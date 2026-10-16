--[[
Veilmap - Copyright (C) 2026 xElementzx
GPL-3.0-or-later. See LICENSE.

A collapsible list of the current zone's unexplored areas, docked to the
world map. Click a row for a waypoint; hover it to highlight its patches.
Rebuilt whenever the world-map fog refreshes (Veilmap.OnFogRefreshed).
]]

local ADDON, Veilmap = ...
local Areas = Veilmap.Areas

local AreaList = {}
Veilmap.AreaList = AreaList

local WIDTH = 190
local ROW_HEIGHT = 16
local HEADER_HEIGHT = 22
local PAD = 6
local TAB_SIZE = 24
-- Below the map's title bar when docked outside.
local DOCK_Y = -30
-- Rows to scroll per mouse-wheel notch.
local WHEEL_ROWS = 3
-- Frame levels above the map canvas, clearing the pins the pin frame-level
-- manager stacks on it.
local CANVAS_CLEARANCE = 100

local NEXT_PAGE = "Interface\\Buttons\\UI-SpellbookIcon-NextPage-"
local PREV_PAGE = "Interface\\Buttons\\UI-SpellbookIcon-PrevPage-"

local tab, panel, header, scroll, content
local rows = {}

-- Outside the right edge normally. Maximized, that edge is off-screen, so
-- dock inside the canvas's top-right corner and open inwards.
local function anchor()
	tab:ClearAllPoints()
	panel:ClearAllPoints()
	-- Created as children of WorldMapFrame, both sit below the canvas and its
	-- pins. That is invisible outside the map, but docked inside it they would
	-- be drawn under the map and lose their clicks.
	local level = WorldMapFrame.ScrollContainer:GetFrameLevel() + CANVAS_CLEARANCE
	tab:SetFrameLevel(level)
	panel:SetFrameLevel(level)

	if WorldMapFrame:IsMaximized() then
		tab:SetPoint("TOPRIGHT", WorldMapFrame.ScrollContainer, "TOPRIGHT", -4, -4)
		panel:SetPoint("TOPRIGHT", tab, "TOPLEFT", -2, 0)
	else
		tab:SetPoint("TOPLEFT", WorldMapFrame, "TOPRIGHT", 0, DOCK_Y)
		panel:SetPoint("TOPLEFT", tab, "TOPRIGHT", 0, 0)
	end
end

-- The arrow points the way the panel will move: outward to open, back
-- toward the map to close.
local function updateTabArrow()
	local opensRight = not WorldMapFrame:IsMaximized()
	local expanded = not Veilmap.db.areaListCollapsed
	local pointsRight = (opensRight and not expanded) or (not opensRight and expanded)
	local base = pointsRight and NEXT_PAGE or PREV_PAGE
	tab:SetNormalTexture(base .. "Up")
	tab:SetPushedTexture(base .. "Down")
end

local function onRowEnter(row)
	Veilmap.FogProvider:Highlight(row.group.entries)
end

local function onRowLeave()
	Veilmap.FogProvider:ClearHighlight()
end

local function onRowClick(row)
	Veilmap.Waypoint.Set(row.group.largest, { row.group.areaID })
end

local function getRow(i)
	local row = rows[i]
	if row then return row end

	row = CreateFrame("Button", nil, content)
	row:SetSize(WIDTH - PAD * 2, ROW_HEIGHT)
	row:SetPoint("TOPLEFT", 0, -(i - 1) * ROW_HEIGHT)
	row:SetHighlightTexture("Interface\\QuestFrame\\UI-QuestTitleHighlight", "ADD")

	row.text = row:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
	row.text:SetPoint("LEFT", 4, 0)
	row.text:SetPoint("RIGHT", -4, 0)
	row.text:SetJustifyH("LEFT")
	row.text:SetWordWrap(false)

	row:SetScript("OnEnter", onRowEnter)
	row:SetScript("OnLeave", onRowLeave)
	row:SetScript("OnClick", onRowClick)

	rows[i] = row
	return row
end

local function onWheel(_, delta)
	local range = scroll:GetVerticalScrollRange()
	local target = scroll:GetVerticalScroll() - delta * ROW_HEIGHT * WHEEL_ROWS
	scroll:SetVerticalScroll(math.max(0, math.min(range, target)))
end

local function fill(current)
	local groups = Areas.Group(current.unexplored)

	local names = {}
	for i = 1, #groups do
		local id = groups[i].areaID
		names[id] = C_Map.GetAreaInfo(id)
	end

	local player
	local position = C_Map.GetPlayerMapPosition(current.mapID, "player")
	if position then
		local x, y = position:GetXY()
		-- A neighbouring zone gets a projected, off-map position: alphabetical then.
		if Areas.OnMap(x, y) then
			player = { x = x, y = y }
		end
	end
	Areas.Sort(groups, names, player, current.layerWidth, current.layerHeight)

	header:SetText(Areas.Summary(#groups))

	for i = 1, #groups do
		local row = getRow(i)
		row.group = groups[i]
		row.text:SetText(Areas.DisplayName(names[groups[i].areaID], groups[i].areaID))
		row:Show()
	end
	for i = #groups + 1, #rows do
		rows[i]:Hide()
		rows[i].group = nil
	end

	local listHeight = #groups * ROW_HEIGHT
	content:SetSize(WIDTH - PAD * 2, math.max(listHeight, 1))
	local maxHeight = WorldMapFrame.ScrollContainer:GetHeight()
	panel:SetHeight(math.min(maxHeight, HEADER_HEIGHT + PAD * 2 + listHeight))
	scroll:SetVerticalScroll(0)
end

function AreaList.Refresh()
	if not tab then return end
	Veilmap.FogProvider:ClearHighlight()

	local current = Veilmap.FogProvider:GetUnexplored()
	if not Veilmap.db.areaListEnabled or not current then
		tab:Hide()
		panel:Hide()
		return
	end

	anchor()
	updateTabArrow()
	tab:Show()

	if Veilmap.db.areaListCollapsed then
		panel:Hide()
		return
	end

	fill(current)
	panel:Show()
end

local function toggle()
	Veilmap.db.areaListCollapsed = not Veilmap.db.areaListCollapsed
	AreaList.Refresh()
end

-- Maximize/restore resizes the map without re-showing it. Deferred one
-- frame for the same reason as MapFrame.lua's resize path: Blizzard's own
-- layout must settle first.
local resizePending = false
local function onMapSizeChanged()
	if resizePending then return end
	resizePending = true
	C_Timer.After(0, function()
		resizePending = false
		AreaList.Refresh()
	end)
end

function AreaList.Initialise()
	if tab then return end

	tab = CreateFrame("Button", nil, WorldMapFrame)
	tab:SetSize(TAB_SIZE, TAB_SIZE)
	tab:SetScript("OnClick", toggle)

	panel = CreateFrame("Frame", nil, WorldMapFrame)
	panel:SetWidth(WIDTH)
	panel:EnableMouse(true)
	local background = panel:CreateTexture(nil, "BACKGROUND")
	background:SetAllPoints()
	background:SetColorTexture(0, 0, 0, 0.75)

	header = panel:CreateFontString(nil, "OVERLAY", "GameFontNormal")
	header:SetPoint("TOPLEFT", PAD, -PAD)
	header:SetPoint("TOPRIGHT", -PAD, -PAD)
	header:SetHeight(HEADER_HEIGHT - PAD)
	header:SetJustifyH("LEFT")

	scroll = CreateFrame("ScrollFrame", nil, panel)
	scroll:SetPoint("TOPLEFT", PAD, -(HEADER_HEIGHT + PAD))
	scroll:SetPoint("BOTTOMRIGHT", -PAD, PAD)
	scroll:EnableMouseWheel(true)
	scroll:SetScript("OnMouseWheel", onWheel)

	content = CreateFrame("Frame", nil, scroll)
	content:SetSize(WIDTH - PAD * 2, 1)
	scroll:SetScrollChild(content)

	tab:Hide()
	panel:Hide()

	WorldMapFrame:HookScript("OnSizeChanged", onMapSizeChanged)
	Veilmap.OnFogRefreshed = AreaList.Refresh
end
