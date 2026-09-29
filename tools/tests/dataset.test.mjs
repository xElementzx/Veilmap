// Veilmap - GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseCsv } from '../lib/csv.mjs';
import { buildDataset } from '../lib/dataset.mjs';

const fixture = (name) =>
  readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8').then(parseCsv);

test('buildDataset', async (t) => {
  const overlays = await fixture('overlay-2153.csv');
  const tiles = await fixture('tile-2153.csv');
  const ds = buildDataset(overlays, tiles);

  await t.test('groups entries under their UiMapArtID', () => {
    assert.deepEqual([...ds.keys()], [2153]);
  });

  await t.test('drops overlays that have no tiles', () => {
    assert.equal(ds.get(2153).length, 3);
    assert.ok(!ds.get(2153).some((e) => e.areaID === 999));
  });

  await t.test('matches the live client for overlay 5157', () => {
    // Verified against C_MapExplorationInfo.GetExploredMapTextures on 1.60.1.69913.
    const e = ds.get(2153).find((x) => x.areaID === 18);
    assert.deepEqual(
      { w: e.width, h: e.height, x: e.offsetX, y: e.offsetY },
      { w: 256, h: 256, x: 422, y: 332 },
    );
    assert.deepEqual(e.fileDataIDs, [272806]);
  });

  await t.test('orders tiles by RowIndex then ColIndex', () => {
    const e = ds.get(2153).find((x) => x.areaID === 60);
    assert.deepEqual(e.fileDataIDs, [272901, 272902]);
  });

  await t.test('sorts entries deterministically', () => {
    const ys = ds.get(2153).map((e) => e.offsetY);
    assert.deepEqual(ys, [...ys].sort((a, b) => a - b));
  });

  await t.test('is stable across repeated runs', () => {
    const again = buildDataset(overlays, tiles);
    assert.deepEqual(again.get(2153), ds.get(2153));
  });
});
