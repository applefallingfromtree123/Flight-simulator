// The player aircraft: runs the C++ flight model at 120 Hz, places the converted FlightGear model on the
// Cesium globe, and handles cameras and controls.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Pawn.h"
#include "AircraftModelLoader.h"
#include "AirportDatabase.h"
#include "SkyLineTypes.h"
#include "FlightControl.h"
#include "FlightModel.h"
#include "SkyLineAircraftPawn.generated.h"

class ACesiumGeoreference;
class UCameraComponent;
class UCesiumGlobeAnchorComponent;
class UStaticMeshComponent;
class UAudioComponent;
class USkyLineEngineSound;

UCLASS()
class SKYLINE_API ASkyLineAircraftPawn : public APawn
{
	GENERATED_BODY()

public:
	ASkyLineAircraftPawn();

	/** Loads the aircraft model + livery and creates the flight model. */
	bool SetupAircraft(const FSkyLineLaunch& Launch, FString& OutError);
	void ApplyLivery(const FString& LiveryId);
	/** Starts the flight at the launch position once terrain under it has streamed in. */
	void BeginFlight(const FSkyLineLaunch& Launch);

	virtual void Tick(float DeltaSeconds) override;
	virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;

	// Read by the HUD.
	skyline::Aircraft* GetSim() const { return Sim.Get(); }
	skyline::FlightControl* GetFcs() const { return Fcs.Get(); }
	const skyline::SimEnv& GetEnv() const { return Env; }
	const FSkyLineAircraftEntry* GetEntry() const { return Entry; }
	const FSkyLineLivery* GetLivery() const { return Livery; }
	ESkyLineView GetView() const { return View; }
	bool IsWaitingForTerrain() const { return bWaitingForTerrain; }
	bool IsPaused() const { return bSimPaused; }
	double GetGeoidOffset() const { return GeoidOffset; }
	double GetTimeScale() const { return TimeScale; }
	const FSkyLineAirport* GetOrigin() const { return Origin; }
	const FSkyLineAirport* GetDestination() const { return Dest; }
	FString StatusMessage;
	double StatusMessageTime = 0;

	void SetView(ESkyLineView NewView);
	void TogglePause() { bSimPaused = !bSimPaused; }
	void ShowMessage(const FString& Msg);

	// MCP / FCU actions (also used by the clickable HUD panel).
	void McpToggleAp();
	void McpToggleAthr();
	void McpMode(const FString& Mode);
	void McpAdjust(const FString& Field, double Delta);

protected:
	virtual void BeginPlay() override;

private:
	UPROPERTY(VisibleAnywhere)
	TObjectPtr<USceneComponent> Body;
	UPROPERTY(VisibleAnywhere)
	TObjectPtr<UStaticMeshComponent> ExteriorMesh;
	UPROPERTY(VisibleAnywhere)
	TObjectPtr<UStaticMeshComponent> InteriorMesh;
	UPROPERTY(VisibleAnywhere)
	TObjectPtr<UCameraComponent> Camera;
	UPROPERTY(VisibleAnywhere)
	TObjectPtr<UCesiumGlobeAnchorComponent> GlobeAnchor;
	UPROPERTY(VisibleAnywhere)
	TObjectPtr<UAudioComponent> Audio;
	UPROPERTY(Transient)
	TObjectPtr<USkyLineEngineSound> EngineSound;
	/** Runtime meshes, materials and textures. */
	UPROPERTY(Transient)
	TArray<TObjectPtr<UObject>> ModelObjects;
	/** Gear/flap pose meshes and spinning propellers/rotors. */
	UPROPERTY(Transient)
	TArray<TObjectPtr<UStaticMeshComponent>> PartComponents;

	struct FPoseRuntime
	{
		FString Group;
		TArray<double> Values;
		TArray<UStaticMeshComponent*> Components;
		int32 Shown = -1;
	};
	struct FSpinRuntime
	{
		UStaticMeshComponent* Component = nullptr;
		FVector Axis = FVector::ForwardVector;
		FString Kind;
		int32 Engine = 0;
		double AngleDeg = 0;
	};
	TArray<FPoseRuntime> Poses;
	TArray<FSpinRuntime> Spins;

	FSkyLineAircraftModel Model;
	const FSkyLineAircraftEntry* Entry = nullptr;
	const FSkyLineLivery* Livery = nullptr;
	TUniquePtr<skyline::Aircraft> Sim;
	TUniquePtr<skyline::FlightControl> Fcs;
	skyline::SimEnv Env;
	skyline::PilotInput Pin;
	skyline::GroundSample Ground;
	const FSkyLineAirport* Origin = nullptr;
	const FSkyLineAirport* Dest = nullptr;
	FSkyLineLaunch LaunchOptions;

	double Accumulator = 0;
	double TimeScale = 1;
	bool bSimPaused = false;
	bool bWaitingForTerrain = false;
	double WaitStarted = 0;
	double GeoidOffset = 0;      // ellipsoid height - MSL near the departure airport (m)
	double GroundTraceTimer = 0;
	double LastRebaseLat = 1000, LastRebaseLon = 1000;
	FVector MeshOffset = FVector::ZeroVector;

	// controls
	double Throttle = 0;
	bool bReverse = false;
	double KeyPitch = 0, KeyRoll = 0, KeyYaw = 0;

	// cameras
	ESkyLineView View = ESkyLineView::Chase;
	double OrbitYaw = 180, OrbitPitch = -10, OrbitDistance = 0;
	double HeadYaw = 0, HeadPitch = 0, CockpitFov = 70;
	FVector TowerLocation = FVector::ZeroVector;

	ACesiumGeoreference* GetGeoreference() const;
	void PlaceOnGlobe();
	void UpdateGroundSample(bool bForce);
	bool TraceGround(double Lat, double Lon, double& OutEllipsoidHeight, bool& bOutWater) const;
	bool IsOnRunway(double Lat, double Lon) const;
	void PositionAtStart();
	void PollInput(float Dt);
	void UpdateCamera(float Dt);
	void CreatePartComponents();
	void UpdateParts(float Dt);
	void UpdateSound();

	void OnGear();
	void OnFlapsUp();
	void OnFlapsDown();
	void OnParkingBrake();
	void OnSpoilers();
	void OnCycleView();
	void OnCockpitView();
	void OnEngines();
	void OnApp();
	void OnToga();
	void OnTimeScale();
	void OnAutobrake();
	void OnZoomIn();
	void OnZoomOut();
};
