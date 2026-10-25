// Derives a complete aerodynamic model (lift curve, drag polar, stability & control derivatives,
// inertias, gear geometry) from an aircraft's published geometry and performance.
import { DEG, G0, KT, FT, clamp, type V3 } from '../core/math.ts';
import { atmosphere, RHO0 } from './atmosphere.ts';
import { maxThrust } from './engines.ts';
import { FLAP_SCHEDULES, type AircraftDef, type FlapDetent } from './types.ts';

export interface GearLeg { name: string; pos: V3; k: number; c: number; steer: number; brake: boolean; tail: boolean; limitVs: number }
export interface Contact { name: string; pos: V3 }

export interface AeroModel {
  AR: number; c: number; e: number;
  CLa: number; a0: number; CLmax: number; CLmin: number;
  flaps: FlapDetent[];
  CD0: number; CDgear: number; Mcrit: number; wavePeak: number; supersonic: boolean;
  Cm0: number; Cma: number; Cmq: number; Cmde: number; trimRange: number;
  CYb: number; CYdr: number;
  Clb: number; Clp: number; Clr: number; Clda: number; Cldr: number;
  Cnb: number; Cnr: number; Cnp: number; Cnda: number; Cndr: number;
  maxDe: number; maxDa: number; maxDr: number;
  Ixx: number; Iyy: number; Izz: number; Ixz: number;
  gear: GearLeg[]; structure: Contact[];
  engPos: V3[];
  cgHeight: number;
  nacD: number;
  gLimit: number;
  CLcruise: number;
}

/** DATCOM / Helmbold lift-curve slope (per rad). */
export function liftSlope(AR: number, sweepDeg: number, M = 0.3): number {
  const beta2 = 1 - Math.min(M, 0.85) ** 2;
  const k = 0.95;
  const tanL = Math.tan(sweepDeg * DEG);
  return (2 * Math.PI * AR) / (2 + Math.sqrt((AR * AR * beta2) / (k * k) * (1 + (tanL * tanL) / beta2) + 4));
}

export function waveDrag(M: number, Mcrit: number, peak: number): number {
  if (M <= Mcrit) return 0;
  if (M < 1.05) return peak * Math.pow((M - Mcrit) / (1.05 - Mcrit), 2.5);
  return peak * (0.55 + 0.45 * Math.sqrt(0.1025 / (M * M - 1)));
}

export function deriveAero(ac: AircraftDef): AeroModel {
  const { b, S, L } = ac;
  const AR = (b * b) / S;
  const c = S / b;
  const sweep = ac.sweep;
  const cat = ac.cat;
  const fighter = ac.cockpit === 'fighter';
  const eOsw = clamp(1.78 * (1 - 0.045 * AR ** 0.68) - 0.64 - 0.04 * Math.min(sweep, 40) / 30, 0.6, 0.9);
  // fighters: LEX/strake, body lift and automatic leading-edge flaps raise the effective lift slope
  const CLa = liftSlope(AR, sweep) * (fighter && ac.tail !== 'delta' ? 1.7 : 1);
  const a0 = (ac.cat === 'glider' ? -3.5 : fighter ? -1 : ac.tail === 'delta' ? 0 : ac.eng.t === 'fan' ? -3.2 : -2.4) * DEG;

  const mRefClean = ac.m.mtow;
  const mRefLand = ac.m.mlw;
  const vs1 = Math.max(ac.v.vs1, 20) * KT, vs0 = Math.max(ac.v.vs0, 20) * KT;
  const CLmax = clamp((2 * mRefClean * G0) / (RHO0 * S * vs1 * vs1), 0.9, 2.1);
  const sched = FLAP_SCHEDULES[ac.flaps];
  const last = sched[sched.length - 1];
  const CLmaxFull = clamp((2 * mRefLand * G0) / (RHO0 * S * vs0 * vs0), CLmax, 3.4);
  const k = last.dCLmax > 0 ? (CLmaxFull - CLmax) / last.dCLmax : 0;
  const jetFlaps = ac.flaps === 'boeing' || ac.flaps === 'boeing747' || ac.flaps === 'airbus' || ac.flaps === 'regional' || ac.flaps === 'bizjet';
  const flaps = sched.map(f => ({
    ...f,
    dCL: jetFlaps ? f.dCL * clamp(k, 0.3, 1.3) * 1.4 : Math.min(f.dCL * clamp(k, 0.3, 1.3), f.dCLmax * k + 0.05),
    dCLmax: f.dCLmax * k,
  }));

  // ── inertias (Roskam radii of gyration) ──
  const mNom = ac.m.e + 0.5 * ac.m.fuel + 0.4 * ac.m.pay;
  const Rx = fighter ? 0.22 : cat === 'ga' || cat === 'vintage' ? 0.25 : ac.eng.mount === 'wing4' ? 0.31 : 0.27;
  const Ry = fighter ? 0.34 : 0.38;
  const Rz = fighter ? 0.45 : 0.46;
  const Ixx = mNom * ((b * Rx) / 2) ** 2;
  const Iyy = mNom * ((L * Ry) / 2) ** 2;
  const Izz = mNom * (((b + L) / 2) * Rz / 2) ** 2;

  // ── stability & control derivatives (per rad; nondimensional rates) ──
  const big = cat === 'widebody' || cat === 'airliner' || cat === 'regional';
  const aerobatic = ac.id === 'extra330';
  const Cma = fighter ? -0.35 : big ? -1.5 : cat === 'bizjet' ? -1.2 : -0.95;
  const Cmq = fighter ? -6 : big ? -24 : cat === 'bizjet' ? -18 : -12;
  const Cmde = fighter ? 0.7 : big ? 1.45 : 1.15;
  const Clda = aerobatic ? 0.32 : fighter ? 0.11 : big ? 0.075 : cat === 'glider' ? 0.1 : 0.15;
  const Clp = cat === 'glider' ? -0.7 : -0.45;
  const Clb = -(0.02 + 0.012 * ac.dih + (ac.wing === 'high' ? 0.05 : 0) + 0.0015 * sweep);
  const Cnb = fighter ? 0.12 : big ? 0.12 : 0.075;

  // ── gear geometry ──
  const g = ac.gear;
  const dia = ac.dia;
  const isHeavy = cat === 'widebody';
  let gh = g.gh ?? (big || cat === 'bizjet' || fighter
    ? 0.5 * dia + (isHeavy ? 0.3 * dia + 0.8 : big ? 0.28 * dia + 0.55 : fighter ? 1.1 : 0.9)
    : ac.fdm === 'rotor' ? 0.5 * dia + 0.35 : 0.5 * dia + (ac.wing === 'high' ? 0.55 : 0.45));
  if (ac.id === 'concorde') gh = 4.2;
  const legs: GearLeg[] = [];
  const W = ac.m.mtow * G0;
  const mkLeg = (name: string, pos: V3, share: number, steer: number, brake: boolean, tail = false): GearLeg => {
    const kk = (W * share) / (big || fighter ? 0.18 : 0.12);
    const cc = 2 * 0.65 * Math.sqrt(kk * ac.m.mtow * share);
    return { name, pos, k: kk, c: cc, steer, brake, tail, limitVs: ac.fdm === 'rotor' ? 3.5 : fighter ? 6 : big ? 4.2 : 3.8 };
  };
  const track = g.track ?? (ac.fdm === 'rotor' ? Math.max(2.0, dia * 1.2) : big ? 0.22 * b : fighter ? 0.3 * b : 0.24 * b);
  if (g.t === 'tri' || g.t === 'float') {
    const wb = g.wb ?? (ac.fdm === 'rotor' ? 0.35 * L : big ? 0.36 * L : fighter ? 0.3 * L : 0.26 * L);
    const mainX = -0.07 * wb - (big ? 0.2 : 0.05);
    legs.push(mkLeg('NOSE', [mainX + wb, 0, gh], 0.1, big ? 70 : 30, false));
    legs.push(mkLeg('LMAIN', [mainX, -track / 2, gh], 0.45, 0, true));
    legs.push(mkLeg('RMAIN', [mainX, track / 2, gh], 0.45, 0, true));
  } else if (g.t === 'tail') {
    const mainX = ac.fdm === 'rotor' ? 0.2 * L : 0.06 * L + 0.2;
    const tailX = ac.fdm === 'rotor' ? -0.42 * L : -0.36 * L;
    const tailZ = gh - (mainX - tailX) * Math.tan((ac.fdm === 'rotor' ? 2 : 11) * DEG);
    legs.push(mkLeg('LMAIN', [mainX, -track / 2, gh], 0.45, 0, true));
    legs.push(mkLeg('RMAIN', [mainX, track / 2, gh], 0.45, 0, true));
    legs.push(mkLeg('TAIL', [tailX, 0, tailZ], 0.1, 25, false, true));
  } else {
    // skids: four contact points
    const sx = 0.22 * L;
    for (const [n, x, y] of [['LSKID-F', sx, -track / 2], ['RSKID-F', sx, track / 2], ['LSKID-A', -sx * 0.9, -track / 2], ['RSKID-A', -sx * 0.9, track / 2]] as const) {
      legs.push(mkLeg(n, [x, y, gh], 0.25, 0, true));
    }
  }

  // ── structure contact points (crash / scrape detection) ──
  // tail-strike geometry: tail bumper placed to give a realistic tail-strike pitch angle
  const mainX0 = legs.find(l => l.name === 'LMAIN')?.pos[0] ?? 0;
  const tsDeg = ac.id === 'concorde' ? 16 : g.t === 'tail' ? 25 : fighter ? 15 : cat === 'ga' || cat === 'turboprop' ? 14 : L > 60 ? 9 : 11;
  const tailZ = Math.min(0.2 * dia, gh - (mainX0 + L * 0.45) * Math.tan(tsDeg * DEG));
  const wingZ = ac.wing === 'high' ? -0.35 * dia : ac.wing === 'mid' ? 0 : 0.3 * dia;
  const tipZ = wingZ - Math.tan(ac.dih * DEG) * b / 2;
  const tipX = -Math.tan(sweep * DEG) * b / 2 * 0.9;
  const structure: Contact[] = [
    { name: 'NOSE', pos: [L * 0.47, 0, 0.35 * dia] },
    { name: 'TAIL', pos: [-L * 0.45, 0, ac.fdm === 'rotor' ? 0.2 * dia : tailZ] },
    { name: 'BELLY', pos: [0, 0, 0.5 * dia] },
    { name: 'LWINGTIP', pos: [tipX, -b / 2, tipZ] },
    { name: 'RWINGTIP', pos: [tipX, b / 2, tipZ] },
  ];

  // engines
  const e = ac.eng;
  const pos: V3[] = [];
  const nacD = e.t === 'fan' ? 0.2 * Math.pow(e.p, 0.47) : 0.6 * dia;
  const podClear = cat === 'widebody' ? 0.75 : 0.5;
  const zUnder = e.mount === 'wing' || e.mount === 'wing4' ? gh - podClear - nacD / 2 : 0.5 * dia;
  switch (e.mount) {
    case 'nose': case 'internal': case 'top': pos.push([L * 0.2, 0, 0]); break;
    case 'internal2': pos.push([-L * 0.3, -0.5, 0], [-L * 0.3, 0.5, 0]); break;
    case 'aft': pos.push([-L * 0.3, -(dia / 2 + 0.7), -0.25 * dia], [-L * 0.3, dia / 2 + 0.7, -0.25 * dia]); break;
    case 'tri': pos.push([0.02 * L, -0.33 * b / 2, zUnder], [-L * 0.42, 0, -0.9 * dia], [0.02 * L, 0.33 * b / 2, zUnder]); break;
    case 'wing': pos.push([0.05 * L, -0.34 * b / 2, zUnder], [0.05 * L, 0.34 * b / 2, zUnder]); break;
    case 'nacelle': pos.push([0.02 * L, -Math.max(0.28 * b / 2, dia * 0.9), wingZ], [0.02 * L, Math.max(0.28 * b / 2, dia * 0.9), wingZ]); break;
    case 'wing4': case 'nacelle4': {
      const z = e.mount === 'wing4' ? zUnder : ac.id === 'concorde' ? 0.5 * dia : wingZ;
      const x = ac.id === 'concorde' ? -0.3 * L : 0.03 * L;
      const y1 = ac.id === 'concorde' ? 0.2 * b / 2 : 0.38 * b / 2, y2 = ac.id === 'concorde' ? 0.36 * b / 2 : 0.68 * b / 2;
      pos.push([x, -y2, z], [x, -y1, z], [x, y1, z], [x, y2, z]);
      break;
    }
  }
  while (pos.length < e.n) pos.push([0, 0, 0]);
  if (e.mount === 'wing' || e.mount === 'wing4') {
    for (const p of pos) structure.push({ name: 'POD', pos: [p[0], p[1], p[2] + nacD / 2] });
  }

  const model: AeroModel = {
    AR, c, e: eOsw, CLa, a0, CLmax, CLmin: -0.75 * CLmax, flaps,
    CD0: 0.025, CDgear: g.retract ? (big ? 0.018 : 0.025) : 0, Mcrit: ac.v.mmo > 1 ? 0.88 : Math.max(0.55, ac.v.mmo - 0.04),
    wavePeak: ac.v.mmo > 1 ? (ac.id === 'concorde' ? 0.011 : 0.03) : 0.035, supersonic: ac.v.mmo > 1,
    Cm0: 0, Cma, Cmq, Cmde, trimRange: fighter ? 6 * DEG : 12 * DEG,
    CYb: -0.65, CYdr: 0.17,
    Clb, Clp, Clr: 0.12, Clda, Cldr: -0.004,
    Cnb, Cnr: fighter ? -0.3 : -0.16, Cnp: -0.03, Cnda: -0.012, Cndr: big ? 0.09 : 0.075,
    maxDe: (fighter ? 25 : 22) * DEG, maxDa: 20 * DEG, maxDr: 28 * DEG,
    Ixx, Iyy, Izz, Ixz: 0,
    gear: legs, structure, engPos: pos, cgHeight: gh, nacD,
    gLimit: aerobatic ? 11 : fighter ? 10.5 : cat === 'ga' || cat === 'vintage' ? 6.5 : cat === 'glider' ? 7 : cat === 'helicopter' ? 4 : 4.2,
    CLcruise: 0.4,
  };
  calibrate(ac, model);
  return model;
}

/** Calibrate zero-lift drag so the aircraft achieves its published cruise speed, and set trim. */
function calibrate(ac: AircraftDef, m: AeroModel) {
  if (ac.fdm === 'rotor') return;
  const sup = m.supersonic;
  const h = (sup ? Math.min(ac.v.cruiseFt, 45000) : ac.v.cruiseFt) * FT;
  const air = atmosphere(h);
  const mass = Math.min(ac.m.mtow, ac.m.e + 0.5 * ac.m.pay + 0.45 * ac.m.fuel);
  const V = sup ? ac.v.mmo * 0.97 * air.a : ac.v.cruise * KT;
  const M = V / air.a;
  const q = 0.5 * air.rho * V * V;
  const CL = (mass * G0) / (q * ac.S);
  m.CLcruise = CL;
  const CDi = (CL * CL) / (Math.PI * m.e * m.AR);
  if (ac.eng.t === 'none') {
    m.CD0 = 0.0105;
  } else {
    const thrustSetting = sup ? 1 : ac.eng.t === 'prop' ? 0.75 : ac.eng.t === 'tprop' ? 0.85 : 0.82;
    const T = maxThrust(ac, air, V, M, sup) * ac.eng.n * thrustSetting;
    const CD = T / (q * ac.S);
    const CD0 = CD - CDi - waveDrag(M, m.Mcrit, m.wavePeak);
    m.CD0 = clamp(CD0, 0.009, 0.075);
  }
  // Trim: neutral elevator holds the cruise-ish lift coefficient.
  const aTrim = m.a0 + Math.min(CL, 0.7) / m.CLa;
  m.Cm0 = -m.Cma * aTrim;
}
