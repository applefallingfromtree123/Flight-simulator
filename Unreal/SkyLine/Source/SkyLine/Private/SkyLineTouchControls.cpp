#include "SkyLineTouchControls.h"

#include "Brushes/SlateRoundedBoxBrush.h"
#include "Fonts/SlateFontInfo.h"
#include "Rendering/DrawElements.h"
#include "SkyLineAircraftPawn.h"
#include "SkyLineHUD.h"
#include "SkyLinePlayerController.h"
#include "Styling/CoreStyle.h"

#define LOCTEXT_NAMESPACE "SkyLineTouch"

namespace
{
const FSlateRoundedBoxBrush& RoundBrush()
{
	static const FSlateRoundedBoxBrush Brush(FLinearColor::White, 16.f);
	return Brush;
}
const FSlateRoundedBoxBrush& CircleBrush()
{
	static const FSlateRoundedBoxBrush Brush(FLinearColor::White, 1000.f);
	return Brush;
}
void Box(FSlateWindowElementList& Out, int32 Layer, const FGeometry& G, const FVector2D& Pos, const FVector2D& Size, const FSlateBrush& Brush, const FLinearColor& Color)
{
	FSlateDrawElement::MakeBox(Out, Layer, G.ToPaintGeometry(FVector2f(Size), FSlateLayoutTransform(FVector2f(Pos))), &Brush, ESlateDrawEffect::None, Color);
}
void Label(FSlateWindowElementList& Out, int32 Layer, const FGeometry& G, const FVector2D& Center, const FText& Text, int32 Size, const FLinearColor& Color)
{
	const FSlateFontInfo Font = FCoreStyle::GetDefaultFontStyle("Bold", Size);
	const float W = Size * 0.62f * Text.ToString().Len();
	FSlateDrawElement::MakeText(Out, Layer, G.ToPaintGeometry(FVector2f(W, Size * 1.4f), FSlateLayoutTransform(FVector2f(Center - FVector2D(W / 2, Size * 0.7f)))),
		Text, Font, ESlateDrawEffect::None, Color);
}
}  // namespace

void SSkyLineTouchControls::Construct(const FArguments& InArgs)
{
	Controller = InArgs._Controller;
	SetVisibility(EVisibility::Visible);
}

ASkyLineAircraftPawn* SSkyLineTouchControls::GetAircraft() const
{
	return Controller.IsValid() ? Cast<ASkyLineAircraftPawn>(Controller->GetPawn()) : nullptr;
}

void SSkyLineTouchControls::Layout(const FVector2D& Size, FVector2D& StickCenter, float& StickRadius, FBox2D& ThrottleBox, FBox2D& RudderBox, TArray<FButton>& Buttons) const
{
	const float M = static_cast<float>(FMath::Min(Size.X, Size.Y));
	StickRadius = M * 0.17f;
	StickCenter = FVector2D(StickRadius + M * 0.05f, Size.Y - StickRadius - M * 0.11f);
	const float Tw = M * 0.085f;
	ThrottleBox = FBox2D(FVector2D(Size.X - Tw - M * 0.04f, Size.Y * 0.38f), FVector2D(Size.X - M * 0.04f, Size.Y - M * 0.05f));
	RudderBox = FBox2D(FVector2D(StickCenter.X - StickRadius, Size.Y - M * 0.075f), FVector2D(StickCenter.X + StickRadius, Size.Y - M * 0.02f));
	// two rows of buttons between the yoke and the throttle
	static const TCHAR* Cmds[] = {TEXT("GEAR"), TEXT("FLAPS_UP"), TEXT("FLAPS_DOWN"), TEXT("SPOILERS"), TEXT("BRAKE"), TEXT("PARK"),
		TEXT("AP"), TEXT("ATHR"), TEXT("APP"), TEXT("VIEW"), TEXT("ENGINES"), TEXT("MENU")};
	static const FText Labels[] = {LOCTEXT("Gear", "기어"), LOCTEXT("FlapUp", "플랩 ▲"), LOCTEXT("FlapDn", "플랩 ▼"), LOCTEXT("Spl", "스포일러"),
		LOCTEXT("Brk", "브레이크"), LOCTEXT("Park", "파킹"), LOCTEXT("Ap", "AP"), LOCTEXT("Athr", "A/THR"), LOCTEXT("App", "APP"),
		LOCTEXT("View", "시점"), LOCTEXT("Eng", "엔진"), LOCTEXT("Menu", "메뉴")};
	const float Left = StickCenter.X + StickRadius + M * 0.06f;
	const float Right = static_cast<float>(ThrottleBox.Min.X) - M * 0.04f;
	const int32 PerRow = 6;
	const float Gap = M * 0.012f;
	const float Bw = (Right - Left - Gap * (PerRow - 1)) / PerRow;
	const float Bh = M * 0.075f;
	Buttons.Reset();
	for (int32 I = 0; I < 12; I++)
	{
		const int32 Row = I / PerRow, Col = I % PerRow;
		FButton B;
		B.Command = Cmds[I];
		B.Label = Labels[I];
		B.Size = FVector2D(Bw, Bh);
		B.Pos = FVector2D(Left + Col * (Bw + Gap), Size.Y - M * 0.04f - (2 - Row) * (Bh + Gap));
		Buttons.Add(B);
	}
}

int32 SSkyLineTouchControls::OnPaint(const FPaintArgs& Args, const FGeometry& G, const FSlateRect& MyCullingRect,
	FSlateWindowElementList& Out, int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const
{
	const ASkyLineAircraftPawn* Ac = GetAircraft();
	const ASkyLinePlayerController* PC = Controller.Get();
	if (!Ac || !PC || PC->IsMenuVisible())
	{
		return LayerId;
	}
	const FVector2D Size = G.GetLocalSize();
	LastSize = Size;
	FVector2D Sc; float Sr; FBox2D Tb, Rb; TArray<FButton> Buttons;
	Layout(Size, Sc, Sr, Tb, Rb, Buttons);
	const FLinearColor Panel(0.02f, 0.03f, 0.05f, 0.45f), Edge(1, 1, 1, 0.18f), Accent(0.2f, 0.65f, 1.f, 0.85f);

	// yoke
	Box(Out, LayerId, G, Sc - FVector2D(Sr, Sr), FVector2D(Sr * 2, Sr * 2), CircleBrush(), Panel);
	Box(Out, LayerId + 1, G, Sc - FVector2D(2, Sr), FVector2D(4, Sr * 2), RoundBrush(), Edge);
	Box(Out, LayerId + 1, G, Sc - FVector2D(Sr, 2), FVector2D(Sr * 2, 4), RoundBrush(), Edge);
	const float Kr = Sr * 0.32f;
	const FVector2D Knob = Sc + StickKnob * Sr * 0.75;
	Box(Out, LayerId + 2, G, Knob - FVector2D(Kr, Kr), FVector2D(Kr * 2, Kr * 2), CircleBrush(), Accent);
	Label(Out, LayerId + 3, G, Sc + FVector2D(0, -Sr - 18), LOCTEXT("Yoke", "조종간"), 14, FLinearColor(1, 1, 1, 0.7f));

	// rudder
	Box(Out, LayerId, G, Rb.Min, Rb.GetSize(), RoundBrush(), Panel);
	const double Rx = Rb.GetCenter().X + RudderValue * Rb.GetSize().X * 0.45;
	Box(Out, LayerId + 1, G, FVector2D(Rx - 14, Rb.Min.Y + 4), FVector2D(28, Rb.GetSize().Y - 8), RoundBrush(), Accent);
	Label(Out, LayerId + 2, G, Rb.GetCenter(), LOCTEXT("Rudder", "러더"), 12, FLinearColor(1, 1, 1, 0.6f));

	// throttle lever
	Box(Out, LayerId, G, Tb.Min, Tb.GetSize(), RoundBrush(), Panel);
	const double Thr = Ac->GetThrottle();
	const double Ty = Tb.Max.Y - Thr * Tb.GetSize().Y;
	Box(Out, LayerId + 1, G, FVector2D(Tb.Min.X, Ty), FVector2D(Tb.GetSize().X, Tb.Max.Y - Ty), RoundBrush(), FLinearColor(0.2f, 0.65f, 1.f, 0.35f));
	Box(Out, LayerId + 2, G, FVector2D(Tb.Min.X - 6, Ty - 14), FVector2D(Tb.GetSize().X + 12, 28), RoundBrush(), Accent);
	Label(Out, LayerId + 3, G, FVector2D(Tb.GetCenter().X, Tb.Min.Y - 22), FText::FromString(FString::Printf(TEXT("%d%%"), FMath::RoundToInt(Thr * 100))), 16, FLinearColor::White);

	// buttons
	for (int32 I = 0; I < Buttons.Num(); I++)
	{
		const FButton& B = Buttons[I];
		bool bPressed = false;
		for (const auto& Pair : Active) bPressed |= Pair.Value.Control == EControl::Button && Pair.Value.Button == I;
		Box(Out, LayerId, G, B.Pos, B.Size, RoundBrush(), bPressed ? Accent : Panel);
		Label(Out, LayerId + 1, G, B.Pos + B.Size / 2, B.Label, 15, FLinearColor::White);
	}
	return LayerId + 4;
}

SSkyLineTouchControls::EControl SSkyLineTouchControls::HitTest(const FVector2D& Local, int32& OutButton) const
{
	FVector2D Sc; float Sr; FBox2D Tb, Rb; TArray<FButton> Buttons;
	Layout(LastSize, Sc, Sr, Tb, Rb, Buttons);
	OutButton = INDEX_NONE;
	if (FVector2D::Distance(Local, Sc) < Sr * 1.15) return EControl::Stick;
	if (Tb.ExpandBy(20).IsInside(Local)) return EControl::Throttle;
	if (Rb.ExpandBy(10).IsInside(Local)) return EControl::Rudder;
	for (int32 I = 0; I < Buttons.Num(); I++)
	{
		if (FBox2D(Buttons[I].Pos, Buttons[I].Pos + Buttons[I].Size).IsInside(Local))
		{
			OutButton = I;
			return EControl::Button;
		}
	}
	return EControl::Look;
}

void SSkyLineTouchControls::UpdateStick(const FVector2D& Local)
{
	FVector2D Sc; float Sr; FBox2D Tb, Rb; TArray<FButton> Buttons;
	Layout(LastSize, Sc, Sr, Tb, Rb, Buttons);
	FVector2D D = (Local - Sc) / (Sr * 0.75);
	if (D.Size() > 1) D = D.GetSafeNormal();
	StickKnob = D;
	if (ASkyLineAircraftPawn* Ac = GetAircraft())
	{
		Ac->Touch.bStick = true;
		Ac->Touch.Roll = D.X;
		Ac->Touch.Pitch = D.Y;  // pull the knob down = nose up, like a yoke
	}
}

void SSkyLineTouchControls::UpdateThrottle(const FVector2D& Local)
{
	FVector2D Sc; float Sr; FBox2D Tb, Rb; TArray<FButton> Buttons;
	Layout(LastSize, Sc, Sr, Tb, Rb, Buttons);
	if (ASkyLineAircraftPawn* Ac = GetAircraft())
	{
		Ac->Touch.Throttle = FMath::Clamp((Tb.Max.Y - Local.Y) / Tb.GetSize().Y, 0.0, 1.0);
	}
}

void SSkyLineTouchControls::UpdateRudder(const FVector2D& Local)
{
	FVector2D Sc; float Sr; FBox2D Tb, Rb; TArray<FButton> Buttons;
	Layout(LastSize, Sc, Sr, Tb, Rb, Buttons);
	RudderValue = FMath::Clamp((Local.X - Rb.GetCenter().X) / (Rb.GetSize().X * 0.45), -1.0, 1.0);
	if (ASkyLineAircraftPawn* Ac = GetAircraft())
	{
		Ac->Touch.Yaw = RudderValue;
	}
}

double SSkyLineTouchControls::LookPinchDistance() const
{
	TArray<FVector2D> Points;
	for (const auto& Pair : Active)
	{
		if (Pair.Value.Control == EControl::Look) Points.Add(Pair.Value.Last);
	}
	return Points.Num() >= 2 ? FVector2D::Distance(Points[0], Points[1]) : 0.0;
}

FReply SSkyLineTouchControls::OnTouchStarted(const FGeometry& MyGeometry, const FPointerEvent& Event)
{
	const ASkyLinePlayerController* PC = Controller.Get();
	if (!GetAircraft() || !PC || PC->IsMenuVisible())
	{
		return FReply::Unhandled();
	}
	const FVector2D Local = MyGeometry.AbsoluteToLocal(Event.GetScreenSpacePosition());
	FActive A;
	A.Control = HitTest(Local, A.Button);
	A.Start = A.Last = Local;
	A.StartTime = FPlatformTime::Seconds();
	Active.Add(Event.GetPointerIndex(), A);
	switch (A.Control)
	{
		case EControl::Stick: UpdateStick(Local); break;
		case EControl::Throttle: UpdateThrottle(Local); break;
		case EControl::Rudder: UpdateRudder(Local); break;
		case EControl::Button:
		{
			FVector2D Sc; float Sr; FBox2D Tb, Rb; TArray<FButton> Buttons;
			Layout(LastSize, Sc, Sr, Tb, Rb, Buttons);
			if (Buttons[A.Button].Command == TEXT("BRAKE")) GetAircraft()->Touch.bBrake = true;
			break;
		}
		default: break;
	}
	return FReply::Handled().CaptureMouse(SharedThis(this));
}

FReply SSkyLineTouchControls::OnTouchMoved(const FGeometry& MyGeometry, const FPointerEvent& Event)
{
	FActive* A = Active.Find(Event.GetPointerIndex());
	if (!A)
	{
		return FReply::Unhandled();
	}
	const FVector2D Local = MyGeometry.AbsoluteToLocal(Event.GetScreenSpacePosition());
	switch (A->Control)
	{
		case EControl::Stick: UpdateStick(Local); break;
		case EControl::Throttle: UpdateThrottle(Local); break;
		case EControl::Rudder: UpdateRudder(Local); break;
		case EControl::Look:
		{
			const double Before = LookPinchDistance();
			const FVector2D Delta = Local - A->Last;
			A->Last = Local;
			const double After = LookPinchDistance();
			if (ASkyLineAircraftPawn* Ac = GetAircraft())
			{
				if (Before > 0 && After > 0) Ac->TouchZoom(After / Before);
				else Ac->TouchLook(Delta.X, Delta.Y);
			}
			return FReply::Handled();
		}
		default: break;
	}
	A->Last = Local;
	return FReply::Handled();
}

FReply SSkyLineTouchControls::OnTouchEnded(const FGeometry& MyGeometry, const FPointerEvent& Event)
{
	FActive A;
	if (!Active.RemoveAndCopyValue(Event.GetPointerIndex(), A))
	{
		return FReply::Unhandled();
	}
	ASkyLineAircraftPawn* Ac = GetAircraft();
	ASkyLinePlayerController* PC = Controller.Get();
	switch (A.Control)
	{
		case EControl::Stick:
			StickKnob = FVector2D::ZeroVector;
			if (Ac) { Ac->Touch.bStick = false; Ac->Touch.Pitch = Ac->Touch.Roll = 0; }
			break;
		case EControl::Throttle:
			if (Ac) Ac->Touch.Throttle = -1;
			break;
		case EControl::Rudder:
			RudderValue = 0;
			if (Ac) Ac->Touch.Yaw = 0;
			break;
		case EControl::Button:
		{
			FVector2D Sc; float Sr; FBox2D Tb, Rb; TArray<FButton> Buttons;
			Layout(LastSize, Sc, Sr, Tb, Rb, Buttons);
			const FString& Cmd = Buttons[A.Button].Command;
			if (Cmd == TEXT("BRAKE")) { if (Ac) Ac->Touch.bBrake = false; }
			else if (Cmd == TEXT("MENU")) { if (PC) PC->ShowMenu(true); }
			else if (Ac) Ac->Command(Cmd);
			break;
		}
		case EControl::Look:
		{
			// a short tap: let the HUD's MCP panel handle it
			const bool bTap = FVector2D::Distance(A.Start, A.Last) < 12 && FPlatformTime::Seconds() - A.StartTime < 0.4;
			if (bTap && PC)
			{
				if (ASkyLineHUD* Hud = Cast<ASkyLineHUD>(PC->GetHUD()))
				{
					Hud->TapAt(A.Start * MyGeometry.Scale);
				}
			}
			break;
		}
		default: break;
	}
	return FReply::Handled().ReleaseMouseCapture();
}

#undef LOCTEXT_NAMESPACE
