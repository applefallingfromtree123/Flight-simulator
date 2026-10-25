// Activities: hand-flown landing challenges at famous airports and discovery flights over landmarks.
#pragma once

#include "CoreMinimal.h"
#include "SkyLineTypes.h"

struct FSkyLineActivity
{
	FString Id;
	ESkyLineMissionType Type = ESkyLineMissionType::LandingChallenge;
	FText Title;
	FText Description;
	FString AircraftId, LiveryId;
	FString Airport, Runway;      // landing challenges
	double FinalNm = 4;
	int32 Weather = 0;
	float Hour = 12.f;
	double Lat = 0, Lon = 0, AglFt = 1500, Hdg = 0;  // discovery flights
};

const TArray<FSkyLineActivity>& SkyLineActivities();
/** Builds the launch options for an activity (falls back to the first converted aircraft if needed). */
FSkyLineLaunch MakeActivityLaunch(const FSkyLineActivity& A);
