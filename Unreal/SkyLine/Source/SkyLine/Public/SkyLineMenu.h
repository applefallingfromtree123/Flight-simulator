// Slate UI: the flight setup menu and the in-flight message overlay (Slate fonts include Hangul).
#pragma once

#include "CoreMinimal.h"
#include "SkyLineTypes.h"
#include "Widgets/SCompoundWidget.h"
#include "Widgets/Views/SListView.h"

class ASkyLinePlayerController;
class SEditableTextBox;
struct FSkyLineAirport;

class SKYLINE_API SSkyLineMenu : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(SSkyLineMenu) {}
		SLATE_ARGUMENT(TWeakObjectPtr<ASkyLinePlayerController>, Controller)
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);
	void Refresh();
	virtual bool SupportsKeyboardFocus() const override { return true; }

private:
	using FItem = TSharedPtr<FString>;
	TWeakObjectPtr<ASkyLinePlayerController> Controller;
	FSkyLineLaunch Launch;
	FText ErrorText;

	TArray<FItem> AircraftItems, LiveryItems, DepItems, DestItems;
	TSharedPtr<SListView<FItem>> AircraftList, LiveryList, DepList, DestList;
	TSharedPtr<SEditableTextBox> DepSearch, DestSearch, TokenBox, GoogleKeyBox;

	void RebuildLiveries();
	void SearchAirports(const FString& Query, TArray<FItem>& Out, TSharedPtr<SListView<FItem>> List);
	TSharedRef<ITableRow> MakeAircraftRow(FItem Item, const TSharedRef<STableViewBase>& Owner);
	TSharedRef<ITableRow> MakeLiveryRow(FItem Item, const TSharedRef<STableViewBase>& Owner);
	TSharedRef<ITableRow> MakeAirportRow(FItem Item, const TSharedRef<STableViewBase>& Owner);
	TSharedRef<SWidget> MakeChoiceRow(const TArray<FText>& Labels, TFunction<int32()> Get, TFunction<void(int32)> Set);
	FReply OnFly();
	FReply OnResume();
	FReply OnRestart();
	FReply OnSaveSettings();
	FText AirportLabel(const FString& Code) const;
};

class SKYLINE_API SSkyLineOverlay : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(SSkyLineOverlay) {}
		SLATE_ARGUMENT(TWeakObjectPtr<ASkyLinePlayerController>, Controller)
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);

private:
	TWeakObjectPtr<ASkyLinePlayerController> Controller;
	class ASkyLineAircraftPawn* GetAircraft() const;
};
