// Airport / runway / navaid database (OurAirports, public domain) with spatial index.
import { DEG, FT, R_EARTH, clamp } from '../core/math.ts';
import { bearing, destination, distance, type LatLon } from '../core/geo.ts';
import type { Approach, Waypoint } from '../sim/fcs.ts';

export interface RunwayEnd { ident: string; lat: number; lon: number; elev: number; disp: number; hdg: number }
export interface Runway { le: RunwayEnd; he: RunwayEnd; length: number; width: number; hard: boolean; lighted: boolean; apt: Airport }
export interface Airport {
  icao: string; name: string; lat: number; lon: number; elev: number; size: 1 | 2 | 3;
  country: string; city: string; iata: string; runways: Runway[];
}
export interface Navaid { ident: string; name: string; type: string; freq: number; lat: number; lon: number; elev: number; magVar: number }

const NAV_TYPES = ['', 'VOR', 'VOR-DME', 'VORTAC', 'TACAN', 'NDB', 'NDB-DME', 'DME'];

type RawRwy = [string, number, number, number | null, number, string, number, number, number | null, number, number, number, number, number];
type RawApt = [string, string, number, number, number, 1 | 2 | 3, string, string, string, RawRwy[]];
type RawNav = [string, string, number, number, number, number, number, number];

class Grid<T> {
  private cells = new Map<number, T[]>();
  private key(lat: number, lon: number) { return (Math.floor(lat + 90) * 360) + Math.floor(lon + 180); }
  add(lat: number, lon: number, v: T) {
    const k = this.key(lat, lon);
    let c = this.cells.get(k);
    if (!c) this.cells.set(k, (c = []));
    c.push(v);
  }
  near(lat: number, lon: number, rDeg = 1): T[] {
    const out: T[] = [];
    const r = Math.ceil(rDeg);
    for (let a = -r; a <= r; a++) for (let o = -r; o <= r; o++) {
      const c = this.cells.get(this.key(lat + a, ((lon + o + 540) % 360) - 180));
      if (c) for (const v of c) out.push(v);
    }
    return out;
  }
}

export class AirportDB {
  airports: Airport[] = [];
  byIcao = new Map<string, Airport>();
  navaids: Navaid[] = [];
  private aptGrid = new Grid<Airport>();
  private rwyGrid = new Grid<Runway>();
  private navGrid = new Grid<Navaid>();
  ready = false;

  async load(base = './data/') {
    const [apts, navs] = await Promise.all([
      fetch(base + 'airports.json').then(r => r.json() as Promise<RawApt[]>),
      fetch(base + 'navaids.json').then(r => r.json() as Promise<RawNav[]>),
    ]);
    this.ingest(apts, navs);
  }

  ingest(apts: RawApt[], navs: RawNav[]) {
    for (const r of apts) {
      const apt: Airport = { icao: r[0], name: r[1], lat: r[2], lon: r[3], elev: r[4] * FT, size: r[5], country: r[6], city: r[7], iata: r[8], runways: [] };
      for (const w of r[9]) {
        const le: RunwayEnd = { ident: w[0], lat: w[1], lon: w[2], elev: (w[3] ?? r[4]) * FT, disp: w[4] * FT, hdg: 0 };
        const he: RunwayEnd = { ident: w[5], lat: w[6], lon: w[7], elev: (w[8] ?? r[4]) * FT, disp: w[9] * FT, hdg: 0 };
        le.hdg = bearing(le, he); he.hdg = bearing(he, le);
        const rw: Runway = { le, he, length: w[10] * FT, width: w[11] * FT, hard: !!w[12], lighted: !!w[13], apt };
        apt.runways.push(rw);
        this.rwyGrid.add((le.lat + he.lat) / 2, (le.lon + he.lon) / 2, rw);
      }
      this.airports.push(apt);
      this.byIcao.set(apt.icao, apt);
      if (apt.iata && !this.byIcao.has(apt.iata)) this.byIcao.set(apt.iata, apt);
      this.aptGrid.add(apt.lat, apt.lon, apt);
    }
    for (const n of navs) {
      const nav: Navaid = { ident: n[0], name: n[1], type: NAV_TYPES[n[2]], freq: n[3], lat: n[4], lon: n[5], elev: n[6] * FT, magVar: n[7] };
      this.navaids.push(nav);
      this.navGrid.add(nav.lat, nav.lon, nav);
    }
    this.ready = true;
  }

  get(code: string): Airport | undefined { return this.byIcao.get(code.trim().toUpperCase()); }

  search(q: string, limit = 12): Airport[] {
    const s = q.trim().toUpperCase();
    if (!s) return [];
    const exact = this.get(s);
    const out: Airport[] = exact ? [exact] : [];
    for (const a of this.airports) {
      if (out.length >= limit) break;
      if (a === exact) continue;
      if (a.icao.startsWith(s) || a.iata === s || a.name.toUpperCase().includes(s) || a.city.toUpperCase().includes(s)) out.push(a);
    }
    return out;
  }

  nearest(p: LatLon, n = 10, rangeM = 200000, minSize = 1): { apt: Airport; d: number }[] {
    const cand = this.aptGrid.near(p.lat, p.lon, clamp(rangeM / 111000, 1, 4));
    return cand.filter(a => a.size >= minSize).map(apt => ({ apt, d: distance(p, apt) })).filter(x => x.d <= rangeM).sort((a, b) => a.d - b.d).slice(0, n);
  }
  runwaysNear(lat: number, lon: number, rDeg = 1): Runway[] { return this.rwyGrid.near(lat, lon, rDeg); }
  navaidsNear(p: LatLon, rangeM: number): Navaid[] {
    return this.navGrid.near(p.lat, p.lon, clamp(rangeM / 111000, 1, 5)).filter(n => distance(p, n) < rangeM);
  }
  findNavaid(ident: string, near?: LatLon): Navaid | undefined {
    const c = this.navaids.filter(n => n.ident === ident.toUpperCase());
    if (!c.length) return undefined;
    if (!near) return c[0];
    return c.sort((a, b) => distance(near, a) - distance(near, b))[0];
  }
  findByFreq(freqKhz: number, near: LatLon): Navaid | undefined {
    return this.navaidsNear(near, 300000).filter(n => Math.abs(n.freq - freqKhz) < 1).sort((a, b) => distance(near, a) - distance(near, b))[0];
  }

  /** Resolve a route token (airport ICAO, navaid ident, or lat/lon "N37.5E126.9"). */
  resolve(tok: string, near: LatLon): Waypoint | undefined {
    const t = tok.trim().toUpperCase();
    if (!t) return undefined;
    const ll = t.match(/^([NS])(\d+(?:\.\d+)?)([EW])(\d+(?:\.\d+)?)$/);
    if (ll) return { ident: t.slice(0, 7), lat: (ll[1] === 'S' ? -1 : 1) * +ll[2], lon: (ll[3] === 'W' ? -1 : 1) * +ll[4], kind: 'user' };
    if (t.length === 4 || (t.length === 3 && !this.findNavaid(t, near))) {
      const a = this.get(t);
      if (a) return { ident: a.icao, lat: a.lat, lon: a.lon, kind: 'apt' };
    }
    const n = this.findNavaid(t, near);
    if (n) return { ident: n.ident, lat: n.lat, lon: n.lon, kind: n.type.startsWith('NDB') ? 'ndb' : 'vor' };
    const a = this.get(t);
    if (a) return { ident: a.icao, lat: a.lat, lon: a.lon, kind: 'apt' };
    return undefined;
  }
}

export function runwayEnds(apt: Airport): { rw: Runway; end: RunwayEnd; opp: RunwayEnd }[] {
  const out: { rw: Runway; end: RunwayEnd; opp: RunwayEnd }[] = [];
  for (const rw of apt.runways) {
    out.push({ rw, end: rw.le, opp: rw.he });
    out.push({ rw, end: rw.he, opp: rw.le });
  }
  return out;
}

/** Build an ILS approach for the given landing runway end. */
export function makeApproach(apt: Airport, rw: Runway, end: RunwayEnd): Approach {
  const opp = end === rw.le ? rw.he : rw.le;
  const thr = end.disp > 0 ? destination(end, end.hdg, end.disp) : { lat: end.lat, lon: end.lon };
  return {
    airport: apt.icao, runway: end.ident, thr, elev: end.elev, crs: end.hdg, gs: 3,
    locAnt: destination(opp, end.hdg, 300), gsAnt: destination(thr, end.hdg, 300), lengthM: rw.length,
  };
}

/** Line-up position at the start of a runway (on the centreline, 40 m past the threshold). */
export function lineUp(end: RunwayEnd): { lat: number; lon: number; hdg: number; elev: number } {
  const p = destination(end, end.hdg, 40 + end.disp * 0);
  return { lat: p.lat, lon: p.lon, hdg: end.hdg, elev: end.elev };
}

/** Runway influence for terrain flattening. Returns weight 0..1 and target elevation. */
export function runwayInfluence(rw: Runway, lat: number, lon: number): { w: number; h: number; on: boolean } {
  const a = rw.le, b = rw.he;
  const cosL = Math.cos(a.lat * DEG);
  const bx = (b.lon - a.lon) * DEG * R_EARTH * cosL, by = (b.lat - a.lat) * DEG * R_EARTH;
  const px = (lon - a.lon) * DEG * R_EARTH * cosL, py = (lat - a.lat) * DEG * R_EARTH;
  const L2 = bx * bx + by * by;
  if (L2 < 1) return { w: 0, h: 0, on: false };
  const Lm = Math.sqrt(L2);
  const t = (px * bx + py * by) / L2;
  const along = t * Lm;
  const lat2 = Math.abs(px * by - py * bx) / Lm;
  const half = rw.width / 2;
  const endOver = along < 0 ? -along : along > Lm ? along - Lm : 0;
  const shoulder = half + 90;
  if (lat2 > shoulder + 260 || endOver > 400) return { w: 0, h: 0, on: false };
  const wl = 1 - smooth(shoulder, shoulder + 260, lat2);
  const we = 1 - smooth(120, 400, endOver);
  const tc = clamp(t, 0, 1);
  return { w: wl * we, h: a.elev + (b.elev - a.elev) * tc, on: lat2 <= half + 3 && endOver < 1 };
}
function smooth(e0: number, e1: number, x: number) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
