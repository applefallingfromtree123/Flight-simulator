// Airline management: found an airline at a hub, buy or lease aircraft, open routes between real airports,
// set frequency and fares, and run it day by day — passenger demand from airport size, distance, fare and
// reputation; costs from fuel, crew, fees, maintenance and leases. Routes can also be flown by the player.
import type { AircraftDef } from '../sim/types.ts';
import { AIRCRAFT, getAircraft } from '../sim/aircraftDb.ts';
import type { Airport, AirportDB } from '../world/airports.ts';
import { distance } from '../core/geo.ts';

export interface Plane {
  id: string; type: string; reg: string; owned: boolean; base: string; hours: number; condition: number;
  /** Owned aircraft leased out to another airline: daily income, not available for routes. */
  leasedOut?: { perDay: number; since: number };
}
/** A maintenance base: aircraft flying through it are looked after every day and cheaper to fix. */
export interface Hangar { icao: string; since: number }
export interface Route { id: string; from: string; to: string; planeId: string; perDay: number; fare: number }
export interface DayLine { route: string; flights: number; pax: number; seats: number; revenue: number; cost: number }
export interface DayReport { day: number; lines: DayLine[]; revenue: number; cost: number; leases: number; profit: number; events: string[] }
export interface Airline {
  name: string; code: string; hub: string; cash: number; day: number; rep: number;
  /** All hubs (the first is the main hub); routes start at any of them. */
  hubs?: string[];
  hangars?: Hangar[];
  /** Emergency loan outstanding (USD) and consecutive days with negative cash. */
  loan?: number; debtDays?: number;
  /** Set when the airline went bankrupt: the fleet is seized and the game is over. */
  bankrupt?: { day: number; debt: number; reason: string; fleet: number; routes: number; best: number };
  bestCash?: number;
  fleet: Plane[]; routes: Route[]; last: DayReport | null; history: { day: number; cash: number }[];
  flightNo: number;
}

const KEY = 'sky.airline';
export const loadAirline = (): Airline | null => {
  try {
    const s = localStorage.getItem(KEY);
    if (!s) return null;
    const a = JSON.parse(s) as Airline;
    a.hubs ??= [a.hub];          // saves from before multiple hubs
    a.hangars ??= [];
    return a;
  } catch { return null; }
};
export const saveAirline = (a: Airline | null) => { try { if (a) localStorage.setItem(KEY, JSON.stringify(a)); else localStorage.removeItem(KEY); } catch { /* ignore */ } };

export function newAirline(name: string, code: string, hub: string): Airline {
  return { name, code: code.toUpperCase().slice(0, 3), hub, hubs: [hub], hangars: [], cash: 60_000_000, day: 1, rep: 50, fleet: [], routes: [], last: null, history: [], flightNo: 100 };
}

// ---- hubs, hangars and the aircraft market for owned planes ----
/** Opening a hub (gates, lounges, ground handling contracts) and its daily cost, by airport size. */
export const hubCost = (apt: Airport) => ({ open: apt.size === 3 ? 18_000_000 : apt.size === 2 ? 6_000_000 : 1_500_000, perDay: apt.size === 3 ? 6000 : apt.size === 2 ? 2500 : 700 });
/** Building a hangar anywhere, and its daily upkeep. */
export const hangarCost = (apt: Airport) => ({ build: apt.size === 3 ? 25_000_000 : apt.size === 2 ? 14_000_000 : 6_000_000, perDay: 4000 });
/** What a buyer pays for an owned aircraft: list price, less age (hours) and wear. */
export function resaleValue(p: Plane) {
  const m = market().find(x => x.def.id === p.type);
  if (!m) return 0;
  return Math.round(m.price * Math.max(0.25, 0.78 - p.hours / 60000) * (0.55 + 0.45 * p.condition / 100) / 1e4) * 1e4;
}
/** Daily rent another airline pays for one of ours (wet-lease rates are a bit under the market lease). */
export const leaseOutRate = (p: Plane) => Math.round((market().find(x => x.def.id === p.type)?.leasePerDay ?? 0) * 0.8 / 100) * 100;
/** Ending a lease early: a month's rent as the termination fee. */
export const returnFee = (p: Plane) => (market().find(x => x.def.id === p.type)?.leasePerDay ?? 0) * 30;
/** Does a hangar look after this aircraft (it flies to or from a hangar airport)? */
export function servedByHangar(al: Airline, p: Plane) {
  const at = new Set((al.hangars ?? []).map(h => h.icao));
  return al.routes.some(r => r.planeId === p.id && (at.has(r.from) || at.has(r.to))) || at.has(p.base);
}

/** Aircraft that make sense for an airline (passenger types), with a list price in USD. */
export function market(): { def: AircraftDef; price: number; leasePerDay: number; seats: number }[] {
  return AIRCRAFT.filter(a => (a.seats ?? 0) >= 4 && a.fdm !== 'rotor' && a.cat !== 'military' && a.cat !== 'glider')
    .map(def => {
      const seats = def.seats ?? 4;
      // list prices per seat; a dry lease costs ~0.85 % of the price a month
      const price = Math.round((def.cat === 'widebody' ? 0.8e6 : def.cat === 'airliner' ? 0.5e6 : def.cat === 'regional' ? 0.45e6 : def.cat === 'bizjet' ? 2.0e6 : def.cat === 'turboprop' ? 0.3e6 : 0.08e6) * seats / 1e5) * 1e5;
      return { def, price, leasePerDay: Math.round(price * 0.00028 / 100) * 100, seats };
    })
    .sort((a, b) => a.price - b.price);
}

const km = (a: Airport, b: Airport) => distance(a, b) / 1000;
/** Typical one-way fare (USD) for a distance: what passengers compare yours with. */
export const refFare = (dKm: number) => Math.round(45 + dKm * 0.11);

function rangeKm(def: AircraftDef) {
  return def.cat === 'widebody' ? 13000 : def.cat === 'airliner' ? 5800 : def.cat === 'regional' ? 3200 : def.cat === 'bizjet' ? 6500 : def.cat === 'turboprop' ? 1800 : 1100;
}
export function canFly(def: AircraftDef, a: Airport, b: Airport) {
  const longest = (x: Airport) => Math.max(0, ...x.runways.map(r => r.length));
  const need = def.cat === 'widebody' ? 2500 : def.cat === 'airliner' ? 1900 : def.cat === 'regional' ? 1400 : 700;
  if (km(a, b) > rangeKm(def)) return `항속거리 초과 (${Math.round(km(a, b))} km > ${rangeKm(def)} km)`;
  if (longest(a) < need || longest(b) < need) return `활주로가 짧습니다 (${need} m 필요)`;
  return '';
}
/** Block time (h) and flights a plane can do per day on a route (18 operating hours, 45-min turns). */
export function blockHours(def: AircraftDef, dKm: number) { return dKm / 1.852 / Math.max(120, def.v.cruise * 0.9) + 0.45; }
export function maxPerDay(def: AircraftDef, dKm: number) { return Math.max(1, Math.floor(18 / (blockHours(def, dKm) + 0.75))); }

/** Daily passengers wanting to fly a route (both directions) at the reference fare. */
function demand(a: Airport, b: Airport, rep: number) {
  const size = (x: Airport) => (x.size === 3 ? 6 : x.size === 2 ? 2 : 0.4);
  const d = km(a, b);
  const distFactor = d < 150 ? 0.4 : d < 600 ? 1 : d < 3000 ? 0.85 : 0.6;
  return 260 * size(a) * size(b) * distFactor * (0.6 + rep / 125);
}

/** One flight's economics (also used when the player flies it). */
export function flightEconomics(al: Airline, r: Route, db: AirportDB, competitionShare = 1) {
  const a = db.get(r.from)!, b = db.get(r.to)!, p = al.fleet.find(x => x.id === r.planeId)!;
  const def = getAircraft(p.type), d = km(a, b), seats = def.seats ?? 4;
  const elasticity = Math.pow(refFare(d) / Math.max(10, r.fare), 1.6);
  const perFlightDemand = demand(a, b, al.rep) * elasticity * competitionShare / Math.max(1, r.perDay * 2) * 2;
  const pax = Math.max(0, Math.min(seats, Math.round(perFlightDemand * (0.85 + Math.random() * 0.3))));
  const bh = blockHours(def, d);
  const fuelKgPerH = def.m.fuel / Math.max(2, rangeKm(def) / 1.852 / def.v.cruise);
  const fuel = fuelKgPerH * bh * 0.85;                       // USD at ~0.85 $/kg
  const crew = bh * (def.cat === 'widebody' ? 3200 : def.cat === 'airliner' ? 1800 : 900);
  const fees = (b.size === 3 ? 3500 : b.size === 2 ? 1300 : 250) * Math.min(2.5, Math.max(0.3, seats / 150)) + pax * 6;
  const maint = bh * seats * 4.5 * (1.3 - p.condition / 330) * (servedByHangar(al, p) ? 0.7 : 1);
  return { pax, seats, revenue: pax * r.fare, cost: Math.round(fuel + crew + fees + maint), hours: bh };
}

/** Run one day of the airline. */
export function runDay(al: Airline, db: AirportDB): DayReport {
  const lines: DayLine[] = [], events: string[] = [];
  for (const r of al.routes) {
    const p = al.fleet.find(x => x.id === r.planeId);
    if (!p || p.leasedOut || !db.get(r.from) || !db.get(r.to)) continue;
    let flights = r.perDay * 2;  // there and back
    if (p.condition < 45 && Math.random() < 0.25) { flights = Math.max(0, flights - 2); events.push(`${p.reg} 정비 문제로 ${r.from}–${r.to} 2편 결항`); al.rep = Math.max(0, al.rep - 2); }
    let pax = 0, seats = 0, revenue = 0, cost = 0;
    for (let i = 0; i < flights; i++) {
      const e = flightEconomics(al, i % 2 ? { ...r, from: r.to, to: r.from } : r, db);
      pax += e.pax; seats += e.seats; revenue += e.revenue; cost += e.cost;
      p.hours += e.hours; p.condition = Math.max(10, p.condition - e.hours * 0.06);
    }
    lines.push({ route: `${r.from}–${r.to}`, flights, pax, seats, revenue, cost });
  }
  const leases = al.fleet.filter(p => !p.owned).reduce((s, p) => s + (market().find(m => m.def.id === p.type)?.leasePerDay ?? 0), 0);
  // aircraft we lease out to others pay us rent; hubs and hangars cost upkeep; hangars look after their aircraft
  const rentIn = al.fleet.reduce((s, p) => s + (p.leasedOut?.perDay ?? 0), 0);
  const hubFees = (al.hubs ?? [al.hub]).reduce((s, h) => { const a = db.get(h); return s + (a ? hubCost(a).perDay : 0); }, 0);
  const hangarFees = (al.hangars ?? []).reduce((s, h) => { const a = db.get(h.icao); return s + (a ? hangarCost(a).perDay : 0); }, 0);
  for (const p of al.fleet) if (servedByHangar(al, p)) p.condition = Math.min(100, p.condition + 3);
  if (rentIn) events.push(`임대 수입 +$${rentIn.toLocaleString()}`);
  const revenue = lines.reduce((s, l) => s + l.revenue, 0) + rentIn;
  const cost = lines.reduce((s, l) => s + l.cost, 0) + al.fleet.filter(p => !p.leasedOut).length * 1500 + hubFees + hangarFees;
  const profit = revenue - cost - leases;
  // reputation follows how full and how cheap the flights are
  const lf = lines.reduce((s, l) => s + l.pax, 0) / Math.max(1, lines.reduce((s, l) => s + l.seats, 0));
  if (lines.length) al.rep = Math.max(0, Math.min(100, al.rep + (lf > 0.95 ? -0.5 : 0.3) + (lf < 0.4 ? 0.4 : 0)));
  if (Math.random() < 0.06) { const bonus = Math.round(revenue * 0.1); events.push(`성수기 수요 증가! +$${bonus.toLocaleString()}`); al.cash += bonus; }
  al.cash += profit;
  solvency(al, events);
  const rep: DayReport = { day: al.day, lines, revenue, cost, leases, profit, events };
  al.last = rep; al.day++;
  al.history.push({ day: al.day, cash: al.cash });
  if (al.history.length > 60) al.history.shift();
  return rep;
}

// ───────────── loans and bankruptcy ─────────────
/** Days of negative cash before the creditors take over. */
export const GRACE_DAYS = 7;
/** Net worth below which the airline is insolvent at once. */
export const INSOLVENT = -50_000_000;
export const loanRate = 0.0006;   // per day (~24 %/yr): emergency money is expensive
/** What owned aircraft would fetch, the loan outstanding and the resulting net worth. */
export function netWorth(al: Airline) {
  const assets = al.fleet.filter(p => p.owned).reduce((s, p) => s + resaleValue(p), 0);
  return { assets, loan: al.loan ?? 0, worth: al.cash + assets - (al.loan ?? 0) };
}
/** Credit line: a base amount plus half of what the owned fleet is worth, less what is already borrowed. */
export function loanLimit(al: Airline) { return Math.max(0, Math.round((30_000_000 + netWorth(al).assets * 0.5 - (al.loan ?? 0)) / 1e6) * 1e6); }
export function takeLoan(al: Airline, amt: number) {
  const a = Math.min(amt, loanLimit(al));
  if (a <= 0 || al.bankrupt) return 0;
  al.loan = (al.loan ?? 0) + a; al.cash += a;
  return a;
}
export function repayLoan(al: Airline, amt: number) {
  const a = Math.min(amt, al.loan ?? 0, Math.max(0, al.cash));
  al.loan = (al.loan ?? 0) - a; al.cash -= a;
  return a;
}
const money = (v: number) => (v < 0 ? '−$' : '$') + Math.abs(Math.round(v)).toLocaleString();
/** End-of-day solvency check: interest, the grace period, and bankruptcy. */
function solvency(al: Airline, events: string[]) {
  if (al.loan) {
    const i = Math.round(al.loan * loanRate);
    al.cash -= i;
    events.push(`대출 이자 −${money(i).slice(0)}`);
  }
  al.bestCash = Math.max(al.bestCash ?? 0, al.cash);
  const { worth } = netWorth(al);
  if (al.cash < 0) {
    al.debtDays = (al.debtDays ?? 0) + 1;
    const left = GRACE_DAYS - al.debtDays;
    if (left > 0) events.push(`자금 부족 (${al.debtDays}일째) — ${left}일 안에 자금을 플러스로 돌리지 못하면 파산합니다`);
  } else al.debtDays = 0;
  const reason = worth < INSOLVENT ? `순자산 ${money(worth)} — 채무 초과`
    : (al.debtDays ?? 0) >= GRACE_DAYS ? `${GRACE_DAYS}일 연속 자금 부족 — 채권단이 회사를 인수했습니다` : '';
  if (reason) {
    al.bankrupt = { day: al.day, debt: Math.round(Math.max(0, (al.loan ?? 0) - al.cash)), reason, fleet: al.fleet.length, routes: al.routes.length, best: Math.round(al.bestCash ?? 0) };
    events.push(`💥 파산: ${reason}`);
  }
}

export function registration(al: Airline) {
  const n = al.fleet.length + 1;
  return `HL${String(7000 + n * 37 % 999).padStart(4, '0')}`;
}
export const callsignOf = (al: Airline | null) => (al ? `${al.name.split(/\s+/)[0]} ${al.flightNo}` : 'SkyLine 123');
