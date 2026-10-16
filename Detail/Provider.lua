--[[
Veilmap - Copyright (C) 2026 xElementzx
GPL-3.0-or-later. See LICENSE.

The close-zoom detail layer: the game's minimap tiles, faded in under the
fog tint as a zone or city map is zoomed. One pin spans the canvas; tile
textures sit at fixed canvas positions, so Blizzard's pan and zoom move and
scale them. Pan and zoom only change which tiles show and how strongly:
pure texture work on our own pin, safe in combat.
]]

local ADDON, Veilmap = ...
local Tiles = Veilmap.Tiles

local Detail = {}
Veilmap.Detail = Detail

local PREFIX = "|cff33ff99Veilmap|r: "
local PIN_LEVEL = "PIN_FRAME_LEVEL_EVENT_OVERLAY"
-- Above this many tiles in view the detail is too faint to matter: skip.
local MAX_TILES = 150
local MIN_ALPHA = 0.01
local VIEW_MARGIN = 1

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

--------------------------------------------------------------------------------
-- Pin
--------------------------------------------------------------------------------

VeilmapDetailPinMixin = CreateFromMixins(MapCanvasPinMixin)

function VeilmapDetailPinMixin:OnLoad()
	self:SetIgnoreGlobalPinScale(true)
	self:UseFrameLevelType(PIN_LEVEL)
	self.texturePool = CreateTexturePool(self, "ARTWORK", 0)
	self.shown = {}
end

-- Blizzard's pool resets a newly created pin (calling this) before
-- AcquirePin runs OnLoad, so the texture pool may not exist yet.
function VeilmapDetailPinMixin:OnReleased()
	if self.texturePool then self.texturePool:ReleaseAll() end
	self.shown = {}
end

-- Shows the tiles in range at alpha, releases the rest.
function VeilmapDetailPinMixin:ShowTiles(state, tx0, tx1, ty0, ty1, alpha)
	local canvas = self:GetMap()
	local width, height = state.width, state.height
	local wanted = {}

	for tx = tx0, tx1 do
		for ty = ty0, ty1 do
			local key = tx * 64 + ty
			local fileID = state.tiles[key]
			if fileID then
				local cu0, cv0, cu1, cv1, s0, t0, s1, t1 = Tiles.Clip(Tiles.TileRect(state.transform, tx, ty))
				if cu0 then
					wanted[key] = true
					local texture = self.shown[key]
					if not texture then
						texture = self.texturePool:Acquire()
						canvas:AddMaskableTexture(texture)
						texture:SetTexture(fileID, nil, nil, "LINEAR")
						texture:ClearAllPoints()
						texture:SetPoint("TOPLEFT", self, "TOPLEFT", cu0 * width, -cv0 * height)
						texture:SetSize((cu1 - cu0) * width, (cv1 - cv0) * height)
						texture:SetTexCoord(s0, s1, t0, t1)
						texture:Show()
						self.shown[key] = texture
					end
					texture:SetAlpha(alpha)
				end
			end
		end
	end

	for key, texture in pairs(self.shown) do
		if not wanted[key] then
			self.texturePool:Release(texture)
			self.shown[key] = nil
		end
	end
end

function VeilmapDetailPinMixin:HideTiles()
	self.texturePool:ReleaseAll()
	self.shown = {}
end

--------------------------------------------------------------------------------
-- Provider
--------------------------------------------------------------------------------

local Provider = CreateFromMixins(MapCanvasDataProviderMixin)
Detail.Provider = Provider
Provider.warned = {}
Provider.refreshPending = false

function Provider:Report(err)
	local message = tostring(err)
	if not self.warned[message] then
		self.warned[message] = true
		print(PREFIX .. "map detail failed: " .. message)
	end
end

function Provider:RemoveAllData()
	self.pin = nil
	self.state = nil
	local ok, err = pcall(function()
		self:GetMap():RemoveAllPinsByTemplate("VeilmapDetailPinTemplate")
	end)
	if not ok then self:Report(err) end
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

function Provider:RefreshAllData()
	-- Acquiring a pin reaches protected code in combat (see Fog/Provider.lua).
	if InCombatLockdown() then
		self.refreshPending = true
		-- This refresh is usually a map change: the old map's tiles and
		-- placement must not carry over onto the new one. Releasing textures
		-- is plain texture work, safe in combat.
		if self.pin then self.pin:HideTiles() end
		self.state = nil
		return
	end
	self:RemoveAllData()

	local db = Veilmap.db
	if not db or not db.detailEnabled then return end

	local canvas = self:GetMap()
	local mapID = canvas:GetMapID()
	if not Detail.IsDetailMap(mapID) then return end

	if not Detail.HasFrameLevel(canvas, PIN_LEVEL) then
		self:Report("the map has no " .. PIN_LEVEL .. " layer; detail disabled")
		return
	end

	local ok, continent, x0, y0, x1, y1 = readWorldRect(mapID)
	if not ok then
		self:Report(continent)
		return
	end
	-- Map (0,0) is the north-west corner: highest X and highest Y.
	local tiles = continent and VeilmapMinimapTiles and VeilmapMinimapTiles[continent]
	if not tiles then return end

	local drawOk, drawErr = pcall(function()
		-- The canvas child is sized explicitly to the map art (SetCanvasSize),
		-- so this is reliable even before the pin has been laid out.
		local width, height = canvas:GetCanvas():GetSize()
		self.state = {
			mapID = mapID,
			transform = Tiles.Transform(math.min(x0, x1), math.min(y0, y1), math.max(x0, x1), math.max(y0, y1)),
			tiles = tiles,
			width = width,
			height = height,
		}
		local pin = canvas:AcquirePin("VeilmapDetailPinTemplate")
		pin:SetAllPoints(canvas:GetCanvas())
		-- Blizzard only applies a pin's level when positioning it by point
		-- (SetPosition); a canvas-spanning pin has to apply its own.
		pin:ApplyFrameLevel()
		self.pin = pin
	end)
	if not drawOk then
		self:Report(drawErr)
		return
	end
	self:UpdateView()
end

function Provider:UpdateView()
	local pin, state, db = self.pin, self.state, Veilmap.db
	if not pin or not state or not db then return end

	local canvas = self:GetMap()
	if canvas:GetMapID() ~= state.mapID then
		pin:HideTiles()
		return
	end
	local container = canvas.ScrollContainer
	local alpha = db.detailStrength * Tiles.Fade(canvas:GetCanvasScale() / container:GetScaleForMinZoom())
	if alpha < MIN_ALPHA then
		pin:HideTiles()
		return
	end

	local view = canvas:GetViewRect()
	local tx0, tx1, ty0, ty1 = Tiles.TileRange(state.transform, view.left, view.top, view.right, view.bottom, VIEW_MARGIN)
	if (tx1 - tx0 + 1) * (ty1 - ty0 + 1) > MAX_TILES then
		pin:HideTiles()
		return
	end
	pin:ShowTiles(state, tx0, tx1, ty0, ty1, alpha)
end

Provider.OnCanvasScaleChanged = Provider.UpdateView
Provider.OnCanvasPanChanged = Provider.UpdateView
Provider.OnCanvasSizeChanged = Provider.UpdateView

-- Settings changes: strength re-fades in place; the toggle needs a refresh.
function Detail.Refresh()
	local map = Provider:GetMap()
	if not map or not map:IsShown() then return end
	if Veilmap.db.detailEnabled and Provider.pin then
		Provider:UpdateView()
	else
		Provider:RefreshAllData()
	end
end

local combatWatcher = CreateFrame("Frame")
combatWatcher:RegisterEvent("PLAYER_REGEN_ENABLED")
combatWatcher:SetScript("OnEvent", function()
	if Provider.refreshPending then
		Provider.refreshPending = false
		local map = Provider:GetMap()
		if map and map:IsShown() then Provider:RefreshAllData() end
	end
end)

function Detail.Initialise()
	WorldMapFrame:AddDataProvider(Provider)
end
