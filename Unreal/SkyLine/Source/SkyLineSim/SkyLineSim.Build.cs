using UnrealBuildTool;

// Engine-independent flight-dynamics core (plain C++17). The same sources build headless in tests/sim.
public class SkyLineSim : ModuleRules
{
	public SkyLineSim(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.NoPCHs;
		bUseUnity = false;
		CppStandard = CppStandardVersion.Cpp17;
		bEnableExceptions = false;
		PublicDependencyModuleNames.Add("Core");
	}
}
