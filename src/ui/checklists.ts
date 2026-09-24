import type { AircraftDef } from '../sim/types.ts';

type CL = Record<string, string[][]>;
const AIRLINER: CL = {
  '시동 전': [['BATTERY', 'ON'], ['EXT LIGHTS / BEACON', 'ON'], ['APU', 'START'], ['APU BLEED', 'ON'], ['FUEL PUMPS', 'ON'], ['PARKING BRAKE', 'SET'], ['BARO', 'SET QNH']],
  '엔진 시동': [['ENG START SELECTOR', 'IGN'], ['ENG 2 MASTER / START', 'ON'], ['ENG 1 MASTER / START', 'ON'], ['N2 / EGT', 'STABLE'], ['APU BLEED', 'OFF'], ['APU', 'OFF']],
  '택시 전': [['FLAPS', 'TAKEOFF'], ['TRIM', 'SET'], ['GROUND SPOILERS', 'ARMED'], ['FMS / RTE', 'CHECKED'], ['MCP ALT / HDG / SPD', 'SET'], ['F/D', 'ON']],
  '이륙 전': [['TRANSPONDER', 'TA/RA'], ['STROBE / LANDING LTS', 'ON'], ['PARKING BRAKE', 'RELEASED'], ['A/THR', 'ARMED'], ['CONFIG', 'NO WARNING']],
  '이륙 후': [['GEAR', 'UP'], ['FLAPS', 'UP (클린 속도)'], ['A/THR', 'SPEED'], ['AUTOPILOT', 'ON'], ['BARO', 'STD (전이고도)']],
  '강하 / 접근': [['ARRIVAL RWY / ILS', 'SET'], ['MINIMUMS', 'SET'], ['BARO', 'QNH'], ['SEATBELT', 'ON'], ['APPR', 'ARMED']],
  '착륙': [['GEAR', 'DOWN 3 GREEN'], ['FLAPS', 'FULL / 30'], ['GROUND SPOILERS', 'ARMED'], ['LANDING LIGHTS', 'ON'], ['AUTOBRAKE', 'SET']],
  '착륙 후': [['SPOILERS', 'RETRACT'], ['FLAPS', 'UP'], ['STROBE / LANDING LTS', 'OFF'], ['APU', 'START'], ['REVERSERS', 'STOWED']],
};
const GA: CL = {
  '시동 전': [['PREFLIGHT', 'COMPLETE'], ['SEATS / BELTS', 'SECURE'], ['FUEL SELECTOR', 'BOTH'], ['CIRCUIT BREAKERS', 'IN'], ['AVIONICS', 'OFF'], ['BRAKES', 'SET']],
  '엔진 시동': [['MIXTURE', 'RICH'], ['THROTTLE', 'OPEN 1/4"'], ['MASTER (BAT)', 'ON'], ['BEACON', 'ON'], ['MAGNETOS / STARTER', 'START'], ['OIL PRESSURE', 'GREEN'], ['AVIONICS', 'ON']],
  '런업': [['BRAKES', 'HOLD'], ['THROTTLE', '1800 RPM'], ['MAGNETOS', 'CHECK (125 RPM 감소 이내)'], ['ENGINE INSTR.', 'GREEN'], ['FLIGHT CONTROLS', 'FREE & CORRECT'], ['TRIM', 'TAKEOFF'], ['FLAPS', '0–10°']],
  '이륙': [['LIGHTS', 'LDG/STROBE ON'], ['THROTTLE', 'FULL'], ['ROTATE', 'VR'], ['CLIMB', 'VY'], ['FLAPS', 'UP (안전고도)']],
  '순항': [['POWER', 'SET 2300–2500 RPM'], ['MIXTURE', 'LEAN'], ['TRIM', 'ADJUST']],
  '착륙': [['MIXTURE', 'RICH'], ['CARB HEAT / FUEL', 'ON / BOTH'], ['FLAPS', 'AS REQ'], ['APPROACH SPEED', 'VREF+5'], ['LANDING LIGHT', 'ON']],
};
const HELI: CL = {
  '시동 전': [['ROTOR BRAKE', 'OFF'], ['BATTERY', 'ON'], ['FUEL PUMPS', 'ON'], ['COLLECTIVE', 'DOWN'], ['CYCLIC', 'NEUTRAL']],
  '엔진 시동': [['ENG MASTER', 'ON'], ['STARTER', 'ENGAGE'], ['NG', '> 60% STABLE'], ['THROTTLE (TWIST GRIP)', 'FLIGHT'], ['NR', '100%']],
  '호버링 / 이륙': [['SAS', 'ON'], ['COLLECTIVE', '천천히 증가'], ['PEDALS', '방향 유지'], ['HOVER CHECK', 'TRQ 확인'], ['TRANSITION', 'ETL 통과']],
  '착륙': [['APPROACH', '저속 · 강하율 < 500fpm (VRS 주의)'], ['HOVER', '안정'], ['COLLECTIVE', 'FULL DOWN'], ['THROTTLE', 'IDLE']],
};
const FIGHTER: CL = {
  '시동': [['BATTERY / MAIN PWR', 'ON'], ['JFS / APU', 'START'], ['ENG MASTER', 'ON'], ['THROTTLE', 'IDLE'], ['CANOPY', 'CLOSED']],
  '이륙': [['FLAPS', 'AUTO / HALF'], ['TRIM', 'SET'], ['THROTTLE', 'MIL → AB'], ['ROTATE', 'VR'], ['GEAR', 'UP < 300KT']],
  '착륙': [['GEAR', 'DOWN'], ['FLAPS', 'FULL'], ['AoA', 'ON SPEED (≈13°)'], ['HOOK', 'AS REQ']],
};
export function checklistFor(d: AircraftDef): CL {
  if (d.fdm === 'rotor') return HELI;
  if (d.cockpit === 'fighter') return FIGHTER;
  if (d.cat === 'ga' || d.cat === 'vintage' || d.cat === 'glider' || (d.cat === 'turboprop' && d.eng.n === 1)) return GA;
  return AIRLINER;
}
