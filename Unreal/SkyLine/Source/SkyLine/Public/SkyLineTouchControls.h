// On-screen flight controls for touch screens (iPad): virtual yoke, throttle lever, rudder strip and cockpit
// buttons. Touches elsewhere drag the camera (one finger), zoom it (two fingers) or tap the MCP panel.
#pragma once

#include "CoreMinimal.h"
#include "Widgets/SLeafWidget.h"

class ASkyLinePlayerController;
class ASkyLineAircraftPawn;

class SKYLINE_API SSkyLineTouchControls : public SLeafWidget
{
public:
	SLATE_BEGIN_ARGS(SSkyLineTouchControls) {}
		SLATE_ARGUMENT(TWeakObjectPtr<ASkyLinePlayerController>, Controller)
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);

	virtual FVector2D ComputeDesiredSize(float) const override { return FVector2D(100, 100); }
	virtual int32 OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry, const FSlateRect& MyCullingRect,
		FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const override;
	virtual FReply OnTouchStarted(const FGeometry& MyGeometry, const FPointerEvent& Event) override;
	virtual FReply OnTouchMoved(const FGeometry& MyGeometry, const FPointerEvent& Event) override;
	virtual FReply OnTouchEnded(const FGeometry& MyGeometry, const FPointerEvent& Event) override;

private:
	enum class EControl : uint8 { None, Stick, Throttle, Rudder, Button, Look };
	struct FButton { FString Command; FText Label; FVector2D Pos, Size; };
	struct FActive { EControl Control = EControl::None; FVector2D Start, Last; int32 Button = INDEX_NONE; double StartTime = 0; };

	TWeakObjectPtr<ASkyLinePlayerController> Controller;
	TMap<uint32, FActive> Active;
	FVector2D StickKnob = FVector2D::ZeroVector;  // -1..1
	double RudderValue = 0;
	mutable FVector2D LastSize = FVector2D(1600, 1200);

	ASkyLineAircraftPawn* GetAircraft() const;
	// layout in local units for a given widget size
	void Layout(const FVector2D& Size, FVector2D& StickCenter, float& StickRadius, FBox2D& ThrottleBox, FBox2D& RudderBox, TArray<FButton>& Buttons) const;
	EControl HitTest(const FVector2D& Local, int32& OutButton) const;
	void UpdateStick(const FVector2D& Local);
	void UpdateThrottle(const FVector2D& Local);
	void UpdateRudder(const FVector2D& Local);
	double LookPinchDistance() const;
};
