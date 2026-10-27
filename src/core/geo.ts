import { DEG, R_EARTH, RAD, wrap360 } from './math.ts';

export interface LatLon { lat: number; lon: number } // degrees

export function distance(a: LatLon, b: LatLon): number {
  const p1 = a.lat * DEG, p2 = b.lat * DEG;
  const dp = p2 - p1, dl = (b.lon - a.lon) * DEG;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}
/** Initial great-circle bearing (deg true). */
export function bearing(a: LatLon, b: LatLon): number {
  const p1 = a.lat * DEG, p2 = b.lat * DEG, dl = (b.lon - a.lon) * DEG;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return wrap360(Math.atan2(y, x) * RAD);
}
export function destination(a: LatLon, brgDeg: number, dist: number): LatLon {
  const d = dist / R_EARTH, t = brgDeg * DEG, p1 = a.lat * DEG, l1 = a.lon * DEG;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
  const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 * RAD, lon: ((l2 * RAD + 540) % 360) - 180 };
}
/** Signed cross-track distance (m) of p from great circle a->b (positive = right of course). */
export function crossTrack(a: LatLon, b: LatLon, p: LatLon): number {
  const d13 = distance(a, p) / R_EARTH;
  const t13 = bearing(a, p) * DEG, t12 = bearing(a, b) * DEG;
  return Math.asin(Math.sin(d13) * Math.sin(t13 - t12)) * R_EARTH;
}
/** Along-track distance from a toward b of p's projection. */
export function alongTrack(a: LatLon, b: LatLon, p: LatLon): number {
  const d13 = distance(a, p) / R_EARTH;
  const xt = crossTrack(a, b, p) / R_EARTH;
  const at = Math.acos(Math.min(1, Math.cos(d13) / Math.max(1e-12, Math.cos(xt)))) * R_EARTH;
  const t13 = bearing(a, p) * DEG, t12 = bearing(a, b) * DEG;
  return Math.cos(t13 - t12) >= 0 ? at : -at;
}
/** Local flat offset (north, east metres) of b relative to a. */
export function localNE(a: LatLon, b: LatLon): [number, number] {
  return [(b.lat - a.lat) * DEG * R_EARTH, (b.lon - a.lon) * DEG * R_EARTH * Math.cos(a.lat * DEG)];
}
export function offsetNE(a: LatLon, n: number, e: number): LatLon {
  return { lat: a.lat + (n / R_EARTH) * RAD, lon: a.lon + (e / (R_EARTH * Math.cos(a.lat * DEG))) * RAD };
}

/**
 * Magnetic variation (deg, east positive). Low-order dipole approximation of WGM —
 * adequate (a few degrees) for heading references when no navaid declination is known.
 */
export function magVar(lat: number, lon: number): number {
  // geomagnetic north pole ~ 80.8N, 72.8W (2025)
  const pLat = 80.8 * DEG, pLon = -72.8 * DEG;
  const la = lat * DEG, lo = lon * DEG;
  const y = Math.sin(pLon - lo) * Math.cos(pLat);
  const x = Math.cos(la) * Math.sin(pLat) - Math.sin(la) * Math.cos(pLat) * Math.cos(pLon - lo);
  let v = Math.atan2(y, x) * RAD;
  if (v > 180) v -= 360;
  return v;
}

export function fmtLat(lat: number) {
  const a = Math.abs(lat), d = Math.floor(a), m = (a - d) * 60;
  return `${lat >= 0 ? 'N' : 'S'}${String(d).padStart(2, '0')}°${m.toFixed(2).padStart(5, '0')}`;
}
export function fmtLon(lon: number) {
  const a = Math.abs(lon), d = Math.floor(a), m = (a - d) * 60;
  return `${lon >= 0 ? 'E' : 'W'}${String(d).padStart(3, '0')}°${m.toFixed(2).padStart(5, '0')}`;
}
