--[[
Veilmap - Copyright (C) 2026 xElementzx
GPL-3.0-or-later. See LICENSE.

Flavor detection.

WoW Forever reports WOW_PROJECT_ID == WOW_PROJECT_MAINLINE (both 1), so the
conventional project-ID check cannot distinguish it from Retail. The build's
interface version is the only reliable discriminator:
  Forever 1.60.x -> 16001   Retail 12.x -> 120001
]]

local ADDON, Veilmap = ...
Veilmap = Veilmap or {}

local Compat = {}
Veilmap.Compat = Compat

local FOREVER_MIN, FOREVER_MAX = 16000, 17000
local RETAIL_MIN = 100000

function Compat.DetectFlavor(tocversion)
	if type(tocversion) ~= "number" then return "unknown" end
	if tocversion >= FOREVER_MIN and tocversion < FOREVER_MAX then return "forever" end
	if tocversion >= RETAIL_MIN then return "retail" end
	return "unknown"
end

if GetBuildInfo then
	Compat.flavor = Compat.DetectFlavor(select(4, GetBuildInfo()))
else
	Compat.flavor = "unknown"
end
Compat.isForever = (Compat.flavor == "forever")

return Compat
