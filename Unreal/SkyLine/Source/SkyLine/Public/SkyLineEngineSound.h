// Real-time synthesised aircraft sound: turbofan (fan whine + jet roar), piston/turboprop harmonics,
// rotor blade slap, wind, runway rumble and the stall warning. Parameters are set from the game thread.
#pragma once

#include "CoreMinimal.h"
#include "Sound/SoundWaveProcedural.h"
#include <atomic>
#include "SkyLineEngineSound.generated.h"

UENUM()
enum class ESkyLineSoundKind : uint8 { Jet, Piston, Turboprop, Helicopter, Glider };

UCLASS()
class SKYLINE_API USkyLineEngineSound : public USoundWaveProcedural
{
	GENERATED_BODY()

public:
	USkyLineEngineSound(const FObjectInitializer& ObjectInitializer);

	void SetKind(ESkyLineSoundKind InKind) { Kind.store(static_cast<int32>(InKind)); }
	/** Engine speed 0..1 (N1, prop rpm or rotor rpm), thrust/power 0..1, true airspeed (m/s). */
	void SetState(float InSpeed, float InPower, float InTas, float InRumble, bool bInStall, bool bInInside)
	{
		Speed.store(InSpeed);
		Power.store(InPower);
		Tas.store(InTas);
		Rumble.store(InRumble);
		Stall.store(bInStall);
		Inside.store(bInInside);
	}

	virtual int32 OnGeneratePCMAudio(TArray<uint8>& OutAudio, int32 NumSamples) override;

private:
	std::atomic<int32> Kind{0};
	std::atomic<float> Speed{0}, Power{0}, Tas{0}, Rumble{0};
	std::atomic<bool> Stall{false}, Inside{false};

	// audio-thread state
	float SmoothSpeed = 0, SmoothPower = 0, SmoothTas = 0, SmoothRumble = 0;
	double Phase1 = 0, Phase2 = 0, Phase3 = 0, Time = 0;
	float Lp1 = 0, Lp2 = 0, Lp3 = 0, Lp4 = 0;
	uint32 Seed = 22222;

	float Noise()
	{
		Seed = Seed * 1664525u + 1013904223u;
		return static_cast<float>(Seed >> 8) / 8388608.f - 1.f;
	}
};
