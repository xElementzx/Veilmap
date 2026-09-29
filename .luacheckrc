std = "lua51"
max_line_length = false
exclude_files = { "tools/node_modules", "Fog/Data_Forever.lua" }

-- Globals Veilmap defines or mutates. SlashCmdList is here, not in
-- read_globals, because Core.lua assigns a field on it.
globals = {
	"VeilmapDB", "VeilmapFogData", "VeilmapFogPinMixin",
	"SLASH_VEILMAP1", "SLASH_VEILMAP2", "SlashCmdList",
}

read_globals = {
	"BattlefieldMapFrame", "C_AddOns", "C_Map", "C_MapExplorationInfo", "C_Timer",
	"ColorPickerFrame", "CreateFrame", "CreateFromMixins", "CreateTexturePool",
	"CreateSettingsButtonInitializer", "CreateSettingsListSectionHeaderInitializer",
	"DeltaLerp", "GameFontNormal", "GetBuildInfo", "GetCursorPosition",
	"InCombatLockdown", "IsPlayerMoving",
	"MapCanvasDataProviderMixin", "MapCanvasPinMixin",
	"MinimalSliderWithSteppersMixin", "PLAYER", "PlayerMovementFrameFader",
	"Settings", "UIParent", "WorldMapFrame",
	"strsplit",
}
