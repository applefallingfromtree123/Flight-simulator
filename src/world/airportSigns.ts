// Airport signage: red mandatory runway-holding signs (with the taxiway location sign beside them) at the
// holding points, black/yellow location signs and yellow direction signs before taxiway junctions, black
// runway distance-remaining boards every 1 000 ft along the runway edge, and windsocks by the thresholds.
// All faces share one canvas atlas, so the whole set is a single small glTF model.
import type { Airport, Runway } from './airports.ts';
import type { OsmWay, SceneryData } from './gates.ts';
import { canvasImage } from './liveryTex.ts';
import { Part, cyl, writeGlb, type NodeDef, type P3 } from './modelBuilder.ts';

type XY = [number, number];  // local metres: x north, y east
type Seg = { k: 'mand' | 'loc' | 'dir' | 'dist'; t: string };
export interface SignFrame { xy(p: { lat: number; lon: number }): XY; groundAt(r: XY[]): number }

const CW = 512, CH = 96, COLS = 2, ROWS = 20;
const FT = 0.3048;

/** Draws the sign panels into the atlas; one cell per distinct sign face. */
class Atlas {
  cv = document.createElement('canvas');
  g: CanvasRenderingContext2D;
  cells = new Map<string, { i: number; w: number }>();
  constructor() { this.cv.width = CW * COLS; this.cv.height = CH * ROWS; this.g = this.cv.getContext('2d')!; this.g.fillStyle = '#111'; this.g.fillRect(0, 0, this.cv.width, this.cv.height); }
  /** Returns the cell and the drawn width (px) of the face, or null when the atlas is full. */
  face(segs: Seg[]) {
    const key = segs.map(s => s.k + ':' + s.t).join('|');
    const have = this.cells.get(key);
    if (have) return have;
    if (this.cells.size >= COLS * ROWS) return null;
    const i = this.cells.size, g = this.g, x0 = (i % COLS) * CW, y0 = Math.floor(i / COLS) * CH;
    g.save();
    g.font = 'bold 66px "Arial Narrow", Arial, Helvetica, sans-serif';
    g.textBaseline = 'middle'; g.textAlign = 'center';
    let x = x0;
    for (const s of segs) {
      const txt = s.t, tw = Math.max(58, g.measureText(txt).width + 30);
      const w = Math.min(CW - (x - x0), tw);
      const bg = s.k === 'mand' ? '#c41e1e' : s.k === 'dir' ? '#f3c318' : '#141414';
      const fg = s.k === 'mand' ? '#ffffff' : s.k === 'dir' ? '#141414' : s.k === 'dist' ? '#ffffff' : '#f3c318';
      g.fillStyle = bg; g.fillRect(x, y0, w, CH);
      if (s.k === 'mand') { g.strokeStyle = '#ffffff'; g.lineWidth = 4; g.strokeRect(x + 6, y0 + 6, w - 12, CH - 12); }
      if (s.k === 'loc') { g.strokeStyle = '#f3c318'; g.lineWidth = 6; g.strokeRect(x + 7, y0 + 7, w - 14, CH - 14); }
      g.fillStyle = fg; g.fillText(txt, x + w / 2, y0 + CH / 2 + 3, w - 16);
      x += w;
    }
    g.restore();
    const c = { i, w: x - x0 };
    this.cells.set(key, c);
    return c;
  }
  uv(c: { i: number; w: number }, u: number, v: number): [number, number] {
    const x0 = (c.i % COLS) * CW, y0 = Math.floor(c.i / COLS) * CH;
    return [(x0 + u * c.w) / this.cv.width, (y0 + v * CH) / this.cv.height];
  }
}

const arrow = (rel: number) => {
  const a = ((rel % 360) + 540) % 360 - 180;    // -180..180, + = right
  return Math.abs(a) < 25 ? '↑' : Math.abs(a) > 155 ? '↓' : a > 0 ? (a < 70 ? '↗' : '→') : (a > -70 ? '↖' : '←');
};

export interface SignSet { glb: ArrayBuffer; socks: { node: string; pos: P3 }[]; count: number; spots: XY[] }

export async function buildSignsGlb(d: SceneryData, apt: Airport, f: SignFrame): Promise<SignSet | null> {
  const atlas = new Atlas();
  const face = new Part('#ffffff', 0, 0.6); face.tex = 0;
  const frame = new Part('#2e3134', 0.3, 0.6), leg = new Part('#8a8f94', 0.6, 0.4);
  const rws = apt.runways.filter(r => r.hard);
  const rwXY = rws.map(r => ({ r, a: f.xy(r.le), b: f.xy(r.he) }));
  const distRwy = (p: XY) => {
    let best = { d: Infinity, r: null as null | typeof rwXY[number] };
    for (const q of rwXY) {
      const dx = q.b[0] - q.a[0], dy = q.b[1] - q.a[1], l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - q.a[0]) * dx + (p[1] - q.a[1]) * dy) / l2));
      const dd = Math.hypot(p[0] - q.a[0] - dx * t, p[1] - q.a[1] - dy * t);
      if (dd < best.d) best = { d: dd, r: q };
    }
    return best;
  };
  const placed: XY[] = [];
  let count = 0;
  /** An oriented block (sign cabinet): centre c, along unit a (half length la), across unit n (half depth ln), z from zt..zb. */
  const obox = (part: Part, c: XY, a: XY, la: number, n: XY, ln: number, zb: number, zt: number) => {
    const P = (sa: number, sn: number, z: number): P3 => [c[0] + a[0] * sa * la + n[0] * sn * ln, c[1] + a[1] * sa * la + n[1] * sn * ln, z];
    const q = (x: P3, y: P3, z: P3, w: P3) => part.quad(x, y, z, w);
    q(P(-1, 1, zb), P(1, 1, zb), P(1, 1, zt), P(-1, 1, zt));
    q(P(1, -1, zb), P(-1, -1, zb), P(-1, -1, zt), P(1, -1, zt));
    q(P(1, 1, zb), P(1, -1, zb), P(1, -1, zt), P(1, 1, zt));
    q(P(-1, -1, zb), P(-1, 1, zb), P(-1, 1, zt), P(-1, -1, zt));
    q(P(-1, -1, zt), P(-1, 1, zt), P(1, 1, zt), P(1, -1, zt));
  };
  /**
   * One sign: centre at p (ground), its front looking along n (towards the pilot), panels for the front and
   * optionally a different back; panel H metres tall on two legs, 0.45 m off the ground.
   */
  const sign = (p: XY, n: XY, front: Seg[], back?: Seg[], H = 0.9, clear = 12) => {
    if (placed.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < 6)) return false;
    const rd = distRwy(p);
    if (rd.r && rd.d < rd.r.r.width / 2 + clear) return false;
    const cf = atlas.face(front), cb = back ? atlas.face(back) : null;
    if (!cf || (back && !cb)) return false;
    placed.push(p); count++;
    const ppm = CH / H;                                  // pixels per metre
    const W = Math.max(cf.w, cb?.w ?? 0) / ppm;
    const g = f.groundAt([p]), z0 = -(g + 0.45), z1 = z0 - H;   // P3 z is down
    const rt: XY = [n[1], -n[0]];                        // the reader's right (they look along -n)
    const depth = 0.18;
    const at = (s: number, off: number, z: number): P3 => [p[0] + rt[0] * s + n[0] * off, p[1] + rt[1] * s + n[1] * off, z];
    obox(frame, p, rt, W / 2 + 0.04, n, depth / 2, z0 + 0.04, z1 - 0.04);
    const panel = (c: { i: number; w: number }, side: 1 | -1) => {
      const w = c.w / ppm, s0 = -w / 2 * side, s1 = w / 2 * side, off = side * (depth / 2 + 0.02);
      const nn: P3 = [n[0] * side, n[1] * side, 0];
      const ia = face.vert(at(s0, off, z0), nn, atlas.uv(c, 0, 1)), ib = face.vert(at(s1, off, z0), nn, atlas.uv(c, 1, 1));
      const ic = face.vert(at(s1, off, z1), nn, atlas.uv(c, 1, 0)), id = face.vert(at(s0, off, z1), nn, atlas.uv(c, 0, 0));
      face.idx.push(ia, ib, ic, ia, ic, id);
    };
    panel(cf, 1);
    if (cb) panel(cb, -1);
    for (const s of [-W / 2 + 0.25, W / 2 - 0.25]) cyl(leg, at(s, 0, -g + 0.1), at(s, 0, z0), 0.045, 0.045, 6, false, false);
    return true;
  };

  // ── mandatory runway-holding signs at the holding points ──
  const named = d.taxiways.filter(w => w.tags.ref);
  const nearWay = (p: XY) => {
    let best: { d: number; dir: XY; w: OsmWay } | null = null;
    for (const w of d.taxiways) {
      const r = w.pts.map(q => f.xy(q));
      for (let i = 1; i < r.length; i++) {
        const a = r[i - 1], b = r[i], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1e-9;
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (l * l)));
        const dd = Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
        if (!best || dd < best.d) best = { d: dd, dir: [dx / l, dy / l], w };
      }
    }
    return best;
  };
  for (const hp of d.holds.slice(0, 40)) {
    const c = f.xy(hp), w = nearWay(c);
    if (!w || w.d > 25) continue;
    // which way along the taxiway is the runway?
    let h: XY = w.dir;
    const fwd = distRwy([c[0] + h[0] * 30, c[1] + h[1] * 30]).d, bwd = distRwy([c[0] - h[0] * 30, c[1] - h[1] * 30]).d;
    if (bwd < fwd) h = [-h[0], -h[1]];
    const rw = distRwy(c).r;
    if (!rw) continue;
    const L: XY = [h[1], -h[0]];                       // the pilot's left
    const u: XY = [rw.b[0] - rw.a[0], rw.b[1] - rw.a[1]];
    const leftIsLe = u[0] * L[0] + u[1] * L[1] > 0;    // turning left = rolling le → he (runway "le")
    const id = leftIsLe ? `${rw.r.le.ident}-${rw.r.he.ident}` : `${rw.r.he.ident}-${rw.r.le.ident}`;
    const ref = w.w.tags.ref;
    const segs: Seg[] = ref ? [{ k: 'loc', t: ref }, { k: 'mand', t: id }] : [{ k: 'mand', t: id }];
    const back: Seg[] = [{ k: 'mand', t: id }];
    const off = 18;
    // both sides of the taxiway, a couple of metres before the line, facing the aircraft
    sign([c[0] - h[0] * 3 + L[0] * off, c[1] - h[1] * 3 + L[1] * off], [-h[0], -h[1]], segs, back);
    sign([c[0] - h[0] * 3 - L[0] * off, c[1] - h[1] * 3 - L[1] * off], [-h[0], -h[1]], segs, back);
  }

  // ── location + direction signs before taxiway junctions ──
  const key = (p: XY) => `${Math.round(p[0] / 2)},${Math.round(p[1] / 2)}`;
  const nodes = new Map<string, { w: number; i: number }[]>();
  const rings = named.map(w => w.pts.map(q => f.xy(q)));
  rings.forEach((r, wi) => r.forEach((p, i) => { const k = key(p); const l = nodes.get(k) ?? []; l.push({ w: wi, i }); nodes.set(k, l); }));
  const brg = (a: XY, b: XY) => Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
  let junctions = 0;
  for (const list of nodes.values()) {
    if (junctions > 30) break;
    const refs = new Set(list.map(e => named[e.w].tags.ref));
    if (refs.size < 2) continue;
    junctions++;
    const J = rings[list[0].w][list[0].i];
    for (const e of list) {
      const r = rings[e.w], me = named[e.w].tags.ref;
      for (const dir of [-1, 1]) {
        const prev = r[e.i + dir];
        if (!prev) continue;
        // walk back 30 m from the junction along this way
        const l = Math.hypot(prev[0] - J[0], prev[1] - J[1]);
        if (l < 34) continue;
        const h: XY = [(J[0] - prev[0]) / l, (J[1] - prev[1]) / l];     // direction of travel towards J
        const L: XY = [h[1], -h[0]];
        const at: XY = [J[0] - h[0] * 30 + L[0] * 16, J[1] - h[1] * 30 + L[1] * 16];
        const hdg = Math.atan2(h[1], h[0]) * 180 / Math.PI;
        const others: { t: string; a: number }[] = [];
        for (const o of list) {
          const oref = named[o.w].tags.ref;
          if (oref === me) continue;
          const orr = rings[o.w];
          for (const od of [-1, 1]) { const q = orr[o.i + od]; if (q) others.push({ t: oref, a: brg(J, q) - hdg }); }
        }
        if (!others.length) continue;
        // left-to-right as the pilot sees them, the location sign in the middle
        const norm = (a: number) => ((a % 360) + 540) % 360 - 180;
        others.sort((x, y) => norm(x.a) - norm(y.a));
        const seen = new Set<string>();
        const segsL: Seg[] = [], segsR: Seg[] = [];
        for (const o of others) {
          const t = norm(o.a) < 0 ? `${arrow(o.a)}${o.t}` : `${o.t}${arrow(o.a)}`;
          if (seen.has(t)) continue; seen.add(t);
          (norm(o.a) < 0 ? segsL : segsR).push({ k: 'dir', t });
        }
        const segs = [...segsL, { k: 'loc' as const, t: me }, ...segsR].slice(0, 4);
        sign(at, [-h[0], -h[1]], segs);
      }
    }
  }

  // ── runway distance remaining (thousands of feet), left side of the runway, numbers for both directions ──
  for (const q of rwXY.slice(0, 4)) {
    const len = Math.hypot(q.b[0] - q.a[0], q.b[1] - q.a[1]);
    if (len < 1300) continue;
    const u: XY = [(q.b[0] - q.a[0]) / len, (q.b[1] - q.a[1]) / len], L: XY = [u[1], -u[0]];
    const off = q.r.width / 2 + 22;
    for (let k = 1; k * 1000 * FT < len - 50; k++) {
      const s = len - k * 1000 * FT;                      // from the le end; remaining towards he = k
      const p: XY = [q.a[0] + u[0] * s + L[0] * off, q.a[1] + u[1] * s + L[1] * off];
      const back = Math.round(s / (1000 * FT));
      sign(p, [-u[0], -u[1]], [{ k: 'dist', t: String(k) }], back >= 1 ? [{ k: 'dist', t: String(back) }] : undefined, 1.3, 8);
    }
  }

  // ── windsocks by both thresholds of the longest runway ──
  const socks: { node: string; pos: P3 }[] = [];
  const nodesOut: NodeDef[] = [];
  const longest = [...rwXY].sort((x, y) => y.r.length - x.r.length)[0];
  if (longest) {
    const len = longest.r.length, u: XY = [(longest.b[0] - longest.a[0]) / len, (longest.b[1] - longest.a[1]) / len], L: XY = [u[1], -u[0]];
    const pole = new Part('#e6e6e6', 0.4, 0.45), base = new Part('#bfc3c6', 0.1, 0.8);
    const ends: [XY, XY][] = [[longest.a, u], [longest.b, [-u[0], -u[1]]]];
    ends.forEach(([e, dir], k) => {
      const l: XY = k === 0 ? L : [-L[0], -L[1]];
      const p: XY = [e[0] + dir[0] * 280 + l[0] * (longest.r.width / 2 + 75), e[1] + dir[1] * 280 + l[1] * (longest.r.width / 2 + 75)];
      const g = f.groundAt([p]), top = -(g + 6.5);
      cyl(pole, [p[0], p[1], -g], [p[0], p[1], top - 0.3], 0.07, 0.05, 8, false, true);
      cyl(base, [p[0], p[1], -g + 0.05], [p[0], p[1], -g - 0.25], 2.2, 2.2, 16, false, true);
      // the sock: five bands, orange and white, along +x (rotated with the wind at run time)
      const parts = [new Part('#ff5a14', 0, 0.75), new Part('#f4f4f0', 0, 0.75)];
      const r0 = 0.45, r1 = 0.2, Ls = 3.6;
      for (let b = 0; b < 5; b++) {
        const xa = (b / 5) * Ls, xb = ((b + 1) / 5) * Ls;
        cyl(parts[b % 2], [xa, 0, 0], [xb, 0, 0], r0 + (r1 - r0) * b / 5, r0 + (r1 - r0) * (b + 1) / 5, 14, false, false);
      }
      const ring = new Part('#9a9ea2', 0.7, 0.35);
      cyl(ring, [-0.04, 0, 0], [0.04, 0, 0], r0 + 0.03, r0 + 0.03, 14, false, false);
      const name = `sock${k}`;
      const pos: P3 = [p[0], p[1], top];
      nodesOut.push({ name, parts: [...parts, ring], translation: pos });
      socks.push({ node: name, pos });
    });
    nodesOut.push({ name: 'sockPoles', parts: [pole, base] });
  }

  if (!face.idx.length && !socks.length) return null;
  const main: NodeDef = { name: 'signs', parts: [face, frame, leg].filter(p => p.idx.length) };
  const img = await canvasImage(atlas.cv, 'image/png');
  return { glb: writeGlb([main, ...nodesOut], [img]), socks, count, spots: [...placed, ...socks.map(s => [s.pos[0], s.pos[1]] as XY)] };
}

/** Rotation for a windsock node: it streams out downwind and droops in a light breeze. Returns yaw/pitch in rad. */
export function sockAngles(dirFrom: number, kt: number, t: number) {
  const to = (dirFrom + 180) * Math.PI / 180;
  const flutter = Math.sin(t * 2.7) * 0.05 + Math.sin(t * 6.1) * 0.025;
  const droop = Math.max(0, 1 - kt / 15) * 1.25;          // fully out at 15 kt
  return { yaw: -to + flutter * (1 + kt / 10), pitch: droop + Math.abs(flutter) * 0.5 };
}

export type { Runway };
