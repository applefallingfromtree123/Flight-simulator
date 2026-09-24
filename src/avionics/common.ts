import type { Aircraft } from '../sim/fdm.ts';
import type { FCS } from '../sim/fcs.ts';
import type { Systems } from '../sim/systems.ts';
import type { AirportDB } from '../world/airports.ts';
import { G0, KT } from '../core/math.ts';

export interface AvData {
  ac: Aircraft; fcs: FCS; sys: Systems; db: AirportDB;
  ndRange: number; ndMode: 'ARC' | 'ROSE' | 'PLAN';
  navSource: 'GPS' | 'LOC' | 'VOR';
  vor: { ident: string; lat: number; lon: number; freq: number; obs: number } | null;
  zulu: Date;
}

export const C = {
  bg: '#05070a', white: '#f2f4f7', green: '#3ee07a', cyan: '#35d6f0', magenta: '#e45bf2', amber: '#ffb020',
  red: '#ff3b3b', grey: '#6b737d', sky: '#1f63b8', ground: '#7a4a1f', yellow: '#ffe14d', dim: '#9aa3ad',
};
export const FONT = '"B612 Mono", "Consolas", "DejaVu Sans Mono", monospace';

export class Display {
  cv: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  constructor(parent: HTMLElement, public w: number, public h: number, cls = 'du') {
    this.cv = document.createElement('canvas');
    this.cv.className = cls;
    parent.appendChild(this.cv);
    this.g = this.cv.getContext('2d')!;
  }
  /** Scale the logical w×h drawing to the element's CSS size (crisp on HiDPI). */
  begin(): CanvasRenderingContext2D {
    const r = this.cv.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr));
    if (this.cv.width !== W || this.cv.height !== H) { this.cv.width = W; this.cv.height = H; }
    const g = this.g;
    const s = Math.min(W / this.w, H / this.h);
    g.setTransform(s, 0, 0, s, (W - this.w * s) / 2, (H - this.h * s) / 2);
    g.fillStyle = C.bg;
    g.fillRect(-1000, -1000, this.w + 2000, this.h + 2000);
    return g;
  }
}

export function text(g: CanvasRenderingContext2D, s: string, x: number, y: number, color = C.white, size = 14, align: CanvasTextAlign = 'center', base: CanvasTextBaseline = 'middle') {
  g.fillStyle = color; g.font = `${size}px ${FONT}`; g.textAlign = align; g.textBaseline = base;
  g.fillText(s, x, y);
}
export function box(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, stroke = C.white, fill = '#000', lw = 1.5) {
  g.fillStyle = fill; g.fillRect(x, y, w, h);
  g.strokeStyle = stroke; g.lineWidth = lw; g.strokeRect(x, y, w, h);
}
export function line(g: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color = C.white, lw = 1.5) {
  g.strokeStyle = color; g.lineWidth = lw; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
}
/** Round dial gauge: value mapped over [a0,a1] degrees. */
export function dial(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, v: number, min: number, max: number, label: string, readout: string,
  opts: { redline?: number; amber?: number; green?: [number, number]; a0?: number; a1?: number; color?: string } = {}) {
  const a0 = (opts.a0 ?? 135) * Math.PI / 180, a1 = (opts.a1 ?? 405) * Math.PI / 180;
  const ang = (x: number) => a0 + (a1 - a0) * Math.min(1.05, Math.max(0, (x - min) / (max - min)));
  g.lineWidth = 2;
  g.strokeStyle = C.white; g.beginPath(); g.arc(cx, cy, r, a0, opts.redline !== undefined ? ang(opts.redline) : a1); g.stroke();
  if (opts.green) { g.strokeStyle = C.green; g.lineWidth = 4; g.beginPath(); g.arc(cx, cy, r - 3, ang(opts.green[0]), ang(opts.green[1])); g.stroke(); }
  if (opts.amber !== undefined) { g.strokeStyle = C.amber; g.lineWidth = 4; g.beginPath(); g.arc(cx, cy, r - 3, ang(opts.amber), ang(opts.redline ?? max)); g.stroke(); }
  if (opts.redline !== undefined) { const a = ang(opts.redline); line(g, cx + Math.cos(a) * (r - 8), cy + Math.sin(a) * (r - 8), cx + Math.cos(a) * (r + 6), cy + Math.sin(a) * (r + 6), C.red, 3); }
  const a = ang(v);
  const over = opts.redline !== undefined && v > opts.redline;
  g.fillStyle = 'rgba(255,255,255,0.08)'; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, r - 2, a0, a); g.closePath(); g.fill();
  line(g, cx, cy, cx + Math.cos(a) * (r - 2), cy + Math.sin(a) * (r - 2), over ? C.red : opts.color ?? C.white, 3);
  box(g, cx + 2, cy - 12, r - 2, 22, over ? C.red : C.grey);
  text(g, readout, cx + r - 3, cy, over ? C.red : opts.color ?? C.green, 15, 'right');
  text(g, label, cx, cy + r * 0.62, C.cyan, 12);
}
/** Stall speed (kt IAS) in the current configuration and weight, 1 g. */
export function stallSpeed(ac: Aircraft, nz = 1): number {
  const A = ac.aero;
  const f = A.flaps[ac.flapIdx];
  const CLmax = A.CLmax + f.dCLmax;
  return Math.sqrt((2 * ac.mass * G0 * Math.max(nz, 0.3)) / (1.225 * ac.def.S * CLmax)) / KT;
}
export function pad(n: number, w: number) { return String(Math.round(n)).padStart(w, '0'); }
