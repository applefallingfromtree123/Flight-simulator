// Head-up display (fighters, and the HUD cockpit view for every aircraft).
import { DEG, FPM, FT, KT, RAD, clamp, wrap180, wrap360 } from '../core/math.ts';
import { indicatedAltitude } from '../sim/atmosphere.ts';
import { magVar } from '../core/geo.ts';
import type { AvData } from './common.ts';

export class HUD {
  cv: HTMLCanvasElement; g: CanvasRenderingContext2D;
  constructor(parent: HTMLElement) {
    this.cv = document.createElement('canvas');
    this.cv.className = 'hud';
    parent.appendChild(this.cv);
    this.g = this.cv.getContext('2d')!;
  }
  draw(d: AvData, show: boolean, vfovDeg: number, headYaw: number, headPitch: number) {
    const cv = this.cv;
    cv.style.display = show ? 'block' : 'none';
    if (!show) return;
    const W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const g = this.g;
    g.clearRect(0, 0, W, H);
    const { ac, fcs, sys } = d;
    const col = '#47ff8a';
    g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 2;
    g.font = `bold 16px "B612 Mono", Consolas, monospace`; g.textBaseline = 'middle';
    g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 3;
    const ppd = H / vfovDeg;
    const cx = W / 2 - headYaw * ppd, cy = H / 2 + headPitch * ppd;
    const pitch = ac.theta * RAD, roll = ac.phi * RAD;
    // pitch ladder (conformal)
    g.save(); g.translate(cx, cy); g.rotate(-roll * DEG);
    for (let p = -90; p <= 90; p += 5) {
      const y = (pitch - p) * ppd;
      if (Math.abs(y) > H * 0.4) continue;
      const w = p === 0 ? W * 0.5 : 110;
      g.setLineDash(p < 0 ? [10, 8] : []);
      g.beginPath();
      if (p === 0) { g.moveTo(-w / 2, y); g.lineTo(-40, y); g.moveTo(40, y); g.lineTo(w / 2, y); }
      else { g.moveTo(-w / 2, y + (p > 0 ? 10 : -10)); g.lineTo(-w / 2, y); g.lineTo(-30, y); g.moveTo(30, y); g.lineTo(w / 2, y); g.lineTo(w / 2, y + (p > 0 ? 10 : -10)); }
      g.stroke();
      g.setLineDash([]);
      if (p) { g.textAlign = 'right'; g.fillText(String(p), -w / 2 - 6, y); g.textAlign = 'left'; g.fillText(String(p), w / 2 + 6, y); }
    }
    g.restore();
    // boresight
    g.beginPath(); g.moveTo(cx - 18, cy); g.lineTo(cx - 6, cy); g.lineTo(cx, cy + 6); g.lineTo(cx + 6, cy); g.lineTo(cx + 18, cy); g.stroke();
    // flight path marker
    const gam = Math.atan2(ac.vs, Math.max(ac.gs, 1)) * RAD;
    const drift = clamp(wrap180(ac.track - ac.heading), -15, 15);
    const fx = cx + drift * ppd, fy = cy + (pitch - gam) * ppd;
    g.beginPath(); g.arc(fx, fy, 9, 0, 7); g.moveTo(fx - 22, fy); g.lineTo(fx - 9, fy); g.moveTo(fx + 9, fy); g.lineTo(fx + 22, fy); g.moveTo(fx, fy - 9); g.lineTo(fx, fy - 18); g.stroke();
    // FD guidance cue
    if (fcs.fd && !ac.onGround && (fcs.ap || fcs.vert !== 'OFF')) {
      const gx = fx + clamp(fcs.fdRoll - roll, -40, 40) * 2, gy = cy + (pitch - fcs.fdPitch) * ppd + (fy - cy) * 0.0;
      g.beginPath(); g.arc(gx, gy, 5, 0, 7); g.stroke();
    }
    // speed / altitude boxes
    const baro = sys.baroStd ? 1013.25 : sys.baroHpa;
    const alt = indicatedAltitude(ac.air.p, baro * 100) / FT;
    const bx = W / 2 - 260, ax = W / 2 + 200, by = H / 2;
    g.strokeRect(bx, by - 16, 70, 32); g.textAlign = 'center'; g.fillText(String(Math.round(ac.ias / KT)), bx + 35, by);
    g.strokeRect(ax, by - 16, 86, 32); g.fillText(String(Math.round(alt / 10) * 10), ax + 43, by);
    g.font = `14px "B612 Mono", Consolas, monospace`;
    g.fillText(`M ${ac.mach.toFixed(2)}`, bx + 35, by + 32);
    g.fillText(`G ${ac.nz.toFixed(1)}`, bx + 35, by + 52);
    g.fillText(`α ${(ac.alpha * RAD).toFixed(1)}`, bx + 35, by + 72);
    g.fillText(`${Math.round(ac.vs / FPM)} VS`, ax + 43, by + 32);
    const ra = (ac.agl - ac.aero.cgHeight) / FT;
    if (ra < 5000) g.fillText(`R ${Math.round(ra)}`, ax + 43, by + 52);
    g.fillText(`${fcs.selSpd}`, bx + 35, by - 32);
    g.fillText(`${fcs.selAlt}`, ax + 43, by - 32);
    // heading tape
    const hdg = wrap360(ac.heading - magVar(ac.lat, ac.lon));
    const ty = H / 2 - H * 0.36;
    for (let h = Math.floor(hdg - 20); h <= hdg + 20; h++) {
      if (h % 5) continue;
      const x = W / 2 + wrap180(h - hdg) * 9;
      g.beginPath(); g.moveTo(x, ty); g.lineTo(x, ty + (h % 10 ? 6 : 12)); g.stroke();
      if (h % 10 === 0) g.fillText(String(wrap360(h) / 10 | 0).padStart(2, '0'), x, ty - 10);
    }
    g.beginPath(); g.moveTo(W / 2, ty + 14); g.lineTo(W / 2 - 6, ty + 24); g.lineTo(W / 2 + 6, ty + 24); g.closePath(); g.stroke();
    // modes
    g.font = `bold 14px "B612 Mono", Consolas, monospace`;
    g.fillText([fcs.athr !== 'OFF' ? fcs.athrDisplay : '', fcs.vert !== 'OFF' ? fcs.vert : '', fcs.lat !== 'OFF' ? fcs.lat : '', fcs.ap ? 'AP' : ''].filter(Boolean).join('   '), W / 2, H / 2 + H * 0.36);
    if (sys.alerts.some(a => a.level === 'warning')) { g.fillStyle = '#ff5050'; g.fillText(sys.alerts.find(a => a.level === 'warning')!.text, W / 2, H / 2 + H * 0.3); }
    void DEG;
  }
}
