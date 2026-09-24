// Aircraft systems: electrical, APU, lighting, engine start logic, and the alerting system
// (master warning/caution, stall/overspeed, configuration, GPWS modes, altitude callouts).
import { FPM, FT, KT, RAD, clamp } from '../core/math.ts';
import type { Aircraft } from './fdm.ts';
import type { FCS } from './fcs.ts';

export interface Switches {
  battery: boolean; avionics: boolean; fuelPump: boolean; apu: boolean; apuBleed: boolean;
  beacon: boolean; nav: boolean; strobe: boolean; landing: boolean; taxi: boolean;
  engMaster: boolean[]; starter: boolean[]; ignition: boolean; seatbelt: boolean; antiIce: boolean;
}

export type AlertLevel = 'warning' | 'caution' | 'advisory';
export interface Alert { id: string; text: string; level: AlertLevel }

export class Systems {
  sw: Switches;
  apuN = 0;           // APU speed %
  apuAvail = false;
  battCharge = 1;
  alerts: Alert[] = [];
  masterWarning = false; masterCaution = false;
  private ackWarn = new Set<string>(); private ackCaut = new Set<string>();
  /** Queue of voice / sound events consumed by the audio system. */
  events: string[] = [];
  private lastRa = 99999;
  private calloutsDone = new Set<number>();
  private gpwsT = 0;
  private altAlertArmed = true;
  minimums = 200; // ft (DH/MDA, radio)
  baroStd = false; baroHpa = 1013;

  constructor(private ac: Aircraft, private fcs: FCS) {
    const n = ac.engines.length;
    this.sw = {
      battery: false, avionics: false, fuelPump: false, apu: false, apuBleed: false,
      beacon: false, nav: false, strobe: false, landing: false, taxi: false,
      engMaster: Array(n).fill(false), starter: Array(n).fill(false), ignition: false, seatbelt: false, antiIce: false,
    };
  }

  get hasApu() { return !!this.ac.def.apu; }
  get elecPowered() { return this.sw.battery && (this.battCharge > 0.02 || this.ac.engines.some(e => e.running) || this.apuAvail); }
  get avionicsPowered() { return this.elecPowered && (this.sw.avionics || this.ac.def.cockpit === 'steam'); }

  /** Everything on and running (auto-start / spawn ready). */
  setReady(running: boolean) {
    const s = this.sw;
    s.battery = s.avionics = s.fuelPump = s.nav = s.beacon = s.ignition = running;
    s.strobe = s.landing = false;
    s.engMaster = s.engMaster.map(() => running);
    s.starter = s.starter.map(() => false);
    this.ac.setAllEngines(running);
    for (const c of this.ac.engineCmd) { c.cutoff = !running; c.mixture = 1; c.prop = 1; }
    if (this.ac.isRotor && running) for (const c of this.ac.engineCmd) c.throttle = 1;
  }

  update(dt: number) {
    const a = this.ac, s = this.sw;
    // APU
    const apuOn = this.hasApu && s.apu && this.elecPowered;
    this.apuN = clamp(this.apuN + (apuOn ? 12 : -15) * dt, 0, 100);
    this.apuAvail = this.apuN > 95;
    // battery
    const charging = a.engines.some(e => e.running) || this.apuAvail;
    if (s.battery) this.battCharge = clamp(this.battCharge + (charging ? 0.01 : -0.0004) * dt, 0, 1);
    // engine commands from switches
    const bleed = this.apuAvail && s.apuBleed || a.engines.some(e => e.running && (e.def.t === 'fan' || e.def.t === 'jet')) || a.def.eng.t !== 'fan';
    a.engines.forEach((e, i) => {
      const c = a.engineCmd[i];
      c.cutoff = !s.engMaster[i] || (!s.fuelPump && a.def.eng.t !== 'prop' && a.alt > 6000 && false);
      c.ignition = s.ignition || e.def.t === 'prop' ? s.engMaster[i] : false;
      c.starter = s.starter[i] && this.elecPowered && (e.def.t === 'fan' || e.def.t === 'jet' ? bleed : true);
      if (e.running && s.starter[i] && (e.def.t === 'prop' || e.n2 > 55 || e.ng > 55)) s.starter[i] = false;
    });
    this.alertsUpdate(dt);
  }

  private raise(list: Alert[], id: string, text: string, level: AlertLevel) { list.push({ id, text, level }); }

  private alertsUpdate(dt: number) {
    const a = this.ac, f = this.fcs, d = a.def;
    const list: Alert[] = [];
    const ias = a.ias / KT;
    const ra = (a.agl - a.aero.cgHeight) / FT;
    const vs = a.vs / FPM;
    const air = !a.onGround;
    const thrIdle = a.engineCmd.every(c => c.throttle < 0.25);
    if (!a.isRotor) {
      if (air && (a.stall > 0.15 || (f.alphaProt && d.fbw !== 'airbus'))) this.raise(list, 'STALL', 'STALL', 'warning');
      if (ias > d.v.vmo + 4 || a.mach > d.v.mmo + 0.01) this.raise(list, 'OVSPD', 'OVERSPEED', 'warning');
      if (d.gear.retract && !a.gearDown && air && ra < 800 && (thrIdle || a.flapIdx >= a.aero.flaps.length - 2) && vs < 0) this.raise(list, 'GEAR', 'L/G NOT DOWN', 'warning');
      if (a.onGround && a.gs < 30 * KT && a.engineCmd.some(c => c.throttle > 0.7)) {
        if (a.flapIdx === 0 && d.flaps !== 'none' && d.cat !== 'ga' && d.cat !== 'vintage' && d.cockpit !== 'fighter') this.raise(list, 'CFGFLAP', 'CONFIG: FLAPS', 'warning');
        if (a.parkingBrake) this.raise(list, 'CFGPB', 'CONFIG: PARK BRK ON', 'warning');
        if (Math.abs(a.trim) > 0.6) this.raise(list, 'CFGTRIM', 'CONFIG: PITCH TRIM', 'warning');
      }
      const vfe = d.v.vfe;
      if (a.flapIdx > 0 && ias > vfe + 5 && d.flaps !== 'none') this.raise(list, 'VFE', 'FLAP OVERSPEED', 'warning');
      if (a.gearPos > 0.1 && d.gear.retract && ias > d.v.vle + 5) this.raise(list, 'VLE', 'GEAR OVERSPEED', 'caution');
      if (a.spoilerPos > 0.1 && a.engineCmd.some(c => c.throttle > 0.7) && air) this.raise(list, 'SPD BRK', 'SPEED BRAKE EXTENDED', 'caution');
    } else {
      if (a.rotorRpm < 0.92 && air) this.raise(list, 'LOWNR', 'LOW ROTOR RPM', 'warning');
      if (a.torquePct > 100) this.raise(list, 'TRQ', 'TORQUE LIMIT', 'caution');
      if (a.stall > 0.3) this.raise(list, 'VRS', 'VORTEX RING', 'warning');
    }
    const fuelFrac = d.m.fuel > 0 ? a.fuel / d.m.fuel : 1;
    if (fuelFrac < 0.08 && d.m.fuel > 0) this.raise(list, 'FUEL', 'FUEL LOW', 'caution');
    a.engines.forEach((e, i) => {
      if (!e.running && this.sw.engMaster[i] && !this.sw.starter[i] && air) this.raise(list, `ENG${i}`, `ENG ${i + 1} FAIL`, 'warning');
      if (e.running && e.oilP < 10 && e.def.t !== 'none') this.raise(list, `OIL${i}`, `ENG ${i + 1} OIL PRESS`, 'caution');
      if (e.fire) this.raise(list, `FIRE${i}`, `ENG ${i + 1} FIRE`, 'warning');
    });
    if (!this.elecPowered) this.raise(list, 'ELEC', 'ELEC: NO POWER', 'caution');
    else if (!this.sw.avionics && d.cockpit !== 'steam') this.raise(list, 'AVI', 'AVIONICS OFF', 'advisory');
    if (a.parkingBrake && a.onGround) this.raise(list, 'PB', 'PARK BRK', 'advisory');
    if (f.apDisconnectWarn > 0) this.raise(list, 'APOFF', 'AP OFF', 'warning');
    if (air && Math.abs(a.phi * RAD) > 35 && !a.isRotor && d.cockpit !== 'fighter' && d.id !== 'extra330') this.raise(list, 'BANK', 'BANK ANGLE', 'warning');
    if (a.tailStrike) this.raise(list, 'TAIL', 'TAIL STRIKE', 'caution');

    // ── GPWS (modes 1, 2, 4) & callouts ──
    this.gpwsT -= dt;
    const gpwsOn = air && !a.isRotor && ra < 2500 && d.cat !== 'glider';
    if (gpwsOn) {
      const sinkLimit = ra < 1000 ? 1500 + ra * 1.2 : 2800 + (ra - 1000) * 1.0;
      const pullLimit = sinkLimit * 1.45;
      const nearAirport = !!f.plan.approach && (f.ils?.distNm ?? 99) < 6;
      const closure = -vs; // simplified: terrain closure ≈ sink over flat ground
      if (vs < -pullLimit) { this.raise(list, 'PULLUP', 'PULL UP', 'warning'); this.say('pull up', 1.5); }
      else if (vs < -sinkLimit) { this.raise(list, 'SINK', 'SINK RATE', 'warning'); this.say('sink rate', 2.5); }
      else if (closure > 3500 && ra < 1800 && !nearAirport) { this.raise(list, 'TERR', 'TERRAIN', 'warning'); this.say('terrain terrain', 2.5); }
      if (ra < 500 && !a.gearDown && d.gear.retract && ias < 190) { this.raise(list, 'TLG', 'TOO LOW GEAR', 'warning'); this.say('too low gear', 3); }
      else if (ra < 245 && a.flapIdx < a.aero.flaps.length - 2 && d.flaps !== 'none' && vs < 0 && ias < 160 && d.cat !== 'ga' && d.cockpit !== 'fighter') { this.raise(list, 'TLF', 'TOO LOW FLAPS', 'warning'); this.say('too low flaps', 3); }
      if (list.some(x => x.id === 'BANK')) this.say('bank angle', 3);
      if (list.some(x => x.id === 'STALL')) this.events.push('stall');
      if (list.some(x => x.id === 'OVSPD')) this.events.push('overspeed');
      if (f.ils && f.ils.gsValid && f.vert !== 'GS' && ra < 1000 && f.ils.gs > 1.3 && vs < 0) { this.say('glideslope', 3); }
    }
    // radio-altitude callouts (airliners/bizjets)
    const callouts = d.cat === 'ga' || d.cat === 'vintage' || d.cat === 'glider' || a.isRotor ? [] : [2500, 1000, 500, 100, 50, 40, 30, 20, 10];
    if (air && vs < -100) {
      for (const c of callouts) {
        if (this.lastRa > c && ra <= c && !this.calloutsDone.has(c)) {
          this.calloutsDone.add(c);
          this.events.push(`say:${c === 2500 ? 'twenty five hundred' : c === 1000 ? 'one thousand' : c === 500 ? 'five hundred' : c === 100 ? 'one hundred' : String(c)}`);
          if (c === 20 && d.fbw === 'airbus' && !thrIdle) this.events.push('say:retard');
        }
      }
      if (this.lastRa > this.minimums + 100 && ra <= this.minimums + 100 && !this.calloutsDone.has(-1)) { this.calloutsDone.add(-1); this.events.push('say:approaching minimums'); }
      if (this.lastRa > this.minimums && ra <= this.minimums && !this.calloutsDone.has(-2)) { this.calloutsDone.add(-2); this.events.push('say:minimums'); }
    }
    if (ra > 2600 || a.onGround && a.gs < 30 * KT) this.calloutsDone.clear();
    this.lastRa = ra;
    // altitude alert (C-chord) when approaching selected altitude
    const altErr = Math.abs(f.selAlt - a.alt / FT);
    if (altErr < 1000 && altErr > 900 && this.altAlertArmed && air) { this.events.push('altalert'); this.altAlertArmed = false; }
    if (altErr > 1100) this.altAlertArmed = true;

    // master warning/caution latching
    for (const al of list) {
      if (al.level === 'warning' && !this.ackWarn.has(al.id)) this.masterWarning = true;
      if (al.level === 'caution' && !this.ackCaut.has(al.id)) this.masterCaution = true;
    }
    for (const id of [...this.ackWarn]) if (!list.some(x => x.id === id)) this.ackWarn.delete(id);
    for (const id of [...this.ackCaut]) if (!list.some(x => x.id === id)) this.ackCaut.delete(id);
    if (!list.some(x => x.level === 'warning' && !this.ackWarn.has(x.id))) this.masterWarning = false;
    if (!list.some(x => x.level === 'caution' && !this.ackCaut.has(x.id))) this.masterCaution = false;
    this.alerts = list;
  }
  ackMaster() {
    for (const al of this.alerts) (al.level === 'warning' ? this.ackWarn : this.ackCaut).add(al.id);
    this.masterWarning = this.masterCaution = false;
  }
  private say(text: string, every: number) {
    if (this.gpwsT > 0) return;
    this.gpwsT = every;
    this.events.push('say:' + text);
  }
}
