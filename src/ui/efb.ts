// EFB (electronic flight bag): the pilot's tablet — flight plan and weights, takeoff/landing performance,
// a moving map, live weather, ground services at the stand, and options (route guidance line).
import type { Aircraft } from '../sim/fdm.ts';
import type { FCS } from '../sim/fcs.ts';
import type { Airport } from '../world/airports.ts';
import { distance, bearing } from '../core/geo.ts';
import { FT, KT, NM, RAD } from '../core/math.ts';
import { liveWeatherCached, reportLine } from '../sim/liveWeather.ts';
import type { Equipment } from '../world/groundServices.ts';

export interface EfbCtx {
  ac: () => Aircraft | null; fcs: () => FCS; dep: () => Airport | undefined; arr: () => Airport | undefined;
  callsign: () => string; pax: () => { count: number; boarded: number; label: string } | null;
  equipment: () => Equipment; setEquipment: (k: Equipment) => void; pushback: () => void; refuel: (kg: number) => void;
  guide: () => boolean; setGuide: (on: boolean) => void; cruiseFt: () => number; runwayLen: (apt: Airport | undefined, arr: boolean) => number;
}

type Tab = 'ofp' | 'perf' | 'map' | 'wx' | 'ground' | 'opt';
const TABS: [Tab, string][] = [['ofp', '비행'], ['perf', '성능'], ['map', '지도'], ['wx', '날씨'], ['ground', '지상'], ['opt', '설정']];

export class Efb {
  tab: Tab = 'ofp';
  private body: HTMLElement;
  private t = 0;
  private mapZoom = 40; // NM across

  constructor(private win: HTMLElement, private ctx: EfbCtx) {
    this.body = win.querySelector('.win-body')!;
  }
  get open() { return !this.win.classList.contains('hidden'); }
  toggle() { this.win.classList.toggle('hidden'); this.render(); }

  /** Live pages (map, ground) refresh while open. */
  tick(dt: number) {
    if (!this.open) return;
    this.t -= dt;
    if (this.t > 0) return;
    this.t = this.tab === 'map' ? 0.25 : 1;
    if (this.tab === 'map') this.drawMap(); else if (this.tab !== 'wx' && this.tab !== 'opt') this.render();
  }

  render() {
    const ac = this.ctx.ac();
    if (!ac) return;
    const tabs = `<div class="efb-tabs">${TABS.map(([k, l]) => `<button data-efb="${k}" class="${k === this.tab ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    this.body.innerHTML = tabs + `<div class="efb-page">${this.page(ac)}</div>`;
    this.body.querySelectorAll<HTMLButtonElement>('[data-efb]').forEach(b => b.onclick = () => { this.tab = b.dataset.efb as Tab; this.t = 0; this.render(); });
    this.bind(ac);
    if (this.tab === 'map') this.drawMap();
  }

  private page(ac: Aircraft): string {
    const d = ac.def, dep = this.ctx.dep(), arr = this.ctx.arr(), f = this.ctx.fcs();
    const row = (k: string, v: string) => `<tr><td>${k}</td><td>${v}</td></tr>`;
    const gw = d.m.e + ac.fuel + ac.payload;
    const distNm = dep && arr ? distance(dep, arr) / NM : 0;
    const remNm = arr ? distance(ac, arr) / NM : 0;
    const gsKt = Math.max(ac.gs / KT, d.v.cruise * 0.9);
    switch (this.tab) {
      case 'ofp': {
        const ete = distNm / Math.max(60, d.v.cruise * 0.9);
        const burnKgH = d.m.fuel / Math.max(2, (d.cat === 'widebody' ? 14 : d.cat === 'airliner' ? 6 : 4.5));
        const need = Math.round((ete + 0.75) * burnKgH);
        const pax = this.ctx.pax();
        return `<h4>${this.ctx.callsign()} · ${dep?.icao ?? '—'} → ${arr?.icao ?? '—'}</h4><table class="spec-t">
          ${row('기종', `${d.mfr} ${d.name}`)}${row('거리', `${Math.round(distNm)} NM (남은 ${Math.round(remNm)} NM)`)}
          ${row('예상 비행시간', `${Math.floor(ete)}시간 ${Math.round((ete % 1) * 60)}분 · 도착 예정 ${arr ? new Date(Date.now() + remNm / gsKt * 3600e3).toTimeString().slice(0, 5) : '—'}`)}
          ${row('순항 고도', `FL${Math.round(this.ctx.cruiseFt() / 100)}`)}
          ${row('연료', `${Math.round(ac.fuel).toLocaleString()} kg 탑재 / 필요 ~${need.toLocaleString()} kg (예비 45분 포함) ${ac.fuel < need ? '<b class="warn">부족</b>' : '✓'}`)}
          ${row('총중량', `${Math.round(gw).toLocaleString()} kg / MTOW ${d.m.mtow.toLocaleString()} ${gw > d.m.mtow ? '<b class="warn">초과</b>' : '✓'}`)}
          ${pax ? row('승객', `${pax.count}명 · ${pax.boarded < pax.count ? `탑승 ${Math.floor(pax.boarded)}명` : pax.label}`) : ''}
          ${row('경로', f.plan.wps.map(w => w.ident).join(' → ') || '—')}</table>`;
      }
      case 'perf': {
        const k = Math.sqrt(Math.min(1.1, gw / d.m.mtow));
        const vr = Math.round(d.v.vr * k), v2 = Math.round((d.v.v2 ?? d.v.vr + 8) * k), v1 = Math.round(vr - Math.max(2, vr * 0.04));  // V1 never above VR
        const vref = Math.round(d.v.vref * Math.sqrt(Math.min(1.05, gw / d.m.mlw)));
        const todr = Math.round((d.cat === 'widebody' ? 2900 : d.cat === 'airliner' ? 2000 : d.cat === 'regional' ? 1500 : d.cat === 'bizjet' ? 1300 : 650) * (gw / d.m.mtow) ** 1.4);
        const ldr = Math.round((d.cat === 'widebody' ? 2000 : d.cat === 'airliner' ? 1500 : d.cat === 'regional' ? 1200 : 600) * (gw / d.m.mlw));
        const toda = this.ctx.runwayLen(dep, false), lda = this.ctx.runwayLen(arr, true);
        return `<h4>이륙</h4><table class="spec-t">${row('V1 / VR / V2', `${v1} / ${vr} / ${v2} kt`)}${row('필요 활주거리', `${todr.toLocaleString()} m / 가용 ${toda ? Math.round(toda).toLocaleString() : '—'} m ${toda && todr > toda ? '<b class="warn">부족</b>' : '✓'}`)}
          ${row('플랩', d.flaps === 'airbus' ? 'CONF 1+F' : d.flaps === 'boeing' || d.flaps === 'boeing747' ? 'FLAPS 5' : d.flaps === 'ga' ? '10°' : '이륙 위치')}</table>
          <h4>착륙</h4><table class="spec-t">${row('VREF / VAPP', `${vref} / ${vref + 5} kt`)}${row('필요 착륙거리', `${ldr.toLocaleString()} m / 가용 ${lda ? Math.round(lda).toLocaleString() : '—'} m ${lda && ldr > lda ? '<b class="warn">부족</b>' : '✓'}`)}
          ${row('오토브레이크', ldr > lda * 0.7 ? 'MED' : 'LOW')}</table>
          <p class="note">현재 중량 ${Math.round(gw).toLocaleString()} kg 기준 계산 (간이 성능표).</p>`;
      }
      case 'map':
        return `<canvas id="efbMap" width="520" height="420"></canvas><div class="frow"><button id="efbZo">－ 넓게</button><button id="efbZi">＋ 좁게</button></div>`;
      case 'wx':
        setTimeout(() => {
          for (const [id, apt] of [['efbWxDep', dep], ['efbWxArr', arr]] as const) {
            const el = this.body.querySelector<HTMLElement>('#' + id);
            if (!el || !apt) continue;
            liveWeatherCached(apt.lat, apt.lon).then(lw => { el.textContent = `${apt.icao}: ${reportLine(lw.report)}`; }).catch(() => { el.textContent = `${apt.icao}: 실시간 기상을 받을 수 없음`; });
          }
        });
        return `<h4>출발</h4><div class="wx-line" id="efbWxDep">${dep ? '받는 중…' : '—'}</div><h4>도착</h4><div class="wx-line" id="efbWxArr">${arr ? '받는 중…' : '—'}</div>`;
      case 'ground': {
        const eq = this.ctx.equipment(), pax = this.ctx.pax(), parked = ac.onGround && ac.gs / KT < 1;
        return `<h4>지상 서비스 ${parked ? '' : '<span class="dim">(정지 상태에서만)</span>'}</h4>
          <div class="efb-grid">
            <button data-eq="jetway" class="${eq === 'jetway' ? 'on' : ''}" ${parked ? '' : 'disabled'}>🛬 탑승교 ${eq === 'jetway' ? '분리' : '연결'}</button>
            <button data-eq="stairs" class="${eq === 'stairs' ? 'on' : ''}" ${parked ? '' : 'disabled'}>🪜 계단차 ${eq === 'stairs' ? '분리' : '연결'}</button>
            <button id="efbPush" ${parked ? '' : 'disabled'}>🚜 푸시백</button>
            <button id="efbFuel" ${parked ? '' : 'disabled'}>⛽ 계획 연료로 급유</button>
          </div>
          <table class="spec-t">${pax ? `<tr><td>탑승</td><td>${Math.floor(pax.boarded)} / ${pax.count}명</td></tr>` : ''}
          <tr><td>연료</td><td>${Math.round(ac.fuel).toLocaleString()} kg</td></tr><tr><td>파킹 브레이크</td><td>${ac.parkingBrake ? 'SET' : '해제'}</td></tr></table>
          <p class="note">탑승교·계단차가 연결된 채로 푸시백하면 자동으로 분리됩니다.</p>`;
      }
      case 'opt':
        return `<label class="efb-opt"><input type="checkbox" id="efbGuide" ${this.ctx.guide() ? 'checked' : ''}> 항로 안내선 표시 (하늘: 비행 경로·ILS 최종접근 / 지상: 택시 경로)</label>`;
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
    q('#efbZi')?.addEventListener('click', () => { this.mapZoom = Math.max(5, this.mapZoom / 2); this.drawMap(); });
    q('#efbZo')?.addEventListener('click', () => { this.mapZoom = Math.min(1280, this.mapZoom * 2); this.drawMap(); });
    const g = q('#efbGuide') as HTMLInputElement | null;
    if (g) g.onchange = () => this.ctx.setGuide(g.checked);
  }

  /** North-up moving map: route, airports, the aircraft and its track. */
  private drawMap() {
    const cv = this.body.querySelector<HTMLCanvasElement>('#efbMap'), ac = this.ctx.ac();
    if (!cv || !ac) return;
    const g = cv.getContext('2d')!, W = cv.width, H = cv.height, s = W / (this.mapZoom * NM);
    const xy = (p: { lat: number; lon: number }) => {
      const d = distance(ac, p), b = bearing(ac, p) * Math.PI / 180;
      return [W / 2 + Math.sin(b) * d * s, H / 2 - Math.cos(b) * d * s];
    };
    g.fillStyle = '#0b1622'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#1d3046'; g.lineWidth = 1;
    for (let r = 1; r <= 3; r++) { g.beginPath(); g.arc(W / 2, H / 2, (r * W) / 6, 0, Math.PI * 2); g.stroke(); }
    const wps = this.ctx.fcs().plan.wps;
    g.strokeStyle = '#e45bf2'; g.lineWidth = 2.5; g.beginPath();
    wps.forEach((w, i) => { const [x, y] = xy(w); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.stroke();
    g.font = '12px Inter, sans-serif'; g.fillStyle = '#fff';
    for (const w of wps) { const [x, y] = xy(w); g.fillRect(x - 3, y - 3, 6, 6); g.fillText(w.ident, x + 6, y - 6); }
    // aircraft
    g.save(); g.translate(W / 2, H / 2); g.rotate(ac.psi);
    g.fillStyle = '#ffd23f'; g.beginPath(); g.moveTo(0, -11); g.lineTo(7, 8); g.lineTo(0, 4); g.lineTo(-7, 8); g.closePath(); g.fill();
    g.restore();
    g.fillStyle = '#9fb3c8'; g.font = '11px Inter, sans-serif';
    g.fillText(`${this.mapZoom} NM · GS ${Math.round(ac.gs / KT)} kt · ${Math.round(ac.alt / FT).toLocaleString()} ft · HDG ${Math.round(((ac.psi * RAD) + 360) % 360)}°`, 8, H - 8);
  }
}
