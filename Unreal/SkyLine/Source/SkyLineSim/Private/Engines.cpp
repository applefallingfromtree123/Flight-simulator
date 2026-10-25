#include "Engines.h"

namespace skyline {

namespace {
constexpr double kLbhPerLbf = 0.10197 / 3600;  // (lb/lbf/h) -> kg/(N s)
constexpr double kBsfcPiston = 7.6e-8;         // kg/J
constexpr double kBsfcTurbine = 9.4e-8;
}  // namespace

double ThrustLapse(const EngineDef& e, const Air& air, double mach, bool ab) {
  const double bpr = e.Bpr;
  if (ab) return std::pow(air.Sigma, 0.8) * (1 + 0.7 * mach);
  if (bpr < 2) return std::pow(air.Sigma, 0.75) * (1 + 0.25 * mach);
  const double k = Clamp(0.25 + 0.02 * bpr, 0.3, 0.5);
  return std::pow(air.Sigma, 0.72) * std::max(0.2, 1 - k * mach + 0.12 * mach * mach);
}

double PowerLapse(const EngineDef& e, const Air& air) {
  if (e.T == EngineType::Prop) return Clamp(1.132 * air.Sigma - 0.132, 0, 1);
  return std::min(1.0, 1.2 * std::pow(air.Sigma, 0.75) * std::sqrt(288.15 / air.T));
}

double PropStaticThrust(double power, double diameter, double rho) {
  const double area = kPi * diameter * diameter / 4;
  return 0.62 * std::cbrt(2 * rho * area * power * power);
}

double PropThrust(double power, double diameter, double rho, double v) {
  if (power <= 0) return 0;
  const double eta = 0.83;
  const double ts = PropStaticThrust(power, diameter, rho);
  const double v0 = eta * power / std::max(1.0, ts);
  return eta * power / std::sqrt(v * v + v0 * v0);
}

double MaxThrust(const AircraftDef& ac, const Air& air, double v, double mach, bool ab) {
  const EngineDef& e = ac.Eng;
  switch (e.T) {
    case EngineType::Fan:
    case EngineType::Jet: {
      const double t0 = ((ab && e.Ab > 0) ? e.Ab : e.P) * 1000;
      return t0 * ThrustLapse(e, air, mach, ab);
    }
    case EngineType::Prop:
    case EngineType::TProp:
      return PropThrust(e.P * 1000 * PowerLapse(e, air), e.PropD, air.Rho, v);
    default:
      return 0;
  }
}

void Engine::SetRunning(bool on) {
  Running = on;
  Spool = 0;
  StartT = 0;
  if (on) {
    if (Def.T == EngineType::Fan || Def.T == EngineType::Jet) { N2 = 60; N1 = 21; Egt = 450; }
    if (Def.T == EngineType::TProp || Def.T == EngineType::Shaft) { Ng = 62; Np = 70; Itt = 520; }
    if (Def.T == EngineType::Prop) Rpm = 800;
    OilP = 1; OilT = 70;
  } else {
    N1 = N2 = Ng = Np = Rpm = 0;
  }
}

void Engine::Update(const EngineCmd& c, const EngineEnv& env) {
  const double dt = env.Dt;
  const Air& air = env.Atm;
  const double v = env.V, mach = env.Mach;
  const EngineDef& e = Def;
  const double ambC = air.T - 273.15;
  const bool canRun = !Failed && env.FuelOk && !c.Cutoff;
  if (Running && !canRun) Running = false;

  const bool reverseCmd = c.Reverse && c.Throttle < 0.05;
  Rev = MoveToward(Rev, reverseCmd ? 1 : 0, dt / 2.0);
  const double lever = Rev > 0.9 ? (c.Reverse ? 0.75 : 0) : (Rev > 0 ? 0 : c.Throttle);

  switch (e.T) {
    case EngineType::Fan:
    case EngineType::Jet: {
      const bool isJet = e.T == EngineType::Jet;
      const double idleN2 = isJet ? 68 : 60;
      if (Running) {
        const double tgt = Clamp((isJet && e.Ab > 0) ? std::min(lever, 0.95) / 0.95 : lever, 0, 1);
        const double size = std::pow(e.P / 120, 0.25);
        const double tau = tgt > Spool ? (1.0 + 3.2 * (1 - Spool) * (1 - Spool)) * size : 1.6 * size;
        Spool = Approach(Spool, tgt, tau, dt);
        const double abCmd = (isJet && e.Ab > 0 && lever > 0.955) ? (lever - 0.955) / 0.045 : 0;
        AbPos = Approach(AbPos, Spool > 0.95 ? abCmd : 0, 0.7, dt);
        N2 = Approach(N2, idleN2 + (100 - idleN2) * std::pow(Spool, 0.6), 0.3, dt);
        N1 = isJet ? N2 : Approach(N1, 20 + 77 * std::pow(Spool, 0.45) * (0.93 + 0.07 * air.Theta), 0.3, dt);
        Egt = Approach(Egt, 420 + 430 * Spool + 20 * mach + ambC * 1.5 + 350 * AbPos, 1.2, dt);
        OilP = Approach(OilP, 30 + 30 * Spool, 1, dt);
      } else {
        // start sequence: starter spins N2 to ~25% with bleed air, then light-off
        const bool cranking = c.Starter && env.BleedOk && env.ElecOk;
        N2 = Approach(N2, cranking ? 26 : 0, cranking ? 5 : 8, dt);
        N1 = Approach(N1, N2 * 0.3, 2, dt);
        if (cranking && N2 > 20 && canRun && c.Ignition) {
          StartT += dt;
          Egt = Approach(Egt, 600, 3, dt);
          N2 = Approach(N2, idleN2 + 2, 7, dt);
          if (StartT > 10) { Running = true; Spool = 0; }
        } else {
          StartT = 0;
          Egt = Approach(Egt, std::max(ambC, N2 > 1 ? 80.0 : ambC), 20, dt);
        }
        OilP = Approach(OilP, N2 * 0.6, 1, dt);
        Spool = 0;
        AbPos = 0;
      }
      const double t0 = e.P * 1000;
      double thrust = 0;
      if (Running) {
        const double idleT = 0.045 * t0 * std::pow(air.Sigma, 0.6);
        thrust = idleT + (t0 * ThrustLapse(e, air, mach) - idleT) * Spool;
        if (e.Ab > 0 && AbPos > 0) thrust += (e.Ab - e.P) * 1000 * ThrustLapse(e, air, mach, true) * AbPos;
        thrust -= 0.5 * air.Rho * v * v * 0.002 * t0 / 1000 * (mach < 1 ? 1 : 0);  // ram drag residual
      } else {
        thrust = -0.5 * air.Rho * v * v * 0.12 * (e.P / 120);  // windmilling drag
      }
      if (Rev > 0) thrust = thrust * (1 - Rev) - std::max(0.0, thrust) * 0.45 * Rev;
      Thrust = thrust;
      const double bpr = e.Bpr;
      const double tsfc = (isJet ? (AbPos > 0.05 ? 1.9 : 0.8 + 0.25 * mach) : (0.34 + 0.3 * mach) * (1 - 0.025 * (bpr - 5))) * kLbhPerLbf * std::sqrt(air.Theta);
      FuelFlow = Running ? tsfc * std::max(std::fabs(thrust), 0.06 * t0 * air.Sigma) * 3600 : 0;
      break;
    }
    case EngineType::Prop: {
      const double pMax = e.P * 1000;
      const bool constantSpeed = e.P > 150 || e.N > 1;
      const double maxRpm = e.P > 800 ? 3000 : 2700;
      if (Running) {
        const double ambInHg = air.P / 3386.39;
        const bool turbo = e.P > 200 && e.P < 800;
        const double mpMax = turbo ? 36 : (e.P >= 800 ? 61 : ambInHg - 0.8);
        Mp = Approach(Mp, ambInHg * 0.33 + (mpMax - ambInHg * 0.33) * std::pow(Clamp(c.Throttle, 0, 1), 0.9), 0.3, dt);
        const double mixOpt = Clamp(air.Sigma * 1.05, 0.3, 1);
        const double mixF = Clamp(1 - 3 * (c.Mixture - mixOpt) * (c.Mixture - mixOpt) - (c.Mixture < mixOpt - 0.25 ? 2 * (mixOpt - 0.25 - c.Mixture) : 0), 0, 1);
        if (c.Mixture < 0.08) Running = false;
        const double tgtRpm = constantSpeed ? 1800 + (maxRpm - 1800) * c.Prop
                                            : 700 + (maxRpm - 700) * (0.78 * std::sqrt(std::max(0.0, c.Throttle)) + 0.22 * Clamp(v / 70, 0, 1.2));
        Rpm = Approach(Rpm, Clamp(tgtRpm, 650, maxRpm + 50), 0.6, dt);
        const double mpRef = turbo ? 36 : (e.P >= 800 ? 61 : 29.92);
        const double pf = Clamp((Mp - 7) / (mpRef - 7), 0.03, 1.05);
        const double rpmF = constantSpeed ? Clamp(0.55 + 0.45 * Rpm / maxRpm, 0.3, 1) : 1;
        Power = std::max(0.0, pMax * pf * mixF * rpmF);
        Egt = Approach(Egt, 1150 + 350 * (1 - std::fabs(c.Mixture - mixOpt) * 2) * pf, 3, dt);  // degF
        Cht = Approach(Cht, 250 + 150 * pf, 30, dt);
        OilP = Approach(OilP, 55 + 20 * (Rpm / maxRpm), 2, dt);
        OilT = Approach(OilT, 180, 60, dt);
      } else {
        const bool crank = c.Starter && env.ElecOk;
        Rpm = Approach(Rpm, crank ? 250 : std::min(v * 12, 900.0) * (v > 25 ? 1 : 0), crank ? 0.6 : 2, dt);
        Mp = Approach(Mp, air.P / 3386.39, 1, dt);
        Power = 0;
        if (crank && Rpm > 150 && canRun && c.Ignition && c.Mixture > 0.2) {
          StartT += dt;
          if (StartT > 1.8) { Running = true; Rpm = 900; }
        } else {
          StartT = 0;
        }
        Egt = Approach(Egt, ambC * 1.8 + 32, 60, dt);
        OilP = Approach(OilP, Rpm / 20, 1, dt);
      }
      Thrust = PropThrust(Power, e.PropD, air.Rho, v) - (Running ? 0 : 0.5 * air.Rho * v * v * 0.04 * e.PropD * e.PropD);
      FuelFlow = Running ? kBsfcPiston * std::max(Power, 0.08 * pMax) * (0.8 + 0.4 * c.Mixture) * 3600 : 0;
      N1 = Rpm / maxRpm * 100;
      break;
    }
    case EngineType::TProp:
    case EngineType::Shaft: {
      const double pMax = e.P * 1000;
      if (Running) {
        const double idle = Rev > 0 ? 0.08 : 0;
        const double tgt = Clamp(std::max(lever, idle), 0, 1);
        const double tau = tgt > Spool ? 1.2 + 1.8 * (1 - Spool) : 1.0;
        Spool = Approach(Spool, tgt, tau, dt);
        Ng = Approach(Ng, 62 + 39 * std::pow(Spool, 0.7), 0.4, dt);
        Np = Approach(Np, e.T == EngineType::Shaft ? 100 : 70 + 30 * Clamp(c.Prop, 0, 1), 1.0, dt);
        Power = pMax * PowerLapse(e, air) * (0.05 + 0.95 * Spool);
        Torque = Power / pMax * 100 * (100 / std::max(Np, 50.0));
        Itt = Approach(Itt, 500 + 300 * Spool + ambC * 1.2 + 100 * (1 - air.Sigma), 1.5, dt);
        OilP = Approach(OilP, 90 + 20 * Spool, 1, dt);
      } else {
        const bool crank = c.Starter && env.ElecOk;
        Ng = Approach(Ng, crank ? 16 : 0, crank ? 3 : 6, dt);
        Np = Approach(Np, crank ? 8 : std::min(v, 40.0) * 0.5, 4, dt);
        Power = 0; Torque = 0; Spool = 0;
        if (crank && Ng > 12 && canRun && c.Ignition) {
          StartT += dt;
          Itt = Approach(Itt, 650, 2, dt);
          Ng = Approach(Ng, 62, 6, dt);
          if (StartT > 12) Running = true;
        } else {
          StartT = 0;
          Itt = Approach(Itt, ambC, 30, dt);
        }
        OilP = Approach(OilP, Ng, 1, dt);
      }
      if (e.T == EngineType::TProp) {
        double thrust = PropThrust(Power, e.PropD, air.Rho, v);
        if (Rev > 0) thrust = thrust * (1 - Rev) - PropStaticThrust(pMax * 0.35 * Spool + pMax * 0.05, e.PropD, air.Rho) * 0.5 * Rev;
        if (!Running) thrust = -0.5 * air.Rho * v * v * 0.01 * e.PropD * e.PropD;  // feathered
        Thrust = thrust;
      } else {
        Thrust = 0;
      }
      FuelFlow = Running ? kBsfcTurbine * std::max(Power, 0.12 * pMax) * 3600 : 0;
      N1 = Ng; N2 = Np; Egt = Itt;
      Rpm = Np * (e.T == EngineType::TProp ? 17 : 1);
      break;
    }
    case EngineType::None:
      Thrust = 0; FuelFlow = 0;
      break;
  }
}

}  // namespace skyline
