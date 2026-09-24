// Builds compact airport / runway / navaid databases from OurAirports (public domain).
// Usage: node tools/build-data.mjs [dir-with-csv]   (downloads the CSVs if no dir given)
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/';
const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../public/data');

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift();
  return rows.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

async function load(name, dir) {
  if (dir) return fs.readFileSync(path.join(dir, name + '.csv'), 'utf8');
  const r = await fetch(SRC + name + '.csv');
  if (!r.ok) throw new Error(name + ': ' + r.status);
  return r.text();
}

const r5 = v => Math.round(v * 1e5) / 1e5;
const dir = process.argv[2];
const airports = parseCSV(await load('airports', dir));
const runways = parseCSV(await load('runways', dir));
const navaids = parseCSV(await load('navaids', dir));

const HARD = /ASP|CON|PEM|BIT|ASPH|CONC|TAR|MAC/i;
const rwyByApt = new Map();
for (const r of runways) {
  if (r.closed === '1') continue;
  const la1 = parseFloat(r.le_latitude_deg), lo1 = parseFloat(r.le_longitude_deg);
  const la2 = parseFloat(r.he_latitude_deg), lo2 = parseFloat(r.he_longitude_deg);
  if (![la1, lo1, la2, lo2].every(Number.isFinite)) continue;
  const len = parseFloat(r.length_ft) || 0;
  if (len < 800) continue;
  const list = rwyByApt.get(r.airport_ident) ?? [];
  list.push([
    r.le_ident, r5(la1), r5(lo1), Math.round(parseFloat(r.le_elevation_ft) || NaN) || null, parseFloat(r.le_displaced_threshold_ft) || 0,
    r.he_ident, r5(la2), r5(lo2), Math.round(parseFloat(r.he_elevation_ft) || NaN) || null, parseFloat(r.he_displaced_threshold_ft) || 0,
    Math.round(len), Math.round(parseFloat(r.width_ft) || 100), HARD.test(r.surface) ? 1 : 0, r.lighted === '1' ? 1 : 0,
  ]);
  rwyByApt.set(r.airport_ident, list);
}

const TYPES = { large_airport: 3, medium_airport: 2, small_airport: 1 };
const out = [];
for (const a of airports) {
  const t = TYPES[a.type];
  if (!t) continue;
  const rw = rwyByApt.get(a.ident);
  if (!rw) continue;
  // keep small airports only if they have a hard-surface runway
  if (t === 1 && !rw.some(r => r[12])) continue;
  out.push([
    a.ident, a.name, r5(+a.latitude_deg), r5(+a.longitude_deg), Math.round(+a.elevation_ft || 0), t,
    a.iso_country, a.municipality, a.iata_code, rw,
  ]);
}
out.sort((a, b) => b[5] - a[5]);

const NT = { VOR: 1, 'VOR-DME': 2, VORTAC: 3, TACAN: 4, NDB: 5, 'NDB-DME': 6, DME: 7 };
const nav = [];
for (const n of navaids) {
  const la = parseFloat(n.latitude_deg), lo = parseFloat(n.longitude_deg);
  if (!Number.isFinite(la) || !Number.isFinite(lo) || !NT[n.type]) continue;
  nav.push([n.ident, n.name, NT[n.type], +n.frequency_khz || 0, r5(la), r5(lo), Math.round(+n.elevation_ft || 0), Math.round((+n.magnetic_variation_deg || 0) * 10) / 10]);
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'airports.json'), JSON.stringify(out));
fs.writeFileSync(path.join(OUT, 'navaids.json'), JSON.stringify(nav));
console.log(`airports: ${out.length}, navaids: ${nav.length}`);
