// Keyboard + gamepad/joystick/HOTAS input. Continuous axes are smoothed; discrete keys map to actions.
import { approach, clamp, moveToward } from '../core/math.ts';

export interface AxisBind { index: number; invert: boolean; pad: number }
export interface GamepadConfig { roll?: AxisBind; pitch?: AxisBind; yaw?: AxisBind; throttle?: AxisBind; brake?: AxisBind; deadzone: number }

export const KEY_ACTIONS: Record<string, string> = {
  'KeyG': 'gear', 'F5': 'flaps-up-full', 'F6': 'flaps-up', 'F7': 'flaps-down', 'F8': 'flaps-full',
  'Slash': 'spoilers', 'Shift+Slash': 'spoilers-arm', 'Ctrl+Period': 'parking-brake', 'Shift+Period': 'parking-brake',
  'KeyZ': 'ap', 'Shift+KeyZ': 'athr', 'KeyH': 'hdg', 'KeyN': 'nav', 'KeyJ': 'alt', 'KeyV': 'vs', 'KeyK': 'flc', 'KeyU': 'app',
  'Shift+KeyT': 'toga', 'KeyP': 'pause', 'Equal': 'rate-up', 'Minus': 'rate-down',
  'Digit1': 'view-cockpit', 'Digit2': 'view-hud', 'Digit3': 'view-chase', 'Digit4': 'view-tower', 'Digit5': 'view-flyby', 'Digit6': 'view-free',
  'KeyL': 'lights', 'Ctrl+KeyE': 'autostart', 'KeyB': 'baro', 'Shift+KeyB': 'baro-std', 'KeyC': 'checklist', 'KeyM': 'map',
  'KeyO': 'overhead', 'Escape': 'menu', 'KeyR': 'reset', 'Space': 'master-ack', 'KeyF': 'fd', 'Shift+KeyR': 'rev-toggle',
  'KeyI': 'sas', 'Tab': 'panel-toggle', 'KeyX': 'ap-disconnect',
};

export class Controls {
  pitch = 0; roll = 0; yaw = 0;
  throttle = 0; reverse = false; brakes = 0; trim = 0; collective = 0;
  keys = new Set<string>();
  gp: GamepadConfig = { deadzone: 0.04 };
  gpActive = false;
  onAction: (a: string) => void = () => {};
  private keyThrottleDirty = false;
  headDelta = { yaw: 0, pitch: 0 };
  /** on-screen touch controls (merged like a joystick) */
  touch = { pitch: 0, roll: 0, yaw: 0, brake: 0, trim: 0, throttleMoved: false };

  constructor() {
    try { const s = localStorage.getItem('sky.gamepad'); if (s) this.gp = JSON.parse(s); } catch { /* ignore */ }
    window.addEventListener('keydown', e => this.down(e));
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }
  saveGamepad() { try { localStorage.setItem('sky.gamepad', JSON.stringify(this.gp)); } catch { /* ignore */ } }

  private down(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    const combo = (e.ctrlKey ? 'Ctrl+' : '') + (e.shiftKey ? 'Shift+' : '') + e.code;
    const action = KEY_ACTIONS[combo] ?? (e.shiftKey || e.ctrlKey ? undefined : KEY_ACTIONS[e.code]);
    if (/^F\d+$/.test(e.code) || e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Slash' || (e.ctrlKey && e.code === 'KeyE')) e.preventDefault();
    if (e.repeat && action) return;
    this.keys.add(e.code);
    if (action) this.onAction(action);
    if (e.code === 'F1') { this.throttle = 0; this.keyThrottleDirty = true; }
    if (e.code === 'F4') { this.throttle = 1; this.keyThrottleDirty = true; }
  }

  update(dt: number, opts: { heli: boolean; autoRudder: boolean }) {
    const k = this.keys;
    const held = (...c: string[]) => c.some(x => k.has(x));
    // keyboard stick: ramp while held, self-centre
    const ramp = (cur: number, neg: boolean, pos: boolean, rate = 1.6) =>
      neg && !pos ? moveToward(cur, -1, rate * dt * (cur > 0 ? 3 : 1)) : pos && !neg ? moveToward(cur, 1, rate * dt * (cur < 0 ? 3 : 1)) : moveToward(cur, 0, rate * 2 * dt);
    let kp = ramp(this.kPitch, held('ArrowUp', 'Numpad8'), held('ArrowDown', 'Numpad2'));
    let kr = ramp(this.kRoll, held('ArrowLeft', 'Numpad4'), held('ArrowRight', 'Numpad6'));
    let ky = ramp(this.kYaw, held('KeyQ', 'Numpad0'), held('KeyE', 'NumpadEnter'), 1.2);
    this.kPitch = kp; this.kRoll = kr; this.kYaw = ky;
    // throttle
    if (held('F3', 'PageUp') && !held('ShiftLeft')) { this.throttle = clamp(this.throttle + dt * 0.35, 0, 1); this.keyThrottleDirty = true; }
    if (held('F2', 'PageDown')) {
      if (this.throttle <= 0.001) this.reverse = true;
      this.throttle = clamp(this.throttle - dt * 0.35, 0, 1); this.keyThrottleDirty = true;
    } else if (this.reverse && !this.revLatched) this.reverse = false;
    if (held('F3', 'PageUp') && this.reverse) { this.reverse = false; this.revLatched = false; }
    // collective (helicopters): Shift+↑/↓ via PageUp/PageDown handled as throttle for fixed-wing
    if (opts.heli) {
      if (held('PageUp', 'F3')) this.collective = clamp(this.collective + dt * 0.3, 0, 1);
      if (held('PageDown', 'F2')) this.collective = clamp(this.collective - dt * 0.3, 0, 1);
      this.reverse = false;
    }
    this.trim = held('Home', 'Numpad7') ? 1 : held('End', 'Numpad1') ? -1 : 0;
    this.brakes = held('Period') ? 1 : 0;
    this.brakeL = held('Comma') ? 1 : 0; // differential: , left  (period = both)
    // head look (numpad hat / Shift+arrows handled by mouse in UI)
    // gamepad
    let gpP = 0, gpR = 0, gpY = 0;
    this.gpActive = false;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const read = (b?: AxisBind) => {
      if (!b) return undefined;
      const p = pads[b.pad];
      if (!p || p.axes.length <= b.index) return undefined;
      let v = p.axes[b.index];
      if (b.invert) v = -v;
      const dz = this.gp.deadzone;
      return Math.abs(v) < dz ? 0 : (v - Math.sign(v) * dz) / (1 - dz);
    };
    const r = read(this.gp.roll), p = read(this.gp.pitch), y = read(this.gp.yaw), th = read(this.gp.throttle), br = read(this.gp.brake);
    if (r !== undefined) { gpR = r; this.gpActive = true; }
    if (p !== undefined) { gpP = -p; this.gpActive = true; }
    if (y !== undefined) gpY = y;
    if (th !== undefined) {
      const v = clamp((1 - th) / 2, 0, 1);
      if (Math.abs(v - this.lastGpThr) > 0.01 || !this.keyThrottleDirty) { this.throttle = v; if (opts.heli) this.collective = v; this.keyThrottleDirty = false; }
      this.lastGpThr = v;
    }
    if (br !== undefined) this.brakes = Math.max(this.brakes, clamp((1 - br) / 2, 0, 1));
    // pad buttons (standard mapping) — A: gear? keep minimal: LB/RB flaps, X brakes
    for (const pad of pads) {
      if (!pad) continue;
      const btn = (i: number) => pad.buttons[i]?.pressed;
      if (btn(2)) this.brakes = 1;
      const edge = (i: number, act: string) => { const was = this.btnPrev.get(pad.index * 100 + i); const now = !!btn(i); if (now && !was) this.onAction(act); this.btnPrev.set(pad.index * 100 + i, now); };
      edge(4, 'flaps-up'); edge(5, 'flaps-down'); edge(3, 'gear'); edge(9, 'pause');
    }
    const t = this.touch;
    if (t.throttleMoved) { this.keyThrottleDirty = true; t.throttleMoved = false; }
    this.brakes = Math.max(this.brakes, t.brake);
    if (t.trim) this.trim = t.trim;
    this.pitch = clamp(gpP + kp + t.pitch, -1, 1);
    this.roll = clamp(gpR + kr + t.roll, -1, 1);
    this.yaw = clamp(gpY + ky + t.yaw, -1, 1);
    // non-linear response curve for fine control
    const curve = (v: number) => Math.sign(v) * (0.35 * Math.abs(v) + 0.65 * v * v);
    this.pitch = curve(this.pitch); this.roll = curve(this.roll);
    void approach;
  }
  brakeL = 0;
  private kPitch = 0; private kRoll = 0; private kYaw = 0;
  private lastGpThr = -1;
  private revLatched = false;
  private btnPrev = new Map<number, boolean>();

  /** Detect an axis the user is moving (for binding UI). */
  static detectAxis(baseline: number[][]): { pad: number; index: number } | null {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let best: { pad: number; index: number; d: number } | null = null;
    pads.forEach((p, pi) => {
      if (!p) return;
      p.axes.forEach((v, i) => {
        const d = Math.abs(v - (baseline[pi]?.[i] ?? 0));
        if (d > 0.5 && (!best || d > best.d)) best = { pad: pi, index: i, d };
      });
    });
    return best;
  }
  static snapshot(): number[][] {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    return Array.from(pads).map(p => (p ? [...p.axes] : []));
  }
}
