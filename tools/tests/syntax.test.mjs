// Veilmap - GPL-3.0-or-later
//
// This file has two independent test layers over the same shipped .lua
// files. They check different things and neither alone is sufficient:
//
//   1. wasmoon (real Lua 5.4 VM): proves the file `load()`s without a
//      syntax error, and is what later tasks will also use to actually
//      EXECUTE pure Lua modules under test. It does NOT prove the file
//      is valid Lua 5.1 - wasmoon's VM is 5.4, but WoW's client runs
//      Lua 5.1. A construct that is valid 5.4 but not valid 5.1
//      (integer division `//`, bitwise operators, goto/`::labels::`,
//      `<const>`/`<close>` attributes, etc.) will pass this test and
//      then fail to load in-game.
//
//   2. luaparse (`{ luaVersion: '5.1' }`): proves the file parses as
//      Lua 5.1 syntax specifically, catching exactly the 5.4-only
//      constructs layer 1 cannot. It does NOT execute anything, so it
//      cannot catch runtime errors or prove the file does anything
//      useful.
//
// Passing both is necessary but still not sufficient for "loads in
// game" - neither layer knows about WoW API globals, taint rules, or
// anything that only exists in the client's environment.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LuaFactory } from 'wasmoon';
import luaparse from 'luaparse';

// fileURLToPath (not the raw .pathname) is required here: on Windows a file
// URL's .pathname keeps a leading slash before the drive letter
// (e.g. "/C:/Projects/Foglight/"), which corrupts every subsequent
// path.join() into a bogus "C:\C:\..." path.
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

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
      // wasmoon marshals Lua nil as JS null (not undefined), so the
      // success case must be checked against null.
      lua.global.set('__src', source);
      lua.global.set('__name', rel);
      const err = lua.doStringSync('local f, e = load(__src, __name); return e');
      assert.equal(err, null, `${rel} failed to parse: ${err}`);
    }
  } finally {
    lua.global.close();
  }
});

test('every shipped Lua file is valid Lua 5.1 (the game client\'s version)', async () => {
  const files = await luaFiles(ROOT);
  assert.ok(files.length > 0, 'expected at least one Lua file');

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const rel = relative(ROOT, file);
    try {
      luaparse.parse(source, { luaVersion: '5.1' });
    } catch (err) {
      assert.fail(`${rel} is not valid Lua 5.1: ${err.message}`);
    }
  }
});
