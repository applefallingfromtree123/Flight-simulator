import { Aircraft } from '../src/sim/fdm.ts';
import { getAircraft, AIRCRAFT } from '../src/sim/aircraftDb.ts';
import { WEATHER_PRESETS } from '../src/sim/atmosphere.ts';
import { KT, FPM, RAD, DEG, FT } from '../src/core/math.ts';

const wx = { ...WEATHER_PRESETS.clear.w, windSpd: 0, gust: 0, turbulence: 0 };
const env = { weather: wx, ground: () => ({ h: 0, water: false, runway: true }), time: 0 };
const ids = process.argv.slice(2);
for (const ac of AIRCRAFT.filter(a => !ids.length || ids.includes(a.id))) {
  if (ac.fdm === 'rotor') continue;
  const a = new Aircraft(ac);
  const A = a.aero;
  a.place(0, 0, a.restHeight(), 0, 0);
  a.setAllEngines(true);
  a.flapIdx = Math.min(a.aero.flaps.length - 1, ac.flaps === 'ga' ? 1 : ac.flaps === 'none' ? 0 : 2);
  a.flapPos = a.aero.flaps[a.flapIdx].deg;
  const dt = 1 / 240;
  let t = 0, liftoff = -1, vLift = 0, dist = 0;
  for (const c of a.engineCmd) c.throttle = 1;
  // takeoff: rotate at Vr to 8-10 deg pitch using simple P controller on pitch
  let rotated = false;
  let maxT = 240;
  let climbVs = 0;
  while (t < maxT) {
    const tgt = rotated ? (ac.cat === 'ga' || ac.cat === 'vintage' ? 8 : 12) : 0;
    if (a.ias > ac.v.vr * KT) rotated = true;
    const err = tgt * DEG - a.theta;
    a.cmd.de = Math.max(-1, Math.min(1, err * 4 - a.w[1] * 1.5 + (rotated ? 0.1 : 0)));
    a.cmd.da = -a.phi * 2 - a.w[0];
    a.cmd.dr = -a.w[2] * 3 - (a.ias > 25 ? a.beta * 2 : 0);
    a.step(dt, env);
    env.time = t;
    t += dt;
    if (!a.onGround && liftoff < 0 && a.agl > a.aero.cgHeight + 1) { liftoff = t; vLift = a.ias / KT; dist = a.lat * 111320; }
    if (liftoff > 0 && a.agl > 300) { a.gearDown = false; }
    if (liftoff > 0 && t - liftoff > 30 && t - liftoff < 31) climbVs = a.vs / FPM;
    if (a.crash) break;
  }
  const flaps0 = A.flaps[0];
  console.log(`${ac.id.padEnd(12)} CLa=${A.CLa.toFixed(2)} CLmax=${A.CLmax.toFixed(2)} CD0=${A.CD0.toFixed(4)} e=${A.e.toFixed(2)} ` +
    `LO ${liftoff.toFixed(1)}s @${vLift.toFixed(0)}kt dist ${dist.toFixed(0)}m climb30s ${climbVs.toFixed(0)}fpm ` +
    `end alt ${(a.alt / FT).toFixed(0)}ft ias ${(a.ias / KT).toFixed(0)} th ${(a.theta * RAD).toFixed(1)} a=${(a.alpha*RAD).toFixed(1)} ${a.crash?.reason ?? ''} ${flaps0 ? '' : ''}`);
}
