// Primary Flight Display (airliner / G1000 / helicopter variants).
import { DEG, FPM, FT, KT, RAD, clamp, wrap360, wrap180 } from '../core/math.ts';
import { indicatedAltitude } from '../sim/atmosphere.ts';
import { C, Display, box, line, pad, stallSpeed, text, type AvData } from './common.ts';

export class PFD extends Display {
  private trendIas = 0; private lastIas = 0;
  constructor(parent: HTMLElement) { super(parent, 420, 420); }

  draw(d: AvData, dt: number) {
    const g = this.begin();
    const { ac, fcs, sys } = d;
    if (!sys.avionicsPowered) { return; }
    const cx = 205, cy = 205;
    const pitch = ac.theta * RAD, roll = ac.phi * RAD;
    const ppd = 5.2;
    // ── attitude ──
    g.save();
    g.beginPath(); g.rect(cx - 125, cy - 135, 250, 270); g.clip();
    g.translate(cx, cy); g.rotate(-roll * DEG);
    const hy = pitch * ppd;
    g.fillStyle = C.sky; g.fillRect(-400, -800 + hy, 800, 800);
    g.fillStyle = C.ground; g.fillRect(-400, hy, 800, 800);
    line(g, -400, hy, 400, hy, C.white, 2);
    for (let p = -80; p <= 80; p += 2.5) {
      if (p === 0) continue;
      const y = hy - p * ppd;
      if (Math.abs(y) > 120) continue;
      const major = p % 10 === 0, mid = p % 5 === 0;
      const w = major ? 50 : mid ? 25 : 10;
      line(g, -w / 2, y, w / 2, y, C.white, 1.5);
      if (major) { text(g, String(Math.abs(p)), -w / 2 - 14, y, C.white, 13); text(g, String(Math.abs(p)), w / 2 + 14, y, C.white, 13); }
    }
    g.restore();
    // roll scale
    g.save(); g.translate(cx, cy);
    g.strokeStyle = C.white; g.lineWidth = 1.5;
    g.beginPath(); g.arc(0, 0, 118, -Math.PI / 2 - 60 * DEG, -Math.PI / 2 + 60 * DEG); g.stroke();
    for (const a of [-60, -45, -30, -20, -10, 10, 20, 30, 45, 60]) {
      const r0 = 118, r1 = Math.abs(a) % 30 === 0 ? 132 : 125, t = (-90 + a) * DEG;
      line(g, Math.cos(t) * r0, Math.sin(t) * r0, Math.cos(t) * r1, Math.sin(t) * r1);
    }
    g.fillStyle = C.yellow; g.beginPath(); g.moveTo(0, -118); g.lineTo(-7, -130); g.lineTo(7, -130); g.fill();
    g.rotate(-roll * DEG);
    const slip = clamp(ac.ny * 60, -14, 14);
    g.fillStyle = Math.abs(roll) > 35 ? C.amber : C.white;
    g.beginPath(); g.moveTo(0, -116); g.lineTo(-7, -104); g.lineTo(7, -104); g.fill();
    g.fillRect(-8 + slip, -102, 16, 4);
    g.restore();
    // flight director
    if (fcs.fd && (fcs.ap || fcs.lat !== 'OFF' || fcs.vert !== 'OFF') && !ac.onGround) {
      const fx = clamp((fcs.fdRoll - roll) * 2.2, -80, 80), fy = clamp(-(fcs.fdPitch - pitch) * ppd, -80, 80);
      line(g, cx + fx, cy - 70, cx + fx, cy + 70, C.magenta, 3);
      line(g, cx - 70, cy + fy, cx + 70, cy + fy, C.magenta, 3);
    }
    // aircraft symbol
    g.fillStyle = '#000'; g.strokeStyle = C.yellow; g.lineWidth = 3;
    g.strokeRect(cx - 80, cy - 3, 40, 6); g.strokeRect(cx + 40, cy - 3, 40, 6); g.strokeRect(cx - 4, cy - 4, 8, 8);
    // flight-path vector (bird) for FBW/fighters
    if (ac.def.fbw && !ac.onGround) {
      const gam = Math.atan2(ac.vs, Math.max(ac.gs, 1)) * RAD;
      const bx = cx + clamp(wrap180(ac.track - ac.heading), -20, 20) * 4, by = cy - (gam - pitch) * ppd;
      g.strokeStyle = C.green; g.lineWidth = 2; g.beginPath(); g.arc(bx, by, 7, 0, Math.PI * 2); g.stroke();
      line(g, bx - 18, by, bx - 7, by, C.green, 2); line(g, bx + 7, by, bx + 18, by, C.green, 2); line(g, bx, by - 7, bx, by - 14, C.green, 2);
    }
    // radio altitude
    const ra = (ac.agl - ac.aero.cgHeight) / FT;
    if (ra < 2500) text(g, String(ra < 10 ? Math.max(0, Math.round(ra)) : ra < 50 ? Math.round(ra / 5) * 5 : Math.round(ra / 10) * 10), cx, cy + 112, ra < sys.minimums ? C.amber : C.green, 20);
    // ILS deviation
    if (fcs.ils && fcs.ilsTuned) {
      const il = fcs.ils;
      for (let i = -2; i <= 2; i++) { if (!i) continue; g.strokeStyle = C.white; g.beginPath(); g.arc(cx + i * 30, cy + 150 - 22, 3, 0, 7); g.stroke(); g.beginPath(); g.arc(cx + 150 - 20, cy - i * 30, 3, 0, 7); g.stroke(); }
      if (il.valid) { g.fillStyle = C.magenta; diamond(g, cx - il.loc * 30, cy + 128, 7); }
      if (il.gsValid) { g.fillStyle = C.magenta; diamond(g, cx + 130, cy - il.gs * 30, 7); }
      text(g, `${fcs.plan.approach!.airport} ${fcs.plan.approach!.runway}  ${il.distNm.toFixed(1)}NM`, 12, 405, C.magenta, 12, 'left');
    }
    // ── speed tape ──
    const ias = ac.ias / KT;
    this.trendIas = this.trendIas + ((ias - this.lastIas) / Math.max(dt, 1e-3) - this.trendIas) * Math.min(1, dt * 1.5);
    this.lastIas = ias;
    const sx = 8, sw = 62, spx = 3.2;
    g.save(); g.beginPath(); g.rect(sx, cy - 135, sw, 270); g.clip();
    g.fillStyle = '#2a2f36'; g.fillRect(sx, cy - 135, sw, 270);
    const vis = Math.max(30, ias);
    for (let v = Math.floor((vis - 45) / 10) * 10; v <= vis + 45; v += 10) {
      if (v < 30) continue;
      const y = cy - (v - vis) * spx;
      line(g, sx + sw - 12, y, sx + sw, y);
      if (v % 20 === 0) text(g, String(v), sx + sw - 16, y, C.white, 14, 'right');
    }
    // overspeed band
    const vmo = ac.def.v.vmo;
    const yv = cy - (vmo - vis) * spx;
    for (let y = yv; y > cy - 140; y -= 10) { g.fillStyle = y % 20 < 10 ? C.red : '#000'; g.fillRect(sx + sw - 8, y - 10, 8, 10); }
    if (!ac.isRotor && !ac.onGround) {
      const vs = stallSpeed(ac, ac.nz);
      const ys = cy - (vs - vis) * spx;
      g.fillStyle = C.red; g.fillRect(sx + sw - 8, ys, 8, 400);
      g.fillStyle = C.amber; g.fillRect(sx + sw - 4, cy - (vs * 1.13 - vis) * spx, 4, (vs * 0.13) * spx);
    }
    if (!ac.isRotor) {
      // V-speed bugs
      const v = fcs.vSpeeds();
      const bug = (val: number, lab: string, col: string) => { const y = cy - (val - vis) * spx; line(g, sx + sw - 16, y, sx + sw, y, col, 2); text(g, lab, sx + sw + 1, y, col, 11, 'left'); };
      if (ac.onGround || ac.agl < 1500 * FT && ac.vs > 0) { bug(v.v1, '1', C.cyan); bug(v.vr, 'R', C.cyan); bug(v.v2, '2', C.cyan); }
      else if (ac.flapIdx > 0) bug(v.vref, 'REF', C.green);
    }
    // selected speed
    const sel = fcs.spdIsMach ? fcs.selMach * ac.air.a / (ac.tas / Math.max(ac.ias, 1)) / KT : fcs.selSpd;
    const ysel = clamp(cy - (sel - vis) * spx, cy - 132, cy + 132);
    g.fillStyle = C.magenta; g.beginPath(); g.moveTo(sx + sw, ysel); g.lineTo(sx + sw - 10, ysel - 7); g.lineTo(sx + sw - 10, ysel + 7); g.fill();
    g.restore();
    // trend
    if (Math.abs(this.trendIas) > 0.2) { const ty = cy - this.trendIas * 10 * spx; line(g, sx + sw + 4, cy, sx + sw + 4, ty, C.green, 2); }
    box(g, sx, cy - 16, sw - 4, 32, C.yellow);
    text(g, String(Math.max(0, Math.round(ias))), sx + sw - 8, cy, C.white, 20, 'right');
    text(g, fcs.spdIsMach ? `.${pad(fcs.selMach * 1000, 3)}` : String(Math.round(fcs.selSpd)), sx + sw / 2, cy - 147, C.magenta, 15);
    if (ac.mach > 0.4) text(g, `.${pad(ac.mach * 1000, 3)}`, sx + sw / 2, cy + 150, C.white, 15);
    else text(g, `GS ${Math.round(ac.gs / KT)}`, sx + sw / 2, cy + 150, C.dim, 12);
    // ── altitude tape ──
    const baro = sys.baroStd ? 1013.25 : sys.baroHpa;
    const alt = indicatedAltitude(ac.air.p, baro * 100) / FT;
    const ax = 336, aw = 64, apx = 0.4;
    g.save(); g.beginPath(); g.rect(ax, cy - 135, aw, 270); g.clip();
    g.fillStyle = '#2a2f36'; g.fillRect(ax, cy - 135, aw, 270);
    for (let v = Math.floor((alt - 400) / 100) * 100; v <= alt + 400; v += 100) {
      const y = cy - (v - alt) * apx;
      line(g, ax, y, ax + (v % 500 === 0 ? 14 : 8), y);
      if (v % 200 === 0) text(g, String(v / 100 | 0).padStart(3, ' '), ax + 18, y, C.white, 13, 'left');
    }
    // ground reference
    const gy = cy - (alt - ra - alt) * apx;
    g.fillStyle = 'rgba(255,176,32,0.5)'; if (ra < 500) g.fillRect(ax, gy, aw, 300);
    const ya = clamp(cy - (fcs.selAlt - alt) * apx, cy - 132, cy + 132);
    g.fillStyle = C.cyan; g.fillRect(ax, ya - 8, 6, 16);
    g.restore();
    box(g, ax + 4, cy - 16, aw - 4, 32, C.yellow);
    const a100 = Math.floor(Math.abs(alt) / 100), a20 = Math.round((Math.abs(alt) % 100) / 20) * 20;
    text(g, `${alt < 0 ? '-' : ''}${a100}`, ax + 42, cy, C.green, 20, 'right');
    text(g, pad(a20 % 100, 2), ax + 44, cy, C.green, 14, 'left');
    text(g, String(fcs.selAlt), ax + aw / 2, cy - 147, C.cyan, 15);
    text(g, sys.baroStd ? 'STD' : `QNH ${Math.round(baro)}`, ax + aw / 2, cy + 150, sys.baroStd ? C.cyan : C.cyan, 13);
    // ── vertical speed ──
    const vsf = ac.vs / FPM;
    const vx = 404;
    g.fillStyle = '#2a2f36'; g.fillRect(vx, cy - 110, 14, 220);
    const vsY = (v: number) => cy - Math.sign(v) * Math.min(105, Math.sqrt(Math.abs(v) / 6000) * 105);
    for (const v of [-6000, -2000, -1000, -500, 500, 1000, 2000, 6000]) line(g, vx, vsY(v), vx + 5, vsY(v));
    line(g, vx - 6, cy, vx + 14, vsY(vsf), Math.abs(vsf) > 6000 ? C.amber : C.green, 2.5);
    if (Math.abs(vsf) > 200) text(g, String(Math.round(vsf / 100) * 100), vx + 7, vsf > 0 ? cy - 122 : cy + 122, C.green, 12);
    // ── heading tape ──
    const hdg = fcs.hdgM;
    const hy2 = 372;
    g.save(); g.beginPath(); g.rect(cx - 120, hy2 - 14, 240, 30); g.clip();
    g.fillStyle = '#2a2f36'; g.fillRect(cx - 120, hy2 - 14, 240, 30);
    for (let h = Math.floor(hdg - 30); h <= hdg + 30; h++) {
      if (h % 5) continue;
      const x = cx + wrap180(h - hdg) * 4;
      line(g, x, hy2 - 14, x, hy2 - (h % 10 ? 9 : 5));
      if (h % 10 === 0) text(g, pad(wrap360(h) / 10, 2), x, hy2 + 6, C.white, 13);
    }
    const hx = cx + clamp(wrap180(fcs.selHdg - hdg), -29, 29) * 4;
    g.fillStyle = C.cyan; g.fillRect(hx - 4, hy2 - 14, 8, 7);
    const tx = cx + clamp(wrap180(ac.track - ac.heading), -29, 29) * 4;
    g.strokeStyle = C.green; g.beginPath(); g.moveTo(tx, hy2 - 14); g.lineTo(tx - 5, hy2 - 6); g.lineTo(tx + 5, hy2 - 6); g.closePath(); g.stroke();
    g.restore();
    line(g, cx, hy2 - 20, cx, hy2 - 8, C.yellow, 3);
    // ── FMA ──
    g.fillStyle = '#000'; g.fillRect(0, 0, 420, 44);
    const cols = [
      [fcs.athr !== 'OFF' ? fcs.athrDisplay : '', C.green],
      [fcs.vert !== 'OFF' ? fcs.vert : '', C.green],
      [fcs.lat !== 'OFF' ? fcs.lat : '', C.green],
      [fcs.vertArmed || fcs.latArmed ? `${fcs.latArmed ?? ''} ${fcs.vertArmed ?? ''}` : '', C.cyan],
      [fcs.ap ? 'AP1' : ac.isRotor && fcs.sas ? 'SAS' : '', C.white],
    ] as const;
    cols.forEach(([t, c], i) => { if (i) line(g, i * 84, 4, i * 84, 40, C.grey, 1); text(g, t, i * 84 + 42, 15, c, 14); });
    text(g, fcs.fd ? 'FD' : '', 4 * 84 + 42, 32, C.white, 12);
    if (fcs.athr !== 'OFF') text(g, 'A/THR', 42, 32, C.white, 11);
    if (ac.def.fbw && fcs.alphaProt) text(g, 'α PROT', 126, 32, C.amber, 11);
    if (fcs.vert === 'VS') text(g, `${fcs.selVs >= 0 ? '+' : ''}${fcs.selVs}`, 126, 32, C.cyan, 11);
    if (sys.masterWarning) text(g, 'MASTER WARN', 210, 32, C.red, 11);
    else if (sys.masterCaution) text(g, 'MASTER CAUT', 210, 32, C.amber, 11);
    // helicopter extras
    if (ac.isRotor) {
      text(g, `NR ${Math.round(ac.rotorRpm * 100)}%`, 20, 405, ac.rotorRpm < 0.95 ? C.amber : C.green, 13, 'left');
      text(g, `TQ ${Math.round(ac.torquePct)}%`, 400, 405, ac.torquePct > 100 ? C.red : C.green, 13, 'right');
    } else if (!fcs.ils || !fcs.ilsTuned) {
      text(g, `TAS ${Math.round(ac.tas / KT)}  OAT ${Math.round(ac.air.T - 273.15)}°C`, 12, 405, C.dim, 12, 'left');
      const w = ac.wind, ws = Math.hypot(w[0], w[1]) / KT, wd = wrap360(Math.atan2(-w[1], -w[0]) * RAD);
      text(g, `WIND ${pad(wd, 3)}°/${Math.round(ws)}`, 408, 405, C.dim, 12, 'right');
    }
  }
}
function diamond(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  g.beginPath(); g.moveTo(x, y - s); g.lineTo(x + s, y); g.lineTo(x, y + s); g.lineTo(x - s, y); g.closePath(); g.fill();
}
