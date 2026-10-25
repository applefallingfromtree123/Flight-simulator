// Builds the world (Cesium globe, sun & sky, clouds) and launches flights chosen in the menu.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "SkyLineTypes.h"
#include "SkyLineGameMode.generated.h"

class ACesium3DTileset;
class ACesiumSunSky;
class ASkyLineAircraftPawn;
class AVolumetricCloud;

UCLASS()
class SKYLINE_API ASkyLineGameMode : public AGameModeBase
{
	GENERATED_BODY()

public:
	ASkyLineGameMode();

	virtual void StartPlay() override;

	/** Spawns (or respawns) the aircraft and starts the flight. Returns false with an error message on failure. */
	bool Launch(const FSkyLineLaunch& Options, FString& OutError);
	/** Recreates the terrain tilesets, e.g. after the Cesium ion token changed. */
	void RebuildWorld();
	void SetTimeOfDay(float LocalHour, int32 Month, int32 Day, double Longitude);

	const FSkyLineLaunch& GetLastLaunch() const { return LastLaunch; }
	ASkyLineAircraftPawn* GetAircraft() const { return Aircraft; }

private:
	UPROPERTY(Transient)
	TArray<TObjectPtr<ACesium3DTileset>> Tilesets;
	UPROPERTY(Transient)
	TObjectPtr<ACesiumSunSky> SunSky;
	UPROPERTY(Transient)
	TObjectPtr<AVolumetricCloud> Clouds;
	UPROPERTY(Transient)
	TObjectPtr<ASkyLineAircraftPawn> Aircraft;

	FSkyLineLaunch LastLaunch;

	void SpawnTilesets();
	void UpdateClouds(int32 WeatherPreset);
};
