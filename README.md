# SkyLine Flight Simulator (Unreal Engine 5)

실제 지구 위에서, 실제 기체 모델과 **실제 항공사 도색**으로, 직접 만든 6자유도 비행역학 엔진을 타고 나는 비행 시뮬레이터입니다.
두 가지 버전이 있습니다.

- **웹 버전 (GitHub Pages)** — 설치 없이 아이패드 Safari·PC 브라우저에서 바로: **https://applefallingfromtree123.github.io/Flight-simulator/**
  (아이패드: Safari로 열고 공유 → "홈 화면에 추가" 하면 앱처럼 전체 화면으로 실행됩니다. 터치 조종 지원)
- **Unreal Engine 5 버전** (`Unreal/SkyLine`) — PC 고품질 버전. Mac + Xcode가 있으면 아이패드 네이티브 앱으로도 빌드 가능.

두 버전 모두 **자유 비행 · 커리어 · 액티비티(착륙 챌린지/디스커버리 비행)** 를 지원합니다.
웹 버전도 언리얼 버전과 같은 **FlightGear 실제 3D 기체 모델과 실제 항공사 도색**(기종 목록에 **FG** 표시)을 쓰며, 랜딩기어 접힘·플랩 전개·프로펠러/로터 회전이 움직입니다. 조종석 시점에서는 **실제 조종석 모델**이 보이고, 그 화면(PFD·ND·EICAS)에 계기가 실시간으로 그려집니다.
변환된 모델은 `web-aircraft` 브랜치에 있고 Pages 배포 때 `public/aircraft` 로 들어갑니다. 다시 만들기: `npm run aircraft` → `npm run aircraft:web` (Python + Pillow) → 결과를 `web-aircraft` 브랜치에 커밋.
웹 버전 개발: `npm install` → `npm run dev` (빌드 `npm run build`, 비행역학 테스트 `npm test`). `main` 또는 이 브랜치에 push하면 GitHub Actions가 Pages로 자동 배포합니다.

## 게임 모드 (MSFS 2024 스타일)

| 모드 | 내용 |
|---|---|
| **자유 비행** | 기종·도색·출발/도착 공항·시작 위치(활주로 / 콜드 앤 다크 / 최종 접근 / 순항)·날씨·시간을 골라 자유롭게 |
| **커리어** | 학생 조종사(SPL) → PPL → CPL → ATPL → 대형기 기장. 현재 공항에서 실제 공항으로 가는 의뢰(여객·화물·페리·관광·응급)를 받아 비행하고, 도착 후 정지 + 파킹브레이크로 완료. 접지율·G·과속·테일스트라이크로 보수 정산, 경험치로 승급하면 더 큰 기종이 열립니다. 돈·평판·비행시간·로그북은 자동 저장 |
| **액티비티** | **착륙 챌린지** 10종 (김포, 제주 측풍, 세인트마틴 마호 비치, 인스브루크, 마데이라, 지브롤터, 파로, 루클라, 사바, 샌프란시스코 야간) — 접지율·중심선·접지 지점·속도·뱅크로 1000점 채점, S~D 등급 · **디스커버리 비행** 10종 (서울 한강, 뉴욕 헬기, 그랜드 캐니언, 후지산, 마터호른, 두바이, 리우, 하와이, 파리, 시드니) |

| 계층 | 구현 |
|---|---|
| 지구 | **Cesium for Unreal** — Google 실사 3D 타일(포토그래메트리 도시·지형, MSFS와 같은 방식) 또는 Cesium World Terrain + Bing 위성사진 |
| 기체 | **FlightGear FGAddon의 실제 3D 모델** (조종석 포함) → 자체 변환기 `tools/fgconv`로 glTF 변환, 게임이 실행 중에 직접 불러옴 |
| 도색 | FlightGear 커뮤니티의 **실제 항공사 리버리 텍스처** (대한항공, ANA, 루프트한자, 에미레이트, 아메리칸, 에어캐나다 …) |
| 비행역학 | 자체 6-DOF 엔진 (C++17, 엔진 독립 모듈 `SkyLineSim`) — 기체 제원에서 공력계수 도출, 지면효과, 실속, 압축성, 착륙장치, 헬기 로터 |
| 비행제어 | 에어버스 Normal Law, 보잉 C*U, 전투기 G-command, 헬기 SAS, 오토파일럿 (HDG/LNAV/LOC/GS/ALT/FLC/VS/FLARE/ROLLOUT/TOGA), 오토스로틀, **CAT III 자동착륙** |
| 계기 | PFD (자세·속도/고도 테이프·FMA·ILS), ND (경로·활주로), 엔진/구성 표시 — **3D 조종석의 실제 디스플레이에 실시간 표시**, 외부 시점에선 화면 오버레이 · 클릭 가능한 MCP 패널 |
| 애니메이션 | FlightGear 애니메이션을 해석해 **랜딩기어 접힘/펼침, 플랩·슬랫 전개**, 프로펠러·팬·헬기 로터 회전 |
| 사운드 | 녹음 파일 없이 실시간 합성 — 터보팬 휘인·배기음, 피스톤/터보프롭 하모닉, 로터 블레이드 슬랩, 풍절음, 활주 소음, 실속 경고 |
| 조명 | 항법등(적/녹/백), 충돌방지 비컨, 스트로브, 착륙등 (야간 비행) |
| 공항 | OurAirports 9,560개 공항·활주로 (퍼블릭 도메인) |

## 1. 준비물

- **Unreal Engine 5.5** 이상 (Epic Games Launcher)
- **Cesium for Unreal** 플러그인 — Epic Launcher → Fab(마켓플레이스)에서 "Cesium for Unreal" 검색 → 엔진에 설치 (무료)
- **Visual Studio 2022** (C++ 게임 개발 워크로드) — 프로젝트가 C++이라 처음 열 때 컴파일이 필요합니다
- **Node.js 20+** 와 **git** — 기체 변환용
- (권장) **Cesium ion 무료 계정** — https://ion.cesium.com/signup 에서 이메일로 가입 → Access Token 복사

## 2. 기체 변환 (한 번만)

저장소 루트에서:

```bash
npm run aircraft                    # 카탈로그의 모든 기체 (Windows: Convert-Aircraft.bat 더블클릭)
npm run aircraft -- b777-300er a380 # 원하는 기체만
```

FlightGear 저장소에서 기체를 내려받아(`.fgcache/`) `Unreal/SkyLine/Aircraft/<기체>/` 에
`<기체>.glb` + `Liveries/*.png` + `manifest.json` 을 만듭니다. 변환 결과물은 용량이 커서 git에 올리지 않습니다.
변환할 기체 목록·기본 도색은 `tools/fgconv/catalog.json` 에서 바꿀 수 있습니다.

## 3. 실행 (PC)

1. `Unreal/SkyLine/SkyLine.uproject` 더블클릭 → "모듈을 빌드하시겠습니까?" → **예**
   (또는 우클릭 → Generate Visual Studio project files → `SkyLine.sln` 에서 `SkyLineEditor` 빌드)
2. 에디터가 처음 열릴 때 `Content/Python/init_unreal.py` 가 기체용 기본 머티리얼을 자동으로 만듭니다.
3. Cesium ion 토큰: 에디터 상단 **Cesium** 패널에서 로그인하거나, 게임 메뉴의 "지구 데이터" 칸에 붙여넣고 저장.
4. **Play** (또는 Standalone Game). 메뉴에서 기종 → 도색 → 출발/도착 공항 → 시작 위치 → **비행 시작**.

> 에디터 Play 중에는 Esc가 플레이를 종료하므로 메뉴는 **M** 키를 쓰세요.

## 4. 아이패드에서 실행하기

Apple 정책상 iOS/iPadOS 앱은 **Mac + Xcode** 로만 빌드·설치할 수 있습니다 (Windows 불가).

1. Mac에 Unreal Engine 5.5, **Xcode 15+**, Cesium for Unreal 설치. Xcode → Settings → Accounts 에 Apple ID 추가 (무료 계정도 7일짜리 개인 설치 가능, 유료 개발자 계정이면 1년).
2. 아이패드용으로 가볍게 기체 변환 (텍스처 1024px, 도색 수 제한, 아이패드에 적합한 22개 기체만):
   ```bash
   npm run aircraft:ipad
   ```
3. 에디터에서 Project Settings → Platforms → iOS → **Bundle Identifier** 를 본인 것으로 (예: `com.<이름>.skyline`), Signing에서 Team 선택.
4. 아이패드를 USB로 연결 → 에디터 상단 **Platforms → iOS → Package Project** (또는 Launch 버튼으로 바로 설치).
5. 아이패드 설정 → 일반 → VPN 및 기기 관리 → 개발자 앱 신뢰.

아이패드에서는 자동으로 **터치 조종**이 켜지고 그래픽 품질이 모바일용으로 낮아집니다 (Lumen·가상 섀도·볼류메트릭 구름 끄기, 3D 타일 해상도 조절 — `Config/DefaultDeviceProfiles.ini`).
권장: M1 이상 아이패드 Pro/Air. PC에서 **F9** 로 터치 UI를 미리 볼 수 있습니다.

### 터치 조작

| 화면 | 동작 |
|---|---|
| 오른쪽 아래 원 (요크) | 드래그 = 피치/롤, 놓으면 중앙 복귀 |
| 왼쪽 세로 막대 | 스로틀 |
| 아래 가로 막대 | 러더 / 지상 조향 |
| 버튼 | 기어 · 플랩 ↑↓ · 스포일러 · 브레이크(누른 채) · 파킹 · AP · A/THR · APP · 시점 · 엔진 · 메뉴 |
| 빈 화면 드래그 / 두 손가락 | 둘러보기 / 줌 · MCP 숫자 탭 |

## 조작 (키보드)

| 키 | 동작 |
|---|---|
| ↑↓ / W S | 피치 (↑ = 기수 내림, 요크처럼) |
| ←→ / A D | 롤 |
| Q E | 러더 |
| F3·PgUp / F2·PgDn | 스로틀 증가 / 감소 · F4 최대 · F1 아이들 |
| R (누른 채) | 역추력 |
| Num1 / Num7 | 피치 트림 (기수 올림 / 내림) |
| F7 ] / F6 [ | 플랩 내림 / 올림 |
| G | 랜딩기어 |
| / · Shift+/ | 스피드브레이크 · 그라운드 스포일러 암 |
| . (누른 채) | 브레이크 · P 파킹브레이크 · B 오토브레이크 |
| Ctrl+E | 엔진 자동 시동/정지 |
| Z · T · L · Insert | AP · A/THR · APP(ILS 접근) · TOGA |
| V · C | 시점 전환 · 조종석 |
| 마우스 오른쪽 드래그 / 휠 | 둘러보기 / 줌 (MCP 숫자 위에서 휠 = 값 조절) |
| Tab · Pause · M · I · F9 · F10 | 시뮬 속도 · 일시정지 · 메뉴 · 계기 표시 · 터치 UI · 도움말 |

게임패드(XInput): 왼스틱 조종, 오른스틱 러더/스로틀, 트리거 브레이크, Y 기어, 십자키 플랩, B AP, X 파킹브레이크.

## 자동착륙 해보기

메뉴에서 도착 공항을 고르고 시작 위치를 **최종 접근 10nm**로 하면 ILS가 암(arm)된 상태로 시작합니다.
LOC → G/S 캡처 → 50ft 부근 FLARE → 접지 → ROLLOUT(중심선 유지, 오토브레이크)까지 자동으로 진행됩니다.
다른 시작 위치에서는 MCP의 **APP** 버튼(또는 L)으로 접근을 암하고 AP를 켜면 됩니다.

## 구조

```
Unreal/SkyLine/
  SkyLine.uproject
  Source/SkyLineSim/     비행역학·비행제어 (엔진 독립 C++17, tests/sim 에서 헤드리스 테스트)
  Source/SkyLine/        Unreal 게임 코드: 기체 로더(GLB→StaticMesh, 도색 교체), 폰, 게임모드(Cesium 지구·태양·구름),
                         메뉴(Slate: 자유비행/커리어/액티비티), 계기(HUD), 터치 조종, 커리어 저장, 미션 채점
  Content/Python/        에디터 시작 시 머티리얼 자동 생성
  Data/                  공항·항법시설 DB
  Aircraft/              (변환 결과, git 제외)
tools/fgconv/            FlightGear → glTF 변환기 (AC3D/3DS 파서, 모델 XML/애니메이션/도색 해석, PNG/SGI/DDS 디코더)
tests/sim/               비행 테스트 (이륙·상승·선회·속도유지·ILS 자동착륙·FBW·헬기 호버, 30개)
```

C++ 비행 테스트: `npm run test:sim` (CMake + C++ 컴파일러 필요).

## 라이선스 / 출처

- 기체 3D 모델과 도색: FlightGear FGAddon 및 각 기체 제작자 (대부분 GPL-2.0-or-later). 변환된 파일은 원 라이선스를 따릅니다.
- 지구 데이터: Cesium ion / Google Map Tiles / Bing Maps — 각 서비스 약관을 따르며 화면 하단에 저작권 표시가 나옵니다.
- 공항 데이터: OurAirports (퍼블릭 도메인).
