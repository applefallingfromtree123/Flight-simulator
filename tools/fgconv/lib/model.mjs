// Assembles a FlightGear aircraft model (model XML + sub-models + AC3D/3DS geometry) into flat parts in
// FlightGear model space, applying the static parts of the animation system: select conditions, LOD ranges,
// livery material slots, texture overrides and transparency effects.
import path from 'node:path';
import { readProps, PNode } from './props.mjs';
import { normalize } from './fgfs.mjs';
import { parseAc } from './ac3d.mjs';
import { parse3ds } from './tds.mjs';
import { ident, mul, fromRot3Loc, xform, translate, rotate, AC_TO_FG, offsetsMatrix } from './math.mjs';

const dirOf = f => path.posix.dirname(normalize(f));

const SKIP_SUBMODEL = /(^|\/)(Human|Humans|Pilot|Pilots|Crew|Walker|Autopush|Pushback|Ground|GroundServices|Services|Stairs|Tug|Lights?)(\/|$)|pilot|walker|autopush|pushback|tug\.xml|stairs|catering|fuel-?truck|gpu\.xml|[-_]light\.xml|beacon|strobe|halo|procedural_light|tow-?bar|Effects\/lights?|landing-?light|light-?cone|light-?beam/i;
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

/**
 * Animated part groups exported as discrete poses (Unreal shows the pose nearest to the live value).
 * rest = value used for the static model.
 */
export const POSE_GROUPS = [
  { id: 'gear', rx: /gear\/gear(\[\d+\])?\/position-norm|controls\/gear\/gear-down|gear\/gear(\[\d+\])?\/position(?![\w-])/i, values: [0, 1 / 3, 2 / 3, 1], rest: 1 },
  { id: 'flaps', rx: /flap-pos-norm|surface-positions\/[\w-]*(flap|slat)|controls\/flight\/(flaps|slats)/i, values: [0, 0.25, 0.5, 0.75, 1], rest: 0 },
];
// Propellers and rotors become separate meshes that Unreal spins.
const SPIN_PROP = /rotors?\/(main|tail)|propeller|\brpm\b|engines\/engine(\[\d+\])?\/(n1|n2|rpm)|blade(\[\d+\])?\/position|prop-?pos/i;
// FlightGear rotate animations turn right-handed about their axis (simgear SGRotateTransform).
const ROT_SIGN = 1;

function parseTransformAnim(node, type, inst) {
  const prop = node.str('property');
  if (!prop) return null;
  let center = node.has('center') ? [node.num('center/x-m'), node.num('center/y-m'), node.num('center/z-m')] : [0, 0, 0];
  let axis = null;
  const ax = node.get('axis');
  if (ax?.has('x1-m')) {
    const p1 = [ax.num('x1-m'), ax.num('y1-m'), ax.num('z1-m')], p2 = [ax.num('x2-m'), ax.num('y2-m'), ax.num('z2-m')];
    axis = [p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]];
    if (!node.has('center')) center = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2, (p1[2] + p2[2]) / 2];
  } else if (ax) axis = [ax.num('x'), ax.num('y'), ax.num('z')];
  if (!axis || Math.hypot(...axis) < 1e-9) return null;
  const suf = type === 'translate' ? '-m' : '-deg';
  const interp = node.get('interpolation')?.getChildren('entry').map(e => [e.num('ind'), e.num('dep')]) ?? null;
  return {
    type, inst, prop, center, axis, interp: interp?.length ? interp : null,
    factor: node.has('factor') ? node.num('factor') : 1, offset: node.num('offset' + suf),
    min: node.has('min' + suf) ? node.num('min' + suf) : -Infinity, max: node.has('max' + suf) ? node.num('max' + suf) : Infinity,
    cond: node.get('condition'),
    group: POSE_GROUPS.find(g => g.rx.test(prop))?.id ?? null,
    spin: (type === 'spin' || type === 'rotate') && SPIN_PROP.test(prop),
  };
}

function animValue(a, v) {
  let x;
  if (a.interp) {
    const t = a.interp;
    if (v <= t[0][0]) x = t[0][1];
    else if (v >= t[t.length - 1][0]) x = t[t.length - 1][1];
    else {
      let i = 1;
      while (t[i][0] < v) i++;
      const f = (v - t[i - 1][0]) / ((t[i][0] - t[i - 1][0]) || 1);
      x = t[i - 1][1] + (t[i][1] - t[i - 1][1]) * f;
    }
  } else x = v * a.factor + a.offset;
  return Math.min(a.max, Math.max(a.min, x));
}

function animMatrix(a, v) {
  const val = animValue(a, v);
  const l = Math.hypot(...a.axis);
  if (a.type === 'translate') return translate(a.axis[0] / l * val, a.axis[1] / l * val, a.axis[2] / l * val);
  const [cx, cy, cz] = a.center;
  return mul(mul(translate(-cx, -cy, -cz), rotate(ROT_SIGN * val, a.axis[0], a.axis[1], a.axis[2])), translate(cx, cy, cz));
}

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

  // Scene graph mirroring FlightGear's: instance roots, AC objects, named animation groups. Transform
  // animations attach to nodes (xforms[0] is closest to the geometry, i.e. the most recently declared).
  const allNodes = [];
  const newNode = (name, parent, inst, isInst) => {
    const n = { name, parent, inst, isInst, xforms: [] };
    allNodes.push(n);
    return n;
  };

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

  async function loadXml(file, parent, name, localToParent, overlay) {
    const node = new PNode('PropertyList');
    await readProps(fg, file, node, { aircraftDir });
    if (overlay) mergeOverlay(node, overlay);
    const inst = new Instance(file, parent, name);
    inst.props = node;
    // <texture-path> adds a texture search directory (relative to the model XML) for the geometry and animations.
    const tp = node.str('texture-path');
    inst.texDir = tp ? normalize(`${inst.dir}/${tp}`) : inst.dir;
    // Model-local frame -> parent frame: this file's <offsets>, then the parent's <model><offsets>.
    inst.local = mul(offsetsMatrix(node.get('offsets')), localToParent);
    inst.node = newNode(name, parent?.node ?? null, inst, true);
    parent?.kids.push(inst);
    instances.push(inst);
    const geomPath = node.str('path');
    if (geomPath) {
      const f = await resolve(geomPath, inst.dir);
      if (f && /\.xml$/i.test(f)) await loadXml(f, inst, '', ident(), null);
      else if (f) await addGeometry(f, inst);
      else log(`  ? geometry not found: ${geomPath} (from ${file})`);
    }
    for (const sub of node.getChildren('model')) {
      if (!evalCondition(sub.get('condition'), state)) continue;
      const p = sub.str('path');
      // People, ground equipment and light-halo sprites are not part of the airframe; Unreal adds real lights.
      if (SKIP_SUBMODEL.test(p) || SKIP_SUBMODEL.test(sub.str('name'))) continue;
      const f = await resolve(p, inst.dir);
      if (!f) { log(`  ? sub-model not found: ${p}`); continue; }
      const subOffsets = offsetsMatrix(sub.get('offsets'));
      const subName = sub.str('name');
      if (/\.xml$/i.test(f)) await loadXml(f, inst, subName, subOffsets, sub.get('overlay'));
      else {
        const si = new Instance(f, inst, subName);
        si.texDir = si.dir;
        si.local = subOffsets;
        si.node = newNode(subName, inst.node, si, true);
        inst.kids.push(si);
        instances.push(si);
        await addGeometry(f, si);
      }
    }
    for (const a of node.getChildren('animation')) animations.push({ inst, node: a });
    for (const e of node.getChildren('effect')) effects.push({ inst, node: e });
    return inst;
  }

  async function addGeometry(file, inst) {
    const g = await loadGeometry(file);
    if (!g) return;
    inst.geomFile = file;
    const base = g.fgSpace ? ident() : AC_TO_FG;
    const dir = dirOf(file);
    const walk = (o, parentM, ancestors, parentNode) => {
      const m = mul(fromRot3Loc(o.rot, o.loc), parentM);
      const names = o.name ? [...ancestors, o.name] : ancestors;
      const n = newNode(o.name, parentNode, inst, false);
      if (o.surfs.length && !o.hidden && !SKIP_OBJECT.test(o.name)) {
        parts.push({ name: o.name, names, inst, node: n, obj: o, localM: m, matrix: null, materials: g.materials, dir,
          texDirs: [...new Set([dir, inst.texDir ?? dir])], visible: true, slot: null, texOverride: null, effect: null });
      }
      for (const k of o.kids) walk(k, m, names, n);
    };
    walk(g.root, base, [], inst.node);
  }

  const root = await loadXml(normalize(modelFile), null, '', ident(), null);
  for (const i of instances) if (!i.local) i.local = ident();

  // ---- animations ----
  const findNodes = (inst, names) => {
    if (!names.length) return [inst.node];
    const set = new Set(names);
    return allNodes.filter(n => n.name && set.has(n.name) && n.inst.isWithin(inst));
  };
  const match = (inst, names) => {
    const t = new Set(findNodes(inst, names));
    if (!t.size) return [];
    return parts.filter(p => { for (let n = p.node; n; n = n.parent) if (t.has(n)) return true; return false; });
  };
  const slots = new Map();
  for (const { inst, node } of animations) {
    const type = node.str('type');
    const names = node.getChildren('object-name').map(n => n.value.trim()).filter(Boolean);
    if ((!type || type === 'none') && node.has('name') && names.length) {
      // named group: later animations can address these objects together
      const targets = findNodes(inst, names);
      if (targets.length) {
        const g = newNode(node.str('name'), targets[0].parent, inst, false);
        for (const t of targets) {
          let cyc = false;
          for (let a = g; a; a = a.parent) if (a === t) { cyc = true; break; }
          if (!cyc) t.parent = g;
        }
      }
    } else if (type === 'rotate' || type === 'translate' || type === 'spin') {
      const anim = parseTransformAnim(node, type, inst);
      if (anim) for (const t of findNodes(inst, names)) t.xforms.unshift(anim);
    } else if (type === 'select') {
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
        if (!slot) { slot = { key, index: slots.size, defaultTex: null, dir: inst.texDir }; slots.set(key, slot); }
        if (tex && !slot.defaultTex) slot.defaultTex = (await resolve(tex, inst.texDir)) ?? (await resolve(tex, inst.dir));
        for (const p of match(inst, names)) p.slot = slot;
      } else if (tex) {
        const f = (await resolve(tex, inst.texDir)) ?? (await resolve(tex, inst.dir));
        if (f) for (const p of match(inst, names)) p.texOverride = f;
      }
      const alpha = node.get('transparency/alpha');
      if (alpha && !node.has('transparency/alpha-prop')) {
        const a = parseFloat(alpha.value); if (a < 1) for (const p of match(inst, names)) p.alpha = a;
      }
    }
  }
  // Canvas liveries (newer FG aircraft): Nasal canvas_livery_update.init(dir) + createTarget(name, objects, prop[, default]).
  for (const inst of instances) {
    const nasal = inst.props?.get('nasal');
    if (!nasal) continue;
    let text = '';
    const walk = x => { text += '\n' + x.value; x.children.forEach(walk); };
    walk(nasal);
    const init = /canvas_livery(?:_update)?\s*\.\s*init\s*\(\s*["']([^"']+)["']/.exec(text);
    if (!init) continue;
    const livDir = normalize(init[1].startsWith('Aircraft/') ? init[1] : `${aircraftDir}/${init[1]}`);
    const lists = [...text.matchAll(/(?:var\s+)?(\w+)\s*=\s*\[([^\]]*)\]/g)]
      .map(m => ({ name: m[1], at: m.index, items: [...m[2].matchAll(/["']([^"']+)["']/g)].map(x => x[1]) }));
    for (const m of text.matchAll(/createTarget\s*\(\s*["']([^"']+)["']\s*,\s*(\w+|\[[^\]]*\])\s*,\s*["']([^"']+)["'](?:\s*,\s*["']([^"']+)["'])?/g)) {
      const names = m[2].startsWith('[')
        ? [...m[2].matchAll(/["']([^"']+)["']/g)].map(x => x[1])
        : lists.filter(l => l.name === m[2] && l.at < m.index).at(-1)?.items ?? [];
      const key = m[3].replace(/^\/+/, '');
      let slot = slots.get(key);
      if (!slot) { slot = { key, index: slots.size, defaultTex: null, dir: livDir, canvas: true }; slots.set(key, slot); }
      if (m[4] && !slot.defaultTex) slot.defaultTex = await resolve(m[4], inst.dir);
      for (const p of match(inst, names)) p.slot = slot;
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

  // ---- animated poses and spinning parts ----
  /** Part transform with the pose-group animations evaluated at the given values (other animations at rest). */
  const poseMatrix = (p, values) => {
    let M = p.localM;
    for (let n = p.node; n; n = n.parent) {
      if (n.isInst) M = mul(M, n.inst.local);
      for (const a of n.xforms) {
        if (a.spin || !a.group || values[a.group] === undefined) continue;
        if (a.cond && !evalCondition(a.cond, state)) continue;
        const gv = values[a.group];
        M = mul(M, animMatrix(a, /gear-down/.test(a.prop) ? (gv > 0.5 ? 1 : 0) : gv));
      }
    }
    return M;
  };
  const animsOf = p => { const out = []; for (let n = p.node; n; n = n.parent) out.push(...n.xforms); return out; };
  const restValues = Object.fromEntries(POSE_GROUPS.map(g => [g.id, g.rest]));
  const spins = new Map();
  for (const p of parts) {
    p.matrix = poseMatrix(p, restValues);
    const anims = animsOf(p);
    p.group = anims.find(a => a.group === 'gear' && !a.spin)?.group ?? anims.find(a => a.group && !a.spin)?.group ?? null;
    const s = anims.find(a => a.spin);
    if (s && !p.interior) {
      if (!spins.has(s)) {
        let M = ident();
        for (let i = s.inst; i; i = i.parent) M = mul(M, i.local);
        const pivot = xform(M, ...s.center), o = xform(M, 0, 0, 0), e = xform(M, ...s.axis);
        const d = [e[0] - o[0], e[1] - o[1], e[2] - o[2]], l = Math.hypot(...d) || 1;
        const kind = /tail/i.test(s.prop) ? 'tail' : /rotor/i.test(s.prop) ? 'rotor' : 'prop';
        const engine = +(/engine\[(\d+)\]/.exec(s.prop)?.[1] ?? /propeller\[(\d+)\]/.exec(s.prop)?.[1] ?? 0);
        spins.set(s, { index: spins.size, pivot, axis: d.map(x => x / l), kind, engine, prop: s.prop });
      }
      p.spin = spins.get(s);
    }
  }
  return { root, parts: parts.filter(p => p.visible), slots: [...slots.values()], instances, resolve, poseMatrix, spins: [...spins.values()] };
}

function mergeOverlay(node, overlay) {
  for (const c of overlay.children) {
    const t = node.getChild(c.name, c.index, true);
    if (c.children.length) mergeOverlay(t, c); else t.value = c.value;
  }
}
