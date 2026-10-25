#include "Aero.h"
#include "Atmosphere.h"
#include "Engines.h"

namespace skyline {

double LiftSlope(double ar, double sweepDeg, double mach) {
  const double beta2 = 1 - std::pow(std::min(mach, 0.85), 2);
  const double k = 0.95;
  const double tanL = std::tan(sweepDeg * DEG);
  return 2 * kPi * ar / (2 + std::sqrt(ar * ar * beta2 / (k * k) * (1 + tanL * tanL / beta2) + 4));
}

double WaveDrag(double mach, double mcrit, double peak) {
  if (mach <= mcrit) return 0;
  if (mach < 1.05) return peak * std::pow((mach - mcrit) / (1.05 - mcrit), 2.5);
  return peak * (0.55 + 0.45 * std::sqrt(0.1025 / (mach * mach - 1)));
}

namespace {

/** Calibrate zero-lift drag so the aircraft achieves its published cruise speed, and set trim. */
void CalibrateAero(const AircraftDef& ac, AeroModel& m) {
  if (ac.Fdm == FdmKind::Rotor) return;
  const bool sup = m.Supersonic;
  const double h = (sup ? std::min(ac.V.CruiseFt, 45000.0) : ac.V.CruiseFt) * FT;
  const Air air = Atmosphere(h);
  const double mass = std::min(ac.M.Mtow, ac.M.Empty + 0.5 * ac.M.Payload + 0.45 * ac.M.Fuel);
  const double v = sup ? ac.V.Mmo * 0.97 * air.A : ac.V.Cruise * KT;
  const double mach = v / air.A;
  const double q = 0.5 * air.Rho * v * v;
  const double cl = mass * G0 / (q * ac.Area);
  m.CLcruise = cl;
  const double cdi = cl * cl / (kPi * m.Oswald * m.AR);
  if (ac.Eng.T == EngineType::None) {
    m.CD0 = 0.0105;
  } else {
    const double setting = sup ? 1 : (ac.Eng.T == EngineType::Prop ? 0.75 : (ac.Eng.T == EngineType::TProp ? 0.85 : 0.82));
    const double thrust = MaxThrust(ac, air, v, mach, sup) * ac.Eng.N * setting;
    const double cd = thrust / (q * ac.Area);
    m.CD0 = Clamp(cd - cdi - WaveDrag(mach, m.Mcrit, m.WavePeak), 0.009, 0.075);
  }
  // Trim: neutral elevator holds the cruise-ish lift coefficient.
  const double aTrim = m.A0 + std::min(cl, 0.7) / m.CLa;
  m.Cm0 = -m.Cma * aTrim;
}

}  // namespace

AeroModel DeriveAero(const AircraftDef& ac) {
  AeroModel m;
  const double span = ac.Span, area = ac.Area, length = ac.Length;
  const double ar = span * span / area;
  const double chord = area / span;
  const double sweep = ac.Sweep;
  const Category cat = ac.Cat;
  const bool fighter = ac.Cockpit == CockpitKind::Fighter;
  const bool rotor = ac.Fdm == FdmKind::Rotor;
  const double eOsw = Clamp(1.78 * (1 - 0.045 * std::pow(ar, 0.68)) - 0.64 - 0.04 * std::min(sweep, 40.0) / 30, 0.6, 0.9);
  // fighters: LEX/strake, body lift and automatic leading-edge flaps raise the effective lift slope
  const double cla = LiftSlope(ar, sweep) * ((fighter && ac.Tail != TailKind::Delta) ? 1.7 : 1);
  const double a0 = (cat == Category::Glider ? -3.5 : fighter ? -1 : ac.Tail == TailKind::Delta ? 0 : ac.Eng.T == EngineType::Fan ? -3.2 : -2.4) * DEG;

  const double vs1 = std::max(ac.V.Vs1, 20.0) * KT, vs0 = std::max(ac.V.Vs0, 20.0) * KT;
  const double clmax = Clamp(2 * ac.M.Mtow * G0 / (RHO0 * area * vs1 * vs1), 0.9, 2.1);
  const std::vector<FlapDetent>& sched = FlapDetents(ac.Flaps);
  const FlapDetent& last = sched.back();
  const double clmaxFull = Clamp(2 * ac.M.Mlw * G0 / (RHO0 * area * vs0 * vs0), clmax, 3.4);
  const double kf = last.DCLmax > 0 ? (clmaxFull - clmax) / last.DCLmax : 0;
  const bool jetFlaps = ac.Flaps == FlapSchedule::Boeing || ac.Flaps == FlapSchedule::Boeing747 || ac.Flaps == FlapSchedule::Airbus ||
                        ac.Flaps == FlapSchedule::Regional || ac.Flaps == FlapSchedule::Bizjet;
  for (const FlapDetent& f : sched) {
    FlapDetent d = f;
    d.DCL = jetFlaps ? f.DCL * Clamp(kf, 0.3, 1.3) * 1.4 : std::min(f.DCL * Clamp(kf, 0.3, 1.3), f.DCLmax * kf + 0.05);
    d.DCLmax = f.DCLmax * kf;
    m.Flaps.push_back(d);
  }

  // inertias (Roskam radii of gyration)
  const double mNom = ac.M.Empty + 0.5 * ac.M.Fuel + 0.4 * ac.M.Payload;
  const double rx = fighter ? 0.22 : (cat == Category::GA || cat == Category::Vintage) ? 0.25 : ac.Eng.Mount == EngineMount::Wing4 ? 0.31 : 0.27;
  const double ry = fighter ? 0.34 : 0.38;
  const double rz = fighter ? 0.45 : 0.46;
  m.Ixx = mNom * std::pow(span * rx / 2, 2);
  m.Iyy = mNom * std::pow(length * ry / 2, 2);
  m.Izz = mNom * std::pow((span + length) / 2 * rz / 2, 2);

  // stability & control derivatives (per rad; nondimensional rates)
  const bool big = cat == Category::Widebody || cat == Category::Airliner || cat == Category::Regional;
  const bool aerobatic = ac.Id == "extra330";
  m.Cma = fighter ? -0.35 : big ? -1.5 : cat == Category::Bizjet ? -1.2 : -0.95;
  m.Cmq = fighter ? -6 : big ? -24 : cat == Category::Bizjet ? -18 : -12;
  m.Cmde = fighter ? 0.7 : big ? 1.45 : 1.15;
  m.Clda = aerobatic ? 0.32 : fighter ? 0.11 : big ? 0.075 : cat == Category::Glider ? 0.1 : 0.15;
  m.Clp = cat == Category::Glider ? -0.7 : -0.45;
  m.Clb = -(0.02 + 0.012 * ac.Dihedral + (ac.Wing == WingPos::High ? 0.05 : 0) + 0.0015 * sweep);
  m.Cnb = fighter ? 0.12 : big ? 0.12 : 0.075;

  // gear geometry
  const GearDef& g = ac.Gear;
  const double dia = ac.Diameter;
  const bool isHeavy = cat == Category::Widebody;
  double gh = g.Height > 0 ? g.Height
            : (big || cat == Category::Bizjet || fighter)
                  ? 0.5 * dia + (isHeavy ? 0.3 * dia + 0.8 : big ? 0.28 * dia + 0.55 : fighter ? 1.1 : 0.9)
                  : rotor ? 0.5 * dia + 0.35 : 0.5 * dia + (ac.Wing == WingPos::High ? 0.55 : 0.45);
  if (ac.Id == "concorde") gh = 4.2;
  const double weight = ac.M.Mtow * G0;
  auto mkLeg = [&](const char* name, const V3& pos, double share, double steer, bool brake, bool tail) {
    GearLeg leg;
    leg.Name = name; leg.Pos = pos;
    leg.K = weight * share / ((big || fighter) ? 0.18 : 0.12);
    leg.C = 2 * 0.65 * std::sqrt(leg.K * ac.M.Mtow * share);
    leg.Steer = steer; leg.Brake = brake; leg.Tail = tail;
    leg.LimitVs = rotor ? 3.5 : fighter ? 6 : big ? 4.2 : 3.8;
    return leg;
  };
  const double track = g.Track > 0 ? g.Track : rotor ? std::max(2.0, dia * 1.2) : big ? 0.22 * span : fighter ? 0.3 * span : 0.24 * span;
  if (g.T == GearKind::Tri || g.T == GearKind::Float) {
    const double wb = g.Wheelbase > 0 ? g.Wheelbase : rotor ? 0.35 * length : big ? 0.36 * length : fighter ? 0.3 * length : 0.26 * length;
    const double mainX = -0.07 * wb - (big ? 0.2 : 0.05);
    m.Gear.push_back(mkLeg("NOSE", V3(mainX + wb, 0, gh), 0.1, big ? 70 : 30, false, false));
    m.Gear.push_back(mkLeg("LMAIN", V3(mainX, -track / 2, gh), 0.45, 0, true, false));
    m.Gear.push_back(mkLeg("RMAIN", V3(mainX, track / 2, gh), 0.45, 0, true, false));
  } else if (g.T == GearKind::Tail) {
    const double mainX = rotor ? 0.2 * length : 0.06 * length + 0.2;
    const double tailX = rotor ? -0.42 * length : -0.36 * length;
    const double tailZ = gh - (mainX - tailX) * std::tan((rotor ? 2 : 11) * DEG);
    m.Gear.push_back(mkLeg("LMAIN", V3(mainX, -track / 2, gh), 0.45, 0, true, false));
    m.Gear.push_back(mkLeg("RMAIN", V3(mainX, track / 2, gh), 0.45, 0, true, false));
    m.Gear.push_back(mkLeg("TAIL", V3(tailX, 0, tailZ), 0.1, 25, false, true));
  } else {
    const double sx = 0.22 * length;
    m.Gear.push_back(mkLeg("LSKID-F", V3(sx, -track / 2, gh), 0.25, 0, true, false));
    m.Gear.push_back(mkLeg("RSKID-F", V3(sx, track / 2, gh), 0.25, 0, true, false));
    m.Gear.push_back(mkLeg("LSKID-A", V3(-sx * 0.9, -track / 2, gh), 0.25, 0, true, false));
    m.Gear.push_back(mkLeg("RSKID-A", V3(-sx * 0.9, track / 2, gh), 0.25, 0, true, false));
  }

  // structure contact points (crash / scrape detection); tail bumper gives a realistic tail-strike pitch
  double mainX0 = 0;
  for (const GearLeg& l : m.Gear) if (l.Name == "LMAIN") { mainX0 = l.Pos.X; break; }
  const double tsDeg = ac.Id == "concorde" ? 16 : g.T == GearKind::Tail ? 25 : fighter ? 15
                       : (cat == Category::GA || cat == Category::Turboprop) ? 14 : length > 60 ? 9 : 11;
  const double tailZ = std::min(0.2 * dia, gh - (mainX0 + length * 0.45) * std::tan(tsDeg * DEG));
  const double wingZ = ac.Wing == WingPos::High ? -0.35 * dia : ac.Wing == WingPos::Mid ? 0 : 0.3 * dia;
  const double tipZ = wingZ - std::tan(ac.Dihedral * DEG) * span / 2;
  const double tipX = -std::tan(sweep * DEG) * span / 2 * 0.9;
  m.Structure = {
      {"NOSE", V3(length * 0.47, 0, 0.35 * dia)},
      {"TAIL", V3(-length * 0.45, 0, rotor ? 0.2 * dia : tailZ)},
      {"BELLY", V3(0, 0, 0.5 * dia)},
      {"LWINGTIP", V3(tipX, -span / 2, tipZ)},
      {"RWINGTIP", V3(tipX, span / 2, tipZ)},
  };

  // engines
  const EngineDef& e = ac.Eng;
  std::vector<V3>& pos = m.EngPos;
  const double nacD = e.T == EngineType::Fan ? 0.2 * std::pow(e.P, 0.47) : 0.6 * dia;
  const double podClear = cat == Category::Widebody ? 0.75 : 0.5;
  const bool underWing = e.Mount == EngineMount::Wing || e.Mount == EngineMount::Wing4;
  const double zUnder = underWing ? gh - podClear - nacD / 2 : 0.5 * dia;
  switch (e.Mount) {
    case EngineMount::Nose:
    case EngineMount::Internal:
    case EngineMount::Top: pos.push_back(V3(length * 0.2, 0, 0)); break;
    case EngineMount::Internal2: pos.push_back(V3(-length * 0.3, -0.5, 0)); pos.push_back(V3(-length * 0.3, 0.5, 0)); break;
    case EngineMount::Aft:
      pos.push_back(V3(-length * 0.3, -(dia / 2 + 0.7), -0.25 * dia));
      pos.push_back(V3(-length * 0.3, dia / 2 + 0.7, -0.25 * dia));
      break;
    case EngineMount::Tri:
      pos.push_back(V3(0.02 * length, -0.33 * span / 2, zUnder));
      pos.push_back(V3(-length * 0.42, 0, -0.9 * dia));
      pos.push_back(V3(0.02 * length, 0.33 * span / 2, zUnder));
      break;
    case EngineMount::Wing:
      pos.push_back(V3(0.05 * length, -0.34 * span / 2, zUnder));
      pos.push_back(V3(0.05 * length, 0.34 * span / 2, zUnder));
      break;
    case EngineMount::Nacelle: {
      const double y = std::max(0.28 * span / 2, dia * 0.9);
      pos.push_back(V3(0.02 * length, -y, wingZ));
      pos.push_back(V3(0.02 * length, y, wingZ));
      break;
    }
    case EngineMount::Wing4:
    case EngineMount::Nacelle4: {
      const bool concorde = ac.Id == "concorde";
      const double z = e.Mount == EngineMount::Wing4 ? zUnder : concorde ? 0.5 * dia : wingZ;
      const double x = concorde ? -0.3 * length : 0.03 * length;
      const double y1 = concorde ? 0.2 * span / 2 : 0.38 * span / 2, y2 = concorde ? 0.36 * span / 2 : 0.68 * span / 2;
      pos.push_back(V3(x, -y2, z)); pos.push_back(V3(x, -y1, z)); pos.push_back(V3(x, y1, z)); pos.push_back(V3(x, y2, z));
      break;
    }
  }
  while (static_cast<int>(pos.size()) < e.N) pos.push_back(V3());
  if (underWing)
    for (const V3& p : pos) m.Structure.push_back({"POD", V3(p.X, p.Y, p.Z + nacD / 2)});

  m.AR = ar; m.Chord = chord; m.Oswald = eOsw; m.CLa = cla; m.A0 = a0; m.CLmax = clmax; m.CLmin = -0.75 * clmax;
  m.CD0 = 0.025;
  m.CDgear = g.Retract ? (big ? 0.018 : 0.025) : 0;
  m.Mcrit = ac.V.Mmo > 1 ? 0.88 : std::max(0.55, ac.V.Mmo - 0.04);
  m.WavePeak = ac.V.Mmo > 1 ? (ac.Id == "concorde" ? 0.011 : 0.03) : 0.035;
  m.Supersonic = ac.V.Mmo > 1;
  m.Cm0 = 0; m.TrimRange = (fighter ? 6 : 12) * DEG;
  m.CYb = -0.65; m.CYdr = 0.17;
  m.Clr = 0.12; m.Cldr = -0.004;
  m.Cnr = fighter ? -0.3 : -0.16; m.Cnp = -0.03; m.Cnda = -0.012; m.Cndr = big ? 0.09 : 0.075;
  m.MaxDe = (fighter ? 25 : 22) * DEG; m.MaxDa = 20 * DEG; m.MaxDr = 28 * DEG;
  m.Ixz = 0;
  m.CgHeight = gh;
  m.NacD = nacD;
  m.GLimit = aerobatic ? 11 : fighter ? 10.5 : (cat == Category::GA || cat == Category::Vintage) ? 6.5 : cat == Category::Glider ? 7 : cat == Category::Helicopter ? 4 : 4.2;
  m.CLcruise = 0.4;
  CalibrateAero(ac, m);
  return m;
}

}  // namespace skyline
