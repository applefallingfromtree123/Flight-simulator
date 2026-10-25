// Mouse-driven controller: cursor always available for the HUD panels, Esc opens the menu.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/PlayerController.h"
#include "SkyLinePlayerController.generated.h"

class SSkyLineMenu;
class SSkyLineOverlay;
class SSkyLineTouchControls;

UCLASS()
class SKYLINE_API ASkyLinePlayerController : public APlayerController
{
	GENERATED_BODY()

public:
	ASkyLinePlayerController();

	void ShowMenu(bool bShow);
	bool IsMenuVisible() const { return bMenuVisible; }
	bool IsHelpVisible() const { return bHelpVisible; }
	bool IsTouchUi() const { return bTouchUi; }

protected:
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type Reason) override;
	virtual void SetupInputComponent() override;
	virtual void PlayerTick(float DeltaTime) override;

private:
	TSharedPtr<SSkyLineMenu> Menu;
	TSharedPtr<SSkyLineOverlay> Overlay;
	TSharedPtr<SSkyLineTouchControls> TouchControls;
	bool bTouchUi = false;
	void SetTouchUi(bool bOn);
	void OnToggleTouch();
	bool bMenuVisible = false;
	bool bHelpVisible = false;

	void OnEscape();
	void OnHelp();
	void OnToggleInstruments();
};
