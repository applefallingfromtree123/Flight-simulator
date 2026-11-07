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

/** Frame of a generated airport: along the longest runway, the terminal side to its right. */
export function genPlan(apt: Airport) {
  const rw = [...apt.runways].sort((a, b) => b.length - a.length)[0];
  if (!rw) return null;
  const mid = { lat: (rw.le.lat + rw.he.lat) / 2, lon: (rw.le.lon + rw.he.lon) / 2 };
  const side = (rw.le.hdg + 90) % 360, along = rw.le.hdg;
  const W = Math.max(18, rw.width), L = rw.length;
  const big = apt.size >= 2;
  const nStands = apt.size === 3 ? 10 : apt.size === 2 ? 6 : 4;
  const pitch = big ? 80 : 45;
  const standOff = W / 2 + (big ? 330 : 200);       // stand centres from the runway centreline
  const twyOff = W / 2 + (big ? 170 : 110);         // parallel taxiway
  const laneOff = standOff - (big ? 55 : 32);       // apron taxilane behind the tails
  const at = (off: number, a: number) => destination(destination(mid, side, off), along, a);
  return { rw, mid, side, along, W, L, big, nStands, pitch, standOff, twyOff, laneOff, at };
}

function generated(apt: Airport): AirportLayout {
  const g = genPlan(apt);
  if (!g) return { stands: [{ ref: 'A1', lat: apt.lat, lon: apt.lon, hdg: 0, kind: 'remote' }], taxiways: [], source: 'generated' };
  const stands: Stand[] = [];
  for (let i = 0; i < g.nStands; i++) {
    const p = g.at(g.standOff, (i - (g.nStands - 1) / 2) * g.pitch);
    stands.push({ ref: `${g.big ? '' : 'R'}${i + 1}`, lat: p.lat, lon: p.lon, hdg: g.side, kind: g.big ? 'gate' : 'remote' });
  }
  // parallel taxiway, connectors at both ends and the middle, and the apron taxilane
  const half = g.L / 2 - 60, span = ((g.nStands - 1) / 2) * g.pitch + 60;
  const taxiways: Taxiway[] = [
    { ref: 'A', pts: [g.at(g.twyOff, -half), g.at(g.twyOff, half)] },
    { ref: 'A1', pts: [g.at(0, -half), g.at(g.twyOff, -half)] },
    { ref: 'A2', pts: [g.at(0, 0), g.at(g.twyOff, 0)] },
    { ref: 'A3', pts: [g.at(0, half), g.at(g.twyOff, half)] },
    { ref: 'B', pts: [g.at(g.laneOff, -span), g.at(g.laneOff, span)] },
    { ref: 'B1', pts: [g.at(g.twyOff, -span), g.at(g.laneOff, -span)] },
    { ref: 'B2', pts: [g.at(g.twyOff, span), g.at(g.laneOff, span)] },
  ];
  return { stands, taxiways, source: 'generated' };
}

// ───────────── airport scenery (buildings, aprons, taxiways, roads) from OpenStreetMap ─────────────
export interface OsmWay { pts: LatLon[]; tags: Record<string, string> }
export interface SceneryData { buildings: OsmWay[]; aprons: OsmWay[]; taxiways: OsmWay[]; roads: OsmWay[]; parking: OsmWay[]; holds: LatLon[]; towers: OsmWay[];
  /** Woods and forests, tree rows and single trees (for the 3D trees). */
  forests?: OsmWay[]; treeRows?: OsmWay[]; trees?: LatLon[] }

const sceneryCache = new Map<string, Promise<SceneryData | null>>();
/** Buildings, aprons, taxiways and roads of the airport (null when OpenStreetMap can't be reached). */
export function airportScenery(apt: Airport): Promise<SceneryData | null> {
  let p = sceneryCache.get(apt.icao);
  if (!p) { p = fetchScenery(apt).catch(() => null); sceneryCache.set(apt.icao, p); }
  return p;
}

async function fetchScenery(apt: Airport): Promise<SceneryData> {
  const d = apt.size === 3 ? 0.045 : 0.03, dLat = d, dLon = d / Math.cos(apt.lat * Math.PI / 180);
  const bb = `${(apt.lat - dLat).toFixed(4)},${(apt.lon - dLon).toFixed(4)},${(apt.lat + dLat).toFixed(4)},${(apt.lon + dLon).toFixed(4)}`;
  const roads = 'motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|service';
  const q = `[out:json][timeout:25];(way["aeroway"="aerodrome"](${bb});relation["aeroway"="aerodrome"](${bb}););map_to_area->.ar;(` +
    `node["aeroway"~"^(holding_position|control_tower)$"](${bb});way["aeroway"~"^(taxiway|taxilane|apron|terminal|hangar|control_tower)$"](${bb});` +
    `way["building"](area.ar);way["highway"~"^(${roads})$"](area.ar);way["amenity"="parking"](area.ar);node["man_made"="tower"]["tower:type"="observation"](area.ar);` +
    `way["landuse"="forest"](${bb});way["natural"="wood"](${bb});way["natural"="tree_row"](${bb});node["natural"="tree"](${bb}););out geom;`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 30000);
  try {
    const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), signal: ctl.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    if (!r.ok) throw new Error(`overpass ${r.status}`);
    const j = await r.json() as { elements: OsmEl[] };
    const out: SceneryData = { buildings: [], aprons: [], taxiways: [], roads: [], parking: [], holds: [], towers: [], forests: [], treeRows: [], trees: [] };
    const seen = new Set<string>();
    for (const e of j.elements as (OsmEl & { id?: number })[]) {
      const t = e.tags ?? {};
      const key = `${e.type}${e.id ?? Math.random()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (e.type === 'node') {
        if (e.lat === undefined || e.lon === undefined) continue;
        if (t.aeroway === 'holding_position') out.holds.push({ lat: e.lat, lon: e.lon });
        else if (t.natural === 'tree') out.trees!.push({ lat: e.lat, lon: e.lon });
        else out.towers.push({ pts: [{ lat: e.lat, lon: e.lon }], tags: t });
        continue;
      }
      const g = e.geometry?.filter(Boolean);
      if (!g || g.length < 2) continue;
      const w: OsmWay = { pts: g, tags: t };
      if (t.landuse === 'forest' || t.natural === 'wood') { out.forests!.push(w); continue; }
      if (t.natural === 'tree_row') { out.treeRows!.push(w); continue; }
      if (t.aeroway === 'taxiway' || t.aeroway === 'taxilane') out.taxiways.push(w);
      else if (t.aeroway === 'apron') out.aprons.push(w);
      else if (t.aeroway === 'control_tower') out.towers.push(w);
      else if (t.highway) out.roads.push(w);
      else if (t.amenity === 'parking' && !t.building) out.parking.push(w);
      else if (t.building || t.aeroway === 'terminal' || t.aeroway === 'hangar') {
        if (t.building === 'roof' && !t.aeroway) continue;
        if (/tower/.test(t['man_made'] ?? '') || t['tower:type'] === 'observation' || t.building === 'control_tower') out.towers.push(w);
        else out.buildings.push(w);
      }
    }
    return out;
  } finally { clearTimeout(timer); }
}
