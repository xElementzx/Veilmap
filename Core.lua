--[[
Veilmap - a World Map addon for WoW Forever.
Copyright (C) 2026 xElementzx

This program is free software: you can redistribute it and/or modify it
under the terms of the GNU General Public License as published by the
Free Software Foundation, either version 3 of the License, or (at your
option) any later version. See the LICENSE file for details.
]]

local ADDON, Veilmap = ...

Veilmap.version = C_AddOns.GetAddOnMetadata(ADDON, "Version") or "dev"

-- Expose the addon table under its own name so it can be inspected and
-- driven from a macro or the chat box (e.g. `/run Veilmap.MapFrame.ApplyScale()`).
-- This global is for external/manual use only: nothing inside the addon should
-- ever read it back — every file keeps using the `...` vararg, not `_G.Veilmap`.
_G[ADDON] = Veilmap

local handlers = {}
Veilmap.commands = handlers

function handlers.version()
	print(("|cff33ff99Veilmap|r %s"):format(Veilmap.version))
	print(("  flavor: %s"):format(Veilmap.Compat.flavor))
end

function handlers.config()
	Veilmap.Options.Open()
end
handlers[""] = handlers.config

function handlers.verify()
	if not Veilmap.FogProvider then
		print("|cff33ff99Veilmap|r: fog provider not loaded")
		return
	end
	local r = Veilmap.FogProvider:Report()
	print("|cff33ff99Veilmap|r verify")
	print(("  map %s  art %s"):format(tostring(r.mapID), tostring(r.artID)))
	print(("  dataset: %d overlays (%d explored, %d unexplored)"):format(r.total, r.explored, r.unexplored))
	print(("  client reports %d explored textures"):format(r.liveCount))
	if r.liveCount ~= r.explored then
		print(("  |cffff5555coverage gap: client reports %d explored, our dataset covers %d — incomplete extraction|r"):format(r.liveCount, r.explored))
	end
	if r.missingTiles > 0 then
		print(("  |cffff5555%d entries have no tiles|r"):format(r.missingTiles))
	end
	if r.total == 0 then
		print("  |cffff5555no dataset for this map art|r")
	end
end

SLASH_VEILMAP1 = "/veilmap"
SLASH_VEILMAP2 = "/vm"
SlashCmdList["VEILMAP"] = function(msg)
	local cmd = msg:match("^(%S*)"):lower()
	local handler = handlers[cmd] or handlers.version
	handler(msg:match("^%S*%s*(.-)%s*$") or "")
end

local loader = CreateFrame("Frame")
loader:RegisterEvent("ADDON_LOADED")
loader:SetScript("OnEvent", function(self, _, name)
	if name ~= ADDON then return end
	self:UnregisterEvent("ADDON_LOADED")

	VeilmapDB = Veilmap.Config.Merge(VeilmapDB, Veilmap.Config.defaults)
	Veilmap.db = VeilmapDB

	if Veilmap.OnReady then Veilmap.OnReady() end
end)
