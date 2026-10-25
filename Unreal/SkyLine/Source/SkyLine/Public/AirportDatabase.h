// Real-world airports and runways (OurAirports, public domain) from Data/airports.json.
#pragma once

#include "CoreMinimal.h"

struct FSkyLineRunwayEnd
{
	FString Ident;
	double Lat = 0, Lon = 0;
	double ElevFt = 0;
	double DisplacedFt = 0;
};

struct FSkyLineRunway
{
	FSkyLineRunwayEnd A, B;
	double LengthFt = 0, WidthFt = 0;
	bool bHard = false, bLit = false;

	/** True heading from end A towards end B (deg). */
	double HeadingAB() const;
};

struct FSkyLineAirport
{
	FString Icao, Name, Country, City, Iata;
	double Lat = 0, Lon = 0, ElevFt = 0;
	int32 Size = 1;  // 3 large, 2 medium, 1 small
	TArray<FSkyLineRunway> Runways;
};

class SKYLINE_API FAirportDatabase
{
public:
	static FAirportDatabase& Get();
	const TArray<FSkyLineAirport>& GetAirports() const { return Airports; }
	const FSkyLineAirport* Find(const FString& IcaoOrIata) const;
	/** Case-insensitive search over ICAO, IATA, name and city; large airports first. */
	TArray<const FSkyLineAirport*> Search(const FString& Query, int32 Max = 50) const;
	/** Picks the longest hard runway end most aligned with the wind (deg FROM). */
	static bool BestRunwayEnd(const FSkyLineAirport& Apt, double WindFromDeg, const FSkyLineRunway*& OutRunway, bool& bOutFromA);

private:
	void Load();
	TArray<FSkyLineAirport> Airports;
	bool bLoaded = false;
};
