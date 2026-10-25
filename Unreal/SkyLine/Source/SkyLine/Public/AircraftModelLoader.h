// Runtime loader for converted aircraft: GLB (written by tools/fgconv) -> UStaticMesh + dynamic materials,
// plus livery texture swapping. No editor import step is needed.
#pragma once

#include "CoreMinimal.h"
#include "AircraftLibrary.h"

class UMaterialInstanceDynamic;
class UStaticMesh;
class UTexture2D;

struct FSkyLineAircraftModel
{
	UStaticMesh* Exterior = nullptr;
	UStaticMesh* Interior = nullptr;
	/** Every material by its glTF name (livery slots reference these). */
	TMap<FName, UMaterialInstanceDynamic*> Materials;
	/** Keeps runtime-created objects alive while the model is in use. */
	TArray<UObject*> Owned;
};

class SKYLINE_API FAircraftModelLoader
{
public:
	/** Builds meshes and materials. Outer owns the transient objects (usually the pawn). */
	static bool Load(const FSkyLineAircraftEntry& Entry, UObject* Outer, FSkyLineAircraftModel& Out, FString& OutError);
	/** Paints the livery textures onto the livery slot materials. */
	static void ApplyLivery(const FSkyLineAircraftEntry& Entry, const FSkyLineLivery& Livery, UObject* Outer, FSkyLineAircraftModel& Model);
	/** Decodes PNG/JPEG bytes into a mip-mapped transient texture. */
	static UTexture2D* CreateTexture(const uint8* Data, int64 Size, bool bSRGB, UObject* Outer, FName Name);
	static UTexture2D* LoadTextureFile(const FString& Path, bool bSRGB, UObject* Outer);
};
