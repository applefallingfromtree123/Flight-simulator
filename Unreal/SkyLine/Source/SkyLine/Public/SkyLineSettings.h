// Project/user settings: world streaming source and API credentials.
#pragma once

#include "CoreMinimal.h"
#include "Engine/DeveloperSettings.h"
#include "SkyLineSettings.generated.h"

UENUM(BlueprintType)
enum class ESkyLineWorldSource : uint8
{
	/** Google Photorealistic 3D Tiles through Cesium ion: photogrammetry cities and terrain (closest to MSFS). */
	GooglePhotorealistic,
	/** Cesium World Terrain with Bing Maps aerial imagery and OSM buildings. */
	CesiumWorldTerrainBing,
};

UCLASS(Config = Game, DefaultConfig, meta = (DisplayName = "SkyLine"))
class SKYLINE_API USkyLineSettings : public UDeveloperSettings
{
	GENERATED_BODY()

public:
	/** Cesium ion access token (free at ion.cesium.com). Empty = the token configured in the Cesium editor panel. */
	UPROPERTY(Config, EditAnywhere, Category = "World")
	FString CesiumIonToken;

	/** Optional Google Maps Platform key to stream Google 3D tiles directly instead of through Cesium ion. */
	UPROPERTY(Config, EditAnywhere, Category = "World")
	FString GoogleMapsApiKey;

	UPROPERTY(Config, EditAnywhere, Category = "World")
	ESkyLineWorldSource WorldSource = ESkyLineWorldSource::GooglePhotorealistic;

	/** Directory with converted aircraft (manifest.json + .glb + Liveries/). Relative to the project directory. */
	UPROPERTY(Config, EditAnywhere, Category = "Aircraft")
	FString AircraftDirectory = TEXT("Aircraft");

	static const USkyLineSettings* Get() { return GetDefault<USkyLineSettings>(); }
	static USkyLineSettings* GetMutable() { return GetMutableDefault<USkyLineSettings>(); }
};
