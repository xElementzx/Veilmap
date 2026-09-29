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
    assert.equal(detect(undefined), 'unknown');
    assert.equal(detect(0), 'unknown');
    // Strings: the realistic failure mode is a caller passing the raw TOC string
    // instead of the parsed number. "16001" must NOT be treated as a number.
    assert.equal(detect("16001"), 'unknown', 'numeric string must not match flavor');
    assert.equal(detect("forever"), 'unknown');
    // Boolean: test if wasmoon marshals it cleanly
    assert.equal(detect(true), 'unknown');
  });

  lua.global.close();
});
