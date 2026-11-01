// EGM96 geoid undulation (height of mean sea level above the WGS84 ellipsoid), 0.5° grid from the NGA data.
// Photorealistic 3D tiles use ellipsoid heights while the simulation flies mean sea level: this is the offset.
let grid: Int16Array | null = null;
const ROWS = 361, COLS = 720, STEP = 0.5;

export async function loadGeoid() {
  try {
    const r = await fetch('data/egm96-half.bin');
    if (r.ok) grid = new Int16Array(await r.arrayBuffer());
  } catch { /* offline: 0 */ }
}

/** Geoid height N (m) at lat/lon (degrees), bilinear; 0 until the grid is loaded. */
export function geoidHeight(lat: number, lon: number): number {
  if (!grid) return 0;
  const r = Math.min(ROWS - 1.0001, Math.max(0, (90 - lat) / STEP));
  const c = ((((lon % 360) + 360) % 360) / STEP);
  const r0 = Math.floor(r), c0 = Math.floor(c) % COLS, c1 = (c0 + 1) % COLS;
  const fr = r - r0, fc = c - Math.floor(c);
  const g = (row: number, col: number) => grid![row * COLS + col] / 100;
  const top = g(r0, c0) * (1 - fc) + g(r0, c1) * fc;
  const bot = g(r0 + 1, c0) * (1 - fc) + g(r0 + 1, c1) * fc;
  return top * (1 - fr) + bot * fr;
}
