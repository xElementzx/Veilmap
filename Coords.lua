--[[
Veilmap - Copyright (C) 2026 xElementzx
GPL-3.0-or-later. See LICENSE.

Player and cursor coordinates beneath the world map.
]]

local ADDON, Veilmap = ...

local Coords = {}
Veilmap.Coords = Coords

local frame, playerText, cursorText
local format = "%s: %.1f, %.1f"
local THROTTLE = 0.05
local elapsedSince = 0

-- Cursor position as a 0-1 fraction of the map canvas, or nil when off-canvas.
local function cursorFraction()
	local child = WorldMapFrame.ScrollContainer.Child
	local left, top = child:GetLeft(), child:GetTop()
	local width, height = child:GetWidth(), child:GetHeight()
	if not left or not top or width == 0 or height == 0 then return end

	local scale = child:GetEffectiveScale()
	local x, y = GetCursorPosition()
	local cx = (x / scale - left) / width
	local cy = (top - y / scale) / height

	if cx < 0 or cx > 1 or cy < 0 or cy > 1 then return end
	return cx, cy
end

local function onUpdate(_, delta)
	elapsedSince = elapsedSince + delta
	if elapsedSince < THROTTLE then return end
	elapsedSince = 0

	local mapID = WorldMapFrame:GetMapID()
	local position = mapID and C_Map.GetPlayerMapPosition(mapID, "player")
	if position then
		local px, py = position:GetXY()
		playerText:SetFormattedText(format, PLAYER, px * 100, py * 100)
	else
		playerText:SetText("")
	end

	local cx, cy = cursorFraction()
	if cx then
		cursorText:SetFormattedText(format, "Cursor", cx * 100, cy * 100)
	else
		cursorText:SetText("")
	end
end

function Coords.Refresh()
	local db = Veilmap.db
	if not db or not frame then return end

	local precision = db.coordsPrecision
	format = "%s: %." .. precision .. "f, %." .. precision .. "f"

	local font = GameFontNormal:GetFont()
	playerText:SetFont(font, db.coordsFontSize, "OUTLINE")
	cursorText:SetFont(font, db.coordsFontSize, "OUTLINE")

	if db.coordsEnabled then
		frame:Show()
		frame:SetScript("OnUpdate", onUpdate)
	else
		frame:Hide()
		frame:SetScript("OnUpdate", nil)
	end
end

function Coords.Initialise()
	if frame then return end

	frame = CreateFrame("Frame", nil, WorldMapFrame.ScrollContainer)
	frame:SetAllPoints(WorldMapFrame.ScrollContainer)

	playerText = frame:CreateFontString(nil, "OVERLAY")
	cursorText = frame:CreateFontString(nil, "OVERLAY")

	playerText:SetTextColor(1, 1, 1)
	cursorText:SetTextColor(1, 1, 1)

	playerText:SetPoint("TOPRIGHT", WorldMapFrame.ScrollContainer, "BOTTOM", -30, -5)
	cursorText:SetPoint("TOPLEFT", WorldMapFrame.ScrollContainer, "BOTTOM", 30, -5)

	Coords.Refresh()
end
