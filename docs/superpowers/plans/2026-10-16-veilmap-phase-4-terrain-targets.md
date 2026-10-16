# Veilmap Implementation Plan — Phase 4 Amendment: Terrain-Accurate Waypoint Targets

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Waypoints point at ground whose terrain area ID actually triggers the area's discovery, instead of at the centre of the map art.

**Architecture:** A new offline generator step parses the game's root terrain tiles (ADTs) from wago.tools, keeps up to 8 spread-out chunk centres per fog area ID, and emits `Fog/Targets_Forever.lua`. In game, `Waypoint.lua` converts those world positions to map coordinates with `C_Map.GetMapPosFromWorldPos` and picks the one nearest the clicked patch, falling back to the hit-rect centre.

**Tech Stack:** Node 24 (`node --test`), wasmoon, Lua 5.1, `C_Map.GetMapPosFromWorldPos`, `CreateVector2D`.

**Spec:** `docs/superpowers/specs/2026-10-16-veilmap-phase-4-area-hunting-design.md`, section 12 (and sections 1–11 for context).
**Continues:** `docs/superpowers/plans/2026-10-16-veilmap-phase-4-area-hunting.md` (Tasks 1–7, done). Tasks here are numbered 8–11.

## Global Constraints

- **Branch:** `feature/phase-4-area-hunting`. Never commit to `main`.
- **Build `1.60.1.69913`.** Continents: `azeroth` = continent ID `0`, `kalimdor` = continent ID `1`.
- **Terrain maths (verified on 512 chunks):** `T = 1600 / 3`, `C = T / 16`. An MCNK header stores the chunk's top-left world position as floats at header offset `0x68` (worldX) and `0x6C` (worldY). Its area ID is a uint32 at header offset `0x34`, and `indexX`/`indexY` are uint32s at `0x04`/`0x08`. The chunk centre is `(worldX − C/2, worldY − C/2)`. For tile file `map_<tileX>_<tileY>.adt`: `worldX = 32·T − tileY·T − indexY·C`, `worldY = 32·T − tileX·T − indexX·C`.
- **Downloads are cached outside the repo** (a `--cache` directory the user passes). Never write terrain files into the repo. Cache only parsed per-tile JSON, never the raw ADTs.
- **At most 8 sample points per area.**
- **Lua 5.1 only. Zero runtime dependencies. GPL-3.0-or-later headers.** Never `hooksecurefunc` a `WorldMapFrame` method.
- **Run tests from `tools/`:** `cd tools && npm test`. All 115 existing tests must keep passing.
- **Commit messages** end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Areas with no terrain chunks** (WMO-only areas such as building interiors and caves). The waypoint must fall back to the hit-rect centre, never to nothing. *(Task 11: `Areas.Nearest` returns nil on an empty list, and `targetFor` falls back.)*
2. **Sample points that land off the displayed map** (an area straddling a zone border). They must be ignored, not used as targets. *(Task 11: filtered with `Areas.OnMap`.)*
3. **An area found on both continents** (shouldn't happen, but area IDs are just numbers in the data). Keep the continent with more chunks, deterministically. *(Task 9: `collectAreaChunks` test.)*
4. **Determinism.** Re-running the generator must produce a byte-identical file, or every regeneration becomes a noisy diff. *(Task 9: sampling and emit determinism tests.)*
5. **An interrupted download run** must resume without re-fetching finished tiles and without leaving a corrupt cache file. *(Task 10: writeAtomic for cache files, and cache hits skip the fetch.)*

## File Structure

| Path | Change | Responsibility |
|---|---|---|
| `tools/lib/adt.mjs` | Create | Parse MCNK headers from a root ADT buffer |
| `tools/tests/fixtures/azeroth_32_49-mcnk.adt` | Create | Real tile trimmed to MVER + MCNK headers |
| `tools/tests/adt.test.mjs` | Create | Parser and formula tests |
| `tools/lib/targets.mjs` | Create | Collect chunks per area, sample, emit Lua |
| `tools/tests/targets.test.mjs` | Create | Collect, sample, emit tests |
| `tools/gentargets.mjs` | Create | CLI: list, fetch (cached), parse, emit |
| `Fog/Targets_Forever.lua` | Generate | `VeilmapAreaTargets` |
| `Fog/Areas.lua` | Modify | `Areas.Nearest` |
| `Fog/Waypoint.lua` | Modify | Terrain targeting with fallback; `Set(entry, areaIDs)` |
| `Fog/AreaList.lua` | Modify | Pass the group's area ID |
| `Veilmap.toc`, `.luacheckrc` | Modify | Load the new data file; globals and exclude |
| `docs/ingame-checks-phase-4.md` | Modify | New checks |

---

### Task 8: ADT chunk parser

**Files:**
- Create: `tools/lib/adt.mjs`
- Create: `tools/tests/fixtures/azeroth_32_49-mcnk.adt` (binary)
- Create: `tools/tests/adt.test.mjs`

**Interfaces:**
- Produces: `parseAdtChunks(buffer) → Array<{ indexX, indexY, areaID, x, y }>`, where `x`/`y` are the world-yard chunk **centre**. `CHUNK_SIZE` and `TILE_SIZE` are exported constants.

- [ ] **Step 1: Make the fixture**

Download the real tile (file ID `778032`, `world/maps/azeroth/azeroth_32_49.adt`) into a scratch directory **outside the repo**:

```bash
curl -s -L -A "veilmap-tools/1" "https://wago.tools/api/casc/778032?download&version=1.60.1.69913" -o <scratch>/778032.adt
```

Then trim it to its `MVER` chunk plus each `MCNK` chunk cut down to its 128-byte header, with the chunk's size field rewritten to 128. Run from the repo root:

```bash
node -e '
const fs = require("fs");
const src = fs.readFileSync(process.argv[1]);
const out = [];
for (let o = 0; o + 8 <= src.length; ) {
  const magic = src.toString("ascii", o, o + 4);
  const size = src.readUInt32LE(o + 4);
  if (magic === "REVM") out.push(src.subarray(o, o + 8 + size));
  if (magic === "KNCM") {
    const head = Buffer.from(src.subarray(o, o + 8 + 128));
    head.writeUInt32LE(128, 4);
    out.push(head);
  }
  o += 8 + size;
}
fs.writeFileSync("tools/tests/fixtures/azeroth_32_49-mcnk.adt", Buffer.concat(out));
' <scratch>/778032.adt
```

Expected: a file of `12 + 256 × 136 = 34828` bytes.

- [ ] **Step 2: Write the failing tests**

Create `tools/tests/adt.test.mjs`:

```js
// Veilmap - GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseAdtChunks, CHUNK_SIZE, TILE_SIZE } from '../lib/adt.mjs';

const fixture = () => readFile(new URL('./fixtures/azeroth_32_49-mcnk.adt', import.meta.url));

test('parseAdtChunks', async (t) => {
  const chunks = parseAdtChunks(await fixture());

  await t.test('reads all 256 chunks of a tile', () => {
    assert.equal(chunks.length, 256);
  });

  await t.test('reads area IDs from the header', () => {
    const counts = {};
    for (const c of chunks) counts[c.areaID] = (counts[c.areaID] ?? 0) + 1;
    // Verified against the full tile: Goldshire 87 x16, Crystal Lake 18 x133.
    assert.equal(counts[87], 16);
    assert.equal(counts[18], 133);
  });

  await t.test('chunk centres match the tile/index formula', () => {
    // File azeroth_32_49: tileX = 32, tileY = 49.
    for (const c of chunks) {
      const x = 32 * TILE_SIZE - 49 * TILE_SIZE - c.indexY * CHUNK_SIZE - CHUNK_SIZE / 2;
      const y = 32 * TILE_SIZE - 32 * TILE_SIZE - c.indexX * CHUNK_SIZE - CHUNK_SIZE / 2;
      assert.ok(Math.abs(c.x - x) < 0.01, `x for ${c.indexX},${c.indexY}`);
      assert.ok(Math.abs(c.y - y) < 0.01, `y for ${c.indexX},${c.indexY}`);
    }
  });

  await t.test('Goldshire chunks centre on Goldshire', () => {
    const g = chunks.filter((c) => c.areaID === 87);
    const cx = g.reduce((s, c) => s + c.x, 0) / g.length;
    const cy = g.reduce((s, c) => s + c.y, 0) / g.length;
    assert.ok(Math.abs(cx - -9440) < 5 && Math.abs(cy - -40) < 5, `${cx}, ${cy}`);
  });

  await t.test('an empty or non-ADT buffer yields no chunks', () => {
    assert.deepEqual(parseAdtChunks(Buffer.alloc(0)), []);
    assert.deepEqual(parseAdtChunks(Buffer.from('{"error":"not found"}')), []);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd tools && node --test tests/adt.test.mjs`
Expected: FAIL with `Cannot find module ... lib/adt.mjs`.

- [ ] **Step 4: Implement `tools/lib/adt.mjs`**

```js
// Veilmap - GPL-3.0-or-later
// Reads the per-chunk area IDs from a root ADT terrain tile. Discovery in the
// game is triggered by these area IDs, not by the world map's overlay art.

export const TILE_SIZE = 1600 / 3; // yards per ADT tile
export const CHUNK_SIZE = TILE_SIZE / 16; // yards per MCNK chunk

const HEADER = 8; // chunk magic + size
const MCNK_HEADER_MIN = 0x74; // through the position vector

// Chunk magics are stored byte-reversed on disk ("KNCM" for MCNK).
const MCNK = 'KNCM';

export function parseAdtChunks(buffer) {
  const chunks = [];
  let offset = 0;
  while (offset + HEADER <= buffer.length) {
    const magic = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + HEADER;
    if (magic === MCNK && size >= MCNK_HEADER_MIN && body + MCNK_HEADER_MIN <= buffer.length) {
      // The header's position is the chunk's top-left corner in world yards.
      chunks.push({
        indexX: buffer.readUInt32LE(body + 0x04),
        indexY: buffer.readUInt32LE(body + 0x08),
        areaID: buffer.readUInt32LE(body + 0x34),
        x: buffer.readFloatLE(body + 0x68) - CHUNK_SIZE / 2,
        y: buffer.readFloatLE(body + 0x6c) - CHUNK_SIZE / 2,
      });
    }
    offset = body + size;
  }
  return chunks;
}
```

Note on the non-ADT test: `'{"er'` reads as a chunk size far past the end of the buffer, so the loop exits without pushing anything.

- [ ] **Step 5: Run to verify pass; full suite; commit**

Run: `cd tools && node --test tests/adt.test.mjs` → PASS. Then `npm test` → PASS.

```bash
git add tools/lib/adt.mjs tools/tests/adt.test.mjs tools/tests/fixtures/azeroth_32_49-mcnk.adt
git commit -m "Add ADT terrain chunk parser for discovery area IDs

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Collect, sample and emit targets

**Files:**
- Create: `tools/lib/targets.mjs`
- Create: `tools/tests/targets.test.mjs`

**Interfaces:**
- Consumes: chunk objects from Task 8 (`{ areaID, x, y, ... }`).
- Produces:
  - `collectAreaChunks(continents, wanted)`. `continents` is `Map<continentID, chunk[]>` and `wanted` is a `Set<areaID>`. Returns `Map<areaID, { continent, points: [{x, y}] }>`. An area found on both continents keeps the continent with more chunks; a tie goes to the lower continent ID.
  - `samplePoints(points, k = 8)` → up to `k` points, deterministic.
  - `emitTargetsLua(targets, meta)` → Lua source defining `VeilmapAreaTargets`.

- [ ] **Step 1: Write the failing tests**

Create `tools/tests/targets.test.mjs`:

```js
// Veilmap - GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { LuaFactory } from 'wasmoon';
import { collectAreaChunks, samplePoints, emitTargetsLua } from '../lib/targets.mjs';

const chunk = (areaID, x, y) => ({ areaID, x, y });

test('collectAreaChunks', async (t) => {
  await t.test('keeps only wanted area IDs, grouped with their continent', () => {
    const r = collectAreaChunks(
      new Map([[0, [chunk(87, 1, 2), chunk(12, 3, 4), chunk(87, 5, 6)]]]),
      new Set([87]),
    );
    assert.deepEqual([...r.keys()], [87]);
    assert.deepEqual(r.get(87), { continent: 0, points: [{ x: 1, y: 2 }, { x: 5, y: 6 }] });
  });

  await t.test('an area on both continents keeps the one with more chunks', () => {
    const r = collectAreaChunks(
      new Map([
        [0, [chunk(5, 0, 0)]],
        [1, [chunk(5, 1, 1), chunk(5, 2, 2)]],
      ]),
      new Set([5]),
    );
    assert.equal(r.get(5).continent, 1);
    assert.equal(r.get(5).points.length, 2);
  });

  await t.test('a tie between continents goes to the lower continent ID', () => {
    const r = collectAreaChunks(
      new Map([
        [1, [chunk(5, 1, 1)]],
        [0, [chunk(5, 0, 0)]],
      ]),
      new Set([5]),
    );
    assert.equal(r.get(5).continent, 0);
  });
});

test('samplePoints', async (t) => {
  const grid = [];
  for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) grid.push({ x: i * 10, y: j * 10 });

  await t.test('returns every point, sorted, when there are no more than k', () => {
    const r = samplePoints([{ x: 5, y: 1 }, { x: 1, y: 9 }, { x: 1, y: 2 }], 8);
    assert.deepEqual(r, [{ x: 1, y: 2 }, { x: 1, y: 9 }, { x: 5, y: 1 }]);
  });

  await t.test('caps at k', () => {
    assert.equal(samplePoints(grid, 8).length, 8);
  });

  await t.test('starts with the point nearest the centroid', () => {
    // Centroid of the grid is (45, 45); the four nearest are equidistant, and
    // the sort order (x, then y) makes (40, 40) the first of them.
    assert.deepEqual(samplePoints(grid, 8)[0], { x: 40, y: 40 });
  });

  await t.test('spreads out: the second pick is a far corner', () => {
    assert.deepEqual(samplePoints(grid, 8)[1], { x: 90, y: 90 });
  });

  await t.test('is deterministic regardless of input order', () => {
    const shuffled = [...grid].reverse();
    assert.deepEqual(samplePoints(shuffled, 8), samplePoints(grid, 8));
  });
});

test('emitTargetsLua', async (t) => {
  const targets = new Map([
    [87, { continent: 0, points: [{ x: -9440.04, y: -40.25 }, { x: -9450, y: -30 }] }],
    [5, { continent: 1, points: [{ x: 10, y: 20 }] }],
  ]);
  const source = emitTargetsLua(targets, { build: '1.60.1.69913', generatedFrom: 'wago.tools' });

  await t.test('loads as Lua with areas in ascending ID order and one-decimal coordinates', async () => {
    const lua = await new LuaFactory().createEngine();
    try {
      lua.doStringSync(source);
      const r = lua.doStringSync('local t = VeilmapAreaTargets[87] return table.concat(t, ",")');
      assert.equal(r, '0,-9440,-40.3,-9450,-30');
      assert.equal(lua.doStringSync('return VeilmapAreaTargets[5][1]'), 1);
    } finally {
      lua.global.close();
    }
    assert.ok(source.indexOf('[5] =') < source.indexOf('[87] ='));
  });

  await t.test('records the build and do-not-edit in the header', () => {
    assert.match(source, /1\.60\.1\.69913/);
    assert.match(source, /do not edit/i);
  });

  await t.test('is byte-identical across runs', () => {
    assert.equal(emitTargetsLua(targets, { build: '1.60.1.69913', generatedFrom: 'wago.tools' }), source);
  });

  await t.test('throws on a non-finite coordinate', () => {
    const bad = new Map([[1, { continent: 0, points: [{ x: NaN, y: 0 }] }]]);
    assert.throws(() => emitTargetsLua(bad, { build: 'b', generatedFrom: 'g' }), /finite/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd tools && node --test tests/targets.test.mjs`
Expected: FAIL with `Cannot find module ... lib/targets.mjs`.

- [ ] **Step 3: Implement `tools/lib/targets.mjs`**

```js
// Veilmap - GPL-3.0-or-later
// Turns terrain chunks into a few waypoint targets per area: points on ground
// whose area ID really triggers the area's discovery.

export function collectAreaChunks(continents, wanted) {
  const perArea = new Map(); // areaID -> Map<continent, points[]>
  const order = [...continents.keys()].sort((a, b) => a - b);
  for (const continent of order) {
    for (const c of continents.get(continent)) {
      if (!wanted.has(c.areaID)) continue;
      let byContinent = perArea.get(c.areaID);
      if (!byContinent) perArea.set(c.areaID, (byContinent = new Map()));
      let points = byContinent.get(continent);
      if (!points) byContinent.set(continent, (points = []));
      points.push({ x: c.x, y: c.y });
    }
  }

  const out = new Map();
  for (const [areaID, byContinent] of perArea) {
    let best;
    // Continents iterate in ascending ID order, and strict > keeps the lower one on a tie.
    for (const [continent, points] of byContinent) {
      if (!best || points.length > best.points.length) best = { continent, points };
    }
    out.set(areaID, best);
  }
  return out;
}

const d2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

// Deterministic farthest-point sampling: start at the point nearest the
// centroid, then repeatedly add the point farthest from everything chosen.
export function samplePoints(points, k = 8) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length <= k) return sorted;

  const centroid = {
    x: sorted.reduce((s, p) => s + p.x, 0) / sorted.length,
    y: sorted.reduce((s, p) => s + p.y, 0) / sorted.length,
  };
  let first = 0;
  for (let i = 1; i < sorted.length; i++) {
    if (d2(sorted[i], centroid) < d2(sorted[first], centroid)) first = i;
  }

  const chosen = [sorted[first]];
  const nearest = sorted.map((p) => d2(p, sorted[first]));
  while (chosen.length < k) {
    let pick = 0;
    for (let i = 1; i < sorted.length; i++) if (nearest[i] > nearest[pick]) pick = i;
    chosen.push(sorted[pick]);
    for (let i = 0; i < sorted.length; i++) nearest[i] = Math.min(nearest[i], d2(sorted[i], sorted[pick]));
  }
  return chosen;
}

function finite(label, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`emitTargetsLua: expected a finite number for ${label}, got ${String(value)}`);
  }
  return value;
}

// One decimal is ~10 cm; plenty for a waypoint and keeps the file small.
// Rounds half away from zero (Math.round alone rounds -40.25 to -40.2), and
// "+ 0" turns -0 into 0.
const yards = (v) => {
  finite('coordinate', v);
  return String((Math.sign(v) * Math.round(Math.abs(v) * 10)) / 10 + 0);
};

export function emitTargetsLua(targets, meta) {
  const out = [];
  out.push('--[[');
  out.push('Veilmap - Copyright (C) 2026 xElementzx');
  out.push('GPL-3.0-or-later. See LICENSE.');
  out.push('');
  out.push('GENERATED FILE - do not edit by hand.');
  out.push(`Source: ${meta.generatedFrom}, WoW build ${meta.build} (terrain ADT chunk area IDs)`);
  out.push('Regenerate with:');
  out.push(`  node tools/gentargets.mjs --build ${meta.build} --cache <dir> --out Fog/Targets_Forever.lua`);
  out.push('');
  out.push('[areaID] = { continentID, x1, y1, x2, y2, ... } -- world yards, chunk centres');
  out.push('Ground that triggers the area\'s discovery; up to 8 points spread over the area.');
  out.push(']]');
  out.push('');
  out.push('VeilmapAreaTargets = {');
  for (const areaID of [...targets.keys()].sort((a, b) => a - b)) {
    const { continent, points } = targets.get(areaID);
    const values = [String(finite('continent', continent))];
    for (const p of points) values.push(yards(p.x), yards(p.y));
    out.push(`\t[${finite('areaID', areaID)}] = {${values.join(',')}},`);
  }
  out.push('}');
  out.push('');
  return out.join('\n');
}
```

- [ ] **Step 4: Run to verify pass; full suite; commit**

Run: `cd tools && node --test tests/targets.test.mjs` → PASS. Then `npm test` → PASS.

```bash
git add tools/lib/targets.mjs tools/tests/targets.test.mjs
git commit -m "Add terrain target collection, sampling and Lua emitter

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: `gentargets` CLI and the generated data file

**Files:**
- Create: `tools/gentargets.mjs`
- Generate: `Fog/Targets_Forever.lua`
- Modify: `Veilmap.toc` (add `Fog\Targets_Forever.lua` after `Fog\Data_Forever.lua`), `.luacheckrc`

**Interfaces:**
- Consumes: `fetchTable`, `isValidBuild`, `writeAtomic`, `arg` from `tools/genfogdata.mjs`; `buildDataset` from `tools/lib/dataset.mjs`; Tasks 8 and 9.
- Produces: the global `VeilmapAreaTargets` in `Fog/Targets_Forever.lua`.

- [ ] **Step 1: Write `tools/gentargets.mjs`**

```js
#!/usr/bin/env node
// Veilmap - GPL-3.0-or-later
// Generates waypoint targets from the game's terrain: for each fog area, a few
// points on ground whose area ID triggers the area's discovery.
//
//   node tools/gentargets.mjs --build 1.60.1.69913 --cache <dir> --out Fog/Targets_Forever.lua
//
// Downloads every root ADT tile once (~900 files). Only each tile's parsed
// chunks are cached (as JSON in <cache>), never the raw terrain, so a re-run is
// fast and an interrupted run resumes where it stopped.

import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { arg, fetchTable, isValidBuild, writeAtomic } from './genfogdata.mjs';
import { buildDataset } from './lib/dataset.mjs';
import { parseAdtChunks } from './lib/adt.mjs';
import { collectAreaChunks, samplePoints, emitTargetsLua } from './lib/targets.mjs';

const CONTINENTS = [
  { id: 0, folder: 'azeroth' },
  { id: 1, folder: 'kalimdor' },
];
const CONCURRENCY = 4;
const UA = { 'User-Agent': 'veilmap-tools/1' };

async function getJson(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

// Root tiles only (not _obj0/_tex0/_lod), as [{ fileID, tileX, tileY }].
// Listed one tileX prefix at a time so no single search result is large.
async function listTiles(folder, build) {
  const pattern = new RegExp(`^world/maps/${folder}/${folder}_(\\d+)_(\\d+)\\.adt$`);
  const tiles = [];
  for (let tileX = 0; tileX < 64; tileX++) {
    const search = encodeURIComponent(`world/maps/${folder}/${folder}_${tileX}_`);
    const files = await getJson(`https://wago.tools/api/files?search=${search}&build=${encodeURIComponent(build)}`);
    for (const [fileID, path] of Object.entries(files)) {
      const m = pattern.exec(path);
      if (m && Number(m[1]) === tileX) tiles.push({ fileID: Number(fileID), tileX, tileY: Number(m[2]) });
    }
  }
  return tiles;
}

async function tileChunks(tile, folder, build, cacheDir) {
  const cached = join(cacheDir, `${folder}_${tile.tileX}_${tile.tileY}.json`);
  try {
    return JSON.parse(await readFile(cached, 'utf8'));
  } catch {
    // not cached yet
  }
  const url = `https://wago.tools/api/casc/${tile.fileID}?download&version=${encodeURIComponent(build)}`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${folder}_${tile.tileX}_${tile.tileY} (${url})`);
  const chunks = parseAdtChunks(Buffer.from(await res.arrayBuffer()));
  if (chunks.length !== 256) {
    throw new Error(`${folder}_${tile.tileX}_${tile.tileY}: expected 256 chunks, got ${chunks.length}`);
  }
  const slim = chunks.map(({ areaID, x, y }) => ({ areaID, x, y }));
  await writeAtomic(cached, JSON.stringify(slim));
  return slim;
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function main() {
  const build = arg('build');
  const cache = arg('cache');
  const out = arg('out');
  if (!build || !cache || !out) {
    console.error('usage: gentargets.mjs --build <version> --cache <dir> --out <path>');
    process.exit(2);
  }
  if (!isValidBuild(build)) {
    console.error(`invalid --build "${build}"`);
    process.exit(2);
  }
  const cacheDir = resolve(cache, build);
  await mkdir(cacheDir, { recursive: true });

  console.log(`Fetching fog overlays for build ${build}...`);
  const [overlays, tiles] = await Promise.all([
    fetchTable('WorldMapOverlay', build),
    fetchTable('WorldMapOverlayTile', build),
  ]);
  const wanted = new Set();
  for (const entries of buildDataset(overlays, tiles).values()) {
    for (const e of entries) for (const id of e.areaIDs) wanted.add(id);
  }
  console.log(`  ${wanted.size} fog area IDs`);

  const continents = new Map();
  for (const { id, folder } of CONTINENTS) {
    const list = await listTiles(folder, build);
    console.log(`  ${folder}: ${list.length} terrain tiles`);
    let done = 0;
    const perTile = await mapLimit(list, CONCURRENCY, async (tile) => {
      const chunks = await tileChunks(tile, folder, build, cacheDir);
      if (++done % 50 === 0) console.log(`    ${done}/${list.length}`);
      return chunks;
    });
    continents.set(id, perTile.flat());
  }

  const collected = collectAreaChunks(continents, wanted);
  const targets = new Map();
  for (const [areaID, { continent, points }] of collected) {
    targets.set(areaID, { continent, points: samplePoints(points, 8) });
  }

  const missing = [...wanted].filter((id) => !targets.has(id)).sort((a, b) => a - b);
  console.log(`  -> targets for ${targets.size}/${wanted.size} areas`);
  if (missing.length) {
    console.log(`  no terrain chunks (building/cave-only areas, waypoint falls back to map art): ${missing.join(', ')}`);
  }
  if (targets.size < wanted.size * 0.8) {
    throw new Error(`only ${targets.size}/${wanted.size} areas found on terrain; refusing to write`);
  }

  const target = resolve(process.cwd(), out);
  await writeAtomic(target, emitTargetsLua(targets, { build, generatedFrom: 'wago.tools' }));
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

Check that `arg` is exported from `genfogdata.mjs` (it is: `export function arg`).

- [ ] **Step 2: Run the suite (the CLI must not break anything)**

Run: `cd tools && npm test` → PASS.

- [ ] **Step 3: Generate the data**

Run from the repo root, with a cache directory outside the repo (the session scratchpad, e.g. `<scratchpad>/terrain-cache`):

```bash
node tools/gentargets.mjs --build 1.60.1.69913 --cache <scratchpad>/terrain-cache --out Fog/Targets_Forever.lua
```

Expected:
- The fog area ID count is printed. It should be roughly 700–1000; the data has 1073 overlays, some sharing areas.
- Tile counts are printed for both continents (hundreds each).
- `-> targets for N/M areas` with N/M ≥ 0.8. The missing list names WMO-only areas.
- `Wrote ...Targets_Forever.lua`.

Sanity checks:
- `grep -n '^\t\[87\]' Fog/Targets_Forever.lua` shows Goldshire on continent 0, with every x near −9440 (±150) and every y near −40 (±150).
- `wc -c Fog/Targets_Forever.lua` is under 250 KB.
- Re-running the same command prints no download progress (all cache hits) and `git diff --stat Fog/Targets_Forever.lua` shows no change.

If the ratio guard trips, stop and report the counts. That would mean the listing or parsing is incomplete, not that the data is fine.

- [ ] **Step 4: Load the file in the addon and keep lint quiet**

In `Veilmap.toc`, add `Fog\Targets_Forever.lua` on the line after `Fog\Data_Forever.lua`.

In `.luacheckrc`:
- `exclude_files = { "tools/node_modules", "Fog/Data_Forever.lua", "Fog/Targets_Forever.lua" }`
- Add `"VeilmapAreaTargets"` to `globals`.
- Add `"CreateVector2D"` to `read_globals`.

- [ ] **Step 5: Run the suite and commit**

Run: `cd tools && npm test` → PASS (`syntax.test.mjs` parses the new file as Lua 5.1).

```bash
git add tools/gentargets.mjs Fog/Targets_Forever.lua Veilmap.toc .luacheckrc
git commit -m "Generate terrain discovery targets for every fog area

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Aim waypoints at terrain targets

**Files:**
- Modify: `Fog/Areas.lua` (add `Areas.Nearest`)
- Modify: `tools/tests/areas.test.mjs`
- Modify: `Fog/Waypoint.lua`
- Modify: `Fog/AreaList.lua`
- Modify: `docs/ingame-checks-phase-4.md`

**Interfaces:**
- Consumes: `VeilmapAreaTargets` (Task 10), `Areas.OnMap`, `Areas.Centre`.
- Produces:
  - `Areas.Nearest(points, x, y, layerW, layerH)` → the `{x=, y=}` from `points` nearest `(x, y)`, measured in layer pixels, or `nil` if `points` is empty. A tie goes to the earlier point.
  - `Veilmap.Waypoint.Set(entry, areaIDs)`. `areaIDs` is optional and defaults to `entry[5]`. It selects which areas' targets are candidates and which names are printed.

- [ ] **Step 1: Write the failing tests**

Append to `tools/tests/areas.test.mjs`:

```js
test('Areas.Nearest', async (t) => {
  await t.test('returns nil for no points', async () => {
    assert.equal(await run('return Areas.Nearest({}, 0.5, 0.5, 100, 100) == nil and "nil" or "pt"'), 'nil');
  });

  await t.test('picks the nearest point', async () => {
    const r = await run(`
      local p = Areas.Nearest({ { x = 0.9, y = 0.9 }, { x = 0.4, y = 0.5 }, { x = 0.1, y = 0.1 } }, 0.5, 0.5, 100, 100)
      return p.x .. "," .. p.y
    `);
    assert.equal(r, '0.4,0.5');
  });

  await t.test('measures in layer pixels, so aspect ratio matters', async () => {
    // Layer 1000 x 100. A is 0.05 away in x (50 px); B is 0.2 away in y (20 px).
    const r = await run(`
      local p = Areas.Nearest({ { x = 0.55, y = 0.5 }, { x = 0.5, y = 0.7 } }, 0.5, 0.5, 1000, 100)
      return p.y
    `);
    assert.equal(r, 0.7);
  });

  await t.test('a tie goes to the earlier point', async () => {
    const r = await run(`
      local p = Areas.Nearest({ { x = 0.4, y = 0.5 }, { x = 0.6, y = 0.5 } }, 0.5, 0.5, 100, 100)
      return p.x
    `);
    assert.equal(r, 0.4);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd tools && node --test tests/areas.test.mjs`
Expected: FAIL with `attempt to call a nil value (field 'Nearest')`.

- [ ] **Step 3: Implement `Areas.Nearest`**

In `Fog/Areas.lua`, before `function Areas.PointMatches`:

```lua
-- The point nearest (x, y), measured in layer pixels; nil for no points.
-- Strict < keeps the earlier point on a tie.
function Areas.Nearest(points, x, y, layerW, layerH)
	local best, bestDistance
	for i = 1, #points do
		local p = points[i]
		local dx, dy = (p.x - x) * layerW, (p.y - y) * layerH
		local distance = dx * dx + dy * dy
		if not best or distance < bestDistance then
			best, bestDistance = p, distance
		end
	end
	return best
end
```

Run: `cd tools && node --test tests/areas.test.mjs` → PASS.

- [ ] **Step 4: Target terrain in `Waypoint.lua`**

Replace `local function namesOf(entry) ... end` with:

```lua
local function namesOf(areaIDs)
	local names = {}
	for i = 1, #areaIDs do
		names[i] = Veilmap.AreaName(areaIDs[i])
	end
	return table.concat(names, ", ")
end

-- Where to put the waypoint: the terrain target nearest the patch, or the
-- patch's hit-rect centre when no target lands on this map. Terrain targets
-- (Fog/Targets_Forever.lua) are chunk centres whose area ID triggers the
-- discovery; the map art can be much larger than that ground.
local function targetFor(areaIDs, mapID, entry, layerW, layerH)
	local cx, cy = Areas.Centre(entry, layerW, layerH)
	local targets = VeilmapAreaTargets
	if not targets then return cx, cy end

	local candidates = {}
	for i = 1, #areaIDs do
		local t = targets[areaIDs[i]]
		if t then
			local continent = t[1]
			for j = 2, #t - 1, 2 do
				local ok, uiMapID, position = pcall(C_Map.GetMapPosFromWorldPos,
					continent, CreateVector2D(t[j], t[j + 1]), mapID)
				if ok and uiMapID == mapID and position then
					local x, y = position:GetXY()
					if Areas.OnMap(x, y) then
						candidates[#candidates + 1] = { x = x, y = y }
					end
				end
			end
		end
	end

	local best = Areas.Nearest(candidates, cx, cy, layerW, layerH)
	if best then return best.x, best.y end
	return cx, cy
end
```

Change `function Waypoint.Set(entry)` to `function Waypoint.Set(entry, areaIDs)`, and at its top (before the combat check) add:

```lua
	-- Which areas to aim at: all the overlay's areas for an Alt-click (any of
	-- them reveals it), or just the list row's area.
	areaIDs = areaIDs or entry[5]
```

Replace the line `local x, y = Areas.Centre(entry, current.layerWidth, current.layerHeight)` with:

```lua
	local x, y = targetFor(areaIDs, mapID, entry, current.layerWidth, current.layerHeight)
```

`targetFor` runs before the existing `pcall` that sets the waypoint. Its own API calls are individually `pcall`ed: a failure there drops that candidate rather than reporting, because the hit-rect fallback still gives a usable waypoint.

Replace `names = namesOf(entry),` with `names = namesOf(areaIDs),`.

- [ ] **Step 5: List rows target their own area**

In `Fog/AreaList.lua`, change `onRowClick` to:

```lua
local function onRowClick(row)
	Veilmap.Waypoint.Set(row.group.largest, { row.group.areaID })
end
```

- [ ] **Step 6: Update the in-game checklist**

Append these rows to the table in `docs/ingame-checks-phase-4.md`, after row 20:

```markdown
| 21 | Alt-click Jerod's Landing (Elwynn), walk to the waypoint | The waypoint sits on the small dock rock, not the middle of the patch. Standing on it discovers Jerod's Landing. |
| 22 | Repeat 21 for three small subzones in other zones (e.g. a Westfall farm, a Durotar camp) | Standing on the waypoint discovers each one. |
| 23 | Click a list row for an area whose patch spans more than one area | The waypoint is on that row's area, and the chat message names only that area. |
| 24 | Waypoint conversion sanity: `/run local _,p=C_Map.GetMapPosFromWorldPos(0,CreateVector2D(-9440,-40),C_Map.GetBestMapForUnit("player")) print(p and p:GetXY())` while in Elwynn | Prints roughly 0.42, 0.65 (Goldshire). |
```

- [ ] **Step 7: Run the suite and commit**

Run: `cd tools && npm test` → PASS.

```bash
git add Fog/Areas.lua tools/tests/areas.test.mjs Fog/Waypoint.lua Fog/AreaList.lua docs/ingame-checks-phase-4.md
git commit -m "Aim waypoints at terrain that triggers discovery

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
