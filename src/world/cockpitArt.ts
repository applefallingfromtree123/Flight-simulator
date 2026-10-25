// Static artwork painted onto the 3D flight deck: instrument panels (bezels, annunciators,
// gear/autobrake/clock), pedestal (MCDUs, thrust quadrant, radios), EFIS panels and overheads.
// Everything is drawn in metres on the surface and rasterised at a fixed pixel density.
import { FONT } from '../avionics/common.ts';

export interface Art { key: string; W: number; H: number; draw: (g: CanvasRenderingContext2D) => void; dim?: boolean }
/** Screen rectangle on a surface: centre (u, v) and size, all in metres from the surface's top-left. */
export interface Rect { x: number; y: number; w: number; h: number; kind: string }

type G = CanvasRenderingContext2D;

// ───────────────────────── primitives (metres) ─────────────────────────
export function rrect(g: G, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
}
/** Text at (x, y) with cap height hM (metres). */
export function label(g: G, s: string, x: number, y: number, hM: number, color = '#e8edf2', align: CanvasTextAlign = 'center', weight = 'bold') {
  g.save(); g.translate(x, y);
  const k = hM / 72; g.scale(k, k);
  g.font = `${weight} 100px ${FONT}`; g.fillStyle = color; g.textAlign = align; g.textBaseline = 'middle';
  g.fillText(s, 0, 0); g.restore();
}
function screw(g: G, x: number, y: number, r = 0.0035) {
  g.fillStyle = '#8b939b'; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#3b4146'; g.lineWidth = r * 0.4; g.beginPath(); g.moveTo(x - r * 0.7, y); g.lineTo(x + r * 0.7, y); g.stroke();
}
function knob(g: G, x: number, y: number, r: number, cap = '#2b2f34', ptr = '#e8edf2', ang = -0.6) {
  const grd = g.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  grd.addColorStop(0, '#5a6066'); grd.addColorStop(1, cap);
  g.fillStyle = '#0d0f11'; g.beginPath(); g.arc(x, y + r * 0.12, r * 1.08, 0, Math.PI * 2); g.fill();
  g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  g.strokeStyle = ptr; g.lineWidth = r * 0.16; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.sin(ang) * r * 0.85, y - Math.cos(ang) * r * 0.85); g.stroke();
}
/** Square pushbutton with a two-line legend (Airbus "dark cockpit" style). */
function pushbutton(g: G, x: number, y: number, s: number, top: string, bot: string, topC = '#e8edf2', botC = '#3ee07a', lit = false) {
  g.fillStyle = '#121417'; rrect(g, x - s / 2 - 0.002, y - s / 2 - 0.002, s + 0.004, s + 0.004, s * 0.12); g.fill();
  g.fillStyle = '#23272b'; rrect(g, x - s / 2, y - s / 2, s, s, s * 0.1); g.fill();
  if (top) label(g, top, x, y - s * 0.2, s * 0.2, lit ? topC : '#4a4f55');
  if (bot) label(g, bot, x, y + s * 0.22, s * 0.2, lit ? botC : '#4a4f55');
}
function toggle(g: G, x: number, y: number, s: number, up = true) {
  g.fillStyle = '#1a1c1f'; g.beginPath(); g.arc(x, y, s * 0.5, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#c9ced4'; rrect(g, x - s * 0.13, up ? y - s * 0.9 : y, s * 0.26, s * 0.9, s * 0.1); g.fill();
}
function sevenSeg(g: G, s: string, x: number, y: number, h: number, color = '#ff9d2e', bg = '#060707') {
  const w = h * 0.62 * s.length + h * 0.4;
  g.fillStyle = bg; g.fillRect(x - w / 2, y - h * 0.7, w, h * 1.4);
  label(g, s, x, y, h, color, 'center', '600');
}
function noise(g: G, W: number, H: number, alpha = 0.035, n = 9000) {
  let s = 1234567;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) { g.fillStyle = r() > 0.5 ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`; g.fillRect(r() * W, r() * H, 1.5, 1.5); }
}

/** Cesium writes unlit material colours through its linear→sRGB output, so store the art pre-linearised. */
const LUT = new Uint8ClampedArray(256).map((_, i) => Math.round(255 * Math.pow(i / 255, 2.2)));
function toLinear(g: G, W: number, H: number) {
  const im = g.getImageData(0, 0, W, H), d = im.data;
  for (let i = 0; i < d.length; i += 4) { d[i] = LUT[d[i]]; d[i + 1] = LUT[d[i + 1]]; d[i + 2] = LUT[d[i + 2]]; }
  g.putImageData(im, 0, 0);
}

/** Build an Art of a w×h metre surface at `ppm` pixels per metre; draw() works in metres. */
export function surface(key: string, w: number, h: number, ppm: number, draw: (g: G) => void, dim = true): Art {
  const W = Math.max(64, Math.min(4096, Math.round(w * ppm))), H = Math.max(64, Math.min(4096, Math.round(h * ppm)));
  return { key, W, H, dim, draw: g => { g.save(); g.scale(W / w, H / h); draw(g); g.restore(); noise(g, W, H); toLinear(g, W, H); } };
}

// ───────────────────────── instrument panels ─────────────────────────
function bezel(g: G, r: Rect, style: 'airbus' | 'boeing' | 'ga' | 'mfd') {
  const m = style === 'ga' ? 0.03 : 0.024;
  const x = r.x - r.w / 2 - m, y = r.y - r.h / 2 - m, w = r.w + 2 * m, h = r.h + 2 * m;
  g.fillStyle = 'rgba(0,0,0,0.35)'; rrect(g, x + 0.004, y + 0.006, w, h, 0.012); g.fill();
  g.fillStyle = style === 'airbus' ? '#2c3237' : '#1d2024'; rrect(g, x, y, w, h, 0.012); g.fill();
  g.fillStyle = '#050607'; g.fillRect(r.x - r.w / 2 - 0.003, r.y - r.h / 2 - 0.003, r.w + 0.006, r.h + 0.006);
  if (style === 'airbus') { knob(g, x + 0.012, y + h - 0.012, 0.007); screw(g, x + w - 0.01, y + 0.01, 0.0025); }
  if (style === 'boeing') for (let i = 0; i < 4; i++) { g.fillStyle = '#3a3f45'; rrect(g, x + 0.03 + i * (w - 0.06) / 3.4, y + h - 0.016, 0.03, 0.01, 0.002); g.fill(); }
  if (style === 'mfd') {
    for (let i = 0; i < 5; i++) {
      const t = (i + 0.5) / 5;
      for (const [bx, by] of [[x + 0.006 + t * (w - 0.012), y + 0.009], [x + 0.006 + t * (w - 0.012), y + h - 0.009], [x + 0.009, y + 0.006 + t * (h - 0.012)], [x + w - 0.009, y + 0.006 + t * (h - 0.012)]]) {
        g.fillStyle = '#3d4248'; rrect(g, bx - 0.006, by - 0.005, 0.012, 0.01, 0.002); g.fill();
      }
    }
  }
  if (style === 'ga') {
    // G1000-style softkeys under the screen and paired knobs on both sides
    for (let i = 0; i < 12; i++) { g.fillStyle = '#3b4046'; rrect(g, x + 0.04 + i * (w - 0.08) / 12, y + h - 0.02, (w - 0.08) / 12 - 0.004, 0.011, 0.002); g.fill(); }
    for (const kx of [x + 0.016, x + w - 0.016]) for (let i = 0; i < 3; i++) knob(g, kx, y + 0.04 + i * (h - 0.08) / 2, 0.009, '#26292d', '#aab2ba', 0.4 * i);
  }
}

export function airlinerPanel(W: number, H: number, screens: Rect[], airbus: boolean, ay: number, toPx: (y: number) => number): (g: G) => void {
  const base = airbus ? '#5f6d79' : '#5c6166';
  return g => {
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, airbus ? '#6a7884' : '#676c71'); grd.addColorStop(1, base);
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    // sub-panel seams + screws (captain | centre | F/O)
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 0.003;
    for (const yy of [-(ay + 0.27), -0.17, 0.17, ay + 0.27]) { const x = toPx(yy); g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (const yy of [-(ay + 0.26), -0.18, 0.18, ay + 0.26, -0.16, 0.16, -(ay + 0.28), ay + 0.28]) { screw(g, toPx(yy), 0.012); screw(g, toPx(yy), H - 0.012); }
    for (const r of screens) bezel(g, r, airbus ? 'airbus' : 'boeing');
    // glareshield-side annunciators above each pilot's displays
    for (const side of [-1, 1]) {
      const cx = toPx(side * ay);
      pushbutton(g, cx - 0.09, 0.03, 0.034, 'MASTER', 'WARN', '#ff4040', '#ff4040');
      pushbutton(g, cx - 0.045, 0.03, 0.034, 'MASTER', 'CAUT', '#ffb020', '#ffb020');
      pushbutton(g, cx + 0.0, 0.03, 0.034, airbus ? 'SIDE STICK' : 'A/P', airbus ? 'PRIORITY' : 'DISC', '#ff4040', '#ff4040');
      pushbutton(g, cx + 0.045, 0.03, 0.034, 'AUTO', 'LAND', '#ff4040', '#ff4040');
      pushbutton(g, cx + 0.09, 0.03, 0.034, 'CHRONO', '', '#e8edf2');
      label(g, side < 0 ? 'CAPT' : 'F/O', cx + 0.15, 0.03, 0.009, '#d0d6dc');
    }
    // centre lower: landing gear, autobrake, brake pressure, clock
    const gx = toPx(0.105), gy = H - 0.09;
    g.fillStyle = '#2a2f34'; rrect(g, gx - 0.035, gy - 0.07, 0.07, 0.14, 0.01); g.fill();
    g.fillStyle = '#0c0d0f'; g.fillRect(gx - 0.006, gy - 0.06, 0.012, 0.12);
    g.fillStyle = '#e6e9ec'; g.beginPath(); g.arc(gx, gy + 0.045, 0.018, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#b8bec4'; g.fillRect(gx - 0.018, gy + 0.043, 0.036, 0.004);
    label(g, 'LDG GEAR', gx, gy - 0.08, 0.008);
    label(g, 'UP', gx + 0.05, gy - 0.05, 0.008); label(g, 'DN', gx + 0.05, gy + 0.05, 0.008);
    for (let i = 0; i < 3; i++) { const tx = toPx(0.03) + (i - 1) * 0.03, ty = gy - 0.03; g.fillStyle = '#0a0b0c'; g.fillRect(tx - 0.012, ty - 0.012, 0.024, 0.024); g.fillStyle = '#3ee07a'; g.beginPath(); g.moveTo(tx, ty + 0.008); g.lineTo(tx - 0.008, ty - 0.006); g.lineTo(tx + 0.008, ty - 0.006); g.closePath(); g.fill(); }
    label(g, 'AUTO BRK', toPx(0.03), gy + 0.0, 0.008);
    ['LO', 'MED', 'MAX'].forEach((t, i) => pushbutton(g, toPx(0.03) + (i - 1) * 0.036, gy + 0.03, 0.03, t, 'ON', '#e8edf2', '#3ee07a'));
    // brake pressure triple gauge
    const bx = toPx(-0.08), by = gy;
    g.fillStyle = '#0a0b0c'; g.beginPath(); g.arc(bx, by, 0.03, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#e8edf2'; g.lineWidth = 0.0015; g.beginPath(); g.arc(bx, by, 0.024, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
    g.strokeStyle = '#3ee07a'; g.lineWidth = 0.002; g.beginPath(); g.moveTo(bx, by); g.lineTo(bx - 0.012, by - 0.018); g.stroke();
    label(g, 'BRAKES', bx, by + 0.02, 0.006); label(g, 'ACCU PRESS', bx, by - 0.036, 0.006);
    // clocks at the outboard lower corners
    for (const side of [-1, 1]) {
      const cx = toPx(side * (ay + 0.2)), cy = H - 0.06;
      g.fillStyle = '#16191c'; g.beginPath(); g.arc(cx, cy, 0.034, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#060707'; g.fillRect(cx - 0.024, cy - 0.016, 0.048, 0.014); label(g, '12:00', cx, cy - 0.009, 0.007, '#ff9d2e', 'center', '600');
      g.fillRect(cx - 0.024, cy + 0.004, 0.048, 0.014); label(g, '00:00', cx, cy + 0.011, 0.007, '#ff9d2e', 'center', '600');
      label(g, 'CLOCK', cx, cy - 0.028, 0.0055);
    }
    // small switches between ND and centre (loudspeaker / console lights)
    for (const side of [-1, 1]) { knob(g, toPx(side * (ay - 0.25)), H - 0.06, 0.012); label(g, 'LOUD SPKR', toPx(side * (ay - 0.25)), H - 0.035, 0.0055); }
  };
}

export function gaPanel(W: number, H: number, screens: Rect[], steam: boolean, toPx: (y: number) => number): (g: G) => void {
  return g => {
    g.fillStyle = steam ? '#4a4e53' : '#41454b'; g.fillRect(0, 0, W, H);
    // brushed trim strip at the top
    const grd = g.createLinearGradient(0, 0, 0, 0.03); grd.addColorStop(0, '#4b5056'); grd.addColorStop(1, '#2a2d31');
    g.fillStyle = grd; g.fillRect(0, 0, W, 0.03);
    for (const r of screens) bezel(g, r, r.kind === 'six' ? 'mfd' : 'ga');
    // annunciator strip
    const ax = toPx(-0.05);
    g.fillStyle = '#0b0c0d'; g.fillRect(ax - 0.07, 0.04, 0.14, 0.022);
    ['OIL', 'VAC', 'VOLT', 'FUEL'].forEach((t, i) => label(g, t, ax - 0.052 + i * 0.035, 0.051, 0.006, '#5a4a22'));
    // bottom switch row (rockers) and ignition
    const sw = ['MASTER', 'AVIONICS', 'FUEL PUMP', 'BCN', 'LAND', 'TAXI', 'NAV', 'STROBE', 'PITOT HT'];
    sw.forEach((t, i) => {
      const x = toPx(-0.5) + 0.02 + i * 0.045, y = H - 0.045;
      g.fillStyle = '#0d0e10'; rrect(g, x - 0.012, y - 0.02, 0.024, 0.032, 0.003); g.fill();
      g.fillStyle = i < 2 ? '#a3262a' : '#1d2024'; rrect(g, x - 0.009, y - 0.017, 0.018, 0.014, 0.002); g.fill();
      label(g, t, x, y + 0.022, 0.0048);
    });
    knob(g, toPx(-0.5) + 0.02, H - 0.11, 0.016, '#30343a', '#e8edf2', -1.2); label(g, 'OFF  R  L  BOTH  START', toPx(-0.5) + 0.02, H - 0.085, 0.0042);
    // radio stack (COM/NAV, transponder) to the right of the screens
    const rx = toPx(0.42);
    if (rx < W - 0.05) {
      for (let i = 0; i < 3; i++) {
        const y = 0.06 + i * 0.05;
        g.fillStyle = '#121416'; rrect(g, rx - 0.075, y - 0.02, 0.15, 0.04, 0.004); g.fill();
        if (i < 2) { sevenSeg(g, i ? '113.90' : '118.70', rx - 0.03, y, 0.011, '#47e08a'); sevenSeg(g, i ? '110.30' : '121.50', rx + 0.04, y, 0.011, '#47e08a'); }
        else { sevenSeg(g, '1200', rx, y, 0.012, '#ff9d2e'); label(g, 'ALT', rx + 0.055, y, 0.006); }
      }
    }
    // throttle / mixture placards (the 3D throttle plunger sits at centre)
    const tx = toPx(0);
    label(g, 'THROTTLE', tx, H - 0.03, 0.006);
    g.fillStyle = '#b5202a'; g.beginPath(); g.arc(tx + 0.07, H - 0.07, 0.014, 0, Math.PI * 2); g.fill(); label(g, 'MIXTURE', tx + 0.07, H - 0.03, 0.006);
    g.fillStyle = '#e8e8e8'; g.beginPath(); g.arc(tx - 0.07, H - 0.07, 0.012, 0, Math.PI * 2); g.fill(); label(g, 'CARB HEAT', tx - 0.07, H - 0.03, 0.006);
  };
}

export function fighterPanel(W: number, H: number, screens: Rect[], toPx: (y: number) => number): (g: G) => void {
  return g => {
    g.fillStyle = '#454b51'; g.fillRect(0, 0, W, H);
    for (const r of screens) bezel(g, r, 'mfd');
    // up-front control keypad
    const ux = toPx(0), uy = 0.035;
    g.fillStyle = '#16191c'; rrect(g, ux - 0.07, uy - 0.03, 0.14, 0.06, 0.005); g.fill();
    for (let i = 0; i < 12; i++) { const kx = ux - 0.05 + (i % 4) * 0.033, ky = uy - 0.016 + Math.floor(i / 4) * 0.016; g.fillStyle = '#41474e'; rrect(g, kx - 0.012, ky - 0.006, 0.024, 0.012, 0.002); g.fill(); label(g, '123456789*0#'[i], kx, ky, 0.006); }
    // warning lights
    ['MASTER CAUTION', 'FIRE', 'ENG', 'HYD', 'OIL', 'TF FAIL'].forEach((t, i) => { const x = toPx(-0.32) + i * 0.03; g.fillStyle = i < 2 ? '#3a0e0e' : '#3a2e0e'; g.fillRect(x - 0.013, 0.02, 0.026, 0.02); label(g, t, x, 0.03, 0.0035, i < 2 ? '#ff5a5a' : '#ffb84a'); });
    for (let i = 0; i < 6; i++) toggle(g, toPx(0.24) + i * 0.022, H - 0.05, 0.016, i % 2 === 0);
    label(g, 'MASTER ARM', toPx(0.29), H - 0.02, 0.005);
  };
}

export function heliPanel(W: number, H: number, screens: Rect[], toPx: (y: number) => number): (g: G) => void {
  return g => {
    g.fillStyle = '#41464c'; g.fillRect(0, 0, W, H);
    for (const r of screens) bezel(g, r, 'boeing');
    const cx = toPx(0.42);
    g.fillStyle = '#0d0f11'; rrect(g, cx - 0.08, 0.02, 0.16, 0.08, 0.005); g.fill();
    ['ENG 1', 'ENG 2', 'XMSN', 'FUEL', 'GEN', 'BAT', 'HYD', 'ROTOR'].forEach((t, i) => { const x = cx - 0.06 + (i % 4) * 0.04, y = 0.04 + Math.floor(i / 4) * 0.035; g.fillStyle = '#2b2a14'; g.fillRect(x - 0.017, y - 0.012, 0.034, 0.024); label(g, t, x, y, 0.005, '#7a7246'); });
    for (let i = 0; i < 6; i++) toggle(g, toPx(-0.6) + i * 0.03, H - 0.05, 0.02, i !== 3);
  };
}

// ───────────────────────── glareshield / pedestal / overhead ─────────────────────────
export function efisPanel(airbus: boolean): Art {
  return surface('efis', 0.2, 0.075, 2400, g => {
    g.fillStyle = '#2a2f34'; g.fillRect(0, 0, 0.2, 0.075);
    knob(g, 0.03, 0.04, 0.016); label(g, airbus ? 'QNH  hPa' : 'BARO', 0.03, 0.012, 0.0055);
    sevenSeg(g, '1013', 0.03, 0.065, 0.0065, '#ff9d2e');
    pushbutton(g, 0.07, 0.025, 0.022, airbus ? 'FD' : 'FPV', '', '#e8edf2', '#3ee07a', true);
    pushbutton(g, 0.07, 0.054, 0.022, airbus ? 'LS' : 'MTRS', '', '#e8edf2');
    knob(g, 0.115, 0.042, 0.013); label(g, 'MODE', 0.115, 0.016, 0.0055);
    knob(g, 0.165, 0.042, 0.013, '#2b2f34', '#e8edf2', 0.5); label(g, 'RANGE', 0.165, 0.016, 0.0055);
  }, true);
}

export function pedestalArt(airbus: boolean, nThr: number, w: number, h: number): Art {
  return surface('ped', w, h, 2000, g => {
    g.fillStyle = airbus ? '#56636e' : '#55595e'; g.fillRect(0, 0, w, h);
    const cx = w / 2;
    // MCDUs (front)
    for (const side of [-1, 1]) {
      const x = cx + side * w * 0.25, y = 0.12;
      g.fillStyle = '#1a1d20'; rrect(g, x - 0.1, y - 0.11, 0.2, 0.22, 0.008); g.fill();
      g.fillStyle = '#050607'; g.fillRect(x - 0.075, y - 0.1, 0.15, 0.09);
      const lines: [string, string][] = [['   INIT A', '#e8edf2'], ['CO RTE    FROM/TO', '#e8edf2'], ['__________ RKSI/RJTT', '#ff9d2e'], ['FLT NBR', '#e8edf2'], ['SKY0101', '#35d6f0'], ['CRZ FL/TEMP', '#e8edf2'], ['FL350/-54°', '#35d6f0']];
      lines.forEach(([t, c], i) => label(g, t, x - 0.07, y - 0.09 + i * 0.012, 0.0055, c, 'left', '600'));
      for (let i = 0; i < 6; i++) for (const sx of [-1, 1]) { g.fillStyle = '#3b4046'; g.fillRect(x + sx * 0.088 - 0.006, y - 0.093 + i * 0.014, 0.012, 0.008); }
      for (let i = 0; i < 30; i++) { const kx = x - 0.07 + (i % 6) * 0.028, ky = y + 0.0 + Math.floor(i / 6) * 0.02; g.fillStyle = i < 12 ? '#3e444a' : '#2f3439'; rrect(g, kx - 0.011, ky - 0.007, 0.022, 0.014, 0.002); g.fill(); label(g, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234'[i], kx, ky, 0.005); }
    }
    // thrust quadrant
    const qy = 0.33, qh = 0.2;
    g.fillStyle = '#2d3237'; rrect(g, cx - 0.12, qy, 0.24, qh, 0.01); g.fill();
    for (let i = 0; i < nThr; i++) {
      const x = cx + (i - (nThr - 1) / 2) * 0.085;
      g.fillStyle = '#0b0c0d'; g.fillRect(x - 0.006, qy + 0.012, 0.012, qh - 0.024);
    }
    const det = airbus ? ['TOGA', 'FLX MCT', 'CL', '', 'IDLE', 'REV'] : ['', 'FWD', '', '', 'IDLE', 'REV'];
    det.forEach((t, i) => { const y = qy + 0.02 + i * (qh - 0.04) / 5; if (t) { label(g, t, cx - 0.105, y, 0.0065, '#e8edf2', 'left'); g.fillStyle = '#e8edf2'; g.fillRect(cx - 0.12, y - 0.0005, 0.012, 0.001); } });
    // speed brake (left) and flaps (right)
    const sb = cx - 0.17, fl = cx + 0.17;
    g.fillStyle = '#0b0c0d'; g.fillRect(sb - 0.006, qy + 0.01, 0.012, qh - 0.02); g.fillRect(fl - 0.006, qy + 0.01, 0.012, qh - 0.02);
    label(g, 'SPEED BRAKE', sb, qy - 0.008, 0.006); ['RET', '1/2', 'FULL'].forEach((t, i) => label(g, t, sb - 0.025, qy + 0.02 + i * 0.07, 0.0055, '#e8edf2', 'right'));
    label(g, 'FLAPS', fl, qy - 0.008, 0.006); (airbus ? ['0', '1', '2', '3', 'FULL'] : ['UP', '1', '5', '15', '30']).forEach((t, i) => label(g, t, fl + 0.025, qy + 0.02 + i * 0.04, 0.0055, '#e8edf2', 'left'));
    g.fillStyle = '#f0f2f4'; g.fillRect(sb - 0.02, qy + 0.012, 0.04, 0.014);
    g.fillStyle = '#d4d8dc'; g.fillRect(fl - 0.02, qy + 0.05, 0.04, 0.016);
    // engine masters
    for (let i = 0; i < Math.min(nThr, 4); i++) { const x = cx + (i - (Math.min(nThr, 4) - 1) / 2) * 0.05, y = qy + qh + 0.04; toggle(g, x, y, 0.024, false); label(g, `ENG ${i + 1}`, x, y + 0.02, 0.0055); }
    label(g, 'MASTER  ON / OFF', cx, qy + qh + 0.075, 0.0055);
    // radios + transponder + parking brake (aft)
    const ry = qy + qh + 0.12;
    for (const side of [-1, 1]) {
      const x = cx + side * w * 0.26;
      g.fillStyle = '#1b1e21'; rrect(g, x - 0.09, ry - 0.035, 0.18, 0.07, 0.006); g.fill();
      sevenSeg(g, '118.700', x - 0.04, ry - 0.012, 0.009, '#ff9d2e'); sevenSeg(g, '121.500', x + 0.04, ry - 0.012, 0.009, '#ff9d2e');
      for (let i = 0; i < 6; i++) pushbutton(g, x - 0.07 + i * 0.028, ry + 0.02, 0.02, ['VHF1', 'VHF2', 'VHF3', 'HF1', 'HF2', 'AM'][i], '', '#e8edf2', '#3ee07a', i === 0);
    }
    g.fillStyle = '#1b1e21'; rrect(g, cx - 0.07, ry - 0.03, 0.14, 0.06, 0.006); g.fill();
    sevenSeg(g, '2000', cx, ry - 0.01, 0.01, '#ff9d2e'); label(g, 'ATC  XPDR', cx, ry + 0.02, 0.0055);
    knob(g, cx, ry + 0.07, 0.016, '#30343a', '#e8edf2', 1.2); label(g, 'PARK BRK', cx, ry + 0.095, 0.006);
  }, true);
}

export function overheadArt(kind: string, w: number, h: number): Art {
  return surface('ovh', w, h, 1800, g => {
    g.fillStyle = kind === 'airliner' ? '#5a6874' : '#3e444a'; g.fillRect(0, 0, w, h);
    const sys = ['ADIRS', 'FLT CTL', 'EVAC', 'GPWS', 'RCDR', 'OXYGEN', 'ELEC', 'HYD', 'FUEL', 'AIR COND', 'ANTI ICE', 'PNEU', 'APU', 'EXT LT', 'INT LT', 'SIGNS', 'ENG', 'WIPER'];
    const cols = 6, rows = 3, pw = w / cols, ph = h / rows;
    let s = 7;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    sys.forEach((name, i) => {
      const x = (i % cols) * pw, y = Math.floor(i / cols) * ph;
      g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 0.003; g.strokeRect(x + 0.004, y + 0.004, pw - 0.008, ph - 0.008);
      screw(g, x + 0.01, y + 0.01, 0.003); screw(g, x + pw - 0.01, y + ph - 0.01, 0.003);
      label(g, name, x + pw / 2, y + 0.018, 0.009);
      const n = 3 + Math.floor(r() * 4);
      for (let k = 0; k < n; k++) {
        const bx = x + pw * (0.2 + 0.3 * (k % 3)), by = y + 0.055 + Math.floor(k / 3) * 0.06;
        const t = r();
        if (t < 0.55) pushbutton(g, bx, by, 0.032, ['', 'FAULT', 'FAULT', ''][k % 4], ['OFF', 'ON', 'AUTO', 'OFF'][k % 4], '#ffb020', '#35d6f0', t < 0.2);
        else if (t < 0.8) { knob(g, bx, by, 0.013, '#2b2f34', '#e8edf2', t * 4); label(g, 'OFF  AUTO  ON', bx, by + 0.024, 0.005); }
        else { toggle(g, bx, by, 0.022, t < 0.9); label(g, 'ON', bx, by - 0.026, 0.005); }
      }
      if (name === 'HYD' || name === 'FUEL' || name === 'ELEC') { g.strokeStyle = '#e8edf2'; g.lineWidth = 0.0015; g.beginPath(); g.moveTo(x + 0.02, y + ph - 0.02); g.lineTo(x + pw - 0.02, y + ph - 0.02); g.stroke(); }
    });
  }, true);
}
