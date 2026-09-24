// Procedural aircraft 3D model generator. Builds a binary glTF (GLB) from the aircraft's real
// geometry (length, span, wing area, sweep, dihedral, tail layout, engine layout, gear).
// Authoring frame: body FRD (x fwd, y right, z down), converted to glTF (Y up, Z forward, X left).
import { DEG, clamp } from '../core/math.ts';
import type { AeroModel } from '../sim/aero.ts';
import type { AircraftDef } from '../sim/types.ts';

type P3 = [number, number, number];

class Part {
  pos: number[] = []; nrm: number[] = []; idx: number[] = [];
  constructor(public color: string, public metal = 0.2, public rough = 0.55, public alpha = 1, public emissive?: string) {}
  vert(p: P3, n: P3) {
    this.pos.push(-p[1], -p[2], p[0]);
    this.nrm.push(-n[1], -n[2], n[0]);
    return this.pos.length / 3 - 1;
  }
  tri(a: P3, b: P3, c: P3) {
    const u = sub(b, a), v = sub(c, a);
    const n = norm(cross(u, v));
    const i = this.vert(a, n), j = this.vert(b, n), k = this.vert(c, n);
    this.idx.push(i, j, k);
  }
  quad(a: P3, b: P3, c: P3, d: P3) { this.tri(a, b, c); this.tri(a, c, d); }
}
const sub = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: P3, b: P3): P3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: P3): P3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

interface Section { x: number; z: number; ry: number; rz: number }

/** Smooth lofted body of elliptic sections along x. */
function loft(part: Part, secs: Section[], seg = 24, a0 = 0, a1 = Math.PI * 2, grow = 0) {
  const rings: { p: P3; n: P3 }[][] = [];
  for (const s of secs) {
    const ring: { p: P3; n: P3 }[] = [];
    for (let i = 0; i <= seg; i++) {
      const a = a0 + ((a1 - a0) * i) / seg;
      const cy = Math.sin(a), cz = -Math.cos(a);
      const ry = s.ry + grow, rz = s.rz + grow;
      ring.push({ p: [s.x, cy * ry, s.z + cz * rz], n: norm([0, cy / Math.max(ry, 1e-3), cz / Math.max(rz, 1e-3)]) });
    }
    rings.push(ring);
  }
  for (let r = 0; r < rings.length - 1; r++) {
    const A = rings[r], B = rings[r + 1];
    const slope = (secs[r].ry - secs[r + 1].ry) / Math.max(0.01, secs[r].x - secs[r + 1].x);
    for (let i = 0; i < seg; i++) {
      const idx = [A[i], A[i + 1], B[i + 1], B[i]].map(v => part.vert(v.p, norm([v.n[0] + slope * 0.5 * Math.sign(secs[r].x), v.n[1], v.n[2]])));
      part.idx.push(idx[0], idx[2], idx[1], idx[0], idx[3], idx[2]);
    }
  }
}

/** Closed tapered panel (wing / stabiliser / fin) with a hexagonal aerofoil section. */
function panel(part: Part, root: { le: P3; c: number; t: number }, tip: { le: P3; c: number; t: number }, vertical = false) {
  const sec = (s: { le: P3; c: number; t: number }): P3[] => {
    const pts: [number, number][] = [[0, 0], [-0.25, 0.5], [-0.7, 0.35], [-1, 0], [-0.7, -0.25], [-0.25, -0.35]];
    return pts.map(([u, v]) => {
      const x = s.le[0] + u * s.c;
      const th = v * s.t * s.c;
      return vertical ? [x, s.le[1] + th, s.le[2]] as P3 : [x, s.le[1], s.le[2] - th] as P3;
    });
  };
  const A = sec(root), B = sec(tip);
  const n = A.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (vertical) part.quad(A[i], B[i], B[j], A[j]);
    else if (root.le[1] >= tip.le[1]) part.quad(A[i], A[j], B[j], B[i]);
    else part.quad(A[i], B[i], B[j], A[j]);
  }
  // caps
  for (let i = 1; i < n - 1; i++) {
    if (vertical) { part.tri(B[0], B[i + 1], B[i]); part.tri(A[0], A[i], A[i + 1]); }
    else if (root.le[1] >= tip.le[1]) { part.tri(B[0], B[i], B[i + 1]); part.tri(A[0], A[i + 1], A[i]); }
    else { part.tri(B[0], B[i + 1], B[i]); part.tri(A[0], A[i], A[i + 1]); }
  }
}

/** Cylinder / cone along an arbitrary axis. */
function cyl(part: Part, a: P3, b: P3, r0: number, r1: number, seg = 16, capA = true, capB = true) {
  const ax = norm(sub(b, a));
  const ref: P3 = Math.abs(ax[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = norm(cross(ax, ref)), v = cross(ax, u);
  const ring = (c: P3, r: number) => Array.from({ length: seg + 1 }, (_, i) => {
    const t = (i / seg) * Math.PI * 2;
    const d: P3 = [u[0] * Math.cos(t) + v[0] * Math.sin(t), u[1] * Math.cos(t) + v[1] * Math.sin(t), u[2] * Math.cos(t) + v[2] * Math.sin(t)];
    return { p: [c[0] + d[0] * r, c[1] + d[1] * r, c[2] + d[2] * r] as P3, n: d };
  });
  const A = ring(a, r0), B = ring(b, r1);
  for (let i = 0; i < seg; i++) {
    const k = [A[i], A[i + 1], B[i + 1], B[i]].map(q => part.vert(q.p, q.n));
    part.idx.push(k[0], k[1], k[2], k[0], k[2], k[3]);
  }
  if (capA && r0 > 0) for (let i = 0; i < seg; i++) part.tri(a, A[i + 1].p, A[i].p);
  if (capB && r1 > 0) for (let i = 0; i < seg; i++) part.tri(b, B[i].p, B[i + 1].p);
}
function box(part: Part, c: P3, s: P3) {
  const [x, y, z] = c, [a, b, h] = [s[0] / 2, s[1] / 2, s[2] / 2];
  const p = (i: number, j: number, k: number): P3 => [x + i * a, y + j * b, z + k * h];
  part.quad(p(1, -1, -1), p(1, 1, -1), p(1, 1, 1), p(1, -1, 1));
  part.quad(p(-1, -1, -1), p(-1, -1, 1), p(-1, 1, 1), p(-1, 1, -1));
  part.quad(p(-1, 1, -1), p(-1, 1, 1), p(1, 1, 1), p(1, 1, -1));
  part.quad(p(-1, -1, -1), p(1, -1, -1), p(1, -1, 1), p(-1, -1, 1));
  part.quad(p(-1, -1, -1), p(-1, 1, -1), p(1, 1, -1), p(1, -1, -1));
  part.quad(p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1));
}

export interface ModelNodes { props: { name: string; pos: P3; axis: 'x' | 'z'; dir: number }[]; gear: string[] }

interface NodeDef { name: string; parts: Part[]; translation?: P3 }

export function buildAircraftGlb(ac: AircraftDef, aero: AeroModel): { glb: ArrayBuffer; nodes: ModelNodes } {
  const [cBody, cTail, cStripe, cEng] = ac.colors;
  const body = new Part(cBody, 0.25, 0.45);
  const tail = new Part(cTail, 0.25, 0.45);
  const stripe = new Part(cStripe, 0.25, 0.45);
  const glass = new Part('#0b1520', 0.6, 0.12);
  const engine = new Part(cEng, 0.55, 0.35);
  const dark = new Part('#1b1d20', 0.3, 0.6);
  const metal = new Part('#9aa0a6', 0.8, 0.3);
  const tire = new Part('#151515', 0, 0.9);
  const wingC = new Part(ac.cockpit === 'fighter' || ac.cat === 'vintage' || ac.cat === 'helicopter' ? cBody : shade(cBody, -0.06), 0.35, 0.45);
  const nodes: NodeDef[] = [];
  const meta: ModelNodes = { props: [], gear: [] };
  const L = ac.L, dia = ac.dia, b = ac.b;
  const rotor = ac.fdm === 'rotor';
  const r = dia / 2;
  const gh = aero.cgHeight;

  // ───────── fuselage ─────────
  const noseX = L * 0.5, tailX = -L * 0.5;
  const secs: Section[] = [];
  if (rotor) {
    const podL = Math.min(L * 0.55, 8), boomEnd = tailX;
    const px = noseX;
    for (const [t, s] of [[0, 0.15], [0.05, 0.55], [0.15, 0.85], [0.3, 1], [0.6, 1], [0.85, 0.75], [1, 0.4]] as const) {
      secs.push({ x: px - t * podL, z: 0.05 * dia * (1 - s), ry: r * s, rz: r * s * 1.05 });
    }
    loft(body, secs, 20);
    // tail boom
    cyl(body, [px - podL * 0.95, 0, -r * 0.2], [boomEnd, 0, -r * 0.35], r * 0.28, r * 0.12, 12);
    // canopy
    loft(glass, [
      { x: px - 0.02 * podL, z: 0.02, ry: r * 0.2, rz: r * 0.25 },
      { x: px - 0.08 * podL, z: -0.05, ry: r * 0.72, rz: r * 0.8 },
      { x: px - 0.3 * podL, z: -0.1, ry: r * 0.85, rz: r * 0.95 },
    ], 16, -Math.PI * 0.55, Math.PI * 0.55, 0.03);
  } else {
    const noseLen = ac.cockpit === 'fighter' ? 0.22 : ac.id === 'concorde' ? 0.2 : ac.cat === 'ga' || ac.cat === 'vintage' || ac.cat === 'turboprop' || ac.cat === 'glider' ? 0.12 : 0.1;
    const tailStart = ac.cat === 'ga' || ac.cat === 'glider' || ac.cat === 'vintage' ? 0.42 : 0.62;
    const upsweep = ac.cockpit === 'fighter' ? 0.1 : 0.32;
    const tailR = ac.cat === 'glider' ? 0.12 : ac.cockpit === 'fighter' ? 0.55 : 0.18;
    const prof: [number, number][] = [[0, 0.02], [0.2, 0.45], [0.45, 0.72], [0.7, 0.9], [1, 1]];
    for (const [t, s] of prof) secs.push({ x: noseX - t * noseLen * L, z: r * 0.25 * (1 - s), ry: r * s, rz: r * s });
    for (let i = 1; i <= 8; i++) {
      const t = i / 8;
      const x = noseX - noseLen * L - t * (1 - noseLen - (1 - tailStart)) * L;
      secs.push({ x, z: 0, ry: r, rz: r * (ac.cat === 'widebody' && ac.id !== 'concorde' ? 1.02 : 1) });
    }
    for (let i = 1; i <= 6; i++) {
      const t = i / 6;
      const s = 1 - (1 - tailR) * Math.pow(t, 1.3);
      secs.push({ x: tailX + (1 - tailStart) * L * (1 - t), z: -upsweep * dia * Math.pow(t, 1.5), ry: r * s * (ac.cockpit === 'fighter' ? 1.1 : 1), rz: r * s });
    }
    loft(body, secs, 28);
    // 747 / A380 upper deck
    if (ac.id.startsWith('b747')) {
      const deck = ac.id === 'b747-8' ? 0.38 : 0.3;
      loft(body, [
        { x: noseX - 0.04 * L, z: -r * 0.3, ry: r * 0.2, rz: r * 0.3 },
        { x: noseX - 0.12 * L, z: -r * 0.55, ry: r * 0.62, rz: r * 0.55 },
        { x: noseX - deck * L, z: -r * 0.55, ry: r * 0.62, rz: r * 0.55 },
        { x: noseX - (deck + 0.06) * L, z: -r * 0.2, ry: r * 0.4, rz: r * 0.2 },
      ], 16, -Math.PI / 2, Math.PI / 2);
    }
    // cockpit windows
    const wx = noseX - noseLen * L * (ac.cockpit === 'fighter' ? 0.9 : 0.75);
    if (ac.cockpit === 'fighter' || (ac.cat === 'vintage' && ac.eng.n === 1) || ac.cat === 'glider' || ac.id === 'extra330') {
      loft(glass, [
        { x: wx + 0.4, z: -r * 0.5, ry: r * 0.1, rz: r * 0.1 },
        { x: wx, z: -r * 0.7, ry: r * 0.55, rz: r * 0.55 },
        { x: wx - L * 0.12, z: -r * 0.75, ry: r * 0.6, rz: r * 0.6 },
        { x: wx - L * 0.2, z: -r * 0.55, ry: r * 0.2, rz: r * 0.3 },
      ], 16, -Math.PI / 2, Math.PI / 2);
    } else {
      loft(glass, [
        { x: wx + 0.25 * dia, z: 0, ry: r * 0.72, rz: r * 0.72 },
        { x: wx, z: 0, ry: r * 0.86, rz: r * 0.86 },
        { x: wx - 0.35 * dia, z: 0, ry: r * 0.96, rz: r * 0.96 },
      ], 20, -Math.PI * 0.42, Math.PI * 0.42, 0.012);
      // cabin window band + cheat line
      if (ac.cat !== 'ga') {
        const x0 = wx - 0.5 * dia, x1 = tailX + (1 - tailStart) * L + 0.5;
        const band: Section[] = [{ x: x0, z: 0, ry: r, rz: r }, { x: x1, z: 0, ry: r, rz: r }];
        loft(dark, band, 24, Math.PI * 0.39, Math.PI * 0.42, 0.01);
        loft(dark, band, 24, -Math.PI * 0.42, -Math.PI * 0.39, 0.01);
        loft(stripe, band, 24, Math.PI * 0.55, Math.PI * 0.6, 0.01);
        loft(stripe, band, 24, -Math.PI * 0.6, -Math.PI * 0.55, 0.01);
      } else {
        const x0 = wx - 0.2 * dia, x1 = wx - 0.25 * L;
        loft(glass, [{ x: x0, z: 0, ry: r, rz: r }, { x: x1, z: 0, ry: r * 0.95, rz: r * 0.95 }], 24, Math.PI * 0.3, Math.PI * 0.5, 0.012);
        loft(glass, [{ x: x0, z: 0, ry: r, rz: r }, { x: x1, z: 0, ry: r * 0.95, rz: r * 0.95 }], 24, -Math.PI * 0.5, -Math.PI * 0.3, 0.012);
        loft(stripe, [{ x: noseX - 0.1 * L, z: 0, ry: r, rz: r }, { x: tailX + 0.2 * L, z: 0, ry: r * 0.5, rz: r * 0.5 }], 24, Math.PI * 0.62, Math.PI * 0.7, 0.012);
        loft(stripe, [{ x: noseX - 0.1 * L, z: 0, ry: r, rz: r }, { x: tailX + 0.2 * L, z: 0, ry: r * 0.5, rz: r * 0.5 }], 24, -Math.PI * 0.7, -Math.PI * 0.62, 0.012);
      }
    }
  }

  // ───────── wings ─────────
  if (!rotor) {
    const taper = ac.tail === 'delta' ? 0.08 : ac.cat === 'glider' ? 0.4 : ac.cockpit === 'fighter' ? 0.3 : ac.cat === 'ga' || ac.cat === 'vintage' ? (ac.id === 'j3cub' ? 1 : 0.65) : ac.cat === 'turboprop' || ac.eng.t === 'tprop' ? 0.5 : 0.25;
    const cr = (2 * ac.S) / (b * (1 + taper));
    const ct = cr * taper;
    const semi = b / 2;
    const tanQC = Math.tan(ac.sweep * DEG);
    const tanLE = tanQC + (0.25 * (cr - ct)) / semi;
    const wz = ac.wing === 'high' ? -r * 0.85 : ac.wing === 'mid' ? 0 : r * 0.55;
    const xRootLE = cr * 0.25 + (ac.tail === 'delta' ? cr * 0.15 : 0.02 * L) + (ac.cockpit === 'fighter' ? -0.05 * L : 0);
    const thick = ac.eng.t === 'fan' ? 0.12 : 0.14;
    const dih = Math.tan(ac.dih * DEG);
    for (const s of [-1, 1]) {
      const rootY = s * r * 0.6;
      const tipLE: P3 = [xRootLE - tanLE * semi, s * semi, wz - dih * semi];
      panel(wingC, { le: [xRootLE, rootY, wz], c: cr, t: thick }, { le: tipLE, c: ct, t: thick * 0.8 });
      // winglets on modern jets
      if (ac.eng.t === 'fan' && ac.cat !== 'military' && ac.id !== 'concorde' && ac.id !== 'md11' && !ac.id.startsWith('b747-4') && ac.cat !== 'bizjet' || ac.id === 'md11') {
        const h = Math.max(0.8, b * 0.04);
        panel(tail, { le: [tipLE[0], tipLE[1], tipLE[2]], c: ct * 0.9, t: 0.08 }, { le: [tipLE[0] - h * 0.8, tipLE[1] + s * h * 0.15, tipLE[2] - h], c: ct * 0.4, t: 0.08 }, true);
      }
    }
    // canard
    if (ac.canard) {
      for (const s of [-1, 1]) panel(wingC, { le: [L * 0.3, s * r * 0.5, -r * 0.2], c: cr * 0.3, t: 0.06 }, { le: [L * 0.24, s * b * 0.2, -r * 0.2], c: cr * 0.12, t: 0.06 });
    }

    // ───────── empennage ─────────
    const finH = Math.max(0.9, (ac.H - gh - r) * (ac.cockpit === 'fighter' ? 0.75 : 0.95));
    const finRoot = clamp(0.2 * L, 1.0, 12) * (ac.tail === 'delta' ? 1.4 : 1);
    const finTip = finRoot * (ac.tail === 'T' ? 0.75 : 0.4);
    const finSweep = ac.cat === 'ga' ? 0.5 : 0.9;
    const finX = tailX + finRoot + 0.02 * L;
    const finZ = -r * (ac.cockpit === 'fighter' ? 0.6 : 0.55) - (ac.cockpit === 'fighter' ? 0 : 0.2 * dia);
    const fins = ac.tail === 'twin' ? [-r * 0.9, r * 0.9] : [0];
    for (const fy of fins) {
      const cant = ac.tail === 'twin' ? Math.sign(fy) * 0.35 : 0;
      panel(tail, { le: [finX, fy, finZ], c: finRoot, t: 0.1 }, { le: [finX - finH * finSweep, fy + cant * finH, finZ - finH], c: finTip, t: 0.1 }, true);
    }
    if (ac.tail !== 'delta') {
      const hsSpan = ac.cockpit === 'fighter' ? b * 0.65 : ac.cat === 'ga' || ac.cat === 'vintage' ? b * 0.33 : b * 0.34;
      const hsRoot = ac.cockpit === 'fighter' ? finRoot * 0.9 : finRoot * 0.7;
      const T = ac.tail === 'T';
      const hsX = T ? finX - finH * finSweep - 0.1 : ac.tail === 'cruciform' ? finX - finH * 0.4 : tailX + hsRoot + 0.01 * L;
      const hsZ = T ? finZ - finH + 0.05 : ac.tail === 'cruciform' ? finZ - finH * 0.4 : -upsweepZ(ac, r);
      const hsDih = ac.cockpit === 'fighter' ? -0.1 : ac.cat === 'ga' ? 0 : 0.12;
      for (const s of [-1, 1]) {
        panel(tail, { le: [hsX, s * (T ? 0.1 : r * 0.35), hsZ], c: hsRoot, t: 0.1 }, { le: [hsX - hsSpan / 2 * (T ? 0.6 : 0.7), s * hsSpan / 2, hsZ - hsDih * hsSpan / 2], c: hsRoot * 0.45, t: 0.1 });
      }
    }

    // ───────── engines ─────────
    const e = ac.eng;
    const nacD = aero.nacD;
    aero.engPos.forEach((p, i) => {
      if (e.t === 'none') return;
      if (e.t === 'fan' || (e.t === 'jet' && e.mount === 'nacelle4')) {
        const ln = e.t === 'fan' ? nacD * 1.9 : L * 0.2;
        const zc = e.mount === 'wing' || e.mount === 'wing4' ? gh - (ac.cat === 'widebody' ? 0.75 : 0.5) - nacD / 2 : p[2];
        const x0 = e.mount === 'aft' ? p[0] + ln * 0.5 : xRootLE - tanLE * Math.abs(p[1]) + ln * 0.55;
        const xc = e.mount === 'tri' && p[1] === 0 ? tailX + finRoot * 0.9 : x0;
        let yc = p[1], zz = zc;
        if (e.mount === 'tri' && p[1] === 0) zz = finZ + nacD * 0.2;
        if (e.mount === 'top') { yc = p[1] || (i === 0 ? -b * 0.18 : b * 0.18); zz = wz - nacD * 0.9; }
        if (e.mount === 'nacelle4') { zz = r * 1.1; yc = p[1]; }
        const rad = e.t === 'fan' ? nacD / 2 : dia * 0.3;
        cyl(engine, [xc, yc, zz], [xc - ln, yc, zz], rad, rad * 0.78, 20, false, false);
        cyl(dark, [xc - 0.05, yc, zz], [xc - 0.3, yc, zz], rad * 0.92, rad * 0.92, 20, true, false);
        cyl(metal, [xc - ln, yc, zz], [xc - ln - rad * 0.5, yc, zz], rad * 0.55, rad * 0.1, 12, false, false);
        if (e.mount === 'wing' || e.mount === 'wing4') box(engine, [xc - ln * 0.4, yc, (zz + wz) / 2 - rad * 0.3], [ln * 0.7, rad * 0.25, Math.abs(zz - wz)]);
        if (e.mount === 'aft') box(engine, [xc - ln * 0.5, (yc + Math.sign(yc) * -r) / 2 + Math.sign(yc) * 0.1, zz], [ln * 0.5, Math.abs(yc) - r * 0.6, rad * 0.4]);
      } else if (e.t === 'jet') {
        // internal: exhaust nozzle(s)
        const yc = e.mount === 'internal2' ? (i === 0 ? -0.45 : 0.45) * (dia / 1.6) : 0;
        cyl(dark, [tailX + 0.3, yc, 0], [tailX - 0.2, yc, 0], dia * 0.28, dia * 0.26, 16, false, true);
        // intakes
        box(dark, [L * 0.05, ac.cockpit === 'fighter' && e.mount === 'internal' ? 0 : yc * 2.2, r * 0.8], [L * 0.1, dia * 0.5, dia * 0.35]);
      } else {
        // propeller engines
        const nose = e.mount === 'nose';
        const top = e.mount === 'top';
        if (top) return;
        const pd = e.propD ?? 2;
        const xh = nose ? noseX + 0.15 : xRootLE + L * 0.12;
        const yc = nose ? 0 : p[1];
        const zc = nose ? 0.05 * dia : wz + (ac.wing === 'high' ? r * 0.15 : 0);
        if (!nose) {
          const nr = Math.max(0.35, pd * 0.16);
          cyl(engine, [xh - 0.1, yc, zc], [xh - L * 0.28, yc, zc], nr, nr * 0.5, 16, true, true);
        }
        const name = `prop${i}`;
        const hub = new Part('#202020', 0.4, 0.4);
        const spin = new Part(nose ? cStripe : cEng, 0.5, 0.3);
        cyl(spin, [0.45, 0, 0], [0, 0, 0], 0, Math.max(0.15, pd * 0.09), 14, false, true);
        const nb = e.blades ?? 3;
        for (let k = 0; k < nb; k++) {
          const a = (k / nb) * Math.PI * 2;
          const dy = Math.cos(a), dz = Math.sin(a);
          const tip: P3 = [0, dy * pd / 2, dz * pd / 2];
          const w = pd * 0.045;
          hub.quad([0.02, dy * 0.1 - dz * w, dz * 0.1 + dy * w], [0.02, tip[1] - dz * w * 0.6, tip[2] + dy * w * 0.6], [-0.02, tip[1] + dz * w * 0.6, tip[2] - dy * w * 0.6], [-0.02, dy * 0.1 + dz * w, dz * 0.1 - dy * w]);
          hub.quad([-0.02, dy * 0.1 + dz * w, dz * 0.1 - dy * w], [-0.02, tip[1] + dz * w * 0.6, tip[2] - dy * w * 0.6], [0.02, tip[1] - dz * w * 0.6, tip[2] + dy * w * 0.6], [0.02, dy * 0.1 - dz * w, dz * 0.1 + dy * w]);
        }
        nodes.push({ name, parts: [hub, spin], translation: [xh, yc, zc] });
        meta.props.push({ name, pos: [xh, yc, zc], axis: 'x', dir: 1 });
      }
    });
  } else {
    // ───────── rotorcraft ─────────
    const R = ac.rotor!.D / 2;
    const mastZ = -r - 0.5;
    const tandem = ac.rotor!.tail === 'tandem';
    cyl(metal, [0, 0, -r * 0.8], [0, 0, mastZ], 0.12, 0.1, 10);
    // tail fin + stabiliser
    panel(tail, { le: [tailX + 1.4, 0, -r * 0.3], c: 1.2, t: 0.1 }, { le: [tailX + 0.6, 0, -r * 0.3 - 1.4], c: 0.8, t: 0.1 }, true);
    for (const s of [-1, 1]) panel(tail, { le: [tailX + 2.6, s * 0.15, -r * 0.3], c: 0.7, t: 0.1 }, { le: [tailX + 2.4, s * 1.3, -r * 0.3], c: 0.5, t: 0.1 });
    const mkRotor = (name: string, pos: P3, rad: number, blades: number, axis: 'x' | 'z', dir: number) => {
      const p = new Part('#2a2a2a', 0.3, 0.5);
      for (let k = 0; k < blades; k++) {
        const a = (k / blades) * Math.PI * 2;
        const dx = Math.cos(a), dy = Math.sin(a);
        const w = Math.max(0.12, rad * 0.05);
        if (axis === 'z') {
          p.quad([dx * 0.3 - dy * w, dy * 0.3 + dx * w, 0], [dx * rad - dy * w, dy * rad + dx * w, 0], [dx * rad + dy * w, dy * rad - dx * w, 0], [dx * 0.3 + dy * w, dy * 0.3 - dx * w, 0]);
          p.quad([dx * 0.3 + dy * w, dy * 0.3 - dx * w, 0.01], [dx * rad + dy * w, dy * rad - dx * w, 0.01], [dx * rad - dy * w, dy * rad + dx * w, 0.01], [dx * 0.3 - dy * w, dy * 0.3 + dx * w, 0.01]);
        } else {
          p.quad([0, dx * 0.1 - dy * w, dy * 0.1 + dx * w], [0, dx * rad - dy * w, dy * rad + dx * w], [0, dx * rad + dy * w, dy * rad - dx * w], [0, dx * 0.1 + dy * w, dy * 0.1 - dx * w]);
          p.quad([0.01, dx * 0.1 + dy * w, dy * 0.1 - dx * w], [0.01, dx * rad + dy * w, dy * rad - dx * w], [0.01, dx * rad - dy * w, dy * rad + dx * w], [0.01, dx * 0.1 - dy * w, dy * 0.1 + dx * w]);
        }
      }
      const hub = new Part('#333333', 0.6, 0.4);
      cyl(hub, [0, 0, 0.1], [0, 0, -0.25], 0.25, 0.15, 10);
      nodes.push({ name, parts: [p, hub], translation: pos });
      meta.props.push({ name, pos, axis, dir });
    };
    if (tandem) {
      mkRotor('rotor0', [L * 0.42, 0, mastZ - 0.3], R, ac.rotor!.blades, 'z', 1);
      mkRotor('rotor1', [-L * 0.42, 0, mastZ - 1.6], R, ac.rotor!.blades, 'z', -1);
      box(body, [-L * 0.42, 0, -r - 0.8], [2.5, 1.2, 1.8]);
    } else {
      mkRotor('rotor0', [0, 0, mastZ], R, ac.rotor!.blades, 'z', 1);
      if (ac.rotor!.tail === 'rotor') mkRotor('rotor1', [tailX + 0.7, -0.35, -r * 0.3 - 0.6], Math.max(0.8, R * 0.18), 2, 'x', 1);
      else cyl(dark, [tailX + 1.2, -0.2, -r * 0.3 - 0.5], [tailX + 1.2, 0.2, -r * 0.3 - 0.5], 0.5, 0.5, 16);
    }
    // engine cowling
    box(engine, [-0.5, 0, -r - 0.15], [2.4, dia * 0.6, 0.6]);
  }

  // ───────── landing gear ─────────
  const gearParts = [new Part('#c9ced6', 0.6, 0.35), tire];
  const [strut] = gearParts;
  for (const leg of aero.gear) {
    const [gx, gy, gz] = leg.pos;
    if (leg.name.includes('SKID')) continue;
    const wheelR = clamp(gh * 0.14, 0.18, 0.65) * (leg.name === 'NOSE' || leg.tail ? 0.8 : 1);
    const top: P3 = [gx, gy, Math.min(r * 0.4, gz - 0.3)];
    cyl(strut, top, [gx, gy, gz - wheelR], Math.max(0.05, wheelR * 0.18), Math.max(0.05, wheelR * 0.15), 8);
    const bogie = ac.cat === 'widebody' && leg.name !== 'NOSE' ? (ac.id === 'a380' || ac.id.startsWith('b777') ? 3 : 2) : 1;
    const pairs = ac.cat === 'airliner' || ac.cat === 'widebody' || ac.cat === 'regional' ? 2 : 1;
    for (let k = 0; k < bogie; k++) {
      const dx = (k - (bogie - 1) / 2) * wheelR * 2.3;
      for (let j = 0; j < pairs; j++) {
        const dy = pairs === 2 ? (j === 0 ? -1 : 1) * wheelR * 0.55 : 0;
        cyl(tire, [gx + dx, gy + dy - wheelR * 0.22, gz - wheelR], [gx + dx, gy + dy + wheelR * 0.22, gz - wheelR], wheelR, wheelR, 14);
      }
    }
  }
  if (aero.gear.some(g => g.name.includes('SKID'))) {
    const sk = aero.gear.filter(g => g.name.includes('SKID'));
    for (const s of [-1, 1]) {
      const pts = sk.filter(g => Math.sign(g.pos[1]) === s);
      const xs = pts.map(p => p.pos[0]);
      const y = pts[0].pos[1], z = pts[0].pos[2] - 0.05;
      cyl(metal, [Math.max(...xs) + 0.6, y, z - 0.25], [Math.max(...xs), y, z], 0.05, 0.05, 8);
      cyl(metal, [Math.max(...xs), y, z], [Math.min(...xs) - 0.3, y, z], 0.05, 0.05, 8);
      for (const x of xs) cyl(metal, [x, y * 0.6, -r * 0.2], [x, y, z], 0.04, 0.04, 6);
    }
  }
  if (ac.gear.retract) { nodes.push({ name: 'gear', parts: gearParts }); meta.gear.push('gear'); }
  else nodes.push({ name: 'gearFixed', parts: gearParts });

  const main: Part[] = [body, tail, stripe, glass, engine, dark, metal, wingC];
  return { glb: writeGlb([{ name: 'body', parts: main }, ...nodes]), nodes: meta };
}

function upsweepZ(ac: AircraftDef, r: number) {
  return ac.cockpit === 'fighter' ? 0 : r * 0.35;
}
function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => clamp(Math.round(v + 255 * k), 0, 255);
  return '#' + [f(n >> 16), f((n >> 8) & 255), f(n & 255)].map(v => v.toString(16).padStart(2, '0')).join('');
}
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  // sRGB -> linear
  const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return [lin(n >> 16), lin((n >> 8) & 255), lin(n & 255)];
}

function writeGlb(nodes: NodeDef[]): ArrayBuffer {
  const bufs: ArrayBuffer[] = [];
  let offset = 0;
  const bufferViews: object[] = [], accessors: object[] = [], meshes: object[] = [], materials: object[] = [];
  const gnodes: object[] = [];
  const matIndex = new Map<string, number>();
  const push = (arr: Float32Array | Uint32Array, target: number) => {
    const bytes = arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength) as ArrayBuffer;
    bufs.push(bytes);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength, target });
    offset += bytes.byteLength;
    const pad = (4 - (offset % 4)) % 4;
    if (pad) { bufs.push(new ArrayBuffer(pad)); offset += pad; }
    return bufferViews.length - 1;
  };
  for (const nd of nodes) {
    if (!nd.parts.some(p => p.idx.length)) continue; // glTF forbids meshes without primitives
    const prims: object[] = [];
    for (const p of nd.parts) {
      if (!p.idx.length) continue;
      const key = `${p.color}|${p.metal}|${p.rough}|${p.alpha}`;
      let mi = matIndex.get(key);
      if (mi === undefined) {
        mi = materials.length;
        materials.push({
          pbrMetallicRoughness: { baseColorFactor: [...hexToRgb(p.color), p.alpha], metallicFactor: p.metal, roughnessFactor: p.rough },
          doubleSided: true,
          ...(p.alpha < 1 ? { alphaMode: 'BLEND' } : {}),
        });
        matIndex.set(key, mi);
      }
      const pos = new Float32Array(p.pos), nrm = new Float32Array(p.nrm), idx = new Uint32Array(p.idx);
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], pos[i + k]); max[k] = Math.max(max[k], pos[i + k]); }
      const bvP = push(pos, 34962), bvN = push(nrm, 34962), bvI = push(idx, 34963);
      accessors.push({ bufferView: bvP, componentType: 5126, count: pos.length / 3, type: 'VEC3', min, max });
      accessors.push({ bufferView: bvN, componentType: 5126, count: nrm.length / 3, type: 'VEC3' });
      accessors.push({ bufferView: bvI, componentType: 5125, count: idx.length, type: 'SCALAR' });
      const n = accessors.length;
      prims.push({ attributes: { POSITION: n - 3, NORMAL: n - 2 }, indices: n - 1, material: mi });
    }
    meshes.push({ name: nd.name, primitives: prims });
    const t = nd.translation;
    gnodes.push({ name: nd.name, mesh: meshes.length - 1, ...(t ? { translation: [-t[1], -t[2], t[0]] } : {}) });
  }
  const json = {
    asset: { version: '2.0', generator: 'SkyLine procedural aircraft' },
    scene: 0,
    scenes: [{ nodes: gnodes.map((_, i) => i) }],
    nodes: gnodes, meshes, materials, accessors, bufferViews,
    buffers: [{ byteLength: offset }],
  };
  const enc = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = Math.ceil(enc.length / 4) * 4;
  const total = 12 + 8 + jsonLen + 8 + offset;
  const out = new ArrayBuffer(total);
  const dv = new DataView(out);
  const u8 = new Uint8Array(out);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true); dv.setUint32(16, 0x4e4f534a, true);
  u8.set(enc, 20); for (let i = enc.length; i < jsonLen; i++) u8[20 + i] = 0x20;
  let o = 20 + jsonLen;
  dv.setUint32(o, offset, true); dv.setUint32(o + 4, 0x004e4942, true); o += 8;
  for (const b of bufs) { u8.set(new Uint8Array(b), o); o += b.byteLength; }
  return out;
}
