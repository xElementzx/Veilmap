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
