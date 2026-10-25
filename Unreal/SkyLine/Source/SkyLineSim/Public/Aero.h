// Derives a complete aerodynamic model (lift curve, drag polar, stability & control derivatives,
// inertias, gear geometry) from an aircraft's published geometry and performance.
#pragma once
#include <string>
#include <vector>
#include "AircraftTypes.h"
#include "SimMath.h"

namespace skyline {

struct GearLeg { std::string Name; V3 Pos; double K = 0, C = 0, Steer = 0; bool Brake = false, Tail = false; double LimitVs = 3.8; };
struct Contact { std::string Name; V3 Pos; };

struct AeroModel {
  double AR = 0, Chord = 0, Oswald = 0;
  double CLa = 0, A0 = 0, CLmax = 0, CLmin = 0;
  std::vector<FlapDetent> Flaps;
  double CD0 = 0.025, CDgear = 0, Mcrit = 0.78, WavePeak = 0.035;
  bool Supersonic = false;
  double Cm0 = 0, Cma = 0, Cmq = 0, Cmde = 0, TrimRange = 0;
  double CYb = 0, CYdr = 0;
  double Clb = 0, Clp = 0, Clr = 0, Clda = 0, Cldr = 0;
  double Cnb = 0, Cnr = 0, Cnp = 0, Cnda = 0, Cndr = 0;
  double MaxDe = 0, MaxDa = 0, MaxDr = 0;
  double Ixx = 0, Iyy = 0, Izz = 0, Ixz = 0;
  std::vector<GearLeg> Gear;
  std::vector<Contact> Structure;
  std::vector<V3> EngPos;
  double CgHeight = 0;
  double NacD = 0;
  double GLimit = 4.2;
  double CLcruise = 0.4;
};

/** DATCOM / Helmbold lift-curve slope (per rad). */
double LiftSlope(double ar, double sweepDeg, double mach = 0.3);
double WaveDrag(double mach, double mcrit, double peak);
AeroModel DeriveAero(const AircraftDef& ac);

}  // namespace skyline
