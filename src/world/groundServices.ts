// Ground services at the stand: a jet bridge or airstairs at the forward left door, and passengers walking
// across the apron and up the stairs while they board. Built in the aircraft's body frame (x forward,
// y right, z down, origin at the centre of gravity) and placed with the aircraft's heading on the ground.
import * as Cesium from 'cesium';
import { Part, box, cyl, writeGlb, type NodeDef, type P3 } from './modelBuilder.ts';
import type { Aircraft } from '../sim/fdm.ts';

export type Equipment = 'none' | 'jetway' | 'stairs';
const WALKERS = 14;

export class GroundServices {
  kind: Equipment = 'none';
  private model: Cesium.Model | null = null;
  private people: Cesium.Model | null = null;
  private path: P3[] = [];
  private phase = 0;
  private gen = 0;

  constructor(private scene: Cesium.Scene, private register: (objs: object[]) => void) {}

  /** Forward left passenger door (body frame) and the height of the centre of gravity above the ground. */
  private door(ac: Aircraft) {
    const d = ac.def, r = d.dia / 2;
    const h0 = Math.max(0.5, ac.alt - ac.groundH);
    const x = d.L / 2 - Math.max(3.5, d.L * 0.135);
    return { x, y: -r * 0.98, sill: Math.min(h0 - 0.3, r * 0.45), h0, r };
  }

  async connect(kind: Equipment, ac: Aircraft) {
    this.disconnect();
    if (kind === 'none') return;
    const gen = ++this.gen;
    const { x, y, sill, h0 } = this.door(ac);
    const nodes: NodeDef[] = [];
    const metal = new Part('#c9ced3', 0.5, 0.45), dark = new Part('#3a3f45', 0.3, 0.6), glass = new Part('#1d2a35', 0.4, 0.2);
    const yellow = new Part('#e8b923', 0.2, 0.5), rubber = new Part('#151515', 0, 0.9);
    const ground = h0;  // body z of the apron
    if (kind === 'jetway') {
      // cab against the door, telescoping tunnel to the rotunda towards the terminal, a wheeled leg under it
      const floor = sill;                        // cab floor level with the door sill
      const cab: P3 = [x, y - 2.0, floor - 1.35];
      box(metal, cab, [3.2, 3.2, 2.9]);
      box(dark, [x, y - 0.35, floor - 1.2], [2.6, 0.5, 2.5]);  // bellows canopy around the door
      const rot: P3 = [x + 9, y - 30, ground - 4.6];
      cyl(metal, [cab[0], cab[1] - 1.5, cab[2]], [rot[0], rot[1] + 2, rot[2]], 1.55, 1.55, 4);
      cyl(glass, [cab[0] + 0.1, cab[1] - 1.6, cab[2] - 0.2], [rot[0] + 0.1, rot[1] + 2.1, rot[2] - 0.2], 1.25, 1.25, 4, false, false);
      cyl(metal, rot, [rot[0], rot[1], rot[2] - 3.2], 2.4, 2.4, 16);          // rotunda
      cyl(dark, [rot[0], rot[1], rot[2]], [rot[0], rot[1], ground], 0.7, 0.7, 12); // its column
      const mid: P3 = [(cab[0] + rot[0]) / 2, (cab[1] + rot[1]) / 2, (cab[2] + rot[2]) / 2 + 1.6];
      cyl(dark, mid, [mid[0], mid[1], ground - 0.6], 0.25, 0.25, 8);         // drive leg
      box(yellow, [mid[0], mid[1], ground - 0.5], [3.2, 1.2, 0.6]);            // drive bogie
      for (const s of [-1, 1]) cyl(rubber, [mid[0] + s * 1.2, mid[1] - 0.5, ground - 0.4], [mid[0] + s * 1.2, mid[1] + 0.5, ground - 0.4], 0.4, 0.4, 12);
    } else {
      // airstairs truck: stairs rising to the sill, platform with rails, chassis on the apron
      const rise = Math.max(0.6, ground - sill), run = rise / Math.tan(36 * Math.PI / 180);
      const n = Math.max(3, Math.round(rise / 0.19));
      const y0 = y - 0.9;                        // top of the stairs, just off the fuselage
      box(metal, [x, y0 + 0.2, sill + 0.05], [1.9, 1.4, 0.1]);   // platform
      for (let i = 1; i <= n; i++) box(metal, [x, y0 - (i / n) * run, sill + (i / n) * rise], [1.6, run / n + 0.04, 0.06]);
      for (const s of [-1, 1]) {
        const xs = x + s * 0.85;
        cyl(dark, [xs, y0, sill - 1.0], [xs, y0 - run, sill + rise - 1.0], 0.04, 0.04, 6);   // handrails
        cyl(dark, [xs, y0 + 0.8, sill - 1.0], [xs, y0, sill - 1.0], 0.04, 0.04, 6);
        cyl(metal, [xs, y0, sill + 0.1], [xs, y0 - run, ground - 0.6], 0.07, 0.07, 6);        // stringers
      }
      box(yellow, [x, y0 - run * 0.55, ground - 0.75], [2.2, run * 1.25 + 2.2, 0.8]);  // truck body
      box(glass, [x, y0 - run - 1.2, ground - 1.6], [2.0, 1.4, 1.1]);                  // cab
      for (const s of [-1, 1]) for (const t of [0.15, 0.95]) cyl(rubber, [x + s * 1.1, y0 - run * t, ground - 0.4], [x + s * 1.3, y0 - run * t, ground - 0.4], 0.4, 0.4, 12);
      // where the walkers go: from the terminal side across the apron, up the stairs, in at the door
      this.path = [[x - 6, y0 - run - 30, ground], [x - 2, y0 - run - 8, ground], [x, y0 - run - 0.5, ground], [x, y0, sill], [x, y + 0.5, sill]];
    }
    nodes.push({ name: 'equip', parts: [metal, dark, glass, yellow, rubber] });
    const url = URL.createObjectURL(new Blob([writeGlb(nodes)], { type: 'model/gltf-binary' }));
    const model = await Cesium.Model.fromGltfAsync({ url, shadows: Cesium.ShadowMode.ENABLED });
    if (gen !== this.gen) { model.destroy(); return; }
    this.model = this.scene.primitives.add(model);
    this.kind = kind;
    if (kind === 'stairs') {
      // a handful of passengers (one node each, moved along the path)
      const pn: NodeDef[] = [];
      const shirts = ['#2f5d9b', '#b23a48', '#3c8d5a', '#d9a23b', '#6b4f9e', '#e0e0e0', '#2b2b2b'];
      for (let i = 0; i < WALKERS; i++) {
        const body = new Part(shirts[i % shirts.length], 0, 0.8), skin = new Part('#d8b08c', 0, 0.7), legs = new Part('#22252a', 0, 0.8);
        cyl(legs, [0, 0, 0], [0, 0, -0.85], 0.16, 0.16, 8);
        cyl(body, [0, 0, -0.85], [0, 0, -1.5], 0.22, 0.2, 8);
        cyl(skin, [0, 0, -1.52], [0, 0, -1.75], 0.11, 0.11, 8);
        box(legs, [-0.05, 0.3, -0.25], [0.35, 0.25, 0.45]);   // roller bag
        pn.push({ name: `p${i}`, parts: [legs, body, skin], translation: [0, 0, 0] });
      }
      const purl = URL.createObjectURL(new Blob([writeGlb(pn)], { type: 'model/gltf-binary' }));
      const people = await Cesium.Model.fromGltfAsync({ url: purl, shadows: Cesium.ShadowMode.ENABLED });
      if (gen !== this.gen) { people.destroy(); return; }
      this.people = this.scene.primitives.add(people);
    }
    this.register([this.model, this.people].filter(Boolean) as object[]);
  }

  disconnect() {
    this.gen++;
    if (this.model) { this.scene.primitives.remove(this.model); this.model = null; }
    if (this.people) { this.scene.primitives.remove(this.people); this.people = null; }
    this.kind = 'none';
    this.register([]);
  }

  /** Follow the parked aircraft (ground fit can still settle) and walk the boarding passengers. */
  update(ac: Aircraft, aircraftMatrix: Cesium.Matrix4, dt: number, boarding: boolean) {
    if (!this.model) return;
    Cesium.Matrix4.clone(aircraftMatrix, this.model.modelMatrix);
    const pm = this.people;
    if (!pm) return;
    Cesium.Matrix4.clone(aircraftMatrix, pm.modelMatrix);
    pm.show = boarding;
    if (!boarding || !pm.ready || this.path.length < 2) return;
    this.phase += dt;
    // cumulative path length
    const seg = this.path.slice(1).map((p, i) => Math.hypot(p[0] - this.path[i][0], p[1] - this.path[i][1], p[2] - this.path[i][2]));
    const total = seg.reduce((s, v) => s + v, 0), speed = 1.3;
    for (let i = 0; i < WALKERS; i++) {
      const n = pm.getNode(`p${i}`);
      if (!n) continue;
      const along = ((this.phase * speed + (i * total) / WALKERS) % total);
      let k = 0, d = along;
      while (k < seg.length - 1 && d > seg[k]) { d -= seg[k]; k++; }
      const a = this.path[k], b = this.path[k + 1], f = Math.min(1, d / (seg[k] || 1));
      const p: P3 = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
      // walking bob; body frame -> glTF (x left, y up, z forward)
      const bob = Math.abs(Math.sin(this.phase * 6 + i)) * 0.04;
      n.matrix = Cesium.Matrix4.fromTranslation(new Cesium.Cartesian3(-p[1], -p[2] + bob, p[0]));
      n.show = k < seg.length - 1 || f < 0.95;
    }
    void ac;
  }
}
