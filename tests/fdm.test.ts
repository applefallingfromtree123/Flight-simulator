// Headless flight tests: run with `npm test`.
import { Aircraft } from '../src/sim/fdm.ts';
import { FCS, type Approach } from '../src/sim/fcs.ts';
import { getAircraft } from '../src/sim/aircraftDb.ts';
import { WEATHER_PRESETS } from '../src/sim/atmosphere.ts';
import { destination, crossTrack, distance } from '../src/core/geo.ts';
import { KT, FPM, RAD, FT } from '../src/core/math.ts';

let failures = 0;
function check(name: string, ok: boolean, info: string) {
  console.log(`${ok ? '  ok ' : 'FAIL'} ${name}: ${info}`);
  if (!ok) failures++;
}
const calm = { ...WEATHER_PRESETS.clear.w, windSpd: 0, gust: 0, turbulence: 0, windAloftSpd: 0 };
const DT = 1 / 120;
const pin = { pitch: 0, roll: 0, yaw: 0, trim: 0, collective: 0.5 };

function makeApproach(elev: number): Approach {
  const thr = { lat: 0, lon: 0 };
  const far = destination(thr, 90, 3000);
  return { airport: 'TEST', runway: '09', thr, elev, crs: 90, gs: 3, locAnt: destination(far, 90, 300), gsAnt: destination(thr, 90, 300), lengthM: 3000 };
}

function flightTest(id: string, opts: { cruiseFt: number; alt?: number; climbSpd?: number; autoland?: boolean }) {
  const def = getAircraft(id);
  const a = new Aircraft(def);
  const fcs = new FCS(a);
  const env = { weather: calm, ground: (lat: number, lon: number) => ({ h: 0, water: false, runway: Math.abs(lat) < 0.001 && lon > -0.05 && lon < 0.03 }), time: 0 };
  // start on runway 27 facing west at lon 0.027 (so we take off westbound, then return)
  a.place(0, 0.02, a.restHeight(), 270, 0);
  a.setAllEngines(true);
  a.flapIdx = Math.min(2, a.aero.flaps.length - 1);
  a.flapPos = a.aero.flaps[a.flapIdx].deg;
  a.spoilerArm = true;
  const vs = fcs.vSpeeds();
  let t = 0, liftoff = 0;
  const run = (secs: number, fn?: () => boolean | void) => {
    const end = t + secs;
    while (t < end && !a.crash) {
      if (fn && fn()) return;
      fcs.update(DT, pin);
      a.step(DT, env);
      t += DT; env.time = t;
      if (process.env.TRACE && Math.round(t * 120) % 120 === 0) console.log(`  t${t.toFixed(0)} alt ${(a.alt/FT).toFixed(0)} vs ${(a.vs/FPM).toFixed(0)} ias ${(a.ias/KT).toFixed(0)} th ${(a.theta*RAD).toFixed(1)} fdP ${fcs.fdPitch.toFixed(1)} phi ${(a.phi*RAD).toFixed(1)} fdR ${fcs.fdRoll.toFixed(1)} de ${a.de.toFixed(2)} da ${a.da.toFixed(2)} trim ${a.trim.toFixed(2)} a ${(a.alpha*RAD).toFixed(1)} ${fcs.lat}/${fcs.vert} ap ${fcs.ap} thr ${a.engineCmd[0].throttle.toFixed(2)} gnd ${a.onGround}`);
    }
  };
  // takeoff roll with manual rotation
  for (const c of a.engineCmd) c.throttle = 1;
  run(120, () => {
    if (a.ias / KT > vs.vr) pin.pitch = Math.max(-0.3, Math.min(0.5, (9 - a.theta * RAD) * 0.15 - a.w[1] * RAD * 0.1));
    if (!a.onGround && !liftoff) liftoff = t;
    return a.agl > 400 * FT;
  });
  pin.pitch = 0;
  check(`${id} takeoff`, !a.crash && liftoff > 0, `liftoff ${liftoff.toFixed(1)}s, IAS ${(a.ias / KT).toFixed(0)}kt ${a.crash?.reason ?? ''}`);
  a.gearDown = false;
  fcs.engageAp(true);
  const climbSpd = opts.climbSpd ?? Math.min(250, def.v.vmo - 10);
  fcs.selAlt = opts.cruiseFt;
  if (fcs.hasAthr) fcs.toggleAthr(); else for (const c of a.engineCmd) c.throttle = 1;
  fcs.setVert('FLC');
  fcs.selSpd = climbSpd;
  run(40); a.flapIdx = 0;
  run(600, () => fcs.vert === 'ALT');
  check(`${id} climb+capture`, fcs.vert === 'ALT' && Math.abs(a.alt / FT - opts.cruiseFt) < 300, `alt ${(a.alt / FT).toFixed(0)}ft mode ${fcs.vert} ias ${(a.ias / KT).toFixed(0)} t=${t.toFixed(0)}`);
  // heading change 180 -> turning back east
  fcs.selHdg = 90; fcs.lat = 'HDG';
  run(120);
  check(`${id} heading`, Math.abs(((fcs.hdgM - 90 + 540) % 360) - 180) < 5 && Math.abs(a.alt / FT - opts.cruiseFt) < 150, `hdg ${a.heading.toFixed(0)} alt ${(a.alt / FT).toFixed(0)} bank ${(a.phi * RAD).toFixed(1)}`);
  // speed change
  fcs.selSpd = Math.round(def.v.vref * 1.45);
  if (!fcs.hasAthr) for (const c of a.engineCmd) c.throttle = 0.55;
  run(90);
  if (fcs.hasAthr) check(`${id} speed hold`, Math.abs(a.ias / KT - fcs.selSpd) < 8, `ias ${(a.ias / KT).toFixed(0)} tgt ${fcs.selSpd}`);
  // position for ILS: 12 nm west of threshold at 3500 ft, heading east
  const ap = makeApproach(0);
  fcs.plan.approach = ap;
  const start = destination(ap.thr, 270, 12 * 1852);
  a.lat = start.lat; a.lon = start.lon; a.alt = 3000 * FT + 60;
  fcs.selAlt = 3000; fcs.altHold = 3000; fcs.vert = 'ALT';
  fcs.selHdg = 90;
  a.gearDown = true; a.flapIdx = a.aero.flaps.length - 1;
  fcs.selSpd = Math.round(fcs.vref() + 5);
  fcs.armApp();
  if (opts.autoland === false) {
    run(420, () => (a.agl / FT) < 200);
    const d = fcs.ils!;
    check(`${id} ILS coupled to 200ft`, fcs.lat === 'LOC' && fcs.vert === 'GS' && Math.abs(d.loc) < 0.3 && Math.abs(d.gs) < 0.5, `loc ${d.loc.toFixed(2)} gs ${d.gs.toFixed(2)} dots, ias ${(a.ias / KT).toFixed(0)}`);
    return;
  }
  run(420, () => a.onGround && a.gs < 20 * KT);
  const ils = fcs.ils;
  check(`${id} autoland`, !a.crash && a.onGround, `touchdown VS ${(a.lastTouchVs / FPM).toFixed(0)} fpm, lat mode ${fcs.lat}, vert ${fcs.vert}, loc ${ils?.loc.toFixed(2)} ${a.crash?.reason ?? ''}`);
  const xtk = crossTrack(ap.thr, ap.locAnt, a);
  check(`${id} rollout centreline`, Math.abs(xtk) < 10, `xtk ${xtk.toFixed(1)} m, stop dist ${(distance(ap.thr, a)).toFixed(0)} m`);
  check(`${id} touchdown firmness`, a.lastTouchVs / FPM < 450, `${(a.lastTouchVs / FPM).toFixed(0)} fpm`);
}

function fbwHold() {
  const a = new Aircraft(getAircraft('a320neo'));
  const fcs = new FCS(a);
  const env = { weather: calm, ground: () => ({ h: 0, water: false, runway: false }), time: 0 };
  a.place(0, 0, 3000, 90, 250, 2);
  a.gearDown = false; a.gearPos = 0;
  a.setAllEngines(true);
  for (const c of a.engineCmd) c.throttle = 0.6;
  let t = 0;
  // roll in 30 deg bank then release
  while (t < 30) {
    pin.roll = a.phi * RAD < 30 && t < 10 ? 0.6 : 0;
    fcs.update(DT, pin); a.step(DT, env); t += DT;
    if (process.env.TRACE && Math.round(t * 120) % 120 === 0) console.log(`  t${t.toFixed(0)} alt ${(a.alt/FT).toFixed(0)} vs ${(a.vs/FPM).toFixed(0)} ias ${(a.ias/KT).toFixed(0)} th ${(a.theta*RAD).toFixed(1)} phi ${(a.phi*RAD).toFixed(1)} de ${a.de.toFixed(2)} trim ${a.trim.toFixed(2)} a ${(a.alpha*RAD).toFixed(1)} nz ${a.nz.toFixed(2)} q ${fcs.dbgQ.map(x=>x.toFixed(4)).join(",")}`);
  }
  pin.roll = 0;
  check('A320 normal law bank hold', Math.abs(a.phi * RAD - 30) < 4, `bank ${(a.phi * RAD).toFixed(1)} vs ${(a.vs / FPM).toFixed(0)} fpm`);
  check('A320 normal law path hold', Math.abs(a.vs / FPM) < 700, `vs ${(a.vs / FPM).toFixed(0)} fpm`);
}

function heliHover(id: string) {
  const a = new Aircraft(getAircraft(id));
  const fcs = new FCS(a);
  const env = { weather: calm, ground: () => ({ h: 0, water: false, runway: false }), time: 0 };
  a.place(0, 0, a.restHeight(), 0, 0);
  a.setAllEngines(true);
  for (const c of a.engineCmd) c.throttle = 1;
  let t = 0;
  let coll = 0.3;
  // simple pilot: collective PI to hold 10 m AGL
  let hi = 0;
  while (t < 60 && !a.crash) {
    const err = 10 - (a.agl - a.aero.cgHeight);
    hi += err * DT * 0.01;
    coll = 0.5 + err * 0.03 - a.vs * 0.05 + hi;
    pin.collective = Math.max(0, Math.min(1, coll));
    pin.pitch = 0; pin.roll = 0;
    pin.yaw = -a.w[2] * 0.5;
    fcs.update(DT, pin); a.step(DT, env); t += DT;
    if (process.env.TRACE && Math.round(t * 120) % 60 === 0) console.log(`  t${t.toFixed(1)} agl ${(a.agl - a.aero.cgHeight).toFixed(1)} vs ${a.vs.toFixed(1)} coll ${pin.collective.toFixed(2)} T/W ${a.CL.toFixed(2)} rpm ${(a.rotorRpm*100).toFixed(0)} th ${(a.theta*RAD).toFixed(1)} phi ${(a.phi*RAD).toFixed(1)} r ${a.w[2].toFixed(2)} gs ${a.gs.toFixed(1)}`);
  }
  check(`${id} hover`, !a.crash && Math.abs(a.agl - a.aero.cgHeight - 10) < 3 && a.gs < 5, `agl ${(a.agl - a.aero.cgHeight).toFixed(1)}m gs ${(a.gs / KT).toFixed(1)}kt coll ${pin.collective.toFixed(2)} rpm ${(a.rotorRpm * 100).toFixed(0)}% ${a.crash?.reason ?? ''}`);
  pin.collective = 0.5;
}

const which = process.argv[2];
if (!which || which === 'a320') flightTest('a320neo', { cruiseFt: 10000 });
if (!which || which === 'b738') flightTest('b737-800', { cruiseFt: 10000 });
if (!which || which === 'c172') flightTest('c172', { cruiseFt: 5000, climbSpd: 75, autoland: false });
if (!which || which === 'b77w') flightTest('b777-300er', { cruiseFt: 10000 });
if (!which || which === 'fbw') fbwHold();
if (!which || which === 'heli') { heliHover('h135'); heliHover('uh60'); heliHover('r44'); }
console.log(failures ? `\n${failures} failure(s)` : '\nall passed');
if (failures) process.exitCode = 1;
