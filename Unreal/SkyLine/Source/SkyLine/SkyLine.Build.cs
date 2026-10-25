using UnrealBuildTool;

public class SkyLine : ModuleRules
{
	public SkyLine(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		CppStandard = CppStandardVersion.Cpp17;
		PublicDependencyModuleNames.AddRange(new string[] {
			"Core", "CoreUObject", "Engine", "InputCore", "EnhancedInput", "SkyLineSim",
			"CesiumRuntime",
		});
		PrivateDependencyModuleNames.AddRange(new string[] {
			"Json", "JsonUtilities", "ImageWrapper", "RenderCore", "RHI",
			"MeshDescription", "StaticMeshDescription", "Slate", "SlateCore", "DeveloperSettings",
		});
	}
}
