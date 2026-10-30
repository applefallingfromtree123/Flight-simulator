// Real FlightGear aircraft models (converted by tools/fgconv, packed for the web by tools/fgconv/web.py):
// exterior mesh, real airline liveries, gear/flap poses and spinning props/rotors. Served from aircraft/.
// Aircraft without a converted model fall back to the procedural model (modelBuilder.ts).

export interface FgPose { group: string; values: number[]; nodes: string[] }
export interface FgSpin { node: string; pivot: [number, number, number]; axis: [number, number, number]; kind: 'prop' | 'rotor' | 'tail'; engine: number }
export interface FgLivery { id: string; name: string; file: string }
export interface FgModel {
  id: string; fdm: string; name: string; source: string; license: string;
  bounds: { min: [number, number, number]; max: [number, number, number] };
  groundY: number;
  /** Pilot eye point (glTF frame), whether interior.gltf exists, and the number of live display faces (screens.json). */
  eye?: [number, number, number]; interior?: boolean; screens?: number;
  poses: FgPose[]; spins: FgSpin[];
  defaultLivery: string; liveries: FgLivery[];
}

/** Livery ids of real FlightGear liveries are stored with this prefix (procedural ones have none). */
export const FG_PREFIX = 'fg:';
/** Extra web aircraft ids that may use a model converted for another flight model. */
const ALIAS: Record<string, string> = {};

const byAircraft = new Map<string, FgModel>();

export async function loadFgModels(): Promise<number> {
  try {
    const r = await fetch('aircraft/index.json', { cache: 'no-cache' });
    if (!r.ok) return 0;
    const idx = await r.json() as { aircraft: FgModel[] };
    for (const m of idx.aircraft) if (!byAircraft.has(m.fdm)) byAircraft.set(m.fdm, m);
    for (const [ac, fdm] of Object.entries(ALIAS)) { const m = byAircraft.get(fdm); if (m && !byAircraft.has(ac)) byAircraft.set(ac, m); }
  } catch { /* no converted models deployed: procedural only */ }
  return byAircraft.size;
}

export function fgModelFor(aircraftId: string): FgModel | undefined { return byAircraft.get(aircraftId); }

/** The FlightGear livery selected for an aircraft (stored id like 'fg:KAL'), or the model's default. */
export function fgLivery(m: FgModel, stored?: string): FgLivery {
  const id = stored?.startsWith(FG_PREFIX) ? stored.slice(FG_PREFIX.length) : m.defaultLivery;
  return m.liveries.find(l => l.id === id) ?? m.liveries[0];
}
