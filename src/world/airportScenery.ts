// Airport scenery built by SkyLine itself: terminal buildings with glass curtain walls, hangars and other airport
// buildings extruded from their OpenStreetMap footprints, a control tower, parked jet bridges at the contact
// stands, and crisp draped aprons, taxiways (yellow centre lines, holding points), stand lead-in lines and stop
// bars, landside roads and car parks. Airports OSM knows nothing about get a generated terminal, apron,
// taxiways, roads and tower laid out beside the longest runway (the same plan the generated stands use).
import * as Cesium from 'cesium';
import earcut from 'earcut';
import { DEG, R_EARTH, RAD } from '../core/math.ts';
import { distance, type LatLon } from '../core/geo.ts';
import type { Airport, AirportDB } from './airports.ts';
import type { ElevationService } from './terrain.ts';
import { airportLayout, airportScenery, genPlan, type AirportLayout, type OsmWay, type SceneryData, type Stand } from './gates.ts';
import { Part, box, cyl, writeGlb, type NodeDef, type P3 } from './modelBuilder.ts';

type XY = [number, number];  // local metres: x north, y east

interface Jetway { stand: Stand; rot: LatLon; node: string }

export class AirportScenery {
  enabled = true;
  /** Parts switched off after render errors. */
  off = { ground: false, model: false };
  disable(k: 'ground' | 'model') {
    this.off[k] = true;
    if (k === 'ground' && this.ground) this.ground.show = false;
    if (k === 'model' && this.model) this.model.show = false;
  }
  private icao = '';
  private gen = 0;
  private model: Cesium.Model | null = null;
  private ground: Cesium.PrimitiveCollection | null = null;
  private groundOffset = 0;
  private lastOffset = 0;
  private groundArgs: [SceneryData, AirportLayout, Frame, Airport] | null = null;
  private origin: { lat: number; lon: number; elev: number } | null = null;
  private offset = NaN;
  private jetways: Jetway[] = [];
  private hidden: LatLon | null = null;
  private night: boolean | null = null;
  private waiters = new Map<string, (() => void)[]>();
  private lastCheck = 0;
  /** Called with the scenery model (excluded when measuring the ground under the aircraft). */
  onModel: (m: Cesium.Model | null) => void = () => {};

  constructor(private scene: Cesium.Scene, private db: AirportDB, private elevation: ElevationService) {
    Cesium.GroundPrimitive.initializeTerrainHeights().catch(() => {});
  }

  /** Build the scenery of the nearest airport; keep the model on the (geoid-corrected) ground. */
  update(lat: number, lon: number, geoidOffset: number, night: boolean) {
    this.lastOffset = geoidOffset;
    // the paint volumes hug the ground: rebuild them if the sea-level/ellipsoid offset moved a lot (tiles on/off)
    if (this.groundArgs && Math.abs(geoidOffset - this.groundOffset) > 5) {
      try { this.buildGround(...this.groundArgs, geoidOffset); } catch (e) { console.warn('airport ground', e); }
    }
    const now = performance.now();
    if (now - this.lastCheck > 1500) {
      this.lastCheck = now;
      const near = this.enabled && this.db.ready ? this.db.nearest({ lat, lon }, 1, 9000)[0]?.apt : undefined;
      const want = near && near.runways.some(r => r.hard) ? near.icao : '';
      if (want !== this.icao) { this.icao = want; this.clear(); if (near && want) void this.build(near); }
    }
    if (this.model && this.origin && !(Math.abs(geoidOffset - this.offset) <= 0.05)) {
      this.offset = geoidOffset;
      this.placeModel();
    }
    if (this.model?.ready && night !== this.night) {
      this.night = night;
      const d = this.model.getNode('glass'), n = this.model.getNode('glassLit');
      if (d) d.show = !night;
      if (n) n.show = night;
    }
  }

  /** Resolves once the scenery of this airport is up (or after a timeout). */
  built(icao: string, timeoutMs = 25000): Promise<void> {
    if (this.icao === icao && this.model?.ready) return Promise.resolve();
    return new Promise(res => {
      const t = setTimeout(res, timeoutMs);
      const list = this.waiters.get(icao) ?? [];
      list.push(() => { clearTimeout(t); res(); });
      this.waiters.set(icao, list);
    });
  }

  /** The parked jet bridge serving a stand: where its rotunda is (the live one swings from there). */
  jetwayFor(stand: LatLon): LatLon | null {
    const j = this.jetways.filter(x => distance(x.stand, stand) < 30).sort((a, b) => distance(a.stand, stand) - distance(b.stand, stand))[0];
    return j?.rot ?? null;
  }
  /** Hide the parked jet bridge at the stand the player's own (animated) one is connected to. */
  hideJetway(stand: LatLon | null) {
    this.hidden = stand;
    this.applyHidden();
  }
  private applyHidden() {
    if (!this.model?.ready) return;
    for (const j of this.jetways) {
      const n = this.model.getNode(j.node);
      if (n) n.show = !(this.hidden && distance(j.stand, this.hidden) < 30);
    }
  }

  private clear() {
    this.gen++;
    if (this.model) { this.scene.primitives.remove(this.model); this.model = null; this.onModel(null); }
    if (this.ground) { this.scene.groundPrimitives.remove(this.ground); this.ground = null; }
    this.jetways = [];
    this.origin = null;
    this.groundArgs = null;
  }

  private placeModel() {
    if (!this.model || !this.origin) return;
    const o = this.origin;
    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromDegrees(o.lon, o.lat, o.elev + this.offset));
    // model frame (x north, y east, z down) authored like the aircraft: glTF fwd/left/up -> north/west/up
    const rot = Cesium.Matrix4.fromRotationTranslation(Cesium.Matrix3.fromArray([0, 1, 0, -1, 0, 0, 0, 0, 1]), Cesium.Cartesian3.ZERO);
    Cesium.Matrix4.multiply(enu, rot, this.model.modelMatrix);
  }

  private async build(apt: Airport) {
    const gen = this.gen;
    const [layout, osm] = await Promise.all([airportLayout(apt), airportScenery(apt)]);
    if (gen !== this.gen) return;
    const data = osm && (osm.buildings.length || osm.aprons.length || osm.taxiways.length) ? osm : generatedScenery(apt, layout);
    // terrain heights for the footprints
    const span = apt.size === 3 ? 0.03 : 0.015;
    await Promise.all([[0, 0], [span, span], [-span, span], [span, -span], [-span, -span]].map(([a, b]) => this.elevation.preload(apt.lat + a, apt.lon + b, 4000)));
    if (gen !== this.gen) return;
    this.origin = { lat: apt.lat, lon: apt.lon, elev: apt.elev };
    const frame = new Frame(apt, (lat, lon) => {
      const h = this.elevation.ground(lat, lon).h - apt.elev;
      return Number.isFinite(h) ? Math.max(-25, Math.min(25, h)) : 0;
    });
    try { this.buildGround(data, layout, frame, apt, this.lastOffset); } catch (e) { console.warn('airport ground', e); }
    try { await this.buildModel(data, layout, frame, apt, gen); } catch (e) { console.warn('airport buildings', e); }
    const w = this.waiters.get(apt.icao);
    this.waiters.delete(apt.icao);
    w?.forEach(f => f());
  }

  // ─────────── draped surfaces: aprons, taxiways, markings, roads, car parks ───────────
  private buildGround(d: SceneryData, layout: AirportLayout, f: Frame, apt: Airport, offset: number) {
    if (this.ground) { this.scene.groundPrimitives.remove(this.ground); this.ground = null; }
    this.groundOffset = offset;
    this.groundArgs = [d, layout, f, apt];
    const col = new Cesium.PrimitiveCollection();
    const C = (p: LatLon) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0);
    // tight classification volumes around the airport's own ground (ground primitives would span the terrain
    // height range of the whole region and show streaks around thin paint near mountains)
    const vol = (pts: LatLon[]) => {
      let lo = Infinity, hi = -Infinity;
      const step = Math.max(1, Math.floor(pts.length / 6));
      for (let i = 0; i < pts.length; i += step) { const h = f.gnd(pts[i].lat, pts[i].lon); lo = Math.min(lo, h); hi = Math.max(hi, h); }
      const base = apt.elev + offset;
      return { height: base + lo - 14, extrudedHeight: base + hi + 16 };
    };
    const polys = (rings: LatLon[][], color: string) => {
      const inst: Cesium.GeometryInstance[] = [];
      const c = Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.fromCssColorString(color));
      for (const r of rings) {
        const pts = dedupe(r);
        if (pts.length < 3) continue;
        const geometry = new Cesium.PolygonGeometry({ polygonHierarchy: new Cesium.PolygonHierarchy(pts.map(C)), ...vol(pts), granularity: Cesium.Math.RADIANS_PER_DEGREE / 100 });
        if (!safe(() => Cesium.PolygonGeometry.createGeometry(geometry))) continue;
        inst.push(new Cesium.GeometryInstance({ geometry, attributes: { color: c } }));
      }
      add(inst);
    };
    const lines = (ways: { pts: LatLon[]; w: number }[], color: string) => {
      const inst: Cesium.GeometryInstance[] = [];
      const c = Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.fromCssColorString(color));
      for (const wy of ways) {
        const pts = dedupe(wy.pts);
        if (pts.length < 2) continue;
        const geometry = new Cesium.CorridorGeometry({ positions: pts.map(C), width: wy.w, ...vol(pts), cornerType: Cesium.CornerType.ROUNDED, granularity: Cesium.Math.RADIANS_PER_DEGREE / 100 });
        if (!safe(() => Cesium.CorridorGeometry.createGeometry(geometry))) continue;
        inst.push(new Cesium.GeometryInstance({ geometry, attributes: { color: c } }));
      }
      add(inst);
    };
    const add = (inst: Cesium.GeometryInstance[]) => {
      if (!inst.length) return;
      col.add(new Cesium.ClassificationPrimitive({ geometryInstances: inst, appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: false }),
        classificationType: Cesium.ClassificationType.BOTH, asynchronous: false, allowPicking: false }));
    };
    const quads: LatLon[][] = [], white: LatLon[][] = [], red: LatLon[][] = [];
    // car parks and aprons first, then pavement, then paint
    polys(d.parking.filter(w => closed(w.pts)).map(w => w.pts), '#4a4d50');
    polys(d.aprons.filter(w => closed(w.pts)).map(w => w.pts), '#8f9290');
    const twW = (w: OsmWay) => {
      const v = parseFloat(w.tags.width ?? '');
      if (Number.isFinite(v) && v > 5 && v < 80) return v;
      return w.tags.aeroway === 'taxilane' ? 16 : apt.size === 3 ? 23 : apt.size === 2 ? 18 : 11;
    };
    lines(d.taxiways.map(w => ({ pts: w.pts, w: twW(w) })), '#3d4043');
    const roadW = (t: Record<string, string>) => {
      const lanes = parseInt(t.lanes ?? '', 10);
      if (lanes > 0 && lanes < 10) return lanes * 3.5 + 1;
      const k = t.highway.replace('_link', '');
      return k === 'motorway' ? 15 : k === 'trunk' ? 13 : k === 'primary' ? 11 : k === 'secondary' ? 9 : k === 'tertiary' ? 8 : k === 'service' ? (t.service ? 4.5 : 6) : 6.5;
    };
    const roads = d.roads.filter(w => !(w.tags.area === 'yes'));
    lines(roads.map(w => ({ pts: w.pts, w: roadW(w.tags) })), '#35373a');
    // taxiway centre lines (yellow) and road centre dashes (white)
    lines(d.taxiways.map(w => ({ pts: w.pts, w: 0.5 })), '#f0bf1e');
    for (const w of roads) {
      const rw = roadW(w.tags);
      if (rw < 8 || w.tags.oneway === 'yes') continue;
      dashes(f, w.pts, 3, 9, 0.18, white);
    }
    // stands: lead-in line and stop bar
    const stands = layout.stands;
    for (const s of stands) {
      const sx = f.xy(s), h = s.hdg * DEG, fw: XY = [Math.cos(h), Math.sin(h)], rt: XY = [-Math.sin(h), Math.cos(h)];
      const p = (a: number, b: number): XY => [sx[0] + fw[0] * a + rt[0] * b, sx[1] + fw[1] * a + rt[1] * b];
      quads.push(f.rect(p(-55, 0), p(19, 0), 0.25));
      quads.push(f.rect(p(19, -3.5), p(19, 3.5), 0.4));
      red.push(f.rect(p(23, -4), p(23, 4), 0.3));      // equipment limit line in front of the nose
    }
    // holding points: two solid and two dashed lines across the taxiway, solid side towards the taxiway
    for (const hp of d.holds) {
      const near = nearestSeg(f, d.taxiways, f.xy(hp));
      if (!near || near.d > 25) continue;
      const [dx, dy] = near.dir, nx = -dy, ny = dx, c = f.xy(hp), hw = 10;
      for (const [k, dashed] of [[-0.9, false], [-0.3, false], [0.3, true], [0.9, true]] as [number, boolean][]) {
        const o: XY = [c[0] + dx * k, c[1] + dy * k];
        if (!dashed) quads.push(f.rect([o[0] - nx * hw, o[1] - ny * hw], [o[0] + nx * hw, o[1] + ny * hw], 0.3));
        else for (let t = -hw; t < hw; t += 2.6) quads.push(f.rect([o[0] + nx * t, o[1] + ny * t], [o[0] + nx * (t + 1.4), o[1] + ny * (t + 1.4)], 0.3));
      }
    }
    polys(quads, '#f0bf1e');
    polys(white, '#e8e8e2');
    polys(red, '#c8302c');
    col.show = !this.off.ground;
    this.ground = this.scene.groundPrimitives.add(col);
    this.scene.groundPrimitives.lowerToBottom(col);  // runways (and their markings) stay on top
  }

  // ─────────── 3D: buildings, tower, parked jet bridges ───────────
  private async buildModel(d: SceneryData, layout: AirportLayout, f: Frame, apt: Airport, gen: number) {
    const glass = new Part('#6f8ea3', 0.75, 0.12), glassLit = new Part('#f3d9a6', 0.1, 0.6, 1, '#f0c890');
    const frame = new Part('#dde1e4', 0.3, 0.45), roof = new Part('#b5babe', 0.15, 0.75);
    const hWall = new Part('#d2d6d9', 0.45, 0.45), hDoor = new Part('#89929a', 0.6, 0.35), hRoof = new Part('#9ba2a8', 0.4, 0.5);
    const palette = ['#d6cfc1', '#c8c2b4', '#bcc1c6', '#e2dfd7', '#aaa59b', '#cfc9bf'].map(c => new Part(c, 0.05, 0.8));
    const gRoof = new Part('#7c8084', 0.1, 0.85), garage = new Part('#b9b9b3', 0.05, 0.85), gap = new Part('#2a2c2f', 0, 0.9);
    const bldNode: NodeDef = { name: 'bld', parts: [frame, roof, hWall, hDoor, hRoof, ...palette, gRoof, garage, gap] };
    const glassNode: NodeDef = { name: 'glass', parts: [glass] }, litNode: NodeDef = { name: 'glassLit', parts: [glassLit] };
    const terminals: XY[][] = [];
    let tris = 0;
    const budget = apt.size === 3 ? 400_000 : 150_000;
    // big buildings first so the triangle budget goes to what matters
    const blds = d.buildings.map(w => ({ w, ring: f.ring(w.pts) })).filter(b => b.ring.length >= 3)
      .map(b => ({ ...b, area: Math.abs(area(b.ring)) })).filter(b => b.area > 12).sort((a, b) => b.area - a.area).slice(0, 2500);
    for (const { w, ring, area: A } of blds) {
      const t = w.tags;
      const kind = t.aeroway === 'terminal' || /^(terminal|transportation|train_station|airport)$/.test(t.building ?? '') ? 'terminal'
        : t.aeroway === 'hangar' || t.building === 'hangar' ? 'hangar' : t.building === 'parking' || t.parking === 'multi-storey' ? 'garage' : 'other';
      let h = num(t.height);
      if (!Number.isFinite(h)) { const lv = num(t['building:levels']); if (Number.isFinite(lv)) h = lv * (kind === 'terminal' ? 5 : 3.4) + 1.5; }
      if (!Number.isFinite(h)) h = kind === 'terminal' ? (A > 30000 ? 24 : A > 8000 ? 18 : 12) : kind === 'hangar' ? (A > 8000 ? 26 : A > 2000 ? 17 : 9) : kind === 'garage' ? 14 : A > 3000 ? 12 : A > 400 ? 8 : 5;
      h = Math.max(3, Math.min(400, h));
      const g = f.groundAt(ring);
      const before = glass.idx.length + frame.idx.length + palette.reduce((s, p) => s + p.idx.length, 0) + hWall.idx.length + garage.idx.length;
      if (kind === 'terminal') {
        terminals.push(ring);
        prism(ring, g, h, { roof, bands: [[1.2, frame], [4.8, [glass, glassLit]]] });
        rooftop(ring, g + h, A, frame);
      } else if (kind === 'hangar') {
        prism(ring, g, h, { roof: hRoof, wall: hWall, door: hDoor });
      } else if (kind === 'garage') {
        prism(ring, g, h, { roof: gRoof, bands: [[1.1, garage], [2.1, gap]] });
      } else {
        const wall = palette[Math.abs(hash(w.pts[0].lat * 1e6 + w.pts[0].lon * 1e5)) % palette.length];
        prism(ring, g, h, { roof: gRoof, bands: [[1.6, wall], [1.8, [glass, glassLit]]], plain: A < 150 ? wall : undefined });
      }
      const after = glass.idx.length + frame.idx.length + palette.reduce((s, p) => s + p.idx.length, 0) + hWall.idx.length + garage.idx.length;
      tris += (after - before) / 3;
      if (tris > budget) break;
    }
    // control tower: mapped, else one beside the terminal at bigger airports
    const towers = d.towers.map(w => ({ c: centroid(f.ring(w.pts.length > 1 ? w.pts : [w.pts[0], w.pts[0], w.pts[0]])), h: num(w.tags.height) }));
    if (!towers.length && apt.size >= 2) {
      const p = generatedTowerAt(apt, f, terminals);
      if (p) towers.push({ c: p, h: NaN });
    }
    const towerNode: NodeDef = { name: 'tower', parts: [] };
    for (const t of towers.slice(0, 2)) {
      const h = Number.isFinite(t.h) ? Math.max(20, Math.min(140, t.h)) : apt.size === 3 ? 75 : 40;
      const g = f.groundAt([t.c]);
      const shaft = new Part('#d9dcdf', 0.2, 0.6), cab = new Part('#3f5a6c', 0.8, 0.1), cap = new Part('#e6e8ea', 0.3, 0.5), base = new Part('#c9ccd0', 0.1, 0.8);
      const at = (z: number): P3 => [t.c[0], t.c[1], -(g + z)];
      box(base, [t.c[0], t.c[1], -(g + 3)], [22, 22, 6 + 4]);
      cyl(shaft, at(0), at(h - 7), 4.5, 3.6, 16);
      cyl(cap, at(h - 7.5), at(h - 6.5), 7.5, 7.5, 12);
      cyl(cab, at(h - 6.5), at(h - 1.2), 7.2, 8, 12, false, false);
      cyl(cap, at(h - 1.2), at(h), 8.3, 6, 12);
      cyl(shaft, at(h), at(h + 4), 0.3, 0.1, 6);    // antenna mast
      towerNode.parts.push(shaft, cab, cap, base);
    }
    // parked jet bridges at contact stands next to a terminal
    const jwNodes: NodeDef[] = [];
    this.jetways = [];
    if (terminals.length) for (const s of layout.stands) {
      if (s.kind === 'remote') continue;
      const j = parkedJetway(f, s, terminals);
      if (!j) continue;
      const name = `jw${jwNodes.length}`;
      jwNodes.push({ name, parts: j.parts });
      this.jetways.push({ stand: s, rot: f.ll(j.rot), node: name });
      if (jwNodes.length >= 220) break;
    }
    const nodes = [bldNode, glassNode, litNode, towerNode, ...jwNodes].filter(n => n.parts.some(p => p.idx.length));
    if (!nodes.length) return;
    const url = URL.createObjectURL(new Blob([writeGlb(nodes)], { type: 'model/gltf-binary' }));
    const model = await Cesium.Model.fromGltfAsync({ url, shadows: Cesium.ShadowMode.ENABLED, backFaceCulling: false });
    if (gen !== this.gen) { model.destroy(); URL.revokeObjectURL(url); return; }
    model.show = !this.off.model;
    this.model = this.scene.primitives.add(model);
    this.offset = NaN;
    this.night = null;  // apply day/night on the next update
    model.readyEvent.addEventListener(() => { this.applyHidden(); URL.revokeObjectURL(url); });
    this.onModel(model);
  }
}

// ───────────────────────── geometry helpers ─────────────────────────
class Frame {
  private k: number;
  constructor(private o: Airport, readonly gnd: (lat: number, lon: number) => number) { this.k = Math.cos(o.lat * DEG); }
  xy(p: LatLon): XY { return [(p.lat - this.o.lat) * DEG * R_EARTH, (p.lon - this.o.lon) * DEG * R_EARTH * this.k]; }
  ll(p: XY): LatLon { return { lat: this.o.lat + (p[0] / R_EARTH) * RAD, lon: this.o.lon + (p[1] / (R_EARTH * this.k)) * RAD }; }
  /** Open ring (no repeated closing point), consecutive duplicates removed. */
  ring(pts: LatLon[]): XY[] {
    const r: XY[] = [];
    for (const p of pts) { const q = this.xy(p); const l = r[r.length - 1]; if (!l || Math.hypot(q[0] - l[0], q[1] - l[1]) > 0.3) r.push(q); }
    if (r.length > 2 && Math.hypot(r[0][0] - r[r.length - 1][0], r[0][1] - r[r.length - 1][1]) < 0.3) r.pop();
    return r;
  }
  /** Lowest ground under a footprint, relative to the airport elevation. */
  groundAt(ring: XY[]) {
    const step = Math.max(1, Math.floor(ring.length / 8));
    let m = Infinity;
    for (let i = 0; i < ring.length; i += step) { const p = this.ll(ring[i]); m = Math.min(m, this.gnd(p.lat, p.lon)); }
    return Number.isFinite(m) ? m : 0;
  }
  /** A thin rectangle (paint) from a to b, w metres wide, as a lat/lon ring. */
  rect(a: XY, b: XY, w: number): LatLon[] {
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    dx /= l; dy /= l;
    const nx = -dy * w / 2, ny = dx * w / 2;
    return [[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]].map(p => this.ll(p as XY));
  }
}

const num = (s?: string) => { const v = parseFloat(s ?? ''); return Number.isFinite(v) ? v : NaN; };
const hash = (v: number) => { let x = Math.floor(v) | 0; x = ((x >>> 16) ^ x) * 0x45d9f3b; x = ((x >>> 16) ^ x) * 0x45d9f3b; return (x >>> 16) ^ x; };
const safe = (fn: () => unknown) => { try { return !!fn(); } catch { return false; } };
const closed = (pts: LatLon[]) => pts.length > 3 && distance(pts[0], pts[pts.length - 1]) < 1;
function dedupe(pts: LatLon[]) {
  const out: LatLon[] = [];
  for (const p of pts) if (!out.length || distance(out[out.length - 1], p) > 0.4) out.push(p);
  if (out.length > 3 && distance(out[0], out[out.length - 1]) < 0.4) out.pop();
  return out;
}
function area(r: XY[]) { let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; }
function centroid(r: XY[]): XY { const n = r.length; return [r.reduce((s, p) => s + p[0], 0) / n, r.reduce((s, p) => s + p[1], 0) / n]; }
function inside(r: XY[], p: XY) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
function nearestOnRing(r: XY[], p: XY) {
  let best = { d: Infinity, pt: p as XY, n: [0, 0] as XY };
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
    const q: XY = [a[0] + dx * t, a[1] + dy * t];
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d < best.d) best = { d, pt: q, n: [(p[0] - q[0]) / (d || 1), (p[1] - q[1]) / (d || 1)] };
  }
  return best;
}
function nearestSeg(f: Frame, ways: OsmWay[], p: XY) {
  let best: { d: number; dir: XY } | null = null;
  for (const w of ways) {
    const r = w.pts.map(q => f.xy(q));
    for (let i = 1; i < r.length; i++) {
      const a = r[i - 1], b = r[i], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1e-9;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (l * l)));
      const d = Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
      if (!best || d < best.d) best = { d, dir: [dx / l, dy / l] };
    }
  }
  return best;
}
function dashes(f: Frame, pts: LatLon[], on: number, period: number, w: number, out: LatLon[][]) {
  const r = pts.map(p => f.xy(p));
  let carry = 0;
  for (let i = 1; i < r.length && out.length < 6000; i++) {
    const a = r[i - 1], b = r[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < 0.5) continue;
    const ux = (b[0] - a[0]) / l, uy = (b[1] - a[1]) / l;
    for (let s = carry; s < l; s += period) {
      const e = Math.min(l, s + on);
      if (e - s > 0.5) out.push(f.rect([a[0] + ux * s, a[1] + uy * s], [a[0] + ux * e, a[1] + uy * e], w));
    }
    carry = (period - ((l - carry) % period)) % period;
  }
}

type Band = [number, Part | [Part, Part]];
/**
 * Extrude a footprint: walls from 3 m below the lowest ground to the roof, either plain or in floor bands
 * (e.g. a frame strip then glass), a flat roof on top. Model frame z is down.
 */
function prism(ring: XY[], g: number, h: number, o: { roof: Part; wall?: Part; door?: Part; bands?: Band[]; plain?: Part }) {
  const zb = -(g - 3), zt = -(g + h);
  const P = (p: XY, z: number): P3 => [p[0], p[1], z];
  const put = (part: Part | [Part, Part], a: XY, b: XY, z0: number, z1: number) => {
    for (const pt of Array.isArray(part) ? part : [part]) pt.quad(P(a, z0), P(b, z0), P(b, z1), P(a, z1));
  };
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (o.plain || (!o.bands && o.wall)) {
      const wall = o.plain ?? o.wall!;
      if (o.door && len > 30) {
        // hangar: a big door panel in the middle of long walls
        const m = 0.12, d0: XY = [a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m], d1: XY = [a[0] + (b[0] - a[0]) * (1 - m), a[1] + (b[1] - a[1]) * (1 - m)];
        const dz = -(g + h * 0.78);
        put(wall, a, d0, zb, zt); put(wall, d1, b, zb, zt);
        put(o.door, d0, d1, zb, dz); put(wall, d0, d1, dz, zt);
      } else put(wall, a, b, zb, zt);
      continue;
    }
    if (!o.bands || len < 2.5) { put(o.bands?.[0][1] ?? o.roof, a, b, zb, zt); continue; }
    let z = zb, first = true;
    const top = zt + 1.2;  // parapet above the top floor
    while (z > top + 0.05) {
      for (const [bh, part] of o.bands) {
        if (z <= top + 0.05) break;
        const z1 = Math.max(top, z - bh - (first ? 3 : 0));  // the ground floor band starts below ground
        put(part, a, b, z, z1);
        z = z1; first = false;
      }
    }
    put(o.bands[0][1], a, b, top, zt);
  }
  // roof
  try {
    const idx = earcut(ring.flat());
    for (let i = 0; i < idx.length; i += 3) o.roof.tri(P(ring[idx[i]], zt), P(ring[idx[i + 1]], zt), P(ring[idx[i + 2]], zt));
  } catch { /* odd footprint: walls only */ }
}

/** Rooftop plant on big terminal roofs. */
function rooftop(ring: XY[], top: number, A: number, part: Part) {
  const n = Math.min(14, Math.floor(A / 6000));
  const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  let seed = Math.floor(A) % 9973;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed % 1000) / 1000; };
  for (let i = 0, tries = 0; i < n && tries < n * 6; tries++) {
    const p: XY = [x0 + (x1 - x0) * rnd(), y0 + (y1 - y0) * rnd()];
    const s = 6 + rnd() * 10;
    if (!inside(ring, p) || nearestOnRing(ring, p).d < s) continue;
    box(part, [p[0], p[1], -(top + 1.6)], [s, s * 0.7, 3.2]);
    i++;
  }
}

/**
 * A jet bridge parked next to the stand: rotunda by the terminal facade nearest the forward left door,
 * tunnel retracted a few metres short of where the door will be. Null when the stand isn't served from a terminal.
 */
function parkedJetway(f: Frame, s: Stand, terminals: XY[][]): { parts: Part[]; rot: XY } | null {
  const sx = f.xy(s), h = s.hdg * DEG, fw: XY = [Math.cos(h), Math.sin(h)], lf: XY = [Math.sin(h), -Math.cos(h)];
  const door: XY = [sx[0] + fw[0] * 14 + lf[0] * 2.5, sx[1] + fw[1] * 14 + lf[1] * 2.5];
  // the rotunda stands by the facade a little to the left of the door, so the tunnel angles in
  const aim: XY = [door[0] + lf[0] * 10, door[1] + lf[1] * 10];
  let best: ReturnType<typeof nearestOnRing> | null = null;
  for (const t of terminals) {
    const n = nearestOnRing(t, aim);
    if (inside(t, door)) return null;
    if (!best || n.d < best.d) best = n;
  }
  if (!best || best.d > 75 || best.d < 8) return null;
  const rot: XY = [best.pt[0] + best.n[0] * 4, best.pt[1] + best.n[1] * 4];
  if (Math.hypot(rot[0] - door[0], rot[1] - door[1]) < 10) return null;
  // must reach the door from the aircraft's left
  if ((rot[0] - sx[0]) * lf[0] + (rot[1] - sx[1]) * lf[1] < 3) return null;
  const g = f.groundAt([sx]);
  const toDoor: XY = [door[0] - rot[0], door[1] - rot[1]], L = Math.hypot(...toDoor);
  const u: XY = [toDoor[0] / L, toDoor[1] / L];
  const cabXY: XY = [door[0] - u[0] * 6, door[1] - u[1] * 6];
  const metal = new Part('#c9ced3', 0.5, 0.45), dark = new Part('#3a3f45', 0.3, 0.6), glassP = new Part('#1d2a35', 0.4, 0.2), yellow = new Part('#e8b923', 0.2, 0.5);
  const floor = g + 3.6, rz = g + 4.6;
  const cab: P3 = [cabXY[0], cabXY[1], -(floor + 1.35)];
  box(metal, cab, [3.0, 3.0, 2.8]);
  cyl(metal, [rot[0], rot[1], -rz], [cab[0] - u[0] * 1.5, cab[1] - u[1] * 1.5, cab[2]], 1.55, 1.55, 4);
  cyl(glassP, [rot[0] + u[0] * 0.2, rot[1] + u[1] * 0.2, -(rz + 0.2)], [cab[0] - u[0] * 1.6, cab[1] - u[1] * 1.6, cab[2] - 0.2], 1.25, 1.25, 4, false, false);
  cyl(metal, [rot[0], rot[1], -(rz - 1.6)], [rot[0], rot[1], -(rz + 1.6)], 2.4, 2.4, 14);
  cyl(dark, [rot[0], rot[1], -(rz - 1.6)], [rot[0], rot[1], -(g - 1)], 0.7, 0.7, 10);
  const m: P3 = [rot[0] + toDoor[0] * 0.62, rot[1] + toDoor[1] * 0.62, 0];
  cyl(dark, [m[0], m[1], -(floor - 0.5)], [m[0], m[1], -(g + 0.6)], 0.25, 0.25, 8);
  box(yellow, [m[0], m[1], -(g + 0.5)], [3.0, 1.2, 0.6]);
  return { parts: [metal, dark, glassP, yellow], rot };
}

function generatedTowerAt(apt: Airport, f: Frame, terminals: XY[][]): XY | null {
  const g = genPlan(apt);
  if (terminals.length) {
    // beside the biggest terminal, away from the runway
    const t = [...terminals].sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)))[0];
    const c = centroid(t);
    const xs = t.map(p => p[0]);
    return [Math.max(...xs) + 60, c[1]];
  }
  if (!g) return null;
  return f.xy(g.at(g.standOff + 160, ((g.nStands - 1) / 2) * g.pitch + 140));
}

/** Terminal, apron, taxiways, roads and car park for an airport without OpenStreetMap data. */
function generatedScenery(apt: Airport, layout: AirportLayout): SceneryData {
  const out: SceneryData = { buildings: [], aprons: [], taxiways: [], roads: [], parking: [], holds: [], towers: [] };
  const g = genPlan(apt);
  if (!g) return out;
  const half = ((g.nStands - 1) / 2) * g.pitch;
  const box4 = (o0: number, o1: number, a0: number, a1: number) => [g.at(o0, a0), g.at(o0, a1), g.at(o1, a1), g.at(o1, a0), g.at(o0, a0)];
  // apron from the taxilane to past the noses, the terminal behind it
  out.aprons.push({ pts: box4(g.laneOff - 30, g.standOff + (g.big ? 38 : 25), -half - 70, half + 70), tags: {} });
  const t0 = g.standOff + (g.big ? 38 : 25), depth = g.big ? (apt.size === 3 ? 55 : 40) : 18;
  out.buildings.push({ pts: box4(t0, t0 + depth, -half - 40, half + 40), tags: { aeroway: 'terminal', height: String(g.big ? (apt.size === 3 ? 22 : 16) : 7) } });
  if (g.big) out.buildings.push({ pts: box4(t0 + depth + 50, t0 + depth + 90, half + 120, half + 220), tags: { building: 'hangar' } });
  for (const tw of layout.taxiways) out.taxiways.push({ pts: tw.pts, tags: { aeroway: tw.ref.startsWith('B') ? 'taxilane' : 'taxiway', ref: tw.ref } });
  // hold short of the runway on each connector
  for (const tw of layout.taxiways.filter(t => /^A\d/.test(t.ref))) {
    const a = tw.pts[0], b = tw.pts[1], k = (g.W / 2 + 60) / Math.max(1, distance(a, b));
    out.holds.push({ lat: a.lat + (b.lat - a.lat) * k, lon: a.lon + (b.lon - a.lon) * k });
  }
  // kerbside road, car park and the access road out to the main road
  const rOff = t0 + depth + 18;
  out.roads.push({ pts: [g.at(rOff, -half - 120), g.at(rOff, half + 120)], tags: { highway: 'secondary' } });
  out.parking.push({ pts: box4(rOff + 14, rOff + 110, -half * 0.8 - 20, half * 0.8 + 20), tags: {} });
  out.roads.push({ pts: [g.at(rOff, -half - 120), g.at(rOff + 1500, -half - 120)], tags: { highway: 'primary' } });
  return out;
}
