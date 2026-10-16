--[[
Veilmap - Copyright (C) 2026 xElementzx
GPL-3.0-or-later. See LICENSE.

Pure maths for the close-zoom detail layer: where each minimap tile sits on
a zone map, which tiles are in view, how they are cropped at the map's
edges, how strongly they show, and the extra zoom steps. No WoW API calls.

World coordinates: X runs north, Y runs west. Map coordinates (u, v) are
0-1 across the map: u grows eastward (as Y falls), v southward (as X falls).
Minimap tile (tx, ty) covers world Y from ORIGIN - tx*T down by T, and world
X from ORIGIN - ty*T down by T: the same grid as the ADT terrain tiles.
]]

local ADDON, Veilmap = ...
Veilmap = Veilmap or {}

local Tiles = {}
Veilmap.Tiles = Tiles

local floor, max, min = math.floor, math.max, math.min

local T = 1600 / 3
local ORIGIN = 32 * T
local GRID = 63 -- tile indices run 0..63

-- Zoom (relative to fully zoomed out) where the detail starts and finishes fading in.
local FADE_FROM, FADE_TO = 1, 2
-- Each appended zoom step is this much deeper than the last.
local ZOOM_STEP = 1.4
-- A step closer than this to the max is replaced by the max itself.
local ZOOM_SNAP = 0.05
-- The max must beat Blizzard's last level by this much to add anything.
local ZOOM_MIN_GAIN = 0.01

-- The map's world extents: X from minX (south) to maxX (north), Y from
-- minY (east) to maxY (west).
function Tiles.Transform(minX, minY, maxX, maxY)
	return { top = maxX, left = maxY, height = maxX - minX, width = maxY - minY }
end

function Tiles.WorldToMap(t, worldX, worldY)
	return (t.left - worldY) / t.width, (t.top - worldX) / t.height
end

function Tiles.TileRect(t, tx, ty)
	local u0 = (t.left - (ORIGIN - tx * T)) / t.width
	local u1 = (t.left - (ORIGIN - (tx + 1) * T)) / t.width
	local v0 = (t.top - (ORIGIN - ty * T)) / t.height
	local v1 = (t.top - (ORIGIN - (ty + 1) * T)) / t.height
	return u0, v0, u1, v1
end

local function clampIndex(i)
	return max(0, min(GRID, i))
end

-- Tiles intersecting the view (0-1 map coordinates), widened by margin tiles.
function Tiles.TileRange(t, left, top, right, bottom, margin)
	local function column(u) return floor((ORIGIN - (t.left - u * t.width)) / T) end
	local function row(v) return floor((ORIGIN - (t.top - v * t.height)) / T) end
	return clampIndex(column(left) - margin), clampIndex(column(right) + margin),
		clampIndex(row(top) - margin), clampIndex(row(bottom) + margin)
end

-- Crops a tile's rect to the map (0-1) and returns the matching texture
-- coordinates; nil when nothing of it is on the map.
function Tiles.Clip(u0, v0, u1, v1)
	if u1 <= 0 or u0 >= 1 or v1 <= 0 or v0 >= 1 then return nil end
	local cu0, cv0, cu1, cv1 = max(u0, 0), max(v0, 0), min(u1, 1), min(v1, 1)
	local du, dv = u1 - u0, v1 - v0
	return cu0, cv0, cu1, cv1,
		(cu0 - u0) / du, (cv0 - v0) / dv, (cu1 - u0) / du, (cv1 - v0) / dv
end

-- 0 at FADE_FROM, 1 at FADE_TO, smoothstep between.
function Tiles.Fade(relativeZoom)
	local x = (relativeZoom - FADE_FROM) / (FADE_TO - FADE_FROM)
	x = max(0, min(1, x))
	return x * x * (3 - 2 * x)
end

-- The relative scales to append after Blizzard's last zoom level, ending
-- exactly at maxRelative.
function Tiles.ZoomScales(lastRelative, maxRelative)
	local out = {}
	if maxRelative <= lastRelative + ZOOM_MIN_GAIN then return out end
	local scale = lastRelative
	while true do
		scale = scale * ZOOM_STEP
		if scale >= maxRelative - ZOOM_SNAP then
			out[#out + 1] = maxRelative
			return out
		end
		out[#out + 1] = scale
	end
end

return Tiles
