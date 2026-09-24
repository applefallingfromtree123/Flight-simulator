// Engine indication & crew alerting (EICAS / ECAM / MFD engine page), per engine type.
import { FT, KT } from '../core/math.ts';
import { C, Display, box, dial, line, text, type AvData } from './common.ts';

export class EICAS extends Display {
  constructor(parent: HTMLElement) { super(parent, 420, 420); }
  draw(d: AvData) {
    const g = this.begin();
    const { ac, sys } = d;
    if (!sys.elecPowered) return;
    const e0 = ac.def.eng;
    const n = ac.engines.length;
    const colW = 420 / Math.max(n, 2);
    const r = n > 2 ? 34 : 44;
    ac.engines.forEach((e, i) => {
      const x = n <= 2 ? 105 + i * 210 : colW * (i + 0.5);
      if (e0.t === 'fan' || e0.t === 'jet') {
        dial(g, x, 62, r, e.n1, 0, 110, e0.t === 'jet' ? 'RPM' : 'N1', e.n1.toFixed(1), { redline: 104, amber: 100 });
        if (e.ab > 0.05) text(g, `AB ${Math.round(e.ab * 100)}%`, x, 62 + r + 4, C.magenta, 12);
        dial(g, x, 170, r * 0.8, e.egt, 0, 1100, 'EGT', String(Math.round(e.egt)), { redline: e0.ab ? 1000 : 950, amber: e0.ab ? 950 : 900 });
        text(g, `N2 ${e.n2.toFixed(1)}`, x, 225, C.green, 13);
        text(g, `FF ${Math.round(e.ff)}`, x, 243, C.green, 13);
        if (e.rev > 0.05) text(g, 'REV', x, 20, e.rev > 0.9 ? C.green : C.amber, 13);
      } else if (e0.t === 'prop') {
        const max = e0.p > 800 ? 3000 : 2700;
        dial(g, x, 62, r, e.rpm, 0, max + 300, 'RPM', String(Math.round(e.rpm)), { redline: max, green: [2000, max] });
        dial(g, x, 170, r * 0.8, e.mp, 10, e0.p >= 800 ? 70 : 40, 'MAN IN', e.mp.toFixed(1), { green: [15, e0.p >= 800 ? 61 : 30] });
        text(g, `FF ${(e.ff / 2.72).toFixed(1)} GPH`, x, 225, C.green, 12);
        text(g, `EGT ${Math.round(e.egt)}°F  OIL ${Math.round(e.oilP)}psi`, x, 243, C.green, 11);
      } else if (e0.t === 'tprop' || e0.t === 'shaft') {
        dial(g, x, 62, r, e.torque, 0, 120, 'TRQ %', e.torque.toFixed(0), { redline: 100, green: [0, 100] });
        dial(g, x, 170, r * 0.8, e.itt, 0, 1000, 'ITT', String(Math.round(e.itt)), { redline: 850, amber: 800 });
        text(g, `NG ${e.ng.toFixed(1)}  NP ${e.np.toFixed(0)}`, x, 225, C.green, 12);
        text(g, `FF ${Math.round(e.ff)} kg/h`, x, 243, C.green, 12);
        if (e.rev > 0.05) text(g, 'BETA', x, 20, C.green, 13);
      }
      if (!e.running && e.def.t !== 'none') text(g, 'OFF', x, 100, C.amber, 13);
    });
    if (ac.isRotor) {
      text(g, `NR ${Math.round(ac.rotorRpm * 100)}%`, 210, 20, ac.rotorRpm < 0.95 ? C.amber : C.green, 15);
    }
    // bottom: status
    line(g, 0, 262, 420, 262, C.grey, 1);
    const fuelKg = ac.fuel;
    text(g, `FOB ${fuelKg >= 10000 ? (fuelKg / 1000).toFixed(1) + ' t' : Math.round(fuelKg) + ' kg'}`, 10, 278, C.green, 13, 'left');
    text(g, `GW ${(ac.mass / 1000).toFixed(1)} t`, 10, 296, C.green, 13, 'left');
    const endur = ac.engines.reduce((s, e) => s + e.ff, 0);
    if (endur > 0) { const h = fuelKg / endur; text(g, `ENDUR ${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`, 10, 314, C.green, 13, 'left'); }
    if (!ac.isRotor) {
      text(g, `FLAPS ${ac.flapLabel}`, 210, 278, ac.flapPos !== ac.flapsDeg ? C.amber : C.white, 13);
      text(g, `TRIM ${(ac.trim * 100).toFixed(0)}`, 210, 296, C.white, 13);
      if (ac.spoilerPos > 0.05 || ac.spoilerArm) text(g, ac.spoilerArm && ac.spoilerPos < 0.05 ? 'SPLR ARM' : `SPD BRK ${Math.round(Math.min(1, ac.spoilerPos) * 100)}%`, 210, 314, ac.spoilerArm ? C.cyan : C.amber, 13);
      if (ac.def.gear.retract) {
        const gx = 360;
        const col = ac.gearPos > 0.99 ? C.green : ac.gearPos > 0.01 ? C.red : C.grey;
        const lab = ac.gearPos > 0.99 ? 'DN' : ac.gearPos > 0.01 ? '▲▼' : 'UP';
        for (const [dx, dy] of [[0, -10], [-24, 10], [24, 10]]) { box(g, gx + dx - 11, 288 + dy - 9, 22, 18, col, '#000', 1.5); text(g, lab, gx + dx, 288 + dy, col, 10); }
      }
    }
    if (ac.parkingBrake) text(g, 'PARK BRK', 400, 314, C.amber, 12, 'right');
    if (sys.apuN > 1) text(g, `APU ${Math.round(sys.apuN)}%${sys.apuAvail ? ' AVAIL' : ''}`, 400, 278, C.green, 12, 'right');
    // alerts
    line(g, 0, 326, 420, 326, C.grey, 1);
    let y = 342;
    const order = { warning: 0, caution: 1, advisory: 2 } as const;
    for (const al of [...sys.alerts].sort((a, b) => order[a.level] - order[b.level]).slice(0, 5)) {
      text(g, al.text, 12, y, al.level === 'warning' ? C.red : al.level === 'caution' ? C.amber : C.cyan, 14, 'left');
      y += 17;
    }
    if (!sys.alerts.length) text(g, ac.onGround ? 'READY' : 'NORMAL', 12, y, C.green, 13, 'left');
    void FT; void KT;
  }
}
