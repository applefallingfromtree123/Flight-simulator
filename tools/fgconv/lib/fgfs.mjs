// FlightGear virtual filesystem: resolves "Aircraft/<name>/..." paths against a local cache,
// downloading on demand from FGAddon (SVN over HTTP) and FGData (GitLab raw).
import fs from 'node:fs';
import path from 'node:path';

const FGADDON = 'https://svn.code.sf.net/p/flightgear/fgaddon/trunk';
const FGDATA = 'https://gitlab.com/flightgear/fgdata/-/raw/next';

// Directories that never contain anything the visual model needs.
const SKIP_DIRS = new Set(['sounds', 'docs', 'doc', 'documentation', 'nasal', 'tutorials', 'dev', '_dev', 'paintkit',
  'gui', 'previews', 'dialogs', 'splash', 'fmc-db', 'efb-db', 'webpanel', 'ci', 'kneeboards', 'scenarios',
  'checklists', 'fms', 'states', 'aircraftconfig', 'sview', 'fde', 'engines', 'systems', 'ai', 'dualcontrol']);
const SKIP_EXT = /\.(wav|ogg|mp3|pdf|nas|blend\d?|xcf|psd|zip|7z|gz|txt|md|odt|doc|docx|svg|ttf|txf|html?|py|sh|lst|yml|kra|max|3dm|obj|mtl|dae|fbx)$/i;

export class FGFS {
  constructor(cacheDir, { offline = false, log = () => {} } = {}) {
    this.root = path.resolve(cacheDir);
    this.offline = offline;
    this.log = log;
    this.missing = new Set();
  }

  local(p) { return path.join(this.root, normalize(p)); }

  /** Candidate remote URLs for a FG_ROOT-relative path. */
  urls(p) {
    p = normalize(p);
    const enc = p.split('/').map(encodeURIComponent).join('/');
    const out = [];
    // Aircraft/<x> lives in fgaddon unless it is one of the shared fgdata folders.
    if (/^Aircraft\/(Generic|Instruments|Instruments-3d|Common|ufo|c172p|Dragonfly|Models)\//i.test(p)) out.push(`${FGDATA}/${enc}`);
    else if (p.startsWith('Aircraft/')) out.push(`${FGADDON}/${enc}`, `${FGDATA}/${enc}`);
    else out.push(`${FGDATA}/${enc}`);
    return out;
  }

  async exists(p) {
    if (fs.existsSync(this.local(p))) return true;
    return (await this.fetch(p)) != null;
  }

  /** Returns the absolute local path of a file, downloading it if needed, or null. */
  async fetch(p) {
    p = normalize(p);
    const dst = this.local(p);
    if (fs.existsSync(dst)) return dst;
    if (this.offline || this.missing.has(p)) return null;
    for (const url of this.urls(p)) {
      const buf = await get(url);
      if (buf) {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.writeFileSync(dst, buf);
        this.log(`  ↓ ${p} (${(buf.length / 1024).toFixed(0)} KB)`);
        return dst;
      }
    }
    this.missing.add(p);
    return null;
  }

  async read(p) { const f = await this.fetch(p); return f ? fs.readFileSync(f) : null; }
  async readText(p) { const b = await this.read(p); return b ? stripBom(b.toString('utf8')) : null; }

  /** Lists a directory (names; directories end with "/"). Uses the SVN HTML index for fgaddon paths. */
  async list(dir) {
    dir = normalize(dir).replace(/\/$/, '');
    const local = this.local(dir);
    const marker = path.join(local, '.listing.json');
    if (fs.existsSync(marker)) return JSON.parse(fs.readFileSync(marker, 'utf8'));
    let names = null;
    if (!this.offline && dir.startsWith('Aircraft/')) {
      const html = await get(`${FGADDON}/${dir.split('/').map(encodeURIComponent).join('/')}/`);
      if (html) names = [...html.toString('utf8').matchAll(/<li><a href="([^"]+)">/g)].map(m => decodeURIComponent(m[1])).filter(n => n !== '../');
    }
    if (!names && fs.existsSync(local)) {
      names = fs.readdirSync(local, { withFileTypes: true }).filter(d => !d.name.startsWith('.'))
        .map(d => d.isDirectory() ? d.name + '/' : d.name);
      return names;
    }
    if (!names) return [];
    fs.mkdirSync(local, { recursive: true });
    fs.writeFileSync(marker, JSON.stringify(names));
    return names;
  }

  /** Mirrors an aircraft folder (minus sounds, docs, scripts, etc.) with parallel downloads. */
  async mirror(dir, { concurrency = 16 } = {}) {
    const files = [];
    const walk = async (d) => {
      const names = await this.list(d);
      const subdirs = [];
      for (const n of names) {
        if (n.endsWith('/')) { if (!SKIP_DIRS.has(n.slice(0, -1).toLowerCase())) subdirs.push(`${d}/${n.slice(0, -1)}`); }
        else if (!SKIP_EXT.test(n)) files.push(`${d}/${n}`);
      }
      await pool(subdirs, 8, walk);
    };
    await walk(normalize(dir).replace(/\/$/, ''));
    let done = 0;
    await pool(files, concurrency, async (f) => {
      await this.fetch(f);
      if (++done % 50 === 0) this.log(`  ${done}/${files.length} files`);
    });
    return files.length;
  }
}

export function normalize(p) {
  p = p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\.\//, '');
  const out = [];
  for (const seg of p.split('/')) {
    if (seg === '..') out.pop();
    else if (seg !== '.' && seg !== '') out.push(seg);
  }
  return out.join('/');
}

export function stripBom(s) { return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s; }

async function get(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (res.status === 404 || res.status === 403) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ct = res.headers.get('content-type') || '';
      const buf = Buffer.from(await res.arrayBuffer());
      // GitLab answers unknown raw paths with its HTML sign-in page instead of a 404.
      if (url.includes('gitlab.com') && ct.includes('text/html')) return null;
      return buf;
    } catch (e) {
      if (i === tries - 1) { console.warn(`  ! ${url}: ${e.message}`); return null; }
      await new Promise(r => setTimeout(r, 1000 * 2 ** i));
    }
  }
  return null;
}

export async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}
