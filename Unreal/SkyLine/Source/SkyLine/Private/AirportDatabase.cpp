#include "AirportDatabase.h"

#include "Dom/JsonValue.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "SkyLine.h"
#include "Geo.h"

double FSkyLineRunway::HeadingAB() const
{
	return skyline::Bearing(skyline::LatLon{A.Lat, A.Lon}, skyline::LatLon{B.Lat, B.Lon});
}

FAirportDatabase& FAirportDatabase::Get()
{
	static FAirportDatabase Instance;
	if (!Instance.bLoaded)
	{
		Instance.Load();
	}
	return Instance;
}

static FString StrOf(const TSharedPtr<FJsonValue>& V)
{
	return (V.IsValid() && V->Type == EJson::String) ? V->AsString() : FString();
}

static double NumOr(const TSharedPtr<FJsonValue>& V, double Def)
{
	return (V.IsValid() && V->Type == EJson::Number) ? V->AsNumber() : Def;
}

void FAirportDatabase::Load()
{
	bLoaded = true;
	FString Text;
	const FString Path = FPaths::ProjectDir() / TEXT("Data/airports.json");
	if (!FFileHelper::LoadFileToString(Text, *Path))
	{
		UE_LOG(LogSkyLine, Error, TEXT("Missing %s"), *Path);
		return;
	}
	TArray<TSharedPtr<FJsonValue>> Rows;
	const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Text);
	if (!FJsonSerializer::Deserialize(Reader, Rows))
	{
		UE_LOG(LogSkyLine, Error, TEXT("Could not parse %s"), *Path);
		return;
	}
	Airports.Reserve(Rows.Num());
	for (const TSharedPtr<FJsonValue>& RowV : Rows)
	{
		const TArray<TSharedPtr<FJsonValue>>& R = RowV->AsArray();
		if (R.Num() < 10)
		{
			continue;
		}
		FSkyLineAirport A;
		A.Icao = StrOf(R[0]);
		A.Name = StrOf(R[1]);
		A.Lat = NumOr(R[2], 0);
		A.Lon = NumOr(R[3], 0);
		A.ElevFt = NumOr(R[4], 0);
		A.Size = static_cast<int32>(NumOr(R[5], 1));
		A.Country = StrOf(R[6]);
		A.City = StrOf(R[7]);
		A.Iata = StrOf(R[8]);
		for (const TSharedPtr<FJsonValue>& RwV : R[9]->AsArray())
		{
			const TArray<TSharedPtr<FJsonValue>>& W = RwV->AsArray();
			if (W.Num() < 14)
			{
				continue;
			}
			FSkyLineRunway Rw;
			Rw.A.Ident = StrOf(W[0]);
			Rw.A.Lat = NumOr(W[1], 0);
			Rw.A.Lon = NumOr(W[2], 0);
			Rw.A.ElevFt = NumOr(W[3], A.ElevFt);
			Rw.A.DisplacedFt = NumOr(W[4], 0);
			Rw.B.Ident = StrOf(W[5]);
			Rw.B.Lat = NumOr(W[6], 0);
			Rw.B.Lon = NumOr(W[7], 0);
			Rw.B.ElevFt = NumOr(W[8], A.ElevFt);
			Rw.B.DisplacedFt = NumOr(W[9], 0);
			Rw.LengthFt = NumOr(W[10], 0);
			Rw.WidthFt = NumOr(W[11], 100);
			Rw.bHard = NumOr(W[12], 0) > 0;
			Rw.bLit = NumOr(W[13], 0) > 0;
			A.Runways.Add(Rw);
		}
		Airports.Add(MoveTemp(A));
	}
	UE_LOG(LogSkyLine, Log, TEXT("Airport database: %d airports"), Airports.Num());
}

const FSkyLineAirport* FAirportDatabase::Find(const FString& Code) const
{
	for (const FSkyLineAirport& A : Airports)
	{
		if (A.Icao.Equals(Code, ESearchCase::IgnoreCase) || (!A.Iata.IsEmpty() && A.Iata.Equals(Code, ESearchCase::IgnoreCase)))
		{
			return &A;
		}
	}
	return nullptr;
}

TArray<const FSkyLineAirport*> FAirportDatabase::Search(const FString& Query, int32 Max) const
{
	TArray<const FSkyLineAirport*> Exact, Partial;
	const FString Q = Query.TrimStartAndEnd();
	for (const FSkyLineAirport& A : Airports)
	{
		if (Q.IsEmpty())
		{
			if (A.Size >= 3)
			{
				Partial.Add(&A);
			}
		}
		else if (A.Icao.Equals(Q, ESearchCase::IgnoreCase) || A.Iata.Equals(Q, ESearchCase::IgnoreCase))
		{
			Exact.Add(&A);
		}
		else if (A.Icao.StartsWith(Q, ESearchCase::IgnoreCase) || A.Name.Contains(Q, ESearchCase::IgnoreCase) || A.City.Contains(Q, ESearchCase::IgnoreCase))
		{
			Partial.Add(&A);
		}
		if (Exact.Num() + Partial.Num() >= Max * 4)
		{
			break;
		}
	}
	Partial.StableSort([](const FSkyLineAirport& X, const FSkyLineAirport& Y) { return X.Size > Y.Size; });
	Exact.Append(Partial);
	if (Exact.Num() > Max)
	{
		Exact.SetNum(Max);
	}
	return Exact;
}

bool FAirportDatabase::BestRunwayEnd(const FSkyLineAirport& Apt, double WindFromDeg, const FSkyLineRunway*& OutRunway, bool& bOutFromA)
{
	OutRunway = nullptr;
	double BestScore = -1e9;
	for (const FSkyLineRunway& Rw : Apt.Runways)
	{
		for (int32 End = 0; End < 2; End++)
		{
			const double Hdg = End == 0 ? Rw.HeadingAB() : skyline::Wrap360(Rw.HeadingAB() + 180);
			const double Headwind = FMath::Cos(FMath::DegreesToRadians(skyline::Wrap180(WindFromDeg - Hdg)));
			const double Score = Rw.LengthFt / 1000.0 * (Rw.bHard ? 2.0 : 1.0) + Headwind * 2.0;
			if (Score > BestScore)
			{
				BestScore = Score;
				OutRunway = &Rw;
				bOutFromA = End == 0;
			}
		}
	}
	return OutRunway != nullptr;
}
