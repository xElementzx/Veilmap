# Veilmap Phase 5: Close-Zoom Map Detail — Design

Status: approved in conversation 2026-10-16, pending written-spec review.
Branch: `feature/phase-5-close-zoom-detail`. Target release: **1.2.0**.
Parent spec: `2026-09-22-veilmap-design.md`. Inspired by OpenMap
(github.com/jiforever/wowforever-openmap, MIT); no OpenMap code is copied.

## 1. Purpose

Make the world map useful up close: zoom further into zone and city maps than Blizzard allows,
and blend in the game's own minimap terrain (roads, tree cover, buildings, rocks) as you zoom,
under the painted map style. At the default, fully zoomed-out view the map looks exactly as it
does today.

Success means a player can wheel-zoom a zone map to the configured depth, see real terrain
fade in and line up with the painted map, still see the fog tint on top, and never hit an
"action blocked" error, in or out of combat.

## 2. Findings this design rests on

- **Blizzard's zone zoom range.** `UiMapArtStyleLayer` for build 1.60.1.69913 gives zone and
  city art (1002×668) `MinScale 1`, `MaxScale 2.14`, `AdditionalZoomSteps 2`, which is 3 levels:
  1, 1.57, 2.14.
- **Sharpness.** A zone map's art is about 3.5 yards per texel; a minimap tile is 1600/3
  yards over 256 px, about 2.08 yards per texel. The minimap is about 1.7× sharper, and stops
  gaining sharpness at about 3.5–4× zoom.
- **Minimap tiles exist for Forever.** wago.tools lists `world/minimaps/azeroth/mapX_Y.blp`
  (1184 tiles) and `world/minimaps/kalimdor/mapX_Y.blp` (1105 tiles). They are on the same grid
  as the ADT tiles from phase 4: tile X runs along world Y (west) and tile Y along world X
  (north). Tile `(tx, ty)` covers world X from `32·T − ty·T` down to `32·T − (ty+1)·T`, and world Y
  from `32·T − tx·T` down to `32·T − (tx+1)·T`, with `T = 1600/3`.
- **World ↔ map conversion works on Forever.** In-game check 24 of phase 4 converted Goldshire's
  world position to (0.454, 0.648) on map 1429.
- **Blizzard map internals (forever branch of the UI source):**
  - `MapCanvasScrollControllerMixin:CreateZoomLevels()` builds `self.zoomLevels`, a list of
    `{ scale = layerScale * self.baseScale, layerIndex = n }`. It runs from
    `OnCanvasSizeChanged()`, which runs on `SetMapID` and whenever the canvas size changes,
    for example on maximize.
  - `GetScaleForMaxZoom()` returns the last level's scale, and the wheel steps through the list.
  - `canvas:GetViewRect()` returns the visible area as a normalized rectangle (left, right,
    top, bottom, from 0 to 1).
  - Data providers get `OnCanvasScaleChanged`, `OnCanvasPanChanged` and `OnCanvasSizeChanged`.
  - The world map's pin frame levels, bottom to top, include `PIN_FRAME_LEVEL_MAP_EXPLORATION`,
    `PIN_FRAME_LEVEL_PLUNDERSTORM_CIRCLE`, `PIN_FRAME_LEVEL_EVENT_OVERLAY`,
    `PIN_FRAME_LEVEL_GARRISON_PLOT`, `PIN_FRAME_LEVEL_FOG_OF_WAR`, then quest blobs and pins.
    On Forever, nothing uses event overlays or fog of war.

## 3. Features and scope

1. **Deeper zoom** on zone and city maps, up to a configurable maximum.
2. **Minimap detail layer** that fades in as you zoom past 1×, at a configurable strength.
3. **Settings:** a master toggle, a strength slider, and a deepest-zoom slider.

**Scope:** world map; zone and city maps only (`C_Map.GetMapInfo(mapID).mapType` is
`Enum.UIMapType.Zone` or `Enum.UIMapType.City`), and only when the map's world rectangle
resolves. Continents, the world map, dungeons and the battlefield map are unchanged.

**Non-goals:** a seamless stitched world map, minimap detail on continent maps, minimap
level-of-detail copies, cave or underground maps, recolouring or tinting the minimap, and
TomTom integration.

## 4. Data

### 4.1 `Detail/Data_Minimap_Forever.lua` (generated)

```lua
VeilmapMinimapTiles = {
	[0] = { [tileX * 64 + tileY] = fileDataID, ... },  -- Eastern Kingdoms (world/minimaps/azeroth)
	[1] = { ... },                                     -- Kalimdor (world/minimaps/kalimdor)
}
```

### 4.2 Generator: `tools/genminimap.mjs`

- For each continent, it makes one `https://wago.tools/api/files?search=world/minimaps/<folder>/map&build=<build>`
  request. Each wago search costs about 20 s regardless of size; phase 4 measured this.
- It keeps paths matching `^world/minimaps/<folder>/map(\d+)_(\d+)\.blp$` with `0 ≤ x, y < 64`.
- It emits the table with keys sorted. Re-running must produce byte-identical output.
- It refuses to write if either continent yields fewer than 1000 tiles. The real counts are
  1184 and 1105; fewer would mean a truncated listing.
- Pure parts live in `tools/lib/minimap.mjs` (`parseMinimapListing`, `emitMinimapLua`) and
  are unit-tested. The CLI reuses `arg`, `isValidBuild` and `writeAtomic` from
  `genfogdata.mjs`.

## 5. Architecture

| File | Responsibility | WoW API |
|---|---|---|
| `Detail/Tiles.lua` (new) | Pure maths: world rect → transform, visible tile range, cropped tile placement and texture coordinates, fade alpha, extended zoom scales | None; unit-tested |
| `Detail/Zoom.lua` (new) | Post-hook on `CreateZoomLevels` that appends deeper levels | Yes |
| `Detail/DetailPin.xml` (new) | `VeilmapDetailPinTemplate` | — |
| `Detail/Provider.lua` (new) | Data provider and pin: per-map placement, culling and fade on pan/zoom | Yes |
| `Detail/Data_Minimap_Forever.lua` (generated) | Tile file IDs | — |
| `Fog/Provider.lua` | Fog pin moves to `PIN_FRAME_LEVEL_FOG_OF_WAR` | Yes |
| `Config.lua`, `Options.lua` | Settings (section 8) | Yes |
| `Core.lua` | `/vm debug combatzoom` (section 6.3) | Yes |

TOC order: `Detail\Tiles.lua`, `Detail\Data_Minimap_Forever.lua`, `Detail\DetailPin.xml`,
`Detail\Zoom.lua`, `Detail\Provider.lua`, all after the `Fog\` files and before `MapFrame.lua`.
`Veilmap.OnReady` adds the detail provider to `WorldMapFrame` and installs the zoom hook.

### 5.1 `Detail/Tiles.lua` (pure)

All coordinates are normalized map coordinates (0–1) unless stated otherwise.

```lua
Tiles.Transform(left, top, right, bottom)
  --> transform (a table); left/top/right/bottom are the map's world-X/world-Y extents
Tiles.WorldToMap(transform, worldX, worldY)          --> u, v
Tiles.TileRect(transform, tileX, tileY)              --> u0, v0, u1, v1   (unclipped)
Tiles.TileRange(transform, viewL, viewT, viewR, viewB, margin)
  --> tx0, tx1, ty0, ty1 (inclusive tile index ranges intersecting the view, plus margin tiles)
Tiles.Clip(u0, v0, u1, v1)
  --> nil if fully outside 0-1; else cu0, cv0, cu1, cv1, s0, t0, s1, t1
      (the 0-1-clipped rect and the matching texture coordinates)
Tiles.Fade(relativeZoom)                             --> 0..1 (smoothstep from 1.0 to 2.0)
Tiles.ZoomScales(blizzardMaxRelative, maxRelative)
  --> list of extra relative scales: x1.4 steps, last one exactly maxRelative;
      empty when maxRelative <= blizzardMaxRelative + 0.01
```

**The world rectangle** comes from `C_Map.GetWorldPosFromMapPos(mapID, CreateVector2D(0, 0))`
and `(1, 1)`. Each returns `continentID, worldPos`. The map's top-left corner is
(worldX = north, worldY = west). `u` increases as world Y decreases, and `v` increases as world
X decreases. The two calls must return the same continent, and that continent must be 0 or 1;
otherwise the map gets no detail.

**Test fixture:** Elwynn Forest (uiMap 1429) from `UiMapAssignment`: world X from
−10254.17 (south) to −7939.58 (north), world Y from −1935.42 (east) to 1535.42 (west). With
it, Goldshire's chunk centre (−9440, −40) maps to (0.4539, 0.6482), which matches in-game
check 24 of phase 4 (0.45390, 0.64824) to 4 decimal places.

## 6. Deeper zoom (`Detail/Zoom.lua`)

### 6.1 The hook

`hooksecurefunc(WorldMapFrame.ScrollContainer, "CreateZoomLevels", OnCreateZoomLevels)`.
This hooks the **scroll container**, never a `WorldMapFrame` method (see `MapFrame.lua` for
why). `OnCreateZoomLevels(self)` appends levels only if **all** of these hold:

- `Veilmap.db.detailEnabled` is true;
- the map (`self.mapID`) is a zone or city;
- `self.zoomLevels` has entries and they all use `layerIndex == 1`;
- `Veilmap.db.detailMaxZoom` is above Blizzard's last relative scale
  (`zoomLevels[#zoomLevels].scale / zoomLevels[1].scale`);
- `not InCombatLockdown()`, or the combat debug flag (6.3) is on.

Appended levels are `{ scale = rel * zoomLevels[1].scale, layerIndex = 1 }` for each `rel` in
`Tiles.ZoomScales(lastRel, detailMaxZoom)`. Nothing else is modified.

### 6.2 When it applies

Levels are rebuilt whenever Blizzard calls `CreateZoomLevels`: on map change and on canvas
size changes. A changed setting therefore takes effect on the next map open, map change, or
maximize/restore. Veilmap never calls `CreateZoomLevels` itself.

### 6.3 Combat

By default nothing is appended during combat, because writing into Blizzard's zoom list mid
map-change could taint that code path. A map that was already showing keeps its extra levels
in combat; only a map change during combat falls back to Blizzard's 2.14× for that map.

`/vm debug combatzoom` toggles a session-only flag (not saved) that lifts the combat skip, for
the in-game taint test (section 10). If that test passes cleanly, the combat skip and the
command are removed before release. If it fails, both stay as they are, the command is
removed, and the CurseForge Known issues list says so.

## 7. Detail layer (`Detail/Provider.lua`)

### 7.1 Layering

From bottom to top: Blizzard's base art and explored overlays (`MAP_EXPLORATION`), then the
detail pin (`PIN_FRAME_LEVEL_EVENT_OVERLAY`), then the fog pin (`PIN_FRAME_LEVEL_FOG_OF_WAR`,
moved from `MAP_EXPLORATION`), then quest blobs and every other pin. Both pins call
`UseFrameLevelType` only if the canvas's pin-frame-levels manager knows the type. Otherwise
the fog stays on `MAP_EXPLORATION` and the detail layer is disabled for that canvas, with one
chat message.

### 7.2 Per-map refresh (`RefreshAllData`)

This follows the fog provider's pattern:
- It defers in combat (`refreshPending` plus `PLAYER_REGEN_ENABLED`).
- It removes old data first.
- Only API calls go in `pcall`, reported once per message.

1. If the setting is off, or the map isn't a zone or city, it stops.
2. It resolves the world rectangle and continent (5.1), stopping if they don't resolve.
3. It looks up `VeilmapMinimapTiles[continent]`, stopping if absent.
4. It acquires the pin, which spans the canvas like the fog pin, and stores the transform.
5. It runs the view update (7.3).

### 7.3 View update (`OnCanvasScaleChanged`, `OnCanvasPanChanged`, `OnCanvasSizeChanged`, and after refresh)

1. `alpha = detailStrength * Tiles.Fade(canvasScale / zoomLevels[1].scale)`.
2. If `alpha < 0.01`, it hides every tile and stops.
3. `view = canvas:GetViewRect()`, then
   `tx0, tx1, ty0, ty1 = Tiles.TileRange(transform, view..., 1)`.
4. If the range covers more than **150** tiles, it hides every tile and stops (safety cap).
5. For each tile in range that has a file ID and a non-nil `Tiles.Clip(...)`:
   - acquire a texture from the pin's pool (or reuse the one already showing that tile);
   - set its size and position in canvas pixels (`cu·canvasW`, `cv·canvasH`);
   - set its texture coordinates;
   - `SetTexture(fileID)` only the first time that texture shows that tile;
   - call `AddMaskableTexture` once per acquired texture, and `SetAlpha(alpha)`.

   Tiles that left the range are released back to the pool.
6. Everything here is texture work on Veilmap's own pin, with no protected calls, so it is
   safe in combat. If there is no pin (a refresh deferred by combat), the update does nothing.

Pan and zoom never move textures: positions are in canvas pixels and the canvas scales and
scrolls them. Updates only change which tiles are shown and the alpha.

## 8. Settings

The options panel gets a new "Map Detail" section.

| Key | Default | Control | Applies |
|---|---|---|---|
| `detailEnabled` | `true` | Checkbox "Close-zoom detail" (extra zoom and minimap layer) | Layer: immediately. Zoom: next map change |
| `detailStrength` | `0.6` | Slider 0–100% | Immediately (view update) |
| `detailMaxZoom` | `4` | Slider 2×–8×, step 0.5 (2× or less = Blizzard's normal 2.14× limit) | Next map change |

The sliders' tooltips say when a change applies. These settings are subject to the known
Forever saved-variables bug.

## 9. Error handling

The parent design's rule applies: guard canvas and API calls and report each message once;
never guard Veilmap's own logic.
- If `GetWorldPosFromMapPos` returns nil or a mismatched continent, the map gets no detail,
  silently. Instances and odd maps are normal cases.
- If `CreateZoomLevels` runs with an unexpected shape (empty, multi-layer), the hook returns
  without changes.
- If the pin-level type is missing, see 7.1.

## 10. Testing

**Unit tests** (`node --test`, wasmoon):
- `tools/tests/minimap.test.mjs`: listing parse (root `mapX_Y.blp` only, out-of-range
  rejected), key packing, emit format, determinism, and the tile-count guard.
- `tools/tests/tiles.test.mjs`:
  - Transform round trip, and the Goldshire cross-check against the Elwynn fixture (5.1).
  - `TileRect` orientation (u grows west to east, v grows north to south).
  - `TileRange` at the centre, at map edges, and with margin.
  - `Clip` when fully inside, fully outside, and crossing each edge, with texture coordinates.
  - `Fade` at 1.0, 1.5 and 2.0, and clamped outside that range.
  - `ZoomScales`: ends exactly at the maximum, ×1.4 spacing, empty when max ≤ Blizzard's, and
    the 4× and 8× sequences.
- The existing syntax tests cover the new Lua files.

**In-game checklist** (`docs/ingame-checks-phase-5.md`):
1. Elwynn at 1×: identical to before (no visible detail).
2. Wheel-zoom reaches the slider value (4×), stepping 2.14 → 3.0 → 4.0.
3. Detail fades in between 1× and 2× and lines up with the painted roads, rivers and lakes
   (Goldshire, Crystal Lake).
4. The fog tint covers the detail over unexplored areas, and pins and quest blobs are above it.
5. No detail spills past the map's edges at any zoom.
6. Barrens and Stranglethorn: smooth panning at 2–4×.
7. Continent, world and dungeon maps: no extra zoom, no detail.
8. Strength slider: changes immediately; 0% shows no detail.
9. Deepest-zoom slider at 8×: applies after a map change; at 2.1×, Blizzard's normal zoom.
10. Toggle off: detail disappears at once, and zoom is back to normal after a map change.
11. Maximize and restore while zoomed: zoom levels and detail stay correct.
12. **Combat taint (default):** wheel-zoom in combat; change zones with the map open in combat;
    open the map in combat; maximize in combat; click quest and flight pins while deep-zoomed.
    No "action blocked" and no Lua errors.
13. **Combat taint (debug):** `/vm debug combatzoom`, then repeat 12 several times, including
    zone changes in combat. The result decides 6.3.

## 11. Release

- Version `1.2.0` in `Veilmap.toc`.
- The CurseForge description gets a "Close-zoom detail" feature section.
- `Detail/` ships with the addon, so neither `.pkgmeta` nor `.gitattributes` changes.
- Merge to `main` and tag `v1.2.0` only after the in-game checklist passes. CurseForge's
  webhook and the GitHub workflow then release it.
