// Full managed flight: SRS climb-out, VNAV climb to cruise, top of descent, path descent, ILS, autoland.
import { setup, run, st, DEG, FT, KT, FPM, destination, distance } from './harness.ts';
const id = process.argv[2] ?? 'a320neo';
const cruise = +(process.argv[3] ?? 24000);
const s = setup(id, 1000, 165, 90, 'clear', 1, false);
const { ac, fcs } = s;
const dep = { lat: 37.5, lon: 126.9 };
const thr = destination({ lat: 37.5, lon: 127 }, 90, 220 * 1852);
fcs.plan.cruiseFt = cruise;
fcs.plan.wps = [
  { ident: 'DEP', ...dep, kind: 'apt' },
  { ident: 'WP1', ...destination(dep, 95, 45 * 1852), kind: 'fix' },
  { ident: 'WP2', ...destination(dep, 88, 130 * 1852), kind: 'fix' },
  { ident: 'IF09', ...destination(thr, 270, 16 * 1852), alt: 4900, kind: 'user' },
  { ident: 'FF09', ...destination(thr, 270, 10 * 1852), alt: 3000, kind: 'user' },
  { ident: 'DST', lat: thr.lat, lon: thr.lon, kind: 'rwy' },
];
fcs.plan.active = 1;
fcs.plan.approach = { airport: 'DST', runway: '09', thr, elev: 0, crs: 90, gs: 3, locAnt: destination(thr, 90, 3300), gsAnt: destination(thr, 90, 300), lengthM: 3000 };
fcs.ilsTuned = true;
fcs.selAlt = cruise; fcs.lat = 'NAV';
fcs.vert = 'TOGA'; (fcs as any).srsSpd = fcs.vSpeeds().v2 + 10; fcs.athr = 'TOGA'; fcs.vertArmed = 'VNAV'; fcs.spdManaged = true;
const n = ac.aero.flaps.length;
let lastPhase = '', td = '';
const t0 = Date.now();
run(s, 3600, 1, t => {
  const rem = fcs.plan.remainingNm(ac);
  const ias = ac.ias / KT;
  // pilot: clean up after takeoff, configure on the approach, select a lower MCP altitude for the descent
  if (ac.flapIdx > 0 && rem > 30 && ac.alt / FT > 2500 && ias > fcs.vls() + 10 && fcs.vls() < 1e9) {
    const save = ac.flapIdx; ac.flapIdx = 0; const ok = ias > fcs.vls() + 5; if (!ok) ac.flapIdx = save;
  }
  if (fcs.todNm !== null && fcs.todNm < 5 && fcs.selAlt > 3000) fcs.selAlt = 3000;
  if (fcs.msg) { console.log('MSG', fcs.msg); fcs.msg = ''; }
  if (rem < 16 && ac.flapIdx === 0) ac.flapIdx = 1;
  if (rem < 13 && ac.flapIdx === 1) ac.flapIdx = 2;
  if (rem < 10 && ac.flapIdx === 2) { ac.flapIdx = Math.min(3, n - 1); ac.gearDown = true; ac.spoilerArm = true; }
  if (rem < 8 && ac.flapIdx < n - 1) ac.flapIdx = n - 1;
  const phase = `${fcs.lat}${fcs.latArmed ? '(' + fcs.latArmed + ')' : ''}/${fcs.vertFma}${fcs.vertArmed ? '(' + fcs.vertArmed + ')' : ''}`;
  if (phase !== lastPhase || Math.round(t) % 60 === 0) {
    console.log(`t${Math.round(t)} rem ${rem.toFixed(1)} tod ${fcs.todNm?.toFixed(1) ?? '-'} ${st(s)} [${phase}] tgt ${Math.round(fcs.targetIas())} flap ${ac.flapIdx} wp ${fcs.plan.to?.ident}`);
    lastPhase = phase;
  }
  if (!td && ac.onGround) { td = `TOUCHDOWN vs ${Math.round(ac.vs / FPM)} fpm, ${Math.round(distance(ac, thr))} m past threshold, ias ${Math.round(ias)}`; console.log(td); }
  if (ac.onGround && ias < 60) throw 'done';
});
console.log('wall', Date.now() - t0, 'ms');
