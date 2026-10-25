#include "SkyLinePlayerController.h"

#include "Engine/Engine.h"
#include "Engine/GameViewportClient.h"
#include "Framework/Application/SlateApplication.h"
#include "SkyLineAircraftPawn.h"
#include "SkyLineGameMode.h"
#include "SkyLineHUD.h"
#include "SkyLineMenu.h"
#include "Widgets/SWeakWidget.h"

ASkyLinePlayerController::ASkyLinePlayerController()
{
	bShowMouseCursor = true;
	bEnableClickEvents = true;
	bEnableMouseOverEvents = true;
}

void ASkyLinePlayerController::BeginPlay()
{
	Super::BeginPlay();
	if (!IsLocalController() || !GEngine || !GEngine->GameViewport)
	{
		return;
	}
	Overlay = SNew(SSkyLineOverlay).Controller(this);
	GEngine->GameViewport->AddViewportWidgetContent(Overlay.ToSharedRef(), 5);
	Menu = SNew(SSkyLineMenu).Controller(this);
	GEngine->GameViewport->AddViewportWidgetContent(Menu.ToSharedRef(), 10);
	ShowMenu(true);
}

void ASkyLinePlayerController::EndPlay(const EEndPlayReason::Type Reason)
{
	if (GEngine && GEngine->GameViewport)
	{
		if (Menu.IsValid()) GEngine->GameViewport->RemoveViewportWidgetContent(Menu.ToSharedRef());
		if (Overlay.IsValid()) GEngine->GameViewport->RemoveViewportWidgetContent(Overlay.ToSharedRef());
	}
	Super::EndPlay(Reason);
}

void ASkyLinePlayerController::SetupInputComponent()
{
	Super::SetupInputComponent();
	InputComponent->BindKey(EKeys::Escape, IE_Pressed, this, &ASkyLinePlayerController::OnEscape);
	InputComponent->BindKey(EKeys::M, IE_Pressed, this, &ASkyLinePlayerController::OnEscape);  // Esc ends PIE in the editor
	InputComponent->BindKey(EKeys::F10, IE_Pressed, this, &ASkyLinePlayerController::OnHelp);
	InputComponent->BindKey(EKeys::I, IE_Pressed, this, &ASkyLinePlayerController::OnToggleInstruments);
	InputComponent->BindKey(EKeys::Gamepad_Special_Right, IE_Pressed, this, &ASkyLinePlayerController::OnEscape);
}

void ASkyLinePlayerController::ShowMenu(bool bShow)
{
	bMenuVisible = bShow;
	if (Menu.IsValid())
	{
		Menu->SetVisibility(bShow ? EVisibility::Visible : EVisibility::Collapsed);
		if (bShow)
		{
			Menu->Refresh();
		}
	}
	if (ASkyLineAircraftPawn* Ac = Cast<ASkyLineAircraftPawn>(GetPawn()))
	{
		if (bShow != Ac->IsPaused())
		{
			Ac->TogglePause();
		}
	}
	FInputModeGameAndUI Mode;
	Mode.SetLockMouseToViewportBehavior(EMouseLockMode::DoNotLock);
	Mode.SetHideCursorDuringCapture(false);
	if (bShow && Menu.IsValid())
	{
		Mode.SetWidgetToFocus(Menu);
	}
	SetInputMode(Mode);
	if (!bShow)
	{
		FSlateApplication::Get().SetAllUserFocusToGameViewport();
	}
}

void ASkyLinePlayerController::OnEscape()
{
	// No flight yet: the menu stays up.
	if (!GetPawn())
	{
		ShowMenu(true);
		return;
	}
	ShowMenu(!bMenuVisible);
}

void ASkyLinePlayerController::OnToggleInstruments()
{
	if (ASkyLineHUD* Hud = Cast<ASkyLineHUD>(GetHUD()))
	{
		Hud->bShowInstruments = !Hud->bShowInstruments;
	}
}

void ASkyLinePlayerController::OnHelp()
{
	bHelpVisible = !bHelpVisible;
}
