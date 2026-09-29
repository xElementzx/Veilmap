// Veilmap - GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { evalInLuaModule } from './helpers/lua.mjs';

test('Config.Merge', async (t) => {
  await t.test('nil saved data yields the defaults', async () => {
    const result = await evalInLuaModule('Config.lua', 'return Config.Merge(nil, Config.defaults).fogColor.r');
    assert.equal(result, 0.1);
  });

  await t.test('saved values win over defaults', async () => {
    const result = await evalInLuaModule('Config.lua', 'return Config.Merge({ mapScale = 1.75 }, Config.defaults).mapScale');
    assert.equal(result, 1.75);
  });

  await t.test('missing keys are filled from defaults', async () => {
    const result = await evalInLuaModule('Config.lua', 'return Config.Merge({ mapScale = 1.75 }, Config.defaults).mapAlpha');
    assert.equal(result, 1.0);
  });

  await t.test('nested tables merge rather than replace', async () => {
    const result = await evalInLuaModule('Config.lua', `
      local m = Config.Merge({ fogColor = { r = 0.5 } }, Config.defaults)
      return m.fogColor.r .. "/" .. m.fogColor.g
    `);
    assert.equal(result, '0.5/0.2');
  });

  await t.test('defaults are not mutated by a merge', async () => {
    const result = await evalInLuaModule('Config.lua', `
      Config.Merge({ fogColor = { r = 0.9 } }, Config.defaults)
      return Config.defaults.fogColor.r
    `);
    assert.equal(result, 0.1);
  });

  await t.test('a saved value of the wrong type is discarded', async () => {
    const result = await evalInLuaModule('Config.lua', 'return Config.Merge({ mapScale = "huge" }, Config.defaults).mapScale');
    assert.equal(result, 1.0);
  });

  await t.test('a nested key survives the merge only because it is present in defaults', async () => {
    const result = await evalInLuaModule('Config.lua', `
      local m = Config.Merge({ position = { point = "TOPLEFT", relativePoint = "TOPLEFT", x = 42, y = -13 } }, Config.defaults)
      return m.position.relativePoint
    `);
    assert.equal(result, 'TOPLEFT');
  });
});
