// Catalog of converted aircraft found on disk (Aircraft/<id>/manifest.json written by tools/fgconv).
#pragma once

#include "CoreMinimal.h"

struct FSkyLineLivery
{
	FString Id;
	FString Name;
	FString Operator;
	FString Registration;
	/** livery slot index -> absolute PNG path */
	TMap<int32, FString> Textures;
};

struct FSkyLineLiverySlot
{
	int32 Index = 0;
	FString Property;
	TArray<FName> Materials;
};

/** Animated part group exported as discrete poses (gear retraction, flap extension). */
struct FSkyLinePoseGroup
{
	FString Group;            // "gear" | "flaps"
	TArray<double> Values;    // normalised value of each pose
	TArray<FString> Nodes;    // mesh node per pose
};

/** A propeller or rotor that spins about its own pivot. */
struct FSkyLineSpin
{
	FString Node;
	FVector Pivot = FVector::ZeroVector;  // Unreal space, cm (model origin)
	FVector Axis = FVector::ForwardVector;
	FString Kind;                         // "prop" | "rotor" | "tail"
	int32 Engine = 0;
};

/** Cockpit display surface (materials that show a live instrument render target). */
struct FSkyLineScreen
{
	FString Kind;  // "PFD" | "ND" | "EICAS" | "MFD"
	TArray<FName> Materials;
};

struct FSkyLineAircraftEntry
{
	FString Id;
	FString Name;
	/** Flight-model id in the C++ aircraft database (skyline::GetAircraft). */
	FString FdmId;
	FString Directory;
	FString GlbPath;
	int32 Triangles = 0;
	/** Model bounds and pilot eye point in Unreal space (cm, X nose, Y right, Z up, origin = model origin). */
	FBox Bounds = FBox(ForceInit);
	FVector Eye = FVector::ZeroVector;
	bool bHasEye = false;
	/** Lowest exterior point (tyres with gear down), cm below the model origin is negative. */
	double GroundZ = 0;
	TArray<FSkyLineLiverySlot> Slots;
	TArray<FSkyLineLivery> Liveries;
	FString DefaultLivery;
	TArray<FSkyLinePoseGroup> Poses;
	TArray<FSkyLineSpin> Spins;
	TArray<FSkyLineScreen> Screens;

	const FSkyLineLivery* FindLivery(const FString& LiveryId) const;
};

class SKYLINE_API FAircraftLibrary
{
public:
	static FAircraftLibrary& Get();

	void Rescan();
	const TArray<FSkyLineAircraftEntry>& GetAircraft() const { return Entries; }
	const FSkyLineAircraftEntry* Find(const FString& Id) const;
	FString GetRootDirectory() const;

	/** Converts a glTF-space vector (m, +Y up, +Z nose, +X left) to Unreal space (cm, X nose, Y right, Z up). */
	static FVector GltfToUnreal(double X, double Y, double Z) { return FVector(Z, -X, Y) * 100.0; }

private:
	TArray<FSkyLineAircraftEntry> Entries;
	bool bScanned = false;
};
