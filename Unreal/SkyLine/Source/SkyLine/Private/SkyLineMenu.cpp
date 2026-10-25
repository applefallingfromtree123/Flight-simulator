#include "SkyLineMenu.h"

#include "AircraftLibrary.h"
#include "AirportDatabase.h"
#include "Engine/World.h"
#include "Fonts/SlateFontInfo.h"
#include "SkyLineAircraftPawn.h"
#include "SkyLineGameMode.h"
#include "SkyLinePlayerController.h"
#include "SkyLineSettings.h"
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
			+ SVerticalBox::Slot().FillHeight(1)
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
	ASkyLineGameMode* GM = GameModeOf(Controller);
	if (!GM)
	{
		return FReply::Handled();
	}
	FString Error;
	ErrorText = LOCTEXT("Loading", "기체를 불러오는 중...");
	if (!GM->Launch(Launch, Error))
	{
		ErrorText = FText::FromString(Error);
		return FReply::Handled();
	}
	ErrorText = FText::GetEmpty();
	Controller->ShowMenu(false);
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
