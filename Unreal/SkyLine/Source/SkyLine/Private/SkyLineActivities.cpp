#include "SkyLineActivities.h"

#include "AircraftLibrary.h"

#define LOCTEXT_NAMESPACE "SkyLineActivities"

const TArray<FSkyLineActivity>& SkyLineActivities()
{
	static TArray<FSkyLineActivity> List;
	if (List.Num() > 0)
	{
		return List;
	}
	auto Landing = [](const TCHAR* Id, FText Title, FText Desc, const TCHAR* Ac, const TCHAR* Liv, const TCHAR* Apt, const TCHAR* Rw, double Nm, int32 Wx, float Hour) {
		FSkyLineActivity A;
		A.Id = Id; A.Type = ESkyLineMissionType::LandingChallenge; A.Title = Title; A.Description = Desc;
		A.AircraftId = Ac; A.LiveryId = Liv; A.Airport = Apt; A.Runway = Rw; A.FinalNm = Nm; A.Weather = Wx; A.Hour = Hour;
		return A;
	};
	auto Discovery = [](const TCHAR* Id, FText Title, FText Desc, const TCHAR* Ac, const TCHAR* Liv, double Lat, double Lon, double Agl, double Hdg, float Hour) {
		FSkyLineActivity A;
		A.Id = Id; A.Type = ESkyLineMissionType::Discovery; A.Title = Title; A.Description = Desc;
		A.AircraftId = Ac; A.LiveryId = Liv; A.Lat = Lat; A.Lon = Lon; A.AglFt = Agl; A.Hdg = Hdg; A.Hour = Hour;
		return A;
	};
	// ---- landing challenges (hand-flown from a short final; scored on touchdown) ----
	List.Add(Landing(TEXT("land-rkss"), LOCTEXT("L1", "김포 32L — 서울 도심 접근"), LOCTEXT("L1d", "한강을 따라 내려오는 김포 32L. 기본기 점검용 무난한 착륙."), TEXT("a320neo"), TEXT(""), TEXT("RKSS"), TEXT("32L"), 4, 0, 17.5f));
	List.Add(Landing(TEXT("land-rkpc"), LOCTEXT("L2", "제주 07 — 강한 측풍"), LOCTEXT("L2d", "대한항공 777로 돌풍 섞인 측풍 속 제주 착륙. 크랩 후 디크랩."), TEXT("b777-200er"), TEXT("KAL"), TEXT("RKPC"), TEXT("07"), 5, 5, 14.f));
	List.Add(Landing(TEXT("land-tncm"), LOCTEXT("L3", "세인트마틴 10 — 마호 비치"), LOCTEXT("L3d", "해변 바로 위를 스치는 그 유명한 접근. 747로 짧은 활주로에 정확히."), TEXT("b747-400"), TEXT("KLM"), TEXT("TNCM"), TEXT("10"), 3, 1, 15.f));
	List.Add(Landing(TEXT("land-lowi"), LOCTEXT("L4", "인스브루크 26 — 알프스 계곡"), LOCTEXT("L4d", "산으로 둘러싸인 계곡 속 착륙. 늦지 않게 강하하세요."), TEXT("a320neo-cfm"), TEXT(""), TEXT("LOWI"), TEXT("26"), 5, 1, 10.f));
	List.Add(Landing(TEXT("land-lpma"), LOCTEXT("L5", "마데이라 05 — 절벽 위 활주로"), LOCTEXT("L5d", "바다 위 기둥 활주로, 거친 바람. 737-800으로 도전."), TEXT("b737-800"), TEXT(""), TEXT("LPMA"), TEXT("05"), 4, 5, 13.f));
	List.Add(Landing(TEXT("land-lxgb"), LOCTEXT("L6", "지브롤터 27 — 바위산 옆"), LOCTEXT("L6d", "거대한 바위와 도로가 가로지르는 활주로."), TEXT("b737-800"), TEXT(""), TEXT("LXGB"), TEXT("27"), 4, 2, 9.f));
	List.Add(Landing(TEXT("land-vqpr"), LOCTEXT("L7", "파로 15 — 히말라야"), LOCTEXT("L7d", "세계에서 가장 어려운 공항 중 하나. 산 사이로 낮게."), TEXT("a320-cfm"), TEXT(""), TEXT("VQPR"), TEXT("15"), 3, 0, 8.f));
	List.Add(Landing(TEXT("land-vnlk"), LOCTEXT("L8", "루클라 06 — 에베레스트 관문"), LOCTEXT("L8d", "527 m 오르막 활주로. 그랜드 캐러밴으로 한 번에."), TEXT("c208"), TEXT(""), TEXT("VNLK"), TEXT("06"), 2, 0, 7.f));
	List.Add(Landing(TEXT("land-tncs"), LOCTEXT("L9", "사바 12 — 400 m 활주로"), LOCTEXT("L9d", "양 끝이 절벽인 세계에서 가장 짧은 상업 활주로. 세스나로."), TEXT("c172"), TEXT(""), TEXT("TNCS"), TEXT("12"), 1.5, 1, 11.f));
	List.Add(Landing(TEXT("land-ksfo"), LOCTEXT("L10", "샌프란시스코 28L — 야간"), LOCTEXT("L10d", "금문교 너머 야경 속 787 착륙."), TEXT("b787-8"), TEXT(""), TEXT("KSFO"), TEXT("28L"), 6, 0, 21.f));
	// ---- discovery flights (free flight from an airborne start) ----
	List.Add(Discovery(TEXT("disc-seoul"), LOCTEXT("D1", "서울 — 한강과 남산타워"), LOCTEXT("D1d", "세스나로 한강 위를 따라 서울 도심 비행."), TEXT("c172"), TEXT(""), 37.528, 127.03, 1500, 280, 17.f));
	List.Add(Discovery(TEXT("disc-nyc"), LOCTEXT("D2", "뉴욕 — 맨해튼 헬기 투어"), LOCTEXT("D2d", "허드슨 강을 따라 자유의 여신상과 마천루 사이로."), TEXT("h135"), TEXT(""), 40.69, -74.03, 1000, 20, 18.f));
	List.Add(Discovery(TEXT("disc-gc"), LOCTEXT("D3", "그랜드 캐니언"), LOCTEXT("D3d", "협곡 위를 낮게 나는 캐러밴 관광 비행."), TEXT("c208"), TEXT(""), 36.10, -112.12, 1500, 80, 16.f));
	List.Add(Discovery(TEXT("disc-fuji"), LOCTEXT("D4", "후지산"), LOCTEXT("D4d", "일본의 상징 후지산 주위를 선회."), TEXT("b737-800"), TEXT(""), 35.25, 138.55, 4000, 45, 7.f));
	List.Add(Discovery(TEXT("disc-alps"), LOCTEXT("D5", "스위스 알프스 — 마터호른"), LOCTEXT("D5d", "체르마트 위 마터호른을 헬기로."), TEXT("h135"), TEXT(""), 45.99, 7.70, 2000, 230, 12.f));
	List.Add(Discovery(TEXT("disc-dubai"), LOCTEXT("D6", "두바이 — 부르즈 할리파"), LOCTEXT("D6d", "A380으로 세계 최고층 빌딩 옆 저공 통과."), TEXT("a380"), TEXT(""), 25.15, 55.25, 2500, 40, 18.5f));
	List.Add(Discovery(TEXT("disc-rio"), LOCTEXT("D7", "리우데자네이루"), LOCTEXT("D7d", "코르코바두 예수상과 슈가로프 산."), TEXT("spitfire"), TEXT(""), -22.97, -43.17, 2000, 300, 16.f));
	List.Add(Discovery(TEXT("disc-hawaii"), LOCTEXT("D8", "하와이 — 다이아몬드 헤드"), LOCTEXT("D8d", "와이키키 해변 위 J-3 컵 유람 비행."), TEXT("j3cub"), TEXT(""), 21.25, -157.85, 1000, 90, 9.f));
	List.Add(Discovery(TEXT("disc-paris"), LOCTEXT("D9", "파리 — 에펠탑"), LOCTEXT("D9d", "센 강을 따라 파리 시내."), TEXT("da40"), TEXT(""), 48.84, 2.25, 1500, 60, 19.f));
	List.Add(Discovery(TEXT("disc-sydney"), LOCTEXT("D10", "시드니 — 오페라하우스"), LOCTEXT("D10d", "하버 브리지와 오페라하우스를 R44로."), TEXT("r44"), TEXT(""), -33.84, 151.20, 1000, 120, 8.f));
	return List;
}

FSkyLineLaunch MakeActivityLaunch(const FSkyLineActivity& A)
{
	FSkyLineLaunch L;
	const FAircraftLibrary& Lib = FAircraftLibrary::Get();
	L.AircraftId = Lib.Find(A.AircraftId) || Lib.GetAircraft().Num() == 0 ? A.AircraftId : Lib.GetAircraft()[0].Id;
	L.LiveryId = A.LiveryId;
	L.WeatherPreset = A.Weather;
	L.LocalHour = A.Hour;
	L.Mission.Type = A.Type;
	L.Mission.Title = A.Title.ToString();
	if (A.Type == ESkyLineMissionType::LandingChallenge)
	{
		L.Airport = A.Airport;
		L.Destination = A.Airport;
		L.Runway = A.Runway;
		L.Start = ESkyLineStart::Final;
		L.FinalNm = A.FinalNm;
		L.bAutopilotOnFinal = false;
		L.Mission.Objective = FString::Printf(TEXT("%s 활주로 %s 에 착륙하세요 — 접지율·중심선·접지 지점·속도로 채점"), *A.Airport, *A.Runway);
	}
	else
	{
		L.Start = ESkyLineStart::Custom;
		L.StartLat = A.Lat;
		L.StartLon = A.Lon;
		L.StartAglFt = A.AglFt;
		L.StartHdg = A.Hdg;
		L.Airport = TEXT("");
		L.Mission.Objective = A.Description.ToString();
	}
	return L;
}

#undef LOCTEXT_NAMESPACE
