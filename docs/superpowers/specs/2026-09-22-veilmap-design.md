# Veilmap — Design

**Date:** 2026-09-22
**Status:** Approved, pending implementation plan
**Target:** WoW Forever (`wow_classic_beta`, 1.60.1.69913, interface `16001`), Retail later

## 1. Context

Veilmap is a World Map addon for WoW Forever, providing tinted fog-of-war reveal,
map scaling, map transparency, and coordinate display.

The work began as a port of [Mapster](https://github.com/Nevcairiel/Mapster) to Forever.
That was abandoned in favour of a fresh implementation for licensing reasons: Mapster
ships **no LICENSE file**, every source header reads `Copyright (c) … All rights reserved.`,
and its TOC declares `## X-License: All rights reserved.` A private local fork is fine;
redistributing a derivative is not.

Consequences that bind this design:

- Veilmap is written from scratch. Features are not copyrightable; implementations are.
- Where behaviour must mirror Blizzard's (notably overlay tiling), it is derived from
  Blizzard's own shipped UI code, not from any addon's adaptation of it.
- Veilmap ships under **GPL-3.0**, so it can never become the dead end Mapster is.

## 2. Findings

Established empirically this session via a throwaway probe addon
(`MapsterProbe`, installed into the Forever client) and direct inspection of
[wago.tools](https://wago.tools) DB2 exports. These are evidence, not assumptions.

### 2.1 Client

| Fact | Value |
|---|---|
| Build | `1.60.1.69913`, dated Sep 17 2026 |
| Interface / tocversion | **`16001`** (five digits — *not* `160001`) |
| `WOW_PROJECT_ID` | `1`, identical to `WOW_PROJECT_MAINLINE` |
| `WOW_PROJECT_CLASSIC` | `2` |

**Forever identifies itself as Mainline.** `WOW_PROJECT_ID` cannot distinguish Forever
from Retail. This invalidates the conventional addon flavor check and is the single most
important constraint on the compatibility layer.

### 2.2 Map system

Forever uses the modern canvas map. Confirmed present:

- `WorldMapFrame.ScrollContainer` / `.Child`, `.BorderFrame.TitleContainer`, `.BorderFrame.NineSlice`
- `EnumeratePinsByTemplate`, `pinPools`, `dataProviders` (36), `MapCanvasMixin`, `MapExplorationPinMixin`
- `C_Map.GetMapArtID` / `GetMapArtLayers` / `GetPlayerMapPosition`, `C_MapExplorationInfo.GetExploredMapTextures`
- `PlayerMovementFrameFader.RemoveFrame`, `DeltaLerp`, `IsPlayerMoving`, `mapFade` CVar, `MAP_FADE_TEXT`
- `Settings`, `Settings.OpenToCategory`

Confirmed absent: `EncounterJournalPinMixin`, `HelpPlate_Show/Hide`,
`InterfaceOptionsFrame_OpenToCategory`, and all legacy map frames
(`WorldMapDetailFrame`, `WorldMapZoomOutButton`, `WorldMapButton`).

Pin pools on the live map: `FogOfWarPinTemplate`, `GroupMembersPinTemplate`,
`MapExplorationPinTemplate`, `MapHighlightPinTemplate`, `QuestBlobPinTemplate`,
`QuestPinTemplate`, `ScenarioBlobPinTemplate`.

**`FogOfWarPinTemplate` is inert.** Blizzard's second, coarser fog mechanism is driven by
the `UiMapFogOfWar` DB2, which **does not exist in build 1.60.1.69913** — wago returns
`404 Table not found`, while the same build serves `WorldMapOverlay` normally and retail
latest serves `UiMapFogOfWar` with 11 rows. The shared canvas code registers the pin type
unconditionally, but Forever ships no data to drive it. The exploration overlay system is
therefore the only fog on Forever, and it is the system Veilmap targets.

### 2.4 Settings and stretch-goal APIs

Confirmed present, making a zero-dependency options panel viable without a hand-built
canvas: `Settings.RegisterAddOnCategory`, `RegisterVerticalLayoutCategory`,
`RegisterCanvasLayoutCategory`, `RegisterProxySetting`, `CreateCheckbox`, `CreateSlider`,
`CreateSliderOptions`, `SettingsPanel`, and `ColorPickerFrame.SetupColorPickerAndShow`.

Absent, both with direct modern replacements: `Settings.CreateSetting` (use
`RegisterProxySetting`) and `OpacitySliderFrame` (the modern colour picker has a built-in
opacity slider). Also absent: `InterfaceOptions_AddCategory` and
`InterfaceOptionsFrame_OpenToCategory`, the pre-Dragonflight options API.

Stretch-goal APIs are all present: `C_Map.GetAreaInfo`, `C_Map.SetUserWaypoint`,
`C_Map.CanSetUserWaypointOnMap`, `C_Map.GetUserWaypoint`, `C_Map.ClearUserWaypoint`,
`UiMapPoint.CreateFromCoordinates`, and `C_SuperTrack.SetSuperTrackedUserWaypoint`.
Phase 4 can therefore offer a real tracked waypoint, not merely a tooltip.

Misc plumbing confirmed: `hooksecurefunc`, `issecurevariable`, `C_Timer.After`, `Mixin`,
`CreateFromMixins`, `CreateFramePool`, `CreateTexturePool`, `CreateObjectPool`,
`C_XMLUtil.GetTemplateInfo`.

`MapExplorationPinTemplate` exposes `RefreshOverlays`, `overlayTexturePool`,
`textureLoadGroup`, and `dataProvider:GetDrawLayer()` → `ARTWORK, 0`.

`UIPanelWindows["WorldMapFrame"]` is populated, so the map participates in the UI panel
system and must be extracted from it to move freely.

### 2.3 Fog data

Source: `WorldMapOverlay` joined to `WorldMapOverlayTile` on `WorldMapOverlayID → ID`,
both fetched per-build from wago.tools. The `?build=` parameter is honoured
(1081 Forever overlay rows vs 2920 on retail latest).

`WorldMapOverlay` schema:
`ID, UiMapArtID, TextureWidth, TextureHeight, OffsetX, OffsetY, HitRectTop, HitRectBottom, HitRectLeft, HitRectRight, PlayerConditionID, Flags, AreaID_0..3`

**Round-trip verified.** For art ID 2153 (Elwynn Forest, live), DB2 row 5157 reads
`w=256 h=256 x=422 y=332` and row 5161 reads `w=256 h=256 x=250 y=270` — matching
exactly what the live client returned from `GetExploredMapTextures`. The join key
`(width, height, offsetX, offsetY)` is therefore sound.

Shape of the Forever dataset:

| Property | Value | Consequence |
|---|---|---|
| Overlay rows | 1081, across 84 art IDs | ~50KB generated Lua |
| Tile rows | 1739 | max 6 tiles per overlay |
| `LayerIndex` | `0` on every row | no multi-layer handling |
| `PlayerConditionID` | `0` on every row | no conditional overlays to gate |
| `AreaID_0` | non-zero on every row | stretch goal has no data gaps |
| `AreaID_1` | non-zero on 68 rows | multi-area overlays exist but are rare |
| `Flags` | `0` (519), `4` (562) | meaning unknown; not currently used |
| Overlays with no tiles | 8 | generator drops them; 1073 emitted |

## 3. Goals

1. Reveal fog of war as a **tinted overlay in a user-selected colour**, not full removal.
2. Scale the world map.
3. Set map transparency, so the map stays usable while moving.
4. Display player and cursor coordinates on the map.

**Stretch:** identify unexplored regions by area name and show where to go to reveal them.

**Non-goals:** quest/POI icon scaling, Encounter Journal integration, battlefield minimap,
group icons, or any feature not listed above. Retail support is phase 5, not phase 1.

## 4. Architecture

Zero third-party dependencies. Blizzard APIs and mixins only.

```
Veilmap.toc              ## Interface: 16001
Core.lua                  addon table, SavedVariables, bootstrap, slash commands
Compat.lua                flavor detection + per-flavor constants
MapFrame.lua              scale, alpha, drag, position persistence
Coords.lua                player + cursor readout
Fog/Provider.lua          tinted-unexplored data provider
Fog/Data_Forever.lua      generated; do not edit
Options.lua               Settings API panel
tools/genfogdata.mjs      CSV -> Lua generator
tools/genfogdata.test.mjs generator tests
```

### 4.1 Flavor detection

`select(4, GetBuildInfo())`, **not** `WOW_PROJECT_ID` (see 2.1). Forever occupies the
`16000`–`16999` band; Retail is `120001`+. `Compat.lua` resolves this once into a table of
constants. No other file branches on flavor.

### 4.2 Fog rendering

Veilmap registers **its own data provider** via `WorldMapFrame:AddDataProvider`, built on
`MapCanvasDataProviderMixin`. It draws unexplored overlays on its own pin, beneath
Blizzard's explored art. It does not hook, wrap, or replace `MapExplorationPinMixin:RefreshOverlays`.

Rejected alternatives:

- *Post-hooking `RefreshOverlays`* — the conventional approach, but injects into Blizzard's
  per-pin logic and shares its texture pool, which is a known taint surface.
- *Replacing `RefreshOverlays`* — maximum control, maximum breakage on every client patch.

The chosen approach is clean-room by construction, isolates Veilmap from Blizzard UI
changes, and gives our pin ownership of its own hit rects — which is precisely what the
stretch goal requires. The cost is handling masking (`AddMaskableTexture`) and
explored-state refresh ourselves; both APIs are confirmed present.

Per map change:

1. `C_Map.GetMapArtID(mapID)` selects the dataset.
2. Build an explored set from `C_MapExplorationInfo.GetExploredMapTextures(mapID)`,
   keyed `"w:h:x:y"`.
3. Draw every dataset entry *absent* from that set, tinted with the configured colour.

Final-row and final-column tiles are partial and padded to the next power of two, so
texcoords are scaled accordingly. This follows from how Blizzard stores the BLP files and
is derived from Blizzard's own `MapExplorationPinMixin`.

### 4.3 Data format

```lua
VeilmapFogData = {
  -- [UiMapArtID] = { {width, height, offsetX, offsetY, areaID, "fileDataIDs,..."}, ... }
  [2153] = {
    {256,249,577,419, 62,"272826"},
    {256,256,422,332, 18,"272806"},
  },
}
```

Flat, no bit-packing. `areaID` is carried from the first generation so the stretch goal
never requires re-extraction.

### 4.4 Generator

```
node tools/genfogdata.mjs --build 1.60.1.69913 --out Fog/Data_Forever.lua
```

Fetches both CSVs, joins them, orders tiles by explicit `RowIndex, ColIndex` (not assumed
ordering), drops tile-less overlays, and stamps the source build into the file header.
Committed to the repo. Forever is a live beta whose map art will change; regenerating must
be one command. Retail support is the same command with a different `--build`.

### 4.5 Modules

| File | Responsibility |
|---|---|
| `Core.lua` | Addon table, SavedVariables load/migrate, event bootstrap, `/veilmap` |
| `Compat.lua` | Flavor constants. The only file that knows which client it is |
| `MapFrame.lua` | Scale; drag-to-move; position and scale persistence. Two distinct transparency settings: a **base alpha** applied whenever the map is open, and an optional **faded alpha** applied while the player is moving. The latter reuses the native `mapFade` CVar and `PlayerMovementFrameFader` rather than reimplementing fade |
| `Coords.lua` | Player coords via `C_Map.GetPlayerMapPosition`; cursor coords from `ScrollContainer.Child` geometry. Throttled; configurable precision |
| `Options.lua` | `Settings` panel: sliders, toggles, colour swatch opening `ColorPickerFrame` |
| `Fog/Provider.lua` | Section 4.2 |

## 5. Verification

There is no in-client test harness, so effort goes where it pays:

- **Generator tests** (`tools/genfogdata.test.mjs`). A pure data transformation with
  existing ground truth: the art-2153 rows cross-checked against the live client become a
  fixture. A wago schema change or a bad join fails a test instead of silently blanking
  the map.
- **`/veilmap verify`**. Walks the current map, compares the dataset against
  `GetExploredMapTextures`, and reports art ID, overlay counts, and unresolved entries.
  Turns "fog looks wrong in Duskwood" into a number, and validates coverage across all
  84 maps without visiting each blind.
- **Luacheck** config with WoW globals declared.

**Iteration:** a directory junction from
`_classic_beta_\Interface\AddOns\Veilmap` to the repo, so editing is `/reload`.

## 6. Phasing

| Phase | Contents |
|---|---|
| 0 | Repo, LICENSE (GPL-3.0), TOC, `Core`/`Compat`, SavedVariables, slash command. Includes the one-line in-game confirmation that `FogOfWarPinTemplate` has no active pins |
| 1 | Generator + tests, `Data_Forever.lua`, fog provider. Colour set by slash command initially |
| 2 | Options panel, scale, alpha, drag-to-move, position persistence |
| 3 | Coords |
| 4 | *Stretch:* hover unexplored patch → area name; optional waypoint at centroid |
| 5 | *Later:* Retail via the `Compat` seam |

Phase 1 delivers the primary feature before the configuration UI exists, deliberately.

**The implementation plan covers phases 0–3**, which together satisfy every goal in
section 3. Phases 4 and 5 are separate efforts and get their own spec and plan when
their time comes.

## 7. Open questions

1. ~~**`FogOfWarPinTemplate`.**~~ **Resolved** (see 2.3): the `UiMapFogOfWar` DB2 does not
   exist in this build, so the pin is inert and the exploration overlay system is the only
   fog on Forever. Phase 0 retains a one-line in-game confirmation
   (`GetNumActive()` per pin pool should report `0`), but this no longer gates the design.
2. ~~**`Settings` API surface.**~~ **Resolved** (see 2.4): the widget set is sufficient.
   No hand-built canvas panel is needed.
3. **UI panel extraction.** `UIPanelWindows["WorldMapFrame"]` is populated, and removing
   the map from the panel system is the tainty-est part of this addon. Try the clean route
   first (`UIPanelLayout-enabled` attribute plus `SetMovable`); escalate only if it misbehaves.
4. **`Flags` semantics.** Values `0` and `4` appear in `WorldMapOverlay`. Meaning unknown.
   Not used; revisit only if rendering anomalies appear.

## 8. Decisions

| Decision | Rationale |
|---|---|
| Fresh addon, not a Mapster fork | Mapster is all-rights-reserved with no LICENSE |
| GPL-3.0 | Guarantees Veilmap stays forkable |
| Zero dependencies | Small, focused feature set; nothing to version-bump |
| Forever first, Retail later | Working addon soonest; compat seam avoids a rewrite |
| Own data provider (not hooking) | Clean-room, taint-isolated, extensible to the stretch goal |
| Build-number flavor detection | `WOW_PROJECT_ID` is `1` on both Forever and Retail |
| `areaID` in the dataset from day one | Avoids re-extraction when the stretch goal lands |
