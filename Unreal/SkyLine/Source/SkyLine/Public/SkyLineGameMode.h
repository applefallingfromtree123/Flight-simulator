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
	const FSkyLineMission& GetMission() const { return LastLaunch.Mission; }
	const FSkyLineMissionResult& GetResult() const { return Result; }
	/** One-line objective / progress shown at the top of the screen. */
	FString GetObjectiveText() const;
	virtual void Tick(float DeltaSeconds) override;
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
	FSkyLineMissionResult Result;
	double FlightMinutes = 0, MaxG = 1, SinceTouch = 0;
	bool bOverspeed = false, bWasAirborne = false, bTouched = false;
	int32 TouchCount = 0;
	double TouchFpm = 0, TouchXtk = 0, TouchAlong = 0, TouchSpeedErr = 0, TouchBank = 0;

	void ResetMission();
	void UpdateMission(float Dt);
	void Finish(bool bSuccess, int32 Score, const FString& Text);

	void SpawnTilesets();
	void UpdateClouds(int32 WeatherPreset);
};
