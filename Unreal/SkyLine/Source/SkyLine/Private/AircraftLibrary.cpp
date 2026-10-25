#include "AircraftLibrary.h"

#include "Dom/JsonObject.h"
#include "HAL/FileManager.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "SkyLine.h"
#include "SkyLineSettings.h"
#include "AircraftTypes.h"

const FSkyLineLivery* FSkyLineAircraftEntry::FindLivery(const FString& LiveryId) const
{
	for (const FSkyLineLivery& L : Liveries)
	{
		if (L.Id == LiveryId)
		{
			return &L;
		}
	}
	return nullptr;
}

FAircraftLibrary& FAircraftLibrary::Get()
{
	static FAircraftLibrary Instance;
	if (!Instance.bScanned)
	{
		Instance.Rescan();
	}
	return Instance;
}

FString FAircraftLibrary::GetRootDirectory() const
{
	const FString Dir = USkyLineSettings::Get()->AircraftDirectory;
	return FPaths::IsRelative(Dir) ? FPaths::ConvertRelativePathToFull(FPaths::ProjectDir() / Dir) : Dir;
}

static FVector ReadGltfVector(const TSharedPtr<FJsonObject>& Obj, const FString& Field, bool& bOk)
{
	const TArray<TSharedPtr<FJsonValue>>* Arr = nullptr;
	bOk = Obj->TryGetArrayField(Field, Arr) && Arr && Arr->Num() == 3;
	if (!bOk)
	{
		return FVector::ZeroVector;
	}
	return FAircraftLibrary::GltfToUnreal((*Arr)[0]->AsNumber(), (*Arr)[1]->AsNumber(), (*Arr)[2]->AsNumber());
}

void FAircraftLibrary::Rescan()
{
	bScanned = true;
	Entries.Reset();
	const FString Root = GetRootDirectory();
	TArray<FString> Dirs;
	IFileManager::Get().FindFiles(Dirs, *(Root / TEXT("*")), false, true);
	for (const FString& Sub : Dirs)
	{
		const FString Dir = Root / Sub;
		FString Text;
		if (!FFileHelper::LoadFileToString(Text, *(Dir / TEXT("manifest.json"))))
		{
			continue;
		}
		TSharedPtr<FJsonObject> Json;
		const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Text);
		if (!FJsonSerializer::Deserialize(Reader, Json) || !Json.IsValid())
		{
			UE_LOG(LogSkyLine, Warning, TEXT("Bad manifest in %s"), *Dir);
			continue;
		}
		FSkyLineAircraftEntry E;
		E.Id = Json->GetStringField(TEXT("id"));
		E.Name = Json->GetStringField(TEXT("name"));
		E.FdmId = Json->GetStringField(TEXT("fdm"));
		E.Directory = Dir;
		E.GlbPath = Dir / Json->GetStringField(TEXT("glb"));
		E.Triangles = static_cast<int32>(Json->GetNumberField(TEXT("triangles")));
		E.DefaultLivery = Json->HasTypedField<EJson::String>(TEXT("defaultLivery")) ? Json->GetStringField(TEXT("defaultLivery")) : FString();

		const TSharedPtr<FJsonObject>* BoundsObj = nullptr;
		if (Json->TryGetObjectField(TEXT("bounds"), BoundsObj))
		{
			bool bA = false, bB = false;
			const FVector A = ReadGltfVector(*BoundsObj, TEXT("min"), bA);
			const FVector B = ReadGltfVector(*BoundsObj, TEXT("max"), bB);
			if (bA && bB)
			{
				E.Bounds = FBox(A.ComponentMin(B), A.ComponentMax(B));
			}
		}
		E.GroundZ = Json->GetNumberField(TEXT("groundY")) * 100.0;
		E.Eye = ReadGltfVector(Json, TEXT("eye"), E.bHasEye);

		for (const TSharedPtr<FJsonValue>& V : Json->GetArrayField(TEXT("slots")))
		{
			const TSharedPtr<FJsonObject> S = V->AsObject();
			FSkyLineLiverySlot Slot;
			Slot.Index = static_cast<int32>(S->GetNumberField(TEXT("index")));
			Slot.Property = S->GetStringField(TEXT("property"));
			for (const TSharedPtr<FJsonValue>& M : S->GetArrayField(TEXT("materials")))
			{
				Slot.Materials.Add(FName(*M->AsString()));
			}
			E.Slots.Add(MoveTemp(Slot));
		}
		for (const TSharedPtr<FJsonValue>& V : Json->GetArrayField(TEXT("liveries")))
		{
			const TSharedPtr<FJsonObject> L = V->AsObject();
			FSkyLineLivery Liv;
			Liv.Id = L->GetStringField(TEXT("id"));
			Liv.Name = L->GetStringField(TEXT("name"));
			L->TryGetStringField(TEXT("operator"), Liv.Operator);
			L->TryGetStringField(TEXT("registration"), Liv.Registration);
			const TSharedPtr<FJsonObject>* Tex = nullptr;
			if (L->TryGetObjectField(TEXT("textures"), Tex))
			{
				for (const auto& Pair : (*Tex)->Values)
				{
					Liv.Textures.Add(FCString::Atoi(*Pair.Key), Dir / Pair.Value->AsString());
				}
			}
			E.Liveries.Add(MoveTemp(Liv));
		}
		const TArray<TSharedPtr<FJsonValue>>* PoseArr = nullptr;
		if (Json->TryGetArrayField(TEXT("poses"), PoseArr))
		{
			for (const TSharedPtr<FJsonValue>& V : *PoseArr)
			{
				const TSharedPtr<FJsonObject> P = V->AsObject();
				FSkyLinePoseGroup G;
				G.Group = P->GetStringField(TEXT("group"));
				for (const TSharedPtr<FJsonValue>& X : P->GetArrayField(TEXT("values"))) G.Values.Add(X->AsNumber());
				for (const TSharedPtr<FJsonValue>& X : P->GetArrayField(TEXT("nodes"))) G.Nodes.Add(X->AsString());
				if (G.Values.Num() == G.Nodes.Num() && G.Nodes.Num() > 0)
				{
					E.Poses.Add(MoveTemp(G));
				}
			}
		}
		const TArray<TSharedPtr<FJsonValue>>* SpinArr = nullptr;
		if (Json->TryGetArrayField(TEXT("spins"), SpinArr))
		{
			for (const TSharedPtr<FJsonValue>& V : *SpinArr)
			{
				const TSharedPtr<FJsonObject> P = V->AsObject();
				FSkyLineSpin S;
				S.Node = P->GetStringField(TEXT("node"));
				bool bPivot = false, bAxis = false;
				S.Pivot = ReadGltfVector(P, TEXT("pivot"), bPivot);
				S.Axis = ReadGltfVector(P, TEXT("axis"), bAxis).GetSafeNormal();
				S.Kind = P->GetStringField(TEXT("kind"));
				S.Engine = static_cast<int32>(P->GetNumberField(TEXT("engine")));
				if (bPivot && bAxis && !S.Axis.IsNearlyZero())
				{
					E.Spins.Add(MoveTemp(S));
				}
			}
		}
		const TArray<TSharedPtr<FJsonValue>>* ScreenArr = nullptr;
		if (Json->TryGetArrayField(TEXT("screens"), ScreenArr))
		{
			for (const TSharedPtr<FJsonValue>& V : *ScreenArr)
			{
				const TSharedPtr<FJsonObject> P = V->AsObject();
				FSkyLineScreen Sc;
				Sc.Kind = P->GetStringField(TEXT("kind"));
				for (const TSharedPtr<FJsonValue>& X : P->GetArrayField(TEXT("materials"))) Sc.Materials.Add(FName(*X->AsString()));
				E.Screens.Add(MoveTemp(Sc));
			}
		}
		if (!skyline::FindAircraft(TCHAR_TO_UTF8(*E.FdmId)))
		{
			UE_LOG(LogSkyLine, Warning, TEXT("%s: flight model '%s' not in the database, using defaults"), *E.Id, *E.FdmId);
		}
		Entries.Add(MoveTemp(E));
	}
	Entries.Sort([](const FSkyLineAircraftEntry& A, const FSkyLineAircraftEntry& B) { return A.Name < B.Name; });
	UE_LOG(LogSkyLine, Log, TEXT("Aircraft library: %d aircraft in %s"), Entries.Num(), *Root);
}

const FSkyLineAircraftEntry* FAircraftLibrary::Find(const FString& Id) const
{
	for (const FSkyLineAircraftEntry& E : Entries)
	{
		if (E.Id == Id)
		{
			return &E;
		}
	}
	return nullptr;
}
