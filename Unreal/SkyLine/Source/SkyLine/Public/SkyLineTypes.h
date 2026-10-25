// Launch options chosen in the menu.
#pragma once

#include "CoreMinimal.h"

enum class ESkyLineStart : uint8
{
	Runway,      // lined up on the active runway, engines running
	ColdAndDark, // on the runway threshold, everything off
	Final,       // on final to the destination runway (ILS armed when the autopilot is used)
	Cruise,      // overhead the airport at cruise altitude
	Custom,      // airborne at an arbitrary position (discovery flights)
};

enum class ESkyLineMissionType : uint8
{
	Free,
	CareerJob,
	LandingChallenge,
	Discovery,
};

/** A career job between two real airports. */
struct FSkyLineJob
{
	FString Id;
	FString Kind;        // 여객, 화물, 페리, 관광, 응급
	FString From, To;    // ICAO
	double DistanceKm = 0;
	double Pay = 0;
	double Xp = 0;
	int32 Tier = 0;      // minimum aircraft tier
	int32 Load = 0;      // passengers or kg
};

/** What the current flight is for and how it is scored. */
struct FSkyLineMission
{
	ESkyLineMissionType Type = ESkyLineMissionType::Free;
	FString Title;
	FString Objective;
	FSkyLineJob Job;
};

struct FSkyLineMissionResult
{
	bool bDone = false;
	bool bSuccess = false;
	int32 Score = 0;
	FString Grade;
	FString Text;
	double Pay = 0, Xp = 0;
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
	// Final start: distance and whether the autopilot flies it (landing challenges are hand-flown)
	double FinalNm = 10;
	bool bAutopilotOnFinal = true;
	// Custom start
	double StartLat = 0, StartLon = 0, StartAglFt = 1500, StartHdg = 0;
	FSkyLineMission Mission;
};
