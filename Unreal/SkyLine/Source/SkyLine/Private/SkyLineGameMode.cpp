#include "SkyLineGameMode.h"

#include "Cesium3DTileset.h"
#include "CesiumGeoreference.h"
#include "CesiumIonRasterOverlay.h"
#include "CesiumSunSky.h"
#include "Components/VolumetricCloudComponent.h"
#include "Engine/World.h"
#include "HAL/IConsoleManager.h"
#include "EngineUtils.h"
#include "GameFramework/PlayerController.h"
#include "Materials/MaterialInterface.h"
#include "SkyLine.h"
#include "SkyLineAircraftPawn.h"
#include "SkyLineHUD.h"
#include "SkyLinePlayerController.h"
#include "SkyLineSettings.h"
#include "SkyLineCareer.h"
#include "Geo.h"
#include "Atmosphere.h"

static TAutoConsoleVariable<int32> CVarMobileQuality(
	TEXT("skyline.MobileQuality"), PLATFORM_IOS || PLATFORM_ANDROID ? 1 : 0,
	TEXT("1 = lighter terrain streaming for tablets (set by the iOS device profile)."));

namespace
{
// Cesium ion asset ids
constexpr int64 kGooglePhotorealistic = 2275207;
constexpr int64 kCesiumWorldTerrain = 1;
constexpr int64 kBingAerial = 2;
constexpr int64 kOsmBuildings = 96188;
}  // namespace

ASkyLineGameMode::ASkyLineGameMode()
{
	DefaultPawnClass = nullptr;  // the aircraft is spawned on launch
	PlayerControllerClass = ASkyLinePlayerController::StaticClass();
	HUDClass = ASkyLineHUD::StaticClass();
	PrimaryActorTick.bCanEverTick = true;
}

void ASkyLineGameMode::StartPlay()
{
	Super::StartPlay();
	UWorld* World = GetWorld();
	ACesiumGeoreference* Geo = ACesiumGeoreference::GetDefaultGeoreference(this);
	if (Geo)
	{
		// Incheon until the first flight is chosen.
		Geo->SetOriginLongitudeLatitudeHeight(FVector(126.4407, 37.4602, 30.0));
	}
	SpawnTilesets();

	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	SunSky = World->SpawnActor<ACesiumSunSky>(ACesiumSunSky::StaticClass(), FTransform::Identity, Params);
	Clouds = World->SpawnActor<AVolumetricCloud>(AVolumetricCloud::StaticClass(), FTransform::Identity, Params);
	if (Clouds)
	{
		if (UMaterialInterface* CloudMat = LoadObject<UMaterialInterface>(nullptr, TEXT("/Engine/EngineSky/VolumetricClouds/m_SimpleVolumetricCloud_Inst.m_SimpleVolumetricCloud_Inst")))
		{
			Clouds->FindComponentByClass<UVolumetricCloudComponent>()->SetMaterial(CloudMat);
		}
	}
	SetTimeOfDay(10.f, 6, 21, 126.44);
	UpdateClouds(0);
}

void ASkyLineGameMode::SpawnTilesets()
{
	for (ACesium3DTileset* T : Tilesets)
	{
		if (T)
		{
			T->Destroy();
		}
	}
	Tilesets.Reset();
	const USkyLineSettings* S = USkyLineSettings::Get();
	UWorld* World = GetWorld();
	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	auto MakeTileset = [&](int64 AssetId, const TCHAR* Label) {
		ACesium3DTileset* T = World->SpawnActor<ACesium3DTileset>(ACesium3DTileset::StaticClass(), FTransform::Identity, Params);
		T->SetTilesetSource(ETilesetSource::FromCesiumIon);
		T->SetIonAssetID(AssetId);
		if (CVarMobileQuality.GetValueOnGameThread() > 0)
		{
			T->SetMaximumScreenSpaceError(32.0);  // coarser tiles: less memory and bandwidth on iPad
		}
		if (!S->CesiumIonToken.IsEmpty())
		{
			T->SetIonAccessToken(S->CesiumIonToken);
		}
#if WITH_EDITOR
		T->SetActorLabel(Label);
#endif
		Tilesets.Add(T);
		return T;
	};

	if (S->WorldSource == ESkyLineWorldSource::GooglePhotorealistic)
	{
		if (!S->GoogleMapsApiKey.IsEmpty())
		{
			ACesium3DTileset* T = World->SpawnActor<ACesium3DTileset>(ACesium3DTileset::StaticClass(), FTransform::Identity, Params);
			T->SetTilesetSource(ETilesetSource::FromUrl);
			T->SetUrl(TEXT("https://tile.googleapis.com/v1/3dtiles/root.json?key=") + S->GoogleMapsApiKey);
			Tilesets.Add(T);
		}
		else
		{
			MakeTileset(kGooglePhotorealistic, TEXT("Google Photorealistic 3D Tiles"));
		}
	}
	else
	{
		ACesium3DTileset* Terrain = MakeTileset(kCesiumWorldTerrain, TEXT("Cesium World Terrain"));
		UCesiumIonRasterOverlay* Bing = NewObject<UCesiumIonRasterOverlay>(Terrain, TEXT("BingAerial"));
		Bing->IonAssetID = kBingAerial;
		if (!S->CesiumIonToken.IsEmpty())
		{
			Bing->IonAccessToken = S->CesiumIonToken;
		}
		Terrain->AddInstanceComponent(Bing);
		Bing->RegisterComponent();
		MakeTileset(kOsmBuildings, TEXT("Cesium OSM Buildings"));
	}
	UE_LOG(LogSkyLine, Log, TEXT("World source: %s"), S->WorldSource == ESkyLineWorldSource::GooglePhotorealistic ? TEXT("Google Photorealistic 3D Tiles") : TEXT("Cesium World Terrain + Bing"));
}

void ASkyLineGameMode::RebuildWorld()
{
	SpawnTilesets();
}

void ASkyLineGameMode::SetTimeOfDay(float LocalHour, int32 Month, int32 Day, double Longitude)
{
	if (!SunSky)
	{
		return;
	}
	// Solar time at the field: time zone from longitude, no daylight saving.
	SunSky->TimeZone = FMath::RoundToDouble(Longitude / 15.0);
	SunSky->SolarTime = LocalHour;
	SunSky->Month = Month;
	SunSky->Day = Day;
	SunSky->UseDaylightSavingTime = false;
	SunSky->UpdateSun();
}

void ASkyLineGameMode::UpdateClouds(int32 WeatherPreset)
{
	if (!Clouds)
	{
		return;
	}
	const skyline::Weather Wx = skyline::MakeWeather(static_cast<skyline::WeatherPreset>(WeatherPreset));
	UVolumetricCloudComponent* C = Clouds->FindComponentByClass<UVolumetricCloudComponent>();
	if (!C || Wx.Clouds.empty())
	{
		Clouds->SetActorHiddenInGame(true);
		return;
	}
	Clouds->SetActorHiddenInGame(false);
	const skyline::CloudLayer& L = Wx.Clouds.front();
	C->SetLayerBottomAltitude(static_cast<float>(L.Base / 1000.0));
	C->SetLayerHeight(static_cast<float>(FMath::Max(0.3, (L.Top - L.Base) / 1000.0)));
}

bool ASkyLineGameMode::Launch(const FSkyLineLaunch& Options, FString& OutError)
{
	UWorld* World = GetWorld();
	APlayerController* PC = World->GetFirstPlayerController();
	if (Aircraft)
	{
		if (PC)
		{
			PC->UnPossess();
		}
		Aircraft->Destroy();
		Aircraft = nullptr;
	}
	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	Aircraft = World->SpawnActor<ASkyLineAircraftPawn>(ASkyLineAircraftPawn::StaticClass(), FTransform::Identity, Params);
	if (!Aircraft || !Aircraft->SetupAircraft(Options, OutError))
	{
		if (Aircraft)
		{
			Aircraft->Destroy();
			Aircraft = nullptr;
		}
		return false;
	}
	if (PC)
	{
		PC->Possess(Aircraft);
	}
	LastLaunch = Options;
	ResetMission();
	Aircraft->BeginFlight(Options);
	if (const FSkyLineAirport* Apt = FAirportDatabase::Get().Find(Options.Airport))
	{
		SetTimeOfDay(Options.LocalHour, Options.Month, Options.Day, Apt->Lon);
	}
	else if (Options.Start == ESkyLineStart::Custom)
	{
		SetTimeOfDay(Options.LocalHour, Options.Month, Options.Day, Options.StartLon);
	}
	UpdateClouds(Options.WeatherPreset);
	return true;
}

// ------------------------------------------------------------------------------------------- missions

void ASkyLineGameMode::ResetMission()
{
	Result = FSkyLineMissionResult();
	FlightMinutes = 0;
	MaxG = 1;
	SinceTouch = 0;
	bOverspeed = bWasAirborne = bTouched = false;
	TouchCount = -1;
}

void ASkyLineGameMode::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	UpdateMission(DeltaSeconds);
}

FString ASkyLineGameMode::GetObjectiveText() const
{
	const FSkyLineMission& M = LastLaunch.Mission;
	if (M.Type == ESkyLineMissionType::Free || !Aircraft || !Aircraft->GetSim())
	{
		return FString();
	}
	if (M.Type == ESkyLineMissionType::CareerJob)
	{
		const FSkyLineAirport* To = FAirportDatabase::Get().Find(M.Job.To);
		const skyline::Aircraft& A = *Aircraft->GetSim();
		const double Nm = To ? skyline::Distance(skyline::LatLon{A.Lat, A.Lon}, skyline::LatLon{To->Lat, To->Lon}) / skyline::NM : 0;
		return FString::Printf(TEXT("%s 의뢰 · %s → %s · 남은 거리 %.0f NM · 보수 $%.0f  (도착 후 정지하고 파킹 브레이크)"), *M.Job.Kind, *M.Job.From, *M.Job.To, Nm, M.Job.Pay);
	}
	return M.Objective;
}

void ASkyLineGameMode::Finish(bool bSuccess, int32 Score, const FString& Text)
{
	Result.bDone = true;
	Result.bSuccess = bSuccess;
	Result.Score = Score;
	Result.Grade = !bSuccess ? TEXT("F") : Score >= 900 ? TEXT("S") : Score >= 750 ? TEXT("A") : Score >= 550 ? TEXT("B") : Score >= 350 ? TEXT("C") : TEXT("D");
	Result.Text = Text;
	if (LastLaunch.Mission.Type == ESkyLineMissionType::CareerJob)
	{
		const FSkyLineJob& J = LastLaunch.Mission.Job;
		const double Q = Score / 1000.0;
		Result.Pay = bSuccess ? FMath::RoundToDouble(J.Pay * (0.6 + 0.4 * Q)) : 0.0;
		Result.Xp = bSuccess ? FMath::RoundToDouble(J.Xp * (0.5 + 0.5 * Q)) : 0.0;
		const int32 RankBefore = FSkyLineCareer::Get().Rank();
		FSkyLineCareer::Get().Complete(J, Result, Aircraft && Aircraft->GetEntry() ? Aircraft->GetEntry()->Name : FString(), FlightMinutes, TouchFpm);
		Result.Text += FString::Printf(TEXT("\n보수 $%.0f · 경험치 +%.0f"), Result.Pay, Result.Xp);
		if (FSkyLineCareer::Get().Rank() > RankBefore)
		{
			Result.Text += TEXT("\n승급! ") + FSkyLineCareer::RankName(FSkyLineCareer::Get().Rank()).ToString() + TEXT(" — 새 기종이 열렸습니다");
		}
	}
	if (Aircraft)
	{
		Aircraft->ShowMessage(bSuccess ? TEXT("미션 완료") : TEXT("미션 실패"));
	}
}

void ASkyLineGameMode::UpdateMission(float Dt)
{
	const ESkyLineMissionType Type = LastLaunch.Mission.Type;
	if (Type == ESkyLineMissionType::Free || Type == ESkyLineMissionType::Discovery || Result.bDone || !Aircraft || !Aircraft->GetSim())
	{
		return;
	}
	if (Aircraft->IsWaitingForTerrain() || Aircraft->IsPaused())
	{
		return;
	}
	const skyline::Aircraft& A = *Aircraft->GetSim();
	const skyline::FlightControl& F = *Aircraft->GetFcs();
	if (TouchCount < 0)
	{
		TouchCount = A.TouchdownEvent;  // ignore the gear settling at spawn
	}
	FlightMinutes += Dt * Aircraft->GetTimeScale() / 60.0;
	if (!A.OnGround) bWasAirborne = true;
	MaxG = FMath::Max(MaxG, FMath::Abs(A.Nz));
	if (A.Ias / skyline::KT > A.Def.V.Vmo + 5) bOverspeed = true;
	if (A.Crashed)
	{
		Finish(false, 0, FString::Printf(TEXT("사고: %s"), UTF8_TO_TCHAR(A.CrashReason.c_str())));
		return;
	}

	// first touchdown: record the landing
	if (!bTouched && bWasAirborne && A.TouchdownEvent > TouchCount)
	{
		bTouched = true;
		TouchFpm = A.LastTouchVs / skyline::FPM;
		TouchBank = FMath::Abs(A.Phi * skyline::RAD);
		if (F.Plan.HasApproach)
		{
			const skyline::ApproachDef& Ap = F.Plan.Appr;
			const skyline::LatLon P{A.Lat, A.Lon};
			TouchXtk = skyline::CrossTrack(Ap.Thr, Ap.LocAnt, P);
			TouchAlong = skyline::AlongTrack(Ap.Thr, Ap.LocAnt, P);
		}
		TouchSpeedErr = A.Ias / skyline::KT - F.Vref();
	}
	if (bTouched) SinceTouch += Dt;

	if (Type == ESkyLineMissionType::LandingChallenge && bTouched && (A.Gs < 30 * skyline::KT || SinceTouch > 30))
	{
		const double SVs = FMath::Clamp(400.0 - FMath::Max(0.0, FMath::Abs(TouchFpm) - 60.0) * 0.9, 0.0, 400.0);
		const double SCl = FMath::Clamp(200.0 - FMath::Abs(TouchXtk) * 15.0, 0.0, 200.0);
		const double SAim = FMath::Clamp(200.0 - FMath::Abs(TouchAlong - 350.0) * 0.35, 0.0, 200.0);
		const double SSpd = FMath::Clamp(100.0 - FMath::Abs(TouchSpeedErr) * 5.0, 0.0, 100.0);
		const double SBank = FMath::Clamp(100.0 - TouchBank * 20.0, 0.0, 100.0);
		const int32 Score = FMath::RoundToInt(SVs + SCl + SAim + SSpd + SBank);
		const bool bOnRunway = TouchAlong > -30 && FMath::Abs(TouchXtk) < 30;
		Finish(bOnRunway, bOnRunway ? Score : 0, FString::Printf(
			TEXT("접지율 %.0f fpm (%d)\n중심선 %.1f m (%d)\n접지 지점: 시단에서 %.0f m (%d)\n속도 Vref %+.0f kt (%d)\n뱅크 %.1f° (%d)%s"),
			TouchFpm, FMath::RoundToInt(SVs), TouchXtk, FMath::RoundToInt(SCl), TouchAlong, FMath::RoundToInt(SAim), TouchSpeedErr,
			FMath::RoundToInt(SSpd), TouchBank, FMath::RoundToInt(SBank), bOnRunway ? TEXT("") : TEXT("\n활주로 밖 접지")));
		return;
	}
	if (Type == ESkyLineMissionType::CareerJob && bTouched && A.OnGround && A.Gs < 1.0 * skyline::KT)
	{
		bool bEnginesOff = true;
		for (const skyline::Engine& E : A.Engines) bEnginesOff &= !E.Running;
		const FSkyLineAirport* To = FAirportDatabase::Get().Find(LastLaunch.Mission.Job.To);
		const double Km = To ? skyline::Distance(skyline::LatLon{A.Lat, A.Lon}, skyline::LatLon{To->Lat, To->Lon}) / 1000.0 : 1e9;
		if ((A.ParkingBrake || bEnginesOff) && Km < 5.0)
		{
			double Q = FMath::Clamp(1.0 - FMath::Max(0.0, FMath::Abs(TouchFpm) - 150.0) / 450.0, 0.3, 1.0);
			if (MaxG > 2.5) Q -= 0.2;
			if (bOverspeed) Q -= 0.15;
			if (A.TailStrike) Q -= 0.3;
			Q = FMath::Clamp(Q, 0.1, 1.0);
			Finish(true, FMath::RoundToInt(Q * 1000), FString::Printf(TEXT("%s 도착 · 비행 %.0f분\n접지율 %.0f fpm · 최대 %.1fG%s%s"), *LastLaunch.Mission.Job.To,
				FlightMinutes, TouchFpm, MaxG, bOverspeed ? TEXT(" · 과속") : TEXT(""), A.TailStrike ? TEXT(" · 테일스트라이크") : TEXT("")));
		}
	}
}
