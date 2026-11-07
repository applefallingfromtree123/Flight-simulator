// Flight control system: control laws (conventional, Airbus normal law, Boeing C*U, fighter g-command),
// yaw damper, helicopter SAS, autopilot (lateral / vertical modes), flight director and autothrottle.
import { DEG, FPM, FT, G0, KT, NM, PID, RAD, approach, clamp, moveToward, wrap180 } from '../core/math.ts';
import { alongTrack, bearing, crossTrack, distance, magVar, type LatLon } from '../core/geo.ts';
import type { Aircraft } from './fdm.ts';
import { maxThrust } from './engines.ts';

export interface PilotInput { pitch: number; roll: number; yaw: number; trim: number; collective: number }

export type LatMode = 'OFF' | 'ROL' | 'HDG' | 'NAV' | 'LOC' | 'RWY' | 'ROLLOUT' | 'GA';
export type VertMode = 'OFF' | 'PIT' | 'VS' | 'ALT' | 'ALT*' | 'FLC' | 'GS' | 'FLARE' | 'TOGA' | 'VNAV';
export type AthrMode = 'OFF' | 'SPEED' | 'THR CLB' | 'IDLE' | 'RETARD' | 'TOGA' | 'A.FLOOR';

export interface Approach {
  airport: string; runway: string;
  thr: LatLon; elev: number;       // threshold, m MSL
  crs: number;                     // true course (deg)
  gs: number;                      // glide slope angle (deg)
  locAnt: LatLon; gsAnt: LatLon;
  lengthM: number;
}

export interface Waypoint { ident: string; lat: number; lon: number; alt?: number; kind: 'apt' | 'vor' | 'ndb' | 'fix' | 'rwy' | 'user' }

export class FlightPlan {
  wps: Waypoint[] = [];
  active = 1;
  approach: Approach | null = null;
  cruiseFt = 35000;
  get from(): Waypoint | undefined { return this.wps[this.active - 1]; }
  get to(): Waypoint | undefined { return this.wps[this.active]; }
  directTo(wp: Waypoint, pos: LatLon) {
    const idx = this.wps.indexOf(wp);
    const here: Waypoint = { ident: 'P.POS', lat: pos.lat, lon: pos.lon, kind: 'user' };
    if (idx >= 0) { this.wps.splice(idx, 0, here); this.active = idx + 1; this.wps.splice(0, idx); this.active = 1; }
    else { this.wps = [here, wp, ...this.wps.slice(this.active)]; this.active = 1; }
  }
  remainingNm(pos: LatLon): number {
    const to = this.to;
    if (!to) return 0;
    let d = distance(pos, to);
    for (let i = this.active; i < this.wps.length - 1; i++) d += distance(this.wps[i], this.wps[i + 1]);
    return d / NM;
  }
}

/** ILS deviations in dots (loc: 1 dot = 1.25°(approx), gs: 1 dot = 0.35°). */
export function ilsDeviation(ap: Approach, pos: LatLon, altM: number) {
  const dLoc = distance(pos, ap.locAnt);
  const xtk = crossTrack(ap.thr, ap.locAnt, pos);
  const locDeg = Math.atan2(xtk, dLoc) * RAD;
  const dGs = Math.max(1, alongTrack(pos, ap.gsAnt, pos) === 0 ? distance(pos, ap.gsAnt) : distance(pos, ap.gsAnt));
  const hRel = altM - ap.elev;
  const gsDeg = Math.atan2(hRel, dGs) * RAD - ap.gs;
  const brgToThr = bearing(pos, ap.thr);
  const inFront = Math.abs(wrap180(brgToThr - ap.crs)) < 90 || distance(pos, ap.thr) < 3000;
  const valid = dLoc < 25 * NM && Math.abs(locDeg) < 35 && inFront;
  return {
    loc: clamp(-locDeg / 1.25, -2.5, 2.5),        // + = course is to the right (fly right)
    gs: clamp(-gsDeg / 0.35, -2.5, 2.5),          // + = glideslope is above (fly up)
    locDeg, gsDeg, valid, gsValid: valid && Math.abs(locDeg) < 10 && dGs < 20 * NM,
    distNm: distance(pos, ap.thr) / NM,
    hat: hRel,
  };
}

export class FCS {
  // selected targets (MCP / FCU)
  selSpd = 250; selMach = 0.78; spdIsMach = false;
  selHdg = 0; selAlt = 10000; selVs = 0; selFpa = 0;
  // engagement
  ap = false; fd = true; athrArmed = false; athr: AthrMode = 'OFF';
  yd = true; sas = true;
  lat: LatMode = 'OFF'; vert: VertMode = 'OFF';
  latArmed: LatMode | null = null; vertArmed: VertMode | null = null;
  // flight director outputs (deg)
  fdPitch = 0; fdRoll = 0;
  thrCmd = 0;
  law: 'NORMAL' | 'ALTN' | 'DIRECT' = 'NORMAL';
  flare = false; flareMemo = 0;
  alphaProt = false; alphaFloor = false;
  apDisconnectWarn = 0;
  plan = new FlightPlan();
  msg = '';
  // internal
  private pitchHold = 0; private bankHold = 0; private rollHoldActive = false;
  private fbwVtrim = 0;
  private vsPid = new PID(0.004, 0.0012, 0, 3, 8);
  private flcGamma = 0;
  private athrPid = new PID(0.045, 0.012, 0, 0.4, 1);
  private yawInt = 0;
  private heliAltPid = new PID(0.0025, 0.0006, 0, 0.25, 0.4);
  private lastIas = 0; private accel = 0;
  ilsTuned = false;
  /** Managed (FMS) speed: 250 kt below 10 000 ft, climb/cruise/descent speeds, Mach above the crossover, flap speeds. */
  spdManaged = false;
  /** VNAV state: climb at managed speed, cruise, path descent from the top of descent. */
  vnavSub: 'SPD' | 'PTH' | 'ALT' = 'SPD';
  vnavPhase: 'CLB' | 'CRZ' | 'DES' = 'CLB';
  /** Distance to the top of descent (NM, negative once past it), for the ND / FMS. */
  todNm: number | null = null;
  private vnavVs = 0;
  private thrI = 0;
  private lastSinG = 0;
  private srsSpd = 0;
  private msgT = 0;
  /** magnetic variation at the aircraft (deg, east +). Selected headings are magnetic. */
  magv = 0;
  get hdgM() { return ((this.ac.heading - this.magv) % 360 + 360) % 360; }
  ils: ReturnType<typeof ilsDeviation> | null = null;
  gsCaptured = false;

  constructor(private ac: Aircraft) {
    this.selHdg = Math.round(ac.heading);
    this.selSpd = Math.round(ac.def.v.vref * 1.3);
  }

  get isJet() { return this.ac.def.eng.t === 'fan' || this.ac.def.eng.t === 'jet'; }
  get bankLimit() { return this.ac.def.cat === 'ga' || this.ac.def.cat === 'vintage' ? 22 : 25; }
  get hasAthr() { const t = this.ac.def.eng.t; return (t === 'fan' || t === 'jet' || t === 'tprop') && this.ac.def.cat !== 'ga' && this.ac.def.cat !== 'vintage'; }

  vref(): number {
    const a = this.ac;
    if (a.isRotor) return 60;
    return a.def.v.vref * Math.sqrt(a.mass / a.def.m.mlw);
  }
  vSpeeds() {
    const a = this.ac, d = a.def, w = Math.sqrt(a.mass / d.m.mtow);
    const vr = d.v.vr * w;
    return { v1: vr - 4, vr, v2: (d.v.v2 ?? vr + 8) * w + (d.v.v2 ? 0 : 0), vref: this.vref(), vapp: this.vref() + 5 };
  }

  // ───────────────────────── speeds ─────────────────────────
  /** Knots IAS per unit Mach here and now. */
  private iasPerMach() { const a = this.ac; const r = a.tas > 30 ? a.ias / a.tas : Math.sqrt(Math.max(0.05, a.air.sigma)); return a.air.a * r / KT; }
  private flapFrac() { const n = this.ac.aero.flaps.length; return n > 1 ? this.ac.flapIdx / (n - 1) : 0; }
  /** Lowest selectable speed for the configuration (1.23 Vs at this weight). */
  vls() {
    const a = this.ac, d = a.def;
    const vs = d.v.vs1 + (d.v.vs0 - d.v.vs1) * this.flapFrac();
    return 1.23 * vs * Math.sqrt(a.mass / Math.max(1, d.m.mlw));
  }
  /** Highest speed: VMO/MMO, the flap placard for the current setting, gear extended. */
  vmax() {
    const a = this.ac, d = a.def;
    let v = d.v.vmo - 5;
    if (d.v.mmo > 0.2) v = Math.min(v, (d.v.mmo - 0.01) * this.iasPerMach());
    if (a.flapIdx > 0) v = Math.min(v, d.v.vfe + (Math.min(d.v.vmo, 250) - d.v.vfe) * (1 - this.flapFrac()) - 3);
    if (a.gearPos > 0.05 && d.gear.retract) v = Math.min(v, d.v.vle - 3);
    return v;
  }
  /** Cruise Mach from the type's cruise TAS at the planned cruise level. */
  private cruiseMach() {
    const d = this.ac.def, h = Math.min(this.plan.cruiseFt, d.v.ceil) * FT;
    const T = Math.max(216.65, 288.15 - 0.0065 * h);
    return Math.min(d.v.mmo - 0.02, (d.v.cruise * KT) / Math.sqrt(1.4 * 287.05 * T));
  }
  /** Managed speed for the phase of flight (KIAS). */
  managedIas() {
    const a = this.ac, d = a.def, altFt = a.alt / FT, ipm = this.iasPerMach();
    const n = a.aero.flaps.length;
    if (a.flapIdx > 0) return a.flapIdx === n - 1 ? this.vref() + 5 : Math.max(this.vls() + 10, this.vmax() - 15);
    const jet = this.isJet;
    const econ = jet ? Math.min(d.v.vmo - 25, d.cat === 'widebody' ? 310 : d.cat === 'bizjet' ? 280 : 290) : Math.min(d.v.vmo - 10, d.v.cruise * 0.92);
    // close to the destination and low: slow down for the approach (clean minimum + a margin)
    const destNm = this.plan.wps.length ? this.plan.remainingNm(a) : 999;
    const destElev = this.plan.approach ? this.plan.approach.elev / FT : 0;
    if (this.plan.approach && destNm < 18 && altFt < destElev + 5000) return Math.max(this.vls() + 25, Math.min(econ, jet ? 210 : econ));
    let v = econ;
    if (d.v.mmo > 0.2 && jet) v = Math.min(v, this.cruiseMach() * ipm);   // Mach above the crossover
    if (altFt < 10000 + (this.plan.approach ? 0 : 0)) v = Math.min(v, 250);
    return Math.max(v, this.vls() + 10);
  }
  /** The speed the autopilot and autothrottle actually fly (selected or managed, within the limits). */
  targetIas() {
    const raw = this.spdManaged ? this.managedIas() : this.spdIsMach ? this.selMach * this.iasPerMach() : this.selSpd;
    const lo = this.ac.onGround ? 0 : this.vls() + 3, hi = this.vmax();
    return clamp(raw, Math.min(lo, hi), hi);
  }
  /** Mode annunciations for the PFD / HUD. */
  get vertFma(): string {
    if (this.vert === 'VNAV') return `VNAV ${this.vnavSub}`;
    if (this.vert === 'TOGA' && !this.ac.onGround) return 'SRS';
    return this.vert === 'OFF' ? '' : this.vert;
  }

  // ───────────────────────── mode engagement ─────────────────────────
  engageAp(on: boolean) {
    const a = this.ac;
    if (on === this.ap) return;
    this.ap = on;
    if (on) {
      if (a.onGround && !a.isRotor) { this.ap = false; this.msg = 'AP: 지상에서는 연결할 수 없습니다'; return; }
      if (this.latArmed === 'NAV' && this.plan.to) { this.lat = 'NAV'; this.latArmed = null; }
      if (this.vertArmed === 'VNAV' && this.plan.to && this.vert === 'OFF') { this.vertArmed = null; this.setVert('VNAV'); }
      if (this.lat === 'OFF') { this.lat = 'HDG'; this.selHdg = Math.round(this.hdgM) || 360; }
      if (this.vert === 'OFF') {
        this.vert = 'VS'; this.selVs = Math.round(a.vs / FPM / 100) * 100;
        if (Math.abs(this.selVs) < 200) { this.vert = 'ALT'; this.selAlt = Math.round(a.alt / FT / 100) * 100; this.altHold = this.selAlt; }
      }
      this.pitchHold = a.theta * RAD;
      this.aEst = a.alpha * RAD;
      this.vsPid.reset();
    } else {
      this.apDisconnectWarn = 3;
      this.fbwVtrim = a.ias;
    }
  }
  altHold = 0;
  setLat(m: LatMode) {
    if (m === 'LOC') { this.latArmed = this.lat === 'LOC' ? null : 'LOC'; return; }
    // on the ground (or below 50 ft on the takeoff) NAV is armed and engages once airborne
    if (m === 'NAV' && (this.ac.onGround || this.lat === 'RWY')) { this.latArmed = this.latArmed === 'NAV' ? null : 'NAV'; return; }
    this.lat = this.lat === m ? 'HDG' : m;
    if (this.lat === 'HDG' && m !== 'HDG') this.selHdg = Math.round(this.hdgM) || 360;
  }
  setVert(m: VertMode) {
    const a = this.ac;
    this.vsPid.reset();
    if (m === this.vert) { m = this.vert === 'VNAV' ? 'ALT' : 'VS'; }
    if (m === 'ALT') { this.altHold = Math.round(a.alt / FT); }
    if (m === 'VS') { this.selVs = Math.round(a.vs / FPM / 100) * 100; }
    if (m === 'FLC') {
      this.flcGamma = Math.atan2(a.vs, a.tas) * RAD;
      if (Math.abs(this.selAlt - a.alt / FT) < 100) { this.msg = 'FLC: 목표 고도를 먼저 선택하세요'; return; }
      this.selSpd = Math.round(a.ias / KT);
    }
    if (m === 'PIT') this.pitchHold = a.theta * RAD;
    if (m === 'VNAV') {
      if (!this.plan.to) { this.msg = 'VNAV: 비행계획이 없습니다'; return; }
      if (a.onGround || this.vert === 'TOGA') { this.vertArmed = this.vertArmed === 'VNAV' ? null : 'VNAV'; this.spdManaged = true; return; }
      this.spdManaged = true;
      this.flcGamma = Math.atan2(a.vs, a.tas) * RAD;
      this.altHold = Math.round(a.alt / FT);
      this.vnavSub = 'ALT';
    }
    this.vert = m;
  }
  armApp() {
    if (!this.plan.approach) { this.msg = 'APP: 도착 활주로(ILS)가 설정되지 않았습니다'; return; }
    this.latArmed = 'LOC'; this.vertArmed = 'GS'; this.ilsTuned = true;
  }
  toga() {
    const a = this.ac;
    this.vert = 'TOGA'; this.lat = a.onGround ? 'RWY' : 'GA';
    this.selHdg = Math.round(this.hdgM) || 360;
    if (this.hasAthr) this.athr = 'TOGA';
    this.flare = false; this.gsCaptured = false;
    if (!a.onGround) { this.latArmed = null; this.vertArmed = null; }
    // SRS: V2 + 10 on the takeoff, at least the current speed on a go-around
    const v = this.vSpeeds();
    this.srsSpd = a.onGround ? v.v2 + 10 : Math.max(v.vref + 10, Math.min(a.ias / KT, v.v2 + 25));
    this.flcGamma = a.onGround ? 8 : Math.max(3, Math.atan2(a.vs, a.tas) * RAD);
  }
  toggleAthr() {
    if (!this.hasAthr) { this.msg = 'A/THR: 이 기종에는 오토스로틀이 없습니다'; return; }
    if (this.athr === 'OFF') { this.athr = 'SPEED'; this.athrPid.reset(); this.thrCmd = this.thrI = this.ac.engineCmd[0]?.throttle ?? 0; }
    else this.athr = 'OFF';
  }

  // ───────────────────────── main update ─────────────────────────
  update(dt: number, pin: PilotInput) {
    const a = this.ac;
    if (this.apDisconnectWarn > 0) this.apDisconnectWarn -= dt;
    const iasKt = a.ias / KT;
    this.magv = magVar(a.lat, a.lon);
    if (this.lastIas > 0) this.accel = approach(this.accel, clamp((iasKt - this.lastIas) / Math.max(dt, 1e-3), -20, 20), 0.6, dt);
    this.lastIas = iasKt;

    // pilot override disconnects AP
    if (this.ap && !a.isRotor && (Math.abs(pin.pitch) > 0.5 || Math.abs(pin.roll) > 0.5)) { this.engageAp(false); this.msg = 'AUTOPILOT DISCONNECT (조종간 개입)'; }

    if (this.plan.approach) this.ils = ilsDeviation(this.plan.approach, a, a.alt); else this.ils = null;
    // takeoff thrust on the roll with the flight director on: TOGA / SRS guidance on the flight director
    // (the autothrottle stays as the pilot left it, so pressing A/THR after takeoff engages it)
    if (!a.isRotor && a.onGround && this.fd && this.vert === 'OFF' && a.gs > 5 * KT && (a.engineCmd[0]?.throttle ?? 0) > 0.85 && a.def.cat !== 'glider') {
      const athr = this.athr;
      this.toga();
      this.athr = athr;
    }

    if (a.isRotor) { this.heli(dt, pin); this.autothrottle(dt); return; }

    this.modeLogic();
    const tgt = this.autopilotTargets(dt);
    this.fdPitch = tgt.pitch; this.fdRoll = tgt.roll;

    const fbw = a.def.fbw;
    let de: number, da: number, dr: number;
    const lowQ = a.qbar < 400 || a.onGround;

    if (this.ap && !lowQ) {
      ({ de, da } = this.innerLoops(dt, tgt.pitch, tgt.roll));
      // autopilot trim servo keeps the elevator unloaded
      if (!fbw) a.trim = clamp(a.trim + clamp(a.de, -1, 1) * 0.08 * dt * (a.aero.maxDe / a.aero.trimRange), -1, 1);
    } else if (fbw && !lowQ && this.law === 'NORMAL') {
      ({ de, da } = this.fbwLaw(dt, pin));
    } else {
      de = pin.pitch; da = pin.roll;
      this.pitchHold = a.theta * RAD; this.bankHold = a.phi * RAD; this.rollHoldActive = false;
      this.fbwVtrim = iasKt;
    }
    // manual pitch trim (conventional); FBW auto-trims
    if (!fbw || lowQ) a.trim = clamp(a.trim + pin.trim * dt * 0.12, -1, 1);

    // yaw: pedals + yaw damper / turn coordination
    dr = pin.yaw;
    if ((this.yd && (this.isJet || fbw || a.def.cat === 'regional' || a.def.eng.t === 'tprop')) || this.ap) {
      if (!a.onGround && a.tas > 30) {
        const rCmd = (G0 * Math.sin(a.phi)) / Math.max(a.tas, 30);
        const I = a.inertia();
        const rdot = 2.2 * (rCmd - a.w[2]) + 1.5 * a.beta * (a.tas / 100);
        this.yawInt = clamp(this.yawInt + a.beta * dt * 0.5, -0.3, 0.3);
        const yd = (I[2] * rdot - a.CnRest) / Math.max(1, a.ctrlPower.yaw);
        dr += clamp(yd + this.yawInt, -0.6, 0.6) * (fbw || this.ap ? 1 : 0.5);
      } else this.yawInt = 0;
    }
    // rollout: keep centreline with rudder / nosewheel
    if (this.lat === 'ROLLOUT' && this.plan.approach && this.ils) {
      const ap = this.plan.approach;
      const xtk = crossTrack(ap.thr, ap.locAnt, a);
      dr = clamp(-xtk * 0.04 - wrap180(a.heading - ap.crs) * 0.1 - a.w[2] * 2, -1, 1) + pin.yaw;
      da = clamp(-a.phi * 2, -1, 1);
      // autobrake after touchdown
      if (a.onGround && a.autobrake === 0) a.autobrakeCmd = 0.35;
    }
    a.cmd.de = clamp(de, -1, 1);
    a.cmd.da = clamp(da, -1, 1);
    a.cmd.dr = clamp(dr, -1, 1);
    this.autothrottle(dt);
  }

  /** Dynamic-inversion inner loops: attitude (deg) targets -> surface commands. */
  private innerLoops(dt: number, pitchDeg: number, rollDeg: number) {
    const a = this.ac;
    const I = a.inertia();
    const big = a.def.cat === 'widebody';
    const kth = big ? 0.9 : 1.2, kq = big ? 2.8 : 3.5;
    const kph = 1.4, kp = 4;
    const V = Math.max(a.tas, 30);
    const cphi = Math.max(0.3, Math.cos(a.phi));
    const turnComp = (G0 * Math.sin(a.phi) * Math.tan(a.phi)) / V;
    const qCmd = clamp((kth * (pitchDeg * DEG - a.theta)) / cphi + turnComp, -0.15, 0.15);
    const qdot = kq * (qCmd - a.w[1]);
    const de = (I[1] * qdot - a.CmRest) / Math.max(1, a.ctrlPower.pitch);
    const rollRateMax = (a.def.cockpit === 'fighter' ? 60 : 7) * DEG;
    const pCmd = clamp(kph * wrap180(rollDeg - a.phi * RAD) * DEG, -rollRateMax, rollRateMax);
    const pdot = kp * (pCmd - a.w[0]);
    const da = (I[0] * pdot - a.ClRest) / Math.max(1, a.ctrlPower.roll);
    void dt;
    return { de, da };
  }

  /** Fly-by-wire normal laws. */
  private fbwLaw(dt: number, pin: PilotInput) {
    const a = this.ac;
    const law = a.def.fbw!;
    const I = a.inertia();
    const V = Math.max(a.tas, 40);
    const iasKt = a.ias / KT;
    const fighter = law === 'fighter';
    // pitch: load-factor demand
    const dnz = pin.pitch >= 0 ? pin.pitch * (fighter ? 8 : 1.5) : pin.pitch * (fighter ? 4 : 2);
    const phi = a.phi;
    const turnComp = Math.abs(phi) < 33 * DEG || fighter ? (G0 * Math.sin(phi) * Math.tan(phi)) / V : (G0 * Math.sin(33 * DEG) * Math.tan(33 * DEG)) / V;
    let qCmd = (G0 * dnz) / V + turnComp;
    // neutral stick: flight-path hold (C* integral term)
    const gamma = Math.atan2(a.vs, Math.max(a.gs, 1));
    if (Math.abs(pin.pitch) < 0.03 && law !== 'boeing') {
      if (!this.pathHoldActive) { this.gammaHold = gamma; this.pathHoldActive = true; }
      qCmd += clamp(0.4 * (this.gammaHold - gamma), -0.05, 0.05) * Math.cos(phi);
    } else this.pathHoldActive = false;
    if (law === 'boeing') qCmd += clamp((iasKt - this.fbwVtrim) * 0.0012, -0.03, 0.03);
    // pitch trim switch moves the Boeing trim reference speed
    if (law === 'boeing') this.fbwVtrim = clamp(this.fbwVtrim - pin.trim * dt * 6, a.def.v.vs1 * 0.8, a.def.v.vmo);
    // protections
    const alphaMax = (a.aero.CLmax + a.aero.flaps[a.flapIdx].dCLmax) / a.aero.CLa + a.aero.a0 - 1.5 * DEG;
    const alphaProt = alphaMax - (fighter ? 0 : 3 * DEG);
    this.alphaProt = a.alpha > alphaProt;
    const aLim = alphaProt + Math.max(0, pin.pitch) * (alphaMax - alphaProt);
    const fighterAlpha = 25 * DEG;
    qCmd = Math.min(qCmd, 2.0 * ((fighter ? fighterAlpha : aLim) - a.alpha) + (fighter ? 0.2 : 0));
    const th = a.theta * RAD;
    if (!fighter) {
      if (th > 25) qCmd = Math.min(qCmd, (30 - th) * 0.02);
      if (th < -10) qCmd = Math.max(qCmd, (-15 - th) * 0.02);
      if (iasKt > a.def.v.vmo + 6) qCmd += (iasKt - a.def.v.vmo - 6) * 0.004;
    }
    this.alphaFloor = !fighter && a.alpha > alphaMax - 1 * DEG && !a.onGround;
    // flare mode (Airbus): below 50 ft RA the law blends to attitude command with nose-down bias
    const ra = (a.agl - a.aero.cgHeight) / FT;
    if (law === 'airbus' && ra < 50 && a.vs < 0 && a.gearDown) {
      if (!this.flare) { this.flare = true; this.flareMemo = th; this.flareT = 0; }
      this.flareT += dt;
      const thCmd = this.flareMemo - Math.min(2, this.flareT * 0.25) + pin.pitch * 12;
      qCmd = 1.5 * (thCmd - th) * DEG;
    } else if (ra > 100) this.flare = false;
    const kq = fighter ? 8 : 3;
    this.dbgQ = [qCmd, a.w[1], this.gammaHold, gamma];
    const qdot = kq * (qCmd - a.w[1]);
    let de = (I[1] * qdot - a.CmRest) / Math.max(1, a.ctrlPower.pitch);

    // roll
    let da: number;
    const phiDeg = phi * RAD;
    if (law === 'boeing') {
      da = pin.roll;
      if (Math.abs(phiDeg) > 35) da -= Math.sign(phiDeg) * (Math.abs(phiDeg) - 35) * 0.04;
    } else {
      const pMax = fighter ? 240 : 15;
      let pCmd: number;
      if (Math.abs(pin.roll) > 0.03) {
        pCmd = pin.roll * pMax * DEG;
        this.bankHold = phiDeg; this.rollHoldActive = true;
      } else {
        if (!this.rollHoldActive) { this.bankHold = phiDeg; this.rollHoldActive = true; }
        if (!fighter && Math.abs(this.bankHold) > 33) this.bankHold = moveToward(this.bankHold, Math.sign(this.bankHold) * 33, 5 * dt);
        pCmd = (this.bankHold - phiDeg) * 1.2 * DEG;
      }
      if (!fighter && Math.abs(phiDeg) > 60 && Math.sign(pCmd) === Math.sign(phiDeg)) pCmd *= clamp((67 - Math.abs(phiDeg)) / 7, 0, 1);
      const pdot = (fighter ? 10 : 4) * (pCmd - a.w[0]);
      da = (I[0] * pdot - a.ClRest) / Math.max(1, a.ctrlPower.roll);
    }
    // auto-trim (THS) — unload elevator slowly
    if (law === 'airbus' && !this.flare) {
      a.trim = clamp(a.trim + clamp(a.de, -1, 1) * 0.3 * dt * (a.aero.maxDe / a.aero.trimRange), -1, 1);
    }
    de = clamp(de, -1, 1);
    return { de, da };
  }
  private flareT = 0;
  private flareTau = 3;
  private pathHoldActive = false;
  dbgQ: number[] = [];
  private gammaHold = 0;

  // ───────────────────────── autopilot / flight director ─────────────────────────
  private modeLogic() {
    const a = this.ac;
    const altFt = a.alt / FT;
    const vsFpm = a.vs / FPM;
    // altitude capture
    if (this.vert === 'VS' || this.vert === 'FLC' || this.vert === 'PIT') {
      const err = this.selAlt - altFt;
      const band = Math.max(150, Math.abs(vsFpm) * 0.25);
      const moving = (err > 0 && vsFpm > 100) || (err < 0 && vsFpm < -100);
      if (Math.abs(err) < band && moving) { this.vert = 'ALT*'; this.altHold = this.selAlt; }
    }
    if (this.vert === 'ALT*' && Math.abs(this.selAlt - altFt) < 40) this.vert = 'ALT';
    if (this.vert === 'ALT' || this.vert === 'ALT*') {
      if (Math.abs(this.altHold - this.selAlt) > 1 && this.vert === 'ALT*') this.altHold = this.selAlt;
    }
    // LOC / GS capture
    const ils = this.ils;
    if (this.latArmed === 'LOC' && ils?.valid && Math.abs(ils.loc) < 1.8) {
      this.lat = 'LOC'; this.latArmed = null;
    }
    if (this.vertArmed === 'GS' && ils?.gsValid && this.lat === 'LOC' && Math.abs(ils.gs) < 0.6) {
      this.vert = 'GS'; this.vertArmed = null; this.gsCaptured = true;
    }
    // autoland: flare / rollout
    const ra = (a.agl - a.aero.cgHeight) / FT;
    const flareFt = clamp(25 + a.def.L * 0.6, 40, 75);
    if (this.vert === 'GS' && this.ap && ra < flareFt && !a.onGround) {
      this.vert = 'FLARE';
      this.flareTau = Math.max(1.5, (ra * FT) / Math.max(0.5, -a.vs - 0.4));
    }
    if ((this.vert === 'FLARE' || this.vert === 'GS') && a.onGround && this.lat === 'LOC') { this.lat = 'ROLLOUT'; }
    if (this.vert === 'TOGA' && !a.onGround && this.lat === 'RWY' && ra > 30) this.lat = 'HDG';
    // armed NAV engages above 50 ft after takeoff
    if (this.latArmed === 'NAV' && !a.onGround && ra > 50 && this.plan.to) { this.lat = 'NAV'; this.latArmed = null; }
    // thrust reduction / acceleration altitude: SRS -> climb (VNAV if armed, else FLC / ALT)
    const thrRed = a.def.cat === 'ga' || a.def.cat === 'vintage' ? 800 : 1500;
    if (this.vert === 'TOGA' && !a.onGround && ra > thrRed && a.vs > 0) {
      if (this.athr === 'TOGA') this.athr = 'SPEED';
      this.thrI = this.ac.engineCmd[0]?.throttle ?? this.thrI;
      if (this.vertArmed === 'VNAV' && this.plan.to) { this.vertArmed = null; this.vert = 'VNAV'; this.vnavSub = 'SPD'; this.flcGamma = Math.atan2(a.vs, a.tas) * RAD; }
      else if (this.selAlt > altFt + 300) { this.vert = 'FLC'; this.flcGamma = Math.atan2(a.vs, a.tas) * RAD; }
      else { this.vert = 'ALT*'; this.altHold = Math.max(this.selAlt, Math.round(altFt / 100) * 100); }
    }
    if (this.vert === 'VNAV') this.vnavLogic();
    // NAV sequencing
    // keep sequencing the flight plan on the approach too (distance to go, managed speeds)
    if (this.lat === 'NAV' || this.lat === 'LOC') this.sequence();
  }

  /**
   * VNAV: climb at managed speed to the lower of the cruise level and the MCP altitude; level there; from the
   * top of descent fly a 3° path down to the next altitude constraint (or 3000 ft above the destination ~12 NM out),
   * never below the MCP altitude. Like Boeing VNAV the MCP altitude is a hard limit in both directions.
   */
  private vnavLogic() {
    const a = this.ac, p = this.plan, altFt = a.alt / FT, vsFpm = a.vs / FPM;
    const destElev = p.approach ? p.approach.elev / FT : 0;
    const remaining = p.remainingNm(a);
    // next constraint below us along the route, else the approach gate
    let endFt = destElev + 3000, endNm = Math.max(0, remaining - 12);
    let acc = p.to ? distance(a, p.to) / NM : 0;
    for (let i = p.active; i < p.wps.length; i++) {
      const w = p.wps[i];
      if (i > p.active) acc += distance(p.wps[i - 1], w) / NM;
      if (w.alt !== undefined && w.alt < altFt - 200 && w.alt > endFt - 1) { endFt = w.alt; endNm = acc; break; }
    }
    const crz = Math.min(p.cruiseFt, this.ac.def.v.ceil);
    const ceilingFt = Math.min(crz, this.selAlt);
    const floorFt = Math.max(this.selAlt, endFt);
    // 3° path: 318 ft per NM, plus room to slow to 250 kt before 10 000 ft
    const decel = altFt > 11000 ? 5 : 0;
    const todDist = endNm - (altFt - endFt) / 318 - decel;
    this.todNm = altFt > endFt + 500 ? todDist : null;
    const band = Math.max(150, Math.abs(vsFpm) * 0.2);
    if (this.vnavPhase !== 'DES' && todDist <= 0 && altFt > endFt + 500 && remaining > 0) this.vnavPhase = 'DES';
    if (this.vnavPhase === 'DES') {
      if (altFt > this.selAlt + 200 || this.vnavSub === 'PTH') {
        // fly the path; level at the MCP altitude / constraint (VNAV ALT) and continue when it is lowered
        const pathFt = endFt + Math.max(0, endNm - decel) * 318 + (altFt > 10000 ? decel * 318 : 0);
        const pathVs = -(a.gs / KT) * 101.27 * Math.tan(3 * DEG);
        this.vnavVs = clamp(pathVs + clamp((pathFt - altFt) * 1.5, -1500, 1200), -4500, 0);
        if (altFt - floorFt < band && vsFpm < -100) { this.vnavSub = 'ALT'; this.altHold = floorFt; }
        else if (this.vnavSub !== 'ALT' || altFt > this.altHold + 250) this.vnavSub = 'PTH';
        // too fast on the path with the thrust at idle: ask for speed brakes
        if (this.vnavSub === 'PTH' && a.ias / KT > this.targetIas() + 12 && (a.engineCmd[0]?.throttle ?? 1) < 0.05 && performance.now() - this.msgT > 15000) {
          this.msgT = performance.now(); this.msg = 'VNAV: MORE DRAG — 스피드 브레이크를 펴세요';
        }
      }
      if (this.vnavSub === 'ALT' && this.selAlt < this.altHold - 200 && altFt > endFt + 200) this.vnavSub = 'PTH';
      // at the top of descent with the MCP altitude still at cruise: remind the pilot (VNAV never busts the MCP altitude)
      if (this.vnavSub === 'ALT' && altFt > endFt + 1000 && this.selAlt >= altFt - 200 && performance.now() - this.msgT > 30000) {
        this.msgT = performance.now(); this.msg = 'T/D — 강하 시작점: MCP 고도를 낮추면 VNAV가 강하합니다';
      }
      return;
    }
    // climb / cruise
    const holding = this.vnavSub === 'ALT' && Math.abs(altFt - this.altHold) < 600 && this.altHold >= ceilingFt - 50;
    if (!holding && altFt < ceilingFt - band) { this.vnavPhase = 'CLB'; if (this.vnavSub !== 'SPD') this.flcGamma = Math.atan2(a.vs, a.tas) * RAD; this.vnavSub = 'SPD'; }
    else {
      // level at the ceiling; if the MCP altitude was set below us before the top of descent, level off where we are
      if (this.vnavSub !== 'ALT') this.altHold = ceilingFt < altFt - 300 ? Math.round(altFt / 100) * 100 : ceilingFt;
      this.vnavSub = 'ALT';
      if (ceilingFt >= crz - 100) this.vnavPhase = 'CRZ';
    }
    // MCP altitude raised while levelled below the cruise level: climb on
    if (this.vnavSub === 'ALT' && ceilingFt > this.altHold + 200) { this.vnavSub = 'SPD'; this.flcGamma = Math.atan2(a.vs, a.tas) * RAD; }
  }

  private sequence() {
    const a = this.ac;
    const p = this.plan;
    const from = p.from, to = p.to;
    if (!from || !to) return;
    const next = p.wps[p.active + 1];
    const dist = distance(a, to);
    let lead = 0.3 * NM;
    if (next) {
      const d = Math.abs(wrap180(bearing(to, next) - bearing(from, to)));
      const R = (a.gs * a.gs) / (G0 * Math.tan(this.bankLimit * DEG));
      lead = Math.max(0.2 * NM, R * Math.tan((d * DEG) / 2));
    }
    // managed approach: arm LOC/GS on the final legs (inside 25 NM of the runway)
    if (p.approach && !this.latArmed && !this.vertArmed && this.lat === 'NAV' && (this.ap || this.fd) && p.remainingNm(a) < 25 && !a.onGround) {
      this.latArmed = 'LOC'; this.vertArmed = 'GS'; this.ilsTuned = true; this.msg = `APPR ARMED — ${p.approach.airport} ${p.approach.runway} ILS`;
    }
    const past = alongTrack(from, to, a) > distance(from, to);
    if (dist < lead || past) {
      if (next) p.active++;
      else if (p.approach && !this.latArmed && this.lat === 'NAV') { this.latArmed = 'LOC'; this.vertArmed = 'GS'; }
    }
  }

  private autopilotTargets(dt: number): { pitch: number; roll: number } {
    const a = this.ac;
    const V = Math.max(a.tas, 30);
    const altFt = a.alt / FT;
    let roll = 0, pitch = a.theta * RAD;
    const hdg = this.hdgM;
    const bankLim = this.bankLimit;
    const courseToRoll = (desiredTrack: number) => {
      const err = wrap180(desiredTrack - a.track);
      return clamp(err * 1.4, -bankLim, bankLim);
    };
    switch (this.lat) {
      case 'HDG': case 'OFF': roll = clamp(wrap180(this.selHdg - hdg) * 1.4, -bankLim, bankLim); break;
      case 'ROL': roll = Math.abs(a.phi * RAD) < 6 ? 0 : a.phi * RAD; break;
      case 'NAV': {
        const from = this.plan.from, to = this.plan.to;
        if (from && to) {
          const xtk = crossTrack(from, to, a);
          const crs = bearing(a, to) * 0 + bearing(from, to) + (alongTrack(from, to, a) / Math.max(1, distance(from, to))) * 0;
          const legCrs = distance(from, to) > 1000 ? bearing(from, to) : bearing(a, to);
          const intercept = clamp((-xtk / NM) * 25, -45, 45);
          void crs;
          roll = courseToRoll(legCrs + intercept);
        } else roll = 0;
        break;
      }
      case 'LOC': case 'ROLLOUT': {
        const ap = this.plan.approach!;
        const ils = this.ils!;
        const dist = Math.max(500, distance(a, ap.locAnt));
        const xtk = Math.tan(ils.locDeg * DEG) * dist;
        const intercept = clamp(-xtk * 0.03 * (8000 / Math.max(3000, dist)), -30, 30);
        roll = courseToRoll(ap.crs + intercept);
        if ((a.agl - a.aero.cgHeight) / FT < 50) roll = clamp(roll, -3, 3);
        break;
      }
      case 'GA': case 'RWY': roll = clamp(wrap180(this.selHdg - hdg) * 1.0, -15, 15); break;
    }

    const gammaToPitch = (gammaDeg: number) => gammaDeg + this.alphaEst();
    switch (this.vert) {
      case 'OFF': pitch = a.theta * RAD; break;
      case 'PIT': pitch = this.pitchHold; break;
      case 'VS': {
        const vsTgt = this.selVs * FPM;
        const g = Math.asin(clamp(vsTgt / V, -0.5, 0.5)) * RAD;
        pitch = gammaToPitch(g) + this.vsPid.update(this.selVs - a.vs / FPM, a.vs / FPM, dt);
        break;
      }
      case 'ALT': case 'ALT*': {
        const err = this.altHold - altFt;
        const vsTgt = clamp(err * (this.vert === 'ALT' ? 4 : 3), -2000, 2000);
        const g = Math.asin(clamp((vsTgt * FPM) / V, -0.5, 0.5)) * RAD;
        pitch = gammaToPitch(g) + this.vsPid.update(vsTgt - a.vs / FPM, a.vs / FPM, dt);
        break;
      }
      case 'FLC': {
        const climbing = this.selAlt > altFt;
        pitch = this.speedOnPitch(dt, this.targetIas(), climbing);
        break;
      }
      case 'VNAV': {
        if (this.vnavSub === 'SPD') pitch = this.speedOnPitch(dt, this.targetIas(), true);
        else if (this.vnavSub === 'PTH') {
          const g = Math.asin(clamp((this.vnavVs * FPM) / V, -0.5, 0.5)) * RAD;
          pitch = gammaToPitch(g) + this.vsPid.update(this.vnavVs - a.vs / FPM, a.vs / FPM, dt);
        } else {
          const vsTgt = clamp((this.altHold - altFt) * 3, -2000, 2000);
          const g = Math.asin(clamp((vsTgt * FPM) / V, -0.5, 0.5)) * RAD;
          pitch = gammaToPitch(g) + this.vsPid.update(vsTgt - a.vs / FPM, a.vs / FPM, dt);
        }
        break;
      }
      case 'GS': {
        const ils = this.ils;
        if (ils) {
          const ap = this.plan.approach!;
          const gCmd = -ap.gs + clamp(ils.gsDeg * -3.0, -2.5, 2.5);
          pitch = gammaToPitch(gCmd);
        }
        break;
      }
      case 'FLARE': {
        const ra = Math.max(0, (a.agl - a.aero.cgHeight));
        const vsTgt = -(ra / this.flareTau + 0.25);
        const g = Math.asin(clamp(vsTgt / V, -0.3, 0.1)) * RAD;
        pitch = gammaToPitch(g) + 0.5 + this.vsPid.update((vsTgt - a.vs) / FPM, a.vs / FPM, dt);
        break;
      }
      case 'TOGA': {
        const ground = this.isJet ? 15 : 10;
        if (a.onGround || (a.agl - a.aero.cgHeight) / FT < 20) { pitch = a.def.cockpit === 'fighter' ? 12 : ground; this.flcGamma = Math.max(this.flcGamma, 6); break; }
        // SRS: hold the takeoff / go-around speed with pitch, never below a positive climb
        pitch = Math.min(this.speedOnPitch(dt, Math.max(this.srsSpd || this.vSpeeds().v2 + 10, this.vls() + 5), true, 2), 18);
        break;
      }
    }
    if (a.onGround && this.lat === 'ROLLOUT') pitch = 0;
    // close to the ground: gentle banks only (10° below 100 ft, 15° below 400 ft)
    const raFt = (a.agl - a.aero.cgHeight) / FT;
    if (this.lat !== 'LOC' && this.lat !== 'ROLLOUT' && raFt < 400) roll = clamp(roll, raFt < 100 ? -10 : -15, raFt < 100 ? 10 : 15);
    pitch = clamp(pitch, -15, 25);
    return { pitch, roll };
  }
  /** Speed-on-elevator (FLC / VNAV SPD / SRS): adjust the flight path angle until the speed is right. */
  private speedOnPitch(dt: number, tgtKt: number, climbing: boolean, minClimb = 0.5) {
    const a = this.ac;
    const spdErr = a.ias / KT - tgtKt;
    this.flcGamma += clamp(spdErr * 0.08 + this.accel * 0.3, -1.5, 1.5) * dt;
    this.flcGamma = climbing ? clamp(this.flcGamma, minClimb, 18) : clamp(this.flcGamma, -12, -0.5);
    return this.flcGamma + this.alphaEst();
  }
  private aEst = 0;
  private alphaEst() {
    // body pitch ≈ flight-path + alpha·cos(phi) (filtered): theta - gamma
    const a = this.ac;
    const gamma = Math.atan2(a.vs, Math.max(a.gs, 1)) * RAD;
    const est = a.theta * RAD - gamma;
    this.aEst = approach(this.aEst, clamp(est, -5, 20), 1.5, 1 / 120);
    return this.aEst;
  }

  // ───────────────────────── autothrottle ─────────────────────────
  private autothrottle(dt: number) {
    const a = this.ac;
    if (this.athr === 'OFF' && !this.alphaFloor) return;
    const iasKt = a.ias / KT;
    const maxThr = a.def.eng.ab ? 0.95 : 1;
    const clb = a.def.eng.t === 'fan' ? 0.9 : 0.95;
    let mode: AthrMode = this.athr;
    if (this.alphaFloor && a.def.fbw === 'airbus') mode = 'A.FLOOR';
    if (this.ap || this.fd) {
      if (this.vert === 'FLC') mode = this.selAlt > a.alt / FT ? 'THR CLB' : 'IDLE';
      if (this.vert === 'VNAV' && this.vnavSub === 'SPD') mode = 'THR CLB';
    }
    if (this.vert === 'FLARE' && (a.agl - a.aero.cgHeight) / FT < 30) mode = 'RETARD';
    if (a.onGround && this.lat === 'ROLLOUT') mode = 'RETARD';
    if (this.athr === 'TOGA') mode = 'TOGA';
    // flight-path feed-forward: a change in climb angle needs W·Δsinγ more (or less) thrust
    const sinG = clamp(a.vs / Math.max(a.tas, 30), -0.3, 0.3);
    const dSin = sinG - this.lastSinG;
    this.lastSinG = sinG;
    let target: number;
    switch (mode) {
      case 'THR CLB': target = clb; break;
      case 'IDLE': case 'RETARD': target = 0; break;
      case 'TOGA': case 'A.FLOOR': target = maxThr; break;
      default: {
        // speed mode: commanded acceleration from the speed error, PI on the acceleration error
        const tgt = this.targetIas();
        const err = tgt - iasKt;
        const aCmd = clamp(err * 0.18, -1.2, 1.2);              // kt/s
        const aErr = aCmd - this.accel;
        const Tmax = Math.max(1, maxThrust(a.def, a.air, Math.max(a.tas, 30), a.mach) * Math.max(1, a.def.eng.n));
        const W = a.mass * G0;
        this.thrI = clamp(this.thrI + aErr * 0.01 * dt + (W * dSin) / Tmax * 0.8, 0, maxThr);
        target = clamp(this.thrI + aErr * 0.035, 0, maxThr * 0.98);
        this.thrCmd = target;
        for (const c of a.engineCmd) c.throttle = moveToward(c.throttle, target, dt * 0.25);
        if (this.athr !== 'TOGA') this.athr = 'SPEED';
        this.athrDisplay = this.spdManaged ? (this.spdIsMach || (this.vert === 'VNAV' && a.alt / FT > 26000) ? 'MACH' : 'SPEED') : this.spdIsMach ? 'MACH' : 'SPEED';
        return;
      }
    }
    this.athrDisplay = mode;
    this.thrCmd = target;
    this.thrI = a.engineCmd[0]?.throttle ?? target;   // bumpless back into SPEED
    for (const c of a.engineCmd) c.throttle = moveToward(c.throttle, target, dt * (mode === 'RETARD' ? 0.25 : 0.2));
  }
  athrDisplay: string = 'OFF';

  // ───────────────────────── helicopter ─────────────────────────
  private heli(dt: number, pin: PilotInput) {
    const a = this.ac;
    const I = a.inertia();
    let de = pin.pitch, da = pin.roll, dr = pin.yaw;
    a.collective = clamp(pin.collective, 0, 1);
    if (this.sas) {
      // rate-damping SAS + attitude retention when stick is centred
      de += -a.w[1] * 1.2;
      da += -a.w[0] * 1.0;
      dr += -a.w[2] * 1.5;
      if (Math.abs(pin.pitch) < 0.03 && !a.onGround) de += (this.pitchHold * DEG - a.theta) * 1.5; else this.pitchHold = a.theta * RAD;
      if (Math.abs(pin.roll) < 0.03 && !a.onGround) da += (this.bankHold * DEG - a.phi) * 1.5; else this.bankHold = a.phi * RAD;
    }
    if (this.ap && !a.onGround) {
      // attitude autopilot with HDG / ALT / IAS / VS upper modes
      let rollT = 0;
      if (this.lat === 'HDG' || this.lat === 'OFF') rollT = clamp(wrap180(this.selHdg - this.hdgM) * 1.0, -20, 20);
      if (this.lat === 'NAV' && this.plan.to) rollT = clamp(wrap180(bearing(a, this.plan.to) - a.track) * 1.0, -20, 20);
      const ias = a.ias / KT;
      const pitchT = ias > 25 || this.selSpd > 25 ? clamp(-(this.selSpd - ias) * 0.3, -12, 10) : 0;
      const qdot = 3 * (1.5 * (pitchT * DEG - a.theta) - a.w[1]);
      const pdot = 3 * (1.5 * (rollT * DEG - a.phi) - a.w[0]);
      de = clamp(I[1] * qdot / Math.max(1, a.ctrlPower.pitch), -1, 1);
      da = clamp(I[0] * pdot / Math.max(1, a.ctrlPower.roll), -1, 1);
      this.pitchHold = a.theta * RAD; this.bankHold = a.phi * RAD;
      // vertical: collective
      let vsTgt = this.selVs;
      if (this.vert === 'ALT' || this.vert === 'ALT*') vsTgt = clamp((this.altHold - a.alt / FT) * 3, -1000, 1000);
      if ((this.vert === 'VS') && Math.abs(this.selAlt - a.alt / FT) < 100 && Math.abs(this.selVs) > 0) { this.vert = 'ALT'; this.altHold = this.selAlt; }
      a.collective = clamp(this.heliCollBase + this.heliAltPid.update(vsTgt - a.vs / FPM, a.vs / FPM, dt), 0, 1);
      // turn coordination with pedals in forward flight
      if (a.tas > 20) dr += clamp(-a.beta * 2, -0.5, 0.5);
    } else {
      this.heliCollBase = a.collective;
      this.heliAltPid.reset();
      this.altHold = a.alt / FT;
    }
    a.cmd.de = clamp(de, -1, 1);
    a.cmd.da = clamp(da, -1, 1);
    a.cmd.dr = clamp(dr, -1, 1);
    this.fdPitch = a.theta * RAD; this.fdRoll = a.phi * RAD;
    void dt;
  }
  private heliCollBase = 0.5;
}

export { NM };
