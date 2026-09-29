// Veilmap - GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { evalInLuaModule } from './helpers/lua.mjs';

test('Geometry', async (t) => {
  await t.test('OverlayKey is stable and distinguishes all four fields', async () => {
    const key1 = await evalInLuaModule('Fog/Geometry.lua', 'return Geometry.OverlayKey(256, 256, 422, 332)');
    assert.equal(key1, '256:256:422:332');
    const key2 = await evalInLuaModule('Fog/Geometry.lua', 'return Geometry.OverlayKey(256, 256, 332, 422)');
    assert.notEqual(key1, key2);
  });

  await t.test('BuildExploredKeySet keys live client textures', async () => {
    const hit = await evalInLuaModule('Fog/Geometry.lua', `
      local set = Geometry.BuildExploredKeySet({
        { textureWidth = 256, textureHeight = 256, offsetX = 422, offsetY = 332 },
        { textureWidth = 256, textureHeight = 256, offsetX = 250, offsetY = 270 },
      })
      return (set["256:256:422:332"] and set["256:256:250:270"]) and 1 or 0
    `);
    assert.equal(hit, 1);
  });

  await t.test('BuildExploredKeySet tolerates nil', async () => {
    const result = await evalInLuaModule('Fog/Geometry.lua', 'local s = Geometry.BuildExploredKeySet(nil); return next(s) == nil and 1 or 0');
    assert.equal(result, 1);
  });

  await t.test('TileCounts rounds up partial tiles', async () => {
    const w1 = await evalInLuaModule('Fog/Geometry.lua', 'local w = Geometry.TileCounts(256, 256, 256, 256); return w');
    assert.equal(w1, 1);
    const h2 = await evalInLuaModule('Fog/Geometry.lua', 'local _, h = Geometry.TileCounts(256, 341, 256, 256); return h');
    assert.equal(h2, 2);
    const w3 = await evalInLuaModule('Fog/Geometry.lua', 'local w = Geometry.TileCounts(513, 100, 256, 256); return w');
    assert.equal(w3, 3);
  });

  await t.test('TileSpan returns a full tile for non-final indices', async () => {
    const p1 = await evalInLuaModule('Fog/Geometry.lua', 'local p, t = Geometry.TileSpan(1, 2, 341, 256); return p');
    assert.equal(p1, 256);
    const t1 = await evalInLuaModule('Fog/Geometry.lua', 'local p, t = Geometry.TileSpan(1, 2, 341, 256); return t');
    assert.equal(t1, 1);
  });

  await t.test('final tile is padded to the next power of two', async () => {
    // 341 % 256 = 85 pixels; padded 16 -> 32 -> 64 -> 128.
    const p = await evalInLuaModule('Fog/Geometry.lua', 'local p = Geometry.TileSpan(2, 2, 341, 256); return p');
    assert.equal(p, 85);
    const t = await evalInLuaModule('Fog/Geometry.lua', 'local _, t = Geometry.TileSpan(2, 2, 341, 256); return t');
    assert.equal(t, 85 / 128);
  });

  await t.test('real overlay heights from art 2153', async () => {
    // 249 -> padded to 256; 240 -> 256; 237 -> 256. All single-tile.
    const t1 = await evalInLuaModule('Fog/Geometry.lua', 'local _, t = Geometry.TileSpan(1, 1, 249, 256); return t');
    assert.equal(t1, 249 / 256);
    const t2 = await evalInLuaModule('Fog/Geometry.lua', 'local _, t = Geometry.TileSpan(1, 1, 240, 256); return t');
    assert.equal(t2, 240 / 256);
    const t3 = await evalInLuaModule('Fog/Geometry.lua', 'local _, t = Geometry.TileSpan(1, 1, 237, 256); return t');
    assert.equal(t3, 237 / 256);
  });

  await t.test('an exact multiple uses the full tile, not a zero-width one', async () => {
    const p = await evalInLuaModule('Fog/Geometry.lua', 'local p = Geometry.TileSpan(2, 2, 512, 256); return p');
    assert.equal(p, 256);
    const t = await evalInLuaModule('Fog/Geometry.lua', 'local _, t = Geometry.TileSpan(2, 2, 512, 256); return t');
    assert.equal(t, 1);
  });

  await t.test('never pads below the 16px floor', async () => {
    const t = await evalInLuaModule('Fog/Geometry.lua', 'local _, t = Geometry.TileSpan(2, 2, 260, 256); return t');
    assert.equal(t, 4 / 16);
  });
});
