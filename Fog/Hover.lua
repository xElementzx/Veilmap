--[[
Veilmap - Copyright (C) 2026 xElementzx
GPL-3.0-or-later. See LICENSE.

Names the unexplored patch under the cursor, and Alt-click sets a waypoint
to it. Nothing here is mouse-enabled: the cursor is polled and hit-tested
against the published unexplored set, so map zoom, pan and Blizzard's own
Ctrl-click pins are untouched.
]]

local ADDON, Veilmap = ...
local Areas = Veilmap.Areas

local Hover = {}
Veilmap.Hover = Hover

local THROTTLE = 0.05
local elapsedSince = 0
local frame
local hovered        -- entry under the cursor, or nil
local ownsTooltip = false

-- Only when the mouse is over the bare canvas. Over any pin (quest POI,
-- flight master, another addon's icon) the focus is that pin, and its own
-- tooltip wins.
local function overCanvas()
	local container = WorldMapFrame.ScrollContainer
	local focus = GetMouseFoci and GetMouseFoci()[1]
	return focus ~= nil and (focus == container or focus == container.Child)
end

local function hideTooltip()
	if ownsTooltip and GameTooltip:GetOwner() == WorldMapFrame then
		GameTooltip:Hide()
	end
	ownsTooltip = false
end

local function showTooltip(entry)
	GameTooltip:SetOwner(WorldMapFrame, "ANCHOR_CURSOR")
	local ids = entry[5]
	for i = 1, #ids do
		GameTooltip:AddLine(Veilmap.AreaName(ids[i]), 1, 1, 1)
	end
	GameTooltip:AddLine("Unexplored", 0.6, 0.6, 0.6)
	GameTooltip:AddLine("Alt-click: set waypoint (replaces your map pin)", 0.25, 1, 0.25)
	GameTooltip:Show()
	ownsTooltip = true
end

local function setHovered(entry)
	if entry == hovered then return end
	hovered = entry
	if entry then showTooltip(entry) else hideTooltip() end
end

local function onUpdate(_, delta)
	elapsedSince = elapsedSince + delta
	if elapsedSince < THROTTLE then return end
	elapsedSince = 0

	local entry
	local current = Veilmap.FogProvider:GetUnexplored()
	if current and overCanvas() then
		local fx, fy = Veilmap.Coords.CursorFraction()
		if fx then
			entry = Areas.HitTest(current.unexplored, fx * current.layerWidth, fy * current.layerHeight)
		end
	end
	setHovered(entry)
end

local function onMouseUp(_, button)
	if button ~= "LeftButton" or not IsAltKeyDown() then return end
	if not hovered or not Veilmap.db.areaTooltips then return end
	Veilmap.Waypoint.Set(hovered)
end

function Hover.Refresh()
	if not frame then return end
	setHovered(nil)
	if Veilmap.db.areaTooltips then
		frame:SetScript("OnUpdate", onUpdate)
	else
		frame:SetScript("OnUpdate", nil)
	end
end

function Hover.Initialise()
	if frame then return end

	-- Parented to the map so it only polls while the map is shown.
	frame = CreateFrame("Frame", nil, WorldMapFrame)
	frame:SetScript("OnHide", function() setHovered(nil) end)

	-- HookScript appends to the scroll container's handler; Blizzard's own
	-- click handling still runs first and unchanged.
	WorldMapFrame.ScrollContainer:HookScript("OnMouseUp", onMouseUp)

	Hover.Refresh()
end
