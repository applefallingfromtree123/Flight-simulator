// Flight control system: control laws (conventional, Airbus normal law, Boeing C*U, fighter g-command),
// yaw damper, helicopter SAS, autopilot (lateral / vertical modes), flight director and autothrottle.
#pragma once
#include <string>
#include <vector>
#include "FlightModel.h"
#include "Geo.h"
#include "SimMath.h"

namespace skyline {

struct PilotInput { double Pitch = 0, Roll = 0, Yaw = 0, Trim = 0, Collective = 0; };

enum class LatMode { Off, Rol, Hdg, Nav, Loc, Rwy, Rollout, GoAround };
enum class VertMode { Off, Pit, Vs, Alt, AltStar, Flc, Gs, Flare, Toga, Vnav };
enum class AthrMode { Off, Speed, ThrClb, Idle, Retard, Toga, AlphaFloor };
enum class FbwLawState { Normal, Alternate, Direct };

const char* LatModeName(LatMode m);
const char* VertModeName(VertMode m);

struct ApproachDef {
  std::string Airport, Runway;
  LatLon Thr; double Elev = 0;  // threshold, m MSL
  double Crs = 0;               // true course (deg)
  double GsAngle = 3;           // glide slope (deg)
  LatLon LocAnt, GsAnt;
  double LengthM = 3000;
};

struct Waypoint { std::string Ident; double Lat = 0, Lon = 0; double AltFt = std::nan(""); };

struct FlightPlan {
  std::vector<Waypoint> Wps;
  int Active = 1;
  bool HasApproach = false;
  ApproachDef Appr;
  double CruiseFt = 35000;
  const Waypoint* From() const { return Active >= 1 && Active - 1 < static_cast<int>(Wps.size()) ? &Wps[Active - 1] : nullptr; }
  const Waypoint* To() const { return Active >= 0 && Active < static_cast<int>(Wps.size()) ? &Wps[Active] : nullptr; }
  double RemainingNm(const LatLon& pos) const;
};

struct IlsDeviation {
  double Loc = 0, Gs = 0;      // dots (+ = fly right / fly up)
  double LocDeg = 0, GsDeg = 0;
  bool Valid = false, GsValid = false;
  double DistNm = 0, Hat = 0;
};
IlsDeviation ComputeIls(const ApproachDef& ap, const LatLon& pos, double altM);

struct VSpeeds { double V1, Vr, V2, Vref, Vapp; };

class FlightControl {
public:
  explicit FlightControl(Aircraft& ac);

  // selected targets (MCP / FCU)
  double SelSpd = 250, SelMach = 0.78; bool SpdIsMach = false;
  double SelHdg = 0, SelAlt = 10000, SelVs = 0;
  // engagement
  bool Ap = false, Fd = true; AthrMode Athr = AthrMode::Off;
  bool Yd = true, Sas = true;
  LatMode Lat = LatMode::Off; VertMode Vert = VertMode::Off;
  LatMode LatArmed = LatMode::Off; VertMode VertArmed = VertMode::Off;  // Off = nothing armed
  double FdPitch = 0, FdRoll = 0;
  double ThrCmd = 0;
  FbwLawState Law = FbwLawState::Normal;
  bool Flare = false; double FlareMemo = 0;
  bool AlphaProt = false, AlphaFloor = false;
  double ApDisconnectWarn = 0;
  FlightPlan Plan;
  std::string Msg;
  std::string AthrDisplay = "OFF";
  double MagVarDeg = 0;  // magnetic variation at the aircraft (deg, east +); selected headings are magnetic
  bool HasIls = false; IlsDeviation Ils;
  bool GsCaptured = false;
  double AltHold = 0;

  double HdgMag() const { return Wrap360(Ac.Heading() - MagVarDeg); }
  bool IsJet() const { return Ac.Def.Eng.T == EngineType::Fan || Ac.Def.Eng.T == EngineType::Jet; }
  double BankLimit() const { return (Ac.Def.Cat == Category::GA || Ac.Def.Cat == Category::Vintage) ? 22 : 25; }
  bool HasAthr() const;
  double Vref() const;
  VSpeeds Speeds() const;

  void EngageAp(bool on);
  void SetLat(LatMode m);
  void SetVert(VertMode m);
  void ArmApp();
  void Toga();
  void ToggleAthr();
  void Update(double dt, const PilotInput& pin);

private:
  Aircraft& Ac;
  double PitchHold = 0, BankHold = 0; bool RollHoldActive = false;
  double FbwVtrim = 0;
  Pid VsPid{0.004, 0.0012, 0, 3, 8};
  double FlcGamma = 0;
  Pid AthrPid{0.045, 0.012, 0, 0.4, 1};
  double YawInt = 0;
  Pid HeliAltPid{0.0025, 0.0006, 0, 0.25, 0.4};
  double LastIas = 0, Accel = 0;
  double AEst = 0;
  double FlareT = 0, FlareTau = 3;
  bool PathHoldActive = false; double GammaHold = 0;
  double HeliCollBase = 0.5;

  void InnerLoops(double pitchDeg, double rollDeg, double& de, double& da);
  void FbwControlLaw(double dt, const PilotInput& pin, double& de, double& da);
  void ModeLogic();
  void Sequence();
  void AutopilotTargets(double dt, double& pitch, double& roll);
  double AlphaEst();
  void Autothrottle(double dt);
  void Heli(double dt, const PilotInput& pin);
};

}  // namespace skyline
