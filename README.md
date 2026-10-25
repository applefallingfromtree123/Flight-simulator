# SkyLine Flight Simulator (Unreal Engine 5)

실제 지구 위에서, 실제 기체 모델과 **실제 항공사 도색**으로, 직접 만든 6자유도 비행역학 엔진을 타고 나는 PC용 비행 시뮬레이터입니다.
Unreal Engine 5(PC) 버전입니다. **아이패드에서는 실행되지 않으므로**, 기존 웹 버전(`src/`, https://applefallingfromtree123.github.io/Flight-simulator/)도 그대로 유지합니다.

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

## 3. 실행

1. `Unreal/SkyLine/SkyLine.uproject` 더블클릭 → "모듈을 빌드하시겠습니까?" → **예**
   (또는 우클릭 → Generate Visual Studio project files → `SkyLine.sln` 에서 `SkyLineEditor` 빌드)
2. 에디터가 처음 열릴 때 `Content/Python/init_unreal.py` 가 기체용 기본 머티리얼을 자동으로 만듭니다.
3. Cesium ion 토큰: 에디터 상단 **Cesium** 패널에서 로그인하거나, 게임 메뉴의 "지구 데이터" 칸에 붙여넣고 저장.
4. **Play** (또는 Standalone Game). 메뉴에서 기종 → 도색 → 출발/도착 공항 → 시작 위치 → **비행 시작**.

> 에디터 Play 중에는 Esc가 플레이를 종료하므로 메뉴는 **M** 키를 쓰세요.

## 조작

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
| Tab · Pause · M · I · F10 | 시뮬 속도 · 일시정지 · 메뉴 · 계기 표시 · 도움말 |

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
                         메뉴(Slate), 계기(HUD)
  Content/Python/        에디터 시작 시 머티리얼 자동 생성
  Data/                  공항·항법시설 DB
  Aircraft/              (변환 결과, git 제외)
tools/fgconv/            FlightGear → glTF 변환기 (AC3D/3DS 파서, 모델 XML/애니메이션/도색 해석, PNG/SGI/DDS 디코더)
tests/sim/               비행 테스트 (이륙·상승·선회·속도유지·ILS 자동착륙·FBW·헬기 호버, 30개)
```

비행 테스트: `npm test` (CMake + C++ 컴파일러 필요).

## 라이선스 / 출처

- 기체 3D 모델과 도색: FlightGear FGAddon 및 각 기체 제작자 (대부분 GPL-2.0-or-later). 변환된 파일은 원 라이선스를 따릅니다.
- 지구 데이터: Cesium ion / Google Map Tiles / Bing Maps — 각 서비스 약관을 따르며 화면 하단에 저작권 표시가 나옵니다.
- 공항 데이터: OurAirports (퍼블릭 도메인).
