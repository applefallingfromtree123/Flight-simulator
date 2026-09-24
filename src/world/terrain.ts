// Real-world elevation streaming (AWS Terrain Tiles / Terrarium, public dataset) with runway grading.
// The same height function feeds both physics (ground contact) and the rendered terrain mesh,
// so aircraft wheels sit exactly on the runway you see.
import { DEG, RAD, clamp } from '../core/math.ts';
import { runwayInfluence, type AirportDB, type Runway } from './airports.ts';

const URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const MAX_Z = 14;

interface Tile { data: Float32Array | null; promise: Promise<Float32Array | null>; used: number }

export class ElevationService {
  private tiles = new Map<string, Tile>();
  private tick = 0;
  private canvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
  private lastPhys = 0;
  inflight = 0;

  constructor(public db: AirportDB) {}

  private key(z: number, x: number, y: number) { return `${z}/${x}/${y}`; }

  private decode(img: ImageBitmap): Float32Array {
    if (!this.canvas) {
      this.canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(256, 256) : Object.assign(document.createElement('canvas'), { width: 256, height: 256 });
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    }
    const ctx = this.ctx!;
    ctx.clearRect(0, 0, 256, 256);
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, 256, 256).data;
    const out = new Float32Array(256 * 256);
    for (let i = 0, j = 0; i < out.length; i++, j += 4) {
      let h = px[j] * 256 + px[j + 1] + px[j + 2] / 256 - 32768;
      if (h < -12) h = -9999; // ocean marker (keep below-sea-level polders)
      out[i] = h;
    }
    return out;
  }

  tile(z: number, x: number, y: number): Tile {
    const n = 1 << z;
    x = ((x % n) + n) % n;
    y = clamp(y, 0, n - 1);
    const k = this.key(z, x, y);
    let t = this.tiles.get(k);
    if (t) { t.used = ++this.tick; return t; }
    const tile: Tile = { data: null, used: ++this.tick, promise: Promise.resolve(null) };
    this.inflight++;
    tile.promise = fetch(URL.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)))
      .then(r => (r.ok ? r.blob() : Promise.reject(r.status)))
      .then(b => createImageBitmap(b))
      .then(img => { tile.data = this.decode(img); img.close(); return tile.data; })
      .catch(() => { tile.data = new Float32Array(256 * 256); return tile.data; })
      .finally(() => { this.inflight--; });
    this.tiles.set(k, tile);
    this.evict();
    return tile;
  }
  private evict() {
    if (this.tiles.size < 420) return;
    const arr = [...this.tiles.entries()].sort((a, b) => a[1].used - b[1].used);
    for (let i = 0; i < 80; i++) this.tiles.delete(arr[i][0]);
  }

  static tileXY(lat: number, lon: number, z: number): [number, number, number, number] {
    const n = 1 << z;
    const x = ((lon + 180) / 360) * n;
    const la = clamp(lat, -85.05, 85.05) * DEG;
    const y = ((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * n;
    return [Math.floor(x), Math.floor(y), (x - Math.floor(x)) * 256, (y - Math.floor(y)) * 256];
  }

  private sampleTile(data: Float32Array, fx: number, fy: number): { h: number; water: boolean } {
    const x0 = clamp(Math.floor(fx - 0.5), 0, 255), y0 = clamp(Math.floor(fy - 0.5), 0, 255);
    const x1 = Math.min(x0 + 1, 255), y1 = Math.min(y0 + 1, 255);
    const tx = clamp(fx - 0.5 - x0, 0, 1), ty = clamp(fy - 0.5 - y0, 0, 1);
    const a = data[y0 * 256 + x0], b = data[y0 * 256 + x1], c = data[y1 * 256 + x0], d = data[y1 * 256 + x1];
    const water = (a < -9000 ? 1 : 0) + (b < -9000 ? 1 : 0) + (c < -9000 ? 1 : 0) + (d < -9000 ? 1 : 0) >= 2;
    const f = (v: number) => (v < -9000 ? 0 : v);
    const h = (f(a) * (1 - tx) + f(b) * tx) * (1 - ty) + (f(c) * (1 - tx) + f(d) * tx) * ty;
    return { h, water };
  }

  /** Raw terrain height from cached tiles (best available zoom). */
  rawSync(lat: number, lon: number, zPref = 13): { h: number; water: boolean } | undefined {
    for (let z = zPref; z >= 6; z--) {
      const [x, y, fx, fy] = ElevationService.tileXY(lat, lon, z);
      const t = this.tiles.get(this.key(z, x, y));
      if (t?.data) {
        if (z < zPref && performance.now() - this.lastPhys > 200) { this.tile(zPref, ...ElevationService.tileXY(lat, lon, zPref).slice(0, 2) as [number, number]); this.lastPhys = performance.now(); }
        return this.sampleTile(t.data, fx, fy);
      }
    }
    const [x, y] = ElevationService.tileXY(lat, lon, zPref);
    this.tile(zPref, x, y);
    return undefined;
  }

  /** Final ground height including runway grading. */
  graded(lat: number, lon: number, raw: number, rws: Runway[]): { h: number; runway: boolean } {
    let best = 0, bh = raw, on = false;
    for (const rw of rws) {
      const r = runwayInfluence(rw, lat, lon);
      if (r.w > best) { best = r.w; bh = r.h; }
      if (r.on) on = true;
    }
    return { h: raw + (bh - raw) * best, runway: on };
  }

  private lastGood = { h: 0, water: false, runway: false };
  /** Physics ground query (synchronous). */
  ground(lat: number, lon: number): { h: number; water: boolean; runway: boolean } {
    const raw = this.rawSync(lat, lon, 13);
    const rws = this.db.ready ? this.db.runwaysNear(lat, lon, 1) : [];
    if (!raw) {
      // no tile yet: trust nearby runway elevation, else last known
      const g = this.graded(lat, lon, this.lastGood.h, rws);
      return { h: g.h, water: false, runway: g.runway };
    }
    const g = this.graded(lat, lon, raw.h, rws);
    this.lastGood = { h: g.h, water: raw.water && !g.runway, runway: g.runway };
    return this.lastGood;
  }

  /** Preload the tiles around a point (used before spawning). */
  async preload(lat: number, lon: number) {
    const ps: Promise<unknown>[] = [];
    for (const z of [10, 13]) {
      const [x, y] = ElevationService.tileXY(lat, lon, z);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) ps.push(this.tile(z, x + dx, y + dy).promise);
    }
    await Promise.race([Promise.all(ps), new Promise(r => setTimeout(r, 8000))]);
  }

  /** Height grid for a geographic rectangle (for the rendered terrain mesh). */
  async heightGrid(west: number, south: number, east: number, north: number, level: number, w: number, h: number): Promise<Float32Array> {
    const z = clamp(level + 1, 1, MAX_Z);
    const [x0, y0] = ElevationService.tileXY(north, west, z);
    const [x1, y1] = ElevationService.tileXY(south, east - 1e-9, z);
    const need: Promise<unknown>[] = [];
    const lookup = new Map<string, Float32Array | null>();
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const t = this.tile(z, x, y);
      need.push(t.promise.then(d => lookup.set(`${x}/${y}`, d)));
    }
    await Promise.all(need);
    const rws = this.db.ready && level >= 8 ? this.db.runwaysNear((north + south) / 2, (east + west) / 2, Math.max(1, (east - west) * 0.6)) : [];
    const out = new Float32Array(w * h);
    for (let j = 0; j < h; j++) {
      const lat = north - ((north - south) * j) / (h - 1);
      for (let i = 0; i < w; i++) {
        const lon = west + ((east - west) * i) / (w - 1);
        const [tx, ty, fx, fy] = ElevationService.tileXY(lat, lon, z);
        const d = lookup.get(`${tx}/${ty}`);
        let hh = 0;
        if (d) hh = this.sampleTile(d, fx, fy).h;
        if (rws.length) hh = this.graded(lat, lon, hh, rws).h;
        out[j * w + i] = hh;
      }
    }
    return out;
  }
}

export { RAD };
