// Glass-cockpit overlay drawn on the canvas: PFD, ND, engine/config display and a clickable MCP/FCU strip.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/HUD.h"
#include "SkyLineHUD.generated.h"

class ASkyLineAircraftPawn;
class UCanvas;
class UCanvasRenderTarget2D;
class UFont;
class UTexture;

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

	/** Touch layout: instruments move to the top so the on-screen yoke/throttle fit at the bottom. */
	bool bTouchLayout = false;
	/** Handles a tap (canvas pixels) on the MCP strip. Returns true if a control was hit. */
	bool TapAt(const FVector2D& Pixel);

	/** Live instrument texture for 3D cockpit displays ("PFD", "ND", "EICAS"; "MFD" shows the PFD). */
	UTexture* GetScreenTexture(const FString& Kind);

private:
	UFUNCTION()
	void DrawPfdTarget(UCanvas* TargetCanvas, int32 Width, int32 Height);
	UFUNCTION()
	void DrawNdTarget(UCanvas* TargetCanvas, int32 Width, int32 Height);
	UFUNCTION()
	void DrawEicasTarget(UCanvas* TargetCanvas, int32 Width, int32 Height);

	UPROPERTY(Transient)
	TArray<TObjectPtr<UCanvasRenderTarget2D>> ScreenTargets;  // PFD, ND, EICAS
	double ScreenUpdateTime = 0;

	void DrawIntoTarget(UCanvas* TargetCanvas, int32 Height, int32 Which);

	struct FMcpRect { FBox2D Box; FName Name; };
	TArray<FMcpRect> McpRects;

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
