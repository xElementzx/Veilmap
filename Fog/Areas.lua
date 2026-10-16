--[[
Veilmap - Copyright (C) 2026 xElementzx
GPL-3.0-or-later. See LICENSE.

Pure logic for unexplored-area hunting: which patch is under a point, which
patches make up an area, where to put a waypoint, and how to order the list.
No WoW API calls, so this is unit-testable.

Entries are fog dataset rows: e[5] is the list of area IDs the overlay
covers, e[7] its hit rect {left, top, right, bottom} in map-art pixels.
]]

local ADDON, Veilmap = ...
Veilmap = Veilmap or {}

local Areas = {}
Veilmap.Areas = Areas

local abs = math.abs

-- Waypoint coordinates round-trip through the client as floats, so an exact
-- comparison would treat our own waypoint as foreign.
local POINT_TOLERANCE = 0.0001

local function rectArea(entry)
	local r = entry[7]
	return (r[3] - r[1]) * (r[4] - r[2])
end

-- The entry whose hit rect contains (px, py), edges inclusive. Rects overlap,
-- so the smallest one wins: that is the patch that looks like it is under the
-- cursor. Strict < keeps the earlier entry on a tie.
function Areas.HitTest(entries, px, py)
	local best, bestArea
	for i = 1, #entries do
		local entry = entries[i]
		local r = entry[7]
		if px >= r[1] and px <= r[3] and py >= r[2] and py <= r[4] then
			local area = rectArea(entry)
			if not best or area < bestArea then
				best, bestArea = entry, area
			end
		end
	end
	return best
end

-- One group per area ID, in first-seen order. An overlay covering several
-- areas joins each of their groups. largest is the waypoint target for the
-- group: a centroid of several patches can land somewhere meaningless.
function Areas.Group(entries)
	local groups, byID = {}, {}
	for i = 1, #entries do
		local entry = entries[i]
		local ids = entry[5]
		for j = 1, #ids do
			local id = ids[j]
			local group = byID[id]
			if not group then
				group = { areaID = id, entries = {} }
				byID[id] = group
				groups[#groups + 1] = group
			end
			group.entries[#group.entries + 1] = entry
			if not group.largest or rectArea(entry) > rectArea(group.largest) then
				group.largest = entry
			end
		end
	end
	return groups
end

-- Hit-rect centre as a 0-1 map coordinate.
function Areas.Centre(entry, layerW, layerH)
	local r = entry[7]
	return (r[1] + r[3]) / 2 / layerW, (r[2] + r[4]) / 2 / layerH
end

-- With a player position: nearest first, measured in layer pixels so the
-- map's aspect ratio does not skew it. Without one: alphabetical, ignoring
-- case, with unnamed areas last. Both modes break ties on area ID.
function Areas.Sort(groups, names, player, layerW, layerH)
	if player then
		local distance = {}
		for i = 1, #groups do
			local group = groups[i]
			local x, y = Areas.Centre(group.largest, layerW, layerH)
			local dx, dy = (x - player.x) * layerW, (y - player.y) * layerH
			distance[group] = dx * dx + dy * dy
		end
		table.sort(groups, function(a, b)
			if distance[a] ~= distance[b] then return distance[a] < distance[b] end
			return a.areaID < b.areaID
		end)
	else
		table.sort(groups, function(a, b)
			local na, nb = names[a.areaID], names[b.areaID]
			if na and nb then
				na, nb = na:lower(), nb:lower()
				if na ~= nb then return na < nb end
			elseif na then
				return true
			elseif nb then
				return false
			end
			return a.areaID < b.areaID
		end)
	end
	return groups
end

function Areas.DisplayName(name, areaID)
	if name and name ~= "" then return name end
	return "Area " .. areaID
end

function Areas.Summary(count)
	if count == 0 then return "All explored" end
	if count == 1 then return "Unexplored: 1 area" end
	return "Unexplored: " .. count .. " areas"
end

-- Whether a 0-1 map position lies on the map. C_Map.GetPlayerMapPosition
-- projects the player onto neighbouring zones of the same continent, so a
-- non-nil position alone does not mean the player is on the displayed map.
function Areas.OnMap(x, y)
	return x >= 0 and x <= 1 and y >= 0 and y <= 1
end

-- Whether a press from (downX, downY) to (upX, upY), in screen pixels, was a
-- click rather than the end of a pan drag.
local CLICK_SLOP = 4
function Areas.IsClick(downX, downY, upX, upY)
	return abs(upX - downX) <= CLICK_SLOP and abs(upY - downY) <= CLICK_SLOP
end

-- The point nearest (x, y), measured in layer pixels; nil for no points.
-- Strict < keeps the earlier point on a tie.
function Areas.Nearest(points, x, y, layerW, layerH)
	local best, bestDistance
	for i = 1, #points do
		local p = points[i]
		local dx, dy = (p.x - x) * layerW, (p.y - y) * layerH
		local distance = dx * dx + dy * dy
		if not best or distance < bestDistance then
			best, bestDistance = p, distance
		end
	end
	return best
end

function Areas.PointMatches(ax, ay, bx, by)
	return abs(ax - bx) <= POINT_TOLERANCE and abs(ay - by) <= POINT_TOLERANCE
end

return Areas
