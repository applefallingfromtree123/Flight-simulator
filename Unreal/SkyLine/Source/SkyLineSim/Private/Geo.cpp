#include "Geo.h"

namespace skyline {

double Distance(const LatLon& a, const LatLon& b) {
  const double p1 = a.Lat * DEG, p2 = b.Lat * DEG;
  const double dp = p2 - p1, dl = (b.Lon - a.Lon) * DEG;
  const double h = std::pow(std::sin(dp / 2), 2) + std::cos(p1) * std::cos(p2) * std::pow(std::sin(dl / 2), 2);
  return 2 * R_EARTH * std::asin(std::min(1.0, std::sqrt(h)));
}

double Bearing(const LatLon& a, const LatLon& b) {
  const double p1 = a.Lat * DEG, p2 = b.Lat * DEG, dl = (b.Lon - a.Lon) * DEG;
  const double y = std::sin(dl) * std::cos(p2);
  const double x = std::cos(p1) * std::sin(p2) - std::sin(p1) * std::cos(p2) * std::cos(dl);
  return Wrap360(std::atan2(y, x) * RAD);
}

LatLon Destination(const LatLon& a, double brgDeg, double dist) {
  const double d = dist / R_EARTH, t = brgDeg * DEG, p1 = a.Lat * DEG, l1 = a.Lon * DEG;
  const double p2 = std::asin(std::sin(p1) * std::cos(d) + std::cos(p1) * std::sin(d) * std::cos(t));
  const double l2 = l1 + std::atan2(std::sin(t) * std::sin(d) * std::cos(p1), std::cos(d) - std::sin(p1) * std::sin(p2));
  LatLon out;
  out.Lat = p2 * RAD;
  out.Lon = std::fmod(l2 * RAD + 540.0, 360.0) - 180.0;
  return out;
}

double CrossTrack(const LatLon& a, const LatLon& b, const LatLon& p) {
  const double d13 = Distance(a, p) / R_EARTH;
  const double t13 = Bearing(a, p) * DEG, t12 = Bearing(a, b) * DEG;
  return std::asin(std::sin(d13) * std::sin(t13 - t12)) * R_EARTH;
}

double AlongTrack(const LatLon& a, const LatLon& b, const LatLon& p) {
  const double d13 = Distance(a, p) / R_EARTH;
  const double xt = CrossTrack(a, b, p) / R_EARTH;
  const double at = std::acos(std::min(1.0, std::cos(d13) / std::max(1e-12, std::cos(xt)))) * R_EARTH;
  const double t13 = Bearing(a, p) * DEG, t12 = Bearing(a, b) * DEG;
  return std::cos(t13 - t12) >= 0 ? at : -at;
}

double MagVar(double lat, double lon) {
  const double pLat = 80.8 * DEG, pLon = -72.8 * DEG;
  const double la = lat * DEG, lo = lon * DEG;
  const double y = std::sin(pLon - lo) * std::cos(pLat);
  const double x = std::cos(la) * std::sin(pLat) - std::sin(la) * std::cos(pLat) * std::cos(pLon - lo);
  double v = std::atan2(y, x) * RAD;
  if (v > 180) v -= 360;
  return v;
}

}  // namespace skyline
