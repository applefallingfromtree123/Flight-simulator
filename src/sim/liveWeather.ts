// Live weather from Open-Meteo (free, no key, CORS): surface wind/gusts, QNH, temperature, clouds, visibility,
// precipitation and the winds/temperatures on pressure levels up to FL390. From those it estimates where the
// air is rough: mechanical turbulence near the ground (wind and gusts), convection (CAPE, thunderstorms) and
// clear-air turbulence in vertical wind shear aloft (the jet stream).
import type { CloudLayer, TurbLayer, WeatherState, WindLevel } from './atmosphere.ts';

const LEVELS = [1000, 925, 850, 700, 500, 400, 300, 250, 200] as const;

/** Observed conditions for display (METAR-like). */
export interface WxReport {
  temp: number; dew: number; qnh: number; windDir: number; wind: number; gust: number; vis: number; code: number;
  low: number; mid: number; high: number; cape: number; jet: { spd: number; dir: number; fl: number } | null;
}
export interface LiveWeather {
  w: WeatherState;
  report: WxReport;
  /** Short description for the pilot ("보통 난기류 FL280–FL340 (제트기류 윈드시어)"). */
  summary: string;
  at: { lat: number; lon: number; time: number };
}

const FT = 0.3048;

/** WMO weather code in Korean. */
export function weatherText(code: number) {
  if (code >= 95) return '뇌우';
  if (code >= 85) return '소낙눈';
  if (code >= 80) return '소나기';
  if (code >= 71) return code >= 75 ? '많은 눈' : '눈';
  if (code >= 61) return code >= 65 ? '강한 비' : code >= 63 ? '비' : '약한 비';
  if (code >= 51) return '이슬비';
  if (code >= 45) return '안개';
  if (code >= 3) return '흐림';
  if (code >= 2) return '구름 조금';
  if (code >= 1) return '대체로 맑음';
  return '맑음';
}

const cache = new Map<string, { t: number; p: Promise<LiveWeather> }>();
/** Cached for 10 minutes per ~10 km cell (the menu asks for the same airports repeatedly). */
export function liveWeatherCached(lat: number, lon: number): Promise<LiveWeather> {
  const k = `${lat.toFixed(1)},${lon.toFixed(1)}`;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.t < 10 * 60_000) return hit.p;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  const p = fetchLiveWeather(lat, lon, ctl.signal).finally(() => clearTimeout(timer));
  p.catch(() => cache.delete(k));
  cache.set(k, { t: Date.now(), p });
  return p;
}

export async function fetchLiveWeather(lat: number, lon: number, signal?: AbortSignal): Promise<LiveWeather> {
  const cur = ['temperature_2m', 'dew_point_2m', 'pressure_msl', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m',
    'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high', 'visibility', 'precipitation', 'weather_code'];
  const hourly = ['cape', ...LEVELS.flatMap(l => [`wind_speed_${l}hPa`, `wind_direction_${l}hPa`, `geopotential_height_${l}hPa`, `temperature_${l}hPa`])];
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}`
    + `&current=${cur.join(',')}&hourly=${hourly.join(',')}&wind_speed_unit=kn&forecast_hours=1&timezone=GMT`;
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`Open-Meteo ${r.status}`);
  const j = await r.json() as { current: Record<string, number>; hourly: Record<string, (number | null)[]> };
  const c = j.current, h = (k: string) => j.hourly?.[k]?.[0] ?? null;

  // winds aloft by pressure level (only levels above the ground)
  const surfaceHgt = 0;
  const winds: WindLevel[] = [];
  for (const l of LEVELS) {
    const z = h(`geopotential_height_${l}hPa`), s = h(`wind_speed_${l}hPa`), d = h(`wind_direction_${l}hPa`);
    if (z === null || s === null || d === null || z < surfaceHgt + 50) continue;
    winds.push({ h: z, dir: d, spd: s, t: h(`temperature_${l}hPa`) ?? undefined });
  }
  winds.sort((a, b) => a.h - b.h);

  // ---- turbulence ----
  const turb: TurbLayer[] = [];
  const reasons: string[] = [];
  const wind = c.wind_speed_10m ?? 0, gust = Math.max(c.wind_gusts_10m ?? 0, wind);
  // mechanical / boundary layer: strong surface wind and gust spread
  const mech = clamp((gust - wind) / 35 + Math.max(0, wind - 12) / 60, 0, 1);
  if (mech > 0.05) { turb.push({ base: 0, top: 1500, agl: true, intensity: mech }); if (mech > 0.2) reasons.push('지상풍·돌풍'); }
  // convection: CAPE and thunderstorm/shower weather codes
  const cape = h('cape') ?? 0, wx = c.weather_code ?? 0;
  const storm = wx >= 95 ? 1 : wx >= 80 ? 0.45 : 0;
  const conv = clamp(Math.max(cape - 300, 0) / 2500 + storm * 0.6, 0, 1);
  if (conv > 0.08) { turb.push({ base: 300, top: wx >= 95 ? 12000 : 6000, agl: true, intensity: conv }); reasons.push(wx >= 95 ? '뇌우' : '대류(적운)'); }
  // clear-air turbulence: vertical wind shear between pressure levels (kt per 1000 ft)
  for (let i = 1; i < winds.length; i++) {
    const a = winds[i - 1], b = winds[i];
    const dv = vecDiff(a, b), dz = (b.h - a.h) / FT / 1000;
    const shear = dz > 0 ? dv / dz : 0;
    const k = clamp((shear - 4) / 7, 0, 1) * (Math.max(a.spd, b.spd) > 50 ? 1 : 0.6);
    if (k > 0.08) { turb.push({ base: a.h, top: b.h, agl: false, intensity: k }); if (k > 0.25) reasons.push('윈드시어(제트기류)'); }
  }

  // ---- clouds ----
  const t = c.temperature_2m ?? 15, td = c.dew_point_2m ?? t - 8;
  const lcl = clamp((t - td) * 125, 150, 3000); // cumulus base (m AGL) from the dew-point spread
  const clouds: CloudLayer[] = [];
  const cov = (p: number | undefined) => clamp((p ?? 0) / 100, 0, 1);
  if (cov(c.cloud_cover_low) > 0.05) clouds.push({ base: lcl, top: lcl + (conv > 0.3 ? 3500 : 900), cover: cov(c.cloud_cover_low) });
  if (cov(c.cloud_cover_mid) > 0.05) clouds.push({ base: 3500, top: 4500, cover: cov(c.cloud_cover_mid) });
  if (cov(c.cloud_cover_high) > 0.05) clouds.push({ base: 8500, top: 9300, cover: cov(c.cloud_cover_high) * 0.6 });

  const precipMm = c.precipitation ?? 0;
  const upper = winds.find(x => x.h > 8500) ?? winds.at(-1);
  const w: WeatherState = {
    windDir: c.wind_direction_10m ?? 0, windSpd: wind, gust,
    windAloftDir: upper?.dir ?? c.wind_direction_10m ?? 0, windAloftSpd: upper?.spd ?? wind,
    turbulence: 0, turbLayers: turb, windsAloft: winds,
    visibility: clamp(c.visibility ?? 30000, 200, 60000),
    dT: t - 15, qnh: c.pressure_msl ?? 1013.25,
    clouds, precip: (precipMm > 4 ? 3 : precipMm > 1 ? 2 : precipMm > 0.05 ? 1 : 0) as WeatherState['precip'],
  };
  const worst = turb.reduce((m, x) => Math.max(m, x.intensity), 0);
  const level = worst > 0.6 ? '심한 난기류' : worst > 0.35 ? '보통 난기류' : worst > 0.12 ? '약한 난기류' : '난기류 없음';
  const cat = turb.filter(x => !x.agl && x.intensity > 0.2);
  const where = cat.length ? ` FL${Math.round(Math.min(...cat.map(x => x.base)) / FT / 100)}–FL${Math.round(Math.max(...cat.map(x => x.top)) / FT / 100)}` : '';
  const summary = `실시간 기상: 바람 ${Math.round(w.windDir)}°/${Math.round(wind)}kt${gust > wind + 5 ? ` 돌풍 ${Math.round(gust)}kt` : ''} · QNH ${Math.round(w.qnh)} · ${level}${where}${reasons.length ? ` (${[...new Set(reasons)].join(', ')})` : ''}`;
  const jetLvl = winds.reduce<WindLevel | null>((m, x) => (!m || x.spd > m.spd ? x : m), null);
  const report: WxReport = {
    temp: t, dew: td, qnh: w.qnh, windDir: w.windDir, wind, gust, vis: w.visibility, code: wx,
    low: c.cloud_cover_low ?? 0, mid: c.cloud_cover_mid ?? 0, high: c.cloud_cover_high ?? 0, cape,
    jet: jetLvl && jetLvl.spd >= 60 ? { spd: jetLvl.spd, dir: jetLvl.dir, fl: Math.round(jetLvl.h / FT / 100) } : null,
  };
  return { w, report, summary, at: { lat, lon, time: Date.now() } };
}

/** One-line report: "138°/12kt 시정 4.7km 이슬비 · 10.9°C/8.2 · QNH 1020 · 구름 하 24% 중 46% 상 97% · 제트 266°/110kt FL340" */
export function reportLine(r: WxReport) {
  const vis = r.vis >= 10000 ? '10km+' : `${(r.vis / 1000).toFixed(1)}km`;
  return `${String(Math.round(r.windDir)).padStart(3, '0')}°/${Math.round(r.wind)}kt${r.gust > r.wind + 5 ? ` G${Math.round(r.gust)}` : ''} · 시정 ${vis} · ${weatherText(r.code)}`
    + ` · ${r.temp.toFixed(0)}°C/${r.dew.toFixed(0)} · QNH ${Math.round(r.qnh)}`
    + ` · 구름 하${Math.round(r.low)}% 중${Math.round(r.mid)}% 상${Math.round(r.high)}%`
    + (r.jet ? ` · 제트기류 ${Math.round(r.jet.dir)}°/${Math.round(r.jet.spd)}kt FL${r.jet.fl}` : '');
}

function vecDiff(a: WindLevel, b: WindLevel) {
  const r = Math.PI / 180;
  const ax = a.spd * Math.sin(a.dir * r), ay = a.spd * Math.cos(a.dir * r), bx = b.spd * Math.sin(b.dir * r), by = b.spd * Math.cos(b.dir * r);
  return Math.hypot(ax - bx, ay - by);
}
function clamp(v: number, a: number, b: number) { return Math.min(b, Math.max(a, v)); }
