// Veilmap - GPL-3.0-or-later
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { LuaFactory } from 'wasmoon';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

// Loads a pure Veilmap module standalone. Pure modules end with `return <table>`,
// which the game ignores but which gives tests a handle on the module.
export async function loadLuaModule(relativePath) {
  const source = await readFile(ROOT + relativePath, 'utf8');
  const lua = await new LuaFactory().createEngine();
  const module = await lua.doString(source);
  return { lua, module };
}

// Evaluates a Lua snippet within a module context. The module source is loaded,
// its trailing `return` statement is stripped, and the snippet is appended before
// execution. The snippet should return a scalar (not a table).
export async function evalInLuaModule(relativePath, luaSnippet) {
  const source = await readFile(ROOT + relativePath, 'utf8');
  // Strip the trailing return statement so we can append the test snippet
  const moduleCode = source.replace(/return\s+\w+\s*$/, '');
  const lua = await new LuaFactory().createEngine();
  try {
    const result = lua.doStringSync(`${moduleCode}\n${luaSnippet}`);
    return result;
  } finally {
    try {
      lua.global.close();
    } catch {
      // Ignore errors during cleanup to avoid masking the original error
    }
  }
}
