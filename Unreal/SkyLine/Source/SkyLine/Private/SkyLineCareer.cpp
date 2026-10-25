#include "SkyLineCareer.h"

#include "AirportDatabase.h"
#include "Kismet/GameplayStatics.h"
#include "Misc/DateTime.h"
#include "AircraftTypes.h"
#include "Geo.h"

#define LOCTEXT_NAMESPACE "SkyLineCareer"

namespace
{
const TCHAR* const kSlot = TEXT("SkyLineCareer");
const double kRankXp[] = {0, 400, 1500, 5000, 12000};
}  // namespace

FSkyLineCareer& FSkyLineCareer::Get()
{
	static FSkyLineCareer Instance;
	return Instance;
}

USkyLineSaveGame* FSkyLineCareer::Data()
{
	if (!Save_.IsValid())
	{
		USkyLineSaveGame* Loaded = Cast<USkyLineSaveGame>(UGameplayStatics::LoadGameFromSlot(kSlot, 0));
		if (!Loaded)
		{
			Loaded = Cast<USkyLineSaveGame>(UGameplayStatics::CreateSaveGameObject(USkyLineSaveGame::StaticClass()));
		}
		Save_.Reset(Loaded);
	}
	return Save_.Get();
}

void FSkyLineCareer::Save()
{
	UGameplayStatics::SaveGameToSlot(Data(), kSlot, 0);
}

void FSkyLineCareer::Reset(const FString& HomeAirport)
{
	Save_.Reset(Cast<USkyLineSaveGame>(UGameplayStatics::CreateSaveGameObject(USkyLineSaveGame::StaticClass())));
	Data()->CurrentAirport = HomeAirport;
	Save();
}

int32 FSkyLineCareer::Rank() const
{
	const double Xp = const_cast<FSkyLineCareer*>(this)->Data()->Xp;
	int32 R = 0;
	for (int32 I = 0; I < 5; I++)
	{
		if (Xp >= kRankXp[I]) R = I;
	}
	return R;
}

double FSkyLineCareer::RankXp(int32 Rank)
{
	return kRankXp[FMath::Clamp(Rank, 0, 4)];
}

FText FSkyLineCareer::RankName(int32 Rank)
{
	switch (Rank)
	{
		case 0: return LOCTEXT("R0", "학생 조종사 (SPL)");
		case 1: return LOCTEXT("R1", "자가용 조종사 (PPL)");
		case 2: return LOCTEXT("R2", "사업용 조종사 (CPL)");
		case 3: return LOCTEXT("R3", "운송용 조종사 (ATPL)");
		default: return LOCTEXT("R4", "대형기 기장");
	}
}

int32 FSkyLineCareer::AircraftTier(const FString& FdmId)
{
	const skyline::AircraftDef* D = skyline::FindAircraft(TCHAR_TO_UTF8(*FdmId));
	if (!D) return 0;
	using skyline::Category;
	switch (D->Cat)
	{
		case Category::GA:
		case Category::Vintage:
		case Category::Glider: return D->Cockpit == skyline::CockpitKind::Fighter ? -1 : 0;
		case Category::Helicopter:
		case Category::Bizjet: return 1;
		case Category::Turboprop: return D->Eng.N > 1 ? 2 : 1;
		case Category::Regional: return 2;
		case Category::Airliner: return 3;
		case Category::Widebody: return 4;
		case Category::Military: return -1;
	}
	return 0;
}

TArray<FSkyLineJob> FSkyLineCareer::Jobs(int32 Count)
{
	TArray<FSkyLineJob> Out;
	USkyLineSaveGame* S = Data();
	const FSkyLineAirport* From = FAirportDatabase::Get().Find(S->CurrentAirport);
	if (!From)
	{
		return Out;
	}
	const int32 R = Rank();
	// distance band and minimum destination size grow with the licence
	static const double MinKm[] = {20, 40, 120, 300, 2500};
	static const double MaxKm[] = {150, 450, 1000, 3200, 9500};
	static const int32 MinSize[] = {1, 1, 2, 2, 3};
	TArray<const FSkyLineAirport*> Candidates;
	for (const FSkyLineAirport& A : FAirportDatabase::Get().GetAirports())
	{
		if (A.Size < MinSize[R] || &A == From) continue;
		const double Km = skyline::Distance(skyline::LatLon{From->Lat, From->Lon}, skyline::LatLon{A.Lat, A.Lon}) / 1000.0;
		if (Km >= MinKm[R] && Km <= MaxKm[R]) Candidates.Add(&A);
	}
	if (Candidates.Num() == 0)
	{
		// remote field: widen the search
		for (const FSkyLineAirport& A : FAirportDatabase::Get().GetAirports())
		{
			const double Km = skyline::Distance(skyline::LatLon{From->Lat, From->Lon}, skyline::LatLon{A.Lat, A.Lon}) / 1000.0;
			if (&A != From && Km > 15 && Km < MaxKm[R] * 2) Candidates.Add(&A);
		}
	}
	FRandomStream Rng(S->JobSeed * 7919 + GetTypeHash(S->CurrentAirport));
	static const TCHAR* Kinds[] = {TEXT("여객"), TEXT("화물"), TEXT("페리"), TEXT("관광"), TEXT("응급")};
	static const double KindRate[] = {1.0, 0.85, 0.6, 0.9, 1.4};
	for (int32 I = 0; I < Count && Candidates.Num() > 0; I++)
	{
		const FSkyLineAirport* To = Candidates[Rng.RandRange(0, Candidates.Num() - 1)];
		FSkyLineJob J;
		const int32 K = Rng.RandRange(0, 4);
		J.Kind = Kinds[K];
		J.From = From->Icao;
		J.To = To->Icao;
		J.DistanceKm = skyline::Distance(skyline::LatLon{From->Lat, From->Lon}, skyline::LatLon{To->Lat, To->Lon}) / 1000.0;
		J.Tier = FMath::Min(R, J.DistanceKm > 2500 ? 4 : J.DistanceKm > 600 ? 3 : J.DistanceKm > 250 ? 2 : 0);
		static const double TierRate[] = {2.0, 3.5, 6.0, 12.0, 22.0};  // $ per km
		J.Pay = FMath::RoundToDouble(J.DistanceKm * TierRate[R] * KindRate[K] * (0.9 + Rng.FRand() * 0.3) + 150);
		J.Xp = FMath::RoundToDouble(40 + J.DistanceKm * 0.25 * (1 + R * 0.3));
		J.Load = K == 1 ? Rng.RandRange(200, 2000) * (R + 1) : Rng.RandRange(1, 4) * (R * R * 40 + 3);
		J.Id = FString::Printf(TEXT("%s-%s-%d"), *J.From, *J.To, I);
		Out.Add(J);
	}
	return Out;
}

void FSkyLineCareer::Complete(const FSkyLineJob& Job, const FSkyLineMissionResult& Result, const FString& AircraftName, double Minutes, double LandingFpm)
{
	USkyLineSaveGame* S = Data();
	FSkyLineLogEntry E;
	E.Date = FDateTime::Now().ToString(TEXT("%Y-%m-%d %H:%M"));
	E.Aircraft = AircraftName;
	E.From = Job.From;
	E.To = Job.To;
	E.Kind = Job.Kind;
	E.Minutes = Minutes;
	E.LandingFpm = LandingFpm;
	E.Pay = Result.Pay;
	E.bSuccess = Result.bSuccess;
	S->Logbook.Insert(E, 0);
	if (S->Logbook.Num() > 200) S->Logbook.SetNum(200);
	S->Flights++;
	S->Hours += Minutes / 60.0;
	S->Money += Result.Pay;
	S->Xp += Result.Xp;
	S->Reputation = FMath::Clamp(S->Reputation + (Result.bSuccess ? Result.Score / 200.0 - 2.0 : -10.0), 0.0, 100.0);
	if (Result.bSuccess) S->CurrentAirport = Job.To;
	S->JobSeed++;
	Save();
}

#undef LOCTEXT_NAMESPACE
