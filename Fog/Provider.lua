--[[
Veilmap - Copyright (C) 2026 xElementzx
GPL-3.0-or-later. See LICENSE.

Draws the overlays the player has NOT discovered, tinted, on a pin of our own.

Blizzard's MapExplorationPin is never hooked, wrapped or replaced. We register an
independent data provider, so nothing we do can taint Blizzard's pin or share its
texture pool.
]]

local ADDON, Veilmap = ...
local Geometry = Veilmap.Geometry

--------------------------------------------------------------------------------
-- Pin
--------------------------------------------------------------------------------

VeilmapFogPinMixin = CreateFromMixins(MapCanvasPinMixin)

function VeilmapFogPinMixin:OnLoad()
	self:SetIgnoreGlobalPinScale(true)
	if self.UseFrameLevelType then
		self:UseFrameLevelType("PIN_FRAME_LEVEL_MAP_EXPLORATION")
	end
	self.texturePool = CreateTexturePool(self, "ARTWORK", -1)
end

function VeilmapFogPinMixin:OnReleased()
	if self.texturePool then self.texturePool:ReleaseAll() end
end

-- entries: array of {width, height, offsetX, offsetY, areaID, "fileDataIDs"}
function VeilmapFogPinMixin:Draw(entries, layerInfo, r, g, b, a)
	self.texturePool:ReleaseAll()

	local canvas = self:GetMap()

	-- The pin must span the map canvas: entries' offsetX/offsetY are positioned
	-- via SetPoint("TOPLEFT", offsetX, -offsetY) relative to this pin, and those
	-- offsets only mean the right thing if the pin itself covers the whole map.
	self:SetAllPoints(canvas:GetCanvas())

	local tileWidth, tileHeight = layerInfo.tileWidth, layerInfo.tileHeight

	for i = 1, #entries do
		local entry = entries[i]
		local width, height = entry[1], entry[2]
		local offsetX, offsetY = entry[3], entry[4]
		local fileIDs = { strsplit(",", entry[6]) }

		local wide, tall = Geometry.TileCounts(width, height, tileWidth, tileHeight)

		for row = 1, tall do
			local pixelH, texMaxY = Geometry.TileSpan(row, tall, height, tileHeight)
			for col = 1, wide do
				local pixelW, texMaxX = Geometry.TileSpan(col, wide, width, tileWidth)

				local fileID = tonumber(fileIDs[(row - 1) * wide + col])
				if fileID then
					local texture = self.texturePool:Acquire()
					canvas:AddMaskableTexture(texture)
					texture:SetWidth(pixelW)
					texture:SetHeight(pixelH)
					texture:SetTexCoord(0, texMaxX, 0, texMaxY)
					texture:SetPoint(
						"TOPLEFT",
						offsetX + tileWidth * (col - 1),
						-(offsetY + tileHeight * (row - 1))
					)
					texture:SetTexture(fileID, nil, nil, "TRILINEAR")
					texture:SetVertexColor(r, g, b)
					texture:SetAlpha(a)
					texture:Show()
				end
			end
		end
	end
end

--------------------------------------------------------------------------------
-- Provider
--------------------------------------------------------------------------------

-- A MapCanvasDataProvider instance binds to exactly one canvas, so the world
-- map and the battlefield map each need their own instance. Methods live on
-- a shared mixin; CreateFogProvider below builds one instance per canvas.
-- warnedDrawErrors and refreshPending are per-INSTANCE fields (set in
-- CreateFogProvider, not here), specifically so one canvas's error or combat
-- deferral can never silence or delay the other's.
local FogProviderMixin = CreateFromMixins(MapCanvasDataProviderMixin)

-- Reports a caught error at most once per distinct message, per instance
-- (self.warnedDrawErrors). This exists ONLY for canvas/API calls whose
-- surface we cannot fully vouch for on every canvas (the battlefield map is
-- a MapCanvas like the world map, but is not guaranteed to expose an
-- identical surface) - a difference there should degrade to one reported
-- warning, not error on every refresh. It must never wrap Veilmap's own
-- logic (Geometry, dataset lookups): a bug in our own code should fail
-- loudly and repeatedly like any other bug, not get silently swallowed and
-- permanently dedup'd alongside genuine canvas differences.
function FogProviderMixin:ReportDrawError(err)
	local message = tostring(err)
	if not self.warnedDrawErrors[message] then
		self.warnedDrawErrors[message] = true
		print("|cffff3333Veilmap|r fog overlay failed to draw: " .. message)
	end
end

function FogProviderMixin:RemoveAllData()
	-- RemoveAllPinsByTemplate is a canvas call, guarded for the same reason
	-- as the canvas calls in RefreshAllData below.
	local ok, err = pcall(function()
		self:GetMap():RemoveAllPinsByTemplate("VeilmapFogPinTemplate")
	end)
	if not ok then
		self:ReportDrawError(err)
	end
end

function FogProviderMixin:RefreshAllData(fromOnShow)
	-- Acquiring or drawing our pin reaches Blizzard's MapCanvasPinMixin setup,
	-- which calls the protected Frame:SetPassThroughButtons; doing that from
	-- our insecure code taints that call chain and gets blocked in combat.
	-- Releasing pins may also reach protected code, so we bail before
	-- touching anything, not just before drawing, and pick the refresh back
	-- up once combat ends. Both canvases need this independently.
	if InCombatLockdown() then
		self.refreshPending = true
		return
	end

	self:RemoveAllData()

	local db = Veilmap.db
	-- Each canvas has its own independent switch (fogEnabled for the world
	-- map, fogBattlefieldMap for the battlefield map). It is read fresh here,
	-- not cached, so a setting change takes effect on the next refresh with
	-- no reload.
	if not db or not db[self.enabledSetting] then return end

	-- Guarded read: only canvas/API calls (GetMap, GetMapID, GetMapArtID,
	-- GetMapArtLayers, GetCanvasContainer/GetCurrentLayerIndex,
	-- GetExploredMapTextures) live inside this pcall, so an unexpected
	-- battlefield-map API difference is caught and reported once instead of
	-- erroring every refresh. entries/layerInfo/live come back nil (with
	-- readOk true) for the ordinary "nothing to draw yet" cases.
	local readOk, entriesOrErr, layerInfo, live = pcall(function()
		local canvas = self:GetMap()
		local mapID = canvas:GetMapID()
		if not mapID then return nil end

		local artID = C_Map.GetMapArtID(mapID)
		local entries = artID and VeilmapFogData and VeilmapFogData[artID]
		if not entries then return nil end

		local layers = C_Map.GetMapArtLayers(mapID)
		local layerInfo = layers and layers[canvas:GetCanvasContainer():GetCurrentLayerIndex()]
		if not layerInfo then return nil end

		local live = C_MapExplorationInfo.GetExploredMapTextures(mapID)
		return entries, layerInfo, live
	end)
	if not readOk then
		self:ReportDrawError(entriesOrErr)
		return
	end
	local entries = entriesOrErr
	if not entries or not layerInfo then return end

	-- Veilmap's own logic, deliberately left UNGUARDED (no pcall): a
	-- malformed dataset entry or a bug in Geometry should error loudly and
	-- every time, not be caught and dedup'd away by warnedDrawErrors.
	local explored = Geometry.BuildExploredKeySet(live)
	local unexplored = {}
	for i = 1, #entries do
		local e = entries[i]
		if not explored[Geometry.OverlayKey(e[1], e[2], e[3], e[4])] then
			unexplored[#unexplored + 1] = e
		end
	end
	if #unexplored == 0 then return end

	-- Guarded draw: AcquirePin/Draw reach canvas and pin-pool APIs, guarded
	-- for the same reason as the read above.
	local color = db.fogColor
	local drawOk, drawErr = pcall(function()
		local pin = self:GetMap():AcquirePin("VeilmapFogPinTemplate")
		pin:Draw(unexplored, layerInfo, color.r, color.g, color.b, color.a)
	end)
	if not drawOk then
		self:ReportDrawError(drawErr)
	end
end

-- Coverage report for the current map. Used by /veilmap verify. Deliberately
-- always reports on WorldMapFrame regardless of which instance this is called
-- on: /veilmap verify is world-map only, per the brief for this task.
function FogProviderMixin:Report()
	local canvas = WorldMapFrame
	local mapID = canvas:GetMapID()
	local artID = mapID and C_Map.GetMapArtID(mapID)
	local entries = artID and VeilmapFogData and VeilmapFogData[artID]

	local report = {
		mapID = mapID,
		artID = artID,
		total = entries and #entries or 0,
		explored = 0,
		unexplored = 0,
		missingTiles = 0,
		liveCount = 0,
	}
	if not entries then return report end

	local live = C_MapExplorationInfo.GetExploredMapTextures(mapID)
	local exploredSet = Geometry.BuildExploredKeySet(live)

	for i = 1, #entries do
		local e = entries[i]
		if exploredSet[Geometry.OverlayKey(e[1], e[2], e[3], e[4])] then
			report.explored = report.explored + 1
		else
			report.unexplored = report.unexplored + 1
		end
		if e[6] == "" then
			report.missingTiles = report.missingTiles + 1
		end
	end

	-- Overlays the client knows about but our dataset does not.
	report.liveCount = live and #live or 0
	return report
end

-- Every provider instance, so the shared combat watcher below can pick up
-- each one's own deferred refresh independently.
local fogProviderInstances = {}

-- enabledSetting: the Veilmap.db key that switches fog on for this canvas
-- ("fogEnabled" for the world map, "fogBattlefieldMap" for the battlefield map).
local function CreateFogProvider(enabledSetting)
	local provider = CreateFromMixins(FogProviderMixin)
	-- Per-instance, not module-level: see the comment above FogProviderMixin.
	provider.warnedDrawErrors = {}
	provider.refreshPending = false
	provider.enabledSetting = enabledSetting
	fogProviderInstances[#fogProviderInstances + 1] = provider
	return provider
end

-- Veilmap.FogProvider must keep resolving to the WORLD MAP instance: Core.lua's
-- /veilmap verify calls Veilmap.FogProvider:Report().
Veilmap.FogProvider = CreateFogProvider("fogEnabled")
local BattlefieldFogProvider = CreateFogProvider("fogBattlefieldMap")

-- Redraws fog on every canvas that has a provider attached and is showing.
-- Called when a fog setting changes; RefreshAllData itself handles combat
-- deferral and the per-canvas enable switches.
function Veilmap.RefreshFog()
	for i = 1, #fogProviderInstances do
		local provider = fogProviderInstances[i]
		local map = provider:GetMap()
		if map and map:IsShown() then
			provider:RefreshAllData()
		end
	end
end

-- Picks a deferred refresh back up once combat ends, for every canvas that
-- deferred one. Never registers for PLAYER_REGEN_DISABLED: entering combat
-- needs no action, RefreshAllData already bails out for itself if combat
-- starts before it runs.
local combatWatcher = CreateFrame("Frame")
combatWatcher:RegisterEvent("PLAYER_REGEN_ENABLED")
combatWatcher:SetScript("OnEvent", function()
	for i = 1, #fogProviderInstances do
		local provider = fogProviderInstances[i]
		if provider.refreshPending then
			provider.refreshPending = false
			provider:RefreshAllData()
		end
	end
end)

-- The battlefield map add-on (Blizzard_BattlefieldMap) is load-on-demand, so
-- BattlefieldMapFrame may not exist yet when Veilmap.OnReady runs. This
-- registers immediately if it is already there, or waits for the
-- ADDON_LOADED naming it otherwise. Registers at most once either way.
local battlefieldMapRegistered = false

local function RegisterBattlefieldMapProvider()
	if battlefieldMapRegistered or not BattlefieldMapFrame then return end
	battlefieldMapRegistered = true
	BattlefieldMapFrame:AddDataProvider(BattlefieldFogProvider)
	if BattlefieldMapFrame:IsShown() then
		BattlefieldFogProvider:RefreshAllData()
	end
end

local function WatchForBattlefieldMap()
	local watcher = CreateFrame("Frame")
	watcher:RegisterEvent("ADDON_LOADED")
	watcher:SetScript("OnEvent", function(self, event, name)
		if name ~= "Blizzard_BattlefieldMap" then return end
		self:UnregisterEvent("ADDON_LOADED")
		RegisterBattlefieldMapProvider()
	end)
end

function Veilmap.OnReady()
	WorldMapFrame:AddDataProvider(Veilmap.FogProvider)
	Veilmap.MapFrame.Initialise()
	Veilmap.Coords.Initialise()
	Veilmap.Options.Initialise()
	if WorldMapFrame:IsShown() then
		Veilmap.FogProvider:RefreshAllData()
	end

	RegisterBattlefieldMapProvider()
	if not battlefieldMapRegistered then
		WatchForBattlefieldMap()
	end
end
