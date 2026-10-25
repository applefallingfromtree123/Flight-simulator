#include "SkyLineHUD.h"

#include "CanvasItem.h"
#include "Engine/Canvas.h"
#include "Engine/Engine.h"
#include "Engine/Font.h"
#include "SkyLineAircraftPawn.h"
#include "SkyLinePlayerController.h"
#include "Atmosphere.h"
#include "Geo.h"

using namespace skyline;

namespace
{
const FLinearColor kWhite(0.95f, 0.95f, 0.95f);
const FLinearColor kGreen(0.15f, 0.95f, 0.35f);
const FLinearColor kCyan(0.2f, 0.85f, 1.f);
const FLinearColor kMagenta(1.f, 0.3f, 1.f);
const FLinearColor kAmber(1.f, 0.72f, 0.1f);
const FLinearColor kRed(1.f, 0.2f, 0.15f);
const FLinearColor kYellow(1.f, 0.92f, 0.1f);
const FLinearColor kBg(0.03f, 0.035f, 0.045f, 0.82f);
const FLinearColor kSky(0.12f, 0.42f, 0.86f, 0.95f);
const FLinearColor kEarth(0.47f, 0.29f, 0.12f, 0.95f);
const FLinearColor kGrey(0.45f, 0.48f, 0.52f);
const FLinearColor kTape(0.18f, 0.2f, 0.24f, 0.85f);
}  // namespace

// ------------------------------------------------------------------------------------------- primitives

void ASkyLineHUD::Rect(float X, float Y, float W, float H, const FLinearColor& C)
{
	FCanvasTileItem Tile(FVector2D(X, Y), FVector2D(W, H), C);
	Tile.BlendMode = SE_BLEND_Translucent;
	Canvas->DrawItem(Tile);
}

void ASkyLineHUD::Frame(float X, float Y, float W, float H, const FLinearColor& C, float T)
{
	Line(FVector2D(X, Y), FVector2D(X + W, Y), C, T);
	Line(FVector2D(X + W, Y), FVector2D(X + W, Y + H), C, T);
	Line(FVector2D(X + W, Y + H), FVector2D(X, Y + H), C, T);
	Line(FVector2D(X, Y + H), FVector2D(X, Y), C, T);
}

void ASkyLineHUD::Line(const FVector2D& A, const FVector2D& B, const FLinearColor& C, float T)
{
	FCanvasLineItem L(A, B);
	L.SetColor(C);
	L.LineThickness = T * Scale;
	Canvas->DrawItem(L);
}

void ASkyLineHUD::Tri(const FVector2D& A, const FVector2D& B, const FVector2D& C, const FLinearColor& Col)
{
	FCanvasTriangleItem T(A, B, C, GWhiteTexture);
	T.SetColor(Col);
	T.BlendMode = SE_BLEND_Translucent;
	Canvas->DrawItem(T);
}

void ASkyLineHUD::Poly(const TArray<FVector2D>& P, const FLinearColor& C)
{
	for (int32 I = 1; I + 1 < P.Num(); I++)
	{
		Tri(P[0], P[I], P[I + 1], C);
	}
}

void ASkyLineHUD::Text(const FString& S, float X, float Y, const FLinearColor& C, int32 Align, bool bLarge)
{
	UFont* F = bLarge ? MediumFont : SmallFont;
	float W = 0, H = 0;
	const float TextScale = Scale * (bLarge ? 0.85f : 1.f);
	Canvas->TextSize(F, S, W, H, TextScale, TextScale);
	const float X0 = Align == 1 ? X - W / 2 : Align == 2 ? X - W : X;
	FCanvasTextItem Item(FVector2D(X0, Y - H / 2), FText::FromString(S), F, C);
	Item.Scale = FVector2D(TextScale, TextScale);
	Item.EnableShadow(FLinearColor(0, 0, 0, 0.8f));
	Canvas->DrawItem(Item);
}

void ASkyLineHUD::Arc(const FVector2D& C, float R, float A0Deg, float A1Deg, const FLinearColor& Col, float T)
{
	const int32 N = FMath::Max(4, FMath::CeilToInt(FMath::Abs(A1Deg - A0Deg) / 4.f));
	FVector2D Prev;
	for (int32 I = 0; I <= N; I++)
	{
		const float A = FMath::DegreesToRadians(FMath::Lerp(A0Deg, A1Deg, static_cast<float>(I) / N));
		const FVector2D P = C + FVector2D(FMath::Sin(A), -FMath::Cos(A)) * R;  // 0 deg = up, clockwise
		if (I > 0)
		{
			Line(Prev, P, Col, T);
		}
		Prev = P;
	}
}

TArray<FVector2D> ASkyLineHUD::ClipHalfPlane(const TArray<FVector2D>& In, const FVector2D& P, const FVector2D& N)
{
	TArray<FVector2D> Out;
	for (int32 I = 0; I < In.Num(); I++)
	{
		const FVector2D& A = In[I];
		const FVector2D& B = In[(I + 1) % In.Num()];
		const double Da = FVector2D::DotProduct(A - P, N), Db = FVector2D::DotProduct(B - P, N);
		if (Da >= 0) Out.Add(A);
		if ((Da >= 0) != (Db >= 0)) Out.Add(A + (B - A) * (Da / (Da - Db)));
	}
	return Out;
}

// ------------------------------------------------------------------------------------------- main

void ASkyLineHUD::DrawHUD()
{
	Super::DrawHUD();
	Aircraft = Cast<ASkyLineAircraftPawn>(GetOwningPawn());
	const ASkyLinePlayerController* PC = Cast<ASkyLinePlayerController>(PlayerOwner);
	if (!Canvas || !Aircraft || !Aircraft->GetSim() || (PC && PC->IsMenuVisible()))
	{
		return;
	}
	SmallFont = GEngine->GetSmallFont();
	MediumFont = GEngine->GetMediumFont();
	Scale = FMath::Clamp(Canvas->ClipY / 1080.f, 0.6f, 2.5f);
	const float W = Canvas->ClipX, H = Canvas->ClipY;

	DrawMcp(W / 2, 8 * Scale);
	DrawInfo(12 * Scale, 70 * Scale);
	if (!bShowInstruments)
	{
		return;
	}
	const float S = 330 * Scale;
	const float Y = H - S - 12 * Scale;
	DrawPfd(12 * Scale, Y, S);
	DrawNd(24 * Scale + S, Y, S);
	DrawEngines(W - 300 * Scale - 12 * Scale, Y, 300 * Scale, S);
}

void ASkyLineHUD::DrawInfo(float X, float Y)
{
	const skyline::Aircraft& A = *Aircraft->GetSim();
	const FlightControl& F = *Aircraft->GetFcs();
	const FSkyLineAircraftEntry* E = Aircraft->GetEntry();
	const FSkyLineLivery* L = Aircraft->GetLivery();
	FString Line1 = E ? E->Name : FString();
	if (L) Line1 += FString::Printf(TEXT("  ·  %s  %s"), *L->Name, *L->Registration);
	Text(Line1, X, Y, kWhite);
	const V3& Wind = A.Wind;
	const double WindSpd = FMath::Sqrt(Wind.X * Wind.X + Wind.Y * Wind.Y) / KT;
	const double WindFrom = Wrap360(FMath::RadiansToDegrees(FMath::Atan2(-Wind.Y, -Wind.X)));
	FString Line2 = FString::Printf(TEXT("GS %.0f  TAS %.0f  WIND %03.0f/%.0f  OAT %.0fC"), A.Gs / KT, A.Tas / KT, WindFrom, WindSpd, A.Atm.T - 273.15);
	if (F.Plan.HasApproach)
	{
		Line2 += FString::Printf(TEXT("  %s %s  %.1f NM"), UTF8_TO_TCHAR(F.Plan.Appr.Airport.c_str()), UTF8_TO_TCHAR(F.Plan.Appr.Runway.c_str()), Distance(LatLon{A.Lat, A.Lon}, F.Plan.Appr.Thr) / NM);
	}
	Text(Line2, X, Y + 18 * Scale, kGrey);
	FString Line3;
	if (Aircraft->IsPaused()) Line3 += TEXT("PAUSED  ");
	if (Aircraft->GetTimeScale() > 1) Line3 += FString::Printf(TEXT("SIM RATE x%.0f  "), Aircraft->GetTimeScale());
	if (A.ParkingBrake) Line3 += TEXT("PARK BRK  ");
	if (A.TailStrike) Line3 += TEXT("TAIL STRIKE  ");
	if (!Line3.IsEmpty()) Text(Line3, X, Y + 36 * Scale, kAmber);
}

// ------------------------------------------------------------------------------------------- PFD

void ASkyLineHUD::DrawPfd(float X0, float Y0, float S)
{
	const skyline::Aircraft& A = *Aircraft->GetSim();
	const FlightControl& F = *Aircraft->GetFcs();
	Rect(X0, Y0, S, S, kBg);
	const FVector2D C(X0 + S * 0.5f, Y0 + S * 0.47f);
	const float Half = S * 0.26f;
	const float Ppd = Half / 18.f;  // pixels per degree of pitch
	const double PitchDeg = A.Theta * RAD, RollDeg = A.Phi * RAD;
	const double Phi = A.Phi;
	const FVector2D D(FMath::Cos(Phi), -FMath::Sin(Phi));    // along the horizon
	const FVector2D N(-FMath::Sin(Phi), -FMath::Cos(Phi));   // towards the sky
	const FVector2D Hz = C - N * (PitchDeg * Ppd);

	// attitude: sky/earth polygons clipped to the ADI square
	const TArray<FVector2D> Box = {C + FVector2D(-Half, -Half), C + FVector2D(Half, -Half), C + FVector2D(Half, Half), C + FVector2D(-Half, Half)};
	Poly(ClipHalfPlane(Box, Hz, N), kSky);
	Poly(ClipHalfPlane(Box, Hz, -N), kEarth);
	Line(Hz - D * Half * 1.5f, Hz + D * Half * 1.5f, kWhite, 2.f);  // (clipped visually by the tapes)
	// pitch ladder
	for (int32 Deg = -30; Deg <= 30; Deg += 5)
	{
		if (Deg == 0 || FMath::Abs(Deg - PitchDeg) > 16) continue;
		const FVector2D Mid = Hz + N * (Deg * Ppd);
		const float Len = (Deg % 10 == 0 ? 0.35f : 0.18f) * Half;
		Line(Mid - D * Len, Mid + D * Len, kWhite, 1.5f);
		if (Deg % 10 == 0)
		{
			Text(FString::FromInt(FMath::Abs(Deg)), (Mid - D * (Len + 12 * Scale)).X, (Mid - D * (Len + 12 * Scale)).Y, kWhite, 1);
		}
	}
	// bank scale
	Arc(C, Half * 0.95f, -60, 60, kWhite);
	for (int32 B : {-60, -45, -30, -20, -10, 10, 20, 30, 45, 60})
	{
		const float Ar = FMath::DegreesToRadians(static_cast<float>(B));
		const FVector2D U(FMath::Sin(Ar), -FMath::Cos(Ar));
		Line(C + U * Half * 0.95f, C + U * Half * (FMath::Abs(B) % 30 == 0 ? 1.06f : 1.01f), kWhite);
	}
	{
		const FVector2D U = -N;  // pointer rotates with the horizon
		const FVector2D Tip = C - U * Half * 0.93f;
		Tri(Tip, Tip + U * 12 * Scale + D * 7 * Scale, Tip + U * 12 * Scale - D * 7 * Scale, FMath::Abs(RollDeg) > 35 ? kAmber : kWhite);
	}
	// flight director
	if (F.Fd && !A.OnGround)
	{
		const float Fx = FMath::Clamp(static_cast<float>(F.FdRoll - RollDeg) * 1.5f, -Half * 0.6f, Half * 0.6f);
		const float Fy = FMath::Clamp(static_cast<float>(PitchDeg - F.FdPitch) * Ppd, -Half * 0.6f, Half * 0.6f);
		Line(C + FVector2D(Fx, -Half * 0.5f), C + FVector2D(Fx, Half * 0.5f), kMagenta, 2.f);
		Line(C + FVector2D(-Half * 0.5f, Fy), C + FVector2D(Half * 0.5f, Fy), kMagenta, 2.f);
	}
	// aircraft symbol
	Line(C + FVector2D(-Half * 0.62f, 0), C + FVector2D(-Half * 0.22f, 0), kYellow, 4.f);
	Line(C + FVector2D(Half * 0.22f, 0), C + FVector2D(Half * 0.62f, 0), kYellow, 4.f);
	Rect(C.X - 3 * Scale, C.Y - 3 * Scale, 6 * Scale, 6 * Scale, kYellow);

	// ILS deviation
	if (F.HasIls && F.Ils.Valid && (F.Lat == LatMode::Loc || F.LatArmed == LatMode::Loc || F.Lat == LatMode::Rollout))
	{
		const float Dot = Half * 0.3f;
		const FVector2D LocC(C.X + static_cast<float>(F.Ils.Loc) * Dot, C.Y + Half + 10 * Scale);
		Tri(LocC + FVector2D(-7 * Scale, 0), LocC + FVector2D(0, -6 * Scale), LocC + FVector2D(7 * Scale, 0), kMagenta);
		Tri(LocC + FVector2D(-7 * Scale, 0), LocC + FVector2D(0, 6 * Scale), LocC + FVector2D(7 * Scale, 0), kMagenta);
		if (F.Ils.GsValid)
		{
			const FVector2D GsC(C.X + Half + 10 * Scale, C.Y - static_cast<float>(F.Ils.Gs) * Dot);
			Tri(GsC + FVector2D(0, -7 * Scale), GsC + FVector2D(-6 * Scale, 0), GsC + FVector2D(0, 7 * Scale), kMagenta);
			Tri(GsC + FVector2D(0, -7 * Scale), GsC + FVector2D(6 * Scale, 0), GsC + FVector2D(0, 7 * Scale), kMagenta);
		}
	}

	// speed tape
	const float TapeW = S * 0.15f, TapeH = Half * 2;
	const float SpX = X0 + S * 0.04f, TapeY = C.Y - Half;
	Rect(SpX, TapeY, TapeW, TapeH, kTape);
	const double Ias = A.Ias / KT;
	const float PxPerKt = TapeH / 80.f;
	for (int32 V = FMath::FloorToInt(Ias / 10) * 10 - 40; V <= Ias + 40; V += 10)
	{
		if (V < 0) continue;
		const float Ty = C.Y - static_cast<float>(V - Ias) * PxPerKt;
		if (Ty < TapeY || Ty > TapeY + TapeH) continue;
		Line(FVector2D(SpX + TapeW - 10 * Scale, Ty), FVector2D(SpX + TapeW, Ty), kWhite);
		if (V % 20 == 0) Text(FString::FromInt(V), SpX + TapeW - 13 * Scale, Ty, kWhite, 2);
	}
	// VMO band and stall band
	const double Vmo = A.Def.V.Vmo;
	if (Vmo - Ias < 40)
	{
		const float Ty = FMath::Max(TapeY, C.Y - static_cast<float>(Vmo - Ias) * PxPerKt);
		Rect(SpX + TapeW - 4 * Scale, TapeY, 4 * Scale, Ty - TapeY, kRed);
	}
	const double Vs = A.Def.V.Vs1 * FMath::Sqrt(A.Mass() / A.Def.M.Mtow) * (1 - 0.25 * A.FlapPos / FMath::Max(1.0, A.Aero.Flaps.back().Deg));
	if (Ias - Vs < 40 && !A.OnGround)
	{
		const float Ty = FMath::Min(TapeY + TapeH, C.Y - static_cast<float>(Vs - Ias) * PxPerKt);
		Rect(SpX + TapeW - 4 * Scale, Ty, 4 * Scale, TapeY + TapeH - Ty, kRed);
	}
	// selected speed bug
	{
		const double Sel = F.SpdIsMach ? F.SelMach * A.Atm.A / KT * (A.Ias / FMath::Max(A.Tas, 1.0)) : F.SelSpd;
		const float Ty = FMath::Clamp(C.Y - static_cast<float>(Sel - Ias) * PxPerKt, TapeY, TapeY + TapeH);
		Tri(FVector2D(SpX + TapeW, Ty), FVector2D(SpX + TapeW + 8 * Scale, Ty - 6 * Scale), FVector2D(SpX + TapeW + 8 * Scale, Ty + 6 * Scale), kMagenta);
		Text(F.SpdIsMach ? FString::Printf(TEXT(".%03.0f"), F.SelMach * 1000) : FString::Printf(TEXT("%.0f"), F.SelSpd), SpX + TapeW / 2, TapeY - 12 * Scale, kMagenta, 1);
	}
	Rect(SpX - 2 * Scale, C.Y - 13 * Scale, TapeW + 2 * Scale, 26 * Scale, FLinearColor(0, 0, 0, 0.95f));
	Frame(SpX - 2 * Scale, C.Y - 13 * Scale, TapeW + 2 * Scale, 26 * Scale, kWhite);
	Text(FString::Printf(TEXT("%.0f"), Ias), SpX + TapeW - 6 * Scale, C.Y, A.Stall > 0.2 ? kRed : kWhite, 2, true);
	Text(FString::Printf(TEXT("M.%03.0f"), A.Mach * 1000), SpX + TapeW / 2, TapeY + TapeH + 12 * Scale, kWhite, 1);

	// altitude tape (indicated = MSL, QNH)
	const float AlX = X0 + S - S * 0.04f - TapeW - 10 * Scale;
	Rect(AlX, TapeY, TapeW, TapeH, kTape);
	const double AltFt = A.Alt / FT;
	const float PxPerFt = TapeH / 1000.f;
	for (int32 Ft = FMath::FloorToInt(AltFt / 100) * 100 - 500; Ft <= AltFt + 500; Ft += 100)
	{
		const float Ty = C.Y - static_cast<float>(Ft - AltFt) * PxPerFt;
		if (Ty < TapeY || Ty > TapeY + TapeH) continue;
		Line(FVector2D(AlX, Ty), FVector2D(AlX + 10 * Scale, Ty), kWhite);
		if (Ft % 200 == 0) Text(FString::FromInt(Ft), AlX + 14 * Scale, Ty, kWhite);
	}
	{
		const float Ty = FMath::Clamp(C.Y - static_cast<float>(F.SelAlt - AltFt) * PxPerFt, TapeY, TapeY + TapeH);
		Tri(FVector2D(AlX, Ty), FVector2D(AlX - 8 * Scale, Ty - 6 * Scale), FVector2D(AlX - 8 * Scale, Ty + 6 * Scale), kMagenta);
		Text(FString::Printf(TEXT("%.0f"), F.SelAlt), AlX + TapeW / 2, TapeY - 12 * Scale, kMagenta, 1);
	}
	// ground (radio altitude) on the tape
	const double RaFt = (A.Agl - A.Aero.CgHeight) / FT;
	if (RaFt < 500)
	{
		const float Ty = FMath::Min(TapeY + TapeH, C.Y + static_cast<float>(RaFt) * PxPerFt);
		Rect(AlX, Ty, TapeW, TapeY + TapeH - Ty, FLinearColor(0.6f, 0.35f, 0.1f, 0.8f));
	}
	Rect(AlX, C.Y - 13 * Scale, TapeW + 4 * Scale, 26 * Scale, FLinearColor(0, 0, 0, 0.95f));
	Frame(AlX, C.Y - 13 * Scale, TapeW + 4 * Scale, 26 * Scale, kWhite);
	Text(FString::Printf(TEXT("%.0f"), AltFt), AlX + 6 * Scale, C.Y, kWhite, 0, true);
	Text(F.SelAlt > AltFt + 2 || F.SelAlt < AltFt - 2 ? TEXT("QNH") : TEXT(""), AlX + TapeW / 2, TapeY + TapeH + 12 * Scale, kCyan, 1);
	// vertical speed
	{
		const float VsX = AlX + TapeW + 14 * Scale;
		const double VsFpm = A.Vs / FPM;
		const float Defl = FMath::Clamp(static_cast<float>(FMath::Sign(VsFpm) * FMath::Sqrt(FMath::Abs(VsFpm) / 6000.0)), -1.f, 1.f) * Half * 0.85f;
		Line(FVector2D(VsX, C.Y), FVector2D(VsX + 8 * Scale, C.Y - Defl), kGreen, 2.5f);
		if (FMath::Abs(VsFpm) > 300) Text(FString::Printf(TEXT("%.0f"), FMath::RoundToDouble(VsFpm / 50) * 50), VsX, C.Y - FMath::Sign(VsFpm) * (Half + 14 * Scale), kGreen, 1);
	}
	if (RaFt < 2500)
	{
		Text(FString::Printf(TEXT("%.0f"), FMath::Max(0.0, RaFt)), C.X, C.Y + Half * 0.72f, RaFt < 200 ? kAmber : kWhite, 1, true);
	}

	// heading tape
	const float HdY = C.Y + Half + 30 * Scale;
	Rect(C.X - Half, HdY - 12 * Scale, Half * 2, 34 * Scale, kTape);
	const double Hdg = F.HdgMag();
	const float PxPerDeg = Half * 2 / 60.f;
	for (int32 Hd = FMath::FloorToInt(Hdg / 5) * 5 - 30; Hd <= Hdg + 30; Hd += 5)
	{
		const float Tx = C.X + static_cast<float>(Hd - Hdg) * PxPerDeg;
		if (Tx < C.X - Half || Tx > C.X + Half) continue;
		Line(FVector2D(Tx, HdY - 12 * Scale), FVector2D(Tx, HdY - (Hd % 10 == 0 ? 2 : 6) * Scale), kWhite);
		if (Hd % 10 == 0) Text(FString::Printf(TEXT("%02d"), static_cast<int32>(Wrap360(Hd)) / 10 % 36 == 0 ? 36 : static_cast<int32>(Wrap360(Hd)) / 10), Tx, HdY + 10 * Scale, kWhite, 1);
	}
	{
		const float Tx = FMath::Clamp(C.X + static_cast<float>(Wrap180(F.SelHdg - Hdg)) * PxPerDeg, C.X - Half, C.X + Half);
		Tri(FVector2D(Tx, HdY - 12 * Scale), FVector2D(Tx - 6 * Scale, HdY - 20 * Scale), FVector2D(Tx + 6 * Scale, HdY - 20 * Scale), kMagenta);
	}
	Tri(FVector2D(C.X, HdY - 12 * Scale), FVector2D(C.X - 6 * Scale, HdY - 22 * Scale), FVector2D(C.X + 6 * Scale, HdY - 22 * Scale), kYellow);

	// FMA
	const float FmaY = Y0 + 14 * Scale;
	const FString Thr = F.Athr != AthrMode::Off ? FString(F.AthrDisplay.c_str()) : FString();
	const FString LatTxt = F.Lat != LatMode::Off ? FString(LatModeName(F.Lat)) : FString();
	const FString VertTxt = F.Vert != VertMode::Off ? FString(VertModeName(F.Vert)) : FString();
	Text(Thr, X0 + S * 0.17f, FmaY, kGreen, 1);
	Text(LatTxt, X0 + S * 0.42f, FmaY, kGreen, 1);
	Text(VertTxt, X0 + S * 0.66f, FmaY, kGreen, 1);
	Text(F.Ap ? TEXT("AP") : (F.Fd ? TEXT("FD") : TEXT("")), X0 + S * 0.9f, FmaY, F.Ap ? kGreen : kWhite, 1);
	if (F.LatArmed != LatMode::Off) Text(FString(LatModeName(F.LatArmed)), X0 + S * 0.42f, FmaY + 16 * Scale, kCyan, 1);
	if (F.VertArmed != VertMode::Off) Text(FString(VertModeName(F.VertArmed)), X0 + S * 0.66f, FmaY + 16 * Scale, kCyan, 1);
	for (int32 I = 1; I < 4; I++) Line(FVector2D(X0 + S * (0.3f + 0.24f * (I - 1)), Y0 + 4 * Scale), FVector2D(X0 + S * (0.3f + 0.24f * (I - 1)), Y0 + 36 * Scale), kGrey, 1.f);

	// warnings
	if (A.Stall > 0.3 && !A.OnGround) Text(TEXT("STALL"), C.X, C.Y - Half * 0.55f, kRed, 1, true);
	if (Ias > Vmo + 2) Text(TEXT("OVERSPEED"), C.X, C.Y - Half * 0.55f, kRed, 1, true);
	if (F.AlphaFloor) Text(TEXT("A.FLOOR"), C.X, C.Y + Half * 0.45f, kAmber, 1, true);
	if (F.ApDisconnectWarn > 0 && FMath::Fmod(F.ApDisconnectWarn, 0.6) > 0.3) Text(TEXT("AP DISCONNECT"), C.X, C.Y - Half * 0.3f, kRed, 1, true);
}

// ------------------------------------------------------------------------------------------- ND

void ASkyLineHUD::DrawNd(float X0, float Y0, float S)
{
	const skyline::Aircraft& A = *Aircraft->GetSim();
	const FlightControl& F = *Aircraft->GetFcs();
	Rect(X0, Y0, S, S, kBg);
	const FVector2D C(X0 + S / 2, Y0 + S * 0.78f);
	const float R = S * 0.62f;
	const double Hdg = F.HdgMag();
	const double RangeNm = A.Agl / FT < 3000 && F.Plan.HasApproach && Distance(LatLon{A.Lat, A.Lon}, F.Plan.Appr.Thr) < 30 * NM ? 10 : 40;
	// compass arc, heading up
	Arc(C, R, -50, 50, kWhite);
	for (int32 Deg = 0; Deg < 360; Deg += 5)
	{
		const double Rel = Wrap180(Deg - Hdg);
		if (FMath::Abs(Rel) > 50) continue;
		const float Ar = FMath::DegreesToRadians(static_cast<float>(Rel));
		const FVector2D U(FMath::Sin(Ar), -FMath::Cos(Ar));
		Line(C + U * R, C + U * (R - (Deg % 10 == 0 ? 12 : 6) * Scale), kWhite);
		if (Deg % 30 == 0) Text(FString::FromInt(Deg / 10), (C + U * (R - 24 * Scale)).X, (C + U * (R - 24 * Scale)).Y, kWhite, 1);
	}
	Arc(C, R * 0.5f, -50, 50, kGrey, 1.f);
	Text(FString::Printf(TEXT("%.0f"), RangeNm / 2), C.X - R * 0.5f * 0.77f - 6 * Scale, C.Y - R * 0.5f * 0.64f, kGrey, 2);
	// heading box + selected heading bug + track line
	Rect(C.X - 26 * Scale, Y0 + 6 * Scale, 52 * Scale, 22 * Scale, FLinearColor(0, 0, 0, 0.9f));
	Text(FString::Printf(TEXT("%03.0f"), Hdg), C.X, Y0 + 17 * Scale, kWhite, 1, true);
	{
		const float Ar = FMath::DegreesToRadians(static_cast<float>(FMath::Clamp(Wrap180(F.SelHdg - Hdg), -50.0, 50.0)));
		const FVector2D U(FMath::Sin(Ar), -FMath::Cos(Ar));
		Tri(C + U * R, C + U * (R + 10 * Scale) + FVector2D(U.Y, -U.X) * 6 * Scale, C + U * (R + 10 * Scale) - FVector2D(U.Y, -U.X) * 6 * Scale, kMagenta);
		const float At = FMath::DegreesToRadians(static_cast<float>(Wrap180(A.Track - F.MagVarDeg - Hdg)));
		Line(C, C + FVector2D(FMath::Sin(At), -FMath::Cos(At)) * R, kGreen, 1.f);
	}
	// route & destination runway
	const double PxPerM = R / (RangeNm * NM);
	auto ToScreen = [&](double Lat, double Lon) {
		const double Brg = Bearing(LatLon{A.Lat, A.Lon}, LatLon{Lat, Lon}) - F.MagVarDeg - Hdg;
		const double Dist = Distance(LatLon{A.Lat, A.Lon}, LatLon{Lat, Lon});
		const double Ar = FMath::DegreesToRadians(Brg);
		return C + FVector2D(FMath::Sin(Ar), -FMath::Cos(Ar)) * static_cast<float>(Dist * PxPerM);
	};
	auto Inside = [&](const FVector2D& P) { return P.X > X0 && P.X < X0 + S && P.Y > Y0 + 30 * Scale && P.Y < Y0 + S; };
	const std::vector<Waypoint>& Wps = F.Plan.Wps;
	for (int32 I = FMath::Max(1, F.Plan.Active); I < static_cast<int32>(Wps.size()); I++)
	{
		const FVector2D P0 = I == F.Plan.Active ? C : ToScreen(Wps[I - 1].Lat, Wps[I - 1].Lon);
		const FVector2D P1 = ToScreen(Wps[I].Lat, Wps[I].Lon);
		if (Inside(P0) || Inside(P1)) Line(P0, P1, I == F.Plan.Active ? kMagenta : kWhite, 2.f);
		if (Inside(P1)) Text(UTF8_TO_TCHAR(Wps[I].Ident.c_str()), P1.X + 8 * Scale, P1.Y, I == F.Plan.Active ? kMagenta : kWhite);
	}
	if (F.Plan.HasApproach)
	{
		const ApproachDef& Ap = F.Plan.Appr;
		const LatLon End = Destination(Ap.Thr, Ap.Crs, Ap.LengthM);
		const FVector2D P0 = ToScreen(Ap.Thr.Lat, Ap.Thr.Lon), P1 = ToScreen(End.Lat, End.Lon);
		if (Inside(P0)) { Line(P0, P1, kWhite, 3.f); }
		const LatLon Far = Destination(Ap.Thr, Wrap360(Ap.Crs + 180), 12 * NM);
		const FVector2D P2 = ToScreen(Far.Lat, Far.Lon);
		if (Inside(P0) || Inside(P2)) Line(P0, P2, kCyan, 1.f);
	}
	// own ship
	Tri(C + FVector2D(0, -12 * Scale), C + FVector2D(-8 * Scale, 10 * Scale), C + FVector2D(8 * Scale, 10 * Scale), kYellow);
	// data block
	Text(FString::Printf(TEXT("GS %.0f TAS %.0f"), A.Gs / KT, A.Tas / KT), X0 + 8 * Scale, Y0 + 14 * Scale, kWhite);
	const Waypoint* To = F.Plan.To();
	if (To)
	{
		Text(FString::Printf(TEXT("%s  %.1f NM"), UTF8_TO_TCHAR(To->Ident.c_str()), Distance(LatLon{A.Lat, A.Lon}, LatLon{To->Lat, To->Lon}) / NM), X0 + S - 8 * Scale, Y0 + 14 * Scale, kMagenta, 2);
	}
	Text(FString::Printf(TEXT("%.0f NM"), RangeNm), X0 + S - 8 * Scale, Y0 + S - 12 * Scale, kGrey, 2);
}

// ------------------------------------------------------------------------------------------- engines / config

void ASkyLineHUD::DrawEngines(float X0, float Y0, float W, float H)
{
	const skyline::Aircraft& A = *Aircraft->GetSim();
	Rect(X0, Y0, W, H, kBg);
	const int32 N = static_cast<int32>(A.Engines.size());
	const bool bTurbine = A.Def.Eng.T == EngineType::Fan || A.Def.Eng.T == EngineType::Jet;
	const bool bPiston = A.Def.Eng.T == EngineType::Prop;
	const float Gw = W / FMath::Max(2, N);
	const float R = FMath::Min(Gw * 0.36f, 46 * Scale);
	for (int32 I = 0; I < N; I++)
	{
		const Engine& E = A.Engines[I];
		const FVector2D C(X0 + Gw * (I + 0.5f), Y0 + 20 * Scale + R);
		const double Pct = bPiston ? E.Rpm / 2700.0 * 100 : E.N1;
		const float Frac = FMath::Clamp(static_cast<float>(Pct / 110.0), 0.f, 1.f);
		Arc(C, R, -90, 120, kGrey, 1.f);
		Arc(C, R, -90, -90 + 210 * Frac, E.Running ? kGreen : kAmber, 3.f);
		const float Ar = FMath::DegreesToRadians(-90 + 210 * Frac);
		Line(C, C + FVector2D(FMath::Sin(Ar), -FMath::Cos(Ar)) * R, kWhite, 2.f);
		Text(bPiston ? FString::Printf(TEXT("%.0f"), E.Rpm) : FString::Printf(TEXT("%.1f"), Pct), C.X, C.Y + R * 0.45f, kWhite, 1, true);
		Text(bPiston ? TEXT("RPM") : (bTurbine ? TEXT("N1") : TEXT("NG")), C.X, C.Y + R * 0.9f, kCyan, 1);
		Text(FString::Printf(TEXT("%s %.0f"), bPiston ? TEXT("EGT") : TEXT("EGT"), E.Egt), C.X, C.Y + R + 14 * Scale, kWhite, 1);
		Text(FString::Printf(TEXT("FF %.0f"), E.FuelFlow), C.X, C.Y + R + 30 * Scale, kWhite, 1);
		if (E.Rev > 0.05) Text(TEXT("REV"), C.X, C.Y - R - 8 * Scale, E.Rev > 0.9 ? kGreen : kAmber, 1);
	}
	// configuration block
	float Y = Y0 + 20 * Scale + 2 * R + 56 * Scale;
	const float Lx = X0 + 12 * Scale;
	Text(FString::Printf(TEXT("THR %3.0f%%"), A.EngineCmds.empty() ? 0.0 : A.EngineCmds[0].Throttle * 100), Lx, Y, kCyan);
	Text(FString::Printf(TEXT("FLAPS %s"), UTF8_TO_TCHAR(A.FlapLabel())), X0 + W / 2, Y, FMath::Abs(A.FlapPos - A.FlapsDeg()) > 0.1 ? kAmber : kGreen);
	Y += 20 * Scale;
	// gear
	if (A.Def.Gear.Retract)
	{
		const FLinearColor Gc = A.GearPos > 0.99 ? kGreen : A.GearPos < 0.01 ? kGrey : kRed;
		Text(A.GearPos > 0.99 ? TEXT("GEAR DOWN") : A.GearPos < 0.01 ? TEXT("GEAR UP") : TEXT("GEAR TRANSIT"), Lx, Y, Gc);
	}
	else
	{
		Text(TEXT("GEAR FIXED"), Lx, Y, kGrey);
	}
	Text(FString::Printf(TEXT("SPDBRK %.0f%%%s"), FMath::Min(A.SpoilerPos, 1.0) * 100, A.SpoilerArm ? TEXT(" ARM") : TEXT("")), X0 + W / 2, Y, A.SpoilerPos > 0.05 ? kAmber : kWhite);
	Y += 20 * Scale;
	Text(FString::Printf(TEXT("TRIM %+.2f"), A.Trim), Lx, Y, kWhite);
	Text(FString::Printf(TEXT("FUEL %.0f KG"), A.Fuel), X0 + W / 2, Y, A.Fuel < A.Def.M.Fuel * 0.08 ? kAmber : kWhite);
	Y += 20 * Scale;
	static const TCHAR* AbNames[] = {TEXT("OFF"), TEXT("LO"), TEXT("MED"), TEXT("MAX")};
	Text(FString::Printf(TEXT("A/BRK %s"), AbNames[FMath::Clamp(A.Autobrake, 0, 3)]), Lx, Y, kWhite);
	Text(FString::Printf(TEXT("G %.2f"), A.Nz), X0 + W / 2, Y, FMath::Abs(A.Nz) > 2.5 ? kAmber : kWhite);
	Y += 20 * Scale;
	if (A.ParkingBrake) Text(TEXT("PARKING BRAKE"), Lx, Y, kAmber);
	if (A.BrakeL > 0.1) Text(TEXT("BRAKES"), X0 + W / 2, Y, kAmber);
	if (A.IsRotor())
	{
		Text(FString::Printf(TEXT("NR %.0f%%  TQ %.0f%%  COLL %.0f%%"), A.RotorRpm * 100, A.TorquePct, A.Collective * 100), Lx, Y + 20 * Scale, kGreen);
	}
}

// ------------------------------------------------------------------------------------------- MCP / FCU strip

void ASkyLineHUD::DrawMcp(float CenterX, float Y)
{
	const FlightControl& F = *Aircraft->GetFcs();
	const skyline::Aircraft& A = *Aircraft->GetSim();
	struct FItemDef { FString Id; FString Label; FString Value; bool bActive; bool bField; };
	TArray<FItemDef> Items = {
		{TEXT("ATHR"), TEXT("A/THR"), TEXT(""), F.Athr != AthrMode::Off, false},
		{TEXT("SPD"), F.SpdIsMach ? TEXT("MACH") : TEXT("SPD"), F.SpdIsMach ? FString::Printf(TEXT(".%03.0f"), F.SelMach * 1000) : FString::Printf(TEXT("%.0f"), F.SelSpd), false, true},
		{TEXT("HDG"), TEXT("HDG"), FString::Printf(TEXT("%03.0f"), F.SelHdg), F.Lat == LatMode::Hdg, true},
		{TEXT("NAV"), TEXT("LNAV"), TEXT(""), F.Lat == LatMode::Nav, false},
		{TEXT("APP"), TEXT("APP"), TEXT(""), F.LatArmed == LatMode::Loc || F.Lat == LatMode::Loc || F.Vert == VertMode::Gs, false},
		{TEXT("ALT"), TEXT("ALT"), FString::Printf(TEXT("%.0f"), F.SelAlt), F.Vert == VertMode::Alt || F.Vert == VertMode::AltStar, true},
		{TEXT("FLC"), TEXT("FLC"), TEXT(""), F.Vert == VertMode::Flc, false},
		{TEXT("VS"), TEXT("V/S"), FString::Printf(TEXT("%+.0f"), F.SelVs), F.Vert == VertMode::Vs, true},
		{TEXT("AP"), TEXT("AP"), TEXT(""), F.Ap, false},
	};
	const float BtnW = 58 * Scale, FieldW = 92 * Scale, H = 46 * Scale, Gap = 6 * Scale;
	float Total = 0;
	for (const FItemDef& It : Items) Total += (It.bField ? FieldW : BtnW) + Gap;
	float X = CenterX - Total / 2;
	Rect(X - 8 * Scale, Y - 4 * Scale, Total + 12 * Scale, H + 8 * Scale, FLinearColor(0.08f, 0.09f, 0.1f, 0.85f));
	for (const FItemDef& It : Items)
	{
		const float Wd = It.bField ? FieldW : BtnW;
		const bool bHover = HoveredField == It.Id;
		Rect(X, Y, Wd, H, bHover ? FLinearColor(0.2f, 0.24f, 0.3f, 0.95f) : FLinearColor(0.13f, 0.14f, 0.16f, 0.95f));
		Text(It.Label, X + Wd / 2, Y + 11 * Scale, kWhite, 1);
		if (It.bField)
		{
			Text(It.Value, X + Wd / 2, Y + 31 * Scale, kAmber, 1, true);
			AddHitBox(FVector2D(X, Y), FVector2D(Wd, H), FName(*It.Id), true, 0);
			AddHitBox(FVector2D(X, Y + H * 0.5f), FVector2D(Wd * 0.3f, H * 0.5f), FName(*(It.Id + TEXT("-"))), true, 1);
			AddHitBox(FVector2D(X + Wd * 0.7f, Y + H * 0.5f), FVector2D(Wd * 0.3f, H * 0.5f), FName(*(It.Id + TEXT("+"))), true, 1);
			Text(TEXT("-"), X + 8 * Scale, Y + 31 * Scale, kGrey, 1);
			Text(TEXT("+"), X + Wd - 8 * Scale, Y + 31 * Scale, kGrey, 1);
			if (It.bActive) Rect(X + 4 * Scale, Y + H - 4 * Scale, Wd - 8 * Scale, 3 * Scale, kGreen);
		}
		else
		{
			Rect(X + Wd / 2 - 12 * Scale, Y + 28 * Scale, 24 * Scale, 6 * Scale, It.bActive ? kGreen : FLinearColor(0.25f, 0.27f, 0.3f));
			AddHitBox(FVector2D(X, Y), FVector2D(Wd, H), FName(*It.Id), true, 0);
		}
		X += Wd + Gap;
	}
	(void)A;
}

void ASkyLineHUD::NotifyHitBoxClick(FName BoxName)
{
	Super::NotifyHitBoxClick(BoxName);
	ASkyLineAircraftPawn* Ac = Cast<ASkyLineAircraftPawn>(GetOwningPawn());
	if (!Ac)
	{
		return;
	}
	const FString Box = BoxName.ToString();
	if (Box.EndsWith(TEXT("+")) || Box.EndsWith(TEXT("-")))
	{
		const FString Field = Box.LeftChop(1);
		const double Step = Field == TEXT("HDG") ? 1 : Field == TEXT("ALT") ? 10 : 1;
		Ac->McpAdjust(Field, Box.EndsWith(TEXT("+")) ? Step * 5 : -Step * 5);
	}
	else if (Box == TEXT("AP")) Ac->McpToggleAp();
	else if (Box == TEXT("ATHR")) Ac->McpToggleAthr();
	else Ac->McpMode(Box);
}

void ASkyLineHUD::NotifyHitBoxBeginCursorOver(FName BoxName)
{
	const FString Box = BoxName.ToString();
	if (Box == TEXT("SPD") || Box == TEXT("HDG") || Box == TEXT("ALT") || Box == TEXT("VS"))
	{
		HoveredField = Box;
	}
}

void ASkyLineHUD::NotifyHitBoxEndCursorOver(FName BoxName)
{
	if (HoveredField == BoxName.ToString())
	{
		HoveredField.Reset();
	}
}
