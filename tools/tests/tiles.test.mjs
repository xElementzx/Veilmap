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
    // %.4g: the test VM is Lua 5.4, which prints float 1 as "1.0"; WoW's 5.1 has no such split.
    run(`local r = { Tiles.Clip(${u0}, ${v0}, ${u1}, ${v1}) } if #r == 0 then return "nil" end
      for i, v in ipairs(r) do r[i] = string.format("%.4g", v) end return table.concat(r, ",")`);

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
