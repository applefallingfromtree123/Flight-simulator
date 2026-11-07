// Headless autopilot test bench: the real flight model and FCS, flat ground at sea level, no rendering.
import { Aircraft } from '../../src/sim/fdm.ts';
import { FCS } from '../../src/sim/fcs.ts';
import { getAircraft } from '../../src/sim/aircraftDb.ts';
import { atmosphere, WEATHER_PRESETS } from '../../src/sim/atmosphere.ts';
import { maxThrust } from '../../src/sim/engines.ts';
import { DEG, FT, KT, FPM, clamp, qFromEuler } from '../../src/core/math.ts';
import { destination, distance, bearing } from '../../src/core/geo.ts';

export const DT = 1 / 120;
export function setup(id: string, altFt: number, spdKt: number, hdg = 90, wx = 'clear', flapIdx = 0, gear = false) {
  const def = getAircraft(id);
  const ac = new Aircraft(def);
  ac.fuel = def.m.fuel * 0.5; ac.payload = (def.m.mtow - def.m.e - ac.fuel) * 0.6;
  const weather = structuredClone(WEATHER_PRESETS[wx].w);
  const air = atmosphere(altFt * FT, weather.dT, weather.qnh * 100);
  const tas = spdKt * KT / Math.sqrt(air.sigma);
  ac.place(37.5, 127, altFt * FT, hdg, tas / KT);
  ac.flapIdx = flapIdx; ac.flapPos = ac.aero.flaps[flapIdx].deg; ac.gearDown = gear; ac.gearPos = gear ? 1 : 0;
  for (const e of ac.engines) { (e as any).running = true; }
  // trim like main.ts
  const A = ac.aero, q = 0.5 * air.rho * tas * tas, f = A.flaps[ac.flapIdx];
  const CL = (ac.mass * 9.80665) / (q * def.S);
  const alpha = A.a0 + (CL - f.dCL) / A.CLa;
  const psi = Math.atan2(ac.vel[1], ac.vel[0]);
  ac.q = qFromEuler(psi, alpha, 0);
  const Cm = A.Cm0 + A.Cma * alpha + f.dCm;
  ac.trim = clamp(-Cm / (A.Cmde * A.trimRange), -1, 1);
  const CD = A.CD0 + f.dCD + A.CDgear * ac.gearPos + CL * CL / (Math.PI * A.e * A.AR);
  const Tmax = maxThrust(def, air, tas, tas / air.a) * Math.max(1, def.eng.n);
  const thr = clamp(q * def.S * CD / Math.max(1, Tmax), 0.05, 0.95);
  for (const c of ac.engineCmd) c.throttle = thr;
  for (const e of ac.engines) e.spool = thr;
  const fcs = new FCS(ac);
  const env = { weather, ground: () => ({ h: 0, water: false, runway: true }), time: 43200 };
  fcs.selSpd = Math.round(spdKt); fcs.selAlt = Math.round(altFt / 100) * 100; fcs.selHdg = hdg;
  fcs.engageAp(true); fcs.lat = 'HDG'; fcs.vert = 'ALT'; fcs.altHold = altFt;
  if (fcs.hasAthr) fcs.toggleAthr();
  return { ac, fcs, env, def };
}
const zero = { pitch: 0, roll: 0, yaw: 0, trim: 0, collective: 0 };
export function run(s: ReturnType<typeof setup>, secs: number, every = 0, log?: (t: number) => void) {
  let t = 0;
  for (let i = 0; i < secs / DT; i++) {
    s.fcs.update(DT, zero); s.ac.step(DT, s.env); t += DT;
    if (s.ac.crash) { console.log('CRASH', s.ac.crash.reason); return false; }
    if (every && i % Math.round(every / DT) === 0 && log) log(t);
  }
  return true;
}
export const st = (s: ReturnType<typeof setup>) => {
  const a = s.ac, f = s.fcs;
  return `alt ${Math.round(a.alt / FT)} vs ${Math.round(a.vs / FPM)} ias ${Math.round(a.ias / KT)} M${a.mach.toFixed(2)} hdg ${Math.round(f.hdgM)} bank ${Math.round(a.phi / DEG)} pit ${(a.theta / DEG).toFixed(1)} thr ${(a.engineCmd[0].throttle * 100).toFixed(0)} ${f.lat}${f.latArmed ? '(' + f.latArmed + ')' : ''}/${f.vert}${f.vertArmed ? '(' + f.vertArmed + ')' : ''} ${f.athrDisplay}`;
};
export { DEG, FT, KT, FPM, destination, distance, bearing };
