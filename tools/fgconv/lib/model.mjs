// Assembles a FlightGear aircraft model (model XML + sub-models + AC3D/3DS geometry) into flat parts in
// FlightGear model space, applying the static parts of the animation system: select conditions, LOD ranges,
// livery material slots, texture overrides and transparency effects.
import path from 'node:path';
import { readProps, PNode } from './props.mjs';
import { normalize } from './fgfs.mjs';
import { parseAc } from './ac3d.mjs';
import { parse3ds } from './tds.mjs';
import { ident, mul, fromRot3Loc, xform, AC_TO_FG, offsetsMatrix } from './math.mjs';

const dirOf = f => path.posix.dirname(normalize(f));

const SKIP_SUBMODEL = /(^|\/)(Human|Humans|Pilot|Pilots|Crew|Walker|Autopush|Pushback|Ground|GroundServices|Services|Stairs|Tug|Lights?)(\/|$)|pilot|walker|autopush|pushback|tug\.xml|stairs|catering|fuel-?truck|gpu\.xml|[-_]light\.xml|beacon|strobe|halo|procedural_light|tow-?bar/i;
const SKIP_OBJECT = /\.flare$|\.spot$|halo|glow|light[-_.]?cone|lightmap-only|^beacon|^strobe|^nav[-_]?light|landing[-_]?light[-_]?(beam|cone)|^shadow$|^shadow\./i;

export class Instance {
  constructor(file, parent, name) { this.file = file; this.parent = parent; this.name = name; this.kids = []; this.dir = dirOf(file); }
  isWithin(other) { for (let i = this; i; i = i.parent) if (i === other) return true; return false; }
  chain() { const out = []; for (let i = this; i; i = i.parent) out.push(i); return out; }
}

/**
 * Property state used to evaluate <condition> blocks. Starts from the -set.xml tree like FlightGear does, with
 * the aircraft parked: gear down, doors shut, ground services off, viewed from the cockpit.
 */
export function makeState(setTree) {
  const overrides = new Map(Object.entries({
    'gear/gear/position-norm': 1, 'gear/gear[1]/position-norm': 1, 'gear/gear[2]/position-norm': 1, 'gear/gear[3]/position-norm': 1,
    'gear/gear[4]/position-norm': 1, 'controls/gear/gear-down': 1, 'gear/gear/wow': 1, 'gear/gear[1]/wow': 1, 'gear/gear[2]/wow': 1,
    'sim/rendering/rembrandt/enabled': 0, 'sim/model/hide-pilot': 0,
  }));
  // View-dependent switches (exterior hidden from the cockpit and vice versa): the converted model must contain both.
  const wild = /^sim\/current-view\/(internal|view-number|name)|^sim\/rendering\/(shaders|quality)/;
  const norm = p => p.replace(/^\//, '').replace(/\[0\]/g, '');
  const st = {
    overlay: null, // a livery's property tree, applied on top like FlightGear's livery loader does
    get(p) {
      p = norm(p.trim());
      if (wild.test(p)) return WILD;
      if (overrides.has(p)) return overrides.get(p);
      const n = st.overlay?.get(p) ?? setTree?.get(p);
      if (!n || n.children.length) return '';
      const v = n.value.trim();
      if (v === 'true') return 1; if (v === 'false') return 0;
      const f = parseFloat(v);
      return Number.isFinite(f) && /^[-+.\d eE]+$/.test(v) ? f : v;
    },
  };
  return st;
}

const WILD = Symbol('either');
/** Conditions are tri-state: true, false, or WILD (depends on the view; treated as visible). */
export function evalCondition(c, st) {
  if (!c) return true;
  return c.children.every(k => evalTerm(k, st) !== false);
}
function operand(n, st) { return n.name === 'property' ? st.get(n.value) : n.name === 'value' ? coerce(n.value.trim()) : null; }
function coerce(v) { if (v === 'true') return 1; if (v === 'false') return 0; const f = parseFloat(v); return Number.isFinite(f) ? f : v; }
function evalTerm(k, st) {
  const ops = () => k.children.filter(c => c.name === 'property' || c.name === 'value').map(c => operand(c, st));
  const cmp = (f) => {
    const [a, b] = ops(); if (a === undefined || b === undefined) return false;
    if (a === WILD || b === WILD) return WILD;
    const x = a === '' ? 0 : a, y = b === '' ? 0 : b; return f(x, y);
  };
  const all = (list, any) => {
    const r = list.map(c => evalTerm(c, st));
    if (any ? r.includes(true) : r.every(v => v === true)) return true;
    return r.includes(WILD) && (any || !r.includes(false)) ? WILD : false;
  };
  switch (k.name) {
    case 'and': return all(k.children, false);
    case 'or': return all(k.children, true);
    case 'not': { const r = all(k.children, false); return r === WILD ? WILD : !r; }
    case 'property': { const v = st.get(k.value); return v === WILD ? WILD : !!v && v !== '0'; }
    case 'equals': return cmp((a, b) => a == b);
    case 'not-equals': return cmp((a, b) => a != b);
    case 'less-than': return cmp((a, b) => a < b);
    case 'greater-than': return cmp((a, b) => a > b);
    case 'less-than-equals': return cmp((a, b) => a <= b);
    case 'greater-than-equals': return cmp((a, b) => a >= b);
    default: return WILD; // <expression> and friends: assume visible
  }
}

/**
 * Loads the full model. Returns { parts, materials, slots, instances } where each part is one AC3D object
 * flattened into FG model space (Float64 positions per triangle corner, uvs, smoothing data).
 */
export async function loadModel(fg, modelFile, { state, aircraftDir, log = () => {}, includeInterior = true } = {}) {
  const parts = [];
  const animations = [];  // { inst, node }
  const effects = [];     // { inst, node }
  const instances = [];
  const geomCache = new Map();

  async function loadGeometry(file) {
    if (geomCache.has(file)) return geomCache.get(file);
    const buf = await fg.read(file);
    let g = null;
    if (!buf) log(`  ? missing geometry ${file}`);
    else if (/\.ac$/i.test(file)) g = parseAc(buf.toString('latin1'));
    else if (/\.3ds$/i.test(file)) g = parse3ds(buf);
    else log(`  ? unsupported geometry ${file}`);
    geomCache.set(file, g);
    return g;
  }

  async function resolve(p, baseDir) {
    if (!p) return null;
    p = p.trim();
    const cands = [normalize(`${baseDir}/${p}`), normalize(p)];
    if (aircraftDir) cands.push(normalize(`${aircraftDir}/${p}`));
    for (const c of cands) if (await fg.exists(c)) return c;
    // tolerate wrong case and Windows separators
    const dir = path.posix.dirname(cands[0]), base = path.posix.basename(cands[0]).toLowerCase();
    const names = await fg.list(dir);
    const hit = names.find(n => n.toLowerCase() === base);
    return hit ? `${dir}/${hit}` : null;
  }

  async function loadXml(file, parent, name, matrix, overlay) {
    const node = new PNode('PropertyList');
    await readProps(fg, file, node, { aircraftDir });
    if (overlay) mergeOverlay(node, overlay);
    const inst = new Instance(file, parent, name);
    inst.props = node;
    parent?.kids.push(inst);
    instances.push(inst);
    const m = mul(offsetsMatrix(node.get('offsets')), matrix);
    const geomPath = node.str('path');
    if (geomPath) {
      const f = await resolve(geomPath, inst.dir);
      if (f && /\.xml$/i.test(f)) await loadXml(f, inst, '', m, null);
      else if (f) await addGeometry(f, inst, m);
      else log(`  ? geometry not found: ${geomPath} (from ${file})`);
    }
    for (const sub of node.getChildren('model')) {
      if (!evalCondition(sub.get('condition'), state)) continue;
      const p = sub.str('path');
      // People, ground equipment and light-halo sprites are not part of the airframe; Unreal adds real lights.
      if (SKIP_SUBMODEL.test(p) || SKIP_SUBMODEL.test(sub.str('name'))) continue;
      const f = await resolve(p, inst.dir);
      if (!f) { log(`  ? sub-model not found: ${p}`); continue; }
      const sm = mul(offsetsMatrix(sub.get('offsets')), m);
      const subName = sub.str('name');
      if (/\.xml$/i.test(f)) await loadXml(f, inst, subName, sm, sub.get('overlay'));
      else {
        const si = new Instance(f, inst, subName); inst.kids.push(si); instances.push(si);
        await addGeometry(f, si, sm);
      }
    }
    for (const a of node.getChildren('animation')) animations.push({ inst, node: a });
    for (const e of node.getChildren('effect')) effects.push({ inst, node: e });
    return inst;
  }

  async function addGeometry(file, inst, matrix) {
    const g = await loadGeometry(file);
    if (!g) return;
    inst.geomFile = file;
    const base = g.fgSpace ? matrix : mul(AC_TO_FG, matrix);
    const dir = dirOf(file);
    const walk = (o, parentM, ancestors) => {
      const local = fromRot3Loc(o.rot, o.loc);
      const m = mul(local, parentM);
      const names = o.name ? [...ancestors, o.name] : ancestors;
      if (o.surfs.length && !o.hidden && !SKIP_OBJECT.test(o.name)) parts.push({ name: o.name, names, inst, obj: o, matrix: m, materials: g.materials, dir, visible: true, slot: null, texOverride: null, effect: null });
      for (const k of o.kids) walk(k, m, names);
    };
    walk(g.root, base, []);
  }

  const root = await loadXml(normalize(modelFile), null, '', ident(), null);

  // ---- animations ----
  const match = (inst, names) => {
    if (!names.length) return parts.filter(p => p.inst.isWithin(inst));
    const set = new Set(names);
    return parts.filter(p => {
      if (!p.inst.isWithin(inst)) return false;
      if (p.names.some(n => set.has(n))) return true;
      // sub-model names declared by `inst` or below
      for (let i = p.inst; i && i !== inst; i = i.parent) if (i.name && set.has(i.name)) return true;
      return false;
    });
  };
  const slots = new Map();
  for (const { inst, node } of animations) {
    const type = node.str('type');
    const names = node.getChildren('object-name').map(n => n.value.trim()).filter(Boolean);
    if (type === 'select') {
      if (!evalCondition(node.get('condition'), state)) for (const p of match(inst, names)) p.visible = false;
    } else if (type === 'range') {
      // LOD: anything that only shows from some distance away is a low-detail duplicate.
      const min = node.num('min-m', 0) || (node.has('min-property') ? 1 : 0);
      if (min > 0) for (const p of match(inst, names)) p.visible = false;
    } else if (type === 'material') {
      const texProp = node.str('texture-prop');
      const base = node.str('property-base').replace(/^\/+|\/+$/g, '');
      const tex = node.str('texture');
      if (texProp) {
        const key = base ? `${base}/${texProp}` : texProp;
        let slot = slots.get(key);
        if (!slot) { slot = { key, index: slots.size, defaultTex: null, dir: inst.dir }; slots.set(key, slot); }
        if (tex && !slot.defaultTex) slot.defaultTex = await resolve(tex, inst.dir);
        for (const p of match(inst, names)) p.slot = slot;
      } else if (tex) {
        const f = await resolve(tex, inst.dir);
        if (f) for (const p of match(inst, names)) p.texOverride = f;
      }
      const alpha = node.get('transparency/alpha');
      if (alpha && !node.has('transparency/alpha-prop')) {
        const a = parseFloat(alpha.value); if (a < 1) for (const p of match(inst, names)) p.alpha = a;
      }
    }
  }
  for (const { inst, node } of effects) {
    const from = node.str('inherits-from');
    const names = node.getChildren('object-name').map(n => n.value.trim()).filter(Boolean);
    if (!names.length) continue;
    const kind = /glass|transparent|canopy|window/i.test(from) ? 'glass'
      : /interior|lightmap/i.test(from) ? 'interior' : /reflect|bumpspec|combined|pbr|fuselage|metal|chrome/i.test(from) ? 'paint' : null;
    if (kind) for (const p of match(inst, names)) p.effect ??= kind;
  }

  // Interior: everything loaded through a cockpit/cabin sub-model.
  const interiorRx = /flight-?deck|cockpit|interior|cabin|panel|pedestal|overhead|glareshield|instrument|seat|yoke|human|pilot|walker|mcp|fcu|efis|display|mfd|pfd/i;
  for (const p of parts) {
    p.interior = p.inst.chain().some(i => i.parent && (interiorRx.test(path.posix.basename(i.file)) || interiorRx.test(i.name)));
    if (p.interior && !includeInterior) p.visible = false;
  }
  return { root, parts: parts.filter(p => p.visible), slots: [...slots.values()], instances, resolve };
}

function mergeOverlay(node, overlay) {
  for (const c of overlay.children) {
    const t = node.getChild(c.name, c.index, true);
    if (c.children.length) mergeOverlay(t, c); else t.value = c.value;
  }
}
