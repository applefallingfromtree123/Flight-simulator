// Main menu: aircraft selection, flight planner (departure / arrival / route / start position),
// conditions (time, weather), scenery & control settings.
import { AIRCRAFT, CATEGORY_LABEL, getAircraft } from '../sim/aircraftDb.ts';
import { WEATHER_PRESETS } from '../sim/atmosphere.ts';
import { runwayEnds, type AirportDB, type Airport } from '../world/airports.ts';
import { Controls, type AxisBind } from '../input/controls.ts';
import type { ImagerySource } from '../world/scene.ts';
import { KEY_HELP } from './help.ts';
import { liveriesFor, getLivery } from '../world/liveries.ts';
import { FG_PREFIX, fgLivery, fgModelFor } from '../world/fgModels.ts';
import { SPECS } from '../sim/specs.ts';
import { ACTIVITIES, loadBest, type Activity } from '../career/activities.ts';
import { CLASS_LABEL, LICENCES, allowed, classOf, eligibleAircraft, generateJobs, jobTitle, licenceOf, loadCareer, newCareer, nextLicence, payloadPct, saveCareer, type CareerState, type Job } from '../career/career.ts';

export interface FlightConfig {
  aircraftId: string;
  /** livery id per aircraft type */
  livery: Record<string, string>;
  dep: string; depRwy: string; start: 'runway' | 'cold' | 'final' | 'cruise' | 'air';
  arr: string; arrRwy: string; route: string; cruiseFt: number;
  fuelPct: number; payloadPct: number;
  time: 'now' | 'dawn' | 'morning' | 'afternoon' | 'dusk' | 'night';
  weather: string; windDir: number | null; windSpd: number | null; visibility: number | null;
  /** Activity overrides: final distance (NM), hand-flown (no autopilot), local hour, airborne spot start. */
  finalNm?: number; handFly?: boolean; hour?: number;
  spot?: { lat: number; lon: number; agl: number; hdg: number };
}
export interface Settings {
  imagery: ImagerySource; googleKey: string; ionToken: string; photoreal: boolean;
  quality: 'low' | 'medium' | 'high' | 'ultra'; shadows: boolean; volume: number; autoMixture: boolean;
  deck3d: boolean;
}

const DEF_CFG: FlightConfig = {
  aircraftId: 'a320neo', livery: {}, dep: 'RKSI', depRwy: '', start: 'runway', arr: 'RJTT', arrRwy: '', route: '',
  cruiseFt: 35000, fuelPct: 60, payloadPct: 70, time: 'now', weather: 'clear', windDir: null, windSpd: null, visibility: null,
};
const DEF_SET: Settings = { imagery: 'esri', googleKey: '', ionToken: '', photoreal: false, quality: 'medium', shadows: false, volume: 0.7, autoMixture: true, deck3d: true };

function load<T>(k: string, d: T): T { try { const s = localStorage.getItem(k); return s ? { ...d, ...JSON.parse(s) } : { ...d }; } catch { return { ...d }; } }
function save(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } }

export class Menu {
  cfg: FlightConfig = load('sky.cfg', DEF_CFG);
  settings: Settings = load('sky.settings', DEF_SET);
  onFly: (c: FlightConfig) => void = () => {};
  onPreview: (apt: Airport) => void = () => {};
  onRoute: (pts: { lat: number; lon: number }[]) => void = () => {};
  onResume: (() => void) | null = null;
  onMapView: (lat: number, lon: number, height: number) => void = () => {};
  onMapSel: (dep?: Airport, arr?: Airport, focus?: Airport) => void = () => {};
  onCareerFly: (c: FlightConfig, job: Job) => void = () => {};
  onCareerAbandon: () => void = () => {};
  onActivity: (c: FlightConfig, a: Activity) => void = () => {};
  career: CareerState | null = loadCareer();
  tab: 'plan' | 'aircraft' | 'career' | 'activities' | 'settings' | 'help' = 'plan';
  private focus: Airport | undefined;
  private canResume = false;

  constructor(private el: HTMLElement, private db: AirportDB, private controls: Controls) {}

  show(canResume: boolean, tab?: Menu['tab']) {
    this.el.classList.remove('hidden');
    if (tab) this.tab = tab;
    this.canResume = canResume;
    this.render(canResume);
    const a = this.db.get(this.cfg.dep);
    if (a) this.onPreview(a);
    this.syncMap();
  }
  private syncMap() { this.onMapSel(this.db.get(this.cfg.dep), this.db.get(this.cfg.arr), this.focus); }
  /** Airport clicked on the globe. */
  pickAirport(apt: Airport) {
    this.focus = apt;
    this.renderAptCard();
    this.syncMap();
  }
  private renderAptCard() {
    const card = this.el.querySelector<HTMLElement>('#aptCard');
    if (!card) return;
    const a = this.focus;
    if (!a) { card.classList.add('hidden'); return; }
    card.classList.remove('hidden');
    const rws = a.runways.map(r => `<div class="rw"><b>${r.le.ident}/${r.he.ident}</b> ${Math.round(r.length / 0.3048).toLocaleString()} ft × ${Math.round(r.width / 0.3048)} ft ${r.hard ? '포장' : '비포장'}${r.lighted ? ' · 조명' : ''}</div>`).join('') || '<div class="dim">활주로 정보 없음 (헬리포트 등)</div>';
    const sizeL = { 3: '대형 공항', 2: '중형 공항', 1: '소형 비행장' }[a.size];
    card.innerHTML = `<div class="apt-h"><b>${a.icao}</b>${a.iata ? ` <span class="dim">/ ${a.iata}</span>` : ''}<button class="x" id="aptX">✕</button></div>
      <div class="apt-n">${a.name}</div><div class="dim">${a.city ? a.city + ', ' : ''}${a.country} · ${sizeL} · 표고 ${Math.round(a.elev / 0.3048).toLocaleString()} ft</div>
      <div class="apt-rw">${rws}</div>
      <div class="frow"><button id="aptDep" class="primary">출발지로 설정</button><button id="aptArr">도착지로 설정</button></div>`;
    card.querySelector<HTMLButtonElement>('#aptX')!.onclick = () => { this.focus = undefined; this.renderAptCard(); this.syncMap(); };
    const set = (k: 'dep' | 'arr') => {
      this.cfg[k] = a.icao; this.cfg[k === 'dep' ? 'depRwy' : 'arrRwy'] = '';
      save('sky.cfg', this.cfg);
      this.focus = undefined;
      if (this.tab !== 'plan') this.tab = 'plan';
      this.render(this.canResume);
      this.syncMap();
    };
    card.querySelector<HTMLButtonElement>('#aptDep')!.onclick = () => set('dep');
    card.querySelector<HTMLButtonElement>('#aptArr')!.onclick = () => set('arr');
  }
  hide() { this.el.classList.add('hidden'); }
  get visible() { return !this.el.classList.contains('hidden'); }

  private render(canResume: boolean) {
    this.el.innerHTML = `
      <header>
        <h1>SKY<span>LINE</span> <span class="dim" style="font-size:11px;letter-spacing:1px">FLIGHT SIMULATOR</span></h1>
        <div class="tabs">
          <button data-tab="plan" class="${this.tab === 'plan' ? 'on' : ''}">비행 계획</button>
          <button data-tab="aircraft" class="${this.tab === 'aircraft' ? 'on' : ''}">기종 · 도색</button>
          <button data-tab="career" class="${this.tab === 'career' ? 'on' : ''}">커리어</button>
          <button data-tab="activities" class="${this.tab === 'activities' ? 'on' : ''}">액티비티</button>
          <button data-tab="settings" class="${this.tab === 'settings' ? 'on' : ''}">설정</button>
          <button data-tab="help" class="${this.tab === 'help' ? 'on' : ''}">조작법</button>
        </div>
        <div><button id="menuDiag" title="렌더링 진단 정보">진단</button> ${canResume ? '<button id="resume">비행 재개 (Esc)</button>' : ''}</div>
      </header>
      <div class="m-col" id="acList"></div>
      <div class="m-mid">
        <div class="map-tools"><button id="mapWorld" title="지구 전체 보기">🌐 세계 지도</button><button id="mapRegion">지역</button><button id="mapDep">출발지</button><button id="mapArr">도착지</button>
          <span class="dim">지구본에서 공항 점을 눌러 선택 · 드래그 회전 · 휠/핀치 확대</span></div>
        <div class="apt-card hidden" id="aptCard"></div>
        <div class="spec" id="acSpec"></div>
      </div>
      <div class="m-col right" id="rightCol"></div>`;
    this.el.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b => b.onclick = () => { this.tab = b.dataset.tab as never; this.render(canResume); });
    this.el.querySelector<HTMLButtonElement>('#menuDiag')!.onclick = () => this.onDiag();
    const res = this.el.querySelector<HTMLButtonElement>('#resume');
    if (res) res.onclick = () => this.onResume?.();
    this.renderAircraftList();
    this.renderSpec();
    this.renderAptCard();
    const q = (id: string) => this.el.querySelector<HTMLButtonElement>('#' + id)!;
    const ctr = () => this.db.get(this.cfg.dep) ?? { lat: 37.5, lon: 127 };
    q('mapWorld').onclick = () => { const p = ctr(); this.onMapView(p.lat, p.lon, 14_000_000); };
    q('mapRegion').onclick = () => { const p = ctr(); this.onMapView(p.lat, p.lon, 1_200_000); };
    q('mapDep').onclick = () => { const a = this.db.get(this.cfg.dep); if (a) { this.onMapView(a.lat, a.lon, 60_000); this.pickAirport(a); } };
    q('mapArr').onclick = () => { const a = this.db.get(this.cfg.arr); if (a) { this.onMapView(a.lat, a.lon, 60_000); this.pickAirport(a); } };
    this.renderRight();
  }
  private renderRight() {
    const right = this.el.querySelector<HTMLElement>('#rightCol')!;
    if (this.tab === 'plan') this.renderPlan(right);
    else if (this.tab === 'aircraft') this.renderAircraftInfo(right);
    else if (this.tab === 'career') this.renderCareer(right);
    else if (this.tab === 'activities') this.renderActivities(right);
    else if (this.tab === 'settings') this.renderSettings(right);
    else right.innerHTML = KEY_HELP;
  }

  private renderAircraftList() {
    const el = this.el.querySelector<HTMLElement>('#acList')!;
    const cats = [...new Set(AIRCRAFT.map(a => a.cat))];
    el.innerHTML = `<input id="acSearch" placeholder="기종 검색 (예: 737, A350, Cessna)" style="width:100%">` +
      cats.map(cat => `<div class="ac-cat">${CATEGORY_LABEL[cat]}</div>` + AIRCRAFT.filter(a => a.cat === cat).map(a =>
        `<div class="ac-item ${a.id === this.cfg.aircraftId ? 'sel' : ''}" data-id="${a.id}" data-q="${(a.mfr + ' ' + a.name + ' ' + a.icao).toLowerCase()}"><span>${a.mfr} ${a.name}${fgModelFor(a.id) ? ' <b class="fgtag" title="FlightGear 실제 3D 모델 · 실제 항공사 도색">FG</b>' : ''}</span><small>${a.icao}</small></div>`).join('')).join('');
    el.querySelectorAll<HTMLElement>('.ac-item').forEach(it => it.onclick = () => {
      this.cfg.aircraftId = it.dataset.id!;
      const d = getAircraft(this.cfg.aircraftId);
      this.cfg.cruiseFt = Math.round(d.v.cruiseFt / 1000) * 1000;
      if (d.cat === 'glider') this.cfg.start = 'air';
      el.querySelectorAll('.ac-item').forEach(x => x.classList.toggle('sel', x === it));
      this.renderSpec();
      if (this.tab === 'plan' || this.tab === 'aircraft') this.renderRight();
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
    const fgm = fgModelFor(a.id);
    const liv = getLivery(a, this.cfg.livery?.[a.id]);
    const livName = fgm ? `${fgLivery(fgm, this.cfg.livery?.[a.id]).name} (실제 도색)` : `${liv.name} (${liv.reg})`;
    const x = SPECS[a.id];
    this.el.querySelector<HTMLElement>('#acSpec')!.innerHTML = `
      <div class="spec-row"><div><h2>${a.name}</h2><div class="mfr">${a.mfr} · ${CATEGORY_LABEL[a.cat]} · ICAO ${a.icao} · 도색: ${livName}</div></div>
      <button id="specMore">상세 제원 · 도색 선택 →</button></div>
      <div class="spec-grid">
        <div><span>전장 / 전폭</span>${a.L.toFixed(1)} / ${a.fdm === 'rotor' ? a.rotor!.D + ' (로터)' : a.b.toFixed(1)} m</div>
        <div><span>MTOW</span>${a.m.mtow.toLocaleString()} kg</div>
        <div><span>순항</span>${a.v.cruise} KTAS${a.fdm === 'rotor' ? '' : ' @ FL' + Math.round(a.v.cruiseFt / 100)}</div>
        <div><span>항속거리</span>${x && x.rangeKm ? x.rangeKm.toLocaleString() + ' km' : '—'}</div>
      </div>`;
    this.el.querySelector<HTMLButtonElement>('#specMore')!.onclick = () => { this.tab = 'aircraft'; this.render(this.canResume); };
  }

  private renderAircraftInfo(el: HTMLElement) {
    const a = getAircraft(this.cfg.aircraftId);
    const x = SPECS[a.id];
    const eng = a.eng.t === 'none' ? '무동력' : `${a.eng.n} × ${a.eng.t === 'fan' ? `터보팬 ${a.eng.p} kN` : a.eng.t === 'jet' ? `터보제트 ${a.eng.p} kN (A/B ${a.eng.ab} kN)` : a.eng.t === 'prop' ? `피스톤 ${Math.round(a.eng.p * 1.341)} hp` : a.eng.t === 'tprop' ? `터보프롭 ${Math.round(a.eng.p * 1.341)} shp` : `터보샤프트 ${Math.round(a.eng.p * 1.341)} shp`}`;
    const law = a.fbw === 'airbus' ? 'FBW · Normal Law · 사이드스틱' : a.fbw === 'boeing' ? 'FBW · C*U · 요크' : a.fbw === 'fighter' ? 'FBW · G-command' : a.fdm === 'rotor' ? '기계식 + SAS' : '기계식 (재래식)';
    const cockpit = { airliner: '글래스 칵핏 (PFD/ND/EICAS)', g1000: 'G1000 글래스 칵핏', steam: '아날로그 6-pack', fighter: 'HUD + MFD', heli: '헬기 글래스 칵핏' }[a.cockpit];
    const AR = a.b * a.b / a.S;
    const thrust = a.eng.t === 'fan' || a.eng.t === 'jet' ? `${((a.eng.n * (a.eng.ab ?? a.eng.p) * 1000) / (a.m.mtow * 9.81)).toFixed(2)} (추력/중량)` : a.eng.t === 'none' ? '—' : `${((a.eng.n * a.eng.p) / a.m.mtow).toFixed(3)} kW/kg (출력/중량)`;
    const row = (k: string, v: string) => `<tr><td>${k}</td><td>${v}</td></tr>`;
    const fgm = fgModelFor(a.id);
    const livs = liveriesFor(a);
    const cur = getLivery(a, this.cfg.livery?.[a.id]).id;
    const fgCur = fgm ? fgLivery(fgm, this.cfg.livery?.[a.id]).id : '';
    const livHtml = fgm
      ? `<div class="sec"><h3>도색 (리버리) — FlightGear 실제 도색</h3><div class="liv-list">
        ${fgm.liveries.map(l => `<button class="liv ${l.id === fgCur ? 'sel' : ''}" data-liv="${FG_PREFIX}${l.id}"><span class="ln">${l.name}</span><span class="dim">${l.id}</span></button>`).join('')}
        </div><p class="note">3D 모델과 도색: ${fgm.source} (${fgm.license}) — FlightGear 커뮤니티 제작 실제 기체 모델·항공사 텍스처.</p></div>`
      : `<div class="sec"><h3>도색 (리버리)</h3><div class="liv-list">
        ${livs.map(l => `<button class="liv ${l.id === cur ? 'sel' : ''}" data-liv="${l.id}">
          <span class="sw"><i style="background:${l.body}"></i><i style="background:${(l.bands ?? [])[0]?.c ?? l.body}"></i><i style="background:${l.tail.bg}"></i><i style="background:${l.engine}"></i></span>
          <span class="ln">${l.name}</span><span class="dim">${l.reg}</span></button>`).join('')}
      </div><p class="note">도색은 실제 운항사의 색 배치·타이틀·꼬리날개 마크를 단순화해 재현한 것입니다.</p></div>`;
    el.innerHTML = `
      <div class="sec"><h3>${a.mfr} ${a.name}</h3>
        <p class="note">${CATEGORY_LABEL[a.cat]} · ICAO ${a.icao}${x ? ` · 초도 비행 ${x.first}년` : ''}${a.seats ? ` · 좌석 ${a.seats}석` : ''}${x?.crew ? ` · 운항 승무원 ${x.crew}명` : ''}</p>
        ${a.note ? `<p class="note">${a.note}</p>` : ''}
      </div>
      ${livHtml}
      <div class="sec"><h3>치수</h3><table class="spec-t">
        ${row('전장', a.L.toFixed(2) + ' m')}${row(a.fdm === 'rotor' ? '로터 직경' : '전폭', (a.fdm === 'rotor' ? a.rotor!.D : a.b).toFixed(2) + ' m')}${row('전고', a.H.toFixed(2) + ' m')}
        ${a.fdm === 'rotor' ? row('로터 블레이드', `${a.rotor!.blades}개 · 꼬리 ${a.rotor!.tail}`) : row('날개 면적', a.S.toFixed(1) + ' m²') + row('가로세로비', AR.toFixed(1)) + row('후퇴각 (1/4 시위)', a.sweep + '°')}
        ${row('동체 직경', a.dia.toFixed(2) + ' m')}</table></div>
      <div class="sec"><h3>중량</h3><table class="spec-t">
        ${row('자체 중량', a.m.e.toLocaleString() + ' kg')}${row('최대 이륙 중량 (MTOW)', a.m.mtow.toLocaleString() + ' kg')}${row('최대 착륙 중량 (MLW)', a.m.mlw.toLocaleString() + ' kg')}
        ${row('연료 용량', a.m.fuel.toLocaleString() + ' kg')}${row('최대 탑재량', a.m.pay.toLocaleString() + ' kg')}${a.fdm === 'rotor' ? '' : row('익면 하중 (MTOW)', Math.round(a.m.mtow / a.S) + ' kg/m²')}</table></div>
      <div class="sec"><h3>동력</h3><table class="spec-t">
        ${row('엔진', eng)}${x ? row('엔진 모델', x.engine) : ''}${row('추력/출력 대 중량', thrust)}${a.eng.bpr ? row('바이패스비', String(a.eng.bpr)) : ''}${a.eng.propD ? row('프로펠러', `${a.eng.propD} m · ${a.eng.blades}엽`) : ''}</table></div>
      <div class="sec"><h3>성능</h3><table class="spec-t">
        ${row('순항 속도', `${a.v.cruise} KTAS (${Math.round(a.v.cruise * 1.852)} km/h)`)}${a.fdm === 'rotor' ? '' : row('순항 고도', `FL${Math.round(a.v.cruiseFt / 100)}`)}
        ${row('실용 상승 한도', a.v.ceil.toLocaleString() + ' ft')}${x && x.rangeKm ? row('항속 거리', `${x.rangeKm.toLocaleString()} km (${Math.round(x.rangeKm / 1.852).toLocaleString()} NM)`) : ''}
        ${row('VMO / MMO', `${a.v.vmo} kt / M${a.v.mmo}`)}${a.fdm === 'rotor' ? '' : row('실속 속도 VS0 / VS1', `${a.v.vs0} / ${a.v.vs1} kt`) + row('VR / VREF', `${a.v.vr} / ${a.v.vref} kt`)}
        ${row('VLE / VFE', `${a.v.vle} / ${a.v.vfe} kt`)}</table></div>
      <div class="sec"><h3>시스템</h3><table class="spec-t">
        ${row('조종 계통', law)}${row('계기', cockpit)}${row('착륙장치', `${{ tri: '전륜식', tail: '후륜식', skid: '스키드', float: '플로트' }[a.gear.t]}${a.gear.retract ? ' · 접이식' : ' · 고정식'}`)}
        ${row('플랩', a.flaps === 'none' ? '—' : a.flaps)}${row('스포일러 / 역추진', `${a.spoilers ? '있음' : '없음'} / ${a.reversers ? '있음' : '없음'}`)}${row('APU', a.apu ? '있음' : '없음')}</table></div>`;
    el.querySelectorAll<HTMLButtonElement>('[data-liv]').forEach(b => b.onclick = () => {
      this.cfg.livery = { ...(this.cfg.livery ?? {}), [a.id]: b.dataset.liv! };
      save('sky.cfg', this.cfg);
      el.querySelectorAll('.liv').forEach(x => x.classList.toggle('sel', x === b));
      this.renderSpec();
    });
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
        this.syncMap();
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

  private renderCareer(el: HTMLElement) {
    const c = this.career;
    if (!c) {
      el.innerHTML = `
        <div class="sec"><h3>커리어 시작</h3>
          <p class="note">학생 조종사로 시작해 소형기 의뢰로 경험치(XP)와 돈을 모으면 자가용 → 사업용 → 운송용 면장과 대형기 기장 자격이 열립니다.
          의뢰는 현재 위치한 실제 공항 주변의 실제 공항들로 생성되며, 착륙 품질·과속·사고 여부로 보수와 평판이 정해집니다.</p>
          <div class="field"><label>조종사 이름</label><input id="cName" value="" placeholder="예: 김민준"></div>
          <div class="field"><label>홈 공항 (ICAO)</label><input id="cHome" value="${this.cfg.dep}"></div>
          <button id="cStart" class="primary" style="width:100%">커리어 시작</button>
        </div>`;
      el.querySelector<HTMLButtonElement>('#cStart')!.onclick = () => {
        const name = el.querySelector<HTMLInputElement>('#cName')!.value.trim() || '조종사';
        const home = this.db.get(el.querySelector<HTMLInputElement>('#cHome')!.value.trim());
        if (!home) { alert('홈 공항을 찾을 수 없습니다.'); return; }
        this.career = newCareer(name, home.icao);
        saveCareer(this.career);
        this.renderCareer(el);
      };
      return;
    }
    const lic = licenceOf(c), next = nextLicence(c);
    const here = this.db.get(c.location);
    if (c.jobsFor !== c.location || !c.jobs.length) { c.jobs = generateJobs(c, this.db); c.jobsFor = c.location; saveCareer(c); }
    const pct = next ? Math.round(((c.xp - lic.xp) / (next.xp - lic.xp)) * 100) : 100;
    const jobCard = (j: Job, active = false) => {
      const to = this.db.get(j.to);
      const acs = eligibleAircraft(c, j.cls);
      const pick = acs.find(a => a.id === this.cfg.aircraftId) ?? acs[0];
      return `<div class="job ${active ? 'active' : ''}" data-job="${j.id}">
        <div class="job-h"><b>${j.from} → ${j.to}</b><span class="pay">$${j.pay.toLocaleString()}</span></div>
        <div>${jobTitle(j)} · <span class="dim">${j.client}</span></div>
        <div class="dim">${to ? to.name + ' · ' + (to.city || to.country) : ''} · ${j.nm} NM · ${CLASS_LABEL[j.cls]} · +${j.xp} XP</div>
        ${active ? `<div class="frow"><button data-resume="1" class="primary">이 임무로 비행</button><button data-abandon="1">임무 포기</button></div>`
          : `<div class="frow"><select data-ac="${j.id}">${acs.map(a => `<option value="${a.id}" ${a === pick ? 'selected' : ''}>${a.mfr} ${a.name}</option>`).join('')}</select>
          <button data-accept="${j.id}" class="primary">수락 · 비행</button></div>`}
      </div>`;
    };
    el.innerHTML = `
      <div class="sec pilot">
        <div class="job-h"><b>${c.name}</b><span class="dim">${lic.name}</span></div>
        <div class="xpbar"><i style="width:${pct}%"></i></div>
        <div class="dim">${c.xp.toLocaleString()} XP${next ? ` · 다음 면장 ${next.name}까지 ${(next.xp - c.xp).toLocaleString()} XP` : ' · 최고 등급'}</div>
        <div class="spec-grid">
          <div><span>잔고</span>$${c.money.toLocaleString()}</div><div><span>비행시간</span>${c.hours.toFixed(1)} h</div>
          <div><span>비행 횟수</span>${c.flights}</div><div><span>평판</span>${c.rep}/100</div>
        </div>
        <div class="dim">현재 위치: <b>${c.location}</b> ${here ? here.name : ''} · 조종 가능: ${lic.classes.map(k => CLASS_LABEL[k]).join(', ')}</div>
      </div>
      ${c.active ? `<div class="sec"><h3>진행 중인 임무</h3>${jobCard(c.active, true)}</div>` : ''}
      <div class="sec"><h3>의뢰 게시판 — ${c.location}</h3>
        ${c.jobs.length ? c.jobs.map(j => jobCard(j)).join('') : '<p class="note">이 공항 주변에 맞는 의뢰가 없습니다. 다른 공항으로 이동(자유 비행 후 착륙)하거나 홈 공항을 바꿔보세요.</p>'}
        <button id="cRefresh" style="width:100%">새 의뢰 받기</button>
      </div>
      <div class="sec"><h3>면장</h3>${LICENCES.map(l => `<div class="lic ${c.xp >= l.xp ? 'got' : ''}">${c.xp >= l.xp ? '✔' : '○'} ${l.name} <span class="dim">${l.xp.toLocaleString()} XP · ${l.classes.map(k => CLASS_LABEL[k]).join(', ')}</span></div>`).join('')}</div>
      <div class="sec"><h3>로그북</h3>${c.log.length ? `<table class="spec-t log"><tr><td>날짜</td><td>구간</td><td>기종</td><td>시간</td><td>착륙</td><td>보수</td></tr>
        ${c.log.slice(0, 15).map(e => `<tr class="${e.result}"><td>${new Date(e.t).toLocaleDateString()}</td><td>${e.from}→${e.to}</td><td>${e.ac}</td><td>${e.min}분</td><td>${e.fpm === null ? '—' : e.fpm + ' fpm'}</td><td>${e.pay >= 0 ? '' : '−'}$${Math.abs(e.pay).toLocaleString()}</td></tr>`).join('')}</table>` : '<p class="note">아직 기록이 없습니다.</p>'}
      </div>
      <button id="cReset" style="width:100%;opacity:.7">커리어 초기화</button>`;
    el.querySelector<HTMLButtonElement>('#cRefresh')!.onclick = () => { c.jobs = generateJobs(c, this.db, Date.now() + 1); c.jobsFor = c.location; saveCareer(c); this.renderCareer(el); };
    el.querySelector<HTMLButtonElement>('#cReset')!.onclick = () => { if (confirm('커리어 기록을 모두 지울까요?')) { this.career = null; saveCareer(null); this.renderCareer(el); } };
    el.querySelectorAll<HTMLButtonElement>('[data-accept]').forEach(b => b.onclick = () => {
      const job = c.jobs.find(j => j.id === b.dataset.accept)!;
      const acId = el.querySelector<HTMLSelectElement>(`[data-ac="${job.id}"]`)!.value;
      c.active = job; saveCareer(c);
      this.flyJob(job, acId);
    });
    el.querySelector<HTMLButtonElement>('[data-resume]')?.addEventListener('click', () => {
      const job = c.active!;
      const acs = eligibleAircraft(c, job.cls);
      this.flyJob(job, (acs.find(a => a.id === this.cfg.aircraftId) ?? acs[0]).id);
    });
    el.querySelector<HTMLButtonElement>('[data-abandon]')?.addEventListener('click', () => { if (confirm('임무를 포기할까요? (평판 −4)')) { this.onCareerAbandon(); this.renderCareer(el); } });
    void allowed; void classOf;
  }
  /** Set up the flight plan for a career job and launch it. */
  private flyJob(job: Job, acId: string) {
    const a = getAircraft(acId);
    const x = SPECS[a.id];
    const endurH = x && x.rangeKm ? x.rangeKm / 1.852 / Math.max(60, a.v.cruise) : rangeHours(a);
    const needH = job.nm * 1.15 / Math.max(60, a.v.cruise * 0.9) + 0.75;
    Object.assign(this.cfg, { aircraftId: a.id, dep: job.from, arr: job.to, depRwy: '', arrRwy: '', route: '', start: 'runway',
      payloadPct: payloadPct(job, a), fuelPct: Math.round(Math.max(20, Math.min(100, (needH / endurH) * 100))),
      cruiseFt: Math.min(a.v.cruiseFt, job.nm < 60 ? 4500 : job.nm < 200 ? Math.min(a.v.cruiseFt, 12000) : a.v.cruiseFt) });
    save('sky.cfg', this.cfg);
    this.onCareerFly({ ...this.cfg }, job);
  }

  private renderActivities(el: HTMLElement) {
    const best = loadBest();
    const card = (a: Activity) => {
      const ac = getAircraft(a.ac);
      const b = best[a.id];
      return `<div class="job">
        <div class="job-h"><b>${a.title}</b>${a.type === 'landing' ? `<span class="pay">${b === undefined ? '—' : b + '점'}</span>` : ''}</div>
        <div>${a.desc}</div>
        <div class="dim">${ac.mfr} ${ac.name} · ${WEATHER_PRESETS[a.weather]?.label ?? ''} · 현지 ${Math.floor(a.hour)}:${String(Math.round((a.hour % 1) * 60)).padStart(2, '0')}${a.type === 'landing' ? ` · 최종접근 ${a.finalNm} NM` : ` · ${a.agl!.toLocaleString()} ft AGL`}</div>
        <div class="frow"><button data-act="${a.id}" class="primary">▶ 시작</button></div>
      </div>`;
    };
    el.innerHTML = `
      <div class="sec"><h3>착륙 챌린지</h3>
        <p class="note">유명한 공항의 짧은 최종접근에서 직접 조종해 착륙합니다 (오토파일럿 꺼짐). 접지율 400 · 중심선 200 · 접지 지점 200 · 속도 100 · 뱅크 100 = 1000점, S~D 등급.</p>
        ${ACTIVITIES.filter(a => a.type === 'landing').map(card).join('')}</div>
      <div class="sec"><h3>디스커버리 비행</h3>
        <p class="note">세계의 명소 상공에서 바로 시작하는 자유 비행. 터치 조종이나 키보드로 마음껏 둘러보세요.</p>
        ${ACTIVITIES.filter(a => a.type === 'discovery').map(card).join('')}</div>`;
    el.querySelectorAll<HTMLButtonElement>('[data-act]').forEach(btn => btn.onclick = () => {
      const a = ACTIVITIES.find(x => x.id === btn.dataset.act)!;
      let dep = a.apt ?? '';
      if (a.type === 'discovery') dep = this.db.nearest({ lat: a.lat!, lon: a.lon! }, 1, 400000)[0]?.apt.icao ?? this.cfg.dep;
      if (!this.db.get(dep)) { alert(`공항 ${dep}을(를) 찾을 수 없습니다.`); return; }
      const c: FlightConfig = { ...this.cfg, aircraftId: a.ac, dep, arr: a.apt ?? dep, depRwy: '', arrRwy: a.rwy ?? '', route: '',
        start: a.type === 'landing' ? 'final' : 'air', fuelPct: 40, payloadPct: 50, time: 'now', weather: a.weather,
        windDir: null, windSpd: null, visibility: null, finalNm: a.finalNm, handFly: a.type === 'landing', hour: a.hour,
        spot: a.type === 'discovery' ? { lat: a.lat!, lon: a.lon!, agl: a.agl!, hdg: a.hdg! } : undefined,
        livery: a.livery ? { ...(this.cfg.livery ?? {}), [a.ac]: a.livery } : this.cfg.livery };
      this.onActivity(c, a);
    });
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
        <div class="frow"><div class="field"><label>품질</label><select id="q"><option value="low">낮음</option><option value="medium">중간</option><option value="high">높음 (레티나 해상도 · MSAA · 그림자)</option><option value="ultra">울트라 (최대 해상도 · 4K 그림자)</option></select></div>
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
  saveSettings() { save('sky.settings', this.settings); }
  onDiag: () => void = () => {};
}

function rangeHours(a: ReturnType<typeof getAircraft>) {
  return a.cat === 'widebody' ? 14 : a.cat === 'airliner' ? 6 : a.cat === 'bizjet' ? 7 : a.cat === 'military' ? 2.5 : a.cat === 'regional' ? 3.5 : 5;
}
