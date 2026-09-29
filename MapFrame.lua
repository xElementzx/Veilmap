--[[
Veilmap - Copyright (C) 2026 xElementzx
GPL-3.0-or-later. See LICENSE.

Makes the world map movable and scalable, and remembers where it was.
]]

local ADDON, Veilmap = ...

local MapFrame = {}
Veilmap.MapFrame = MapFrame

local initialised = false

function MapFrame.ApplyScale()
	local db = Veilmap.db
	if not db then return end
	if WorldMapFrame:IsMaximized() then
		if WorldMapFrame:GetScale() ~= 1 then WorldMapFrame:SetScale(1) end
	elseif WorldMapFrame:GetScale() ~= db.mapScale then
		WorldMapFrame:SetScale(db.mapScale)
	end
end

function MapFrame.ApplyPosition()
	local db = Veilmap.db
	if not db or WorldMapFrame:IsMaximized() then return end
	local p = db.position
	WorldMapFrame:ClearAllPoints()
	WorldMapFrame:SetPoint(p.point, UIParent, p.relativePoint or p.point, p.x, p.y)
end

function MapFrame.SavePosition()
	local db = Veilmap.db
	if not db or WorldMapFrame:IsMaximized() then return end
	local point, _, relativePoint, x, y = WorldMapFrame:GetPoint(1)
	db.position.point, db.position.relativePoint, db.position.x, db.position.y = point, relativePoint, x, y
end

local function onDragStart()
	if not WorldMapFrame:IsMaximized() then WorldMapFrame:StartMoving() end
end

local function onDragStop()
	WorldMapFrame:StopMovingOrSizing()
	MapFrame.SavePosition()
end

local fader = CreateFrame("Frame")
fader:Hide()

function MapFrame.ApplyAlpha()
	local db = Veilmap.db
	if not db then return end

	-- Blizzard's own fader would fight ours for control of the map's alpha.
	if PlayerMovementFrameFader and PlayerMovementFrameFader.RemoveFrame then
		PlayerMovementFrameFader.RemoveFrame(WorldMapFrame)
	end

	if db.fadeWhenMoving then
		fader:Show()
	else
		fader:Hide()
		WorldMapFrame:SetAlpha(db.mapAlpha)
	end
end

fader:SetScript("OnUpdate", function(_, elapsed)
	local db = Veilmap.db
	if not db or not WorldMapFrame:IsShown() then return end

	local moving = IsPlayerMoving() and not WorldMapFrame:IsMouseOver()
	local target = moving and db.fadedAlpha or db.mapAlpha
	local alpha = DeltaLerp(WorldMapFrame:GetAlpha(), target, 0.2, elapsed)

	-- Snap, or the lerp asymptotes and never quite settles.
	if math.abs(alpha - target) < 0.01 then alpha = target end
	WorldMapFrame:SetAlpha(alpha)
end)

-- Shared by the OnShow and OnSizeChanged hooks below. Both ApplyScale and
-- ApplyPosition already guard on IsMaximized() and short-circuit when the
-- value is already correct, so calling this more than once per transition
-- (OnSizeChanged in particular can fire several times) is cheap and safe.
-- ApplyAlpha is included here too (rather than as a second, competing
-- OnShow hook) so reopening the map also re-asserts control away from
-- Blizzard's own PlayerMovementFrameFader.
local function reapply()
	MapFrame.ApplyScale()
	MapFrame.ApplyPosition()
	MapFrame.ApplyAlpha()
end

-- OnSizeChanged-only: queues a single deferred reapply() via
-- C_Timer.After(0, ...), scoped by its own pending flag so several
-- OnSizeChanged firings during one maximize/restore transition collapse
-- into one queued call rather than stacking timers. See the comment in
-- Initialise for why this path (and only this path) defers.
local resizeReapplyPending = false
local function deferredReapplyOnResize()
	if resizeReapplyPending then return end
	resizeReapplyPending = true
	C_Timer.After(0, function()
		resizeReapplyPending = false
		reapply()
	end)
end

function MapFrame.Initialise()
	if initialised then return end
	initialised = true

	-- We deliberately leave Blizzard's own panel management alone here: clearing
	-- the UIPanelLayout attributes broke Blizzard's Minimize path (a Lua error
	-- opening the map for the first time while in combat). Instead we let
	-- Blizzard position the map as it normally would, and the script hooks
	-- below re-apply our saved scale/position afterwards.
	WorldMapFrame:SetMovable(true)
	WorldMapFrame:SetClampedToScreen(true)
	WorldMapFrame:RegisterForDrag("LeftButton")
	WorldMapFrame:HookScript("OnDragStart", onDragStart)
	WorldMapFrame:HookScript("OnDragStop", onDragStop)

	-- Do NOT hook WorldMapFrame.SynchronizeDisplayState with hooksecurefunc,
	-- even though it looks like the "correct" place to react to display-state
	-- changes. Live bisection proved the mere PRESENCE of a hooksecurefunc
	-- wrapper on that METHOD breaks Blizzard's own
	-- Show -> SetDisplayState -> Minimize sequence on this client and throws
	-- "attempt to call a nil value" inside Minimize the first time the map is
	-- opened in combat - this happened even with the wrapper reduced to a
	-- no-op body, so it is not about what the hook does, only that
	-- hooksecurefunc shadows the mixin's method with a wrapper at all.
	-- HookScript is different: it appends to a frame script handler rather
	-- than replacing a method, which is why the drag HookScript calls above
	-- have never caused trouble.
	--
	-- OnShow covers the map opening; OnSizeChanged additionally covers
	-- maximize/restore, since restoring from maximized resizes the frame
	-- without hiding and re-showing it, so OnShow alone would miss it.
	--
	-- OnShow and OnSizeChanged deliberately get DIFFERENT timing, and that
	-- difference is not leftover inconsistency - do not "harmonise" them:
	--   - OnShow calls reapply() directly, with no deferral. This is proven
	--     live: it fixes the map-open case with no error and no visible jump.
	--     (History: round 5 added a blanket C_Timer.After deferral here on
	--     the theory that mutating the frame mid-show caused the combat
	--     error. That theory was WRONG - the actual cause was the
	--     hooksecurefunc method wrapper above, removed in round 6 - and
	--     round 7 correctly removed the OnShow deferral, which fixed a
	--     visible jump the deferral itself had introduced.)
	--   - OnSizeChanged calls a DEFERRED reapply via C_Timer.After(0, ...)
	--     (deferredReapplyOnResize below), for a different, evidenced
	--     reason: on maximize/restore, our handler was firing either while
	--     IsMaximized() still reported true (so ApplyPosition correctly
	--     bailed) or before Blizzard's own restore sequence had finished
	--     repositioning the frame, so our reapply lost the race and got
	--     immediately overwritten. Deferring one frame lets Blizzard's
	--     restore settle first.
	WorldMapFrame:HookScript("OnShow", reapply)
	WorldMapFrame:HookScript("OnSizeChanged", deferredReapplyOnResize)

	MapFrame.ApplyScale()
	MapFrame.ApplyPosition()
	MapFrame.ApplyAlpha()
end
