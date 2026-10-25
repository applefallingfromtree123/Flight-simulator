// Minimal GLB 2.0 writer: meshes with multiple primitives, PBR materials, embedded images.
export class GlbWriter {
  constructor() {
    this.json = { asset: { version: '2.0', generator: 'SkyLine fgconv' }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [],
      materials: [], textures: [], images: [], samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
      accessors: [], bufferViews: [], buffers: [{ byteLength: 0 }], extensionsUsed: [] };
    this.chunks = []; this.length = 0;
  }
  view(buf, target) {
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) { this.chunks.push(Buffer.alloc(pad)); this.length += pad; }
    const b = Buffer.from(buf.buffer ?? buf, buf.byteOffset ?? 0, buf.byteLength ?? buf.length);
    this.json.bufferViews.push({ buffer: 0, byteOffset: this.length, byteLength: b.length, ...(target ? { target } : {}) });
    this.chunks.push(b); this.length += b.length;
    return this.json.bufferViews.length - 1;
  }
  accessor(arr, type, componentType, target, minmax = false) {
    const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[type];
    const acc = { bufferView: this.view(arr, target), componentType, count: arr.length / n, type };
    if (minmax) {
      const min = Array(n).fill(Infinity), max = Array(n).fill(-Infinity);
      for (let i = 0; i < arr.length; i++) { const c = i % n; if (arr[i] < min[c]) min[c] = arr[i]; if (arr[i] > max[c]) max[c] = arr[i]; }
      acc.min = min; acc.max = max;
    }
    this.json.accessors.push(acc);
    return this.json.accessors.length - 1;
  }
  image(bytes, mimeType, name) {
    this.json.images.push({ bufferView: this.view(bytes), mimeType, name });
    this.json.textures.push({ source: this.json.images.length - 1, sampler: 0 });
    return this.json.textures.length - 1;
  }
  material(m) { this.json.materials.push(m); return this.json.materials.length - 1; }
  mesh(name, prims) {
    const primitives = prims.map(p => ({
      attributes: {
        POSITION: this.accessor(p.pos, 'VEC3', 5126, 34962, true),
        NORMAL: this.accessor(p.nrm, 'VEC3', 5126, 34962),
        TEXCOORD_0: this.accessor(p.uv, 'VEC2', 5126, 34962),
      },
      indices: this.accessor(p.idx, 'SCALAR', 5125, 34963),
      material: p.material,
    }));
    this.json.meshes.push({ name, primitives });
    return this.json.meshes.length - 1;
  }
  node(n, root = true) { this.json.nodes.push(n); const i = this.json.nodes.length - 1; if (root) this.json.scenes[0].nodes.push(i); return i; }
  toBuffer() {
    const j = this.json;
    j.buffers[0].byteLength = this.length;
    for (const k of ['textures', 'images', 'extensionsUsed']) if (!j[k].length) delete j[k];
    if (!j.textures) delete j.samplers;
    let js = Buffer.from(JSON.stringify(j));
    js = Buffer.concat([js, Buffer.alloc((4 - js.length % 4) % 4, 0x20)]);
    let bin = Buffer.concat(this.chunks);
    bin = Buffer.concat([bin, Buffer.alloc((4 - bin.length % 4) % 4)]);
    const h = Buffer.alloc(12); h.writeUInt32LE(0x46546c67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
    const ch = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
    return Buffer.concat([h, ch(js.length, 0x4e4f534a), js, ch(bin.length, 0x004e4942), bin]);
  }
}
