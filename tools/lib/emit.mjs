// Veilmap - GPL-3.0-or-later

// Number('garbage') is NaN, and NaN.toString() is the literal text "NaN" -
// syntactically valid inside a Lua numeral position but semantically
// corrupt and silent. Refuse to emit anything for a non-finite value
// instead of writing it into the shipped data file.
function assertFinite(label, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`emitLua: expected a finite number for ${label}, got ${String(value)}`);
  }
}

export function emitLua(dataset, meta) {
  const arts = [...dataset.keys()].sort((a, b) => a - b);
  const out = [];

  out.push('--[[');
  out.push('Veilmap - Copyright (C) 2026 xElementzx');
  out.push('GPL-3.0-or-later. See LICENSE.');
  out.push('');
  out.push('GENERATED FILE - do not edit by hand.');
  out.push(`Source: ${meta.generatedFrom}, WoW build ${meta.build}`);
  out.push('Regenerate with:');
  out.push(`  node tools/genfogdata.mjs --build ${meta.build} --out Fog/Data_Forever.lua`);
  out.push('');
  out.push('[UiMapArtID] = { {width, height, offsetX, offsetY, areaID, "fileDataIDs"}, ... }');
  out.push(']]');
  out.push('');
  out.push('VeilmapFogData = {');

  for (const art of arts) {
    assertFinite('UiMapArtID', art);
    out.push(`\t[${art}] = {`);
    for (const e of dataset.get(art)) {
      assertFinite('width', e.width);
      assertFinite('height', e.height);
      assertFinite('offsetX', e.offsetX);
      assertFinite('offsetY', e.offsetY);
      assertFinite('areaID', e.areaID);
      for (const id of e.fileDataIDs) assertFinite('fileDataID', id);
      out.push(
        `\t\t{${e.width},${e.height},${e.offsetX},${e.offsetY},${e.areaID},"${e.fileDataIDs.join(',')}"},`,
      );
    }
    out.push('\t},');
  }

  out.push('}');
  out.push('');
  return out.join('\n');
}
