export type Category = 'airliner' | 'widebody' | 'regional' | 'bizjet' | 'turboprop' | 'ga' | 'military' | 'vintage' | 'helicopter' | 'glider';
export type EngineType = 'fan' | 'jet' | 'prop' | 'tprop' | 'shaft' | 'none';
export type EngineMount = 'wing' | 'wing4' | 'aft' | 'tri' | 'nose' | 'nacelle' | 'nacelle4' | 'internal' | 'internal2' | 'top';
export type FlapSchedule = 'boeing' | 'boeing747' | 'airbus' | 'ga' | 'bizjet' | 'regional' | 'fighter' | 'none' | 'split';
export type Cockpit = 'airliner' | 'g1000' | 'steam' | 'fighter' | 'heli';
export type FbwLaw = 'airbus' | 'boeing' | 'fighter' | null;

export interface EngineDef {
  t: EngineType;
  n: number;
  /** kN static thrust per engine (fan/jet) or kW shaft power per engine (prop/tprop/shaft). */
  p: number;
  ab?: number;         // kN with afterburner (jet)
  mount: EngineMount;
  bpr?: number;        // bypass ratio (fan)
  propD?: number;      // propeller diameter (m)
  blades?: number;
}

export interface AircraftDef {
  id: string;
  name: string;
  mfr: string;
  cat: Category;
  icao: string;
  fdm: 'fixed' | 'rotor';
  fbw: FbwLaw;
  cockpit: Cockpit;
  // geometry (m, m², deg)
  L: number; b: number; S: number; H: number; dia: number;
  sweep: number; dih: number; wing: 'low' | 'mid' | 'high';
  tail: 'conv' | 'T' | 'cruciform' | 'twin' | 'H' | 'delta';
  canard?: boolean;
  eng: EngineDef;
  m: { e: number; mtow: number; mlw: number; fuel: number; pay: number };
  v: {
    vs0: number; vs1: number; vr: number; vref: number;  // KIAS
    vmo: number; mmo: number; vle: number; vfe: number;
    cruise: number; cruiseFt: number; ceil: number;    // KTAS, ft, ft
    v2?: number;
  };
  flaps: FlapSchedule;
  gear: { t: 'tri' | 'tail' | 'skid' | 'float'; retract: boolean; wb?: number; track?: number; gh?: number };
  colors: [string, string, string, string]; // fuselage, tail, cheatline, engine
  // rotorcraft only
  rotor?: { D: number; blades: number; tail: 'rotor' | 'fenestron' | 'notar' | 'tandem' };
  apu?: boolean;
  spoilers?: boolean;
  reversers?: boolean;
  seats?: number;
  note?: string;
}

export interface FlapDetent { label: string; deg: number; dCL: number; dCLmax: number; dCD: number; dCm: number }

export const FLAP_SCHEDULES: Record<FlapSchedule, FlapDetent[]> = {
  boeing: [
    { label: 'UP', deg: 0, dCL: 0, dCLmax: 0, dCD: 0, dCm: 0 },
    { label: '1', deg: 1, dCL: 0.12, dCLmax: 0.45, dCD: 0.004, dCm: -0.005 },
    { label: '5', deg: 5, dCL: 0.25, dCLmax: 0.6, dCD: 0.010, dCm: -0.01 },
    { label: '10', deg: 10, dCL: 0.35, dCLmax: 0.72, dCD: 0.016, dCm: -0.015 },
    { label: '15', deg: 15, dCL: 0.45, dCLmax: 0.82, dCD: 0.022, dCm: -0.02 },
    { label: '25', deg: 25, dCL: 0.60, dCLmax: 0.95, dCD: 0.040, dCm: -0.03 },
    { label: '30', deg: 30, dCL: 0.72, dCLmax: 1.05, dCD: 0.060, dCm: -0.035 },
    { label: '40', deg: 40, dCL: 0.85, dCLmax: 1.12, dCD: 0.090, dCm: -0.04 },
  ],
  boeing747: [
    { label: 'UP', deg: 0, dCL: 0, dCLmax: 0, dCD: 0, dCm: 0 },
    { label: '1', deg: 1, dCL: 0.12, dCLmax: 0.45, dCD: 0.004, dCm: -0.005 },
    { label: '5', deg: 5, dCL: 0.25, dCLmax: 0.6, dCD: 0.010, dCm: -0.01 },
    { label: '10', deg: 10, dCL: 0.35, dCLmax: 0.72, dCD: 0.016, dCm: -0.015 },
    { label: '20', deg: 20, dCL: 0.50, dCLmax: 0.88, dCD: 0.030, dCm: -0.025 },
    { label: '25', deg: 25, dCL: 0.62, dCLmax: 0.97, dCD: 0.045, dCm: -0.03 },
    { label: '30', deg: 30, dCL: 0.75, dCLmax: 1.08, dCD: 0.065, dCm: -0.035 },
  ],
  airbus: [
    { label: '0', deg: 0, dCL: 0, dCLmax: 0, dCD: 0, dCm: 0 },
    { label: '1', deg: 10, dCL: 0.10, dCLmax: 0.45, dCD: 0.005, dCm: -0.005 },
    { label: '1+F', deg: 15, dCL: 0.25, dCLmax: 0.62, dCD: 0.012, dCm: -0.01 },
    { label: '2', deg: 20, dCL: 0.40, dCLmax: 0.78, dCD: 0.022, dCm: -0.02 },
    { label: '3', deg: 30, dCL: 0.58, dCLmax: 0.95, dCD: 0.040, dCm: -0.03 },
    { label: 'FULL', deg: 40, dCL: 0.78, dCLmax: 1.1, dCD: 0.075, dCm: -0.04 },
  ],
  regional: [
    { label: '0', deg: 0, dCL: 0, dCLmax: 0, dCD: 0, dCm: 0 },
    { label: '5', deg: 5, dCL: 0.20, dCLmax: 0.35, dCD: 0.008, dCm: -0.01 },
    { label: '10', deg: 10, dCL: 0.32, dCLmax: 0.5, dCD: 0.015, dCm: -0.015 },
    { label: '15', deg: 15, dCL: 0.45, dCLmax: 0.62, dCD: 0.025, dCm: -0.02 },
    { label: '35', deg: 35, dCL: 0.75, dCLmax: 0.9, dCD: 0.075, dCm: -0.035 },
  ],
  bizjet: [
    { label: 'UP', deg: 0, dCL: 0, dCLmax: 0, dCD: 0, dCm: 0 },
    { label: '15', deg: 15, dCL: 0.30, dCLmax: 0.4, dCD: 0.015, dCm: -0.015 },
    { label: '35', deg: 35, dCL: 0.65, dCLmax: 0.75, dCD: 0.065, dCm: -0.035 },
  ],
  ga: [
    { label: 'UP', deg: 0, dCL: 0, dCLmax: 0, dCD: 0, dCm: 0 },
    { label: '10°', deg: 10, dCL: 0.20, dCLmax: 0.22, dCD: 0.008, dCm: -0.02 },
    { label: '20°', deg: 20, dCL: 0.38, dCLmax: 0.38, dCD: 0.022, dCm: -0.035 },
    { label: '30°', deg: 30, dCL: 0.52, dCLmax: 0.5, dCD: 0.045, dCm: -0.05 },
  ],
  split: [
    { label: 'UP', deg: 0, dCL: 0, dCLmax: 0, dCD: 0, dCm: 0 },
    { label: 'DN', deg: 50, dCL: 0.45, dCLmax: 0.4, dCD: 0.08, dCm: -0.05 },
  ],
  fighter: [
    { label: 'AUTO', deg: 0, dCL: 0, dCLmax: 0, dCD: 0, dCm: 0 },
    { label: 'HALF', deg: 20, dCL: 0.25, dCLmax: 0.3, dCD: 0.02, dCm: -0.01 },
    { label: 'FULL', deg: 40, dCL: 0.4, dCLmax: 0.45, dCD: 0.04, dCm: -0.02 },
  ],
  none: [{ label: '—', deg: 0, dCL: 0, dCLmax: 0, dCD: 0, dCm: 0 }],
};
