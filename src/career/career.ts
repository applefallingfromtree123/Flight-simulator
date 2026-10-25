// Career mode: pilot profile, licences that unlock aircraft classes, a job board generated from
// the real airport network around the pilot's current location, flight evaluation and logbook.
import type { AircraftDef } from '../sim/types.ts';
import { AIRCRAFT } from '../sim/aircraftDb.ts';
import type { Airport, AirportDB } from '../world/airports.ts';
import { distance } from '../core/geo.ts';

export type JobClass = 'ga' | 'twin' | 'heli' | 'turboprop' | 'bizjet' | 'regional' | 'airliner' | 'widebody';
export interface Licence { id: string; name: string; xp: number; classes: JobClass[] }

export const LICENCES: Licence[] = [
  { id: 'SPL', name: '학생 조종사 (SPL)', xp: 0, classes: ['ga'] },
  { id: 'PPL', name: '자가용 조종사 (PPL)', xp: 400, classes: ['ga', 'twin', 'heli'] },
  { id: 'CPL', name: '사업용 조종사 (CPL)', xp: 1500, classes: ['ga', 'twin', 'heli', 'turboprop', 'bizjet'] },
  { id: 'ATPL', name: '운송용 조종사 (ATPL)', xp: 4000, classes: ['ga', 'twin', 'heli', 'turboprop', 'bizjet', 'regional', 'airliner'] },
  { id: 'CPT', name: '대형기 기장 (Heavy Captain)', xp: 9000, classes: ['ga', 'twin', 'heli', 'turboprop', 'bizjet', 'regional', 'airliner', 'widebody'] },
];

export const CLASS_LABEL: Record<JobClass, string> = {
  ga: '단발 피스톤', twin: '쌍발 피스톤', heli: '헬리콥터', turboprop: '터보프롭', bizjet: '비즈니스 제트', regional: '리저널', airliner: '협동체 여객기', widebody: '광동체 여객기',
};

export function classOf(a: AircraftDef): JobClass | null {
  if (a.fdm === 'rotor') return a.id === 'ch47' || a.id === 'uh60' ? null : 'heli';
  if (a.cat === 'glider' || a.cat === 'military' && a.id !== 'c130j') return null;
  if (a.id === 'c130j') return 'turboprop';
  if (a.cat === 'ga' || a.cat === 'vintage') return a.eng.n > 1 ? 'twin' : 'ga';
  if (a.cat === 'turboprop') return 'turboprop';
  if (a.cat === 'bizjet') return 'bizjet';
  if (a.cat === 'regional') return 'regional';
  if (a.cat === 'airliner') return 'airliner';
  if (a.cat === 'widebody') return a.id === 'concorde' ? 'widebody' : 'widebody';
  return null;
}

/** Distance band (NM), minimum runway (m) and pay per NM per class. */
const CLASS_JOB: Record<JobClass, { min: number; max: number; rwy: number; perNm: number; kind: ('pax' | 'cargo' | 'ferry' | 'tour' | 'medical')[] }> = {
  ga: { min: 15, max: 160, rwy: 500, perNm: 9, kind: ['pax', 'cargo', 'ferry', 'tour'] },
  twin: { min: 60, max: 400, rwy: 800, perNm: 14, kind: ['pax', 'cargo', 'ferry'] },
  heli: { min: 8, max: 120, rwy: 0, perNm: 26, kind: ['medical', 'pax', 'tour', 'cargo'] },
  turboprop: { min: 80, max: 650, rwy: 900, perNm: 22, kind: ['pax', 'cargo', 'medical'] },
  bizjet: { min: 200, max: 2200, rwy: 1300, perNm: 38, kind: ['pax', 'ferry'] },
  regional: { min: 150, max: 900, rwy: 1500, perNm: 46, kind: ['pax', 'cargo'] },
  airliner: { min: 250, max: 2400, rwy: 2000, perNm: 70, kind: ['pax', 'cargo'] },
  widebody: { min: 1800, max: 7000, rwy: 2700, perNm: 120, kind: ['pax', 'cargo'] },
};

const CLIENTS: Record<string, string[]> = {
  pax: ['한빛 에어택시', 'Blue Horizon Charter', '스카이브릿지 항공', 'Pacific Link', '코리아 익스프레스', 'Aurora Air', '누리항공'],
  cargo: ['K-Logistics', '동방 화물', 'AirFreight Asia', '퀵카고', 'Global Parcel', '한라 물류'],
  ferry: ['정비 회사 기체 이송', '리스사 반납 비행', '신규 기체 인도', '중고기 매매 이송'],
  tour: ['관광 비행', '항공 촬영', '유람 비행'],
  medical: ['닥터헬기 환자 이송', '장기 이식 긴급 수송', '응급 의료 후송'],
};
const KIND_LABEL = { pax: '여객', cargo: '화물', ferry: '페리', tour: '관광', medical: '응급' } as const;

export interface Job {
  id: string; cls: JobClass; kind: keyof typeof KIND_LABEL; client: string;
  from: string; to: string; nm: number; pax: number; cargoKg: number; pay: number; xp: number;
}
export interface LogEntry {
  t: number; from: string; to: string; ac: string; min: number; fpm: number | null;
  result: 'ok' | 'diverted' | 'crash' | 'abandoned'; pay: number; xp: number; note: string;
}
export interface CareerState {
  name: string; home: string; location: string; started: number;
  money: number; xp: number; hours: number; flights: number; rep: number;
  log: LogEntry[]; jobs: Job[]; jobsFor: string; active: Job | null;
}

const KEY = 'sky.career';
export function loadCareer(): CareerState | null { try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) as CareerState : null; } catch { return null; } }
export function saveCareer(c: CareerState | null) { try { if (c) localStorage.setItem(KEY, JSON.stringify(c)); else localStorage.removeItem(KEY); } catch { /* ignore */ } }

export function newCareer(name: string, home: string): CareerState {
  return { name, home, location: home, started: Date.now(), money: 5000, xp: 0, hours: 0, flights: 0, rep: 50, log: [], jobs: [], jobsFor: '', active: null };
}

export function licenceOf(c: CareerState): Licence { return [...LICENCES].reverse().find(l => c.xp >= l.xp)!; }
export function nextLicence(c: CareerState): Licence | null { return LICENCES.find(l => l.xp > c.xp) ?? null; }
export function allowed(c: CareerState, a: AircraftDef) { const k = classOf(a); return !!k && licenceOf(c).classes.includes(k); }
export function eligibleAircraft(c: CareerState, cls: JobClass) { return AIRCRAFT.filter(a => classOf(a) === cls && allowed(c, a)); }

function seeded(seed: number) { let s = seed >>> 0 || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

/** Job board for the pilot's current airport (regenerated when they move or ask). */
export function generateJobs(c: CareerState, db: AirportDB, seed = Date.now()): Job[] {
  const here = db.get(c.location);
  if (!here) return [];
  const rnd = seeded(seed);
  const classes = licenceOf(c).classes;
  const jobs: Job[] = [];
  const longest = (a: Airport) => Math.max(0, ...a.runways.filter(r => r.hard || a.size === 1).map(r => r.length));
  for (const cls of classes) {
    const spec = CLASS_JOB[cls];
    // candidate destinations in the class's distance band
    const cands = db.airports.filter(a => {
      if (a === here) return false;
      const nm = distance(here, a) / 1852;
      if (nm < spec.min || nm > spec.max) return false;
      if (cls === 'heli') return true;
      if (longest(a) < spec.rwy) return false;
      return cls === 'ga' || cls === 'twin' ? true : a.size >= (cls === 'widebody' || cls === 'airliner' ? 3 : 2);
    });
    if (!cands.length) continue;
    const n = cls === classes[classes.length - 1] ? 4 : 2;
    for (let i = 0; i < n; i++) {
      const to = cands[Math.floor(rnd() * cands.length)];
      const nm = Math.round(distance(here, to) / 1852);
      const kind = spec.kind[Math.floor(rnd() * spec.kind.length)];
      const ac = eligibleAircraft(c, cls)[0];
      const cap = ac ? ac.m.pay : 500;
      const load = 0.4 + rnd() * 0.55;
      const pax = kind === 'pax' || kind === 'tour' ? Math.max(1, Math.round((ac?.seats ?? 4) * load)) : kind === 'medical' ? 1 : 0;
      const cargoKg = kind === 'cargo' ? Math.round(cap * load / 10) * 10 : kind === 'medical' ? 120 : 0;
      const pay = Math.round((spec.perNm * nm * (0.85 + rnd() * 0.4) * (kind === 'medical' ? 1.6 : kind === 'ferry' ? 0.7 : 1) + 200) / 10) * 10;
      const xp = Math.round(30 + nm * (cls === 'ga' || cls === 'heli' ? 2.2 : cls === 'twin' ? 1.6 : 0.9) + (kind === 'medical' ? 40 : 0));
      const names = CLIENTS[kind];
      jobs.push({ id: `${seed}-${cls}-${i}`, cls, kind, client: names[Math.floor(rnd() * names.length)], from: here.icao, to: to.icao, nm, pax, cargoKg, pay, xp });
    }
  }
  return jobs.sort((a, b) => a.nm - b.nm);
}

export function jobTitle(j: Job) {
  const load = j.kind === 'cargo' ? `화물 ${j.cargoKg.toLocaleString()} kg` : j.kind === 'medical' ? '환자 1명 + 의료진' : j.kind === 'ferry' ? '기체 이송 (무탑재)' : `승객 ${j.pax}명`;
  return `${KIND_LABEL[j.kind]} · ${load}`;
}

/** Payload fraction for the chosen aircraft. */
export function payloadPct(j: Job, a: AircraftDef) {
  const kg = j.kind === 'cargo' || j.kind === 'medical' ? j.cargoKg + j.pax * 90 : j.pax * 95;
  return Math.max(0, Math.min(100, Math.round((kg / Math.max(1, a.m.pay)) * 100)));
}

export interface FlightResult { landedAt: string | null; crashed: boolean; fpm: number | null; minutes: number; overspeed: number; aborted?: boolean }
export interface Grade { result: LogEntry['result']; pay: number; xp: number; rep: number; lines: [string, string][] }

/** Score a finished job flight and apply it to the career. */
export function finishJob(c: CareerState, job: Job, acName: string, r: FlightResult): Grade {
  const lines: [string, string][] = [];
  let pay = 0, xp = 0, rep = 0;
  let result: LogEntry['result'];
  if (r.crashed) {
    result = 'crash';
    const repair = Math.round(job.pay * 1.5);
    pay = -repair; rep = -12;
    lines.push(['결과', '사고 — 임무 실패'], ['수리비 / 배상', `−$${repair.toLocaleString()}`]);
  } else if (r.aborted) {
    result = 'abandoned'; rep = -4;
    lines.push(['결과', '임무 포기']);
  } else if (r.landedAt === job.to) {
    result = 'ok';
    pay = job.pay; xp = job.xp;
    lines.push(['기본 보수', `$${job.pay.toLocaleString()}`]);
    if (r.fpm !== null) {
      const f = r.fpm;
      const [label, k, rp] = f < 120 ? ['버터 착륙 보너스', 0.15, 3] : f < 240 ? ['부드러운 착륙 보너스', 0.08, 2] : f < 400 ? ['정상 착륙', 0, 1] : f < 600 ? ['거친 착륙 감점', -0.1, -1] : ['하드 랜딩 감점 (기체 점검)', -0.3, -4];
      const b = Math.round(job.pay * k);
      pay += b; rep += rp;
      lines.push([`착륙 ${Math.round(f)} fpm`, `${label} ${b >= 0 ? '+' : '−'}$${Math.abs(b).toLocaleString()}`]);
    }
    if (r.overspeed > 5) { const pen = Math.round(job.pay * 0.1); pay -= pen; rep -= 1; lines.push(['과속 경고', `−$${pen.toLocaleString()}`]); }
  } else {
    result = 'diverted';
    pay = Math.round(job.pay * 0.25); xp = Math.round(job.xp * 0.4); rep = -2;
    lines.push(['결과', `회항 (${r.landedAt ?? '공항 외'} 착륙) — 보수 25%`]);
  }
  rep = Math.max(-100, rep);
  c.money += pay; c.xp += xp; c.rep = Math.max(0, Math.min(100, c.rep + rep));
  c.hours += r.minutes / 60; c.flights += 1;
  if (r.landedAt) c.location = r.landedAt;
  c.active = null; c.jobs = []; c.jobsFor = '';
  c.log.unshift({ t: Date.now(), from: job.from, to: r.landedAt ?? '—', ac: acName, min: Math.round(r.minutes), fpm: r.fpm === null ? null : Math.round(r.fpm), result, pay, xp, note: jobTitle(job) });
  c.log = c.log.slice(0, 100);
  lines.push(['경험치', `+${xp} XP`], ['평판', `${rep >= 0 ? '+' : ''}${rep}`], ['총 비행시간', `${c.hours.toFixed(1)} h`]);
  return { result, pay, xp, rep, lines };
}
