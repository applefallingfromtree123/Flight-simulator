// Paints a Livery into the two textures the procedural model uses:
//  - fuselage: u = distance aft of the nose / length, v = angle around the body / 2π (0 = crown,
//    0.25 = right side, 0.5 = belly, 0.75 = left side)
//  - fin: two halves (right side | left side) so art is mirrored like real paint but text still reads.
import type { Font, Livery, TailShape } from './liveries.ts';

export interface FuselageGeom {
  L: number; r: number;
  noseLen: number;    // m from the nose tip to the start of the constant section
  tailStart: number;  // m from the nose tip to the start of the tail cone
  kind: 'airliner' | 'widebody' | 'regional' | 'bizjet' | 'turboprop' | 'ga' | 'military' | 'heli';
  decks?: number;
}
/** Fin outline in its bounding box (fractions of width, from the root leading edge). */
export interface FinGeom { aspect: number; leTop: number; teTop: number; teRoot: number }

const FONT: Record<Font, string> = {
  sans: 'bold 100px "Helvetica Neue", Helvetica, Arial, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif',
  wide: '900 100px "Arial Black", "Helvetica Neue", Helvetica, Arial, "Apple SD Gothic Neo", sans-serif',
  serif: 'bold 100px Georgia, "Times New Roman", serif',
  italic: 'italic bold 100px "Helvetica Neue", Helvetica, Arial, sans-serif',
};

function mkCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function lum(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

export function paintFuselage(liv: Livery, geo: FuselageGeom): HTMLCanvasElement {
  const W = 2048, H = 1024;
  const cv = mkCanvas(W, H);
  const g = cv.getContext('2d')!;
  const { L, r } = geo;
  const circ = 2 * Math.PI * r;
  const ku = W / L, kv = H / circ;
  // body + horizontal bands (height = cos(angle), 1 = crown)
  g.fillStyle = liv.body; g.fillRect(0, 0, W, H);
  const bandAt = (hn: number) => { let c: string | null = null; for (const b of liv.bands ?? []) if (hn >= b.from && hn <= b.to) c = b.c; return c; };
  for (let y = 0; y < H; y++) {
    const hn = Math.cos((y + 0.5) / H * Math.PI * 2);
    const c = bandAt(hn);
    if (c) { g.fillStyle = c; g.fillRect(0, y, W, 1); }
  }
  for (const ln of liv.lines ?? []) {
    const x0 = (ln.from ?? 0) * W, x1 = (ln.to ?? 1) * W;
    g.fillStyle = ln.c;
    for (let y = 0; y < H; y++) {
      const hn = Math.cos((y + 0.5) / H * Math.PI * 2);
      if (Math.abs(hn - ln.h) <= ln.w / 2) g.fillRect(x0, y, x1 - x0, 1);
    }
  }
  // fin colour sweeping forward along the crown of the tail cone
  if (liv.tailWrap) {
    g.fillStyle = liv.tailWrap;
    const s0 = geo.tailStart - 0.04 * L;
    for (let x = Math.floor(s0 * ku); x < W; x += 2) {
      const t = Math.min(1, (x / ku - s0) / (L - s0));
      const thr = 1 - 1.5 * Math.pow(t, 0.8);       // widen toward the tail
      const a = Math.acos(Math.max(-1, Math.min(1, thr))) / (2 * Math.PI) * H;
      g.fillRect(x, 0, 2, a); g.fillRect(x, H - a, 2, a);
    }
  }
  if (liv.nose) {
    g.fillStyle = liv.nose;
    g.fillRect(0, 0, geo.noseLen * 0.38 * ku, H);
  }
  // per-side drawing in (s = m aft of nose, h = m up from the centreline)
  const side = (s: 'L' | 'R', fn: (g: CanvasRenderingContext2D, dir: number) => void) => {
    g.save();
    if (s === 'L') g.setTransform(ku, 0, 0, kv, 0, 0.75 * H);
    else g.setTransform(ku, 0, 0, -kv, 0, 0.25 * H);
    fn(g, s === 'L' ? 1 : -1);
    g.restore();
  };
  const both = (fn: (g: CanvasRenderingContext2D, dir: number) => void) => { side('L', fn); side('R', fn); };
  const rrect = (x: number, y: number, w: number, h: number, rad: number) => {
    g.beginPath();
    g.moveTo(x + rad, y); g.lineTo(x + w - rad, y); g.quadraticCurveTo(x + w, y, x + w, y + rad);
    g.lineTo(x + w, y + h - rad); g.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
    g.lineTo(x + rad, y + h); g.quadraticCurveTo(x, y + h, x, y + h - rad);
    g.lineTo(x, y + rad); g.quadraticCurveTo(x, y, x + rad, y); g.closePath();
  };
  /** Text centred at (s, h) metres, cap height sizeM, reading front-to-back for the viewer. */
  const text = (gg: CanvasRenderingContext2D, dir: number, spans: { s: string; c: string }[], font: Font, sC: number, hC: number, sizeM: number, maxW: number) => {
    gg.save();
    gg.translate(sC, hC);
    const k = sizeM / 72; // 100px font ≈ 72px cap height
    gg.scale(dir * k, -k);
    gg.font = FONT[font];
    gg.textBaseline = 'middle';
    const widths = spans.map(sp => gg.measureText(sp.s).width);
    const total = widths.reduce((a, b) => a + b, 0);
    const lim = maxW / k;
    if (total > lim) gg.scale(lim / total, 1);
    let x = -widths.reduce((a, b) => a + b, 0) / 2;
    spans.forEach((sp, i) => { gg.fillStyle = sp.c; gg.textAlign = 'left'; gg.fillText(sp.s, x, 0); x += widths[i]; });
    gg.restore();
  };
  const cabin = geo.kind === 'airliner' || geo.kind === 'widebody' || geo.kind === 'regional' || geo.kind === 'bizjet' || geo.kind === 'turboprop';
  const winH = geo.decks === 2 ? -r * 0.22 : r * 0.12;
  if (cabin) {
    const biz = geo.kind === 'bizjet';
    const pitch = biz ? 0.95 : geo.kind === 'turboprop' ? 0.8 : 0.533;
    const ww = biz ? 0.42 : 0.24, wh = biz ? 0.3 : 0.34;
    const s0 = geo.noseLen + (biz ? 1.6 : 2.6), s1 = geo.tailStart - (biz ? 0.4 : 1.6);
    const doors = biz ? [geo.noseLen + 0.3] : geo.kind === 'widebody'
      ? [geo.noseLen + 0.6, geo.noseLen + (s1 - geo.noseLen) * 0.3, geo.noseLen + (s1 - geo.noseLen) * 0.62, s1 - 0.4]
      : [geo.noseLen + 0.6, s1 - 0.2];
    const dW = biz ? 0.75 : 0.9, dH = biz ? 1.5 : 1.85;
    if (geo.decks === 2) both(gg => {
      gg.fillStyle = '#161b22';
      for (let s = s0 + 1; s < s1 - 3; s += pitch) { rrect(s - ww / 2, r * 0.62 - wh / 2, ww, wh, Math.min(ww, wh) * 0.45); gg.fill(); }
    });
    both(gg => {
      gg.fillStyle = '#161b22';
      for (let s = s0; s < s1; s += pitch) {
        if (doors.some(d => Math.abs(s - (d + dW / 2)) < dW / 2 + 0.35)) continue;
        rrect(s - ww / 2, winH - wh / 2, ww, wh, Math.min(ww, wh) * 0.45); gg.fill();
      }
      gg.strokeStyle = 'rgba(20,24,30,0.55)'; gg.lineWidth = 0.03;
      for (const d of doors) {
        rrect(d, winH - dH * 0.62, dW, dH, 0.12); gg.stroke();
        gg.fillStyle = '#161b22';
        rrect(d + dW / 2 - ww / 2, winH - wh / 2, ww, wh, Math.min(ww, wh) * 0.45); gg.fill();
      }
    });
  }
  // flight-deck windows (glass painted on; the model has no separate canopy for airliners)
  if (cabin) {
    both(gg => {
      gg.fillStyle = '#10151b';
      const n = geo.noseLen;
      const top = r * 0.52, bot = r * 0.26;
      gg.beginPath(); gg.moveTo(n * 0.6, bot); gg.lineTo(n * 0.74, top); gg.lineTo(n * 0.86, top); gg.lineTo(n * 0.86, bot); gg.closePath(); gg.fill();
      gg.beginPath(); gg.moveTo(n * 0.89, bot); gg.lineTo(n * 0.89, top * 0.98); gg.lineTo(n * 1.02, top * 0.9); gg.lineTo(n * 1.02, bot); gg.closePath(); gg.fill();
      gg.fillStyle = 'rgba(160,190,220,0.18)';
      gg.beginPath(); gg.moveTo(n * 0.62, bot * 1.15); gg.lineTo(n * 0.7, top * 0.9); gg.lineTo(n * 0.73, top * 0.9); gg.lineTo(n * 0.66, bot * 1.15); gg.closePath(); gg.fill();
    });
  }
  // titles
  if (liv.titles) {
    const t = liv.titles;
    const size = r * 0.3 * (t.size ?? 1);
    const hC = (t.h ?? (geo.decks === 2 ? 0.22 : cabin ? 0.5 : 0.15)) * r;
    const sC = (t.at ?? (geo.kind === 'widebody' ? 0.3 : geo.kind === 'heli' ? 0.45 : 0.36)) * L;
    both((gg, dir) => text(gg, dir, t.spans, t.font ?? 'sans', sC, hC, size, L * 0.5));
    if (liv.sub) {
      const sub = liv.sub;
      both((gg, dir) => text(gg, dir, [{ s: sub.s, c: sub.c }], sub.font ?? 'sans', sC, hC - size * 1.05, size * 0.38, L * 0.4));
    }
  }
  // registration
  const regDark = lum(liv.body) > 0.55;
  const ga = geo.kind === 'ga' || geo.kind === 'heli';
  const regSize = ga ? r * 0.45 : geo.kind === 'military' ? r * 0.12 : r * 0.11;
  const regS = ga ? L * (geo.kind === 'heli' ? 0.72 : 0.6) : geo.kind === 'military' ? L * 0.62 : geo.tailStart + 0.05 * L;
  const regH = ga ? -r * 0.05 : geo.kind === 'military' ? -r * 0.2 : r * 0.3;
  both((gg, dir) => text(gg, dir, [{ s: liv.reg, c: regDark ? '#2a3037' : '#f2f4f6' }], 'sans', regS, regH, regSize, L * 0.3));
  return cv;
}

/** aspect = fin width / height (side-view bounding box). */
export function paintFin(liv: Livery, fin: FinGeom): HTMLCanvasElement {
  const HW = 512, H = Math.max(128, Math.min(1024, Math.round(HW / Math.max(0.2, fin.aspect))));
  const cv = mkCanvas(HW * 2, H);
  const g = cv.getContext('2d')!;
  g.fillStyle = liv.tail.bg; g.fillRect(0, 0, HW * 2, H);
  for (const half of [0, 1]) {
    // half 0 = right side (forward = right edge), half 1 = left side (forward = left edge)
    // shape x is a fraction of the local chord, so art follows the fin's sweep and stays on it
    const P = (cx: number, fy: number): [number, number] => {
      const le = fin.leTop * fy, te = fin.teRoot + (fin.teTop - fin.teRoot) * fy;
      const fx = le + cx * (te - le);
      return [half === 0 ? (1 - fx) * HW : HW + fx * HW, (1 - fy) * H];
    };
    const fwd = half === 0 ? 1 : -1;
    const R = (r: number) => r * Math.min(HW, H);
    g.save();
    g.beginPath(); g.rect(half * HW, 0, HW, H); g.clip();
    for (const s of liv.tail.shapes ?? []) drawShape(g, s, P, R, fwd, H);
    g.restore();
  }
  return cv;
}

function drawShape(g: CanvasRenderingContext2D, s: TailShape, P: (x: number, y: number) => [number, number], R: (r: number) => number, fwd: number, H: number) {
  const poly = (pts: [number, number][]) => { g.beginPath(); pts.forEach(([x, y], i) => { const p = P(x, y); if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); }); g.closePath(); g.fill(); };
  g.fillStyle = 'c' in s ? s.c : '#000';
  switch (s.t) {
    case 'band': { const k = s.slant ?? 0; poly([[-0.3, s.y0 - k * 0.8], [1.3, s.y0 + k * 0.8], [1.3, s.y1 + k * 0.8], [-0.3, s.y1 - k * 0.8]]); break; }
    case 'vband': { const k = s.slant ?? 0; poly([[s.x0 - k * 0.8, -0.3], [s.x1 - k * 0.8, -0.3], [s.x1 + k * 0.8, 1.3], [s.x0 + k * 0.8, 1.3]]); break; }
    case 'wave': {
      const amp = s.amp ?? 0.08, pts: [number, number][] = [];
      for (let x = -0.2; x <= 1.2; x += 0.05) pts.push([x, s.y + s.h / 2 + amp * Math.sin(x * Math.PI * 1.6)]);
      for (let x = 1.2; x >= -0.2; x -= 0.05) pts.push([x, s.y - s.h / 2 + amp * Math.sin(x * Math.PI * 1.6 + 0.6)]);
      poly(pts); break;
    }
    case 'circle': {
      const [x, y] = P(s.x, s.y);
      g.beginPath(); g.arc(x, y, R(s.r), 0, Math.PI * 2); g.fill();
      if (s.ring) { g.strokeStyle = s.ring; g.lineWidth = R(s.lw ?? 0.03); g.stroke(); }
      break;
    }
    case 'swirl': {
      const [x, y] = P(s.x, s.y), r = R(s.r);
      g.fillStyle = s.c2; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      g.fillStyle = s.c1; g.beginPath();
      g.arc(x, y, r, Math.PI, 0);                 // top half
      g.arc(x + r / 2, y, r / 2, 0, Math.PI);      // bulge into the bottom half
      g.arc(x - r / 2, y, r / 2, 0, Math.PI, true); // bulge into the top half
      g.closePath(); g.fill();
      break;
    }
    case 'star': case 'leaf': {
      const [x, y] = P(s.x, s.y), r = R(s.r);
      const n = s.t === 'leaf' ? 11 : s.n ?? 5, inner = s.t === 'leaf' ? 0.55 : s.inner ?? 0.5;
      g.beginPath();
      for (let i = 0; i < n * 2; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / n, rr = i % 2 ? r * inner : r;
        const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr * (s.t === 'leaf' ? 0.95 : 1);
        if (i) g.lineTo(px, py); else g.moveTo(px, py);
      }
      g.closePath(); g.fill();
      if (s.t === 'leaf') g.fillRect(x - r * 0.05, y + r * 0.4, r * 0.1, r * 0.6);
      break;
    }
    case 'bird': {
      const [x, y] = P(s.x, s.y), r = R(s.r), f = fwd;
      g.beginPath();
      g.moveTo(x - f * r, y + 0.1 * r);
      g.quadraticCurveTo(x - f * 0.35 * r, y - 0.75 * r, x + f * 0.05 * r, y - 0.05 * r);
      g.quadraticCurveTo(x + f * 0.4 * r, y - 0.55 * r, x + f * r, y - 0.35 * r);
      g.quadraticCurveTo(x + f * 0.45 * r, y + 0.05 * r, x + f * 0.1 * r, y + 0.5 * r);
      g.quadraticCurveTo(x - f * 0.35 * r, y + 0.05 * r, x - f * r, y + 0.1 * r);
      g.closePath(); g.fill();
      break;
    }
    case 'text': {
      const [x, y] = P(s.x, s.y);
      g.save(); g.translate(x, y);
      if (s.vertical) g.rotate(-Math.PI / 2);
      const k = (s.size * H) / 72;
      g.scale(k, k);
      g.font = FONT[s.font ?? 'sans'];
      g.textAlign = 'center'; g.textBaseline = 'middle';
      const w = g.measureText(s.s).width, max = (R(0.85) / k);
      if (w > max) g.scale(max / w, 1);
      g.fillText(s.s, 0, 0);
      g.restore();
      break;
    }
  }
}

export async function canvasPng(cv: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((res, rej) => cv.toBlob(b => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}
