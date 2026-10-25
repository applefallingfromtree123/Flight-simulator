// Autodesk .3ds reader → same object/material shape as ac3d.mjs (coordinates already in FG model space).
export function parse3ds(buf) {
  const materials = [], matIndex = new Map(), objects = [];
  const cstr = (p) => { let e = p; while (buf[e]) e++; return [buf.toString('latin1', p, e), e + 1]; };
  const color = (p, end) => {
    while (p < end) {
      const id = buf.readUInt16LE(p), len = buf.readUInt32LE(p + 2);
      if (id === 0x0011 || id === 0x0012) return [buf[p + 6] / 255, buf[p + 7] / 255, buf[p + 8] / 255];
      if (id === 0x0010 || id === 0x0013) return [buf.readFloatLE(p + 6), buf.readFloatLE(p + 10), buf.readFloatLE(p + 14)];
      p += len;
    }
    return null;
  };
  const pct = (p, end) => {
    while (p < end) {
      const id = buf.readUInt16LE(p), len = buf.readUInt32LE(p + 2);
      if (id === 0x0030) return buf.readUInt16LE(p + 6) / 100;
      if (id === 0x0031) return buf.readFloatLE(p + 6);
      p += len;
    }
    return 0;
  };
  function walk(p, end, ctx) {
    while (p + 6 <= end) {
      const id = buf.readUInt16LE(p), len = buf.readUInt32LE(p + 2);
      if (len < 6) break;
      const body = p + 6, cend = Math.min(p + len, end);
      switch (id) {
        case 0x4d4d: case 0x3d3d: walk(body, cend, ctx); break;
        case 0xafff: { const m = { name: '', rgb: [0.8, 0.8, 0.8], amb: [0.2, 0.2, 0.2], emis: [0, 0, 0], spec: [0, 0, 0], shi: 0, trans: 0, texture: null }; walk(body, cend, { mat: m }); matIndex.set(m.name, materials.length); materials.push(m); break; }
        case 0xa000: ctx.mat.name = cstr(body)[0]; break;
        case 0xa010: ctx.mat.amb = color(body, cend) ?? ctx.mat.amb; break;
        case 0xa020: ctx.mat.rgb = color(body, cend) ?? ctx.mat.rgb; break;
        case 0xa030: ctx.mat.spec = color(body, cend) ?? ctx.mat.spec; break;
        case 0xa050: ctx.mat.trans = pct(body, cend); break;
        case 0xa200: walk(body, cend, ctx); break;
        case 0xa300: ctx.mat.texture = cstr(body)[0]; break;
        case 0x4000: {
          const [name, q] = cstr(body);
          const obj = { kind: 'poly', name, loc: [0, 0, 0], rot: null, verts: new Float64Array(0), uvs: null, surfs: [], texture: null, texrep: [1, 1], texoff: [0, 0], crease: 30, kids: [], faceMats: [] };
          walk(q, cend, { obj });
          if (obj.verts.length) objects.push(obj);
          break;
        }
        case 0x4100: walk(body, cend, ctx); break;
        case 0x4110: { const n = buf.readUInt16LE(body); const v = new Float64Array(n * 3); for (let i = 0; i < n * 3; i++) v[i] = buf.readFloatLE(body + 2 + i * 4); ctx.obj.verts = v; break; }
        case 0x4140: { const n = buf.readUInt16LE(body); const uv = new Float64Array(n * 2); for (let i = 0; i < n * 2; i++) uv[i] = buf.readFloatLE(body + 2 + i * 4); ctx.obj.uvs = uv; break; }
        case 0x4120: {
          const n = buf.readUInt16LE(body);
          const faces = [];
          for (let i = 0; i < n; i++) faces.push([buf.readUInt16LE(body + 2 + i * 8), buf.readUInt16LE(body + 4 + i * 8), buf.readUInt16LE(body + 6 + i * 8)]);
          ctx.obj.faces = faces;
          walk(body + 2 + n * 8, cend, ctx);
          break;
        }
        case 0x4130: {
          const [mname, q] = cstr(body); const n = buf.readUInt16LE(q);
          const list = []; for (let i = 0; i < n; i++) list.push(buf.readUInt16LE(q + 2 + i * 2));
          ctx.obj.faceMats.push([mname, list]);
          break;
        }
      }
      p += len;
    }
  }
  walk(0, buf.length, {});
  // Convert faces into AC3D-style surfaces. 3DS stores per-vertex UVs and one material per face.
  for (const o of objects) {
    const fm = new Int32Array(o.faces?.length ?? 0).fill(-1);
    for (const [name, list] of o.faceMats) { const mi = matIndex.get(name) ?? -1; for (const f of list) fm[f] = mi; }
    for (let i = 0; i < (o.faces?.length ?? 0); i++) {
      const f = o.faces[i];
      const mi = fm[i];
      const uv = k => o.uvs ? [o.uvs[k * 2], o.uvs[k * 2 + 1]] : [0, 0];
      o.surfs.push({ flags: 0x10, mat: mi < 0 ? 0 : mi, refs: f.map(k => [k, ...uv(k)]), texture: mi >= 0 ? materials[mi].texture : null });
    }
    delete o.faces; delete o.faceMats; delete o.uvs;
  }
  if (!materials.length) materials.push({ name: 'default', rgb: [0.8, 0.8, 0.8], amb: [0.2, 0.2, 0.2], emis: [0, 0, 0], spec: [0, 0, 0], shi: 0, trans: 0, texture: null });
  return { materials, root: { kind: 'world', name: '', loc: [0, 0, 0], rot: null, verts: new Float64Array(0), surfs: [], kids: objects, texrep: [1, 1], texoff: [0, 0], crease: 30 }, fgSpace: true };
}
