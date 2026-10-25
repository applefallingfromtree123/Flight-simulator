// Headless flight tests for the C++ sim core: takeoff, climb, heading/speed holds, ILS autoland,
// Airbus normal-law holds and helicopter hover.   ./flight_tests [a320|b738|c172|b77w|fbw|heli]
#include <cstdarg>
#include <cstdio>
#include <cstdlib>
#include <string>
#include "AircraftTypes.h"
#include "FlightControl.h"
#include "FlightModel.h"
#include "Geo.h"

using namespace skyline;

static int gFailures = 0;
static void Check(const std::string& name, bool ok, const std::string& info) {
  std::printf("%s %s: %s\n", ok ? "  ok " : "FAIL", name.c_str(), info.c_str());
  if (!ok) gFailures++;
}
static std::string Fmt(const char* f, ...) {
  char buf[512];
  va_list ap;
  va_start(ap, f);
  std::vsnprintf(buf, sizeof buf, f, ap);
  va_end(ap);
  return buf;
}

static const double kDt = 1.0 / 120;
static PilotInput gPin = {0, 0, 0, 0, 0.5};
static const bool kTrace = std::getenv("TRACE") != nullptr;

static Weather Calm() {
  Weather w = MakeWeather(WeatherPreset::Clear);
  w.WindSpd = 0; w.Gust = 0; w.Turbulence = 0; w.WindAloftSpd = 0;
  return w;
}

static ApproachDef MakeApproach(double elev) {
  ApproachDef ap;
  ap.Airport = "TEST"; ap.Runway = "09";
  ap.Thr = LatLon{0, 0};
  const LatLon far = Destination(ap.Thr, 90, 3000);
  ap.Elev = elev; ap.Crs = 90; ap.GsAngle = 3;
  ap.LocAnt = Destination(far, 90, 300);
  ap.GsAnt = Destination(ap.Thr, 90, 300);
  ap.LengthM = 3000;
  return ap;
}

struct Opts { double CruiseFt; double ClimbSpd = 0; bool Autoland = true; };

static void FlightTest(const std::string& id, const Opts& opts) {
  const AircraftDef& def = GetAircraft(id);
  Aircraft a(def);
  FlightControl fcs(a);
  SimEnv env;
  env.Wx = Calm();
  env.Ground = [](double lat, double lon) { GroundSample g; g.Runway = std::fabs(lat) < 0.001 && lon > -0.05 && lon < 0.03; return g; };
  a.Place(0, 0.02, a.RestHeight(), 270, 0);
  a.SetAllEngines(true);
  a.FlapIdx = std::min(2, static_cast<int>(a.Aero.Flaps.size()) - 1);
  a.FlapPos = a.Aero.Flaps[a.FlapIdx].Deg;
  a.SpoilerArm = true;
  const VSpeeds vs = fcs.Speeds();
  double t = 0, liftoff = 0;
  auto run = [&](double secs, auto&& stop) {
    const double end = t + secs;
    while (t < end && !a.Crashed) {
      if (stop()) return;
      fcs.Update(kDt, gPin);
      a.Step(kDt, env);
      t += kDt; env.Time = t;
      if (kTrace && static_cast<long>(std::lround(t * 120)) % 120 == 0)
        std::printf("  t%.0f alt %.0f vs %.0f ias %.0f th %.1f phi %.1f %s/%s thr %.2f gnd %d\n", t, a.Alt / FT, a.Vs / FPM, a.Ias / KT, a.Theta * RAD,
                    a.Phi * RAD, LatModeName(fcs.Lat), VertModeName(fcs.Vert), a.EngineCmds[0].Throttle, a.OnGround);
    }
  };
  auto never = [] { return false; };
  // takeoff roll with manual rotation
  for (EngineCmd& c : a.EngineCmds) c.Throttle = 1;
  run(120, [&] {
    if (a.Ias / KT > vs.Vr) gPin.Pitch = std::max(-0.3, std::min(0.5, (9 - a.Theta * RAD) * 0.15 - a.W.Y * RAD * 0.1));
    if (!a.OnGround && liftoff == 0) liftoff = t;
    return a.Agl > 400 * FT;
  });
  gPin.Pitch = 0;
  Check(id + " takeoff", !a.Crashed && liftoff > 0, Fmt("liftoff %.1fs, IAS %.0fkt %s", liftoff, a.Ias / KT, a.CrashReason.c_str()));
  a.GearDown = false;
  fcs.EngageAp(true);
  const double climbSpd = opts.ClimbSpd > 0 ? opts.ClimbSpd : std::min(250.0, def.V.Vmo - 10);
  fcs.SelAlt = opts.CruiseFt;
  if (fcs.HasAthr()) fcs.ToggleAthr(); else for (EngineCmd& c : a.EngineCmds) c.Throttle = 1;
  fcs.SetVert(VertMode::Flc);
  fcs.SelSpd = climbSpd;
  run(40, never);
  a.FlapIdx = 0;
  run(600, [&] { return fcs.Vert == VertMode::Alt; });
  Check(id + " climb+capture", fcs.Vert == VertMode::Alt && std::fabs(a.Alt / FT - opts.CruiseFt) < 300,
        Fmt("alt %.0fft mode %s ias %.0f t=%.0f", a.Alt / FT, VertModeName(fcs.Vert), a.Ias / KT, t));
  fcs.SelHdg = 90; fcs.Lat = LatMode::Hdg;
  run(120, never);
  Check(id + " heading", std::fabs(std::fmod(fcs.HdgMag() - 90 + 540, 360.0) - 180) < 5 && std::fabs(a.Alt / FT - opts.CruiseFt) < 150,
        Fmt("hdg %.0f alt %.0f bank %.1f", a.Heading(), a.Alt / FT, a.Phi * RAD));
  fcs.SelSpd = std::round(def.V.Vref * 1.45);
  if (!fcs.HasAthr()) for (EngineCmd& c : a.EngineCmds) c.Throttle = 0.55;
  run(90, never);
  if (fcs.HasAthr()) Check(id + " speed hold", std::fabs(a.Ias / KT - fcs.SelSpd) < 8, Fmt("ias %.0f tgt %.0f", a.Ias / KT, fcs.SelSpd));
  // position for ILS: 12 nm west of threshold at 3000 ft, heading east
  const ApproachDef ap = MakeApproach(0);
  fcs.Plan.HasApproach = true; fcs.Plan.Appr = ap;
  const LatLon start = Destination(ap.Thr, 270, 12 * 1852);
  a.Lat = start.Lat; a.Lon = start.Lon; a.Alt = 3000 * FT + 60;
  fcs.SelAlt = 3000; fcs.AltHold = 3000; fcs.Vert = VertMode::Alt;
  fcs.SelHdg = 90;
  a.GearDown = true; a.FlapIdx = static_cast<int>(a.Aero.Flaps.size()) - 1;
  fcs.SelSpd = std::round(fcs.Vref() + 5);
  fcs.ArmApp();
  if (!opts.Autoland) {
    run(420, [&] { return a.Agl / FT < 200; });
    const IlsDeviation& d = fcs.Ils;
    Check(id + " ILS coupled to 200ft", fcs.Lat == LatMode::Loc && fcs.Vert == VertMode::Gs && std::fabs(d.Loc) < 0.3 && std::fabs(d.Gs) < 0.5,
          Fmt("loc %.2f gs %.2f dots, ias %.0f", d.Loc, d.Gs, a.Ias / KT));
    return;
  }
  run(420, [&] { return a.OnGround && a.Gs < 20 * KT; });
  Check(id + " autoland", !a.Crashed && a.OnGround,
        Fmt("touchdown VS %.0f fpm, lat mode %s, vert %s, loc %.2f %s", a.LastTouchVs / FPM, LatModeName(fcs.Lat), VertModeName(fcs.Vert), fcs.Ils.Loc, a.CrashReason.c_str()));
  const double xtk = CrossTrack(ap.Thr, ap.LocAnt, LatLon{a.Lat, a.Lon});
  Check(id + " rollout centreline", std::fabs(xtk) < 10, Fmt("xtk %.1f m, stop dist %.0f m", xtk, Distance(ap.Thr, LatLon{a.Lat, a.Lon})));
  Check(id + " touchdown firmness", a.LastTouchVs / FPM < 450, Fmt("%.0f fpm", a.LastTouchVs / FPM));
}

static void FbwHold() {
  Aircraft a(GetAircraft("a320neo"));
  FlightControl fcs(a);
  SimEnv env;
  env.Wx = Calm();
  env.Ground = [](double, double) { return GroundSample(); };
  a.Place(0, 0, 3000, 90, 250, 2);
  a.GearDown = false; a.GearPos = 0;
  a.SetAllEngines(true);
  for (EngineCmd& c : a.EngineCmds) c.Throttle = 0.6;
  double t = 0;
  while (t < 30) {
    gPin.Roll = (a.Phi * RAD < 30 && t < 10) ? 0.6 : 0;
    fcs.Update(kDt, gPin); a.Step(kDt, env); t += kDt;
  }
  gPin.Roll = 0;
  Check("A320 normal law bank hold", std::fabs(a.Phi * RAD - 30) < 4, Fmt("bank %.1f vs %.0f fpm", a.Phi * RAD, a.Vs / FPM));
  Check("A320 normal law path hold", std::fabs(a.Vs / FPM) < 700, Fmt("vs %.0f fpm", a.Vs / FPM));
}

static void HeliHover(const std::string& id) {
  Aircraft a(GetAircraft(id));
  FlightControl fcs(a);
  SimEnv env;
  env.Wx = Calm();
  env.Ground = [](double, double) { return GroundSample(); };
  a.Place(0, 0, a.RestHeight(), 0, 0);
  a.SetAllEngines(true);
  for (EngineCmd& c : a.EngineCmds) c.Throttle = 1;
  double t = 0, hi = 0;
  while (t < 60 && !a.Crashed) {
    const double err = 10 - (a.Agl - a.Aero.CgHeight);
    hi += err * kDt * 0.01;
    const double coll = 0.5 + err * 0.03 - a.Vs * 0.05 + hi;
    gPin.Collective = std::max(0.0, std::min(1.0, coll));
    gPin.Pitch = 0; gPin.Roll = 0;
    gPin.Yaw = -a.W.Z * 0.5;
    fcs.Update(kDt, gPin); a.Step(kDt, env); t += kDt;
  }
  Check(id + " hover", !a.Crashed && std::fabs(a.Agl - a.Aero.CgHeight - 10) < 3 && a.Gs < 5,
        Fmt("agl %.1fm gs %.1fkt coll %.2f rpm %.0f%% %s", a.Agl - a.Aero.CgHeight, a.Gs / KT, gPin.Collective, a.RotorRpm * 100, a.CrashReason.c_str()));
  gPin.Collective = 0.5;
}

int main(int argc, char** argv) {
  const std::string which = argc > 1 ? argv[1] : "";
  if (which.empty() || which == "a320") FlightTest("a320neo", {10000});
  if (which.empty() || which == "b738") FlightTest("b737-800", {10000});
  if (which.empty() || which == "c172") FlightTest("c172", {5000, 75, false});
  if (which.empty() || which == "b77w") FlightTest("b777-300er", {10000});
  if (which.empty() || which == "fbw") FbwHold();
  if (which.empty() || which == "heli") { HeliHover("h135"); HeliHover("uh60"); HeliHover("r44"); }
  std::printf(gFailures ? "\n%d failure(s)\n" : "\nall passed\n", gFailures);
  return gFailures ? 1 : 0;
}
