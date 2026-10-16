--[[
Veilmap - Copyright (C) 2026 xElementzx
GPL-3.0-or-later. See LICENSE.

A tracked waypoint to an unexplored patch, cleared once the patch is
discovered. Only a waypoint Veilmap set itself is ever cleared: if the player
has re-pinned since, theirs is left alone.
]]

local ADDON, Veilmap = ...
local Areas = Veilmap.Areas
local Geometry = Veilmap.Geometry

local Waypoint = {}
Veilmap.Waypoint = Waypoint

local PREFIX = "|cff33ff99Veilmap|r: "

-- { mapID, x, y, key, names } for the waypoint we set, or nil.
local ours

-- The waypoint API is guarded like the canvas calls in Provider.lua: one
-- report per distinct message, never repeated.
local warned = {}
local function reportError(err)
	local message = tostring(err)
	if not warned[message] then
		warned[message] = true
		print(PREFIX .. "waypoint failed: " .. message)
	end
end

local function namesOf(areaIDs)
	local names = {}
	for i = 1, #areaIDs do
		names[i] = Veilmap.AreaName(areaIDs[i])
	end
	return table.concat(names, ", ")
end

-- Where to put the waypoint: the terrain target nearest the patch, or the
-- patch's hit-rect centre when no target lands on this map. Terrain targets
-- (Fog/Targets_Forever.lua) are chunk centres whose area ID triggers the
-- discovery; the map art can be much larger than that ground.
local function targetFor(areaIDs, mapID, entry, layerW, layerH)
	local cx, cy = Areas.Centre(entry, layerW, layerH)
	local targets = VeilmapAreaTargets
	if not targets then return cx, cy end

	local candidates = {}
	for i = 1, #areaIDs do
		local t = targets[areaIDs[i]]
		if t then
			local continent = t[1]
			for j = 2, #t - 1, 2 do
				local ok, uiMapID, position = pcall(C_Map.GetMapPosFromWorldPos,
					continent, CreateVector2D(t[j], t[j + 1]), mapID)
				if ok and uiMapID == mapID and position then
					local x, y = position:GetXY()
					if Areas.OnMap(x, y) then
						candidates[#candidates + 1] = { x = x, y = y }
					end
				end
			end
		end
	end

	local best = Areas.Nearest(candidates, cx, cy, layerW, layerH)
	if best then return best.x, best.y end
	return cx, cy
end

function Waypoint.Set(entry, areaIDs)
	-- Which areas to aim at: all the overlay's areas for an Alt-click (any of
	-- them reveals it), or just the list row's area.
	areaIDs = areaIDs or entry[5]

	-- A blocked protected call shows Blizzard's "action blocked" popup rather
	-- than raising an error we could catch, so refuse up front.
	if InCombatLockdown() then
		print(PREFIX .. "can't set a waypoint in combat.")
		return
	end

	local current = Veilmap.FogProvider:GetUnexplored()
	if not current then return end

	local mapID = current.mapID
	local x, y = targetFor(areaIDs, mapID, entry, current.layerWidth, current.layerHeight)

	local ok, result = pcall(function()
		if not C_Map.CanSetUserWaypointOnMap(mapID) then return false end
		C_Map.SetUserWaypoint(UiMapPoint.CreateFromCoordinates(mapID, x, y))
		C_SuperTrack.SetSuperTrackedUserWaypoint(true)
		return true
	end)
	if not ok then
		reportError(result)
		return
	end
	if not result then
		print(PREFIX .. "waypoints aren't available on this map.")
		return
	end

	ours = {
		mapID = mapID,
		x = x,
		y = y,
		key = Geometry.OverlayKey(entry[1], entry[2], entry[3], entry[4]),
		names = namesOf(areaIDs),
	}
	print(PREFIX .. "waypoint set to " .. ours.names .. ".")
end

-- Reads the live waypoint and explored textures for our map. Guarded API
-- calls only; the comparison logic below stays unguarded.
local function readLive(mapID)
	return pcall(function()
		return C_Map.GetUserWaypoint(), C_MapExplorationInfo.GetExploredMapTextures(mapID)
	end)
end

local function onExplorationUpdated()
	if not ours then return end

	local ok, point, live = readLive(ours.mapID)
	if not ok then
		reportError(point)
		return
	end

	local stillOurs = point and point.uiMapID == ours.mapID
		and Areas.PointMatches(point.position.x, point.position.y, ours.x, ours.y)
	if not stillOurs then
		-- The player replaced or removed it. Not ours to touch any more.
		ours = nil
		return
	end

	if not Geometry.BuildExploredKeySet(live)[ours.key] then return end

	local names = ours.names
	ours = nil
	local cleared, err = pcall(C_Map.ClearUserWaypoint)
	if not cleared then
		reportError(err)
		return
	end
	print(PREFIX .. "discovered " .. names .. ", waypoint cleared.")
end

local watcher = CreateFrame("Frame")
watcher:RegisterEvent("MAP_EXPLORATION_UPDATED")
watcher:SetScript("OnEvent", onExplorationUpdated)
