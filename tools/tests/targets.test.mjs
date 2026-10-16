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
