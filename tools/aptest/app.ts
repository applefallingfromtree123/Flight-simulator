// ILS intercept from a 30-degree heading at 3000 ft, 14 NM out, then autoland and rollout.
import { setup, run, st, DEG, FT, KT, FPM, destination, distance } from './harness.ts';
const id = process.argv[2] ?? 'a320neo';
const crs = 90, thr = { lat: 37.5, lon: 127 };
const s0 = setup(id, 3000, 180, 60, process.argv[3] ?? 'clear', 0, false);
const { ac, fcs } = s0;
const p = destination(thr, crs + 180, 14 * 1852);
const off = destination(p, crs + 90, 2.5 * 1852);
ac.place(off.lat, off.lon, 3000 * FT, 60, 188);
// re-orient the trimmed attitude to the new heading
const { qFromEuler } = await import('../../src/core/math.ts');
const th = ac.theta; ac.q = qFromEuler(60 * DEG, th, 0);
fcs.plan.approach = { airport: 'TEST', runway: '09', thr, elev: 0, crs, gs: 3, locAnt: destination(thr, crs, 3300), gsAnt: destination(thr, crs, 300), lengthM: 3000 };
fcs.ilsTuned = true; fcs.selHdg = 60; fcs.selAlt = 3000; fcs.selSpd = 180;
fcs.armApp();
const vapp = Math.round(fcs.vref() + 5);
let configured = false, td: any = null;
run(s0, 900, 5, t => {
  const d = distance(ac, thr) / 1852;
  if (!configured && d < 9) { configured = true; ac.flapIdx = ac.aero.flaps.length - 1; ac.gearDown = true; fcs.selSpd = vapp; ac.spoilerArm = true; ac.autobrake = 2; }
  if (!td && ac.onGround) td = { t, vs: Math.round(ac.vs / FPM), x: Math.round(distance(ac, thr)), y: Math.round(Math.sin((Math.atan2(0, 1))) ), ias: Math.round(ac.ias / KT) };
  const ils = fcs.ils;
  console.log(`t${Math.round(t)} d${d.toFixed(1)} ${st(s0)} loc ${ils?.loc.toFixed(2)} gs ${ils?.gs.toFixed(2)} ra ${Math.round(ac.agl / FT)}`);
  if (ac.onGround && ac.gs < 3) throw 'stopped';
});
