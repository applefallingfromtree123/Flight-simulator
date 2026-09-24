// In-flight cockpit panel: MCP/FCU autopilot panel, display units, pedestal readouts,
// overhead systems window, checklists, FMS/radio window and nav map window.
import { FT, KT, clamp, wrap360 } from '../core/math.ts';
import type { Aircraft } from '../sim/fdm.ts';
import type { FCS } from '../sim/fcs.ts';
import type { Systems, Switches } from '../sim/systems.ts';
import type { AirportDB } from '../world/airports.ts';
import { magVar } from '../core/geo.ts';
import { PFD } from '../avionics/pfd.ts';
import { ND } from '../avionics/nd.ts';
import { EICAS } from '../avionics/eicas.ts';
import { SixPack } from '../avionics/steam.ts';
import type { AvData } from '../avionics/common.ts';
import { checklistFor } from './checklists.ts';

export class Cockpit {
  pfd: PFD | null = null; nd: ND | null = null; eicas: EICAS | null = null; six: SixPack | null = null;
  mapNd: ND | null = null;
  av!: AvData;
  private mcp = document.getElementById('mcp')!;
  private dus = document.getElementById('dus')!;
  private ped = document.getElementById('pedestal')!;
  private mcpEls: Record<string, HTMLElement> = {};
  private clDone = new Set<string>();
  private clTab = '';
  private mapRange = 80;

  constructor(private ac: Aircraft, private fcs: FCS, private sys: Systems, private db: AirportDB, private act: (a: string) => void) {}

  build(av: AvData) {
    this.av = av;
    const d = this.ac.def;
    this.dus.innerHTML = '';
    this.pfd = this.nd = this.eicas = this.six = null;
    if (d.cockpit === 'steam') {
      this.six = new SixPack(this.dus);
      this.eicas = new EICAS(this.dus);
      av.ndMode = 'ROSE';
      if (d.cat !== 'glider') this.nd = new ND(this.dus);
    } else {
      this.pfd = new PFD(this.dus);
      this.nd = new ND(this.dus);
      this.eicas = new EICAS(this.dus);
      av.ndMode = d.cockpit === 'g1000' || d.cockpit === 'heli' ? 'ROSE' : 'ARC';
    }
    this.buildMcp();
    this.buildOverhead();
    this.buildChecklist();
    this.buildFms();
    const mapBody = document.querySelector('#mapwin .win-body')!;
    mapBody.innerHTML = '<div style="display:flex;gap:6px;margin-bottom:6px"><button data-r="-">RANGE −</button><button data-r="+">RANGE +</button><span id="mapInfo" class="dim"></span></div>';
    this.mapNd = new ND(mapBody as HTMLElement);
    mapBody.querySelectorAll<HTMLButtonElement>('[data-r]').forEach(b => b.onclick = () => {
      const steps = [5, 10, 20, 40, 80, 160, 320, 640];
      const i = steps.indexOf(this.mapRange);
      this.mapRange = steps[clamp(i + (b.dataset.r === '+' ? 1 : -1), 0, steps.length - 1)];
    });
  }

  // ───────────────────────── MCP / FCU ─────────────────────────
  private buildMcp() {
    const f = this.fcs, a = this.ac;
    const heli = a.isRotor;
    const knob = (id: string, label: string, get: () => string, step: (dir: number, big: boolean) => void, set?: (v: number) => void) => `
      <div class="mcp-grp" data-knob="${id}"><label>${label}</label><div class="mcp-val" id="mv_${id}">${get()}</div>
      <div class="mcp-row"><button data-k="${id}" data-d="-1">−</button><button data-k="${id}" data-d="1">+</button></div></div>`;
    const knobs: Record<string, { get: () => string; step: (d: number, big: boolean) => void; set?: (v: number) => void }> = {
      spd: { get: () => f.spdIsMach ? f.selMach.toFixed(2) : String(f.selSpd), step: (d, big) => { if (f.spdIsMach) f.selMach = clamp(+(f.selMach + d * (big ? 0.05 : 0.01)).toFixed(2), 0.3, 2.2); else f.selSpd = clamp(f.selSpd + d * (big ? 10 : 1), 30, 700); }, set: v => { if (v < 3) { f.spdIsMach = true; f.selMach = v; } else { f.spdIsMach = false; f.selSpd = Math.round(v); } } },
      hdg: { get: () => String(f.selHdg).padStart(3, '0'), step: (d, big) => { f.selHdg = Math.round(wrap360(f.selHdg + d * (big ? 10 : 1))) || 360; }, set: v => { f.selHdg = Math.round(wrap360(v)) || 360; } },
      alt: { get: () => String(f.selAlt), step: (d, big) => { f.selAlt = clamp(f.selAlt + d * (big ? 1000 : 100), 0, 60000); }, set: v => { f.selAlt = clamp(Math.round(v / 100) * 100, 0, 60000); } },
      vs: { get: () => (f.selVs > 0 ? '+' : '') + f.selVs, step: (d, big) => { f.selVs = clamp(f.selVs + d * (big ? 500 : 100), -8000, 8000); if (f.vert !== 'VS' && f.ap && !heli) f.setVert('VS'); }, set: v => { f.selVs = clamp(Math.round(v / 100) * 100, -8000, 8000); } },
      baro: { get: () => this.sys.baroStd ? 'STD' : String(this.sys.baroHpa), step: d => { this.sys.baroStd = false; this.sys.baroHpa = clamp(this.sys.baroHpa + d, 940, 1060); }, set: v => { this.sys.baroStd = false; this.sys.baroHpa = v > 100 ? Math.round(v) : Math.round(v * 33.8639); } },
      mins: { get: () => String(this.sys.minimums), step: d => { this.sys.minimums = clamp(this.sys.minimums + d * 10, 0, 5000); }, set: v => { this.sys.minimums = Math.round(v); } },
      rng: { get: () => String(this.av.ndRange), step: d => { const s = [5, 10, 20, 40, 80, 160, 320]; this.av.ndRange = s[clamp(s.indexOf(this.av.ndRange) + d, 0, s.length - 1)]; } },
    };
    const btn = (act: string, label: string) => `<button class="mcp-btn" data-act="${act}" id="mb_${act}">${label}</button>`;
    this.mcp.innerHTML = `
      <div class="mw"><button class="mwbtn" id="mwarn">MASTER WARN</button><button class="mwbtn" id="mcaut">MASTER CAUT</button></div>
      ${knob('spd', 'SPD/MACH', knobs.spd.get, knobs.spd.step)}
      ${knob('hdg', 'HDG', knobs.hdg.get, knobs.hdg.step)}
      ${knob('alt', 'ALT', knobs.alt.get, knobs.alt.step)}
      ${knob('vs', 'V/S FPM', knobs.vs.get, knobs.vs.step)}
      <div class="mcp-btns">
        ${btn('ap', 'AP')}${btn('athr', 'A/THR')}${btn('fd', 'FD')}${heli ? btn('sas', 'SAS') : btn('toga', 'TOGA')}
        ${btn('hdg', 'HDG')}${btn('nav', 'NAV')}${btn('loc', 'LOC')}${btn('app', 'APPR')}
        ${btn('alt', 'ALT')}${btn('vs', 'V/S')}${btn('flc', heli ? 'IAS' : 'FLC')}${btn('spdmach', 'SPD/M')}
      </div>
      ${knob('baro', 'BARO hPa', knobs.baro.get, knobs.baro.step)}
      ${knob('mins', 'MINS RA', knobs.mins.get, knobs.mins.step)}
      ${knob('rng', 'ND RANGE', knobs.rng.get, knobs.rng.step)}
      <div class="mcp-btns">${btn('ndmode', 'ND MODE')}${btn('navsrc', 'NAV SRC')}${btn('fms', 'FMS')}${btn('baro-std', 'STD')}</div>`;
    this.mcp.querySelectorAll<HTMLButtonElement>('[data-k]').forEach(b => b.onclick = e => { knobs[b.dataset.k!].step(+b.dataset.d!, (e as MouseEvent).shiftKey); this.refreshMcp(); });
    this.mcp.querySelectorAll<HTMLElement>('[data-knob]').forEach(g => {
      const id = g.dataset.knob!;
      g.addEventListener('wheel', e => { e.preventDefault(); knobs[id].step(e.deltaY < 0 ? 1 : -1, e.shiftKey || Math.abs(e.deltaY) > 80); this.refreshMcp(); }, { passive: false });
      const val = g.querySelector<HTMLElement>('.mcp-val')!;
      val.ondblclick = val.onclick = () => {
        if (!knobs[id].set) return;
        const v = prompt(`${id.toUpperCase()} 값 입력`, val.textContent ?? '');
        if (v !== null && v.trim() !== '' && !isNaN(+v)) { knobs[id].set!(+v); this.refreshMcp(); }
      };
      this.mcpEls[id] = val;
    });
    this.mcp.querySelectorAll<HTMLButtonElement>('[data-act]').forEach(b => b.onclick = () => { this.act(b.dataset.act!); this.refreshMcp(); });
    document.getElementById('mwarn')!.onclick = document.getElementById('mcaut')!.onclick = () => this.sys.ackMaster();
    this.knobs = knobs;
  }
  private knobs: Record<string, { get: () => string }> = {};

  refreshMcp() {
    for (const [id, el] of Object.entries(this.mcpEls)) { const t = this.knobs[id].get(); if (el.textContent !== t) el.textContent = t; }
    const f = this.fcs;
    const on = (id: string, v: boolean, armed = false) => { const e = document.getElementById('mb_' + id); if (e) { e.classList.toggle('on', v); e.classList.toggle('armed', armed && !v); } };
    on('ap', f.ap); on('athr', f.athr !== 'OFF'); on('fd', f.fd); on('sas', f.sas);
    on('hdg', f.lat === 'HDG'); on('nav', f.lat === 'NAV'); on('loc', f.lat === 'LOC', f.latArmed === 'LOC'); on('app', f.vert === 'GS' || f.vert === 'FLARE', f.vertArmed === 'GS');
    on('alt', f.vert === 'ALT' || f.vert === 'ALT*'); on('vs', f.vert === 'VS'); on('flc', f.vert === 'FLC'); on('toga', f.vert === 'TOGA'); on('spdmach', f.spdIsMach);
    document.getElementById('mwarn')!.className = 'mwbtn' + (this.sys.masterWarning ? ' w' : '');
    document.getElementById('mcaut')!.className = 'mwbtn' + (this.sys.masterCaution ? ' c' : '');
  }

  // ───────────────────────── pedestal readout ─────────────────────────
  private pedT = 0;
  updatePedestal(dt: number, throttleLever: number) {
    this.pedT -= dt;
    if (this.pedT > 0) return;
    this.pedT = 0.1;
    const a = this.ac;
    const thr = a.engineCmd[0]?.throttle ?? 0;
    const rev = a.engines.some(e => e.rev > 0.1);
    const heli = a.isRotor;
    const parts = [
      heli ? `COLL <span class="thr-bar"><i style="width:${Math.round(a.collective * 100)}%"></i></span> <span class="pv">${Math.round(a.collective * 100)}%</span>`
        : `THR <span class="thr-bar"><i style="width:${Math.round(thr * 100)}%"></i></span> <span class="${rev ? 'pa' : 'pv'}">${rev ? 'REV' : Math.round(thr * 100) + '%'}</span>${a.def.eng.ab ? (thr > 0.955 ? ' <span class="pa">AB</span>' : thr > 0.94 ? ' <span class="pv">MIL</span>' : '') : ''}`,
      !heli && a.def.flaps !== 'none' ? `FLAPS <span class="${a.flapPos !== a.flapsDeg ? 'pa' : 'pv'}">${a.flapLabel}</span>` : '',
      a.def.gear.retract ? `GEAR <span class="${a.gearPos > 0.99 ? 'pv' : 'pa'}">${a.gearPos > 0.99 ? 'DOWN' : a.gearPos < 0.01 ? 'UP' : 'TRANSIT'}</span>` : '',
      a.def.spoilers ? `SPLR <span class="${a.spoilerPos > 0.05 ? 'pa' : 'pv'}">${a.spoilerArm ? 'ARM ' : ''}${Math.round(Math.min(1, a.spoilerPos) * 100)}%</span>` : '',
      `TRIM <span class="pv">${(a.trim * 100).toFixed(0)}</span>`,
      `BRK <span class="${a.parkingBrake ? 'pa' : 'pv'}">${a.parkingBrake ? 'PARK' : Math.round(Math.max(a.brakeL, a.brakeR) * 100) + '%'}</span>`,
      `GS <span class="pv">${Math.round(a.gs / KT)}kt</span>`,
      `AGL <span class="pv">${Math.max(0, Math.round((a.agl - a.aero.cgHeight) / FT))}ft</span>`,
      `FUEL <span class="pv">${Math.round(a.fuel).toLocaleString()}kg</span>`,
    ];
    this.ped.innerHTML = parts.filter(Boolean).join('');
    void throttleLever;
  }

  // ───────────────────────── overhead ─────────────────────────
  buildOverhead() {
    const body = document.querySelector('#overhead .win-body')!;
    const s = this.sys.sw;
    const n = this.ac.engines.length;
    const sw = (key: keyof Switches, label: string, idx?: number) => `<div class="sw"><button data-sw="${key}" ${idx !== undefined ? `data-i="${idx}"` : ''}>${label}</button></div>`;
    const engs = Array.from({ length: n }, (_, i) => sw('engMaster', `ENG ${i + 1} MASTER`, i) + sw('starter', `ENG ${i + 1} START`, i)).join('');
    body.innerHTML = `
      <div class="sw-sec"><h4>ELECTRICAL</h4><div class="sw-grid">${sw('battery', 'BATTERY')}${sw('avionics', 'AVIONICS')}${this.ac.def.apu ? sw('apu', 'APU') + sw('apuBleed', 'APU BLEED') : ''}</div></div>
      <div class="sw-sec"><h4>FUEL / ENGINE</h4><div class="sw-grid">${sw('fuelPump', 'FUEL PUMPS')}${sw('ignition', 'IGNITION')}${engs}</div></div>
      <div class="sw-sec"><h4>EXTERIOR LIGHTS</h4><div class="sw-grid">${sw('beacon', 'BEACON')}${sw('nav', 'NAV')}${sw('strobe', 'STROBE')}${sw('landing', 'LANDING')}${sw('taxi', 'TAXI')}</div></div>
      <div class="sw-sec"><h4>MISC</h4><div class="sw-grid">${sw('antiIce', 'ANTI-ICE')}${sw('seatbelt', 'SEATBELT')}</div></div>
      <div class="sw-sec"><h4>PROCEDURES</h4><div style="display:flex;gap:6px"><button id="ohAuto" class="primary">AUTO START (Ctrl+E)</button><button id="ohShut">SHUTDOWN</button><button id="ohAutobrk">AUTOBRAKE: <span id="abv">OFF</span></button></div>
      <p class="note">제트기: BATTERY → APU → (APU AVAIL) → APU BLEED → FUEL PUMPS → ENG MASTER → ENG START. 피스톤: BATTERY → FUEL PUMP → ENG MASTER(마그네토) → START.</p></div>`;
    body.querySelectorAll<HTMLButtonElement>('[data-sw]').forEach(b => b.onclick = () => {
      const k = b.dataset.sw as keyof Switches;
      if (b.dataset.i !== undefined) { const arr = s[k] as boolean[]; arr[+b.dataset.i] = !arr[+b.dataset.i]; }
      else (s as unknown as Record<string, boolean>)[k] = !(s as unknown as Record<string, boolean>)[k];
      this.refreshOverhead();
    });
    (body.querySelector('#ohAuto') as HTMLButtonElement).onclick = () => this.act('autostart');
    (body.querySelector('#ohShut') as HTMLButtonElement).onclick = () => this.act('shutdown');
    (body.querySelector('#ohAutobrk') as HTMLButtonElement).onclick = () => { this.ac.autobrake = (this.ac.autobrake + 1) % 4; this.refreshOverhead(); };
    this.refreshOverhead();
  }
  refreshOverhead() {
    const s = this.sys.sw;
    document.querySelectorAll<HTMLButtonElement>('#overhead [data-sw]').forEach(b => {
      const v = s[b.dataset.sw as keyof Switches];
      b.classList.toggle('on', Array.isArray(v) ? v[+b.dataset.i!] : !!v);
    });
    const ab = document.getElementById('abv');
    if (ab) ab.textContent = ['OFF', 'LO', 'MED', 'MAX'][this.ac.autobrake];
  }

  // ───────────────────────── checklist ─────────────────────────
  private buildChecklist() {
    const cl = checklistFor(this.ac.def);
    if (!this.clTab || !cl[this.clTab]) this.clTab = Object.keys(cl)[0];
    const body = document.querySelector('#checklist .win-body')!;
    body.innerHTML = `<div class="cl-tabs">${Object.keys(cl).map(k => `<button data-t="${k}" class="${k === this.clTab ? 'on' : ''}">${k}</button>`).join('')}</div>` +
      cl[this.clTab].map(([i, v]) => { const key = this.clTab + i; return `<div class="cl-item ${this.clDone.has(key) ? 'done' : ''}" data-k="${key}"><span>${i}</span><span>${v}</span></div>`; }).join('');
    body.querySelectorAll<HTMLButtonElement>('[data-t]').forEach(b => b.onclick = () => { this.clTab = b.dataset.t!; this.buildChecklist(); });
    body.querySelectorAll<HTMLElement>('.cl-item').forEach(it => it.onclick = () => { const k = it.dataset.k!; if (this.clDone.has(k)) this.clDone.delete(k); else this.clDone.add(k); it.classList.toggle('done'); });
  }

  // ───────────────────────── FMS / radios ─────────────────────────
  buildFms() {
    const body = document.querySelector('#fmswin .win-body')!;
    const p = this.fcs.plan;
    body.innerHTML = `
      <div class="fms-row"><label>DIRECT TO</label><input id="fmsDct" placeholder="식별자 (공항/VOR/NDB)"><button id="fmsDctGo">DCT</button></div>
      <div class="fms-row"><label>INSERT WPT</label><input id="fmsIns" placeholder="현재 TO 앞에 추가"><button id="fmsInsGo">INS</button></div>
      <div class="wp-list" id="fmsList"></div>
      <div class="fms-row" style="margin-top:8px"><label>NAV1 VOR</label><input id="vorFreq" placeholder="주파수 (예: 113.60) 또는 식별자"><button id="vorGo">TUNE</button></div>
      <div class="fms-row"><label>OBS / CRS</label><input id="vorObs" type="number" value="${this.av.vor?.obs ?? 0}"><button id="obsGo">SET</button></div>
      <div class="note" id="vorInfo">${this.av.vor ? `${this.av.vor.ident} ${(this.av.vor.freq / 1000).toFixed(2)}` : 'VOR 미동조'}</div>
      <div class="note">ILS: ${p.approach ? `${p.approach.airport} RWY ${p.approach.runway} · CRS ${Math.round(wrap360(p.approach.crs - magVar(p.approach.thr.lat, p.approach.thr.lon)))}°` : '도착 활주로 미설정'}</div>`;
    const list = body.querySelector<HTMLElement>('#fmsList')!;
    list.innerHTML = p.wps.map((w, i) => `<div class="${i === p.active ? 'act' : ''}" data-i="${i}"><span>${i === p.active ? '▶ ' : ''}${w.ident}</span><span>${w.lat.toFixed(3)} ${w.lon.toFixed(3)}</span></div>`).join('') || '<div class="dim">경로 없음</div>';
    list.querySelectorAll<HTMLElement>('[data-i]').forEach(d => d.onclick = () => { const w = p.wps[+d.dataset.i!]; p.directTo(w, this.ac); this.fcs.msg = `DIRECT TO ${w.ident}`; this.buildFms(); });
    const $ = (id: string) => body.querySelector<HTMLInputElement>('#' + id)!;
    $('fmsDctGo').onclick = () => {
      const w = this.db.resolve($('fmsDct').value, this.ac);
      if (!w) { this.fcs.msg = 'NOT IN DATABASE'; return; }
      p.directTo(w, this.ac); if (this.fcs.lat !== 'NAV') this.fcs.setLat('NAV'); this.buildFms();
    };
    $('fmsInsGo').onclick = () => {
      const w = this.db.resolve($('fmsIns').value, this.ac);
      if (!w) { this.fcs.msg = 'NOT IN DATABASE'; return; }
      p.wps.splice(p.active, 0, w); this.buildFms();
    };
    $('vorGo').onclick = () => {
      const v = $('vorFreq').value.trim();
      const n = /^\d/.test(v) ? this.db.findByFreq(Math.round(+v * (+v < 200 ? 1000 : 1)), this.ac) : this.db.findNavaid(v, this.ac);
      if (!n) { this.fcs.msg = 'VOR NOT FOUND'; return; }
      this.av.vor = { ident: n.ident, lat: n.lat, lon: n.lon, freq: n.freq, obs: this.av.vor?.obs ?? 0 };
      this.av.navSource = 'VOR';
      this.buildFms();
    };
    $('obsGo').onclick = () => { if (this.av.vor) this.av.vor.obs = wrap360(+$('vorObs').value); };
  }

  draw(dt: number) {
    const av = this.av;
    this.pfd?.draw(av, dt);
    this.nd?.draw(av);
    this.eicas?.draw(av);
    this.six?.draw(av, dt);
    if (this.mapNd && !document.getElementById('mapwin')!.classList.contains('hidden')) {
      this.mapNd.draw({ ...av, ndMode: 'PLAN', ndRange: this.mapRange });
      const i = document.getElementById('mapInfo'); if (i) i.textContent = `${this.mapRange} NM · PLAN (North-up)`;
    }
  }
}
