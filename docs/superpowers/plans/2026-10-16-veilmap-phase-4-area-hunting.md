# Veilmap Implementation Plan — Phase 4: Unexplored-Area Hunting

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player hover an unexplored fog patch to see its area name, Alt-click it (or pick
it from a side list) to get a tracked waypoint, and have that waypoint clear itself on discovery.

**Architecture:** The generator emits two more fields per fog entry (area-ID list, hit rect).
A new pure module `Fog/Areas.lua` holds all the hit-testing, grouping and sorting maths and is
unit-tested under wasmoon. The world-map fog provider publishes the unexplored set it already
computes, and three thin WoW-facing modules (`Waypoint`, `Hover`, `AreaList`) consume it. None
of them adds a mouse-enabled frame to the map canvas, and none hooks a `WorldMapFrame` method.

**Tech Stack:** Lua 5.1 (WoW Forever client), Blizzard `C_Map` / `C_SuperTrack` / `GameTooltip`
/ MapCanvas APIs, Node 24 (`node --test`), `wasmoon` + `luaparse` (dev-only).

**Spec:** `docs/superpowers/specs/2026-10-16-veilmap-phase-4-area-hunting-design.md`
(parent: `docs/superpowers/specs/2026-09-22-veilmap-design.md`)

## Global Constraints

- **Branch:** all work happens on `feature/phase-4-area-hunting`. Never commit to `main`.
- **Interface `16001`**, data build **`1.60.1.69913`**. Do not change the data build.
- **Zero third-party runtime dependencies.** Blizzard APIs only. Dev dependencies under `tools/` are fine.
- **GPL-3.0-or-later.** Every new `.lua` / `.mjs` file starts with the short GPL header used by its neighbours.
- **Lua 5.1 syntax only.** No `goto`, `//`, `<const>`, `<close>`, or bitwise operators. Tests run on Lua 5.4 and will accept these silently; `syntax.test.mjs` catches them.
- **Pure modules use the dual-load pattern:** `local ADDON, Veilmap = ...`, then `Veilmap = Veilmap or {}`, and the file ends with `return <Module>`. They must not call any WoW API.
- **Never `hooksecurefunc` a `WorldMapFrame` method.** It breaks Blizzard's Minimize on this client (see `MapFrame.lua`). Use `HookScript` on frame scripts only.
- **No mouse-enabled frames on the map canvas.** The fog pin stays click-through.
- **Error-handling rule (parent spec):** wrap only canvas/API calls whose surface we can't vouch for in `pcall`, and report each message once. Never wrap Veilmap's own logic (`Areas`, `Geometry`, dataset reads).
- **Chat message prefix:** `|cff33ff99Veilmap|r: ` (same as `Core.lua`).
- **UI text is plain ASCII.** No em dashes in anything the game renders.
- **World map only.** The battlefield-map provider must not publish, hover or list.
- **Run tests from `tools/`:** `cd tools && npm test`. All 68 existing tests must keep passing.
- **Commit messages** end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Overlapping and nested hit rects.** The player expects the patch that looks like it's under the cursor, i.e. the smallest containing rect. *(Task 2: HitTest overlap and tie tests.)*
2. **A player waypoint that isn't ours.** If the player re-pins somewhere by hand, discovery must never clear their pin. *(Task 2: `Areas.PointMatches` tolerance tests; Task 4 uses it.)*
3. **Player not on the displayed map** (browsing another zone, or in an instance). The list must fall back to alphabetical, not sort by garbage distances. *(Task 2: Sort with `player == nil`.)*
4. **Areas the client has no name for.** They must show as `Area <id>` and sort last, not render blank rows or error on `nil .. string`. *(Task 2: DisplayName and Sort-unnamed tests.)*
5. **A fully explored zone, or a zone with one area left.** The header must read `All explored` or `Unexplored: 1 area`, never `0 areas` or `1 areas`. *(Task 2: `Areas.Summary` tests.)*

## File Structure

| Path | Change | Responsibility |
|---|---|---|
| `tools/lib/dataset.mjs` | Modify | Emit `areaIDs` (non-zero `AreaID_0..3`) and `hitRect` (zero → bounds fallback) |
| `tools/lib/emit.mjs` | Modify | Write the new entry format |
| `tools/tests/dataset.test.mjs`, `emit.test.mjs` | Modify | Cover the new fields; adapt to the format change |
| `Fog/Data_Forever.lua` | Regenerate | New format, same coverage |
| `Fog/Areas.lua` | **Create** | **Pure.** Hit-test, group, centre, sort, display name, summary, point match |
| `tools/tests/areas.test.mjs` | **Create** | Unit tests for `Areas` |
| `Fog/Provider.lua` | Modify | Publish unexplored set, `AreaName`, pin texture tracking + highlight, live refresh on exploration |
| `Coords.lua` | Modify | Expose `Coords.CursorFraction` |
| `Fog/Waypoint.lua` | **Create** | Set, track, clear-on-discovery |
| `Fog/Hover.lua` | **Create** | Cursor polling, tooltip, Alt-click |
| `Fog/AreaList.lua` | **Create** | Collapsible side panel |
| `Config.lua`, `Options.lua` | Modify | `areaTooltips`, `areaListEnabled`, `areaListCollapsed` |
| `Veilmap.toc` | Modify | Load order; version `1.1.0` at release |
| `.luacheckrc` | Modify | New globals |
| `docs/ingame-checks-phase-4.md` | **Create** | In-game checklist |
| `media/CURSEFORGE.md` | Modify | Feature section |

Final `Veilmap.toc` file list (built up across tasks):

```
Compat.lua
Config.lua
Fog\Geometry.lua
Fog\Areas.lua
Fog\Data_Forever.lua
Fog\FogPin.xml
Fog\Provider.lua
Fog\Waypoint.lua
Fog\Hover.lua
Fog\AreaList.lua
MapFrame.lua
Coords.lua
Options.lua
Core.lua
```

---

### Task 1: Generator emits area-ID lists and hit rects

**Files:**
- Modify: `tools/lib/dataset.mjs`
- Modify: `tools/lib/emit.mjs`
- Modify: `tools/tests/dataset.test.mjs`
- Modify: `tools/tests/emit.test.mjs`
- Regenerate: `Fog/Data_Forever.lua`

**Interfaces:**
- Produces: each dataset entry is `{ width, height, offsetX, offsetY, areaIDs: number[], fileDataIDs: number[], hitRect: [left, top, right, bottom] }`. The emitted Lua entry is `{w,h,x,y,{areaIDs...},"fileDataIDs",{left,top,right,bottom}}`. `areaIDs` is never empty.

- [ ] **Step 1: Update the existing dataset tests and add new ones**

In `tools/tests/dataset.test.mjs`, the existing tests use `e.areaID`. Replace each
`x.areaID === N` / `e.areaID === 999` with the `areaIDs[0]` form, then add the new tests.
The full file becomes:

```js
// Veilmap - GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseCsv } from '../lib/csv.mjs';
import { buildDataset } from '../lib/dataset.mjs';

const fixture = (name) =>
  readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8').then(parseCsv);

// Minimal overlay row with every column the generator reads. Values are strings,
// as parseCsv produces them.
function overlayRow(fields) {
  return {
    ID: '1', UiMapArtID: '7', TextureWidth: '100', TextureHeight: '50',
    OffsetX: '10', OffsetY: '20',
    HitRectTop: '0', HitRectBottom: '0', HitRectLeft: '0', HitRectRight: '0',
    AreaID_0: '5', AreaID_1: '0', AreaID_2: '0', AreaID_3: '0',
    ...fields,
  };
}
const tileFor = (id) => ({ ID: '1', RowIndex: '0', ColIndex: '0', FileDataID: '42', WorldMapOverlayID: id });

test('buildDataset', async (t) => {
  const overlays = await fixture('overlay-2153.csv');
  const tiles = await fixture('tile-2153.csv');
  const ds = buildDataset(overlays, tiles);

  await t.test('groups entries under their UiMapArtID', () => {
    assert.deepEqual([...ds.keys()], [2153]);
  });

  await t.test('drops overlays that have no tiles', () => {
    assert.equal(ds.get(2153).length, 3);
    assert.ok(!ds.get(2153).some((e) => e.areaIDs[0] === 999));
  });

  await t.test('matches the live client for overlay 5157', () => {
    // Verified against C_MapExplorationInfo.GetExploredMapTextures on 1.60.1.69913.
    const e = ds.get(2153).find((x) => x.areaIDs[0] === 18);
    assert.deepEqual(
      { w: e.width, h: e.height, x: e.offsetX, y: e.offsetY },
      { w: 256, h: 256, x: 422, y: 332 },
    );
    assert.deepEqual(e.fileDataIDs, [272806]);
  });

  await t.test('orders tiles by RowIndex then ColIndex', () => {
    const e = ds.get(2153).find((x) => x.areaIDs[0] === 60);
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

  await t.test('reads the hit rect as [left, top, right, bottom]', () => {
    // Fixture row 5157: HitRectTop=380 Bottom=475 Left=450 Right=605.
    const e = ds.get(2153).find((x) => x.areaIDs[0] === 18);
    assert.deepEqual(e.hitRect, [450, 380, 605, 475]);
  });

  await t.test('collects every non-zero AreaID column, in column order', () => {
    const d = buildDataset(
      [overlayRow({ AreaID_0: '61', AreaID_1: '0', AreaID_2: '63', AreaID_3: '62' })],
      [tileFor('1')],
    );
    assert.deepEqual(d.get(7)[0].areaIDs, [61, 63, 62]);
  });

  await t.test('a single-area overlay yields a one-element list', () => {
    const d = buildDataset([overlayRow({})], [tileFor('1')]);
    assert.deepEqual(d.get(7)[0].areaIDs, [5]);
  });

  await t.test('an all-zero hit rect falls back to the overlay bounds', () => {
    const d = buildDataset([overlayRow({})], [tileFor('1')]);
    // offset (10, 20), size 100 x 50
    assert.deepEqual(d.get(7)[0].hitRect, [10, 20, 110, 70]);
  });

  await t.test('a partly-zero hit rect is kept as-is', () => {
    const d = buildDataset(
      [overlayRow({ HitRectLeft: '0', HitRectTop: '0', HitRectRight: '30', HitRectBottom: '40' })],
      [tileFor('1')],
    );
    assert.deepEqual(d.get(7)[0].hitRect, [0, 0, 30, 40]);
  });
});
```

- [ ] **Step 2: Run the dataset tests to verify they fail**

Run: `cd tools && node --test tests/dataset.test.mjs`
Expected: FAIL. The `areaIDs` and `hitRect` tests fail, e.g. `TypeError: Cannot read properties of undefined (reading '0')`.

- [ ] **Step 3: Implement the dataset change**

In `tools/lib/dataset.mjs`, add two helpers below `const num = ...`:

```js
const AREA_COLUMNS = ['AreaID_0', 'AreaID_1', 'AreaID_2', 'AreaID_3'];

// Every non-zero area the overlay covers, in column order. AreaID_0 is
// non-zero on every Forever row, so this is never empty in practice.
function areaIDsOf(overlay) {
  return AREA_COLUMNS.map((c) => num(overlay[c])).filter((id) => id !== 0);
}

// [left, top, right, bottom] in map-art pixels. Rows whose hit rect is all
// zeros fall back to the overlay's own bounds, so the Lua side never needs a
// fallback of its own.
function hitRectOf(overlay, width, height, offsetX, offsetY) {
  const rect = [
    num(overlay.HitRectLeft),
    num(overlay.HitRectTop),
    num(overlay.HitRectRight),
    num(overlay.HitRectBottom),
  ];
  if (rect.every((v) => v === 0)) return [offsetX, offsetY, offsetX + width, offsetY + height];
  return rect;
}
```

and replace the `entries.push({...})` block with:

```js
    const width = num(overlay.TextureWidth);
    const height = num(overlay.TextureHeight);
    const offsetX = num(overlay.OffsetX);
    const offsetY = num(overlay.OffsetY);
    entries.push({
      width,
      height,
      offsetX,
      offsetY,
      areaIDs: areaIDsOf(overlay),
      fileDataIDs: tiles.map((t) => num(t.FileDataID)),
      hitRect: hitRectOf(overlay, width, height, offsetX, offsetY),
    });
```

- [ ] **Step 4: Run the dataset tests to verify they pass**

Run: `cd tools && node --test tests/dataset.test.mjs`
Expected: PASS (all subtests).

- [ ] **Step 5: Update the emit tests for the new format**

In `tools/tests/emit.test.mjs`:

1. In `'produces Lua that loads and yields the expected table'`, change `if e[5] == 18 then` to `if e[5][1] == 18 then`.
2. In `'joins multiple file data IDs with commas'`, change `if e[5] == 60 then` to `if e[5][1] == 60 then`.
3. In both `throws when ...` tests, replace `areaID: 18` with `areaIDs: [18], hitRect: [0, 0, 1, 1]`.
4. Change the header assertion test to also check the documented format:

```js
  await t.test('records the source build and entry format in a header comment', () => {
    assert.match(source, /1\.60\.1\.69913/);
    assert.match(source, /do not edit/i);
    assert.match(source, /\{areaIDs\}/);
    assert.match(source, /hitLeft, hitTop, hitRight, hitBottom/);
  });
```

5. Append these tests inside the `test('emitLua', ...)` body:

```js
  await t.test('emits the area-ID list and hit rect as Lua tables', async () => {
    const lua = await new LuaFactory().createEngine();
    try {
      lua.doStringSync(source);
      const row = lua.doStringSync(`
        for _, e in ipairs(VeilmapFogData[2153]) do
          if e[5][1] == 18 then
            return #e[5] .. "|" .. table.concat(e[7], ",")
          end
        end
      `);
      assert.equal(row, '1|450,380,605,475');
    } finally {
      lua.global.close();
    }
  });

  await t.test('emits every area of a multi-area overlay', () => {
    const multi = new Map([
      [7, [{ width: 1, height: 1, offsetX: 0, offsetY: 0, areaIDs: [61, 62], fileDataIDs: [1], hitRect: [0, 0, 1, 1] }]],
    ]);
    const out = emitLua(multi, { build: '1.60.1.69913', generatedFrom: 'wago.tools' });
    assert.match(out, /\{1,1,0,0,\{61,62\},"1",\{0,0,1,1\}\},/);
  });

  await t.test('throws when an area ID is not finite', () => {
    const bad = new Map([
      [7, [{ width: 1, height: 1, offsetX: 0, offsetY: 0, areaIDs: [NaN], fileDataIDs: [1], hitRect: [0, 0, 1, 1] }]],
    ]);
    assert.throws(
      () => emitLua(bad, { build: '1.60.1.69913', generatedFrom: 'wago.tools' }),
      /expected a finite number for areaID/,
    );
  });

  await t.test('throws when a hit rect value is not finite', () => {
    const bad = new Map([
      [7, [{ width: 1, height: 1, offsetX: 0, offsetY: 0, areaIDs: [5], fileDataIDs: [1], hitRect: [0, NaN, 1, 1] }]],
    ]);
    assert.throws(
      () => emitLua(bad, { build: '1.60.1.69913', generatedFrom: 'wago.tools' }),
      /expected a finite number for hitRect/,
    );
  });
```

- [ ] **Step 6: Run the emit tests to verify they fail**

Run: `cd tools && node --test tests/emit.test.mjs`
Expected: FAIL (the emitter still writes the old format and asserts `e.areaID`).

- [ ] **Step 7: Implement the emit change**

In `tools/lib/emit.mjs`, change the header format line to:

```js
  out.push('[UiMapArtID] = { {width, height, offsetX, offsetY, {areaIDs}, "fileDataIDs", {hitLeft, hitTop, hitRight, hitBottom}}, ... }');
```

and replace the per-entry block inside `for (const e of dataset.get(art))` with:

```js
      assertFinite('width', e.width);
      assertFinite('height', e.height);
      assertFinite('offsetX', e.offsetX);
      assertFinite('offsetY', e.offsetY);
      for (const id of e.areaIDs) assertFinite('areaID', id);
      for (const id of e.fileDataIDs) assertFinite('fileDataID', id);
      for (const v of e.hitRect) assertFinite('hitRect', v);
      out.push(
        `\t\t{${e.width},${e.height},${e.offsetX},${e.offsetY},{${e.areaIDs.join(',')}},"${e.fileDataIDs.join(',')}",{${e.hitRect.join(',')}}},`,
      );
```

- [ ] **Step 8: Run the whole suite**

Run: `cd tools && npm test`
Expected: PASS. All tests pass, including `genfogdata.test.mjs` and `syntax.test.mjs`.

- [ ] **Step 9: Regenerate the shipped data**

Run (from the repo root): `node tools/genfogdata.mjs --build 1.60.1.69913 --out Fog/Data_Forever.lua`
Expected output ends with `-> 84 map art IDs, 1073 overlays (8 dropped as tile-less)` and `Wrote ...Data_Forever.lua`.

Check the result:
`grep -c '^\t\t{' Fog/Data_Forever.lua` → `1073`
`grep -cE ',\{[0-9]+(,[0-9]+)+\},"' Fog/Data_Forever.lua` → between `60` and `68`. These are rows with more than one area ID: an area list containing a comma, followed by the quoted file IDs, so the hit rect (followed by `}}`) can't match. The raw table has 68 such rows, and a few may be among the 8 tile-less rows that get dropped.
`sed -n '30,32p' Fog/Data_Forever.lua` → lines like `{445,160,244,0,{1637},"271435,271442",{...}},`

If the overlay count isn't 1073, or the multi-area count is outside 60–68, stop and report. That would mean the build's data changed, not our code.

- [ ] **Step 10: Run the suite again and commit**

Run: `cd tools && npm test` → PASS (`syntax.test.mjs` re-parses the regenerated file as Lua 5.1).

```bash
git add tools/lib/dataset.mjs tools/lib/emit.mjs tools/tests/dataset.test.mjs tools/tests/emit.test.mjs Fog/Data_Forever.lua
git commit -m "Emit area-ID lists and hit rects in the fog dataset

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `Fog/Areas.lua` pure module

**Files:**
- Create: `Fog/Areas.lua`
- Create: `tools/tests/areas.test.mjs`
- Modify: `Veilmap.toc` (add `Fog\Areas.lua` after `Fog\Geometry.lua`)

**Interfaces:**
- Consumes: entries in the Task 1 format: `e[5]` = area-ID list, `e[7]` = `{left, top, right, bottom}`.
- Produces (all on `Veilmap.Areas`):
  - `Areas.HitTest(entries, px, py)` → entry or `nil`. Inclusive edges; the smallest rect area wins; a tie goes to the earlier entry.
  - `Areas.Group(entries)` → array of `{ areaID = number, entries = {entry...}, largest = entry }`, in first-seen order.
  - `Areas.Centre(entry, layerW, layerH)` → `x, y` in 0–1.
  - `Areas.Sort(groups, names, player, layerW, layerH)` → `groups` sorted in place. `names` is `{[areaID] = string|nil}`; `player` is `{x=, y=}` or `nil`.
  - `Areas.DisplayName(name, areaID)` → `name` or `"Area <id>"`.
  - `Areas.Summary(count)` → `"All explored"`, `"Unexplored: 1 area"`, `"Unexplored: N areas"`.
  - `Areas.PointMatches(ax, ay, bx, by)` → boolean; true when both axes are within `0.0001`.

- [ ] **Step 1: Write the failing tests**

Create `tools/tests/areas.test.mjs`:

```js
// Veilmap - GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { evalInLuaModule } from './helpers/lua.mjs';

const run = (snippet) => evalInLuaModule('Fog/Areas.lua', snippet);

// Builds a Lua entry in the shipped format: {w,h,x,y,{areaIDs},"files",{l,t,r,b}}.
// Only fields 5 and 7 matter to Areas; the rest are filler.
const E = (ids, l, t, r, b) => `{0,0,0,0,{${ids.join(',')}},"",{${l},${t},${r},${b}}}`;

test('Areas.HitTest', async (t) => {
  await t.test('returns the entry containing the point', async () => {
    const r = await run(`
      local a = ${E([1], 0, 0, 10, 10)}
      return Areas.HitTest({ a }, 5, 5) == a and "hit" or "miss"
    `);
    assert.equal(r, 'hit');
  });

  await t.test('returns nil outside every rect', async () => {
    const r = await run(`return Areas.HitTest({ ${E([1], 0, 0, 10, 10)} }, 11, 5) == nil and "nil" or "hit"`);
    assert.equal(r, 'nil');
  });

  await t.test('edges are inclusive on all four sides', async () => {
    const r = await run(`
      local a = ${E([1], 10, 20, 30, 40)}
      local n = 0
      for _, p in ipairs({ {10, 25}, {30, 25}, {15, 20}, {15, 40} }) do
        if Areas.HitTest({ a }, p[1], p[2]) == a then n = n + 1 end
      end
      return n
    `);
    assert.equal(r, 4);
  });

  await t.test('the smallest containing rect wins when rects overlap', async () => {
    const r = await run(`
      local big = ${E([1], 0, 0, 100, 100)}
      local small = ${E([2], 40, 40, 60, 60)}
      return Areas.HitTest({ big, small }, 50, 50)[5][1]
    `);
    assert.equal(r, 2);
  });

  await t.test('equal-area overlap goes to the earlier entry', async () => {
    const r = await run(`
      local first = ${E([1], 0, 0, 10, 10)}
      local second = ${E([2], 5, 5, 15, 15)}
      return Areas.HitTest({ first, second }, 7, 7)[5][1]
    `);
    assert.equal(r, 1);
  });

  await t.test('an empty list returns nil', async () => {
    const r = await run('return Areas.HitTest({}, 1, 1) == nil and "nil" or "hit"');
    assert.equal(r, 'nil');
  });
});

test('Areas.Group', async (t) => {
  await t.test('one group per area ID, in first-seen order', async () => {
    const r = await run(`
      local g = Areas.Group({ ${E([7], 0, 0, 1, 1)}, ${E([3], 0, 0, 1, 1)}, ${E([7], 0, 0, 2, 2)} })
      return #g .. ":" .. g[1].areaID .. "," .. g[2].areaID .. ":" .. #g[1].entries .. "," .. #g[2].entries
    `);
    assert.equal(r, '2:7,3:2,1');
  });

  await t.test('a multi-area entry joins every group it names', async () => {
    const r = await run(`
      local shared = ${E([1, 2], 0, 0, 5, 5)}
      local g = Areas.Group({ shared })
      return #g .. ":" .. (g[1].entries[1] == shared and "y" or "n") .. (g[2].entries[1] == shared and "y" or "n")
    `);
    assert.equal(r, '2:yy');
  });

  await t.test('largest is the entry with the biggest hit rect, ties to the earlier', async () => {
    const r = await run(`
      local a = ${E([1], 0, 0, 10, 10)}
      local b = ${E([1], 0, 0, 20, 20)}
      local c = ${E([1], 50, 50, 70, 70)}
      local g = Areas.Group({ a, b, c })
      return g[1].largest == b and "b" or "other"
    `);
    assert.equal(r, 'b');
  });
});

test('Areas.Centre', async (t) => {
  await t.test('normalizes the hit-rect centre by the layer size', async () => {
    const r = await run(`
      local x, y = Areas.Centre(${E([1], 100, 50, 300, 150)}, 1000, 500)
      return x .. "," .. y
    `);
    assert.equal(r, '0.2,0.2');
  });
});

test('Areas.Sort', async (t) => {
  // Layer 1000 x 500, player at the centre. A's centre is (0.5, 0.7): 0.2 away
  // in raw 0-1 units but 100 px. B's centre is (0.65, 0.5): 0.15 raw but 150 px.
  // Correct (pixel) order is A then B; raw 0-1 order would be B then A.
  const aspectSetup = `
    local a = ${E([1], 490, 340, 510, 360)}
    local b = ${E([2], 640, 240, 660, 260)}
    local groups = Areas.Group({ b, a })
  `;

  await t.test('sorts by distance in layer pixels when the player is on the map', async () => {
    const r = await run(`${aspectSetup}
      Areas.Sort(groups, {}, { x = 0.5, y = 0.5 }, 1000, 500)
      return groups[1].areaID .. "," .. groups[2].areaID
    `);
    assert.equal(r, '1,2');
  });

  await t.test('equal distances break ties on area ID', async () => {
    const r = await run(`
      local groups = Areas.Group({ ${E([9], 0, 0, 10, 10)}, ${E([4], 0, 0, 10, 10)} })
      Areas.Sort(groups, {}, { x = 0.9, y = 0.9 }, 100, 100)
      return groups[1].areaID .. "," .. groups[2].areaID
    `);
    assert.equal(r, '4,9');
  });

  await t.test('sorts alphabetically when there is no player position', async () => {
    const r = await run(`
      local groups = Areas.Group({ ${E([1], 0, 0, 1, 1)}, ${E([2], 0, 0, 1, 1)}, ${E([3], 0, 0, 1, 1)} })
      Areas.Sort(groups, { [1] = "Brook", [2] = "Arch", [3] = "Crag" }, nil, 100, 100)
      return groups[1].areaID .. "," .. groups[2].areaID .. "," .. groups[3].areaID
    `);
    assert.equal(r, '2,1,3');
  });

  await t.test('alphabetical order ignores case', async () => {
    const r = await run(`
      local groups = Areas.Group({ ${E([1], 0, 0, 1, 1)}, ${E([2], 0, 0, 1, 1)} })
      Areas.Sort(groups, { [1] = "beta", [2] = "Alpha" }, nil, 100, 100)
      return groups[1].areaID .. "," .. groups[2].areaID
    `);
    assert.equal(r, '2,1');
  });

  await t.test('unnamed areas sort last, then by ID', async () => {
    const r = await run(`
      local groups = Areas.Group({ ${E([9], 0, 0, 1, 1)}, ${E([5], 0, 0, 1, 1)}, ${E([2], 0, 0, 1, 1)} })
      Areas.Sort(groups, { [2] = "Zed" }, nil, 100, 100)
      return groups[1].areaID .. "," .. groups[2].areaID .. "," .. groups[3].areaID
    `);
    assert.equal(r, '2,5,9');
  });

  await t.test('identical names break ties on ID', async () => {
    const r = await run(`
      local groups = Areas.Group({ ${E([8], 0, 0, 1, 1)}, ${E([3], 0, 0, 1, 1)} })
      Areas.Sort(groups, { [8] = "Same", [3] = "Same" }, nil, 100, 100)
      return groups[1].areaID .. "," .. groups[2].areaID
    `);
    assert.equal(r, '3,8');
  });
});

test('Areas.DisplayName', async (t) => {
  await t.test('uses the name when there is one', async () => {
    assert.equal(await run('return Areas.DisplayName("Goldshire", 87)'), 'Goldshire');
  });
  await t.test('falls back to "Area <id>" for nil or empty names', async () => {
    assert.equal(await run('return Areas.DisplayName(nil, 87)'), 'Area 87');
    assert.equal(await run('return Areas.DisplayName("", 87)'), 'Area 87');
  });
});

test('Areas.Summary', async (t) => {
  await t.test('zero reads All explored', async () => {
    assert.equal(await run('return Areas.Summary(0)'), 'All explored');
  });
  await t.test('one is singular', async () => {
    assert.equal(await run('return Areas.Summary(1)'), 'Unexplored: 1 area');
  });
  await t.test('many is plural', async () => {
    assert.equal(await run('return Areas.Summary(4)'), 'Unexplored: 4 areas');
  });
});

test('Areas.PointMatches', async (t) => {
  await t.test('identical points match', async () => {
    assert.equal(await run('return Areas.PointMatches(0.25, 0.5, 0.25, 0.5) and "y" or "n"'), 'y');
  });
  await t.test('float noise within 0.0001 matches', async () => {
    assert.equal(await run('return Areas.PointMatches(0.25, 0.5, 0.25009, 0.49991) and "y" or "n"'), 'y');
  });
  await t.test('a re-pinned point elsewhere does not match', async () => {
    assert.equal(await run('return Areas.PointMatches(0.25, 0.5, 0.2502, 0.5) and "y" or "n"'), 'n');
    assert.equal(await run('return Areas.PointMatches(0.25, 0.5, 0.25, 0.4) and "y" or "n"'), 'n');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd tools && node --test tests/areas.test.mjs`
Expected: FAIL with `ENOENT ... Fog/Areas.lua`.

- [ ] **Step 3: Implement `Fog/Areas.lua`**

```lua
--[[
Veilmap - Copyright (C) 2026 xElementzx
GPL-3.0-or-later. See LICENSE.

Pure logic for unexplored-area hunting: which patch is under a point, which
patches make up an area, where to put a waypoint, and how to order the list.
No WoW API calls, so this is unit-testable.

Entries are fog dataset rows: e[5] is the list of area IDs the overlay
covers, e[7] its hit rect {left, top, right, bottom} in map-art pixels.
]]

local ADDON, Veilmap = ...
Veilmap = Veilmap or {}

local Areas = {}
Veilmap.Areas = Areas

local abs = math.abs

-- Waypoint coordinates round-trip through the client as floats, so an exact
-- comparison would treat our own waypoint as foreign.
local POINT_TOLERANCE = 0.0001

local function rectArea(entry)
	local r = entry[7]
	return (r[3] - r[1]) * (r[4] - r[2])
end

-- The entry whose hit rect contains (px, py), edges inclusive. Rects overlap,
-- so the smallest one wins: that is the patch that looks like it is under the
-- cursor. Strict < keeps the earlier entry on a tie.
function Areas.HitTest(entries, px, py)
	local best, bestArea
	for i = 1, #entries do
		local entry = entries[i]
		local r = entry[7]
		if px >= r[1] and px <= r[3] and py >= r[2] and py <= r[4] then
			local area = rectArea(entry)
			if not best or area < bestArea then
				best, bestArea = entry, area
			end
		end
	end
	return best
end

-- One group per area ID, in first-seen order. An overlay covering several
-- areas joins each of their groups. largest is the waypoint target for the
-- group: a centroid of several patches can land somewhere meaningless.
function Areas.Group(entries)
	local groups, byID = {}, {}
	for i = 1, #entries do
		local entry = entries[i]
		local ids = entry[5]
		for j = 1, #ids do
			local id = ids[j]
			local group = byID[id]
			if not group then
				group = { areaID = id, entries = {} }
				byID[id] = group
				groups[#groups + 1] = group
			end
			group.entries[#group.entries + 1] = entry
			if not group.largest or rectArea(entry) > rectArea(group.largest) then
				group.largest = entry
			end
		end
	end
	return groups
end

-- Hit-rect centre as a 0-1 map coordinate.
function Areas.Centre(entry, layerW, layerH)
	local r = entry[7]
	return (r[1] + r[3]) / 2 / layerW, (r[2] + r[4]) / 2 / layerH
end

-- With a player position: nearest first, measured in layer pixels so the
-- map's aspect ratio does not skew it. Without one: alphabetical, ignoring
-- case, with unnamed areas last. Both modes break ties on area ID.
function Areas.Sort(groups, names, player, layerW, layerH)
	if player then
		local distance = {}
		for i = 1, #groups do
			local group = groups[i]
			local x, y = Areas.Centre(group.largest, layerW, layerH)
			local dx, dy = (x - player.x) * layerW, (y - player.y) * layerH
			distance[group] = dx * dx + dy * dy
		end
		table.sort(groups, function(a, b)
			if distance[a] ~= distance[b] then return distance[a] < distance[b] end
			return a.areaID < b.areaID
		end)
	else
		table.sort(groups, function(a, b)
			local na, nb = names[a.areaID], names[b.areaID]
			if na and nb then
				na, nb = na:lower(), nb:lower()
				if na ~= nb then return na < nb end
			elseif na then
				return true
			elseif nb then
				return false
			end
			return a.areaID < b.areaID
		end)
	end
	return groups
end

function Areas.DisplayName(name, areaID)
	if name and name ~= "" then return name end
	return "Area " .. areaID
end

function Areas.Summary(count)
	if count == 0 then return "All explored" end
	if count == 1 then return "Unexplored: 1 area" end
	return "Unexplored: " .. count .. " areas"
end

function Areas.PointMatches(ax, ay, bx, by)
	return abs(ax - bx) <= POINT_TOLERANCE and abs(ay - by) <= POINT_TOLERANCE
end

return Areas
```

Note on `Sort`'s alphabetical branch: an empty-string name counts as a name. That's fine, because names come from `C_Map.GetAreaInfo`, which returns `nil`, not `""`, for unknown IDs.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd tools && node --test tests/areas.test.mjs`
Expected: PASS.

- [ ] **Step 5: Add to the TOC, run the full suite, commit**

In `Veilmap.toc`, insert `Fog\Areas.lua` on the line after `Fog\Geometry.lua`.

Run: `cd tools && npm test` → PASS (`syntax.test.mjs` now also checks `Fog/Areas.lua` as Lua 5.1).

```bash
git add Fog/Areas.lua tools/tests/areas.test.mjs Veilmap.toc
git commit -m "Add pure Areas module for hit-testing, grouping and sorting

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Provider publishes the unexplored set; pin highlight; cursor helper

**Files:**
- Modify: `Fog/Provider.lua`
- Modify: `Coords.lua`
- Modify: `.luacheckrc`

**Interfaces:**
- Consumes: the Task 1 entry format.
- Produces:
  - `Veilmap.FogProvider:GetUnexplored()` → `nil` or `{ mapID = number, layerWidth = number, layerHeight = number, unexplored = {entry...} }`. `unexplored` may be empty (fully explored zone). The entry tables are the same objects as in `VeilmapFogData`, so they can be used as table keys.
  - `Veilmap.OnFogRefreshed` — optional callback slot. The world-map provider calls it (no args) after every completed refresh, but not after a combat-deferred one.
  - `Veilmap.FogProvider:Highlight(entries)` / `Veilmap.FogProvider:ClearHighlight()`.
  - `Veilmap.AreaName(areaID)` → string (`C_Map.GetAreaInfo` name, or `"Area <id>"`).
  - `Veilmap.Coords.CursorFraction()` → `fx, fy` in 0–1, or `nil` when off-canvas.
  - The fog now also refreshes live on `MAP_EXPLORATION_UPDATED`.

There is no WoW runtime under test, so this task is verified by the syntax tests and by the in-game checklist (Task 7). Keep edits exactly as shown.

- [ ] **Step 1: Expose the cursor helper in `Coords.lua`**

Directly after the `local function cursorFraction() ... end` block, add:

```lua
-- Shared with Fog/Hover.lua, which hit-tests fog patches under the cursor.
Coords.CursorFraction = cursorFraction
```

- [ ] **Step 2: Track textures per entry in the pin, and add highlight**

In `Fog/Provider.lua`, change `VeilmapFogPinMixin:OnReleased` to:

```lua
function VeilmapFogPinMixin:OnReleased()
	if self.texturePool then self.texturePool:ReleaseAll() end
	self.entryTextures = nil
	self.highlighted = nil
end
```

In `VeilmapFogPinMixin:Draw`:
- Update the comment above it to `-- entries: array of {width, height, offsetX, offsetY, {areaIDs}, "fileDataIDs", {hitRect}}`.
- After `self.texturePool:ReleaseAll()`, add:

```lua
	-- Which textures draw which entry, so the area list can highlight an
	-- area's patches without redrawing. Keyed by the dataset entry table.
	self.entryTextures = {}
	self.highlighted = nil
	self.baseColor = { r = r, g = g, b = b, a = a }
```

- Inside the `for i = 1, #entries do` loop, after `local entry = entries[i]`, add:

```lua
		local textures = {}
		self.entryTextures[entry] = textures
```

- After `texture:Show()`, add `textures[#textures + 1] = texture`.

Then add, after the `Draw` function:

```lua
-- How far the highlight lifts the fog colour toward white.
local HIGHLIGHT_LIFT = 0.6

function VeilmapFogPinMixin:Highlight(entries)
	self:ClearHighlight()
	if not self.entryTextures then return end
	local c = self.baseColor
	local r = c.r + (1 - c.r) * HIGHLIGHT_LIFT
	local g = c.g + (1 - c.g) * HIGHLIGHT_LIFT
	local b = c.b + (1 - c.b) * HIGHLIGHT_LIFT
	for i = 1, #entries do
		local textures = self.entryTextures[entries[i]]
		if textures then
			for j = 1, #textures do
				textures[j]:SetVertexColor(r, g, b)
				textures[j]:SetAlpha(1)
			end
		end
	end
	self.highlighted = entries
end

function VeilmapFogPinMixin:ClearHighlight()
	local entries = self.highlighted
	if not entries or not self.entryTextures then return end
	local c = self.baseColor
	for i = 1, #entries do
		local textures = self.entryTextures[entries[i]]
		if textures then
			for j = 1, #textures do
				textures[j]:SetVertexColor(c.r, c.g, c.b)
				textures[j]:SetAlpha(c.a)
			end
		end
	end
	self.highlighted = nil
end
```

- [ ] **Step 3: Split `RefreshAllData` into a combat gate plus `Rebuild`, and publish**

Replace the whole `function FogProviderMixin:RefreshAllData(fromOnShow) ... end` with the two
functions below. The body of `Rebuild` is the old body, minus the combat check, with
`self.pin` / `self.current` bookkeeping added and `mapID` returned from the guarded read.

```lua
function FogProviderMixin:RefreshAllData(fromOnShow)
	-- Acquiring or drawing our pin reaches Blizzard's MapCanvasPinMixin setup,
	-- which calls the protected Frame:SetPassThroughButtons; doing that from
	-- our insecure code taints that call chain and gets blocked in combat.
	-- Releasing pins may also reach protected code, so we bail before
	-- touching anything, not just before drawing, and pick the refresh back
	-- up once combat ends. Both canvases need this independently. The
	-- published unexplored set (self.current) is deliberately left as it was,
	-- so hover and the area list keep working on the last good data.
	if InCombatLockdown() then
		self.refreshPending = true
		return
	end

	self:Rebuild()

	if self.publishes and Veilmap.OnFogRefreshed then
		Veilmap.OnFogRefreshed()
	end
end

function FogProviderMixin:Rebuild()
	self:RemoveAllData()
	self.pin = nil
	self.current = nil

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
	local readOk, entriesOrErr, layerInfo, live, mapID = pcall(function()
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
		return entries, layerInfo, live, mapID
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

	-- Published before the empty check: a fully explored zone is still a
	-- zone with fog data, and the area list shows "All explored" for it.
	self.current = {
		mapID = mapID,
		layerWidth = layerInfo.layerWidth,
		layerHeight = layerInfo.layerHeight,
		unexplored = unexplored,
	}
	if #unexplored == 0 then return end

	-- Guarded draw: AcquirePin/Draw reach canvas and pin-pool APIs, guarded
	-- for the same reason as the read above.
	local color = db.fogColor
	local drawOk, drawErr = pcall(function()
		local pin = self:GetMap():AcquirePin("VeilmapFogPinTemplate")
		pin:Draw(unexplored, layerInfo, color.r, color.g, color.b, color.a)
		self.pin = pin
	end)
	if not drawOk then
		self:ReportDrawError(drawErr)
	end
end

-- The latest unexplored set for this canvas, or nil when it has no fog data
-- (or fog is off). See Rebuild for when it changes.
function FogProviderMixin:GetUnexplored()
	return self.current
end

-- Pure texture recolouring on our own pin: no protected calls, safe in combat.
function FogProviderMixin:Highlight(entries)
	if self.pin then self.pin:Highlight(entries) end
end

function FogProviderMixin:ClearHighlight()
	if self.pin then self.pin:ClearHighlight() end
end
```

- [ ] **Step 4: Mark the world-map instance as the publisher; add `AreaName` and the exploration watcher**

Change `CreateFogProvider` to take the flag:

```lua
-- enabledSetting: the Veilmap.db key that switches fog on for this canvas
-- ("fogEnabled" for the world map, "fogBattlefieldMap" for the battlefield map).
-- publishes: true only for the world map, whose unexplored set drives hover,
-- waypoints and the area list (Veilmap.OnFogRefreshed).
local function CreateFogProvider(enabledSetting, publishes)
	local provider = CreateFromMixins(FogProviderMixin)
	-- Per-instance, not module-level: see the comment above FogProviderMixin.
	provider.warnedDrawErrors = {}
	provider.refreshPending = false
	provider.enabledSetting = enabledSetting
	provider.publishes = publishes
	fogProviderInstances[#fogProviderInstances + 1] = provider
	return provider
end

-- Veilmap.FogProvider must keep resolving to the WORLD MAP instance: Core.lua's
-- /veilmap verify calls Veilmap.FogProvider:Report(), and hover, waypoints and
-- the area list read Veilmap.FogProvider:GetUnexplored().
Veilmap.FogProvider = CreateFogProvider("fogEnabled", true)
local BattlefieldFogProvider = CreateFogProvider("fogBattlefieldMap", false)
```

Directly after `function Veilmap.RefreshFog() ... end`, add:

```lua
-- Display name for an area ID; "Area <id>" when the client has none.
function Veilmap.AreaName(areaID)
	return Veilmap.Areas.DisplayName(C_Map.GetAreaInfo(areaID), areaID)
end

-- Blizzard's own exploration pin refreshes itself on discovery, but the
-- canvas does not refresh other providers, so without this our fog (and the
-- area list) would only catch up the next time the map is opened.
-- RefreshFog only touches canvases that are showing, and RefreshAllData
-- defers itself in combat.
local explorationWatcher = CreateFrame("Frame")
explorationWatcher:RegisterEvent("MAP_EXPLORATION_UPDATED")
explorationWatcher:SetScript("OnEvent", function()
	Veilmap.RefreshFog()
end)
```

- [ ] **Step 5: Update `.luacheckrc`**

Do not add `Veilmap` to the globals: the addon table is never read as a global. Replace `read_globals` with this list, which adds the API names used from this task onward (Tasks 4–6 rely on it too):

```lua
read_globals = {
	"BattlefieldMapFrame", "C_AddOns", "C_Map", "C_MapExplorationInfo", "C_SuperTrack", "C_Timer",
	"ColorPickerFrame", "CreateFrame", "CreateFromMixins", "CreateTexturePool",
	"CreateSettingsButtonInitializer", "CreateSettingsListSectionHeaderInitializer",
	"DeltaLerp", "GameFontNormal", "GameTooltip", "GetBuildInfo", "GetCursorPosition",
	"GetMouseFoci", "InCombatLockdown", "IsAltKeyDown", "IsPlayerMoving",
	"MapCanvasDataProviderMixin", "MapCanvasPinMixin",
	"MinimalSliderWithSteppersMixin", "PLAYER", "PlayerMovementFrameFader",
	"Settings", "UIParent", "UiMapPoint", "WorldMapFrame",
	"strsplit",
}
```

- [ ] **Step 6: Run the suite and commit**

Run: `cd tools && npm test` → PASS.
If `luacheck` is installed (`luacheck --version`), also run `luacheck .` → `0 warnings / 0 errors`. It isn't installed on the dev machine today; skip it if absent and say so in the task report.

```bash
git add Fog/Provider.lua Coords.lua .luacheckrc
git commit -m "Publish the world map's unexplored set and add fog highlighting

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `Fog/Waypoint.lua`

**Files:**
- Create: `Fog/Waypoint.lua`
- Modify: `Veilmap.toc` (add `Fog\Waypoint.lua` after `Fog\Provider.lua`)

**Interfaces:**
- Consumes: `Veilmap.FogProvider:GetUnexplored()`, `Veilmap.AreaName`, `Veilmap.Areas.Centre`, `Veilmap.Areas.PointMatches`, `Veilmap.Geometry.OverlayKey`, `Veilmap.Geometry.BuildExploredKeySet`.
- Produces: `Veilmap.Waypoint.Set(entry)`. Sets a tracked waypoint at the entry's hit-rect centre on the current world-map map, or prints why not.

- [ ] **Step 1: Create `Fog/Waypoint.lua`**

```lua
--[[
Veilmap - Copyright (C) 2026 xElementzx
GPL-3.0-or-later. See LICENSE.

A tracked waypoint to an unexplored patch, cleared once the patch is
discovered. Only a waypoint Veilmap set itself is ever cleared: if the player
has re-pinned since, theirs is left alone.
]]

local ADDON, Veilmap = ...
local Areas = Veilmap.Areas
local Geometry = Veilmap.Geometry

local Waypoint = {}
Veilmap.Waypoint = Waypoint

local PREFIX = "|cff33ff99Veilmap|r: "

-- { mapID, x, y, key, names } for the waypoint we set, or nil.
local ours

-- The waypoint API is guarded like the canvas calls in Provider.lua: one
-- report per distinct message, never repeated.
local warned = {}
local function reportError(err)
	local message = tostring(err)
	if not warned[message] then
		warned[message] = true
		print(PREFIX .. "waypoint failed: " .. message)
	end
end

local function namesOf(entry)
	local ids, names = entry[5], {}
	for i = 1, #ids do
		names[i] = Veilmap.AreaName(ids[i])
	end
	return table.concat(names, ", ")
end

function Waypoint.Set(entry)
	-- A blocked protected call shows Blizzard's "action blocked" popup rather
	-- than raising an error we could catch, so refuse up front.
	if InCombatLockdown() then
		print(PREFIX .. "can't set a waypoint in combat.")
		return
	end

	local current = Veilmap.FogProvider:GetUnexplored()
	if not current then return end

	local mapID = current.mapID
	local x, y = Areas.Centre(entry, current.layerWidth, current.layerHeight)

	local ok, result = pcall(function()
		if not C_Map.CanSetUserWaypointOnMap(mapID) then return false end
		C_Map.SetUserWaypoint(UiMapPoint.CreateFromCoordinates(mapID, x, y))
		C_SuperTrack.SetSuperTrackedUserWaypoint(true)
		return true
	end)
	if not ok then
		reportError(result)
		return
	end
	if not result then
		print(PREFIX .. "waypoints aren't available on this map.")
		return
	end

	ours = {
		mapID = mapID,
		x = x,
		y = y,
		key = Geometry.OverlayKey(entry[1], entry[2], entry[3], entry[4]),
		names = namesOf(entry),
	}
	print(PREFIX .. "waypoint set to " .. ours.names .. ".")
end

-- Reads the live waypoint and explored textures for our map. Guarded API
-- calls only; the comparison logic below stays unguarded.
local function readLive(mapID)
	return pcall(function()
		return C_Map.GetUserWaypoint(), C_MapExplorationInfo.GetExploredMapTextures(mapID)
	end)
end

local function onExplorationUpdated()
	if not ours then return end

	local ok, point, live = readLive(ours.mapID)
	if not ok then
		reportError(point)
		return
	end

	local stillOurs = point and point.uiMapID == ours.mapID
		and Areas.PointMatches(point.position.x, point.position.y, ours.x, ours.y)
	if not stillOurs then
		-- The player replaced or removed it. Not ours to touch any more.
		ours = nil
		return
	end

	if not Geometry.BuildExploredKeySet(live)[ours.key] then return end

	local names = ours.names
	ours = nil
	local cleared, err = pcall(C_Map.ClearUserWaypoint)
	if not cleared then
		reportError(err)
		return
	end
	print(PREFIX .. "discovered " .. names .. ", waypoint cleared.")
end

local watcher = CreateFrame("Frame")
watcher:RegisterEvent("MAP_EXPLORATION_UPDATED")
watcher:SetScript("OnEvent", onExplorationUpdated)
```

- [ ] **Step 2: Add to the TOC, run the suite, commit**

In `Veilmap.toc`, add `Fog\Waypoint.lua` on the line after `Fog\Provider.lua`.

Run: `cd tools && npm test` → PASS.

```bash
git add Fog/Waypoint.lua Veilmap.toc
git commit -m "Add tracked waypoints to unexplored patches, cleared on discovery

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `Fog/Hover.lua`, the tooltip setting and Alt-click

**Files:**
- Create: `Fog/Hover.lua`
- Modify: `Veilmap.toc` (add `Fog\Hover.lua` after `Fog\Waypoint.lua`)
- Modify: `Config.lua`, `Options.lua`, `Fog/Provider.lua` (`Veilmap.OnReady`)
- Test: `tools/tests/config.test.mjs`

**Interfaces:**
- Consumes: `Veilmap.FogProvider:GetUnexplored()`, `Veilmap.Coords.CursorFraction()`, `Veilmap.Areas.HitTest`, `Veilmap.AreaName`, `Veilmap.Waypoint.Set`.
- Produces: `Veilmap.Hover.Initialise()`, `Veilmap.Hover.Refresh()`; setting `areaTooltips` (boolean, default `true`).

- [ ] **Step 1: Write the failing config test**

Append inside `test('Config.Merge', ...)` in `tools/tests/config.test.mjs`:

```js
  await t.test('phase 4 settings default on, with the list expanded', async () => {
    const result = await evalInLuaModule('Config.lua', `
      local m = Config.Merge(nil, Config.defaults)
      return tostring(m.areaTooltips) .. "/" .. tostring(m.areaListEnabled) .. "/" .. tostring(m.areaListCollapsed)
    `);
    assert.equal(result, 'true/true/false');
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd tools && node --test tests/config.test.mjs`
Expected: FAIL, `'nil/nil/nil' !== 'true/true/false'`.

- [ ] **Step 3: Add the defaults**

In `Config.lua`, inside `Config.defaults`, after `fogBattlefieldMap = true,` add:

```lua

	-- Unexplored-area hunting (world map only)
	areaTooltips = true,
	areaListEnabled = true,
	areaListCollapsed = false,
```

Run: `cd tools && node --test tests/config.test.mjs` → PASS.

All three keys go in now, together. Task 6 uses the other two.

- [ ] **Step 4: Create `Fog/Hover.lua`**

```lua
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
```

- [ ] **Step 5: Wire up the setting and initialisation**

In `Options.lua`, add a branch to `apply(key)`, before the final `else`:

```lua
	elseif key == "areaTooltips" then
		Veilmap.Hover.Refresh()
```

In `Options.Initialise`, after the `Fog colour` button initializer and before the `Map Frame` header, add:

```lua
	addCheckbox("areaTooltips", "Area tooltips and Alt-click waypoints",
		"Hover an unexplored area on the World Map to see its name. Alt-click it to set a tracked waypoint to it (this replaces your current map pin).")
```

In `Fog/Provider.lua`, inside `function Veilmap.OnReady()`, after `Veilmap.Coords.Initialise()` add:

```lua
	Veilmap.Hover.Initialise()
```

In `Veilmap.toc`, add `Fog\Hover.lua` on the line after `Fog\Waypoint.lua`.

- [ ] **Step 6: Run the suite and commit**

Run: `cd tools && npm test` → PASS.

```bash
git add Fog/Hover.lua Config.lua Options.lua Fog/Provider.lua Veilmap.toc tools/tests/config.test.mjs
git commit -m "Name unexplored areas on hover and set waypoints with Alt-click

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `Fog/AreaList.lua`, the side panel

**Files:**
- Create: `Fog/AreaList.lua`
- Modify: `Veilmap.toc` (add `Fog\AreaList.lua` after `Fog\Hover.lua`)
- Modify: `Options.lua`, `Fog/Provider.lua` (`Veilmap.OnReady`)

**Interfaces:**
- Consumes: `Veilmap.FogProvider:GetUnexplored()`, `:Highlight(entries)`, `:ClearHighlight()`, `Veilmap.OnFogRefreshed` (slot), `Veilmap.Areas.Group/Sort/DisplayName/Summary`, `Veilmap.Waypoint.Set`, settings `areaListEnabled` and `areaListCollapsed` (added in Task 5).
- Produces: `Veilmap.AreaList.Initialise()`, `Veilmap.AreaList.Refresh()`.

- [ ] **Step 1: Create `Fog/AreaList.lua`**

```lua
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

local NEXT_PAGE = "Interface\\Buttons\\UI-SpellbookIcon-NextPage-"
local PREV_PAGE = "Interface\\Buttons\\UI-SpellbookIcon-PrevPage-"

local tab, panel, header, scroll, content
local rows = {}

-- Outside the right edge normally. Maximized, that edge is off-screen, so
-- dock inside the canvas's top-right corner and open inwards.
local function anchor()
	tab:ClearAllPoints()
	panel:ClearAllPoints()
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
	Veilmap.Waypoint.Set(row.group.largest)
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
		player = { x = x, y = y }
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
```

- [ ] **Step 2: Wire up the setting and initialisation**

In `Options.lua`, add a branch to `apply(key)`, before the final `else` (after the `areaTooltips` branch from Task 5):

```lua
	elseif key == "areaListEnabled" then
		Veilmap.AreaList.Refresh()
```

In `Options.Initialise`, directly after the `areaTooltips` checkbox, add:

```lua
	addCheckbox("areaListEnabled", "Unexplored areas list",
		"Show a list of the zone's unexplored areas beside the World Map. Click an area to set a waypoint to it.")
```

In `Fog/Provider.lua`, inside `Veilmap.OnReady()`, after `Veilmap.Hover.Initialise()` add:

```lua
	Veilmap.AreaList.Initialise()
```

This must come **before** the `if WorldMapFrame:IsShown() then Veilmap.FogProvider:RefreshAllData() end` already in `OnReady`, so that the first refresh reaches the list. It does, because `Hover`/`AreaList` initialisation sits with `Coords.Initialise`, above that line.

In `Veilmap.toc`, add `Fog\AreaList.lua` on the line after `Fog\Hover.lua`.

- [ ] **Step 3: Run the suite and commit**

Run: `cd tools && npm test` → PASS.

```bash
git add Fog/AreaList.lua Options.lua Fog/Provider.lua Veilmap.toc
git commit -m "Add a collapsible list of unexplored areas beside the world map

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: In-game checklist, version and store page

**Files:**
- Create: `docs/ingame-checks-phase-4.md`
- Modify: `Veilmap.toc` (`## Version: 1.1.0`)
- Modify: `media/CURSEFORGE.md`

**Interfaces:** none (docs and metadata).

- [ ] **Step 1: Write `docs/ingame-checks-phase-4.md`**

```markdown
# Veilmap phase 4: in-game checks

Run these on WoW Forever with the branch build installed, before merging to `main`.
Use a character with a partly explored zone (a fresh character in Elwynn Forest is ideal).
Chat lines must stay under 255 characters; the `/run` lines below do.

| # | Check | Pass when |
|---|---|---|
| 1 | Alt + left-click on empty map (no fog) on a zone map | Nothing happens. Blizzard has no native Alt-click there. If it does something, note what. |
| 2 | Enter combat, then Alt-click a fog patch | Chat: `Veilmap: can't set a waypoint in combat.` No "action blocked" popup. |
| 3 | Open the map (not maximized) | Tab and panel sit outside the map's right edge, below the title bar. Nothing Blizzard overlaps them (open the quest log too). |
| 4 | Hover a quest POI or flight master that sits over fog | Blizzard's tooltip shows, not Veilmap's. |
| 5 | Hover patch edges in Elwynn, Westfall and one Kalimdor zone | The tooltip appears roughly where the tinted patch is. |
| 6 | Alt-click a patch, walk into it | Arrow and distance show while walking. On discovery: `Veilmap: discovered <name>, waypoint cleared.` and the pin is gone. |
| 7 | Alt-click a patch, then Ctrl-click elsewhere to re-pin by hand, then discover the first patch | Your hand-placed pin stays. No Veilmap message. |
| 8 | Hover a multi-area patch | Every area name is listed. Find one with `/vm verify` plus trial, or look for any tooltip with two white lines. |
| 9 | List in your own zone, then browse to another zone | Own zone: nearest first. Other zone: alphabetical. |
| 10 | Hover a list row | That area's patches brighten. Moving off restores the tint. |
| 11 | Click a list row | Waypoint set, with the chat confirmation. |
| 12 | Maximize the map | Tab and panel move inside the top-right corner and open inwards. Restoring moves them back outside. |
| 13 | Continent map, dungeon map | No tab, no panel, no tooltips. |
| 14 | Fully explore a small area set, or use a fully explored zone | Header reads `All explored`. |
| 15 | Toggle both new options off and on in `/vm` | Tooltips and the list disappear and return without `/reload`. |
| 16 | Tab arrow textures | Arrows render (not green squares). |
| 17 | Explore a new area with the map open | The fog patch disappears and the list updates without reopening the map. |

Useful one-liners:

    /run local c=Veilmap.FogProvider:GetUnexplored() print(c and c.mapID, c and #c.unexplored, c and c.layerWidth, c and c.layerHeight)
    /run local p=C_Map.GetUserWaypoint() print(p and p.uiMapID, p and p.position.x, p and p.position.y)
```

- [ ] **Step 2: Bump the version**

In `Veilmap.toc`, change `## Version: 1.0.0` to `## Version: 1.1.0`.

- [ ] **Step 3: Update the CurseForge description**

In `media/CURSEFORGE.md`, insert this section directly after the `### Tinted fog of war` bullet list (before `### Movable, scalable map`):

```markdown
### Hunt down unexplored areas
- **Hover** a fogged patch on the World Map to see the name of the area it hides.
- **Alt-click** a patch to set a tracked waypoint to it, with the on-screen arrow and distance.
- An **unexplored areas list** beside the map shows what's left in the zone, nearest first. Click an area to set a waypoint, or hover it to highlight it on the map.
- When you discover the area, Veilmap **clears the waypoint** for you. A pin you placed yourself is never touched.
- Each feature has its own toggle in the settings.
```

- [ ] **Step 4: Run the suite and commit**

Run: `cd tools && npm test` → PASS.

```bash
git add docs/ingame-checks-phase-4.md Veilmap.toc media/CURSEFORGE.md
git commit -m "Add phase 4 in-game checklist and prepare 1.1.0

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

Do **not** merge to `main` or tag. That happens only after the user runs the in-game checklist.
