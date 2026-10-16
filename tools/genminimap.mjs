#!/usr/bin/env node
// Veilmap - GPL-3.0-or-later
// Generates the minimap tile table for the close-zoom detail layer.
//
//   node tools/genminimap.mjs --build 1.60.1.69913 --out Detail/Data_Minimap_Forever.lua
//
// One wago.tools file search per continent (~20 s each); no tile is downloaded.

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { arg, isValidBuild, writeAtomic } from './genfogdata.mjs';
import { parseMinimapListing, emitMinimapLua, MIN_TILES } from './lib/minimap.mjs';

const CONTINENTS = [
  { id: 0, folder: 'azeroth' },
  { id: 1, folder: 'kalimdor' },
];

export async function main() {
  const build = arg('build');
  const out = arg('out');
  if (!build || !out) {
    console.error('usage: genminimap.mjs --build <version> --out <path>');
    process.exit(2);
  }
  if (!isValidBuild(build)) {
    console.error(`invalid --build "${build}"`);
    process.exit(2);
  }

  const byContinent = new Map();
  for (const { id, folder } of CONTINENTS) {
    const search = encodeURIComponent(`world/minimaps/${folder}/map`);
    const url = `https://wago.tools/api/files?search=${search}&build=${encodeURIComponent(build)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'veilmap-tools/1' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    const tiles = parseMinimapListing(await res.json(), folder);
    console.log(`  ${folder}: ${tiles.size} minimap tiles`);
    if (tiles.size < MIN_TILES) throw new Error(`${folder}: only ${tiles.size} tiles; listing looks truncated`);
    byContinent.set(id, tiles);
  }

  const target = resolve(process.cwd(), out);
  await writeAtomic(target, emitMinimapLua(byContinent, { build, generatedFrom: 'wago.tools' }));
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
