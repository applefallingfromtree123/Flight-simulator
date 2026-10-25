// Great-circle navigation helpers on a spherical Earth.
#pragma once
#include "SimMath.h"

namespace skyline {

struct LatLon { double Lat = 0, Lon = 0; };  // degrees

double Distance(const LatLon& a, const LatLon& b);
/** Initial great-circle bearing (deg true). */
double Bearing(const LatLon& a, const LatLon& b);
LatLon Destination(const LatLon& a, double brgDeg, double dist);
/** Signed cross-track distance (m) of p from great circle a->b (positive = right of course). */
double CrossTrack(const LatLon& a, const LatLon& b, const LatLon& p);
/** Along-track distance from a toward b of p's projection. */
double AlongTrack(const LatLon& a, const LatLon& b, const LatLon& p);
/** Magnetic variation (deg, east positive), dipole approximation. */
double MagVar(double lat, double lon);

}  // namespace skyline
