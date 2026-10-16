#!/usr/bin/env node
// Veilmap - GPL-3.0-or-later
// Generates waypoint targets from the game's terrain: for each fog area, a few
// points on ground whose area ID triggers the area's discovery.
//
//   node tools/gentargets.mjs --build 1.60.1.69913 --cache <dir> --out Fog/Targets_Forever.lua
//
// Downloads every root ADT tile once (~1700 files, ~15 minutes). Only each tile's parsed
// chunks are cached (as JSON in <cache>), never the raw terrain, so a re-run is
// fast and an interrupted run resumes where it stopped.

import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { arg, fetchTable, isValidBuild, writeAtomic } from './genfogdata.mjs';
import { buildDataset } from './lib/dataset.mjs';
import { parseAdtChunks } from './lib/adt.mjs';
import { collectAreaChunks, samplePoints, emitTargetsLua } from './lib/targets.mjs';

const CONTINENTS = [
  { id: 0, folder: 'azeroth' },
  { id: 1, folder: 'kalimdor' },
];
const CONCURRENCY = 6;
const UA = { 'User-Agent': 'veilmap-tools/1' };

async function getJson(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

// Root tiles only (not _obj0/_tex0/_lod), as [{ fileID, tileX, tileY }].
// One search per continent: each search costs ~20s on wago.tools whatever
// its size, and the full listing (~4-5k files) comes back uncapped.
async function listTiles(folder, build) {
  const pattern = new RegExp(`^world/maps/${folder}/${folder}_(\\d+)_(\\d+)\\.adt$`);
  const search = encodeURIComponent(`world/maps/${folder}/${folder}_`);
  const files = await getJson(`https://wago.tools/api/files?search=${search}&build=${encodeURIComponent(build)}`);
  const tiles = [];
  for (const [fileID, path] of Object.entries(files)) {
    const m = pattern.exec(path);
    if (m) tiles.push({ fileID: Number(fileID), tileX: Number(m[1]), tileY: Number(m[2]) });
  }
  return tiles;
}

async function tileChunks(tile, folder, build, cacheDir) {
  const cached = join(cacheDir, `${folder}_${tile.tileX}_${tile.tileY}.json`);
  try {
    return JSON.parse(await readFile(cached, 'utf8'));
  } catch {
    // not cached yet
  }
  const url = `https://wago.tools/api/casc/${tile.fileID}?download&version=${encodeURIComponent(build)}`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${folder}_${tile.tileX}_${tile.tileY} (${url})`);
  const chunks = parseAdtChunks(Buffer.from(await res.arrayBuffer()));
  if (chunks.length !== 256) {
    throw new Error(`${folder}_${tile.tileX}_${tile.tileY}: expected 256 chunks, got ${chunks.length}`);
  }
  const slim = chunks.map(({ areaID, x, y }) => ({ areaID, x, y }));
  await writeAtomic(cached, JSON.stringify(slim));
  return slim;
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function main() {
  const build = arg('build');
  const cache = arg('cache');
  const out = arg('out');
  if (!build || !cache || !out) {
    console.error('usage: gentargets.mjs --build <version> --cache <dir> --out <path>');
    process.exit(2);
  }
  if (!isValidBuild(build)) {
    console.error(`invalid --build "${build}"`);
    process.exit(2);
  }
  const cacheDir = resolve(cache, build);
  await mkdir(cacheDir, { recursive: true });

  console.log(`Fetching fog overlays for build ${build}...`);
  const [overlays, tiles] = await Promise.all([
    fetchTable('WorldMapOverlay', build),
    fetchTable('WorldMapOverlayTile', build),
  ]);
  const wanted = new Set();
  for (const entries of buildDataset(overlays, tiles).values()) {
    for (const e of entries) for (const id of e.areaIDs) wanted.add(id);
  }
  console.log(`  ${wanted.size} fog area IDs`);

  const continents = new Map();
  for (const { id, folder } of CONTINENTS) {
    const list = await listTiles(folder, build);
    console.log(`  ${folder}: ${list.length} terrain tiles`);
    let done = 0;
    const perTile = await mapLimit(list, CONCURRENCY, async (tile) => {
      const chunks = await tileChunks(tile, folder, build, cacheDir);
      if (++done % 50 === 0) console.log(`    ${done}/${list.length}`);
      return chunks;
    });
    continents.set(id, perTile.flat());
  }

  const collected = collectAreaChunks(continents, wanted);
  const targets = new Map();
  for (const [areaID, { continent, points }] of collected) {
    targets.set(areaID, { continent, points: samplePoints(points, 8) });
  }

  const missing = [...wanted].filter((id) => !targets.has(id)).sort((a, b) => a - b);
  console.log(`  -> targets for ${targets.size}/${wanted.size} areas`);
  if (missing.length) {
    console.log(`  no terrain chunks (building/cave-only areas, waypoint falls back to map art): ${missing.join(', ')}`);
  }
  if (targets.size < wanted.size * 0.8) {
    throw new Error(`only ${targets.size}/${wanted.size} areas found on terrain; refusing to write`);
  }

  const target = resolve(process.cwd(), out);
  await writeAtomic(target, emitTargetsLua(targets, { build, generatedFrom: 'wago.tools' }));
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
