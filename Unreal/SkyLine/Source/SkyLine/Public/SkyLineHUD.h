// Glass-cockpit overlay drawn on the canvas: PFD, ND, engine/config display and a clickable MCP/FCU strip.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/HUD.h"
#include "SkyLineHUD.generated.h"

class ASkyLineAircraftPawn;
class UFont;

UCLASS()
class SKYLINE_API ASkyLineHUD : public AHUD
{
	GENERATED_BODY()

public:
	virtual void DrawHUD() override;
	virtual void NotifyHitBoxClick(FName BoxName) override;
	virtual void NotifyHitBoxBeginCursorOver(FName BoxName) override;
	virtual void NotifyHitBoxEndCursorOver(FName BoxName) override;

	/** MCP field under the mouse ("SPD", "HDG", "ALT", "VS") so the mouse wheel can adjust it. */
	FString HoveredField;
	bool bShowInstruments = true;

private:
	ASkyLineAircraftPawn* Aircraft = nullptr;
	float Scale = 1.f;
	UFont* SmallFont = nullptr;
	UFont* MediumFont = nullptr;

	void DrawPfd(float X, float Y, float Size);
	void DrawNd(float X, float Y, float Size);
	void DrawEngines(float X, float Y, float W, float H);
	void DrawMcp(float CenterX, float Y);
	void DrawInfo(float X, float Y);

	// primitives (pixels)
	void Rect(float X, float Y, float W, float H, const FLinearColor& C);
	void Frame(float X, float Y, float W, float H, const FLinearColor& C, float T = 1.f);
	void Line(const FVector2D& A, const FVector2D& B, const FLinearColor& C, float T = 1.5f);
	void Tri(const FVector2D& A, const FVector2D& B, const FVector2D& C, const FLinearColor& Col);
	void Poly(const TArray<FVector2D>& P, const FLinearColor& C);
	/** Align: 0 left, 1 centre, 2 right; vertical always centred on Y. */
	void Text(const FString& S, float X, float Y, const FLinearColor& C, int32 Align = 0, bool bLarge = false);
	void Arc(const FVector2D& C, float R, float A0Deg, float A1Deg, const FLinearColor& Col, float T = 1.5f);
	static TArray<FVector2D> ClipHalfPlane(const TArray<FVector2D>& Poly, const FVector2D& P, const FVector2D& N);
};
