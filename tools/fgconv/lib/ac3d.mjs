// AC3D (.ac) reader. Produces { materials, root } where root is an object tree in AC3D space.
export function parseAc(text) {
  const lines = text.split(/\r?\n/);
  let li = 0;
  const next = () => { while (li < lines.length) { const l = lines[li++].trim(); if (l) return l; } return null; };
  const header = next();
  if (!header?.startsWith('AC3D')) throw new Error('not an AC3D file');
  const materials = [];
  const tok = l => l.match(/"[^"]*"|\S+/g) ?? [];
  const unq = s => s?.startsWith('"') ? s.slice(1, -1) : s;

  function readObject(first) {
    const obj = { kind: tok(first)[1], name: '', loc: [0, 0, 0], rot: null, verts: [], surfs: [], texture: null,
      texrep: [1, 1], texoff: [0, 0], crease: 61, kids: [], hidden: false };
    for (;;) {
      const l = next();
      if (l == null) return obj;
      const t = tok(l);
      switch (t[0]) {
        case 'name': obj.name = unq(l.slice(5).trim()); break;
        case 'data': { const n = +t[1]; let s = ''; while (s.length < n && li < lines.length) s += (s ? '\n' : '') + lines[li++]; break; }
        case 'texture': obj.texture = unq(l.slice(8).trim()); break;
        case 'texrep': obj.texrep = [+t[1], +t[2]]; break;
        case 'texoff': obj.texoff = [+t[1], +t[2]]; break;
        case 'rot': obj.rot = t.slice(1, 10).map(Number); break;
        case 'loc': obj.loc = t.slice(1, 4).map(Number); break;
        case 'crease': obj.crease = +t[1]; break;
        case 'hidden': obj.hidden = true; break;
        case 'url': case 'subdiv': case 'folded': case 'locked': break;
        case 'numvert': {
          const n = +t[1];
          obj.verts = new Float64Array(n * 3);
          for (let i = 0; i < n; i++) { const v = next().split(/\s+/); obj.verts[i * 3] = +v[0]; obj.verts[i * 3 + 1] = +v[1]; obj.verts[i * 3 + 2] = +v[2]; }
          break;
        }
        case 'numsurf': {
          const n = +t[1];
          for (let s = 0; s < n; s++) {
            const surf = { flags: 0, mat: 0, refs: [] };
            for (;;) {
              const sl = next(); const st = tok(sl);
              if (st[0] === 'SURF') surf.flags = parseInt(st[1], 16) || parseInt(st[1]) || 0;
              else if (st[0] === 'mat') surf.mat = +st[1];
              else if (st[0] === 'refs') {
                const r = +st[1];
                for (let k = 0; k < r; k++) { const v = next().split(/\s+/); surf.refs.push([+v[0], +(v[1] ?? 0), +(v[2] ?? 0)]); }
                break;
              }
            }
            obj.surfs.push(surf);
          }
          break;
        }
        case 'kids': {
          const n = +t[1];
          for (let k = 0; k < n; k++) { const kl = next(); if (kl == null) break; obj.kids.push(readObject(kl)); }
          return obj;
        }
      }
    }
  }

  let root = null;
  for (;;) {
    const l = next();
    if (l == null) break;
    if (l.startsWith('MATERIAL')) {
      const g = (k, n) => { const m = l.match(new RegExp(`\\b${k}\\s+([-\\d.eE+]+)${n > 1 ? '\\s+([-\\d.eE+]+)\\s+([-\\d.eE+]+)' : ''}`)); return m ? m.slice(1, 1 + n).map(Number) : null; };
      materials.push({
        name: unq(tok(l)[1]),
        rgb: g('rgb', 3) ?? [0.8, 0.8, 0.8], amb: g('amb', 3) ?? [0.2, 0.2, 0.2], emis: g('emis', 3) ?? [0, 0, 0],
        spec: g('spec', 3) ?? [0, 0, 0], shi: (g('shi', 1) ?? [0])[0], trans: (g('trans', 1) ?? [0])[0],
      });
    } else if (l.startsWith('OBJECT')) { root = readObject(l); break; }
  }
  return { materials, root };
}
