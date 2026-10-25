using UnrealBuildTool;

public class SkyLineTarget : TargetRules
{
	public SkyLineTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.AddRange(new string[] { "SkyLineSim", "SkyLine" });
	}
}
