// Aircraft database (exported from the original SkyLine TypeScript database; public-domain performance/geometry data).
#include "AircraftTypes.h"

namespace skyline {

const std::vector<FlapDetent>& FlapDetents(FlapSchedule s) {
  static const std::vector<FlapDetent> kBoeing = {{"UP", 0, 0, 0, 0, 0}, {"1", 1, 0.12, 0.45, 0.004, -0.005}, {"5", 5, 0.25, 0.6, 0.01, -0.01}, {"10", 10, 0.35, 0.72, 0.016, -0.015}, {"15", 15, 0.45, 0.82, 0.022, -0.02}, {"25", 25, 0.6, 0.95, 0.04, -0.03}, {"30", 30, 0.72, 1.05, 0.06, -0.035}, {"40", 40, 0.85, 1.12, 0.09, -0.04}};
  static const std::vector<FlapDetent> kBoeing747 = {{"UP", 0, 0, 0, 0, 0}, {"1", 1, 0.12, 0.45, 0.004, -0.005}, {"5", 5, 0.25, 0.6, 0.01, -0.01}, {"10", 10, 0.35, 0.72, 0.016, -0.015}, {"20", 20, 0.5, 0.88, 0.03, -0.025}, {"25", 25, 0.62, 0.97, 0.045, -0.03}, {"30", 30, 0.75, 1.08, 0.065, -0.035}};
  static const std::vector<FlapDetent> kAirbus = {{"0", 0, 0, 0, 0, 0}, {"1", 10, 0.1, 0.45, 0.005, -0.005}, {"1+F", 15, 0.25, 0.62, 0.012, -0.01}, {"2", 20, 0.4, 0.78, 0.022, -0.02}, {"3", 30, 0.58, 0.95, 0.04, -0.03}, {"FULL", 40, 0.78, 1.1, 0.075, -0.04}};
  static const std::vector<FlapDetent> kRegional = {{"0", 0, 0, 0, 0, 0}, {"5", 5, 0.2, 0.35, 0.008, -0.01}, {"10", 10, 0.32, 0.5, 0.015, -0.015}, {"15", 15, 0.45, 0.62, 0.025, -0.02}, {"35", 35, 0.75, 0.9, 0.075, -0.035}};
  static const std::vector<FlapDetent> kBizjet = {{"UP", 0, 0, 0, 0, 0}, {"15", 15, 0.3, 0.4, 0.015, -0.015}, {"35", 35, 0.65, 0.75, 0.065, -0.035}};
  static const std::vector<FlapDetent> kGA = {{"UP", 0, 0, 0, 0, 0}, {"10°", 10, 0.2, 0.22, 0.008, -0.02}, {"20°", 20, 0.38, 0.38, 0.022, -0.035}, {"30°", 30, 0.52, 0.5, 0.045, -0.05}};
  static const std::vector<FlapDetent> kSplit = {{"UP", 0, 0, 0, 0, 0}, {"DN", 50, 0.45, 0.4, 0.08, -0.05}};
  static const std::vector<FlapDetent> kFighter = {{"AUTO", 0, 0, 0, 0, 0}, {"HALF", 20, 0.25, 0.3, 0.02, -0.01}, {"FULL", 40, 0.4, 0.45, 0.04, -0.02}};
  static const std::vector<FlapDetent> kNone = {{"—", 0, 0, 0, 0, 0}};
  switch (s) {
    case FlapSchedule::Boeing: return kBoeing;
    case FlapSchedule::Boeing747: return kBoeing747;
    case FlapSchedule::Airbus: return kAirbus;
    case FlapSchedule::Regional: return kRegional;
    case FlapSchedule::Bizjet: return kBizjet;
    case FlapSchedule::GA: return kGA;
    case FlapSchedule::Split: return kSplit;
    case FlapSchedule::Fighter: return kFighter;
    case FlapSchedule::None: return kNone;
  }
  return kNone;
}

namespace {
std::vector<AircraftDef> BuildDb() {
  std::vector<AircraftDef> db;
  db.reserve(67);
  {
    AircraftDef d;
    d.Id = "a320neo"; d.Name = "A320neo"; d.Maker = "Airbus"; d.Icao = "A20N";
    d.Cat = Category::Airliner; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::Airbus; d.Cockpit = CockpitKind::Airliner;
    d.Length = 37.57; d.Span = 35.8; d.Area = 122.6; d.Height = 11.76; d.Diameter = 3.95; d.Sweep = 25; d.Dihedral = 5.5;
    d.Wing = WingPos::Low; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Fan; d.Eng.N = 2; d.Eng.P = 120.6; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Wing; d.Eng.Bpr = 11; d.Eng.PropD = 2; d.Eng.Blades = 0;
    d.M = {44300, 79000, 67400, 18730, 20000};
    d.V = {105, 145, 140, 132, 350, 0.82, 280, 177, 450, 37000, 39800, 145};
    d.Flaps = FlapSchedule::Airbus;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = true; d.Spoilers = true; d.Reversers = true; d.Seats = 180;
    d.EngineName = "CFM LEAP-1A / PW1100G-JM"; d.RangeKm = 6300; d.FirstFlight = 2014;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "a319"; d.Name = "A319ceo"; d.Maker = "Airbus"; d.Icao = "A319";
    d.Cat = Category::Airliner; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::Airbus; d.Cockpit = CockpitKind::Airliner;
    d.Length = 33.84; d.Span = 34.1; d.Area = 122.6; d.Height = 11.76; d.Diameter = 3.95; d.Sweep = 25; d.Dihedral = 5.5;
    d.Wing = WingPos::Low; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Fan; d.Eng.N = 2; d.Eng.P = 105; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Wing; d.Eng.Bpr = 5.7; d.Eng.PropD = 2; d.Eng.Blades = 0;
    d.M = {40800, 75500, 62500, 18700, 17000};
    d.V = {100, 140, 135, 125, 350, 0.82, 280, 177, 447, 37000, 39800, 0};
    d.Flaps = FlapSchedule::Airbus;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = true; d.Spoilers = true; d.Reversers = true; d.Seats = 144;
    d.EngineName = "CFM56-5B / IAE V2500"; d.RangeKm = 6950; d.FirstFlight = 1995;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "a321neo"; d.Name = "A321neo"; d.Maker = "Airbus"; d.Icao = "A21N";
    d.Cat = Category::Airliner; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::Airbus; d.Cockpit = CockpitKind::Airliner;
    d.Length = 44.51; d.Span = 35.8; d.Area = 128; d.Height = 11.76; d.Diameter = 3.95; d.Sweep = 25; d.Dihedral = 5.5;
    d.Wing = WingPos::Low; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Fan; d.Eng.N = 2; d.Eng.P = 147; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Wing; d.Eng.Bpr = 12.5; d.Eng.PropD = 2; d.Eng.Blades = 0;
    d.M = {50100, 97000, 79200, 25000, 25000};
    d.V = {112, 152, 150, 140, 350, 0.82, 280, 177, 450, 36000, 39800, 0};
    d.Flaps = FlapSchedule::Airbus;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = true; d.Spoilers = true; d.Reversers = true; d.Seats = 220;
    d.EngineName = "CFM LEAP-1A / PW1100G-JM"; d.RangeKm = 7400; d.FirstFlight = 2016;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "a220"; d.Name = "A220-300"; d.Maker = "Airbus"; d.Icao = "BCS3";
    d.Cat = Category::Airliner; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::Airbus; d.Cockpit = CockpitKind::Airliner;
    d.Length = 38.7; d.Span = 35.1; d.Area = 112.3; d.Height = 11.5; d.Diameter = 3.7; d.Sweep = 25; d.Dihedral = 5.5;
    d.Wing = WingPos::Low; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Fan; d.Eng.N = 2; d.Eng.P = 103.6; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Wing; d.Eng.Bpr = 12; d.Eng.PropD = 2; d.Eng.Blades = 0;
    d.M = {37080, 70900, 61000, 17200, 18700};
    d.V = {98, 138, 135, 125, 330, 0.82, 250, 170, 447, 37000, 41000, 0};
    d.Flaps = FlapSchedule::Regional;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = true; d.Spoilers = true; d.Reversers = true; d.Seats = 145;
    d.EngineName = "P&W PW1500G"; d.RangeKm = 6300; d.FirstFlight = 2015;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "b737-700"; d.Name = "737-700"; d.Maker = "Boeing"; d.Icao = "B737";
    d.Cat = Category::Airliner; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::None; d.Cockpit = CockpitKind::Airliner;
    d.Length = 33.6; d.Span = 35.8; d.Area = 124.6; d.Height = 12.5; d.Diameter = 3.76; d.Sweep = 25; d.Dihedral = 6;
    d.Wing = WingPos::Low; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Fan; d.Eng.N = 2; d.Eng.P = 116; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Wing; d.Eng.Bpr = 5.1; d.Eng.PropD = 2; d.Eng.Blades = 0;
    d.M = {37648, 70080, 58604, 20894, 17600};
    d.V = {102, 140, 140, 135, 340, 0.82, 270, 162, 453, 37000, 41000, 0};
    d.Flaps = FlapSchedule::Boeing;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = true; d.Spoilers = true; d.Reversers = true; d.Seats = 140;
    d.EngineName = "CFM56-7B"; d.RangeKm = 6370; d.FirstFlight = 1997;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "b737-800"; d.Name = "737-800"; d.Maker = "Boeing"; d.Icao = "B738";
    d.Cat = Category::Airliner; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::None; d.Cockpit = CockpitKind::Airliner;
    d.Length = 39.5; d.Span = 35.8; d.Area = 124.6; d.Height = 12.5; d.Diameter = 3.76; d.Sweep = 25; d.Dihedral = 6;
    d.Wing = WingPos::Low; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Fan; d.Eng.N = 2; d.Eng.P = 121.4; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Wing; d.Eng.Bpr = 5.1; d.Eng.PropD = 2; d.Eng.Blades = 0;
    d.M = {41413, 79016, 66361, 20894, 20000};
    d.V = {108, 148, 150, 145, 340, 0.82, 270, 162, 453, 37000, 41000, 0};
    d.Flaps = FlapSchedule::Boeing;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = true; d.Spoilers = true; d.Reversers = true; d.Seats = 189;
    d.EngineName = "CFM56-7B"; d.RangeKm = 5440; d.FirstFlight = 1997;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "b737max8"; d.Name = "737 MAX 8"; d.Maker = "Boeing"; d.Icao = "B38M";
    d.Cat = Category::Airliner; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::None; d.Cockpit = CockpitKind::Airliner;
    d.Length = 39.52; d.Span = 35.9; d.Area = 127; d.Height = 12.3; d.Diameter = 3.76; d.Sweep = 25; d.Dihedral = 6;
    d.Wing = WingPos::Low; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Fan; d.Eng.N = 2; d.Eng.P = 130; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Wing; d.Eng.Bpr = 9; d.Eng.PropD = 2; d.Eng.Blades = 0;
    d.M = {45070, 82200, 69300, 20730, 20800};
    d.V = {106, 146, 150, 142, 340, 0.82, 270, 162, 453, 37000, 41000, 0};
    d.Flaps = FlapSchedule::Boeing;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = true; d.Spoilers = true; d.Reversers = true; d.Seats = 189;
    d.EngineName = "CFM LEAP-1B"; d.RangeKm = 6570; d.FirstFlight = 2016;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "b757"; d.Name = "757-200"; d.Maker = "Boeing"; d.Icao = "B752";
    d.Cat = Category::Airliner; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::None; d.Cockpit = CockpitKind::Airliner;
    d.Length = 47.3; d.Span = 38.05; d.Area = 185.25; d.Height = 13.6; d.Diameter = 3.76; d.Sweep = 25; d.Dihedral = 5.5;
    d.Wing = WingPos::Low; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Fan; d.Eng.N = 2; d.Eng.P = 193; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Wing; d.Eng.Bpr = 4.1; d.Eng.PropD = 2; d.Eng.Blades = 0;
    d.M = {58390, 115680, 89800, 33800, 25000};
    d.V = {100, 140, 145, 132, 350, 0.86, 270, 162, 460, 37000, 42000, 0};
    d.Flaps = FlapSchedule::Boeing;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = true; d.Spoilers = true; d.Reversers = true; d.Seats = 200;
    d.EngineName = "RR RB211-535 / P&W PW2000"; d.RangeKm = 7250; d.FirstFlight = 1982;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "c919"; d.Name = "C919"; d.Maker = "COMAC"; d.Icao = "C919";
    d.Cat = Category::Airliner; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::Airbus; d.Cockpit = CockpitKind::Airliner;
    d.Length = 38.9; d.Span = 35.8; d.Area = 129.2; d.Height = 11.95; d.Diameter = 3.96; d.Sweep = 25; d.Dihedral = 5.5;
    d.Wing = WingPos::Low; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Fan; d.Eng.N = 2; d.Eng.P = 129; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Wing; d.Eng.Bpr = 11; d.Eng.PropD = 2; d.Eng.Blades = 0;
    d.M = {42100, 72500, 66600, 19560, 18900};
    d.V = {104, 142, 140, 132, 340, 0.82, 270, 177, 450, 37000, 39800, 0};
    d.Flaps = FlapSchedule::Airbus;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = true; d.Spoilers = true; d.Reversers = true; d.Seats = 168;
    d.EngineName = "CFM LEAP-1C"; d.RangeKm = 5555; d.FirstFlight = 2017;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "e175"; d.Name = "E175"; d.Maker = "Embraer"; d.Icao = "E175";
    d.Cat = Category::Regional; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::None; d.Cockpit = CockpitKind::Airliner;
    d.Length = 31.68; d.Span = 26; d.Area = 72.7; d.Height = 9.86; d.Diameter = 3.01; d.Sweep = 23; d.Dihedral = 5.5;
    d.Wing = WingPos::Low; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Fan; d.Eng.N = 2; d.Eng.P = 64.5; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Wing; d.Eng.Bpr = 5; d.Eng.PropD = 2; d.Eng.Blades = 0;
    d.M = {21800, 38790, 34000, 9400, 10000};
    d.V = {98, 132, 130, 125, 320, 0.82, 250, 165, 447, 37000, 41000, 0};
    d.Flaps = FlapSchedule::Regional;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = true; d.Spoilers = true; d.Reversers = true; d.Seats = 78;
    d.EngineName = "GE CF34-8E"; d.RangeKm = 3700; d.FirstFlight = 2003;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "e195e2"; d.Name = "E195-E2"; d.Maker = "Embraer"; d.Icao = "E295";
    d.Cat = Category::Regional; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::Boeing; d.Cockpit = CockpitKind::Airliner;
    d.Length = 41.5; d.Span = 35.1; d.Area = 103; d.Height = 10.9; d.Diameter = 3.35; d.Sweep = 25; d.Dihedral = 5.5;
    d.Wing = WingPos::Low; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Fan; d.Eng.N = 2; d.Eng.P = 100; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Wing; d.Eng.Bpr = 12; d.Eng.PropD = 2; d.Eng.Blades = 0;
    d.M = {35900, 61500, 54000, 13690, 16150};
    d.V = {102, 138, 135, 128, 320, 0.82, 250, 165, 450, 37000, 41000, 0};
    d.Flaps = FlapSchedule::Regional;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = true; d.Spoilers = true; d.Reversers = true; d.Seats = 132;
    d.EngineName = "P&W PW1900G"; d.RangeKm = 4800; d.FirstFlight = 2017;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "crj900"; d.Name = "CRJ900"; d.Maker = "Bombardier"; d.Icao = "CRJ9";
    d.Cat = Category::Regional; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::None; d.Cockpit = CockpitKind::Airliner;
    d.Length = 36.2; d.Span = 24.9; d.Area = 70.6; d.Height = 7.5; d.Diameter = 2.69; d.Sweep = 26; d.Dihedral = 5.5;
    d.Wing = WingPos::Low; d.Tail = TailKind::T; d.Canard = false;
    d.Eng.T = EngineType::Fan; d.Eng.N = 2; d.Eng.P = 64.5; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Aft; d.Eng.Bpr = 5; d.Eng.PropD = 2; d.Eng.Blades = 0;
    d.M = {21845, 38330, 33340, 8800, 10300};
    d.V = {105, 140, 140, 135, 335, 0.85, 220, 170, 450, 37000, 41000, 0};
    d.Flaps = FlapSchedule::Regional;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = true; d.Spoilers = true; d.Reversers = true; d.Seats = 90;
    d.EngineName = "GE CF34-8C5"; d.RangeKm = 2950; d.FirstFlight = 2001;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "q400"; d.Name = "Dash 8-400"; d.Maker = "De Havilland Canada"; d.Icao = "DH8D";
    d.Cat = Category::Regional; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::None; d.Cockpit = CockpitKind::Airliner;
    d.Length = 32.8; d.Span = 28.4; d.Area = 63.1; d.Height = 8.3; d.Diameter = 2.69; d.Sweep = 0; d.Dihedral = 2.5;
    d.Wing = WingPos::High; d.Tail = TailKind::T; d.Canard = false;
    d.Eng.T = EngineType::TProp; d.Eng.N = 2; d.Eng.P = 3781; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Nacelle; d.Eng.Bpr = 5; d.Eng.PropD = 4.1; d.Eng.Blades = 6;
    d.M = {17185, 30481, 28123, 5318, 8670};
    d.V = {85, 110, 115, 115, 286, 0.6, 200, 148, 360, 25000, 27000, 0};
    d.Flaps = FlapSchedule::Regional;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = false; d.Spoilers = true; d.Reversers = true; d.Seats = 78;
    d.EngineName = "P&W Canada PW150A"; d.RangeKm = 2040; d.FirstFlight = 1998;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "atr72"; d.Name = "ATR 72-600"; d.Maker = "ATR"; d.Icao = "AT76";
    d.Cat = Category::Regional; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::None; d.Cockpit = CockpitKind::Airliner;
    d.Length = 27.17; d.Span = 27.05; d.Area = 61; d.Height = 7.65; d.Diameter = 2.57; d.Sweep = 0; d.Dihedral = 2;
    d.Wing = WingPos::High; d.Tail = TailKind::T; d.Canard = false;
    d.Eng.T = EngineType::TProp; d.Eng.N = 2; d.Eng.P = 2051; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Nacelle; d.Eng.Bpr = 5; d.Eng.PropD = 3.93; d.Eng.Blades = 6;
    d.M = {13311, 23000, 22350, 5000, 7500};
    d.V = {80, 100, 110, 110, 250, 0.55, 180, 150, 275, 17000, 25000, 0};
    d.Flaps = FlapSchedule::Regional;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = false; d.Spoilers = false; d.Reversers = true; d.Seats = 72;
    d.EngineName = "P&W Canada PW127M"; d.RangeKm = 1530; d.FirstFlight = 2009;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "a330-900"; d.Name = "A330-900neo"; d.Maker = "Airbus"; d.Icao = "A339";
    d.Cat = Category::Widebody; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::Airbus; d.Cockpit = CockpitKind::Airliner;
    d.Length = 63.66; d.Span = 64; d.Area = 465; d.Height = 16.79; d.Diameter = 5.64; d.Sweep = 30; d.Dihedral = 5.5;
    d.Wing = WingPos::Low; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Fan; d.Eng.N = 2; d.Eng.P = 320; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Wing; d.Eng.Bpr = 10; d.Eng.PropD = 2; d.Eng.Blades = 0;
    d.M = {137000, 251000, 191000, 111000, 45600};
    d.V = {108, 150, 150, 140, 330, 0.86, 250, 180, 470, 39000, 41450, 0};
    d.Flaps = FlapSchedule::Airbus;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = true; d.Spoilers = true; d.Reversers = true; d.Seats = 287;
    d.EngineName = "RR Trent 7000"; d.RangeKm = 13330; d.FirstFlight = 2017;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "a340-600"; d.Name = "A340-600"; d.Maker = "Airbus"; d.Icao = "A346";
    d.Cat = Category::Widebody; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::Airbus; d.Cockpit = CockpitKind::Airliner;
    d.Length = 75.36; d.Span = 63.45; d.Area = 439; d.Height = 17.22; d.Diameter = 5.64; d.Sweep = 30; d.Dihedral = 5.5;
    d.Wing = WingPos::Low; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Fan; d.Eng.N = 4; d.Eng.P = 249; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Wing4; d.Eng.Bpr = 7.5; d.Eng.PropD = 2; d.Eng.Blades = 0;
    d.M = {177800, 380000, 265000, 155000, 66000};
    d.V = {118, 160, 165, 150, 330, 0.86, 250, 180, 475, 37000, 41450, 0};
    d.Flaps = FlapSchedule::Airbus;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = true; d.Spoilers = true; d.Reversers = true; d.Seats = 370;
    d.EngineName = "RR Trent 556"; d.RangeKm = 14450; d.FirstFlight = 2001;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "a350-900"; d.Name = "A350-900"; d.Maker = "Airbus"; d.Icao = "A359";
    d.Cat = Category::Widebody; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::Airbus; d.Cockpit = CockpitKind::Airliner;
    d.Length = 66.8; d.Span = 64.75; d.Area = 442; d.Height = 17.05; d.Diameter = 5.96; d.Sweep = 31.9; d.Dihedral = 5.5;
    d.Wing = WingPos::Low; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Fan; d.Eng.N = 2; d.Eng.P = 374; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Wing; d.Eng.Bpr = 9.3; d.Eng.PropD = 2; d.Eng.Blades = 0;
    d.M = {142400, 283000, 207000, 110500, 53300};
    d.V = {108, 150, 155, 140, 340, 0.89, 250, 186, 488, 41000, 43100, 0};
    d.Flaps = FlapSchedule::Airbus;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = true; d.Spoilers = true; d.Reversers = true; d.Seats = 325;
    d.EngineName = "RR Trent XWB-84"; d.RangeKm = 15000; d.FirstFlight = 2013;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "a350-1000"; d.Name = "A350-1000"; d.Maker = "Airbus"; d.Icao = "A35K";
    d.Cat = Category::Widebody; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::Airbus; d.Cockpit = CockpitKind::Airliner;
    d.Length = 73.79; d.Span = 64.75; d.Area = 464; d.Height = 17.08; d.Diameter = 5.96; d.Sweep = 31.9; d.Dihedral = 5.5;
    d.Wing = WingPos::Low; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Fan; d.Eng.N = 2; d.Eng.P = 432; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Wing; d.Eng.Bpr = 8; d.Eng.PropD = 2; d.Eng.Blades = 0;
    d.M = {155000, 319000, 236000, 124000, 68000};
    d.V = {112, 156, 160, 145, 340, 0.89, 250, 186, 488, 39000, 41450, 0};
    d.Flaps = FlapSchedule::Airbus;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = true; d.Spoilers = true; d.Reversers = true; d.Seats = 366;
    d.EngineName = "RR Trent XWB-97"; d.RangeKm = 16100; d.FirstFlight = 2016;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "a380"; d.Name = "A380-800"; d.Maker = "Airbus"; d.Icao = "A388";
    d.Cat = Category::Widebody; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::Airbus; d.Cockpit = CockpitKind::Airliner;
    d.Length = 72.72; d.Span = 79.75; d.Area = 845; d.Height = 24.09; d.Diameter = 7.14; d.Sweep = 33.5; d.Dihedral = 5.5;
    d.Wing = WingPos::Low; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Fan; d.Eng.N = 4; d.Eng.P = 311; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Wing4; d.Eng.Bpr = 8.5; d.Eng.PropD = 2; d.Eng.Blades = 0;
    d.M = {277000, 575000, 394000, 254000, 84000};
    d.V = {108, 150, 160, 138, 340, 0.89, 250, 177, 490, 39000, 43000, 0};
    d.Flaps = FlapSchedule::Airbus;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = true; d.Spoilers = true; d.Reversers = true; d.Seats = 555;
    d.EngineName = "RR Trent 900 / EA GP7200"; d.RangeKm = 15000; d.FirstFlight = 2005;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "b747-400"; d.Name = "747-400"; d.Maker = "Boeing"; d.Icao = "B744";
    d.Cat = Category::Widebody; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::None; d.Cockpit = CockpitKind::Airliner;
    d.Length = 70.6; d.Span = 64.4; d.Area = 525; d.Height = 19.4; d.Diameter = 6.5; d.Sweep = 37.5; d.Dihedral = 5.5;
    d.Wing = WingPos::Low; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Fan; d.Eng.N = 4; d.Eng.P = 252; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Wing4; d.Eng.Bpr = 5; d.Eng.PropD = 2; d.Eng.Blades = 0;
    d.M = {178756, 396890, 295742, 173000, 67000};
    d.V = {115, 160, 165, 150, 365, 0.92, 270, 180, 490, 35000, 45100, 0};
    d.Flaps = FlapSchedule::Boeing747;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = true; d.Spoilers = true; d.Reversers = true; d.Seats = 416;
    d.EngineName = "P&W PW4000 / GE CF6-80C2 / RR RB211-524"; d.RangeKm = 13450; d.FirstFlight = 1988;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "b747-8"; d.Name = "747-8 Intercontinental"; d.Maker = "Boeing"; d.Icao = "B748";
    d.Cat = Category::Widebody; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::None; d.Cockpit = CockpitKind::Airliner;
    d.Length = 76.3; d.Span = 68.4; d.Area = 554; d.Height = 19.4; d.Diameter = 6.5; d.Sweep = 37.5; d.Dihedral = 5.5;
    d.Wing = WingPos::Low; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Fan; d.Eng.N = 4; d.Eng.P = 296; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Wing4; d.Eng.Bpr = 8; d.Eng.PropD = 2; d.Eng.Blades = 0;
    d.M = {220100, 447700, 312100, 193000, 75000};
    d.V = {118, 165, 170, 155, 365, 0.9, 270, 180, 493, 37000, 43100, 0};
    d.Flaps = FlapSchedule::Boeing747;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = true; d.Spoilers = true; d.Reversers = true; d.Seats = 467;
    d.EngineName = "GE GEnx-2B67"; d.RangeKm = 14320; d.FirstFlight = 2011;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "b767-300"; d.Name = "767-300ER"; d.Maker = "Boeing"; d.Icao = "B763";
    d.Cat = Category::Widebody; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::None; d.Cockpit = CockpitKind::Airliner;
    d.Length = 54.94; d.Span = 47.57; d.Area = 283.3; d.Height = 15.85; d.Diameter = 5.03; d.Sweep = 31; d.Dihedral = 5.5;
    d.Wing = WingPos::Low; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Fan; d.Eng.N = 2; d.Eng.P = 282; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Wing; d.Eng.Bpr = 5; d.Eng.PropD = 2; d.Eng.Blades = 0;
    d.M = {90000, 186880, 136080, 73400, 40000};
    d.V = {105, 150, 155, 140, 360, 0.86, 270, 170, 459, 37000, 43100, 0};
    d.Flaps = FlapSchedule::Boeing;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = true; d.Spoilers = true; d.Reversers = true; d.Seats = 269;
    d.EngineName = "P&W PW4000 / GE CF6-80C2"; d.RangeKm = 11070; d.FirstFlight = 1986;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "b777-200er"; d.Name = "777-200ER"; d.Maker = "Boeing"; d.Icao = "B772";
    d.Cat = Category::Widebody; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::Boeing; d.Cockpit = CockpitKind::Airliner;
    d.Length = 63.7; d.Span = 60.9; d.Area = 427.8; d.Height = 18.5; d.Diameter = 6.19; d.Sweep = 31.6; d.Dihedral = 5.5;
    d.Wing = WingPos::Low; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Fan; d.Eng.N = 2; d.Eng.P = 400; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Wing; d.Eng.Bpr = 8.4; d.Eng.PropD = 2; d.Eng.Blades = 0;
    d.M = {138100, 297550, 213180, 137000, 55000};
    d.V = {105, 152, 160, 140, 330, 0.89, 270, 180, 482, 37000, 43100, 0};
    d.Flaps = FlapSchedule::Boeing;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = true; d.Spoilers = true; d.Reversers = true; d.Seats = 313;
    d.EngineName = "GE90-94B / PW4090 / Trent 895"; d.RangeKm = 13080; d.FirstFlight = 1996;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "b777-300er"; d.Name = "777-300ER"; d.Maker = "Boeing"; d.Icao = "B77W";
    d.Cat = Category::Widebody; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::Boeing; d.Cockpit = CockpitKind::Airliner;
    d.Length = 73.9; d.Span = 64.8; d.Area = 436.8; d.Height = 18.5; d.Diameter = 6.19; d.Sweep = 31.6; d.Dihedral = 5.5;
    d.Wing = WingPos::Low; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Fan; d.Eng.N = 2; d.Eng.P = 513; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Wing; d.Eng.Bpr = 9; d.Eng.PropD = 2; d.Eng.Blades = 0;
    d.M = {167800, 351500, 251300, 145500, 69000};
    d.V = {112, 162, 170, 150, 330, 0.89, 270, 180, 490, 37000, 43100, 0};
    d.Flaps = FlapSchedule::Boeing;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = true; d.Spoilers = true; d.Reversers = true; d.Seats = 396;
    d.EngineName = "GE90-115B"; d.RangeKm = 13650; d.FirstFlight = 2003;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "b787-8"; d.Name = "787-8 Dreamliner"; d.Maker = "Boeing"; d.Icao = "B788";
    d.Cat = Category::Widebody; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::Boeing; d.Cockpit = CockpitKind::Airliner;
    d.Length = 56.72; d.Span = 60.12; d.Area = 360; d.Height = 16.92; d.Diameter = 5.77; d.Sweep = 32.2; d.Dihedral = 7;
    d.Wing = WingPos::Low; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Fan; d.Eng.N = 2; d.Eng.P = 280; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Wing; d.Eng.Bpr = 10; d.Eng.PropD = 2; d.Eng.Blades = 0;
    d.M = {119950, 227930, 172365, 101300, 43000};
    d.V = {105, 150, 155, 140, 340, 0.9, 270, 180, 488, 41000, 43100, 0};
    d.Flaps = FlapSchedule::Boeing;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = true; d.Spoilers = true; d.Reversers = true; d.Seats = 248;
    d.EngineName = "GE GEnx-1B / RR Trent 1000"; d.RangeKm = 13530; d.FirstFlight = 2009;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "b787-9"; d.Name = "787-9 Dreamliner"; d.Maker = "Boeing"; d.Icao = "B789";
    d.Cat = Category::Widebody; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::Boeing; d.Cockpit = CockpitKind::Airliner;
    d.Length = 62.81; d.Span = 60.12; d.Area = 360; d.Height = 17.02; d.Diameter = 5.77; d.Sweep = 32.2; d.Dihedral = 7;
    d.Wing = WingPos::Low; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Fan; d.Eng.N = 2; d.Eng.P = 320; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Wing; d.Eng.Bpr = 10; d.Eng.PropD = 2; d.Eng.Blades = 0;
    d.M = {128850, 254011, 192777, 101400, 53000};
    d.V = {108, 155, 160, 145, 340, 0.9, 270, 180, 488, 41000, 43100, 0};
    d.Flaps = FlapSchedule::Boeing;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = true; d.Spoilers = true; d.Reversers = true; d.Seats = 296;
    d.EngineName = "GE GEnx-1B / RR Trent 1000"; d.RangeKm = 14010; d.FirstFlight = 2013;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "b787-10"; d.Name = "787-10 Dreamliner"; d.Maker = "Boeing"; d.Icao = "B78X";
    d.Cat = Category::Widebody; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::Boeing; d.Cockpit = CockpitKind::Airliner;
    d.Length = 68.28; d.Span = 60.12; d.Area = 377; d.Height = 17.02; d.Diameter = 5.77; d.Sweep = 32.2; d.Dihedral = 7;
    d.Wing = WingPos::Low; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Fan; d.Eng.N = 2; d.Eng.P = 340; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Wing; d.Eng.Bpr = 10; d.Eng.PropD = 2; d.Eng.Blades = 0;
    d.M = {135500, 254011, 201848, 101400, 57000};
    d.V = {110, 158, 165, 150, 340, 0.9, 270, 180, 488, 39000, 41100, 0};
    d.Flaps = FlapSchedule::Boeing;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = true; d.Spoilers = true; d.Reversers = true; d.Seats = 336;
    d.EngineName = "GE GEnx-1B / RR Trent 1000"; d.RangeKm = 11730; d.FirstFlight = 2017;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "md11"; d.Name = "MD-11"; d.Maker = "McDonnell Douglas"; d.Icao = "MD11";
    d.Cat = Category::Widebody; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::None; d.Cockpit = CockpitKind::Airliner;
    d.Length = 61.6; d.Span = 51.97; d.Area = 338.9; d.Height = 17.6; d.Diameter = 6.02; d.Sweep = 35; d.Dihedral = 5.5;
    d.Wing = WingPos::Low; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Fan; d.Eng.N = 3; d.Eng.P = 274; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Tri; d.Eng.Bpr = 5; d.Eng.PropD = 2; d.Eng.Blades = 0;
    d.M = {128800, 286000, 195000, 117000, 51000};
    d.V = {120, 165, 170, 160, 365, 0.87, 260, 180, 473, 35000, 43000, 0};
    d.Flaps = FlapSchedule::Boeing;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = true; d.Spoilers = true; d.Reversers = true; d.Seats = 298;
    d.EngineName = "GE CF6-80C2 / P&W PW4460"; d.RangeKm = 12450; d.FirstFlight = 1990;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "concorde"; d.Name = "Concorde"; d.Maker = "Aérospatiale/BAC"; d.Icao = "CONC";
    d.Cat = Category::Widebody; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::None; d.Cockpit = CockpitKind::Airliner;
    d.Length = 61.66; d.Span = 25.6; d.Area = 358.25; d.Height = 12.2; d.Diameter = 2.88; d.Sweep = 55; d.Dihedral = 0;
    d.Wing = WingPos::Low; d.Tail = TailKind::Delta; d.Canard = false;
    d.Eng.T = EngineType::Jet; d.Eng.N = 4; d.Eng.P = 140; d.Eng.Ab = 169; d.Eng.Mount = EngineMount::Nacelle4; d.Eng.Bpr = 0.4; d.Eng.PropD = 2; d.Eng.Blades = 0;
    d.M = {78700, 185070, 111130, 95680, 12700};
    d.V = {135, 140, 195, 162, 530, 2.04, 270, 270, 1170, 55000, 60000, 0};
    d.Flaps = FlapSchedule::None;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = false; d.Spoilers = false; d.Reversers = true; d.Seats = 100;
    d.EngineName = "RR/SNECMA Olympus 593 Mk 610"; d.RangeKm = 7220; d.FirstFlight = 1969;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "cj4"; d.Name = "Citation CJ4"; d.Maker = "Cessna"; d.Icao = "C25C";
    d.Cat = Category::Bizjet; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::None; d.Cockpit = CockpitKind::Airliner;
    d.Length = 16.26; d.Span = 15.49; d.Area = 30.66; d.Height = 4.67; d.Diameter = 1.6; d.Sweep = 12.5; d.Dihedral = 5.5;
    d.Wing = WingPos::Low; d.Tail = TailKind::T; d.Canard = false;
    d.Eng.T = EngineType::Fan; d.Eng.N = 2; d.Eng.P = 16; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Aft; d.Eng.Bpr = 4.1; d.Eng.PropD = 2; d.Eng.Blades = 0;
    d.M = {5000, 7761, 7103, 2640, 800};
    d.V = {88, 100, 105, 110, 305, 0.77, 200, 200, 451, 43000, 45000, 0};
    d.Flaps = FlapSchedule::Bizjet;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = false; d.Spoilers = true; d.Reversers = true; d.Seats = 10;
    d.EngineName = "Williams FJ44-4A"; d.RangeKm = 3700; d.FirstFlight = 2008;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "longitude"; d.Name = "Citation Longitude"; d.Maker = "Cessna"; d.Icao = "C700";
    d.Cat = Category::Bizjet; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::None; d.Cockpit = CockpitKind::Airliner;
    d.Length = 22.3; d.Span = 20.9; d.Area = 49.9; d.Height = 5.9; d.Diameter = 2; d.Sweep = 27; d.Dihedral = 5.5;
    d.Wing = WingPos::Low; d.Tail = TailKind::T; d.Canard = false;
    d.Eng.T = EngineType::Fan; d.Eng.N = 2; d.Eng.P = 32; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Aft; d.Eng.Bpr = 4.4; d.Eng.PropD = 2; d.Eng.Blades = 0;
    d.M = {10660, 17960, 15600, 6480, 1500};
    d.V = {95, 110, 115, 115, 325, 0.84, 250, 200, 476, 43000, 45000, 0};
    d.Flaps = FlapSchedule::Bizjet;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = true; d.Spoilers = true; d.Reversers = true; d.Seats = 12;
    d.EngineName = "Honeywell HTF7700L"; d.RangeKm = 6480; d.FirstFlight = 2016;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "hondajet"; d.Name = "HondaJet Elite II"; d.Maker = "Honda"; d.Icao = "HDJT";
    d.Cat = Category::Bizjet; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::None; d.Cockpit = CockpitKind::Airliner;
    d.Length = 12.99; d.Span = 12.12; d.Area = 16.7; d.Height = 4.54; d.Diameter = 1.5; d.Sweep = 6; d.Dihedral = 5.5;
    d.Wing = WingPos::Low; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Fan; d.Eng.N = 2; d.Eng.P = 9.1; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Top; d.Eng.Bpr = 2.9; d.Eng.PropD = 2; d.Eng.Blades = 0;
    d.M = {3300, 4853, 4600, 1300, 500};
    d.V = {85, 95, 100, 105, 270, 0.72, 200, 180, 422, 41000, 43000, 0};
    d.Flaps = FlapSchedule::Bizjet;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = false; d.Spoilers = true; d.Reversers = false; d.Seats = 7;
    d.EngineName = "GE Honda HF120"; d.RangeKm = 2660; d.FirstFlight = 2010;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "phenom300"; d.Name = "Phenom 300E"; d.Maker = "Embraer"; d.Icao = "E55P";
    d.Cat = Category::Bizjet; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::None; d.Cockpit = CockpitKind::Airliner;
    d.Length = 15.9; d.Span = 16.2; d.Area = 28.5; d.Height = 5.1; d.Diameter = 1.7; d.Sweep = 26; d.Dihedral = 5.5;
    d.Wing = WingPos::Low; d.Tail = TailKind::T; d.Canard = false;
    d.Eng.T = EngineType::Fan; d.Eng.N = 2; d.Eng.P = 15; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Aft; d.Eng.Bpr = 4.1; d.Eng.PropD = 2; d.Eng.Blades = 0;
    d.M = {5300, 8150, 7650, 2430, 1000};
    d.V = {88, 105, 105, 110, 320, 0.8, 250, 180, 464, 43000, 45000, 0};
    d.Flaps = FlapSchedule::Bizjet;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = false; d.Spoilers = true; d.Reversers = false; d.Seats = 10;
    d.EngineName = "P&W Canada PW535E1"; d.RangeKm = 3720; d.FirstFlight = 2008;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "g650"; d.Name = "Gulfstream G650ER"; d.Maker = "Gulfstream"; d.Icao = "GLF6";
    d.Cat = Category::Bizjet; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::Boeing; d.Cockpit = CockpitKind::Airliner;
    d.Length = 30.4; d.Span = 30.4; d.Area = 119.2; d.Height = 7.8; d.Diameter = 2.6; d.Sweep = 36; d.Dihedral = 5.5;
    d.Wing = WingPos::Low; d.Tail = TailKind::T; d.Canard = false;
    d.Eng.T = EngineType::Fan; d.Eng.N = 2; d.Eng.P = 75.2; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Aft; d.Eng.Bpr = 4.4; d.Eng.PropD = 2; d.Eng.Blades = 0;
    d.M = {24500, 47600, 37876, 20000, 2900};
    d.V = {98, 118, 125, 120, 340, 0.925, 225, 200, 488, 45000, 51000, 0};
    d.Flaps = FlapSchedule::Bizjet;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = true; d.Spoilers = true; d.Reversers = true; d.Seats = 16;
    d.EngineName = "RR BR725"; d.RangeKm = 13890; d.FirstFlight = 2009;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "global7500"; d.Name = "Global 7500"; d.Maker = "Bombardier"; d.Icao = "GL7T";
    d.Cat = Category::Bizjet; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::Boeing; d.Cockpit = CockpitKind::Airliner;
    d.Length = 33.8; d.Span = 31.7; d.Area = 99; d.Height = 8.2; d.Diameter = 2.69; d.Sweep = 33; d.Dihedral = 5.5;
    d.Wing = WingPos::Low; d.Tail = TailKind::T; d.Canard = false;
    d.Eng.T = EngineType::Fan; d.Eng.N = 2; d.Eng.P = 82.3; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Aft; d.Eng.Bpr = 5.6; d.Eng.PropD = 2; d.Eng.Blades = 0;
    d.M = {25600, 52300, 39000, 20500, 2600};
    d.V = {98, 120, 125, 115, 340, 0.925, 250, 210, 488, 45000, 51000, 0};
    d.Flaps = FlapSchedule::Bizjet;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = true; d.Spoilers = true; d.Reversers = true; d.Seats = 19;
    d.EngineName = "GE Passport"; d.RangeKm = 14260; d.FirstFlight = 2016;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "kingair350"; d.Name = "King Air 350i"; d.Maker = "Beechcraft"; d.Icao = "B350";
    d.Cat = Category::Turboprop; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::None; d.Cockpit = CockpitKind::G1000;
    d.Length = 14.22; d.Span = 17.65; d.Area = 28.8; d.Height = 4.37; d.Diameter = 1.45; d.Sweep = 0; d.Dihedral = 5;
    d.Wing = WingPos::Low; d.Tail = TailKind::T; d.Canard = false;
    d.Eng.T = EngineType::TProp; d.Eng.N = 2; d.Eng.P = 783; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Nacelle; d.Eng.Bpr = 5; d.Eng.PropD = 2.67; d.Eng.Blades = 4;
    d.M = {4100, 6804, 6804, 1640, 1000};
    d.V = {81, 92, 94, 100, 263, 0.58, 181, 184, 312, 25000, 35000, 0};
    d.Flaps = FlapSchedule::GA;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = false; d.Spoilers = false; d.Reversers = true; d.Seats = 11;
    d.EngineName = "P&W Canada PT6A-60A"; d.RangeKm = 3340; d.FirstFlight = 1988;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "tbm940"; d.Name = "TBM 940"; d.Maker = "Daher"; d.Icao = "TBM9";
    d.Cat = Category::Turboprop; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::None; d.Cockpit = CockpitKind::G1000;
    d.Length = 10.73; d.Span = 12.83; d.Area = 18; d.Height = 4.35; d.Diameter = 1.3; d.Sweep = 0; d.Dihedral = 5;
    d.Wing = WingPos::Low; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::TProp; d.Eng.N = 1; d.Eng.P = 634; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Nose; d.Eng.Bpr = 5; d.Eng.PropD = 2.31; d.Eng.Blades = 5;
    d.M = {2097, 3354, 3186, 856, 400};
    d.V = {61, 72, 85, 85, 266, 0.52, 178, 178, 330, 28000, 31000, 0};
    d.Flaps = FlapSchedule::GA;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = false; d.Spoilers = false; d.Reversers = false; d.Seats = 6;
    d.EngineName = "P&W Canada PT6A-66D"; d.RangeKm = 2730; d.FirstFlight = 2019;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "pc12"; d.Name = "PC-12 NGX"; d.Maker = "Pilatus"; d.Icao = "PC12";
    d.Cat = Category::Turboprop; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::None; d.Cockpit = CockpitKind::G1000;
    d.Length = 14.4; d.Span = 16.28; d.Area = 25.8; d.Height = 4.26; d.Diameter = 1.52; d.Sweep = 0; d.Dihedral = 5;
    d.Wing = WingPos::Low; d.Tail = TailKind::T; d.Canard = false;
    d.Eng.T = EngineType::TProp; d.Eng.N = 1; d.Eng.P = 900; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Nose; d.Eng.Bpr = 5; d.Eng.PropD = 2.67; d.Eng.Blades = 5;
    d.M = {3000, 4740, 4500, 1200, 1000};
    d.V = {67, 88, 85, 85, 240, 0.48, 180, 163, 290, 28000, 30000, 0};
    d.Flaps = FlapSchedule::GA;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = false; d.Spoilers = false; d.Reversers = false; d.Seats = 9;
    d.EngineName = "P&W Canada PT6E-67XP"; d.RangeKm = 3420; d.FirstFlight = 2019;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "c208"; d.Name = "Grand Caravan EX"; d.Maker = "Cessna"; d.Icao = "C208";
    d.Cat = Category::Turboprop; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::None; d.Cockpit = CockpitKind::G1000;
    d.Length = 12.67; d.Span = 15.87; d.Area = 25.96; d.Height = 4.53; d.Diameter = 1.65; d.Sweep = 0; d.Dihedral = 3;
    d.Wing = WingPos::High; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::TProp; d.Eng.N = 1; d.Eng.P = 649; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Nose; d.Eng.Bpr = 5; d.Eng.PropD = 2.69; d.Eng.Blades = 3;
    d.M = {2250, 3995, 3856, 1009, 1400};
    d.V = {61, 78, 70, 80, 175, 0.4, 175, 125, 185, 10000, 25000, 0};
    d.Flaps = FlapSchedule::GA;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = false; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = false; d.Spoilers = false; d.Reversers = false; d.Seats = 14;
    d.EngineName = "P&W Canada PT6A-140"; d.RangeKm = 1690; d.FirstFlight = 2012;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "c130j"; d.Name = "C-130J Super Hercules"; d.Maker = "Lockheed Martin"; d.Icao = "C30J";
    d.Cat = Category::Military; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::None; d.Cockpit = CockpitKind::Airliner;
    d.Length = 29.8; d.Span = 40.4; d.Area = 162.1; d.Height = 11.84; d.Diameter = 4.3; d.Sweep = 0; d.Dihedral = 2.5;
    d.Wing = WingPos::High; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::TProp; d.Eng.N = 4; d.Eng.P = 3458; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Nacelle4; d.Eng.Bpr = 5; d.Eng.PropD = 4.11; d.Eng.Blades = 6;
    d.M = {34400, 70300, 58967, 20800, 19000};
    d.V = {90, 110, 110, 110, 300, 0.59, 170, 145, 348, 28000, 28000, 0};
    d.Flaps = FlapSchedule::Regional;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = true; d.Spoilers = false; d.Reversers = true; d.Seats = 92;
    d.EngineName = "RR AE 2100D3"; d.RangeKm = 3300; d.FirstFlight = 1996;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "c152"; d.Name = "Cessna 152"; d.Maker = "Cessna"; d.Icao = "C152";
    d.Cat = Category::GA; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::None; d.Cockpit = CockpitKind::Steam;
    d.Length = 7.34; d.Span = 10.11; d.Area = 14.9; d.Height = 2.59; d.Diameter = 1.05; d.Sweep = 0; d.Dihedral = 1.7;
    d.Wing = WingPos::High; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Prop; d.Eng.N = 1; d.Eng.P = 82; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Nose; d.Eng.Bpr = 5; d.Eng.PropD = 1.75; d.Eng.Blades = 2;
    d.M = {490, 757, 757, 71, 200};
    d.V = {35, 40, 50, 60, 149, 0.3, 149, 85, 107, 6000, 14700, 0};
    d.Flaps = FlapSchedule::GA;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = false; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = false; d.Spoilers = false; d.Reversers = false; d.Seats = 2;
    d.EngineName = "Lycoming O-235-L2C"; d.RangeKm = 770; d.FirstFlight = 1977;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "c172"; d.Name = "Cessna 172S Skyhawk (G1000)"; d.Maker = "Cessna"; d.Icao = "C172";
    d.Cat = Category::GA; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::None; d.Cockpit = CockpitKind::G1000;
    d.Length = 8.28; d.Span = 11; d.Area = 16.2; d.Height = 2.72; d.Diameter = 1.12; d.Sweep = 0; d.Dihedral = 1.7;
    d.Wing = WingPos::High; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Prop; d.Eng.N = 1; d.Eng.P = 134; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Nose; d.Eng.Bpr = 5; d.Eng.PropD = 1.93; d.Eng.Blades = 2;
    d.M = {767, 1157, 1157, 145, 400};
    d.V = {40, 48, 55, 65, 163, 0.3, 163, 110, 124, 8000, 14000, 0};
    d.Flaps = FlapSchedule::GA;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = false; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = false; d.Spoilers = false; d.Reversers = false; d.Seats = 4;
    d.EngineName = "Lycoming IO-360-L2A"; d.RangeKm = 1185; d.FirstFlight = 1955;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "c172-classic"; d.Name = "Cessna 172N Skyhawk (Classic)"; d.Maker = "Cessna"; d.Icao = "C172";
    d.Cat = Category::GA; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::None; d.Cockpit = CockpitKind::Steam;
    d.Length = 8.28; d.Span = 11; d.Area = 16.2; d.Height = 2.72; d.Diameter = 1.12; d.Sweep = 0; d.Dihedral = 1.7;
    d.Wing = WingPos::High; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Prop; d.Eng.N = 1; d.Eng.P = 119; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Nose; d.Eng.Bpr = 5; d.Eng.PropD = 1.9; d.Eng.Blades = 2;
    d.M = {740, 1043, 1043, 115, 350};
    d.V = {41, 50, 55, 65, 158, 0.3, 158, 85, 115, 7000, 13000, 0};
    d.Flaps = FlapSchedule::GA;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = false; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = false; d.Spoilers = false; d.Reversers = false; d.Seats = 4;
    d.EngineName = "Lycoming O-320-H2AD"; d.RangeKm = 1060; d.FirstFlight = 1955;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "c182"; d.Name = "Cessna 182T Skylane"; d.Maker = "Cessna"; d.Icao = "C182";
    d.Cat = Category::GA; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::None; d.Cockpit = CockpitKind::G1000;
    d.Length = 8.84; d.Span = 10.97; d.Area = 16.2; d.Height = 2.84; d.Diameter = 1.15; d.Sweep = 0; d.Dihedral = 1.7;
    d.Wing = WingPos::High; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Prop; d.Eng.N = 1; d.Eng.P = 172; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Nose; d.Eng.Bpr = 5; d.Eng.PropD = 2.08; d.Eng.Blades = 3;
    d.M = {894, 1406, 1338, 250, 450};
    d.V = {49, 54, 55, 70, 175, 0.32, 175, 100, 145, 8000, 18100, 0};
    d.Flaps = FlapSchedule::GA;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = false; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = false; d.Spoilers = false; d.Reversers = false; d.Seats = 4;
    d.EngineName = "Lycoming IO-540-AB1A5"; d.RangeKm = 1715; d.FirstFlight = 1956;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "pa28"; d.Name = "PA-28-181 Archer III"; d.Maker = "Piper"; d.Icao = "P28A";
    d.Cat = Category::GA; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::None; d.Cockpit = CockpitKind::Steam;
    d.Length = 7.3; d.Span = 10.8; d.Area = 15.8; d.Height = 2.2; d.Diameter = 1.15; d.Sweep = 0; d.Dihedral = 7;
    d.Wing = WingPos::Low; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Prop; d.Eng.N = 1; d.Eng.P = 134; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Nose; d.Eng.Bpr = 5; d.Eng.PropD = 1.93; d.Eng.Blades = 2;
    d.M = {766, 1156, 1156, 144, 390};
    d.V = {45, 50, 55, 66, 154, 0.3, 154, 102, 128, 8000, 13200, 0};
    d.Flaps = FlapSchedule::GA;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = false; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = false; d.Spoilers = false; d.Reversers = false; d.Seats = 4;
    d.EngineName = "Lycoming O-360-A4M"; d.RangeKm = 960; d.FirstFlight = 1960;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "sr22t"; d.Name = "SR22T G6"; d.Maker = "Cirrus"; d.Icao = "S22T";
    d.Cat = Category::GA; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::None; d.Cockpit = CockpitKind::G1000;
    d.Length = 7.92; d.Span = 11.68; d.Area = 13.5; d.Height = 2.71; d.Diameter = 1.27; d.Sweep = 0; d.Dihedral = 4.5;
    d.Wing = WingPos::Low; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Prop; d.Eng.N = 1; d.Eng.P = 235; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Nose; d.Eng.Bpr = 5; d.Eng.PropD = 1.98; d.Eng.Blades = 3;
    d.M = {1100, 1633, 1633, 250, 450};
    d.V = {60, 70, 70, 80, 205, 0.35, 205, 119, 213, 25000, 25000, 0};
    d.Flaps = FlapSchedule::GA;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = false; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = false; d.Spoilers = false; d.Reversers = false; d.Seats = 5;
    d.EngineName = "Continental TSIO-550-K"; d.RangeKm = 1880; d.FirstFlight = 2010;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "da40"; d.Name = "DA40 NG"; d.Maker = "Diamond"; d.Icao = "DA40";
    d.Cat = Category::GA; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::None; d.Cockpit = CockpitKind::G1000;
    d.Length = 8.06; d.Span = 11.63; d.Area = 13.5; d.Height = 1.97; d.Diameter = 1.2; d.Sweep = 0; d.Dihedral = 5;
    d.Wing = WingPos::Low; d.Tail = TailKind::T; d.Canard = false;
    d.Eng.T = EngineType::Prop; d.Eng.N = 1; d.Eng.P = 101; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Nose; d.Eng.Bpr = 5; d.Eng.PropD = 1.9; d.Eng.Blades = 3;
    d.M = {900, 1310, 1310, 110, 350};
    d.V = {49, 52, 59, 70, 178, 0.33, 178, 108, 150, 10000, 16400, 0};
    d.Flaps = FlapSchedule::GA;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = false; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = false; d.Spoilers = false; d.Reversers = false; d.Seats = 4;
    d.EngineName = "Austro Engine AE300"; d.RangeKm = 1390; d.FirstFlight = 1997;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "da62"; d.Name = "DA62"; d.Maker = "Diamond"; d.Icao = "DA62";
    d.Cat = Category::GA; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::None; d.Cockpit = CockpitKind::G1000;
    d.Length = 9.19; d.Span = 14.55; d.Area = 17.1; d.Height = 2.82; d.Diameter = 1.3; d.Sweep = 0; d.Dihedral = 5;
    d.Wing = WingPos::Low; d.Tail = TailKind::T; d.Canard = false;
    d.Eng.T = EngineType::Prop; d.Eng.N = 2; d.Eng.P = 134; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Nacelle; d.Eng.Bpr = 5; d.Eng.PropD = 1.9; d.Eng.Blades = 3;
    d.M = {1580, 2300, 2300, 230, 700};
    d.V = {62, 69, 75, 80, 200, 0.35, 188, 138, 192, 16000, 20000, 0};
    d.Flaps = FlapSchedule::GA;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = false; d.Spoilers = false; d.Reversers = false; d.Seats = 7;
    d.EngineName = "2 × Austro Engine AE330"; d.RangeKm = 2280; d.FirstFlight = 2012;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "baron58"; d.Name = "Baron G58"; d.Maker = "Beechcraft"; d.Icao = "BE58";
    d.Cat = Category::GA; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::None; d.Cockpit = CockpitKind::G1000;
    d.Length = 9.09; d.Span = 11.53; d.Area = 18.5; d.Height = 2.97; d.Diameter = 1.3; d.Sweep = 0; d.Dihedral = 6;
    d.Wing = WingPos::Low; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Prop; d.Eng.N = 2; d.Eng.P = 224; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Nacelle; d.Eng.Bpr = 5; d.Eng.PropD = 1.98; d.Eng.Blades = 3;
    d.M = {1660, 2495, 2449, 560, 600};
    d.V = {73, 84, 85, 95, 223, 0.38, 152, 152, 200, 8000, 20700, 0};
    d.Flaps = FlapSchedule::GA;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = false; d.Spoilers = false; d.Reversers = false; d.Seats = 6;
    d.EngineName = "2 × Continental IO-550-C"; d.RangeKm = 1480; d.FirstFlight = 1969;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "bonanza"; d.Name = "Bonanza G36"; d.Maker = "Beechcraft"; d.Icao = "BE36";
    d.Cat = Category::GA; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::None; d.Cockpit = CockpitKind::G1000;
    d.Length = 8.38; d.Span = 10.2; d.Area = 16.8; d.Height = 2.62; d.Diameter = 1.25; d.Sweep = 0; d.Dihedral = 6;
    d.Wing = WingPos::Low; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Prop; d.Eng.N = 1; d.Eng.P = 224; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Nose; d.Eng.Bpr = 5; d.Eng.PropD = 2.03; d.Eng.Blades = 3;
    d.M = {1170, 1655, 1655, 212, 420};
    d.V = {59, 70, 70, 80, 205, 0.35, 152, 124, 176, 8000, 18500, 0};
    d.Flaps = FlapSchedule::GA;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = false; d.Spoilers = false; d.Reversers = false; d.Seats = 6;
    d.EngineName = "Continental IO-550-B"; d.RangeKm = 1700; d.FirstFlight = 1945;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "j3cub"; d.Name = "J-3 Cub"; d.Maker = "Piper"; d.Icao = "J3";
    d.Cat = Category::Vintage; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::None; d.Cockpit = CockpitKind::Steam;
    d.Length = 6.83; d.Span = 10.74; d.Area = 16.6; d.Height = 2.03; d.Diameter = 0.9; d.Sweep = 0; d.Dihedral = 1;
    d.Wing = WingPos::High; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Prop; d.Eng.N = 1; d.Eng.P = 48; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Nose; d.Eng.Bpr = 5; d.Eng.PropD = 1.83; d.Eng.Blades = 2;
    d.M = {345, 553, 553, 32, 170};
    d.V = {33, 33, 40, 50, 106, 0.2, 106, 106, 65, 3000, 11500, 0};
    d.Flaps = FlapSchedule::None;
    d.Gear.T = GearKind::Tail; d.Gear.Retract = false; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = false; d.Spoilers = false; d.Reversers = false; d.Seats = 2;
    d.EngineName = "Continental A-65"; d.RangeKm = 350; d.FirstFlight = 1938;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "extra330"; d.Name = "Extra 330LX"; d.Maker = "Extra"; d.Icao = "E300";
    d.Cat = Category::GA; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::None; d.Cockpit = CockpitKind::Steam;
    d.Length = 7.19; d.Span = 8; d.Area = 10.7; d.Height = 2.62; d.Diameter = 1; d.Sweep = 0; d.Dihedral = 0;
    d.Wing = WingPos::Low; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Prop; d.Eng.N = 1; d.Eng.P = 235; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Nose; d.Eng.Bpr = 5; d.Eng.PropD = 1.9; d.Eng.Blades = 3;
    d.M = {650, 870, 870, 65, 180};
    d.V = {55, 55, 60, 75, 219, 0.36, 219, 219, 180, 5000, 16000, 0};
    d.Flaps = FlapSchedule::None;
    d.Gear.T = GearKind::Tail; d.Gear.Retract = false; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = false; d.Spoilers = false; d.Reversers = false; d.Seats = 2;
    d.EngineName = "Lycoming AEIO-580-B1A"; d.RangeKm = 700; d.FirstFlight = 2008;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "ask21"; d.Name = "ASK 21 (Glider)"; d.Maker = "Schleicher"; d.Icao = "AS21";
    d.Cat = Category::Glider; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::None; d.Cockpit = CockpitKind::Steam;
    d.Length = 8.35; d.Span = 17; d.Area = 17.95; d.Height = 1.55; d.Diameter = 0.75; d.Sweep = 0; d.Dihedral = 4;
    d.Wing = WingPos::Mid; d.Tail = TailKind::T; d.Canard = false;
    d.Eng.T = EngineType::None; d.Eng.N = 0; d.Eng.P = 0; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Nose; d.Eng.Bpr = 5; d.Eng.PropD = 2; d.Eng.Blades = 0;
    d.M = {360, 600, 600, 0, 200};
    d.V = {35, 35, 40, 50, 150, 0.3, 150, 150, 55, 3000, 20000, 0};
    d.Flaps = FlapSchedule::None;
    d.Gear.T = GearKind::Tail; d.Gear.Retract = false; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = false; d.Spoilers = true; d.Reversers = false; d.Seats = 2;
    d.EngineName = "무동력 (글라이더)"; d.RangeKm = 0; d.FirstFlight = 1979;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "f16"; d.Name = "F-16C Fighting Falcon"; d.Maker = "Lockheed Martin"; d.Icao = "F16";
    d.Cat = Category::Military; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::Fighter; d.Cockpit = CockpitKind::Fighter;
    d.Length = 15.06; d.Span = 9.96; d.Area = 27.87; d.Height = 4.88; d.Diameter = 1.4; d.Sweep = 40; d.Dihedral = 0;
    d.Wing = WingPos::Mid; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Jet; d.Eng.N = 1; d.Eng.P = 76.3; d.Eng.Ab = 129; d.Eng.Mount = EngineMount::Internal; d.Eng.Bpr = 0.4; d.Eng.PropD = 2; d.Eng.Blades = 0;
    d.M = {8570, 19187, 15000, 3200, 7700};
    d.V = {118, 125, 150, 140, 800, 2.05, 300, 370, 480, 30000, 50000, 0};
    d.Flaps = FlapSchedule::Fighter;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = false; d.Spoilers = false; d.Reversers = false; d.Seats = 1;
    d.EngineName = "GE F110-GE-129"; d.RangeKm = 4220; d.FirstFlight = 1974;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "fa18e"; d.Name = "F/A-18E Super Hornet"; d.Maker = "Boeing"; d.Icao = "F18S";
    d.Cat = Category::Military; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::Fighter; d.Cockpit = CockpitKind::Fighter;
    d.Length = 18.31; d.Span = 13.62; d.Area = 46.45; d.Height = 4.88; d.Diameter = 1.6; d.Sweep = 26; d.Dihedral = -3;
    d.Wing = WingPos::Mid; d.Tail = TailKind::Twin; d.Canard = false;
    d.Eng.T = EngineType::Jet; d.Eng.N = 2; d.Eng.P = 62.3; d.Eng.Ab = 97.9; d.Eng.Mount = EngineMount::Internal2; d.Eng.Bpr = 0.4; d.Eng.PropD = 2; d.Eng.Blades = 0;
    d.M = {14552, 29937, 20000, 6780, 8000};
    d.V = {115, 125, 150, 135, 750, 1.6, 250, 250, 470, 30000, 50000, 0};
    d.Flaps = FlapSchedule::Fighter;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = true; d.Spoilers = false; d.Reversers = false; d.Seats = 1;
    d.EngineName = "2 × GE F414-GE-400"; d.RangeKm = 3330; d.FirstFlight = 1995;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "f35a"; d.Name = "F-35A Lightning II"; d.Maker = "Lockheed Martin"; d.Icao = "F35";
    d.Cat = Category::Military; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::Fighter; d.Cockpit = CockpitKind::Fighter;
    d.Length = 15.7; d.Span = 10.7; d.Area = 42.7; d.Height = 4.38; d.Diameter = 1.8; d.Sweep = 33; d.Dihedral = 0;
    d.Wing = WingPos::Mid; d.Tail = TailKind::Twin; d.Canard = false;
    d.Eng.T = EngineType::Jet; d.Eng.N = 1; d.Eng.P = 125; d.Eng.Ab = 191; d.Eng.Mount = EngineMount::Internal; d.Eng.Bpr = 0.4; d.Eng.PropD = 2; d.Eng.Blades = 0;
    d.M = {13290, 31800, 22000, 8278, 8100};
    d.V = {125, 135, 160, 145, 750, 1.6, 300, 300, 480, 30000, 50000, 0};
    d.Flaps = FlapSchedule::Fighter;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = false; d.Spoilers = false; d.Reversers = false; d.Seats = 1;
    d.EngineName = "P&W F135-PW-100"; d.RangeKm = 2800; d.FirstFlight = 2006;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "typhoon"; d.Name = "Eurofighter Typhoon"; d.Maker = "Eurofighter"; d.Icao = "EUFI";
    d.Cat = Category::Military; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::Fighter; d.Cockpit = CockpitKind::Fighter;
    d.Length = 15.96; d.Span = 10.95; d.Area = 51.2; d.Height = 5.28; d.Diameter = 1.6; d.Sweep = 53; d.Dihedral = 0;
    d.Wing = WingPos::Low; d.Tail = TailKind::Delta; d.Canard = true;
    d.Eng.T = EngineType::Jet; d.Eng.N = 2; d.Eng.P = 60; d.Eng.Ab = 90; d.Eng.Mount = EngineMount::Internal2; d.Eng.Bpr = 0.4; d.Eng.PropD = 2; d.Eng.Blades = 0;
    d.M = {11000, 23500, 16000, 4996, 7500};
    d.V = {125, 130, 150, 145, 750, 2, 290, 290, 480, 35000, 55000, 0};
    d.Flaps = FlapSchedule::None;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = false; d.Spoilers = false; d.Reversers = false; d.Seats = 1;
    d.EngineName = "2 × Eurojet EJ200"; d.RangeKm = 2900; d.FirstFlight = 1994;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "p51d"; d.Name = "P-51D Mustang"; d.Maker = "North American"; d.Icao = "P51";
    d.Cat = Category::Vintage; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::None; d.Cockpit = CockpitKind::Steam;
    d.Length = 9.83; d.Span = 11.28; d.Area = 21.83; d.Height = 4.08; d.Diameter = 1.3; d.Sweep = 0; d.Dihedral = 5;
    d.Wing = WingPos::Low; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Prop; d.Eng.N = 1; d.Eng.P = 1100; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Nose; d.Eng.Bpr = 5; d.Eng.PropD = 3.4; d.Eng.Blades = 4;
    d.M = {3232, 5490, 4580, 780, 200};
    d.V = {82, 88, 100, 110, 439, 0.8, 148, 143, 315, 25000, 41900, 0};
    d.Flaps = FlapSchedule::GA;
    d.Gear.T = GearKind::Tail; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = false; d.Spoilers = false; d.Reversers = false; d.Seats = 1;
    d.EngineName = "Packard V-1650-7 Merlin"; d.RangeKm = 2650; d.FirstFlight = 1940;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "spitfire"; d.Name = "Spitfire Mk IX"; d.Maker = "Supermarine"; d.Icao = "SPIT";
    d.Cat = Category::Vintage; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::None; d.Cockpit = CockpitKind::Steam;
    d.Length = 9.47; d.Span = 11.23; d.Area = 22.48; d.Height = 3.86; d.Diameter = 1.2; d.Sweep = 0; d.Dihedral = 6;
    d.Wing = WingPos::Low; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Prop; d.Eng.N = 1; d.Eng.P = 1170; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Nose; d.Eng.Bpr = 5; d.Eng.PropD = 3.27; d.Eng.Blades = 4;
    d.M = {2600, 3400, 3400, 250, 100};
    d.V = {70, 75, 85, 90, 390, 0.8, 139, 139, 280, 20000, 43000, 0};
    d.Flaps = FlapSchedule::Split;
    d.Gear.T = GearKind::Tail; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = false; d.Spoilers = false; d.Reversers = false; d.Seats = 1;
    d.EngineName = "RR Merlin 66"; d.RangeKm = 700; d.FirstFlight = 1942;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "dc3"; d.Name = "DC-3"; d.Maker = "Douglas"; d.Icao = "DC3";
    d.Cat = Category::Vintage; d.Fdm = FdmKind::Fixed; d.Fbw = FbwLaw::None; d.Cockpit = CockpitKind::Steam;
    d.Length = 19.7; d.Span = 29; d.Area = 91.7; d.Height = 5.16; d.Diameter = 2.5; d.Sweep = 0; d.Dihedral = 5;
    d.Wing = WingPos::Low; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Prop; d.Eng.N = 2; d.Eng.P = 895; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Nacelle; d.Eng.Bpr = 5; d.Eng.PropD = 3.5; d.Eng.Blades = 3;
    d.M = {7650, 11430, 11430, 2500, 2700};
    d.V = {58, 67, 85, 85, 190, 0.5, 140, 97, 180, 10000, 23200, 0};
    d.Flaps = FlapSchedule::Split;
    d.Gear.T = GearKind::Tail; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Apu = false; d.Spoilers = false; d.Reversers = false; d.Seats = 32;
    d.EngineName = "2 × P&W R-1830 Twin Wasp"; d.RangeKm = 2400; d.FirstFlight = 1935;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "h135"; d.Name = "H135"; d.Maker = "Airbus Helicopters"; d.Icao = "EC35";
    d.Cat = Category::Helicopter; d.Fdm = FdmKind::Rotor; d.Fbw = FbwLaw::None; d.Cockpit = CockpitKind::Heli;
    d.Length = 10.2; d.Span = 10.2; d.Area = 1; d.Height = 3.5; d.Diameter = 1.6; d.Sweep = 0; d.Dihedral = 0;
    d.Wing = WingPos::High; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Shaft; d.Eng.N = 2; d.Eng.P = 473; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Top; d.Eng.Bpr = 5; d.Eng.PropD = 2; d.Eng.Blades = 0;
    d.M = {1490, 2980, 2980, 570, 1100};
    d.V = {0, 0, 0, 0, 155, 0.3, 155, 155, 137, 3000, 20000, 0};
    d.Flaps = FlapSchedule::None;
    d.Gear.T = GearKind::Skid; d.Gear.Retract = false; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Rotor.D = 10.2; d.Rotor.Blades = 4; d.Rotor.Tail = RotorTail::Fenestron;
    d.Apu = false; d.Spoilers = false; d.Reversers = false; d.Seats = 7;
    d.EngineName = "2 × Safran Arrius 2B2 / PW206B3"; d.RangeKm = 635; d.FirstFlight = 1994;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "h125"; d.Name = "H125 (AS350 B3e)"; d.Maker = "Airbus Helicopters"; d.Icao = "AS50";
    d.Cat = Category::Helicopter; d.Fdm = FdmKind::Rotor; d.Fbw = FbwLaw::None; d.Cockpit = CockpitKind::Heli;
    d.Length = 10.93; d.Span = 10.69; d.Area = 1; d.Height = 3.34; d.Diameter = 1.7; d.Sweep = 0; d.Dihedral = 0;
    d.Wing = WingPos::High; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Shaft; d.Eng.N = 1; d.Eng.P = 632; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Top; d.Eng.Bpr = 5; d.Eng.PropD = 2; d.Eng.Blades = 0;
    d.M = {1223, 2250, 2250, 426, 1000};
    d.V = {0, 0, 0, 0, 155, 0.3, 155, 155, 136, 3000, 23000, 0};
    d.Flaps = FlapSchedule::None;
    d.Gear.T = GearKind::Skid; d.Gear.Retract = false; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Rotor.D = 10.69; d.Rotor.Blades = 3; d.Rotor.Tail = RotorTail::Rotor;
    d.Apu = false; d.Spoilers = false; d.Reversers = false; d.Seats = 6;
    d.EngineName = "Safran Arriel 2D"; d.RangeKm = 640; d.FirstFlight = 1974;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "bell407"; d.Name = "Bell 407GXi"; d.Maker = "Bell"; d.Icao = "B407";
    d.Cat = Category::Helicopter; d.Fdm = FdmKind::Rotor; d.Fbw = FbwLaw::None; d.Cockpit = CockpitKind::Heli;
    d.Length = 10.56; d.Span = 10.67; d.Area = 1; d.Height = 3.56; d.Diameter = 1.6; d.Sweep = 0; d.Dihedral = 0;
    d.Wing = WingPos::High; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Shaft; d.Eng.N = 1; d.Eng.P = 606; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Top; d.Eng.Bpr = 5; d.Eng.PropD = 2; d.Eng.Blades = 0;
    d.M = {1210, 2268, 2268, 399, 900};
    d.V = {0, 0, 0, 0, 140, 0.3, 140, 140, 133, 3000, 18690, 0};
    d.Flaps = FlapSchedule::None;
    d.Gear.T = GearKind::Skid; d.Gear.Retract = false; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Rotor.D = 10.67; d.Rotor.Blades = 4; d.Rotor.Tail = RotorTail::Rotor;
    d.Apu = false; d.Spoilers = false; d.Reversers = false; d.Seats = 7;
    d.EngineName = "RR M250-C47B"; d.RangeKm = 611; d.FirstFlight = 1995;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "r44"; d.Name = "R44 Raven II"; d.Maker = "Robinson"; d.Icao = "R44";
    d.Cat = Category::Helicopter; d.Fdm = FdmKind::Rotor; d.Fbw = FbwLaw::None; d.Cockpit = CockpitKind::Heli;
    d.Length = 8.96; d.Span = 10.06; d.Area = 1; d.Height = 3.28; d.Diameter = 1.3; d.Sweep = 0; d.Dihedral = 0;
    d.Wing = WingPos::High; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Prop; d.Eng.N = 1; d.Eng.P = 183; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Top; d.Eng.Bpr = 5; d.Eng.PropD = 2; d.Eng.Blades = 0;
    d.M = {684, 1134, 1134, 130, 400};
    d.V = {0, 0, 0, 0, 130, 0.25, 130, 130, 110, 2000, 14000, 0};
    d.Flaps = FlapSchedule::None;
    d.Gear.T = GearKind::Skid; d.Gear.Retract = false; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Rotor.D = 10.06; d.Rotor.Blades = 2; d.Rotor.Tail = RotorTail::Rotor;
    d.Apu = false; d.Spoilers = false; d.Reversers = false; d.Seats = 4;
    d.EngineName = "Lycoming IO-540-AE1A5"; d.RangeKm = 560; d.FirstFlight = 1990;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "aw139"; d.Name = "AW139"; d.Maker = "Leonardo"; d.Icao = "A139";
    d.Cat = Category::Helicopter; d.Fdm = FdmKind::Rotor; d.Fbw = FbwLaw::None; d.Cockpit = CockpitKind::Heli;
    d.Length = 13.77; d.Span = 13.8; d.Area = 1; d.Height = 3.72; d.Diameter = 2.2; d.Sweep = 0; d.Dihedral = 0;
    d.Wing = WingPos::High; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Shaft; d.Eng.N = 2; d.Eng.P = 1142; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Top; d.Eng.Bpr = 5; d.Eng.PropD = 2; d.Eng.Blades = 0;
    d.M = {3622, 7000, 7000, 1250, 2500};
    d.V = {0, 0, 0, 0, 167, 0.3, 150, 167, 165, 3000, 20000, 0};
    d.Flaps = FlapSchedule::None;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = true; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Rotor.D = 13.8; d.Rotor.Blades = 5; d.Rotor.Tail = RotorTail::Rotor;
    d.Apu = false; d.Spoilers = false; d.Reversers = false; d.Seats = 15;
    d.EngineName = "2 × P&W Canada PT6C-67C"; d.RangeKm = 1060; d.FirstFlight = 2001;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "uh60"; d.Name = "UH-60M Black Hawk"; d.Maker = "Sikorsky"; d.Icao = "H60";
    d.Cat = Category::Helicopter; d.Fdm = FdmKind::Rotor; d.Fbw = FbwLaw::None; d.Cockpit = CockpitKind::Heli;
    d.Length = 15.26; d.Span = 16.36; d.Area = 1; d.Height = 5.13; d.Diameter = 2.4; d.Sweep = 0; d.Dihedral = 0;
    d.Wing = WingPos::High; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Shaft; d.Eng.N = 2; d.Eng.P = 1409; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Top; d.Eng.Bpr = 5; d.Eng.PropD = 2; d.Eng.Blades = 0;
    d.M = {5224, 9979, 9979, 1100, 3000};
    d.V = {0, 0, 0, 0, 193, 0.35, 193, 193, 151, 3000, 19000, 0};
    d.Flaps = FlapSchedule::None;
    d.Gear.T = GearKind::Tail; d.Gear.Retract = false; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Rotor.D = 16.36; d.Rotor.Blades = 4; d.Rotor.Tail = RotorTail::Rotor;
    d.Apu = false; d.Spoilers = false; d.Reversers = false; d.Seats = 13;
    d.EngineName = "2 × GE T700-GE-701D"; d.RangeKm = 590; d.FirstFlight = 1974;
    db.push_back(d);
  }
  {
    AircraftDef d;
    d.Id = "ch47"; d.Name = "CH-47F Chinook"; d.Maker = "Boeing"; d.Icao = "H47";
    d.Cat = Category::Helicopter; d.Fdm = FdmKind::Rotor; d.Fbw = FbwLaw::None; d.Cockpit = CockpitKind::Heli;
    d.Length = 15.8; d.Span = 18.29; d.Area = 1; d.Height = 5.7; d.Diameter = 3.8; d.Sweep = 0; d.Dihedral = 0;
    d.Wing = WingPos::High; d.Tail = TailKind::Conv; d.Canard = false;
    d.Eng.T = EngineType::Shaft; d.Eng.N = 2; d.Eng.P = 3529; d.Eng.Ab = 0; d.Eng.Mount = EngineMount::Top; d.Eng.Bpr = 5; d.Eng.PropD = 2; d.Eng.Blades = 0;
    d.M = {11148, 22680, 22680, 3000, 10000};
    d.V = {0, 0, 0, 0, 170, 0.35, 170, 170, 155, 3000, 20000, 0};
    d.Flaps = FlapSchedule::None;
    d.Gear.T = GearKind::Tri; d.Gear.Retract = false; d.Gear.Wheelbase = 0; d.Gear.Track = 0; d.Gear.Height = 0;
    d.Rotor.D = 18.29; d.Rotor.Blades = 3; d.Rotor.Tail = RotorTail::Tandem;
    d.Apu = false; d.Spoilers = false; d.Reversers = false; d.Seats = 36;
    d.EngineName = "2 × Honeywell T55-GA-714A"; d.RangeKm = 740; d.FirstFlight = 1961;
    db.push_back(d);
  }
  return db;
}
}  // namespace

const std::vector<AircraftDef>& AllAircraft() {
  static const std::vector<AircraftDef> kDb = BuildDb();
  return kDb;
}

const AircraftDef* FindAircraft(const std::string& id) {
  for (const AircraftDef& d : AllAircraft())
    if (d.Id == id) return &d;
  return nullptr;
}

const AircraftDef& GetAircraft(const std::string& id) {
  const AircraftDef* d = FindAircraft(id);
  return d ? *d : AllAircraft().front();
}

}  // namespace skyline

