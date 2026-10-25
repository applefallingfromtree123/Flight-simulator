// Six-degree-of-freedom rigid-body flight dynamics model.
// Fixed-wing: component build-up with stability derivatives, post-stall, ground effect, compressibility.
// Rotorcraft: rotor-disk model with governor, translational lift, ground effect, vortex-ring state.
#pragma once
#include <functional>
#include <string>
#include <vector>
#include "Aero.h"
#include "AircraftTypes.h"
#include "Atmosphere.h"
#include "Engines.h"
#include "SimMath.h"

namespace skyline {

struct GroundSample { double H = 0; bool Water = false; bool Runway = false; };

struct SimEnv {
  Weather Wx;
  std::function<GroundSample(double lat, double lon)> Ground;
  double Time = 0;
};

struct ControlCmd { double De = 0, Da = 0, Dr = 0; };
struct ControlPower { double Pitch = 1, Roll = 1, Yaw = 1; };

class Aircraft {
public:
  explicit Aircraft(const AircraftDef& def);

  const AircraftDef& Def;
  AeroModel Aero;
  // state
  double Lat = 0, Lon = 0, Alt = 0;  // deg, deg, m MSL
  V3 Vel;                            // NED m/s
  Quat Q;                            // body -> NED
  V3 W;                              // body rates rad/s
  double Fuel = 0, Payload = 0;
  // control effectors (normalised)
  double De = 0, Da = 0, Dr = 0;
  ControlCmd Cmd;
  double Trim = 0, RudderTrim = 0;
  int FlapIdx = 0;
  double FlapPos = 0;  // deg
  bool GearDown = true;
  double GearPos = 1;
  double Speedbrake = 0;
  bool SpoilerArm = false;
  double SpoilerPos = 0;
  double BrakeL = 0, BrakeR = 0;
  bool ParkingBrake = false;
  int Autobrake = 0;
  double AutobrakeCmd = 0;
  double Collective = 0, RotorRpm = 0;
  std::vector<Engine> Engines;
  std::vector<EngineCmd> EngineCmds;
  // derived outputs
  Air Atm;
  V3 VAir, Wind;
  double Tas = 0, Ias = 0, Mach = 0, Alpha = 0, Beta = 0, Qbar = 0;
  double Psi = 0, Theta = 0, Phi = 0;
  double Gs = 0, Track = 0, Vs = 0, Agl = 0, GroundH = 0;
  bool OnWater = false, OnRunway = false;
  double Nz = 1, Ny = 0, Nx = 0;
  double CL = 0, CD = 0, Stall = 0;
  bool OnGround = false;
  std::vector<bool> Wow;
  std::vector<double> GearCompression;
  double LastTouchVs = 0;
  int TouchdownEvent = 0;
  bool Crashed = false;
  std::string CrashReason;
  double CrashTime = 0;
  bool TailStrike = false, BellyLanding = false;
  double CmRest = 0, ClRest = 0, CnRest = 0;
  ControlPower CtrlPower;
  double TorquePct = 0;
  double Time = 0;

  double Mass() const { return Def.M.Empty + Fuel + Payload; }
  V3 Inertia() const;
  bool IsRotor() const { return Def.Fdm == FdmKind::Rotor; }
  double FlapsDeg() const { return Aero.Flaps[FlapIdx].Deg; }
  const char* FlapLabel() const { return Aero.Flaps[FlapIdx].Label; }
  double Heading() const { return Wrap360(Psi * RAD); }

  /** Place the aircraft at rest (speedKt = 0) or in flight. pitchDeg NaN = automatic. */
  void Place(double lat, double lon, double alt, double hdgDeg, double speedKt = 0, double pitchDeg = std::nan(""));
  double StaticPitch() const;
  /** Height of the CG above ground when resting on the gear. */
  double RestHeight() const;
  void SetAllEngines(bool on);
  void Step(double dt, const SimEnv& env);
  void DoCrash(const std::string& reason);

private:
  void UpdateDerived();
  void FixedWingForces(double v, V3& f, V3& m);
  void RotorForces(double dt, const Air& air, const V3& vb, double v, V3& f, V3& m);
  void GroundContact(V3& f, V3& m, double mass);
  void CheckLimits();

  V3 CtrlM;
  double SampleT = 0;
  GroundSample Gs0;
  bool PrevOnGround = false;
};

}  // namespace skyline
