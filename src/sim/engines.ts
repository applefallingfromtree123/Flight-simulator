// Engine models: turbofan / turbojet (with afterburner), piston + propeller, turboprop, turboshaft.
import { approach, clamp, moveToward, type V3 } from '../core/math.ts';
import type { Air } from './atmosphere.ts';
import type { AircraftDef, EngineDef } from './types.ts';

export interface EngineCmd { throttle: number; reverse: boolean; mixture: number; prop: number; cutoff: boolean; starter: boolean; ignition: boolean }
export interface EngineEnv { air: Air; V: number; M: number; fuelOk: boolean; bleedOk: boolean; elecOk: boolean; dt: number }

const LBH_PER_LBF = 0.10197 / 3600; // (lb/lbf/h) -> kg/(N s)
const BSFC_PISTON = 7.6e-8;         // kg/J
const BSFC_TURBINE = 9.4e-8;

/** Max available static-normalised thrust lapse for jets. */
export function thrustLapse(e: EngineDef, air: Air, M: number, ab = false): number {
  const bpr = e.bpr ?? 5;
  if (ab) return Math.pow(air.sigma, 0.8) * (1 + 0.7 * M);
  if (bpr < 2) return Math.pow(air.sigma, 0.75) * (1 + 0.25 * M);
  const k = clamp(0.25 + 0.02 * bpr, 0.3, 0.5);
  return Math.pow(air.sigma, 0.72) * Math.max(0.2, 1 - k * M + 0.12 * M * M);
}
/** Flat-rated shaft power lapse (turbine) or naturally-aspirated (piston). */
export function powerLapse(e: EngineDef, air: Air): number {
  if (e.t === 'prop') return clamp(1.132 * air.sigma - 0.132, 0, 1);
  return Math.min(1, 1.2 * Math.pow(air.sigma, 0.75) * Math.sqrt(288.15 / air.T));
}
/** Static thrust of a propeller (momentum theory with figure of merit). */
export function propStaticThrust(P: number, D: number, rho: number): number {
  const A = Math.PI * D * D / 4;
  return 0.62 * Math.cbrt(2 * rho * A * P * P);
}
/** Propeller thrust at airspeed V from shaft power P. */
export function propThrust(P: number, D: number, rho: number, V: number): number {
  if (P <= 0) return 0;
  const eta = 0.83;
  const Ts = propStaticThrust(P, D, rho);
  const V0 = (eta * P) / Math.max(1, Ts);
  return (eta * P) / Math.sqrt(V * V + V0 * V0);
}

/** Maximum available thrust per engine (N) — used for drag calibration and A/THR feed-forward. */
export function maxThrust(ac: AircraftDef, air: Air, V: number, M: number, ab = false): number {
  const e = ac.eng;
  switch (e.t) {
    case 'fan':
    case 'jet': {
      const T0 = (ab && e.ab ? e.ab : e.p) * 1000;
      return T0 * thrustLapse(e, air, M, ab);
    }
    case 'prop':
    case 'tprop':
      return propThrust(e.p * 1000 * powerLapse(e, air), e.propD ?? 2, air.rho, V);
    default:
      return 0;
  }
}

export class Engine {
  running = false;
  failed = false;
  fire = false;
  // generic
  spool = 0;        // 0..1 core speed state (fraction idle->max)
  thrust = 0;       // N (+ fwd)
  power = 0;        // W shaft (prop / turboshaft)
  ff = 0;           // kg/h
  rev = 0;          // reverser deployed 0..1
  ab = 0;           // afterburner 0..1
  // indications
  n1 = 0; n2 = 0; egt = 15; oilP = 0; oilT = 15;
  rpm = 0; mp = 29.92; torque = 0; ng = 0; np = 0; itt = 15; cht = 15;
  private startT = 0;

  constructor(public def: EngineDef, public idx: number, public pos: V3, public z: number) {}

  get kind() { return this.def.t; }

  setRunning(on: boolean) {
    this.running = on;
    this.spool = 0;
    this.startT = 0;
    if (on) {
      if (this.def.t === 'fan' || this.def.t === 'jet') { this.n2 = 60; this.n1 = 21; this.egt = 450; }
      if (this.def.t === 'tprop' || this.def.t === 'shaft') { this.ng = 62; this.np = 70; this.itt = 520; }
      if (this.def.t === 'prop') { this.rpm = 800; }
      this.oilP = 1; this.oilT = 70;
    } else {
      this.n1 = this.n2 = this.ng = this.np = this.rpm = 0;
    }
  }

  update(c: EngineCmd, env: EngineEnv) {
    const { dt, air, V, M } = env;
    const e = this.def;
    const ambC = air.T - 273.15;
    const canRun = !this.failed && env.fuelOk && !c.cutoff;
    if (this.running && !canRun) this.running = false;

    const reverseCmd = c.reverse && c.throttle < 0.05;
    this.rev = moveToward(this.rev, reverseCmd ? 1 : 0, dt / 2.0);
    const lever = this.rev > 0.9 ? (c.reverse ? 0.75 : 0) : this.rev > 0 ? 0 : c.throttle;

    switch (e.t) {
      case 'fan':
      case 'jet': {
        const isJet = e.t === 'jet';
        const idleN2 = isJet ? 68 : 60;
        if (this.running) {
          const tgt = clamp(isJet && e.ab ? Math.min(lever, 0.95) / 0.95 : lever, 0, 1);
          const size = Math.pow(e.p / 120, 0.25);
          const tau = tgt > this.spool ? (1.0 + 3.2 * (1 - this.spool) ** 2) * size : 1.6 * size;
          this.spool = approach(this.spool, tgt, tau, dt);
          const abCmd = isJet && e.ab && lever > 0.955 ? (lever - 0.955) / 0.045 : 0;
          this.ab = approach(this.ab, this.spool > 0.95 ? abCmd : 0, 0.7, dt);
          this.n2 = approach(this.n2, idleN2 + (100 - idleN2) * Math.pow(this.spool, 0.6), 0.3, dt);
          this.n1 = isJet ? this.n2 : approach(this.n1, 20 + 77 * Math.pow(this.spool, 0.45) * (0.93 + 0.07 * air.theta), 0.3, dt);
          this.egt = approach(this.egt, 420 + 430 * this.spool + 20 * M + ambC * 1.5 + 350 * this.ab, 1.2, dt);
          this.oilP = approach(this.oilP, 30 + 30 * this.spool, 1, dt);
        } else {
          // start sequence: starter spins N2 to ~25% with bleed air, then light-off
          const cranking = c.starter && env.bleedOk && env.elecOk;
          const target = cranking ? 26 : 0;
          this.n2 = approach(this.n2, target, cranking ? 5 : 8, dt);
          this.n1 = approach(this.n1, this.n2 * 0.3, 2, dt);
          if (cranking && this.n2 > 20 && canRun && c.ignition) {
            this.startT += dt;
            this.egt = approach(this.egt, 600, 3, dt);
            this.n2 = approach(this.n2, idleN2 + 2, 7, dt);
            if (this.startT > 10) { this.running = true; this.spool = 0; }
          } else {
            this.startT = 0;
            this.egt = approach(this.egt, Math.max(ambC, this.n2 > 1 ? 80 : ambC), 20, dt);
          }
          this.oilP = approach(this.oilP, this.n2 * 0.6, 1, dt);
          this.spool = 0;
          this.ab = 0;
        }
        const T0 = e.p * 1000;
        let T = 0;
        if (this.running) {
          const idleT = 0.045 * T0 * Math.pow(air.sigma, 0.6);
          T = idleT + (T0 * thrustLapse(e, air, M) - idleT) * this.spool;
          if (e.ab && this.ab > 0) T += ((e.ab - e.p) * 1000) * thrustLapse(e, air, M, true) * this.ab;
          T -= 0.5 * air.rho * V * V * 0.002 * T0 / 1000 * (M < 1 ? 1 : 0); // ram drag residual
        } else {
          T = -0.5 * air.rho * V * V * 0.12 * (e.p / 120); // windmilling drag
        }
        if (this.rev > 0) T = T * (1 - this.rev) - Math.max(0, T) * 0.45 * this.rev;
        this.thrust = T;
        const bpr = e.bpr ?? 5;
        const tsfc = (isJet ? (this.ab > 0.05 ? 1.9 : 0.8 + 0.25 * M) : (0.34 + 0.3 * M) * (1 - 0.025 * (bpr - 5))) * LBH_PER_LBF * Math.sqrt(air.theta);
        this.ff = this.running ? tsfc * Math.max(Math.abs(T), 0.06 * T0 * air.sigma) * 3600 : 0;
        break;
      }
      case 'prop': {
        const Pmax = e.p * 1000;
        const cs = e.p > 150 || e.n > 1;           // constant-speed propeller?
        const maxRpm = e.p > 800 ? 3000 : 2700;
        if (this.running) {
          const ambInHg = air.p / 3386.39;
          const turbo = e.p > 200 && e.p < 800 ? 1 : 0; // turbo-normalised (SR22T etc)
          const mpMax = turbo ? 36 : e.p >= 800 ? 61 : ambInHg - 0.8;
          this.mp = approach(this.mp, ambInHg * 0.33 + (mpMax - ambInHg * 0.33) * Math.pow(clamp(c.throttle, 0, 1), 0.9), 0.3, dt);
          const mixOpt = clamp(air.sigma * 1.05, 0.3, 1);
          const mixF = clamp(1 - 3 * (c.mixture - mixOpt) ** 2 - (c.mixture < mixOpt - 0.25 ? 2 * (mixOpt - 0.25 - c.mixture) : 0), 0, 1);
          if (c.mixture < 0.08) this.running = false;
          const tgtRpm = cs ? 1800 + (maxRpm - 1800) * c.prop : 700 + (maxRpm - 700) * (0.78 * Math.sqrt(c.throttle) + 0.22 * clamp(V / 70, 0, 1.2));
          this.rpm = approach(this.rpm, clamp(tgtRpm, 650, maxRpm + 50), 0.6, dt);
          const mpRef = turbo ? 36 : e.p >= 800 ? 61 : 29.92;
          const pf = clamp((this.mp - 7) / (mpRef - 7), 0.03, 1.05);
          const rpmF = cs ? clamp(0.55 + 0.45 * this.rpm / maxRpm, 0.3, 1) : 1;
          this.power = Pmax * pf * mixF * rpmF;
          this.power = Math.max(this.power, 0);
          this.egt = approach(this.egt, 1150 + 350 * (1 - Math.abs(c.mixture - mixOpt) * 2) * pf, 3, dt);  // °F
          this.cht = approach(this.cht, 250 + 150 * pf, 30, dt);
          this.oilP = approach(this.oilP, 55 + 20 * (this.rpm / maxRpm), 2, dt);
          this.oilT = approach(this.oilT, 180, 60, dt);
        } else {
          const crank = c.starter && env.elecOk;
          this.rpm = approach(this.rpm, crank ? 250 : Math.min(V * 12, 900) * (V > 25 ? 1 : 0), crank ? 0.6 : 2, dt);
          this.mp = approach(this.mp, air.p / 3386.39, 1, dt);
          this.power = 0;
          if (crank && this.rpm > 150 && canRun && c.ignition && c.mixture > 0.2) {
            this.startT += dt;
            if (this.startT > 1.8) { this.running = true; this.rpm = 900; }
          } else this.startT = 0;
          this.egt = approach(this.egt, ambC * 1.8 + 32, 60, dt);
          this.oilP = approach(this.oilP, this.rpm / 20, 1, dt);
        }
        this.thrust = propThrust(this.power, e.propD ?? 2, air.rho, V) - (this.running ? 0 : 0.5 * air.rho * V * V * 0.04 * (e.propD ?? 2) ** 2);
        this.ff = this.running ? BSFC_PISTON * Math.max(this.power, 0.08 * Pmax) * (0.8 + 0.4 * c.mixture) * 3600 : 0;
        this.n1 = (this.rpm / maxRpm) * 100;
        break;
      }
      case 'tprop':
      case 'shaft': {
        const Pmax = e.p * 1000;
        if (this.running) {
          const idle = this.rev > 0 ? 0.08 : 0;
          const tgt = clamp(Math.max(lever, idle), 0, 1);
          const tau = tgt > this.spool ? 1.2 + 1.8 * (1 - this.spool) : 1.0;
          this.spool = approach(this.spool, tgt, tau, dt);
          this.ng = approach(this.ng, 62 + 39 * Math.pow(this.spool, 0.7), 0.4, dt);
          this.np = approach(this.np, e.t === 'shaft' ? 100 : 70 + 30 * clamp(c.prop, 0, 1), 1.0, dt);
          this.power = Pmax * powerLapse(e, air) * (0.05 + 0.95 * this.spool);
          this.torque = (this.power / Pmax) * 100 * (100 / Math.max(this.np, 50));
          this.itt = approach(this.itt, 500 + 300 * this.spool + ambC * 1.2 + 100 * (1 - air.sigma), 1.5, dt);
          this.oilP = approach(this.oilP, 90 + 20 * this.spool, 1, dt);
        } else {
          const crank = c.starter && env.elecOk;
          this.ng = approach(this.ng, crank ? 16 : 0, crank ? 3 : 6, dt);
          this.np = approach(this.np, crank ? 8 : Math.min(V, 40) * 0.5, 4, dt);
          this.power = 0; this.torque = 0; this.spool = 0;
          if (crank && this.ng > 12 && canRun && c.ignition) {
            this.startT += dt;
            this.itt = approach(this.itt, 650, 2, dt);
            this.ng = approach(this.ng, 62, 6, dt);
            if (this.startT > 12) this.running = true;
          } else {
            this.startT = 0;
            this.itt = approach(this.itt, ambC, 30, dt);
          }
          this.oilP = approach(this.oilP, this.ng, 1, dt);
        }
        if (e.t === 'tprop') {
          let T = propThrust(this.power, e.propD ?? 2.5, air.rho, V);
          if (this.rev > 0) T = T * (1 - this.rev) - propStaticThrust(Pmax * 0.35 * this.spool + Pmax * 0.05, e.propD ?? 2.5, air.rho) * 0.5 * this.rev;
          if (!this.running) T = -0.5 * air.rho * V * V * 0.01 * (e.propD ?? 2.5) ** 2; // feathered
          this.thrust = T;
        } else this.thrust = 0;
        this.ff = this.running ? BSFC_TURBINE * Math.max(this.power, 0.12 * Pmax) * 3600 : 0;
        this.n1 = this.ng; this.n2 = this.np; this.egt = this.itt;
        this.rpm = this.np * (e.t === 'tprop' ? 17 : 1);
        break;
      }
      case 'none':
        this.thrust = 0; this.ff = 0;
        break;
    }
  }
}
