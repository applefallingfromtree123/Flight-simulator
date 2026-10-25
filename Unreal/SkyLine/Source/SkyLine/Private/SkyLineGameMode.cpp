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
	Aircraft->BeginFlight(Options);
	if (const FSkyLineAirport* Apt = FAirportDatabase::Get().Find(Options.Airport))
	{
		SetTimeOfDay(Options.LocalHour, Options.Month, Options.Day, Apt->Lon);
	}
	UpdateClouds(Options.WeatherPreset);
	return true;
}
