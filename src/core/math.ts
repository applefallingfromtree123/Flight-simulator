// Minimal allocation-light 3D math used by the flight-dynamics engine.
// Frames: body = FRD (x fwd, y right, z down); navigation = local NED.

export type V3 = [number, number, number];
export type Q = [number, number, number, number]; // w, x, y, z  (rotates body -> NED)

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
export const G0 = 9.80665;
export const KT = 0.514444;      // m/s per knot
export const FT = 0.3048;        // m per foot
export const NM = 1852;          // m per nautical mile
export const FPM = FT / 60;      // m/s per ft/min
export const LB = 0.45359237;    // kg per lb
export const R_EARTH = 6371008.8;

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const wrap360 = (a: number) => ((a % 360) + 360) % 360;
export const wrap180 = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;
export const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** First-order lag toward target with time constant tau. */
export const approach = (cur: number, target: number, tau: number, dt: number) =>
  tau <= 0 ? target : cur + (target - cur) * (1 - Math.exp(-dt / tau));
/** Rate-limited move toward target. */
export const moveToward = (cur: number, target: number, maxStep: number) =>
  Math.abs(target - cur) <= maxStep ? target : cur + Math.sign(target - cur) * maxStep;

export const v3 = (x = 0, y = 0, z = 0): V3 => [x, y, z];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);

export function qNormalize(q: Q): Q {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}
export function qMul(a: Q, b: Q): Q {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}
/** Rotate vector v by q (body -> NED). */
export function qRot(q: Q, v: V3): V3 {
  const [w, x, y, z] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
}
/** Inverse rotation (NED -> body). */
export function qRotInv(q: Q, v: V3): V3 {
  return qRot([q[0], -q[1], -q[2], -q[3]], v);
}
/** Aerospace 3-2-1 Euler (yaw psi, pitch theta, roll phi) to quaternion. */
export function qFromEuler(psi: number, theta: number, phi: number): Q {
  const cy = Math.cos(psi / 2), sy = Math.sin(psi / 2);
  const cp = Math.cos(theta / 2), sp = Math.sin(theta / 2);
  const cr = Math.cos(phi / 2), sr = Math.sin(phi / 2);
  return [
    cr * cp * cy + sr * sp * sy,
    sr * cp * cy - cr * sp * sy,
    cr * sp * cy + sr * cp * sy,
    cr * cp * sy - sr * sp * cy,
  ];
}
/** Quaternion -> [psi, theta, phi]. */
export function qToEuler(q: Q): V3 {
  const [w, x, y, z] = q;
  const phi = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
  const theta = Math.asin(clamp(2 * (w * y - z * x), -1, 1));
  const psi = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  return [psi, theta, phi];
}
/** Integrate body rates (p,q,r) over dt. */
export function qIntegrate(q: Q, w: V3, dt: number): Q {
  const wn = len(w);
  if (wn < 1e-9) return q;
  const a = (wn * dt) / 2;
  const s = Math.sin(a) / wn;
  return qNormalize(qMul(q, [Math.cos(a), w[0] * s, w[1] * s, w[2] * s]));
}

/** Simple PID with anti-windup and derivative on measurement. */
export class PID {
  i = 0;
  private prev = NaN;
  constructor(public kp: number, public ki: number, public kd: number, public iLim = 1, public outLim = 1) {}
  reset() { this.i = 0; this.prev = NaN; }
  update(err: number, meas: number, dt: number): number {
    const d = Number.isNaN(this.prev) || dt <= 0 ? 0 : -(meas - this.prev) / dt;
    this.prev = meas;
    const out0 = this.kp * err + this.i + this.kd * d;
    // conditional integration (don't wind up while saturated in the same direction)
    if (!(Math.abs(out0) >= this.outLim && Math.sign(out0) === Math.sign(err))) {
      this.i = clamp(this.i + this.ki * err * dt, -this.iLim, this.iLim);
    }
    return clamp(this.kp * err + this.i + this.kd * d, -this.outLim, this.outLim);
  }
}

/** Piecewise-linear table lookup. xs ascending. */
export function interp(xs: number[], ys: number[], x: number): number {
  if (x <= xs[0]) return ys[0];
  const n = xs.length - 1;
  if (x >= xs[n]) return ys[n];
  let i = 1;
  while (xs[i] < x) i++;
  const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
  return ys[i - 1] + (ys[i] - ys[i - 1]) * t;
}
