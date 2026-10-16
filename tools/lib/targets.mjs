// Veilmap - GPL-3.0-or-later
// Turns terrain chunks into a few waypoint targets per area: points on ground
// whose area ID really triggers the area's discovery.

export function collectAreaChunks(continents, wanted) {
  const perArea = new Map(); // areaID -> Map<continent, points[]>
  const order = [...continents.keys()].sort((a, b) => a - b);
  for (const continent of order) {
    for (const c of continents.get(continent)) {
      if (!wanted.has(c.areaID)) continue;
      let byContinent = perArea.get(c.areaID);
      if (!byContinent) perArea.set(c.areaID, (byContinent = new Map()));
      let points = byContinent.get(continent);
      if (!points) byContinent.set(continent, (points = []));
      points.push({ x: c.x, y: c.y });
    }
  }

  const out = new Map();
  for (const [areaID, byContinent] of perArea) {
    let best;
    // Continents iterate in ascending ID order, and strict > keeps the lower one on a tie.
    for (const [continent, points] of byContinent) {
      if (!best || points.length > best.points.length) best = { continent, points };
    }
    out.set(areaID, best);
  }
  return out;
}

const d2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

// Deterministic farthest-point sampling: start at the point nearest the
// centroid, then repeatedly add the point farthest from everything chosen.
export function samplePoints(points, k = 8) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length <= k) return sorted;

  const centroid = {
    x: sorted.reduce((s, p) => s + p.x, 0) / sorted.length,
    y: sorted.reduce((s, p) => s + p.y, 0) / sorted.length,
  };
  let first = 0;
  for (let i = 1; i < sorted.length; i++) {
    if (d2(sorted[i], centroid) < d2(sorted[first], centroid)) first = i;
  }

  const chosen = [sorted[first]];
  const nearest = sorted.map((p) => d2(p, sorted[first]));
  while (chosen.length < k) {
    let pick = 0;
    for (let i = 1; i < sorted.length; i++) if (nearest[i] > nearest[pick]) pick = i;
    chosen.push(sorted[pick]);
    for (let i = 0; i < sorted.length; i++) nearest[i] = Math.min(nearest[i], d2(sorted[i], sorted[pick]));
  }
  return chosen;
}

function finite(label, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`emitTargetsLua: expected a finite number for ${label}, got ${String(value)}`);
  }
  return value;
}

// One decimal is ~10 cm; plenty for a waypoint and keeps the file small.
// Rounds half away from zero (Math.round alone rounds -40.25 to -40.2), and
// "+ 0" turns -0 into 0.
const yards = (v) => {
  finite('coordinate', v);
  return String((Math.sign(v) * Math.round(Math.abs(v) * 10)) / 10 + 0);
};

export function emitTargetsLua(targets, meta) {
  const out = [];
  out.push('--[[');
  out.push('Veilmap - Copyright (C) 2026 xElementzx');
  out.push('GPL-3.0-or-later. See LICENSE.');
  out.push('');
  out.push('GENERATED FILE - do not edit by hand.');
  out.push(`Source: ${meta.generatedFrom}, WoW build ${meta.build} (terrain ADT chunk area IDs)`);
  out.push('Regenerate with:');
  out.push(`  node tools/gentargets.mjs --build ${meta.build} --cache <dir> --out Fog/Targets_Forever.lua`);
  out.push('');
  out.push('[areaID] = { continentID, x1, y1, x2, y2, ... } -- world yards, chunk centres');
  out.push('Ground that triggers the area\'s discovery; up to 8 points spread over the area.');
  out.push(']]');
  out.push('');
  out.push('VeilmapAreaTargets = {');
  for (const areaID of [...targets.keys()].sort((a, b) => a - b)) {
    const { continent, points } = targets.get(areaID);
    const values = [String(finite('continent', continent))];
    for (const p of points) values.push(yards(p.x), yards(p.y));
    out.push(`\t[${finite('areaID', areaID)}] = {${values.join(',')}},`);
  }
  out.push('}');
  out.push('');
  return out.join('\n');
}
