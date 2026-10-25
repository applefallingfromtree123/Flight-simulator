// International Standard Atmosphere, air-data conversions, and the weather/wind model.
#pragma once
#include <vector>
#include "SimMath.h"

namespace skyline {

constexpr double RHO0 = 1.225, P0 = 101325.0, T0 = 288.15, A0 = 340.294;

struct Air { double T = T0, P = P0, Rho = RHO0, A = A0, Sigma = 1, Delta = 1, Theta = 1; };

/** ISA with temperature deviation (K) and sea-level pressure (Pa). */
Air Atmosphere(double hMsl, double dT = 0, double qnh = P0);
double PressureAltitude(double p);
double IndicatedAltitude(double p, double setting);
/** Calibrated airspeed (m/s) from TAS (m/s), compressible. */
double TasToCas(double tas, const Air& air);
double CasToTas(double cas, const Air& air);

struct CloudLayer { double Base = 0, Top = 0, Cover = 0; };  // metres MSL, 0..1

struct Weather {
  double WindDir = 270, WindSpd = 5;            // deg FROM, kt at surface
  double WindAloftDir = 280, WindAloftSpd = 45; // at FL300
  double Gust = 0;                              // kt
  double Turbulence = 0.05;                     // 0..1
  double Visibility = 60000;                    // m
  double DeltaT = 0;                            // ISA deviation K
  double Qnh = 1013.25;                         // hPa
  std::vector<CloudLayer> Clouds;
  int Precip = 0;                               // 0 none .. 3 heavy
};

enum class WeatherPreset { Clear, Few, Overcast, Storm, LowVis, Crosswind, Calm };
Weather MakeWeather(WeatherPreset preset);

/** Wind vector in NED (m/s, direction the air moves TO). */
V3 WindAt(const Weather& w, double hMsl, double agl, double t);
/** Cloud density 0..1 at an altitude. */
double InCloud(const Weather& w, double hMsl);

}  // namespace skyline
