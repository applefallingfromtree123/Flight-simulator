// Liveries: real-operator paint schemes, simplified to what a procedural model can carry
// (fuselage colour bands, cheat lines, titles, registration, tail art). Painted into textures
// by liveryTex.ts. Shapes are stylised; they are not the operators' artwork.
import type { AircraftDef } from '../sim/types.ts';

/** Tail-fin art. fx: 0 = leading edge .. 1 = trailing edge; fy: 0 = root .. 1 = tip. */
export type TailShape =
  | { t: 'band'; y0: number; y1: number; c: string; slant?: number }
  | { t: 'vband'; x0: number; x1: number; c: string; slant?: number }
  | { t: 'circle'; x: number; y: number; r: number; c: string; ring?: string; lw?: number }
  | { t: 'swirl'; x: number; y: number; r: number; c1: string; c2: string }
  | { t: 'star'; x: number; y: number; r: number; c: string; n?: number; inner?: number }
  | { t: 'leaf'; x: number; y: number; r: number; c: string }
  | { t: 'bird'; x: number; y: number; r: number; c: string }
  | { t: 'wave'; y: number; h: number; c: string; amp?: number }
  | { t: 'text'; s: string; x: number; y: number; size: number; c: string; font?: Font; vertical?: boolean };

export type Font = 'sans' | 'serif' | 'italic' | 'wide';

export interface Livery {
  id: string;
  name: string;
  reg: string;
  body: string;
  /** Horizontal colour bands over the whole fuselage; height -1 = belly .. +1 = crown. */
  bands?: { from: number; to: number; c: string }[];
  /** Thin lines along the fuselage at height h (same scale), w = thickness. */
  lines?: { h: number; w: number; c: string; from?: number; to?: number }[];
  /** Fuselage titles; spans let one word use several colours (e.g. FedEx). */
  titles?: { spans: { s: string; c: string }[]; font?: Font; size?: number; h?: number; at?: number };
  /** Small second line under the titles. */
  sub?: { s: string; c: string; font?: Font };
  tail: { bg: string; shapes?: TailShape[] };
  /** Colour that sweeps from the fin onto the rear fuselage crown. */
  tailWrap?: string;
  engine: string;
  wing?: string;
  stab?: string;
  nose?: string;
}

type Airline = Omit<Livery, 'id' | 'reg' | 'name'> & { name: string };

const W = '#f4f6f8', GREY = '#c9ced4';

const A: Record<string, Airline> = {
  kal: { name: 'Korean Air', body: '#a9cfea', bands: [{ from: -1, to: -0.18, c: '#c5cace' }], lines: [{ h: -0.18, w: 0.025, c: '#e8eef2' }],
    titles: { spans: [{ s: 'KOREAN AIR', c: '#1b3a6b' }], font: 'wide' }, tail: { bg: W, shapes: [{ t: 'swirl', x: 0.55, y: 0.5, r: 0.26, c1: '#d0202f', c2: '#1f4fa0' }] }, engine: '#a9cfea' },
  aar: { name: 'Asiana Airlines', body: W, bands: [{ from: -1, to: -0.3, c: '#b9b2a6' }],
    titles: { spans: [{ s: 'ASIANA AIRLINES', c: '#6d6e71' }], font: 'sans' },
    tail: { bg: W, shapes: [
      { t: 'band', y0: 0.0, y1: 0.12, c: '#a77d4e', slant: 0.5 }, { t: 'band', y0: 0.12, y1: 0.24, c: '#8d8d8d', slant: 0.5 },
      { t: 'band', y0: 0.24, y1: 0.36, c: '#0063af', slant: 0.5 }, { t: 'band', y0: 0.36, y1: 0.48, c: '#f8b81e', slant: 0.5 },
      { t: 'band', y0: 0.48, y1: 0.6, c: '#e2231a', slant: 0.5 }] }, engine: W },
  jja: { name: 'Jeju Air', body: W, titles: { spans: [{ s: 'JEJU', c: '#ff5000' }, { s: 'air', c: '#ff5000' }], font: 'italic' },
    lines: [{ h: -0.35, w: 0.05, c: '#ff5000' }], tail: { bg: '#ff5000', shapes: [{ t: 'text', s: 'J', x: 0.55, y: 0.45, size: 0.5, c: W, font: 'italic' }] }, engine: '#ff5000' },
  jal: { name: 'Japan Airlines', body: W, titles: { spans: [{ s: 'JAL', c: '#cc0000' }], font: 'wide', size: 1.3 }, sub: { s: 'JAPAN AIRLINES', c: '#555' },
    tail: { bg: W, shapes: [{ t: 'circle', x: 0.55, y: 0.5, r: 0.27, c: '#cc0000' }, { t: 'bird', x: 0.55, y: 0.5, r: 0.22, c: W }] }, engine: W },
  ana: { name: 'All Nippon Airways', body: W, bands: [{ from: -1, to: -0.45, c: '#13448f' }], lines: [{ h: -0.38, w: 0.06, c: '#00a6e4' }],
    titles: { spans: [{ s: 'ANA', c: '#13448f' }], font: 'wide', size: 1.3 },
    tail: { bg: '#13448f', shapes: [{ t: 'band', y0: 0.62, y1: 0.72, c: '#00a6e4', slant: 0.4 }, { t: 'text', s: 'ANA', x: 0.55, y: 0.35, size: 0.22, c: W, font: 'wide' }] }, engine: W },
  dlh: { name: 'Lufthansa', body: W, titles: { spans: [{ s: 'Lufthansa', c: '#05164d' }], font: 'serif', size: 1.2 },
    tail: { bg: '#05164d', shapes: [{ t: 'circle', x: 0.55, y: 0.5, r: 0.27, c: '#05164d', ring: W, lw: 0.035 }, { t: 'bird', x: 0.55, y: 0.5, r: 0.2, c: W }] }, engine: '#05164d' },
  ezy: { name: 'easyJet', body: W, nose: '#ff6600', titles: { spans: [{ s: 'easyJet', c: '#ff6600' }], font: 'sans', size: 1.4 },
    tail: { bg: '#ff6600', shapes: [{ t: 'text', s: 'easyJet', x: 0.55, y: 0.45, size: 0.17, c: W, font: 'sans' }] }, engine: '#ff6600' },
  baw: { name: 'British Airways', body: W, bands: [{ from: -1, to: -0.3, c: '#1c2b55' }], lines: [{ h: -0.3, w: 0.04, c: '#c8102e' }],
    titles: { spans: [{ s: 'BRITISH AIRWAYS', c: '#1c2b55' }], font: 'serif' },
    tail: { bg: '#1c2b55', shapes: [{ t: 'wave', y: 0.55, h: 0.3, c: W, amp: 0.08 }, { t: 'wave', y: 0.56, h: 0.14, c: '#c8102e', amp: 0.08 }, { t: 'wave', y: 0.2, h: 0.12, c: '#c8102e', amp: 0.06 }] }, engine: GREY },
  aca: { name: 'Air Canada', body: W, bands: [{ from: -1, to: -0.55, c: '#111111' }], titles: { spans: [{ s: 'AIR CANADA', c: '#111' }], font: 'wide' },
    tail: { bg: '#111111', shapes: [{ t: 'leaf', x: 0.55, y: 0.48, r: 0.27, c: '#e2231a' }] }, engine: '#111111' },
  aal: { name: 'American Airlines', body: '#c7ccd1', titles: { spans: [{ s: 'American', c: '#36495a' }], font: 'sans', size: 1.2 },
    tail: { bg: '#c7ccd1', shapes: [{ t: 'vband', x0: 0.0, x1: 0.45, c: '#0078d2' },
      { t: 'band', y0: 0.0, y1: 0.12, c: '#c30019', slant: -0.5 }, { t: 'band', y0: 0.24, y1: 0.36, c: '#c30019', slant: -0.5 }, { t: 'band', y0: 0.48, y1: 0.6, c: '#c30019', slant: -0.5 }] }, engine: '#c7ccd1' },
  dal: { name: 'Delta Air Lines', body: W, bands: [{ from: -1, to: -0.28, c: '#003366' }], titles: { spans: [{ s: 'DELTA', c: '#003366' }], font: 'wide', size: 1.2 },
    tail: { bg: '#003366', shapes: [{ t: 'band', y0: 0.45, y1: 1.2, c: '#c01933', slant: 0.6 }, { t: 'band', y0: 0.38, y1: 0.45, c: '#9b1631', slant: 0.6 }] }, engine: '#003366', tailWrap: '#003366' },
  ual: { name: 'United Airlines', body: W, bands: [{ from: -1, to: -0.25, c: '#1c4b9e' }], lines: [{ h: -0.25, w: 0.03, c: '#7ea6dc' }],
    titles: { spans: [{ s: 'UNITED', c: '#0a2a5c' }], font: 'wide', size: 1.2 },
    tail: { bg: '#0a2a5c', shapes: [{ t: 'circle', x: 0.55, y: 0.5, r: 0.27, c: '#3b6fc5' }, { t: 'wave', y: 0.5, h: 0.05, c: W, amp: 0.1 }, { t: 'wave', y: 0.38, h: 0.04, c: W, amp: 0.1 }, { t: 'wave', y: 0.62, h: 0.04, c: W, amp: 0.1 }] }, engine: '#1c4b9e' },
  swa: { name: 'Southwest Airlines', body: '#304cb2', bands: [{ from: -1, to: -0.6, c: '#ffbf27' }, { from: -0.6, to: -0.4, c: '#e31837' }],
    titles: { spans: [{ s: 'SOUTHWEST', c: W }], font: 'wide', size: 1.2 },
    tail: { bg: '#304cb2', shapes: [{ t: 'band', y0: 0, y1: 0.18, c: '#ffbf27', slant: 0.4 }, { t: 'band', y0: 0.18, y1: 0.3, c: '#e31837', slant: 0.4 }] }, engine: '#304cb2', tailWrap: '#304cb2' },
  ryr: { name: 'Ryanair', body: W, bands: [{ from: -1, to: -0.15, c: '#073590' }], titles: { spans: [{ s: 'RYANAIR', c: '#073590' }], font: 'wide', size: 1.2 },
    tail: { bg: '#073590', shapes: [{ t: 'circle', x: 0.55, y: 0.48, r: 0.24, c: '#073590', ring: '#f1c933', lw: 0.03 }, { t: 'star', x: 0.55, y: 0.48, r: 0.15, c: '#f1c933', n: 5, inner: 0.45 }] }, engine: W, tailWrap: '#073590' },
  afr: { name: 'Air France', body: W, titles: { spans: [{ s: 'AIRFRANCE', c: '#002157' }], font: 'wide', size: 1.2 },
    tail: { bg: W, shapes: [{ t: 'vband', x0: 0.32, x1: 0.48, c: '#002157' }, { t: 'vband', x0: 0.5, x1: 0.56, c: '#002157' }, { t: 'vband', x0: 0.58, x1: 0.64, c: '#e30613' }] }, engine: W },
  sia: { name: 'Singapore Airlines', body: W, titles: { spans: [{ s: 'SINGAPORE AIRLINES', c: '#1d2b58' }], font: 'serif' },
    tail: { bg: '#1d2b58', shapes: [{ t: 'bird', x: 0.55, y: 0.5, r: 0.26, c: '#f2a900' }] }, engine: '#1d2b58' },
  cpa: { name: 'Cathay Pacific', body: W, bands: [{ from: -1, to: -0.4, c: '#b4bbbf' }], lines: [{ h: -0.4, w: 0.025, c: '#006564' }],
    titles: { spans: [{ s: 'CATHAY PACIFIC', c: '#006564' }], font: 'sans' },
    tail: { bg: '#006564', shapes: [{ t: 'bird', x: 0.55, y: 0.5, r: 0.26, c: W }] }, engine: GREY },
  qfa: { name: 'Qantas', body: W, titles: { spans: [{ s: 'QANTAS', c: '#e40000' }], font: 'wide', size: 1.2 },
    tail: { bg: '#e40000', shapes: [{ t: 'leaf', x: 0.55, y: 0.48, r: 0.22, c: W }] }, engine: GREY, tailWrap: '#e40000' },
  uae: { name: 'Emirates', body: W, titles: { spans: [{ s: 'Emirates', c: '#d71a21' }], font: 'serif', size: 1.4 },
    tail: { bg: W, shapes: [{ t: 'vband', x0: 0.04, x1: 0.2, c: '#d71a21' }, { t: 'band', y0: 0.6, y1: 0.85, c: '#00843d', slant: 0.15 }, { t: 'band', y0: 0.1, y1: 0.35, c: '#111', slant: 0.15 }] }, engine: W },
  qtr: { name: 'Qatar Airways', body: '#eceae6', titles: { spans: [{ s: 'QATAR', c: '#5c0632' }], font: 'serif', size: 1.3 }, sub: { s: 'AIRWAYS', c: '#5c0632', font: 'serif' },
    tail: { bg: '#5c0632', shapes: [{ t: 'bird', x: 0.55, y: 0.5, r: 0.24, c: '#eceae6' }] }, engine: '#eceae6' },
  klm: { name: 'KLM', body: W, bands: [{ from: -0.05, to: 1, c: '#00a1de' }], lines: [{ h: -0.05, w: 0.04, c: '#003082' }],
    titles: { spans: [{ s: 'KLM', c: W }], font: 'wide', size: 1.3, h: 0.45 }, sub: { s: 'Royal Dutch Airlines', c: '#003082' },
    tail: { bg: '#00a1de', shapes: [{ t: 'star', x: 0.55, y: 0.66, r: 0.08, c: W, n: 5, inner: 0.5 }, { t: 'text', s: 'KLM', x: 0.55, y: 0.45, size: 0.2, c: W, font: 'wide' }] }, engine: '#00a1de' },
  ces: { name: 'China Eastern', body: W, lines: [{ h: -0.3, w: 0.04, c: '#cf1c27' }, { h: -0.38, w: 0.04, c: '#0b2f7a' }],
    titles: { spans: [{ s: '中国东方航空', c: '#0b2f7a' }], font: 'sans', size: 1.2 }, sub: { s: 'CHINA EASTERN', c: '#0b2f7a' },
    tail: { bg: W, shapes: [{ t: 'circle', x: 0.55, y: 0.5, r: 0.26, c: '#cf1c27' }, { t: 'bird', x: 0.55, y: 0.48, r: 0.2, c: '#0b2f7a' }] }, engine: W },
  azu: { name: 'Azul', body: W, bands: [{ from: -1, to: -0.35, c: '#0033a0' }], titles: { spans: [{ s: 'Azul', c: '#0033a0' }], font: 'italic', size: 1.4 },
    tail: { bg: '#0033a0', shapes: [{ t: 'circle', x: 0.4, y: 0.4, r: 0.06, c: '#4fc3f7' }, { t: 'circle', x: 0.55, y: 0.55, r: 0.08, c: '#4fc3f7' }, { t: 'circle', x: 0.7, y: 0.35, r: 0.05, c: W }] }, engine: '#0033a0' },
  anz: { name: 'Air New Zealand', body: W, bands: [{ from: -1, to: -0.5, c: '#111' }], titles: { spans: [{ s: 'AIR NEW ZEALAND', c: '#111' }], font: 'sans' },
    tail: { bg: '#111111', shapes: [{ t: 'swirl', x: 0.55, y: 0.5, r: 0.22, c1: W, c2: '#111111' }] }, engine: '#111111', tailWrap: '#111111' },
  fdx: { name: 'FedEx Express', body: W, bands: [{ from: -1, to: -0.3, c: '#9b9da0' }], titles: { spans: [{ s: 'Fed', c: '#4d148c' }, { s: 'Ex', c: '#ff6600' }], font: 'wide', size: 1.6 },
    tail: { bg: '#4d148c', shapes: [{ t: 'text', s: 'FedEx', x: 0.55, y: 0.45, size: 0.17, c: W, font: 'wide' }] }, engine: '#9b9da0', tailWrap: '#4d148c' },
  // houses / special
  airbus: { name: 'Airbus 하우스 컬러', body: W, lines: [{ h: -0.3, w: 0.05, c: '#00205b' }], titles: { spans: [{ s: 'AIRBUS', c: '#00205b' }], font: 'wide', size: 1.2 },
    tail: { bg: '#00205b', shapes: [{ t: 'wave', y: 0.35, h: 0.1, c: '#00aeef', amp: 0.08 }, { t: 'text', s: 'AIRBUS', x: 0.55, y: 0.6, size: 0.12, c: W, font: 'wide' }] }, engine: W },
  boeing: { name: 'Boeing 하우스 컬러', body: W, bands: [{ from: -1, to: -0.3, c: '#1d428a' }], lines: [{ h: -0.3, w: 0.04, c: '#7fb5e8' }],
    titles: { spans: [{ s: 'BOEING', c: '#1d428a' }], font: 'wide', size: 1.2 }, tail: { bg: '#1d428a', shapes: [{ t: 'wave', y: 0.4, h: 0.1, c: '#7fb5e8', amp: 0.1 }] }, engine: W, tailWrap: '#1d428a' },
  comac: { name: 'COMAC 하우스 컬러', body: W, lines: [{ h: -0.3, w: 0.06, c: '#0a6ab6' }, { h: -0.4, w: 0.03, c: '#4fb3e8' }], titles: { spans: [{ s: 'COMAC', c: '#0a6ab6' }], font: 'wide', size: 1.2 },
    tail: { bg: W, shapes: [{ t: 'vband', x0: 0.3, x1: 0.62, c: '#0a6ab6' }, { t: 'vband', x0: 0.64, x1: 0.7, c: '#4fb3e8' }] }, engine: W },
  embraer: { name: 'Embraer 하우스 컬러', body: W, bands: [{ from: -1, to: -0.4, c: '#0d2c6c' }], titles: { spans: [{ s: 'EMBRAER', c: '#0d2c6c' }], font: 'wide' },
    tail: { bg: '#0d2c6c', shapes: [{ t: 'band', y0: 0.2, y1: 0.3, c: '#4fb3e8', slant: 0.5 }] }, engine: W },
  atr: { name: 'ATR 하우스 컬러', body: W, lines: [{ h: -0.32, w: 0.05, c: '#00a3e0' }], titles: { spans: [{ s: 'ATR', c: '#003a70' }], font: 'wide', size: 1.3 },
    tail: { bg: '#003a70', shapes: [{ t: 'text', s: 'ATR', x: 0.55, y: 0.5, size: 0.22, c: W, font: 'wide' }] }, engine: W },
};

// military / general aviation / helicopter schemes
const S: Record<string, Airline> = {
  usaf: { name: '미 공군 (USAF)', body: '#8a949c', tail: { bg: '#8a949c', shapes: [{ t: 'text', s: 'AF', x: 0.5, y: 0.6, size: 0.14, c: '#30363b', font: 'wide' }] }, engine: '#6f777e', wing: '#8a949c', stab: '#8a949c' },
  rokaf: { name: '대한민국 공군 (ROKAF)', body: '#7f8a92', tail: { bg: '#7f8a92', shapes: [{ t: 'circle', x: 0.5, y: 0.6, r: 0.1, c: W }, { t: 'swirl', x: 0.5, y: 0.6, r: 0.08, c1: '#c60c30', c2: '#003478' }] },
    titles: { spans: [{ s: 'R.O.K. AIR FORCE', c: '#30363b' }], font: 'wide', size: 0.6, h: 0.1 }, engine: '#666e75', wing: '#7f8a92', stab: '#7f8a92' },
  thunderbirds: { name: 'Thunderbirds', body: W, bands: [{ from: -1, to: -0.2, c: '#0b2c6b' }, { from: -0.2, to: -0.05, c: '#c8102e' }],
    tail: { bg: W, shapes: [{ t: 'band', y0: 0, y1: 0.15, c: '#c8102e', slant: 0.5 }, { t: 'band', y0: 0.15, y1: 0.3, c: W, slant: 0.5 }, { t: 'band', y0: 0.3, y1: 0.45, c: '#0b2c6b', slant: 0.5 }, { t: 'star', x: 0.55, y: 0.72, r: 0.1, c: '#0b2c6b', n: 5, inner: 0.45 }] },
    engine: '#555', wing: W, stab: W },
  usn: { name: '미 해군 (US Navy)', body: '#8f989f', tail: { bg: '#8f989f', shapes: [{ t: 'text', s: 'NAVY', x: 0.5, y: 0.55, size: 0.12, c: '#30363b', font: 'wide' }] }, engine: '#6f777e', wing: '#8f989f', stab: '#8f989f' },
  blueangels: { name: 'Blue Angels', body: '#002a5c', bands: [{ from: -1, to: -0.6, c: '#ffcc00' }], titles: { spans: [{ s: 'U.S. NAVY', c: '#ffcc00' }], font: 'wide', size: 0.7, h: 0.15 },
    tail: { bg: '#002a5c', shapes: [{ t: 'circle', x: 0.5, y: 0.55, r: 0.14, c: '#ffcc00' }, { t: 'text', s: '1', x: 0.5, y: 0.55, size: 0.15, c: '#002a5c', font: 'wide' }] }, engine: '#444', wing: '#002a5c', stab: '#002a5c' },
  raf: { name: '영국 공군 (RAF)', body: '#7a8288', tail: { bg: '#7a8288', shapes: [{ t: 'vband', x0: 0.3, x1: 0.42, c: '#c8102e' }, { t: 'vband', x0: 0.42, x1: 0.54, c: W }, { t: 'vband', x0: 0.54, x1: 0.66, c: '#012169' }] }, engine: '#5c6368', wing: '#7a8288', stab: '#7a8288' },
  luftwaffe: { name: '독일 공군 (Luftwaffe)', body: '#8b9399', tail: { bg: '#8b9399', shapes: [{ t: 'band', y0: 0.62, y1: 0.68, c: '#111' }, { t: 'band', y0: 0.68, y1: 0.74, c: '#dd0000' }, { t: 'band', y0: 0.74, y1: 0.8, c: '#ffce00' }] }, engine: '#666', wing: '#8b9399', stab: '#8b9399' },
  metal: { name: '무도장 (Natural metal)', body: '#b9bec4', nose: '#e1b12c', tail: { bg: '#b9bec4', shapes: [{ t: 'text', s: '44-14', x: 0.5, y: 0.5, size: 0.12, c: '#222', font: 'wide' }] }, engine: '#b9bec4', wing: '#b9bec4', stab: '#b9bec4' },
  redtail: { name: 'Red Tail', body: '#b9bec4', nose: '#c8102e', tail: { bg: '#c8102e' }, engine: '#b9bec4', wing: '#b9bec4', stab: '#c8102e' },
  rafCamo: { name: 'RAF 위장도색', body: '#5a5f3c', bands: [{ from: -1, to: -0.25, c: '#9aa3a0' }], lines: [{ h: -0.1, w: 0.12, c: '#c9b88a', from: 0.7, to: 0.78 }],
    tail: { bg: '#5a5f3c', shapes: [{ t: 'vband', x0: 0.05, x1: 0.2, c: '#c8102e' }, { t: 'vband', x0: 0.2, x1: 0.3, c: W }, { t: 'vband', x0: 0.3, x1: 0.45, c: '#012169' }] }, engine: '#5a5f3c', wing: '#5a5f3c', stab: '#5a5f3c' },
  aalVintage: { name: 'American Airlines (1940s)', body: '#c4c9ce', lines: [{ h: 0.02, w: 0.06, c: '#e46b1f' }, { h: -0.08, w: 0.05, c: '#1a3b7a' }], titles: { spans: [{ s: 'AMERICAN AIRLINES', c: '#1a3b7a' }], font: 'serif', h: 0.4 },
    tail: { bg: '#c4c9ce', shapes: [{ t: 'band', y0: 0.3, y1: 0.4, c: '#e46b1f' }, { t: 'band', y0: 0.4, y1: 0.5, c: '#1a3b7a' }] }, engine: '#c4c9ce', wing: '#c4c9ce', stab: '#c4c9ce' },
  panam: { name: 'Pan Am', body: W, bands: [{ from: -1, to: -0.2, c: '#c4c9ce' }], lines: [{ h: 0.02, w: 0.07, c: '#0b5aa6' }], titles: { spans: [{ s: 'PAN AMERICAN', c: '#0b5aa6' }], font: 'sans', h: 0.45 },
    tail: { bg: W, shapes: [{ t: 'circle', x: 0.5, y: 0.5, r: 0.2, c: '#0b5aa6' }, { t: 'wave', y: 0.5, h: 0.04, c: W, amp: 0.05 }] }, engine: '#c4c9ce' },
  usafTransport: { name: '미 공군 수송기', body: '#6c757d', tail: { bg: '#6c757d', shapes: [{ t: 'text', s: 'AMC', x: 0.5, y: 0.5, size: 0.12, c: '#2a2e31', font: 'wide' }] }, titles: { spans: [{ s: 'U.S. AIR FORCE', c: '#2a2e31' }], font: 'wide', size: 0.8 }, engine: '#5b636a', wing: '#6c757d', stab: '#6c757d' },
  rokafTransport: { name: '대한민국 공군 수송기', body: '#5f6b72', tail: { bg: '#5f6b72', shapes: [{ t: 'swirl', x: 0.5, y: 0.6, r: 0.08, c1: '#c60c30', c2: '#003478' }] }, titles: { spans: [{ s: 'REPUBLIC OF KOREA AIR FORCE', c: '#262b2e' }], font: 'wide', size: 0.7 }, engine: '#525b61', wing: '#5f6b72', stab: '#5f6b72' },
  army: { name: '미 육군 (US Army)', body: '#4b5320', titles: { spans: [{ s: 'UNITED STATES ARMY', c: '#1d2010' }], font: 'wide', size: 0.7 }, tail: { bg: '#4b5320' }, engine: '#3e4519' },
  medevac: { name: '응급의료 (닥터헬기)', body: '#c1272d', bands: [{ from: -1, to: -0.2, c: W }], lines: [{ h: -0.2, w: 0.08, c: '#ffd200' }], titles: { spans: [{ s: '응급의료헬기', c: '#c1272d' }], font: 'sans', h: -0.55 },
    tail: { bg: '#c1272d', shapes: [{ t: 'star', x: 0.5, y: 0.5, r: 0.2, c: W, n: 6, inner: 0.55 }] }, engine: '#3a3a3a' },
  police: { name: '경찰 항공대', body: '#1e3a6e', bands: [{ from: -1, to: -0.15, c: W }], lines: [{ h: -0.15, w: 0.08, c: '#ffd200' }], titles: { spans: [{ s: 'POLICE 경찰', c: '#1e3a6e' }], font: 'wide', h: -0.5 },
    tail: { bg: '#1e3a6e' }, engine: '#3a3a3a' },
  coastguard: { name: '해양경찰 / 코스트가드', body: W, bands: [{ from: -1, to: -0.4, c: '#ff6a13' }], lines: [{ h: -0.3, w: 0.1, c: '#003478' }], titles: { spans: [{ s: 'COAST GUARD', c: '#003478' }], font: 'wide', h: 0.3 },
    tail: { bg: '#ff6a13' }, engine: '#3a3a3a' },
  offshore: { name: '해상 운송 (Offshore)', body: '#f1f1f1', bands: [{ from: -1, to: -0.3, c: '#0a3d62' }], lines: [{ h: -0.3, w: 0.06, c: '#f39c12' }], tail: { bg: '#0a3d62' }, engine: '#3a3a3a' },
};

/** Registration patterns: # = digit, @ = letter (matching each operator's national prefix and fleet style). */
const AIRLINE_REG: Record<string, string> = {
  kal: 'HL8###', aar: 'HL8###', jja: 'HL8###', jal: 'JA###J', ana: 'JA###A', dlh: 'D-A@@@', ezy: 'G-EZ@@', baw: 'G-@@@@', aca: 'C-F@@@', aal: 'N###AA', dal: 'N###DN',
  ual: 'N###UA', swa: 'N###WN', ryr: 'EI-@@@', afr: 'F-G@@@', sia: '9V-S@@', cpa: 'B-L@@', qfa: 'VH-O@@', uae: 'A6-E@@', qtr: 'A7-A@@', klm: 'PH-@@@', ces: 'B-####',
  azu: 'PR-A@@', anz: 'ZK-N@@', fdx: 'N###FE', airbus: 'F-W@@@', boeing: 'N###BA', comac: 'B-####', embraer: 'PR-Z@@', atr: 'F-W@@@',
};

/** Operator schemes offered per aircraft type (first = default). */
const BY_TYPE: Record<string, string[]> = {
  a320neo: ['dlh', 'ezy', 'airbus'], a319: ['baw', 'aca', 'airbus'], a321neo: ['kal', 'aal', 'airbus'], a220: ['kal', 'dal', 'aca'],
  'b737-700': ['swa', 'boeing'], 'b737-800': ['ryr', 'jja', 'kal'], b737max8: ['kal', 'swa', 'ual'], b757: ['dal', 'ual', 'boeing'],
  c919: ['ces', 'comac'], e175: ['klm', 'dal', 'embraer'], e195e2: ['klm', 'azu', 'embraer'], crj900: ['dal', 'dlh'], q400: ['ana', 'anz'], atr72: ['anz', 'atr'],
  'a330-900': ['dal', 'airbus'], 'a340-600': ['dlh', 'airbus'], 'a350-900': ['aar', 'sia', 'qtr', 'dal'], 'a350-1000': ['cpa', 'jal', 'baw', 'qtr'],
  a380: ['kal', 'uae', 'aar', 'qfa', 'sia'], 'b747-400': ['klm', 'baw', 'dlh'], 'b747-8': ['kal', 'dlh', 'boeing'], 'b767-300': ['ana', 'dal', 'aar'],
  'b777-200er': ['ual', 'aal', 'kal'], 'b777-300er': ['kal', 'uae', 'afr', 'cpa'], 'b787-8': ['ana', 'jal', 'boeing'], 'b787-9': ['kal', 'qfa', 'ual'], 'b787-10': ['sia', 'kal', 'ual'],
  md11: ['fdx', 'klm'], concorde: ['baw', 'afr'],
  f16: ['usaf', 'rokaf', 'thunderbirds'], fa18e: ['usn', 'blueangels'], f35a: ['usaf', 'rokaf'], typhoon: ['raf', 'luftwaffe'],
  p51d: ['metal', 'redtail'], spitfire: ['rafCamo'], dc3: ['aalVintage', 'panam'], c130j: ['usafTransport', 'rokafTransport'],
  h135: ['medevac', 'police'], h125: ['police', 'medevac'], bell407: ['medevac', 'police'], aw139: ['coastguard', 'offshore', 'medevac'], uh60: ['army'], ch47: ['army'],
};

function hash(s: string) { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; }

function regFor(key: string, ac: AircraftDef): string {
  const L = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  let h = hash(key + ac.id);
  const next = (n: number) => { const v = h % n; h = Math.floor(h / n) || hash(String(h) + key); return v; };
  return (AIRLINE_REG[key] ?? 'N###@@').replace(/[#@]/g, c => (c === '#' ? String(next(10)) : L[next(L.length)]));
}

/** Manufacturer / owner scheme built from the type's base colours (GA, bizjets, others). */
function house(ac: AircraftDef): Livery {
  const [body, tail, stripe, eng] = ac.colors;
  const ga = ac.cat === 'ga' || ac.cat === 'glider' || ac.cat === 'vintage';
  const h = hash(ac.id);
  const reg = ac.cat === 'helicopter' ? `HL9${String(h % 1000).padStart(3, '0')}` : ga ? `HL1${String(h % 1000).padStart(3, '0')}` : `N${100 + (h % 899)}${ac.icao.slice(0, 2)}`;
  return {
    id: 'house', name: `${ac.mfr} 공장 도색`, reg, body,
    lines: ac.cat === 'military' ? [] : [{ h: ga ? -0.15 : -0.25, w: 0.08, c: stripe }, { h: ga ? -0.28 : -0.36, w: 0.035, c: tail }],
    titles: ac.cat === 'ga' || ac.cat === 'glider' || ac.cat === 'military' ? undefined : { spans: [{ s: ac.mfr.toUpperCase().split(/[ /]/)[0], c: tail }], font: 'wide', size: 0.8 },
    tail: { bg: tail === body ? body : tail, shapes: tail === body ? [{ t: 'band', y0: 0.3, y1: 0.42, c: stripe, slant: 0.4 }] : [{ t: 'band', y0: 0.25, y1: 0.33, c: stripe, slant: 0.4 }] },
    engine: eng, wing: ac.cat === 'military' || ga ? body : undefined, stab: ga || ac.cat === 'military' ? body : undefined,
  };
}

/** All schemes for a type (first = default). */
export function liveriesFor(ac: AircraftDef): Livery[] {
  const out: Livery[] = [];
  for (const key of BY_TYPE[ac.id] ?? []) {
    const a = A[key] ?? S[key];
    if (!a) continue;
    out.push({ ...a, id: key, reg: S[key] ? (key.startsWith('rokaf') ? `${10 + (hash(ac.id) % 89)}-${String(hash(key) % 1000).padStart(3, '0')}` : `${String(hash(ac.id + key) % 100000).padStart(5, '0')}`) : regFor(key, ac) });
  }
  out.push(house(ac));
  return out;
}

export function getLivery(ac: AircraftDef, id?: string): Livery {
  const all = liveriesFor(ac);
  return all.find(l => l.id === id) ?? all[0];
}
