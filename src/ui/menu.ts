// Main menu: aircraft selection, flight planner (departure / arrival / route / start position),
// conditions (time, weather), scenery & control settings.
import { AIRCRAFT, CATEGORY_LABEL, getAircraft } from '../sim/aircraftDb.ts';
import { WEATHER_PRESETS } from '../sim/atmosphere.ts';
import { runwayEnds, type AirportDB, type Airport } from '../world/airports.ts';
import { Controls, type AxisBind } from '../input/controls.ts';
import type { ImagerySource } from '../world/scene.ts';
import { KEY_HELP } from './help.ts';

export interface FlightConfig {
  aircraftId: string;
  dep: string; depRwy: string; start: 'runway' | 'cold' | 'final' | 'cruise' | 'air';
  arr: string; arrRwy: string; route: string; cruiseFt: number;
  fuelPct: number; payloadPct: number;
  time: 'now' | 'dawn' | 'morning' | 'afternoon' | 'dusk' | 'night';
  weather: string; windDir: number | null; windSpd: number | null; visibility: number | null;
}
export interface Settings {
  imagery: ImagerySource; googleKey: string; ionToken: string; photoreal: boolean;
  quality: 'low' | 'medium' | 'high'; shadows: boolean; volume: number; autoMixture: boolean;
}

const DEF_CFG: FlightConfig = {
  aircraftId: 'a320neo', dep: 'RKSI', depRwy: '', start: 'runway', arr: 'RJTT', arrRwy: '', route: '',
  cruiseFt: 35000, fuelPct: 60, payloadPct: 70, time: 'now', weather: 'clear', windDir: null, windSpd: null, visibility: null,
};
const DEF_SET: Settings = { imagery: 'esri', googleKey: '', ionToken: '', photoreal: false, quality: 'medium', shadows: false, volume: 0.7, autoMixture: true };

function load<T>(k: string, d: T): T { try { const s = localStorage.getItem(k); return s ? { ...d, ...JSON.parse(s) } : { ...d }; } catch { return { ...d }; } }
function save(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } }

export class Menu {
  cfg: FlightConfig = load('sky.cfg', DEF_CFG);
  settings: Settings = load('sky.settings', DEF_SET);
  onFly: (c: FlightConfig) => void = () => {};
  onPreview: (apt: Airport) => void = () => {};
  onRoute: (pts: { lat: number; lon: number }[]) => void = () => {};
  onResume: (() => void) | null = null;
  private tab: 'plan' | 'settings' | 'help' = 'plan';

  constructor(private el: HTMLElement, private db: AirportDB, private controls: Controls) {}

  show(canResume: boolean) {
    this.el.classList.remove('hidden');
    this.render(canResume);
    const a = this.db.get(this.cfg.dep);
    if (a) this.onPreview(a);
  }
  hide() { this.el.classList.add('hidden'); }
  get visible() { return !this.el.classList.contains('hidden'); }

  private render(canResume: boolean) {
    const c = this.cfg;
    this.el.innerHTML = `
      <header>
        <h1>SKY<span>LINE</span> <span class="dim" style="font-size:11px;letter-spacing:1px">FLIGHT SIMULATOR</span></h1>
        <div class="tabs">
          <button data-tab="plan" class="${this.tab === 'plan' ? 'on' : ''}">비행 계획</button>
          <button data-tab="settings" class="${this.tab === 'settings' ? 'on' : ''}">설정</button>
          <button data-tab="help" class="${this.tab === 'help' ? 'on' : ''}">조작법</button>
        </div>
        <div><button id="menuDiag" title="렌더링 진단 정보">진단</button> ${canResume ? '<button id="resume">비행 재개 (Esc)</button>' : ''}</div>
      </header>
      <div class="m-col" id="acList"></div>
      <div class="m-mid"><div class="spec" id="acSpec"></div></div>
      <div class="m-col right" id="rightCol"></div>`;
    this.el.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b => b.onclick = () => { this.tab = b.dataset.tab as never; this.render(canResume); });
    this.el.querySelector<HTMLButtonElement>('#menuDiag')!.onclick = () => this.onDiag();
    const res = this.el.querySelector<HTMLButtonElement>('#resume');
    if (res) res.onclick = () => this.onResume?.();
    this.renderAircraftList();
    this.renderSpec();
    const right = this.el.querySelector<HTMLElement>('#rightCol')!;
    if (this.tab === 'plan') this.renderPlan(right);
    else if (this.tab === 'settings') this.renderSettings(right);
    else right.innerHTML = KEY_HELP;
    void c;
  }

  private renderAircraftList() {
    const el = this.el.querySelector<HTMLElement>('#acList')!;
    const cats = [...new Set(AIRCRAFT.map(a => a.cat))];
    el.innerHTML = `<input id="acSearch" placeholder="기종 검색 (예: 737, A350, Cessna)" style="width:100%">` +
      cats.map(cat => `<div class="ac-cat">${CATEGORY_LABEL[cat]}</div>` + AIRCRAFT.filter(a => a.cat === cat).map(a =>
        `<div class="ac-item ${a.id === this.cfg.aircraftId ? 'sel' : ''}" data-id="${a.id}" data-q="${(a.mfr + ' ' + a.name + ' ' + a.icao).toLowerCase()}"><span>${a.mfr} ${a.name}</span><small>${a.icao}</small></div>`).join('')).join('');
    el.querySelectorAll<HTMLElement>('.ac-item').forEach(it => it.onclick = () => {
      this.cfg.aircraftId = it.dataset.id!;
      const d = getAircraft(this.cfg.aircraftId);
      this.cfg.cruiseFt = Math.round(d.v.cruiseFt / 1000) * 1000;
      if (d.cat === 'glider') this.cfg.start = 'air';
      el.querySelectorAll('.ac-item').forEach(x => x.classList.toggle('sel', x === it));
      this.renderSpec();
      if (this.tab === 'plan') this.renderPlan(this.el.querySelector('#rightCol')!);
    });
    const s = el.querySelector<HTMLInputElement>('#acSearch')!;
    s.oninput = () => {
      const q = s.value.toLowerCase();
      el.querySelectorAll<HTMLElement>('.ac-item').forEach(it => it.classList.toggle('hidden', !!q && !it.dataset.q!.includes(q)));
    };
    el.querySelector('.ac-item.sel')?.scrollIntoView({ block: 'center' });
  }

  private renderSpec() {
    const a = getAircraft(this.cfg.aircraftId);
    const eng = a.eng.t === 'none' ? '무동력' : `${a.eng.n} × ${a.eng.t === 'fan' ? `터보팬 ${a.eng.p} kN` : a.eng.t === 'jet' ? `터보제트 ${a.eng.p} kN (AB ${a.eng.ab} kN)` : a.eng.t === 'prop' ? `피스톤 ${Math.round(a.eng.p * 1.341)} hp` : a.eng.t === 'tprop' ? `터보프롭 ${Math.round(a.eng.p * 1.341)} shp` : `터보샤프트 ${Math.round(a.eng.p * 1.341)} shp`}`;
    const law = a.fbw === 'airbus' ? 'FBW (Normal Law, 사이드스틱)' : a.fbw === 'boeing' ? 'FBW (C*U, 요크)' : a.fbw === 'fighter' ? 'FBW (G-command)' : a.fdm === 'rotor' ? '기계식 + SAS' : '기계식 (재래식)';
    const cockpit = { airliner: '글래스 칵핏 (PFD/ND/EICAS)', g1000: 'G1000/글래스 GA', steam: '아날로그 6-pack', fighter: 'HUD + MFD', heli: '헬기 글래스' }[a.cockpit];
    this.el.querySelector<HTMLElement>('#acSpec')!.innerHTML = `
      <h2>${a.name}</h2><div class="mfr">${a.mfr} · ${CATEGORY_LABEL[a.cat]} · ICAO ${a.icao}</div>
      <div class="spec-grid">
        <div><span>전장 / 전폭</span>${a.L.toFixed(1)} / ${a.fdm === 'rotor' ? a.rotor!.D + ' (로터)' : a.b.toFixed(1)} m</div>
        <div><span>MTOW</span>${a.m.mtow.toLocaleString()} kg</div>
        <div><span>엔진</span>${eng}</div>
        <div><span>조종계통</span>${law}</div>
        <div><span>순항</span>${a.v.cruise} KTAS @ ${a.fdm === 'rotor' ? '—' : 'FL' + Math.round(a.v.cruiseFt / 100)}</div>
        <div><span>VMO / MMO</span>${a.v.vmo} kt / M${a.v.mmo}</div>
        <div><span>${a.fdm === 'rotor' ? '실용상승한도' : 'VR / VREF'}</span>${a.fdm === 'rotor' ? a.v.ceil + ' ft' : a.v.vr + ' / ' + a.v.vref + ' kt'}</div>
        <div><span>계기</span>${cockpit}</div>
      </div>${a.note ? `<p class="note">${a.note}</p>` : ''}`;
  }

  private aptField(id: string, label: string, value: string) {
    return `<div class="field sugg"><label>${label}</label><input id="${id}" value="${value}" placeholder="ICAO / IATA / 도시" autocomplete="off"><div class="list hidden"></div><div class="apt-info" id="${id}Info"></div></div>`;
  }

  private renderPlan(el: HTMLElement) {
    const c = this.cfg;
    const a = getAircraft(c.aircraftId);
    const wx = Object.entries(WEATHER_PRESETS).map(([k, v]) => `<option value="${k}" ${k === c.weather ? 'selected' : ''}>${v.label}</option>`).join('');
    el.innerHTML = `
      <div class="sec"><h3>출발</h3>
        ${this.aptField('dep', '출발 공항', c.dep)}
        <div class="frow"><div class="field"><label>활주로</label><select id="depRwy"></select></div>
        <div class="field"><label>시작 위치</label><select id="start">
          <option value="runway">활주로 정렬 (엔진 가동)</option>
          <option value="cold">활주로 Cold & Dark</option>
          <option value="final">도착 최종접근 10NM</option>
          <option value="cruise">순항 고도</option>
          <option value="air">공중 시작 (3000ft AGL)</option>
        </select></div></div>
      </div>
      <div class="sec"><h3>도착 / 경로</h3>
        ${this.aptField('arr', '도착 공항', c.arr)}
        <div class="frow"><div class="field"><label>착륙 활주로 (ILS)</label><select id="arrRwy"></select></div>
        <div class="field"><label>순항 고도 (ft)</label><input id="cruise" type="number" step="1000" value="${c.cruiseFt}"></div></div>
        <div class="field"><label>경유지 (VOR/NDB 식별자, 공항, N37.5E127.1 형식 — 공백 구분)</label><input id="route" value="${c.route}" placeholder="예: GUKDO SEL"></div>
        <div class="apt-info" id="routeInfo"></div>
      </div>
      <div class="sec"><h3>무게 · 시간 · 기상</h3>
        <div class="frow"><div class="field"><label>연료 <b id="fuelV">${c.fuelPct}%</b></label><input id="fuel" type="range" min="5" max="100" value="${c.fuelPct}"></div>
        <div class="field"><label>탑재량 <b id="payV">${c.payloadPct}%</b></label><input id="pay" type="range" min="0" max="100" value="${c.payloadPct}"></div></div>
        <div class="apt-info" id="wtInfo"></div>
        <div class="frow"><div class="field"><label>시각 (현지)</label><select id="time">
          <option value="now">현재 (실시간)</option><option value="dawn">새벽 06:00</option><option value="morning">오전 10:00</option>
          <option value="afternoon">오후 15:00</option><option value="dusk">황혼 19:00</option><option value="night">야간 23:00</option></select></div>
        <div class="field"><label>기상 프리셋</label><select id="weather">${wx}</select></div></div>
        <div class="frow3"><div class="field"><label>풍향 °</label><input id="wdir" type="number" placeholder="프리셋" value="${c.windDir ?? ''}"></div>
        <div class="field"><label>풍속 kt</label><input id="wspd" type="number" placeholder="프리셋" value="${c.windSpd ?? ''}"></div>
        <div class="field"><label>시정 m</label><input id="vis" type="number" placeholder="프리셋" value="${c.visibility ?? ''}"></div></div>
      </div>
      <button id="fly" class="primary">▶ 비행 시작</button>
      <p class="note">${a.fdm === 'rotor' ? '헬기: PageUp/PageDown(F3/F2) = 콜렉티브, 방향키 = 사이클릭, Q/E = 페달.' : '팁: 시작 후 Ctrl+E 자동 시동, Z 오토파일럿, Shift+Z 오토스로틀.'}</p>`;
    const $ = <T extends HTMLElement>(id: string) => el.querySelector<T>('#' + id)!;
    ($('start') as HTMLSelectElement).value = c.start;
    ($('time') as HTMLSelectElement).value = c.time;
    const fillRwy = (sel: HTMLSelectElement, icao: string, cur: string) => {
      const apt = this.db.get(icao);
      sel.innerHTML = apt ? runwayEnds(apt).map(r => `<option value="${r.end.ident}" ${r.end.ident === cur ? 'selected' : ''}>${r.end.ident} — ${Math.round(r.rw.length / 0.3048).toLocaleString()} ft ${r.rw.hard ? '' : '(비포장)'}</option>`).join('') : '';
      if (apt && !runwayEnds(apt).some(r => r.end.ident === cur)) {
        const longest = runwayEnds(apt).sort((x, y) => y.rw.length - x.rw.length)[0];
        if (longest) sel.value = longest.end.ident;
      }
    };
    const info = (id: string, icao: string) => {
      const apt = this.db.get(icao);
      $(id + 'Info').textContent = apt ? `${apt.name} · ${apt.city} ${apt.country} · 표고 ${Math.round(apt.elev / 0.3048)} ft` : icao ? '공항을 찾을 수 없음' : '';
    };
    const updRoute = () => {
      const dep = this.db.get(c.dep), arr = this.db.get(c.arr);
      const pts: { lat: number; lon: number }[] = [];
      if (dep) pts.push(dep);
      const unknown: string[] = [];
      for (const tok of c.route.split(/\s+/).filter(Boolean)) {
        const w = this.db.resolve(tok, pts[pts.length - 1] ?? { lat: 0, lon: 0 });
        if (w) pts.push(w); else unknown.push(tok);
      }
      if (arr) pts.push(arr);
      let dist = 0;
      for (let i = 1; i < pts.length; i++) {
        const p1 = pts[i - 1], p2 = pts[i];
        const R = 3440.065, t = Math.PI / 180;
        const h = Math.sin((p2.lat - p1.lat) * t / 2) ** 2 + Math.cos(p1.lat * t) * Math.cos(p2.lat * t) * Math.sin((p2.lon - p1.lon) * t / 2) ** 2;
        dist += 2 * R * Math.asin(Math.sqrt(h));
      }
      $('routeInfo').innerHTML = `총 거리 ${Math.round(dist)} NM · 예상 비행 ${a.v.cruise > 0 ? (dist / (a.v.cruise * 0.9)).toFixed(1) : '—'} h${unknown.length ? ` · <span class="warn">인식 불가: ${unknown.join(' ')}</span>` : ''}`;
      this.onRoute(pts);
      const needKg = a.eng.t === 'none' ? 0 : dist / Math.max(1, a.v.cruise) * 1.25 * (a.m.fuel / Math.max(2, rangeHours(a)));
      $('wtInfo').textContent = `연료 ${Math.round(a.m.fuel * c.fuelPct / 100).toLocaleString()} kg (추정 소요 ~${Math.round(needKg).toLocaleString()} kg) · 총중량 ${Math.round(a.m.e + a.m.fuel * c.fuelPct / 100 + a.m.pay * c.payloadPct / 100).toLocaleString()} kg / MTOW ${a.m.mtow.toLocaleString()}`;
    };
    const bindApt = (id: 'dep' | 'arr', rwyId: 'depRwy' | 'arrRwy') => {
      const inp = $<HTMLInputElement>(id);
      const list = inp.parentElement!.querySelector<HTMLElement>('.list')!;
      fillRwy($(rwyId), c[id], c[rwyId]); info(id, c[id]);
      inp.oninput = () => {
        const res = this.db.search(inp.value, 14);
        list.innerHTML = res.map(r => `<div data-i="${r.icao}"><b>${r.icao}</b>${r.name} <span class="dim">${r.city}</span></div>`).join('');
        list.classList.toggle('hidden', !res.length);
        list.querySelectorAll<HTMLElement>('div').forEach(dv => dv.onmousedown = () => { inp.value = dv.dataset.i!; list.classList.add('hidden'); commit(); });
      };
      const commit = () => {
        const apt = this.db.get(inp.value);
        c[id] = apt ? apt.icao : inp.value.toUpperCase();
        inp.value = c[id];
        fillRwy($(rwyId), c[id], ''); c[rwyId] = ($(rwyId) as HTMLSelectElement).value;
        info(id, c[id]); updRoute();
        if (apt && id === 'dep') this.onPreview(apt);
      };
      inp.onchange = commit;
      inp.onblur = () => setTimeout(() => list.classList.add('hidden'), 150);
    };
    bindApt('dep', 'depRwy'); bindApt('arr', 'arrRwy');
    c.depRwy = ($('depRwy') as HTMLSelectElement).value; c.arrRwy = ($('arrRwy') as HTMLSelectElement).value;
    ($('depRwy') as HTMLSelectElement).onchange = e => { c.depRwy = (e.target as HTMLSelectElement).value; };
    ($('arrRwy') as HTMLSelectElement).onchange = e => { c.arrRwy = (e.target as HTMLSelectElement).value; };
    ($('start') as HTMLSelectElement).onchange = e => { c.start = (e.target as HTMLSelectElement).value as never; };
    ($('time') as HTMLSelectElement).onchange = e => { c.time = (e.target as HTMLSelectElement).value as never; };
    ($('weather') as HTMLSelectElement).onchange = e => { c.weather = (e.target as HTMLSelectElement).value; };
    $<HTMLInputElement>('cruise').onchange = e => { c.cruiseFt = +(e.target as HTMLInputElement).value || 10000; };
    $<HTMLInputElement>('route').onchange = e => { c.route = (e.target as HTMLInputElement).value.toUpperCase(); updRoute(); };
    const num = (v: string) => (v.trim() === '' ? null : +v);
    $<HTMLInputElement>('wdir').onchange = e => { c.windDir = num((e.target as HTMLInputElement).value); };
    $<HTMLInputElement>('wspd').onchange = e => { c.windSpd = num((e.target as HTMLInputElement).value); };
    $<HTMLInputElement>('vis').onchange = e => { c.visibility = num((e.target as HTMLInputElement).value); };
    $<HTMLInputElement>('fuel').oninput = e => { c.fuelPct = +(e.target as HTMLInputElement).value; $('fuelV').textContent = c.fuelPct + '%'; updRoute(); };
    $<HTMLInputElement>('pay').oninput = e => { c.payloadPct = +(e.target as HTMLInputElement).value; $('payV').textContent = c.payloadPct + '%'; updRoute(); };
    updRoute();
    $('fly').onclick = () => {
      if (!this.db.get(c.dep)) { alert('출발 공항을 확인하세요.'); return; }
      save('sky.cfg', c);
      this.onFly({ ...c });
    };
  }

  private renderSettings(el: HTMLElement) {
    const s = this.settings;
    el.innerHTML = `
      <div class="sec"><h3>지형 · 위성영상</h3>
        <div class="field"><label>위성영상 소스</label><select id="img">
          <option value="esri">Esri World Imagery (위성, 키 불필요 · 기본)</option>
          <option value="sentinel2">Sentinel-2 Cloudless (위성, 키 불필요 · 유럽우주국 원본)</option>
          <option value="bing-ion">Bing Maps Aerial via Cesium ion (MSFS와 동일 소스, 무료 가입만 필요)</option>
          <option value="google">Google 위성지도 (Google Maps API 키 필요)</option>
          <option value="osm">OpenStreetMap (지도)</option></select></div>
        <div class="field"><label>Cesium ion 액세스 토큰</label><input id="ion" value="${s.ionToken}" placeholder="eyJ... (ion.cesium.com 무료 가입 → Access Tokens)"></div>
        <div class="field"><label>Google Maps Platform API 키 (Google 위성지도 · 3D 도시에 사용)</label>
          <input id="gkey" value="${s.googleKey}" placeholder="AIza... (Google Cloud 콘솔에서 Map Tiles API 활성화)"></div>
        <div class="field"><label><input type="checkbox" id="pr" ${s.photoreal ? 'checked' : ''}> Google Photorealistic 3D Tiles (실사 3D 도시 · 포토그래메트리, 같은 키 사용)</label></div>
        <p class="note">
          위성지도 원본을 <b>무료로</b> 더 받을 수 있는 방법:<br>
          • <b>Esri World Imagery</b> (기본) — Maxar 등 상용 위성사진, 키 없이 바로 사용. 대부분 지역에서 이미 Google 지도와 비슷한 해상도입니다.<br>
          • <b>Sentinel-2 Cloudless</b> — 유럽우주국 Sentinel-2 위성의 무료 공개 원본(EOX 가공). 키 불필요, 해상도는 약 10m/px로 낮은 고도에서는 Esri보다 흐리지만 완전히 다른 원본입니다.<br>
          • <b>Bing Maps Aerial</b> — <a href="https://ion.cesium.com/signup" target="_blank" rel="noopener">ion.cesium.com</a>에서 <b>신용카드 없이</b> 이메일만으로 무료 가입하면 발급되는 토큰만 넣으면 됩니다. MSFS 2020이 쓰는 것과 같은 소스로, 셋 중 화질이 가장 좋습니다.<br>
          • <b>Google 위성지도</b> — Google Cloud 계정과 결제수단 등록이 필요한 대신(무료 사용량 있음), 최신 갱신 빈도가 가장 좋습니다.<br>
          키가 없거나 잘못되면 자동으로 Esri로 되돌아갑니다.
        </p>
        <p class="note">지형 고도는 AWS Terrain Tiles(SRTM 기반, 전 세계)를 실시간 스트리밍하며, 활주로는 실제 활주로 좌표/표고로 평탄화됩니다. Google 3D 타일을 켜면 MSFS의 포토그래메트리 도시와 유사한 실사 3D 지형·건물이 표시됩니다.</p>
      </div>
      <div class="sec"><h3>그래픽 · 사운드</h3>
        <div class="frow"><div class="field"><label>품질</label><select id="q"><option value="low">낮음</option><option value="medium">중간</option><option value="high">높음 (MSAA)</option></select></div>
        <div class="field"><label>그림자</label><select id="sh"><option value="0">끔</option><option value="1">켬</option></select></div></div>
        <div class="field"><label>음량 <b id="volV">${Math.round(s.volume * 100)}%</b></label><input id="vol" type="range" min="0" max="100" value="${Math.round(s.volume * 100)}"></div>
        <div class="field"><label><input type="checkbox" id="mix" ${s.autoMixture ? 'checked' : ''}> 피스톤 엔진 자동 혼합비 (Auto-lean)</label></div>
      </div>
      <div class="sec"><h3>조이스틱 / HOTAS / 러더 페달</h3>
        <p class="note">버튼을 누른 뒤 해당 축을 끝까지 움직이세요. (Gamepad API — 브라우저에서 한 번 버튼을 눌러야 장치가 인식됩니다)</p>
        <div id="axes"></div>
        <div class="field"><label>데드존 <b id="dzV">${Math.round(this.controls.gp.deadzone * 100)}%</b></label><input id="dz" type="range" min="0" max="25" value="${Math.round(this.controls.gp.deadzone * 100)}"></div>
      </div>
      <button id="saveSet" class="primary" style="width:100%">저장 (일부는 재시작 후 적용)</button>`;
    const $ = <T extends HTMLElement>(id: string) => el.querySelector<T>('#' + id)!;
    ($('img') as HTMLSelectElement).value = s.imagery;
    ($('q') as HTMLSelectElement).value = s.quality;
    ($('sh') as HTMLSelectElement).value = s.shadows ? '1' : '0';
    $<HTMLInputElement>('vol').oninput = e => { s.volume = +(e.target as HTMLInputElement).value / 100; $('volV').textContent = Math.round(s.volume * 100) + '%'; };
    $<HTMLInputElement>('dz').oninput = e => { this.controls.gp.deadzone = +(e.target as HTMLInputElement).value / 100; $('dzV').textContent = (e.target as HTMLInputElement).value + '%'; this.controls.saveGamepad(); };
    const axes = $('axes');
    const names: [keyof typeof this.controls.gp, string][] = [['roll', '롤 (에일러론)'], ['pitch', '피치 (엘리베이터)'], ['yaw', '요 (러더)'], ['throttle', '스로틀 / 콜렉티브'], ['brake', '브레이크']];
    const renderAxes = () => {
      axes.innerHTML = names.map(([k, n]) => {
        const b = this.controls.gp[k] as AxisBind | undefined;
        return `<div class="fms-row"><label>${n}</label><span style="flex:1;font-family:B612 Mono">${b ? `PAD${b.pad} AXIS ${b.index}` : '— 미지정 —'}</span>
          <button data-bind="${k}">할당</button><button data-inv="${k}" class="${b?.invert ? 'on' : ''}">반전</button><button data-clr="${k}">✕</button></div>`;
      }).join('');
      axes.querySelectorAll<HTMLButtonElement>('[data-bind]').forEach(btn => btn.onclick = () => {
        const base = Controls.snapshot();
        btn.textContent = '움직이세요…';
        const t0 = performance.now();
        const poll = () => {
          const hit = Controls.detectAxis(base);
          if (hit) { (this.controls.gp as unknown as Record<string, AxisBind>)[btn.dataset.bind!] = { pad: hit.pad, index: hit.index, invert: false }; this.controls.saveGamepad(); renderAxes(); return; }
          if (performance.now() - t0 < 8000) requestAnimationFrame(poll); else renderAxes();
        };
        poll();
      });
      axes.querySelectorAll<HTMLButtonElement>('[data-inv]').forEach(btn => btn.onclick = () => { const b = this.controls.gp[btn.dataset.inv as 'roll'] as AxisBind | undefined; if (b) { b.invert = !b.invert; this.controls.saveGamepad(); renderAxes(); } });
      axes.querySelectorAll<HTMLButtonElement>('[data-clr]').forEach(btn => btn.onclick = () => { delete (this.controls.gp as unknown as Record<string, unknown>)[btn.dataset.clr!]; this.controls.saveGamepad(); renderAxes(); });
    };
    renderAxes();
    $('saveSet').onclick = () => {
      const oldKey = s.googleKey;
      s.imagery = ($('img') as HTMLSelectElement).value as ImagerySource;
      s.ionToken = $<HTMLInputElement>('ion').value.trim();
      s.googleKey = $<HTMLInputElement>('gkey').value.trim();
      if (s.googleKey && !oldKey && s.imagery === 'esri') s.imagery = 'google'; // new key -> use Google imagery
      s.photoreal = $<HTMLInputElement>('pr').checked;
      s.quality = ($('q') as HTMLSelectElement).value as never;
      s.shadows = ($('sh') as HTMLSelectElement).value === '1';
      s.autoMixture = $<HTMLInputElement>('mix').checked;
      save('sky.settings', s);
      this.onSettings(s);
    };
  }
  onSettings: (s: Settings) => void = () => {};
  onDiag: () => void = () => {};
}

function rangeHours(a: ReturnType<typeof getAircraft>) {
  return a.cat === 'widebody' ? 14 : a.cat === 'airliner' ? 6 : a.cat === 'bizjet' ? 7 : a.cat === 'military' ? 2.5 : a.cat === 'regional' ? 3.5 : 5;
}
