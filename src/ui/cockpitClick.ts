// Clickable cockpit: taps on the 3D cockpit's FCU/MCP strip press its buttons and turn its knobs; taps on a real
// cockpit's autopilot windows, PFD or ND open a small glass pop-up right where you tapped (like MSFS knob tooltips).
import type { Cockpit } from './cockpit.ts';
import type { FCS } from '../sim/fcs.ts';
import { fcuHit, type FcuGroup } from '../world/cockpit3d.ts';
import type { CockpitZone } from '../world/scene.ts';

/** One control in a cockpit zone pop-up: a button (with a lit state) or a slider. */
export interface ZoneItem { label: () => string; on?: () => boolean; press?: () => void; slider?: { get: () => number; set: (v: number) => void }; wide?: boolean }
export type ZoneSpec = (z: Exclude<CockpitZone, 'glareshield'>) => { title: string; items: ZoneItem[] };

type Target = FcuGroup | 'ap' | 'nd' | Exclude<CockpitZone, 'glareshield'>;
const TITLE: Record<Target, string> = { spd: '속도 SPD', hdg: '방향 HDG', alt: '고도 ALT', vs: '승강률 V/S', ap: '자동비행 (MCP)', nd: '항법 화면 ND', pedestal: '페데스털', overhead: '오버헤드', panel: '계기판' };
const STEPS: Record<FcuGroup, [number, number]> = { spd: [1, 10], hdg: [1, 10], alt: [100, 1000], vs: [100, 500] };
const MODES: Record<FcuGroup, [string, string][]> = {
  spd: [['spdmng', 'SPD MNG'], ['spdmach', 'SPD/MACH'], ['flc', 'FLC'], ['athr', 'A/THR']],
  hdg: [['hdg', 'HDG'], ['nav', 'NAV'], ['loc', 'LOC'], ['app', 'APPR']],
  alt: [['alt', 'ALT HOLD'], ['vnav', 'VNAV'], ['flc', 'FLC'], ['vs', 'V/S']],
  vs: [['vs', 'V/S'], ['alt', 'ALT HOLD']],
};

export class CockpitClick {
  private el: HTMLDivElement;
  private target: Target | null = null;
  private timer = 0;

  private zone: ReturnType<ZoneSpec> | null = null;
  constructor(private cockpit: () => Cockpit | null, private fcs: () => FCS | null, private click: () => void, private zones: ZoneSpec) {
    this.el = document.createElement('div');
    this.el.id = 'ckpop';
    this.el.className = 'hidden';
    document.body.appendChild(this.el);
    // stop taps on the pop-up from reaching the 3D view (head look / another cockpit tap)
    for (const ev of ['pointerdown', 'pointerup', 'wheel']) this.el.addEventListener(ev, e => e.stopPropagation());
  }

  get open() { return this.target !== null; }
  close() { this.target = null; this.el.classList.add('hidden'); clearInterval(this.timer); }

  /** A tap in the cockpit view resolved by World.cockpitHit. */
  tap(hit: ReturnType<import('../world/scene.ts').World['cockpitHit']>, x: number, y: number) {
    if (!hit) { this.close(); return false; }
    const ck = this.cockpit();
    if (!ck) return false;
    if (hit.kind === 'fcu') {
      const z = fcuHit(hit.u, hit.v);
      if (!z) return false;
      this.click();
      if ('act' in z) { ck.press(z.act); return true; }
      if (z.part === 'minus' || z.part === 'plus') ck.knob(z.group, z.part === 'plus' ? 1 : -1);
      else if (z.part === 'label') ck.press(z.group === 'spd' ? 'spdmng' : z.group);
      else this.show(z.group, x, y);
      return true;
    }
    this.click();
    if (hit.kind === 'gear') { ck.press('gear'); return true; }
    if (hit.kind === 'zone') { this.show(hit.zone === 'glareshield' ? 'ap' : hit.zone, x, y); return true; }
    this.show(hit.kind === 'group' ? hit.group : hit.kind === 'nd' ? 'nd' : 'ap', x, y);
    return true;
  }

  /** Mouse wheel over a knob window: turn it. */
  wheel(hit: ReturnType<import('../world/scene.ts').World['cockpitHit']>, up: boolean, big: boolean) {
    const ck = this.cockpit();
    if (!hit || !ck) return false;
    let g: FcuGroup | null = null;
    if (hit.kind === 'group') g = hit.group;
    if (hit.kind === 'fcu') { const z = fcuHit(hit.u, hit.v); if (z && 'group' in z) g = z.group; }
    if (!g) return false;
    ck.knob(g, up ? 1 : -1, big);
    return true;
  }

  private show(t: Target, x: number, y: number) {
    this.target = t;
    this.render();
    const el = this.el;
    el.classList.remove('hidden');
    const w = el.offsetWidth || 300, h = el.offsetHeight || 200;
    el.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2))}px`;
    el.style.top = `${Math.max(48, Math.min(window.innerHeight - h - 8, y - h - 18))}px`;
    clearInterval(this.timer);
    this.timer = window.setInterval(() => this.refresh(), 250);
  }

  private groupHtml(g: FcuGroup) {
    const [s1, s2] = STEPS[g];
    return `<div class="ck-row"><button data-k="${g}" data-d="-${s2 / s1}">−${s2}</button><button data-k="${g}" data-d="-1">−${s1}</button>
      <div class="ck-val" data-v="${g}"></div><button data-k="${g}" data-d="1">+${s1}</button><button data-k="${g}" data-d="${s2 / s1}">+${s2}</button></div>`;
  }

  private render() {
    const t = this.target;
    if (!t) return;
    let body = '';
    this.zone = null;
    if (t === 'pedestal' || t === 'overhead' || t === 'panel') {
      const z = this.zone = this.zones(t);
      body = z.items.map((it, i) => it.slider
        ? `<div class="ck-slider"><span data-zl="${i}"></span><input type="range" min="0" max="100" data-zs="${i}"></div>`
        : '').join('') +
        `<div class="ck-modes">${z.items.map((it, i) => it.slider ? '' : `<button data-z="${i}" class="${it.wide ? 'wide' : ''}"></button>`).join('')}</div>`;
    } else if (t === 'nd') {
      body = `<div class="ck-row"><button data-k="rng" data-d="-1">RANGE −</button><div class="ck-val" data-v="rng"></div><button data-k="rng" data-d="1">RANGE +</button></div>
        <div class="ck-modes"><button data-a="ndmode">ND MODE</button><button data-a="navsrc">NAV SRC</button></div>`;
    } else if (t === 'ap') {
      body = (['spd', 'hdg', 'alt', 'vs'] as FcuGroup[]).map(g => `<div class="ck-lbl">${TITLE[g]}</div>${this.groupHtml(g)}`).join('') +
        `<div class="ck-modes">${[['ap', 'AP'], ['athr', 'A/THR'], ['fd', 'FD'], ['hdg', 'HDG'], ['nav', 'NAV'], ['vnav', 'VNAV'], ['app', 'APPR'], ['flc', 'FLC'], ['alt', 'ALT'], ['vs', 'V/S'], ['spdmng', 'SPD MNG'], ['toga', 'TOGA']]
          .map(([a, l]) => `<button data-a="${a}">${l}</button>`).join('')}</div>`;
    } else {
      body = this.groupHtml(t) + `<div class="ck-modes">${[['ap', 'AP'], ...MODES[t]].map(([a, l]) => `<button data-a="${a}">${l}</button>`).join('')}</div>`;
    }
    this.el.innerHTML = `<div class="ck-head"><b>${this.zone?.title ?? TITLE[t]}</b><button class="ck-x" data-close>✕</button></div>${body}
      ${this.zone ? '' : '<div class="ck-note">값을 눌러 직접 입력 · 데스크톱은 창 위에서 마우스 휠</div>'}`;
    const ck = this.cockpit();
    this.el.querySelector<HTMLButtonElement>('[data-close]')!.onclick = () => this.close();
    this.el.querySelectorAll<HTMLButtonElement>('[data-k]').forEach(b => b.onclick = () => { ck?.knob(b.dataset.k!, Math.sign(+b.dataset.d!), Math.abs(+b.dataset.d!) > 1); this.click(); this.refresh(); });
    this.el.querySelectorAll<HTMLButtonElement>('[data-a]').forEach(b => b.onclick = () => { ck?.press(b.dataset.a!); this.click(); this.refresh(); });
    this.el.querySelectorAll<HTMLButtonElement>('[data-z]').forEach(b => b.onclick = () => { this.zone?.items[+b.dataset.z!].press?.(); this.click(); this.refresh(); });
    this.el.querySelectorAll<HTMLInputElement>('[data-zs]').forEach(r => r.oninput = () => { this.zone?.items[+r.dataset.zs!].slider?.set(+r.value / 100); this.refresh(); });
    this.el.querySelectorAll<HTMLElement>('[data-v]').forEach(v => v.onclick = () => {
      const id = v.dataset.v!;
      if (id === 'rng') return;
      const s = prompt(`${TITLE[id as FcuGroup] ?? id} 값 입력`, ck?.knobValue(id).replace(/[()]/g, '') ?? '');
      if (s !== null && s.trim() !== '' && !isNaN(+s)) { ck?.knobSet(id, +s); this.refresh(); }
    });
    this.refresh();
  }

  private refresh() {
    const ck = this.cockpit(), f = this.fcs();
    if (!ck || !f || !this.target) return;
    if (this.zone) {
      const z = this.zone;
      this.el.querySelectorAll<HTMLButtonElement>('[data-z]').forEach(b => { const it = z.items[+b.dataset.z!]; const l = it.label(); if (b.textContent !== l) b.textContent = l; b.classList.toggle('on', !!it.on?.()); });
      this.el.querySelectorAll<HTMLInputElement>('[data-zs]').forEach(r => { const it = z.items[+r.dataset.zs!]; if (document.activeElement !== r) r.value = String(Math.round((it.slider!.get()) * 100)); });
      this.el.querySelectorAll<HTMLElement>('[data-zl]').forEach(s => { const l = z.items[+s.dataset.zl!].label(); if (s.textContent !== l) s.textContent = l; });
      return;
    }
    this.el.querySelectorAll<HTMLElement>('[data-v]').forEach(v => { const t = ck.knobValue(v.dataset.v!); if (v.textContent !== t) v.textContent = t; });
    const on: Record<string, boolean> = {
      ap: f.ap, athr: f.athr !== 'OFF', fd: f.fd, hdg: f.lat === 'HDG', nav: f.lat === 'NAV' || f.latArmed === 'NAV', loc: f.lat === 'LOC' || f.latArmed === 'LOC',
      app: f.vert === 'GS' || f.vertArmed === 'GS', vnav: f.vert === 'VNAV' || f.vertArmed === 'VNAV', flc: f.vert === 'FLC', alt: f.vert === 'ALT' || f.vert === 'ALT*',
      vs: f.vert === 'VS', spdmng: f.spdManaged, spdmach: f.spdIsMach, toga: f.vert === 'TOGA',
    };
    this.el.querySelectorAll<HTMLButtonElement>('[data-a]').forEach(b => b.classList.toggle('on', !!on[b.dataset.a!]));
  }
}
