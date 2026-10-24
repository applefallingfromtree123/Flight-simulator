// 3D flight deck: a procedural interior (panel, glareshield, pedestal, consoles, window frames,
// overhead, yokes / sidesticks / throttles) built around the pilot's eye point, with the real
// avionics (PFD, ND, EICAS, six-pack, FCU) rendered live onto its screens.
import * as Cesium from 'cesium';
import { Part, box, cyl, writeGlb, type NodeDef, type P3 } from './modelBuilder.ts';
import type { Aircraft } from '../sim/fdm.ts';
import { C, FONT, type AvData } from '../avionics/common.ts';
import { PFD } from '../avionics/pfd.ts';
import { ND } from '../avionics/nd.ts';
import { EICAS } from '../avionics/eicas.ts';
import { SixPack } from '../avionics/steam.ts';

type Src = 'pfd' | 'nd' | 'eicas' | 'six' | 'fcu' | 'ovh';
/** A flat screen: centre, right and up unit vectors (body FRD), size in metres. */
interface ScreenDef { src: Src; c: P3; r: P3; u: P3; w: number; h: number }
interface Lever { node: string; kind: 'stick' | 'yoke' | 'thr' | 'coll'; idx?: number }

const add = (a: P3, b: P3): P3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: P3, k: number): P3 => [a[0] * k, a[1] * k, a[2] * k];
const toGltf = (p: P3) => new Cesium.Cartesian3(-p[1], -p[2], p[0]);

/** Panel "up" vector for a panel tilted back by `deg` (top further forward). */
const tiltUp = (deg: number): P3 => [Math.sin(deg * Math.PI / 180), 0, -Math.cos(deg * Math.PI / 180)];

export class Cockpit3D {
  model: Cesium.Model | null = null;
  private screens: { def: ScreenDef; prim: Cesium.Primitive }[] = [];
  /** One GPU texture per avionics source, shared by every screen showing it (e.g. both PFDs). */
  private textures = new Map<Src, { tex: unknown; cv: HTMLCanvasElement }>();
  private levers: Lever[] = [];
  private pivots = new Map<string, P3>();
  private holder = document.createElement('div');
  private pfd: PFD | null = null; private nd: ND | null = null; private eicas: EICAS | null = null; private six: SixPack | null = null;
  private fcu = document.createElement('canvas');
  private ovh = document.createElement('canvas');
  private drawT = 0;
  visible = false;

  constructor(private scene: Cesium.Scene) {}

  destroy() {
    if (this.model) { this.scene.primitives.remove(this.model); this.model = null; }
    for (const s of this.screens) {
      // the textures are shared and owned here: detach them so the material doesn't destroy them too
      const m = (s.prim.appearance as unknown as { material?: { _textures?: Record<string, unknown>; _defaultTexture?: unknown } }).material;
      if (m?._textures) for (const k of Object.keys(m._textures)) m._textures[k] = m._defaultTexture;
      this.scene.primitives.remove(s.prim);
    }
    for (const t of this.textures.values()) (t.tex as { destroy?: () => void }).destroy?.();
    this.screens = [];
    this.textures.clear();
  }

  async build(ac: Aircraft, eye: P3) {
    this.destroy();
    const d = ac.def;
    const kind = d.cockpit;
    const { nodes, screens, levers } = kind === 'g1000' || kind === 'steam' ? buildGa(ac, eye) : kind === 'fighter' ? buildFighter(ac, eye) : kind === 'heli' ? buildHeli(ac, eye) : buildAirliner(ac, eye);
    this.levers = levers;
    this.pivots.clear();
    for (const n of nodes) if (n.translation) this.pivots.set(n.name, n.translation);
    const glb = writeGlb(nodes);
    const url = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
    this.model = await Cesium.Model.fromGltfAsync({ url, backFaceCulling: false, shadows: Cesium.ShadowMode.DISABLED });
    this.model.show = false;
    this.scene.primitives.add(this.model);
    // offscreen avionics
    this.holder.innerHTML = '';
    const need = new Set(screens.map(s => s.src));
    this.pfd = need.has('pfd') ? new PFD(this.holder) : null;
    this.nd = need.has('nd') ? new ND(this.holder) : null;
    this.eicas = need.has('eicas') ? new EICAS(this.holder) : null;
    this.six = need.has('six') ? new SixPack(this.holder) : null;
    for (const disp of [this.pfd, this.nd, this.eicas, this.six]) {
      if (!disp) continue;
      disp.fixed = disp === this.six ? [768, 512] : [512, 512];
      disp.cv.width = disp.fixed[0]; disp.cv.height = disp.fixed[1];
    }
    this.fcu.width = 1024; this.fcu.height = 128;
    this.ovh.width = 1024; this.ovh.height = 512;
    drawOverhead(this.ovh, kind);
    const ctx = (this.scene as unknown as { context: unknown }).context;
    const TextureCtor = (Cesium as unknown as { Texture: new (o: object) => { copyFrom(o: object): void; destroy(): void } }).Texture;
    for (const def of screens) {
      const cv = def.src === 'pfd' ? this.pfd!.cv : def.src === 'nd' ? this.nd!.cv : def.src === 'eicas' ? this.eicas!.cv : def.src === 'six' ? this.six!.cv : def.src === 'fcu' ? this.fcu : this.ovh;
      let entry = this.textures.get(def.src);
      if (!entry) {
        const g = cv.getContext('2d')!; g.fillStyle = '#05070a'; g.fillRect(0, 0, cv.width, cv.height);
        if (def.src === 'ovh') drawOverhead(cv, kind);
        entry = { cv, tex: new TextureCtor({ context: ctx, source: cv, sampler: new (Cesium as unknown as { Sampler: new (o: object) => unknown }).Sampler({ minificationFilter: Cesium.TextureMinificationFilter.LINEAR, magnificationFilter: Cesium.TextureMagnificationFilter.LINEAR }) }) };
        this.textures.set(def.src, entry);
      }
      const tex = entry.tex;
      const material = new Cesium.Material({ fabric: { type: 'Image', uniforms: { image: Cesium.Material.DefaultImageId } } });
      (material.uniforms as Record<string, unknown>).image = tex;
      const prim = this.scene.primitives.add(new Cesium.Primitive({
        geometryInstances: new Cesium.GeometryInstance({ geometry: quad(def) }),
        appearance: new Cesium.MaterialAppearance({ material, flat: true, translucent: false, faceForward: false, closed: false,
          renderState: { cull: { enabled: false }, depthTest: { enabled: true } } }),
        asynchronous: false, compressVertices: false, show: false,
      })) as Cesium.Primitive;
      this.screens.push({ def, prim });
    }
  }

  /** Per frame. `mm` is the aircraft model matrix (same frame as the exterior model). */
  update(ac: Aircraft, av: AvData, mm: Cesium.Matrix4, show: boolean, dt: number, input: { pitch: number; roll: number; throttle: number[]; collective: number }) {
    this.visible = show;
    if (!this.model) return;
    this.model.show = show;
    Cesium.Matrix4.clone(mm, this.model.modelMatrix);
    for (const s of this.screens) { s.prim.show = show; Cesium.Matrix4.clone(mm, s.prim.modelMatrix); }
    if (!show) return;
    if (this.model.ready) {
      for (const lv of this.levers) {
        const node = this.model.getNode(lv.node);
        const piv = this.pivots.get(lv.node);
        if (!node || !piv) continue;
        let rot = Cesium.Matrix3.IDENTITY, off: P3 = [0, 0, 0];
        if (lv.kind === 'stick') rot = Cesium.Matrix3.multiply(Cesium.Matrix3.fromRotationZ(input.roll * 0.3), Cesium.Matrix3.fromRotationX(-input.pitch * 0.3), new Cesium.Matrix3());
        else if (lv.kind === 'yoke') { rot = Cesium.Matrix3.fromRotationZ(input.roll * 1.2); off = [-input.pitch * 0.08, 0, 0]; }
        else if (lv.kind === 'thr') rot = Cesium.Matrix3.fromRotationX(-0.55 + (input.throttle[lv.idx ?? 0] ?? 0) * 1.1);
        else if (lv.kind === 'coll') rot = Cesium.Matrix3.fromRotationX(-input.collective * 0.5);
        node.matrix = Cesium.Matrix4.fromRotationTranslation(rot, toGltf(add(piv, off)));
      }
    }
    this.drawT -= dt;
    if (this.drawT > 0) return;
    this.drawT = 1 / 20;
    const sys = av.sys;
    this.pfd?.draw(av, 1 / 20);
    this.nd?.draw(av);
    this.eicas?.draw(av);
    this.six?.draw(av, 1 / 20);
    drawFcu(this.fcu, av, ac);
    for (const [src, t] of this.textures) {
      if (src === 'ovh') continue;
      if (!sys.avionicsPowered && src !== 'six') { const g = t.cv.getContext('2d')!; g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#05070a'; g.fillRect(0, 0, t.cv.width, t.cv.height); }
      try { (t.tex as { copyFrom(o: object): void }).copyFrom({ source: t.cv }); } catch { /* size changed mid-flight: ignore this frame */ }
    }
  }
}

function quad(d: ScreenDef): Cesium.Geometry {
  const hw = d.w / 2, hh = d.h / 2;
  const corners: P3[] = [add(add(d.c, mul(d.r, -hw)), mul(d.u, -hh)), add(add(d.c, mul(d.r, hw)), mul(d.u, -hh)), add(add(d.c, mul(d.r, hw)), mul(d.u, hh)), add(add(d.c, mul(d.r, -hw)), mul(d.u, hh))];
  // body FRD -> model frame (fwd, left, up)
  const pos = new Float64Array(corners.flatMap(p => [p[0], -p[1], -p[2]]));
  const st = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const nb: P3 = [d.r[1] * d.u[2] - d.r[2] * d.u[1], d.r[2] * d.u[0] - d.r[0] * d.u[2], d.r[0] * d.u[1] - d.r[1] * d.u[0]];
  const normal = new Float32Array([0, 1, 2, 3].flatMap(() => [nb[0], -nb[1], -nb[2]]));
  return new Cesium.Geometry({
    attributes: {
      position: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: pos }),
      normal: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 3, values: normal }),
      st: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 2, values: st }),
    } as unknown as Cesium.GeometryAttributes,
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
    primitiveType: Cesium.PrimitiveType.TRIANGLES,
    boundingSphere: Cesium.BoundingSphere.fromVertices(Array.from(pos)),
  });
}

// ───────────────────────── geometry helpers ─────────────────────────
/** Flat quad from 4 corners (any winding; the GLB writer fixes it against the normal). */
function face(p: Part, a: P3, b: P3, c: P3, d: P3) { p.quad(a, b, c, d); }
/** Thin slab between two corner points in a plane given by 4 corners, with thickness along its normal. */
function slab(p: Part, a: P3, b: P3, c: P3, d: P3, t = 0.02) {
  const u: P3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v: P3 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
  const n: P3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(...n) || 1; const o = mul(n, t / l);
  const A2 = add(a, o), B2 = add(b, o), C2 = add(c, o), D2 = add(d, o);
  face(p, a, b, c, d); face(p, A2, B2, C2, D2);
  face(p, a, b, B2, A2); face(p, b, c, C2, B2); face(p, c, d, D2, C2); face(p, d, a, A2, D2);
}
/** Post (pillar) of square section between two points. */
function post(p: Part, a: P3, b: P3, w = 0.05) { cyl(p, a, b, w, w, 4); }

function screen(src: Src, c: P3, w: number, h: number, tilt = 12): ScreenDef { return { src, c, r: [0, 1, 0], u: tiltUp(tilt), w, h }; }
/** Point on a panel plane tilted back by `tilt` deg through (x0, z0) at height z. */
function onPanel(x0: number, z0: number, tilt: number, y: number, z: number, inset = -0.004): P3 {
  return [x0 + (z0 - z) * Math.tan(tilt * Math.PI / 180) + inset, y, z];
}

// ───────────────────────── airliner ─────────────────────────
function buildAirliner(ac: Aircraft, E: P3) {
  const d = ac.def;
  const airbus = d.fbw === 'airbus';
  const boeingish = !airbus;
  const [ex, ey, ez] = E;
  const W = Math.min(1.25, d.dia * 0.36 + 0.2);
  const shell = new Part(airbus ? '#6e7b86' : '#8b9096', 0.05, 0.75);
  const panelC = new Part(airbus ? '#45505a' : '#3d4146', 0.05, 0.8);
  const dark = new Part('#1d2125', 0.1, 0.7);
  const glare = new Part('#26292d', 0.05, 0.9);
  const metal = new Part('#a9afb5', 0.7, 0.35);
  const seat = new Part('#2b2f35', 0.0, 0.95);
  const floor = new Part('#33373c', 0.0, 0.95);
  const tilt = 14, px = ex + 0.86, pz0 = ez + 0.2, pz1 = ez + 0.74;
  // main instrument panel
  const P = (y: number, z: number) => onPanel(px, pz0, tilt, y, z, 0);
  slab(panelC, P(-W, pz0), P(W, pz0), P(W, pz1), P(-W, pz1), 0.03);
  // glareshield (flat top + sloped lip), FCU strip on its aft face
  slab(glare, [px - 0.24, -W, pz0 - 0.07], [px - 0.24, W, pz0 - 0.07], [px + 0.1, W, pz0 - 0.1], [px + 0.1, -W, pz0 - 0.1], 0.02);
  slab(glare, [px - 0.24, -W, pz0 - 0.07], [px - 0.24, W, pz0 - 0.07], [px - 0.2, W, pz0 + 0.02], [px - 0.2, -W, pz0 + 0.02], 0.02);
  // EFIS control panels at each end of the glareshield
  for (const s of [-1, 1]) box(dark, [px - 0.235, s * (Math.abs(ey) + 0.08), pz0 - 0.03], [0.02, 0.16, 0.05]);
  // pedestal
  const pedTop = ez + 0.6;
  slab(panelC, [ex + 0.72, -0.24, pedTop - 0.08], [ex + 0.72, 0.24, pedTop - 0.08], [ex - 0.4, 0.24, pedTop], [ex - 0.4, -0.24, pedTop], 0.02);
  box(dark, [ex + 0.16, 0, pedTop + 0.25], [1.12, 0.48, 0.5]);
  slab(panelC, [px - 0.02, -0.24, pz1], [px - 0.02, 0.24, pz1], [ex + 0.72, 0.24, pedTop - 0.08], [ex + 0.72, -0.24, pedTop - 0.08], 0.02);
  // side consoles
  for (const s of [-1, 1]) {
    box(shell, [ex - 0.05, s * (W - 0.12), ez + 0.75], [1.3, 0.24, 0.5]);
    slab(panelC, [ex + 0.6, s * (W - 0.24), ez + 0.5], [ex + 0.6, s * W, ez + 0.5], [ex - 0.7, s * W, ez + 0.5], [ex - 0.7, s * (W - 0.24), ez + 0.5], 0.01);
  }
  // floor, aft bulkhead
  face(floor, [px + 0.3, -W, ez + 1.05], [px + 0.3, W, ez + 1.05], [ex - 1.0, W, ez + 1.05], [ex - 1.0, -W, ez + 1.05]);
  face(shell, [ex - 1.0, -W, ez + 1.05], [ex - 1.0, W, ez + 1.05], [ex - 1.0, W, ez - 0.6], [ex - 1.0, -W, ez - 0.6]);
  // shell: side walls under the sill, window frames, roof
  const sillZ = ez + 0.1, roofF: P3 = [px + 0.05, 0, ez - 0.33], roofA: P3 = [ex - 1.0, 0, ez - 0.6];
  for (const s of [-1, 1]) {
    face(shell, [px, s * W, pz1], [px, s * W, sillZ], [ex - 1.0, s * W, sillZ], [ex - 1.0, s * W, ez + 1.05]);
    face(shell, [px, s * W, pz1], [px, s * W, ez + 1.05], [ex - 1.0, s * W, ez + 1.05], [ex - 1.0, s * W, pz1]);
    // window posts: A-pillar, side-window frames, aft solid section
    post(shell, [px - 0.12, s * W * 0.98, sillZ - 0.05], [roofF[0] - 0.05, s * W * 0.9, roofF[2]], 0.045);
    post(shell, [px - 0.16, s * W * 0.55, pz0 - 0.08], [roofF[0], s * W * 0.5, roofF[2]], 0.035);
    post(shell, [ex + 0.2, s * W, sillZ], [ex + 0.15, s * W * 0.96, ez - 0.42], 0.04);
    post(shell, [ex - 0.45, s * W, sillZ], [ex - 0.5, s * W * 0.95, ez - 0.5], 0.06);
    face(shell, [ex - 0.5, s * W, sillZ], [ex - 1.0, s * W, sillZ], [ex - 1.0, s * W * 0.95, ez - 0.6], [ex - 0.5, s * W * 0.95, ez - 0.5]);
    post(dark, [px - 0.1, s * W, sillZ], [ex - 0.5, s * W, sillZ], 0.025);
  }
  post(shell, [px - 0.14, 0, pz0 - 0.09], [roofF[0], 0, roofF[2]], 0.035);
  face(shell, [roofF[0], -W, roofF[2] + 0.02], [roofF[0], W, roofF[2] + 0.02], [roofA[0], W, roofA[2]], [roofA[0], -W, roofA[2]]);
  // overhead panel body
  slab(panelC, [roofF[0] - 0.15, -0.5, roofF[2] + 0.05], [roofF[0] - 0.15, 0.5, roofF[2] + 0.05], [ex - 0.6, 0.5, ez - 0.48], [ex - 0.6, -0.5, ez - 0.48], 0.04);
  // seats (F/O seat is visible when looking right)
  for (const s of [-1, 1]) {
    const sy = s * Math.abs(ey);
    box(seat, [ex - 0.05, sy, ez + 0.62], [0.5, 0.5, 0.12]);
    box(seat, [ex - 0.32, sy, ez + 0.25], [0.12, 0.5, 0.75]);
    box(seat, [ex - 0.3, sy, ez - 0.08], [0.14, 0.28, 0.18]);
  }
  const nodes: NodeDef[] = [{ name: 'deck', parts: [shell, panelC, dark, glare, metal, seat, floor] }];
  const levers: Lever[] = [];
  // flight controls
  if (airbus) {
    for (const s of [-1, 1]) {
      const name = s < 0 ? 'stickL' : 'stickR';
      const piv: P3 = [ex + 0.28, s * (Math.abs(ey) + 0.36), ez + 0.48];
      const st = new Part('#202326', 0.2, 0.6);
      cyl(st, [0, 0, 0], [0.02, 0, -0.12], 0.018, 0.022, 10);
      cyl(st, [0.02, 0, -0.12], [0.04, 0, -0.2], 0.026, 0.02, 10);
      box(new Part('#555b61', 0.3, 0.5), [0, 0, 0.01], [0.08, 0.08, 0.02]);
      nodes.push({ name, parts: [st], translation: piv });
      levers.push({ node: name, kind: 'stick' });
    }
  } else {
    for (const s of [-1, 1]) {
      const name = s < 0 ? 'yokeL' : 'yokeR';
      const y0 = s * Math.abs(ey);
      cyl(dark, [ex + 0.62, y0, ez + 1.05], [ex + 0.56, y0, ez + 0.5], 0.035, 0.03, 8);
      const yk = new Part(boeingish ? '#2a2a2a' : '#1e1e1e', 0.2, 0.6);
      cyl(yk, [0.04, 0, 0], [-0.02, 0, 0], 0.03, 0.03, 8);
      cyl(yk, [0, -0.15, 0.02], [0, 0.15, 0.02], 0.016, 0.016, 8);
      cyl(yk, [0, -0.15, 0.02], [0, -0.17, -0.1], 0.02, 0.02, 8);
      cyl(yk, [0, 0.15, 0.02], [0, 0.17, -0.1], 0.02, 0.02, 8);
      box(yk, [0.01, 0, -0.01], [0.04, 0.12, 0.06]);
      nodes.push({ name, parts: [yk], translation: [ex + 0.52, y0, ez + 0.47] });
      levers.push({ node: name, kind: 'yoke' });
    }
  }
  const nThr = Math.max(1, Math.min(4, d.eng.n));
  for (let i = 0; i < nThr; i++) {
    const name = `thr${i}`;
    const y = (i - (nThr - 1) / 2) * 0.085;
    const tl = new Part('#1a1c1f', 0.2, 0.6);
    cyl(tl, [0, 0, 0], [0, 0, -0.17], 0.012, 0.012, 8);
    box(new Part(airbus ? '#2c2f33' : '#d9d9d9', 0.2, 0.5), [0, 0, -0.18], [0.04, 0.07, 0.035]);
    nodes.push({ name, parts: [tl], translation: [ex + 0.3, y, pedTop - 0.02] });
    levers.push({ node: name, kind: 'thr', idx: i });
  }
  // screens: Captain PFD/ND outboard→inboard, centre EICAS (+ lower), F/O mirrored; FCU on the glareshield
  const sz = 0.2, zc = ez + 0.43, ay = Math.abs(ey);
  const S = (src: Src, y: number, z = zc, w = sz, h = sz) => screen(src, onPanel(px, pz0, tilt, y, z, -0.032), w, h, tilt);
  const screens: ScreenDef[] = [
    S('pfd', -(ay + 0.12)), S('nd', -(ay - 0.12)), S('eicas', 0, zc - 0.01),
    S('nd', ay - 0.12), S('pfd', ay + 0.12),
    S('pfd', -0.17, zc + 0.08, 0.09, 0.09),
    { src: 'fcu', c: [px - 0.232, 0, pz0 - 0.025], r: [0, 1, 0], u: [0.4, 0, -0.92], w: 0.9, h: 0.085 },
    { src: 'ovh', c: [roofF[0] - 0.15 - (roofF[0] - 0.15 - (ex - 0.6)) / 2, 0, (roofF[2] + 0.05 + ez - 0.48) / 2 + 0.005], r: [0, 1, 0], u: [1, 0, 0.12], w: 0.98, h: Math.hypot(roofF[0] - 0.15 - (ex - 0.6), roofF[2] + 0.05 - (ez - 0.48)) * 0.96 },
  ];
  return { nodes, screens, levers };
}

// ───────────────────────── GA ─────────────────────────
function buildGa(ac: Aircraft, E: P3) {
  const d = ac.def;
  const [ex, ey, ez] = E;
  const W = Math.min(0.62, d.dia / 2 + 0.05);
  const shell = new Part('#b8b2a6', 0.0, 0.85);
  const panelC = new Part('#2b2e33', 0.05, 0.8);
  const dark = new Part('#18191b', 0.1, 0.7);
  const seat = new Part('#5a4e40', 0, 0.95);
  const tilt = 6, px = ex + 0.66, pz0 = ez + 0.12, pz1 = ez + 0.52;
  const P = (y: number, z: number) => onPanel(px, pz0, tilt, y, z, 0);
  slab(panelC, P(-W, pz0), P(W, pz0), P(W, pz1), P(-W, pz1), 0.03);
  slab(dark, [px - 0.12, -W, pz0 - 0.03], [px - 0.12, W, pz0 - 0.03], [px + 0.08, W, pz0 - 0.06], [px + 0.08, -W, pz0 - 0.06], 0.015);
  // cabin shell: side walls, door frames, roof, windscreen posts
  const sillZ = ez + 0.2, roofZ = ez - 0.28;
  for (const s of [-1, 1]) {
    face(shell, [px, s * W, pz1], [px, s * W, sillZ], [ex - 0.8, s * W, sillZ], [ex - 0.8, s * W, ez + 0.9]);
    face(shell, [px, s * W, pz1], [px, s * W, ez + 0.9], [ex - 0.8, s * W, ez + 0.9], [ex - 0.8, s * W, pz1]);
    post(shell, [px - 0.08, s * W * 0.98, pz0 - 0.04], [ex + 0.3, s * W * 0.9, roofZ], 0.035);
    post(shell, [ex - 0.25, s * W, sillZ], [ex - 0.25, s * W * 0.92, roofZ], 0.04);
  }
  face(shell, [ex + 0.32, -W, roofZ], [ex + 0.32, W, roofZ], [ex - 0.8, W, roofZ - 0.05], [ex - 0.8, -W, roofZ - 0.05]);
  face(dark, [px + 0.2, -W, ez + 0.9], [px + 0.2, W, ez + 0.9], [ex - 0.8, W, ez + 0.9], [ex - 0.8, -W, ez + 0.9]);
  for (const s of [-1, 1]) {
    const sy = s * Math.abs(ey);
    box(seat, [ex - 0.05, sy, ez + 0.55], [0.45, 0.42, 0.1]);
    box(seat, [ex - 0.3, sy, ez + 0.2], [0.1, 0.42, 0.65]);
  }
  const nodes: NodeDef[] = [{ name: 'deck', parts: [shell, panelC, dark, seat] }];
  const levers: Lever[] = [];
  const seats = d.seats === 1 || d.cat === 'glider' || d.id === 'extra330' || d.id === 'j3cub' ? [0] : [-1, 1];
  for (const s of seats) {
    const name = s <= 0 ? 'yokeL' : 'yokeR';
    const y0 = s * Math.abs(ey);
    const yk = new Part('#1c1c1c', 0.2, 0.6);
    if (d.id === 'sr22t' || d.cat === 'glider' || d.id === 'extra330' || d.id === 'j3cub' || d.cat === 'vintage') {
      // side-yoke / stick: a centre stick between the knees
      cyl(yk, [0, 0, 0], [0.02, 0, -0.3], 0.015, 0.02, 8);
      cyl(yk, [0.02, 0, -0.3], [0.03, 0, -0.38], 0.022, 0.018, 8);
      nodes.push({ name, parts: [yk], translation: [ex + 0.35, y0, ez + 0.75] });
      levers.push({ node: name, kind: 'stick' });
    } else {
      cyl(dark, [px - 0.01, y0, ez + 0.36], [ex + 0.4, y0, ez + 0.36], 0.018, 0.018, 8);
      cyl(yk, [0, -0.13, 0], [0, 0.13, 0], 0.014, 0.014, 8);
      cyl(yk, [0, -0.13, 0], [-0.01, -0.15, -0.08], 0.017, 0.017, 8);
      cyl(yk, [0, 0.13, 0], [-0.01, 0.15, -0.08], 0.017, 0.017, 8);
      box(yk, [0, 0, 0.0], [0.04, 0.1, 0.05]);
      nodes.push({ name, parts: [yk], translation: [ex + 0.4, y0, ez + 0.36] });
      levers.push({ node: name, kind: 'yoke' });
    }
  }
  const thr = new Part('#111', 0.2, 0.6);
  cyl(thr, [0, 0, 0], [-0.1, 0, 0], 0.006, 0.006, 6);
  cyl(thr, [-0.1, 0, 0], [-0.13, 0, 0], 0.02, 0.02, 10);
  nodes.push({ name: 'thr0', parts: [thr], translation: [px - 0.03, 0.0, ez + 0.44] });
  levers.push({ node: 'thr0', kind: 'thr', idx: 0 });
  const ay = Math.abs(ey) || 0.15;
  const S = (src: Src, y: number, z: number, w: number, h: number) => screen(src, onPanel(px, pz0, tilt, y, z, -0.032), w, h, tilt);
  const screens: ScreenDef[] = d.cockpit === 'steam'
    ? [S('six', -ay + 0.02, ez + 0.32, 0.36, 0.24), ...(d.cat === 'glider' ? [] : [S('nd', ay - 0.02, ez + 0.3, 0.18, 0.18)]), S('eicas', ay + 0.2, ez + 0.32, 0.14, 0.14)]
    : [S('pfd', -ay + 0.02, ez + 0.3, 0.26, 0.21), S('nd', ay - 0.02, ez + 0.3, 0.26, 0.21), S('eicas', 0.0, ez + 0.47, 0.1, 0.07)];
  return { nodes, screens, levers };
}

// ───────────────────────── fighter ─────────────────────────
function buildFighter(ac: Aircraft, E: P3) {
  const [ex, , ez] = E;
  const shell = new Part('#3e464d', 0.1, 0.8);
  const panelC = new Part('#262a2e', 0.05, 0.85);
  const glass = new Part('#2f6b4f', 0.0, 0.1, 0.18);
  const W = 0.4;
  const tilt = 20, px = ex + 0.62, pz0 = ez + 0.3, pz1 = ez + 0.62;
  const P = (y: number, z: number) => onPanel(px, pz0, tilt, y, z, 0);
  slab(panelC, P(-W, pz0), P(W, pz0), P(W, pz1), P(-W, pz1), 0.03);
  slab(shell, [px - 0.1, -W * 0.8, pz0 - 0.03], [px - 0.1, W * 0.8, pz0 - 0.03], [px + 0.1, W * 0.8, pz0 - 0.05], [px + 0.1, -W * 0.8, pz0 - 0.05], 0.015);
  for (const s of [-1, 1]) {
    box(shell, [ex - 0.1, s * (W - 0.07), ez + 0.55], [1.3, 0.14, 0.35]);
    face(shell, [px, s * W, ez + 0.3], [px, s * W, ez + 0.9], [ex - 0.8, s * W, ez + 0.9], [ex - 0.8, s * W, ez + 0.3]);
  }
  // canopy bow
  for (let i = 0; i < 10; i++) {
    const a0 = Math.PI * (i / 10) - Math.PI / 2, a1 = Math.PI * ((i + 1) / 10) - Math.PI / 2;
    post(shell, [px - 0.05, Math.sin(a0) * W, ez + 0.28 - Math.cos(a0) * 0.6], [px - 0.05, Math.sin(a1) * W, ez + 0.28 - Math.cos(a1) * 0.6], 0.025);
  }
  // HUD combiner
  face(glass, [px - 0.1, -0.09, pz0 - 0.06], [px - 0.1, 0.09, pz0 - 0.06], [px - 0.07, 0.09, pz0 - 0.2], [px - 0.07, -0.09, pz0 - 0.2]);
  const nodes: NodeDef[] = [{ name: 'deck', parts: [shell, panelC, glass] }];
  const st = new Part('#1b1b1b', 0.2, 0.6);
  cyl(st, [0, 0, 0], [0.02, 0, -0.16], 0.018, 0.02, 8);
  cyl(st, [0.02, 0, -0.16], [0.03, 0, -0.26], 0.026, 0.022, 8);
  const side = ac.def.id === 'f16' || ac.def.id === 'f35a';
  nodes.push({ name: 'stick', parts: [st], translation: side ? [ex + 0.2, W - 0.1, ez + 0.4] : [ex + 0.35, 0, ez + 0.62] });
  const th = new Part('#1b1b1b', 0.2, 0.6);
  cyl(th, [0, 0, 0], [0, 0, -0.12], 0.015, 0.015, 8);
  box(th, [0, 0, -0.14], [0.06, 0.05, 0.05]);
  nodes.push({ name: 'thr0', parts: [th], translation: [ex + 0.1, -(W - 0.1), ez + 0.38] });
  const S = (src: Src, y: number, z: number, w: number, h: number) => screen(src, onPanel(px, pz0, tilt, y, z, -0.032), w, h, tilt);
  const screens: ScreenDef[] = [S('pfd', -0.17, ez + 0.45, 0.16, 0.16), S('nd', 0.17, ez + 0.45, 0.16, 0.16), S('eicas', 0, ez + 0.53, 0.11, 0.11)];
  return { nodes, screens, levers: [{ node: 'stick', kind: 'stick' }, { node: 'thr0', kind: 'thr', idx: 0 }] as Lever[] };
}

// ───────────────────────── helicopter ─────────────────────────
function buildHeli(ac: Aircraft, E: P3) {
  const d = ac.def;
  const [ex, ey, ez] = E;
  const W = Math.min(0.95, d.dia / 2);
  const shell = new Part('#4a5157', 0.05, 0.8);
  const panelC = new Part('#24282c', 0.05, 0.85);
  const seat = new Part('#2e3237', 0, 0.95);
  const tilt = 25, px = ex + 0.72, pz0 = ez + 0.28, pz1 = ez + 0.62;
  const P = (y: number, z: number) => onPanel(px, pz0, tilt, y, z, 0);
  slab(panelC, P(-W * 0.85, pz0), P(W * 0.85, pz0), P(W * 0.85, pz1), P(-W * 0.85, pz1), 0.03);
  slab(shell, [px - 0.12, -W * 0.85, pz0 - 0.03], [px - 0.12, W * 0.85, pz0 - 0.03], [px + 0.1, W * 0.85, pz0 - 0.08], [px + 0.1, -W * 0.85, pz0 - 0.08], 0.02);
  const roofZ = ez - 0.45;
  post(shell, [px - 0.1, 0, pz0 - 0.05], [ex + 0.5, 0, roofZ], 0.03);
  for (const s of [-1, 1]) {
    post(shell, [px - 0.05, s * W * 0.85, pz0], [ex + 0.45, s * W, roofZ], 0.035);
    post(shell, [ex - 0.25, s * W, ez + 0.95], [ex - 0.25, s * W, roofZ], 0.045);
    post(shell, [px, s * W * 0.8, ez + 0.95], [ex - 0.25, s * W, ez + 0.95], 0.03);
    box(seat, [ex - 0.05, s * Math.abs(ey), ez + 0.6], [0.45, 0.45, 0.1]);
    box(seat, [ex - 0.3, s * Math.abs(ey), ez + 0.25], [0.1, 0.45, 0.7]);
  }
  face(shell, [ex + 0.5, -W, roofZ], [ex + 0.5, W, roofZ], [ex - 0.7, W, roofZ - 0.05], [ex - 0.7, -W, roofZ - 0.05]);
  slab(shell, [ex + 0.4, -0.2, roofZ + 0.04], [ex + 0.4, 0.2, roofZ + 0.04], [ex - 0.4, 0.2, roofZ + 0.06], [ex - 0.4, -0.2, roofZ + 0.06], 0.04);
  const nodes: NodeDef[] = [{ name: 'deck', parts: [shell, panelC, seat] }];
  const cy = new Part('#1b1b1b', 0.2, 0.6);
  cyl(cy, [0, 0, 0], [-0.03, 0, -0.42], 0.016, 0.02, 8);
  cyl(cy, [-0.03, 0, -0.42], [-0.02, 0, -0.52], 0.024, 0.02, 8);
  nodes.push({ name: 'cyclic', parts: [cy], translation: [ex + 0.4, ey, ez + 0.95] });
  const co = new Part('#1b1b1b', 0.2, 0.6);
  cyl(co, [0, 0, 0], [0.45, 0, -0.05], 0.018, 0.018, 8);
  cyl(co, [0.45, 0, -0.05], [0.55, 0, -0.06], 0.025, 0.025, 8);
  nodes.push({ name: 'coll', parts: [co], translation: [ex - 0.2, ey - 0.28, ez + 0.65] });
  const ay = Math.abs(ey);
  const S = (src: Src, y: number, z: number, w: number, h: number) => screen(src, onPanel(px, pz0, tilt, y, z, -0.032), w, h, tilt);
  const screens: ScreenDef[] = [S('pfd', -ay - 0.08, ez + 0.44, 0.2, 0.2), S('nd', -ay + 0.16, ez + 0.44, 0.2, 0.2), S('eicas', 0.14, ez + 0.44, 0.17, 0.17), S('pfd', ay + 0.2, ez + 0.44, 0.2, 0.2)];
  return { nodes, screens, levers: [{ node: 'cyclic', kind: 'stick' }, { node: 'coll', kind: 'coll' }] as Lever[] };
}

// ───────────────────────── textures drawn on canvases ─────────────────────────
function drawFcu(cv: HTMLCanvasElement, av: AvData, ac: Aircraft) {
  const g = cv.getContext('2d')!;
  const { fcs, sys } = av;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#2d3238'; g.fillRect(0, 0, cv.width, cv.height);
  const on = sys.avionicsPowered;
  const groups: [string, string][] = [
    ['SPD', fcs.spdIsMach ? fcs.selMach.toFixed(2) : String(fcs.selSpd)],
    ['HDG', String(fcs.selHdg).padStart(3, '0')],
    ['ALT', String(fcs.selAlt)],
    ['V/S', (fcs.selVs > 0 ? '+' : '') + fcs.selVs],
  ];
  const gw = 190;
  groups.forEach(([label, val], i) => {
    const x = 20 + i * (gw + 12);
    g.fillStyle = '#c9d1d9'; g.font = `bold 20px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'top';
    g.fillText(label, x + gw / 2, 6);
    g.fillStyle = '#050607'; g.fillRect(x, 32, gw, 60);
    if (on) { g.fillStyle = C.amber; g.font = `bold 38px ${FONT}`; g.textBaseline = 'middle'; g.fillText(val, x + gw / 2, 63); }
  });
  const lights: [string, boolean][] = [['AP', fcs.ap], ['A/THR', fcs.athr !== 'OFF'], ['LOC', fcs.lat === 'LOC' || fcs.latArmed === 'LOC'], ['APPR', fcs.vert === 'GS' || fcs.vertArmed === 'GS']];
  lights.forEach(([label, lit], i) => {
    const x = 830 + (i % 2) * 96, y = 14 + Math.floor(i / 2) * 56;
    g.fillStyle = '#1a1d21'; g.fillRect(x, y, 86, 46);
    g.fillStyle = '#c9d1d9'; g.font = `bold 17px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label, x + 43, y + 30);
    if (lit && on) { g.fillStyle = C.green; g.fillRect(x + 18, y + 6, 50, 6); }
  });
  void ac;
}

function drawOverhead(cv: HTMLCanvasElement, kind: string) {
  const g = cv.getContext('2d')!;
  const W = cv.width, H = cv.height;
  g.fillStyle = kind === 'airliner' ? '#4a5661' : '#3a3f45'; g.fillRect(0, 0, W, H);
  const panels = ['ADIRS', 'FLT CTL', 'EVAC', 'GPWS', 'RCDR', 'OXYGEN', 'CALLS', 'ELEC', 'HYD', 'FUEL', 'AIR COND', 'ANTI ICE', 'APU', 'EXT LT', 'INT LT', 'SIGNS', 'ENG', 'WIPER'];
  const cols = 6, rows = 3, pw = W / cols, ph = H / rows;
  let rnd = 7;
  const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
  panels.forEach((name, i) => {
    const x = (i % cols) * pw, y = Math.floor(i / cols) * ph;
    g.strokeStyle = '#2a3036'; g.lineWidth = 3; g.strokeRect(x + 4, y + 4, pw - 8, ph - 8);
    g.fillStyle = '#e8edf2'; g.font = `bold 15px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'top';
    g.fillText(name, x + pw / 2, y + 10);
    const n = 3 + Math.floor(rand() * 4);
    for (let k = 0; k < n; k++) {
      const bx = x + 18 + (k % 3) * ((pw - 36) / 3), by = y + 40 + Math.floor(k / 3) * 58;
      g.fillStyle = '#1b1f23'; g.fillRect(bx, by, 40, 34);
      g.fillStyle = rand() > 0.75 ? '#e0e6ea' : '#5b6670'; g.fillRect(bx + 6, by + 22, 28, 6);
      g.fillStyle = '#cfd6dc'; g.font = `11px ${FONT}`; g.fillText(['ON', 'AUTO', 'OFF', 'ARM', 'NORM'][Math.floor(rand() * 5)], bx + 20, by + 4);
    }
  });
}
