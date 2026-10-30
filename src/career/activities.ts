// Activities: hand-flown landing challenges at famous airports (scored on touchdown) and
// discovery flights that start airborne over landmarks.

export interface Activity {
  id: string;
  type: 'landing' | 'discovery';
  title: string;
  desc: string;
  ac: string;
  livery?: string;
  weather: string;
  hour: number;           // local solar hour
  // landing challenge
  apt?: string; rwy?: string; finalNm?: number;
  // discovery flight
  lat?: number; lon?: number; agl?: number; hdg?: number;
}

const L = (id: string, title: string, desc: string, ac: string, apt: string, rwy: string, finalNm: number, weather: string, hour: number): Activity =>
  ({ id, type: 'landing', title, desc, ac, apt, rwy, finalNm, weather, hour });
const D = (id: string, title: string, desc: string, ac: string, lat: number, lon: number, agl: number, hdg: number, hour: number): Activity =>
  ({ id, type: 'discovery', title, desc, ac, lat, lon, agl, hdg, weather: 'few', hour });

export const ACTIVITIES: Activity[] = [
  L('land-rkss', '김포 32L — 서울 도심 접근', '한강을 따라 내려오는 김포 32L. 기본기 점검용 무난한 착륙.', 'a320neo', 'RKSS', '32L', 4, 'clear', 17.5),
  L('land-rkpc', '제주 07 — 강한 측풍', '777로 돌풍 섞인 측풍 속 제주 착륙. 크랩 후 디크랩.', 'b777-200er', 'RKPC', '07', 5, 'xwind', 14),
  L('land-tncm', '세인트마틴 10 — 마호 비치', '해변 바로 위를 스치는 그 유명한 접근. 747로 짧은 활주로에 정확히.', 'b747-400', 'TNCM', '10', 3, 'few', 15),
  L('land-lowi', '인스브루크 26 — 알프스 계곡', '산으로 둘러싸인 계곡 속 착륙. 늦지 않게 강하하세요.', 'a320neo', 'LOWI', '26', 5, 'few', 10),
  L('land-lpma', '마데이라 05 — 절벽 위 활주로', '바다 위 기둥 활주로, 거친 바람. 737-800으로 도전.', 'b737-800', 'LPMA', '05', 4, 'xwind', 13),
  L('land-lxgb', '지브롤터 27 — 바위산 옆', '거대한 바위와 도로가 가로지르는 활주로.', 'b737-800', 'LXGB', '27', 4, 'overcast', 9),
  L('land-vqpr', '파로 15 — 히말라야', '세계에서 가장 어려운 공항 중 하나. 산 사이로 낮게.', 'a319', 'VQPR', '15', 3, 'clear', 8),
  L('land-vnlk', '루클라 06 — 에베레스트 관문', '527 m 오르막 활주로. 그랜드 캐러밴으로 한 번에.', 'c208', 'VNLK', '06', 2, 'clear', 7),
  L('land-tncs', '사바 12 — 400 m 활주로', '양 끝이 절벽인 세계에서 가장 짧은 상업 활주로. 세스나로.', 'c172-classic', 'TNCS', '12', 1.5, 'few', 11),
  L('land-rjgg', '나고야 주부 36 — 드림리프터', '787 부품을 싣고 오는 보잉 드림리프터로 주부 국제공항 착륙. 커다란 동체가 바람을 많이 받습니다.', 'b747-lcf', 'RJGG', '36', 5, 'few', 11),
  L('land-ksfo', '샌프란시스코 28L — 야간', '금문교 너머 야경 속 787 착륙.', 'b787-8', 'KSFO', '28L', 6, 'clear', 21),
  D('disc-seoul', '서울 — 한강과 남산타워', '세스나로 한강 위를 따라 서울 도심 비행.', 'c172-classic', 37.528, 127.03, 1500, 280, 17),
  D('disc-nyc', '뉴욕 — 맨해튼 헬기 투어', '허드슨 강을 따라 자유의 여신상과 마천루 사이로.', 'h135', 40.69, -74.03, 1000, 20, 18),
  D('disc-gc', '그랜드 캐니언', '협곡 위를 낮게 나는 캐러밴 관광 비행.', 'c208', 36.10, -112.12, 1500, 80, 16),
  D('disc-fuji', '후지산', '일본의 상징 후지산 주위를 선회.', 'b737-800', 35.25, 138.55, 4000, 45, 7),
  D('disc-alps', '스위스 알프스 — 마터호른', '체르마트 위 마터호른을 헬기로.', 'h135', 45.99, 7.70, 2000, 230, 12),
  D('disc-dubai', '두바이 — 부르즈 할리파', 'A380으로 세계 최고층 빌딩 옆 저공 통과.', 'a380', 25.15, 55.25, 2500, 40, 18.5),
  D('disc-rio', '리우데자네이루', '코르코바두 예수상과 슈가로프 산.', 'spitfire', -22.97, -43.17, 2000, 300, 16),
  D('disc-hawaii', '하와이 — 다이아몬드 헤드', '와이키키 해변 위 J-3 컵 유람 비행.', 'j3cub', 21.25, -157.85, 1000, 90, 9),
  D('disc-paris', '파리 — 에펠탑', '센 강을 따라 파리 시내.', 'da40', 48.84, 2.25, 1500, 60, 19),
  D('disc-sydney', '시드니 — 오페라하우스', '하버 브리지와 오페라하우스를 R44로.', 'r44', -33.84, 151.20, 1000, 120, 8),
];

/** Touchdown data recorded for a landing challenge. */
export interface Touchdown { fpm: number; xtk: number; along: number; spdErr: number; bank: number }

/** 1000-point landing score: sink rate 400, centreline 200, aim point 200, speed 100, bank 100. */
export function scoreLanding(t: Touchdown) {
  const c = (v: number, max: number) => Math.round(Math.max(0, Math.min(max, v)));
  const parts: [string, string, number][] = [
    ['접지율', `${Math.round(t.fpm)} fpm`, c(400 - Math.max(0, Math.abs(t.fpm) - 60) * 0.9, 400)],
    ['중심선', `${Math.abs(t.xtk).toFixed(1)} m`, c(200 - Math.abs(t.xtk) * 15, 200)],
    ['접지 지점', `시단에서 ${Math.round(t.along)} m`, c(200 - Math.abs(t.along - 350) * 0.35, 200)],
    ['속도', `Vref ${t.spdErr >= 0 ? '+' : ''}${Math.round(t.spdErr)} kt`, c(100 - Math.abs(t.spdErr) * 5, 100)],
    ['뱅크', `${t.bank.toFixed(1)}°`, c(100 - t.bank * 20, 100)],
  ];
  const onRunway = t.along > -30 && Math.abs(t.xtk) < 30;
  const score = onRunway ? parts.reduce((s, p) => s + p[2], 0) : 0;
  const grade = !onRunway ? 'F' : score >= 900 ? 'S' : score >= 750 ? 'A' : score >= 550 ? 'B' : score >= 350 ? 'C' : 'D';
  return { score, grade, onRunway, parts };
}

const KEY = 'sky.activities';
export function loadBest(): Record<string, number> { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; } }
export function saveBest(id: string, score: number) {
  const b = loadBest();
  if (score > (b[id] ?? -1)) { b[id] = score; try { localStorage.setItem(KEY, JSON.stringify(b)); } catch { /* ignore */ } return true; }
  return false;
}
