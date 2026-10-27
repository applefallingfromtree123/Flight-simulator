// On-screen touch controls (iPad / tablets): virtual stick, throttle/collective lever,
// rudder bar and the most-used cockpit buttons.
import { clamp } from '../core/math.ts';
import type { Controls } from '../input/controls.ts';

export class TouchControls {
  el: HTMLElement;
  enabled: boolean;
  private knob!: HTMLElement; private thumb!: HTMLElement; private thrLabel!: HTMLElement; private rudKnob!: HTMLElement;
  private heli = false;

  constructor(private c: Controls, private act: (a: string) => void) {
    const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
    let saved: string | null = null;
    try { saved = localStorage.getItem('sky.touch'); } catch { /* ignore */ }
    this.enabled = saved !== null ? saved === '1' : coarse || navigator.maxTouchPoints > 0;
    this.el = document.createElement('div');
    this.el.id = 'touch';
    this.el.className = 'hidden';
    document.body.appendChild(this.el);
    this.build();
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    try { localStorage.setItem('sky.touch', on ? '1' : '0'); } catch { /* ignore */ }
    if (!on) this.reset();
  }
  show(on: boolean, heli: boolean) {
    this.heli = heli;
    this.el.classList.toggle('hidden', !(on && this.enabled));
    const lab = this.el.querySelector<HTMLElement>('.t-thr-title');
    if (lab) lab.textContent = heli ? 'COLL' : 'THR';
  }
  private reset() { this.c.touch.pitch = this.c.touch.roll = this.c.touch.yaw = 0; this.c.touch.brake = 0; this.c.touch.trim = 0; }

  /** Keep the lever in sync when A/THR, keys or a joystick move the throttle. */
  sync(throttle: number) {
    if (this.draggingThr) return;
    this.thumb.style.bottom = `${throttle * 100}%`;
    this.thrLabel.textContent = `${Math.round(throttle * 100)}%`;
  }
  private draggingThr = false;

  private build() {
    this.el.innerHTML = `
      <div class="t-thr"><div class="t-thr-title">THR</div><div class="t-track"><div class="t-thumb"></div></div><div class="t-thr-val">0%</div></div>
      <div class="t-left-btns">
        <button data-a="rev" class="t-btn">REV</button>
        <button data-hold="brake" class="t-btn">BRAKE</button>
        <button data-a="parking-brake" class="t-btn">PARK</button>
      </div>
      <div class="t-stick"><div class="t-knob"></div></div>
      <div class="t-rudder"><div class="t-rud-knob"></div><span>RUDDER</span></div>
      <div class="t-btns">
        <button data-a="gear" class="t-btn">GEAR</button>
        <button data-a="flaps-up" class="t-btn">FLAP −</button>
        <button data-a="flaps-down" class="t-btn">FLAP +</button>
        <button data-a="spoilers" class="t-btn">SPD BRK</button>
        <button data-hold="trim-up" class="t-btn">TRIM ▲</button>
        <button data-hold="trim-dn" class="t-btn">TRIM ▼</button>
        <button data-a="ap" class="t-btn">AP</button>
        <button data-a="athr" class="t-btn">A/THR</button>
        <button data-a="view-next" class="t-btn">VIEW</button>
        <button data-a="pause" class="t-btn">⏸</button>
      </div>`;
    const stick = this.el.querySelector<HTMLElement>('.t-stick')!;
    this.knob = stick.querySelector('.t-knob')!;
    const track = this.el.querySelector<HTMLElement>('.t-track')!;
    this.thumb = track.querySelector('.t-thumb')!;
    this.thrLabel = this.el.querySelector('.t-thr-val')!;
    const rud = this.el.querySelector<HTMLElement>('.t-rudder')!;
    this.rudKnob = rud.querySelector('.t-rud-knob')!;

    // virtual stick (springs back to centre)
    const stickMove = (e: PointerEvent) => {
      const r = stick.getBoundingClientRect();
      const x = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1);
      const y = clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1);
      this.c.touch.roll = x; this.c.touch.pitch = y; // drag down (toward you) = pull = nose up
      this.knob.style.transform = `translate(${x * 50}%, ${y * 50}%)`;
    };
    this.drag(stick, stickMove, () => { this.c.touch.roll = this.c.touch.pitch = 0; this.knob.style.transform = ''; });
    // throttle / collective lever (stays where you leave it)
    const thrMove = (e: PointerEvent) => {
      const r = track.getBoundingClientRect();
      const v = clamp(1 - (e.clientY - r.top) / r.height, 0, 1);
      if (this.heli) this.c.collective = v; else { this.c.throttle = v; this.act('athr-off'); }
      this.c.touch.throttleMoved = true;
      this.thumb.style.bottom = `${v * 100}%`;
      this.thrLabel.textContent = `${Math.round(v * 100)}%`;
    };
    this.drag(track, e => { this.draggingThr = true; thrMove(e); }, () => { this.draggingThr = false; });
    // rudder bar (springs back)
    const rudMove = (e: PointerEvent) => {
      const r = rud.getBoundingClientRect();
      const x = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1);
      this.c.touch.yaw = x;
      this.rudKnob.style.left = `${(x + 1) * 50}%`;
    };
    this.drag(rud, rudMove, () => { this.c.touch.yaw = 0; this.rudKnob.style.left = '50%'; });
    // buttons
    this.el.querySelectorAll<HTMLButtonElement>('[data-a]').forEach(b => b.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      const a = b.dataset.a!;
      if (a === 'rev') { this.c.reverse = !this.c.reverse; b.classList.toggle('on', this.c.reverse); return; }
      this.act(a);
      if (a === 'parking-brake') b.classList.toggle('on');
    }));
    this.el.querySelectorAll<HTMLButtonElement>('[data-hold]').forEach(b => {
      const k = b.dataset.hold!;
      const set = (on: boolean) => {
        b.classList.toggle('on', on);
        if (k === 'brake') this.c.touch.brake = on ? 1 : 0;
        else this.c.touch.trim = on ? (k === 'trim-up' ? -1 : 1) : 0; // ▲ = nose down (trim wheel forward)
      };
      b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); b.setPointerCapture(e.pointerId); set(true); });
      b.addEventListener('pointerup', () => set(false));
      b.addEventListener('pointercancel', () => set(false));
    });
  }

  private drag(el: HTMLElement, move: (e: PointerEvent) => void, end: () => void) {
    let id = -1;
    el.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); id = e.pointerId; el.setPointerCapture(id); move(e); });
    el.addEventListener('pointermove', e => { if (e.pointerId === id) move(e); });
    const up = (e: PointerEvent) => { if (e.pointerId !== id) return; id = -1; end(); };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }
}
