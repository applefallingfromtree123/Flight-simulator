// Takeoff from the runway: throttle up (auto TOGA), rotate by hand at VR, AP on at 400 ft with NAV/VNAV armed.
import { qFromEuler } from '../../src/core/math.ts';
import { setup, run, st, DEG, FT, KT, FPM, destination } from './harness.ts';
const id = process.argv[2] ?? 'a320neo';
const s = setup(id, 0, 0, 90, 'clear', 1, true);
const { ac, fcs, env } = s;
ac.place(37.5, 127, ac.restHeight(), 90, 0); ac.setAllEngines(true); for (const e of ac.engines) e.spool = 0.2; ac.trim = 0.1;

fcs.engageAp(false); fcs.lat = 'OFF'; fcs.vert = 'OFF'; fcs.athr = 'OFF'; fcs.ap = false;
fcs.plan.wps = [{ ident: 'DEP', lat: 37.5, lon: 127, kind: 'apt' }, { ident: 'WP1', ...destination({ lat: 37.5, lon: 127 }, 120, 40 * 1852), kind: 'fix' }];
fcs.plan.active = 1; fcs.plan.cruiseFt = 20000; fcs.selAlt = 20000;
fcs.latArmed = 'NAV'; fcs.vertArmed = 'VNAV'; fcs.spdManaged = true;
for (const c of ac.engineCmd) c.throttle = 1;
const v = fcs.vSpeeds();
let pitchIn = 0, apOn = false;
const pin = { pitch: 0, roll: 0, yaw: 0, trim: 0, collective: 0 };
let last = '';
for (let i = 0; i < 240 * 120; i++) {
  const ias = ac.ias / KT, ra = ac.agl / FT;
  pin.pitch = 0;
  if (!apOn) {
    if (ias > v.vr || !ac.onGround) { // hand flying: follow the FD pitch bar
      pin.pitch = Math.max(-0.5, Math.min(0.6, (fcs.fdPitch - ac.theta / DEG) * 0.08 - ac.w[1] * 0.6));
    }
    pin.roll = Math.max(-0.4, Math.min(0.4, (fcs.fdRoll - ac.phi / DEG) * 0.03));
    if (ra > 400) { fcs.engageAp(true); apOn = true; console.log('AP ON'); }
  } else pin.roll = 0;
  if (ra > 3000 && ac.flapIdx > 0 && ias > fcs.vls() + 20) ac.flapIdx = 0;
  if (ra > 300) ac.gearDown = false;
  fcs.update(1 / 120, pin); ac.step(1 / 120, env);
  if (ac.crash) { console.log('CRASH', ac.crash.reason); break; }
  const ph = `${fcs.lat}${fcs.latArmed ? '(' + fcs.latArmed + ')' : ''}/${fcs.vertFma}${fcs.vertArmed ? '(' + fcs.vertArmed + ')' : ''} ${fcs.athrDisplay}`;
  if (ph !== last || i % (120 * 20) === 0) { console.log(`t${(i / 120).toFixed(0)} ${st(s)} ra ${Math.round(ra)} tgt ${Math.round(fcs.targetIas())} | ${ph}`); last = ph; }
}
