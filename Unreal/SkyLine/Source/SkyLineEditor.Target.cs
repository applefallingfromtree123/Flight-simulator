using UnrealBuildTool;

public class SkyLineEditorTarget : TargetRules
{
	public SkyLineEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.AddRange(new string[] { "SkyLineSim", "SkyLine" });
	}
}
