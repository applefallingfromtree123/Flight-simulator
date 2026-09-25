# SkyLine Flight Simulator

실제 지구 전체(위성영상 + 실측 지형 + 실제 공항 9,560개)를 배경으로, **직접 만든 6자유도 비행역학 엔진** 위에서 동작하는
전문가용 비행 시뮬레이터입니다. 웹 브라우저(WebGL2)에서 바로 실행됩니다.

> 캐주얼 요소 없이 실제 조종 절차 · 계기 · 자동비행 · 경고 시스템을 재현하는 데 집중했습니다.

## 실행

> ⚠️ **index.html 파일을 직접 열면(더블클릭) 실행되지 않습니다.** 브라우저 보안 정책상 웹 서버가 필요합니다.

**가장 쉬운 방법** — [Node.js LTS](https://nodejs.org) 설치 후:
- **Windows**: `start.bat` 더블클릭
- **macOS**: `start.command` 더블클릭 (처음엔 우클릭 → 열기)

자동으로 설치 → 빌드 → 브라우저가 열립니다 (`http://localhost:4173`).

**터미널**
```bash
npm install
npm start          # 빌드 후 브라우저 자동 실행 (가장 빠름)
npm run dev        # 개발 모드 http://localhost:5173
npm test           # 헤드리스 비행 테스트
```

**온라인 (설치 없이)** — `https://applefallingfromtree123.github.io/Flight-simulator/`
`.github/workflows/pages.yml`이 push마다 빌드·배포합니다. 저장소 Settings → Pages → Source는 **GitHub Actions** 로 두세요
("Deploy from a branch"로 두면 빌드되지 않은 소스가 올라가 로딩 화면에서 멈춥니다).

Chrome / Edge 최신 버전 권장 (WebGL2, 하드웨어 가속 필요). 조이스틱·HOTAS·러더 페달은 **설정 → 조이스틱** 에서 축을 할당합니다.

## 엔진 구성 — 왜 Unity/Unreal이 아닌가

요청하신 선택지 중 **"엔진을 직접 만든다"** 를 택했습니다. Unity/Unreal 프로젝트는 에디터와 수 GB의 에셋 없이는 빌드·실행할 수 없고,
MSFS처럼 *지구 전체*를 스트리밍하려면 어차피 별도의 지구 렌더링 계층이 필요하기 때문입니다.

| 계층 | 구현 |
|---|---|
| 비행역학 (FDM) | **자체 구현** — `src/sim/fdm.ts` 쿼터니언 6-DOF 강체, 120 Hz 고정 스텝 |
| 공력 모델 | **자체 구현** — `src/sim/aero.ts` 기체 제원(전장·전폭·면적·후퇴각·실속속도·순항성능)에서 양력곡선, 항력극곡선, 안정·조종 미계수, 관성모멘트를 자동 도출 |
| 엔진 | 터보팬 / 터보제트(애프터버너) / 피스톤+프로펠러 / 터보프롭 / 터보샤프트 — 스풀 지연, 고도·마하 감률, TSFC, 시동 시퀀스 |
| 비행제어 | 재래식, **에어버스 Normal Law**(C*, 경로 유지, α-prot, 뱅크 보호, flare law), **보잉 C\*U**, 전투기 G-command, 헬기 SAS — 동적 역변환(NDI) 기반 |
| 자동비행 | HDG / NAV(LNAV) / LOC / ALT / ALT\* / V/S / FLC / G/S / FLARE / ROLLOUT / TOGA, 오토스로틀(SPEED/MACH/THR CLB/IDLE/RETARD/α-floor), **CAT III 자동착륙** |
| 시스템 | 전기·APU·블리드·연료·조명·엔진 시동 절차, Master Warning/Caution, GPWS(SINK RATE, PULL UP, TOO LOW GEAR/FLAPS), 전파고도 콜아웃, 이륙 CONFIG 경고 |
| 렌더링 | CesiumJS(WebGL 지구본) 위에 자체 레이어: 지형 스트리밍·활주로 평탄화, 절차적 3D 기체 모델, 활주로/접근등/PAPI, 구름, 안개 |
| 계기 | 자체 캔버스 렌더러 — PFD, ND(ARC/ROSE/PLAN), EICAS, 아날로그 6-pack, HUD |

## 지도 (MSFS와 같은 실제 지구)

- **지형**: AWS Terrain Tiles (SRTM/GMTED 기반 전 세계 표고) 실시간 스트리밍
- **활주로 평탄화**: 실제 활주로 양 끝 좌표·표고로 지형을 정지(grading) — 물리와 렌더링이 동일한 지면 함수를 사용
- **활주로 3D 표면**: 모든 포장 활주로를 실제 좌표·폭·표고로 생성하고 ICAO 표지(시단 피아노키, 번호·L/C/R, 중심선, 접지구역, 조준점, 가장자리선) 표시
- **위성영상**: Esri World Imagery (기본, 키 불필요), **Google 위성지도** (설정에 Google Maps API 키 입력 시), 또는 **Bing Maps Aerial**(MSFS 2020과 같은 소스, Cesium ion 토큰 필요)
- **포토그래메트리 3D 도시**: 설정에서 **Google Photorealistic 3D Tiles** 활성화 (Google Maps Platform API 키 필요) — MSFS의 실사 도시와 가장 유사
- **공항 DB**: OurAirports(퍼블릭 도메인) 대형·중형 공항 + 포장 활주로 소형 공항 9,560개, VOR/NDB 11,008개 (`npm run data` 로 갱신)
- **실시간 태양 위치 · 대기 산란 · 야간 조명**, 기상 프리셋(CAVOK, 적운, 흐림, 뇌우, CAT III 안개, 강한 측풍), 바람 고도 프로파일·돌풍·난류

## 기종 (65종)

- **협동체**: A320neo, A319, A321neo, A220-300, 737-700, 737-800, 737 MAX 8, 757-200, C919
- **광동체**: A330-900neo, A340-600, A350-900, A350-1000, A380-800, 747-400, 747-8, 767-300ER, 777-200ER, 777-300ER, 787-8/-9/-10, MD-11, Concorde
- **리저널**: E175, E195-E2, CRJ900, Dash 8-400, ATR 72-600
- **비즈니스 제트**: Citation CJ4, Citation Longitude, HondaJet, Phenom 300E, G650ER, Global 7500
- **터보프롭**: King Air 350i, TBM 940, PC-12 NGX, Grand Caravan, C-130J
- **GA**: C152, C172S(G1000), C172N(아날로그), C182T, PA-28, SR22T, DA40, DA62, Baron G58, Bonanza G36, Extra 330LX, J-3 Cub
- **군용/빈티지**: F-16C, F/A-18E, F-35A, Typhoon, P-51D, Spitfire Mk IX, DC-3
- **헬리콥터**: H135, H125, Bell 407, R44, AW139, UH-60M, CH-47F
- **글라이더**: ASK 21

각 기종은 실제 제원(치수·중량·추력/출력·V-speed·순항 성능)으로 정의되고, 공력 계수는 이 값에서 자동 도출·보정되어
실속속도, 이륙 거리, 상승률, 순항 속도가 실제와 비슷하게 나옵니다. 3D 외형도 같은 제원으로 절차적으로 생성합니다.

## 조작 (요약)

| 키 | 기능 |
|---|---|
| 방향키 / Q·E | 피치·롤 / 러더 |
| F1–F4, PgUp/PgDn | 스로틀 (헬기: 콜렉티브), 아이들에서 F2 유지 = 역추진 |
| F5–F8 · G · / | 플랩 · 기어 · 스피드브레이크 |
| Z · Shift+Z | 오토파일럿 · 오토스로틀 |
| H N U J V K | HDG · NAV · APP · ALT · V/S · FLC |
| Ctrl+E | 자동 시동 |
| 1–6 | 조종석 · HUD · 외부 · 관제탑 · 플라이바이 · 자유 시점 |
| (터치) | iPad·태블릿: 화면 조종간·스로틀·러더·버튼 자동 표시 (상단 `터치` 버튼으로 켜기/끄기) |
| O · C · M | 시스템 패널 · 체크리스트 · 항법 지도 |

전체 목록은 게임 메뉴의 **조작법** 탭에 있습니다.

## 프로젝트 구조

```
src/core      수학(쿼터니언, PID), 측지(대권, 편차)
src/sim       FDM, 공력 도출, 엔진, 비행제어/자동비행, 시스템, 기종 DB
src/world     Cesium 장면, 지형 스트리밍, 공항 DB, 절차적 glTF 기체 모델
src/avionics  PFD / ND / EICAS / 6-pack / HUD
src/ui        메뉴(비행계획), 조종석 패널, 체크리스트
src/input     키보드·게임패드
src/audio     합성 엔진음, 경고음, 음성 콜아웃
tests         헤드리스 비행 테스트
tools         공항/항법 데이터 빌드 스크립트
```

## 한계 (솔직하게)

- MSFS 2024 수준의 개별 기종 3D 조종석(스위치 하나하나 클릭)과 전 세계 포토그래메트리는 수십 명·수년 규모의 상용 데이터가 필요합니다.
  여기서는 2D 글래스/아날로그 계기 패널 + 오버헤드 시스템 창으로 절차를 재현하고, 실사 3D 도시는 Google 3D Tiles(키 필요)로 대체합니다.
- ILS 주파수 데이터는 공개 DB에 없어, 선택한 도착 활주로에 3° 가상 ILS를 생성합니다. SID/STAR, ATC, AI 트래픽은 없습니다.

데이터 출처: OurAirports (Public Domain), AWS Terrain Tiles, Esri World Imagery, Cesium Natural Earth II.
