// SkyLine Flight Simulator — application entry: boot, flight setup, main loop.
import * as Cesium from 'cesium';
import { DEG, FT, KT, NM, RAD, clamp, qFromEuler, wrap360 } from './core/math.ts';
import { destination, magVar } from './core/geo.ts';
import { Aircraft } from './sim/fdm.ts';
import { FCS, type Waypoint } from './sim/fcs.ts';
import { Systems } from './sim/systems.ts';
import { getAircraft } from './sim/aircraftDb.ts';
import { WEATHER_PRESETS, atmosphere, casToTas, inCloud, type WeatherState } from './sim/atmosphere.ts';
import { maxThrust } from './sim/engines.ts';
import { AirportDB, lineUp, makeApproach, runwayEnds, type Airport } from './world/airports.ts';
import { World, type ViewMode } from './world/scene.ts';
import { Controls } from './input/controls.ts';
import { Sound } from './audio/sound.ts';
import { Menu, type FlightConfig } from './ui/menu.ts';
import { Cockpit } from './ui/cockpit.ts';
import { HUD } from './avionics/hud.ts';
import type { AvData } from './avionics/common.ts';

(window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = CESIUM_BASE_URL;

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
  hud!: HUD;
  // flight
  ac: Aircraft | null = null;
  fcs!: FCS; sys!: Systems; cockpit!: Cockpit; av!: AvData;
  cfg: FlightConfig | null = null;
  weather!: WeatherState;
  flying = false; paused = false; rateIdx = 2;
  private acc = 0; private last = 0; private instT = 0; private wxT = 0; private lastTouch = 0;
  private fps = 60;
  private wasAp = false;
  private dragging: { x: number; y: number; btn: number } | null = null;

  async boot() {
    loading('공항 · 항법 데이터베이스 로딩 중…');
    try {
      await this.db.load();
    } catch (e) {
      throw new Error(`공항 데이터(data/airports.json)를 불러오지 못했습니다 — ${(e as Error).message}`);
    }
    this.menu = new Menu($('menu'), this.db, this.controls);
    const s = this.menu.settings;
    this.world = new World($('world'), this.db, { imagery: s.imagery, googleKey: s.googleKey, ionToken: s.ionToken, photoreal: s.photoreal, shadows: s.shadows, quality: s.quality });
    this.hud = new HUD($('hudLayer'));
    this.sound.volume = s.volume;
    this.menu.onFly = c => { this.sound.init(); void this.startFlight(c); };
    this.menu.onPreview = apt => { if (!this.flying) this.world.flyOverview(apt.lat, apt.lon); void this.world.elevation.preload(apt.lat, apt.lon, 10000); };
    this.menu.onRoute = pts => this.world.showRoute(pts);
    this.menu.onResume = () => this.resume();
    this.menu.onSettings = st => {
      this.sound.volume = st.volume;
      this.world.opts = { ...this.world.opts, ...st };
      this.world.setImagery(st.imagery);
      this.world.viewer.shadows = st.shadows;
      if (st.photoreal && st.googleKey) void this.world.enablePhotoreal(st.googleKey);
      toast('설정 저장됨');
    };
    this.controls.onAction = a => this.action(a);
    this.bindUi();
    loading(null);
    (window as unknown as { __booted: boolean }).__booted = true;
    this.menu.show(false);
    requestAnimationFrame(t => this.frame(t));
  }

  // ───────────────────────── flight setup ─────────────────────────
  async startFlight(cfg: FlightConfig) {
    this.cfg = cfg;
    this.menu.hide();
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
    const w: WeatherState = JSON.parse(JSON.stringify((WEATHER_PRESETS[cfg.weather] ?? WEATHER_PRESETS.clear).w));
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
    if (arr && arrEnd) { fcs.plan.approach = makeApproach(arr, arrEnd.rw, arrEnd.end); fcs.ilsTuned = true; }
    fcs.selAlt = Math.min(cfg.cruiseFt, def.v.ceil);
    // time of day
    const date = this.simDate(cfg, dep);
    this.world.setTime(date, 1);
    // spawn
    await this.spawn(cfg, dep, arr);
    // scene
    this.world.hideRoute();
    this.world.geoidOffset = 0;
    await this.world.loadAircraft(ac);
    if (this.world.opts.photoreal) await this.world.calibrateGeoid(ac.lat, ac.lon, ac.groundH);
    this.world.updateWeather(w, ac, true);
    this.world.view = def.cockpit === 'fighter' ? 'cockpit' : 'cockpit';
    this.world.head = { yaw: 0, pitch: def.fdm === 'rotor' ? -8 : -4, zoom: 1 };
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
    if (cfg.start === 'cold') toast('Cold & Dark: 오버헤드(O)에서 시동 절차를 수행하거나 Ctrl+E로 자동 시동');
  }

  private simDate(cfg: FlightConfig, apt: Airport): Date {
    if (cfg.time === 'now') return new Date();
    const hours = { dawn: 6, morning: 10, afternoon: 15, dusk: 19, night: 23 }[cfg.time];
    const off = Math.round(apt.lon / 15);
    const d = new Date();
    d.setUTCHours(hours - off, 0, 0, 0);
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
      const dist = (def.fdm === 'rotor' ? 3 : def.cat === 'ga' || def.cat === 'vintage' ? 6 : 10) * NM;
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
    } else {
      const p = destination(depEnd.end, depEnd.end.hdg, 3000);
      lat = p.lat; lon = p.lon; hdg = depEnd.end.hdg;
      altM = dep.elev + (def.fdm === 'rotor' ? 1000 : 3000) * FT;
      spdKt = def.fdm === 'rotor' ? 60 : def.cat === 'glider' ? 50 : Math.min(def.v.vref * 1.5, 250);
    }
    await this.world.elevation.preload(lat, lon, 1500);
    const ground = Math.max(this.world.elevation.ground(lat, lon).h, start === 'cruise' ? 0 : dep.elev);
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
    if (def.cat !== 'glider') {
      fcs.engageAp(true);
      if (start === 'cruise') { fcs.lat = fcs.plan.to ? 'NAV' : 'HDG'; fcs.vert = 'ALT'; fcs.altHold = fcs.selAlt; if (def.v.mmo < 1 && ac.mach > 0.6) { fcs.spdIsMach = true; fcs.selMach = Math.round(ac.mach * 100) / 100; } }
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
    $('world').style.bottom = panelOn ? 'var(--panelH)' : '0';
    $('panel').classList.toggle('hidden', !this.flying);
  }

  openMenu() {
    this.paused = true;
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
    $('btnFms').onclick = () => this.action('fms');
    $('btnMenu').onclick = () => this.openMenu();
    $('crashRetry').onclick = () => { if (this.cfg) void this.startFlight(this.cfg); };
    $('crashMenu').onclick = () => { $('crash').classList.add('hidden'); this.flying = false; document.body.classList.remove('flying'); $('topbar').classList.add('hidden'); this.layout(); this.menu.show(false); };
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
    el.addEventListener('mousedown', e => { if (this.world.view !== 'free') this.dragging = { x: e.clientX, y: e.clientY, btn: e.button }; });
    window.addEventListener('mouseup', () => { this.dragging = null; });
    window.addEventListener('mousemove', e => {
      if (!this.dragging || this.world.view === 'free') return;
      const dx = e.clientX - this.dragging.x, dy = e.clientY - this.dragging.y;
      this.dragging.x = e.clientX; this.dragging.y = e.clientY;
      const w = this.world;
      if (w.view === 'cockpit' || w.view === 'cockpit-hud') { w.head.yaw = clamp(w.head.yaw + dx * 0.25, -160, 160); w.head.pitch = clamp(w.head.pitch - dy * 0.25, -70, 70); }
      else if (w.view === 'chase') { w.chase.yaw = (w.chase.yaw - dx * 0.4 + 360) % 360; w.chase.pitch = clamp(w.chase.pitch - dy * 0.3, -80, 60); }
    });
    el.addEventListener('dblclick', () => { this.world.head.yaw = 0; this.world.head.pitch = this.ac?.isRotor ? -8 : -4; this.world.head.zoom = 1; this.world.chase = { yaw: 180, pitch: -8, dist: 1 }; });
    el.addEventListener('wheel', e => {
      if (this.world.view === 'free') return;
      const w = this.world;
      if (w.view === 'chase') w.chase.dist = clamp(w.chase.dist * (e.deltaY > 0 ? 1.1 : 0.9), 0.3, 12);
      else w.head.zoom = clamp(w.head.zoom * (e.deltaY > 0 ? 0.9 : 1.1), 0.6, 8);
    }, { passive: true });
    window.addEventListener('resize', () => this.layout());
    window.addEventListener('pointerdown', () => this.sound.init(), { once: true });
  }

  // ───────────────────────── main loop ─────────────────────────
  private frame(t: number) {
    requestAnimationFrame(tt => this.frame(tt));
    const dtReal = clamp((t - (this.last || t)) / 1000, 0, 0.1);
    this.last = t;
    if (dtReal > 0) this.fps += (1 / dtReal - this.fps) * 0.05;
    if (!this.flying || !this.ac) return;
    const ac = this.ac, f = this.fcs, s = this.sys, c = this.controls;
    const rate = RATES[this.rateIdx];
    const running = !this.paused && !ac.crash && !this.menu.visible;
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
      }
      if (ac.crash) {
        $('crashReason').textContent = ac.crash.reason;
        $('crash').classList.remove('hidden');
        s.events.push('say:crash');
      }
      if (f.msg) { toast(f.msg); f.msg = ''; }
      // head look with Shift+arrows (hat) handled here
    }

    // ── render ──
    const w = this.world;
    const lightsOn = { nav: s.sw.nav && s.elecPowered, beacon: s.sw.beacon && s.elecPowered, strobe: s.sw.strobe && s.elecPowered, landing: (s.sw.landing || s.sw.taxi) && s.elecPowered };
    w.updateAircraft(ac, running ? dtReal * rate : 0, lightsOn, performance.now() / 1000);
    w.updateCamera(ac, dtReal);
    const night = w.nightFactor(ac.lat, ac.lon);
    const eyeAlt = w.view === 'cockpit' || w.view === 'cockpit-hud' ? ac.alt : w.scene.camera.positionCartographic.height - w.geoidOffset;
    w.updateAirportLights(ac, night, { lat: ac.lat, lon: ac.lon, alt: ac.alt });
    this.wxT -= dtReal;
    if (this.wxT <= 0) { this.wxT = 2; w.updateWeather(this.weather, ac); }
    // weather effects
    const cloud = inCloud(this.weather, eyeAlt);
    $('cloudfx').style.opacity = String(cloud * 0.93);
    const topCloud = Math.max(0, ...this.weather.clouds.map(x => x.top));
    $('rainfx').style.opacity = String(this.weather.precip && eyeAlt < topCloud ? 0.25 + 0.2 * this.weather.precip : 0);
    const g = ac.nz;
    $('blackout').style.opacity = String(clamp((g - 6.5) / 3, 0, 0.9) + clamp((-g - 2.5) / 2, 0, 0.6));
    document.documentElement.style.setProperty('--panelBright', String(1 - night * 0.3));
    // instruments ~30 Hz
    this.instT -= dtReal;
    this.av.zulu = Cesium.JulianDate.toDate(w.viewer.clock.currentTime);
    if (this.instT <= 0) {
      this.instT = 1 / 30;
      if (w.view === 'cockpit' && !document.body.classList.contains('nopanel')) this.cockpit.draw(1 / 30);
      else if (!$('mapwin').classList.contains('hidden')) this.cockpit.draw(1 / 30);
      this.cockpit.refreshMcp();
      this.cockpit.updatePedestal(1 / 30, c.throttle);
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
