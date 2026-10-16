--[[
Veilmap - Copyright (C) 2026 xElementzx
GPL-3.0-or-later. See LICENSE.

The close-zoom detail layer: the game's minimap tiles, faded in under the fog
tint as a zone or city map is zoomed toward Blizzard's 2.14x limit.

Deliberately NOT a map pin. Acquiring a pin reaches protected code
(SetPassThroughButtons), so a pin-based layer has to wait out combat. This is
one plain frame on the map canvas, created at login with a fixed set of
textures, at the EVENT_OVERLAY pin level: above Blizzard's explored overlays,
below the fog. After login everything is texture work on our own frame, so
it works on maps opened or changed in combat. Nothing here writes into
Blizzard's map state (see the phase 5 spec, section 12, for what that costs).
]]

local ADDON, Veilmap = ...
local Tiles = Veilmap.Tiles

local Detail = {}
Veilmap.Detail = Detail

local PREFIX = "|cff33ff99Veilmap|r: "
local LEVEL = "PIN_FRAME_LEVEL_EVENT_OVERLAY"
-- Textures created at login; also the most tiles shown at once. More in view
-- than this means the map is too far out for the detail to matter.
local MAX_TILES = 150
local MIN_ALPHA = 0.01
local VIEW_MARGIN = 1

local layer       -- our frame on the canvas; nil when unavailable
local free = {}   -- textures not showing a tile
local shown = {}  -- tile key -> texture
local state       -- the current map's placement; nil when it gets no detail

-- An unknown frame-level type silently falls back to the default level
-- (2000, far above the map art), so check rather than assume.
function Detail.HasFrameLevel(canvas, frameLevelType)
	local manager = canvas and canvas.GetPinFrameLevelsManager and canvas:GetPinFrameLevelsManager()
	return manager ~= nil and manager.definitions ~= nil and manager.definitions[frameLevelType] ~= nil
end

function Detail.IsDetailMap(mapID)
	local info = mapID and C_Map.GetMapInfo(mapID)
	return info ~= nil and (info.mapType == Enum.UIMapType.Zone or info.mapType == Enum.UIMapType.City)
end

local warned = {}
local function report(err)
	local message = tostring(err)
	if not warned[message] then
		warned[message] = true
		print(PREFIX .. "map detail failed: " .. message)
	end
end

local function release(key)
	local texture = shown[key]
	texture:Hide()
	shown[key] = nil
	free[#free + 1] = texture
end

local function releaseAll()
	for key in pairs(shown) do
		release(key)
	end
end

-- Shows the tiles in range at alpha. Tiles leaving the range are released
-- first, so the fixed texture set always covers the range.
local function showTiles(tx0, tx1, ty0, ty1, alpha)
	local wanted = {}
	for tx = tx0, tx1 do
		for ty = ty0, ty1 do
			local key = tx * 64 + ty
			if state.tiles[key] then wanted[key] = true end
		end
	end
	for key in pairs(shown) do
		if not wanted[key] then release(key) end
	end

	for key in pairs(wanted) do
		local texture = shown[key]
		if not texture then
			local tx, ty = math.floor(key / 64), key % 64
			local cu0, cv0, cu1, cv1, s0, t0, s1, t1 = Tiles.Clip(Tiles.TileRect(state.transform, tx, ty))
			if cu0 then
				texture = table.remove(free)
				texture:SetTexture(state.tiles[key], nil, nil, "LINEAR")
				texture:ClearAllPoints()
				texture:SetPoint("TOPLEFT", layer, "TOPLEFT", cu0 * state.width, -cv0 * state.height)
				texture:SetSize((cu1 - cu0) * state.width, (cv1 - cv0) * state.height)
				texture:SetTexCoord(s0, s1, t0, t1)
				texture:Show()
				shown[key] = texture
			end
		end
		if texture then texture:SetAlpha(alpha) end
	end
end

-- Reads the map's world rectangle and continent. Guarded: API calls only.
local function readWorldRect(mapID)
	return pcall(function()
		local c0, p0 = C_Map.GetWorldPosFromMapPos(mapID, CreateVector2D(0, 0))
		local c1, p1 = C_Map.GetWorldPosFromMapPos(mapID, CreateVector2D(1, 1))
		if not p0 or not p1 or c0 ~= c1 then return nil end
		local x0, y0 = p0:GetXY()
		local x1, y1 = p1:GetXY()
		return c0, x0, y0, x1, y1
	end)
end

--------------------------------------------------------------------------------
-- Provider: only for the canvas's callbacks. It never acquires a pin, so
-- nothing here waits for combat to end.
--------------------------------------------------------------------------------

local Provider = CreateFromMixins(MapCanvasDataProviderMixin)
Detail.Provider = Provider

function Provider:RemoveAllData()
	releaseAll()
	state = nil
end

function Provider:RefreshAllData()
	self:RemoveAllData()

	local db = Veilmap.db
	if not layer or not db or not db.detailEnabled then return end

	local canvas = self:GetMap()
	local mapID = canvas:GetMapID()
	if not Detail.IsDetailMap(mapID) then return end

	local ok, continent, x0, y0, x1, y1 = readWorldRect(mapID)
	if not ok then
		report(continent)
		return
	end
	local tiles = continent and VeilmapMinimapTiles and VeilmapMinimapTiles[continent]
	if not tiles then return end

	-- The canvas child is sized explicitly to the map art (SetCanvasSize).
	local width, height = canvas:GetCanvas():GetSize()
	state = {
		mapID = mapID,
		-- Map (0,0) is the north-west corner; min/max makes the corner order irrelevant.
		transform = Tiles.Transform(math.min(x0, x1), math.min(y0, y1), math.max(x0, x1), math.max(y0, y1)),
		tiles = tiles,
		width = width,
		height = height,
	}
	self:UpdateView()
end

function Provider:UpdateView()
	local db = Veilmap.db
	if not state or not db then return end

	local canvas = self:GetMap()
	if canvas:GetMapID() ~= state.mapID then
		releaseAll()
		return
	end

	local alpha = db.detailStrength * Tiles.Fade(canvas:GetCanvasScale() / canvas.ScrollContainer:GetScaleForMinZoom())
	if alpha < MIN_ALPHA then
		releaseAll()
		return
	end

	local view = canvas:GetViewRect()
	local tx0, tx1, ty0, ty1 = Tiles.TileRange(state.transform, view.left, view.top, view.right, view.bottom, VIEW_MARGIN)
	if (tx1 - tx0 + 1) * (ty1 - ty0 + 1) > MAX_TILES then
		releaseAll()
		return
	end
	showTiles(tx0, tx1, ty0, ty1, alpha)
end

Provider.OnCanvasScaleChanged = Provider.UpdateView
Provider.OnCanvasPanChanged = Provider.UpdateView
Provider.OnCanvasSizeChanged = Provider.UpdateView

-- Settings changes: rebuild for the map on screen, or just clear.
function Detail.Refresh()
	local map = Provider:GetMap()
	if map and map:IsShown() then
		Provider:RefreshAllData()
	else
		Provider:RemoveAllData()
	end
end

function Detail.Initialise()
	if layer then return end
	local canvas = WorldMapFrame
	if not Detail.HasFrameLevel(canvas, LEVEL) then
		report("the map has no " .. LEVEL .. " layer; detail disabled")
		return
	end

	local child = canvas:GetCanvas()
	layer = CreateFrame("Frame", nil, child)
	layer:SetAllPoints(child)
	layer:SetFrameLevel(canvas:GetPinFrameLevelsManager():GetValidFrameLevel(LEVEL))

	-- Registered with the map's mask once, here, rather than as tiles come
	-- and go: AddMaskableTexture writes into the canvas's own table.
	for i = 1, MAX_TILES do
		local texture = layer:CreateTexture(nil, "ARTWORK")
		texture:Hide()
		canvas:AddMaskableTexture(texture)
		free[i] = texture
	end

	canvas:AddDataProvider(Provider)
end
