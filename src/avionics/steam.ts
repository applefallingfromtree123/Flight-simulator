// Classic analogue flight instruments ("six-pack"): ASI, AI, ALT, TC, HSI/DG, VSI.
import { DEG, FPM, FT, KT, RAD, clamp, wrap180, wrap360 } from '../core/math.ts';
import { indicatedAltitude } from '../sim/atmosphere.ts';
import { magVar } from '../core/geo.ts';
import { C, Display, line, text, type AvData } from './common.ts';

export class SixPack extends Display {
  private gyroHdg = 0; private turnRate = 0;
  constructor(parent: HTMLElement) { super(parent, 630, 420, 'du sixpack'); }

  private bezel(g: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
    const grd = g.createRadialGradient(cx, cy, r * 0.9, cx, cy, r * 1.08);
    grd.addColorStop(0, '#111'); grd.addColorStop(1, '#3a3d42');
    g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, r * 1.08, 0, 7); g.fill();
    g.fillStyle = '#0b0b0c'; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill();
  }
  private needle(g: CanvasRenderingContext2D, cx: number, cy: number, a: number, len: number, w = 4, col = '#f5f5f5') {
    g.save(); g.translate(cx, cy); g.rotate(a);
    g.fillStyle = col; g.beginPath(); g.moveTo(-w / 2, 10); g.lineTo(0, -len); g.lineTo(w / 2, 10); g.fill();
    g.fillStyle = '#222'; g.beginPath(); g.arc(0, 0, 6, 0, 7); g.fill();
    g.restore();
  }
  private ticks(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, n: number, a0: number, a1: number, major: number, labels?: (i: number) => string) {
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * i / n - Math.PI / 2;
      const big = i % major === 0;
      line(g, cx + Math.cos(a) * r, cy + Math.sin(a) * r, cx + Math.cos(a) * (r - (big ? 12 : 6)), cy + Math.sin(a) * (r - (big ? 12 : 6)), '#eee', big ? 2 : 1);
      if (big && labels) text(g, labels(i), cx + Math.cos(a) * (r - 24), cy + Math.sin(a) * (r - 24), '#eee', 13);
    }
  }

  draw(d: AvData, dt: number) {
    const g = this.begin();
    g.fillStyle = '#1c1f23'; g.fillRect(0, 0, 630, 420);
    const { ac, sys, fcs } = d;
    const r = 88;
    const P = [[105, 105], [315, 105], [525, 105], [105, 315], [315, 315], [525, 315]];
    P.forEach(([x, y]) => this.bezel(g, x, y, r));
    // ASI
    {
      const [cx, cy] = P[0];
      const v = ac.def.v;
      const vmax = Math.max(160, Math.ceil(v.vmo * 1.15 / 20) * 20);
      const ang = (k: number) => (clamp(k, 0, vmax) / vmax) * 330 * DEG - Math.PI / 2;
      const arc = (a: number, b: number, col: string, rr: number) => { g.strokeStyle = col; g.lineWidth = 6; g.beginPath(); g.arc(cx, cy, rr, ang(a), ang(b)); g.stroke(); };
      arc(v.vs0, v.vfe, '#fff', r - 12);
      arc(v.vs1, v.vmo * 0.87, C.green, r - 5);
      arc(v.vmo * 0.87, v.vmo, C.yellow, r - 5);
      line(g, cx + Math.cos(ang(v.vmo)) * (r - 12), cy + Math.sin(ang(v.vmo)) * (r - 12), cx + Math.cos(ang(v.vmo)) * r, cy + Math.sin(ang(v.vmo)) * r, C.red, 4);
      for (let k = 0; k <= vmax; k += 10) {
        const a = ang(k);
        const big = k % 20 === 0;
        line(g, cx + Math.cos(a) * (r - 2), cy + Math.sin(a) * (r - 2), cx + Math.cos(a) * (r - (big ? 14 : 8)), cy + Math.sin(a) * (r - (big ? 14 : 8)), '#eee', 1.5);
        if (big && k % (vmax > 250 ? 40 : 20) === 0) text(g, String(k), cx + Math.cos(a) * (r - 28), cy + Math.sin(a) * (r - 28), '#eee', 12);
      }
      text(g, 'KNOTS', cx, cy + 30, '#ccc', 10);
      this.needle(g, cx, cy, ang(ac.ias / KT) + Math.PI / 2, r - 10);
    }
    // Attitude indicator
    {
      const [cx, cy] = P[1];
      g.save(); g.beginPath(); g.arc(cx, cy, r - 2, 0, 7); g.clip();
      g.translate(cx, cy); g.rotate(-ac.phi);
      const hy = clamp(ac.theta * RAD, -40, 40) * 3.2;
      g.fillStyle = '#2c7fd6'; g.fillRect(-200, -400 + hy, 400, 400);
      g.fillStyle = '#6b4020'; g.fillRect(-200, hy, 400, 400);
      line(g, -200, hy, 200, hy, '#fff', 2);
      for (const p of [-20, -10, -5, 5, 10, 20]) { const w = Math.abs(p) >= 10 ? 26 : 12; line(g, -w, hy - p * 3.2, w, hy - p * 3.2, '#fff', 1.5); }
      for (const a of [-60, -30, -20, -10, 0, 10, 20, 30, 60]) {
        const t = (a - 90) * DEG; line(g, Math.cos(t) * (r - 4), Math.sin(t) * (r - 4), Math.cos(t) * (r - 16), Math.sin(t) * (r - 16), '#fff', 2);
      }
      g.restore();
      g.fillStyle = C.amber; g.beginPath(); g.moveTo(cx, cy - r + 16); g.lineTo(cx - 7, cy - r + 28); g.lineTo(cx + 7, cy - r + 28); g.fill();
      line(g, cx - 50, cy, cx - 16, cy, C.amber, 4); line(g, cx + 16, cy, cx + 50, cy, C.amber, 4);
      line(g, cx - 16, cy, cx, cy + 8, C.amber, 4); line(g, cx + 16, cy, cx, cy + 8, C.amber, 4);
    }
    // Altimeter
    {
      const [cx, cy] = P[2];
      const baro = sys.baroStd ? 1013.25 : sys.baroHpa;
      const alt = indicatedAltitude(ac.air.p, baro * 100) / FT;
      this.ticks(g, cx, cy, r - 2, 50, 0, Math.PI * 2 * 49 / 50, 5, i => String(i / 5));
      text(g, `${(baro * 0.02953).toFixed(2)}`, cx + 34, cy, '#eee', 11);
      text(g, 'ALT', cx, cy - 30, '#ccc', 10);
      this.needle(g, cx, cy, ((alt / 10000) % 1) * Math.PI * 2, r - 45, 3, '#ddd');
      this.needle(g, cx, cy, ((alt / 1000) % 1) * Math.PI * 2, r - 30, 7);
      this.needle(g, cx, cy, ((alt / 100) % 10) / 10 * Math.PI * 2, r - 10, 3.5);
    }
    // Turn coordinator
    {
      const [cx, cy] = P[3];
      const rate = ac.w[2] * RAD * Math.cos(ac.theta);
      this.turnRate += (rate - this.turnRate) * Math.min(1, dt * 3);
      text(g, 'L', cx - 58, cy + 30, '#eee', 12); text(g, 'R', cx + 58, cy + 30, '#eee', 12);
      text(g, '2 MIN', cx, cy + 58, '#ccc', 10);
      for (const s of [-1, 1]) { const a = s * 20 * DEG; line(g, cx + Math.cos(a) * 62 * s, cy + Math.sin(a) * 62 * s + 0, cx + Math.cos(a) * 76 * s, cy + Math.sin(a) * 76 * s, '#eee', 3); }
      line(g, cx - 76, cy, cx - 62, cy, '#eee', 3); line(g, cx + 62, cy, cx + 76, cy, '#eee', 3);
      g.save(); g.translate(cx, cy); g.rotate(clamp(this.turnRate / 3, -1.5, 1.5) * 20 * DEG);
      line(g, -60, 0, 60, 0, '#f5f5f5', 5); line(g, 0, 0, 0, -18, '#f5f5f5', 4); line(g, -14, 10, 14, 10, '#f5f5f5', 3);
      g.restore();
      // inclinometer ball
      g.strokeStyle = '#ddd'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx - 40, cy + 32); g.quadraticCurveTo(cx, cy + 48, cx + 40, cy + 32); g.stroke();
      const bx = clamp(ac.ny * 150, -34, 34);
      g.fillStyle = '#111'; g.strokeStyle = '#eee'; g.beginPath(); g.arc(cx + bx, cy + 38 + (bx * bx) / 200, 7, 0, 7); g.fill(); g.stroke();
    }
    // HSI / DG
    {
      const [cx, cy] = P[4];
      const hdgM = wrap360(ac.heading - magVar(ac.lat, ac.lon));
      this.gyroHdg = hdgM;
      g.save(); g.translate(cx, cy); g.rotate(-this.gyroHdg * DEG);
      for (let h = 0; h < 360; h += 5) {
        const a = h * DEG - Math.PI / 2;
        const big = h % 10 === 0;
        line(g, Math.cos(a) * (r - 2), Math.sin(a) * (r - 2), Math.cos(a) * (r - (big ? 12 : 7)), Math.sin(a) * (r - (big ? 12 : 7)), '#eee', 1.5);
        if (h % 30 === 0) {
          g.save(); g.rotate(h * DEG); text(g, ['N', '3', '6', 'E', '12', '15', 'S', '21', '24', 'W', '30', '33'][h / 30], 0, -r + 24, '#eee', 13); g.restore();
        }
      }
      // heading bug
      g.save(); g.rotate(fcs.selHdg * DEG); g.fillStyle = C.amber; g.fillRect(-6, -r + 1, 12, 7); g.restore();
      // CDI (VOR/LOC/GPS)
      const obs = d.navSource === 'VOR' && d.vor ? d.vor.obs : fcs.plan.approach && d.navSource === 'LOC' ? wrap360(fcs.plan.approach.crs - magVar(ac.lat, ac.lon)) : null;
      if (obs !== null) {
        g.save(); g.rotate(obs * DEG);
        line(g, 0, -r + 14, 0, -32, C.green, 3); line(g, 0, 32, 0, r - 14, C.green, 3);
        const dev = d.navSource === 'LOC' && fcs.ils ? fcs.ils.loc : 0;
        line(g, dev * 12, -28, dev * 12, 28, C.green, 3);
        g.restore();
      }
      g.restore();
      g.fillStyle = C.amber; g.beginPath(); g.moveTo(cx, cy - r + 2); g.lineTo(cx - 6, cy - r - 8); g.lineTo(cx + 6, cy - r - 8); g.fill();
      line(g, cx, cy - 18, cx, cy + 16, C.amber, 3); line(g, cx - 14, cy - 4, cx + 14, cy - 4, C.amber, 3);
    }
    // VSI
    {
      const [cx, cy] = P[5];
      const ang = (v: number) => Math.PI + clamp(v / 2000, -1, 1) * 170 * DEG; // 0 fpm at 9 o'clock
      for (let v = -2000; v <= 2000; v += 100) {
        const a = ang(v);
        const big = v % 500 === 0;
        line(g, cx + Math.cos(a) * (r - 2), cy + Math.sin(a) * (r - 2), cx + Math.cos(a) * (r - (big ? 13 : 7)), cy + Math.sin(a) * (r - (big ? 13 : 7)), '#eee', 1.5);
        if (big && v % 1000 === 0) text(g, String(Math.abs(v / 100)), cx + Math.cos(a) * (r - 26), cy + Math.sin(a) * (r - 26), '#eee', 12);
      }
      text(g, 'VERT SPEED', cx + 18, cy - 20, '#ccc', 9);
      text(g, '100 FT/MIN', cx + 18, cy + 20, '#ccc', 9);
      this.needle(g, cx, cy, ang(ac.vs / FPM) + Math.PI / 2, r - 10);
    }
    void wrap180;
  }
}
