// SkyLine Flight Simulator — application entry: boot, flight setup, main loop.
import * as Cesium from 'cesium';
import { DEG, FT, KT, NM, RAD, clamp, qFromEuler, wrap360 } from './core/math.ts';
import { alongTrack, crossTrack, destination, distance, magVar } from './core/geo.ts';
import { Aircraft } from './sim/fdm.ts';
import { FCS, type Waypoint } from './sim/fcs.ts';
import { Systems } from './sim/systems.ts';
import { getAircraft } from './sim/aircraftDb.ts';
import { WEATHER_PRESETS, atmosphere, casToTas, inCloud, turbulenceAt, type WeatherState } from './sim/atmosphere.ts';
import { fetchLiveWeather, reportLine, type WxReport } from './sim/liveWeather.ts';
import { maxThrust } from './sim/engines.ts';
import { AirportDB, lineUp, makeApproach, runwayEnds, type Airport } from './world/airports.ts';
import { World, type ViewMode } from './world/scene.ts';
import { Controls } from './input/controls.ts';
import { Sound } from './audio/sound.ts';
import { Menu, type FlightConfig } from './ui/menu.ts';
import { Cockpit } from './ui/cockpit.ts';
import { CockpitClick } from './ui/cockpitClick.ts';
import { HUD } from './avionics/hud.ts';
import { TouchControls } from './ui/touch.ts';
import type { AvData } from './avionics/common.ts';
import { AirportMap } from './world/worldMap.ts';
import { loadFgModels } from './world/fgModels.ts';
import { loadGeoid } from './world/geoid.ts';
import { airportLayout } from './world/gates.ts';
import { Passengers, speak } from './sim/passengers.ts';
import { Atc } from './atc/atc.ts';
import { GroundServices, type Equipment } from './world/groundServices.ts';
import { Efb } from './ui/efb.ts';
import { callsignOf, flightEconomics, loadAirline, saveAirline } from './career/airline.ts';
import { finishJob, saveCareer, type Job } from './career/career.ts';
import { saveBest, scoreLanding, type Activity, type Touchdown } from './career/activities.ts';

(window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = CESIUM_BASE_URL;
(window as unknown as { Cesium: typeof Cesium }).Cesium = Cesium; // for the diagnostics console / tests

const $ = (id: string) => document.getElementById(id)!;
const PHYS_DT = 1 / 120;
const RATES = [0.25, 0.5, 1, 2, 4, 8, 16];

function toast(msg: string) {
  const d = document.createElement('div');
  d.textContent = msg;
  $('toast').appendChild(d);
  setTimeout(() => d.remove(), 4000);
  while ($('toast').children.length > 4) $('toast').firstChild!.remove();
}
/** The cockpit toggle names what pressing it does, not the current mode. */
function deckLabel(deck3d: boolean) { return deck3d ? '2D 패널로 보기' : '3D 조종석으로 보기'; }
function loading(text: string | null) {
  $('loading').classList.toggle('hidden', text === null);
  if (text) $('loadingText').textContent = text;
}

class App {
  db = new AirportDB();
  world!: World;
  controls = new Controls();
  sound = new Sound();
  menu!: Menu;
  touch!: TouchControls;
  hud!: HUD;
  // flight
  ac: Aircraft | null = null;
  fcs!: FCS; sys!: Systems; cockpit!: Cockpit; av!: AvData;
  private ckClick = new CockpitClick(() => this.cockpit ?? null, () => this.fcs ?? null, () => this.sound.chime([1800], 0.025));
  private tapStart: { x: number; y: number; t: number } | null = null;
  cfg: FlightConfig | null = null;
  weather!: WeatherState;
  flying = false; paused = false; rateIdx = 2;
  private acc = 0; private last = 0; private instT = 0; private wxT = 0; private lastTouch = 0;
  private fps = 60;
  private wasAp = false;
  private dragging: { x: number; y: number; btn: number } | null = null;
  map!: AirportMap;
  // career flight tracking
  careerJob: Job | null = null;
  activity: Activity | null = null;
  pax: Passengers | null = null;
  ground!: GroundServices;
  efb!: Efb;
  atc: Atc | null = null;
  /** Pushback by the tug: metres pushed so far; done once the tug is disconnected. */
  private push: { on: boolean; dist: number; done: boolean } = { on: false, dist: 0, done: false };
  private airlineDone = false;
  /** Live weather in use: where/when it was fetched (refreshed as the flight moves on). */
  private liveWx: { at: { lat: number; lon: number; time: number }; summary: string; report?: WxReport; busy?: boolean } | null = null;
  private wxWinT = 0;
  /** Weather window: conditions where the aircraft is and the turbulence by altitude, with the aircraft marked. */
  private updateWxWin() {
    const win = $('wxwin');
    if (win.classList.contains('hidden') || !this.ac || performance.now() - this.wxWinT < 1500) return;
    this.wxWinT = performance.now();
    const ac = this.ac, w = this.weather, ground = ac.alt - ac.agl;
    const wind = Math.hypot(ac.wind?.[0] ?? 0, ac.wind?.[1] ?? 0) / KT;
    const here = turbulenceAt(w, ac.alt, ac.agl);
    const word = (t: number) => (t > 0.6 ? '심함' : t > 0.35 ? '보통' : t > 0.12 ? '약함' : '없음');
    const rows: string[] = [];
    for (let fl = 440; fl >= 0; fl -= 20) {
      const h = fl * 100 * FT;
      const t = turbulenceAt(w, h, Math.max(0, h - ground));
      const me = Math.abs(ac.alt / FT / 100 - fl) < 10;
      rows.push(`<div class="tb-row${me ? ' me' : ''}"><span>FL${String(fl).padStart(3, '0')}</span><i style="width:${Math.round(t * 100)}%;background:${t > 0.6 ? '#ff4d4d' : t > 0.35 ? '#ffb020' : t > 0.12 ? '#ffe14d' : '#3ee07a'}"></i><b>${me ? '◀ 현재' : ''}</b></div>`);
    }
    win.querySelector('.win-body')!.innerHTML = `
      <div class="wx-now"><b>현재 위치</b> 바람 ${Math.round(wind)}kt · 난기류 <b>${word(here)}</b> · 외기 ${Math.round(ac.air.T - 273.15)}°C</div>
      ${this.liveWx?.report ? `<div class="wx-line">${reportLine(this.liveWx.report)}</div><div class="dim" style="font-size:11px">Open-Meteo 실시간 · ${Math.round((Date.now() - this.liveWx.at.time) / 60000)}분 전 갱신</div>`
        : `<div class="dim" style="font-size:11px">${this.cfg?.weather === 'live' ? '실시간 기상을 받지 못했습니다 (기본 날씨 사용)' : '기상 프리셋 사용 중 — 비행 계획에서 "실시간 기상"을 고르면 실제 날씨'}</div>`}
      <div class="tb-chart">${rows.join('')}</div>`;
  }
  private turbShown = 0;
  private async fetchWeather(lat: number, lon: number) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try { return await fetchLiveWeather(lat, lon, ctl.signal); } finally { clearTimeout(timer); }
  }
  /** Passengers and ATC for this flight. */
  private setupCrew(cfg: FlightConfig, dep: Airport, arr: Airport | undefined, def: ReturnType<typeof getAircraft>) {
    const atGate = cfg.start === 'gate';
    this.push = { on: false, dist: 0, done: !atGate };
    this.airlineDone = false;
    const seats = def.seats ?? 0;
    const count = def.cat === 'military' || def.cat === 'glider' ? 0 : cfg.pax ?? (seats > 4 ? Math.round(seats * cfg.payloadPct / 100) : Math.min(seats, 1));
    this.pax = count > 0 ? new Passengers(count, atGate, t => { if (this.menu.settings.volume > 0) speak(t, 'ko-KR', { rate: 1.05 }); toast(`📢 ${t}`); }) : null;
    this.atc = null;
    if (this.activity || def.cat === 'glider') { this.renderAtc(); return; }
    const ends = runwayEnds(dep);
    const depEnd = (ends.find(r => r.end.ident === cfg.depRwy) ?? [...ends].sort((a, b) => b.rw.length - a.rw.length)[0])?.end;
    if (!depEnd) return;
    const arrEnd = arr ? (runwayEnds(arr).find(r => r.end.ident === cfg.arrRwy) ?? runwayEnds(arr)[0])?.end : undefined;
    const al = cfg.airlineRoute ? loadAirline() : null;
    this.atc = new Atc({
      callsign: callsignOf(al), dep, depEnd, arr: arr && arr !== dep ? arr : undefined, arrEnd, cruiseFt: cfg.cruiseFt, atGate, stand: cfg.gate,
      wind: () => ({ dir: this.weather.windDir, spd: this.weather.windSpd }),
      boarded: () => !this.pax || this.pax.boardingDone,
      enginesRunning: () => this.ac!.engines.some(e => e.running),
      onPushback: () => this.startPushback(),
      pushDone: () => this.push.done,
    }, this.ac!);
    this.atc.muted = this.menu.settings.volume === 0;
    this.atc.onChange = () => this.renderAtc();
    this.arrApt = arr ?? null; this.arrLayout = null;
    Promise.all([airportLayout(dep), arr ? airportLayout(arr) : Promise.resolve(null)]).then(([d, a]) => { this.atc?.setLayout(d, a); this.arrLayout = a; }).catch(() => {});
    $('atcwin').classList.remove('hidden');
    this.renderAtc();
    if (atGate) toast(`게이트 ${cfg.gate?.ref ?? ''}: 승객 탑승 중 · 무전으로 IFR 허가 → 푸시백 → 택시 (Ctrl+E 자동 시동)`);
  }
  setEquipment(k: Equipment) {
    if (!this.ac) return;
    if (k !== 'none' && (!this.ac.onGround || this.ac.gs > KT)) { toast('정지한 상태에서만 연결할 수 있습니다'); return; }
    this.connectGround(k);
    if (k !== 'none') toast(k === 'jetway' ? '탑승교 연결' : '계단차 연결');
  }
  /** Connect ground equipment; a jet bridge swings out from the parked one at this stand when the terminal has one. */
  private connectGround(k: Equipment) {
    const ac = this.ac;
    if (!ac) return;
    const rot = k === 'jetway' ? this.world.scenery.jetwayFor(ac) : null;
    this.world.scenery.hideJetway(rot ? { lat: ac.lat, lon: ac.lon } : null);
    let anchor: [number, number] | undefined;
    if (rot) {
      const dN = (rot.lat - ac.lat) * DEG * 6371008.8, dE = (rot.lon - ac.lon) * DEG * 6371008.8 * Math.cos(ac.lat * DEG);
      const h = ac.psi;
      anchor = [dN * Math.cos(h) + dE * Math.sin(h), -dN * Math.sin(h) + dE * Math.cos(h)];
    }
    void this.ground.connect(k, ac, anchor);
  }
  /**
   * Parked at the destination (stopped, parking brake set or engines off): open the doors — a jet bridge at a
   * contact gate (from the terminal's own bridge), airstairs and the apron bus elsewhere — and let the passengers off.
   */
  private checkArrivalParking() {
    const ac = this.ac, pax = this.pax, arr = this.arrApt;
    if (!ac || !pax || !arr || pax.phase !== 'landed' || !ac.onGround || ac.gs > 0.5 * KT) return;
    if (!ac.parkingBrake && ac.engines.some(e => e.running)) return;
    if (distance(ac, arr) > 6000) return;
    const stands = this.arrLayout?.stands ?? [];
    const near = stands.map(s => ({ s, d: distance(ac, s) })).sort((a, b) => a.d - b.d)[0];
    const atStand = near && near.d < 60 ? near.s : null;
    const big = ac.def.cat === 'airliner' || ac.def.cat === 'widebody';
    if ((ac.def.seats ?? 0) > 6) this.connectGround(big && atStand && atStand.kind !== 'remote' && this.world.scenery.jetwayFor(ac) ? 'jetway' : 'stairs');
    pax.startDeboard();
    toast(atStand ? `${atStand.ref}번 ${atStand.kind === 'remote' ? '주기장' : '게이트'} 도착 — 승객 하기 시작` : '도착 — 승객 하기 시작');
  }
  private arrApt: { lat: number; lon: number } | null = null;
  private arrLayout: { stands: { ref: string; lat: number; lon: number; kind: string }[] } | null = null;
  startPushback() {
    if (!this.ac || this.push.done) return;
    if (this.ground.kind !== 'none') { this.ground.disconnect(); this.world.scenery.hideJetway(null); toast('탑승교·계단차 분리'); }
    this.ac.parkingBrake = false;
    this.push = { on: true, dist: 0, done: false };
    toast('푸시백 시작 — 러더(Q/E·RUDDER)로 꼬리 방향 조절, 다시 누르면 정지');
  }
  private stopPushback() {
    const ac = this.ac!;
    this.push = { on: false, dist: this.push.dist, done: true };
    ac.vel = [0, 0, 0]; ac.w = [0, 0, 0];
    ac.parkingBrake = true;
    toast('푸시백 완료 — 토잉카 분리. 파킹브레이크 설정됨');
  }
  private atcT = 0;
  renderAtc() {
    const win = $('atcwin');
    const a = this.atc;
    if (!a) { win.classList.add('hidden'); return; }
    const req = a.request;
    win.querySelector('.win-body')!.innerHTML = `
      <div class="atc-freq"><span>${a.freq.station}</span><span>${a.freq.mhz.toFixed(3)}</span></div>
      <div class="atc-log">${a.log.slice(-6).map(l => `<div class="${l.who}"><b>${l.who === 'atc' ? l.station : l.station}</b> ${l.text}<small>${l.ko}</small></div>`).join('')}</div>
      <div class="atc-btns">${req ? `<button class="primary" id="atcReq">${req.label}</button>` : ''}<button id="atcAgain">다시</button><button id="atcMute">${a.muted ? '음성 켜기' : '음성 끄기'}</button></div>`;
    const log = win.querySelector('.atc-log')!; log.scrollTop = log.scrollHeight;
    const rq = win.querySelector<HTMLButtonElement>('#atcReq');
    if (rq && req) rq.onclick = () => { req.send(); this.renderAtc(); };
    win.querySelector<HTMLButtonElement>('#atcAgain')!.onclick = () => a.sayAgain();
    win.querySelector<HTMLButtonElement>('#atcMute')!.onclick = () => { a.muted = !a.muted; if (a.muted) window.speechSynthesis?.cancel(); this.renderAtc(); };
  }
  /** Airline flight finished at the destination: pay out by passengers and how they felt. */
  private finishAirline() {
    const cfg = this.cfg!, ac = this.ac!;
    if (this.airlineDone || !cfg.airlineRoute) return;
    const al = loadAirline();
    const r = al?.routes.find(x => x.id === cfg.airlineRoute);
    if (!al || al.bankrupt || !r || !this.pax) return;
    this.airlineDone = true;
    const e = flightEconomics(al, { ...r, from: cfg.dep, to: cfg.arr }, this.db);
    const c = this.pax.comfort;
    const revenue = Math.round(this.pax.count * r.fare * (0.85 + 0.3 * c / 100));
    const bonus = c > 90 ? Math.round(revenue * 0.05) : 0;
    const profit = revenue + bonus - e.cost;
    al.cash += profit;
    al.rep = Math.max(0, Math.min(100, al.rep + (c - 70) / 15));
    const p = al.fleet.find(x => x.id === r.planeId);
    if (p) { p.hours += e.hours; p.condition = Math.max(10, p.condition - e.hours * 0.06 - (this.job.fpm ?? 0) / 300); }
    saveAirline(al);
    $('resultTitle').textContent = `${callsignOf(al)} 운항 완료`;
    $('resultBody').innerHTML = `<div class="res-pay ${profit >= 0 ? 'ok' : 'bad'}">${profit >= 0 ? '+' : '−'}$${Math.abs(profit).toLocaleString()}</div>
      <table class="spec-t"><tr><td>승객</td><td>${this.pax.count}명</td></tr><tr><td>승객 만족도</td><td>${this.pax.label}</td></tr>
      <tr><td>운임 수입</td><td>$${revenue.toLocaleString()}${bonus ? ` (+보너스 $${bonus.toLocaleString()})` : ''}</td></tr><tr><td>운항 비용</td><td>$${e.cost.toLocaleString()}</td></tr>
      <tr><td>평판</td><td>${Math.round(al.rep)}/100</td></tr>${this.pax.notes.map(n => `<tr><td></td><td>${n}</td></tr>`).join('')}</table>`;
    $('resultCareer').textContent = '항공사 화면으로';
    $('resultwin').classList.remove('hidden');
    this.paused = true;
    void ac;
  }

  /** Refresh live weather every 10 minutes or 150 km, and tell the pilot when the air gets rough. */
  private updateLiveWeather() {
    const ac = this.ac!, lw = this.liveWx;
    if (lw && !lw.busy) {
      const moved = Math.hypot(ac.lat - lw.at.lat, (ac.lon - lw.at.lon) * Math.cos(ac.lat * DEG)) * 111;
      if (moved > 150 || Date.now() - lw.at.time > 10 * 60_000) {
        lw.busy = true;
        this.fetchWeather(ac.lat, ac.lon).then(n => {
          // clouds come back above ground: put them over the terrain under the aircraft
          for (const c of n.w.clouds) { c.base += ac.groundH; c.top += ac.groundH; }
          Object.assign(this.weather, n.w);
          this.liveWx = { at: n.at, summary: n.summary, report: n.report };
          toast(n.summary);
        }).catch(() => { lw.at = { lat: ac.lat, lon: ac.lon, time: Date.now() }; lw.busy = false; });
      }
    }
    const t = turbulenceAt(this.weather, ac.alt, ac.agl);
    const lvl = t > 0.6 ? 3 : t > 0.35 ? 2 : t > 0.12 ? 1 : 0;
    if (lvl !== this.turbShown) {
      if (lvl > this.turbShown) toast(['', '약한 난기류 구역 — 기체가 흔들립니다', '보통 난기류 — 좌석벨트', '심한 난기류! 속도를 줄이고 고도를 바꾸세요'][lvl]);
      else if (lvl === 0) toast('난기류 구역을 벗어났습니다');
      this.turbShown = lvl;
    }
  }
  private landing: { td: Touchdown | null; since: number; done: boolean } = { td: null, since: 0, done: false };
  private job = { t: 0, airborne: false, overspeed: 0, fpm: null as number | null, stillT: 0, done: false };

  async boot() {
    loading('공항 · 항법 데이터베이스 로딩 중…');
    try {
      await this.db.load();
    } catch (e) {
      throw new Error(`공항 데이터(data/airports.json)를 불러오지 못했습니다 — ${(e as Error).message}`);
    }
    loading('실제 기체 모델 목록 불러오는 중…');
    await Promise.all([loadFgModels(), loadGeoid()]);
    this.menu = new Menu($('menu'), this.db, this.controls);
    const s = this.menu.settings;
    this.world = new World($('world'), this.db, { imagery: s.imagery, googleKey: s.googleKey, ionToken: s.ionToken, photoreal: s.photoreal, shadows: s.shadows, quality: s.quality });
    let lastIssue = -Infinity; // never suppress the very first render-issue toast (e.g. right at boot)
    this.world.onRenderIssue = (msg, fatal) => {
      if (fatal) { loading(`그래픽 오류로 렌더링을 계속할 수 없습니다: ${msg}`); document.querySelector<HTMLElement>('#loading .spinner')?.style.setProperty('display', 'none'); return; }
      if (performance.now() - lastIssue > 15000) { lastIssue = performance.now(); toast(`렌더링 오류 자동 복구: ${msg.slice(0, 120)}`); }
    };
    this.world.onPersistentError = msg => {
      $('errBannerText').textContent = `3D 렌더링 오류가 계속 발생합니다: ${msg.slice(0, 160)}`;
      $('errBanner').classList.remove('hidden');
    };
    this.hud = new HUD($('hudLayer'));
    this.world.effects.onThunder = d => this.sound.thunder(d);
    this.ground = new GroundServices(this.world.scene, objs => { this.world.groundObjects = objs; if (this.world.groundModelsOff) for (const o of objs) (o as { show?: boolean }).show = false; });
    this.world.guideOn = !!s.routeGuide;
    this.world.scenery.enabled = s.airportScenery !== false;
    this.efb = new Efb($('efbwin'), {
      ac: () => this.ac, fcs: () => this.fcs, dep: () => this.cfg ? this.db.get(this.cfg.dep) : undefined, arr: () => this.cfg ? this.db.get(this.cfg.arr) : undefined,
      callsign: () => (this.cfg?.airlineRoute ? callsignOf(loadAirline()) : 'SkyLine 123'), pax: () => this.pax,
      equipment: () => this.ground.kind, setEquipment: k => this.setEquipment(k), pushback: () => { if (!this.push.on) { this.push.done = false; this.startPushback(); } },
      refuel: kg => { if (this.ac) { this.ac.fuel = kg; toast(`급유 완료: ${Math.round(kg).toLocaleString()} kg`); } },
      guide: () => this.world.guideOn, setGuide: on => { this.world.guideOn = on; this.menu.settings.routeGuide = on; this.menu.saveSettings(); },
      graphics: () => ({ quality: this.menu.settings.quality, shadows: this.menu.settings.shadows }),
      setGraphics: (q, sh) => { const st = this.menu.settings; st.quality = q; st.shadows = sh; this.menu.saveSettings(); this.menu.onGraphics(st); toast(`그래픽: ${({ low: '낮음', medium: '중간', high: '높음', ultra: '울트라' })[q]}${sh ? ' · 그림자' : ''}`); },
      scenery: () => this.world.scenery.enabled, setScenery: on => { this.world.scenery.enabled = on; this.menu.settings.airportScenery = on; this.menu.saveSettings(); },
      cruiseFt: () => this.cfg?.cruiseFt ?? 35000,
      runwayLen: (apt, arr) => { if (!apt || !this.cfg) return 0; const id = arr ? this.cfg.arrRwy : this.cfg.depRwy; const e = runwayEnds(apt).find(r => r.end.ident === id) ?? [...runwayEnds(apt)].sort((a, b) => b.rw.length - a.rw.length)[0]; return e ? e.rw.length : 0; },
    });
    this.world.deck3d = s.deck3d;
    $('btnDeck').textContent = deckLabel(s.deck3d);
    this.sound.volume = s.volume;
    this.menu.onFly = c => { this.sound.init(); this.careerJob = null; this.activity = null; void this.startFlight(c); };
    this.menu.onActivity = (c, a) => { this.sound.init(); this.careerJob = null; this.activity = a; void this.startFlight(c); };
    this.map = new AirportMap(this.world.scene, this.db);
    this.map.onPick = apt => { if (this.menu.visible) this.menu.pickAirport(apt); };
    this.menu.onMapView = (lat, lon, h) => { if (!this.flying) this.map.view(lat, lon, h); };
    this.menu.onMapSel = (dep, arr, focus) => this.map.setSelection(dep, arr, focus);
    this.menu.onPreview = apt => {
      if (!this.flying) { this.world.flyOverview(apt.lat, apt.lon); this.map.view(apt.lat, apt.lon, 900_000, 2); }
      void this.world.elevation.preload(apt.lat, apt.lon, 10000);
    };
    this.menu.onAirlineFly = c => { this.sound.init(); this.careerJob = null; this.activity = null; void this.startFlight(c); };
    this.menu.onCareerFly = (c, job) => { this.sound.init(); this.careerJob = job; this.activity = null; void this.startFlight(c); };
    this.menu.onCareerAbandon = () => {
      const car = this.menu.career;
      if (car?.active) { finishJob(car, car.active, '—', { landedAt: null, crashed: false, fpm: null, minutes: 0, overspeed: 0, aborted: true }); car.location = car.active?.from ?? car.location; saveCareer(car); }
      this.careerJob = null;
    };
    this.menu.onRoute = pts => this.world.showRoute(pts);
    this.menu.onHome = home => { if (!this.flying) this.map.setActive(!home); };
    this.menu.onResume = () => this.resume();
    this.menu.onDiag = () => this.toggleDiag();
    this.menu.onGraphics = st => {
      this.sound.volume = st.volume;
      this.world.opts = { ...this.world.opts, ...st };
      this.world.applyGraphics(st.quality, st.shadows);
    };
    this.menu.onSettings = st => {
      this.sound.volume = st.volume;
      this.world.opts = { ...this.world.opts, ...st };
      this.world.setImagery(st.imagery);
      this.world.applyGraphics(st.quality, st.shadows);
      if (st.photoreal && (st.googleKey || st.ionToken)) void this.world.enablePhotoreal(st.googleKey || undefined);
      else this.world.disablePhotoreal();
      toast('설정 저장됨');
    };
    this.controls.onAction = a => this.action(a);
    this.touch = new TouchControls(this.controls, a => this.action(a));
    $('btnTouch').classList.toggle('on', this.touch.enabled);
    this.bindUi();
    loading(null);
    (window as unknown as { __booted: boolean }).__booted = true;
    this.map.setActive(true);
    this.menu.show(false);
    requestAnimationFrame(t => this.frame(t));
  }

  // ───────────────────────── flight setup ─────────────────────────
  async startFlight(cfg: FlightConfig) {
    this.cfg = cfg;
    this.menu.hide();
    this.map.setActive(false);
    this.job = { t: 0, airborne: false, overspeed: 0, fpm: null, stillT: 0, done: false };
    this.landing = { td: null, since: 0, done: false };
    loading('비행 준비 중… 지형 데이터 스트리밍');
    this.flying = false;
    const def = getAircraft(cfg.aircraftId);
    const ac = new Aircraft(def);
    ac.fuel = def.m.fuel * cfg.fuelPct / 100;
    ac.payload = def.m.pay * cfg.payloadPct / 100;
    const fcs = new FCS(ac);
    const sys = new Systems(ac, fcs);
    this.ac = ac; this.fcs = fcs; this.sys = sys;
    // weather
    let w: WeatherState = JSON.parse(JSON.stringify((WEATHER_PRESETS[cfg.weather] ?? WEATHER_PRESETS.clear).w));
    const depApt = this.db.get(cfg.dep)!;
    this.liveWx = null;
    if (cfg.weather === 'live') {
      loading('실시간 기상 받는 중… (Open-Meteo)');
      try {
        const lw = await this.fetchWeather(depApt.lat, depApt.lon);
        w = lw.w;
        this.liveWx = { at: lw.at, summary: lw.summary, report: lw.report };
      } catch (e) {
        w = JSON.parse(JSON.stringify(WEATHER_PRESETS.few.w));
        toast(`실시간 기상을 받지 못해 기본 날씨로 시작합니다 (${(e as Error).message})`);
      }
    }
    if (cfg.windDir !== null) w.windDir = cfg.windDir;
    if (cfg.windSpd !== null) { w.windSpd = cfg.windSpd; if (w.gust && w.gust < cfg.windSpd) w.gust = 0; }
    if (cfg.visibility !== null) w.visibility = cfg.visibility;
    const dep = this.db.get(cfg.dep)!;
    const arr = this.db.get(cfg.arr);
    // cloud bases are AGL in the presets -> MSL at departure
    for (const c of w.clouds) { c.base += dep.elev; c.top += dep.elev; }
    this.weather = w;
    sys.baroHpa = Math.round(w.qnh);
    // flight plan
    const wps: Waypoint[] = [{ ident: dep.icao, lat: dep.lat, lon: dep.lon, kind: 'apt' }];
    for (const tok of cfg.route.split(/\s+/).filter(Boolean)) {
      const r = this.db.resolve(tok, wps[wps.length - 1]);
      if (r) wps.push(r);
    }
    if (arr) wps.push({ ident: arr.icao, lat: arr.lat, lon: arr.lon, kind: 'apt' });
    fcs.plan.wps = wps; fcs.plan.active = 1; fcs.plan.cruiseFt = cfg.cruiseFt;
    const arrEnd = arr ? runwayEnds(arr).find(r => r.end.ident === cfg.arrRwy) ?? runwayEnds(arr)[0] : undefined;
    if (arr && arrEnd) {
      const ap = makeApproach(arr, arrEnd.rw, arrEnd.end);
      fcs.plan.approach = ap; fcs.ilsTuned = true;
      // the approach: intermediate fix 16 NM and final approach fix 10 NM out on the extended centreline (with
      // altitude constraints for VNAV), then the runway threshold — so NAV lines up with the localizer
      const elevFt = ap.elev / FT;
      const iF = destination(ap.thr, ap.crs + 180, 16 * NM), faf = destination(ap.thr, ap.crs + 180, 10 * NM);
      const last = wps[wps.length - 1];
      if (wps.length >= 2 && last.ident === arr.icao) {
        const before = wps[wps.length - 2];
        const fromBefore = distance(before, ap.thr) / NM;
        const add: Waypoint[] = [];
        if (fromBefore > 20) add.push({ ident: `IF${ap.runway}`, lat: iF.lat, lon: iF.lon, alt: Math.round((elevFt + 4900) / 100) * 100, kind: 'user' });
        if (fromBefore > 12) add.push({ ident: `FF${ap.runway}`, lat: faf.lat, lon: faf.lon, alt: Math.round((elevFt + 3000) / 100) * 100, kind: 'user' });
        wps.splice(wps.length - 1, 1, ...add, { ...last, lat: ap.thr.lat, lon: ap.thr.lon, kind: 'rwy' });
      }
    }
    fcs.selAlt = Math.min(cfg.cruiseFt, def.v.ceil);
    // time of day
    const date = this.simDate(cfg, dep);
    this.world.setTime(date, 1);
    // spawn
    await this.spawn(cfg, dep, arr);
    // scene
    this.world.hideRoute();
    this.world.geoidOffset = 0;
    await this.world.loadAircraft(ac, cfg.livery?.[def.id]);
    if (this.world.opts.photoreal) await this.world.calibrateGeoid(ac.lat, ac.lon, ac.groundH);
    this.world.updateWeather(w, ac, true);
    this.world.view = def.cockpit === 'fighter' ? 'cockpit' : 'cockpit';
    this.world.head = { yaw: 0, pitch: this.defaultHeadPitch(), zoom: 1 };
    this.av = { ac, fcs, sys, db: this.db, ndRange: def.cat === 'ga' || def.fdm === 'rotor' ? 10 : 20, ndMode: 'ARC', navSource: 'GPS', vor: null, zulu: date };
    this.cockpit = new Cockpit(ac, fcs, sys, this.db, a => this.action(a));
    this.cockpit.build(this.av);
    this.sound.setupAircraft(ac);
    this.controls.throttle = ac.engineCmd[0]?.throttle ?? 0;
    this.controls.collective = ac.collective;
    this.setView(this.world.view);
    document.body.classList.add('flying');
    $('topbar').classList.remove('hidden');
    $('crash').classList.add('hidden');
    $('tbAircraft').textContent = `${def.mfr} ${def.name}`;
    // Don't block on imagery/terrain streaming: runway height comes from the airport DB, and the
    // mesh refines while you fly. Only give the tile directly underneath a brief head start.
    await this.world.elevation.preload(ac.lat, ac.lon, 1200);
    if (ac.onGround) {
      const g = this.world.elevation.ground(ac.lat, ac.lon);
      ac.alt = g.h + ac.restHeight();
      ac.vel = [0, 0, 0];
    }
    loading(null);
    this.flying = true; this.paused = false; this.acc = 0;
    this.rateIdx = 2;
    this.layout();
    this.lastTouch = ac.touchdownEvent;
    toast(`${dep.icao} ${cfg.start === 'final' && arr ? '→ ' + arr.icao + ' 최종접근' : ''} · ${def.name} · QNH ${Math.round(w.qnh)}`);
    if (this.careerJob) toast(`커리어 임무: ${this.careerJob.from} → ${this.careerJob.to} · 도착 후 정지하고 파킹 브레이크(또는 엔진 정지)하면 임무 완료`);
    if (this.liveWx) toast(this.liveWx.summary);
    this.setupCrew(cfg, dep, arr, def);
    // at the stand: a jet bridge for airliners at a contact gate, airstairs otherwise
    this.ground.disconnect();
    if (cfg.start === 'gate' && (def.seats ?? 0) > 6) {
      const big = def.cat === 'airliner' || def.cat === 'widebody';
      const kind = big && cfg.gate?.kind !== 'remote' ? 'jetway' : 'stairs';
      this.connectGround(kind);
      // once the airport's own buildings are up, swing the jet bridge out from the terminal's one at this stand
      if (kind === 'jetway') void this.world.scenery.built(dep.icao).then(() => {
        if (this.ac === ac && this.ground.kind === 'jetway' && ac.onGround && ac.gs < 1) this.connectGround('jetway');
      });
    } else this.world.scenery.hideJetway(null);
    if (this.activity) toast(this.activity.type === 'landing' ? `착륙 챌린지: ${this.activity.title} — 직접 조종해서 착륙하세요 (채점)` : `디스커버리: ${this.activity.title}`);
    if (cfg.start === 'cold') toast('Cold & Dark: 오버헤드(O)에서 시동 절차를 수행하거나 Ctrl+E로 자동 시동');
  }

  private simDate(cfg: FlightConfig, apt: Airport): Date {
    if (cfg.time === 'now' && cfg.hour === undefined) return new Date();
    const hours = cfg.hour ?? { dawn: 6, morning: 10, afternoon: 15, dusk: 19, night: 23 }[cfg.time as 'dawn'];
    const off = Math.round(apt.lon / 15);
    const d = new Date();
    d.setUTCHours(Math.floor(hours - off), Math.round((hours % 1) * 60), 0, 0);
    return d;
  }

  private async spawn(cfg: FlightConfig, dep: Airport, arr: Airport | undefined) {
    const ac = this.ac!, fcs = this.fcs, sys = this.sys, def = ac.def;
    const ends = runwayEnds(dep);
    const depEnd = ends.find(r => r.end.ident === cfg.depRwy) ?? ends.sort((a, b) => b.rw.length - a.rw.length)[0];
    let start = cfg.start;
    if (def.cat === 'glider' && (start === 'runway' || start === 'cold')) start = 'air';
    const takeoffFlaps = () => {
      const n = ac.aero.flaps.length;
      ac.flapIdx = n <= 1 ? 0 : def.flaps === 'ga' || def.flaps === 'split' || def.flaps === 'bizjet' || def.flaps === 'fighter' ? 1 : Math.min(2, n - 1);
      ac.flapPos = ac.aero.flaps[ac.flapIdx].deg;
    };
    // airliners and bizjets with a route: LNAV / VNAV and managed speed armed for the takeoff (like an MSFS / real
    // FMS setup) — TOGA thrust gives SRS guidance, NAV engages at 50 ft and VNAV at the thrust reduction altitude
    const preArm = () => {
      if (def.fdm === 'rotor' || !fcs.hasAthr || fcs.plan.wps.length < 2 || !['airliner', 'widebody', 'regional', 'bizjet'].includes(def.cat)) return;
      fcs.latArmed = 'NAV'; fcs.vertArmed = 'VNAV'; fcs.spdManaged = true; fcs.vnavPhase = 'CLB';
    };
    if (start === 'gate') {
      // parked at a stand: power on, engines off, parking brake set; boarding, then push and start
      const stand = cfg.gate ?? (await airportLayout(dep)).stands[0];
      cfg.gate = stand;
      await this.world.elevation.preload(stand.lat, stand.lon);
      const h = this.world.elevation.ground(stand.lat, stand.lon).h;
      ac.place(stand.lat, stand.lon, h + ac.restHeight(), stand.hdg, 0);
      ac.groundH = h;
      sys.setReady(false);
      sys.sw.nav = true; sys.sw.beacon = false;
      ac.parkingBrake = true;
      for (const c of ac.engineCmd) c.throttle = 0;
      fcs.selHdg = Math.round(wrap360(depEnd.end.hdg - magVar(stand.lat, stand.lon))) || 360;
      fcs.selSpd = def.fdm === 'rotor' ? 80 : Math.round(Math.min(250, def.v.vmo - 20, (def.v.v2 ?? def.v.vr + 10) + 40));
      preArm();
      return;
    }
    if (start === 'runway' || start === 'cold') {
      const p = lineUp(depEnd.end);
      void this.world.elevation.preload(p.lat, p.lon);
      const g = this.world.elevation.ground(p.lat, p.lon); // graded runway height is exact even without tiles
      const h = g.runway ? g.h : depEnd.end.elev;
      ac.place(p.lat, p.lon, h + ac.restHeight(), p.hdg, 0);
      ac.groundH = h;
      const ready = start === 'runway';
      sys.setReady(ready);
      if (ready) { sys.sw.strobe = sys.sw.landing = true; }
      ac.parkingBrake = !ready;
      if (!def.fdm.startsWith('rotor')) takeoffFlaps();
      ac.spoilerArm = !!def.spoilers && def.cat !== 'ga';
      fcs.selHdg = Math.round(wrap360(p.hdg - magVar(p.lat, p.lon))) || 360;
      fcs.selSpd = def.fdm === 'rotor' ? 80 : Math.round(Math.min(250, def.v.vmo - 20, (def.v.v2 ?? def.v.vr + 10) + 40));
      if (def.cat === 'ga' || def.cat === 'vintage') fcs.selSpd = Math.round(def.v.vr * 1.35);
      preArm();
      for (const c of ac.engineCmd) c.throttle = def.fdm === 'rotor' && ready ? 1 : 0;
      ac.collective = 0;
      return;
    }
    // airborne starts
    let lat: number, lon: number, hdg: number, altM: number, spdKt: number;
    const air = (h: number) => atmosphere(h, this.weather.dT, this.weather.qnh * 100);
    if (start === 'final') {
      const ap = fcs.plan.approach ?? makeApproach(dep, depEnd.rw, depEnd.end);
      fcs.plan.approach = ap; fcs.ilsTuned = true;
      const dist = (cfg.finalNm ?? (def.fdm === 'rotor' ? 3 : def.cat === 'ga' || def.cat === 'vintage' ? 6 : 10)) * NM;
      const p = destination(ap.thr, ap.crs + 180, dist);
      lat = p.lat; lon = p.lon; hdg = ap.crs;
      altM = ap.elev + Math.tan(3 * DEG) * (dist + 300) - 10;
      spdKt = def.fdm === 'rotor' ? 70 : fcs.vref() + 12;
      if (!fcs.plan.wps.length || fcs.plan.wps[fcs.plan.wps.length - 1].ident !== ap.airport) fcs.plan.wps = [{ ident: ap.airport, lat: ap.thr.lat, lon: ap.thr.lon, kind: 'apt' }];
      fcs.plan.wps = [{ ident: 'FINAL', lat, lon, kind: 'user' }, fcs.plan.wps[fcs.plan.wps.length - 1]];
      fcs.plan.active = 1;
    } else if (start === 'cruise') {
      const next = fcs.plan.wps[1] ?? { lat: dep.lat + 1, lon: dep.lon };
      const brg = Math.atan2((next.lon - dep.lon) * Math.cos(dep.lat * DEG), next.lat - dep.lat) * RAD;
      const p = destination(dep, brg, 40 * NM);
      lat = p.lat; lon = p.lon; hdg = wrap360(brg);
      altM = Math.min(cfg.cruiseFt, def.v.ceil) * FT;
      spdKt = def.fdm === 'rotor' ? def.v.cruise : def.v.cruise;
      fcs.plan.wps.splice(0, 1, { ident: dep.icao, lat: dep.lat, lon: dep.lon, kind: 'apt' });
    } else if (cfg.spot) {
      lat = cfg.spot.lat; lon = cfg.spot.lon; hdg = cfg.spot.hdg;
      await this.world.elevation.preload(lat, lon, 1500);
      altM = this.world.elevation.ground(lat, lon).h + cfg.spot.agl * FT;
      spdKt = def.fdm === 'rotor' ? 70 : def.cat === 'glider' ? 50 : Math.min(def.v.vref * 1.5, 250);
    } else {
      const p = destination(depEnd.end, depEnd.end.hdg, 3000);
      lat = p.lat; lon = p.lon; hdg = depEnd.end.hdg;
      altM = dep.elev + (def.fdm === 'rotor' ? 1000 : 3000) * FT;
      spdKt = def.fdm === 'rotor' ? 60 : def.cat === 'glider' ? 50 : Math.min(def.v.vref * 1.5, 250);
    }
    await this.world.elevation.preload(lat, lon, 1500);
    const ground = Math.max(this.world.elevation.ground(lat, lon).h, start === 'cruise' || cfg.spot ? 0 : dep.elev);
    altM = Math.max(altM, ground + 150);
    const a = air(altM);
    const tas = start === 'cruise' ? spdKt * KT : casToTas(spdKt * KT, a);
    ac.place(lat, lon, altM, hdg, tas / KT, 0);
    ac.groundH = ground;
    sys.setReady(true);
    sys.sw.strobe = true; sys.sw.landing = start === 'final';
    ac.gearDown = start === 'final' ? true : false;
    ac.gearPos = ac.gearDown || !def.gear.retract ? 1 : 0;
    if (start === 'final' && def.fdm !== 'rotor') {
      ac.flapIdx = Math.max(0, ac.aero.flaps.length - (def.fbw === 'airbus' ? 1 : def.flaps === 'boeing' ? 2 : 1));
      ac.flapPos = ac.aero.flaps[ac.flapIdx].deg;
      ac.spoilerArm = !!def.spoilers && def.cat !== 'ga';
      ac.autobrake = def.cat === 'airliner' || def.cat === 'widebody' || def.cat === 'regional' ? 2 : 0;
    }
    if (start === 'final') ac.vel[2] = Math.sin(3 * DEG) * tas;
    this.trim(ac, a, tas);
    // autopilot setup
    fcs.selSpd = Math.round(start === 'final' ? (def.fdm === 'rotor' ? 60 : fcs.vref() + 5) : spdKt > 100 && start === 'cruise' ? Math.round(ac.ias / KT) : spdKt);
    fcs.selHdg = Math.round(wrap360(hdg - magVar(lat, lon))) || 360;
    fcs.selAlt = Math.round(altM / FT / 100) * 100;
    if (start === 'final') fcs.selAlt = Math.round((fcs.plan.approach!.elev / FT + 3000) / 100) * 100;
    if (def.cat !== 'glider' && !cfg.handFly) {
      fcs.engageAp(true);
      if (start === 'cruise') {
        fcs.lat = fcs.plan.to ? 'NAV' : 'HDG'; fcs.vert = 'ALT'; fcs.altHold = fcs.selAlt;
        if (def.v.mmo < 1 && ac.mach > 0.6) { fcs.spdIsMach = true; fcs.selMach = Math.round(ac.mach * 100) / 100; }
        // with a route: VNAV cruise (it will start the descent at the top of descent once the MCP altitude is lowered)
        if (fcs.plan.to && fcs.hasAthr && def.cat !== 'ga' && def.cat !== 'vintage') { fcs.setVert('VNAV'); fcs.vnavPhase = 'CRZ'; fcs.altHold = fcs.selAlt; fcs.vnavSub = 'ALT'; }
      }
      else if (start === 'final') { fcs.lat = 'HDG'; fcs.vert = 'ALT'; fcs.altHold = altM / FT; fcs.selAlt = Math.round(fcs.selAlt); if (def.fdm !== 'rotor') fcs.armApp(); }
      else { fcs.lat = 'HDG'; fcs.vert = 'ALT'; fcs.altHold = altM / FT; }
      if (fcs.hasAthr) fcs.toggleAthr();
    }
    if (def.fdm === 'rotor') { ac.collective = 0.5; for (const c of ac.engineCmd) c.throttle = 1; }
  }

  /** Put an airborne aircraft into (approximately) trimmed flight. */
  private trim(ac: Aircraft, air: ReturnType<typeof atmosphere>, tas: number) {
    if (ac.isRotor) { ac.rotorRpm = 1; return; }
    const A = ac.aero, def = ac.def;
    const q = 0.5 * air.rho * tas * tas;
    const f = A.flaps[ac.flapIdx];
    const CL = (ac.mass * 9.80665) / (q * def.S);
    const alpha = A.a0 + (CL - f.dCL) / A.CLa;
    const gamma = Math.asin(clamp(ac.vel[2] / Math.max(tas, 1), -0.2, 0.2)) * -1;
    const psi = Math.atan2(ac.vel[1], ac.vel[0]);
    ac.q = qFromEuler(psi, alpha + gamma, 0);
    const Cm = A.Cm0 + A.Cma * alpha + f.dCm + 0.02 * ac.gearPos * (def.gear.retract ? 1 : 0);
    ac.trim = clamp(-Cm / (A.Cmde * A.trimRange), -1, 1);
    // throttle for level flight
    const CD = A.CD0 + f.dCD + A.CDgear * ac.gearPos + CL * CL / (Math.PI * A.e * A.AR);
    const D = q * def.S * CD - ac.mass * 9.80665 * Math.sin(gamma);
    const Tmax = maxThrust(def, air, tas, tas / air.a) * Math.max(1, def.eng.n);
    const thr = def.eng.t === 'none' ? 0 : clamp(D / Math.max(1, Tmax), 0.05, 0.95);
    for (const c of ac.engineCmd) c.throttle = thr;
    for (const e of ac.engines) e.spool = thr;
    this.controls.throttle = thr;
  }

  // ───────────────────────── actions ─────────────────────────
  action(a: string) {
    if (a === 'menu') { this.menu.visible ? this.resume() : this.openMenu(); return; }
    if (!this.flying || !this.ac) return;
    const ac = this.ac, f = this.fcs, s = this.sys;
    const n = ac.aero.flaps.length;
    switch (a) {
      case 'gear':
        if (!ac.def.gear.retract) break;
        if (ac.onGround && ac.gearDown) { toast('지상에서 기어를 올릴 수 없습니다 (WOW)'); break; }
        ac.gearDown = !ac.gearDown; toast(ac.gearDown ? 'GEAR DOWN' : 'GEAR UP'); break;
      case 'flaps-up': ac.flapIdx = Math.max(0, ac.flapIdx - 1); toast(`FLAPS ${ac.flapLabel}`); break;
      case 'flaps-down': ac.flapIdx = Math.min(n - 1, ac.flapIdx + 1); toast(`FLAPS ${ac.flapLabel}`); break;
      case 'flaps-up-full': ac.flapIdx = 0; toast(`FLAPS ${ac.flapLabel}`); break;
      case 'flaps-full': ac.flapIdx = n - 1; toast(`FLAPS ${ac.flapLabel}`); break;
      case 'spoilers': ac.speedbrake = ac.speedbrake > 0 ? 0 : 1; ac.spoilerArm = false; toast(ac.speedbrake ? 'SPEED BRAKE EXTEND' : 'SPEED BRAKE RETRACT'); break;
      case 'spoilers-arm': ac.spoilerArm = !ac.spoilerArm; toast(ac.spoilerArm ? 'GROUND SPOILERS ARMED' : 'GROUND SPOILERS DISARMED'); break;
      case 'pushback': if (this.push.on) this.stopPushback(); else if (ac.onGround && ac.gs < KT) { this.push.done = false; this.startPushback(); } break;
      case 'atc': $('atcwin').classList.toggle('hidden'); this.renderAtc(); break;
      case 'parking-brake': ac.parkingBrake = !ac.parkingBrake; toast(ac.parkingBrake ? 'PARKING BRAKE SET' : 'PARKING BRAKE RELEASED'); break;
      case 'ap': f.engageAp(!f.ap); break;
      case 'ap-disconnect': if (f.ap) f.engageAp(false); break;
      case 'athr': f.toggleAthr(); break;
      case 'fd': f.fd = !f.fd; break;
      case 'sas': f.sas = !f.sas; toast(`SAS ${f.sas ? 'ON' : 'OFF'}`); break;
      case 'hdg': f.lat = 'HDG'; f.latArmed = null; break;
      case 'nav': if (!f.plan.to) { toast('NAV: 비행계획 없음'); break; } f.setLat('NAV'); break;
      case 'loc': f.latArmed = f.latArmed === 'LOC' ? null : 'LOC'; f.ilsTuned = true; break;
      case 'app': f.armApp(); break;
      case 'alt': f.setVert('ALT'); break;
      case 'vs': f.setVert('VS'); break;
      case 'flc': f.setVert('FLC'); break;
      case 'vnav': f.setVert('VNAV'); if (f.msg) break; toast(f.vert === 'VNAV' ? 'VNAV — 비행계획 고도·속도로 상승/순항/강하' : f.vertArmed === 'VNAV' ? 'VNAV 준비 (이륙 후 감속 고도에서 연결)' : 'VNAV 해제'); break;
      case 'spdmng': { const t = Math.round(f.targetIas()); f.spdManaged = !f.spdManaged; if (!f.spdManaged) { f.spdIsMach = false; f.selSpd = t; } } toast(f.spdManaged ? '속도 관리 모드 (FMS 속도)' : '선택 속도 모드'); break;
      case 'toga': f.toga(); if (f.hasAthr) for (const c of ac.engineCmd) c.throttle = ac.def.eng.ab ? 0.95 : 1; break;
      case 'spdmach': f.spdIsMach = !f.spdIsMach; if (f.spdIsMach) f.selMach = Math.round(ac.mach * 100) / 100; else f.selSpd = Math.round(ac.ias / KT); break;
      case 'pause': this.paused = !this.paused; break;
      case 'rate-up': this.rateIdx = Math.min(RATES.length - 1, this.rateIdx + 1); toast(`SIM RATE ×${RATES[this.rateIdx]}`); break;
      case 'rate-down': this.rateIdx = Math.max(0, this.rateIdx - 1); toast(`SIM RATE ×${RATES[this.rateIdx]}`); break;
      case 'view-cockpit': this.setView('cockpit'); break;
      case 'view-hud': this.setView('cockpit-hud'); break;
      case 'view-chase': this.setView('chase'); break;
      case 'view-tower': this.setView('tower'); break;
      case 'view-flyby': this.setView('flyby'); break;
      case 'view-free': this.setView('free'); break;
      case 'view-next': { const vs: ViewMode[] = ['cockpit', 'cockpit-hud', 'chase', 'tower', 'flyby']; this.setView(vs[(vs.indexOf(this.world.view) + 1) % vs.length]); break; }
      case 'athr-off': if (f.athr !== 'OFF') { f.athr = 'OFF'; toast('A/THR DISCONNECT'); } break;
      case 'lights': { const on = !(s.sw.nav && s.sw.beacon && s.sw.strobe && s.sw.landing); s.sw.nav = s.sw.beacon = s.sw.strobe = s.sw.landing = s.sw.taxi = on; this.cockpit.refreshOverhead(); toast(`EXT LIGHTS ${on ? 'ON' : 'OFF'}`); break; }
      case 'autostart': s.setReady(true); s.sw.beacon = true; if (ac.isRotor) { for (const c of ac.engineCmd) c.throttle = 1; ac.rotorRpm = 1; } this.cockpit.refreshOverhead(); toast('AUTO START 완료'); break;
      case 'shutdown': s.setReady(false); this.cockpit.refreshOverhead(); toast('SHUTDOWN'); break;
      case 'baro': s.baroStd = false; s.baroHpa = Math.round(this.weather.qnh); toast(`QNH ${s.baroHpa}`); break;
      case 'baro-std': s.baroStd = !s.baroStd; break;
      case 'master-ack': s.ackMaster(); break;
      case 'checklist': this.toggleWin('checklist'); break;
      case 'overhead': this.toggleWin('overhead'); this.cockpit.refreshOverhead(); break;
      case 'map': this.toggleWin('mapwin'); break;
      case 'fms': this.cockpit.buildFms(); this.toggleWin('fmswin'); break;
      case 'ndmode': this.av.ndMode = this.av.ndMode === 'ARC' ? 'ROSE' : this.av.ndMode === 'ROSE' ? 'PLAN' : 'ARC'; break;
      case 'navsrc': this.av.navSource = this.av.navSource === 'GPS' ? 'VOR' : this.av.navSource === 'VOR' ? 'LOC' : 'GPS'; toast(`NAV SOURCE ${this.av.navSource}`); break;
      case 'reset': if (this.cfg) void this.startFlight(this.cfg); break;
      case 'panel-toggle': document.body.classList.toggle('nopanel'); this.layout(); break;
      case 'rev-toggle': this.controls.reverse = !this.controls.reverse; break;
    }
    this.cockpit?.refreshMcp();
  }

  private defaultHeadPitch() {
    const rotor = this.ac?.isRotor;
    return this.world.deck3d ? (rotor ? -14 : this.ac?.def.cockpit === 'fighter' ? -7 : -11) : rotor ? -8 : -4;
  }
  private toggleWin(id: string) { $(id).classList.toggle('hidden'); }

  setView(v: ViewMode) {
    this.world.view = v;
    this.world.head.zoom = 1;
    document.querySelectorAll<HTMLButtonElement>('#viewSeg button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
    const cockpit = v === 'cockpit';
    document.body.classList.toggle('nopanel', !cockpit);
    this.layout();
  }
  private layout() {
    // shrink the 3D view above the instrument panel in cockpit view (horizon stays centred)
    const panelOn = this.flying && !document.body.classList.contains('nopanel') && this.world.view === 'cockpit';
    document.body.classList.toggle('c3d', panelOn && this.world.deck3d);
    // the 3D deck's autopilot bar floats over the view as glass; the classic 2D panel still takes its own space
    $('world').style.bottom = panelOn && !this.world.deck3d ? 'var(--panelH)' : '0';
    $('panel').classList.toggle('hidden', !this.flying);
  }

  /** Leave the flight and return to the main menu (world map). */
  endFlight(tab?: 'career' | 'activities' | 'airline') {
    window.speechSynthesis?.cancel();
    this.ground.disconnect(); this.world.scenery.hideJetway(null);
    $('efbwin').classList.add('hidden');
    $('atcwin').classList.add('hidden'); $('paxChip').classList.add('hidden');
    this.flying = false;
    this.touch.show(false, false);
    document.body.classList.remove('flying', 'c3d');
    $('topbar').classList.add('hidden');
    this.world.cockpit3d.destroy();
    this.layout();
    this.map.setActive(true);
    this.menu.show(false, tab);
  }
  openMenu() {
    this.paused = true;
    this.touch.show(false, false);
    this.menu.show(this.flying);
  }
  resume() {
    if (!this.flying) return;
    this.menu.hide();
    this.paused = false;
  }

  private bindUi() {
    document.querySelectorAll<HTMLButtonElement>('#viewSeg button').forEach(b => b.onclick = () => this.setView(b.dataset.view as ViewMode));
    $('btnOverhead').onclick = () => this.action('overhead');
    $('btnChecklist').onclick = () => this.action('checklist');
    $('btnMap').onclick = () => this.action('map');
    $('btnEfb').onclick = () => this.efb.toggle();
    $('btnAtc').onclick = () => { $('atcwin').classList.toggle('hidden'); this.renderAtc(); };
    $('btnWx').onclick = () => { $('wxwin').classList.toggle('hidden'); this.wxWinT = 0; this.updateWxWin(); };
    $('btnFms').onclick = () => this.action('fms');
    $('btnMenu').onclick = () => this.openMenu();
    $('btnDiag').onclick = () => this.toggleDiag();
    $('btnDeck').onclick = () => {
      this.world.deck3d = !this.world.deck3d;
      this.menu.settings.deck3d = this.world.deck3d; this.menu.saveSettings();
      $('btnDeck').textContent = deckLabel(this.world.deck3d);
      this.world.head.pitch = this.defaultHeadPitch();
      if (this.world.view !== 'cockpit') this.setView('cockpit'); else this.layout();
    };
    $('errBannerOpen').onclick = () => { $('diagwin').classList.remove('hidden'); this.diagT = 0; this.updateDiag(); };
    $('btnTouch').onclick = () => { this.touch.setEnabled(!this.touch.enabled); $('btnTouch').classList.toggle('on', this.touch.enabled); toast(`터치 조종 ${this.touch.enabled ? 'ON' : 'OFF'}`); };
    $('crashRetry').onclick = () => { if (this.cfg) void this.startFlight(this.cfg); };
    $('resultCareer').onclick = () => { $('resultwin').classList.add('hidden'); $('crash').classList.add('hidden'); this.endFlight(this.cfg?.airlineRoute ? 'airline' : this.activity ? 'activities' : 'career'); };
    $('resultStay').onclick = () => { $('resultwin').classList.add('hidden'); this.paused = false; };
    $('crashMenu').onclick = () => { $('crash').classList.add('hidden'); this.endFlight(); };
    document.querySelectorAll<HTMLElement>('.window').forEach(w => {
      w.querySelector<HTMLButtonElement>('.close')!.onclick = () => w.classList.add('hidden');
      const head = w.querySelector<HTMLElement>('.win-head')!;
      head.onmousedown = e => {
        const r = w.getBoundingClientRect(); const ox = e.clientX - r.left, oy = e.clientY - r.top;
        const mv = (ev: MouseEvent) => { w.style.left = ev.clientX - ox + 'px'; w.style.top = ev.clientY - oy + 'px'; w.style.right = 'auto'; w.style.transform = 'none'; };
        const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
        window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
      };
    });
    // mouse look / orbit
    const el = $('world');
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('pointerdown', e => { this.tapStart = { x: e.clientX, y: e.clientY, t: performance.now() }; if (this.world.view !== 'free') this.dragging = { x: e.clientX, y: e.clientY, btn: e.button }; });
    // a short tap (not a head-look drag) in the cockpit: press what is under it
    el.addEventListener('pointerup', e => {
      const s = this.tapStart;
      this.tapStart = null;
      if (!s || !this.flying || this.world.view !== 'cockpit' || e.button > 0) return;
      if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > 8 || performance.now() - s.t > 500) return;
      const r = el.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      // fingers are big and digit windows small: look a little around the tap for a knob window
      let hit = this.world.cockpitHit(x, y);
      if (!hit || hit.kind !== 'group') {
        for (const [dx, dy] of [[14, 0], [-14, 0], [0, 12], [0, -12], [26, 0], [-26, 0], [0, 22], [0, -22]]) {
          const h = this.world.cockpitHit(x + dx, y + dy);
          if (h && h.kind === 'group') { hit = h; break; }
        }
      }
      this.ckClick.tap(hit, e.clientX, e.clientY);
    });
    window.addEventListener('pointerup', () => { this.dragging = null; });
    window.addEventListener('pointercancel', () => { this.dragging = null; });
    window.addEventListener('pointermove', e => {
      if (!this.dragging || this.world.view === 'free') return;
      const dx = e.clientX - this.dragging.x, dy = e.clientY - this.dragging.y;
      this.dragging.x = e.clientX; this.dragging.y = e.clientY;
      const w = this.world;
      if (w.view === 'cockpit' || w.view === 'cockpit-hud') { w.head.yaw = clamp(w.head.yaw + dx * 0.25, -160, 160); w.head.pitch = clamp(w.head.pitch - dy * 0.25, -70, 70); }
      else if (w.view === 'chase') { w.chase.yaw = (w.chase.yaw - dx * 0.4 + 360) % 360; w.chase.pitch = clamp(w.chase.pitch - dy * 0.3, -80, 60); }
    });
    el.addEventListener('dblclick', () => { this.world.head.yaw = 0; this.world.head.pitch = this.defaultHeadPitch(); this.world.head.zoom = 1; this.world.chase = { yaw: 180, pitch: -8, dist: 1 }; });
    el.addEventListener('wheel', e => {
      if (this.world.view === 'free') return;
      const w = this.world;
      if (w.view === 'cockpit' && this.flying) {
        const r = el.getBoundingClientRect();
        if (this.ckClick.wheel(w.cockpitHit(e.clientX - r.left, e.clientY - r.top), e.deltaY < 0, e.shiftKey)) return;
      }
      if (w.view === 'chase') w.chase.dist = clamp(w.chase.dist * (e.deltaY > 0 ? 1.1 : 0.9), 0.3, 12);
      else w.head.zoom = clamp(w.head.zoom * (e.deltaY > 0 ? 0.9 : 1.1), 0.6, 8);
    }, { passive: true });
    window.addEventListener('resize', () => this.layout());
    window.addEventListener('pointerdown', () => this.sound.init(), { once: true });
    // the toolbar steps back after a few seconds without input (touch or move to bring it back)
    let idleTimer = 0;
    const wake = () => {
      document.body.classList.remove('idle');
      clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => { if (this.flying && !this.menu.visible) document.body.classList.add('idle'); }, 4000);
    };
    for (const ev of ['pointermove', 'pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, wake, { passive: true });
  }

  // ───────────────────────── main loop ─────────────────────────
  private frame(t: number) {
    requestAnimationFrame(tt => this.frame(tt));
    const dtReal = clamp((t - (this.last || t)) / 1000, 0, 0.1);
    this.last = t;
    if (dtReal > 0) this.fps += (1 / dtReal - this.fps) * 0.05;
    if (!this.flying || !this.ac) { this.world.renderFrame(); this.updateDiag(); return; }
    const ac = this.ac, f = this.fcs, s = this.sys, c = this.controls;
    const rate = RATES[this.rateIdx];
    const running = !this.paused && !ac.crash && !this.menu.visible;
    this.touch.show(!this.menu.visible && !ac.crash, ac.isRotor);
    this.world.viewer.clock.shouldAnimate = running;
    this.world.viewer.clock.multiplier = rate;

    if (running) {
      c.update(dtReal, { heli: ac.isRotor, autoRudder: false });
      // throttle / reverse
      const heli = ac.isRotor;
      if (!heli) {
        if (f.athr !== 'OFF' && (c.keys.has('F2') || c.keys.has('F3') || c.keys.has('PageUp') || c.keys.has('PageDown'))) { f.athr = 'OFF'; toast('A/THR DISCONNECT'); this.sound.chime([900, 900], 0.15); }
        if (f.athr === 'OFF') for (const cmd of ac.engineCmd) cmd.throttle = c.throttle; else c.throttle = ac.engineCmd[0]?.throttle ?? 0;
        const revOk = ac.def.reversers || ac.def.eng.t === 'tprop';
        for (const cmd of ac.engineCmd) cmd.reverse = revOk && c.reverse && (ac.onGround || ac.def.cockpit === 'fighter' ? ac.onGround : false);
      } else {
        for (const cmd of ac.engineCmd) cmd.throttle = s.sw.engMaster.some(Boolean) ? Math.max(cmd.throttle, ac.engines.some(e => e.running) ? 1 : cmd.throttle) : 0;
      }
      for (const cmd of ac.engineCmd) if (this.menu.settings.autoMixture) cmd.mixture = clamp(ac.air.sigma * 1.05, 0.3, 1);
      ac.brakeR = c.brakes; ac.brakeL = Math.max(c.brakes, c.brakeL);
      if (c.brakes > 0 || f.athr === 'TOGA' || ac.engineCmd.some(x => x.throttle > 0.3)) ac.autobrakeCmd = 0;
      else if (ac.autobrake > 0 && ac.onGround && ac.gs > 30 * KT && ac.spoilerPos > 0.5) ac.autobrakeCmd = [0, 0.25, 0.45, 0.8][ac.autobrake];
      const pin = { pitch: c.pitch, roll: c.roll, yaw: c.yaw, trim: c.trim, collective: heli ? c.collective : 0 };
      this.acc += dtReal * rate;
      let steps = 0;
      const env = { weather: this.weather, ground: (la: number, lo: number) => this.world.elevation.ground(la, lo), time: this.world.viewer.clock.currentTime.secondsOfDay };
      while (this.acc >= PHYS_DT && steps < 240) {
        if (this.push.on) {
          // the tug pushes tail-first at walking pace; rudder input swings the tail
          const spd = 1.5;
          ac.parkingBrake = false; ac.brakeL = ac.brakeR = 0;
          ac.vel = [-Math.cos(ac.psi) * spd, -Math.sin(ac.psi) * spd, ac.vel[2]];
          ac.w = [0, 0, -c.yaw * 0.09];
          this.push.dist += spd * PHYS_DT;
          if (this.push.dist > 70) this.stopPushback();
        }
        f.update(PHYS_DT, pin);
        ac.step(PHYS_DT, env);
        this.acc -= PHYS_DT; steps++;
        if (ac.crash) break;
      }
      if (steps >= 240) this.acc = 0;
      if (heli) c.collective = ac.collective;
      s.update(dtReal * rate);
      if (ac.touchdownEvent !== this.lastTouch) {
        this.lastTouch = ac.touchdownEvent;
        const fpm = ac.lastTouchVs / (FT / 60);
        if (ac.gs > 20 * KT && !ac.isRotor) {
          const grade = fpm < 120 ? '버터 착륙' : fpm < 240 ? '훌륭함' : fpm < 400 ? '양호' : fpm < 600 ? '거친 착륙' : '하드 랜딩';
          toast(`TOUCHDOWN ${Math.round(fpm)} fpm · ${Math.round(ac.ias / KT)} kt · ${grade}`);
        }
        s.events.push('touchdown');
        this.job.fpm = fpm;
        if (this.pax && ac.gs > 20 * KT) this.pax.touchdown(fpm);
      }
      if (this.careerJob) this.trackJob(dtReal * rate);
      this.updateLiveWeather();
      if (this.pax) this.pax.update(dtReal * rate, ac, turbulenceAt(this.weather, ac.alt, ac.agl));
      if (this.atc) {
        this.atc.update();
        this.atcT -= dtReal;
        if (this.atcT <= 0) { this.atcT = 1; if (!$('atcwin').classList.contains('hidden')) this.renderAtc(); }
        if (this.atc.phase === 'done' && this.cfg?.airlineRoute && (!this.pax || this.pax.phase === 'deboarded')) this.finishAirline();
      }
      this.checkArrivalParking();
      const walk = !this.pax || this.ground.kind !== 'stairs' ? null : this.pax.phase === 'boarding' ? 'in' : this.pax.phase === 'deboarding' ? 'out' : null;
      this.ground.update(ac, this.world.acMatrix, dtReal * rate, walk);
      this.world.updateGuide(ac, f.plan.wps, f.plan.active, this.cfg?.cruiseFt ?? 35000, f.plan.approach, this.atc?.taxiGuide() ?? null);
      this.efb.tick(dtReal);
      if (this.pax) { $('paxChip').classList.remove('hidden'); $('paxChip').textContent = this.pax.phase === 'boarding' ? `탑승 중 ${Math.floor(this.pax.boarded)}/${this.pax.count}명` : this.pax.phase === 'deboarding' ? `하기 중 · 기내 ${Math.ceil(this.pax.boarded)}명 남음` : this.pax.phase === 'deboarded' ? `승객 ${this.pax.count}명 하기 완료 · 만족도 ${this.pax.label}` : `승객 ${this.pax.count}명 · 만족도 ${this.pax.label}`; }
      else $('paxChip').classList.add('hidden');
      this.updateWxWin();
      if (this.activity?.type === 'landing') this.trackLanding(dtReal * rate);
      if (ac.crash) {
        if (this.careerJob && !this.job.done) this.completeJob(true);
        $('crashReason').textContent = ac.crash.reason;
        $('crash').classList.remove('hidden');
        s.events.push('say:crash');
      }
      if (f.msg) { toast(f.msg); f.msg = ''; }
      // head look with Shift+arrows (hat) handled here
    }

    // ── render ──
    const w = this.world;
    // values the real cockpit's levers, sticks, needles and MCP windows follow (FlightGear property semantics)
    {
      const fbwStick = ac.def.fbw === 'airbus';
      const roll = fbwStick ? c.roll : ac.cmd.da, pitch = fbwStick ? c.pitch : ac.cmd.de;
      const lv: Record<string, number> = {
        aileron: roll, 'aileron-abs': Math.abs(roll), elevator: -pitch, rudder: c.yaw, 'elevator-trim': ac.trim, speedbrake: ac.speedbrake,
        mixture: ac.engineCmd[0]?.mixture ?? 1, 'prop-lever': 1, 'gear-lever': ac.gearDown ? 1 : 0,
        'ap-spd': f.selSpd, 'ap-mach': f.selMach, 'ap-hdg': f.selHdg, 'ap-alt': f.selAlt, 'ap-vs': f.selVs,
        ias: ac.ias / KT, alt: ac.alt / FT, pitch: ac.theta * RAD, roll: ac.phi * RAD, hdg: wrap360(ac.psi * RAD),
        vs: ac.vs / FT * 60, turn: ac.w[2] * RAD / 3, slip: clamp(ac.ny * 4, -1, 1),
        'aileron-pos': ac.da, 'aileron-pos-r': -ac.da, 'elevator-pos': -ac.de, 'rudder-pos': ac.dr,
      };
      ac.engineCmd.forEach((e, i) => { lv['throttle' + i] = e.throttle; });
      ac.engines.forEach((e, i) => { lv['rpm' + i] = e.rpm; });
      w.liveValues = lv;
    }
    const lightsOn = { nav: s.sw.nav && s.elecPowered, beacon: s.sw.beacon && s.elecPowered, strobe: s.sw.strobe && s.elecPowered, landing: (s.sw.landing || s.sw.taxi) && s.elecPowered };
    w.updateAircraft(ac, running ? dtReal * rate : 0, lightsOn, performance.now() / 1000);
    w.cockpit3d.update(ac, this.av, w.acMatrix, w.view === 'cockpit' && w.deck3d, dtReal,
      { pitch: c.pitch, roll: c.roll, throttle: ac.engineCmd.map(e => e.throttle), collective: ac.collective }, 1 - w.nightFactor(ac.lat, ac.lon) * 0.75);
    w.updateCamera(ac, dtReal);
    const night = w.nightFactor(ac.lat, ac.lon);
    const eyeAlt = w.view === 'cockpit' || w.view === 'cockpit-hud' ? ac.alt : w.scene.camera.positionCartographic.height - w.geoidOffset;
    w.updateAirportLights(ac, night, { lat: ac.lat, lon: ac.lon, alt: ac.alt });
    w.runways.setWet(this.weather.precip > 0);
    w.scenery.wind = { dir: this.weather.windDir, spd: this.weather.windSpd, gust: this.weather.gust };
    this.wxT -= dtReal;
    if (this.wxT <= 0) { this.wxT = 2; w.updateWeather(this.weather, ac); }
    // weather effects
    const cloud = inCloud(this.weather, eyeAlt);
    $('cloudfx').style.opacity = String(cloud * 0.93);
    const topCloud = Math.max(0, ...this.weather.clouds.map(x => x.top));
    // animated rain / snow (shader) on medium+; the old CSS streaks only on low quality
    const precipOn = !!this.weather.precip && eyeAlt < topCloud;
    $('rainfx').style.opacity = String(precipOn && w.qualityTier < 1 ? 0.25 + 0.2 * this.weather.precip : 0);
    // downwash on water / dust, and lightning in thunderstorms (heavy rain under convective cloud)
    const gs0 = w.elevation.ground(ac.lat, ac.lon);
    const sea = gs0.water || gs0.h < 1.5;   // terrain data has bathymetry / no-data at sea: the surface is sea level
    w.effects.updateWash(ac, { h: sea ? Math.max(0, gs0.h) : gs0.h, water: sea, offset: w.geoidOffset }, dtReal);
    const storm = this.weather.precip >= 3 || (this.weather.precip >= 2 && this.weather.clouds.some(c => c.top - c.base > 5000)) ? Math.min(1, this.weather.precip / 3) : 0;
    w.effects.updateLightning(storm, dtReal);
    w.effects.update(ac, w.acMatrix, { precipLevel: this.weather.precip, belowTops: eyeAlt < topCloud, cockpit: w.view === 'cockpit' || w.view === 'cockpit-hud', tier: w.qualityTier, night, inCloud: cloud, dt: dtReal });
    const g = ac.nz;
    $('blackout').style.opacity = String(clamp((g - 6.5) / 3, 0, 0.9) + clamp((-g - 2.5) / 2, 0, 0.6));
    document.documentElement.style.setProperty('--panelBright', String(1 - night * 0.3));
    // instruments ~30 Hz
    this.instT -= dtReal;
    this.av.zulu = Cesium.JulianDate.toDate(w.viewer.clock.currentTime);
    if (this.instT <= 0) {
      this.instT = 1 / 30;
      if (w.view === 'cockpit' && !w.deck3d && !document.body.classList.contains('nopanel')) this.cockpit.draw(1 / 30);
      else if (!$('mapwin').classList.contains('hidden')) this.cockpit.draw(1 / 30);
      this.cockpit.refreshMcp();
      this.cockpit.updatePedestal(1 / 30, c.throttle);
      this.touch.sync(ac.isRotor ? ac.collective : (ac.engineCmd[0]?.throttle ?? c.throttle));
      const fr = w.scene.camera.frustum as Cesium.PerspectiveFrustum & { fovy: number };
      const hudOn = (w.view === 'cockpit-hud' || (w.view === 'cockpit' && ac.def.cockpit === 'fighter')) && s.avionicsPowered;
      this.hud.draw(this.av, hudOn, fr.fovy * RAD, w.head.yaw, w.head.pitch);
      const z = this.av.zulu;
      $('tbUtc').textContent = `${String(z.getUTCHours()).padStart(2, '0')}:${String(z.getUTCMinutes()).padStart(2, '0')}:${String(z.getUTCSeconds()).padStart(2, '0')}Z`;
      $('tbRate').textContent = `×${rate}  ${Math.round(this.fps)}fps`;
      $('tbPause').classList.toggle('hidden', !this.paused);
      $('tbPos').textContent = `${ac.lat.toFixed(4)} ${ac.lon.toFixed(4)}  ${Math.round(ac.alt / FT)}ft`;
    }
    const events = s.events.splice(0);
    if (this.wasAp && !f.ap) events.push('apoff');
    this.wasAp = f.ap;
    this.sound.update(ac, w.view === 'cockpit' || w.view === 'cockpit-hud', !running, events);
    w.renderFrame();
    this.updateDiag();
  }

  // ───────────────────────── career ─────────────────────────
  private trackJob(dt: number) {
    const ac = this.ac!, j = this.job;
    if (j.done) return;
    j.t += dt;
    if (!ac.onGround && ac.agl > 30) j.airborne = true;
    if (ac.ias / KT > ac.def.v.vmo + 5) j.overspeed += dt;
    const stopped = ac.onGround && ac.gs < 1.5 * KT && (ac.parkingBrake || ac.engines.every(e => !e.running));
    j.stillT = stopped ? j.stillT + dt : 0;
    if (j.airborne && j.stillT > 2) this.completeJob(false);
  }
  private completeJob(crashed: boolean) {
    const car = this.menu.career, job = this.careerJob, ac = this.ac!;
    this.job.done = true;
    if (!car || !job) return;
    const near = this.db.nearest(ac, 1, 5000)[0];
    const r = finishJob(car, job, `${ac.def.mfr} ${ac.def.name}`, { landedAt: crashed ? null : near?.apt.icao ?? null, crashed, fpm: this.job.fpm, minutes: this.job.t / 60, overspeed: this.job.overspeed });
    if (crashed) car.location = job.from;
    saveCareer(car);
    this.careerJob = null;
    const title = r.result === 'ok' ? '임무 완료' : r.result === 'diverted' ? '회항 — 임무 부분 완료' : r.result === 'crash' ? '임무 실패' : '임무 종료';
    $('resultTitle').textContent = title;
    $('resultCareer').textContent = '커리어 화면으로';
    $('resultBody').innerHTML = `<div class="res-pay ${r.pay >= 0 ? 'ok' : 'bad'}">${r.pay >= 0 ? '+' : '−'}$${Math.abs(r.pay).toLocaleString()}</div>
      <table class="spec-t">${r.lines.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
      <div class="dim" style="margin-top:6px">잔고 $${car.money.toLocaleString()} · ${car.xp.toLocaleString()} XP · 위치 ${car.location}</div>`;
    $('resultwin').classList.remove('hidden');
    if (!crashed) this.paused = true;
  }

  // ───────────────────────── landing challenge ─────────────────────────
  private trackLanding(dt: number) {
    const ac = this.ac!, L = this.landing, ap = this.fcs.plan.approach;
    if (L.done) return;
    if (ac.crash) { this.finishLanding(); return; }
    if (!L.td && ac.onGround && this.job.fpm !== null) {
      const p = { lat: ac.lat, lon: ac.lon };
      L.td = {
        fpm: this.job.fpm,
        xtk: ap ? crossTrack(ap.thr, ap.locAnt, p) : 0,
        along: ap ? alongTrack(ap.thr, ap.locAnt, p) : 0,
        spdErr: ac.ias / KT - this.fcs.vref(),
        bank: Math.abs(ac.phi * RAD),
      };
    }
    if (L.td) { L.since += dt; if (ac.gs < 30 * KT || L.since > 30) this.finishLanding(); }
  }
  private finishLanding() {
    const L = this.landing, a = this.activity!;
    L.done = true;
    const crashed = !!this.ac!.crash;
    const r = L.td && !crashed ? scoreLanding(L.td) : { score: 0, grade: 'F', onRunway: false, parts: [] as [string, string, number][] };
    const record = !crashed && saveBest(a.id, r.score);
    $('resultTitle').textContent = `${a.title} — ${r.grade} 등급`;
    $('resultBody').innerHTML = `<div class="res-pay ${r.score >= 550 ? 'ok' : 'bad'}">${r.score} / 1000${record && r.score > 0 ? ' · 최고 기록!' : ''}</div>
      <table class="spec-t">${r.parts.map(([k, v, pts]) => `<tr><td>${k}</td><td>${v} (${pts})</td></tr>`).join('')}
      ${crashed ? '<tr><td>결과</td><td>사고</td></tr>' : !r.onRunway ? '<tr><td>결과</td><td>활주로 밖 접지</td></tr>' : ''}</table>`;
    $('resultCareer').textContent = '액티비티 화면으로';
    $('resultwin').classList.remove('hidden');
    if (!crashed) this.paused = true;
  }

  // ───────────────────────── diagnostics panel ─────────────────────────
  private diagT = 0;
  private updateDiag() {
    const win = $('diagwin');
    if (win.classList.contains('hidden')) return;
    if (performance.now() - this.diagT < 500) return;
    this.diagT = performance.now();
    const d = this.world.diagnostics();
    const esc = (x: string) => x.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
    const rows = Object.entries(d).map(([k, v]) => `<tr><td>${k}</td><td>${esc(v)}</td></tr>`).join('');
    const errs = this.world.errorLog.slice().reverse().map(e =>
      `<div class="diag-err"><b>×${e.count}</b> [${e.where}] ${esc(e.msg)}<pre>${esc(e.stack.split('\n').slice(0, 6).join('\n'))}</pre></div>`).join('') || '<div class="dim">렌더링 오류 없음</div>';
    win.querySelector('.win-body')!.innerHTML = `<table class="help-table">${rows}</table><h4 style="margin:10px 0 4px">최근 렌더링 오류</h4>${errs}
      <p class="note">문제가 있으면 이 창을 캡처해서 보내주세요.</p>`;
  }
  toggleDiag() {
    $('diagwin').classList.toggle('hidden');
    this.diagT = 0;
    this.updateDiag();
  }
}

const app = new App();
(window as unknown as { sky: App }).sky = app;
app.boot().catch(e => {
  console.error(e);
  const webgl = !!document.createElement('canvas').getContext('webgl2');
  loading('오류: ' + (e?.message ?? e) + (webgl ? '' : ' — 이 브라우저/그래픽 드라이버는 WebGL2를 지원하지 않습니다 (Chrome/Edge 최신 버전, 하드웨어 가속 켜기)'));
  document.querySelector<HTMLElement>('#loading .spinner')?.style.setProperty('display', 'none');
});
