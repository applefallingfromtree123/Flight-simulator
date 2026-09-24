// Navigation Display: ARC / ROSE (HSI with CDI) / PLAN modes, route, airports, navaids, wind.
import { DEG, KT, NM, RAD, clamp, wrap180, wrap360 } from '../core/math.ts';
import { bearing, crossTrack, distance, localNE, magVar } from '../core/geo.ts';
import { C, Display, line, pad, text, type AvData } from './common.ts';

export class ND extends Display {
  constructor(parent: HTMLElement) { super(parent, 420, 420); }

  draw(d: AvData) {
    const g = this.begin();
    const { ac, fcs, sys, db } = d;
    if (!sys.avionicsPowered) return;
    const mode = d.ndMode;
    const arc = mode === 'ARC';
    const cx = 210, cy = arc ? 345 : 215;
    const R = arc ? 290 : 160;
    const var_ = magVar(ac.lat, ac.lon);
    const up = mode === 'PLAN' ? 0 : ac.heading;          // true up-direction
    const hdgM = wrap360(ac.heading - var_);
    const pxPerM = R / (d.ndRange * NM);
    const toXY = (lat: number, lon: number): [number, number] => {
      const [n, e] = localNE(ac, { lat, lon });
      const a = -up * DEG;
      const x = e * Math.cos(a) + n * Math.sin(a), y = -e * Math.sin(a) + n * Math.cos(a);
      return [cx + x * pxPerM, cy - y * pxPerM];
    };
    g.save();
    g.beginPath(); g.rect(0, 30, 420, 390); g.clip();
    // compass rose
    g.strokeStyle = C.white; g.lineWidth = 1.5;
    g.beginPath(); g.arc(cx, cy, R, arc ? -Math.PI / 2 - 50 * DEG : 0, arc ? -Math.PI / 2 + 50 * DEG : Math.PI * 2); g.stroke();
    for (let h = 0; h < 360; h += 5) {
      const rel = wrap180(h - (mode === 'PLAN' ? 0 : hdgM));
      if (arc && Math.abs(rel) > 52) continue;
      const a = (rel - 90) * DEG;
      const l = h % 10 === 0 ? 12 : 6;
      line(g, cx + Math.cos(a) * R, cy + Math.sin(a) * R, cx + Math.cos(a) * (R - l), cy + Math.sin(a) * (R - l));
      if (h % 30 === 0) text(g, String(h / 10), cx + Math.cos(a) * (R - 24), cy + Math.sin(a) * (R - 24), C.white, 14);
    }
    // range ring
    g.setLineDash([4, 6]); g.strokeStyle = C.grey;
    g.beginPath(); g.arc(cx, cy, R / 2, arc ? -Math.PI / 2 - 50 * DEG : 0, arc ? -Math.PI / 2 + 50 * DEG : Math.PI * 2); g.stroke();
    g.setLineDash([]);
    text(g, String(d.ndRange / 2), cx - R / 2 * 0.72 - 8, cy - R / 2 * 0.72, C.grey, 11);
    // airports & navaids
    const range = d.ndRange * NM * 1.1;
    for (const { apt } of db.nearest(ac, 40, range, d.ndRange > 40 ? 2 : 1)) {
      const [x, y] = toXY(apt.lat, apt.lon);
      g.strokeStyle = C.cyan; g.lineWidth = 1.2; g.beginPath(); g.arc(x, y, 5, 0, 7); g.stroke();
      text(g, apt.icao, x + 8, y + 8, C.cyan, 10, 'left');
    }
    for (const n of db.navaidsNear(ac, range).slice(0, 40)) {
      const [x, y] = toXY(n.lat, n.lon);
      g.strokeStyle = n.type.startsWith('NDB') ? C.magenta : C.green;
      g.beginPath();
      if (n.type.startsWith('NDB')) g.arc(x, y, 4, 0, 7); else for (let i = 0; i <= 6; i++) { const a = i * Math.PI / 3; g.lineTo(x + Math.cos(a) * 6, y + Math.sin(a) * 6); }
      g.stroke();
      text(g, n.ident, x + 8, y - 8, g.strokeStyle as string, 10, 'left');
    }
    // approach course
    const ap = fcs.plan.approach;
    if (ap) {
      const [x1, y1] = toXY(ap.thr.lat, ap.thr.lon);
      const far = { lat: ap.thr.lat - Math.cos(ap.crs * DEG) * 0.25, lon: ap.thr.lon - Math.sin(ap.crs * DEG) * 0.25 / Math.cos(ap.thr.lat * DEG) };
      const [x2, y2] = toXY(far.lat, far.lon);
      g.setLineDash([10, 5]); line(g, x1, y1, x2, y2, C.magenta, 1.5); g.setLineDash([]);
      g.fillStyle = C.white; g.fillRect(x1 - 2, y1 - 2, 4, 4);
    }
    // route
    const wps = fcs.plan.wps;
    if (wps.length > 1) {
      for (let i = 0; i < wps.length - 1; i++) {
        const [x1, y1] = toXY(wps[i].lat, wps[i].lon), [x2, y2] = toXY(wps[i + 1].lat, wps[i + 1].lon);
        const active = i === fcs.plan.active - 1;
        line(g, x1, y1, x2, y2, active ? C.magenta : C.white, active ? 2.5 : 1.5);
      }
      wps.forEach((w, i) => {
        const [x, y] = toXY(w.lat, w.lon);
        g.strokeStyle = i === fcs.plan.active ? C.magenta : C.white;
        g.beginPath(); g.moveTo(x, y - 6); g.lineTo(x + 6, y); g.lineTo(x, y + 6); g.lineTo(x - 6, y); g.closePath(); g.stroke();
        text(g, w.ident, x + 9, y, i === fcs.plan.active ? C.magenta : C.white, 11, 'left');
      });
    }
    // selected heading bug & track line
    const rel = (h: number) => (wrap180(h - (mode === 'PLAN' ? 0 : hdgM)) - 90) * DEG;
    const hb = rel(fcs.selHdg);
    g.fillStyle = C.cyan; g.save(); g.translate(cx + Math.cos(hb) * R, cy + Math.sin(hb) * R); g.rotate(hb + Math.PI / 2); g.fillRect(-6, -2, 12, 8); g.restore();
    const tr = (wrap180(ac.track - up) - 90) * DEG;
    if (mode !== 'PLAN') line(g, cx, cy, cx + Math.cos(tr) * R, cy + Math.sin(tr) * R, C.green, 1.2);
    // ROSE: CDI (HSI) for VOR/LOC/GPS
    if (mode === 'ROSE') this.cdi(g, d, cx, cy, R, hdgM);
    g.restore();
    // own aircraft
    g.save(); g.translate(cx, cy); if (mode === 'PLAN') g.rotate(ac.heading * DEG);
    g.strokeStyle = C.yellow; g.lineWidth = 3;
    line(g, 0, -18, 0, 16, C.yellow, 3); line(g, -14, -4, 14, -4, C.yellow, 3); line(g, -6, 12, 6, 12, C.yellow, 3);
    g.restore();
    // header: GS TAS wind
    const w = ac.wind, ws = Math.hypot(w[0], w[1]) / KT, wdT = wrap360(Math.atan2(-w[1], -w[0]) * RAD);
    text(g, `GS ${Math.round(ac.gs / KT)}  TAS ${Math.round(ac.tas / KT)}`, 8, 14, C.white, 13, 'left');
    text(g, `${pad(wrap360(wdT - var_), 3)}°/${Math.round(ws)}`, 8, 32, C.white, 13, 'left');
    g.save(); g.translate(22, 58); g.rotate((wdT - up + 180) * DEG); line(g, 0, -12, 0, 12, C.white, 2); line(g, 0, 12, -4, 6); line(g, 0, 12, 4, 6); g.restore();
    text(g, mode === 'PLAN' ? 'PLAN' : `HDG ${pad(hdgM, 3)}°M`, 210, 14, C.green, 14);
    const to = fcs.plan.to;
    if (to) {
      const dist = distance(ac, to) / NM;
      const ete = ac.gs > 5 ? dist / (ac.gs / KT) * 60 : 0;
      const eta = new Date(d.zulu.getTime() + ete * 60000);
      text(g, to.ident, 412, 14, C.magenta, 14, 'right');
      text(g, `${pad(wrap360(bearing(ac, to) - var_), 3)}°  ${dist.toFixed(dist < 10 ? 1 : 0)}NM`, 412, 32, C.white, 12, 'right');
      text(g, `${pad(eta.getUTCHours(), 2)}${pad(eta.getUTCMinutes(), 2)}Z`, 412, 48, C.white, 12, 'right');
    }
    text(g, `${d.ndRange} NM`, 412, 408, C.cyan, 12, 'right');
    text(g, d.navSource === 'GPS' ? 'GPS' : d.navSource === 'VOR' ? `VOR ${d.vor?.ident ?? '---'}` : `ILS ${fcs.plan.approach?.runway ?? '---'}`, 8, 408, d.navSource === 'GPS' ? C.magenta : C.green, 12, 'left');
    void clamp;
  }

  private cdi(g: CanvasRenderingContext2D, d: AvData, cx: number, cy: number, R: number, hdgM: number) {
    const { ac, fcs } = d;
    let crs = 0, dev = 0, valid = false, toFrom = 0, label = '';
    const var_ = magVar(ac.lat, ac.lon);
    if (d.navSource === 'VOR' && d.vor) {
      const v = d.vor;
      const radial = wrap360(bearing(v, ac) - var_);
      crs = v.obs;
      const from = Math.abs(wrap180(radial - crs)) < 90;
      toFrom = from ? -1 : 1;
      dev = clamp((from ? wrap180(crs - radial) : wrap180(radial + 180 - crs)) / 2.5, -2.5, 2.5);
      valid = distance(ac, v) < 150 * NM;
      label = `${v.ident} ${(distance(ac, v) / NM).toFixed(1)}NM`;
    } else if (d.navSource === 'LOC' && fcs.plan.approach && fcs.ils) {
      crs = wrap360(fcs.plan.approach.crs - var_); dev = fcs.ils.loc; valid = fcs.ils.valid; toFrom = 1; label = `ILS ${fcs.plan.approach.runway}`;
    } else if (fcs.plan.from && fcs.plan.to) {
      crs = wrap360(bearing(fcs.plan.from, fcs.plan.to) - var_);
      const xtk = crossTrack(fcs.plan.from, fcs.plan.to, ac);
      dev = clamp(-xtk / NM / 0.5, -2.5, 2.5); valid = true; toFrom = 1; label = 'GPS';
    } else return;
    const a = (wrap180(crs - hdgM)) * DEG;
    g.save(); g.translate(cx, cy); g.rotate(a);
    const col = d.navSource === 'GPS' ? C.magenta : C.green;
    line(g, 0, -R + 20, 0, -60, col, 4); line(g, 0, 60, 0, R - 20, col, 4);
    g.fillStyle = col; g.beginPath(); g.moveTo(0, -R + 12); g.lineTo(-8, -R + 28); g.lineTo(8, -R + 28); g.fill();
    for (const i of [-2, -1, 1, 2]) { g.strokeStyle = C.white; g.beginPath(); g.arc(i * 26, 0, 4, 0, 7); g.stroke(); }
    if (valid) line(g, dev * 26, -56, dev * 26, 56, col, 4);
    if (toFrom) { g.fillStyle = C.white; g.beginPath(); const y = toFrom > 0 ? -40 : 40; g.moveTo(34, y - 8 * toFrom); g.lineTo(26, y); g.lineTo(42, y); g.fill(); }
    g.restore();
    text(g, `CRS ${pad(crs, 3)}°`, 210, 405, col, 13);
    text(g, label, 210, 388, col, 11);
    void RAD;
  }
}
