#include "FlightControl.h"

namespace skyline {

const char* LatModeName(LatMode m) {
  switch (m) {
    case LatMode::Off: return "OFF";
    case LatMode::Rol: return "ROL";
    case LatMode::Hdg: return "HDG";
    case LatMode::Nav: return "NAV";
    case LatMode::Loc: return "LOC";
    case LatMode::Rwy: return "RWY";
    case LatMode::Rollout: return "ROLLOUT";
    case LatMode::GoAround: return "GA";
  }
  return "";
}

const char* VertModeName(VertMode m) {
  switch (m) {
    case VertMode::Off: return "OFF";
    case VertMode::Pit: return "PIT";
    case VertMode::Vs: return "VS";
    case VertMode::Alt: return "ALT";
    case VertMode::AltStar: return "ALT*";
    case VertMode::Flc: return "FLC";
    case VertMode::Gs: return "GS";
    case VertMode::Flare: return "FLARE";
    case VertMode::Toga: return "TOGA";
    case VertMode::Vnav: return "VNAV";
  }
  return "";
}

double FlightPlan::RemainingNm(const LatLon& pos) const {
  const Waypoint* to = To();
  if (!to) return 0;
  double d = Distance(pos, LatLon{to->Lat, to->Lon});
  for (int i = Active; i < static_cast<int>(Wps.size()) - 1; i++)
    d += Distance(LatLon{Wps[i].Lat, Wps[i].Lon}, LatLon{Wps[i + 1].Lat, Wps[i + 1].Lon});
  return d / NM;
}

IlsDeviation ComputeIls(const ApproachDef& ap, const LatLon& pos, double altM) {
  IlsDeviation r;
  const double dLoc = Distance(pos, ap.LocAnt);
  const double xtk = CrossTrack(ap.Thr, ap.LocAnt, pos);
  r.LocDeg = std::atan2(xtk, dLoc) * RAD;
  const double dGs = std::max(1.0, Distance(pos, ap.GsAnt));
  const double hRel = altM - ap.Elev;
  r.GsDeg = std::atan2(hRel, dGs) * RAD - ap.GsAngle;
  const double brgToThr = Bearing(pos, ap.Thr);
  const bool inFront = std::fabs(Wrap180(brgToThr - ap.Crs)) < 90 || Distance(pos, ap.Thr) < 3000;
  r.Valid = dLoc < 25 * NM && std::fabs(r.LocDeg) < 35 && inFront;
  r.Loc = Clamp(-r.LocDeg / 1.25, -2.5, 2.5);
  r.Gs = Clamp(-r.GsDeg / 0.35, -2.5, 2.5);
  r.GsValid = r.Valid && std::fabs(r.LocDeg) < 10 && dGs < 20 * NM;
  r.DistNm = Distance(pos, ap.Thr) / NM;
  r.Hat = hRel;
  return r;
}

FlightControl::FlightControl(Aircraft& ac) : Ac(ac) {
  SelHdg = std::round(ac.Heading());
  SelSpd = std::round(ac.Def.V.Vref * 1.3);
}

bool FlightControl::HasAthr() const {
  const EngineType t = Ac.Def.Eng.T;
  return (t == EngineType::Fan || t == EngineType::Jet || t == EngineType::TProp) && Ac.Def.Cat != Category::GA && Ac.Def.Cat != Category::Vintage;
}

double FlightControl::Vref() const {
  if (Ac.IsRotor()) return 60;
  return Ac.Def.V.Vref * std::sqrt(Ac.Mass() / Ac.Def.M.Mlw);
}

VSpeeds FlightControl::Speeds() const {
  const double w = std::sqrt(Ac.Mass() / Ac.Def.M.Mtow);
  const double vr = Ac.Def.V.Vr * w;
  VSpeeds s;
  s.V1 = vr - 4;
  s.Vr = vr;
  s.V2 = (Ac.Def.V.V2 > 0 ? Ac.Def.V.V2 : vr + 8) * w;
  s.Vref = Vref();
  s.Vapp = s.Vref + 5;
  return s;
}

static double HdgOr360(double h) { const double r = std::round(h); return r == 0 ? 360 : r; }

void FlightControl::EngageAp(bool on) {
  if (on == Ap) return;
  Ap = on;
  if (on) {
    if (Ac.OnGround && !Ac.IsRotor()) { Ap = false; Msg = "AP: 지상에서는 연결할 수 없습니다"; return; }
    if (Lat == LatMode::Off) { Lat = LatMode::Hdg; SelHdg = HdgOr360(HdgMag()); }
    if (Vert == VertMode::Off) {
      Vert = VertMode::Vs;
      SelVs = std::round(Ac.Vs / FPM / 100) * 100;
      if (std::fabs(SelVs) < 200) { Vert = VertMode::Alt; SelAlt = std::round(Ac.Alt / FT / 100) * 100; AltHold = SelAlt; }
    }
    PitchHold = Ac.Theta * RAD;
    AEst = Ac.Alpha * RAD;
    VsPid.Reset();
  } else {
    ApDisconnectWarn = 3;
    FbwVtrim = Ac.Ias;
  }
}

void FlightControl::SetLat(LatMode m) {
  if (m == LatMode::Loc) { LatArmed = Lat == LatMode::Loc ? LatMode::Off : LatMode::Loc; return; }
  Lat = Lat == m ? LatMode::Hdg : m;
  if (Lat == LatMode::Hdg && m != LatMode::Hdg) SelHdg = HdgOr360(HdgMag());
}

void FlightControl::SetVert(VertMode m) {
  VsPid.Reset();
  if (m == Vert) m = VertMode::Vs;
  if (m == VertMode::Alt) AltHold = std::round(Ac.Alt / FT);
  if (m == VertMode::Vs) SelVs = std::round(Ac.Vs / FPM / 100) * 100;
  if (m == VertMode::Flc) {
    FlcGamma = std::atan2(Ac.Vs, Ac.Tas) * RAD;
    if (std::fabs(SelAlt - Ac.Alt / FT) < 100) { Msg = "FLC: 목표 고도를 먼저 선택하세요"; return; }
    SelSpd = std::round(Ac.Ias / KT);
  }
  if (m == VertMode::Pit) PitchHold = Ac.Theta * RAD;
  Vert = m;
}

void FlightControl::ArmApp() {
  if (!Plan.HasApproach) { Msg = "APP: 도착 활주로(ILS)가 설정되지 않았습니다"; return; }
  LatArmed = LatMode::Loc; VertArmed = VertMode::Gs;
}

void FlightControl::Toga() {
  Vert = VertMode::Toga;
  Lat = Ac.OnGround ? LatMode::Rwy : LatMode::GoAround;
  SelHdg = HdgOr360(HdgMag());
  if (HasAthr()) Athr = AthrMode::Toga;
  Flare = false; GsCaptured = false; LatArmed = LatMode::Off; VertArmed = VertMode::Off;
}

void FlightControl::ToggleAthr() {
  if (!HasAthr()) { Msg = "A/THR: 이 기종에는 오토스로틀이 없습니다"; return; }
  if (Athr == AthrMode::Off) {
    Athr = AthrMode::Speed;
    AthrPid.Reset();
    ThrCmd = Ac.EngineCmds.empty() ? 0 : Ac.EngineCmds[0].Throttle;
  } else {
    Athr = AthrMode::Off;
  }
}

void FlightControl::Update(double dt, const PilotInput& pin) {
  Aircraft& a = Ac;
  if (ApDisconnectWarn > 0) ApDisconnectWarn -= dt;
  const double iasKt = a.Ias / KT;
  MagVarDeg = MagVar(a.Lat, a.Lon);
  if (LastIas > 0) Accel = Approach(Accel, Clamp((iasKt - LastIas) / std::max(dt, 1e-3), -20, 20), 0.6, dt);
  LastIas = iasKt;

  // pilot override disconnects AP
  if (Ap && !a.IsRotor() && (std::fabs(pin.Pitch) > 0.5 || std::fabs(pin.Roll) > 0.5)) { EngageAp(false); Msg = "AUTOPILOT DISCONNECT (조종간 개입)"; }

  HasIls = Plan.HasApproach;
  if (HasIls) Ils = ComputeIls(Plan.Appr, LatLon{a.Lat, a.Lon}, a.Alt);

  if (a.IsRotor()) { Heli(dt, pin); Autothrottle(dt); return; }

  ModeLogic();
  double tgtPitch = 0, tgtRoll = 0;
  AutopilotTargets(dt, tgtPitch, tgtRoll);
  FdPitch = tgtPitch; FdRoll = tgtRoll;

  const bool fbw = a.Def.Fbw != FbwLaw::None;
  double de = 0, da = 0;
  const bool lowQ = a.Qbar < 400 || a.OnGround;

  if (Ap && !lowQ) {
    InnerLoops(tgtPitch, tgtRoll, de, da);
    // autopilot trim servo keeps the elevator unloaded
    if (!fbw) a.Trim = Clamp(a.Trim + Clamp(a.De, -1, 1) * 0.08 * dt * (a.Aero.MaxDe / a.Aero.TrimRange), -1, 1);
  } else if (fbw && !lowQ && Law == FbwLawState::Normal) {
    FbwControlLaw(dt, pin, de, da);
  } else {
    de = pin.Pitch; da = pin.Roll;
    PitchHold = a.Theta * RAD; BankHold = a.Phi * RAD; RollHoldActive = false;
    FbwVtrim = iasKt;
  }
  // manual pitch trim (conventional); FBW auto-trims
  if (!fbw || lowQ) a.Trim = Clamp(a.Trim + pin.Trim * dt * 0.12, -1, 1);

  // yaw: pedals + yaw damper / turn coordination
  double dr = pin.Yaw;
  if ((Yd && (IsJet() || fbw || a.Def.Cat == Category::Regional || a.Def.Eng.T == EngineType::TProp)) || Ap) {
    if (!a.OnGround && a.Tas > 30) {
      const double rCmd = G0 * std::sin(a.Phi) / std::max(a.Tas, 30.0);
      const V3 inertia = a.Inertia();
      const double rdot = 2.2 * (rCmd - a.W.Z) + 1.5 * a.Beta * (a.Tas / 100);
      YawInt = Clamp(YawInt + a.Beta * dt * 0.5, -0.3, 0.3);
      const double yd = (inertia.Z * rdot - a.CnRest) / std::max(1.0, a.CtrlPower.Yaw);
      dr += Clamp(yd + YawInt, -0.6, 0.6) * ((fbw || Ap) ? 1 : 0.5);
    } else {
      YawInt = 0;
    }
  }
  // rollout: keep centreline with rudder / nosewheel
  if (Lat == LatMode::Rollout && Plan.HasApproach && HasIls) {
    const ApproachDef& ap = Plan.Appr;
    const double xtk = CrossTrack(ap.Thr, ap.LocAnt, LatLon{a.Lat, a.Lon});
    dr = Clamp(-xtk * 0.04 - Wrap180(a.Heading() - ap.Crs) * 0.1 - a.W.Z * 2, -1, 1) + pin.Yaw;
    da = Clamp(-a.Phi * 2, -1, 1);
    if (a.OnGround && a.Autobrake == 0) a.AutobrakeCmd = 0.35;  // autobrake after touchdown
  }
  a.Cmd.De = Clamp(de, -1, 1);
  a.Cmd.Da = Clamp(da, -1, 1);
  a.Cmd.Dr = Clamp(dr, -1, 1);
  Autothrottle(dt);
}

void FlightControl::InnerLoops(double pitchDeg, double rollDeg, double& de, double& da) {
  Aircraft& a = Ac;
  const V3 inertia = a.Inertia();
  const bool big = a.Def.Cat == Category::Widebody;
  const double kth = big ? 0.9 : 1.2, kq = big ? 2.8 : 3.5;
  const double kph = 1.4, kp = 4;
  const double v = std::max(a.Tas, 30.0);
  const double cphi = std::max(0.3, std::cos(a.Phi));
  const double turnComp = G0 * std::sin(a.Phi) * std::tan(a.Phi) / v;
  const double qCmd = Clamp(kth * (pitchDeg * DEG - a.Theta) / cphi + turnComp, -0.15, 0.15);
  const double qdot = kq * (qCmd - a.W.Y);
  de = (inertia.Y * qdot - a.CmRest) / std::max(1.0, a.CtrlPower.Pitch);
  const double rollRateMax = (a.Def.Cockpit == CockpitKind::Fighter ? 60 : 7) * DEG;
  const double pCmd = Clamp(kph * Wrap180(rollDeg - a.Phi * RAD) * DEG, -rollRateMax, rollRateMax);
  const double pdot = kp * (pCmd - a.W.X);
  da = (inertia.X * pdot - a.ClRest) / std::max(1.0, a.CtrlPower.Roll);
}

void FlightControl::FbwControlLaw(double dt, const PilotInput& pin, double& de, double& da) {
  Aircraft& a = Ac;
  const FbwLaw law = a.Def.Fbw;
  const V3 inertia = a.Inertia();
  const double v = std::max(a.Tas, 40.0);
  const double iasKt = a.Ias / KT;
  const bool fighter = law == FbwLaw::Fighter;
  // pitch: load-factor demand
  const double dnz = pin.Pitch >= 0 ? pin.Pitch * (fighter ? 8 : 1.5) : pin.Pitch * (fighter ? 4 : 2);
  const double phi = a.Phi;
  const double turnComp = (std::fabs(phi) < 33 * DEG || fighter) ? G0 * std::sin(phi) * std::tan(phi) / v
                                                                  : G0 * std::sin(33 * DEG) * std::tan(33 * DEG) / v;
  double qCmd = G0 * dnz / v + turnComp;
  // neutral stick: flight-path hold (C* integral term)
  const double gamma = std::atan2(a.Vs, std::max(a.Gs, 1.0));
  if (std::fabs(pin.Pitch) < 0.03 && law != FbwLaw::Boeing) {
    if (!PathHoldActive) { GammaHold = gamma; PathHoldActive = true; }
    qCmd += Clamp(0.4 * (GammaHold - gamma), -0.05, 0.05) * std::cos(phi);
  } else {
    PathHoldActive = false;
  }
  if (law == FbwLaw::Boeing) {
    qCmd += Clamp((iasKt - FbwVtrim) * 0.0012, -0.03, 0.03);
    // pitch trim switch moves the Boeing trim reference speed
    FbwVtrim = Clamp(FbwVtrim - pin.Trim * dt * 6, a.Def.V.Vs1 * 0.8, a.Def.V.Vmo);
  }
  // protections
  const double alphaMax = (a.Aero.CLmax + a.Aero.Flaps[a.FlapIdx].DCLmax) / a.Aero.CLa + a.Aero.A0 - 1.5 * DEG;
  const double alphaProtLim = alphaMax - (fighter ? 0 : 3 * DEG);
  AlphaProt = a.Alpha > alphaProtLim;
  const double aLim = alphaProtLim + std::max(0.0, pin.Pitch) * (alphaMax - alphaProtLim);
  const double fighterAlpha = 25 * DEG;
  qCmd = std::min(qCmd, 2.0 * ((fighter ? fighterAlpha : aLim) - a.Alpha) + (fighter ? 0.2 : 0));
  const double th = a.Theta * RAD;
  if (!fighter) {
    if (th > 25) qCmd = std::min(qCmd, (30 - th) * 0.02);
    if (th < -10) qCmd = std::max(qCmd, (-15 - th) * 0.02);
    if (iasKt > a.Def.V.Vmo + 6) qCmd += (iasKt - a.Def.V.Vmo - 6) * 0.004;
  }
  AlphaFloor = !fighter && a.Alpha > alphaMax - 1 * DEG && !a.OnGround;
  // flare mode (Airbus): below 50 ft RA the law blends to attitude command with nose-down bias
  const double ra = (a.Agl - a.Aero.CgHeight) / FT;
  if (law == FbwLaw::Airbus && ra < 50 && a.Vs < 0 && a.GearDown) {
    if (!Flare) { Flare = true; FlareMemo = th; FlareT = 0; }
    FlareT += dt;
    const double thCmd = FlareMemo - std::min(2.0, FlareT * 0.25) + pin.Pitch * 12;
    qCmd = 1.5 * (thCmd - th) * DEG;
  } else if (ra > 100) {
    Flare = false;
  }
  const double kq = fighter ? 8 : 3;
  const double qdot = kq * (qCmd - a.W.Y);
  de = (inertia.Y * qdot - a.CmRest) / std::max(1.0, a.CtrlPower.Pitch);

  // roll
  const double phiDeg = phi * RAD;
  if (law == FbwLaw::Boeing) {
    da = pin.Roll;
    if (std::fabs(phiDeg) > 35) da -= Sign(phiDeg) * (std::fabs(phiDeg) - 35) * 0.04;
  } else {
    const double pMax = fighter ? 240 : 15;
    double pCmd;
    if (std::fabs(pin.Roll) > 0.03) {
      pCmd = pin.Roll * pMax * DEG;
      BankHold = phiDeg; RollHoldActive = true;
    } else {
      if (!RollHoldActive) { BankHold = phiDeg; RollHoldActive = true; }
      if (!fighter && std::fabs(BankHold) > 33) BankHold = MoveToward(BankHold, Sign(BankHold) * 33, 5 * dt);
      pCmd = (BankHold - phiDeg) * 1.2 * DEG;
    }
    if (!fighter && std::fabs(phiDeg) > 60 && Sign(pCmd) == Sign(phiDeg)) pCmd *= Clamp((67 - std::fabs(phiDeg)) / 7, 0, 1);
    const double pdot = (fighter ? 10 : 4) * (pCmd - a.W.X);
    da = (inertia.X * pdot - a.ClRest) / std::max(1.0, a.CtrlPower.Roll);
  }
  // auto-trim (THS): unload elevator slowly
  if (law == FbwLaw::Airbus && !Flare) a.Trim = Clamp(a.Trim + Clamp(a.De, -1, 1) * 0.3 * dt * (a.Aero.MaxDe / a.Aero.TrimRange), -1, 1);
  de = Clamp(de, -1, 1);
}

void FlightControl::ModeLogic() {
  Aircraft& a = Ac;
  const double altFt = a.Alt / FT;
  const double vsFpm = a.Vs / FPM;
  // altitude capture
  if (Vert == VertMode::Vs || Vert == VertMode::Flc || Vert == VertMode::Pit || Vert == VertMode::Vnav) {
    const double err = SelAlt - altFt;
    const double band = std::max(150.0, std::fabs(vsFpm) * 0.25);
    const bool moving = (err > 0 && vsFpm > 100) || (err < 0 && vsFpm < -100);
    if (std::fabs(err) < band && moving) { Vert = VertMode::AltStar; AltHold = SelAlt; }
  }
  if (Vert == VertMode::AltStar && std::fabs(SelAlt - altFt) < 40) Vert = VertMode::Alt;
  if (Vert == VertMode::AltStar && std::fabs(AltHold - SelAlt) > 1) AltHold = SelAlt;
  // LOC / GS capture
  if (LatArmed == LatMode::Loc && HasIls && Ils.Valid && std::fabs(Ils.Loc) < 1.8) { Lat = LatMode::Loc; LatArmed = LatMode::Off; }
  if (VertArmed == VertMode::Gs && HasIls && Ils.GsValid && Lat == LatMode::Loc && std::fabs(Ils.Gs) < 0.6) {
    Vert = VertMode::Gs; VertArmed = VertMode::Off; GsCaptured = true;
  }
  // autoland: flare / rollout
  const double ra = (a.Agl - a.Aero.CgHeight) / FT;
  const double flareFt = Clamp(25 + a.Def.Length * 0.6, 40, 75);
  if (Vert == VertMode::Gs && Ap && ra < flareFt && !a.OnGround) {
    Vert = VertMode::Flare;
    FlareTau = std::max(1.5, ra * FT / std::max(0.5, -a.Vs - 0.4));
  }
  if ((Vert == VertMode::Flare || Vert == VertMode::Gs) && a.OnGround && Lat == LatMode::Loc) Lat = LatMode::Rollout;
  if (Vert == VertMode::Toga && !a.OnGround && Lat == LatMode::Rwy && ra > 30) Lat = LatMode::Hdg;
  if (Lat == LatMode::Nav) Sequence();
}

void FlightControl::Sequence() {
  Aircraft& a = Ac;
  FlightPlan& p = Plan;
  const Waypoint* from = p.From();
  const Waypoint* to = p.To();
  if (!from || !to) return;
  const LatLon pos{a.Lat, a.Lon}, f{from->Lat, from->Lon}, t{to->Lat, to->Lon};
  const Waypoint* next = p.Active + 1 < static_cast<int>(p.Wps.size()) ? &p.Wps[p.Active + 1] : nullptr;
  const double dist = Distance(pos, t);
  double lead = 0.3 * NM;
  if (next) {
    const double d = std::fabs(Wrap180(Bearing(t, LatLon{next->Lat, next->Lon}) - Bearing(f, t)));
    const double r = a.Gs * a.Gs / (G0 * std::tan(BankLimit() * DEG));
    lead = std::max(0.2 * NM, r * std::tan(d * DEG / 2));
  }
  const bool past = AlongTrack(f, t, pos) > Distance(f, t);
  if (dist < lead || past) {
    if (next) p.Active++;
    else if (p.HasApproach && LatArmed == LatMode::Off && Lat == LatMode::Nav) { LatArmed = LatMode::Loc; VertArmed = VertMode::Gs; }
  }
}

void FlightControl::AutopilotTargets(double dt, double& pitch, double& roll) {
  Aircraft& a = Ac;
  const double v = std::max(a.Tas, 30.0);
  const double altFt = a.Alt / FT;
  roll = 0;
  pitch = a.Theta * RAD;
  const double hdg = HdgMag();
  const double bankLim = BankLimit();
  const LatLon pos{a.Lat, a.Lon};
  auto courseToRoll = [&](double desiredTrack) { return Clamp(Wrap180(desiredTrack - a.Track) * 1.4, -bankLim, bankLim); };
  switch (Lat) {
    case LatMode::Hdg:
    case LatMode::Off: roll = Clamp(Wrap180(SelHdg - hdg) * 1.4, -bankLim, bankLim); break;
    case LatMode::Rol: roll = std::fabs(a.Phi * RAD) < 6 ? 0 : a.Phi * RAD; break;
    case LatMode::Nav: {
      const Waypoint* from = Plan.From();
      const Waypoint* to = Plan.To();
      if (from && to) {
        const LatLon f{from->Lat, from->Lon}, t{to->Lat, to->Lon};
        const double xtk = CrossTrack(f, t, pos);
        const double legCrs = Distance(f, t) > 1000 ? Bearing(f, t) : Bearing(pos, t);
        const double intercept = Clamp(-xtk / NM * 25, -45, 45);
        roll = courseToRoll(legCrs + intercept);
      }
      break;
    }
    case LatMode::Loc:
    case LatMode::Rollout: {
      if (!Plan.HasApproach) break;
      const ApproachDef& ap = Plan.Appr;
      const double dist = std::max(500.0, Distance(pos, ap.LocAnt));
      const double xtk = std::tan(Ils.LocDeg * DEG) * dist;
      const double intercept = Clamp(-xtk * 0.03 * (8000 / std::max(3000.0, dist)), -30, 30);
      roll = courseToRoll(ap.Crs + intercept);
      if ((a.Agl - a.Aero.CgHeight) / FT < 50) roll = Clamp(roll, -3, 3);
      break;
    }
    case LatMode::GoAround:
    case LatMode::Rwy: roll = Clamp(Wrap180(SelHdg - hdg) * 1.0, -15, 15); break;
  }

  auto gammaToPitch = [&](double gammaDeg) { return gammaDeg + AlphaEst(); };
  switch (Vert) {
    case VertMode::Off: pitch = a.Theta * RAD; break;
    case VertMode::Pit: pitch = PitchHold; break;
    case VertMode::Vs: {
      const double vsTgt = SelVs * FPM;
      const double g = std::asin(Clamp(vsTgt / v, -0.5, 0.5)) * RAD;
      pitch = gammaToPitch(g) + VsPid.Update(SelVs - a.Vs / FPM, a.Vs / FPM, dt);
      break;
    }
    case VertMode::Alt:
    case VertMode::AltStar: {
      const double err = AltHold - altFt;
      const double vsTgt = Clamp(err * (Vert == VertMode::Alt ? 4 : 3), -2000, 2000);
      const double g = std::asin(Clamp(vsTgt * FPM / v, -0.5, 0.5)) * RAD;
      pitch = gammaToPitch(g) + VsPid.Update(vsTgt - a.Vs / FPM, a.Vs / FPM, dt);
      break;
    }
    case VertMode::Flc: {
      const bool climbing = SelAlt > altFt;
      const double spdErr = a.Ias / KT - SelSpd;
      FlcGamma += Clamp(spdErr * 0.08 + Accel * 0.25, -1.5, 1.5) * dt;
      FlcGamma = climbing ? Clamp(FlcGamma, 0.5, 18) : Clamp(FlcGamma, -12, -0.5);
      pitch = gammaToPitch(FlcGamma);
      break;
    }
    case VertMode::Gs: {
      if (HasIls) {
        const double gCmd = -Plan.Appr.GsAngle + Clamp(Ils.GsDeg * -3.0, -2.5, 2.5);
        pitch = gammaToPitch(gCmd);
      }
      break;
    }
    case VertMode::Flare: {
      const double ra = std::max(0.0, a.Agl - a.Aero.CgHeight);
      const double vsTgt = -(ra / FlareTau + 0.25);
      const double g = std::asin(Clamp(vsTgt / v, -0.3, 0.1)) * RAD;
      pitch = gammaToPitch(g) + 0.5 + VsPid.Update((vsTgt - a.Vs) / FPM, a.Vs / FPM, dt);
      break;
    }
    case VertMode::Toga:
      pitch = IsJet() ? 15 : 10;
      if (a.Def.Cockpit == CockpitKind::Fighter) pitch = 12;
      break;
    case VertMode::Vnav: break;
  }
  if (a.OnGround && Lat == LatMode::Rollout) pitch = 0;
  pitch = Clamp(pitch, -15, 25);
}

double FlightControl::AlphaEst() {
  // body pitch ~ flight-path + alpha (filtered): theta - gamma
  const double gamma = std::atan2(Ac.Vs, std::max(Ac.Gs, 1.0)) * RAD;
  const double est = Ac.Theta * RAD - gamma;
  AEst = Approach(AEst, Clamp(est, -5, 20), 1.5, 1.0 / 120);
  return AEst;
}

void FlightControl::Autothrottle(double dt) {
  Aircraft& a = Ac;
  if (Athr == AthrMode::Off && !AlphaFloor) return;
  const double iasKt = a.Ias / KT;
  const double maxThr = a.Def.Eng.Ab > 0 ? 0.95 : 1;
  const double clb = a.Def.Eng.T == EngineType::Fan ? 0.9 : 0.95;
  AthrMode mode = Athr;
  if (AlphaFloor && a.Def.Fbw == FbwLaw::Airbus) mode = AthrMode::AlphaFloor;
  if (Vert == VertMode::Flc && Ap) mode = SelAlt > a.Alt / FT ? AthrMode::ThrClb : AthrMode::Idle;
  if (Vert == VertMode::Flare && (a.Agl - a.Aero.CgHeight) / FT < 30) mode = AthrMode::Retard;
  if (a.OnGround && Lat == LatMode::Rollout) mode = AthrMode::Retard;
  if (Athr == AthrMode::Toga) mode = AthrMode::Toga;
  double target;
  switch (mode) {
    case AthrMode::ThrClb: target = clb; AthrDisplay = "THR CLB"; break;
    case AthrMode::Idle: target = 0; AthrDisplay = "IDLE"; break;
    case AthrMode::Retard: target = 0; AthrDisplay = "RETARD"; break;
    case AthrMode::Toga: target = maxThr; AthrDisplay = "TOGA"; break;
    case AthrMode::AlphaFloor: target = maxThr; AthrDisplay = "A.FLOOR"; break;
    default: {
      const double tgtSpd = SpdIsMach ? SelMach * a.Atm.A / (a.Tas / std::max(a.Ias, 1.0)) / KT : SelSpd;
      const double err = tgtSpd - iasKt;
      const double rate = Clamp(err * 0.02 - Accel * 0.12, -0.25, 0.25);
      target = Clamp(ThrCmd + rate * dt * 4, 0, maxThr * 0.98);
      ThrCmd = target;
      for (EngineCmd& c : a.EngineCmds) c.Throttle = MoveToward(c.Throttle, target, dt * 0.3);
      if (Athr != AthrMode::Toga) Athr = AthrMode::Speed;
      AthrDisplay = SpdIsMach ? "MACH" : "SPEED";
      return;
    }
  }
  ThrCmd = target;
  for (EngineCmd& c : a.EngineCmds) c.Throttle = MoveToward(c.Throttle, target, dt * (mode == AthrMode::Retard ? 0.25 : 0.2));
}

void FlightControl::Heli(double dt, const PilotInput& pin) {
  Aircraft& a = Ac;
  const V3 inertia = a.Inertia();
  double de = pin.Pitch, da = pin.Roll, dr = pin.Yaw;
  a.Collective = Clamp(pin.Collective, 0, 1);
  if (Sas) {
    // rate-damping SAS + attitude retention when stick is centred
    de += -a.W.Y * 1.2;
    da += -a.W.X * 1.0;
    dr += -a.W.Z * 1.5;
    if (std::fabs(pin.Pitch) < 0.03 && !a.OnGround) de += (PitchHold * DEG - a.Theta) * 1.5; else PitchHold = a.Theta * RAD;
    if (std::fabs(pin.Roll) < 0.03 && !a.OnGround) da += (BankHold * DEG - a.Phi) * 1.5; else BankHold = a.Phi * RAD;
  }
  if (Ap && !a.OnGround) {
    // attitude autopilot with HDG / ALT / IAS / VS upper modes
    double rollT = 0;
    if (Lat == LatMode::Hdg || Lat == LatMode::Off) rollT = Clamp(Wrap180(SelHdg - HdgMag()) * 1.0, -20, 20);
    if (Lat == LatMode::Nav && Plan.To()) rollT = Clamp(Wrap180(Bearing(LatLon{a.Lat, a.Lon}, LatLon{Plan.To()->Lat, Plan.To()->Lon}) - a.Track) * 1.0, -20, 20);
    const double ias = a.Ias / KT;
    const double pitchT = (ias > 25 || SelSpd > 25) ? Clamp(-(SelSpd - ias) * 0.3, -12, 10) : 0;
    const double qdot = 3 * (1.5 * (pitchT * DEG - a.Theta) - a.W.Y);
    const double pdot = 3 * (1.5 * (rollT * DEG - a.Phi) - a.W.X);
    de = Clamp(inertia.Y * qdot / std::max(1.0, a.CtrlPower.Pitch), -1, 1);
    da = Clamp(inertia.X * pdot / std::max(1.0, a.CtrlPower.Roll), -1, 1);
    PitchHold = a.Theta * RAD; BankHold = a.Phi * RAD;
    double vsTgt = SelVs;
    if (Vert == VertMode::Alt || Vert == VertMode::AltStar) vsTgt = Clamp((AltHold - a.Alt / FT) * 3, -1000, 1000);
    if (Vert == VertMode::Vs && std::fabs(SelAlt - a.Alt / FT) < 100 && std::fabs(SelVs) > 0) { Vert = VertMode::Alt; AltHold = SelAlt; }
    a.Collective = Clamp(HeliCollBase + HeliAltPid.Update(vsTgt - a.Vs / FPM, a.Vs / FPM, dt), 0, 1);
    if (a.Tas > 20) dr += Clamp(-a.Beta * 2, -0.5, 0.5);  // turn coordination
  } else {
    HeliCollBase = a.Collective;
    HeliAltPid.Reset();
    AltHold = a.Alt / FT;
  }
  a.Cmd.De = Clamp(de, -1, 1);
  a.Cmd.Da = Clamp(da, -1, 1);
  a.Cmd.Dr = Clamp(dr, -1, 1);
  FdPitch = a.Theta * RAD; FdRoll = a.Phi * RAD;
}

}  // namespace skyline
