#include "SkyLineAircraftPawn.h"

#include "Camera/CameraComponent.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Components/AudioComponent.h"
#include "Components/PointLightComponent.h"
#include "Components/SpotLightComponent.h"
#include "SkyLineEngineSound.h"
#include "CesiumGeoreference.h"
#include "CesiumGlobeAnchorComponent.h"
#include "Components/InputComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/World.h"
#include "GameFramework/PlayerController.h"
#include "InputCoreTypes.h"
#include "SkyLine.h"
#include "SkyLineHUD.h"
#include "Geo.h"

using namespace skyline;

namespace
{
constexpr double kSimStep = 1.0 / 120.0;

/** Body axes (FRD expressed in local NED) -> rotation in Cesium's East-South-Up frame (Unreal axes X fwd, Y right, Z up). */
FQuat EsuRotationFromBody(const Quat& Q)
{
	const V3 F = QRot(Q, V3(1, 0, 0));
	const V3 R = QRot(Q, V3(0, 1, 0));
	const V3 D = QRot(Q, V3(0, 0, 1));
	// NED (n, e, d) -> ESU (e, -n, -d)
	const FVector Fwd(F.Y, -F.X, -F.Z);
	const FVector Right(R.Y, -R.X, -R.Z);
	const FVector Up(-D.Y, D.X, D.Z);
	return FMatrix(Fwd, Right, Up, FVector::ZeroVector).ToQuat();
}
}  // namespace

ASkyLineAircraftPawn::ASkyLineAircraftPawn()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.TickGroup = TG_PrePhysics;

	Body = CreateDefaultSubobject<USceneComponent>(TEXT("Body"));
	RootComponent = Body;

	ExteriorMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Exterior"));
	ExteriorMesh->SetupAttachment(Body);
	ExteriorMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	ExteriorMesh->SetGenerateOverlapEvents(false);

	InteriorMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Interior"));
	InteriorMesh->SetupAttachment(Body);
	InteriorMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	InteriorMesh->SetGenerateOverlapEvents(false);

	Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
	Camera->SetupAttachment(Body);
	Camera->bUsePawnControlRotation = false;

	GlobeAnchor = CreateDefaultSubobject<UCesiumGlobeAnchorComponent>(TEXT("GlobeAnchor"));

	Audio = CreateDefaultSubobject<UAudioComponent>(TEXT("Audio"));
	Audio->SetupAttachment(Body);
	Audio->bAutoActivate = false;
	Audio->bAllowSpatialization = false;
}

void ASkyLineAircraftPawn::BeginPlay()
{
	Super::BeginPlay();
	Env.Ground = [this](double, double) { return Ground; };
}

ACesiumGeoreference* ASkyLineAircraftPawn::GetGeoreference() const
{
	return ACesiumGeoreference::GetDefaultGeoreference(this);
}

bool ASkyLineAircraftPawn::SetupAircraft(const FSkyLineLaunch& Launch, FString& OutError)
{
	FAircraftLibrary& Lib = FAircraftLibrary::Get();
	Entry = Lib.Find(Launch.AircraftId);
	if (!Entry && Lib.GetAircraft().Num() > 0)
	{
		Entry = &Lib.GetAircraft()[0];
	}
	if (!Entry)
	{
		OutError = FString::Printf(TEXT("No converted aircraft in %s. Run: node tools/fgconv/convert.mjs"), *Lib.GetRootDirectory());
		return false;
	}
	Model = FSkyLineAircraftModel();
	if (!FAircraftModelLoader::Load(*Entry, this, Model, OutError))
	{
		return false;
	}
	ModelObjects.Reset();
	for (UObject* O : Model.Owned)
	{
		ModelObjects.Add(O);
	}
	ExteriorMesh->SetStaticMesh(Model.Exterior);
	InteriorMesh->SetStaticMesh(Model.Interior);
	InteriorMesh->SetVisibility(Model.Interior != nullptr);

	Sim = MakeUnique<Aircraft>(GetAircraft(TCHAR_TO_UTF8(*Entry->FdmId)));
	Fcs = MakeUnique<FlightControl>(*Sim);
	Throttle = 0;

	// Put the flight model's CG at the actor origin: FG models are built around the nose, so shift the mesh back
	// by the CG station (the flight model places its nose contact at 47 % of the length ahead of the CG) and down
	// so the tyres touch the ground at the gear's CG height.
	const double LengthCm = Sim->Def.Length * 100.0;
	const double CgX = Entry->Bounds.Max.X - 0.47 * LengthCm;
	MeshOffset = FVector(-CgX, 0, -Sim->Aero.CgHeight * 100.0 - Entry->GroundZ);
	ExteriorMesh->SetRelativeLocation(MeshOffset);
	InteriorMesh->SetRelativeLocation(MeshOffset);
	CreatePartComponents();
	CreateLights();
	OrbitDistance = FMath::Max(1500.0, Entry->Bounds.GetSize().GetMax() * 1.6);

	ApplyLivery(Launch.LiveryId.IsEmpty() ? Entry->DefaultLivery : Launch.LiveryId);

	EngineSound = NewObject<USkyLineEngineSound>(this);
	const EngineType Et = Sim->Def.Eng.T;
	EngineSound->SetKind(Sim->IsRotor() ? ESkyLineSoundKind::Helicopter
		: Et == EngineType::Prop ? ESkyLineSoundKind::Piston
		: Et == EngineType::TProp ? ESkyLineSoundKind::Turboprop
		: Et == EngineType::None ? ESkyLineSoundKind::Glider : ESkyLineSoundKind::Jet);
	Audio->SetSound(EngineSound);
	Audio->Play();
	return true;
}

void ASkyLineAircraftPawn::ApplyLivery(const FString& LiveryId)
{
	if (!Entry)
	{
		return;
	}
	const FSkyLineLivery* L = Entry->FindLivery(LiveryId);
	if (!L && Entry->Liveries.Num() > 0)
	{
		L = &Entry->Liveries[0];
	}
	if (!L)
	{
		return;
	}
	Livery = L;
	FAircraftModelLoader::ApplyLivery(*Entry, *L, this, Model);
	for (UObject* O : Model.Owned)
	{
		ModelObjects.AddUnique(O);
	}
}

void ASkyLineAircraftPawn::BeginFlight(const FSkyLineLaunch& Launch)
{
	LaunchOptions = Launch;
	FAirportDatabase& Db = FAirportDatabase::Get();
	Origin = Db.Find(Launch.Airport);
	Dest = Db.Find(Launch.Destination);
	Env.Wx = MakeWeather(static_cast<WeatherPreset>(Launch.WeatherPreset));
	Env.Time = 0;
	const bool bCustom = Launch.Start == ESkyLineStart::Custom;
	if (bCustom || Origin)
	{
		SpawnLat = bCustom ? Launch.StartLat : Origin->Lat;
		SpawnLon = bCustom ? Launch.StartLon : Origin->Lon;
		const double ElevM = Origin && !bCustom ? Origin->ElevFt * FT : 0.0;
		if (ACesiumGeoreference* Geo = GetGeoreference())
		{
			Geo->SetOriginLongitudeLatitudeHeight(FVector(SpawnLon, SpawnLat, ElevM));
			LastRebaseLat = SpawnLat;
			LastRebaseLon = SpawnLon;
		}
		// Park the model at the spawn point while terrain streams in.
		Sim->Place(SpawnLat, SpawnLon, ElevM + 50, 0, 0);
	}
	bWaitingForTerrain = true;
	WaitStarted = FPlatformTime::Seconds();
	ShowMessage(TEXT("지형 데이터를 불러오는 중..."));
}

static void RunwayStart(const FSkyLineRunway& Rw, bool bFromA, double& OutLat, double& OutLon, double& OutHdg, double& OutElevFt)
{
	const FSkyLineRunwayEnd& Thr = bFromA ? Rw.A : Rw.B;
	OutHdg = bFromA ? Rw.HeadingAB() : Wrap360(Rw.HeadingAB() + 180);
	// line up just past the threshold (and any displaced portion)
	const LatLon P = Destination(LatLon{Thr.Lat, Thr.Lon}, OutHdg, 60.0 + Thr.DisplacedFt * FT);
	OutLat = P.Lat;
	OutLon = P.Lon;
	OutElevFt = Thr.ElevFt;
}

static ApproachDef MakeApproachFor(const FSkyLineAirport& Apt, double WindFrom, const FString& RunwayIdent = FString())
{
	ApproachDef Ap;
	const FSkyLineRunway* Rw = nullptr;
	bool bFromA = true;
	FAirportDatabase::BestRunwayEnd(Apt, WindFrom, Rw, bFromA);
	for (const FSkyLineRunway& R : Apt.Runways)
	{
		if (!RunwayIdent.IsEmpty() && R.A.Ident.Equals(RunwayIdent, ESearchCase::IgnoreCase)) { Rw = &R; bFromA = true; }
		if (!RunwayIdent.IsEmpty() && R.B.Ident.Equals(RunwayIdent, ESearchCase::IgnoreCase)) { Rw = &R; bFromA = false; }
	}
	if (!Rw)
	{
		return Ap;
	}
	const FSkyLineRunwayEnd& Thr = bFromA ? Rw->A : Rw->B;
	const FSkyLineRunwayEnd& Far = bFromA ? Rw->B : Rw->A;
	Ap.Airport = TCHAR_TO_UTF8(*Apt.Icao);
	Ap.Runway = TCHAR_TO_UTF8(*Thr.Ident);
	Ap.Crs = bFromA ? Rw->HeadingAB() : Wrap360(Rw->HeadingAB() + 180);
	Ap.Thr = Destination(LatLon{Thr.Lat, Thr.Lon}, Ap.Crs, Thr.DisplacedFt * FT);
	Ap.Elev = Thr.ElevFt * FT;
	Ap.GsAngle = 3;
	Ap.LocAnt = Destination(LatLon{Far.Lat, Far.Lon}, Ap.Crs, 300);
	Ap.GsAnt = Destination(Ap.Thr, Ap.Crs, 300);
	Ap.LengthM = Rw->LengthFt * FT;
	return Ap;
}

void ASkyLineAircraftPawn::PositionAtStart()
{
	bWaitingForTerrain = false;
	if (LaunchOptions.Start == ESkyLineStart::Custom)
	{
		StartAirborneCustom();
		return;
	}
	if (!Origin)
	{
		ShowMessage(TEXT("출발 공항을 찾을 수 없습니다"));
		return;
	}
	const FSkyLineRunway* Rw = nullptr;
	bool bFromA = true;
	FAirportDatabase::BestRunwayEnd(*Origin, Env.Wx.WindDir, Rw, bFromA);
	if (!LaunchOptions.Runway.IsEmpty())
	{
		for (const FSkyLineRunway& R : Origin->Runways)
		{
			if (R.A.Ident.Equals(LaunchOptions.Runway, ESearchCase::IgnoreCase)) { Rw = &R; bFromA = true; }
			if (R.B.Ident.Equals(LaunchOptions.Runway, ESearchCase::IgnoreCase)) { Rw = &R; bFromA = false; }
		}
	}
	double Lat = Origin->Lat, Lon = Origin->Lon, Hdg = 0, ElevFt = Origin->ElevFt;
	if (Rw)
	{
		RunwayStart(*Rw, bFromA, Lat, Lon, Hdg, ElevFt);
	}
	// Terrain tiles are in ellipsoid heights; airport elevations are MSL. The difference is the local geoid height.
	double TerrainEll = 0;
	bool bWater = false;
	if (TraceGround(Lat, Lon, TerrainEll, bWater))
	{
		GeoidOffset = TerrainEll - ElevFt * FT;
		if (FMath::Abs(GeoidOffset) > 150)
		{
			GeoidOffset = 0;  // bad hit (building, bridge); trust the database
		}
	}
	Ground.H = ElevFt * FT;
	Ground.Runway = true;
	Ground.Water = false;

	const ESkyLineStart Start = LaunchOptions.Start;
	FlightControl& F = *Fcs;
	Aircraft& A = *Sim;
	if (Dest)
	{
		F.Plan.HasApproach = true;
		F.Plan.Appr = MakeApproachFor(*Dest, Env.Wx.WindDir, Start == ESkyLineStart::Final ? LaunchOptions.Runway : FString());
		F.Plan.Wps.clear();
		Waypoint W0;
		W0.Ident = TCHAR_TO_UTF8(*Origin->Icao); W0.Lat = Origin->Lat; W0.Lon = Origin->Lon;
		Waypoint W1;
		W1.Ident = TCHAR_TO_UTF8(*Dest->Icao); W1.Lat = F.Plan.Appr.Thr.Lat; W1.Lon = F.Plan.Appr.Thr.Lon;
		// join the final approach 12 nm out
		Waypoint WF;
		WF.Ident = "FINAL";
		const LatLon Fp = Destination(F.Plan.Appr.Thr, Wrap360(F.Plan.Appr.Crs + 180), 12 * NM);
		WF.Lat = Fp.Lat; WF.Lon = Fp.Lon;
		F.Plan.Wps = {W0, WF, W1};
		F.Plan.Active = 1;
	}

	if (Start == ESkyLineStart::Final && Dest && F.Plan.HasApproach)
	{
		const ApproachDef& Ap = F.Plan.Appr;
		const double FinalNm = FMath::Max(1.0, LaunchOptions.FinalNm);
		const LatLon P = Destination(Ap.Thr, Wrap360(Ap.Crs + 180), FinalNm * NM);
		const double AltFt = Ap.Elev / FT + FinalNm * 318.0 + 50.0;
		const double Spd = F.Vref() + 10;
		A.Place(P.Lat, P.Lon, AltFt * FT, Ap.Crs, Spd, 0.0);
		A.SetAllEngines(true);
		A.GearDown = true; A.GearPos = 1;
		A.FlapIdx = static_cast<int>(A.Aero.Flaps.size()) - 1;
		A.FlapPos = A.Aero.Flaps[A.FlapIdx].Deg;
		A.SpoilerArm = true;
		F.SelHdg = std::round(Wrap360(Ap.Crs - MagVar(P.Lat, P.Lon)));
		F.SelAlt = std::round(AltFt / 100) * 100;
		F.SelSpd = std::round(Spd);
		Throttle = A.Def.Eng.T == EngineType::Prop ? 0.5 : 0.45;
		if (LaunchOptions.bAutopilotOnFinal)
		{
			F.EngageAp(true);
			F.Vert = VertMode::Alt; F.AltHold = AltFt; F.Lat = LatMode::Hdg;
			if (F.HasAthr()) F.ToggleAthr();
			F.ArmApp();
			Throttle = 0.55;
		}
		else
		{
			// hand-flown: already descending on the 3° path
			A.Vel = A.Vel + V3(0, 0, Spd * KT * FMath::Tan(FMath::DegreesToRadians(3.0)));
		}
		LastRebaseLat = 1000;
	}
	else if (Start == ESkyLineStart::Cruise)
	{
		const double AltFt = FMath::Min(A.Def.V.CruiseFt, 37000.0);
		A.Place(Lat, Lon, AltFt * FT, Hdg, A.Def.V.Cruise * 0.92, 1.5);
		A.SetAllEngines(true);
		A.GearDown = false; A.GearPos = 0;
		F.SelAlt = AltFt; F.SelHdg = std::round(F.HdgMag());
		F.SelSpd = std::round(FMath::Min(A.Def.V.Vmo - 20, 280.0));
		F.EngageAp(true);
		F.Vert = VertMode::Alt; F.AltHold = AltFt;
		if (F.HasAthr()) F.ToggleAthr();
		Throttle = 0.7;
		LastRebaseLat = 1000;
	}
	else
	{
		A.Place(Lat, Lon, ElevFt * FT + A.RestHeight(), Hdg, 0);
		const bool bRunning = Start != ESkyLineStart::ColdAndDark;
		A.SetAllEngines(bRunning);
		const int NumFlaps = static_cast<int>(A.Aero.Flaps.size());
		A.FlapIdx = bRunning ? FMath::Min(2, NumFlaps - 1) : 0;
		A.FlapPos = A.Aero.Flaps[A.FlapIdx].Deg;
		A.SpoilerArm = bRunning;
		A.ParkingBrake = !bRunning;
		F.SelHdg = std::round(F.HdgMag());
		F.SelAlt = FMath::Min(A.Def.V.CruiseFt, 10000.0);
		F.SelSpd = std::round(F.Speeds().V2 + 10);
		Throttle = 0;
		if (A.IsRotor()) Throttle = 0;
	}
	for (EngineCmd& C : A.EngineCmds) C.Throttle = Throttle;
	Accumulator = 0;
	PlaceOnGlobe();
	ShowMessage(FString::Printf(TEXT("%s · %s %s"), *Entry->Name, *Origin->Icao, Rw ? *(bFromA ? Rw->A.Ident : Rw->B.Ident) : TEXT("")));
}

void ASkyLineAircraftPawn::StartAirborneCustom()
{
	Aircraft& A = *Sim;
	FlightControl& F = *Fcs;
	double TerrainEll = 0;
	bool bWater = false;
	GeoidOffset = 0;  // no airport reference here: fly on ellipsoid heights
	const double GroundM = TraceGround(SpawnLat, SpawnLon, TerrainEll, bWater) ? TerrainEll : 0.0;
	Ground.H = GroundM;
	Ground.Runway = false;
	const double AltM = GroundM + LaunchOptions.StartAglFt * FT;
	const double Spd = A.IsRotor() ? 70.0 : FMath::Max(F.Vref() * 1.35, FMath::Min(A.Def.V.Cruise * 0.55, 200.0));
	A.Place(SpawnLat, SpawnLon, AltM, LaunchOptions.StartHdg, Spd, A.IsRotor() ? 0.0 : 2.0);
	A.SetAllEngines(true);
	A.GearDown = !A.Def.Gear.Retract;
	A.GearPos = A.GearDown ? 1 : 0;
	A.FlapIdx = 0;
	A.FlapPos = 0;
	if (A.IsRotor()) A.RotorRpm = 1;
	Throttle = A.IsRotor() ? 0.55 : 0.65;
	for (EngineCmd& C : A.EngineCmds) C.Throttle = A.IsRotor() ? 1.0 : Throttle;
	F.SelAlt = std::round(AltM / FT / 100) * 100;
	F.SelHdg = std::round(F.HdgMag());
	F.SelSpd = std::round(Spd);
	Accumulator = 0;
	LastRebaseLat = 1000;
	PlaceOnGlobe();
	ShowMessage(FString::Printf(TEXT("%s · %s"), *Entry->Name, *LaunchOptions.Mission.Title));
}

bool ASkyLineAircraftPawn::TraceGround(double Lat, double Lon, double& OutEllipsoidHeight, bool& bOutWater) const
{
	ACesiumGeoreference* Geo = GetGeoreference();
	UWorld* World = GetWorld();
	if (!Geo || !World)
	{
		return false;
	}
	const double TopH = (Sim ? Sim->Alt + GeoidOffset : 0) + 2000.0;
	const FVector Start = Geo->TransformLongitudeLatitudeHeightPositionToUnreal(FVector(Lon, Lat, FMath::Max(TopH, 9000.0)));
	const FVector End = Geo->TransformLongitudeLatitudeHeightPositionToUnreal(FVector(Lon, Lat, -500.0));
	FCollisionQueryParams Params(SCENE_QUERY_STAT(SkyLineGround), true, this);
	FHitResult Hit;
	if (!World->LineTraceSingleByChannel(Hit, Start, End, ECC_Visibility, Params))
	{
		return false;
	}
	OutEllipsoidHeight = Geo->TransformUnrealPositionToLongitudeLatitudeHeight(Hit.ImpactPoint).Z;
	bOutWater = false;
	return true;
}

bool ASkyLineAircraftPawn::IsOnRunway(double Lat, double Lon) const
{
	for (const FSkyLineAirport* Apt : {Origin, Dest})
	{
		if (!Apt || FMath::Abs(Apt->Lat - Lat) > 0.06 || FMath::Abs(Apt->Lon - Lon) > 0.08)
		{
			continue;
		}
		for (const FSkyLineRunway& Rw : Apt->Runways)
		{
			const LatLon A{Rw.A.Lat, Rw.A.Lon}, B{Rw.B.Lat, Rw.B.Lon}, P{Lat, Lon};
			const double Along = AlongTrack(A, B, P);
			const double Cross = CrossTrack(A, B, P);
			if (Along > -30 && Along < Rw.LengthFt * FT + 30 && FMath::Abs(Cross) < Rw.WidthFt * FT * 0.5 + 3)
			{
				return true;
			}
		}
	}
	return false;
}

void ASkyLineAircraftPawn::UpdateGroundSample(bool bForce)
{
	GroundTraceTimer -= 1.0 / 60.0;
	if (!bForce && GroundTraceTimer > 0)
	{
		return;
	}
	GroundTraceTimer = Sim->Agl > 3000 ? 0.5 : 0.05;
	double H = 0;
	bool bWater = false;
	if (TraceGround(Sim->Lat, Sim->Lon, H, bWater))
	{
		Ground.H = H - GeoidOffset;
		Ground.Water = bWater;
	}
	Ground.Runway = IsOnRunway(Sim->Lat, Sim->Lon);
}

void ASkyLineAircraftPawn::PlaceOnGlobe()
{
	if (!Sim)
	{
		return;
	}
	const double HeightEll = Sim->Alt + GeoidOffset;
	// Keep the Unreal origin near the aircraft so single-precision rendering stays sharp.
	if (Distance(LatLon{Sim->Lat, Sim->Lon}, LatLon{LastRebaseLat, LastRebaseLon}) > 8000.0)
	{
		if (ACesiumGeoreference* Geo = GetGeoreference())
		{
			Geo->SetOriginLongitudeLatitudeHeight(FVector(Sim->Lon, Sim->Lat, Ground.H + GeoidOffset));
		}
		LastRebaseLat = Sim->Lat;
		LastRebaseLon = Sim->Lon;
	}
	GlobeAnchor->MoveToLongitudeLatitudeHeight(FVector(Sim->Lon, Sim->Lat, HeightEll));
	GlobeAnchor->SetEastSouthUpRotation(EsuRotationFromBody(Sim->Q));
}

void ASkyLineAircraftPawn::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	if (!Sim)
	{
		return;
	}
	PollInput(DeltaSeconds);
	if (bWaitingForTerrain)
	{
		double H = 0;
		bool bWater = false;
		const bool bHit = (Origin || LaunchOptions.Start == ESkyLineStart::Custom) && TraceGround(SpawnLat, SpawnLon, H, bWater);
		if (bHit || FPlatformTime::Seconds() - WaitStarted > 25.0)
		{
			PositionAtStart();
		}
	}
	else if (!bSimPaused && !Sim->Crashed)
	{
		UpdateGroundSample(false);
		Accumulator = FMath::Min(Accumulator + DeltaSeconds * TimeScale, 0.25 * TimeScale);
		while (Accumulator >= kSimStep)
		{
			Fcs->Update(kSimStep, Pin);
			Sim->Step(kSimStep, Env);
			Env.Time += kSimStep;
			Accumulator -= kSimStep;
		}
		if (Sim->Crashed)
		{
			ShowMessage(FString(UTF8_TO_TCHAR(Sim->CrashReason.c_str())));
		}
		if (!Fcs->Msg.empty())
		{
			ShowMessage(FString(UTF8_TO_TCHAR(Fcs->Msg.c_str())));
			Fcs->Msg.clear();
		}
	}
	PlaceOnGlobe();
	UpdateParts(DeltaSeconds);
	UpdateCamera(DeltaSeconds);
	UpdateSound();
	UpdateLights();
	if (!bScreensApplied)
	{
		ApplyCockpitScreens();
	}
}

void ASkyLineAircraftPawn::CreateLights()
{
	const FBox B = Entry->Bounds;
	const FVector Off = MeshOffset;
	auto Point = [this](const FVector& Rel, const FLinearColor& Color, float Intensity, float Radius) {
		UPointLightComponent* L = NewObject<UPointLightComponent>(this);
		L->SetupAttachment(Body);
		L->SetRelativeLocation(Rel);
		L->SetLightColor(Color);
		L->SetIntensityUnits(ELightUnits::Candelas);
		L->SetIntensity(Intensity);
		L->SetAttenuationRadius(Radius);
		L->SetCastShadows(false);
		L->RegisterComponent();
		return L;
	};
	// wingtips at the widest point, tail light at the very back
	const double MidX = (B.Min.X + B.Max.X) * 0.5 - (B.Max.X - B.Min.X) * 0.08;
	const double WingZ = B.Min.Z + (B.Max.Z - B.Min.Z) * 0.35;
	NavLights.Add(Point(Off + FVector(MidX, B.Min.Y, WingZ), FLinearColor(1, 0.05f, 0.05f), 60, 1500));
	NavLights.Add(Point(Off + FVector(MidX, B.Max.Y, WingZ), FLinearColor(0.05f, 1, 0.2f), 60, 1500));
	NavLights.Add(Point(Off + FVector(B.Min.X, 0, B.Min.Z + (B.Max.Z - B.Min.Z) * 0.5), FLinearColor::White, 40, 1500));
	Strobes.Add(Point(Off + FVector(MidX, B.Min.Y + 30, WingZ), FLinearColor::White, 0, 4000));
	Strobes.Add(Point(Off + FVector(MidX, B.Max.Y - 30, WingZ), FLinearColor::White, 0, 4000));
	Beacon = Point(Off + FVector((B.Min.X + B.Max.X) * 0.5, 0, B.Max.Z * 0.6), FLinearColor(1, 0.1f, 0.05f), 0, 3000);
	LandingLight = NewObject<USpotLightComponent>(this);
	LandingLight->SetupAttachment(Body);
	LandingLight->SetRelativeLocation(Off + FVector(B.Max.X - (B.Max.X - B.Min.X) * 0.15, 0, B.Min.Z + 150));
	LandingLight->SetRelativeRotation(FRotator(-4, 0, 0));
	LandingLight->SetIntensityUnits(ELightUnits::Candelas);
	LandingLight->SetIntensity(0);
	LandingLight->SetAttenuationRadius(120000);
	LandingLight->SetOuterConeAngle(22);
	LandingLight->SetInnerConeAngle(10);
	LandingLight->SetLightColor(FLinearColor(1, 0.95f, 0.85f));
	LandingLight->RegisterComponent();
}

void ASkyLineAircraftPawn::UpdateLights()
{
	if (!Sim || !LandingLight)
	{
		return;
	}
	bool bRunning = false;
	for (const Engine& E : Sim->Engines) bRunning |= E.Running;
	const double T = FPlatformTime::Seconds();
	const bool bAirborneOrRunway = !Sim->OnGround || Sim->OnRunway;
	for (UPointLightComponent* L : NavLights) L->SetVisibility(bRunning || !Sim->OnGround);
	Beacon->SetIntensity(bRunning && FMath::Fmod(T, 1.2) < 0.12 ? 20000.f : 0.f);
	const bool bStrobe = bAirborneOrRunway && bRunning && FMath::Fmod(T, 1.0) < 0.06;
	for (UPointLightComponent* L : Strobes) L->SetIntensity(bStrobe ? 60000.f : 0.f);
	const bool bLanding = bRunning && Sim->Alt / FT < 10000.0 + Ground.H / FT && (Sim->GearDown || Sim->OnGround) && bAirborneOrRunway;
	LandingLight->SetIntensity(bLanding ? 250000.f : 0.f);
}

void ASkyLineAircraftPawn::ApplyCockpitScreens()
{
	APlayerController* PC = Cast<APlayerController>(GetController());
	ASkyLineHUD* Hud = PC ? Cast<ASkyLineHUD>(PC->GetHUD()) : nullptr;
	if (!Hud || !Entry)
	{
		return;
	}
	bScreensApplied = true;
	for (const FSkyLineScreen& Sc : Entry->Screens)
	{
		UTexture* Tex = Hud->GetScreenTexture(Sc.Kind);
		if (!Tex)
		{
			continue;
		}
		for (const FName& Mat : Sc.Materials)
		{
			if (UMaterialInstanceDynamic** Mid = Model.Materials.Find(Mat))
			{
				(*Mid)->SetTextureParameterValue(TEXT("BaseColorTexture"), Tex);
				(*Mid)->SetTextureParameterValue(TEXT("EmissiveTexture"), Tex);
				(*Mid)->SetScalarParameterValue(TEXT("EmissiveStrength"), 2.5f);
				(*Mid)->SetVectorParameterValue(TEXT("BaseColorFactor"), FLinearColor(0.15f, 0.15f, 0.15f, 1.f));
				(*Mid)->SetScalarParameterValue(TEXT("Roughness"), 0.15f);
			}
		}
	}
}

void ASkyLineAircraftPawn::UpdateSound()
{
	if (!EngineSound || !Sim)
	{
		return;
	}
	double Speed = 0, Power = 0;
	const int32 N = static_cast<int32>(Sim->Engines.size());
	for (const Engine& E : Sim->Engines)
	{
		switch (E.Def.T)
		{
			case EngineType::Prop: Speed += E.Rpm / 2700.0; Power += E.Power / (E.Def.P * 1000.0); break;
			case EngineType::TProp:
			case EngineType::Shaft: Speed += E.Ng / 100.0; Power += E.Torque / 100.0; break;
			default: Speed += E.N1 / 100.0; Power += E.Running ? E.Spool : 0.0; break;
		}
	}
	if (N > 0) { Speed /= N; Power /= N; }
	if (Sim->IsRotor()) { Speed = Sim->RotorRpm; Power = Sim->Collective; }
	const double Rumble = Sim->OnGround ? FMath::Clamp(Sim->Gs / 40.0, 0.0, 1.0) : 0.0;
	const bool bPausedNow = bSimPaused || bWaitingForTerrain;
	EngineSound->SetState(bPausedNow ? 0.f : static_cast<float>(Speed), static_cast<float>(Power), bPausedNow ? 0.f : static_cast<float>(Sim->Tas),
		bPausedNow ? 0.f : static_cast<float>(Rumble), !bPausedNow && Sim->Stall > 0.3 && !Sim->OnGround, View == ESkyLineView::Cockpit);
}

void ASkyLineAircraftPawn::CreatePartComponents()
{
	for (UStaticMeshComponent* C : PartComponents)
	{
		if (C) C->DestroyComponent();
	}
	PartComponents.Reset();
	Poses.Reset();
	Spins.Reset();
	auto Make = [this](UStaticMesh* Mesh, const FVector& RelLocation) {
		UStaticMeshComponent* C = NewObject<UStaticMeshComponent>(this);
		C->SetupAttachment(Body);
		C->SetStaticMesh(Mesh);
		C->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		C->SetGenerateOverlapEvents(false);
		C->SetRelativeLocation(RelLocation);
		C->RegisterComponent();
		PartComponents.Add(C);
		return C;
	};
	for (const FSkyLinePoseGroup& G : Entry->Poses)
	{
		FPoseRuntime P;
		P.Group = G.Group;
		P.Values = G.Values;
		for (const FString& Node : G.Nodes)
		{
			UStaticMesh** Mesh = Model.Nodes.Find(Node);
			UStaticMeshComponent* C = Mesh ? Make(*Mesh, MeshOffset) : nullptr;
			if (C) C->SetVisibility(false);
			P.Components.Add(C);
		}
		Poses.Add(MoveTemp(P));
	}
	for (const FSkyLineSpin& S : Entry->Spins)
	{
		if (UStaticMesh** Mesh = Model.Nodes.Find(S.Node))
		{
			FSpinRuntime R;
			R.Component = Make(*Mesh, MeshOffset + S.Pivot);
			R.Axis = S.Axis;
			R.Kind = S.Kind;
			R.Engine = S.Engine;
			Spins.Add(R);
		}
	}
}

void ASkyLineAircraftPawn::UpdateParts(float Dt)
{
	if (!Sim)
	{
		return;
	}
	const double MaxFlap = FMath::Max(1.0, Sim->Aero.Flaps.back().Deg);
	for (FPoseRuntime& P : Poses)
	{
		const double Value = P.Group == TEXT("gear") ? Sim->GearPos : P.Group == TEXT("flaps") ? Sim->FlapPos / MaxFlap : 0.0;
		int32 Best = 0;
		for (int32 I = 1; I < P.Values.Num(); I++)
		{
			if (FMath::Abs(P.Values[I] - Value) < FMath::Abs(P.Values[Best] - Value)) Best = I;
		}
		if (Best != P.Shown)
		{
			for (int32 I = 0; I < P.Components.Num(); I++)
			{
				if (P.Components[I]) P.Components[I]->SetVisibility(I == Best);
			}
			P.Shown = Best;
		}
	}
	for (FSpinRuntime& S : Spins)
	{
		// Visual rates (deg/s) kept below the frame-rate strobe limit.
		double Rate = 0;
		if (S.Kind == TEXT("rotor")) Rate = 1100.0 * Sim->RotorRpm;
		else if (S.Kind == TEXT("tail")) Rate = 2600.0 * Sim->RotorRpm;
		else if (!Sim->Engines.empty())
		{
			const Engine& E = Sim->Engines[FMath::Clamp(S.Engine, 0, static_cast<int32>(Sim->Engines.size()) - 1)];
			const double Frac = E.Def.T == EngineType::Prop ? E.Rpm / 2700.0 : (E.Def.T == EngineType::TProp ? E.Np / 100.0 : E.N1 / 100.0);
			Rate = 1500.0 * FMath::Clamp(Frac, 0.0, 1.2);
		}
		S.AngleDeg = FMath::Fmod(S.AngleDeg + Rate * Dt, 360.0);
		if (S.Component)
		{
			S.Component->SetRelativeRotation(FQuat(S.Axis, FMath::DegreesToRadians(S.AngleDeg)));
		}
	}
}

void ASkyLineAircraftPawn::ShowMessage(const FString& Msg)
{
	StatusMessage = Msg;
	StatusMessageTime = FPlatformTime::Seconds();
	UE_LOG(LogSkyLine, Log, TEXT("%s"), *Msg);
}

// ------------------------------------------------------------------------------------------------ input

void ASkyLineAircraftPawn::PollInput(float Dt)
{
	APlayerController* PC = Cast<APlayerController>(GetController());
	if (!PC || !Sim)
	{
		return;
	}
	auto Key = [PC](const FKey& K) { return PC->IsInputKeyDown(K) ? 1.0 : 0.0; };
	const bool bCtrl = Key(EKeys::LeftControl) + Key(EKeys::RightControl) > 0;

	// Keyboard: arrows or WASD. Up/W pushes the nose down, like a yoke.
	const double TgtPitch = FMath::Clamp(Key(EKeys::Down) + Key(EKeys::S) - Key(EKeys::Up) - Key(EKeys::W), -1.0, 1.0) * 0.7;
	const double TgtRoll = FMath::Clamp(Key(EKeys::Right) + Key(EKeys::D) - Key(EKeys::Left) - Key(EKeys::A), -1.0, 1.0) * 0.8;
	const double TgtYaw = bCtrl ? 0.0 : FMath::Clamp(Key(EKeys::E) - Key(EKeys::Q), -1.0, 1.0);
	KeyPitch = MoveToward(KeyPitch, TgtPitch, Dt * (TgtPitch == 0 ? 4.0 : 1.8));
	KeyRoll = MoveToward(KeyRoll, TgtRoll, Dt * (TgtRoll == 0 ? 4.0 : 2.5));
	KeyYaw = MoveToward(KeyYaw, TgtYaw, Dt * 3.0);

	// Gamepad (XInput): left stick = yoke, right stick X = rudder, right stick Y = throttle/collective rate, triggers = brakes.
	const double PadX = PC->GetInputAnalogKeyState(EKeys::Gamepad_LeftX);
	const double PadY = PC->GetInputAnalogKeyState(EKeys::Gamepad_LeftY);
	const double PadRX = PC->GetInputAnalogKeyState(EKeys::Gamepad_RightX);
	const double PadRY = PC->GetInputAnalogKeyState(EKeys::Gamepad_RightY);
	const double PadBrake = FMath::Max(PC->GetInputAnalogKeyState(EKeys::Gamepad_LeftTriggerAxis), PC->GetInputAnalogKeyState(EKeys::Gamepad_RightTriggerAxis));
	auto Curve = [](double V) { return FMath::Sign(V) * FMath::Pow(FMath::Abs(V), 1.6); };

	Pin.Pitch = FMath::Clamp(KeyPitch - Curve(PadY), -1.0, 1.0);
	Pin.Roll = FMath::Clamp(KeyRoll + Curve(PadX), -1.0, 1.0);
	Pin.Yaw = FMath::Clamp(KeyYaw + Curve(PadRX), -1.0, 1.0);
	if (Touch.bStick)
	{
		Pin.Pitch = FMath::Clamp(Pin.Pitch + Curve(Touch.Pitch), -1.0, 1.0);
		Pin.Roll = FMath::Clamp(Pin.Roll + Curve(Touch.Roll), -1.0, 1.0);
	}
	Pin.Yaw = FMath::Clamp(Pin.Yaw + Touch.Yaw, -1.0, 1.0);
	// Pitch trim: Numpad 1 nose up, Numpad 7 nose down (also Home/End).
	Pin.Trim = Key(EKeys::NumPadOne) + Key(EKeys::End) - Key(EKeys::NumPadSeven) - Key(EKeys::Home);

	// Throttle: F3 / PageUp / Numpad+ increase, F2 / PageDown / Numpad- decrease, F4 full, F1 idle.
	const bool bAthrDriving = Fcs->Athr != AthrMode::Off;
	if (bAthrDriving && !Sim->EngineCmds.empty())
	{
		Throttle = Sim->EngineCmds[0].Throttle;
	}
	const double ThrRate = Key(EKeys::F3) + Key(EKeys::PageUp) + Key(EKeys::Add) - Key(EKeys::F2) - Key(EKeys::PageDown) - Key(EKeys::Subtract) + PadRY;
	if (ThrRate != 0)
	{
		Throttle = FMath::Clamp(Throttle + ThrRate * Dt * 0.45, 0.0, 1.0);
		if (bAthrDriving && FMath::Abs(ThrRate) > 0.5) { Fcs->Athr = AthrMode::Off; ShowMessage(TEXT("A/THR OFF (수동 스로틀)")); }
	}
	if (Touch.Throttle >= 0)
	{
		if (bAthrDriving && FMath::Abs(Touch.Throttle - Throttle) > 0.05) { Fcs->Athr = AthrMode::Off; ShowMessage(TEXT("A/THR OFF (수동 스로틀)")); }
		Throttle = FMath::Clamp(Touch.Throttle, 0.0, 1.0);
	}
	if (Key(EKeys::F4) > 0) Throttle = 1.0;
	if (Key(EKeys::F1) > 0) Throttle = 0.0;
	bReverse = Key(EKeys::R) > 0 && !bCtrl;

	if (Sim->IsRotor())
	{
		Pin.Collective = Throttle;
		for (EngineCmd& C : Sim->EngineCmds) { C.Throttle = 1.0; C.Reverse = false; }
	}
	else if (!bAthrDriving)
	{
		for (EngineCmd& C : Sim->EngineCmds) { C.Throttle = bReverse ? 0.0 : Throttle; C.Reverse = bReverse; }
	}
	else
	{
		for (EngineCmd& C : Sim->EngineCmds) C.Reverse = false;
	}

	// Brakes: '.' hold (or gamepad triggers).
	const double Brake = FMath::Max3(Key(EKeys::Period), PadBrake, Touch.bBrake ? 1.0 : 0.0);
	Sim->BrakeL = Sim->BrakeR = Brake;
	if (Brake > 0.1) Sim->AutobrakeCmd = 0;

	// Mouse: right button drag looks around / orbits, wheel zooms.
	if (PC->IsInputKeyDown(EKeys::RightMouseButton))
	{
		float Dx = 0, Dy = 0;
		PC->GetInputMouseDelta(Dx, Dy);
		if (View == ESkyLineView::Cockpit)
		{
			HeadYaw = FMath::Clamp(HeadYaw + Dx * 0.25, -160.0, 160.0);
			HeadPitch = FMath::Clamp(HeadPitch + Dy * 0.25, -70.0, 60.0);
		}
		else
		{
			OrbitYaw = Wrap360(OrbitYaw + Dx * 0.3);
			OrbitPitch = FMath::Clamp(OrbitPitch + Dy * 0.3, -85.0, 85.0);
		}
	}
}

void ASkyLineAircraftPawn::SetupPlayerInputComponent(UInputComponent* Input)
{
	Super::SetupPlayerInputComponent(Input);
	Input->BindKey(EKeys::G, IE_Pressed, this, &ASkyLineAircraftPawn::OnGear);
	Input->BindKey(EKeys::F6, IE_Pressed, this, &ASkyLineAircraftPawn::OnFlapsUp);
	Input->BindKey(EKeys::LeftBracket, IE_Pressed, this, &ASkyLineAircraftPawn::OnFlapsUp);
	Input->BindKey(EKeys::F7, IE_Pressed, this, &ASkyLineAircraftPawn::OnFlapsDown);
	Input->BindKey(EKeys::RightBracket, IE_Pressed, this, &ASkyLineAircraftPawn::OnFlapsDown);
	Input->BindKey(EKeys::P, IE_Pressed, this, &ASkyLineAircraftPawn::OnParkingBrake);
	Input->BindKey(EKeys::Slash, IE_Pressed, this, &ASkyLineAircraftPawn::OnSpoilers);
	Input->BindKey(EKeys::V, IE_Pressed, this, &ASkyLineAircraftPawn::OnCycleView);
	Input->BindKey(EKeys::C, IE_Pressed, this, &ASkyLineAircraftPawn::OnCockpitView);
	Input->BindKey(FInputChord(EKeys::E, false, true, false, false), IE_Pressed, this, &ASkyLineAircraftPawn::OnEngines);
	Input->BindKey(EKeys::Z, IE_Pressed, this, &ASkyLineAircraftPawn::McpToggleAp);
	Input->BindKey(EKeys::T, IE_Pressed, this, &ASkyLineAircraftPawn::McpToggleAthr);
	Input->BindKey(EKeys::L, IE_Pressed, this, &ASkyLineAircraftPawn::OnApp);
	Input->BindKey(EKeys::Insert, IE_Pressed, this, &ASkyLineAircraftPawn::OnToga);
	Input->BindKey(EKeys::Tab, IE_Pressed, this, &ASkyLineAircraftPawn::OnTimeScale);
	Input->BindKey(EKeys::B, IE_Pressed, this, &ASkyLineAircraftPawn::OnAutobrake);
	Input->BindKey(EKeys::MouseScrollUp, IE_Pressed, this, &ASkyLineAircraftPawn::OnZoomIn);
	Input->BindKey(EKeys::MouseScrollDown, IE_Pressed, this, &ASkyLineAircraftPawn::OnZoomOut);
	Input->BindKey(EKeys::Pause, IE_Pressed, this, &ASkyLineAircraftPawn::TogglePause);
	Input->BindKey(EKeys::Gamepad_FaceButton_Top, IE_Pressed, this, &ASkyLineAircraftPawn::OnGear);
	Input->BindKey(EKeys::Gamepad_DPad_Up, IE_Pressed, this, &ASkyLineAircraftPawn::OnFlapsUp);
	Input->BindKey(EKeys::Gamepad_DPad_Down, IE_Pressed, this, &ASkyLineAircraftPawn::OnFlapsDown);
	Input->BindKey(EKeys::Gamepad_RightThumbstick, IE_Pressed, this, &ASkyLineAircraftPawn::OnCycleView);
	Input->BindKey(EKeys::Gamepad_FaceButton_Left, IE_Pressed, this, &ASkyLineAircraftPawn::OnParkingBrake);
	Input->BindKey(EKeys::Gamepad_FaceButton_Right, IE_Pressed, this, &ASkyLineAircraftPawn::McpToggleAp);
}

void ASkyLineAircraftPawn::Command(const FString& Name)
{
	if (Name == TEXT("GEAR")) OnGear();
	else if (Name == TEXT("FLAPS_UP")) OnFlapsUp();
	else if (Name == TEXT("FLAPS_DOWN")) OnFlapsDown();
	else if (Name == TEXT("PARK")) OnParkingBrake();
	else if (Name == TEXT("SPOILERS")) OnSpoilers();
	else if (Name == TEXT("VIEW")) OnCycleView();
	else if (Name == TEXT("AP")) McpToggleAp();
	else if (Name == TEXT("ATHR")) McpToggleAthr();
	else if (Name == TEXT("APP")) OnApp();
	else if (Name == TEXT("TOGA")) OnToga();
	else if (Name == TEXT("ENGINES")) OnEngines();
	else if (Name == TEXT("PAUSE")) TogglePause();
	else if (Name == TEXT("RATE")) OnTimeScale();
	else if (Name == TEXT("AUTOBRAKE")) OnAutobrake();
}

void ASkyLineAircraftPawn::TouchLook(double Dx, double Dy)
{
	if (View == ESkyLineView::Cockpit)
	{
		HeadYaw = FMath::Clamp(HeadYaw + Dx * 0.2, -160.0, 160.0);
		HeadPitch = FMath::Clamp(HeadPitch + Dy * 0.2, -70.0, 60.0);
	}
	else
	{
		OrbitYaw = Wrap360(OrbitYaw + Dx * 0.25);
		OrbitPitch = FMath::Clamp(OrbitPitch + Dy * 0.25, -85.0, 85.0);
	}
}

void ASkyLineAircraftPawn::TouchZoom(double Factor)
{
	if (View == ESkyLineView::Cockpit) CockpitFov = FMath::Clamp(CockpitFov / Factor, 25.0, 100.0);
	else OrbitDistance = FMath::Clamp(OrbitDistance / Factor, 800.0, 60000.0);
}

void ASkyLineAircraftPawn::OnGear()
{
	if (!Sim || !Sim->Def.Gear.Retract) return;
	if (Sim->OnGround && Sim->GearDown) { ShowMessage(TEXT("지상에서는 기어를 올릴 수 없습니다")); return; }
	Sim->GearDown = !Sim->GearDown;
	ShowMessage(Sim->GearDown ? TEXT("GEAR DOWN") : TEXT("GEAR UP"));
}

void ASkyLineAircraftPawn::OnFlapsUp()
{
	if (!Sim || Sim->FlapIdx <= 0) return;
	Sim->FlapIdx--;
	ShowMessage(FString::Printf(TEXT("FLAPS %s"), UTF8_TO_TCHAR(Sim->FlapLabel())));
}

void ASkyLineAircraftPawn::OnFlapsDown()
{
	if (!Sim || Sim->FlapIdx >= static_cast<int>(Sim->Aero.Flaps.size()) - 1) return;
	Sim->FlapIdx++;
	ShowMessage(FString::Printf(TEXT("FLAPS %s"), UTF8_TO_TCHAR(Sim->FlapLabel())));
}

void ASkyLineAircraftPawn::OnParkingBrake()
{
	if (!Sim) return;
	Sim->ParkingBrake = !Sim->ParkingBrake;
	ShowMessage(Sim->ParkingBrake ? TEXT("PARKING BRAKE SET") : TEXT("PARKING BRAKE RELEASED"));
}

void ASkyLineAircraftPawn::OnSpoilers()
{
	if (!Sim) return;
	APlayerController* PC = Cast<APlayerController>(GetController());
	if (PC && (PC->IsInputKeyDown(EKeys::LeftShift) || PC->IsInputKeyDown(EKeys::RightShift)))
	{
		Sim->SpoilerArm = !Sim->SpoilerArm;
		ShowMessage(Sim->SpoilerArm ? TEXT("GROUND SPOILERS ARMED") : TEXT("GROUND SPOILERS DISARMED"));
		return;
	}
	Sim->Speedbrake = Sim->Speedbrake > 0.4 ? 0.0 : (Sim->Speedbrake > 0.1 ? 1.0 : 0.5);
	ShowMessage(FString::Printf(TEXT("SPEED BRAKE %d%%"), FMath::RoundToInt(Sim->Speedbrake * 100)));
}

void ASkyLineAircraftPawn::OnCycleView()
{
	SetView(static_cast<ESkyLineView>((static_cast<uint8>(View) + 1) % 4));
}

void ASkyLineAircraftPawn::OnCockpitView()
{
	SetView(View == ESkyLineView::Cockpit ? ESkyLineView::Chase : ESkyLineView::Cockpit);
}

void ASkyLineAircraftPawn::SetView(ESkyLineView NewView)
{
	View = NewView;
	HeadYaw = 0;
	HeadPitch = -8;
	if (View == ESkyLineView::Tower)
	{
		// a spotter 250 m off the right wing, 20 m up
		TowerLocation = GetActorLocation() + GetActorRightVector() * 25000.0 + FVector(0, 0, 2000.0);
	}
	static const TCHAR* Names[] = {TEXT("조종석"), TEXT("추적 카메라"), TEXT("궤도 카메라"), TEXT("관제탑 시점")};
	ShowMessage(Names[static_cast<uint8>(View)]);
}

void ASkyLineAircraftPawn::OnEngines()
{
	if (!Sim) return;
	bool bAny = false;
	for (const Engine& E : Sim->Engines) bAny |= E.Running;
	Sim->SetAllEngines(!bAny);
	for (EngineCmd& C : Sim->EngineCmds) C.Cutoff = bAny;
	ShowMessage(bAny ? TEXT("엔진 정지") : TEXT("엔진 시동 (자동)"));
}

void ASkyLineAircraftPawn::OnApp() { McpMode(TEXT("APP")); }

void ASkyLineAircraftPawn::OnToga()
{
	if (!Fcs) return;
	Fcs->Toga();
	Throttle = 1;
	ShowMessage(TEXT("TOGA"));
}

void ASkyLineAircraftPawn::OnTimeScale()
{
	TimeScale = TimeScale >= 4 ? 1 : TimeScale * 2;
	ShowMessage(FString::Printf(TEXT("시뮬레이션 속도 x%d"), FMath::RoundToInt(TimeScale)));
}

void ASkyLineAircraftPawn::OnAutobrake()
{
	if (!Sim) return;
	Sim->Autobrake = (Sim->Autobrake + 1) % 4;
	static const TCHAR* Names[] = {TEXT("OFF"), TEXT("LO"), TEXT("MED"), TEXT("MAX")};
	ShowMessage(FString::Printf(TEXT("AUTOBRAKE %s"), Names[Sim->Autobrake]));
}

static FString HoveredMcpField(APawn* Pawn)
{
	const APlayerController* PC = Cast<APlayerController>(Pawn->GetController());
	const ASkyLineHUD* Hud = PC ? Cast<ASkyLineHUD>(PC->GetHUD()) : nullptr;
	return Hud ? Hud->HoveredField : FString();
}

void ASkyLineAircraftPawn::OnZoomIn()
{
	const FString Field = HoveredMcpField(this);
	if (!Field.IsEmpty()) { McpAdjust(Field, 1); return; }
	if (View == ESkyLineView::Cockpit) CockpitFov = FMath::Clamp(CockpitFov - 5.0, 25.0, 100.0);
	else OrbitDistance = FMath::Max(800.0, OrbitDistance * 0.88);
}

void ASkyLineAircraftPawn::OnZoomOut()
{
	const FString Field = HoveredMcpField(this);
	if (!Field.IsEmpty()) { McpAdjust(Field, -1); return; }
	if (View == ESkyLineView::Cockpit) CockpitFov = FMath::Clamp(CockpitFov + 5.0, 25.0, 100.0);
	else OrbitDistance = FMath::Min(60000.0, OrbitDistance / 0.88);
}

void ASkyLineAircraftPawn::McpToggleAp()
{
	if (!Fcs) return;
	Fcs->EngageAp(!Fcs->Ap);
	ShowMessage(Fcs->Ap ? TEXT("AP ON") : TEXT("AP OFF"));
}

void ASkyLineAircraftPawn::McpToggleAthr()
{
	if (!Fcs) return;
	Fcs->ToggleAthr();
	if (Fcs->Athr == AthrMode::Off && Sim && !Sim->EngineCmds.empty()) Throttle = Sim->EngineCmds[0].Throttle;
}

void ASkyLineAircraftPawn::McpMode(const FString& Mode)
{
	if (!Fcs) return;
	if (Mode == TEXT("HDG")) Fcs->SetLat(LatMode::Hdg);
	else if (Mode == TEXT("NAV")) Fcs->SetLat(LatMode::Nav);
	else if (Mode == TEXT("LOC")) Fcs->SetLat(LatMode::Loc);
	else if (Mode == TEXT("APP")) Fcs->ArmApp();
	else if (Mode == TEXT("ALT")) Fcs->SetVert(VertMode::Alt);
	else if (Mode == TEXT("VS")) Fcs->SetVert(VertMode::Vs);
	else if (Mode == TEXT("FLC")) Fcs->SetVert(VertMode::Flc);
	else if (Mode == TEXT("SPD")) Fcs->SpdIsMach = !Fcs->SpdIsMach;
}

void ASkyLineAircraftPawn::McpAdjust(const FString& Field, double Delta)
{
	if (!Fcs) return;
	if (Field == TEXT("SPD"))
	{
		if (Fcs->SpdIsMach) Fcs->SelMach = FMath::Clamp(Fcs->SelMach + Delta * 0.01, 0.3, 0.99);
		else Fcs->SelSpd = FMath::Clamp(Fcs->SelSpd + Delta, 40.0, 400.0);
	}
	else if (Field == TEXT("HDG"))
	{
		Fcs->SelHdg = Wrap360(Fcs->SelHdg + Delta - 1) + 1;
	}
	else if (Field == TEXT("ALT"))
	{
		Fcs->SelAlt = FMath::Clamp(Fcs->SelAlt + Delta * 100, 0.0, 50000.0);
	}
	else if (Field == TEXT("VS"))
	{
		Fcs->SelVs = FMath::Clamp(Fcs->SelVs + Delta * 100, -6000.0, 6000.0);
	}
}

// ------------------------------------------------------------------------------------------------ cameras

void ASkyLineAircraftPawn::UpdateCamera(float Dt)
{
	if (!Entry)
	{
		return;
	}
	ExteriorMesh->SetVisibility(true);
	if (View == ESkyLineView::Cockpit)
	{
		const FVector Eye = (Entry->bHasEye ? Entry->Eye : FVector(Entry->Bounds.Max.X - Sim->Def.Length * 12.0, -50, 150)) + MeshOffset;
		Camera->SetRelativeLocationAndRotation(Eye, FRotator(HeadPitch, HeadYaw, 0));
		Camera->SetFieldOfView(static_cast<float>(CockpitFov));
		return;
	}
	const FVector Target = GetActorLocation();
	const double ActorYaw = GetActorRotation().Yaw;
	Camera->SetFieldOfView(60.f);
	if (View == ESkyLineView::Tower)
	{
		const FVector ToAc = Target - TowerLocation;
		const double Dist = ToAc.Size();
		Camera->SetWorldLocationAndRotation(TowerLocation, ToAc.Rotation());
		Camera->SetFieldOfView(static_cast<float>(FMath::Clamp(2.0 * FMath::RadiansToDegrees(FMath::Atan2(OrbitDistance * 0.9, Dist)), 2.0, 60.0)));
		if (Dist > 1500000.0)
		{
			SetView(ESkyLineView::Tower);  // too far: move the spotter
		}
		return;
	}
	const double Yaw = View == ESkyLineView::Chase ? ActorYaw + OrbitYaw + 180.0 : OrbitYaw;
	const FRotator Rot(OrbitPitch, Yaw, 0);
	Camera->SetWorldLocationAndRotation(Target - Rot.Vector() * OrbitDistance + FVector(0, 0, OrbitDistance * 0.08), Rot);
	(void)Dt;
}
