#include "SkyLineEngineSound.h"

namespace
{
constexpr int32 kRate = 44100;
constexpr double kTwoPi = 6.283185307179586;

float OnePole(float& State, float In, float CutoffHz)
{
	const float A = 1.f - FMath::Exp(-static_cast<float>(kTwoPi) * CutoffHz / kRate);
	State += (In - State) * A;
	return State;
}
}  // namespace

USkyLineEngineSound::USkyLineEngineSound(const FObjectInitializer& ObjectInitializer)
	: Super(ObjectInitializer)
{
	SetSampleRate(kRate);
	NumChannels = 1;
	Duration = INDEFINITELY_LOOPING_DURATION;
	bLooping = true;
	bProcedural = true;
}

int32 USkyLineEngineSound::OnGeneratePCMAudio(TArray<uint8>& OutAudio, int32 NumSamples)
{
	OutAudio.SetNumUninitialized(NumSamples * static_cast<int32>(sizeof(int16)));
	int16* Out = reinterpret_cast<int16*>(OutAudio.GetData());
	const ESkyLineSoundKind K = static_cast<ESkyLineSoundKind>(Kind.load());
	const float TSpeed = Speed.load(), TPower = Power.load(), TTas = Tas.load(), TRumble = Rumble.load();
	const bool bStall = Stall.load(), bInside = Inside.load();
	const float Smooth = 1.f / (0.08f * kRate);
	for (int32 I = 0; I < NumSamples; I++)
	{
		SmoothSpeed += (TSpeed - SmoothSpeed) * Smooth;
		SmoothPower += (TPower - SmoothPower) * Smooth;
		SmoothTas += (TTas - SmoothTas) * Smooth;
		SmoothRumble += (TRumble - SmoothRumble) * Smooth;
		Time += 1.0 / kRate;
		const float N = Noise();
		float S = 0;
		switch (K)
		{
			case ESkyLineSoundKind::Jet:
			{
				// fan blade-passing whine, core whine and jet roar (low-passed noise opening up with power)
				const float Fan = 120.f + 2600.f * SmoothSpeed;
				Phase1 += Fan / kRate;
				Phase2 += (900.f + 5200.f * SmoothSpeed) / kRate;
				const float Whine = FMath::Sin(static_cast<float>(kTwoPi * Phase1)) * 0.10f + FMath::Sin(static_cast<float>(kTwoPi * Phase2)) * 0.05f;
				const float Roar = OnePole(Lp1, N, 250.f + 2200.f * SmoothPower);
				S = Whine * SmoothSpeed * (bInside ? 0.35f : 1.f) + Roar * (0.25f + 1.6f * SmoothPower * SmoothPower) * (bInside ? 0.5f : 1.f);
				break;
			}
			case ESkyLineSoundKind::Piston:
			case ESkyLineSoundKind::Turboprop:
			{
				// firing / blade-passing fundamental with rich harmonics (saw), plus exhaust noise
				const float F0 = K == ESkyLineSoundKind::Piston ? 8.f + 82.f * SmoothSpeed : 30.f + 70.f * SmoothSpeed;
				Phase1 += F0 / kRate;
				Phase1 -= FMath::FloorToDouble(Phase1);
				const float Saw = static_cast<float>(Phase1) * 2.f - 1.f;
				const float Buzz = OnePole(Lp2, Saw, 300.f + 900.f * SmoothPower);
				const float Exhaust = OnePole(Lp1, N, 500.f + 1500.f * SmoothPower);
				S = (Buzz * 0.9f + Exhaust * 0.35f) * (0.25f + 0.9f * SmoothPower) * FMath::Min(1.f, SmoothSpeed * 3.f);
				if (K == ESkyLineSoundKind::Turboprop)
				{
					Phase2 += (1500.f + 4000.f * SmoothSpeed) / kRate;
					S += FMath::Sin(static_cast<float>(kTwoPi * Phase2)) * 0.06f * SmoothSpeed;
				}
				break;
			}
			case ESkyLineSoundKind::Helicopter:
			{
				// main rotor blade slap (pulsed noise) + turbine whine
				const float Bpf = 17.f * SmoothSpeed;
				Phase1 += Bpf / kRate;
				Phase1 -= FMath::FloorToDouble(Phase1);
				const float Pulse = FMath::Exp(-static_cast<float>(Phase1) * 9.f);
				const float Slap = OnePole(Lp1, N, 180.f) * Pulse * (0.8f + 1.5f * SmoothPower);
				Phase2 += (2400.f + 3000.f * SmoothSpeed) / kRate;
				S = Slap * 2.2f + FMath::Sin(static_cast<float>(kTwoPi * Phase2)) * 0.05f * SmoothSpeed;
				break;
			}
			case ESkyLineSoundKind::Glider:
				break;
		}
		// wind noise rises with airspeed; runway rumble while rolling
		const float Wind = OnePole(Lp3, N, 300.f + SmoothTas * 6.f) * FMath::Min(1.2f, (SmoothTas / 140.f) * (SmoothTas / 140.f)) * (bInside ? 0.45f : 0.8f);
		const float Rumble = OnePole(Lp4, N, 90.f) * SmoothRumble * 1.6f;
		S += Wind + Rumble;
		// stall warning: 2.4 Hz horn
		if (bStall && FMath::Fmod(Time, 0.42) < 0.25)
		{
			Phase3 += 750.0 / kRate;
			S += FMath::Sin(static_cast<float>(kTwoPi * Phase3)) * 0.35f;
		}
		Phase1 -= FMath::FloorToDouble(Phase1);
		Phase2 -= FMath::FloorToDouble(Phase2);
		Phase3 -= FMath::FloorToDouble(Phase3);
		Out[I] = static_cast<int16>(FMath::Clamp(S * 0.45f, -1.f, 1.f) * 32000.f);
	}
	return NumSamples;
}
