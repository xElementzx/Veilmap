#!/usr/bin/env node
// Veilmap - GPL-3.0-or-later
// Generates the fog dataset from wago.tools DB2 exports.
//
//   node tools/genfogdata.mjs --build 1.60.1.69913 --out Fog/Data_Forever.lua

import { writeFile, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseCsv } from './lib/csv.mjs';
import { buildDataset } from './lib/dataset.mjs';
import { emitLua } from './lib/emit.mjs';
import { assertDatasetUsable } from './lib/verify.mjs';

// Conservative allowlist for a build string that gets interpolated into a
// URL and, via emitLua, into a Lua `--[[ ]]` block comment. A value
// containing "]]" would close that comment early and turn the header into
// executable Lua, so anything outside dotted version/build syntax is
// rejected up front rather than trusted.
export const BUILD_PATTERN = /^[\w.-]+$/;

export function isValidBuild(build) {
  return typeof build === 'string' && build.length > 0 && BUILD_PATTERN.test(build);
}

export function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

export async function fetchTable(table, build) {
  const url = `https://wago.tools/db2/${table}/csv?build=${encodeURIComponent(build)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${table}: HTTP ${res.status} from ${url}`);
  const text = await res.text();
  if (text.trimStart().startsWith('{')) throw new Error(`${table}: ${text.trim()}`);
  return parseCsv(text);
}

// Write to a temp file beside the target, then rename over it. rename() on
// the same filesystem is atomic, so a crash or full disk mid-write leaves
// the previous good file in place instead of a half-written one, and a
// reader never observes a partially-written target.
//
// If writeFile or rename throws (full disk, permission denied, interrupted
// run), the temp file is cleaned up best-effort before re-throwing. Cleanup
// failure must never replace the original error - that error is the useful
// diagnostic - so it is swallowed and the original is always what the
// caller sees, and the run still fails loudly and exits non-zero.
export async function writeAtomic(target, contents) {
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(tmp, contents, 'utf8');
    await rename(tmp, target);
  } catch (err) {
    try {
      await unlink(tmp);
    } catch {
      // best-effort cleanup only; do not mask the original error
    }
    throw err;
  }
}

export async function main() {
  const build = arg('build');
  const out = arg('out');
  if (!build || !out) {
    console.error('usage: genfogdata.mjs --build <version> --out <path>');
    process.exit(2);
  }
  if (!isValidBuild(build)) {
    console.error(`invalid --build "${build}": expected version/build characters only (${BUILD_PATTERN})`);
    process.exit(2);
  }

  console.log(`Fetching DB2 exports for build ${build}...`);
  const [overlays, tiles] = await Promise.all([
    fetchTable('WorldMapOverlay', build),
    fetchTable('WorldMapOverlayTile', build),
  ]);
  console.log(`  WorldMapOverlay:     ${overlays.length} rows`);
  console.log(`  WorldMapOverlayTile: ${tiles.length} rows`);

  const dataset = buildDataset(overlays, tiles);
  const entries = [...dataset.values()].reduce((n, e) => n + e.length, 0);
  console.log(`  -> ${dataset.size} map art IDs, ${entries} overlays (${overlays.length - entries} dropped as tile-less)`);

  // Refuse to overwrite 1000+ verified entries with an empty table just
  // because a fetch came back well-formed but empty. See tools/lib/verify.mjs.
  assertDatasetUsable({ overlayRows: overlays, tileRows: tiles, dataset });

  const target = resolve(process.cwd(), out);
  const source = emitLua(dataset, { build, generatedFrom: 'wago.tools' });
  await writeAtomic(target, source);
  console.log(`Wrote ${target}`);
}

const isMain =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  main().catch((err) => {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  });
}
