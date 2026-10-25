#include "FlightModel.h"
#include <cstdio>

namespace skyline {

Aircraft::Aircraft(const AircraftDef& def) : Def(def), Aero(DeriveAero(def)) {
  for (int i = 0; i < def.Eng.N; i++) {
    Engines.emplace_back(def.Eng, i, Aero.EngPos[i]);
    EngineCmds.push_back(EngineCmd());
  }
  Fuel = def.M.Fuel * 0.6;
  Payload = def.M.Payload * 0.6;
  Atm = Atmosphere(0);
}

V3 Aircraft::Inertia() const {
  const double r = Mass() / (Def.M.Empty + 0.5 * Def.M.Fuel + 0.4 * Def.M.Payload);
  return {Aero.Ixx * r, Aero.Iyy * r, Aero.Izz * r};
}

void Aircraft::Place(double lat, double lon, double alt, double hdgDeg, double speedKt, double pitchDeg) {
  Lat = lat; Lon = lon; Alt = alt;
  const double th = std::isnan(pitchDeg) ? (speedKt > 0 ? 2 : StaticPitch()) : pitchDeg;
  Q = QFromEuler(hdgDeg * DEG, th * DEG, 0);
  const double v = speedKt * KT;
  Vel = V3(std::cos(hdgDeg * DEG) * v, std::sin(hdgDeg * DEG) * v, 0);
  W = V3();
  Crashed = false; CrashReason.clear();
  TailStrike = false;
  Trim = 0;
  De = Da = Dr = 0;
  Cmd = ControlCmd();
  SampleT = 0;
  Gs0 = GroundSample();
  Gs0.H = alt;
  RotorRpm = 0;
  UpdateDerived();
}

double Aircraft::StaticPitch() const {
  const GearLeg* tail = nullptr;
  for (const GearLeg& g : Aero.Gear) if (g.Tail) tail = &g;
  if (!tail) return IsRotor() ? 0 : 0.5;
  const GearLeg& main = Aero.Gear[0];
  return std::atan2(main.Pos.Z - tail->Pos.Z, main.Pos.X - tail->Pos.X) * RAD;
}

double Aircraft::RestHeight() const {
  const double th = StaticPitch() * DEG;
  double h = 0;
  for (const GearLeg& l : Aero.Gear) h = std::max(h, -std::sin(th) * l.Pos.X + std::cos(th) * l.Pos.Z);
  return h - 0.06;
}

void Aircraft::SetAllEngines(bool on) {
  for (Engine& e : Engines) e.SetRunning(on);
  if (on && IsRotor()) RotorRpm = 1;
}

void Aircraft::Step(double dt, const SimEnv& env) {
  if (Crashed) return;
  Time += dt;

  // ground sample (throttled)
  SampleT -= dt;
  if (SampleT <= 0) {
    if (env.Ground) Gs0 = env.Ground(Lat, Lon);
    SampleT = 0.05;
  }
  GroundH = Gs0.H; OnWater = Gs0.Water; OnRunway = Gs0.Runway;
  Agl = Alt - GroundH;

  // atmosphere & air data
  const Weather& wx = env.Wx;
  Atm = Atmosphere(Alt, wx.DeltaT, wx.Qnh * 100);
  const Air air = Atm;
  Wind = WindAt(wx, Alt, std::max(0.0, Agl - Aero.CgHeight), env.Time);
  const V3 vAirN = Vel - Wind;
  const V3 vb = QRotInv(Q, vAirN);
  VAir = vb;
  const double v = std::max(Len(vb), 0.01);
  Tas = v;
  Mach = v / air.A;
  Alpha = std::atan2(vb.Z, std::max(std::fabs(vb.X), 0.1) * (vb.X == 0 ? 1 : Sign(vb.X)));
  if (vb.X < 0) Alpha = std::atan2(vb.Z, vb.X);  // flying backwards (tail slide)
  Beta = std::asin(Clamp(vb.Y / v, -1, 1));
  Qbar = 0.5 * air.Rho * v * v;

  // actuators
  const double rate = Def.Fbw != FbwLaw::None ? 3.5 : 4.5;  // full-scale per second
  De = MoveToward(De, Clamp(Cmd.De, -1, 1), rate * dt);
  Da = MoveToward(Da, Clamp(Cmd.Da, -1, 1), rate * dt);
  Dr = MoveToward(Dr, Clamp(Cmd.Dr + RudderTrim, -1, 1), rate * 0.8 * dt);
  const double flapTarget = Aero.Flaps[FlapIdx].Deg;
  const double flapRate = (Def.Cat == Category::GA || Def.Cat == Category::Vintage) ? 5 : 1.6;
  FlapPos = MoveToward(FlapPos, flapTarget, flapRate * dt);
  if (Def.Gear.Retract) GearPos = MoveToward(GearPos, GearDown ? 1 : 0, dt / (Def.Cat == Category::GA ? 6 : 9));
  else GearPos = 1;
  // ground spoilers
  double sbTarget = Speedbrake;
  bool allIdle = true;
  for (const EngineCmd& c : EngineCmds) if (c.Throttle >= 0.1) allIdle = false;
  if (SpoilerArm && OnGround && allIdle && Gs > 20 * KT) sbTarget = 1.6;
  SpoilerPos = MoveToward(SpoilerPos, sbTarget, dt * 1.2);

  // engines
  double fuelFlow = 0;
  EngineEnv eenv;
  eenv.Atm = air; eenv.V = v; eenv.Mach = Mach; eenv.FuelOk = Fuel > 0.5 || Def.M.Fuel == 0; eenv.Dt = dt;
  for (size_t i = 0; i < Engines.size(); i++) {
    Engines[i].Update(EngineCmds[i], eenv);
    fuelFlow += Engines[i].FuelFlow;
  }
  Fuel = std::max(0.0, Fuel - fuelFlow / 3600 * dt);

  const double mass = Mass();
  const V3 inertia = Inertia();

  V3 f, mom;
  if (IsRotor()) RotorForces(dt, air, vb, v, f, mom);
  else FixedWingForces(v, f, mom);

  // thrust (fixed-wing)
  if (!IsRotor()) {
    for (const Engine& e : Engines) {
      const V3 tf(e.Thrust, 0, 0);
      f += tf;
      // thrust line relative to the CG (CG sits below the fuselage centreline on real aircraft)
      const double armZ = Clamp(e.Pos.Z, -0.3 * Def.Diameter, 0.25 * Def.Diameter);
      mom += Cross(V3(e.Pos.X, e.Pos.Y, armZ), tf);
      // single-engine propeller torque & P-factor (left-turning tendency)
      if ((e.Def.T == EngineType::Prop || e.Def.T == EngineType::TProp) && Def.Eng.N == 1) {
        const double omega = std::max(50.0, e.Rpm / 60 * 2 * kPi);
        mom.X -= e.Power / omega * 0.6;
        mom.Z -= e.Thrust * 0.006 * Def.Span * (0.5 + Clamp(Alpha * 6, -0.5, 1)) * Clamp(1 - v / 70, 0, 1);
      }
    }
  }

  // gravity
  const V3 gB = QRotInv(Q, V3(0, 0, G0 * mass));
  f += gB;

  // ground reaction
  GroundContact(f, mom, mass);

  // integrate
  const V3 aN = QRot(Q, f * (1.0 / mass));
  Nx = (f.X - gB.X) / (mass * G0);
  Ny = (f.Y - gB.Y) / (mass * G0);
  Nz = -(f.Z - gB.Z) / (mass * G0);
  Vel = Vel + aN * dt;
  const V3 iw(inertia.X * W.X, inertia.Y * W.Y, inertia.Z * W.Z);
  const V3 gyro = Cross(W, iw);
  // everything except the control-surface contribution (used by dynamic-inversion control laws)
  if (!IsRotor()) {
    ClRest = mom.X - gyro.X - CtrlM.X;
    CmRest = mom.Y - gyro.Y - CtrlM.Y;
    CnRest = mom.Z - gyro.Z - CtrlM.Z;
  }
  W = V3(W.X + (mom.X - gyro.X) / inertia.X * dt, W.Y + (mom.Y - gyro.Y) / inertia.Y * dt, W.Z + (mom.Z - gyro.Z) / inertia.Z * dt);
  for (int i = 0; i < 3; i++) W[i] = Clamp(W[i], -12, 12);
  Q = QIntegrate(Q, W, dt);
  const double rn = R_EARTH + Alt;
  Lat += Vel.X / rn * dt * RAD;
  Lon += Vel.Y / (rn * std::cos(Lat * DEG)) * dt * RAD;
  if (Lon > 180) Lon -= 360;
  if (Lon < -180) Lon += 360;
  Alt -= Vel.Z * dt;

  UpdateDerived();
  CheckLimits();
}

void Aircraft::UpdateDerived() {
  const V3 e = QToEuler(Q);
  Psi = e.X; Theta = e.Y; Phi = e.Z;
  Gs = std::hypot(Vel.X, Vel.Y);
  Track = Wrap360(std::atan2(Vel.Y, Vel.X) * RAD);
  Vs = -Vel.Z;
  Ias = TasToCas(Tas, Atm);
  Agl = Alt - GroundH;
}

void Aircraft::FixedWingForces(double v, V3& f, V3& mom) {
  const AeroModel& A = Aero;
  const double area = Def.Area, span = Def.Span, chord = A.Chord;
  const double qS = Qbar * area;
  const double alpha = Alpha, beta = Beta;
  const double vn = std::max(v, 5.0);
  const double ph = W.X * span / (2 * vn), qh = W.Y * chord / (2 * vn), rh = W.Z * span / (2 * vn);

  // flaps interpolate between detents by actual deflection
  const std::vector<FlapDetent>& fl = A.Flaps;
  size_t fi = 0;
  while (fl.size() >= 2 && fi < fl.size() - 2 && fl[fi + 1].Deg < FlapPos) fi++;
  const FlapDetent& f0 = fl[fi];
  const FlapDetent& f1 = fl[std::min(fi + 1, fl.size() - 1)];
  const double ft = f1.Deg == f0.Deg ? 0 : Clamp((FlapPos - f0.Deg) / (f1.Deg - f0.Deg), 0, 1);
  const double dCL = f0.DCL + (f1.DCL - f0.DCL) * ft;
  const double dCLmax = f0.DCLmax + (f1.DCLmax - f0.DCLmax) * ft;
  const double dCDf = f0.DCD + (f1.DCD - f0.DCD) * ft;
  const double dCmf = f0.DCm + (f1.DCm - f0.DCm) * ft;

  // compressibility on lift slope (Prandtl-Glauert, capped)
  const double mc = std::min(Mach, 0.9);
  const double pg = Mach < 1 ? 1 / std::sqrt(1 - mc * mc) : 1 / std::sqrt(std::max(0.2, Mach * Mach - 1)) * 0.6;
  const double cla = A.CLa * std::min(pg, 1.6) / (1 / std::sqrt(1 - 0.09));  // A.CLa computed at M 0.3
  const double machStallLoss = Mach > 0.6 ? Clamp((Mach - 0.6) * 1.2, 0, 0.5) : 0;  // buffet boundary
  const double clmax = (A.CLmax + dCLmax) * (1 - machStallLoss);
  const double clmin = A.CLmin;

  // ground effect
  const double hWing = std::max(0.1, Agl - A.CgHeight + 0.5);
  const double hb = hWing / span;
  const double geInduced = hb < 1 ? std::pow(16 * hb, 2) / (1 + std::pow(16 * hb, 2)) : 1;
  const double geLift = hb < 1 ? 1 + 0.12 * std::pow(1 - hb, 3) : 1;

  const double aLin = alpha - A.A0;
  const double aStallEff = (clmax - dCL) / cla;
  double cl;
  double stall = 0;
  const double clLin = cla * aLin + dCL;
  if (aLin <= aStallEff && clLin >= clmin) {
    cl = clLin;
  } else if (aLin > aStallEff) {
    const double x = aLin - aStallEff;
    stall = Smoothstep(0, 6 * DEG, x);
    const double fp = 2 * std::sin(alpha) * std::cos(alpha) * 1.05;  // flat plate
    const double drop = clmax * (1 - 0.25 * Smoothstep(0, 8 * DEG, x));
    cl = drop + (fp - drop) * Smoothstep(8 * DEG, 25 * DEG, x);
    if (Def.Cockpit == CockpitKind::Fighter || Def.Tail == TailKind::Delta) {  // vortex lift: gentle stall
      cl = clmax * (1 - 0.1 * Smoothstep(0, 15 * DEG, x)) + (fp - clmax) * Smoothstep(20 * DEG, 45 * DEG, x);
      stall *= 0.4;
    }
  } else {
    const double x = clmin / cla - aLin;
    stall = Smoothstep(0, 6 * DEG, x);
    const double fp = 2 * std::sin(alpha) * std::cos(alpha);
    cl = clmin + (fp - clmin) * Smoothstep(4 * DEG, 20 * DEG, x);
  }
  Stall = stall;
  // Polhamus vortex lift on slender deltas
  if (Def.Tail == TailKind::Delta && Def.Sweep > 45)
    cl += 2.4 * std::pow(std::sin(alpha), 2) * std::cos(alpha) * Sign(alpha) * (1 - stall * 0.5);
  cl *= geLift;
  cl -= 0.45 * std::min(SpoilerPos, 1.0) * std::max(0.0, cl) * 0.6 + (SpoilerPos > 1 ? 0.5 : 0) * cl;
  // stall buffet on lift
  if (stall > 0) cl += (std::sin(Time * 23) * 0.04 + std::sin(Time * 37) * 0.03) * stall;

  const double cdi = cl * cl / (kPi * A.Oswald * A.AR) * geInduced;
  const double cdGear = A.CDgear * GearPos;
  const double cdPost = stall * 1.1 * std::pow(std::sin(alpha), 2);
  const double cdBeta = 0.5 * beta * beta;
  const double cdSb = 0.05 * std::min(SpoilerPos, 1.0) + (SpoilerPos > 1 ? 0.04 : 0);
  const double cd = A.CD0 + dCDf + cdGear + cdi + cdPost + cdBeta + cdSb + WaveDrag(Mach, A.Mcrit, A.WavePeak);
  CL = cl; CD = cd;
  const double cy = A.CYb * beta - A.CYdr * Dr * (A.MaxDr / (25 * DEG));

  // stability-axis -> body
  const double ca = std::cos(alpha), sa = std::sin(alpha);
  const double lift = cl * qS, drag = cd * qS;
  f.X += -drag * ca + lift * sa;
  f.Z += -drag * sa - lift * ca;
  f.Y += cy * qS;

  // moments
  const double deEff = De * A.MaxDe + Trim * A.TrimRange;
  const double ctrlFade = 1 - 0.5 * stall;
  const double cmRest = A.Cm0 + A.Cma * alpha + A.Cmq * qh + dCmf - 0.25 * stall * Sign(alpha) * 0.4 +
                        0.02 * GearPos * (Def.Gear.Retract ? 1 : 0) - 0.01 * std::min(SpoilerPos, 1.0);
  const double cm = cmRest + A.Cmde * deEff * ctrlFade;
  // wing drop at stall (asymmetric, depends on yaw/sideslip)
  const double wingDrop = stall * Clamp(rh * 20 + beta * 4 + std::sin(Time * 1.7) * 0.3, -1, 1) * 0.06;
  const double clRestC = A.Clb * beta + A.Clp * (1 - 0.8 * stall) * ph + A.Clr * rh + wingDrop + A.Cldr * Dr * A.MaxDr;
  const double clRoll = clRestC + A.Clda * Da * A.MaxDa * ctrlFade;
  const double cnRestC = A.Cnb * beta + A.Cnr * rh + A.Cnp * ph + A.Cnda * Da * A.MaxDa;
  const double cn = cnRestC + A.Cndr * Dr * A.MaxDr;
  mom.X += clRoll * qS * span;
  mom.Y += cm * qS * chord;
  mom.Z += cn * qS * span;

  CtrlM = V3(A.Clda * Da * A.MaxDa * ctrlFade * qS * span, A.Cmde * De * A.MaxDe * ctrlFade * qS * chord, A.Cndr * Dr * A.MaxDr * qS * span);
  CtrlPower.Pitch = A.Cmde * A.MaxDe * qS * chord * ctrlFade;
  CtrlPower.Roll = A.Clda * A.MaxDa * qS * span * ctrlFade;
  CtrlPower.Yaw = A.Cndr * A.MaxDr * qS * span;
}

void Aircraft::RotorForces(double dt, const Air& air, const V3& vb, double v, V3& f, V3& mom) {
  const double radius = Def.Rotor.D / 2;
  const bool tandem = Def.Rotor.Tail == RotorTail::Tandem;
  const double disk = kPi * radius * radius * (tandem ? 1.6 : 1);
  const double mass = Mass();
  const double hubH = 0.5 * Def.Diameter + 1.1;

  // engine power available -> rotor rpm governor
  double pAvail = 0;
  for (const Engine& e : Engines) pAvail += std::max(0.0, e.Power);
  const double wMax = Def.M.Mtow * G0;
  const double tMax = wMax * 1.45;
  const double coll = Clamp(Collective, 0, 1);
  const double omega = RotorRpm;  // normalised (1 = 100 %)

  // translational lift & ground effect
  const double vh = std::hypot(vb.X, vb.Y);
  const double vHover = std::sqrt(wMax / (2 * air.Rho * disk));
  const double etl = 1 + 0.22 * Smoothstep(8, 22, vh) - 0.06 * Smoothstep(40, 80, vh);
  const double zr = std::max(0.3, Agl - Aero.CgHeight + hubH);
  const double ige = zr < 2 * radius ? 1 / (1 - std::pow(radius / (4 * zr), 2) * 0.9) : 1;
  // vortex ring state: descending into own downwash at low airspeed
  const double descent = vb.Z;
  const double vrs = Smoothstep(0.5 * vHover, 0.95 * vHover, descent) * (1 - Smoothstep(8, 16, vh));
  const double inflowCorr = Clamp(1 + descent / vHover * 0.35, 0.3, 1.6);

  double thrust = tMax * (0.08 + 0.92 * coll) * (air.Rho / 1.225) * omega * omega * etl * std::min(ige, 1.35) * inflowCorr *
                  (1 - 0.3 * vrs * (0.8 + 0.2 * std::sin(Time * 9)));
  thrust = std::max(0.0, thrust);

  // power required
  const double vi = std::sqrt(thrust / (2 * air.Rho * disk)) / std::sqrt(1 + std::pow(vh / std::max(1.0, vHover), 2) * 3);
  const double pInd = thrust * vi / 0.75;
  const double pProfile = 0.12 * (wMax * vHover) / 0.75;
  const double fArea = 0.012 * std::pow(Def.M.Mtow, 0.66);
  const double pPar = 0.5 * air.Rho * std::pow(vh, 3) * fArea;
  const double pClimb = std::max(-0.8 * pInd, -thrust * descent * 0.9);
  const double pReq = std::max(0.0, pInd + pProfile * std::pow(omega, 3) + pPar + pClimb);
  const double jRotor = 0.5 * Def.M.Mtow * 1.6 * radius * radius * 0.15;
  const double omegaRad = 30 * omega + 0.1;
  const double pUsed = std::min(pAvail, pReq + (1.0 - omega) * 4 * pReq + 0.05 * pAvail * (omega < 1 ? 1 : 0));
  const double autorot = std::max(0.0, thrust * descent * 0.9 - pInd * 0.5);
  const double dOmega = (pUsed + autorot - pReq) / (jRotor * omegaRad * 30) * dt;
  RotorRpm = Clamp(omega + dOmega, 0, 1.12);
  bool anyRunning = false;
  for (const Engine& e : Engines) if (e.Running) anyRunning = true;
  if (pAvail > pReq * 1.02 && anyRunning) RotorRpm = Approach(RotorRpm, 1, 0.4, dt);
  TorquePct = pAvail > 0 ? std::min(pReq, pAvail) / (Def.Eng.P * 1000 * Def.Eng.N) * 100 : 0;

  // cyclic: disk tilt (with blow-back proportional to forward speed)
  const double maxTilt = 9 * DEG;
  const double a1 = -De * maxTilt + 0.0045 * vb.X * (1 / (1 + vh / 60));
  const double b1 = Da * maxTilt - 0.002 * vb.Y;
  const V3 tb(-thrust * std::sin(a1), thrust * std::sin(b1), -thrust * std::cos(a1) * std::cos(b1));
  f += tb;
  const V3 mT = Cross(V3(0, 0, -hubH), tb);
  const double hubStiff = mass * G0 * 1.4 * (Def.Rotor.Blades >= 4 ? 1.3 : 0.9);
  mom.X += mT.X + hubStiff * b1 * omega * omega;
  mom.Y += mT.Y - hubStiff * a1 * omega * omega;
  // rotor damping (flapping)
  const double damp = mass * radius * radius * 0.9 * omega;
  mom.X += -damp * W.X;
  mom.Y += -damp * W.Y * 1.1;

  // torque reaction & anti-torque
  const double qMain = pReq / std::max(5.0, omegaRad);
  const double armT = 0.6 * Def.Length;
  const double yawAuthority = tandem ? mass * G0 * 0.18 * armT : (qMain * 1.6 + mass * G0 * 0.05 * armT) * omega;
  mom.Z += (tandem ? 0 : qMain * omega * 0.92) + Dr * yawAuthority - (tandem ? 0 : qMain * 0.92 * omega * 0.95);
  mom.Z += -W.Z * mass * armT * armT * 0.25 * (0.6 + 0.4 * omega);
  mom.X += Dr * yawAuthority * 0.02;  // tail rotor thrust also rolls slightly

  // fuselage drag and fin weathercock
  f.X += -0.5 * air.Rho * std::fabs(vb.X) * vb.X * fArea;
  f.Y += -0.5 * air.Rho * std::fabs(vb.Y) * vb.Y * fArea * 5;
  f.Z += -0.5 * air.Rho * std::fabs(vb.Z) * vb.Z * fArea * 6;
  mom.Z += 0.5 * air.Rho * v * vb.Y * fArea * 3.0 * armT * 0.4;
  mom.Y += 0.5 * air.Rho * v * -vb.Z * fArea * 0.8 * armT * 0.15;

  Alpha = std::atan2(vb.Z, std::max(1.0, vb.X));
  Stall = vrs;
  CL = thrust / (mass * G0);
  CmRest = mom.Y;
  ClRest = mom.X;
  CnRest = mom.Z;
  CtrlPower.Pitch = hubStiff * maxTilt + thrust * hubH * maxTilt;
  CtrlPower.Roll = hubStiff * maxTilt + thrust * hubH * maxTilt;
  CtrlPower.Yaw = yawAuthority;
}

void Aircraft::GroundContact(V3& f, V3& mom, double mass) {
  const AeroModel& A = Aero;
  const double gh = GroundH;
  const double wet = OnRunway ? 0.75 : 0.55;
  OnGround = false;
  Wow.clear();
  GearCompression.clear();
  double vsTouch = 0;
  const bool gearOk = GearPos > 0.98;
  for (const GearLeg& leg : A.Gear) {
    const V3 rN = QRot(Q, leg.Pos);
    const double depth = gh - (Alt - rN.Z);
    GearCompression.push_back(std::max(0.0, depth));
    if (depth <= 0 || !gearOk) { Wow.push_back(false); continue; }
    Wow.push_back(true);
    OnGround = true;
    const V3 vP = Vel + QRot(Q, Cross(W, leg.Pos));
    if (vP.Z > vsTouch) vsTouch = vP.Z;
    const double dd = std::min(depth, 1.2);
    double n = leg.K * dd + leg.C * vP.Z;
    if (depth > 0.8) n += leg.K * 10 * (depth - 0.8);  // bottoming
    n = std::max(0.0, n);
    // wheel orientation
    double steer = 0;
    if (leg.Steer > 0) {
      const double lim = leg.Tail ? leg.Steer : leg.Steer * (leg.Steer > 40 ? Clamp(1 - Gs / 40, 0.1, 1) : 1);
      steer = Dr * lim * DEG;
      if (leg.Tail && std::fabs(Dr) > 0.95) steer = 0;  // tailwheel unlocks: free castor approximated
    }
    const double hd = Psi + steer;
    const double fx = std::cos(hd), fy = std::sin(hd);
    const double vLong = vP.X * fx + vP.Y * fy;
    const double vLat = -vP.X * fy + vP.Y * fx;
    double brake = 0;
    if (leg.Brake) {
      const double b0 = leg.Name[0] == 'L' ? BrakeL : leg.Name[0] == 'R' ? BrakeR : std::max(BrakeL, BrakeR);
      brake = std::max({b0, ParkingBrake ? 1.0 : 0.0, AutobrakeCmd});
    }
    const bool isSkid = leg.Name.find("SKID") != std::string::npos;
    const double muRoll = isSkid ? 0.5 : OnWater ? 0.2 : OnRunway ? 0.015 : 0.05;
    const double mu = std::max(muRoll, wet * brake);
    const double holding = (ParkingBrake || isSkid) ? 0.05 : 0.25;
    const double fLong = -mu * n * std::tanh(vLong / holding);
    const double fLat = -(leg.Tail ? 0.35 : wet * 1.1) * n * std::tanh(vLat / 0.25);
    const V3 fb = QRotInv(Q, V3(fx * fLong - fy * fLat, fy * fLong + fx * fLat, -n));
    f += fb;
    mom += Cross(leg.Pos, fb);
  }

  // structural contacts (belly, tail, wingtips, pods, and all points if gear is up)
  std::string structHit;
  std::vector<Contact> pts = A.Structure;
  if (!gearOk) for (const GearLeg& g : A.Gear) pts.push_back({"BELLY", V3(g.Pos.X, g.Pos.Y, A.CgHeight * 0.45)});
  for (const Contact& s : pts) {
    const V3 rN = QRot(Q, s.Pos);
    const double depth = gh - (Alt - rN.Z);
    if (depth <= 0) continue;
    const V3 vP = Vel + QRot(Q, Cross(W, s.Pos));
    if (s.Name == "TAIL" && Def.Fdm == FdmKind::Fixed) TailStrike = true;
    // scrape: strong friction + support
    const double n = mass * G0 * 8 * depth + mass * 2 * std::max(0.0, vP.Z);
    const V3 fb = QRotInv(Q, V3(-std::tanh(vP.X) * n * 0.5, -std::tanh(vP.Y) * n * 0.5, -n));
    f += fb;
    mom += Cross(s.Pos, fb);
    const double speed = std::hypot(vP.X, vP.Y);
    if (s.Name == "TAIL" && vP.Z < 2.5 && speed < 110) continue;  // tail strike: damage but not destruction
    if (s.Name == "BELLY" && vP.Z < 2 && speed < 60 && !gearOk) { BellyLanding = true; continue; }
    if (vP.Z > 1.5 || speed > 25 || s.Name.find("WINGTIP") != std::string::npos || s.Name == "NOSE" || s.Name == "POD") structHit = s.Name;
  }
  if (OnGround && !PrevOnGround) {
    LastTouchVs = vsTouch;
    TouchdownEvent++;
    const double lim = A.Gear.empty() ? 3.8 : A.Gear[0].LimitVs;
    if (vsTouch > lim * 1.35) DoCrash("랜딩기어 파손 — 접지 강하율 " + std::to_string(static_cast<int>(vsTouch / FPM)) + " fpm");
  }
  if (OnGround && OnWater && Gs > 3 && Def.Gear.T != GearKind::Float) DoCrash("수면 착수 — 기체 손실");
  if (!structHit.empty()) {
    const char* label = structHit == "NOSE" ? "기수" : structHit == "TAIL" ? "후미" : structHit == "LWINGTIP" ? "좌측 날개끝"
                      : structHit == "RWINGTIP" ? "우측 날개끝" : structHit == "POD" ? "엔진 나셀" : structHit == "BELLY" ? "동체" : structHit.c_str();
    DoCrash(std::string("지면 충돌 — ") + label + " 접촉");
  }
  PrevOnGround = OnGround;
}

void Aircraft::CheckLimits() {
  if (std::fabs(Nz) > Aero.GLimit * 1.5) {
    char buf[96];
    std::snprintf(buf, sizeof buf, "구조 파괴 — 하중배수 %.1f G 초과", Nz);
    DoCrash(buf);
  }
  if (Ias > Def.V.Vmo * 1.25 * KT && Def.Fdm == FdmKind::Fixed) DoCrash("구조 파괴 — 설계 급강하 속도(VD) 초과");
  if (Alt < GroundH - 30) DoCrash("지형 충돌");
}

void Aircraft::DoCrash(const std::string& reason) {
  if (Crashed) return;
  Crashed = true;
  CrashReason = reason;
  CrashTime = Time;
}

}  // namespace skyline
