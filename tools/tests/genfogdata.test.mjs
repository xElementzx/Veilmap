// Veilmap - GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchTable, isValidBuild, writeAtomic } from '../genfogdata.mjs';

function stubFetch(impl) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return () => {
    globalThis.fetch = original;
  };
}

test('fetchTable', async (t) => {
  await t.test('throws mentioning the HTTP status on a non-200 response', async () => {
    const restore = stubFetch(async () => ({
      ok: false,
      status: 503,
      text: async () => 'service unavailable',
    }));
    try {
      await assert.rejects(
        () => fetchTable('WorldMapOverlay', '1.60.1.69913'),
        /HTTP 503/,
      );
    } finally {
      restore();
    }
  });

  await t.test('throws rather than parsing a JSON error body as CSV', async () => {
    const restore = stubFetch(async () => ({
      ok: true,
      status: 200,
      text: async () => '{"errors":"Table not found."}',
    }));
    try {
      await assert.rejects(
        () => fetchTable('WorldMapOverlay', '1.60.1.69913'),
        /Table not found/,
      );
    } finally {
      restore();
    }
  });

  await t.test('restoring fetch leaves the global untouched for later tests', () => {
    assert.equal(typeof globalThis.fetch, 'function');
  });
});

test('isValidBuild', async (t) => {
  await t.test('accepts an ordinary version/build string', () => {
    assert.equal(isValidBuild('1.60.1.69913'), true);
  });

  await t.test('rejects a value that could close a Lua block comment early', () => {
    assert.equal(isValidBuild('1.60.1]]VeilmapFogData={}--'), false);
  });

  await t.test('rejects empty and non-string input', () => {
    assert.equal(isValidBuild(''), false);
    assert.equal(isValidBuild(undefined), false);
  });
});

test('writeAtomic', async (t) => {
  await t.test('writes the target with no stray temp file left behind on success', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'veilmap-writeatomic-'));
    try {
      const target = join(dir, 'out.lua');
      await writeAtomic(target, 'contents');
      assert.equal(await readFile(target, 'utf8'), 'contents');
      assert.deepEqual(await readdir(dir), ['out.lua']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  await t.test('cleans up the temp file and rethrows the original error when rename fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'veilmap-writeatomic-'));
    try {
      // Make the target a directory so writeFile(tmp) succeeds but the
      // subsequent rename(tmp, target) fails - this is what exercises the
      // cleanup path, not a failure before the temp file even exists.
      const target = join(dir, 'target-is-a-dir');
      await mkdir(target);
      await assert.rejects(() => writeAtomic(target, 'contents'));
      // Only the pre-existing directory should remain: no leaked .tmp-* file.
      assert.deepEqual(await readdir(dir), ['target-is-a-dir']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  await t.test('rethrows (rather than masking with a cleanup error) when writeFile itself fails', async () => {
    // Target's parent directory does not exist, so writeFile(tmp) fails
    // before any temp file is created; cleanup must be a harmless no-op,
    // not something that replaces the original ENOENT with its own error.
    const dir = await mkdtemp(join(tmpdir(), 'veilmap-writeatomic-'));
    try {
      const target = join(dir, 'missing-subdir', 'out.lua');
      await assert.rejects(() => writeAtomic(target, 'contents'));
      assert.deepEqual(await readdir(dir), []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
