// 3D runway surfaces with ICAO markings (threshold piano keys, designators, centreline,
// touchdown-zone and aiming-point marks, edge lines), built from the airport database.
// Geometry is assembled directly on the main thread (no geometry web workers) so it is safe on iOS Safari.
import * as Cesium from 'cesium';
import { DEG, R_EARTH, RAD } from '../core/math.ts';
import { distance } from '../core/geo.ts';
import type { AirportDB, Runway } from './airports.ts';

type Quad = [number, number][]; // 4 corners in runway frame (x along runway from LE, y right), metres

// 7-segment glyphs (segments a..g) + a few letters, drawn in a 3 x 9 m cell
const SEG: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg',
  L: 'fed', C: 'afed', R: 'efabg', // R gets an extra diagonal leg below
};

export class RunwayRenderer {
  private prim: Cesium.Primitive | null = null;
  private builtAt: { lat: number; lon: number } | null = null;
  offset = 0; // geoid offset (photoreal tiles)

  constructor(private scene: Cesium.Scene, private db: AirportDB) {}

  update(lat: number, lon: number, force = false) {
    if (!this.db.ready) return;
    if (!force && this.builtAt && distance(this.builtAt, { lat, lon }) < 8000) return;
    this.builtAt = { lat, lon };
    const rws: Runway[] = [];
    for (const { apt } of this.db.nearest({ lat, lon }, 12, 45000)) for (const rw of apt.runways) if (rw.hard) rws.push(rw);
    this.build(rws);
  }

  private build(rws: Runway[]) {
    const asphalt: number[] = [], paint: number[] = [];
    for (const rw of rws) this.runway(rw, asphalt, paint);
    if (this.prim) { this.scene.primitives.remove(this.prim); this.prim = null; }
    const instances: Cesium.GeometryInstance[] = [];
    const mk = (pos: number[], color: string, id: string) => {
      if (!pos.length) return;
      const n = pos.length / 3;
      const positions = new Float64Array(pos);
      const normals = new Float32Array(pos.length);
      const tmp = new Cesium.Cartesian3();
      for (let i = 0; i < n; i++) {
        Cesium.Cartesian3.fromElements(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2], tmp);
        const nn = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(tmp, tmp);
        normals[i * 3] = nn.x; normals[i * 3 + 1] = nn.y; normals[i * 3 + 2] = nn.z;
      }
      const indices = new Uint32Array(n);
      for (let i = 0; i < n; i++) indices[i] = i;
      const geometry = new Cesium.Geometry({
        attributes: {
          position: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: positions as unknown as number[] }),
          normal: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 3, values: normals as unknown as number[] }),
        } as unknown as Cesium.GeometryAttributes,
        indices,
        primitiveType: Cesium.PrimitiveType.TRIANGLES,
        boundingSphere: Cesium.BoundingSphere.fromVertices(Array.from(positions)),
      });
      instances.push(new Cesium.GeometryInstance({ geometry, id, attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.fromCssColorString(color)) } }));
    };
    mk(asphalt, '#3f4245', 'rwy-asphalt');
    mk(paint, '#e9ebe6', 'rwy-paint');
    if (!instances.length) return;
    this.prim = this.scene.primitives.add(new Cesium.Primitive({
      geometryInstances: instances,
      appearance: new Cesium.PerInstanceColorAppearance({ flat: false, translucent: false, closed: false }),
      asynchronous: false, compressVertices: false, allowPicking: false,
      shadows: Cesium.ShadowMode.RECEIVE_ONLY,
    }));
  }

  /** Emit triangles for one runway. */
  private runway(rw: Runway, asphalt: number[], paint: number[]) {
    const a = rw.le, b = rw.he;
    const L = distance(a, b);
    if (L < 200) return;
    const W = Math.max(18, rw.width);
    const hdg = a.hdg * DEG;
    const cosLat = Math.cos(a.lat * DEG);
    const toWorld = (x: number, y: number, dz: number) => {
      const north = x * Math.cos(hdg) - y * Math.sin(hdg);
      const east = x * Math.sin(hdg) + y * Math.cos(hdg);
      const lat = a.lat + (north / R_EARTH) * RAD;
      const lon = a.lon + (east / (R_EARTH * cosLat)) * RAD;
      const h = a.elev + (b.elev - a.elev) * Math.min(1, Math.max(0, x / L)) + dz + this.offset;
      return Cesium.Cartesian3.fromDegrees(lon, lat, h);
    };
    const push = (out: number[], q: Quad, dz: number) => {
      const p = q.map(([x, y]) => toWorld(x, y, dz));
      for (const i of [0, 1, 2, 0, 2, 3]) out.push(p[i].x, p[i].y, p[i].z);
    };
    const rect = (out: number[], x0: number, x1: number, y0: number, y1: number, dz: number) => {
      // subdivide long quads so they follow the (slightly curved / sloped) surface
      const n = Math.max(1, Math.ceil(Math.abs(x1 - x0) / 250));
      for (let i = 0; i < n; i++) {
        const xa = x0 + ((x1 - x0) * i) / n, xb = x0 + ((x1 - x0) * (i + 1)) / n;
        push(out, [[xa, y0], [xb, y0], [xb, y1], [xa, y1]], dz);
      }
    };
    const P = 0.34, S = 0.22; // paint / surface heights above the graded terrain
    rect(asphalt, -30, L + 30, -W / 2 - 3, W / 2 + 3, S);
    // markings for both directions, built in the frame of each landing end
    for (const end of [0, 1] as const) {
      const X = (x: number) => (end === 0 ? x : L - x);
      const Y = (y: number) => (end === 0 ? y : -y);
      const r = (x0: number, x1: number, y0: number, y1: number) => rect(paint, X(x0), X(x1), Y(y0), Y(y1), P);
      const thr = (end === 0 ? a.disp : b.disp) || 0;
      // threshold piano keys
      const nKeys = W >= 60 ? 16 : W >= 45 ? 12 : W >= 30 ? 8 : W >= 23 ? 6 : 4;
      const kw = 1.8, gap = (W - 6 - nKeys * kw) / (nKeys - 1 + 2);
      let y = -W / 2 + 3 + gap;
      for (let k = 0; k < nKeys; k++) {
        if (k === nKeys / 2) y += gap * 1.5;
        r(thr + 6, thr + 36, y, y + kw);
        y += kw + gap;
      }
      // designator (e.g. "34L") — 9 m tall digits, reading from the approach
      const ident = (end === 0 ? a.ident : b.ident).replace(/^0/, '').toUpperCase();
      const chars = ident.split('').filter(c => SEG[c]);
      const digits = chars.filter(c => /\d/.test(c)), letter = chars.find(c => /[LCR]/.test(c));
      const drawGlyph = (c: string, x0: number, yc: number) => {
        const w = 3.2, h = 9, t = 0.9; // glyph cell: x is along runway (height of glyph), y is across (width)
        const segs = SEG[c];
        const segRect: Record<string, [number, number, number, number]> = {
          a: [x0 + h - t, x0 + h, yc - w / 2, yc + w / 2], g: [x0 + h / 2 - t / 2, x0 + h / 2 + t / 2, yc - w / 2, yc + w / 2], d: [x0, x0 + t, yc - w / 2, yc + w / 2],
          f: [x0 + h / 2, x0 + h, yc - w / 2, yc - w / 2 + t], b: [x0 + h / 2, x0 + h, yc + w / 2 - t, yc + w / 2],
          e: [x0, x0 + h / 2, yc - w / 2, yc - w / 2 + t], c: [x0, x0 + h / 2, yc + w / 2 - t, yc + w / 2],
        };
        for (const sgm of segs) { const [p, q, s, u] = segRect[sgm]; r(p, q, s, u); }
        if (c === 'R') r(x0, x0 + h / 2, yc + w / 2 - t - 0.6, yc + w / 2 - 0.6);
      };
      let x0 = thr + 48;
      if (letter) { drawGlyph(letter, x0, 0); x0 += 12; }
      const dw = 4.4;
      digits.forEach((c, i) => drawGlyph(c, x0, (i - (digits.length - 1) / 2) * dw));
      // aiming point & touchdown zone
      if (L > 1200) {
        const ap = L > 2400 ? 400 : 300;
        const off = W > 40 ? 9 : 6;
        for (const s of [-1, 1]) r(thr + ap, thr + ap + 45, s * off - 3, s * off + 3);
      }
      if (L > 2400 && W >= 30) {
        const tdz: [number, number][] = [[150, 3], [450, 2], [600, 2], [750, 1], [900, 1]];
        for (const [d, n] of tdz) for (const s of [-1, 1]) for (let k = 0; k < n; k++) {
          const yy = s * (W > 40 ? 9 : 6) + s * (k * 3.3 - 1);
          r(thr + d, thr + d + 22.5, yy - 0.9, yy + 0.9);
        }
      }
    }
    // centreline (between designators)
    const start = 48 + 12 + 20, stop = L - start;
    for (let x = start; x + 36 < stop; x += 60) rect(paint, x, x + 36, -0.45, 0.45, P);
    // edge lines
    if (W >= 30) { rect(paint, 0, L, -W / 2 + 0.2, -W / 2 + 1.1, P); rect(paint, 0, L, W / 2 - 1.1, W / 2 - 0.2, P); }
  }
}
