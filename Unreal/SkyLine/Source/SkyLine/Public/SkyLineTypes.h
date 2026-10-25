// Launch options chosen in the menu.
#pragma once

#include "CoreMinimal.h"

enum class ESkyLineStart : uint8
{
	Runway,      // lined up on the active runway, engines running
	ColdAndDark, // on the runway threshold, everything off
	Final,       // 10 nm final, ILS armed
	Cruise,      // overhead the airport at cruise altitude
};

enum class ESkyLineView : uint8
{
	Cockpit,
	Chase,
	Orbit,
	Tower,
};

struct FSkyLineLaunch
{
	FString AircraftId = TEXT("b737-800");
	FString LiveryId;
	FString Airport = TEXT("RKSI");
	FString Runway;            // empty = best for the wind
	FString Destination = TEXT("RKPC");
	ESkyLineStart Start = ESkyLineStart::Runway;
	int32 WeatherPreset = 0;   // skyline::WeatherPreset
	float LocalHour = 10.f;    // solar time at the airport
	int32 Month = 6, Day = 21;
};
