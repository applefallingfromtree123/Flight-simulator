// Gates and stands of an airport from OpenStreetMap (Overpass API: aeroway=parking_position/gate, taxiways,
// terminals). The aircraft parks nose-in: heading from the nearest taxilane towards the stand. Without OSM data
// (offline, unmapped field) a row of remote stands is laid out beside the longest runway.
import { bearing, destination, distance, type LatLon } from '../core/geo.ts';
import type { Airport } from './airports.ts';

export interface Stand { ref: string; lat: number; lon: number; hdg: number; kind: 'gate' | 'stand' | 'remote' }
export interface Taxiway { ref: string; pts: LatLon[] }
export interface AirportLayout { stands: Stand[]; taxiways: Taxiway[]; source: 'osm' | 'generated' }

const cache = new Map<string, Promise<AirportLayout>>();

export function airportLayout(apt: Airport): Promise<AirportLayout> {
  let p = cache.get(apt.icao);
  if (!p) {
    p = fetchOsm(apt).catch(() => generated(apt));
    cache.set(apt.icao, p);
  }
  return p;
}

interface OsmEl { type: 'node' | 'way'; lat?: number; lon?: number; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] }

async function fetchOsm(apt: Airport): Promise<AirportLayout> {
  const dLat = 0.035, dLon = 0.035 / Math.cos(apt.lat * Math.PI / 180);
  const bb = `${(apt.lat - dLat).toFixed(4)},${(apt.lon - dLon).toFixed(4)},${(apt.lat + dLat).toFixed(4)},${(apt.lon + dLon).toFixed(4)}`;
  const q = `[out:json][timeout:20];(node["aeroway"~"^(parking_position|gate)$"](${bb});way["aeroway"="parking_position"](${bb});way["aeroway"~"^(taxiway|taxilane)$"](${bb});way["aeroway"="terminal"](${bb}););out geom;`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), signal: ctl.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    if (!r.ok) throw new Error(`overpass ${r.status}`);
    const j = await r.json() as { elements: OsmEl[] };
    const taxiways: Taxiway[] = [], terminals: LatLon[] = [];
    const raw: { ref: string; p: LatLon; dir?: number; kind: Stand['kind'] }[] = [];
    for (const e of j.elements) {
      const t = e.tags ?? {};
      if (e.type === 'way' && /taxi/.test(t.aeroway ?? '') && e.geometry?.length) taxiways.push({ ref: t.ref ?? '', pts: e.geometry });
      else if (e.type === 'way' && t.aeroway === 'terminal' && e.geometry?.length) {
        const g = e.geometry; terminals.push({ lat: g.reduce((s, x) => s + x.lat, 0) / g.length, lon: g.reduce((s, x) => s + x.lon, 0) / g.length });
      } else if (t.aeroway === 'parking_position' || t.aeroway === 'gate') {
        const ref = (t.ref ?? t.name ?? '').trim();
        if (e.type === 'node' && e.lat !== undefined && e.lon !== undefined) raw.push({ ref, p: { lat: e.lat, lon: e.lon }, kind: t.aeroway === 'gate' ? 'gate' : 'stand' });
        else if (e.geometry && e.geometry.length >= 2) {
          // stand lead-in line: the end farther from the taxilanes is where the nose stops
          const g = e.geometry, a = g[0], b = g[g.length - 1];
          const near = (x: LatLon) => nearestOn(taxiways, x)?.d ?? 0;
          const [from, to] = near(a) > near(b) ? [b, a] : [a, b];
          raw.push({ ref, p: to, dir: bearing(from, to), kind: 'stand' });
        }
      }
    }
    // parking positions win over gate nodes that duplicate them
    const stands: Stand[] = [];
    for (const s of raw.sort((x, y) => (x.kind === 'gate' ? 1 : 0) - (y.kind === 'gate' ? 1 : 0))) {
      if (stands.some(o => distance(o, s.p) < 25)) continue;
      let hdg = s.dir;
      if (hdg === undefined) {
        const tw = nearestOn(taxiways, s.p);
        if (tw && tw.d < 250) hdg = bearing(tw.pt, s.p);  // nose-in: from the taxilane towards the stand
        else {
          const term = terminals.map(t => ({ t, d: distance(t, s.p) })).sort((x, y) => x.d - y.d)[0];
          hdg = term ? bearing(s.p, term.t) : 0;
        }
      }
      stands.push({ ref: s.ref || `P${stands.length + 1}`, lat: s.p.lat, lon: s.p.lon, hdg: (hdg + 360) % 360, kind: s.kind });
    }
    if (!stands.length) throw new Error('no stands mapped');
    stands.sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }));
    return { stands, taxiways, source: 'osm' };
  } finally { clearTimeout(timer); }
}

function nearestOn(ways: Taxiway[], p: LatLon) {
  let best: { pt: LatLon; d: number; ref: string } | null = null;
  for (const w of ways) for (let i = 1; i < w.pts.length; i++) {
    const a = w.pts[i - 1], b = w.pts[i];
    // project in a local flat frame
    const k = Math.cos(p.lat * Math.PI / 180);
    const ax = (a.lon - p.lon) * k, ay = a.lat - p.lat, bx = (b.lon - p.lon) * k, by = b.lat - p.lat;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-12;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2));
    const pt = { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
    const d = distance(p, pt);
    if (!best || d < best.d) best = { pt, d, ref: w.ref };
  }
  return best;
}

/** Taxiway names between two points (nearest named taxiways along the way), for ATC taxi instructions. */
export function taxiRoute(layout: AirportLayout, from: LatLon, to: LatLon): string[] {
  const named = layout.taxiways.filter(t => t.ref && /^[A-Z]{1,2}\d{0,2}$/.test(t.ref));
  if (!named.length) return [];
  const out: string[] = [];
  for (let i = 0; i <= 4; i++) {
    const f = i / 4;
    const p = { lat: from.lat + (to.lat - from.lat) * f, lon: from.lon + (to.lon - from.lon) * f };
    const n = nearestOn(named, p);
    if (n && n.d < 400 && out[out.length - 1] !== n.ref) out.push(n.ref);
  }
  return out.slice(0, 4);
}

function generated(apt: Airport): AirportLayout {
  const rw = [...apt.runways].sort((a, b) => b.length - a.length)[0];
  if (!rw) return { stands: [{ ref: 'A1', lat: apt.lat, lon: apt.lon, hdg: 0, kind: 'remote' }], taxiways: [], source: 'generated' };
  const mid = { lat: (rw.le.lat + rw.he.lat) / 2, lon: (rw.le.lon + rw.he.lon) / 2 };
  const side = (rw.le.hdg + 90) % 360;
  const base = destination(mid, side, 260 + rw.width);
  const stands: Stand[] = [];
  for (let i = 0; i < 8; i++) {
    const p = destination(base, rw.le.hdg, (i - 3.5) * 85);
    stands.push({ ref: `R${i + 1}`, lat: p.lat, lon: p.lon, hdg: side, kind: 'remote' });
  }
  return { stands, taxiways: [], source: 'generated' };
}
