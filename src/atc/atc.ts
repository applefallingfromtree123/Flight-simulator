// ATC: clearance delivery, ground (push/start, taxi), tower (takeoff, landing), departure, centre and approach,
// following the flight like a real controller would. ICAO phraseology spoken in English (Web Speech) with a
// Korean subtitle; the pilot's requests are buttons and the readbacks are read automatically.
import { distance, bearing } from '../core/geo.ts';
import { FT, KT, NM } from '../core/math.ts';
import type { Aircraft } from '../sim/fdm.ts';
import type { Airport, RunwayEnd } from '../world/airports.ts';
import type { AirportLayout, Stand } from '../world/gates.ts';
import { taxiRoute } from '../world/gates.ts';
import { speak } from '../sim/passengers.ts';

export type AtcPhase = 'parked' | 'cleared' | 'push' | 'taxi' | 'holding' | 'takeoff' | 'climb' | 'cruise' | 'descent' | 'approach' | 'final' | 'landed' | 'taxiin' | 'done';
type Station = 'DEL' | 'GND' | 'TWR' | 'DEP' | 'CTR' | 'APP';
export interface AtcLine { who: 'atc' | 'pilot' | 'other'; station: string; text: string; ko: string }

export interface AtcSetup {
  callsign: string;          // "SkyLine 123"
  dep: Airport; depEnd: RunwayEnd; arr?: Airport; arrEnd?: RunwayEnd;
  cruiseFt: number; atGate: boolean; stand?: Stand;
  wind: () => { dir: number; spd: number };
  boarded: () => boolean;
  enginesRunning: () => boolean;
  onPushback: () => void;
  pushDone: () => boolean;
  /** Altimeter setting (hPa) for clearances. */
  qnh?: () => number;
}

/** Other traffic on the frequency (airline, ICAO telephony, flight number). */
const TRAFFIC: [string, string][] = [['Korean Air', 'KAL'], ['Asiana', 'AAR'], ['Jeju Air', 'JJA'], ['Jin Air', 'JNA'], ['Japan Air', 'JAL'], ['All Nippon', 'ANA'],
  ['Cathay', 'CPX'], ['Lufthansa', 'DLH'], ['Speedbird', 'BAW'], ['United', 'UAL'], ['Delta', 'DAL'], ['Emirates', 'UAE'], ['Singapore', 'SIA'], ['Air China', 'CCA'], ['Qatari', 'QTR'], ['Air Busan', 'ABL']];
const ATIS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const NATO: Record<string, string> = { A: 'alpha', B: 'bravo', C: 'charlie', D: 'delta', E: 'echo', F: 'foxtrot', G: 'golf', H: 'hotel', I: 'india', J: 'juliett', K: 'kilo', L: 'lima', M: 'mike',
  N: 'november', O: 'oscar', P: 'papa', Q: 'quebec', R: 'romeo', S: 'sierra', T: 'tango', U: 'uniform', V: 'victor', W: 'whiskey', X: 'x-ray', Y: 'yankee', Z: 'zulu' };
const DIG = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'];
const digits = (s: string) => s.split('').map(c => (/\d/.test(c) ? DIG[+c] : NATO[c.toUpperCase()] ?? c)).join(' ');
const rwySay = (r: string) => digits(r.replace(/[LCR]$/, '')) + ({ L: ' left', R: ' right', C: ' center' }[r.slice(-1)] ?? '');
const freqSay = (f: number) => { const [a, b] = f.toFixed(3).replace(/0+$/, '').replace(/\.$/, '.0').split('.'); return `${digits(a)} decimal ${digits(b)}`; };
const flSay = (ft: number) => (ft >= 18000 ? `flight level ${digits(String(Math.round(ft / 100)))}` : `${ft >= 10000 ? digits(String(Math.floor(ft / 1000))) + ' thousand' : `${DIG[Math.floor(ft / 1000)]} thousand`}${ft % 1000 ? ` ${DIG[Math.round((ft % 1000) / 100)]} hundred` : ''}`);
const flText = (ft: number) => (ft >= 18000 ? `FL${Math.round(ft / 100)}` : `${ft.toLocaleString()} ft`);
const csSay = (cs: string) => cs.replace(/(\d+)$/, m => m.split('').map(c => DIG[+c]).join(' '));
const stationName = (apt: Airport) => apt.name.replace(/\b(International|Intl|Airport|Airfield|Air Base|Regional|Municipal)\b.*$/i, '').trim().split(/[\s/-]+/).slice(0, 2).join(' ') || apt.icao;

export class Atc {
  phase: AtcPhase = 'parked';
  log: AtcLine[] = [];
  freq = { station: '', mhz: 0 };
  private squawk = String(Math.floor(Math.random() * 7) + 1) + String(Math.floor(Math.random() * 8)) + String(Math.floor(Math.random() * 8)) + String(Math.floor(Math.random() * 8));
  private lastAtc: AtcLine | null = null;
  private busyUntil = 0;
  private queue: (() => void)[] = [];
  private climbFl = 0;
  muted = false;
  onChange: () => void = () => {};
  /** A transmission starts (for the radio squelch and static), with its length in ms. */
  onTx: (who: 'atc' | 'pilot' | 'other', ms: number) => void = () => {};
  private atis = ATIS[Math.floor(Math.random() * ATIS.length)];
  private nextChatter = performance.now() + 15000 + Math.random() * 20000;

  constructor(private s: AtcSetup, private ac: Aircraft) {
    this.climbFl = Math.min(s.cruiseFt, 23000);
    if (!s.atGate) this.phase = 'holding';
    this.tune(s.atGate ? 'DEL' : 'TWR', s.dep);
  }

  private mhz(st: Station, apt: Airport) {
    const f = apt.freq ?? {};
    const pick = { DEL: f.DEL ?? f.GND ?? f.TWR ?? f.CTAF, GND: f.GND ?? f.TWR ?? f.CTAF, TWR: f.TWR ?? f.CTAF, DEP: f.DEP ?? f.APP ?? f.TWR, APP: f.APP ?? f.TWR, CTR: f.APP ?? f.DEP ?? f.TWR }[st];
    return pick ?? { DEL: 121.9, GND: 121.8, TWR: 118.1, DEP: 124.5, APP: 119.3, CTR: 132.6 }[st];
  }
  private tune(st: Station, apt: Airport) {
    const nm = stationName(apt);
    this.freq = { station: `${nm} ${{ DEL: 'Delivery', GND: 'Ground', TWR: 'Tower', DEP: 'Departure', APP: 'Approach', CTR: 'Control' }[st]}`, mhz: this.mhz(st, apt) };
    this.onChange();
  }

  /** Queue a transmission so calls don't talk over each other. */
  private tx(who: 'atc' | 'pilot' | 'other', text: string, ko: string, after?: () => void, station?: string, voice?: { rate: number; pitch: number }) {
    this.queue.push(() => {
      const line: AtcLine = { who, station: station ?? (who === 'atc' ? this.freq.station : this.s.callsign), text, ko };
      this.log.push(line);
      if (this.log.length > 40) this.log.shift();
      if (who === 'atc') this.lastAtc = line;
      const ms = Math.max(1500, text.length * 48);
      if (!this.muted) speak(text, 'en-US', voice ?? (who === 'atc' ? { rate: 1.08, pitch: 0.95 } : { rate: 1.15, pitch: 1.15, voiceHint: /Daniel|Alex|Fred|Google UK|Male/ }));
      this.onTx(who, ms);
      this.busyUntil = performance.now() + ms + 350;   // a short gap between calls, as on a real frequency
      after?.();
      this.onChange();
    });
  }

  /**
   * Other traffic on the frequency: airliners getting their own clearances from the same controller, so the
   * radio sounds like a real, busy airport (ground: taxi; tower: takeoff / landing; departure / approach: levels).
   */
  private chatter() {
    const s = this.s, st = this.freq.station;
    const [tel, icao] = TRAFFIC[Math.floor(Math.random() * TRAFFIC.length)];
    const no = String(Math.floor(Math.random() * 900) + 100);
    const cs = `${tel} ${no.split('').map(c => DIG[+c]).join(' ')}`, csTxt = `${icao}${no}`;
    const rwy = (st.includes('Approach') || this.phase === 'final' || this.phase === 'approach') && s.arrEnd ? s.arrEnd.ident : s.depEnd.ident;
    const w = s.wind(), wind = `wind ${digits(String(Math.round(w.dir / 10) * 10).padStart(3, '0'))} at ${digits(String(Math.round(w.spd)))}`;
    const fl = (Math.floor(Math.random() * 12) + 24) * 10;
    const voice = { rate: 1.1 + Math.random() * 0.15, pitch: 0.8 + Math.random() * 0.5 };
    const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
    let pair: [string, string, string] | null = null;   // controller, pilot readback, Korean
    if (st.includes('Ground') || st.includes('Delivery')) pair = pick([
      [`${cs}, taxi to holding point runway ${rwySay(rwy)} via ${pick(['alpha', 'bravo', 'charlie', 'kilo'])}`, `Taxi holding point ${rwySay(rwy)}, ${cs}`, `${csTxt} 활주로 ${rwy} 대기 지점까지 택시`],
      [`${cs}, push and start approved, facing ${pick(['north', 'south', 'east', 'west'])}`, `Push and start approved, ${cs}`, `${csTxt} 푸시백 승인`],
      [`${cs}, give way to the company traffic from left to right, then continue`, `Give way, then continue, ${cs}`, `${csTxt} 좌측 항공기 먼저 통과 후 진행`]]);
    else if (st.includes('Tower') && ['holding', 'takeoff', 'final', 'landed'].includes(this.phase)) pair = pick([
      // the runway is ours: everyone else is held or sequenced behind us
      [`${cs}, hold short runway ${rwySay(rwy)}, ${this.phase === 'final' ? 'landing' : 'departing'} traffic`, `Holding short ${rwySay(rwy)}, ${cs}`, `${csTxt} 활주로 ${rwy} 진입 전 대기`],
      [`${cs}, continue approach, number two, traffic ${this.phase === 'final' ? 'on short final' : 'to depart'}`, `Continue, number two, ${cs}`, `${csTxt} 접근 계속, 2번째`],
      this.phase === 'final'
        ? [`${cs}, behind the landing ${pick(['Airbus', 'Boeing'])} on short final, line up and wait behind`, `Behind the landing traffic, line up and wait behind, ${cs}`, `${csTxt} 착륙기 뒤 진입 대기`]
        : [`${cs}, number two for departure, hold short runway ${rwySay(rwy)}`, `Number two, holding short, ${cs}`, `${csTxt} 이륙 순서 2번째`]]);
    else if (st.includes('Tower')) pair = pick([
      [`${cs}, runway ${rwySay(rwy)}, ${wind}, cleared to land`, `Cleared to land ${rwySay(rwy)}, ${cs}`, `${csTxt} 활주로 ${rwy} 착륙 허가`],
      [`${cs}, line up and wait runway ${rwySay(rwy)}`, `Line up and wait ${rwySay(rwy)}, ${cs}`, `${csTxt} 활주로 진입 후 대기`],
      [`${cs}, vacate left via next taxiway, contact ground ${freqSay(this.mhz('GND', s.arr ?? s.dep))}`, `Vacate left, ground, ${cs}`, `${csTxt} 활주로 이탈 후 지상 관제로`]]);
    else if (st.includes('Departure') || st.includes('Control')) pair = pick([
      [`${cs}, climb and maintain flight level ${digits(String(fl))}`, `Climb flight level ${digits(String(fl))}, ${cs}`, `${csTxt} FL${fl}까지 상승`],
      [`${cs}, turn right heading ${digits(String(Math.floor(Math.random() * 35 + 1) * 10).padStart(3, '0'))}, vectors for traffic`, `Right heading, ${cs}`, `${csTxt} 우선회, 교통 회피 유도`],
      [`${cs}, contact ${pick(['Seoul', 'Fukuoka', 'Shanghai', 'Tokyo'])} control ${freqSay(118 + Math.floor(Math.random() * 18) + Math.floor(Math.random() * 4) * 0.025)}`, `Changing over, ${cs}`, `${csTxt} 다음 항로 관제로 이양`]]);
    else if (st.includes('Approach')) pair = pick([
      [`${cs}, descend and maintain ${flSay(4000)}, reduce speed one eight zero knots`, `Descend four thousand, one eight zero knots, ${cs}`, `${csTxt} 4,000 ft 강하, 180kt 감속`],
      [`${cs}, turn left heading ${digits(String(Math.round(((s.arrEnd?.hdg ?? 0) + 330) % 360 / 10) * 10).padStart(3, '0'))}, cleared ILS approach runway ${rwySay(rwy)}`, `Cleared ILS ${rwySay(rwy)}, ${cs}`, `${csTxt} ILS 접근 허가`]]);
    if (!pair) return;
    this.tx('atc', pair[0], pair[2], undefined, st);
    this.tx('other', pair[1], '', undefined, csTxt, voice);
  }
  private atc(text: string, ko: string, after?: () => void) { this.tx('atc', `${csSay(this.s.callsign)}, ${text}`, ko, after); }
  private pilot(text: string, ko: string, after?: () => void) { this.tx('pilot', `${text}, ${csSay(this.s.callsign)}`, ko, after); }

  /** What the pilot can ask for now (the main radio button). */
  get request(): { label: string; send: () => void } | null {
    const s = this.s, ac = this.ac;
    if (this.queue.length || performance.now() < this.busyUntil) return { label: '교신 중…', send: () => {} };
    switch (this.phase) {
      case 'parked': return { label: 'IFR 허가 요청', send: () => this.clearance() };
      case 'cleared':
        return s.boarded() ? { label: '푸시백·시동 요청', send: () => this.push() } : { label: '탑승 중… (기다리기)', send: () => {} };
      case 'push':
        return s.pushDone() || ac.gs / KT > 2 ? { label: '택시 요청', send: () => this.taxi() } : { label: '푸시백 중…', send: () => {} };
      case 'taxi': return { label: '출발 준비 완료', send: () => this.ready() };
      case 'holding': return { label: '이륙 허가 요청', send: () => this.ready() };
      default: return null;
    }
  }

  sayAgain() { if (this.lastAtc) { this.tx('pilot', `Say again, ${csSay(this.s.callsign)}`, '다시 말씀해 주십시오'); const l = this.lastAtc; this.queue.push(() => { this.log.push(l); if (!this.muted) speak(l.text, 'en-US', { rate: 1.0 }); this.onChange(); }); } }

  private clearance() {
    const s = this.s, dest = s.arr ?? s.dep;
    this.pilot(`${this.freq.station}, ${this.s.stand ? `stand ${digits(this.s.stand.ref)}, ` : ''}information ${NATO[this.atis]}, request IFR clearance to ${digits(dest.icao)}`, `ATIS ${this.atis} 수신, ${dest.icao}까지 IFR 허가 요청합니다`);
    this.atc(`cleared to ${digits(dest.icao)} via flight planned route, runway ${rwySay(s.depEnd.ident)}, climb via SID to ${flSay(5000)}, expect ${flSay(s.cruiseFt)} ten minutes after departure, departure frequency ${freqSay(this.mhz('DEP', s.dep))}, squawk ${digits(this.squawk)}`,
      `${dest.icao}까지 비행계획 경로로 허가. 활주로 ${s.depEnd.ident}, 5,000 ft까지 상승, 출발 10분 후 ${flText(s.cruiseFt)} 예상, 출발 관제 ${this.mhz('DEP', s.dep)}, 스쿼크 ${this.squawk}`);
    this.pilot(`Cleared to ${digits(dest.icao)}, runway ${rwySay(s.depEnd.ident)}, ${flSay(5000)}, squawk ${digits(this.squawk)}`, '허가 복창');
    this.atc(`readback correct, contact ground ${freqSay(this.mhz('GND', s.dep))} for push and start`, `복창 확인. 푸시백·시동은 지상 관제 ${this.mhz('GND', s.dep)}`,
      () => { this.tune('GND', s.dep); this.phase = 'cleared'; });
  }
  private push() {
    const s = this.s;
    const facing = ['north', 'east', 'south', 'west'][Math.round(this.ac.heading / 90) % 4];
    this.pilot(`${this.freq.station}, at stand ${s.stand?.ref ?? ''}, request push and start`, `${s.stand?.ref ?? ''}번 주기장, 푸시백·시동 요청`);
    this.atc(`push and start approved, facing ${facing}`, `푸시백·시동 승인 (기수 ${facing === 'north' ? '북' : facing === 'east' ? '동' : facing === 'south' ? '남' : '서'}쪽)`,
      () => { this.phase = 'push'; s.onPushback(); });
    this.pilot(`Push and start approved, facing ${facing}`, '푸시백 승인 복창');
  }
  private taxiVia = '';
  private taxi(layout?: AirportLayout) {
    const s = this.s;
    void layout;
    this.pilot(`${this.freq.station}, request taxi`, '택시 요청합니다');
    const via = this.taxiVia ? ` via ${this.taxiVia.split(' ').map(digits).join(', ')}` : '';
    const qnh = Math.round(s.qnh?.() ?? 1013);
    this.atc(`taxi to holding point runway ${rwySay(s.depEnd.ident)}${via}, hold short runway ${rwySay(s.depEnd.ident)}, QNH ${digits(String(qnh))}`,
      `활주로 ${s.depEnd.ident} 대기 지점까지 택시${this.taxiVia ? ` (경유 ${this.taxiVia})` : ''}, 활주로 진입 전 대기, QNH ${qnh}`, () => { this.phase = 'taxi'; });
    this.pilot(`Taxi to holding point runway ${rwySay(s.depEnd.ident)}${via}, hold short`, '택시 지시 복창');
  }
  /** Taxiway names for the taxi instruction (set once the airport layout is known). */
  setLayout(dep: AirportLayout | null, arrLayout: AirportLayout | null) {
    if (dep && this.s.stand) this.taxiVia = taxiRoute(dep, this.s.stand, this.s.depEnd).join(' ');
    this.depLayout = dep;
    this.arrLayout = arrLayout;
  }
  private depLayout: AirportLayout | null = null;
  private arrVia = '';
  /** Ground guidance: the assigned taxiways (polylines) and where the taxi ends, while taxiing out or in. */
  taxiGuide(): { ways: { lat: number; lon: number }[][]; to: { lat: number; lon: number } } | null {
    const out = this.phase === 'cleared' || this.phase === 'push' || this.phase === 'taxi' || this.phase === 'holding';
    const inb = this.phase === 'taxiin';
    if (!out && !inb) return null;
    const L = out ? this.depLayout : this.arrLayout, via = (out ? this.taxiVia : this.arrVia).split(' ').filter(Boolean);
    const ways = L ? L.taxiways.filter(t => via.includes(t.ref)).map(t => t.pts) : [];
    const to = out ? this.s.depEnd : this.arrStand;
    return to ? { ways, to } : null;
  }
  private arrLayout: AirportLayout | null = null;

  private ready() {
    const s = this.s, w = s.wind();
    if (this.freq.station.indexOf('Tower') < 0) {
      this.pilot(`${this.freq.station}, holding point runway ${rwySay(s.depEnd.ident)}, ready`, '출발 준비 완료');
      this.atc(`contact tower ${freqSay(this.mhz('TWR', s.dep))}`, `관제탑 ${this.mhz('TWR', s.dep)}로 교신하세요`, () => this.tune('TWR', s.dep));
    }
    this.pilot(`${stationName(s.dep)} Tower, ready for departure runway ${rwySay(s.depEnd.ident)}`, `활주로 ${s.depEnd.ident} 이륙 준비 완료`);
    this.atc(`wind ${digits(String(Math.round(w.dir / 10) * 10).padStart(3, '0'))} degrees ${digits(String(Math.round(w.spd)))} knots, runway ${rwySay(s.depEnd.ident)}, cleared for takeoff`,
      `바람 ${Math.round(w.dir / 10) * 10}° ${Math.round(w.spd)}kt, 활주로 ${s.depEnd.ident} 이륙 허가`, () => { this.phase = 'takeoff'; });
    this.pilot(`Cleared for takeoff runway ${rwySay(s.depEnd.ident)}`, '이륙 허가 복창');
  }

  /** Controller-initiated calls as the flight progresses. */
  update() {
    const now = performance.now();
    if (this.queue.length && now > this.busyUntil) this.queue.shift()!();
    if (this.queue.length) return;
    // a busy frequency: other traffic now and then while we're quiet
    if (now > this.nextChatter && now > this.busyUntil + 2500 && this.phase !== 'done') {
      this.nextChatter = now + 22000 + Math.random() * 38000;
      this.chatter();
      return;
    }
    const s = this.s, ac = this.ac, ft = ac.alt / FT, agl = ac.agl / FT;
    const dest = s.arr, thr = s.arrEnd;
    const distArr = dest ? distance(ac, dest) / NM : Infinity;
    switch (this.phase) {
      case 'taxi': {
        // lined up on the runway without calling: the tower asks
        if (distance(ac, s.depEnd) < 120 && ac.gs / KT < 3) this.phase = 'holding';
        break;
      }
      case 'takeoff':
        if (!ac.onGround && agl > 1200) {
          this.atc(`contact departure ${freqSay(this.mhz('DEP', s.dep))}, good day`, `출발 관제 ${this.mhz('DEP', s.dep)}로 교신하세요`, () => this.tune('DEP', s.dep));
          this.pilot(`${freqSay(this.mhz('DEP', s.dep))}, good day`, '주파수 변경');
          this.pilot(`${stationName(s.dep)} Departure, passing ${flSay(Math.round(ft / 100) * 100)}`, `${Math.round(ft / 100) * 100} ft 통과 중`);
          this.atc(`radar contact, climb and maintain ${flSay(this.climbFl)}`, `레이더 포착. ${flText(this.climbFl)}까지 상승`, () => { this.phase = 'climb'; });
          this.pilot(`Climb and maintain ${flSay(this.climbFl)}`, '상승 지시 복창');
        }
        break;
      case 'climb':
        if (ft > this.climbFl - 1500) {
          if (this.climbFl < s.cruiseFt) {
            this.atc(`contact control ${freqSay(this.mhz('CTR', s.dep))}`, '항로 관제로 교신하세요', () => this.tune('CTR', s.dep));
            this.atc(`climb and maintain ${flSay(s.cruiseFt)}, proceed direct ${dest ? digits(dest.icao) : 'on course'}`, `${flText(s.cruiseFt)}까지 상승, 목적지 방향 직항`);
            this.pilot(`Climb ${flSay(s.cruiseFt)}, direct`, '복창');
          }
          this.phase = 'cruise';
        }
        break;
      case 'cruise': {
        const tod = s.cruiseFt / 1000 * 3 + 15;
        if (dest && distArr < tod) {
          this.atc(`descend and maintain ${flSay(10000)}, expect ILS approach runway ${thr ? rwySay(thr.ident) : ''}`, `10,000 ft까지 강하, 활주로 ${thr?.ident ?? ''} ILS 접근 예상`, () => { this.phase = 'descent'; });
          this.pilot(`Descend ${flSay(10000)}, expect ILS runway ${thr ? rwySay(thr.ident) : ''}`, '강하 지시 복창');
        }
        break;
      }
      case 'descent':
        if (dest && distArr < 32) {
          this.tune('APP', dest);
          this.pilot(`${this.freq.station}, descending ${flSay(Math.round(ft / 1000) * 1000)}, information received`, `${stationName(dest)} 접근 관제, 강하 중`);
          this.atc(`${stationName(dest)} Approach, descend and maintain ${flSay(3000)}, cleared ILS approach runway ${thr ? rwySay(thr.ident) : ''}`,
            `3,000 ft까지 강하, 활주로 ${thr?.ident ?? ''} ILS 접근 허가`, () => { this.phase = 'approach'; });
          this.pilot(`Descend ${flSay(3000)}, cleared ILS runway ${thr ? rwySay(thr.ident) : ''}`, '접근 허가 복창');
        }
        break;
      case 'approach':
        if (thr && distance(ac, thr) / NM < 9) {
          const w = s.wind();
          this.atc(`contact tower ${freqSay(this.mhz('TWR', dest!))}`, `관제탑 ${this.mhz('TWR', dest!)}로 교신하세요`, () => this.tune('TWR', dest!));
          this.pilot(`${stationName(dest!)} Tower, ILS runway ${rwySay(thr.ident)}`, `활주로 ${thr.ident} ILS 접근 중`);
          this.atc(`wind ${digits(String(Math.round(w.dir / 10) * 10).padStart(3, '0'))} degrees ${digits(String(Math.round(w.spd)))} knots, runway ${rwySay(thr.ident)}, cleared to land`,
            `바람 ${Math.round(w.dir / 10) * 10}° ${Math.round(w.spd)}kt, 활주로 ${thr.ident} 착륙 허가`, () => { this.phase = 'final'; });
          this.pilot(`Cleared to land runway ${rwySay(thr.ident)}`, '착륙 허가 복창');
        }
        break;
      case 'final':
        if (ac.onGround && ac.gs / KT < 40) {
          const apt = dest ?? s.dep;
          this.atc(`vacate runway when able, contact ground ${freqSay(this.mhz('GND', apt))}`, `활주로를 벗어나 지상 관제 ${this.mhz('GND', apt)}로 교신하세요`, () => this.tune('GND', apt));
          const stand = this.arrLayout?.stands[Math.floor(Math.random() * Math.max(1, this.arrLayout.stands.length))];
          this.pilot(`${stationName(apt)} Ground, runway vacated`, '활주로 이탈했습니다');
          if (stand) {
            this.arrStand = stand;
            const via = this.arrLayout ? taxiRoute(this.arrLayout, ac, stand).join(' ') : '';
            this.arrVia = via;
            this.atc(`taxi to stand ${digits(stand.ref)}${via ? ` via ${via.split(' ').map(digits).join(', ')}` : ''}`, `${stand.ref}번 주기장으로 택시${via ? ` (경유 ${via})` : ''}`, () => { this.phase = 'taxiin'; });
            this.pilot(`Taxi to stand ${digits(stand.ref)}`, '복창');
          } else this.atc('taxi to the apron, welcome', '계류장으로 택시하세요', () => { this.phase = 'taxiin'; });
        }
        break;
      case 'taxiin':
        if (ac.gs / KT < 1 && (ac.parkingBrake || !s.enginesRunning()) && (!this.arrStand || distance(ac, this.arrStand) < 60)) {
          this.atc(`welcome to ${stationName(dest ?? s.dep)}, frequency change approved, good day`, '도착을 환영합니다', () => { this.phase = 'done'; });
        }
        break;
    }
  }
  arrStand: Stand | null = null;

  /** Bearing from the aircraft to the assigned stand (taxi guidance), or null. */
  standGuide() {
    if (!this.arrStand) return null;
    return { ref: this.arrStand.ref, dist: distance(this.ac, this.arrStand), brg: bearing(this.ac, this.arrStand) };
  }
}
