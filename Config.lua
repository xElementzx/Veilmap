--[[
Veilmap - Copyright (C) 2026 xElementzx
GPL-3.0-or-later. See LICENSE.

Defaults and SavedVariables merging.
]]

local ADDON, Veilmap = ...
Veilmap = Veilmap or {}

local Config = {}
Veilmap.Config = Config

Config.defaults = {
	-- Fog
	fogEnabled = true,
	fogColor = { r = 0.1, g = 0.2, b = 0.35, a = 0.85 },
	fogBattlefieldMap = true,

	-- Map frame
	mapScale = 1.0,
	mapAlpha = 1.0,
	fadedAlpha = 0.5,
	fadeWhenMoving = true,

	-- Coordinates
	coordsEnabled = true,
	coordsPrecision = 1,
	coordsFontSize = 11,

	-- Saved map position
	position = { point = "CENTER", relativePoint = "CENTER", x = 0, y = 0 },
}

-- Recursive fill: saved values win, missing keys come from defaults.
-- Neither argument is mutated.
function Config.Merge(saved, defaults)
	local out = {}
	for key, default in pairs(defaults) do
		local value = saved and saved[key]
		if type(default) == "table" then
			out[key] = Config.Merge(type(value) == "table" and value or nil, default)
		elseif value ~= nil and type(value) == type(default) then
			out[key] = value
		else
			out[key] = default
		end
	end
	return out
end

return Config
