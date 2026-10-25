// Aircraft definition: published geometry, masses, speeds and configuration from which the
// aerodynamic model is derived (see Aero.h).
#pragma once
#include <string>
#include <vector>

namespace skyline {

enum class Category { Airliner, Widebody, Regional, Bizjet, Turboprop, GA, Military, Vintage, Helicopter, Glider };
enum class EngineType { Fan, Jet, Prop, TProp, Shaft, None };
enum class EngineMount { Wing, Wing4, Aft, Tri, Nose, Nacelle, Nacelle4, Internal, Internal2, Top };
enum class FlapSchedule { Boeing, Boeing747, Airbus, GA, Bizjet, Regional, Fighter, None, Split };
enum class CockpitKind { Airliner, G1000, Steam, Fighter, Heli };
enum class FbwLaw { None, Airbus, Boeing, Fighter };
enum class WingPos { Low, Mid, High };
enum class TailKind { Conv, T, Cruciform, Twin, H, Delta };
enum class GearKind { Tri, Tail, Skid, Float };
enum class FdmKind { Fixed, Rotor };
enum class RotorTail { Rotor, Fenestron, Notar, Tandem };

struct EngineDef {
  EngineType T = EngineType::Fan;
  int N = 2;
  double P = 100;        // kN static thrust per engine (fan/jet) or kW shaft power (prop/tprop/shaft)
  double Ab = 0;         // kN with afterburner (jet), 0 = none
  EngineMount Mount = EngineMount::Wing;
  double Bpr = 5;        // bypass ratio
  double PropD = 2;      // propeller diameter (m)
  int Blades = 0;
};

struct MassDef { double Empty = 0, Mtow = 0, Mlw = 0, Fuel = 0, Payload = 0; };

struct SpeedDef {
  double Vs0 = 0, Vs1 = 0, Vr = 0, Vref = 0;   // KIAS
  double Vmo = 0, Mmo = 0, Vle = 0, Vfe = 0;
  double Cruise = 0, CruiseFt = 0, Ceiling = 0; // KTAS, ft, ft
  double V2 = 0;                                // 0 = derive
};

struct GearDef {
  GearKind T = GearKind::Tri;
  bool Retract = true;
  double Wheelbase = 0, Track = 0, Height = 0;  // 0 = derive
};

struct RotorDef { double D = 0; int Blades = 0; RotorTail Tail = RotorTail::Rotor; };

struct AircraftDef {
  std::string Id, Name, Maker, Icao;
  Category Cat = Category::Airliner;
  FdmKind Fdm = FdmKind::Fixed;
  FbwLaw Fbw = FbwLaw::None;
  CockpitKind Cockpit = CockpitKind::Airliner;
  // geometry (m, m^2, deg)
  double Length = 0, Span = 0, Area = 0, Height = 0, Diameter = 0;
  double Sweep = 0, Dihedral = 0;
  WingPos Wing = WingPos::Low;
  TailKind Tail = TailKind::Conv;
  bool Canard = false;
  EngineDef Eng;
  MassDef M;
  SpeedDef V;
  FlapSchedule Flaps = FlapSchedule::Boeing;
  GearDef Gear;
  RotorDef Rotor;
  bool Apu = false, Spoilers = false, Reversers = false;
  int Seats = 0;
  // published facts for the spec sheet
  std::string EngineName;
  double RangeKm = 0;
  int FirstFlight = 0;
};

struct FlapDetent { const char* Label; double Deg, DCL, DCLmax, DCD, DCm; };

const std::vector<FlapDetent>& FlapDetents(FlapSchedule s);

const std::vector<AircraftDef>& AllAircraft();
/** Returns the aircraft with this id, or the first entry if unknown. */
const AircraftDef& GetAircraft(const std::string& id);
const AircraftDef* FindAircraft(const std::string& id);

}  // namespace skyline
