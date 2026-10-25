// Turns assembled FG parts into per-material triangle buckets in glTF space (+Y up, +Z nose, +X left).
const fgToGltf = (x, y, z) => [-y, z, -x];

export function buildBuckets(parts, materialKeyOf) {
  const buckets = new Map(); // key -> { key, interior, mat, pos:[], nrm:[], uv:[], idx:[] }
  let tris = 0;
  for (const p of parts) {
    const o = p.obj, m = p.matrix, nv = o.verts.length / 3;
    // world positions in glTF space
    const P = new Float64Array(nv * 3);
    for (let i = 0; i < nv; i++) {
      const w = xf(m, o.verts[i * 3], o.verts[i * 3 + 1], o.verts[i * 3 + 2]);
      const g = fgToGltf(w[0], w[1], w[2]);
      P[i * 3] = g[0]; P[i * 3 + 1] = g[1]; P[i * 3 + 2] = g[2];
    }
    // triangulate every polygon surface
    const faces = []; // { surf, tri:[ref,ref,ref], n:[x,y,z] }
    for (const s of o.surfs) {
      if ((s.flags & 0xf) !== 0 || s.refs.length < 3) continue;
      const refs = s.refs.filter(r => r[0] < nv);
      for (const t of triangulate(refs, P)) {
        const n = faceNormal(P, t[0][0], t[1][0], t[2][0]);
        if (!n) continue;
        faces.push({ s, t, n });
      }
    }
    if (!faces.length) continue;
    // vertex -> faces (smooth surfaces only) for crease-limited smoothing
    const vf = new Map();
    faces.forEach((f, fi) => { if (f.s.flags & 0x10) for (const r of f.t) { let a = vf.get(r[0]); if (!a) vf.set(r[0], a = []); a.push(fi); } });
    const cosCrease = Math.cos((o.crease ?? 61) * Math.PI / 180);
    const local = new Map();
    for (const f of faces) {
      const key = materialKeyOf(p, f.s);
      if (key == null) continue;
      let b = buckets.get(key.id);
      if (!b) { b = { ...key, pos: [], nrm: [], uv: [], idx: [], count: 0 }; buckets.set(key.id, b); }
      let lmap = local.get(b); if (!lmap) local.set(b, lmap = new Map());
      tris++;
      for (const r of f.t) {
        let n = f.n;
        if (f.s.flags & 0x10) {
          let sx = 0, sy = 0, sz = 0;
          for (const fi of vf.get(r[0])) { const g = faces[fi].n; if (g[0] * n[0] + g[1] * n[1] + g[2] * n[2] >= cosCrease) { sx += g[0]; sy += g[1]; sz += g[2]; } }
          const l = Math.hypot(sx, sy, sz); if (l > 1e-9) n = [sx / l, sy / l, sz / l];
        }
        const u = r[1] * o.texrep[0] + o.texoff[0], v = 1 - (r[2] * o.texrep[1] + o.texoff[1]);
        const k = `${r[0]}|${n[0].toFixed(3)},${n[1].toFixed(3)},${n[2].toFixed(3)}|${u.toFixed(5)},${v.toFixed(5)}`;
        let vi = lmap.get(k);
        if (vi === undefined) {
          vi = b.count++; lmap.set(k, vi);
          b.pos.push(P[r[0] * 3], P[r[0] * 3 + 1], P[r[0] * 3 + 2]); b.nrm.push(n[0], n[1], n[2]); b.uv.push(u, v);
        }
        b.idx.push(vi);
      }
    }
  }
  return { buckets: [...buckets.values()], tris };
}

function xf(m, x, y, z) {
  return [x * m[0] + y * m[4] + z * m[8] + m[12], x * m[1] + y * m[5] + z * m[9] + m[13], x * m[2] + y * m[6] + z * m[10] + m[14]];
}
function faceNormal(P, a, b, c) {
  const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
  const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz);
  return l < 1e-12 ? null : [nx / l, ny / l, nz / l];
}

/** Ear clipping on the polygon's dominant plane; falls back to a fan for degenerate input. */
function triangulate(refs, P) {
  const n = refs.length;
  if (n === 3) return [refs];
  if (n === 4) {
    // split along the shorter diagonal unless that produces a fold
    return [[refs[0], refs[1], refs[2]], [refs[0], refs[2], refs[3]]];
  }
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < n; i++) {
    const a = refs[i][0] * 3, b = refs[(i + 1) % n][0] * 3;
    nx += (P[a + 1] - P[b + 1]) * (P[a + 2] + P[b + 2]); ny += (P[a + 2] - P[b + 2]) * (P[a] + P[b]); nz += (P[a] - P[b]) * (P[a + 1] + P[b + 1]);
  }
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  const [i0, i1, sign] = ax >= ay && ax >= az ? [1, 2, Math.sign(nx)] : ay >= az ? [2, 0, Math.sign(ny)] : [0, 1, Math.sign(nz)];
  const pts = refs.map(r => [P[r[0] * 3 + i0] * (sign || 1), P[r[0] * 3 + i1]]);
  const idx = refs.map((_, i) => i), out = [];
  const cross = (a, b, c) => (pts[b][0] - pts[a][0]) * (pts[c][1] - pts[a][1]) - (pts[b][1] - pts[a][1]) * (pts[c][0] - pts[a][0]);
  const inside = (p, a, b, c) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i + idx.length - 1) % idx.length], b = idx[i], c = idx[(i + 1) % idx.length];
      if (cross(a, b, c) <= 0) continue;
      if (idx.some(j => j !== a && j !== b && j !== c && inside(j, a, b, c))) continue;
      out.push([refs[a], refs[b], refs[c]]); idx.splice(i, 1); clipped = true; break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) out.push(idx.map(i => refs[i]));
  else if (idx.length > 3) for (let i = 1; i < idx.length - 1; i++) out.push([refs[idx[0]], refs[idx[i]], refs[idx[i + 1]]]);
  return out;
}
