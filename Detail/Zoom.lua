--[[
Veilmap - Copyright (C) 2026 xElementzx
GPL-3.0-or-later. See LICENSE.

Deeper zoom on zone and city maps: after Blizzard builds a map's zoom levels
(CreateZoomLevels, on every map change and canvas resize), append steps up
to the "Deepest zoom" setting.

This hooks the SCROLL CONTAINER's method. Never hooksecurefunc a
WorldMapFrame method (see MapFrame.lua). Nothing is appended in combat:
writing into Blizzard's zoom list mid map-change could taint that path.
Zoom.combatDebug (/vm debug combatzoom, session only) lifts that for the
in-game taint test.
]]

local ADDON, Veilmap = ...
local Tiles = Veilmap.Tiles

local Zoom = {}
Veilmap.Zoom = Zoom

Zoom.combatDebug = false
local installed = false

local function onCreateZoomLevels(container)
	local db = Veilmap.db
	if not db or not db.detailEnabled then return end
	if InCombatLockdown() and not Zoom.combatDebug then return end
	if not Veilmap.Detail.IsDetailMap(container.mapID) then return end

	local levels = container.zoomLevels
	if type(levels) ~= "table" or #levels == 0 then return end
	for i = 1, #levels do
		if levels[i].layerIndex ~= 1 then return end
	end

	local base = levels[1].scale
	local extra = Tiles.ZoomScales(levels[#levels].scale / base, db.detailMaxZoom)
	for i = 1, #extra do
		levels[#levels + 1] = { scale = extra[i] * base, layerIndex = 1 }
	end
end

function Zoom.Initialise()
	if installed then return end
	installed = true
	hooksecurefunc(WorldMapFrame.ScrollContainer, "CreateZoomLevels", onCreateZoomLevels)
end
