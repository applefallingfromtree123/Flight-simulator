// Texture decoding (PNG, SGI .rgb/.rgba/.sgi/.bw, DDS DXT1/3/5, uncompressed DDS) and PNG encoding.
// Images are { w, h, data: Uint8Array RGBA }. JPEGs are passed through untouched.
import zlib from 'node:zlib';

export function sniff(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpeg';
  if (buf.readUInt16BE(0) === 474) return 'sgi';
  if (buf.toString('latin1', 0, 4) === 'DDS ') return 'dds';
  return null;
}

export function decode(buf) {
  switch (sniff(buf)) {
    case 'png': return decodePng(buf);
    case 'sgi': return decodeSgi(buf);
    case 'dds': return decodeDds(buf);
    default: return null;
  }
}

// ---------------- PNG ----------------
export function decodePng(buf) {
  let p = 8, w = 0, h = 0, depth = 8, ctype = 6, interlace = 0, palette = null, trns = null;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    p += 12 + len;
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; ctype = d[9]; interlace = d[12]; }
    else if (type === 'PLTE') palette = d;
    else if (type === 'tRNS') trns = d;
    else if (type === 'IDAT') idat.push(d);
    else if (type === 'IEND') break;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const chans = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  const out = new Uint8Array(w * h * 4);
  const passes = interlace ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]];
  let off = 0;
  for (const [x0, y0, dx, dy] of passes) {
    const pw = Math.ceil((w - x0) / dx), ph = Math.ceil((h - y0) / dy);
    if (pw <= 0 || ph <= 0) continue;
    const bpp = Math.max(1, (chans * depth) >> 3);
    const stride = Math.ceil(pw * chans * depth / 8);
    let prev = new Uint8Array(stride);
    for (let y = 0; y < ph; y++) {
      const f = raw[off++];
      const line = new Uint8Array(raw.subarray(off, off + stride)); off += stride;
      unfilter(f, line, prev, bpp);
      for (let x = 0; x < pw; x++) {
        const o = ((y0 + y * dy) * w + x0 + x * dx) * 4;
        const s = sample(line, x, chans, depth);
        if (ctype === 3) {
          const i = s.raw0;
          out[o] = palette[i * 3]; out[o + 1] = palette[i * 3 + 1]; out[o + 2] = palette[i * 3 + 2];
          out[o + 3] = trns && i < trns.length ? trns[i] : 255;
        } else if (chans <= 2) {
          const g = s[0];
          out[o] = out[o + 1] = out[o + 2] = g; out[o + 3] = chans === 2 ? s[1] : 255;
          if (ctype === 0 && trns && trns.readUInt16BE(0) === s.raw0) out[o + 3] = 0;
        } else {
          out[o] = s[0]; out[o + 1] = s[1]; out[o + 2] = s[2]; out[o + 3] = chans === 4 ? s[3] : 255;
          if (ctype === 2 && trns && trns.readUInt16BE(0) === s.raw[0] && trns.readUInt16BE(2) === s.raw[1] && trns.readUInt16BE(4) === s.raw[2]) out[o + 3] = 0;
        }
      }
      prev = line;
    }
  }
  return { w, h, data: out };
}
function sample(line, x, chans, depth) {
  // Returns 8-bit channel values; .raw keeps the original values (palette indices, tRNS keys).
  const r = [], raw = [];
  for (let c = 0; c < chans; c++) {
    let v;
    if (depth === 8) v = line[x * chans + c];
    else if (depth === 16) v = (line[(x * chans + c) * 2] << 8) | line[(x * chans + c) * 2 + 1];
    else { const bit = (x * chans + c) * depth; v = (line[bit >> 3] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1); }
    raw.push(v);
    r.push(depth === 16 ? v >> 8 : depth < 8 ? Math.round(v * 255 / ((1 << depth) - 1)) : v);
  }
  r.raw = raw; r.raw0 = raw[0];
  return r;
}
function unfilter(f, line, prev, bpp) {
  for (let i = 0; i < line.length; i++) {
    const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
    let v = line[i];
    if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
    else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
    line[i] = v & 255;
  }
}

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const b = Buffer.alloc(12 + data.length);
  b.writeUInt32BE(data.length, 0); b.write(type, 4, 'latin1'); Buffer.from(data).copy(b, 8);
  b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)), 8 + data.length);
  return b;
}
export function encodePng({ w, h, data }, { alpha = true } = {}) {
  const ch = alpha ? 4 : 3, stride = w * ch;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 1; // Sub filter: cheap and compresses aircraft textures well
    const o = y * (stride + 1) + 1;
    for (let x = 0; x < w; x++) for (let c = 0; c < ch; c++) {
      const i = x * ch + c, v = data[(y * w + x) * 4 + c];
      raw[o + i] = (v - (x > 0 ? data[(y * w + x - 1) * 4 + c] : 0)) & 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = alpha ? 6 : 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------------- SGI ----------------
export function decodeSgi(buf) {
  const rle = buf[2], bpc = buf[3], w = buf.readUInt16BE(6), h = buf.readUInt16BE(8), zs = buf.readUInt16BE(10);
  const out = new Uint8Array(w * h * 4).fill(255);
  const get = (ch, y) => {
    const row = new Uint8Array(w);
    if (!rle) { const o = 512 + (ch * h + y) * w * bpc; for (let x = 0; x < w; x++) row[x] = buf[o + x * bpc]; return row; }
    const tab = 512 + (ch * h + y) * 4;
    let p = buf.readUInt32BE(tab), x = 0;
    while (x < w) {
      const c = buf[p]; p += bpc; const n = c & 0x7f; if (!n) break;
      if (c & 0x80) { for (let i = 0; i < n && x < w; i++) { row[x++] = buf[p]; p += bpc; } }
      else { const v = buf[p]; p += bpc; for (let i = 0; i < n && x < w; i++) row[x++] = v; }
    }
    return row;
  };
  for (let y = 0; y < h; y++) {
    const rows = []; for (let c = 0; c < zs; c++) rows.push(get(c, y));
    const dy = h - 1 - y; // SGI is bottom-up
    for (let x = 0; x < w; x++) {
      const o = (dy * w + x) * 4;
      if (zs <= 2) { out[o] = out[o + 1] = out[o + 2] = rows[0][x]; if (zs === 2) out[o + 3] = rows[1][x]; }
      else { out[o] = rows[0][x]; out[o + 1] = rows[1][x]; out[o + 2] = rows[2][x]; if (zs >= 4) out[o + 3] = rows[3][x]; }
    }
  }
  return { w, h, data: out };
}

// ---------------- DDS ----------------
export function decodeDds(buf) {
  const h = buf.readUInt32LE(12), w = buf.readUInt32LE(16);
  const pfFlags = buf.readUInt32LE(80), four = buf.toString('latin1', 84, 88), bits = buf.readUInt32LE(88);
  let p = 128;
  const out = new Uint8Array(w * h * 4);
  if (pfFlags & 4) {
    const fmt = four === 'DXT1' ? 1 : four === 'DXT3' ? 3 : four === 'DXT5' ? 5 : 0;
    if (!fmt) return null;
    for (let by = 0; by < h; by += 4) for (let bx = 0; bx < w; bx += 4) {
      const alpha = new Uint8Array(16).fill(255);
      if (fmt === 3) { for (let i = 0; i < 16; i++) alpha[i] = ((buf[p + (i >> 1)] >> ((i & 1) * 4)) & 15) * 17; p += 8; }
      else if (fmt === 5) {
        const a0 = buf[p], a1 = buf[p + 1]; const t = [a0, a1];
        if (a0 > a1) for (let i = 1; i < 7; i++) t.push(((7 - i) * a0 + i * a1) / 7 | 0);
        else { for (let i = 1; i < 5; i++) t.push(((5 - i) * a0 + i * a1) / 5 | 0); t.push(0, 255); }
        let bitsA = 0n; for (let i = 0; i < 6; i++) bitsA |= BigInt(buf[p + 2 + i]) << BigInt(8 * i);
        for (let i = 0; i < 16; i++) alpha[i] = t[Number((bitsA >> BigInt(3 * i)) & 7n)];
        p += 8;
      }
      const c0 = buf.readUInt16LE(p), c1 = buf.readUInt16LE(p + 2), idx = buf.readUInt32LE(p + 4); p += 8;
      const rgb = c => [((c >> 11) & 31) * 255 / 31 | 0, ((c >> 5) & 63) * 255 / 63 | 0, (c & 31) * 255 / 31 | 0];
      const A = rgb(c0), B = rgb(c1);
      const pal = c0 > c1 || fmt !== 1
        ? [A, B, A.map((v, i) => (2 * v + B[i]) / 3 | 0), A.map((v, i) => (v + 2 * B[i]) / 3 | 0)]
        : [A, B, A.map((v, i) => (v + B[i]) / 2 | 0), [0, 0, 0]];
      for (let i = 0; i < 16; i++) {
        const x = bx + (i & 3), y = by + (i >> 2); if (x >= w || y >= h) continue;
        const ci = (idx >> (2 * i)) & 3, o = (y * w + x) * 4, c = pal[ci];
        out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2];
        out[o + 3] = fmt === 1 ? (c0 <= c1 && ci === 3 ? 0 : 255) : alpha[i];
      }
    }
    return { w, h, data: out };
  }
  // uncompressed RGB(A)
  const masks = [92, 96, 100, 104].map(o => buf.readUInt32LE(o));
  const shift = m => { if (!m) return -1; let s = 0; while (!((m >>> s) & 1)) s++; return s; };
  const bytes = bits >> 3;
  for (let i = 0; i < w * h; i++, p += bytes) {
    let v = 0; for (let b = 0; b < bytes; b++) v |= buf[p + b] << (8 * b); v >>>= 0;
    for (let c = 0; c < 4; c++) {
      const m = masks[c], s = shift(m);
      out[i * 4 + c] = s < 0 ? 255 : Math.round((((v & m) >>> s) / ((m >>> s) || 1)) * 255);
    }
  }
  return { w, h, data: out };
}

/** 'opaque' | 'mask' | 'blend' from the alpha channel. */
export function alphaKind(img) {
  let partial = 0, zero = 0; const n = img.w * img.h;
  for (let i = 3; i < img.data.length; i += 4) { const a = img.data[i]; if (a === 0) zero++; else if (a < 250) partial++; }
  if (partial + zero === 0) return 'opaque';
  if (partial < n * 0.002) return 'mask';
  return 'blend';
}

export function opaqueCopy(img) {
  const d = new Uint8Array(img.data); for (let i = 3; i < d.length; i += 4) d[i] = 255;
  return { w: img.w, h: img.h, data: d };
}
