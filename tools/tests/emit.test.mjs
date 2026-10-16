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

  await t.test('records the source build and entry format in a header comment', () => {
    assert.match(source, /1\.60\.1\.69913/);
    assert.match(source, /do not edit/i);
    assert.match(source, /\{areaIDs\}/);
    assert.match(source, /hitLeft, hitTop, hitRight, hitBottom/);
  });

  await t.test('produces Lua that loads and yields the expected table', async () => {
    const lua = await new LuaFactory().createEngine();
    try {
      lua.doStringSync(source);
      const n = lua.doStringSync('return #VeilmapFogData[2153]');
      assert.equal(n, 3);

      const row = lua.doStringSync(`
        for _, e in ipairs(VeilmapFogData[2153]) do
          if e[5][1] == 18 then
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
          if e[5][1] == 60 then return e[6] end
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

  await t.test('throws when a numeric entry field is not finite', () => {
    const bad = new Map([
      [
        2153,
        [{ width: NaN, height: 256, offsetX: 0, offsetY: 0, areaIDs: [18], hitRect: [0, 0, 1, 1], fileDataIDs: [1] }],
      ],
    ]);
    assert.throws(
      () => emitLua(bad, { build: '1.60.1.69913', generatedFrom: 'wago.tools' }),
      /expected a finite number for width/,
    );
  });

  await t.test('throws when a fileDataIDs element is not finite', () => {
    const bad = new Map([
      [
        2153,
        [{ width: 256, height: 256, offsetX: 0, offsetY: 0, areaIDs: [18], hitRect: [0, 0, 1, 1], fileDataIDs: [1, NaN] }],
      ],
    ]);
    assert.throws(
      () => emitLua(bad, { build: '1.60.1.69913', generatedFrom: 'wago.tools' }),
      /expected a finite number for fileDataID/,
    );
  });

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
});
