#include "SkyLineMenu.h"

#include "AircraftLibrary.h"
#include "AirportDatabase.h"
#include "Engine/World.h"
#include "Fonts/SlateFontInfo.h"
#include "SkyLineAircraftPawn.h"
#include "SkyLineGameMode.h"
#include "SkyLinePlayerController.h"
#include "SkyLineSettings.h"
#include "SkyLineCareer.h"
#include "SkyLineActivities.h"
#include "Widgets/Layout/SWidgetSwitcher.h"
#include "Styling/CoreStyle.h"
#include "Widgets/Input/SButton.h"
#include "Widgets/Input/SEditableTextBox.h"
#include "Widgets/Input/SSlider.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/Layout/SScrollBox.h"
#include "Widgets/Layout/SSpacer.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/SOverlay.h"
#include "Widgets/Text/STextBlock.h"
#include "Widgets/Views/STableRow.h"

#define LOCTEXT_NAMESPACE "SkyLineMenu"

namespace
{
FSlateFontInfo Font(int32 Size, bool bBold = false)
{
	return FCoreStyle::GetDefaultFontStyle(bBold ? "Bold" : "Regular", Size);
}

const FLinearColor kPanel(0.015f, 0.02f, 0.03f, 0.92f);
const FLinearColor kAccent(0.20f, 0.62f, 1.0f, 1.f);
const FLinearColor kDim(0.62f, 0.68f, 0.75f, 1.f);

TSharedRef<SWidget> Header(const FText& Text)
{
	return SNew(STextBlock).Text(Text).Font(Font(15, true)).ColorAndOpacity(kAccent);
}

ASkyLineGameMode* GameModeOf(const TWeakObjectPtr<ASkyLinePlayerController>& PC)
{
	return PC.IsValid() && PC->GetWorld() ? Cast<ASkyLineGameMode>(PC->GetWorld()->GetAuthGameMode()) : nullptr;
}

const TArray<FText>& StartLabels()
{
	static const TArray<FText> L = {LOCTEXT("S0", "활주로 (엔진 가동)"), LOCTEXT("S1", "콜드 & 다크"), LOCTEXT("S2", "최종 접근 10nm"), LOCTEXT("S3", "순항 고도")};
	return L;
}

const TArray<FText>& WeatherLabels()
{
	static const TArray<FText> L = {LOCTEXT("W0", "맑음"), LOCTEXT("W1", "적운"), LOCTEXT("W2", "흐림"), LOCTEXT("W3", "뇌우"), LOCTEXT("W4", "저시정"), LOCTEXT("W5", "강한 측풍")};
	return L;
}
}  // namespace

void SSkyLineMenu::Construct(const FArguments& InArgs)
{
	Controller = InArgs._Controller;
	const USkyLineSettings* S = USkyLineSettings::Get();
	if (ASkyLineGameMode* GM = GameModeOf(Controller))
	{
		if (!GM->GetLastLaunch().AircraftId.IsEmpty())
		{
			Launch = GM->GetLastLaunch();
		}
	}

	ChildSlot
	[
		SNew(SBorder)
		.BorderImage(FCoreStyle::Get().GetBrush("WhiteBrush"))
		.BorderBackgroundColor(kPanel)
		.Padding(24)
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight().Padding(0, 0, 0, 12)
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Bottom)
				[
					SNew(STextBlock).Text(LOCTEXT("Title", "SkyLine Flight Simulator")).Font(Font(28, true))
				]
				+ SHorizontalBox::Slot().FillWidth(1).VAlign(VAlign_Bottom).Padding(16, 0)
				[
					SNew(STextBlock).Text(LOCTEXT("Sub", "실제 지구 · 실제 기체 · 실제 항공사 도색")).Font(Font(13)).ColorAndOpacity(kDim)
				]
			]
			+ SVerticalBox::Slot().AutoHeight().Padding(0, 0, 0, 14)
			[
				MakeChoiceRow({LOCTEXT("TabFree", "  자유 비행  "), LOCTEXT("TabCareer", "  커리어  "), LOCTEXT("TabAct", "  액티비티  ")},
					[this] { return Tab; }, [this](int32 V) { Tab = V; if (V == 1) RefreshCareer(); })
			]
			+ SVerticalBox::Slot().FillHeight(1)
			[
				SNew(SWidgetSwitcher)
				.WidgetIndex_Lambda([this] { return Tab; })
				+ SWidgetSwitcher::Slot()
				[
				SNew(SHorizontalBox)
				// ---------------- aircraft
				+ SHorizontalBox::Slot().FillWidth(0.30f).Padding(0, 0, 16, 0)
				[
					SNew(SVerticalBox)
					+ SVerticalBox::Slot().AutoHeight().Padding(0, 0, 0, 6)[Header(LOCTEXT("Aircraft", "기종"))]
					+ SVerticalBox::Slot().FillHeight(1)
					[
						SAssignNew(AircraftList, SListView<FItem>)
						.ListItemsSource(&AircraftItems)
						.SelectionMode(ESelectionMode::Single)
						.OnGenerateRow(this, &SSkyLineMenu::MakeAircraftRow)
						.OnSelectionChanged_Lambda([this](FItem Item, ESelectInfo::Type) {
							if (Item.IsValid())
							{
								Launch.AircraftId = *Item;
								Launch.LiveryId.Reset();
								RebuildLiveries();
							}
						})
					]
				]
				// ---------------- livery
				+ SHorizontalBox::Slot().FillWidth(0.30f).Padding(0, 0, 16, 0)
				[
					SNew(SVerticalBox)
					+ SVerticalBox::Slot().AutoHeight().Padding(0, 0, 0, 6)[Header(LOCTEXT("Livery", "도색 (실제 항공사)"))]
					+ SVerticalBox::Slot().FillHeight(1)
					[
						SAssignNew(LiveryList, SListView<FItem>)
						.ListItemsSource(&LiveryItems)
						.SelectionMode(ESelectionMode::Single)
						.OnGenerateRow(this, &SSkyLineMenu::MakeLiveryRow)
						.OnSelectionChanged_Lambda([this](FItem Item, ESelectInfo::Type) {
							if (Item.IsValid())
							{
								Launch.LiveryId = *Item;
							}
						})
					]
				]
				// ---------------- flight
				+ SHorizontalBox::Slot().FillWidth(0.40f)
				[
					SNew(SScrollBox)
					+ SScrollBox::Slot()
					[
						SNew(SVerticalBox)
						+ SVerticalBox::Slot().AutoHeight().Padding(0, 0, 0, 6)[Header(LOCTEXT("Dep", "출발 공항"))]
						+ SVerticalBox::Slot().AutoHeight()
						[
							SNew(STextBlock).Font(Font(12)).Text_Lambda([this] { return AirportLabel(Launch.Airport); })
						]
						+ SVerticalBox::Slot().AutoHeight().Padding(0, 4)
						[
							SAssignNew(DepSearch, SEditableTextBox)
							.HintText(LOCTEXT("DepHint", "ICAO / IATA / 도시 검색 (예: RKSI, 김포, Tokyo)"))
							.OnTextChanged_Lambda([this](const FText& T) { SearchAirports(T.ToString(), DepItems, DepList); })
						]
						+ SVerticalBox::Slot().AutoHeight()
						[
							SNew(SBox).HeightOverride(120)
							[
								SAssignNew(DepList, SListView<FItem>)
								.ListItemsSource(&DepItems)
								.OnGenerateRow(this, &SSkyLineMenu::MakeAirportRow)
								.OnSelectionChanged_Lambda([this](FItem Item, ESelectInfo::Type) { if (Item.IsValid()) { Launch.Airport = *Item; Launch.Runway.Reset(); } })
							]
						]
						+ SVerticalBox::Slot().AutoHeight().Padding(0, 10, 0, 6)[Header(LOCTEXT("Dest", "도착 공항 (ILS 자동착륙 가능)"))]
						+ SVerticalBox::Slot().AutoHeight()
						[
							SNew(STextBlock).Font(Font(12)).Text_Lambda([this] { return AirportLabel(Launch.Destination); })
						]
						+ SVerticalBox::Slot().AutoHeight().Padding(0, 4)
						[
							SAssignNew(DestSearch, SEditableTextBox)
							.HintText(LOCTEXT("DestHint", "도착 공항 검색"))
							.OnTextChanged_Lambda([this](const FText& T) { SearchAirports(T.ToString(), DestItems, DestList); })
						]
						+ SVerticalBox::Slot().AutoHeight()
						[
							SNew(SBox).HeightOverride(120)
							[
								SAssignNew(DestList, SListView<FItem>)
								.ListItemsSource(&DestItems)
								.OnGenerateRow(this, &SSkyLineMenu::MakeAirportRow)
								.OnSelectionChanged_Lambda([this](FItem Item, ESelectInfo::Type) { if (Item.IsValid()) { Launch.Destination = *Item; } })
							]
						]
						+ SVerticalBox::Slot().AutoHeight().Padding(0, 10, 0, 6)[Header(LOCTEXT("Start", "시작 위치"))]
						+ SVerticalBox::Slot().AutoHeight()
						[
							MakeChoiceRow(StartLabels(), [this] { return static_cast<int32>(Launch.Start); }, [this](int32 V) { Launch.Start = static_cast<ESkyLineStart>(V); })
						]
						+ SVerticalBox::Slot().AutoHeight().Padding(0, 10, 0, 6)[Header(LOCTEXT("Wx", "날씨"))]
						+ SVerticalBox::Slot().AutoHeight()
						[
							MakeChoiceRow(WeatherLabels(), [this] { return Launch.WeatherPreset; }, [this](int32 V) { Launch.WeatherPreset = V; })
						]
						+ SVerticalBox::Slot().AutoHeight().Padding(0, 10, 0, 6)[Header(LOCTEXT("Time", "현지 시각"))]
						+ SVerticalBox::Slot().AutoHeight()
						[
							SNew(SHorizontalBox)
							+ SHorizontalBox::Slot().FillWidth(1).VAlign(VAlign_Center)
							[
								SNew(SSlider)
								.MinValue(0.f).MaxValue(24.f)
								.Value_Lambda([this] { return Launch.LocalHour; })
								.OnValueChanged_Lambda([this](float V) { Launch.LocalHour = V; })
							]
							+ SHorizontalBox::Slot().AutoWidth().Padding(8, 0)
							[
								SNew(STextBlock).Font(Font(13, true)).Text_Lambda([this] {
									const int32 Minutes = FMath::RoundToInt(Launch.LocalHour * 60.f) % (24 * 60);
									return FText::FromString(FString::Printf(TEXT("%02d:%02d"), Minutes / 60, Minutes % 60));
								})
							]
						]
						+ SVerticalBox::Slot().AutoHeight().Padding(0, 18, 0, 0)
						[
							SNew(SHorizontalBox)
							+ SHorizontalBox::Slot().FillWidth(1)
							[
								SNew(SButton).HAlign(HAlign_Center).OnClicked(this, &SSkyLineMenu::OnFly)
								[
									SNew(STextBlock).Text(LOCTEXT("Fly", "비행 시작")).Font(Font(18, true))
								]
							]
							+ SHorizontalBox::Slot().AutoWidth().Padding(8, 0, 0, 0)
							[
								SNew(SButton).OnClicked(this, &SSkyLineMenu::OnRestart)
								.Visibility_Lambda([this] { return Controller.IsValid() && Controller->GetPawn() ? EVisibility::Visible : EVisibility::Collapsed; })
								[
									SNew(STextBlock).Text(LOCTEXT("Restart", "다시 시작")).Font(Font(14))
								]
							]
							+ SHorizontalBox::Slot().AutoWidth().Padding(8, 0, 0, 0)
							[
								SNew(SButton).OnClicked(this, &SSkyLineMenu::OnResume)
								.Visibility_Lambda([this] { return Controller.IsValid() && Controller->GetPawn() ? EVisibility::Visible : EVisibility::Collapsed; })
								[
									SNew(STextBlock).Text(LOCTEXT("Resume", "계속 비행 (M)")).Font(Font(14))
								]
							]
						]
						+ SVerticalBox::Slot().AutoHeight().Padding(0, 8)
						[
							SNew(STextBlock).Font(Font(12)).ColorAndOpacity(FLinearColor(1.f, 0.45f, 0.35f)).AutoWrapText(true).Text_Lambda([this] { return ErrorText; })
						]
						+ SVerticalBox::Slot().AutoHeight().Padding(0, 16, 0, 6)[Header(LOCTEXT("World", "지구 데이터 (Cesium)"))]
						+ SVerticalBox::Slot().AutoHeight()
						[
							MakeChoiceRow({LOCTEXT("G3D", "Google 실사 3D 타일"), LOCTEXT("CWT", "Cesium 지형 + Bing 위성")},
								[] { return static_cast<int32>(USkyLineSettings::Get()->WorldSource); },
								[](int32 V) { USkyLineSettings::GetMutable()->WorldSource = static_cast<ESkyLineWorldSource>(V); })
						]
						+ SVerticalBox::Slot().AutoHeight().Padding(0, 4)
						[
							SAssignNew(TokenBox, SEditableTextBox)
							.Text(FText::FromString(S->CesiumIonToken))
							.HintText(LOCTEXT("TokenHint", "Cesium ion 액세스 토큰 (ion.cesium.com 무료 가입)"))
						]
						+ SVerticalBox::Slot().AutoHeight().Padding(0, 4)
						[
							SAssignNew(GoogleKeyBox, SEditableTextBox)
							.Text(FText::FromString(S->GoogleMapsApiKey))
							.HintText(LOCTEXT("GoogleHint", "(선택) Google Maps API 키 - 직접 스트리밍"))
						]
						+ SVerticalBox::Slot().AutoHeight().Padding(0, 4)
						[
							SNew(SButton).OnClicked(this, &SSkyLineMenu::OnSaveSettings)
							[
								SNew(STextBlock).Text(LOCTEXT("Save", "저장 후 지구 다시 불러오기")).Font(Font(12))
							]
						]
					]
				]
				]
				+ SWidgetSwitcher::Slot()[MakeCareerPanel()]
				+ SWidgetSwitcher::Slot()[MakeActivitiesPanel()]
			]
			+ SVerticalBox::Slot().AutoHeight().Padding(0, 10, 0, 0)
			[
				SNew(STextBlock).Font(Font(11)).ColorAndOpacity(kDim).AutoWrapText(true)
				.Text(LOCTEXT("Credits", "기체·도색: FlightGear FGAddon (GPL) · 지구: Cesium / Google / Bing · 공항: OurAirports. 조작법은 비행 중 F10."))
			]
		]
	];
	Refresh();
}

void SSkyLineMenu::Refresh()
{
	AircraftItems.Reset();
	const TArray<FSkyLineAircraftEntry>& All = FAircraftLibrary::Get().GetAircraft();
	FItem Selected;
	for (const FSkyLineAircraftEntry& E : All)
	{
		FItem Item = MakeShared<FString>(E.Id);
		if (E.Id == Launch.AircraftId)
		{
			Selected = Item;
		}
		AircraftItems.Add(Item);
	}
	if (!Selected && AircraftItems.Num() > 0)
	{
		Selected = AircraftItems[0];
		Launch.AircraftId = *Selected;
	}
	if (All.Num() == 0)
	{
		ErrorText = FText::FromString(FString::Printf(TEXT("변환된 기체가 없습니다. 저장소 루트에서 실행: node tools/fgconv/convert.mjs\n(%s)"), *FAircraftLibrary::Get().GetRootDirectory()));
	}
	if (AircraftList.IsValid())
	{
		AircraftList->RequestListRefresh();
		if (Selected)
		{
			AircraftList->SetSelection(Selected);
			AircraftList->RequestScrollIntoView(Selected);
		}
	}
	RebuildLiveries();
	SearchAirports(DepSearch.IsValid() ? DepSearch->GetText().ToString() : FString(), DepItems, DepList);
	SearchAirports(DestSearch.IsValid() ? DestSearch->GetText().ToString() : FString(), DestItems, DestList);
}

void SSkyLineMenu::RebuildLiveries()
{
	LiveryItems.Reset();
	FItem Selected;
	if (const FSkyLineAircraftEntry* E = FAircraftLibrary::Get().Find(Launch.AircraftId))
	{
		const FString Want = Launch.LiveryId.IsEmpty() ? E->DefaultLivery : Launch.LiveryId;
		for (const FSkyLineLivery& L : E->Liveries)
		{
			FItem Item = MakeShared<FString>(L.Id);
			if (L.Id == Want)
			{
				Selected = Item;
			}
			LiveryItems.Add(Item);
		}
	}
	if (LiveryList.IsValid())
	{
		LiveryList->RequestListRefresh();
		if (Selected)
		{
			LiveryList->SetSelection(Selected);
			LiveryList->RequestScrollIntoView(Selected);
		}
	}
}

void SSkyLineMenu::SearchAirports(const FString& Query, TArray<FItem>& Out, TSharedPtr<SListView<FItem>> List)
{
	Out.Reset();
	for (const FSkyLineAirport* A : FAirportDatabase::Get().Search(Query, 40))
	{
		Out.Add(MakeShared<FString>(A->Icao));
	}
	if (List.IsValid())
	{
		List->RequestListRefresh();
	}
}

FText SSkyLineMenu::AirportLabel(const FString& Code) const
{
	const FSkyLineAirport* A = FAirportDatabase::Get().Find(Code);
	if (!A)
	{
		return FText::FromString(Code.IsEmpty() ? TEXT("-") : Code);
	}
	return FText::FromString(FString::Printf(TEXT("%s  %s  (%s, %s)  활주로 %d개"), *A->Icao, *A->Name, *A->City, *A->Country, A->Runways.Num()));
}

TSharedRef<ITableRow> SSkyLineMenu::MakeAircraftRow(FItem Item, const TSharedRef<STableViewBase>& Owner)
{
	const FSkyLineAircraftEntry* E = FAircraftLibrary::Get().Find(*Item);
	const FString Name = E ? E->Name : *Item;
	const FString Info = E ? FString::Printf(TEXT("실제 도색 %d종 · 폴리곤 %s"), E->Liveries.Num(), *FText::AsNumber(E->Triangles).ToString()) : FString();
	return SNew(STableRow<FItem>, Owner).Padding(FMargin(6, 4))
	[
		SNew(SVerticalBox)
		+ SVerticalBox::Slot().AutoHeight()[SNew(STextBlock).Text(FText::FromString(Name)).Font(Font(14, true))]
		+ SVerticalBox::Slot().AutoHeight()[SNew(STextBlock).Text(FText::FromString(Info)).Font(Font(10)).ColorAndOpacity(kDim)]
	];
}

TSharedRef<ITableRow> SSkyLineMenu::MakeLiveryRow(FItem Item, const TSharedRef<STableViewBase>& Owner)
{
	const FSkyLineAircraftEntry* E = FAircraftLibrary::Get().Find(Launch.AircraftId);
	const FSkyLineLivery* L = E ? E->FindLivery(*Item) : nullptr;
	const FString Name = L ? L->Name : *Item;
	const FString Info = L ? FString::Printf(TEXT("%s  %s"), *L->Operator, *L->Registration) : FString();
	return SNew(STableRow<FItem>, Owner).Padding(FMargin(6, 3))
	[
		SNew(SVerticalBox)
		+ SVerticalBox::Slot().AutoHeight()[SNew(STextBlock).Text(FText::FromString(Name)).Font(Font(13))]
		+ SVerticalBox::Slot().AutoHeight()[SNew(STextBlock).Text(FText::FromString(Info)).Font(Font(10)).ColorAndOpacity(kDim)]
	];
}

TSharedRef<ITableRow> SSkyLineMenu::MakeAirportRow(FItem Item, const TSharedRef<STableViewBase>& Owner)
{
	const FSkyLineAirport* A = FAirportDatabase::Get().Find(*Item);
	const FString Text = A ? FString::Printf(TEXT("%s  %s  %s · %s"), *A->Icao, *A->Iata, *A->Name, *A->City) : *Item;
	return SNew(STableRow<FItem>, Owner).Padding(FMargin(4, 2))
	[
		SNew(STextBlock).Text(FText::FromString(Text)).Font(Font(11))
	];
}

TSharedRef<SWidget> SSkyLineMenu::MakeChoiceRow(const TArray<FText>& Labels, TFunction<int32()> Get, TFunction<void(int32)> Set)
{
	TSharedRef<SHorizontalBox> Row = SNew(SHorizontalBox);
	for (int32 I = 0; I < Labels.Num(); I++)
	{
		Row->AddSlot().AutoWidth().Padding(0, 0, 6, 0)
		[
			SNew(SButton)
			.ButtonColorAndOpacity_Lambda([Get, I] { return Get() == I ? FSlateColor(kAccent) : FSlateColor(FLinearColor(0.25f, 0.28f, 0.32f)); })
			.OnClicked_Lambda([Set, I] { Set(I); return FReply::Handled(); })
			[
				SNew(STextBlock).Text(Labels[I]).Font(Font(11))
			]
		];
	}
	return Row;
}

FReply SSkyLineMenu::OnFly()
{
	FSkyLineLaunch L = Launch;
	L.Mission = FSkyLineMission();
	if (L.Start == ESkyLineStart::Custom) L.Start = ESkyLineStart::Runway;
	return LaunchWith(L);
}

FReply SSkyLineMenu::LaunchWith(const FSkyLineLaunch& L)
{
	ASkyLineGameMode* GM = GameModeOf(Controller);
	if (!GM)
	{
		return FReply::Handled();
	}
	FString Error;
	ErrorText = LOCTEXT("Loading", "기체를 불러오는 중...");
	if (!GM->Launch(L, Error))
	{
		ErrorText = FText::FromString(Error);
		return FReply::Handled();
	}
	ErrorText = FText::GetEmpty();
	Controller->ShowMenu(false);
	return FReply::Handled();
}

// ---------------------------------------------------------------------------------------------------- career

void SSkyLineMenu::RefreshCareer()
{
	FSkyLineCareer& C = FSkyLineCareer::Get();
	JobItems.Reset();
	for (const FSkyLineJob& J : C.Jobs(8))
	{
		JobItems.Add(MakeShared<FSkyLineJob>(J));
	}
	SelectedJob = JobItems.Num() > 0 ? JobItems[0] : nullptr;
	if (JobList.IsValid())
	{
		JobList->RequestListRefresh();
		if (SelectedJob) JobList->SetSelection(SelectedJob);
	}
	CareerAircraftItems.Reset();
	for (const FSkyLineAircraftEntry& E : FAircraftLibrary::Get().GetAircraft())
	{
		if (C.CanFly(E.FdmId)) CareerAircraftItems.Add(MakeShared<FString>(E.Id));
	}
	if (CareerAircraftList.IsValid())
	{
		CareerAircraftList->RequestListRefresh();
		for (const FItem& I : CareerAircraftItems)
		{
			if (*I == CareerAircraft) CareerAircraftList->SetSelection(I);
		}
	}
}

TSharedRef<SWidget> SSkyLineMenu::MakeCareerPanel()
{
	return SNew(SHorizontalBox)
	+ SHorizontalBox::Slot().FillWidth(0.28f).Padding(0, 0, 16, 0)
	[
		SNew(SScrollBox)
		+ SScrollBox::Slot()
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight().Padding(0, 0, 0, 6)[Header(LOCTEXT("Pilot", "조종사"))]
			+ SVerticalBox::Slot().AutoHeight()
			[
				SNew(STextBlock).Font(Font(13)).AutoWrapText(true).Text_Lambda([] {
					FSkyLineCareer& C = FSkyLineCareer::Get();
					const USkyLineSaveGame* S = C.Data();
					const int32 R = C.Rank();
					const FString Next = R < 4 ? FString::Printf(TEXT("다음 면장까지 %.0f XP"), FSkyLineCareer::RankXp(R + 1) - S->Xp) : FString(TEXT("최고 등급"));
					const FSkyLineAirport* A = FAirportDatabase::Get().Find(S->CurrentAirport);
					return FText::FromString(FString::Printf(TEXT("%s\n경험치 %.0f XP · %s\n자금 $%s\n평판 %.0f / 100\n비행 %d회 · %.1f시간\n현재 위치 %s %s"),
						*FSkyLineCareer::RankName(R).ToString(), S->Xp, *Next, *FText::AsNumber(FMath::RoundToInt(S->Money)).ToString(), S->Reputation,
						S->Flights, S->Hours, *S->CurrentAirport, A ? *A->Name : TEXT("")));
				})
			]
			+ SVerticalBox::Slot().AutoHeight().Padding(0, 10, 0, 0)
			[
				SNew(SButton).OnClicked_Lambda([this] { FSkyLineCareer::Get().RefreshJobs(); RefreshCareer(); return FReply::Handled(); })
				[SNew(STextBlock).Text(LOCTEXT("Refresh", "의뢰 새로고침")).Font(Font(12))]
			]
			+ SVerticalBox::Slot().AutoHeight().Padding(0, 6, 0, 0)
			[
				SNew(SButton).OnClicked_Lambda([this] { FSkyLineCareer::Get().Reset(TEXT("RKSS")); RefreshCareer(); return FReply::Handled(); })
				[SNew(STextBlock).Text(LOCTEXT("ResetCareer", "커리어 처음부터 (김포 RKSS)")).Font(Font(11))]
			]
			+ SVerticalBox::Slot().AutoHeight().Padding(0, 14, 0, 6)[Header(LOCTEXT("Log", "로그북"))]
			+ SVerticalBox::Slot().AutoHeight()
			[
				SNew(STextBlock).Font(Font(11)).ColorAndOpacity(kDim).AutoWrapText(true).Text_Lambda([] {
					FString S;
					const TArray<FSkyLineLogEntry>& Log = FSkyLineCareer::Get().Data()->Logbook;
					for (int32 I = 0; I < FMath::Min(8, Log.Num()); I++)
					{
						const FSkyLineLogEntry& E = Log[I];
						S += FString::Printf(TEXT("%s  %s→%s  %s  %.0f fpm  $%.0f%s\n"), *E.Date.Left(10), *E.From, *E.To, *E.Aircraft, E.LandingFpm, E.Pay, E.bSuccess ? TEXT("") : TEXT(" (실패)"));
					}
					return FText::FromString(S.IsEmpty() ? TEXT("아직 비행 기록이 없습니다.") : S);
				})
			]
		]
	]
	+ SHorizontalBox::Slot().FillWidth(0.40f).Padding(0, 0, 16, 0)
	[
		SNew(SVerticalBox)
		+ SVerticalBox::Slot().AutoHeight().Padding(0, 0, 0, 6)
		[
			SNew(STextBlock).Font(Font(15, true)).ColorAndOpacity(kAccent).Text_Lambda([] {
				return FText::FromString(FString::Printf(TEXT("의뢰 — 출발 %s"), *FSkyLineCareer::Get().Data()->CurrentAirport));
			})
		]
		+ SVerticalBox::Slot().FillHeight(1)
		[
			SAssignNew(JobList, SListView<TSharedPtr<FSkyLineJob>>)
			.ListItemsSource(&JobItems)
			.SelectionMode(ESelectionMode::Single)
			.OnSelectionChanged_Lambda([this](TSharedPtr<FSkyLineJob> J, ESelectInfo::Type) { if (J.IsValid()) SelectedJob = J; })
			.OnGenerateRow_Lambda([](TSharedPtr<FSkyLineJob> J, const TSharedRef<STableViewBase>& Owner) -> TSharedRef<ITableRow> {
				const FSkyLineAirport* To = FAirportDatabase::Get().Find(J->To);
				const FString Load = J->Kind == TEXT("화물") ? FString::Printf(TEXT("화물 %d kg"), J->Load) : J->Kind == TEXT("페리") ? FString(TEXT("기체 이동")) : FString::Printf(TEXT("승객 %d명"), J->Load);
				return SNew(STableRow<TSharedPtr<FSkyLineJob>>, Owner).Padding(FMargin(6, 4))
				[
					SNew(SVerticalBox)
					+ SVerticalBox::Slot().AutoHeight()
					[
						SNew(STextBlock).Font(Font(14, true)).Text(FText::FromString(FString::Printf(TEXT("[%s] %s → %s  $%s"), *J->Kind, *J->From, *J->To, *FText::AsNumber(FMath::RoundToInt(J->Pay)).ToString())))
					]
					+ SVerticalBox::Slot().AutoHeight()
					[
						SNew(STextBlock).Font(Font(10)).ColorAndOpacity(kDim).Text(FText::FromString(FString::Printf(TEXT("%s · %.0f km · %s · +%.0f XP"), To ? *To->Name : *J->To, J->DistanceKm, *Load, J->Xp)))
					]
				];
			})
		]
	]
	+ SHorizontalBox::Slot().FillWidth(0.32f)
	[
		SNew(SVerticalBox)
		+ SVerticalBox::Slot().AutoHeight().Padding(0, 0, 0, 6)[Header(LOCTEXT("CareerAc", "기체 (면장으로 운항 가능)"))]
		+ SVerticalBox::Slot().FillHeight(1)
		[
			SAssignNew(CareerAircraftList, SListView<FItem>)
			.ListItemsSource(&CareerAircraftItems)
			.SelectionMode(ESelectionMode::Single)
			.OnGenerateRow(this, &SSkyLineMenu::MakeAircraftRow)
			.OnSelectionChanged_Lambda([this](FItem Item, ESelectInfo::Type) { if (Item.IsValid()) CareerAircraft = *Item; })
		]
		+ SVerticalBox::Slot().AutoHeight().Padding(0, 10, 0, 0)
		[
			SNew(STextBlock).Font(Font(12)).AutoWrapText(true).ColorAndOpacity(kDim).Text_Lambda([this] {
				if (!SelectedJob.IsValid()) return LOCTEXT("NoJob", "의뢰를 선택하세요.");
				const skyline::AircraftDef* D = nullptr;
				if (const FSkyLineAircraftEntry* E = FAircraftLibrary::Get().Find(CareerAircraft)) D = skyline::FindAircraft(TCHAR_TO_UTF8(*E->FdmId));
				const bool bRange = !D || D->RangeKm <= 0 || D->RangeKm >= SelectedJob->DistanceKm;
				return FText::FromString(FString::Printf(TEXT("%s → %s, %.0f km%s"), *SelectedJob->From, *SelectedJob->To, SelectedJob->DistanceKm,
					bRange ? TEXT("") : TEXT("\n선택한 기체의 항속거리를 넘습니다. 연료가 부족할 수 있습니다.")));
			})
		]
		+ SVerticalBox::Slot().AutoHeight().Padding(0, 10, 0, 0)
		[
			SNew(SButton).HAlign(HAlign_Center).OnClicked(this, &SSkyLineMenu::OnAcceptJob)
			[SNew(STextBlock).Text(LOCTEXT("Accept", "의뢰 수락 · 출발")).Font(Font(18, true))]
		]
	];
}

FReply SSkyLineMenu::OnAcceptJob()
{
	if (!SelectedJob.IsValid() || CareerAircraft.IsEmpty())
	{
		ErrorText = LOCTEXT("PickJob", "의뢰와 기체를 선택하세요.");
		return FReply::Handled();
	}
	FSkyLineLaunch L = Launch;
	L.AircraftId = CareerAircraft;
	L.LiveryId.Reset();
	L.Airport = SelectedJob->From;
	L.Destination = SelectedJob->To;
	L.Runway.Reset();
	L.Start = ESkyLineStart::Runway;
	L.Mission.Type = ESkyLineMissionType::CareerJob;
	L.Mission.Title = FString::Printf(TEXT("%s 의뢰 %s → %s"), *SelectedJob->Kind, *SelectedJob->From, *SelectedJob->To);
	L.Mission.Job = *SelectedJob;
	return LaunchWith(L);
}

// ---------------------------------------------------------------------------------------------------- activities

TSharedRef<SWidget> SSkyLineMenu::MakeActivitiesPanel()
{
	ActivityItems.Reset();
	for (const FSkyLineActivity& A : SkyLineActivities())
	{
		ActivityItems.Add(MakeShared<FString>(A.Id));
	}
	SelectedActivity = SkyLineActivities()[0].Id;
	auto Find = [](const FString& Id) -> const FSkyLineActivity* {
		for (const FSkyLineActivity& A : SkyLineActivities()) if (A.Id == Id) return &A;
		return nullptr;
	};
	return SNew(SHorizontalBox)
	+ SHorizontalBox::Slot().FillWidth(0.5f).Padding(0, 0, 16, 0)
	[
		SNew(SVerticalBox)
		+ SVerticalBox::Slot().AutoHeight().Padding(0, 0, 0, 6)[Header(LOCTEXT("Acts", "착륙 챌린지 · 명소 비행"))]
		+ SVerticalBox::Slot().FillHeight(1)
		[
			SAssignNew(ActivityList, SListView<FItem>)
			.ListItemsSource(&ActivityItems)
			.SelectionMode(ESelectionMode::Single)
			.OnSelectionChanged_Lambda([this](FItem Item, ESelectInfo::Type) { if (Item.IsValid()) SelectedActivity = *Item; })
			.OnGenerateRow_Lambda([Find](FItem Item, const TSharedRef<STableViewBase>& Owner) -> TSharedRef<ITableRow> {
				const FSkyLineActivity* A = Find(*Item);
				const FString Kind = A && A->Type == ESkyLineMissionType::LandingChallenge ? TEXT("착륙 챌린지") : TEXT("명소 비행");
				return SNew(STableRow<FItem>, Owner).Padding(FMargin(6, 4))
				[
					SNew(SVerticalBox)
					+ SVerticalBox::Slot().AutoHeight()[SNew(STextBlock).Font(Font(14, true)).Text(A ? A->Title : FText::GetEmpty())]
					+ SVerticalBox::Slot().AutoHeight()[SNew(STextBlock).Font(Font(10)).ColorAndOpacity(kDim).Text(FText::FromString(Kind))]
				];
			})
		]
	]
	+ SHorizontalBox::Slot().FillWidth(0.5f)
	[
		SNew(SVerticalBox)
		+ SVerticalBox::Slot().AutoHeight().Padding(0, 0, 0, 8)
		[
			SNew(STextBlock).Font(Font(20, true)).AutoWrapText(true).Text_Lambda([this, Find] { const FSkyLineActivity* A = Find(SelectedActivity); return A ? A->Title : FText::GetEmpty(); })
		]
		+ SVerticalBox::Slot().AutoHeight().Padding(0, 0, 0, 8)
		[
			SNew(STextBlock).Font(Font(13)).AutoWrapText(true).Text_Lambda([this, Find] {
				const FSkyLineActivity* A = Find(SelectedActivity);
				if (!A) return FText::GetEmpty();
				const FSkyLineAircraftEntry* E = FAircraftLibrary::Get().Find(A->AircraftId);
				return FText::FromString(A->Description.ToString() + TEXT("\n\n기체: ") + (E ? E->Name : A->AircraftId + TEXT(" (변환 필요)")) +
					(A->Type == ESkyLineMissionType::LandingChallenge ? FString::Printf(TEXT("\n%s 활주로 %s · 최종접근 %.1f NM에서 수동 비행"), *A->Airport, *A->Runway, A->FinalNm) : FString()));
			})
		]
		+ SVerticalBox::Slot().AutoHeight().Padding(0, 10, 0, 0)
		[
			SNew(SButton).HAlign(HAlign_Center).OnClicked(this, &SSkyLineMenu::OnStartActivity)
			[SNew(STextBlock).Text(LOCTEXT("StartAct", "시작")).Font(Font(18, true))]
		]
	];
}

FReply SSkyLineMenu::OnStartActivity()
{
	for (const FSkyLineActivity& A : SkyLineActivities())
	{
		if (A.Id == SelectedActivity)
		{
			return LaunchWith(MakeActivityLaunch(A));
		}
	}
	return FReply::Handled();
}

FReply SSkyLineMenu::OnRestart()
{
	if (ASkyLineGameMode* GM = GameModeOf(Controller))
	{
		Launch = GM->GetLastLaunch();
		return OnFly();
	}
	return FReply::Handled();
}

FReply SSkyLineMenu::OnResume()
{
	if (Controller.IsValid())
	{
		Controller->ShowMenu(false);
	}
	return FReply::Handled();
}

FReply SSkyLineMenu::OnSaveSettings()
{
	USkyLineSettings* S = USkyLineSettings::GetMutable();
	S->CesiumIonToken = TokenBox->GetText().ToString().TrimStartAndEnd();
	S->GoogleMapsApiKey = GoogleKeyBox->GetText().ToString().TrimStartAndEnd();
	S->SaveConfig();
	if (ASkyLineGameMode* GM = GameModeOf(Controller))
	{
		GM->RebuildWorld();
	}
	ErrorText = LOCTEXT("Saved", "저장했습니다. 지구 데이터를 다시 불러옵니다.");
	return FReply::Handled();
}

// ---------------------------------------------------------------------------------------------------- overlay

ASkyLineAircraftPawn* SSkyLineOverlay::GetAircraft() const
{
	return Controller.IsValid() ? Cast<ASkyLineAircraftPawn>(Controller->GetPawn()) : nullptr;
}

void SSkyLineOverlay::Construct(const FArguments& InArgs)
{
	Controller = InArgs._Controller;
	ChildSlot
	[
		SNew(SOverlay)
		.Visibility(EVisibility::HitTestInvisible)
		// toast message (top centre, below the MCP strip)
		+ SOverlay::Slot().HAlign(HAlign_Center).VAlign(VAlign_Top).Padding(0, 96, 0, 0)
		[
			SNew(SBorder)
			.BorderImage(FCoreStyle::Get().GetBrush("WhiteBrush"))
			.BorderBackgroundColor(FLinearColor(0, 0, 0, 0.55f))
			.Padding(FMargin(14, 6))
			.Visibility_Lambda([this] {
				const ASkyLineAircraftPawn* Ac = GetAircraft();
				return Ac && !Ac->StatusMessage.IsEmpty() && FPlatformTime::Seconds() - Ac->StatusMessageTime < 4.0 ? EVisibility::HitTestInvisible : EVisibility::Collapsed;
			})
			[
				SNew(STextBlock).Font(Font(16, true)).Text_Lambda([this] {
					const ASkyLineAircraftPawn* Ac = GetAircraft();
					return Ac ? FText::FromString(Ac->StatusMessage) : FText::GetEmpty();
				})
			]
		]
		// mission objective (top)
		+ SOverlay::Slot().HAlign(HAlign_Center).VAlign(VAlign_Top).Padding(0, 140, 0, 0)
		[
			SNew(SBorder)
			.BorderImage(FCoreStyle::Get().GetBrush("WhiteBrush"))
			.BorderBackgroundColor(FLinearColor(0.02f, 0.05f, 0.1f, 0.6f))
			.Padding(FMargin(12, 4))
			.Visibility_Lambda([this] {
				const ASkyLineGameMode* GM = GameModeOf(Controller);
				return GM && !GM->GetObjectiveText().IsEmpty() && !GM->GetResult().bDone ? EVisibility::HitTestInvisible : EVisibility::Collapsed;
			})
			[
				SNew(STextBlock).Font(Font(13)).ColorAndOpacity(FLinearColor(0.75f, 0.9f, 1.f)).Text_Lambda([this] {
					const ASkyLineGameMode* GM = GameModeOf(Controller);
					return GM ? FText::FromString(GM->GetObjectiveText()) : FText::GetEmpty();
				})
			]
		]
		// mission result
		+ SOverlay::Slot().HAlign(HAlign_Center).VAlign(VAlign_Center)
		[
			SNew(SBorder)
			.BorderImage(FCoreStyle::Get().GetBrush("WhiteBrush"))
			.BorderBackgroundColor(FLinearColor(0.01f, 0.03f, 0.07f, 0.88f))
			.Padding(FMargin(36, 24))
			.Visibility_Lambda([this] {
				const ASkyLineGameMode* GM = GameModeOf(Controller);
				const ASkyLineAircraftPawn* Ac = GetAircraft();
				const bool bCrashed = Ac && Ac->GetSim() && Ac->GetSim()->Crashed;
				return GM && GM->GetResult().bDone && !bCrashed ? EVisibility::HitTestInvisible : EVisibility::Collapsed;
			})
			[
				SNew(SVerticalBox)
				+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center)
				[
					SNew(STextBlock).Font(Font(20, true)).Text_Lambda([this] {
						const ASkyLineGameMode* GM = GameModeOf(Controller);
						return GM ? FText::FromString(GM->GetMission().Title) : FText::GetEmpty();
					})
				]
				+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(0, 8)
				[
					SNew(STextBlock).Font(Font(54, true)).ColorAndOpacity(kAccent).Text_Lambda([this] {
						const ASkyLineGameMode* GM = GameModeOf(Controller);
						if (!GM) return FText::GetEmpty();
						const FSkyLineMissionResult& R = GM->GetResult();
						return FText::FromString(R.bSuccess ? FString::Printf(TEXT("%s  %d점"), *R.Grade, R.Score) : TEXT("실패"));
					})
				]
				+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center)
				[
					SNew(STextBlock).Font(Font(15)).Justification(ETextJustify::Center).Text_Lambda([this] {
						const ASkyLineGameMode* GM = GameModeOf(Controller);
						return GM ? FText::FromString(GM->GetResult().Text + TEXT("\n\n메뉴(M / 메뉴 버튼)에서 계속")) : FText::GetEmpty();
					})
				]
			]
		]
		// terrain loading / crash banner (centre)
		+ SOverlay::Slot().HAlign(HAlign_Center).VAlign(VAlign_Center)
		[
			SNew(SBorder)
			.BorderImage(FCoreStyle::Get().GetBrush("WhiteBrush"))
			.BorderBackgroundColor(FLinearColor(0.05f, 0, 0, 0.75f))
			.Padding(FMargin(28, 16))
			.Visibility_Lambda([this] {
				const ASkyLineAircraftPawn* Ac = GetAircraft();
				return Ac && (Ac->IsWaitingForTerrain() || (Ac->GetSim() && Ac->GetSim()->Crashed)) ? EVisibility::HitTestInvisible : EVisibility::Collapsed;
			})
			[
				SNew(STextBlock).Font(Font(22, true)).Justification(ETextJustify::Center).Text_Lambda([this] {
					const ASkyLineAircraftPawn* Ac = GetAircraft();
					if (!Ac) return FText::GetEmpty();
					if (Ac->IsWaitingForTerrain()) return LOCTEXT("Streaming", "지형과 공항을 불러오는 중...");
					return FText::FromString(FString(UTF8_TO_TCHAR(Ac->GetSim()->CrashReason.c_str())) + TEXT("\nM 키 → 메뉴 → 다시 시작"));
				})
			]
		]
		// help (F10)
		+ SOverlay::Slot().HAlign(HAlign_Right).VAlign(VAlign_Center).Padding(0, 0, 24, 0)
		[
			SNew(SBorder)
			.BorderImage(FCoreStyle::Get().GetBrush("WhiteBrush"))
			.BorderBackgroundColor(FLinearColor(0, 0, 0, 0.7f))
			.Padding(16)
			.Visibility_Lambda([this] { return Controller.IsValid() && Controller->IsHelpVisible() ? EVisibility::HitTestInvisible : EVisibility::Collapsed; })
			[
				SNew(STextBlock).Font(Font(12)).Text(LOCTEXT("Help",
					"조종\n"
					"  ↑↓ / W S        피치 (↑ 기수 내림)\n"
					"  ←→ / A D        롤\n"
					"  Q E             러더\n"
					"  F3 / PgUp  F2 / PgDn   스로틀 ±   F4 최대  F1 아이들\n"
					"  R (누른 채)      역추력\n"
					"  Num1 / Num7     트림 (기수 올림/내림)\n"
					"  F7 ]  F6 [      플랩 내림 / 올림\n"
					"  G               랜딩기어\n"
					"  /  ·  Shift+/   스피드브레이크 · 그라운드 스포일러 암\n"
					"  .  (누른 채)     브레이크      P  파킹브레이크    B 오토브레이크\n"
					"  Ctrl+E          엔진 자동 시동/정지\n"
					"\n자동비행 (화면 상단 MCP 패널 클릭 / 휠로 값 조절)\n"
					"  Z  AP     T  A/THR     L  APP(ILS)     Insert  TOGA\n"
					"\n카메라\n"
					"  V 시점 전환  C 조종석   마우스 오른쪽 드래그 둘러보기   휠 줌\n"
					"\n기타\n"
					"  Tab 시뮬 속도 x1/x2/x4   Pause 일시정지   M 메뉴   I 계기 표시   F10 도움말\n"
					"  게임패드: 왼스틱 조종, 오른스틱 러더/스로틀, 트리거 브레이크"))
			]
		]
	];
}

#undef LOCTEXT_NAMESPACE
