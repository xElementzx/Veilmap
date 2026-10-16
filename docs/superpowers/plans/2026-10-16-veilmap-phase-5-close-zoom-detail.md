# Veilmap Implementation Plan — Phase 5: Close-Zoom Map Detail

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zoom zone and city maps deeper than Blizzard allows, and fade the game's minimap terrain in under the painted map as you zoom, with the fog tint still on top.

**Architecture:** A generator emits minimap tile file IDs per continent. A pure `Detail/Tiles.lua` holds all placement, culling, clipping, fade and zoom-step maths and is unit-tested. `Detail/Provider.lua` is a map data provider whose pin (on the `EVENT_OVERLAY` frame level) shows, hides and fades pooled tile textures on pan and zoom. `Detail/Zoom.lua` post-hooks the scroll container's `CreateZoomLevels` to append deeper levels. The fog pin moves up to the `FOG_OF_WAR` frame level so it stays above the detail.

**Tech Stack:** Lua 5.1, Blizzard MapCanvas (`CreateZoomLevels`, `GetViewRect`, provider canvas callbacks, pin frame-levels manager), `C_Map.GetWorldPosFromMapPos`, `C_Map.GetMapInfo`; Node 24, wasmoon.

**Spec:** `docs/superpowers/specs/2026-10-16-veilmap-phase-5-close-zoom-detail-design.md`

## Global Constraints

- **Branch:** `feature/phase-5-close-zoom-detail`. Never commit to `main`.
- **Build `1.60.1.69913`.** Continent 0 = `azeroth`, 1 = `kalimdor`.
- **Tile maths:** `T = 1600 / 3`, `ORIGIN = 32 * T`. Minimap tile `(tx, ty)` covers world Y (west) from `ORIGIN − tx·T` down to `ORIGIN − (tx+1)·T`, and world X (north) from `ORIGIN − ty·T` down to `ORIGIN − (ty+1)·T`. Map `u` grows as world Y falls (west to east) and `v` grows as world X falls (north to south).
- **Elwynn fixture (uiMap 1429):** world X from −10254.166015625 to −7939.5830078125, world Y from −1935.4166259766 to 1535.4166259766. Goldshire (−9440, −40) maps to (0.4539, 0.6482).
- **Never `hooksecurefunc` a `WorldMapFrame` method.** Hooking `WorldMapFrame.ScrollContainer` is allowed (spec 6.1).
- **Unknown pin frame-level types silently fall back to level 2000.** Always check `manager.definitions[type]` before using a type.
- **The error rule:** `pcall` only canvas/API calls and report each message once; never wrap Veilmap's own logic.
- **Lua 5.1 only, zero runtime dependencies, GPL headers, plain-ASCII UI text.**
- **Tests:** `cd tools && npm test`; all 141 existing tests must keep passing.
- **Commits** end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Maps that aren't zones or cities, or whose world rectangle doesn't resolve** (continents, instances, the world map). These must show no detail and get no extra zoom. *(Task 3: the provider's early exits; Task 4: the hook's zone/city check.)*
2. **Tiles straddling the map edge.** They must be cropped exactly, with matching texture coordinates, and never drawn past the map. *(Task 2: `Clip` tests for every edge.)*
3. **The default 1× view.** It must look identical to before: zero detail alpha. *(Task 2: `Fade(1) == 0`; Task 3 skips drawing below 0.01.)*
4. **Zoom-step sequences.** They must end exactly at the slider value and add nothing when the slider is at or below Blizzard's maximum. *(Task 2: `ZoomScales` tests.)*
5. **Combat.** Pan and zoom updates must never acquire pins; zoom levels must not be touched in combat unless the debug flag is on. *(Task 3: the view update only touches textures; Task 4: the combat check; in-game checks 12–13.)*

## File Structure

| Path | Change |
|---|---|
| `tools/lib/minimap.mjs`, `tools/tests/minimap.test.mjs`, `tools/genminimap.mjs` | Create |
| `Detail/Data_Minimap_Forever.lua` | Generate |
| `Detail/Tiles.lua`, `tools/tests/tiles.test.mjs` | Create |
| `Detail/DetailPin.xml`, `Detail/Provider.lua`, `Detail/Zoom.lua` | Create |
| `Fog/Provider.lua` | Modify (fog pin level; `OnReady` wiring) |
| `Config.lua`, `Options.lua`, `Core.lua`, `tools/tests/config.test.mjs` | Modify |
| `Veilmap.toc`, `.luacheckrc` | Modify |
| `docs/ingame-checks-phase-5.md`, `media/CURSEFORGE.md` | Create / modify |

Final TOC file list:

```
Compat.lua
Config.lua
Fog\Geometry.lua
Fog\Areas.lua
Fog\Data_Forever.lua
Fog\Targets_Forever.lua
Fog\FogPin.xml
Fog\Provider.lua
Fog\Waypoint.lua
Fog\Hover.lua
Fog\AreaList.lua
Detail\Tiles.lua
Detail\Data_Minimap_Forever.lua
Detail\DetailPin.xml
Detail\Zoom.lua
Detail\Provider.lua
MapFrame.lua
Coords.lua
Options.lua
Core.lua
```

---

### Task 1: Minimap tile data

**Files:** create `tools/lib/minimap.mjs`, `tools/tests/minimap.test.mjs`, `tools/genminimap.mjs`; generate `Detail/Data_Minimap_Forever.lua`; modify `Veilmap.toc`, `.luacheckrc`.

**Interfaces:**
- Produces:
  - `parseMinimapListing(files, folder)` → `Map<number key, number fileID>`, with `key = tileX * 64 + tileY`. Only `world/minimaps/<folder>/map<X>_<Y>.blp` with `0 ≤ X, Y < 64` are kept.
  - `emitMinimapLua(byContinent, meta)` → Lua source. `byContinent` is `Map<continentID, Map<key, fileID>>`.
  - `MIN_TILES = 1000`.
  - The global `VeilmapMinimapTiles[continent][key] = fileID`.

- [ ] **Step 1: Write failing tests** — `tools/tests/minimap.test.mjs`:

```js
// Veilmap - GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { LuaFactory } from 'wasmoon';
import { parseMinimapListing, emitMinimapLua, MIN_TILES } from '../lib/minimap.mjs';

test('parseMinimapListing', async (t) => {
  const files = {
    204207: 'world/minimaps/azeroth/map24_53.blp',
    204208: 'world/minimaps/azeroth/map24_54.blp',
    1: 'world/minimaps/azeroth/map64_01.blp', // out of range
    2: 'world/minimaps/azeroth/noLiquid_map24_53.blp', // not a root tile
    3: 'world/minimaps/kalimdor/map10_10.blp', // other continent
    4: 'world/minimaps/azeroth/map00_00.blp',
  };
  const tiles = parseMinimapListing(files, 'azeroth');

  await t.test('keeps root tiles of the folder, keyed x * 64 + y', () => {
    assert.deepEqual([...tiles.entries()].sort((a, b) => a[0] - b[0]), [
      [0, 4],
      [24 * 64 + 53, 204207],
      [24 * 64 + 54, 204208],
    ]);
  });
});

test('emitMinimapLua', async (t) => {
  const byContinent = new Map([
    [1, new Map([[5, 50], [3, 30]])],
    [0, new Map([[24 * 64 + 53, 204207]])],
  ]);
  const source = emitMinimapLua(byContinent, { build: '1.60.1.69913', generatedFrom: 'wago.tools' });

  await t.test('loads as Lua with the expected lookups', async () => {
    const lua = await new LuaFactory().createEngine();
    try {
      lua.doStringSync(source);
      assert.equal(lua.doStringSync('return VeilmapMinimapTiles[0][24 * 64 + 53]'), 204207);
      assert.equal(lua.doStringSync('return VeilmapMinimapTiles[1][3]'), 30);
    } finally {
      lua.global.close();
    }
  });

  await t.test('sorts continents and keys', () => {
    assert.ok(source.indexOf('[0] = {') < source.indexOf('[1] = {'));
    assert.ok(source.indexOf('[3] = 30') < source.indexOf('[5] = 50'));
  });

  await t.test('records the build and do-not-edit', () => {
    assert.match(source, /1\.60\.1\.69913/);
    assert.match(source, /do not edit/i);
  });

  await t.test('is byte-identical across runs', () => {
    assert.equal(emitMinimapLua(byContinent, { build: '1.60.1.69913', generatedFrom: 'wago.tools' }), source);
  });

  await t.test('the truncation guard is set below the real counts (1184, 1105)', () => {
    assert.equal(MIN_TILES, 1000);
  });
});
```

- [ ] **Step 2: Run** `cd tools && node --test tests/minimap.test.mjs`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement `tools/lib/minimap.mjs`:**

```js
// Veilmap - GPL-3.0-or-later
// The game's minimap tiles, by continent: the close-zoom detail layer's source.

// Real counts on 1.60.1.69913 are 1184 (azeroth) and 1105 (kalimdor); fewer
// than this means a truncated listing, not a smaller world.
export const MIN_TILES = 1000;

export function parseMinimapListing(files, folder) {
  const pattern = new RegExp(`^world/minimaps/${folder}/map(\\d+)_(\\d+)\\.blp$`);
  const tiles = new Map();
  for (const [fileID, path] of Object.entries(files)) {
    const m = pattern.exec(path);
    if (!m) continue;
    const x = Number(m[1]);
    const y = Number(m[2]);
    if (x >= 64 || y >= 64) continue;
    tiles.set(x * 64 + y, Number(fileID));
  }
  return tiles;
}

export function emitMinimapLua(byContinent, meta) {
  const out = [];
  out.push('--[[');
  out.push('Veilmap - Copyright (C) 2026 xElementzx');
  out.push('GPL-3.0-or-later. See LICENSE.');
  out.push('');
  out.push('GENERATED FILE - do not edit by hand.');
  out.push(`Source: ${meta.generatedFrom}, WoW build ${meta.build} (world/minimaps/<continent>/mapX_Y.blp)`);
  out.push('Regenerate with:');
  out.push(`  node tools/genminimap.mjs --build ${meta.build} --out Detail/Data_Minimap_Forever.lua`);
  out.push('');
  out.push('[continentID] = { [tileX * 64 + tileY] = fileDataID, ... }');
  out.push(']]');
  out.push('');
  out.push('VeilmapMinimapTiles = {');
  for (const continent of [...byContinent.keys()].sort((a, b) => a - b)) {
    out.push(`\t[${continent}] = {`);
    const entries = [...byContinent.get(continent).entries()].sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < entries.length; i += 8) {
      out.push('\t\t' + entries.slice(i, i + 8).map(([k, v]) => `[${k}] = ${v},`).join(' '));
    }
    out.push('\t},');
  }
  out.push('}');
  out.push('');
  return out.join('\n');
}
```

- [ ] **Step 4: Run** `cd tools && node --test tests/minimap.test.mjs` → PASS; then `npm test` → PASS.

- [ ] **Step 5: Write `tools/genminimap.mjs`:**

```js
#!/usr/bin/env node
// Veilmap - GPL-3.0-or-later
// Generates the minimap tile table for the close-zoom detail layer.
//
//   node tools/genminimap.mjs --build 1.60.1.69913 --out Detail/Data_Minimap_Forever.lua
//
// One wago.tools file search per continent (~20 s each); no tile is downloaded.

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { arg, isValidBuild, writeAtomic } from './genfogdata.mjs';
import { parseMinimapListing, emitMinimapLua, MIN_TILES } from './lib/minimap.mjs';

const CONTINENTS = [
  { id: 0, folder: 'azeroth' },
  { id: 1, folder: 'kalimdor' },
];

export async function main() {
  const build = arg('build');
  const out = arg('out');
  if (!build || !out) {
    console.error('usage: genminimap.mjs --build <version> --out <path>');
    process.exit(2);
  }
  if (!isValidBuild(build)) {
    console.error(`invalid --build "${build}"`);
    process.exit(2);
  }

  const byContinent = new Map();
  for (const { id, folder } of CONTINENTS) {
    const search = encodeURIComponent(`world/minimaps/${folder}/map`);
    const url = `https://wago.tools/api/files?search=${search}&build=${encodeURIComponent(build)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'veilmap-tools/1' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    const tiles = parseMinimapListing(await res.json(), folder);
    console.log(`  ${folder}: ${tiles.size} minimap tiles`);
    if (tiles.size < MIN_TILES) throw new Error(`${folder}: only ${tiles.size} tiles; listing looks truncated`);
    byContinent.set(id, tiles);
  }

  const target = resolve(process.cwd(), out);
  await writeAtomic(target, emitMinimapLua(byContinent, { build, generatedFrom: 'wago.tools' }));
  console.log(`Wrote ${target}`);
}

const isMain =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  main().catch((err) => {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  });
}
```

- [ ] **Step 6: Generate.** Run `mkdir -p Detail && node tools/genminimap.mjs --build 1.60.1.69913 --out Detail/Data_Minimap_Forever.lua` from the repo root. Expected output: `azeroth: 1184`, `kalimdor: 1105`, then `Wrote`. Run it again into a temp path and `cmp` the two files: they must be identical.

- [ ] **Step 7: Wire up.**
  - TOC: add `Detail\Data_Minimap_Forever.lua` after `Fog\AreaList.lua`. `Detail\Tiles.lua` goes before it in Task 2.
  - `.luacheckrc`: add `"Detail/Data_Minimap_Forever.lua"` to `exclude_files`, and `"VeilmapMinimapTiles"` to `globals`.

  Run `npm test` → PASS. The syntax test parses the data file.

- [ ] **Step 8: Commit**

```bash
git add tools/lib/minimap.mjs tools/tests/minimap.test.mjs tools/genminimap.mjs Detail/Data_Minimap_Forever.lua Veilmap.toc .luacheckrc
git commit -m "Generate the minimap tile table for close-zoom detail

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `Detail/Tiles.lua` (pure)

**Files:** create `Detail/Tiles.lua`, `tools/tests/tiles.test.mjs`; modify `Veilmap.toc`.

**Interfaces (all on `Veilmap.Tiles`):**
- `Tiles.Transform(minX, minY, maxX, maxY)` → transform table.
- `Tiles.WorldToMap(t, worldX, worldY)` → `u, v`.
- `Tiles.TileRect(t, tx, ty)` → `u0, v0, u1, v1` (u0 < u1, v0 < v1).
- `Tiles.TileRange(t, left, top, right, bottom, margin)` → `tx0, tx1, ty0, ty1`, inclusive and clamped to 0–63.
- `Tiles.Clip(u0, v0, u1, v1)` → `nil`, or `cu0, cv0, cu1, cv1, s0, t0, s1, t1`.
- `Tiles.Fade(relativeZoom)` → 0..1.
- `Tiles.ZoomScales(lastRelative, maxRelative)` → array of relative scales.

- [ ] **Step 1: Write failing tests** — `tools/tests/tiles.test.mjs`:

```js
// Veilmap - GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { evalInLuaModule } from './helpers/lua.mjs';

const run = (snippet) => evalInLuaModule('Detail/Tiles.lua', snippet);
const ELWYNN = 'local t = Tiles.Transform(-10254.166015625, -1935.4166259766, -7939.5830078125, 1535.4166259766)';
const near = (a, b, eps = 1e-4) => Math.abs(a - b) < eps;

test('Tiles.WorldToMap', async (t) => {
  await t.test('Goldshire lands where the game puts it (check 24, phase 4)', async () => {
    const r = await run(`${ELWYNN} local u, v = Tiles.WorldToMap(t, -9440, -40) return u .. "," .. v`);
    const [u, v] = r.split(',').map(Number);
    assert.ok(near(u, 0.4539) && near(v, 0.6482), r);
  });

  await t.test('the map corners are 0 and 1', async () => {
    const r = await run(`${ELWYNN}
      local u0, v0 = Tiles.WorldToMap(t, -7939.5830078125, 1535.4166259766)
      local u1, v1 = Tiles.WorldToMap(t, -10254.166015625, -1935.4166259766)
      return u0 .. "," .. v0 .. "," .. u1 .. "," .. v1`);
    const [a, b, c, d] = r.split(',').map(Number);
    assert.ok(near(a, 0) && near(b, 0) && near(c, 1) && near(d, 1), r);
  });
});

test('Tiles.TileRect', async (t) => {
  await t.test('tile 32,49 (Goldshire) is positive-size, oriented, and contains Goldshire', async () => {
    const r = await run(`${ELWYNN}
      local u0, v0, u1, v1 = Tiles.TileRect(t, 32, 49)
      local u, v = Tiles.WorldToMap(t, -9440, -40)
      return ((u0 < u1 and v0 < v1 and u >= u0 and u <= u1 and v >= v0 and v <= v1) and "ok" or "bad")
        .. "," .. (u1 - u0) .. "," .. (v1 - v0)`);
    const [ok, w, h] = r.split(',');
    assert.equal(ok, 'ok');
    // 533.33 yards over Elwynn's 3470.83 x 2314.58 yards
    assert.ok(near(Number(w), 533.3333 / 3470.8333, 1e-3) && near(Number(h), 533.3333 / 2314.5833, 1e-3), r);
  });

  await t.test('the next tile east (tx + 1) sits to the right', async () => {
    const r = await run(`${ELWYNN}
      local a = Tiles.TileRect(t, 32, 49) local b = Tiles.TileRect(t, 33, 49)
      return b > a and "right" or "left"`);
    assert.equal(r, 'right');
  });

  await t.test('the next tile south (ty + 1) sits below', async () => {
    const r = await run(`${ELWYNN}
      local _, a = Tiles.TileRect(t, 32, 49) local _, b = Tiles.TileRect(t, 32, 50)
      return b > a and "below" or "above"`);
    assert.equal(r, 'below');
  });
});

test('Tiles.TileRange', async (t) => {
  await t.test('a tiny view around Goldshire is just tile 32,49', async () => {
    const r = await run(`${ELWYNN}
      local u, v = Tiles.WorldToMap(t, -9440, -40)
      local a, b, c, d = Tiles.TileRange(t, u - 0.001, v - 0.001, u + 0.001, v + 0.001, 0)
      return a .. "," .. b .. "," .. c .. "," .. d`);
    assert.equal(r, '32,32,49,49');
  });

  await t.test('margin widens the range by one tile each way', async () => {
    const r = await run(`${ELWYNN}
      local u, v = Tiles.WorldToMap(t, -9440, -40)
      local a, b, c, d = Tiles.TileRange(t, u - 0.001, v - 0.001, u + 0.001, v + 0.001, 1)
      return a .. "," .. b .. "," .. c .. "," .. d`);
    assert.equal(r, '31,33,48,50');
  });

  await t.test('the whole map spans a handful of tiles', async () => {
    const r = await run(`${ELWYNN}
      local a, b, c, d = Tiles.TileRange(t, 0, 0, 1, 1, 0)
      return (b - a + 1) .. "," .. (d - c + 1)`);
    const [w, h] = r.split(',').map(Number);
    assert.ok(w >= 7 && w <= 8 && h >= 5 && h <= 6, r);
  });

  await t.test('ranges clamp to the 0-63 grid', async () => {
    const r = await run(`
      local t = Tiles.Transform(-17066, -17066, 17066, 17066)
      local a, b, c, d = Tiles.TileRange(t, -1, -1, 2, 2, 3)
      return a .. "," .. b .. "," .. c .. "," .. d`);
    assert.equal(r, '0,63,0,63');
  });
});

test('Tiles.Clip', async (t) => {
  const clip = (u0, v0, u1, v1) =>
    run(`local r = { Tiles.Clip(${u0}, ${v0}, ${u1}, ${v1}) } if #r == 0 then return "nil" end return table.concat(r, ",")`);

  await t.test('fully inside is unchanged with full texture coordinates', async () => {
    assert.equal(await clip(0.2, 0.3, 0.4, 0.5), '0.2,0.3,0.4,0.5,0,0,1,1');
  });

  await t.test('fully outside is nil', async () => {
    assert.equal(await clip(1.0, 0.2, 1.2, 0.4), 'nil');
    assert.equal(await clip(-0.4, 0.2, -0.1, 0.4), 'nil');
    assert.equal(await clip(0.2, -0.5, 0.4, 0), 'nil');
  });

  await t.test('crossing the left edge crops the left half', async () => {
    assert.equal(await clip(-0.1, 0.2, 0.1, 0.4), '0,0.2,0.1,0.4,0.5,0,1,1');
  });

  await t.test('crossing the right edge crops the right quarter', async () => {
    assert.equal(await clip(0.9, 0.2, 1.3, 0.4), '0.9,0.2,1,0.4,0,0,0.25,1');
  });

  await t.test('crossing the top and bottom edges', async () => {
    assert.equal(await clip(0.2, -0.2, 0.4, 0.2), '0.2,0,0.4,0.2,0,0.5,1,1');
    assert.equal(await clip(0.2, 0.8, 0.4, 1.2), '0.2,0.8,0.4,1,0,0,1,0.5');
  });
});

test('Tiles.Fade', async (t) => {
  await t.test('is 0 at 1x, 0.5 at 1.5x, 1 at 2x, and clamps', async () => {
    const r = await run('return Tiles.Fade(1) .. "," .. Tiles.Fade(1.5) .. "," .. Tiles.Fade(2) .. "," .. Tiles.Fade(0.5) .. "," .. Tiles.Fade(4)');
    assert.equal(r, '0,0.5,1,0,1');
  });
});

test('Tiles.ZoomScales', async (t) => {
  const scales = (last, max) =>
    run(`local s = Tiles.ZoomScales(${last}, ${max}) local o = {} for i, v in ipairs(s) do o[i] = string.format("%.2f", v) end return table.concat(o, ",")`);

  await t.test('4x from 2.14 is 3.00, 4.00', async () => {
    assert.equal(await scales(2.14, 4), '3.00,4.00');
  });
  await t.test('8x from 2.14 is 3.00, 4.19, 5.87, 8.00', async () => {
    assert.equal(await scales(2.14, 8), '3.00,4.19,5.87,8.00');
  });
  await t.test('a max just above Blizzard adds only the max', async () => {
    assert.equal(await scales(2.14, 2.5), '2.50');
  });
  await t.test('a max at or below Blizzard adds nothing', async () => {
    assert.equal(await scales(2.14, 2.1), '');
    assert.equal(await scales(2.14, 2.145), '');
  });
});
```

- [ ] **Step 2: Run** `cd tools && node --test tests/tiles.test.mjs`. Expected: FAIL (ENOENT `Detail/Tiles.lua`).

- [ ] **Step 3: Implement `Detail/Tiles.lua`:**

```lua
--[[
Veilmap - Copyright (C) 2026 xElementzx
GPL-3.0-or-later. See LICENSE.

Pure maths for the close-zoom detail layer: where each minimap tile sits on
a zone map, which tiles are in view, how they are cropped at the map's
edges, how strongly they show, and the extra zoom steps. No WoW API calls.

World coordinates: X runs north, Y runs west. Map coordinates (u, v) are
0-1 across the map: u grows eastward (as Y falls), v southward (as X falls).
Minimap tile (tx, ty) covers world Y from ORIGIN - tx*T down by T, and world
X from ORIGIN - ty*T down by T: the same grid as the ADT terrain tiles.
]]

local ADDON, Veilmap = ...
Veilmap = Veilmap or {}

local Tiles = {}
Veilmap.Tiles = Tiles

local floor, max, min = math.floor, math.max, math.min

local T = 1600 / 3
local ORIGIN = 32 * T
local GRID = 63 -- tile indices run 0..63

-- Zoom (relative to fully zoomed out) where the detail starts and finishes fading in.
local FADE_FROM, FADE_TO = 1, 2
-- Each appended zoom step is this much deeper than the last.
local ZOOM_STEP = 1.4
-- A step closer than this to the max is replaced by the max itself.
local ZOOM_SNAP = 0.05
-- The max must beat Blizzard's last level by this much to add anything.
local ZOOM_MIN_GAIN = 0.01

-- The map's world extents: X from minX (south) to maxX (north), Y from
-- minY (east) to maxY (west).
function Tiles.Transform(minX, minY, maxX, maxY)
	return { top = maxX, left = maxY, height = maxX - minX, width = maxY - minY }
end

function Tiles.WorldToMap(t, worldX, worldY)
	return (t.left - worldY) / t.width, (t.top - worldX) / t.height
end

function Tiles.TileRect(t, tx, ty)
	local u0 = (t.left - (ORIGIN - tx * T)) / t.width
	local u1 = (t.left - (ORIGIN - (tx + 1) * T)) / t.width
	local v0 = (t.top - (ORIGIN - ty * T)) / t.height
	local v1 = (t.top - (ORIGIN - (ty + 1) * T)) / t.height
	return u0, v0, u1, v1
end

local function clampIndex(i)
	return max(0, min(GRID, i))
end

-- Tiles intersecting the view (0-1 map coordinates), widened by margin tiles.
function Tiles.TileRange(t, left, top, right, bottom, margin)
	local function column(u) return floor((ORIGIN - (t.left - u * t.width)) / T) end
	local function row(v) return floor((ORIGIN - (t.top - v * t.height)) / T) end
	return clampIndex(column(left) - margin), clampIndex(column(right) + margin),
		clampIndex(row(top) - margin), clampIndex(row(bottom) + margin)
end

-- Crops a tile's rect to the map (0-1) and returns the matching texture
-- coordinates; nil when nothing of it is on the map.
function Tiles.Clip(u0, v0, u1, v1)
	if u1 <= 0 or u0 >= 1 or v1 <= 0 or v0 >= 1 then return nil end
	local cu0, cv0, cu1, cv1 = max(u0, 0), max(v0, 0), min(u1, 1), min(v1, 1)
	local du, dv = u1 - u0, v1 - v0
	return cu0, cv0, cu1, cv1,
		(cu0 - u0) / du, (cv0 - v0) / dv, (cu1 - u0) / du, (cv1 - v0) / dv
end

-- 0 at FADE_FROM, 1 at FADE_TO, smoothstep between.
function Tiles.Fade(relativeZoom)
	local x = (relativeZoom - FADE_FROM) / (FADE_TO - FADE_FROM)
	x = max(0, min(1, x))
	return x * x * (3 - 2 * x)
end

-- The relative scales to append after Blizzard's last zoom level, ending
-- exactly at maxRelative.
function Tiles.ZoomScales(lastRelative, maxRelative)
	local out = {}
	if maxRelative <= lastRelative + ZOOM_MIN_GAIN then return out end
	local scale = lastRelative
	while true do
		scale = scale * ZOOM_STEP
		if scale >= maxRelative - ZOOM_SNAP then
			out[#out + 1] = maxRelative
			return out
		end
		out[#out + 1] = scale
	end
end

return Tiles
```

- [ ] **Step 4: Run** `cd tools && node --test tests/tiles.test.mjs` → PASS. If a `Clip` string differs only by float formatting (e.g. `0.25` vs `0.25000000000000006`), round in the **test** with `string.format("%.4g")`. Do not change the maths, and ledger it as a ruling.

- [ ] **Step 5: TOC + suite + commit.** Add `Detail\Tiles.lua` before `Detail\Data_Minimap_Forever.lua`. Run `npm test` → PASS.

```bash
git add Detail/Tiles.lua tools/tests/tiles.test.mjs Veilmap.toc
git commit -m "Add pure tile placement, clipping, fade and zoom-step maths

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Detail provider, fog pin level, strength settings

**Files:** create `Detail/DetailPin.xml`, `Detail/Provider.lua`; modify `Fog/Provider.lua`, `Config.lua`, `Options.lua`, `tools/tests/config.test.mjs`, `Veilmap.toc`, `.luacheckrc`.

**Interfaces:**
- Consumes: `Veilmap.Tiles.*`, `VeilmapMinimapTiles`.
- Produces:
  - `Veilmap.Detail.HasFrameLevel(canvas, type)` → boolean.
  - `Veilmap.Detail.Provider`, the world-map data provider.
  - `Veilmap.Detail.Refresh()`, which re-runs the view update (used by settings).
  - `Veilmap.Detail.IsDetailMap(mapID)` → boolean; zone or city maps.
  - `Veilmap.Detail.Initialise()`.
  - Settings `detailEnabled` (true), `detailStrength` (0.6), `detailMaxZoom` (4).

- [ ] **Step 1: Failing config test** — append inside `test('Config.Merge', ...)`:

```js
  await t.test('phase 5 detail settings defaults', async () => {
    const result = await evalInLuaModule('Config.lua', `
      local m = Config.Merge(nil, Config.defaults)
      return tostring(m.detailEnabled) .. "/" .. m.detailStrength .. "/" .. m.detailMaxZoom
    `);
    assert.equal(result, 'true/0.6/4');
  });
```

Run → FAIL (`attempt to concatenate a nil value`).

- [ ] **Step 2: Defaults** — in `Config.lua`, after the `areaListCollapsed` line:

```lua

	-- Close-zoom detail (world map zone and city maps)
	detailEnabled = true,
	detailStrength = 0.6,
	detailMaxZoom = 4,
```

Run `node --test tests/config.test.mjs` → PASS.

- [ ] **Step 3: `Detail/DetailPin.xml`:**

```xml
<Ui xmlns="http://www.blizzard.com/wow/ui/">
	<!-- Veilmap - GPL-3.0-or-later -->
	<Frame name="VeilmapDetailPinTemplate" mixin="VeilmapDetailPinMixin" virtual="true"/>
</Ui>
```

- [ ] **Step 4: `Detail/Provider.lua`:**

```lua
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

function VeilmapDetailPinMixin:OnReleased()
	self.texturePool:ReleaseAll()
	self.shown = {}
end

-- Shows the tiles in range at alpha, releases the rest.
function VeilmapDetailPinMixin:ShowTiles(state, tx0, tx1, ty0, ty1, alpha)
	local canvas = self:GetMap()
	local width, height = self:GetWidth(), self:GetHeight()
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

	self.state = {
		transform = Tiles.Transform(math.min(x0, x1), math.min(y0, y1), math.max(x0, x1), math.max(y0, y1)),
		tiles = tiles,
	}

	local drawOk, drawErr = pcall(function()
		local pin = canvas:AcquirePin("VeilmapDetailPinTemplate")
		pin:SetAllPoints(canvas:GetCanvas())
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
```

Notes for the implementer:
- `Provider:GetMap()` is nil until `AddDataProvider`. `Detail.Refresh` guards on that.
- `view.left/right/top/bottom` are fields of Blizzard's `RectangleMixin`.
- The Y of map (0,0) is the higher world Y (west), so `Transform` gets min/max explicitly and is robust to which corner comes back first.

- [ ] **Step 5: Move the fog pin up a level.** In `Fog/Provider.lua`, change `VeilmapFogPinMixin:OnLoad` to:

```lua
function VeilmapFogPinMixin:OnLoad()
	self:SetIgnoreGlobalPinScale(true)
	if self.UseFrameLevelType then
		-- Above the close-zoom detail layer (EVENT_OVERLAY), which sits above
		-- Blizzard's explored overlays (MAP_EXPLORATION). FOG_OF_WAR is unused
		-- on Forever. A canvas without it keeps the fog where it always was.
		local level = Veilmap.Detail.HasFrameLevel(self:GetMap(), "PIN_FRAME_LEVEL_FOG_OF_WAR")
			and "PIN_FRAME_LEVEL_FOG_OF_WAR" or "PIN_FRAME_LEVEL_MAP_EXPLORATION"
		self:UseFrameLevelType(level)
	end
	self.texturePool = CreateTexturePool(self, "ARTWORK", -1)
end
```

`Veilmap.Detail` is defined by `Detail/Provider.lua`, which loads after `Fog/Provider.lua`. `OnLoad` only runs at the first `AcquirePin`, after every file has loaded, so the forward reference is safe.

- [ ] **Step 6: Wire up.**
  - In `Veilmap.OnReady` (`Fog/Provider.lua`), after `Veilmap.AreaList.Initialise()`, add `Veilmap.Detail.Initialise()`.
  - In `Options.lua` `apply(key)`, before the final `else`:

    ```lua
    	elseif key == "detailEnabled" or key == "detailStrength" then
    		Veilmap.Detail.Refresh()
    	elseif key == "detailMaxZoom" then
    		-- Applies when Blizzard next rebuilds zoom levels (map change, maximize).
    ```

  - In `Options.Initialise`, after the Coordinates section, add:

    ```lua
    	layout:AddInitializer(CreateSettingsListSectionHeaderInitializer("Map Detail"))
    	addCheckbox("detailEnabled", "Close-zoom detail",
    		"Zoom zone and city maps further, and blend in the game's minimap terrain as you zoom in. Zoom changes apply the next time the map changes.")
    	addSlider("detailStrength", "Detail strength", "How strongly the minimap terrain shows when zoomed in. Applies immediately.", 0, 1, 0.05, percent)
    	addSlider("detailMaxZoom", "Deepest zoom", "How far zone and city maps zoom in. 2x or less keeps Blizzard's normal limit (2.1x). Applies the next time the map changes.", 2, 8, 0.5, function(v) return ("%.1fx"):format(v) end)
    ```

    The slider runs 2–8 in 0.5 steps, so the 4× default sits on a step. `ZoomScales` adds nothing for any max ≤ 2.15, so 2× means Blizzard's normal zoom. (The spec said 2.1–8; a 2.1 start can't land on 4 with 0.5 steps.)
  - TOC: add `Detail\DetailPin.xml` and `Detail\Provider.lua` (with `Detail\Zoom.lua` between them in Task 4), as in the final list.
  - `.luacheckrc`: add `"VeilmapDetailPinMixin"` to `globals`, and `"Enum"` to `read_globals`.

- [ ] **Step 7: Run** `npm test` → PASS. **Commit:**

```bash
git add Detail/DetailPin.xml Detail/Provider.lua Fog/Provider.lua Config.lua Options.lua tools/tests/config.test.mjs Veilmap.toc .luacheckrc
git commit -m "Fade the game's minimap terrain in under the fog as zone maps are zoomed

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Deeper zoom and the combat debug flag

**Files:** create `Detail/Zoom.lua`; modify `Fog/Provider.lua` (`OnReady`), `Core.lua`, `Veilmap.toc`.

**Interfaces:**
- Consumes: `Veilmap.Tiles.ZoomScales`, `Veilmap.Detail.IsDetailMap`, `db.detailEnabled`, `db.detailMaxZoom`.
- Produces: `Veilmap.Zoom.Initialise()`, and `Veilmap.Zoom.combatDebug` (session-only boolean).

- [ ] **Step 1: `Detail/Zoom.lua`:**

```lua
--[[
Veilmap - Copyright (C) 2026 xElementzx
GPL-3.0-or-later. See LICENSE.

Deeper zoom on zone and city maps: after Blizzard builds a map's zoom levels
(CreateZoomLevels, on every map change and canvas resize), append steps up
to the "Deepest zoom" setting.

This hooks the SCROLL CONTAINER's method. Never hooksecurefunc a
WorldMapFrame method (see MapFrame.lua). Nothing is appended in combat:
writing into Blizzard's zoom list mid map-change could taint that path.
Zoom.combatDebug (/vm debug combatzoom, session only) lifts that for the
in-game taint test.
]]

local ADDON, Veilmap = ...
local Tiles = Veilmap.Tiles

local Zoom = {}
Veilmap.Zoom = Zoom

Zoom.combatDebug = false
local installed = false

local function onCreateZoomLevels(container)
	local db = Veilmap.db
	if not db or not db.detailEnabled then return end
	if InCombatLockdown() and not Zoom.combatDebug then return end
	if not Veilmap.Detail.IsDetailMap(container.mapID) then return end

	local levels = container.zoomLevels
	if type(levels) ~= "table" or #levels == 0 then return end
	for i = 1, #levels do
		if levels[i].layerIndex ~= 1 then return end
	end

	local base = levels[1].scale
	local extra = Tiles.ZoomScales(levels[#levels].scale / base, db.detailMaxZoom)
	for i = 1, #extra do
		levels[#levels + 1] = { scale = extra[i] * base, layerIndex = 1 }
	end
end

function Zoom.Initialise()
	if installed then return end
	installed = true
	hooksecurefunc(WorldMapFrame.ScrollContainer, "CreateZoomLevels", onCreateZoomLevels)
end
```

- [ ] **Step 2: Wire up.**
  - In `Veilmap.OnReady`, after `Veilmap.Detail.Initialise()`, add `Veilmap.Zoom.Initialise()`.

    Zoom levels for an already-open map rebuild on its next map change. That's acceptable at login: the map is almost never open then.
  - TOC: `Detail\Zoom.lua` goes between `Detail\DetailPin.xml` and `Detail\Provider.lua`.
  - `.luacheckrc`: add `"hooksecurefunc"` to `read_globals`.

- [ ] **Step 3: Debug command** — in `Core.lua`, after `handlers.verify`:

```lua
-- Temporary, for the phase 5 in-game taint test: lets the deeper-zoom hook
-- run in combat for this session only. Removed before release.
function handlers.debug(args)
	if args == "combatzoom" then
		Veilmap.Zoom.combatDebug = not Veilmap.Zoom.combatDebug
		print(("|cff33ff99Veilmap|r: combat zoom debug %s (this session only)"):format(
			Veilmap.Zoom.combatDebug and "ON" or "off"))
	else
		print("|cff33ff99Veilmap|r: /vm debug combatzoom")
	end
end
```

- [ ] **Step 4: Run** `npm test` → PASS. **Commit:**

```bash
git add Detail/Zoom.lua Fog/Provider.lua Core.lua Veilmap.toc .luacheckrc
git commit -m "Zoom zone and city maps deeper than Blizzard's limit

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Checklist, version, store page

**Files:** create `docs/ingame-checks-phase-5.md`; modify `Veilmap.toc` (`## Version: 1.2.0`), `media/CURSEFORGE.md`.

- [ ] **Step 1: `docs/ingame-checks-phase-5.md`.** A table holding spec section 10's checks 1–13, verbatim in meaning, each with a "Pass when" column, plus these one-liners:

```
/run local m=WorldMapFrame:GetMapID() local c,p=C_Map.GetWorldPosFromMapPos(m,CreateVector2D(0,0)) print(m,c,p and p:GetXY())
/run local s=WorldMapFrame.ScrollContainer local o={} for i,l in ipairs(s.zoomLevels) do o[i]=("%.2f"):format(l.scale/s.zoomLevels[1].scale) end print(table.concat(o," "))
/run for p in WorldMapFrame:EnumeratePinsByTemplate("VeilmapDetailPinTemplate") do print("detail",p:GetFrameLevel()) end for p in WorldMapFrame:EnumeratePinsByTemplate("VeilmapFogPinTemplate") do print("fog",p:GetFrameLevel()) end
```

Expected for the last one: the fog level is greater than the detail level.

- [ ] **Step 2: Version** — `## Version: 1.2.0` in `Veilmap.toc`.

- [ ] **Step 3: CurseForge** — insert after the "Hunt down unexplored areas" section:

```markdown
### Close-zoom detail
- **Zoom further** into zone and city maps than the game normally allows: up to 8x, set in the options (default 4x).
- As you zoom in, the game's own **minimap terrain fades in** under the map: roads, tree cover, buildings and rocks. Zoomed right out, the map looks exactly as it always did.
- Choose how strongly the terrain shows, or turn the whole feature off.
- The fog tint stays on top, so unexplored areas still stand out.
```

- [ ] **Step 4: Run** `npm test` → PASS. **Commit:**

```bash
git add docs/ingame-checks-phase-5.md Veilmap.toc media/CURSEFORGE.md
git commit -m "Add phase 5 in-game checklist and prepare 1.2.0

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

Do **not** merge or tag. The user runs the in-game checklist first. The spec 6.3 outcome (whether to keep or remove the combat skip) is applied after check 13.
