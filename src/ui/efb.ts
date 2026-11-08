// EFB (electronic flight bag): the pilot's tablet. A home screen of apps — flight plan, performance, moving map,
// airport diagrams, weather, ground services, the cabin (service, announcements, seatbelt sign, lights, IFE),
// checklists and settings — with a status bar and a home bar like the real iPad EFBs.
import type { Aircraft } from '../sim/fdm.ts';
import type { FCS } from '../sim/fcs.ts';
import type { Airport } from '../world/airports.ts';
import type { AirportLayout } from '../world/gates.ts';
import { distance, bearing } from '../core/geo.ts';
import { DEG, FT, KT, NM, RAD, R_EARTH } from '../core/math.ts';
import { liveWeatherCached, reportLine } from '../sim/liveWeather.ts';
import type { Equipment } from '../world/groundServices.ts';
import { SERVICES, type Passengers, type ServiceKind } from '../sim/passengers.ts';

export interface EfbCtx {
  ac: () => Aircraft | null; fcs: () => FCS; dep: () => Airport | undefined; arr: () => Airport | undefined;
  callsign: () => string; pax: () => Passengers | null;
  equipment: () => Equipment; setEquipment: (k: Equipment) => void; pushback: () => void; refuel: (kg: number) => void;
  guide: () => boolean; setGuide: (on: boolean) => void; scenery: () => boolean; setScenery: (on: boolean) => void;
  graphics: () => { quality: 'low' | 'medium' | 'high' | 'ultra'; shadows: boolean; look: boolean }; setGraphics: (q: 'low' | 'medium' | 'high' | 'ultra', shadows: boolean, look: boolean) => void; cruiseFt: () => number; runwayLen: (apt: Airport | undefined, arr: boolean) => number;
  /** Airports around a point (for the moving map). */
  nearby: (lat: number, lon: number, radiusM: number) => Airport[];
  layout: (apt: Airport) => Promise<AirportLayout>;
  seatbelt: () => boolean; setSeatbelt: (on: boolean) => void;
  action: (a: string) => void;
  say: (text: string) => void;
}

type App = 'home' | 'ofp' | 'perf' | 'map' | 'chart' | 'wx' | 'ground' | 'cabin' | 'opt';
const APPS: { id: App | 'checklist'; name: string; icon: string; color: string }[] = [
  { id: 'ofp', name: '비행계획', icon: '📋', color: '#2f7cf6' },
  { id: 'perf', name: '성능', icon: '📈', color: '#16a37f' },
  { id: 'map', name: '무빙맵', icon: '🗺️', color: '#7c4dff' },
  { id: 'chart', name: '공항도', icon: '🛬', color: '#f2994a' },
  { id: 'wx', name: '날씨', icon: '⛅', color: '#2d9cdb' },
  { id: 'ground', name: '지상', icon: '🚜', color: '#c0392b' },
  { id: 'cabin', name: '객실', icon: '🍱', color: '#e84393' },
  { id: 'checklist', name: '체크리스트', icon: '✅', color: '#27ae60' },
  { id: 'opt', name: '설정', icon: '⚙️', color: '#636e72' },
];

export class Efb {
  app: App = 'home';
  private body: HTMLElement;
  private t = 0;
  private mapZoom = 40; // NM across
  private chartFor: 'dep' | 'arr' = 'dep';
  private chartLayout: { icao: string; layout: AirportLayout | null } | null = null;
  private lastTouch = 0;

  constructor(private win: HTMLElement, private ctx: EfbCtx) {
    this.body = win.querySelector('.win-body')!;
    win.classList.add('efb-device');
    // don't redraw under a finger: a refresh between touch-down and the click would swallow the tap
    this.body.addEventListener('pointerdown', () => { this.lastTouch = performance.now(); }, true);
  }
  get open() { return !this.win.classList.contains('hidden'); }
  toggle() { this.win.classList.toggle('hidden'); this.render(); }

  /** Live pages (map, cabin, ground) refresh while open. */
  tick(dt: number) {
    if (!this.open) return;
    this.t -= dt;
    if (this.t > 0) return;
    this.t = this.app === 'map' ? 0.25 : 1;
    if (this.app !== 'map' && performance.now() - this.lastTouch < 1500) return;
    if (this.app === 'map') { this.drawMap(); this.statusBar(); }
    else if (this.app === 'chart') this.drawChart();
    else if (this.app !== 'wx' && this.app !== 'opt') this.render();
    else this.statusBar();
  }

  private statusBar() {
    const sb = this.body.querySelector<HTMLElement>('.efb-sb-time');
    if (sb) sb.textContent = new Date().toISOString().slice(11, 16) + 'Z';
  }

  render() {
    const ac = this.ctx.ac();
    if (!ac) return;
    const title = this.app === 'home' ? 'SkyLine EFB' : APPS.find(a => a.id === this.app)?.name ?? '';
    const now = new Date();
    this.body.innerHTML = `
      <div class="efb-sb"><span class="efb-sb-time">${now.toISOString().slice(11, 16)}Z</span><span class="efb-sb-title">${this.app === 'home' ? '' : `<button class="efb-back" data-home>‹ 홈</button>`}${title}</span><span>📶 ✈︎ 🔋 ${85 + (now.getMinutes() % 10)}%</span></div>
      <div class="efb-screen ${this.app === 'home' ? 'home' : ''}">${this.app === 'home' ? this.home(ac) : this.page(ac)}</div>
      <div class="efb-homebar" data-home></div>`;
    this.body.querySelectorAll<HTMLElement>('[data-home]').forEach(b => b.onclick = () => { this.app = 'home'; this.render(); });
    this.body.querySelectorAll<HTMLButtonElement>('[data-app]').forEach(b => b.onclick = () => {
      const id = b.dataset.app!;
      if (id === 'checklist') { this.ctx.action('checklist'); return; }
      this.app = id as App; this.t = 0; this.render();
    });
    this.bind(ac);
    if (this.app === 'map') this.drawMap();
    if (this.app === 'chart') this.loadChart();
  }

  private home(ac: Aircraft) {
    const dep = this.ctx.dep(), arr = this.ctx.arr(), pax = this.ctx.pax();
    return `<div class="efb-widget"><div><b>${this.ctx.callsign()}</b><span>${dep?.icao ?? '—'} → ${arr?.icao ?? '—'}</span></div>
        <div><b>${Math.round(ac.alt / FT).toLocaleString()} ft</b><span>${Math.round(ac.ias / KT)} kt · ${arr ? Math.round(distance(ac, arr) / NM) + ' NM 남음' : ''}</span></div>
        ${pax ? `<div><b>${pax.count}명</b><span>만족도 ${pax.label}</span></div>` : ''}</div>
      <div class="efb-apps">${APPS.map(a => `<button class="efb-app" data-app="${a.id}"><i style="background:${a.color}">${a.icon}</i><span>${a.name}</span></button>`).join('')}</div>`;
  }

  private minutesLeft(ac: Aircraft) {
    const arr = this.ctx.arr();
    return arr ? distance(ac, arr) / NM / Math.max(120, ac.gs / KT) * 60 : 0;
  }

  private page(ac: Aircraft): string {
    const d = ac.def, dep = this.ctx.dep(), arr = this.ctx.arr(), f = this.ctx.fcs();
    const row = (k: string, v: string) => `<tr><td>${k}</td><td>${v}</td></tr>`;
    const gw = d.m.e + ac.fuel + ac.payload;
    const distNm = dep && arr ? distance(dep, arr) / NM : 0;
    const remNm = arr ? distance(ac, arr) / NM : 0;
    const gsKt = Math.max(ac.gs / KT, d.v.cruise * 0.9);
    switch (this.app) {
      case 'ofp': {
        const ete = distNm / Math.max(60, d.v.cruise * 0.9);
        const burnKgH = d.m.fuel / Math.max(2, (d.cat === 'widebody' ? 14 : d.cat === 'airliner' ? 6 : 4.5));
        const need = Math.round((ete + 0.75) * burnKgH);
        const pax = this.ctx.pax();
        const wps = f.plan.wps;
        return `<div class="efb-card"><h4>${this.ctx.callsign()} · ${dep?.icao ?? '—'} → ${arr?.icao ?? '—'}</h4><table class="spec-t">
          ${row('기종', `${d.mfr} ${d.name}`)}${row('거리', `${Math.round(distNm)} NM (남은 ${Math.round(remNm)} NM)`)}
          ${row('예상 비행시간', `${Math.floor(ete)}시간 ${Math.round((ete % 1) * 60)}분 · 도착 예정 ${arr ? new Date(Date.now() + remNm / gsKt * 3600e3).toTimeString().slice(0, 5) : '—'}`)}
          ${row('순항 고도', `FL${Math.round(this.ctx.cruiseFt() / 100)}`)}
          ${row('연료', `${Math.round(ac.fuel).toLocaleString()} kg 탑재 / 필요 ~${need.toLocaleString()} kg (예비 45분 포함) ${ac.fuel < need ? '<b class="warn">부족</b>' : '✓'}`)}
          ${row('총중량', `${Math.round(gw).toLocaleString()} kg / MTOW ${d.m.mtow.toLocaleString()} ${gw > d.m.mtow ? '<b class="warn">초과</b>' : '✓'}`)}
          ${pax ? row('승객', `${pax.count}명 · ${pax.boarded < pax.count ? `탑승 ${Math.floor(pax.boarded)}명` : pax.label}`) : ''}</table></div>
          <div class="efb-card"><h4>항로</h4><table class="spec-t efb-legs"><tr><td>경유지</td><td>고도 제한</td><td>구간</td></tr>
          ${wps.map((w, i) => `<tr class="${i === f.plan.active ? 'act' : i < f.plan.active ? 'past' : ''}"><td>${w.ident}</td><td>${w.alt ? w.alt.toLocaleString() + ' ft' : '—'}</td><td>${i ? Math.round(distance(wps[i - 1], w) / NM) + ' NM' : ''}</td></tr>`).join('')}</table></div>`;
      }
      case 'perf': {
        const k = Math.sqrt(Math.min(1.1, gw / d.m.mtow));
        const vr = Math.round(d.v.vr * k), v2 = Math.round((d.v.v2 ?? d.v.vr + 8) * k), v1 = Math.round(vr - Math.max(2, vr * 0.04));  // V1 never above VR
        const vref = Math.round(d.v.vref * Math.sqrt(Math.min(1.05, gw / d.m.mlw)));
        const todr = Math.round((d.cat === 'widebody' ? 2900 : d.cat === 'airliner' ? 2000 : d.cat === 'regional' ? 1500 : d.cat === 'bizjet' ? 1300 : 650) * (gw / d.m.mtow) ** 1.4);
        const ldr = Math.round((d.cat === 'widebody' ? 2000 : d.cat === 'airliner' ? 1500 : d.cat === 'regional' ? 1200 : 600) * (gw / d.m.mlw));
        const toda = this.ctx.runwayLen(dep, false), lda = this.ctx.runwayLen(arr, true);
        const bar = (need: number, have: number) => have ? `<div class="efb-bar"><i style="width:${Math.min(100, need / have * 100)}%;background:${need > have ? '#e74c3c' : need > have * 0.8 ? '#f39c12' : '#2ecc71'}"></i></div>` : '';
        return `<div class="efb-card"><h4>이륙 — ${dep?.icao ?? ''}</h4><div class="efb-vs"><div><span>V1</span><b>${v1}</b></div><div><span>VR</span><b>${vr}</b></div><div><span>V2</span><b>${v2}</b></div></div>
          <table class="spec-t">${row('필요 / 가용 활주거리', `${todr.toLocaleString()} m / ${toda ? Math.round(toda).toLocaleString() : '—'} m ${toda && todr > toda ? '<b class="warn">부족</b>' : '✓'}`)}
          ${row('플랩', d.flaps === 'airbus' ? 'CONF 1+F' : d.flaps === 'boeing' || d.flaps === 'boeing747' ? 'FLAPS 5' : d.flaps === 'ga' ? '10°' : '이륙 위치')}</table>${bar(todr, toda)}</div>
          <div class="efb-card"><h4>착륙 — ${arr?.icao ?? ''}</h4><div class="efb-vs"><div><span>VREF</span><b>${vref}</b></div><div><span>VAPP</span><b>${vref + 5}</b></div><div><span>A/BRK</span><b>${ldr > lda * 0.7 ? 'MED' : 'LO'}</b></div></div>
          <table class="spec-t">${row('필요 / 가용 착륙거리', `${ldr.toLocaleString()} m / ${lda ? Math.round(lda).toLocaleString() : '—'} m ${lda && ldr > lda ? '<b class="warn">부족</b>' : '✓'}`)}</table>${bar(ldr, lda)}
          <p class="note">현재 중량 ${Math.round(gw).toLocaleString()} kg 기준 (간이 성능표). 젖은 활주로는 착륙거리 +15%.</p></div>`;
      }
      case 'map':
        return `<canvas id="efbMap" width="600" height="440"></canvas><div class="efb-seg"><button id="efbZo">－</button><span>${this.mapZoom} NM</span><button id="efbZi">＋</button></div>`;
      case 'chart': {
        const a = this.chartFor === 'dep' ? dep : arr;
        return `<div class="efb-seg"><button data-chart="dep" class="${this.chartFor === 'dep' ? 'on' : ''}">출발 ${dep?.icao ?? ''}</button><button data-chart="arr" class="${this.chartFor === 'arr' ? 'on' : ''}">도착 ${arr?.icao ?? ''}</button></div>
          <canvas id="efbChart" width="600" height="440"></canvas><p class="note">${a ? `${a.name} — 활주로 · 유도로 · 주기장 (OpenStreetMap)` : ''}</p>`;
      }
      case 'wx':
        setTimeout(() => {
          for (const [id, apt] of [['efbWxDep', dep], ['efbWxArr', arr]] as const) {
            const el = this.body.querySelector<HTMLElement>('#' + id);
            if (!el || !apt) continue;
            liveWeatherCached(apt.lat, apt.lon).then(lw => { el.textContent = reportLine(lw.report); }).catch(() => { el.textContent = '실시간 기상을 받을 수 없음'; });
          }
        });
        return `<div class="efb-card"><h4>출발 ${dep?.icao ?? ''}</h4><div class="wx-line" id="efbWxDep">${dep ? '받는 중…' : '—'}</div></div>
          <div class="efb-card"><h4>도착 ${arr?.icao ?? ''}</h4><div class="wx-line" id="efbWxArr">${arr ? '받는 중…' : '—'}</div></div>`;
      case 'ground': {
        const eq = this.ctx.equipment(), pax = this.ctx.pax(), parked = ac.onGround && ac.gs / KT < 1;
        return `<div class="efb-card"><h4>지상 서비스 ${parked ? '' : '<span class="dim">(정지 상태에서만)</span>'}</h4>
          <div class="efb-grid">
            <button data-eq="jetway" class="${eq === 'jetway' ? 'on' : ''}" ${parked ? '' : 'disabled'}>🛬 탑승교 ${eq === 'jetway' ? '분리' : '연결'}</button>
            <button data-eq="stairs" class="${eq === 'stairs' ? 'on' : ''}" ${parked ? '' : 'disabled'}>🪜 계단차 ${eq === 'stairs' ? '분리' : '연결'}</button>
            <button id="efbPush" ${parked ? '' : 'disabled'}>🚜 푸시백</button>
            <button id="efbFuel" ${parked ? '' : 'disabled'}>⛽ 계획 연료로 급유</button>
          </div>
          <table class="spec-t">${pax ? `<tr><td>탑승</td><td>${Math.floor(pax.boarded)} / ${pax.count}명</td></tr>` : ''}
          <tr><td>연료</td><td>${Math.round(ac.fuel).toLocaleString()} kg</td></tr><tr><td>파킹 브레이크</td><td>${ac.parkingBrake ? 'SET' : '해제'}</td></tr></table>
          <p class="note">탑승교·계단차가 연결된 채로 푸시백하면 자동으로 분리됩니다.</p></div>`;
      }
      case 'cabin': {
        const pax = this.ctx.pax();
        if (!pax) return '<div class="efb-card"><p class="note">이 비행에는 승객이 없습니다.</p></div>';
        const belt = this.ctx.seatbelt(), left = this.minutesLeft(ac);
        const sv = pax.service;
        const svBtn = (k: ServiceKind, icon: string) => {
          const done = pax.served.has(k), running = sv?.kind === k;
          return `<button data-svc="${k}" class="${done ? 'done' : running ? 'on' : ''}" ${done || (sv && !running) ? 'disabled' : ''}>${icon} ${SERVICES[k].name}${done ? ' ✓' : running ? ` ${Math.round(sv!.done * 100)}%` : ''}<small>${SERVICES[k].min}분 · 만족도 +${SERVICES[k].bonus}</small></button>`;
        };
        return `<div class="efb-card efb-cabin-head"><div class="efb-gauge" style="--v:${pax.comfort}"><b>${Math.round(pax.comfort)}</b><span>만족도</span></div>
            <div><b>${pax.count}명</b> 탑승<br><span class="dim">${pax.label} · 남은 비행 약 ${Math.round(left)}분</span></div></div>
          <div class="efb-card"><h4>객실 서비스</h4><div class="efb-grid">
            ${svBtn('drinks', '🥤')}${svBtn('snack', '🥨')}${svBtn('meal', '🍱')}${svBtn('dutyfree', '🛍️')}</div>
            <p class="note">10,000 ft 이상 · 좌석벨트 표시등 OFF에서만. 서비스 중 난기류가 오면 음료가 쏟아집니다.</p></div>
          <div class="efb-card"><h4>객실 관리</h4><div class="efb-grid">
            <button id="efbBelt" class="${belt ? 'on' : ''}">💺 좌석벨트 표시등 ${belt ? 'ON' : 'OFF'}</button>
            <button id="efbDim" class="${pax.cabinDim ? 'on' : ''}">💡 객실 조명 ${pax.cabinDim ? '어둡게' : '밝게'}</button>
            <button id="efbIfe" class="${pax.ife ? 'on' : ''}">🎬 기내 엔터테인먼트 ${pax.ife ? 'ON' : 'OFF'}</button>
            <button data-pa="welcome">📢 환영 방송</button><button data-pa="cruise">📢 순항 안내</button><button data-pa="descent">📢 강하 안내</button></div></div>
          ${pax.notes.length ? `<div class="efb-card"><h4>승객 반응</h4>${pax.notes.slice(-5).map(n => `<div class="efb-note">${n}</div>`).join('')}</div>` : ''}`;
      }
      case 'opt':
        return `<div class="efb-card"><label class="efb-opt"><input type="checkbox" id="efbGuide" ${this.ctx.guide() ? 'checked' : ''}> 항로 안내선 표시 (하늘: 비행 경로·ILS 최종접근 / 지상: 택시 경로)</label>
          <div class="efb-opt">그래픽 품질 <select id="efbQ">${(['low', 'medium', 'high', 'ultra'] as const).map(q => `<option value="${q}" ${this.ctx.graphics().quality === q ? 'selected' : ''}>${({ low: '낮음', medium: '중간', high: '높음', ultra: '울트라' })[q]}</option>`).join('')}</select>
            <label><input type="checkbox" id="efbSh" ${this.ctx.graphics().shadows ? 'checked' : ''}> 그림자</label>
            <label><input type="checkbox" id="efbLook" ${this.ctx.graphics().look ? 'checked' : ''}> 향상된 화질</label></div>
          <label class="efb-opt"><input type="checkbox" id="efbScen" ${this.ctx.scenery() ? 'checked' : ''}> 공항 시설 표시 (터미널·격납고·관제탑·탑승교·유도로·도로·나무)</label></div>`;
      default: return '';
    }
  }

  private bind(ac: Aircraft) {
    const q = (s: string) => this.body.querySelector<HTMLElement>(s);
    this.body.querySelectorAll<HTMLButtonElement>('[data-eq]').forEach(b => b.onclick = () => {
      const k = b.dataset.eq as Equipment;
      this.ctx.setEquipment(this.ctx.equipment() === k ? 'none' : k);
      setTimeout(() => this.render(), 300);
    });
    q('#efbPush')?.addEventListener('click', () => this.ctx.pushback());
    q('#efbFuel')?.addEventListener('click', () => {
      const dep = this.ctx.dep(), arr = this.ctx.arr(), d = ac.def;
      const ete = dep && arr ? distance(dep, arr) / NM / Math.max(60, d.v.cruise * 0.9) : 1;
      this.ctx.refuel(Math.min(d.m.fuel, (ete + 0.75) * d.m.fuel / Math.max(2, d.cat === 'widebody' ? 14 : d.cat === 'airliner' ? 6 : 4.5)));
      this.render();
    });
    q('#efbZi')?.addEventListener('click', () => { this.mapZoom = Math.max(5, this.mapZoom / 2); this.render(); });
    q('#efbZo')?.addEventListener('click', () => { this.mapZoom = Math.min(1280, this.mapZoom * 2); this.render(); });
    this.body.querySelectorAll<HTMLButtonElement>('[data-chart]').forEach(b => b.onclick = () => { this.chartFor = b.dataset.chart as 'dep' | 'arr'; this.chartLayout = null; this.render(); });
    // cabin
    const pax = this.ctx.pax();
    this.body.querySelectorAll<HTMLButtonElement>('[data-svc]').forEach(b => b.onclick = () => {
      if (!pax) return;
      const why = pax.startService(b.dataset.svc as ServiceKind, ac.alt / FT, this.minutesLeft(ac));
      if (why) this.ctx.say(why);
      this.render();
    });
    this.body.querySelectorAll<HTMLButtonElement>('[data-pa]').forEach(b => b.onclick = () => { pax?.announceCabin(b.dataset.pa as 'welcome'); this.render(); });
    q('#efbBelt')?.addEventListener('click', () => { this.ctx.setSeatbelt(!this.ctx.seatbelt()); this.render(); });
    q('#efbDim')?.addEventListener('click', () => { if (pax) pax.cabinDim = !pax.cabinDim; this.render(); });
    q('#efbIfe')?.addEventListener('click', () => { if (pax) pax.ife = !pax.ife; this.render(); });
    // settings
    const g = q('#efbGuide') as HTMLInputElement | null;
    if (g) g.onchange = () => this.ctx.setGuide(g.checked);
    const gq = q('#efbQ') as HTMLSelectElement | null, gs = q('#efbSh') as HTMLInputElement | null, gl = q('#efbLook') as HTMLInputElement | null;
    if (gq && gs && gl) gq.onchange = gs.onchange = gl.onchange = () => this.ctx.setGraphics(gq.value as 'low', gs.checked, gl.checked);
    const sc = q('#efbScen') as HTMLInputElement | null;
    if (sc) sc.onchange = () => this.ctx.setScenery(sc.checked);
  }

  /** Track-up-optional, north-up moving map: route, nearby airports with their runways, the aircraft, range rings. */
  private drawMap() {
    const cv = this.body.querySelector<HTMLCanvasElement>('#efbMap'), ac = this.ctx.ac();
    if (!cv || !ac) return;
    const g = cv.getContext('2d')!, W = cv.width, H = cv.height, s = W / (this.mapZoom * NM);
    const xy = (p: { lat: number; lon: number }) => {
      const d = distance(ac, p), b = bearing(ac, p) * Math.PI / 180;
      return [W / 2 + Math.sin(b) * d * s, H / 2 - Math.cos(b) * d * s];
    };
    const grd = g.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, '#0d1b2a'); grd.addColorStop(1, '#08121c');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#1d3046'; g.lineWidth = 1; g.fillStyle = '#4f6b85'; g.font = '10px Inter, sans-serif';
    for (let r = 1; r <= 3; r++) { g.beginPath(); g.arc(W / 2, H / 2, (r * W) / 6, 0, Math.PI * 2); g.stroke(); g.fillText(`${Math.round(this.mapZoom * r / 6)}`, W / 2 + 4, H / 2 - (r * W) / 6 + 12); }
    // nearby airports, with runways when zoomed in
    for (const apt of this.ctx.nearby(ac.lat, ac.lon, this.mapZoom * NM * 0.75)) {
      const [x, y] = xy(apt);
      if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
      if (this.mapZoom <= 40) {
        g.strokeStyle = '#c8d6e5'; g.lineWidth = Math.max(2, 45 * s);
        for (const rw of apt.runways) { const [a, b] = xy(rw.le), [c, d2] = xy(rw.he); g.beginPath(); g.moveTo(a, b); g.lineTo(c, d2); g.stroke(); }
      }
      g.fillStyle = apt.size === 3 ? '#4fc3f7' : '#7f8fa6';
      g.beginPath(); g.arc(x, y, apt.size === 3 ? 4 : 3, 0, Math.PI * 2); g.fill();
      if (apt.size >= 2 || this.mapZoom <= 20) { g.fillStyle = '#9fb3c8'; g.fillText(apt.icao, x + 6, y + 4); }
    }
    const f = this.ctx.fcs(), wps = f.plan.wps;
    g.strokeStyle = '#e45bf2'; g.lineWidth = 3; g.beginPath();
    wps.forEach((w, i) => { const [x, y] = xy(w); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.stroke();
    g.font = 'bold 12px Inter, sans-serif';
    wps.forEach((w, i) => { const [x, y] = xy(w); g.fillStyle = i === f.plan.active ? '#e45bf2' : '#fff'; g.beginPath(); g.moveTo(x, y - 6); g.lineTo(x + 5, y); g.lineTo(x, y + 6); g.lineTo(x - 5, y); g.closePath(); g.fill(); g.fillText(w.ident, x + 8, y - 6); });
    // track line ahead (2 min)
    const trk = ac.track * DEG, ahead = ac.gs * 120 * s;
    g.strokeStyle = '#2ecc71'; g.setLineDash([6, 6]); g.lineWidth = 2; g.beginPath(); g.moveTo(W / 2, H / 2); g.lineTo(W / 2 + Math.sin(trk) * ahead, H / 2 - Math.cos(trk) * ahead); g.stroke(); g.setLineDash([]);
    g.save(); g.translate(W / 2, H / 2); g.rotate(ac.psi);
    g.fillStyle = '#ffd23f'; g.strokeStyle = '#000'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, -13); g.lineTo(3, -4); g.lineTo(12, 2); g.lineTo(12, 5); g.lineTo(3, 2); g.lineTo(2, 9); g.lineTo(5, 12); g.lineTo(-5, 12); g.lineTo(-2, 9); g.lineTo(-3, 2); g.lineTo(-12, 5); g.lineTo(-12, 2); g.lineTo(-3, -4); g.closePath(); g.fill(); g.stroke();
    g.restore();
    g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, H - 26, W, 26);
    g.fillStyle = '#e6edf3'; g.font = '12px "B612 Mono", monospace';
    g.fillText(`GS ${Math.round(ac.gs / KT)}kt  ALT ${Math.round(ac.alt / FT).toLocaleString()}ft  TRK ${Math.round(((ac.track) + 360) % 360)}°  ${f.plan.to ? `→ ${f.plan.to.ident} ${Math.round(distance(ac, f.plan.to) / NM)}NM` : ''}`, 10, H - 9);
  }

  /** Airport diagram from the real layout (runways from the database, taxiways and stands from OpenStreetMap). */
  private loadChart() {
    const apt = this.chartFor === 'dep' ? this.ctx.dep() : this.ctx.arr();
    if (!apt) return;
    if (this.chartLayout?.icao === apt.icao) { this.drawChart(); return; }
    this.chartLayout = { icao: apt.icao, layout: null };
    this.drawChart();
    this.ctx.layout(apt).then(l => { if (this.chartLayout?.icao === apt.icao) { this.chartLayout.layout = l; this.drawChart(); } }).catch(() => {});
  }
  private drawChart() {
    const cv = this.body.querySelector<HTMLCanvasElement>('#efbChart'), ac = this.ctx.ac();
    const apt = this.chartFor === 'dep' ? this.ctx.dep() : this.ctx.arr();
    if (!cv || !apt) return;
    const g = cv.getContext('2d')!, W = cv.width, H = cv.height;
    g.fillStyle = '#f4f1e8'; g.fillRect(0, 0, W, H);
    // scale to the runways' extent
    const k = Math.cos(apt.lat * DEG);
    const pts = apt.runways.flatMap(r => [r.le, r.he]);
    const L = this.chartLayout?.layout;
    if (L) for (const s of L.stands) pts.push({ ...s, ident: '', elev: 0, disp: 0, hdg: 0 });
    const xs = pts.map(p => (p.lon - apt.lon) * k * DEG * R_EARTH), ys = pts.map(p => (p.lat - apt.lat) * DEG * R_EARTH);
    const span = Math.max(1200, Math.max(...xs) - Math.min(...xs), (Math.max(...ys) - Math.min(...ys)) * W / H) * 1.15;
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2, s = W / span;
    const P = (p: { lat: number; lon: number }) => [W / 2 + ((p.lon - apt.lon) * k * DEG * R_EARTH - cx) * s, H / 2 - ((p.lat - apt.lat) * DEG * R_EARTH - cy) * s];
    if (L) {
      g.strokeStyle = '#d9c98f'; g.lineCap = 'round';
      for (const t of L.taxiways) {
        g.lineWidth = Math.max(2, 20 * s); g.beginPath(); t.pts.forEach((p, i) => { const [x, y] = P(p); if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke();
      }
      g.fillStyle = '#6b5d2f'; g.font = 'bold 10px Inter, sans-serif';
      const seen = new Set<string>();
      for (const t of L.taxiways) { if (!t.ref || seen.has(t.ref)) continue; seen.add(t.ref); const m = t.pts[Math.floor(t.pts.length / 2)]; const [x, y] = P(m); g.fillText(t.ref, x + 3, y - 3); }
    }
    for (const r of apt.runways) {
      const [a, b] = P(r.le), [c, d] = P(r.he);
      g.strokeStyle = '#2b2b2b'; g.lineWidth = Math.max(4, r.width * s); g.lineCap = 'butt';
      g.beginPath(); g.moveTo(a, b); g.lineTo(c, d); g.stroke();
      g.fillStyle = '#c0392b'; g.font = 'bold 12px Inter, sans-serif';
      g.fillText(r.le.ident, a - 10, b + 14); g.fillText(r.he.ident, c - 10, d + 14);
    }
    if (L) {
      g.fillStyle = '#1f6fd1'; g.font = '9px Inter, sans-serif';
      for (const st of L.stands) { const [x, y] = P(st); g.beginPath(); g.arc(x, y, 2.5, 0, Math.PI * 2); g.fill(); if (s > 0.12) g.fillText(st.ref, x + 3, y + 3); }
    } else { g.fillStyle = '#555'; g.font = '12px Inter, sans-serif'; g.fillText('유도로 · 주기장 정보를 받는 중…', 12, 20); }
    if (ac && distance(ac, apt) < 8000) {
      const [x, y] = P(ac);
      g.save(); g.translate(x, y); g.rotate(ac.psi); g.fillStyle = '#e67e22'; g.beginPath(); g.moveTo(0, -9); g.lineTo(6, 7); g.lineTo(0, 4); g.lineTo(-6, 7); g.closePath(); g.fill(); g.restore();
    }
    g.fillStyle = '#333'; g.font = 'bold 13px Inter, sans-serif'; g.fillText(`${apt.icao} ${apt.iata ? '/ ' + apt.iata : ''} — ${apt.name}`, 10, H - 10);
    // north arrow
    g.beginPath(); g.moveTo(W - 20, 14); g.lineTo(W - 26, 30); g.lineTo(W - 14, 30); g.closePath(); g.fill(); g.fillText('N', W - 24, 44);
    void RAD;
  }
}
