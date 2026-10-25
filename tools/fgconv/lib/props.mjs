// Minimal XML reader plus FlightGear PropertyList semantics: indexed children (n="…"),
// include="…" merging and typed values. Mirrors simgear/props/props_io.cxx.
import path from 'node:path';
import { normalize } from './fgfs.mjs';

export class PNode {
  constructor(name, index = 0, parent = null) {
    this.name = name; this.index = index; this.parent = parent;
    this.children = []; this.value = ''; this.attrs = {};
  }
  getChild(name, index = 0, create = false) {
    let c = this.children.find(k => k.name === name && k.index === index);
    if (!c && create) { c = new PNode(name, index, this); this.children.push(c); }
    return c ?? null;
  }
  getChildren(name) { return this.children.filter(c => c.name === name).sort((a, b) => a.index - b.index); }
  /** Path lookup: "a/b[2]/c". */
  get(p) {
    let n = this;
    for (const seg of p.split('/').filter(Boolean)) {
      const m = /^([^[]+)(?:\[(\d+)\])?$/.exec(seg);
      n = n?.getChild(m[1], m[2] ? +m[2] : 0) ?? null;
      if (!n) return null;
    }
    return n;
  }
  str(p, def = '') { const n = p ? this.get(p) : this; return n ? n.value.trim() : def; }
  num(p, def = 0) { const n = this.get(p); if (!n) return def; const v = parseFloat(n.value); return Number.isFinite(v) ? v : def; }
  has(p) { return this.get(p) != null; }
}

// ---------- tiny XML tokenizer ----------
function parseXml(src) {
  const root = { name: '#doc', attrs: {}, kids: [], text: '' };
  const stack = [root];
  let i = 0;
  const ent = s => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e) =>
    e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'amp' ? '&' : e === 'quot' ? '"' : e === 'apos' ? "'" :
    e[1] === 'x' || e[1] === 'X' ? String.fromCodePoint(parseInt(e.slice(2), 16)) : String.fromCodePoint(+e.slice(1)));
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) break;
    if (lt > i) stack.at(-1).text += ent(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) { const e = src.indexOf('-->', lt + 4); i = e < 0 ? src.length : e + 3; continue; }
    if (src.startsWith('<![CDATA[', lt)) { const e = src.indexOf(']]>', lt); stack.at(-1).text += src.slice(lt + 9, e); i = e + 3; continue; }
    if (src.startsWith('<?', lt)) { i = src.indexOf('?>', lt) + 2; continue; }
    if (src.startsWith('<!', lt)) { i = src.indexOf('>', lt) + 1; continue; }
    const gt = findTagEnd(src, lt);
    const body = src.slice(lt + 1, gt);
    i = gt + 1;
    if (body[0] === '/') { if (stack.length > 1) stack.pop(); continue; }
    const selfClose = body.endsWith('/');
    const m = /^([^\s/>]+)([\s\S]*?)\/?$/.exec(body);
    const el = { name: m[1], attrs: {}, kids: [], text: '' };
    for (const a of m[2].matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) el.attrs[a[1]] = ent(a[3] ?? a[4]);
    stack.at(-1).kids.push(el);
    if (!selfClose) stack.push(el);
  }
  return root.kids.find(k => k.name) ?? null;
}
function findTagEnd(s, i) {
  let q = null;
  for (let j = i + 1; j < s.length; j++) {
    const c = s[j];
    if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '>') return j;
  }
  return s.length - 1;
}

/**
 * Reads a PropertyList file into `target` (or a new node). `fg` is the FGFS resolver; `file` is FG_ROOT-relative.
 * include paths resolve relative to the including file first, then FG_ROOT, then the aircraft dir.
 */
export async function readProps(fg, file, target = new PNode('PropertyList'), ctx = {}) {
  const text = await fg.readText(file);
  if (text == null) throw new Error(`missing ${file}`);
  const xml = parseXml(text);
  if (!xml) return target;
  await applyElement(fg, xml, target, path.posix.dirname(normalize(file)), ctx);
  target.file ??= normalize(file);
  return target;
}

async function resolveInclude(fg, inc, baseDir, ctx) {
  const cands = [normalize(`${baseDir}/${inc}`), normalize(inc)];
  if (ctx.aircraftDir) cands.push(normalize(`${ctx.aircraftDir}/${inc}`));
  for (const c of cands) if (await fg.exists(c)) return c;
  return null;
}

async function applyElement(fg, el, node, baseDir, ctx) {
  if (el.attrs.include) {
    const inc = await resolveInclude(fg, el.attrs.include, baseDir, ctx);
    if (inc) await readProps(fg, inc, node, ctx);
    else fg.log?.(`  ? include not found: ${el.attrs.include} (from ${baseDir})`);
  }
  for (const [k, v] of Object.entries(el.attrs)) if (k !== 'include' && k !== 'n') node.attrs[k] = v;
  const counters = {};
  for (const k of el.kids) {
    let index;
    if (k.attrs.n != null) { index = parseInt(k.attrs.n, 10) || 0; counters[k.name] = Math.max(counters[k.name] ?? 0, index + 1); }
    else { index = counters[k.name] ?? 0; counters[k.name] = index + 1; }
    const child = node.getChild(k.name, index, true);
    child.baseDir = baseDir;
    await applyElement(fg, k, child, baseDir, ctx);
  }
  if (el.kids.length === 0 && el.text.trim() !== '') node.value = el.text;
  else if (el.kids.length === 0 && !el.attrs.include) node.value = el.text;
}
