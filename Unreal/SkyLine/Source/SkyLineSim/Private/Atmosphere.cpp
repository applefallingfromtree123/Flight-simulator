#include "Atmosphere.h"

namespace skyline {

namespace {
constexpr double kLapse = 0.0065, kRgas = 287.05287, kGrav = 9.80665, kGamma = 1.4;

double TurbNoise(double t, double seed) {
  return std::sin(t * 1.3 + seed) * 0.5 + std::sin(t * 2.9 + seed * 1.7) * 0.3 + std::sin(t * 6.1 + seed * 2.3) * 0.2;
}
}  // namespace

Air Atmosphere(double hMsl, double dT, double qnh) {
  const double h = std::max(-500.0, hMsl);
  double tStd, p;
  if (h < 11000) {
    tStd = T0 - kLapse * h;
    p = qnh * std::pow(tStd / T0, kGrav / (kLapse * kRgas));
  } else {
    tStd = 216.65;
    const double p11 = qnh * std::pow(216.65 / T0, kGrav / (kLapse * kRgas));
    p = p11 * std::exp(-kGrav * (h - 11000) / (kRgas * 216.65));
  }
  Air air;
  air.T = tStd + dT;
  air.P = p;
  air.Rho = p / (kRgas * air.T);
  air.A = std::sqrt(kGamma * kRgas * air.T);
  air.Sigma = air.Rho / RHO0;
  air.Delta = p / P0;
  air.Theta = air.T / T0;
  return air;
}

double PressureAltitude(double p) {
  if (p > 22632) return (T0 / kLapse) * (1 - std::pow(p / P0, kLapse * kRgas / kGrav));
  return 11000 + (-kRgas * 216.65 / kGrav) * std::log(p / 22632);
}

double IndicatedAltitude(double p, double setting) { return (T0 / kLapse) * (1 - std::pow(p / setting, kLapse * kRgas / kGrav)); }

double TasToCas(double tas, const Air& air) {
  const double m = tas / air.A;
  const double qc = air.P * (std::pow(1 + 0.2 * m * m, 3.5) - 1);
  return A0 * std::sqrt(5 * (std::pow(qc / P0 + 1, 2.0 / 7.0) - 1));
}

double CasToTas(double cas, const Air& air) {
  const double qc = P0 * (std::pow(1 + 0.2 * (cas / A0) * (cas / A0), 3.5) - 1);
  const double m = std::sqrt(5 * (std::pow(qc / air.P + 1, 2.0 / 7.0) - 1));
  return m * air.A;
}

Weather MakeWeather(WeatherPreset preset) {
  Weather w;
  switch (preset) {
    case WeatherPreset::Clear: break;
    case WeatherPreset::Calm: w.WindSpd = 0; w.WindAloftSpd = 0; w.Turbulence = 0; break;
    case WeatherPreset::Few:
      w = {240, 10, 260, 60, 0, 0.15, 30000, 2, 1015, {{1200, 2100, 0.3}, {7000, 7400, 0.2}}, 0};
      break;
    case WeatherPreset::Overcast: w = {200, 14, 240, 80, 20, 0.3, 8000, -2, 1004, {{500, 2400, 0.95}}, 1}; break;
    case WeatherPreset::Storm: w = {180, 22, 230, 100, 35, 0.7, 2500, -4, 996, {{300, 9000, 1}}, 3}; break;
    case WeatherPreset::LowVis: w = {90, 3, 260, 40, 0, 0.02, 250, -1, 1022, {{30, 350, 1}}, 0}; break;
    case WeatherPreset::Crosswind: w = {0, 28, 300, 90, 38, 0.45, 20000, 0, 1008, {{1500, 2000, 0.4}}, 0}; break;
  }
  return w;
}

V3 WindAt(const Weather& w, double hMsl, double agl, double t) {
  const double k = Clamp(hMsl / 9144, 0, 1);
  const double bl = agl < 300 ? Clamp(std::log(std::max(agl, 1.0) / 0.1) / std::log(300 / 0.1), 0.35, 1) : 1;
  double dir = w.WindDir + (std::fmod(std::fmod(w.WindAloftDir - w.WindDir, 360.0) + 540.0, 360.0) - 180.0) * k;
  double spd = (w.WindSpd + (w.WindAloftSpd - w.WindSpd) * k) * (k < 0.05 ? bl : 1);
  if (w.Gust > w.WindSpd && agl < 1500) {
    const double gf = std::max(0.0, TurbNoise(t * 0.25, 11));
    spd += (w.Gust - w.WindSpd) * gf * (1 - agl / 1500);
  }
  dir *= DEG;
  const double v = spd * KT;
  const double n = -std::cos(dir) * v, e = -std::sin(dir) * v;
  const double turb = w.Turbulence * (agl < 600 ? 1 : 0.6) * (1 + 0.4 * std::min(1.0, spd / 30));
  const double tn = TurbNoise(t, 1) * turb * 3, te = TurbNoise(t, 2) * turb * 3;
  const double td = TurbNoise(t * 1.4, 3) * turb * 2.2 * Clamp(agl / 30, 0, 1);
  return {n + tn, e + te, td};
}

double InCloud(const Weather& w, double hMsl) {
  double d = 0;
  for (const CloudLayer& c : w.Clouds)
    if (hMsl > c.Base && hMsl < c.Top) d = std::max(d, c.Cover);
  return d;
}

}  // namespace skyline
