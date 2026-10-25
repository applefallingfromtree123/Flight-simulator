// Engine models: turbofan / turbojet (with afterburner), piston + propeller, turboprop, turboshaft.
#pragma once
#include "AircraftTypes.h"
#include "Atmosphere.h"
#include "SimMath.h"

namespace skyline {

struct EngineCmd {
  double Throttle = 0;
  bool Reverse = false;
  double Mixture = 1, Prop = 1;
  bool Cutoff = false, Starter = false, Ignition = true;
};

struct EngineEnv { Air Atm; double V = 0, Mach = 0; bool FuelOk = true, BleedOk = true, ElecOk = true; double Dt = 0; };

double ThrustLapse(const EngineDef& e, const Air& air, double mach, bool ab = false);
double PowerLapse(const EngineDef& e, const Air& air);
double PropStaticThrust(double power, double diameter, double rho);
double PropThrust(double power, double diameter, double rho, double v);
/** Maximum available thrust per engine (N), used for drag calibration and A/THR feed-forward. */
double MaxThrust(const AircraftDef& ac, const Air& air, double v, double mach, bool ab = false);

class Engine {
public:
  EngineDef Def;
  int Index = 0;
  V3 Pos;
  bool Running = false, Failed = false, Fire = false;
  double Spool = 0;   // 0..1 core speed state (idle..max)
  double Thrust = 0;  // N (+ fwd)
  double Power = 0;   // W shaft
  double FuelFlow = 0; // kg/h
  double Rev = 0;     // reverser 0..1
  double AbPos = 0;   // afterburner 0..1
  // indications
  double N1 = 0, N2 = 0, Egt = 15, OilP = 0, OilT = 15;
  double Rpm = 0, Mp = 29.92, Torque = 0, Ng = 0, Np = 0, Itt = 15, Cht = 15;

  Engine(const EngineDef& def, int index, const V3& pos) : Def(def), Index(index), Pos(pos) {}
  EngineType Kind() const { return Def.T; }
  void SetRunning(bool on);
  void Update(const EngineCmd& c, const EngineEnv& env);

private:
  double StartT = 0;
};

}  // namespace skyline
