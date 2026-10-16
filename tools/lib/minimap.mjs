// Veilmap - GPL-3.0-or-later
// The game's minimap tiles, by continent: the close-zoom detail layer's source.

// Real counts on 1.60.1.69913 are 1184 (azeroth) and 1105 (kalimdor); fewer
// than this means a truncated listing, not a smaller world.
export const MIN_TILES = 1000;

export function parseMinimapListing(files, folder) {
  const pattern = new RegExp(`^world/minimaps/${folder}/map(\\d+)_(\\d+)\\.blp$`);
  const tiles = new Map();
  for (const [fileID, path] of Object.entries(files)) {
    const m = pattern.exec(path);
    if (!m) continue;
    const x = Number(m[1]);
    const y = Number(m[2]);
    if (x >= 64 || y >= 64) continue;
    tiles.set(x * 64 + y, Number(fileID));
  }
  return tiles;
}

export function emitMinimapLua(byContinent, meta) {
  const out = [];
  out.push('--[[');
  out.push('Veilmap - Copyright (C) 2026 xElementzx');
  out.push('GPL-3.0-or-later. See LICENSE.');
  out.push('');
  out.push('GENERATED FILE - do not edit by hand.');
  out.push(`Source: ${meta.generatedFrom}, WoW build ${meta.build} (world/minimaps/<continent>/mapX_Y.blp)`);
  out.push('Regenerate with:');
  out.push(`  node tools/genminimap.mjs --build ${meta.build} --out Detail/Data_Minimap_Forever.lua`);
  out.push('');
  out.push('[continentID] = { [tileX * 64 + tileY] = fileDataID, ... }');
  out.push(']]');
  out.push('');
  out.push('VeilmapMinimapTiles = {');
  for (const continent of [...byContinent.keys()].sort((a, b) => a - b)) {
    out.push(`\t[${continent}] = {`);
    const entries = [...byContinent.get(continent).entries()].sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < entries.length; i += 8) {
      out.push('\t\t' + entries.slice(i, i + 8).map(([k, v]) => `[${k}] = ${v},`).join(' '));
    }
    out.push('\t},');
  }
  out.push('}');
  out.push('');
  return out.join('\n');
}
