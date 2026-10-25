// 4x4 affine matrices in OSG row-vector convention: p' = p * M, stored row-major (m[r*4+c]).
export const ident = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export function mul(a, b) { // a then b
  const o = new Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    let s = 0; for (let k = 0; k < 4; k++) s += a[r * 4 + k] * b[k * 4 + c]; o[r * 4 + c] = s;
  }
  return o;
}
export function translate(x, y, z) { const m = ident(); m[12] = x; m[13] = y; m[14] = z; return m; }
/** Right-handed rotation about a unit axis, row-vector form. */
export function rotate(deg, ax, ay, az) {
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  const l = Math.hypot(ax, ay, az) || 1; ax /= l; ay /= l; az /= l;
  // column-vector matrix R, row-vector form is R^T
  const R = [
    t * ax * ax + c, t * ax * ay - s * az, t * ax * az + s * ay,
    t * ax * ay + s * az, t * ay * ay + c, t * ay * az - s * ax,
    t * ax * az - s * ay, t * ay * az + s * ax, t * az * az + c,
  ];
  return [R[0], R[3], R[6], 0, R[1], R[4], R[7], 0, R[2], R[5], R[8], 0, 0, 0, 0, 1];
}
export function fromRot3Loc(rot, loc) {
  const m = ident();
  if (rot) { m[0] = rot[0]; m[1] = rot[1]; m[2] = rot[2]; m[4] = rot[3]; m[5] = rot[4]; m[6] = rot[5]; m[8] = rot[6]; m[9] = rot[7]; m[10] = rot[8]; }
  m[12] = loc[0]; m[13] = loc[1]; m[14] = loc[2];
  return m;
}
export function xform(m, x, y, z) {
  return [x * m[0] + y * m[4] + z * m[8] + m[12], x * m[1] + y * m[5] + z * m[9] + m[13], x * m[2] + y * m[6] + z * m[10] + m[14]];
}
/** AC3D is Y-up; FlightGear model space is X aft, Y right, Z up (simgear model.cxx). */
export const AC_TO_FG = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1];
/** FlightGear model offsets: pitch about Y, then roll about X, then heading about Z, then translate (simgear modellib). */
export function offsetsMatrix(o) {
  if (!o) return ident();
  let m = rotate(o.num('pitch-deg'), 0, 1, 0);
  m = mul(m, rotate(o.num('roll-deg'), 1, 0, 0));
  m = mul(m, rotate(o.num('heading-deg'), 0, 0, 1));
  return mul(m, translate(o.num('x-m'), o.num('y-m'), o.num('z-m')));
}
