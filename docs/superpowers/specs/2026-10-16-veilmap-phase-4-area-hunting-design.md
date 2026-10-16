# Veilmap Phase 4: Unexplored-Area Hunting — Design

Status: approved in conversation 2026-10-16, pending written-spec review.
Branch: `feature/phase-4-area-hunting`. Target release: **1.1.0**.
Parent spec: `2026-09-22-veilmap-design.md` (section 6, phase 4).

## 1. Purpose

The primary use is **exploration hunting**: "what is left to discover in this zone, and how do
I get there?" (Explorer achievements, completionists). The secondary use is **orientation**:
"what is that fogged patch called?"

Success means a player can open the map on a partly explored zone, see every unexplored area
by name, pick one, get a tracked waypoint to it, and have that waypoint clean itself up when
the area is discovered, all without disturbing Blizzard's normal map interaction.

## 2. Features

1. **Hover tooltip.** Hovering an unexplored fog patch shows the name of every area it covers.
2. **Alt-click waypoint.** Alt + left-click on a patch sets a tracked user waypoint at the
   centre of that patch. Alt is used because Ctrl-click is Blizzard's own map pin.
3. **Unexplored-areas list.** A collapsible panel docked to the world map lists the zone's
   unexplored areas. Clicking a row sets a waypoint; hovering a row highlights its patches.
4. **Clear on discovery.** When the targeted patch is discovered, the waypoint Veilmap set is
   cleared, with a chat message. It does **not** advance to the next area automatically: the
   nearest area in a straight line may not be reachable from where the player stands.

**Scope:** world map only. The battlefield map gets neither hover nor list.

**Non-goals:** pathing or route planning, multi-zone lists, auto-advancing waypoints,
TomTom integration, pixel-accurate hover (texture alpha cannot be read by addons).

## 3. Data

### 3.1 Entry format

`Fog/Data_Forever.lua` entries change from

```lua
{width, height, offsetX, offsetY, areaID, "fileDataIDs"}
```

to

```lua
{width, height, offsetX, offsetY, {areaIDs}, "fileDataIDs", {hitLeft, hitTop, hitRight, hitBottom}}
```

- **Field 5** becomes a list of every non-zero `AreaID_0..3`, in that column order. Every row
  has a non-zero `AreaID_0` (parent spec 2.3), so the list is never empty; 68 rows have more
  than one entry. No current code reads field 5, so fog drawing is unaffected.
- **Field 7** is the overlay's hit rect from `HitRectLeft/Top/Right/Bottom`, in the same
  map-art pixel space as `offsetX/offsetY`. If all four values are 0, the generator writes the
  overlay's own bounds (`offsetX, offsetY, offsetX + width, offsetY + height`) instead, so Lua
  never needs a fallback.
- The header comment in the generated file documents the new format.
- `Data_Forever.lua` is regenerated from the same build (1.60.1.69913) so only the format
  changes, not the coverage.

### 3.2 Generator changes

- `tools/lib/dataset.mjs`: collect `areaIDs` and `hitRect` as described above.
- `tools/lib/emit.mjs`: emit both, with `assertFinite` on every number, as for existing fields.
- `tools/lib/verify.mjs`: unchanged.

## 4. Architecture

### 4.1 New and changed files

| File | Responsibility | WoW API |
|---|---|---|
| `Fog/Areas.lua` (new) | Pure logic: hit-testing, grouping entries into areas, patch centres, list sorting | None; unit-tested |
| `Fog/Hover.lua` (new) | Cursor polling, tooltip, Alt-click hook | Yes |
| `Fog/Waypoint.lua` (new) | Set, track and clear-on-discovery for Veilmap's waypoint | Yes |
| `Fog/AreaList.lua` (new) | The collapsible side panel | Yes |
| `Fog/Provider.lua` | Keeps the latest unexplored set for the world map; per-entry texture tracking on the pin; highlight; refresh callback | Yes |
| `Coords.lua` | Exposes `cursorFraction` as `Veilmap.Coords.CursorFraction` | Yes |
| `Config.lua`, `Options.lua` | New settings (section 7) | Yes |
| `Veilmap.toc` | Load order: `Areas` after `Geometry`; `Waypoint`, `Hover`, `AreaList` after `Provider` | — |

### 4.2 Shared state

The world-map provider already computes the unexplored entries on every refresh. After each
refresh it stores, on itself:

```lua
self.current = { mapID = ..., layerWidth = ..., layerHeight = ..., unexplored = { ... } }
```

(`nil` when the map has no fog data or the fog is switched off) and exposes it as
`Veilmap.FogProvider:GetUnexplored()`. After storing it, it calls `Veilmap.OnFogRefreshed()`,
which `AreaList` uses to rebuild. Hover, Alt-click and the list all read this one object; nothing
recomputes the explored set.

**Layer size** is `layerInfo.layerWidth` and `layerInfo.layerHeight` from
`C_Map.GetMapArtLayers`, the pixel size of the art that the offsets and hit rects are measured
against. Map-art pixels are converted to 0–1 map coordinates by dividing by these.

During combat, `RefreshAllData` defers (existing behaviour), so `current` keeps the previous
refresh's data. Hover, tooltips and the list keep working against it. This matches the fog
itself, which also catches up after combat.

### 4.3 `Fog/Areas.lua` (pure)

```lua
Areas.HitTest(entries, px, py)         --> entry or nil
Areas.Group(entries)                   --> { {areaID=, entries={...}, largest=entry}, ... }
Areas.Centre(entry, layerW, layerH)    --> x, y   (0-1 map coords, hit-rect centre)
Areas.Sort(groups, names, player, layerW, layerH)  --> groups, sorted in place
```

- **HitTest:** a point is inside a hit rect when `left <= px <= right` and `top <= py <= bottom`
  (inclusive). If several rects contain the point, the one with the **smallest area** wins; a
  tie goes to the earlier entry. Returns `nil` if none match.
- **Group:** one group per area ID. An entry with several area IDs belongs to several groups.
  `largest` is the group entry with the biggest hit-rect area (tie: earlier entry). It is the
  waypoint target for list clicks; a centroid of several patches can land somewhere
  meaningless, so it is not used.
- **Centre:** the hit-rect centre divided by the layer size.
- **Sort:** if `player` (`{x, y}` in 0–1 map coords) is given, sort by ascending distance from
  the player to each group's `largest` centre. Distance is measured in layer pixels
  (`dx * layerW`, `dy * layerH`), so the map's aspect ratio does not skew it. Otherwise sort
  alphabetically by `names[areaID]`. Ties in either mode break on area ID, so the order is
  stable.

Names are resolved outside this module (`C_Map.GetAreaInfo`) and passed in, keeping it free of
WoW API calls. An area ID with no name sorts last and displays as `Area <id>`.

## 5. Interaction

### 5.1 Hover (`Hover.lua`)

- A frame parented to `WorldMapFrame` runs an `OnUpdate` throttled to 0.05s (the same rate as
  coordinates). It only runs while the map is shown and the `areaTooltips` setting is on.
- Each tick:
  1. If the mouse focus is not the map canvas itself (`WorldMapFrame.ScrollContainer` or its
     child), hide our tooltip and stop. **Blizzard's pins (quest POIs, flight masters, …) and
     other addons' tooltips always win.**
  2. Get the cursor fraction from `Veilmap.Coords.CursorFraction()`, multiply by the layer
     size, and call `Areas.HitTest(current.unexplored, px, py)`.
  3. Rebuild the tooltip only when the hovered entry changes; hide it when there is none.
- **Tooltip** (`GameTooltip`, owner `WorldMapFrame`, `ANCHOR_CURSOR`):

  ```
  <Area name>                  one line per area the patch covers (white)
  Unexplored                   grey
  Alt-click: set waypoint      green; this replaces your current map pin
  ```

  Veilmap only hides `GameTooltip` if Veilmap currently owns it (a flag set when we show it).

### 5.2 Alt-click

- `WorldMapFrame.ScrollContainer:HookScript("OnMouseUp", ...)`. With `IsAltKeyDown()`, the
  left button, `areaTooltips` on, and a hovered entry, it calls `Waypoint.Set(entry)`.
- A hook, not a replacement: Blizzard's own click handling runs unchanged.

### 5.3 Waypoint (`Waypoint.lua`)

- **Set(entry):**
  1. Work out the target with `Areas.Centre(entry, layerW, layerH)` on `current.mapID`.
  2. If `C_Map.CanSetUserWaypointOnMap(mapID)` is false, print
     `Veilmap: waypoints aren't available on this map.` and stop.
  3. `C_Map.SetUserWaypoint(UiMapPoint.CreateFromCoordinates(mapID, x, y))` and then
     `C_SuperTrack.SetSuperTrackedUserWaypoint(true)`.
  4. Remember `{ mapID, x, y, key = Geometry.OverlayKey(...), names }` as ours.
  5. Print `Veilmap: waypoint set to <names>.`

  The game allows only one user waypoint, so this replaces any pin the player placed; the
  tooltip hint says so.
- **Clear on discovery:** on `MAP_EXPLORATION_UPDATED`, if we hold a waypoint:
  1. If `C_Map.GetUserWaypoint()` no longer matches ours (different map, or coordinates more
     than 0.0001 apart), the player has replaced or removed it. Forget ours and do nothing else.
  2. Otherwise, if our key is now in
     `Geometry.BuildExploredKeySet(C_MapExplorationInfo.GetExploredMapTextures(mapID))`, call
     `C_Map.ClearUserWaypoint()`, forget ours, and print
     `Veilmap: discovered <names>, waypoint cleared.`
- **Combat:** if the in-game check (section 9) shows `SetUserWaypoint` is unusable in combat,
  `Set` refuses during `InCombatLockdown()` with `Veilmap: can't set a waypoint in combat.`

## 6. List panel (`AreaList.lua`)

- **Placement:** docked to `WorldMapFrame`'s **right outer edge**, top-aligned, so it moves and
  scales with the map. When collapsed, only a small toggle tab is visible; the tab toggles the
  panel. If the in-game check finds Blizzard docking something on the right (e.g. a quest log
  side panel), the panel moves to the left edge. The edge is one constant.
- **Content:**
  - Header: `Unexplored — N areas` (`Unexplored — 1 area` in the singular).
  - One row per group from `Areas.Group`, sorted by `Areas.Sort`. The player position is
    passed only when `C_Map.GetPlayerMapPosition(current.mapID, "player")` returns one.
  - Up to 27 groups exist in a single zone today. The panel scrolls when its rows are taller
    than the map.
  - A fully explored zone shows `All explored`.
  - On maps with no fog data (`current == nil`: continents, dungeons, fog off), the panel and
    tab are **hidden entirely**.
- **Row click:** `Waypoint.Set(group.largest)`.
- **Row hover:** highlights every entry in the group on the map by brightening its fog tint
  (`FogPin:Highlight(entries)` and `FogPin:ClearHighlight()`). This needs the pin to keep an
  `entry → textures` map, filled in `Draw`. The highlight colour is the fog colour lifted
  toward white, at full alpha.
- **Rebuild:** on `Veilmap.OnFogRefreshed` (map opened, map changed, exploration updated,
  settings changed). It does not re-sort continuously as the player moves.

## 7. Settings

Added to `Config.defaults` and to the options panel's Fog section:

| Key | Default | Label |
|---|---|---|
| `areaTooltips` | `true` | Area tooltips and Alt-click waypoints |
| `areaListEnabled` | `true` | Unexplored areas list |
| `areaListCollapsed` | `false` | (not in the panel; remembered from the tab) |

These are subject to the known Forever saved-variables bug (CurseForge "Known issues").

## 8. Error handling

The parent design's rule applies: canvas and API calls whose surface we cannot fully vouch for
are guarded and reported once; Veilmap's own logic (`Areas`, `Geometry`, dataset reads) is
never wrapped and fails loudly.

- `GetUnexplored()` returning `nil` is the normal "nothing here" case. Hover shows nothing,
  and the list is hidden.
- `C_Map.GetAreaInfo` returning `nil` gives the name `Area <id>`.
- A waypoint API error is caught and reported once, using the same pattern as
  `ReportDrawError`.

## 9. Testing

**Unit tests** (`node --test`, wasmoon):

- `tools/tests/areas.test.mjs`:
  - HitTest: inside, outside, on each edge, overlapping rects (smallest wins, tie → earlier),
    and an empty list.
  - Group: single-area entries, multi-area entries landing in several groups, and `largest`
    selection.
  - Centre: normalization.
  - Sort: distance order with aspect correction (a case where unscaled 0–1 distance would
    give the wrong order), alphabetical fallback, unnamed areas last, ID tie-break.
- `dataset.test.mjs` and `emit.test.mjs`: area-ID lists (including multi-area), zero hit rect
  → bounds fallback, the new emitted format. The existing fixture row with a zero hit rect
  (ID 5999) covers the fallback.
- `syntax.test.mjs` picks up the new Lua files automatically (Lua 5.1 and 5.4 layers).
- luacheck clean, with new globals added to `.luacheckrc` as needed.

**In-game checklist** (`docs/ingame-checks-phase-4.md`; replaces the stale Foglight-era
`ingame-checks.txt`, which is deleted):

1. Alt + left-click on a zone map: does Blizzard do anything natively?
2. `C_Map.SetUserWaypoint` and super-tracking: do they work in combat?
3. Is the world map's right outer edge free (quest log, side panels)?
4. Hovering a quest POI over a fog patch shows Blizzard's tooltip, not ours.
5. Hit rects line up with the visible fog patches in two or three zones.
6. Discovering a targeted area clears the waypoint and prints the message. A waypoint
   replaced by hand is left alone.
7. A multi-area overlay lists every name.
8. The list sorts by distance in the player's zone and alphabetically elsewhere.
9. Row hover highlights the right patches.

## 10. Release

- Version `1.1.0` in `Veilmap.toc`.
- Update the CurseForge description: a features section for hover, Alt-click and the list.
- Merge `feature/phase-4-area-hunting` into `main` and tag `v1.1.0` only after the in-game
  checklist passes.

## 11. Roadmap note

Phase 5 is now the **close-zoom map detail** toggle (the game's minimap tiles blended in at
deep zoom, inspired by OpenMap). Retail moves to phase 6. Each gets its own spec and plan.
