// Career mode: pilot licences, money, reputation and a logbook, with jobs generated between real airports.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/SaveGame.h"
#include "UObject/StrongObjectPtr.h"
#include "SkyLineTypes.h"
#include "SkyLineCareer.generated.h"

USTRUCT()
struct FSkyLineLogEntry
{
	GENERATED_BODY()

	UPROPERTY() FString Date;
	UPROPERTY() FString Aircraft;
	UPROPERTY() FString From;
	UPROPERTY() FString To;
	UPROPERTY() FString Kind;
	UPROPERTY() double Minutes = 0;
	UPROPERTY() double LandingFpm = 0;
	UPROPERTY() double Pay = 0;
	UPROPERTY() bool bSuccess = true;
};

UCLASS()
class SKYLINE_API USkyLineSaveGame : public USaveGame
{
	GENERATED_BODY()

public:
	UPROPERTY() double Money = 2000;
	UPROPERTY() double Xp = 0;
	UPROPERTY() double Reputation = 50;   // 0..100
	UPROPERTY() double Hours = 0;
	UPROPERTY() int32 Flights = 0;
	UPROPERTY() FString CurrentAirport = TEXT("RKSS");
	UPROPERTY() int32 JobSeed = 1;
	UPROPERTY() TArray<FSkyLineLogEntry> Logbook;
};

class SKYLINE_API FSkyLineCareer
{
public:
	static FSkyLineCareer& Get();

	USkyLineSaveGame* Data();
	void Save();
	void Reset(const FString& HomeAirport);

	int32 Rank() const;
	static FText RankName(int32 Rank);
	static double RankXp(int32 Rank);
	/** 0 GA, 1 utility/helicopter/single turboprop, 2 regional, 3 narrow-body, 4 wide-body; -1 not in career (military). */
	static int32 AircraftTier(const FString& FdmId);
	bool CanFly(const FString& FdmId) const { const int32 T = AircraftTier(FdmId); return T >= 0 && T <= Rank(); }

	TArray<FSkyLineJob> Jobs(int32 Count = 8);
	void RefreshJobs() { Data()->JobSeed++; Save(); }
	/** Books a finished job; returns the pay actually earned. */
	void Complete(const FSkyLineJob& Job, const FSkyLineMissionResult& Result, const FString& AircraftName, double Minutes, double LandingFpm);

private:
	TStrongObjectPtr<USkyLineSaveGame> Save_;
};
