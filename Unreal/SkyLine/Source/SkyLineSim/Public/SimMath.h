// Allocation-free 3D math for the flight-dynamics core. Engine-independent C++17.
// Frames: body = FRD (x fwd, y right, z down); navigation = local NED.
#pragma once
#include <algorithm>
#include <cmath>

namespace skyline {

constexpr double kPi = 3.14159265358979323846;
constexpr double DEG = kPi / 180.0;
constexpr double RAD = 180.0 / kPi;
constexpr double G0 = 9.80665;
constexpr double KT = 0.514444;      // m/s per knot
constexpr double FT = 0.3048;        // m per foot
constexpr double NM = 1852.0;        // m per nautical mile
constexpr double FPM = FT / 60.0;    // m/s per ft/min
constexpr double LB = 0.45359237;    // kg per lb
constexpr double R_EARTH = 6371008.8;

inline double Clamp(double v, double lo, double hi) { return v < lo ? lo : (v > hi ? hi : v); }
inline double Lerp(double a, double b, double t) { return a + (b - a) * t; }
inline double Sign(double v) { return v > 0 ? 1.0 : (v < 0 ? -1.0 : 0.0); }
inline double Smoothstep(double e0, double e1, double x) {
  const double t = Clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}
inline double Wrap360(double a) { return std::fmod(std::fmod(a, 360.0) + 360.0, 360.0); }
inline double Wrap180(double a) { return std::fmod(std::fmod(a + 180.0, 360.0) + 360.0, 360.0) - 180.0; }
/** First-order lag toward target with time constant tau. */
inline double Approach(double cur, double target, double tau, double dt) {
  return tau <= 0 ? target : cur + (target - cur) * (1.0 - std::exp(-dt / tau));
}
/** Rate-limited move toward target. */
inline double MoveToward(double cur, double target, double maxStep) {
  return std::fabs(target - cur) <= maxStep ? target : cur + Sign(target - cur) * maxStep;
}

struct V3 {
  double X = 0, Y = 0, Z = 0;
  V3() = default;
  V3(double x, double y, double z) : X(x), Y(y), Z(z) {}
  double& operator[](int i) { return i == 0 ? X : (i == 1 ? Y : Z); }
  double operator[](int i) const { return i == 0 ? X : (i == 1 ? Y : Z); }
  V3 operator+(const V3& o) const { return {X + o.X, Y + o.Y, Z + o.Z}; }
  V3 operator-(const V3& o) const { return {X - o.X, Y - o.Y, Z - o.Z}; }
  V3 operator*(double s) const { return {X * s, Y * s, Z * s}; }
  V3& operator+=(const V3& o) { X += o.X; Y += o.Y; Z += o.Z; return *this; }
};
inline double Dot(const V3& a, const V3& b) { return a.X * b.X + a.Y * b.Y + a.Z * b.Z; }
inline V3 Cross(const V3& a, const V3& b) { return {a.Y * b.Z - a.Z * b.Y, a.Z * b.X - a.X * b.Z, a.X * b.Y - a.Y * b.X}; }
inline double Len(const V3& a) { return std::sqrt(a.X * a.X + a.Y * a.Y + a.Z * a.Z); }

/** Unit quaternion (w, x, y, z) rotating body -> NED. */
struct Quat {
  double W = 1, X = 0, Y = 0, Z = 0;
  Quat() = default;
  Quat(double w, double x, double y, double z) : W(w), X(x), Y(y), Z(z) {}
};
inline Quat QNormalize(const Quat& q) {
  double n = std::sqrt(q.W * q.W + q.X * q.X + q.Y * q.Y + q.Z * q.Z);
  if (n <= 0) n = 1;
  return {q.W / n, q.X / n, q.Y / n, q.Z / n};
}
inline Quat QMul(const Quat& a, const Quat& b) {
  return {a.W * b.W - a.X * b.X - a.Y * b.Y - a.Z * b.Z,
          a.W * b.X + a.X * b.W + a.Y * b.Z - a.Z * b.Y,
          a.W * b.Y - a.X * b.Z + a.Y * b.W + a.Z * b.X,
          a.W * b.Z + a.X * b.Y - a.Y * b.X + a.Z * b.W};
}
/** Rotate v by q (body -> NED). */
inline V3 QRot(const Quat& q, const V3& v) {
  const double tx = 2 * (q.Y * v.Z - q.Z * v.Y);
  const double ty = 2 * (q.Z * v.X - q.X * v.Z);
  const double tz = 2 * (q.X * v.Y - q.Y * v.X);
  return {v.X + q.W * tx + (q.Y * tz - q.Z * ty), v.Y + q.W * ty + (q.Z * tx - q.X * tz), v.Z + q.W * tz + (q.X * ty - q.Y * tx)};
}
/** Inverse rotation (NED -> body). */
inline V3 QRotInv(const Quat& q, const V3& v) { return QRot(Quat(q.W, -q.X, -q.Y, -q.Z), v); }
/** Aerospace 3-2-1 Euler (yaw psi, pitch theta, roll phi) to quaternion. */
inline Quat QFromEuler(double psi, double theta, double phi) {
  const double cy = std::cos(psi / 2), sy = std::sin(psi / 2);
  const double cp = std::cos(theta / 2), sp = std::sin(theta / 2);
  const double cr = std::cos(phi / 2), sr = std::sin(phi / 2);
  return {cr * cp * cy + sr * sp * sy, sr * cp * cy - cr * sp * sy, cr * sp * cy + sr * cp * sy, cr * cp * sy - sr * sp * cy};
}
/** Quaternion -> (psi, theta, phi). */
inline V3 QToEuler(const Quat& q) {
  const double phi = std::atan2(2 * (q.W * q.X + q.Y * q.Z), 1 - 2 * (q.X * q.X + q.Y * q.Y));
  const double theta = std::asin(Clamp(2 * (q.W * q.Y - q.Z * q.X), -1, 1));
  const double psi = std::atan2(2 * (q.W * q.Z + q.X * q.Y), 1 - 2 * (q.Y * q.Y + q.Z * q.Z));
  return {psi, theta, phi};
}
/** Integrate body rates over dt. */
inline Quat QIntegrate(const Quat& q, const V3& w, double dt) {
  const double wn = Len(w);
  if (wn < 1e-9) return q;
  const double half = wn * dt / 2;
  const double s = std::sin(half) / wn;
  return QNormalize(QMul(q, Quat(std::cos(half), w.X * s, w.Y * s, w.Z * s)));
}

/** PID with conditional-integration anti-windup and derivative on measurement. */
class Pid {
public:
  double Kp, Ki, Kd, ILim, OutLim;
  double I = 0;
  Pid(double kp, double ki, double kd, double iLim = 1, double outLim = 1) : Kp(kp), Ki(ki), Kd(kd), ILim(iLim), OutLim(outLim) {}
  void Reset() { I = 0; HasPrev = false; }
  double Update(double err, double meas, double dt) {
    const double d = (!HasPrev || dt <= 0) ? 0.0 : -(meas - Prev) / dt;
    Prev = meas; HasPrev = true;
    const double out0 = Kp * err + I + Kd * d;
    if (!(std::fabs(out0) >= OutLim && Sign(out0) == Sign(err))) I = Clamp(I + Ki * err * dt, -ILim, ILim);
    return Clamp(Kp * err + I + Kd * d, -OutLim, OutLim);
  }
private:
  double Prev = 0;
  bool HasPrev = false;
};

}  // namespace skyline
