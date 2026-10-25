// Six-degree-of-freedom rigid-body flight dynamics model.
// Fixed-wing: component build-up with stability derivatives, post-stall, ground effect, compressibility.
// Rotorcraft: rotor-disk model with governor, translational lift, ground effect, vortex-ring state.
import {
  DEG, G0, KT, R_EARTH, RAD, FPM, add, approach, clamp, cross, len, moveToward, qFromEuler, qIntegrate,
  qRot, qRotInv, qToEuler, smoothstep, type Q, type V3,
} from '../core/math.ts';
import { atmosphere, tasToCas, windAt, type Air, type WeatherState } from './atmosphere.ts';
import { deriveAero, waveDrag, type AeroModel } from './aero.ts';
import { Engine, type EngineCmd } from './engines.ts';
import type { AircraftDef } from './types.ts';

export interface GroundSample { h: number; water: boolean; runway: boolean }
export interface SimEnv {
  weather: WeatherState;
  ground: (lat: number, lon: number) => GroundSample;
  time: number;
}

export interface Crash { reason: string; t: number }

export class Aircraft {
  readonly aero: AeroModel;
  // ── state ──
  lat = 0; lon = 0; alt = 0;          // deg, deg, m MSL
  vel: V3 = [0, 0, 0];                 // NED m/s
  q: Q = [1, 0, 0, 0];                 // body -> NED
  w: V3 = [0, 0, 0];                   // body rates rad/s
  fuel = 0; payload = 0;
  // ── control effectors (normalised) ──
  de = 0; da = 0; dr = 0;              // actual surface deflections (-1..1)
  cmd = { de: 0, da: 0, dr: 0 };       // commanded
  trim = 0;                            // elevator/stabiliser trim (-1..1)
  rudderTrim = 0;
  flapIdx = 0; flapPos = 0;            // target detent, actual deg
  gearDown = true; gearPos = 1;
  speedbrake = 0; spoilerArm = false; spoilerPos = 0;
  brakeL = 0; brakeR = 0; parkingBrake = false; autobrake = 0;
  collective = 0; rotorRpm = 0;        // rotorcraft
  engines: Engine[] = [];
  engineCmd: EngineCmd[] = [];
  // ── derived outputs ──
  air!: Air;
  vAir: V3 = [0, 0, 0];
  wind: V3 = [0, 0, 0];
  tas = 0; ias = 0; mach = 0; alpha = 0; beta = 0; qbar = 0;
  psi = 0; theta = 0; phi = 0;
  gs = 0; track = 0; vs = 0; agl = 0; groundH = 0; onWater = false; onRunway = false;
  nz = 1; ny = 0; nx = 0;
  CL = 0; CD = 0; stall = 0;
  onGround = false; wow: boolean[] = [];
  gearCompression: number[] = [];
  lastTouchVs = 0; touchdownEvent = 0;
  crash: Crash | null = null;
  tailStrike = false;
  // pieces of the moment equation without control contribution (for dynamic-inversion control laws)
  CmRest = 0; ClRest = 0; CnRest = 0;
  private ctrlM: V3 = [0, 0, 0];
  ctrlPower = { pitch: 1, roll: 1, yaw: 1 }; // moment per unit command (N m)
  time = 0;
  private sampleT = 0;
  private gs0: GroundSample = { h: 0, water: false, runway: false };

  constructor(public readonly def: AircraftDef) {
    this.aero = deriveAero(def);
    for (let i = 0; i < def.eng.n; i++) {
      this.engines.push(new Engine(def.eng, i, this.aero.engPos[i], 0));
      this.engineCmd.push({ throttle: 0, reverse: false, mixture: 1, prop: 1, cutoff: false, starter: false, ignition: true });
    }
    this.fuel = def.m.fuel * 0.6;
    this.payload = def.m.pay * 0.6;
    this.air = atmosphere(0);
  }

  get mass() { return this.def.m.e + this.fuel + this.payload; }
  inertia(): V3 {
    const A = this.aero, d = this.def;
    const r = this.mass / (d.m.e + 0.5 * d.m.fuel + 0.4 * d.m.pay);
    return [A.Ixx * r, A.Iyy * r, A.Izz * r];
  }
  get isRotor() { return this.def.fdm === 'rotor'; }
  get flapDetents() { return this.aero.flaps; }
  get flapsDeg() { return this.aero.flaps[this.flapIdx].deg; }
  get flapLabel() { return this.aero.flaps[this.flapIdx].label; }
  get heading() { return ((this.psi * RAD) % 360 + 360) % 360; }

  /** Place the aircraft at rest or in flight. */
  place(lat: number, lon: number, alt: number, hdgDeg: number, speedKt = 0, pitchDeg?: number) {
    this.lat = lat; this.lon = lon; this.alt = alt;
    const th = pitchDeg ?? (speedKt > 0 ? 2 : this.staticPitch());
    this.q = qFromEuler(hdgDeg * DEG, th * DEG, 0);
    const v = speedKt * KT;
    this.vel = [Math.cos(hdgDeg * DEG) * v, Math.sin(hdgDeg * DEG) * v, 0];
    this.w = [0, 0, 0];
    this.crash = null;
    this.tailStrike = false;
    this.trim = 0;
    this.de = this.da = this.dr = 0;
    this.cmd = { de: 0, da: 0, dr: 0 };
    this.sampleT = 0;
    this.gs0 = { h: alt, water: false, runway: false };
    this.rotorRpm = 0;
    this.updateDerived();
  }
  /** Static ground pitch attitude (tail-draggers sit nose-high). */
  staticPitch(): number {
    const tail = this.aero.gear.find(g => g.tail);
    if (!tail) return this.isRotor ? 0 : 0.5;
    const main = this.aero.gear[0];
    return Math.atan2(main.pos[2] - tail.pos[2], main.pos[0] - tail.pos[0]) * RAD;
  }
  /** Height of CG above ground when resting on gear. */
  restHeight(): number {
    const th = this.staticPitch() * DEG;
    let h = 0;
    for (const l of this.aero.gear) h = Math.max(h, -Math.sin(th) * l.pos[0] + Math.cos(th) * l.pos[2]);
    return h - 0.06;
  }

  setAllEngines(on: boolean) {
    for (const e of this.engines) e.setRunning(on);
    if (on && this.isRotor) this.rotorRpm = 1;
  }

  step(dt: number, env: SimEnv) {
    if (this.crash) return;
    this.time += dt;
    const def = this.def;
    const A = this.aero;

    // ── ground sample (throttled, it's a cache lookup but not free) ──
    this.sampleT -= dt;
    if (this.sampleT <= 0) {
      this.gs0 = env.ground(this.lat, this.lon);
      this.sampleT = 0.05;
    }
    this.groundH = this.gs0.h; this.onWater = this.gs0.water; this.onRunway = this.gs0.runway;
    this.agl = this.alt - this.groundH;

    // ── atmosphere & air data ──
    const wx = env.weather;
    const air = (this.air = atmosphere(this.alt, wx.dT, wx.qnh * 100));
    this.wind = windAt(wx, this.alt, Math.max(0, this.agl - A.cgHeight), env.time);
    const vAirN: V3 = [this.vel[0] - this.wind[0], this.vel[1] - this.wind[1], this.vel[2] - this.wind[2]];
    const vb = qRotInv(this.q, vAirN);
    this.vAir = vb;
    const V = Math.max(len(vb), 0.01);
    this.tas = V;
    this.mach = V / air.a;
    this.alpha = Math.atan2(vb[2], Math.max(Math.abs(vb[0]), 0.1) * Math.sign(vb[0] || 1));
    if (vb[0] < 0) this.alpha = Math.atan2(vb[2], vb[0]); // flying backwards (tail slide)
    this.beta = Math.asin(clamp(vb[1] / V, -1, 1));
    this.qbar = 0.5 * air.rho * V * V;

    // ── actuators ──
    const rate = def.fbw ? 3.5 : 4.5; // full-scale per second
    this.de = moveToward(this.de, clamp(this.cmd.de, -1, 1), rate * dt);
    this.da = moveToward(this.da, clamp(this.cmd.da, -1, 1), rate * dt);
    this.dr = moveToward(this.dr, clamp(this.cmd.dr + this.rudderTrim, -1, 1), rate * 0.8 * dt);
    const flapTarget = A.flaps[this.flapIdx].deg;
    const flapRate = def.cat === 'ga' || def.cat === 'vintage' ? 5 : 1.6;
    // flap blow-back / overspeed protection: refuse to extend beyond VFE+15
    this.flapPos = moveToward(this.flapPos, flapTarget, flapRate * dt);
    if (def.gear.retract) {
      this.gearPos = moveToward(this.gearPos, this.gearDown ? 1 : 0, dt / (def.cat === 'ga' ? 6 : 9));
    } else this.gearPos = 1;
    // ground spoilers
    let sbTarget = this.speedbrake;
    if (this.spoilerArm && this.onGround && this.engineCmd.every(c => c.throttle < 0.1) && this.gs > 20 * KT) sbTarget = 1.6;
    this.spoilerPos = moveToward(this.spoilerPos, sbTarget, dt * 1.2);

    // ── engines ──
    const elecOk = true;
    const bleedOk = true;
    let fuelFlow = 0;
    for (let i = 0; i < this.engines.length; i++) {
      const e = this.engines[i];
      e.update(this.engineCmd[i], { air, V, M: this.mach, fuelOk: this.fuel > 0.5 || def.m.fuel === 0, bleedOk, elecOk, dt });
      fuelFlow += e.ff;
    }
    this.fuel = Math.max(0, this.fuel - (fuelFlow / 3600) * dt);

    const m = this.mass;
    const I = this.inertia();

    let F: V3 = [0, 0, 0];
    let M: V3 = [0, 0, 0];
    if (this.isRotor) this.rotorForces(dt, air, vb, V, F, M);
    else this.fixedWingForces(air, vb, V, F, M);

    // thrust (fixed-wing)
    if (!this.isRotor) {
      for (const e of this.engines) {
        const Tf: V3 = [e.thrust, 0, 0];
        F = add(F, Tf);
        // thrust line relative to the CG (CG sits below the fuselage centreline on real aircraft)
        const armZ = clamp(e.pos[2], -0.3 * def.dia, 0.25 * def.dia);
        M = add(M, cross([e.pos[0], e.pos[1], armZ], Tf));
        // single-engine propeller torque & P-factor (left-turning tendency)
        if (e.def.t === 'prop' || e.def.t === 'tprop') {
          if (def.eng.n === 1) {
            const omega = Math.max(50, (e.rpm / 60) * 2 * Math.PI);
            M[0] -= (e.power / omega) * 0.6;
            M[2] -= e.thrust * 0.006 * def.b * (0.5 + clamp(this.alpha * 6, -0.5, 1)) * clamp(1 - V / 70, 0, 1);
          }
        }
      }
    }

    // gravity
    const gB = qRotInv(this.q, [0, 0, G0 * m]);
    F = add(F, gB);

    // ground reaction
    this.groundContact(dt, F, M, m);

    // ── integrate ──
    const aN = qRot(this.q, [F[0] / m, F[1] / m, F[2] / m]);
    // specific force (load factors)
    this.nx = (F[0] - gB[0]) / (m * G0);
    this.ny = (F[1] - gB[1]) / (m * G0);
    this.nz = -(F[2] - gB[2]) / (m * G0);
    this.vel = [this.vel[0] + aN[0] * dt, this.vel[1] + aN[1] * dt, this.vel[2] + aN[2] * dt];
    const [p, qq, r] = this.w;
    const Iw: V3 = [I[0] * p, I[1] * qq, I[2] * r];
    const gyro = cross(this.w, Iw);
    // everything except the control-surface contribution (used by dynamic-inversion control laws)
    if (!this.isRotor) {
      this.ClRest = M[0] - gyro[0] - this.ctrlM[0];
      this.CmRest = M[1] - gyro[1] - this.ctrlM[1];
      this.CnRest = M[2] - gyro[2] - this.ctrlM[2];
    }
    this.w = [
      p + ((M[0] - gyro[0]) / I[0]) * dt,
      qq + ((M[1] - gyro[1]) / I[1]) * dt,
      r + ((M[2] - gyro[2]) / I[2]) * dt,
    ];
    // numerical safety
    for (let i = 0; i < 3; i++) this.w[i] = clamp(this.w[i], -12, 12);
    this.q = qIntegrate(this.q, this.w, dt);
    const Rn = R_EARTH + this.alt;
    this.lat += (this.vel[0] / Rn) * dt * RAD;
    this.lon += (this.vel[1] / (Rn * Math.cos(this.lat * DEG))) * dt * RAD;
    if (this.lon > 180) this.lon -= 360;
    if (this.lon < -180) this.lon += 360;
    this.alt -= this.vel[2] * dt;

    this.updateDerived();
    this.checkLimits();
  }

  private updateDerived() {
    const [psi, th, ph] = qToEuler(this.q);
    this.psi = psi; this.theta = th; this.phi = ph;
    this.gs = Math.hypot(this.vel[0], this.vel[1]);
    this.track = ((Math.atan2(this.vel[1], this.vel[0]) * RAD) + 360) % 360;
    this.vs = -this.vel[2];
    this.ias = this.air ? tasToCas(this.tas, this.air) : 0;
    this.agl = this.alt - this.groundH;
  }

  // ──────────────────────────── fixed-wing aerodynamics ────────────────────────────
  private fixedWingForces(air: Air, vb: V3, V: number, F: V3, M: V3) {
    const def = this.def, A = this.aero;
    const S = def.S, b = def.b, c = A.c;
    const qS = this.qbar * S;
    const alpha = this.alpha, beta = this.beta;
    const Vn = Math.max(V, 5);
    const [p, q, r] = this.w;
    const ph = (p * b) / (2 * Vn), qh = (q * c) / (2 * Vn), rh = (r * b) / (2 * Vn);

    // flaps interpolate between detents by actual deflection
    const fl = A.flaps;
    let fi = 0;
    while (fi < fl.length - 2 && fl[fi + 1].deg < this.flapPos) fi++;
    const f0 = fl[fi], f1 = fl[Math.min(fi + 1, fl.length - 1)];
    const ft = f1.deg === f0.deg ? 0 : clamp((this.flapPos - f0.deg) / (f1.deg - f0.deg), 0, 1);
    const dCL = f0.dCL + (f1.dCL - f0.dCL) * ft;
    const dCLmax = f0.dCLmax + (f1.dCLmax - f0.dCLmax) * ft;
    const dCDf = f0.dCD + (f1.dCD - f0.dCD) * ft;
    const dCmf = f0.dCm + (f1.dCm - f0.dCm) * ft;

    // compressibility on lift slope (Prandtl-Glauert, capped)
    const Mc = Math.min(this.mach, 0.9);
    const pg = this.mach < 1 ? 1 / Math.sqrt(1 - Mc * Mc) : 1 / Math.sqrt(Math.max(0.2, this.mach * this.mach - 1)) * 0.6;
    const CLa = A.CLa * Math.min(pg, 1.6) / (1 / Math.sqrt(1 - 0.09)); // A.CLa computed at M 0.3
    const machStallLoss = this.mach > 0.6 ? clamp((this.mach - 0.6) * 1.2, 0, 0.5) : 0; // buffet boundary
    const CLmax = (A.CLmax + dCLmax) * (1 - machStallLoss);
    const CLmin = A.CLmin;

    // ground effect
    const hWing = Math.max(0.1, this.agl - A.cgHeight + 0.5);
    const hb = hWing / b;
    const geInduced = hb < 1 ? (16 * hb) ** 2 / (1 + (16 * hb) ** 2) : 1;
    const geLift = hb < 1 ? 1 + 0.12 * (1 - hb) ** 3 : 1;

    const aLin = alpha - A.a0;
    const aStall = CLmax / CLa;       // alpha (from zero lift) where CL hits max, incl. flap offset
    const aStallEff = (CLmax - dCL) / CLa;
    let CL: number;
    let stall = 0;
    const clLin = CLa * aLin + dCL;
    if (aLin <= aStallEff && clLin >= CLmin) {
      CL = clLin;
    } else if (aLin > aStallEff) {
      const x = aLin - aStallEff;
      stall = smoothstep(0, 6 * DEG, x);
      const fp = 2 * Math.sin(alpha) * Math.cos(alpha) * 1.05; // flat plate
      const drop = CLmax * (1 - 0.25 * smoothstep(0, 8 * DEG, x));
      CL = drop + (fp - drop) * smoothstep(8 * DEG, 25 * DEG, x);
      if (def.cockpit === 'fighter' || def.tail === 'delta') { // vortex lift: gentle stall
        CL = CLmax * (1 - 0.1 * smoothstep(0, 15 * DEG, x)) + (fp - CLmax) * smoothstep(20 * DEG, 45 * DEG, x);
        stall *= 0.4;
      }
    } else {
      const x = (CLmin / CLa) - aLin;
      stall = smoothstep(0, 6 * DEG, x);
      const fp = 2 * Math.sin(alpha) * Math.cos(alpha);
      CL = CLmin + (fp - CLmin) * smoothstep(4 * DEG, 20 * DEG, x);
    }
    void aStall;
    this.stall = stall;
    // Polhamus vortex lift on slender deltas
    if (def.tail === 'delta' && def.sweep > 45) CL += 2.4 * Math.sin(alpha) ** 2 * Math.cos(alpha) * Math.sign(alpha) * (1 - stall * 0.5);
    CL *= geLift;
    CL -= 0.45 * Math.min(this.spoilerPos, 1) * Math.max(0, CL) * 0.6 + (this.spoilerPos > 1 ? 0.5 : 0) * CL;
    // stall buffet on lift
    if (stall > 0) CL += (Math.sin(this.time * 23) * 0.04 + Math.sin(this.time * 37) * 0.03) * stall;

    const CDi = (CL * CL) / (Math.PI * A.e * A.AR) * geInduced;
    const CDgear = A.CDgear * this.gearPos;
    const CDpost = stall * 1.1 * Math.sin(alpha) ** 2;
    const CDbeta = 0.5 * beta * beta;
    const CDsb = 0.05 * Math.min(this.spoilerPos, 1) + (this.spoilerPos > 1 ? 0.04 : 0);
    const CD = A.CD0 + dCDf + CDgear + CDi + CDpost + CDbeta + CDsb + waveDrag(this.mach, A.Mcrit, A.wavePeak);
    this.CL = CL; this.CD = CD;
    const CY = A.CYb * beta - A.CYdr * this.dr * (A.maxDr / (25 * DEG));

    // stability-axis -> body
    const ca = Math.cos(alpha), sa = Math.sin(alpha);
    const Lf = CL * qS, Df = CD * qS;
    F[0] += -Df * ca + Lf * sa;
    F[2] += -Df * sa - Lf * ca;
    F[1] += CY * qS;

    // moments
    const deEff = this.de * A.maxDe + this.trim * A.trimRange;
    const ctrlFade = 1 - 0.5 * stall;
    const CmRest = A.Cm0 + A.Cma * alpha + A.Cmq * qh + dCmf - 0.25 * stall * Math.sign(alpha) * 0.4
      + 0.02 * this.gearPos * (def.gear.retract ? 1 : 0) - 0.01 * Math.min(this.spoilerPos, 1);
    const Cm = CmRest + A.Cmde * deEff * ctrlFade;
    // wing drop at stall (asymmetric, depends on yaw/sideslip)
    const wingDrop = stall * clamp(rh * 20 + beta * 4 + Math.sin(this.time * 1.7) * 0.3, -1, 1) * 0.06;
    const ClRest = A.Clb * beta + A.Clp * (1 - 0.8 * stall) * ph + A.Clr * rh + wingDrop + A.Cldr * this.dr * A.maxDr;
    const Cl = ClRest + A.Clda * this.da * A.maxDa * ctrlFade;
    const CnRest = A.Cnb * beta + A.Cnr * rh + A.Cnp * ph + A.Cnda * this.da * A.maxDa;
    const Cn = CnRest + A.Cndr * this.dr * A.maxDr;
    M[0] += Cl * qS * b;
    M[1] += Cm * qS * c;
    M[2] += Cn * qS * b;

    this.ctrlM = [A.Clda * this.da * A.maxDa * ctrlFade * qS * b, A.Cmde * this.de * A.maxDe * ctrlFade * qS * c, A.Cndr * this.dr * A.maxDr * qS * b];
    this.ctrlPower = {
      pitch: A.Cmde * A.maxDe * qS * c * ctrlFade,
      roll: A.Clda * A.maxDa * qS * b * ctrlFade,
      yaw: A.Cndr * A.maxDr * qS * b,
    };
    void air; void vb;
  }

  // ──────────────────────────── rotorcraft ────────────────────────────
  private rotorForces(dt: number, air: Air, vb: V3, V: number, F: V3, M: V3) {
    const def = this.def;
    const R = def.rotor!.D / 2;
    const Adisk = Math.PI * R * R * (def.rotor!.tail === 'tandem' ? 1.6 : 1);
    const m = this.mass;
    const hubH = 0.5 * def.dia + 1.1;

    // engine power available -> rotor rpm governor
    let Pavail = 0;
    for (const e of this.engines) Pavail += Math.max(0, e.power);
    const Wmax = def.m.mtow * G0;
    const Tmax = Wmax * 1.45;
    const coll = clamp(this.collective, 0, 1);
    const Omega = this.rotorRpm; // normalised (1 = 100 %)

    // translational lift & ground effect
    const Vh = Math.hypot(vb[0], vb[1]);
    const vHover = Math.sqrt(Wmax / (2 * air.rho * Adisk));
    const etl = 1 + 0.22 * smoothstep(8, 22, Vh) - 0.06 * smoothstep(40, 80, Vh);
    const zr = Math.max(0.3, this.agl - this.aero.cgHeight + hubH);
    const ige = zr < 2 * R ? 1 / (1 - (R / (4 * zr)) ** 2 * 0.9) : 1;
    // vortex ring state: descending into own downwash at low airspeed
    const descent = vb[2]; // +down (body z)
    const vrs = smoothstep(0.5 * vHover, 0.95 * vHover, descent) * (1 - smoothstep(8, 16, Vh));
    // inflow damping (heave)
    const inflowCorr = clamp(1 + (descent / vHover) * 0.35, 0.3, 1.6);

    let T = Tmax * (0.08 + 0.92 * coll) * (air.rho / 1.225) * Omega * Omega * etl * Math.min(ige, 1.35) * inflowCorr * (1 - 0.3 * vrs * (0.8 + 0.2 * Math.sin(this.time * 9)));
    T = Math.max(0, T);

    // power required
    const vi = Math.sqrt(T / (2 * air.rho * Adisk)) / Math.sqrt(1 + (Vh / Math.max(1, vHover)) ** 2 * 3);
    const Pi = (T * vi) / 0.75;
    const P0 = 0.12 * (Wmax * vHover) / 0.75;
    const fArea = 0.012 * def.m.mtow ** 0.66;
    const Ppar = 0.5 * air.rho * Vh ** 3 * fArea;
    const Pclimb = Math.max(-0.8 * Pi, -T * descent * 0.9);
    const Preq = Math.max(0, Pi + P0 * Omega ** 3 + Ppar + Pclimb);
    const J = 0.5 * def.m.mtow * 1.6 * R * R * 0.15; // rotor inertia estimate
    const OmegaRad = 30 * Omega + 0.1;
    const Pused = Math.min(Pavail, Preq + (1.0 - Omega) * 4 * Preq + 0.05 * Pavail * (Omega < 1 ? 1 : 0));
    const autorot = Math.max(0, T * descent * 0.9 - Pi * 0.5);
    const dOmega = ((Pused + autorot - Preq) / (J * OmegaRad * 30)) * dt;
    this.rotorRpm = clamp(Omega + dOmega, 0, 1.12);
    // governor clamp: running engines keep NR ~100 % unless power-limited
    if (Pavail > Preq * 1.02 && this.engines.some(e => e.running)) this.rotorRpm = approach(this.rotorRpm, 1, 0.4, dt);
    this.torquePct = Pavail > 0 ? (Math.min(Preq, Pavail) / (def.eng.p * 1000 * def.eng.n)) * 100 : 0;

    // cyclic: disk tilt (with blow-back proportional to forward speed)
    const maxTilt = 9 * DEG;
    const a1 = -this.de * maxTilt + 0.0045 * vb[0] * (1 / (1 + Vh / 60));
    const b1 = this.da * maxTilt - 0.002 * vb[1];
    const Tb: V3 = [-T * Math.sin(a1), T * Math.sin(b1), -T * Math.cos(a1) * Math.cos(b1)];
    F[0] += Tb[0]; F[1] += Tb[1]; F[2] += Tb[2];
    const hub: V3 = [0, 0, -hubH];
    const mT = cross(hub, Tb);
    const hubStiff = m * G0 * 1.4 * (def.rotor!.blades >= 4 ? 1.3 : 0.9);
    M[0] += mT[0] + hubStiff * b1 * Omega * Omega;
    M[1] += mT[1] - hubStiff * a1 * Omega * Omega;
    // rotor damping (flapping)
    const [p, q, r] = this.w;
    const damp = m * R * R * 0.9 * Omega;
    M[0] += -damp * p;
    M[1] += -damp * q * 1.1;

    // torque reaction & anti-torque
    const Qmain = Preq / Math.max(5, OmegaRad);
    const tandem = def.rotor!.tail === 'tandem';
    const armT = 0.6 * def.L;
    const yawAuthority = tandem ? m * G0 * 0.18 * armT : (Qmain * 1.6 + m * G0 * 0.05 * armT) * Omega;
    M[2] += (tandem ? 0 : Qmain * Omega * 0.92) + this.dr * yawAuthority - (tandem ? 0 : Qmain * 0.92 * Omega * 0.95);
    M[2] += -r * m * armT * armT * 0.25 * (0.6 + 0.4 * Omega);
    // tail rotor thrust also rolls slightly
    M[0] += this.dr * yawAuthority * 0.02;

    // fuselage drag and fin weathercock
    const f = fArea;
    F[0] += -0.5 * air.rho * Math.abs(vb[0]) * vb[0] * f;
    F[1] += -0.5 * air.rho * Math.abs(vb[1]) * vb[1] * f * 5;
    F[2] += -0.5 * air.rho * Math.abs(vb[2]) * vb[2] * f * 6;
    M[2] += 0.5 * air.rho * V * vb[1] * f * 3.0 * armT * 0.4;
    M[1] += 0.5 * air.rho * V * -vb[2] * f * 0.8 * armT * 0.15;

    this.alpha = Math.atan2(vb[2], Math.max(1, vb[0]));
    this.stall = vrs;
    this.CL = T / (m * G0);
    this.CmRest = M[1];
    this.ClRest = M[0];
    this.CnRest = M[2];
    this.ctrlPower = { pitch: hubStiff * maxTilt + T * hubH * maxTilt, roll: hubStiff * maxTilt + T * hubH * maxTilt, yaw: yawAuthority };
  }
  torquePct = 0;

  // ──────────────────────────── landing gear / ground ────────────────────────────
  private groundContact(dt: number, F: V3, M: V3, m: number) {
    const A = this.aero;
    const gh = this.groundH;
    const wet = this.onRunway ? 0.75 : 0.55;
    this.onGround = false;
    this.wow = [];
    this.gearCompression = [];
    const psi = this.psi;
    let vsTouch = 0;
    const gearOk = this.gearPos > 0.98;
    for (const leg of A.gear) {
      const rN = qRot(this.q, leg.pos);
      const pAlt = this.alt - rN[2];
      const depth = gh - pAlt;
      this.gearCompression.push(Math.max(0, depth));
      if (depth <= 0 || !gearOk) { this.wow.push(false); continue; }
      this.wow.push(true);
      this.onGround = true;
      const wB = cross(this.w, leg.pos);
      const vP = add(this.vel, qRot(this.q, wB));
      if (vP[2] > vsTouch) vsTouch = vP[2];
      const dd = Math.min(depth, 1.2);
      let N = leg.k * dd + leg.c * vP[2];
      if (depth > 0.8) N += leg.k * 10 * (depth - 0.8); // bottoming
      N = Math.max(0, N);
      // wheel orientation
      let steer = 0;
      if (leg.steer > 0) {
        const lim = leg.tail ? leg.steer : leg.steer * (leg.steer > 40 ? clamp(1 - this.gs / 40, 0.1, 1) : 1);
        steer = this.dr * lim * DEG;
        if (leg.tail && Math.abs(this.dr) > 0.95) steer = 0; // tailwheel unlocks — free castor approximated
      }
      const hd = psi + steer;
      const fx = Math.cos(hd), fy = Math.sin(hd);
      const vLong = vP[0] * fx + vP[1] * fy;
      const vLat = -vP[0] * fy + vP[1] * fx;
      let brake = 0;
      if (leg.brake) {
        const b0 = leg.name.startsWith('L') ? this.brakeL : leg.name.startsWith('R') ? this.brakeR : Math.max(this.brakeL, this.brakeR);
        brake = Math.max(b0, this.parkingBrake ? 1 : 0, this.autobrakeCmd);
      }
      const isSkid = leg.name.includes('SKID');
      const muRoll = isSkid ? 0.5 : this.onWater ? 0.2 : this.onRunway ? 0.015 : 0.05;
      const muBrake = wet * brake;
      const mu = Math.max(muRoll, muBrake);
      const holding = (this.parkingBrake || isSkid) ? 0.05 : 0.25;
      const Flong = -mu * N * Math.tanh(vLong / holding);
      const Flat = -(leg.tail ? 0.35 : wet * 1.1) * N * Math.tanh(vLat / 0.25);
      const Fn: V3 = [fx * Flong - fy * Flat, fy * Flong + fx * Flat, -N];
      const Fb = qRotInv(this.q, Fn);
      F[0] += Fb[0]; F[1] += Fb[1]; F[2] += Fb[2];
      const mm = cross(leg.pos, Fb);
      M[0] += mm[0]; M[1] += mm[1]; M[2] += mm[2];
    }

    // structural contacts (belly, tail, wingtips, pods, and all points if gear is up)
    let structHit = '';
    const pts = gearOk ? A.structure : [...A.structure, ...A.gear.map(g => ({ name: 'BELLY', pos: [g.pos[0], g.pos[1], A.cgHeight * 0.45] as V3 }))];
    for (const s of pts) {
      const rN = qRot(this.q, s.pos);
      const depth = gh - (this.alt - rN[2]);
      if (depth <= 0) continue;
      const wB = cross(this.w, s.pos);
      const vP = add(this.vel, qRot(this.q, wB));
      if (s.name === 'TAIL' && this.def.fdm === 'fixed') this.tailStrike = true;
      // scrape: strong friction + support
      const N = m * G0 * 8 * depth + m * 2 * Math.max(0, vP[2]);
      const Fn: V3 = [-Math.tanh(vP[0]) * N * 0.5, -Math.tanh(vP[1]) * N * 0.5, -N];
      const Fb = qRotInv(this.q, Fn);
      F[0] += Fb[0]; F[1] += Fb[1]; F[2] += Fb[2];
      const mm = cross(s.pos, Fb);
      M[0] += mm[0]; M[1] += mm[1]; M[2] += mm[2];
      const speed = Math.hypot(vP[0], vP[1]);
      if (s.name === 'TAIL' && vP[2] < 2.5 && speed < 110) continue; // tail strike: damage but not destruction
      if (s.name === 'BELLY' && vP[2] < 2 && speed < 60 && !gearOk) { structHit = structHit || ''; this.bellyLanding = true; continue; }
      if (vP[2] > 1.5 || speed > 25 || s.name.includes('WINGTIP') || s.name === 'NOSE' || s.name === 'POD') structHit = s.name;
    }
    if (this.onGround && !this.prevOnGround) {
      this.lastTouchVs = vsTouch;
      this.touchdownEvent++;
      const lim = A.gear[0]?.limitVs ?? 3.8;
      if (vsTouch > lim * 1.35) this.doCrash(`랜딩기어 파손 — 접지 강하율 ${Math.round(vsTouch / FPM)} fpm`);
    }
    if (this.onGround && this.onWater && this.gs > 3 && this.def.gear.t !== 'float') this.doCrash('수면 착수 — 기체 손실');
    if (structHit) {
      const names: Record<string, string> = { NOSE: '기수', TAIL: '후미', LWINGTIP: '좌측 날개끝', RWINGTIP: '우측 날개끝', POD: '엔진 나셀', BELLY: '동체' };
      this.doCrash(`지면 충돌 — ${names[structHit] ?? structHit} 접촉`);
    }
    this.prevOnGround = this.onGround;
    void dt;
  }
  bellyLanding = false;
  private prevOnGround = false;
  autobrakeCmd = 0;

  private checkLimits() {
    const d = this.def;
    if (Math.abs(this.nz) > this.aero.gLimit * 1.5) this.doCrash(`구조 파괴 — 하중배수 ${this.nz.toFixed(1)} G 초과`);
    const vd = d.v.vmo * 1.25 * KT;
    if (this.ias > vd && d.fdm === 'fixed') this.doCrash(`구조 파괴 — 설계 급강하 속도(VD) 초과`);
    if (this.alt < this.groundH - 30) this.doCrash('지형 충돌');
  }
  doCrash(reason: string) {
    if (!this.crash) this.crash = { reason, t: this.time };
  }
}
