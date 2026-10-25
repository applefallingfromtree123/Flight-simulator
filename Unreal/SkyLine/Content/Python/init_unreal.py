"""Runs automatically when the Unreal Editor opens the project (Python Editor Script Plugin).

Creates the base materials used by the runtime aircraft loader (Source/SkyLine/Private/AircraftModelLoader.cpp),
so the repository does not need to carry binary .uasset files. Safe to run repeatedly: existing assets are kept.
Parameters: BaseColorTexture, EmissiveTexture (textures), BaseColorFactor, Emissive (vectors), Roughness, Metallic,
Opacity, EmissiveStrength (scalars).
"""
import unreal

MAT_DIR = "/Game/SkyLine/Materials"
WHITE = "/Engine/EngineResources/WhiteSquareTexture"
BLACK = "/Engine/EngineResources/Black"


def _scalar(mat, mel, name, default, x, y):
    node = mel.create_material_expression(mat, unreal.MaterialExpressionScalarParameter, x, y)
    node.set_editor_property("parameter_name", name)
    node.set_editor_property("default_value", default)
    return node


def _vector(mat, mel, name, default, x, y):
    node = mel.create_material_expression(mat, unreal.MaterialExpressionVectorParameter, x, y)
    node.set_editor_property("parameter_name", name)
    node.set_editor_property("default_value", default)
    return node


def _make(name, blend, two_sided):
    path = f"{MAT_DIR}/{name}"
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        return
    unreal.log(f"SkyLine: creating {path}")
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    mat = tools.create_asset(name, MAT_DIR, unreal.Material, unreal.MaterialFactoryNew())
    mat.set_editor_property("blend_mode", blend)
    mat.set_editor_property("two_sided", two_sided)
    mel = unreal.MaterialEditingLibrary

    tex = mel.create_material_expression(mat, unreal.MaterialExpressionTextureSampleParameter2D, -900, -200)
    tex.set_editor_property("parameter_name", "BaseColorTexture")
    tex.set_editor_property("texture", unreal.load_asset(WHITE))
    tint = _vector(mat, mel, "BaseColorFactor", unreal.LinearColor(1, 1, 1, 1), -900, 100)
    mul = mel.create_material_expression(mat, unreal.MaterialExpressionMultiply, -500, -100)
    mel.connect_material_expressions(tex, "RGB", mul, "A")
    mel.connect_material_expressions(tint, "", mul, "B")
    mel.connect_material_property(mul, "", unreal.MaterialProperty.MP_BASE_COLOR)

    mel.connect_material_property(_scalar(mat, mel, "Roughness", 0.6, -500, 150), "", unreal.MaterialProperty.MP_ROUGHNESS)
    mel.connect_material_property(_scalar(mat, mel, "Metallic", 0.0, -500, 250), "", unreal.MaterialProperty.MP_METALLIC)
    # emissive = Emissive colour + EmissiveTexture * EmissiveStrength (cockpit displays use a live render target)
    etex = mel.create_material_expression(mat, unreal.MaterialExpressionTextureSampleParameter2D, -1300, 600)
    etex.set_editor_property("parameter_name", "EmissiveTexture")
    etex.set_editor_property("texture", unreal.load_asset(BLACK))
    estr = _scalar(mat, mel, "EmissiveStrength", 0.0, -1300, 850)
    emul = mel.create_material_expression(mat, unreal.MaterialExpressionMultiply, -900, 650)
    mel.connect_material_expressions(etex, "RGB", emul, "A")
    mel.connect_material_expressions(estr, "", emul, "B")
    eadd = mel.create_material_expression(mat, unreal.MaterialExpressionAdd, -500, 350)
    mel.connect_material_expressions(_vector(mat, mel, "Emissive", unreal.LinearColor(0, 0, 0, 1), -900, 350), "", eadd, "A")
    mel.connect_material_expressions(emul, "", eadd, "B")
    mel.connect_material_property(eadd, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)

    if blend == unreal.BlendMode.BLEND_MASKED:
        mel.connect_material_property(tex, "A", unreal.MaterialProperty.MP_OPACITY_MASK)
    elif blend == unreal.BlendMode.BLEND_TRANSLUCENT:
        opacity = _scalar(mat, mel, "Opacity", 0.3, -900, 450)
        omul = mel.create_material_expression(mat, unreal.MaterialExpressionMultiply, -500, 450)
        mel.connect_material_expressions(tex, "A", omul, "A")
        mel.connect_material_expressions(opacity, "", omul, "B")
        mel.connect_material_property(omul, "", unreal.MaterialProperty.MP_OPACITY)
        mat.set_editor_property("translucency_lighting_mode", unreal.TranslucencyLightingMode.TLM_SURFACE)

    mel.recompile_material(mat)
    unreal.EditorAssetLibrary.save_asset(path, only_if_is_dirty=False)


def main():
    try:
        _make("M_AircraftOpaque", unreal.BlendMode.BLEND_OPAQUE, False)
        _make("M_AircraftOpaqueTwoSided", unreal.BlendMode.BLEND_OPAQUE, True)
        _make("M_AircraftMasked", unreal.BlendMode.BLEND_MASKED, True)
        _make("M_AircraftGlass", unreal.BlendMode.BLEND_TRANSLUCENT, True)
    except Exception as exc:  # never block the editor from opening
        unreal.log_error(f"SkyLine material setup failed: {exc}")


main()
