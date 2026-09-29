--[[
Veilmap - Copyright (C) 2026 xElementzx
GPL-3.0-or-later. See LICENSE.

Pure geometry for overlay tiling. No WoW API calls, so this is unit-testable.

Blizzard stores each overlay as a grid of tiles. Every tile is a full tileSize
square except those in the final row and column, which hold only the remainder.
Those remainder tiles are stored in a texture padded up to the next power of two
(minimum 16), so the visible fraction is pixels/paddedSize and the texture
coordinates must be scaled to match.
]]

local ADDON, Veilmap = ...
Veilmap = Veilmap or {}

local Geometry = {}
Veilmap.Geometry = Geometry

local ceil = math.ceil

function Geometry.OverlayKey(width, height, offsetX, offsetY)
	return width .. ":" .. height .. ":" .. offsetX .. ":" .. offsetY
end

-- Keys the overlays the player has already discovered, so the provider can skip them.
function Geometry.BuildExploredKeySet(textures)
	local set = {}
	if type(textures) ~= "table" then return set end
	for i = 1, #textures do
		local t = textures[i]
		set[Geometry.OverlayKey(t.textureWidth, t.textureHeight, t.offsetX, t.offsetY)] = true
	end
	return set
end

function Geometry.TileCounts(width, height, tileWidth, tileHeight)
	return ceil(width / tileWidth), ceil(height / tileHeight)
end

-- index and count are 1-based. Returns the tile's visible pixel size along one
-- axis, and the texture coordinate maximum for that axis.
function Geometry.TileSpan(index, count, total, tileSize)
	if index < count then
		return tileSize, 1
	end

	local pixels = total % tileSize
	if pixels == 0 then
		pixels = tileSize
	end

	local padded = 16
	while padded < pixels do
		padded = padded * 2
	end

	return pixels, pixels / padded
end

return Geometry
