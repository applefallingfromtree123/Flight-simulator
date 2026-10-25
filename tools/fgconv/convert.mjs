#!/usr/bin/env node
// FlightGear aircraft → glTF (GLB) + real-world livery textures + manifest, for the SkyLine Unreal project.
//
//   node tools/fgconv/convert.mjs                 # every aircraft in catalog.json
//   node tools/fgconv/convert.mjs b777-300er a320 # selected ids
//   options: --out <dir> --cache <dir> --max-tex 4096 --no-interior --offline --liveries <n>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { FGFS, normalize, pool } from './lib/fgfs.mjs';
import { readProps, PNode } from './lib/props.mjs';
import { loadModel, makeState, POSE_GROUPS } from './lib/model.mjs';
import { buildBuckets } from './lib/mesh.mjs';
import { GlbWriter } from './lib/gltf.mjs';
import { decode, sniff, encodePng, opaqueCopy } from './lib/image.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : d; };
const flag = k => { const i = args.indexOf(k); if (i >= 0) args.splice(i, 1); return i >= 0; };
// --profile ipad: smaller textures and a curated set so the iPad app stays within memory and bundle limits.
const PROFILE = opt('--profile', 'pc');
const IPAD = PROFILE === 'ipad';
const OUT = path.resolve(opt('--out', path.join(repo, 'Unreal/SkyLine/Aircraft')));
const CACHE = path.resolve(opt('--cache', path.join(repo, '.fgcache')));
const MAX_TEX = +opt('--max-tex', IPAD ? 1024 : 4096);
const MAX_LIVERIES = +opt('--liveries', IPAD ? 12 : 1000);
const NO_INTERIOR = flag('--no-interior');
const OFFLINE = flag('--offline');
const catalog = JSON.parse(fs.readFileSync(path.join(here, 'catalog.json'), 'utf8'));
const ids = args.length ? args : catalog.aircraft.filter(a => !IPAD || a.ipad).map(a => a.id);

const fg = new FGFS(CACHE, { offline: OFFLINE, log: s => process.stdout.write(s + '\n') });

for (const id of ids) {
  const entry = catalog.aircraft.find(a => a.id === id);
  if (!entry) { console.error(`unknown aircraft id ${id}`); process.exitCode = 1; continue; }
  const t0 = Date.now();
  try { await convert(entry); }
  catch (e) { console.error(`✗ ${id}: ${e.stack}`); process.exitCode = 1; }
  console.log(`  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}

async function convert(entry) {
  const acDir = `Aircraft/${entry.dir}`;
  console.log(`\n▶ ${entry.id} — ${entry.name} (${acDir}/${entry.set})`);
  if (entry.git) {
    // Aircraft developed outside FGAddon (e.g. the C172P team's repository).
    const local = fg.local(acDir);
    if (!fs.existsSync(path.join(local, entry.set)) && !OFFLINE) {
      console.log(`  cloning ${entry.git}`);
      fs.rmSync(local, { recursive: true, force: true });
      execFileSync('git', ['clone', '--depth', '1', '--quiet', entry.git, local], { stdio: 'inherit' });
    }
  } else if (!OFFLINE) {
    const n = await fg.mirror(acDir);
    console.log(`  mirrored ${n} files`);
  }

  const setTree = new PNode('PropertyList');
  await readProps(fg, `${acDir}/${entry.set}`, setTree, { aircraftDir: acDir });
  let modelPath = entry.model ?? setTree.str('sim/model/path');
  if (!modelPath) throw new Error('no sim/model/path in set file');
  if (!modelPath.startsWith('Aircraft/') && await fg.exists(`${acDir}/${modelPath}`)) modelPath = `${acDir}/${modelPath}`;
  const state = makeState(setTree);
  for (const [k, v] of Object.entries(entry.props ?? {})) { const g = state.get; state.get = p => (p.replace(/^\//, '') === k ? v : g(p)); }

  const load = () => loadModel(fg, modelPath, { state, aircraftDir: acDir, includeInterior: !NO_INTERIOR, log: s => console.log(s) });
  let model = await load();

  // ---------- liveries ----------
  const liveries = await findLiveries(entry, model, setTree, acDir);
  const def = liveries.find(l => entry.defaultLivery && (l.id === entry.defaultLivery || l.name === entry.defaultLivery)) ?? liveries[0];
  if (def) {
    // Liveries also set properties (operator, variant flags) that select geometry; rebuild with the default applied.
    state.overlay = def.tree;
    model = await load();
  }
  // Only slots that liveries actually repaint are livery slots; the rest (EFB pages, stairs) are static textures.
  for (const p of model.parts) if (p.slot && !liveries.some(l => l.textures.has(p.slot.key))) { p.texOverride = p.slot.defaultTex; p.slot = null; }
  model.slots = model.slots.filter(s => liveries.some(l => l.textures.has(s.key))).map((s, i) => Object.assign(s, { index: i }));
  console.log(`  ${model.parts.length} visible objects, ${model.instances.length} model files, ${model.slots.length} livery slot(s), ${liveries.length} liveries`);

  // ---------- textures ----------
  const texResolve = new Map();
  const resolveTex = async (name, dir, quiet = false) => {
    if (!name) return null;
    const k = `${dir}|${name}`;
    if (texResolve.has(k)) return texResolve.get(k);
    let f = await model.resolve(name, dir);
    if (!f) for (const ext of ['.png', '.rgb', '.dds', '.jpg', '.rgba', '.sgi']) {
      f = await model.resolve(name.replace(/\.[^./\\]+$/, ext), dir); if (f) break;
    }
    if (!f && !quiet) console.log(`  ? texture not found: ${name} (in ${dir})`);
    texResolve.set(k, f); return f;
  };
  for (const p of model.parts) {
    p.texFiles = new Map();
    for (const s of p.obj.surfs) {
      const name = s.texture ?? p.obj.texture;
      if (name && !p.texFiles.has(name)) {
        let f = null;
        for (const d of p.texDirs) if (!f) f = await resolveTex(name, d, d !== p.texDirs.at(-1));
        p.texFiles.set(name, f);
      }
    }
  }

  const imgCache = new Map();
  const loadImage = async (file) => {
    if (imgCache.has(file)) return imgCache.get(file);
    const buf = await fg.read(file);
    let rec = null;
    if (buf) {
      const kind = sniff(buf);
      if (kind === 'jpeg') rec = { buf, mime: 'image/jpeg', img: null, alpha: { kind: 'opaque' } };
      else { const img = decode(buf); if (img) rec = { buf: kind === 'png' ? buf : null, mime: 'image/png', img: downscale(img, MAX_TEX), alpha: alphaStats(img), resized: img.w > MAX_TEX || img.h > MAX_TEX }; }
    }
    imgCache.set(file, rec); return rec;
  };

  // ---------- materials ----------
  const gw = new GlbWriter();
  const texIndex = new Map();
  const embed = async (file, opaque) => {
    const k = `${file}|${opaque}`;
    if (texIndex.has(k)) return texIndex.get(k);
    const rec = await loadImage(file);
    let idx = null;
    if (rec) {
      const needsReencode = !rec.buf || rec.resized || (opaque && rec.alpha.kind !== 'opaque');
      const bytes = rec.mime === 'image/jpeg' ? rec.buf : needsReencode ? encodePng(opaque ? opaqueCopy(rec.img) : rec.img, { alpha: !opaque }) : rec.buf;
      idx = gw.image(bytes, rec.mime, path.posix.basename(file));
    }
    texIndex.set(k, idx); return idx;
  };

  const slotTex = new Map();
  for (const s of model.slots) slotTex.set(s, def?.textures.get(s.key) ?? s.defaultTex);
  const matDefs = new Map();
  // Cockpit display surfaces get their own materials so Unreal can show live PFD/ND/EICAS render targets on them.
  const SCREEN_RX = /pfd|\bnd\b|nd[._-]?screen|navdisplay|eicas|ecam|ewd|mfd|efis[._-]?screen|lcd|\bdu\d|screen/i;
  const SCREEN_EXCL = /off|bezel|frame|btn|button|knob|switch|letter|panel|glare|ovlay|overlay|keyboard|reflect|glass|cover|\.set|\.on\b|mount|light|cdu|efb|chart|clock|radio|freq|xpdr|wiper/i;
  const screenKind = p => {
    if (!p.interior || !SCREEN_RX.test(p.name) || SCREEN_EXCL.test(p.name)) return null;
    if (/pfd/i.test(p.name)) return 'PFD';
    if (/eicas|ecam|ewd/i.test(p.name)) return 'EICAS';
    if (/\bnd|nav|efis|mfd/i.test(p.name)) return 'ND';
    return 'MFD';
  };
  const materialKeyOf = (p, s) => {
    const acm = p.materials[s.mat] ?? p.materials[0];
    const twoSided = !!(s.flags & 0x20);
    const texName = s.texture ?? p.obj.texture;
    const tex = p.slot ? slotTex.get(p.slot) : p.texOverride ?? (texName ? p.texFiles.get(texName) : null);
    const glass = p.effect === 'glass' || (acm?.trans ?? 0) > 0.05 || (p.alpha ?? 1) < 0.95;
    const screen = screenKind(p);
    const id = [p.interior ? 'I' : 'E', p.slot ? `S${p.slot.index}` : '', screen ?? '', tex ?? '', acm?.name, acm?.rgb, acm?.emis, acm?.trans, twoSided, glass, p.effect].join('|');
    if (!matDefs.has(id)) matDefs.set(id, { id, acm, tex, twoSided, glass: glass && !screen, slot: p.slot, effect: p.effect, interior: p.interior, alpha: p.alpha, screen });
    return { id, interior: p.interior };
  };
  // Static exterior/interior, plus animated gear/flap poses and spinning props/rotors as separate nodes.
  const isStatic = p => p.interior || (!p.group && !p.spin);
  const base = buildBuckets(model.parts.filter(isStatic), materialKeyOf);
  let tris = base.tris;
  const meshes = [];  // { name, buckets, translation? }
  meshes.push({ name: 'Exterior', buckets: base.buckets.filter(b => !b.interior) });
  meshes.push({ name: 'Interior', buckets: base.buckets.filter(b => b.interior) });
  const poses = [];
  for (const g of POSE_GROUPS) {
    const gp = model.parts.filter(p => !p.interior && !p.spin && p.group === g.id);
    if (!gp.length) continue;
    const nodes = [];
    for (const [k, v] of g.values.entries()) {
      for (const p of gp) p.matrix = model.poseMatrix(p, { [g.id]: v });
      const r = buildBuckets(gp, materialKeyOf);
      if (v === g.rest) tris += r.tris;
      const name = `Pose_${g.id}_${k}`;
      meshes.push({ name, buckets: r.buckets, pose: v === g.rest });
      nodes.push(name);
    }
    for (const p of gp) p.matrix = model.poseMatrix(p, { [g.id]: g.rest });
    poses.push({ group: g.id, values: g.values, nodes, objects: gp.length });
  }
  const spins = [];
  for (const s of model.spins) {
    const sp = model.parts.filter(p => p.spin === s && !p.interior);
    if (!sp.length) continue;
    const r = buildBuckets(sp, materialKeyOf);
    tris += r.tris;
    const pivot = [-s.pivot[1], s.pivot[2], -s.pivot[0]];  // FG -> glTF
    for (const b of r.buckets) for (let i = 0; i < b.pos.length; i++) b.pos[i] -= pivot[i % 3];
    const name = `Spin_${spins.length}`;
    meshes.push({ name, buckets: r.buckets, translation: pivot });
    spins.push({ node: name, pivot, axis: [-s.axis[1], s.axis[2], -s.axis[0]], kind: s.kind, engine: s.engine });
  }
  const buckets = meshes.flatMap(m => m.buckets);
  console.log(`  ${tris.toLocaleString()} triangles · ${poses.map(p => `${p.group} ${p.objects} parts`).join(', ') || 'no poses'} · ${spins.length} spinning parts`);

  const screens = {};
  const matIndex = new Map();
  const slotMaterials = new Map(model.slots.map(s => [s.index, []]));
  for (const b of buckets) {
    if (matIndex.has(b.id)) continue;
    const d = matDefs.get(b.id);
    const name = `${d.slot ? `LIVERY${d.slot.index}_` : d.screen ? `SCREEN_${d.screen}_` : d.glass ? 'GLASS_' : ''}${(d.acm?.name || 'mat').replace(/[^\w]/g, '')}_${matIndex.size}`;
    const opaque = !!d.slot || d.effect === 'paint';
    const texture = d.tex ? await embed(d.tex, opaque) : null;
    const rec = d.tex ? await loadImage(d.tex) : null;
    const rgb = d.acm?.rgb ?? [0.8, 0.8, 0.8];
    const m = { name, pbrMetallicRoughness: { baseColorFactor: [...(texture != null ? [1, 1, 1] : rgb.map(srgbToLinear)), 1], metallicFactor: 0, roughnessFactor: 0.6 } };
    if (texture != null) m.pbrMetallicRoughness.baseColorTexture = { index: texture };
    const shi = d.acm?.shi ?? 0, spec = Math.max(...(d.acm?.spec ?? [0]));
    m.pbrMetallicRoughness.roughnessFactor = +(d.slot || d.effect === 'paint' ? 0.32 : Math.max(0.25, 0.85 - spec * 0.3 - shi / 400)).toFixed(3);
    if (d.acm?.emis?.some(v => v > 0.05)) m.emissiveFactor = d.acm.emis.map(srgbToLinear);
    if (d.twoSided) m.doubleSided = true;
    if (d.glass) {
      const a = Math.min(d.alpha ?? 1, 1 - (d.acm?.trans ?? 0));
      m.alphaMode = 'BLEND'; m.pbrMetallicRoughness.baseColorFactor[3] = +Math.max(0.12, Math.min(a, 0.6)).toFixed(3);
      m.pbrMetallicRoughness.roughnessFactor = 0.05; m.doubleSided = true;
    } else if (!opaque && rec && rec.alpha.kind !== 'opaque') {
      m.alphaMode = rec.alpha.kind === 'blend' ? 'BLEND' : 'MASK';
      if (m.alphaMode === 'MASK') m.alphaCutoff = 0.5;
    }
    matIndex.set(b.id, gw.material(m));
    if (d.slot) slotMaterials.get(d.slot.index).push(name);
    if (d.screen) (screens[d.screen] ??= []).push(name);
  }

  // ---------- meshes ----------
  for (const m of meshes) {
    const prims = m.buckets.map(b => ({
      pos: new Float32Array(b.pos), nrm: new Float32Array(b.nrm), uv: new Float32Array(b.uv),
      idx: new Uint32Array(b.idx), material: matIndex.get(b.id),
    }));
    if (prims.length) gw.node({ name: m.name, mesh: gw.mesh(m.name, prims), ...(m.translation ? { translation: m.translation } : {}) });
  }

  // bounds (exterior only) in glTF space
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const m of meshes) {
    if (m.name === 'Interior' || (m.name.startsWith('Pose_') && !m.pose)) continue;
    const t = m.translation ?? [0, 0, 0];
    for (const b of m.buckets) for (let i = 0; i < b.pos.length; i++) {
      const c = i % 3, v = b.pos[i] + t[c];
      if (v < min[c]) min[c] = v;
      if (v > max[c]) max[c] = v;
    }
  }

  const outDir = path.join(OUT, entry.id);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'Liveries'), { recursive: true });
  const glb = gw.toBuffer();
  fs.writeFileSync(path.join(outDir, `${entry.id}.glb`), glb);
  console.log(`  wrote ${entry.id}.glb (${(glb.length / 1048576).toFixed(1)} MB)`);

  // ---------- livery textures ----------
  const livOut = [];
  // keep the default livery when trimming the list
  const keep = [def, ...liveries.filter(l => l !== def)].filter(Boolean).slice(0, MAX_LIVERIES);
  await pool(keep, 4, async (l) => {
    const files = {};
    for (const s of model.slots) {
      const f = l.textures.get(s.key) ?? s.defaultTex;
      if (!f) continue;
      const rec = await loadImage(f);
      if (!rec) continue;
      const fn = `${l.id}_S${s.index}.png`;
      const bytes = rec.mime === 'image/jpeg' ? null : encodePng(opaqueCopy(rec.img), { alpha: false });
      if (bytes) { fs.writeFileSync(path.join(outDir, 'Liveries', fn), bytes); files[s.index] = `Liveries/${fn}`; }
    }
    livOut.push({ id: l.id, name: l.name, operator: l.operator, registration: l.registration, textures: files });
  });
  livOut.sort((a, b) => a.name.localeCompare(b.name));

  const eye = setTree.get('sim/view/config');
  const manifest = {
    id: entry.id, name: entry.name, fdm: entry.fdm, source: `FlightGear FGAddon ${acDir}`, license: entry.license ?? 'GPL-2.0-or-later',
    glb: `${entry.id}.glb`, triangles: tris,
    // glTF space (metres): +Y up, +Z nose, +X left. groundY is the lowest exterior point (tyres with gear down).
    bounds: { min, max }, groundY: min[1],
    eye: eye ? [-eye.num('x-offset-m'), eye.num('y-offset-m'), -eye.num('z-offset-m')] : null,
    slots: model.slots.map(s => ({ index: s.index, property: s.key, materials: slotMaterials.get(s.index) })),
    poses, spins,
    screens: Object.entries(screens).map(([kind, materials]) => ({ kind, materials })),
    defaultLivery: def?.id ?? null,
    liveries: livOut,
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1));
  console.log(`  ✓ ${livOut.length} liveries → ${path.relative(repo, outDir)}`);
}

// ---------------------------------------------------------------------------------------------

async function findLiveries(entry, model, setTree, acDir) {
  if (!model.slots.length) return [];
  // Livery folders are announced to Nasal: aircraft.livery.init("…") / aircraft.livery_update.new("…")
  const dirs = new Set(entry.liveryDirs ?? []);
  const scan = (txt) => { for (const m of txt.matchAll(/livery(?:_update)?\s*\.\s*(?:init|new)\s*\(\s*["']([^"']+)["']/g)) dirs.add(normalize(m[1])); };
  for (const i of model.instances) {
    const n = i.props?.get('nasal'); if (!n) continue;
    const walk = x => { scan(x.value); x.children.forEach(walk); }; walk(n);
  }
  if (!dirs.size) {
    const walk = x => { scan(x.value); x.children.forEach(walk); }; walk(setTree);
    for (const f of await fg.list(`${acDir}/Nasal`)) if (f.endsWith('.nas')) { const t = await fg.readText(`${acDir}/Nasal/${f}`); if (t) scan(t); }
  }
  if (!dirs.size) for (const sub of ['Models/Liveries', 'Models/liveries', 'Liveries']) if ((await fg.list(`${acDir}/${sub}`)).length) dirs.add(`${acDir}/${sub}`);
  const out = [];
  for (const d of dirs) {
    const dir = d.startsWith('Aircraft/') ? d : `${acDir}/${d}`;
    const names = await fg.list(dir);
    for (const n of names.filter(x => x.endsWith('.xml'))) {
      const file = `${dir}/${n}`;
      const tree = new PNode('PropertyList');
      try { await readProps(fg, file, tree, { aircraftDir: acDir }); } catch { continue; }
      const id = n.replace(/\.xml$/, '').replace(/[^\w-]/g, '_');
      const liv = { id, file, tree, name: tree.str('sim/model/livery/name') || id, operator: tree.str('sim/aircraft-operator'), registration: tree.str('sim/aircraft-registration') || tree.str('sim/model/livery/registration'), textures: new Map() };
      for (const s of model.slots) {
        const v = tree.str(s.key);
        let f = v ? await model.resolve(v, s.dir) : null;
        if (!f && v) f = await model.resolve(v, path.posix.dirname(file));
        // canvas liveries keep each texture in resolution folders next to the livery XML
        for (const res of ['4k', '8k', '2k', '1k']) if (!f && v) f = await model.resolve(`${res}/${v}`, s.canvas ? s.dir : path.posix.dirname(file));
        if (!f && v) {
          // Stale texture names are common (KAL/A380.png vs KAL/KAL.png): pick the image in the livery's own folder.
          const want = path.posix.dirname(normalize(`${s.dir}/${v}`));
          const cand = (await fg.list(want)).filter(x => /\.(png|rgb|dds|jpe?g)$/i.test(x));
          const pick = cand.find(x => x.replace(/\.\w+$/, '') === n.replace(/\.xml$/, '')) ?? (cand.length === 1 ? cand[0] : null)
            ?? cand.find(x => x.toLowerCase().includes(path.posix.basename(v).replace(/\.\w+$/, '').toLowerCase()));
          if (pick) f = `${want}/${pick}`;
        }
        if (f) liv.textures.set(s.key, f);
      }
      if (liv.textures.size) out.push(liv);
    }
  }
  return out;
}

function alphaStats(img) {
  let zero = 0, partial = 0; const n = img.w * img.h;
  for (let i = 3; i < img.data.length; i += 4) { const a = img.data[i]; if (a < 8) zero++; else if (a < 248) partial++; }
  // Alpha used as a reflection/specular mask (common in FG) looks like "partial everywhere, rarely zero".
  const kind = zero + partial === 0 ? 'opaque' : zero / n > 0.02 ? (partial / n > 0.15 ? 'blend' : 'mask') : partial / n > 0.5 ? 'opaque' : 'mask';
  return { kind, zero: zero / n, partial: partial / n };
}

function downscale(img, max) {
  let { w, h, data } = img;
  while (w > max || h > max) {
    const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1), o = new Uint8Array(nw * nh * 4);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) for (let c = 0; c < 4; c++) {
      const i = ((y * 2) * w + x * 2) * 4 + c;
      o[(y * nw + x) * 4 + c] = (data[i] + data[i + 4] + data[i + w * 4] + data[i + w * 4 + 4] + 2) >> 2;
    }
    w = nw; h = nh; data = o;
  }
  return { w, h, data };
}
function srgbToLinear(c) { return +(c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4).toFixed(4); }
