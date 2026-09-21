# Veilmap Implementation Plan — Phases 0–3

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Veilmap, a zero-dependency World Map addon for WoW Forever providing tinted fog-of-war reveal, map scaling, map transparency, and coordinate display.

**Architecture:** Pure-logic Lua modules (no WoW API calls) hold the error-prone maths and are unit-tested under Node via a WASM Lua VM; thin WoW-facing shells consume them and are verified in-game. Fog is drawn by Veilmap's *own* map data provider — Blizzard's `MapExplorationPinMixin` is never hooked, wrapped, or replaced. Fog data is generated from wago.tools DB2 exports by a committed, re-runnable Node script.

**Tech Stack:** Lua 5.1 (WoW client), Blizzard `Settings` / `C_Map` / `MapCanvas` APIs, Node 24 (`node --test`), `wasmoon` (dev-only).

**Spec:** `docs/superpowers/specs/2026-09-22-veilmap-design.md`

## Global Constraints

- **Interface version: `16001`** — five digits. Target build `1.60.1.69913`.
- **The shipped addon has zero third-party runtime dependencies.** Blizzard APIs only. Dev dependencies under `tools/` are fine and do not ship.
- **Licence: GPL-3.0.** Every `.lua` and `.mjs` file Veilmap owns starts with a short GPL header.
- **No code derived from Mapster.** Mapster is all-rights-reserved. Where behaviour must mirror Blizzard's, derive it from Blizzard's shipped UI code.
- **Lua 5.1 syntax only.** No `goto`, no integer-division `//`, no `<close>`. Tests run on Lua 5.4 via wasmoon, which will silently accept 5.4-only syntax the game rejects.
- **Flavor is detected from `select(4, GetBuildInfo())`, never `WOW_PROJECT_ID`** — Forever reports `1`, identical to Retail.
- **Pure modules use the dual-load pattern** (see Task 2) so they load both in-game and standalone under test.

## File Structure

| Path | Responsibility |
|---|---|
| `Veilmap.toc` | Load order, interface version, SavedVariables |
| `Core.lua` | Addon table, event bootstrap, `/veilmap` dispatch |
| `Compat.lua` | **Pure.** Flavor detection from tocversion |
| `Config.lua` | **Pure.** Defaults and SavedVariables merge |
| `Fog/Geometry.lua` | **Pure.** Overlay keying and tile padding maths |
| `Fog/FogPin.xml` | Pin template declaration |
| `Fog/Provider.lua` | Map data provider; draws unexplored overlays |
| `Fog/Data_Forever.lua` | Generated. Do not edit |
| `MapFrame.lua` | Scale, alpha, drag, persistence |
| `Coords.lua` | Player and cursor coordinate readout |
| `Options.lua` | `Settings` panel |
| `tools/lib/csv.mjs` | **Pure.** CSV parsing |
| `tools/lib/dataset.mjs` | **Pure.** Overlay/tile join |
| `tools/lib/emit.mjs` | **Pure.** Lua serialisation |
| `tools/genfogdata.mjs` | CLI: fetch, join, emit |
| `tools/tests/*.test.mjs` | Node tests |

---

### Task 1: Repo scaffold and Lua syntax harness

Establishes the test harness first, so every later task has somewhere to put a failing test.

**Files:**
- Create: `LICENSE`, `.gitignore`, `README.md`, `Veilmap.toc`, `Core.lua`
- Create: `tools/package.json`, `tools/tests/syntax.test.mjs`

**Interfaces:**
- Consumes: nothing
- Produces: global `Veilmap` addon table (via `...` addon-table vararg); `npm test` in `tools/` runs all Node tests

- [ ] **Step 1: Initialise the Node harness**

```bash
cd /c/Projects/Veilmap/tools
npm init -y
npm install --save-dev wasmoon
```

Then set `tools/package.json` `"scripts"` and `"type"`:

```json
{
  "name": "veilmap-tools",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/"
  },
  "devDependencies": {
    "wasmoon": "^1.16.0"
  }
}
```

Use whatever `wasmoon` version `npm install` actually resolved — do not downgrade it to match this document.

- [ ] **Step 2: Write the failing syntax test**

Create `tools/tests/syntax.test.mjs`:

```js
// Veilmap - GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { LuaFactory } from 'wasmoon';

const ROOT = new URL('../../', import.meta.url).pathname;

async function luaFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'docs', 'tools'].includes(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await luaFiles(full));
    else if (entry.name.endsWith('.lua')) out.push(full);
  }
  return out;
}

test('every shipped Lua file parses', async () => {
  const files = await luaFiles(ROOT);
  assert.ok(files.length > 0, 'expected at least one Lua file');

  const lua = await new LuaFactory().createEngine();
  try {
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      const rel = relative(ROOT, file);
      // load() returns nil + message on a syntax error rather than throwing.
      lua.global.set('__src', source);
      lua.global.set('__name', rel);
      const err = lua.doStringSync('local f, e = load(__src, __name); return e');
      assert.equal(err, undefined, `${rel} failed to parse: ${err}`);
    }
  } finally {
    lua.global.close();
  }
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd /c/Projects/Veilmap/tools && npm test`
Expected: FAIL — `expected at least one Lua file` (no `.lua` files exist yet).

- [ ] **Step 4: Add LICENSE, .gitignore and README**

Fetch the GPL-3.0 text verbatim:

```bash
cd /c/Projects/Veilmap
curl -sSL https://www.gnu.org/licenses/gpl-3.0.txt -o LICENSE
wc -l LICENSE   # expect ~674 lines
```

Create `.gitignore`:

```
node_modules/
*.zip
.DS_Store
```

Create `README.md`:

```markdown
# Veilmap

A World Map addon for WoW Forever.

- Reveals fog of war as a tinted overlay in a colour you choose, rather than removing it
- Scales the world map
- Sets map transparency, so the map stays usable while you move
- Shows player and cursor coordinates

## Development

Fog data is generated from [wago.tools](https://wago.tools) DB2 exports:

    node tools/genfogdata.mjs --build 1.60.1.69913 --out Fog/Data_Forever.lua

Tests:

    cd tools && npm test

## Licence

GPL-3.0-or-later. See `LICENSE`.
```

- [ ] **Step 5: Create the TOC and Core.lua**

Create `Veilmap.toc`:

```
## Interface: 16001
## Title: Veilmap
## Notes: Tinted fog of war, map scaling, transparency and coordinates.
## Author: xElementzx
## Version: 0.1.0
## SavedVariables: VeilmapDB
## X-License: GPL-3.0-or-later

Compat.lua
Config.lua
Core.lua
```

Create `Core.lua`:

```lua
--[[
Veilmap - a World Map addon for WoW Forever.
Copyright (C) 2026 xElementzx

This program is free software: you can redistribute it and/or modify it
under the terms of the GNU General Public License as published by the
Free Software Foundation, either version 3 of the License, or (at your
option) any later version. See the LICENSE file for details.
]]

local ADDON, Veilmap = ...

Veilmap.version = C_AddOns.GetAddOnMetadata(ADDON, "Version") or "dev"

local handlers = {}
Veilmap.commands = handlers

function handlers.version()
	print(("|cff33ff99Veilmap|r %s"):format(Veilmap.version))
end

SLASH_VEILMAP1 = "/veilmap"
SLASH_VEILMAP2 = "/fl"
SlashCmdList["VEILMAP"] = function(msg)
	local cmd = msg:match("^(%S*)"):lower()
	local handler = handlers[cmd] or handlers.version
	handler(msg:match("^%S*%s*(.-)%s*$") or "")
end
```

`Compat.lua` and `Config.lua` are listed in the TOC but created in Tasks 2 and 3. Create both now as one-line placeholders so the TOC is not broken in between:

```lua
-- replaced in Task 2
local ADDON, Veilmap = ...
```

(`Config.lua` gets the same body with `Task 3` in the comment.)

- [ ] **Step 6: Run the syntax test to verify it passes**

Run: `cd /c/Projects/Veilmap/tools && npm test`
Expected: PASS — three Lua files found and parsed.

- [ ] **Step 7: Link the addon into the game and verify it loads**

```bash
cmd //c mklink //J "E:\BattleNet Library\World of Warcraft\_classic_beta_\Interface\AddOns\Veilmap" "C:\Projects\Veilmap"
```

In-game: enable Veilmap, `/reload`, then run `/veilmap`.
Expected: prints `Veilmap 0.1.0`. No Lua errors.

- [ ] **Step 8: Commit**

```bash
cd /c/Projects/Veilmap
git add -A
git commit -m "Add repo scaffold, GPL-3.0 licence and Lua syntax harness"
```

---

### Task 2: Flavor detection

**Files:**
- Modify: `Compat.lua` (replace placeholder)
- Create: `tools/tests/compat.test.mjs`, `tools/tests/helpers/lua.mjs`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `Veilmap.Compat.DetectFlavor(tocversion: number) -> "forever" | "retail" | "unknown"`
  - `Veilmap.Compat.flavor: string` — resolved once at load
  - `Veilmap.Compat.isForever: boolean`
  - Test helper `loadLuaModule(relativePath) -> Promise<{ lua, module }>`

- [ ] **Step 1: Write the shared test helper**

Create `tools/tests/helpers/lua.mjs`:

```js
// Veilmap - GPL-3.0-or-later
import { readFile } from 'node:fs/promises';
import { LuaFactory } from 'wasmoon';

const ROOT = new URL('../../../', import.meta.url).pathname;

// Loads a pure Veilmap module standalone. Pure modules end with `return <table>`,
// which the game ignores but which gives tests a handle on the module.
export async function loadLuaModule(relativePath) {
  const source = await readFile(ROOT + relativePath, 'utf8');
  const lua = await new LuaFactory().createEngine();
  const module = await lua.doString(source);
  return { lua, module };
}
```

- [ ] **Step 2: Write the failing test**

Create `tools/tests/compat.test.mjs`:

```js
// Veilmap - GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLuaModule } from './helpers/lua.mjs';

test('DetectFlavor', async (t) => {
  const { lua, module } = await loadLuaModule('Compat.lua');
  const detect = (v) => module.DetectFlavor(v);

  await t.test('Forever build 1.60.1 reports forever', () => {
    assert.equal(detect(16001), 'forever');
  });

  await t.test('the whole 16xxx band is Forever', () => {
    assert.equal(detect(16000), 'forever');
    assert.equal(detect(16999), 'forever');
  });

  await t.test('retail is retail', () => {
    assert.equal(detect(120001), 'retail');
    assert.equal(detect(100200), 'retail');
  });

  await t.test('classic era and cata classic are neither', () => {
    assert.equal(detect(11505), 'unknown');
    assert.equal(detect(40400), 'unknown');
  });

  await t.test('junk input does not throw', () => {
    assert.equal(detect(null), 'unknown');
    assert.equal(detect(0), 'unknown');
  });

  lua.global.close();
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd /c/Projects/Veilmap/tools && npm test`
Expected: FAIL — `module.DetectFlavor is not a function` (placeholder returns nothing).

- [ ] **Step 4: Implement Compat.lua**

Replace `Compat.lua` entirely:

```lua
--[[
Veilmap - Copyright (C) 2026 xElementzx
GPL-3.0-or-later. See LICENSE.

Flavor detection.

WoW Forever reports WOW_PROJECT_ID == WOW_PROJECT_MAINLINE (both 1), so the
conventional project-ID check cannot distinguish it from Retail. The build's
interface version is the only reliable discriminator:
  Forever 1.60.x -> 16001   Retail 12.x -> 120001
]]

local ADDON, Veilmap = ...
Veilmap = Veilmap or {}

local Compat = {}
Veilmap.Compat = Compat

local FOREVER_MIN, FOREVER_MAX = 16000, 17000
local RETAIL_MIN = 100000

function Compat.DetectFlavor(tocversion)
	if type(tocversion) ~= "number" then return "unknown" end
	if tocversion >= FOREVER_MIN and tocversion < FOREVER_MAX then return "forever" end
	if tocversion >= RETAIL_MIN then return "retail" end
	return "unknown"
end

if GetBuildInfo then
	Compat.flavor = Compat.DetectFlavor(select(4, GetBuildInfo()))
else
	Compat.flavor = "unknown"
end
Compat.isForever = (Compat.flavor == "forever")

return Compat
```

The `GetBuildInfo` guard is what lets this file load under test, where no WoW API exists.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /c/Projects/Veilmap/tools && npm test`
Expected: PASS — all `DetectFlavor` subtests plus the syntax test.

- [ ] **Step 6: Verify in-game**

Add a temporary line to `Core.lua`'s `handlers.version`:

```lua
	print(("  flavor: %s"):format(Veilmap.Compat.flavor))
```

In-game: `/reload`, `/veilmap`.
Expected: `flavor: forever`. Keep this line — it is useful diagnostics.

- [ ] **Step 7: Commit**

```bash
cd /c/Projects/Veilmap
git add -A
git commit -m "Detect client flavor from build number, not WOW_PROJECT_ID"
```

---

### Task 3: Settings defaults and SavedVariables

**Files:**
- Modify: `Config.lua` (replace placeholder), `Core.lua`
- Create: `tools/tests/config.test.mjs`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `Veilmap.Config.defaults` — table of default values
  - `Veilmap.Config.Merge(saved: table|nil, defaults: table) -> table`
  - `Veilmap.db` — live settings table, populated on `ADDON_LOADED`

- [ ] **Step 1: Write the failing test**

Create `tools/tests/config.test.mjs`:

```js
// Veilmap - GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLuaModule } from './helpers/lua.mjs';

test('Config.Merge', async (t) => {
  const { lua, module } = await loadLuaModule('Config.lua');
  // Expose the module to inline Lua snippets. Merge takes and returns tables,
  // which is far easier to assert on inside Lua than across the JS bridge.
  lua.global.set('__config', module);
  const run = (body) => lua.doStringSync(`local C = __config\n${body}`);

  await t.test('nil saved data yields the defaults', () => {
    assert.equal(run('return C.Merge(nil, C.defaults).fogColor.r'), 0.1);
  });

  await t.test('saved values win over defaults', () => {
    assert.equal(run('return C.Merge({ mapScale = 1.75 }, C.defaults).mapScale'), 1.75);
  });

  await t.test('missing keys are filled from defaults', () => {
    assert.equal(run('return C.Merge({ mapScale = 1.75 }, C.defaults).mapAlpha'), 1.0);
  });

  await t.test('nested tables merge rather than replace', () => {
    assert.equal(
      run(`
        local m = C.Merge({ fogColor = { r = 0.5 } }, C.defaults)
        return m.fogColor.r .. "/" .. m.fogColor.g
      `),
      '0.5/0.2',
    );
  });

  await t.test('defaults are not mutated by a merge', () => {
    assert.equal(
      run(`
        C.Merge({ fogColor = { r = 0.9 } }, C.defaults)
        return C.defaults.fogColor.r
      `),
      0.1,
    );
  });

  await t.test('a saved value of the wrong type is discarded', () => {
    assert.equal(run('return C.Merge({ mapScale = "huge" }, C.defaults).mapScale'), 1.0);
  });

  lua.global.close();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /c/Projects/Veilmap/tools && npm test`
Expected: FAIL — `attempt to index a nil value` or `Merge is nil`.

- [ ] **Step 3: Implement Config.lua**

Replace `Config.lua` entirely:

```lua
--[[
Veilmap - Copyright (C) 2026 xElementzx
GPL-3.0-or-later. See LICENSE.

Defaults and SavedVariables merging.
]]

local ADDON, Veilmap = ...
Veilmap = Veilmap or {}

local Config = {}
Veilmap.Config = Config

Config.defaults = {
	-- Fog
	fogEnabled = true,
	fogColor = { r = 0.1, g = 0.2, b = 0.35, a = 0.85 },

	-- Map frame
	mapScale = 1.0,
	mapAlpha = 1.0,
	fadedAlpha = 0.5,
	fadeWhenMoving = true,

	-- Coordinates
	coordsEnabled = true,
	coordsPrecision = 1,
	coordsFontSize = 11,

	-- Saved map position
	position = { point = "CENTER", x = 0, y = 0 },
}

-- Recursive fill: saved values win, missing keys come from defaults.
-- Neither argument is mutated.
function Config.Merge(saved, defaults)
	local out = {}
	for key, default in pairs(defaults) do
		local value = saved and saved[key]
		if type(default) == "table" then
			out[key] = Config.Merge(type(value) == "table" and value or nil, default)
		elseif value ~= nil and type(value) == type(default) then
			out[key] = value
		else
			out[key] = default
		end
	end
	return out
end

return Config
```

Note the `type(value) == type(default)` guard: it discards corrupted SavedVariables of the wrong type instead of propagating them into the UI.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /c/Projects/Veilmap/tools && npm test`
Expected: PASS.

- [ ] **Step 5: Wire SavedVariables into Core.lua**

Append to `Core.lua`:

```lua
local loader = CreateFrame("Frame")
loader:RegisterEvent("ADDON_LOADED")
loader:SetScript("OnEvent", function(self, _, name)
	if name ~= ADDON then return end
	self:UnregisterEvent("ADDON_LOADED")

	VeilmapDB = Veilmap.Config.Merge(VeilmapDB, Veilmap.Config.defaults)
	Veilmap.db = VeilmapDB

	if Veilmap.OnReady then Veilmap.OnReady() end
end)
```

`Veilmap.OnReady` is defined in Task 7; the guard keeps this safe until then.

- [ ] **Step 6: Verify in-game**

In-game: `/reload`, then `/dump VeilmapDB.fogColor`.
Expected: a table with `r=0.1, g=0.2, b=0.35, a=0.85`.

- [ ] **Step 7: Commit**

```bash
cd /c/Projects/Veilmap
git add -A
git commit -m "Add settings defaults and non-mutating SavedVariables merge"
```

---

### Task 4: CSV parsing

**Files:**
- Create: `tools/lib/csv.mjs`, `tools/tests/csv.test.mjs`

**Interfaces:**
- Consumes: nothing
- Produces: `parseCsv(text: string) -> Array<Record<string, string>>`

- [ ] **Step 1: Write the failing test**

Create `tools/tests/csv.test.mjs`:

```js
// Veilmap - GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../lib/csv.mjs';

test('parseCsv', async (t) => {
  await t.test('parses a header and rows into objects', () => {
    const rows = parseCsv('ID,UiMapArtID\n5157,2153\n5161,2153\n');
    assert.deepEqual(rows, [
      { ID: '5157', UiMapArtID: '2153' },
      { ID: '5161', UiMapArtID: '2153' },
    ]);
  });

  await t.test('ignores a trailing newline', () => {
    assert.equal(parseCsv('A,B\n1,2\n').length, 1);
  });

  await t.test('handles CRLF line endings', () => {
    const rows = parseCsv('A,B\r\n1,2\r\n');
    assert.deepEqual(rows, [{ A: '1', B: '2' }]);
  });

  await t.test('respects quoted fields containing commas', () => {
    const rows = parseCsv('A,B\n"x,y",2\n');
    assert.deepEqual(rows, [{ A: 'x,y', B: '2' }]);
  });

  await t.test('unescapes doubled quotes inside a quoted field', () => {
    const rows = parseCsv('A\n"say ""hi"""\n');
    assert.deepEqual(rows, [{ A: 'say "hi"' }]);
  });

  await t.test('returns an empty array for header-only input', () => {
    assert.deepEqual(parseCsv('A,B\n'), []);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /c/Projects/Veilmap/tools && npm test`
Expected: FAIL — cannot resolve `../lib/csv.mjs`.

- [ ] **Step 3: Implement csv.mjs**

Create `tools/lib/csv.mjs`:

```js
// Veilmap - GPL-3.0-or-later
// Minimal RFC4180-ish CSV reader. wago.tools serves plain numeric columns for the
// tables we use, but quoting is handled so a schema change cannot corrupt data silently.

function splitLine(line) {
  const fields = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      fields.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields;
}

export function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  const header = splitLine(lines[0]);
  return lines.slice(1).map((line) => {
    const fields = splitLine(line);
    const row = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = fields[i] ?? '';
    return row;
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /c/Projects/Veilmap/tools && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /c/Projects/Veilmap
git add -A
git commit -m "Add CSV parser for DB2 exports"
```

---

### Task 5: Overlay/tile join

**Files:**
- Create: `tools/lib/dataset.mjs`, `tools/tests/dataset.test.mjs`
- Create: `tools/tests/fixtures/overlay-2153.csv`, `tools/tests/fixtures/tile-2153.csv`

**Interfaces:**
- Consumes: `parseCsv` from Task 4
- Produces: `buildDataset(overlayRows, tileRows) -> Map<number, Array<Entry>>` where
  `Entry = { width, height, offsetX, offsetY, areaID, fileDataIDs: number[] }`,
  entries sorted by `offsetY, offsetX, width, height` for deterministic output.

- [ ] **Step 1: Create the ground-truth fixtures**

These rows are real, taken from build `1.60.1.69913`, and two of them were verified against the live client's `GetExploredMapTextures` output.

Create `tools/tests/fixtures/overlay-2153.csv`:

```
ID,UiMapArtID,TextureWidth,TextureHeight,OffsetX,OffsetY,HitRectTop,HitRectBottom,HitRectLeft,HitRectRight,PlayerConditionID,Flags,AreaID_0,AreaID_1,AreaID_2,AreaID_3
5156,2153,256,249,577,419,495,565,615,735,0,4,62,0,0,0
5157,2153,256,256,422,332,380,475,450,605,0,4,18,0,0,0
5160,2153,256,341,124,327,445,645,200,300,0,4,60,0,0,0
5999,2153,128,128,10,10,0,0,0,0,0,0,999,0,0,0
```

Create `tools/tests/fixtures/tile-2153.csv`:

```
ID,RowIndex,ColIndex,LayerIndex,FileDataID,WorldMapOverlayID
16001,0,0,0,272826,5156
16002,0,0,0,272806,5157
16004,1,0,0,272902,5160
16003,0,0,0,272901,5160
```

Row `5999` has no tile rows — it is the fixture's stand-in for the 8 tile-less overlays in the real data, and must be dropped. The two `5160` tile rows are deliberately out of order to prove sorting is applied.

- [ ] **Step 2: Write the failing test**

Create `tools/tests/dataset.test.mjs`:

```js
// Veilmap - GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseCsv } from '../lib/csv.mjs';
import { buildDataset } from '../lib/dataset.mjs';

const fixture = (name) =>
  readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8').then(parseCsv);

test('buildDataset', async (t) => {
  const overlays = await fixture('overlay-2153.csv');
  const tiles = await fixture('tile-2153.csv');
  const ds = buildDataset(overlays, tiles);

  await t.test('groups entries under their UiMapArtID', () => {
    assert.deepEqual([...ds.keys()], [2153]);
  });

  await t.test('drops overlays that have no tiles', () => {
    assert.equal(ds.get(2153).length, 3);
    assert.ok(!ds.get(2153).some((e) => e.areaID === 999));
  });

  await t.test('matches the live client for overlay 5157', () => {
    // Verified against C_MapExplorationInfo.GetExploredMapTextures on 1.60.1.69913.
    const e = ds.get(2153).find((x) => x.areaID === 18);
    assert.deepEqual(
      { w: e.width, h: e.height, x: e.offsetX, y: e.offsetY },
      { w: 256, h: 256, x: 422, y: 332 },
    );
    assert.deepEqual(e.fileDataIDs, [272806]);
  });

  await t.test('orders tiles by RowIndex then ColIndex', () => {
    const e = ds.get(2153).find((x) => x.areaID === 60);
    assert.deepEqual(e.fileDataIDs, [272901, 272902]);
  });

  await t.test('sorts entries deterministically', () => {
    const ys = ds.get(2153).map((e) => e.offsetY);
    assert.deepEqual(ys, [...ys].sort((a, b) => a - b));
  });

  await t.test('is stable across repeated runs', () => {
    const again = buildDataset(overlays, tiles);
    assert.deepEqual(again.get(2153), ds.get(2153));
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd /c/Projects/Veilmap/tools && npm test`
Expected: FAIL — cannot resolve `../lib/dataset.mjs`.

- [ ] **Step 4: Implement dataset.mjs**

Create `tools/lib/dataset.mjs`:

```js
// Veilmap - GPL-3.0-or-later
// Joins WorldMapOverlay to WorldMapOverlayTile and groups by UiMapArtID.

const num = (v) => Number(v ?? 0);

export function buildDataset(overlayRows, tileRows) {
  const tilesByOverlay = new Map();
  for (const tile of tileRows) {
    const id = num(tile.WorldMapOverlayID);
    let list = tilesByOverlay.get(id);
    if (!list) tilesByOverlay.set(id, (list = []));
    list.push(tile);
  }

  const byArt = new Map();
  for (const overlay of overlayRows) {
    const tiles = tilesByOverlay.get(num(overlay.ID));
    if (!tiles || tiles.length === 0) continue; // tile-less overlays render nothing

    // Explicit ordering. Blizzard indexes tiles row-major; do not assume file order.
    tiles.sort(
      (a, b) => num(a.RowIndex) - num(b.RowIndex) || num(a.ColIndex) - num(b.ColIndex),
    );

    const art = num(overlay.UiMapArtID);
    let entries = byArt.get(art);
    if (!entries) byArt.set(art, (entries = []));

    entries.push({
      width: num(overlay.TextureWidth),
      height: num(overlay.TextureHeight),
      offsetX: num(overlay.OffsetX),
      offsetY: num(overlay.OffsetY),
      areaID: num(overlay.AreaID_0),
      fileDataIDs: tiles.map((t) => num(t.FileDataID)),
    });
  }

  for (const entries of byArt.values()) {
    entries.sort(
      (a, b) =>
        a.offsetY - b.offsetY ||
        a.offsetX - b.offsetX ||
        a.width - b.width ||
        a.height - b.height,
    );
  }
  return byArt;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /c/Projects/Veilmap/tools && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /c/Projects/Veilmap
git add -A
git commit -m "Join overlay and tile tables into an art-keyed dataset"
```

---

### Task 6: Lua emission and the generator CLI

**Files:**
- Create: `tools/lib/emit.mjs`, `tools/tests/emit.test.mjs`, `tools/genfogdata.mjs`
- Create: `Fog/Data_Forever.lua` (generated)
- Modify: `Veilmap.toc`

**Interfaces:**
- Consumes: `buildDataset` (Task 5), `parseCsv` (Task 4)
- Produces:
  - `emitLua(dataset: Map, meta: { build: string, generatedFrom: string }) -> string`
  - Global `VeilmapFogData` in `Fog/Data_Forever.lua`, shape
    `{ [artID] = { {width, height, offsetX, offsetY, areaID, "id,id"}, ... } }`

- [ ] **Step 1: Write the failing test**

Create `tools/tests/emit.test.mjs`:

```js
// Veilmap - GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LuaFactory } from 'wasmoon';
import { parseCsv } from '../lib/csv.mjs';
import { buildDataset } from '../lib/dataset.mjs';
import { emitLua } from '../lib/emit.mjs';

const fixture = (name) =>
  readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8').then(parseCsv);

test('emitLua', async (t) => {
  const ds = buildDataset(await fixture('overlay-2153.csv'), await fixture('tile-2153.csv'));
  const source = emitLua(ds, { build: '1.60.1.69913', generatedFrom: 'wago.tools' });

  await t.test('records the source build in a header comment', () => {
    assert.match(source, /1\.60\.1\.69913/);
    assert.match(source, /do not edit/i);
  });

  await t.test('produces Lua that loads and yields the expected table', async () => {
    const lua = await new LuaFactory().createEngine();
    try {
      lua.doStringSync(source);
      const n = lua.doStringSync('return #VeilmapFogData[2153]');
      assert.equal(n, 3);

      const row = lua.doStringSync(`
        for _, e in ipairs(VeilmapFogData[2153]) do
          if e[5] == 18 then
            return e[1] .. "," .. e[2] .. "," .. e[3] .. "," .. e[4] .. "," .. e[6]
          end
        end
      `);
      assert.equal(row, '256,256,422,332,272806');
    } finally {
      lua.global.close();
    }
  });

  await t.test('joins multiple file data IDs with commas', async () => {
    const lua = await new LuaFactory().createEngine();
    try {
      lua.doStringSync(source);
      const ids = lua.doStringSync(`
        for _, e in ipairs(VeilmapFogData[2153]) do
          if e[5] == 60 then return e[6] end
        end
      `);
      assert.equal(ids, '272901,272902');
    } finally {
      lua.global.close();
    }
  });

  await t.test('is byte-identical across runs', () => {
    assert.equal(emitLua(ds, { build: '1.60.1.69913', generatedFrom: 'wago.tools' }), source);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /c/Projects/Veilmap/tools && npm test`
Expected: FAIL — cannot resolve `../lib/emit.mjs`.

- [ ] **Step 3: Implement emit.mjs**

Create `tools/lib/emit.mjs`:

```js
// Veilmap - GPL-3.0-or-later

export function emitLua(dataset, meta) {
  const arts = [...dataset.keys()].sort((a, b) => a - b);
  const out = [];

  out.push('--[[');
  out.push('Veilmap - Copyright (C) 2026 xElementzx');
  out.push('GPL-3.0-or-later. See LICENSE.');
  out.push('');
  out.push('GENERATED FILE - do not edit by hand.');
  out.push(`Source: ${meta.generatedFrom}, WoW build ${meta.build}`);
  out.push('Regenerate with:');
  out.push(`  node tools/genfogdata.mjs --build ${meta.build} --out Fog/Data_Forever.lua`);
  out.push('');
  out.push('[UiMapArtID] = { {width, height, offsetX, offsetY, areaID, "fileDataIDs"}, ... }');
  out.push(']]');
  out.push('');
  out.push('VeilmapFogData = {');

  for (const art of arts) {
    out.push(`\t[${art}] = {`);
    for (const e of dataset.get(art)) {
      out.push(
        `\t\t{${e.width},${e.height},${e.offsetX},${e.offsetY},${e.areaID},"${e.fileDataIDs.join(',')}"},`,
      );
    }
    out.push('\t},');
  }

  out.push('}');
  out.push('');
  return out.join('\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /c/Projects/Veilmap/tools && npm test`
Expected: PASS.

- [ ] **Step 5: Write the generator CLI**

Create `tools/genfogdata.mjs`:

```js
#!/usr/bin/env node
// Veilmap - GPL-3.0-or-later
// Generates the fog dataset from wago.tools DB2 exports.
//
//   node tools/genfogdata.mjs --build 1.60.1.69913 --out Fog/Data_Forever.lua

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseCsv } from './lib/csv.mjs';
import { buildDataset } from './lib/dataset.mjs';
import { emitLua } from './lib/emit.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

async function fetchTable(table, build) {
  const url = `https://wago.tools/db2/${table}/csv?build=${encodeURIComponent(build)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${table}: HTTP ${res.status} from ${url}`);
  const text = await res.text();
  if (text.trimStart().startsWith('{')) throw new Error(`${table}: ${text.trim()}`);
  return parseCsv(text);
}

const build = arg('build');
const out = arg('out');
if (!build || !out) {
  console.error('usage: genfogdata.mjs --build <version> --out <path>');
  process.exit(2);
}

console.log(`Fetching DB2 exports for build ${build}...`);
const [overlays, tiles] = await Promise.all([
  fetchTable('WorldMapOverlay', build),
  fetchTable('WorldMapOverlayTile', build),
]);
console.log(`  WorldMapOverlay:     ${overlays.length} rows`);
console.log(`  WorldMapOverlayTile: ${tiles.length} rows`);

const dataset = buildDataset(overlays, tiles);
const entries = [...dataset.values()].reduce((n, e) => n + e.length, 0);
console.log(`  -> ${dataset.size} map art IDs, ${entries} overlays (${overlays.length - entries} dropped as tile-less)`);

const target = resolve(process.cwd(), out);
await writeFile(target, emitLua(dataset, { build, generatedFrom: 'wago.tools' }), 'utf8');
console.log(`Wrote ${target}`);
```

- [ ] **Step 6: Generate the real dataset**

```bash
cd /c/Projects/Veilmap
mkdir -p Fog
node tools/genfogdata.mjs --build 1.60.1.69913 --out Fog/Data_Forever.lua
```

Expected output:

```
  WorldMapOverlay:     1081 rows
  WorldMapOverlayTile: 1739 rows
  -> 84 map art IDs, 1073 overlays (8 dropped as tile-less)
```

If those numbers differ, **stop** — either wago changed its schema or Forever patched. Investigate before continuing.

- [ ] **Step 7: Add the data file to the TOC**

In `Veilmap.toc`, after `Config.lua`:

```
Fog\Data_Forever.lua
```

Note the backslash — WoW TOC paths use backslashes.

- [ ] **Step 8: Verify the generated file is sane**

Run: `cd /c/Projects/Veilmap/tools && npm test`
Expected: PASS — the syntax test now also parses the 1073-entry generated file.

In-game: `/reload`, then `/dump #VeilmapFogData[2153]`.
Expected: `12` (art 2153 has 12 overlay rows in the real data).

- [ ] **Step 9: Commit**

```bash
cd /c/Projects/Veilmap
git add -A
git commit -m "Add fog data generator and dataset for build 1.60.1.69913"
```

---

### Task 7: Tile geometry maths

The highest-risk logic in the addon, and the reason the pure/shell split exists. Errors here produce subtly misaligned artwork that is painful to diagnose in-game.

**Files:**
- Create: `Fog/Geometry.lua`, `tools/tests/geometry.test.mjs`
- Modify: `Veilmap.toc`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `Veilmap.Geometry.OverlayKey(w, h, x, y) -> string`
  - `Veilmap.Geometry.BuildExploredKeySet(textures) -> table<string, true>`
  - `Veilmap.Geometry.TileCounts(width, height, tileWidth, tileHeight) -> wide, tall`
  - `Veilmap.Geometry.TileSpan(index, count, total, tileSize) -> pixels, texCoordMax`

- [ ] **Step 1: Write the failing test**

Create `tools/tests/geometry.test.mjs`:

```js
// Veilmap - GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLuaModule } from './helpers/lua.mjs';

test('Geometry', async (t) => {
  const { lua, module } = await loadLuaModule('Fog/Geometry.lua');
  lua.global.set('__geom', module);
  lua.doStringSync('function G() return __geom end');

  await t.test('OverlayKey is stable and distinguishes all four fields', () => {
    assert.equal(module.OverlayKey(256, 256, 422, 332), '256:256:422:332');
    assert.notEqual(module.OverlayKey(256, 256, 422, 332), module.OverlayKey(256, 256, 332, 422));
  });

  await t.test('BuildExploredKeySet keys live client textures', () => {
    const hit = lua.doStringSync(`
      local set = G().BuildExploredKeySet({
        { textureWidth = 256, textureHeight = 256, offsetX = 422, offsetY = 332 },
        { textureWidth = 256, textureHeight = 256, offsetX = 250, offsetY = 270 },
      })
      return (set["256:256:422:332"] and set["256:256:250:270"]) and 1 or 0
    `);
    assert.equal(hit, 1);
  });

  await t.test('BuildExploredKeySet tolerates nil', () => {
    assert.equal(lua.doStringSync('local s = G().BuildExploredKeySet(nil); return next(s) == nil and 1 or 0'), 1);
  });

  await t.test('TileCounts rounds up partial tiles', () => {
    assert.equal(lua.doStringSync('local w = G().TileCounts(256, 256, 256, 256); return w'), 1);
    assert.equal(lua.doStringSync('local _, h = G().TileCounts(256, 341, 256, 256); return h'), 2);
    assert.equal(lua.doStringSync('local w = G().TileCounts(513, 100, 256, 256); return w'), 3);
  });

  await t.test('TileSpan returns a full tile for non-final indices', () => {
    assert.equal(lua.doStringSync('local p, t = G().TileSpan(1, 2, 341, 256); return p'), 256);
    assert.equal(lua.doStringSync('local p, t = G().TileSpan(1, 2, 341, 256); return t'), 1);
  });

  await t.test('final tile is padded to the next power of two', () => {
    // 341 % 256 = 85 pixels; padded 16 -> 32 -> 64 -> 128.
    assert.equal(lua.doStringSync('local p = G().TileSpan(2, 2, 341, 256); return p'), 85);
    assert.equal(lua.doStringSync('local _, t = G().TileSpan(2, 2, 341, 256); return t'), 85 / 128);
  });

  await t.test('real overlay heights from art 2153', () => {
    // 249 -> padded to 256; 240 -> 256; 237 -> 256. All single-tile.
    assert.equal(lua.doStringSync('local _, t = G().TileSpan(1, 1, 249, 256); return t'), 249 / 256);
    assert.equal(lua.doStringSync('local _, t = G().TileSpan(1, 1, 240, 256); return t'), 240 / 256);
    assert.equal(lua.doStringSync('local _, t = G().TileSpan(1, 1, 237, 256); return t'), 237 / 256);
  });

  await t.test('an exact multiple uses the full tile, not a zero-width one', () => {
    assert.equal(lua.doStringSync('local p = G().TileSpan(2, 2, 512, 256); return p'), 256);
    assert.equal(lua.doStringSync('local _, t = G().TileSpan(2, 2, 512, 256); return t'), 1);
  });

  await t.test('never pads below the 16px floor', () => {
    assert.equal(lua.doStringSync('local _, t = G().TileSpan(2, 2, 260, 256); return t'), 4 / 16);
  });

  lua.global.close();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /c/Projects/Veilmap/tools && npm test`
Expected: FAIL — `Fog/Geometry.lua` does not exist.

- [ ] **Step 3: Implement Geometry.lua**

Create `Fog/Geometry.lua`:

```lua
--[[
Veilmap - Copyright (C) 2026 xElementzx
GPL-3.0-or-later. See LICENSE.

Pure geometry for overlay tiling. No WoW API calls, so this is unit-testable.

Blizzard stores each overlay as a grid of tiles. Every tile is a full tileSize
square except those in the final row and column, which hold only the remainder.
Those remainder tiles are stored in a texture padded up to the next power of two
(minimum 16), so the visible fraction is pixels/paddedSize and the texture
coordinates must be scaled to match.
]]

local ADDON, Veilmap = ...
Veilmap = Veilmap or {}

local Geometry = {}
Veilmap.Geometry = Geometry

local ceil = math.ceil

function Geometry.OverlayKey(width, height, offsetX, offsetY)
	return width .. ":" .. height .. ":" .. offsetX .. ":" .. offsetY
end

-- Keys the overlays the player has already discovered, so the provider can skip them.
function Geometry.BuildExploredKeySet(textures)
	local set = {}
	if type(textures) ~= "table" then return set end
	for i = 1, #textures do
		local t = textures[i]
		set[Geometry.OverlayKey(t.textureWidth, t.textureHeight, t.offsetX, t.offsetY)] = true
	end
	return set
end

function Geometry.TileCounts(width, height, tileWidth, tileHeight)
	return ceil(width / tileWidth), ceil(height / tileHeight)
end

-- index and count are 1-based. Returns the tile's visible pixel size along one
-- axis, and the texture coordinate maximum for that axis.
function Geometry.TileSpan(index, count, total, tileSize)
	if index < count then
		return tileSize, 1
	end

	local pixels = total % tileSize
	if pixels == 0 then
		pixels = tileSize
	end

	local padded = 16
	while padded < pixels do
		padded = padded * 2
	end

	return pixels, pixels / padded
end

return Geometry
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /c/Projects/Veilmap/tools && npm test`
Expected: PASS — all ten Geometry subtests.

- [ ] **Step 5: Add to the TOC**

In `Veilmap.toc`, immediately before `Fog\Data_Forever.lua`:

```
Fog\Geometry.lua
```

- [ ] **Step 6: Commit**

```bash
cd /c/Projects/Veilmap
git add -A
git commit -m "Add pure tile geometry with unit tests"
```

---

### Task 8: Fog data provider

The first WoW-facing component. Built in two visible increments so a mistake is caught while there is one rectangle on screen, not 1073.

**Files:**
- Create: `Fog/FogPin.xml`, `Fog/Provider.lua`
- Modify: `Veilmap.toc`, `Core.lua`

**Interfaces:**
- Consumes: `Veilmap.Geometry` (Task 7), `VeilmapFogData` (Task 6), `Veilmap.db` (Task 3)
- Produces:
  - Global `VeilmapFogPinMixin`
  - `Veilmap.FogProvider` — registered on `WorldMapFrame`
  - `Veilmap.FogProvider:RefreshAllData(fromOnShow)`
  - `Veilmap.OnReady()` — called from `Core.lua`'s `ADDON_LOADED`

- [ ] **Step 1: Declare the pin template**

Create `Fog/FogPin.xml`:

```xml
<Ui xmlns="http://www.blizzard.com/wow/ui/">
	<!-- Veilmap - GPL-3.0-or-later -->
	<Frame name="VeilmapFogPinTemplate" inherits="MapCanvasPinTemplate" mixin="VeilmapFogPinMixin" virtual="true"/>
</Ui>
```

- [ ] **Step 2: Write the provider and pin**

Create `Fog/Provider.lua`:

```lua
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
	self.texturePool = CreateTexturePool(self, "ARTWORK", -1)
end

function VeilmapFogPinMixin:OnReleased()
	if self.texturePool then self.texturePool:ReleaseAll() end
end

-- entries: array of {width, height, offsetX, offsetY, areaID, "fileDataIDs"}
function VeilmapFogPinMixin:Draw(entries, layerInfo, r, g, b, a)
	self.texturePool:ReleaseAll()

	local canvas = self:GetMap()
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

local FogProvider = CreateFromMixins(MapCanvasDataProviderMixin)
Veilmap.FogProvider = FogProvider

function FogProvider:RemoveAllData()
	self:GetMap():RemoveAllPinsByTemplate("VeilmapFogPinTemplate")
end

function FogProvider:RefreshAllData(fromOnShow)
	self:RemoveAllData()

	local db = Veilmap.db
	if not db or not db.fogEnabled then return end

	local canvas = self:GetMap()
	local mapID = canvas:GetMapID()
	if not mapID then return end

	local artID = C_Map.GetMapArtID(mapID)
	local entries = artID and VeilmapFogData and VeilmapFogData[artID]
	if not entries then return end

	local layers = C_Map.GetMapArtLayers(mapID)
	local layerInfo = layers and layers[canvas:GetCanvasContainer():GetCurrentLayerIndex()]
	if not layerInfo then return end

	local explored = Geometry.BuildExploredKeySet(C_MapExplorationInfo.GetExploredMapTextures(mapID))

	local unexplored = {}
	for i = 1, #entries do
		local e = entries[i]
		if not explored[Geometry.OverlayKey(e[1], e[2], e[3], e[4])] then
			unexplored[#unexplored + 1] = e
		end
	end
	if #unexplored == 0 then return end

	local color = db.fogColor
	local pin = canvas:AcquirePin("VeilmapFogPinTemplate")
	pin:Draw(unexplored, layerInfo, color.r, color.g, color.b, color.a)
end

function Veilmap.OnReady()
	WorldMapFrame:AddDataProvider(FogProvider)
	if WorldMapFrame:IsShown() then
		FogProvider:RefreshAllData()
	end
end
```

- [ ] **Step 3: Add to the TOC**

In `Veilmap.toc`, after `Fog\Data_Forever.lua`:

```
Fog\FogPin.xml
Fog\Provider.lua
```

XML must precede the Lua that acquires pins from it.

- [ ] **Step 4: Smallest visible increment — prove one rectangle draws**

Temporarily cap the work in `RefreshAllData`, immediately before `local pin = canvas:AcquirePin(...)`:

```lua
	unexplored = { unexplored[1] }   -- TEMPORARY: Task 8 Step 4
```

In-game: `/reload`, open the world map on a zone with unexplored areas.
Expected: exactly one tinted dark-blue rectangle in an undiscovered part of the map, aligned to the map art (not offset, not stretched, not upside down).

If it is misaligned, the bug is in `SetPoint`/`SetTexCoord`, with only one rectangle to reason about. If nothing appears, check `/dump #VeilmapFogData[C_Map.GetMapArtID(WorldMapFrame:GetMapID())]`.

- [ ] **Step 5: Remove the cap and verify the full draw**

Delete the temporary line from Step 4.

In-game: `/reload`, open the map.
Expected: every undiscovered region tinted; already-discovered regions untouched and full-colour. Walking into a new area and reopening the map clears that patch's tint.

- [ ] **Step 6: Confirm FogOfWarPinTemplate is inert**

In-game:

```
/run for t,p in pairs(WorldMapFrame.pinPools) do print(t, p:GetNumActive()) end
```

Expected: `FogOfWarPinTemplate 0`, and `VeilmapFogPinTemplate 1`. This closes open question 1 in the spec.

- [ ] **Step 7: Commit**

```bash
cd /c/Projects/Veilmap
git add -A
git commit -m "Draw unexplored overlays via an independent map data provider"
```

---

### Task 9: Diagnostics command

**Files:**
- Modify: `Fog/Provider.lua`, `Core.lua`

**Interfaces:**
- Consumes: `Veilmap.Geometry`, `VeilmapFogData`
- Produces: `Veilmap.FogProvider:Report() -> table` with fields
  `mapID, artID, total, explored, unexplored, missingTiles`; `/veilmap verify`

- [ ] **Step 1: Add Report to Provider.lua**

Append to `Fog/Provider.lua`, before `function Veilmap.OnReady()`:

```lua
-- Coverage report for the current map. Used by /veilmap verify.
function FogProvider:Report()
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
```

- [ ] **Step 2: Add the command to Core.lua**

Append to `Core.lua`:

```lua
function handlers.verify()
	if not Veilmap.FogProvider then
		print("|cff33ff99Veilmap|r: fog provider not loaded")
		return
	end
	local r = Veilmap.FogProvider:Report()
	print("|cff33ff99Veilmap|r verify")
	print(("  map %s  art %s"):format(tostring(r.mapID), tostring(r.artID)))
	print(("  dataset: %d overlays (%d explored, %d unexplored)"):format(r.total, r.explored, r.unexplored))
	print(("  client reports %d explored textures"):format(r.liveCount))
	if r.missingTiles > 0 then
		print(("  |cffff5555%d entries have no tiles|r"):format(r.missingTiles))
	end
	if r.total == 0 then
		print("  |cffff5555no dataset for this map art|r")
	end
end
```

- [ ] **Step 3: Verify in-game**

In-game: open the map in a partially explored zone, run `/veilmap verify`.
Expected, for Elwynn Forest (art 2153):

```
  map 1429  art 2153
  dataset: 12 overlays (N explored, M unexplored)
  client reports N explored textures
```

The `explored` count and `client reports` count **must match**. A mismatch means the dataset and client disagree — investigate before proceeding.

- [ ] **Step 4: Survey coverage across zones**

Visit or open the map on at least six zones across different continents. Run `/veilmap verify` on each.
Expected: every zone reports a non-zero `dataset` line. Record any zone reporting `no dataset for this map art` — that indicates missing extraction coverage.

- [ ] **Step 5: Commit**

```bash
cd /c/Projects/Veilmap
git add -A
git commit -m "Add /veilmap verify coverage diagnostics"
```

---

### Task 10: Map frame — scale, drag and persistence

**Files:**
- Create: `MapFrame.lua`
- Modify: `Veilmap.toc`, `Fog/Provider.lua` (the `OnReady` hook)

**Interfaces:**
- Consumes: `Veilmap.db` (Task 3)
- Produces:
  - `Veilmap.MapFrame.Initialise()`
  - `Veilmap.MapFrame.ApplyScale()`, `.ApplyPosition()`, `.SavePosition()`

- [ ] **Step 1: Create MapFrame.lua**

```lua
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
	WorldMapFrame:SetPoint(p.point, UIParent, p.point, p.x, p.y)
end

function MapFrame.SavePosition()
	local db = Veilmap.db
	if not db or WorldMapFrame:IsMaximized() then return end
	local point, _, _, x, y = WorldMapFrame:GetPoint(1)
	db.position.point, db.position.x, db.position.y = point, x, y
end

local function onDragStart()
	if not WorldMapFrame:IsMaximized() then WorldMapFrame:StartMoving() end
end

local function onDragStop()
	WorldMapFrame:StopMovingOrSizing()
	MapFrame.SavePosition()
end

function MapFrame.Initialise()
	if initialised then return end
	initialised = true

	-- Take the map out of the UI panel layout system so it can sit anywhere.
	-- Attribute-only approach; see the spec's open question 3.
	WorldMapFrame:SetAttribute("UIPanelLayout-enabled", false)
	WorldMapFrame:SetAttribute("UIPanelLayout-area", nil)

	WorldMapFrame:SetMovable(true)
	WorldMapFrame:SetClampedToScreen(true)
	WorldMapFrame:RegisterForDrag("LeftButton")
	WorldMapFrame:HookScript("OnDragStart", onDragStart)
	WorldMapFrame:HookScript("OnDragStop", onDragStop)

	if WorldMapFrame.SynchronizeDisplayState then
		hooksecurefunc(WorldMapFrame, "SynchronizeDisplayState", function()
			MapFrame.ApplyScale()
			MapFrame.ApplyPosition()
		end)
	end

	MapFrame.ApplyScale()
	MapFrame.ApplyPosition()
end
```

- [ ] **Step 2: Add to the TOC and call from OnReady**

In `Veilmap.toc`, after `Fog\Provider.lua`:

```
MapFrame.lua
```

In `Fog/Provider.lua`, extend `Veilmap.OnReady`:

```lua
function Veilmap.OnReady()
	WorldMapFrame:AddDataProvider(FogProvider)
	Veilmap.MapFrame.Initialise()
	if WorldMapFrame:IsShown() then
		FogProvider:RefreshAllData()
	end
end
```

- [ ] **Step 3: Verify dragging and persistence in-game**

In-game: `/reload`, open the map, drag it by its frame to a corner, close it, `/reload`, reopen.
Expected: the map reopens where you left it.

- [ ] **Step 4: Verify scaling in-game**

In-game: `/run VeilmapDB.mapScale = 0.6; Veilmap.MapFrame.ApplyScale()`
Expected: the map shrinks immediately and stays draggable. Mouse interaction (hovering zones, clicking to change map) still lands on the right targets.

Then `/run VeilmapDB.mapScale = 1.0; Veilmap.MapFrame.ApplyScale()`.

- [ ] **Step 5: Check for taint**

In-game: enter combat (attack any hostile mob), open and close the map, then open the game menu with Escape.
Expected: no "Interface action failed because of an AddOn" error, and the menu opens normally. If it fails, the attribute-only panel approach is insufficient — record the exact error and consult spec open question 3 before escalating.

- [ ] **Step 6: Commit**

```bash
cd /c/Projects/Veilmap
git add -A
git commit -m "Make the world map movable and scalable with saved position"
```

---

### Task 11: Map frame — alpha and fade

**Files:**
- Modify: `MapFrame.lua`

**Interfaces:**
- Consumes: `Veilmap.db`
- Produces: `Veilmap.MapFrame.ApplyAlpha()`

- [ ] **Step 1: Add alpha handling to MapFrame.lua**

Append before `function MapFrame.Initialise()`:

```lua
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
```

- [ ] **Step 2: Call it from Initialise**

In `MapFrame.Initialise`, after `MapFrame.ApplyPosition()`:

```lua
	MapFrame.ApplyAlpha()
```

Also add an `OnShow` hook immediately above that line, so Blizzard cannot re-register the map with its own fader when the map is reopened:

```lua
	WorldMapFrame:HookScript("OnShow", MapFrame.ApplyAlpha)
```

- [ ] **Step 3: Verify base alpha in-game**

In-game: `/reload`, then `/run VeilmapDB.fadeWhenMoving = false; VeilmapDB.mapAlpha = 0.6; Veilmap.MapFrame.ApplyAlpha()`
Expected: the map becomes translucent and stays at 0.6 whether you stand still or move.

- [ ] **Step 4: Verify fade-on-move in-game**

In-game: `/run VeilmapDB.fadeWhenMoving = true; VeilmapDB.mapAlpha = 1.0; VeilmapDB.fadedAlpha = 0.3; Veilmap.MapFrame.ApplyAlpha()`
Expected: the map is opaque at rest; it smoothly fades toward 0.3 while running and returns to opaque when you stop. Hovering the mouse over the map keeps it opaque while moving.

- [ ] **Step 5: Commit**

```bash
cd /c/Projects/Veilmap
git add -A
git commit -m "Add map transparency with optional fade while moving"
```

---

### Task 12: Coordinates

**Files:**
- Create: `Coords.lua`
- Modify: `Veilmap.toc`, `Fog/Provider.lua` (`OnReady`)

**Interfaces:**
- Consumes: `Veilmap.db`
- Produces: `Veilmap.Coords.Initialise()`, `Veilmap.Coords.Refresh()`

- [ ] **Step 1: Create Coords.lua**

```lua
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
```

- [ ] **Step 2: Add to the TOC and call from OnReady**

In `Veilmap.toc`, after `MapFrame.lua`:

```
Coords.lua
```

In `Fog/Provider.lua`, extend `Veilmap.OnReady`:

```lua
	Veilmap.Coords.Initialise()
```

- [ ] **Step 3: Verify in-game**

In-game: `/reload`, open the map.
Expected: two readouts beneath the map. The left tracks your cursor as you move it across the map and blanks when the cursor leaves the canvas; the right shows your character's position and updates as you run.

- [ ] **Step 4: Verify precision and scale interaction**

In-game: `/run VeilmapDB.coordsPrecision = 2; Veilmap.Coords.Refresh()`
Expected: both readouts show two decimal places.

Then `/run VeilmapDB.mapScale = 0.7; Veilmap.MapFrame.ApplyScale()` and move the cursor over a known landmark.
Expected: cursor coordinates remain correct at non-default map scale. This is the case `GetEffectiveScale` exists to handle — if the numbers drift, the bug is in `cursorFraction`.

- [ ] **Step 5: Commit**

```bash
cd /c/Projects/Veilmap
git add -A
git commit -m "Add player and cursor coordinate readouts"
```

---

### Task 13: Options panel

**Files:**
- Create: `Options.lua`
- Modify: `Veilmap.toc`, `Fog/Provider.lua` (`OnReady`), `Core.lua`

**Interfaces:**
- Consumes: `Veilmap.db`, `Veilmap.MapFrame`, `Veilmap.Coords`, `Veilmap.FogProvider`
- Produces: `Veilmap.Options.Initialise()`, `Veilmap.Options.Open()`

- [ ] **Step 1: Create Options.lua**

```lua
--[[
Veilmap - Copyright (C) 2026 xElementzx
GPL-3.0-or-later. See LICENSE.

Settings panel, built on Blizzard's Settings API. No third-party config library.
]]

local ADDON, Veilmap = ...

local Options = {}
Veilmap.Options = Options

local category

-- Pushes a changed setting through to whatever renders it.
local function apply(key)
	if key == "fogEnabled" or key == "fogColor" then
		if Veilmap.FogProvider and WorldMapFrame:IsShown() then
			Veilmap.FogProvider:RefreshAllData()
		end
	elseif key == "mapScale" then
		Veilmap.MapFrame.ApplyScale()
	elseif key == "mapAlpha" or key == "fadedAlpha" or key == "fadeWhenMoving" then
		Veilmap.MapFrame.ApplyAlpha()
	else
		Veilmap.Coords.Refresh()
	end
end

local function addCheckbox(key, name, tooltip)
	local setting = Settings.RegisterProxySetting(
		category, "Veilmap_" .. key, Settings.VarType.Boolean, name,
		Veilmap.Config.defaults[key],
		function() return Veilmap.db[key] end,
		function(value) Veilmap.db[key] = value; apply(key) end
	)
	Settings.CreateCheckbox(category, setting, tooltip)
	return setting
end

local function addSlider(key, name, tooltip, min, max, step, formatter)
	local setting = Settings.RegisterProxySetting(
		category, "Veilmap_" .. key, Settings.VarType.Number, name,
		Veilmap.Config.defaults[key],
		function() return Veilmap.db[key] end,
		function(value) Veilmap.db[key] = value; apply(key) end
	)
	local options = Settings.CreateSliderOptions(min, max, step)
	options:SetLabelFormatter(MinimalSliderWithSteppersMixin.Label.Right, formatter)
	Settings.CreateSlider(category, setting, options, tooltip)
	return setting
end

local function percent(value)
	return ("%d%%"):format(math.floor(value * 100 + 0.5))
end

function Options.Open()
	Settings.OpenToCategory(category:GetID())
end

function Options.Initialise()
	if category then return end

	local layout
	category, layout = Settings.RegisterVerticalLayoutCategory("Veilmap")

	layout:AddInitializer(CreateSettingsListSectionHeaderInitializer("Fog of War"))
	addCheckbox("fogEnabled", "Show unexplored areas",
		"Draw undiscovered parts of the map, tinted, instead of hiding them.")

	-- Settings has no colour widget, so the swatch is a small custom button.
	local swatch = CreateFrame("Button", nil, UIParent)
	swatch:SetSize(20, 20)
	swatch.bg = swatch:CreateTexture(nil, "BACKGROUND")
	swatch.bg:SetAllPoints()
	swatch.bg:SetColorTexture(0, 0, 0, 1)
	swatch.fill = swatch:CreateTexture(nil, "ARTWORK")
	swatch.fill:SetPoint("TOPLEFT", 2, -2)
	swatch.fill:SetPoint("BOTTOMRIGHT", -2, 2)

	local function refreshSwatch()
		local c = Veilmap.db.fogColor
		swatch.fill:SetColorTexture(c.r, c.g, c.b, 1)
	end

	swatch:SetScript("OnClick", function()
		local c = Veilmap.db.fogColor
		local previous = { r = c.r, g = c.g, b = c.b, a = c.a }

		local function onChange()
			local r, g, b = ColorPickerFrame:GetColorRGB()
			c.r, c.g, c.b = r, g, b
			c.a = 1 - ColorPickerFrame:GetColorAlpha()
			refreshSwatch()
			apply("fogColor")
		end

		ColorPickerFrame:SetupColorPickerAndShow({
			r = c.r, g = c.g, b = c.b, opacity = 1 - c.a,
			hasOpacity = true,
			swatchFunc = onChange,
			opacityFunc = onChange,
			cancelFunc = function()
				c.r, c.g, c.b, c.a = previous.r, previous.g, previous.b, previous.a
				refreshSwatch()
				apply("fogColor")
			end,
		})
	end)
	refreshSwatch()
	Veilmap.Options.swatch = swatch

	layout:AddInitializer(CreateSettingsListSectionHeaderInitializer("Map Frame"))
	addSlider("mapScale", "Map scale", "Size of the world map.", 0.5, 2.0, 0.05, percent)
	addSlider("mapAlpha", "Map opacity", "Opacity of the map while you are standing still.", 0.1, 1.0, 0.05, percent)
	addCheckbox("fadeWhenMoving", "Fade while moving",
		"Fade the map toward the faded opacity while your character is moving.")
	addSlider("fadedAlpha", "Faded opacity", "Opacity of the map while you are moving.", 0.05, 1.0, 0.05, percent)

	layout:AddInitializer(CreateSettingsListSectionHeaderInitializer("Coordinates"))
	addCheckbox("coordsEnabled", "Show coordinates", "Show player and cursor coordinates beneath the map.")
	addSlider("coordsPrecision", "Decimal places", "Number of decimal places shown.", 0, 2, 1, tostring)
	addSlider("coordsFontSize", "Font size", "Size of the coordinate text.", 8, 20, 1, tostring)

	Settings.RegisterAddOnCategory(category)
end
```

The colour swatch is parented to `UIParent` rather than placed in the layout: `Settings` has no colour widget, and anchoring a custom frame into a vertical layout requires a canvas initializer. Step 3 confirms whether the swatch needs a proper home.

`ColorPickerFrame`'s opacity slider runs inverted relative to alpha — `1 - alpha` — which is why the conversions appear on every read and write.

- [ ] **Step 2: Add to the TOC, OnReady and the slash command**

In `Veilmap.toc`, after `Coords.lua`:

```
Options.lua
```

In `Fog/Provider.lua`, `Veilmap.OnReady` now reaches its final form:

```lua
function Veilmap.OnReady()
	WorldMapFrame:AddDataProvider(FogProvider)
	Veilmap.MapFrame.Initialise()
	Veilmap.Coords.Initialise()
	Veilmap.Options.Initialise()
	if WorldMapFrame:IsShown() then
		FogProvider:RefreshAllData()
	end
end
```

In `Core.lua`, add a handler and make it the default:

```lua
function handlers.config()
	Veilmap.Options.Open()
end
handlers[""] = handlers.config
```

- [ ] **Step 3: Verify the panel in-game**

In-game: `/reload`, then `/veilmap`.
Expected: the Settings window opens on a Veilmap category showing three sections with their checkboxes and sliders. Every slider shows a percentage or number on the right.

If the colour swatch is not visible or is floating loose on screen, replace the vertical layout with `Settings.RegisterCanvasLayoutCategory` and lay the controls out manually — both APIs were confirmed present.

- [ ] **Step 4: Verify each control takes effect immediately**

In-game, with the map open beside the Settings window:

- Toggle **Show unexplored areas** → tinted regions appear and disappear
- Click the colour swatch, pick a strong red, confirm → tint turns red immediately; **Cancel** on a second attempt restores the previous colour
- Drag **Map scale** → the map resizes live
- Drag **Map opacity** → the map's transparency changes live
- Toggle **Fade while moving** off, then run → the map no longer fades
- Toggle **Show coordinates** → readouts appear and disappear
- Drag **Decimal places** to 0 → coordinates show whole numbers

- [ ] **Step 5: Verify settings survive a reload**

In-game: change several settings, `/reload`, reopen the panel and the map.
Expected: every change persisted and is reflected both in the panel and on the map.

- [ ] **Step 6: Commit**

```bash
cd /c/Projects/Veilmap
git add -A
git commit -m "Add Settings panel for fog, map frame and coordinates"
```

---

### Task 14: Release readiness

**Files:**
- Create: `.luacheckrc`
- Modify: `README.md`, `Veilmap.toc`

**Interfaces:**
- Consumes: everything
- Produces: a tagged, installable addon

- [ ] **Step 1: Add the luacheck config**

Create `.luacheckrc`:

```lua
std = "lua51"
max_line_length = false
exclude_files = { "tools/node_modules", "Fog/Data_Forever.lua" }

globals = {
	"VeilmapDB", "VeilmapFogData", "VeilmapFogPinMixin",
	"SLASH_VEILMAP1", "SLASH_VEILMAP2",
}

read_globals = {
	"C_AddOns", "C_Map", "C_MapExplorationInfo", "C_Timer",
	"ColorPickerFrame", "CreateFrame", "CreateFromMixins", "CreateTexturePool",
	"CreateSettingsListSectionHeaderInitializer", "DeltaLerp", "GameFontNormal",
	"GetBuildInfo", "GetCursorPosition", "IsPlayerMoving",
	"MapCanvasDataProviderMixin", "MapCanvasPinMixin",
	"MinimalSliderWithSteppersMixin", "PLAYER", "PlayerMovementFrameFader",
	"Settings", "SlashCmdList", "UIParent", "WorldMapFrame",
	"hooksecurefunc", "strsplit",
}
```

This file is configuration for an optional tool; no task gates on luacheck being installed.

- [ ] **Step 2: Run the full test suite**

Run: `cd /c/Projects/Veilmap/tools && npm test`
Expected: PASS — every test across syntax, compat, config, csv, dataset, emit and geometry.

Record the actual counts rather than assuming them.

- [ ] **Step 3: Full manual smoke test from a clean profile**

Move the SavedVariables aside so the addon starts from defaults. Note the forward
slashes — this is a bash path, and the account directory contains a `#`, so it must
be quoted.

```bash
SV="/e/BattleNet Library/World of Warcraft/_classic_beta_/WTF/Account/254884087#1/SavedVariables"
mv "$SV/Veilmap.lua" "$SV/Veilmap.lua.bak"
```

Restore it afterwards with the reverse `mv` if you want your settings back.

In-game: `/reload`, then verify from defaults:

- No Lua errors on login
- `/veilmap` opens the panel
- `/veilmap verify` reports a dataset for the current map with matching explored counts
- The map opens, is draggable, and unexplored regions are tinted
- Coordinates track cursor and player

- [ ] **Step 4: Update the README with the verified numbers**

Replace the README's feature list intro with the real dataset figures from Task 6 Step 6:

```markdown
Fog data covers 84 map art IDs / 1073 overlays, generated from WoW build 1.60.1.69913.
```

- [ ] **Step 5: Set the release version**

In `Veilmap.toc`, set `## Version: 1.0.0`.

- [ ] **Step 6: Commit and tag**

```bash
cd /c/Projects/Veilmap
git add -A
git commit -m "Prepare 1.0.0 release"
git tag -a v1.0.0 -m "Veilmap 1.0.0 - fog tinting, map scale, alpha and coordinates for WoW Forever"
```

- [ ] **Step 7: Remove the probe addon**

The diagnostic addon from the design phase has served its purpose.

```bash
rm -rf "/e/BattleNet Library/World of Warcraft/_classic_beta_/Interface/AddOns/MapsterProbe"
```

Leave the `Veilmap` junction from Task 1 in place — that is how the addon is installed.

---

## Deferred

Not in this plan. Each gets its own spec and plan.

- **Phase 4 (stretch):** hover an unexplored patch → area name via `C_Map.GetAreaInfo`; optional tracked waypoint at its centroid via `C_Map.SetUserWaypoint` + `C_SuperTrack.SetSuperTrackedUserWaypoint`. The `areaID` is already in the dataset, so no re-extraction is needed.
- **Phase 5:** Retail support through the `Compat` seam — `genfogdata.mjs --build <retail>` plus a `Data_Retail.lua` and a TOC gate.
- **`Flags` semantics.** `WorldMapOverlay.Flags` holds `0` (519 rows) and `4` (562 rows). Meaning unknown, currently unused. Revisit only if rendering anomalies appear.
