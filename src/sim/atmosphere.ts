import { DEG, FT, KT, clamp } from '../core/math.ts';

export const RHO0 = 1.225, P0 = 101325, T0 = 288.15, A0 = 340.294;
const L = 0.0065, Rg = 287.05287, g = 9.80665, GAMMA = 1.4;

export interface Air { T: number; p: number; rho: number; a: number; sigma: number; delta: number; theta: number }

/** ISA with temperature deviation (K) and sea-level pressure (Pa), pressure altitude via QNH. */
export function atmosphere(hMsl: number, dT = 0, qnh = P0): Air {
  const h = Math.max(-500, hMsl);
  let Tstd: number, p: number;
  if (h < 11000) {
    Tstd = T0 - L * h;
    p = qnh * Math.pow(Tstd / T0, g / (L * Rg));
  } else {
    Tstd = 216.65;
    const p11 = qnh * Math.pow(216.65 / T0, g / (L * Rg));
    p = p11 * Math.exp((-g * (h - 11000)) / (Rg * 216.65));
  }
  const T = Tstd + dT;
  const rho = p / (Rg * T);
  const a = Math.sqrt(GAMMA * Rg * T);
  return { T, p, rho, a, sigma: rho / RHO0, delta: p / P0, theta: T / T0 };
}

/** Pressure altitude (m) from static pressure. */
export function pressureAltitude(p: number): number {
  if (p > 22632) return (T0 / L) * (1 - Math.pow(p / P0, (L * Rg) / g));
  return 11000 + (-Rg * 216.65 / g) * Math.log(p / 22632);
}

/** Indicated altitude for a given static pressure and altimeter setting (Pa). */
export function indicatedAltitude(p: number, setting: number): number {
  return (T0 / L) * (1 - Math.pow(p / setting, (L * Rg) / g));
}

/** Calibrated airspeed (m/s) from TAS (m/s) — compressible. */
export function tasToCas(tas: number, air: Air): number {
  const M = tas / air.a;
  const qc = air.p * (Math.pow(1 + 0.2 * M * M, 3.5) - 1);
  return A0 * Math.sqrt(5 * (Math.pow(qc / P0 + 1, 2 / 7) - 1));
}
export function casToTas(cas: number, air: Air): number {
  const qc = P0 * (Math.pow(1 + 0.2 * (cas / A0) ** 2, 3.5) - 1);
  const M = Math.sqrt(5 * (Math.pow(qc / air.p + 1, 2 / 7) - 1));
  return M * air.a;
}

export interface CloudLayer { base: number; top: number; cover: number } // metres MSL, cover 0..1 (oktas/8)

export interface WeatherState {
  windDir: number;      // deg true FROM at surface
  windSpd: number;      // kt at surface
  windAloftDir: number; // deg FROM at FL300
  windAloftSpd: number; // kt at FL300
  gust: number;         // kt
  turbulence: number;   // 0..1
  visibility: number;   // metres
  dT: number;           // ISA deviation K
  qnh: number;          // hPa
  clouds: CloudLayer[];
  precip: 0 | 1 | 2 | 3; // none, light, moderate, heavy
}

export const WEATHER_PRESETS: Record<string, { label: string; w: WeatherState }> = {
  clear: {
    label: 'CAVOK (맑음)',
    w: { windDir: 270, windSpd: 5, windAloftDir: 280, windAloftSpd: 45, gust: 0, turbulence: 0.05, visibility: 60000, dT: 0, qnh: 1013.25, clouds: [], precip: 0 },
  },
  few: {
    label: 'FEW/SCT 적운',
    w: { windDir: 240, windSpd: 10, windAloftDir: 260, windAloftSpd: 60, gust: 0, turbulence: 0.15, visibility: 30000, dT: 2, qnh: 1015,
      clouds: [{ base: 1200, top: 2100, cover: 0.3 }, { base: 7000, top: 7400, cover: 0.2 }], precip: 0 },
  },
  overcast: {
    label: 'OVC 흐림',
    w: { windDir: 200, windSpd: 14, windAloftDir: 240, windAloftSpd: 80, gust: 20, turbulence: 0.3, visibility: 8000, dT: -2, qnh: 1004,
      clouds: [{ base: 500, top: 2400, cover: 0.95 }], precip: 1 },
  },
  storm: {
    label: 'TSRA 뇌우/강우',
    w: { windDir: 180, windSpd: 22, windAloftDir: 230, windAloftSpd: 100, gust: 35, turbulence: 0.7, visibility: 2500, dT: -4, qnh: 996,
      clouds: [{ base: 300, top: 9000, cover: 1 }], precip: 3 },
  },
  lowvis: {
    label: 'CAT III 저시정 (FG)',
    w: { windDir: 90, windSpd: 3, windAloftDir: 260, windAloftSpd: 40, gust: 0, turbulence: 0.02, visibility: 250, dT: -1, qnh: 1022,
      clouds: [{ base: 30, top: 350, cover: 1 }], precip: 0 },
  },
  xwind: {
    label: '강한 측풍 훈련',
    w: { windDir: 0, windSpd: 28, windAloftDir: 300, windAloftSpd: 90, gust: 38, turbulence: 0.45, visibility: 20000, dT: 0, qnh: 1008,
      clouds: [{ base: 1500, top: 2000, cover: 0.4 }], precip: 0 },
  },
};

/** Deterministic smooth noise for turbulence. */
function noise1(t: number, seed: number) {
  return Math.sin(t * 1.3 + seed) * 0.5 + Math.sin(t * 2.9 + seed * 1.7) * 0.3 + Math.sin(t * 6.1 + seed * 2.3) * 0.2;
}

/** Wind vector in NED (m/s, direction the air moves TO) at altitude AGL/MSL. */
export function windAt(w: WeatherState, hMsl: number, agl: number, t: number): [number, number, number] {
  const k = clamp(hMsl / 9144, 0, 1);
  // boundary-layer log profile near the surface
  const bl = agl < 300 ? clamp(Math.log(Math.max(agl, 1) / 0.1) / Math.log(300 / 0.1), 0.35, 1) : 1;
  let dir = w.windDir + ((((w.windAloftDir - w.windDir) % 360) + 540) % 360 - 180) * k;
  let spd = (w.windSpd + (w.windAloftSpd - w.windSpd) * k) * (k < 0.05 ? bl : 1);
  if (w.gust > w.windSpd && agl < 1500) {
    const gf = Math.max(0, noise1(t * 0.25, 11));
    spd += (w.gust - w.windSpd) * gf * (1 - agl / 1500);
  }
  dir *= DEG;
  const v = spd * KT;
  const n = -Math.cos(dir) * v, e = -Math.sin(dir) * v;
  const turb = w.turbulence * (agl < 600 ? 1 : 0.6) * (1 + 0.4 * Math.min(1, spd / 30));
  const tn = noise1(t, 1) * turb * 3, te = noise1(t, 2) * turb * 3, td = noise1(t * 1.4, 3) * turb * 2.2 * clamp(agl / 30, 0, 1);
  return [n + tn, e + te, td];
}

/** Is altitude inside a cloud layer (for whiteout/icing). Returns density 0..1. */
export function inCloud(w: WeatherState, hMsl: number): number {
  let d = 0;
  for (const c of w.clouds) {
    if (hMsl > c.base && hMsl < c.top) d = Math.max(d, c.cover);
  }
  return d;
}

export const ftToM = (ft: number) => ft * FT;
