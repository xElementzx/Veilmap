--[[
Veilmap - Copyright (C) 2026 xElementzx
GPL-3.0-or-later. See LICENSE.

Settings panel, built on Blizzard's Settings API. No third-party config library.
]]

local ADDON, Veilmap = ...

local Options = {}
Veilmap.Options = Options

local category

-- Pushes a changed setting through to whatever renders it.
local function apply(key)
	if key == "fogEnabled" or key == "fogBattlefieldMap" or key == "fogColor" then
		Veilmap.RefreshFog()
	elseif key == "mapScale" then
		Veilmap.MapFrame.ApplyScale()
	elseif key == "mapAlpha" or key == "fadedAlpha" or key == "fadeWhenMoving" then
		Veilmap.MapFrame.ApplyAlpha()
	else
		Veilmap.Coords.Refresh()
	end
end

local function register(key, varType, name)
	return Settings.RegisterProxySetting(
		category, "Veilmap_" .. key, varType, name,
		Veilmap.Config.defaults[key],
		function() return Veilmap.db[key] end,
		function(value) Veilmap.db[key] = value; apply(key) end
	)
end

local function addCheckbox(key, name, tooltip)
	local setting = register(key, Settings.VarType.Boolean, name)
	Settings.CreateCheckbox(category, setting, tooltip)
	return setting
end

local function addSlider(key, name, tooltip, min, max, step, formatter)
	local setting = register(key, Settings.VarType.Number, name)
	local options = Settings.CreateSliderOptions(min, max, step)
	options:SetLabelFormatter(MinimalSliderWithSteppersMixin.Label.Right, formatter)
	Settings.CreateSlider(category, setting, options, tooltip)
	return setting
end

local function percent(value)
	return ("%d%%"):format(math.floor(value * 100 + 0.5))
end

local function whole(value)
	return tostring(math.floor(value + 0.5))
end

-- ColorPickerFrame's opacity slider runs inverted relative to alpha, hence
-- the `1 - a` on every read and write.
local function openColorPicker()
	local c = Veilmap.db.fogColor
	local previous = { r = c.r, g = c.g, b = c.b, a = c.a }

	local function onChange()
		local r, g, b = ColorPickerFrame:GetColorRGB()
		c.r, c.g, c.b = r, g, b
		c.a = 1 - ColorPickerFrame:GetColorAlpha()
		apply("fogColor")
	end

	ColorPickerFrame:SetupColorPickerAndShow({
		r = c.r, g = c.g, b = c.b, opacity = 1 - c.a,
		hasOpacity = true,
		swatchFunc = onChange,
		opacityFunc = onChange,
		cancelFunc = function()
			c.r, c.g, c.b, c.a = previous.r, previous.g, previous.b, previous.a
			apply("fogColor")
		end,
	})
end

function Options.Open()
	Settings.OpenToCategory(category:GetID())
end

function Options.Initialise()
	if category then return end

	local layout
	category, layout = Settings.RegisterVerticalLayoutCategory("Veilmap")

	layout:AddInitializer(CreateSettingsListSectionHeaderInitializer("Fog of War"))
	addCheckbox("fogEnabled", "Hide on World Map",
		"Show the parts of the World Map you have not explored yet, tinted, instead of hiding them under fog of war.")
	addCheckbox("fogBattlefieldMap", "Hide on Battlefield Map",
		"Show the parts of the Battlefield Map (Shift+M) you have not explored yet, tinted, instead of hiding them under fog of war.")
	-- Settings has no colour widget; a button opening the picker keeps the
	-- control inside the layout, and the map's tint is the live preview.
	layout:AddInitializer(CreateSettingsButtonInitializer("Fog colour", "Choose...",
		openColorPicker, "Colour and opacity of the tint over unexplored areas.", true))

	layout:AddInitializer(CreateSettingsListSectionHeaderInitializer("Map Frame"))
	addSlider("mapScale", "Map scale", "Size of the world map.", 0.5, 2.0, 0.05, percent)
	addSlider("mapAlpha", "Map opacity", "Opacity of the map while you are standing still.", 0.1, 1.0, 0.05, percent)
	addCheckbox("fadeWhenMoving", "Fade while moving",
		"Fade the map toward the faded opacity while your character is moving.")
	addSlider("fadedAlpha", "Faded opacity", "Opacity of the map while you are moving.", 0.05, 1.0, 0.05, percent)

	layout:AddInitializer(CreateSettingsListSectionHeaderInitializer("Coordinates"))
	addCheckbox("coordsEnabled", "Show coordinates", "Show player and cursor coordinates beneath the map.")
	addSlider("coordsPrecision", "Decimal places", "Number of decimal places shown.", 0, 2, 1, whole)
	addSlider("coordsFontSize", "Font size", "Size of the coordinate text.", 8, 20, 1, whole)

	Settings.RegisterAddOnCategory(category)
end
