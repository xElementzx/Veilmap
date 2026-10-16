// Veilmap - GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseCsv } from '../lib/csv.mjs';
import { buildDataset } from '../lib/dataset.mjs';

const fixture = (name) =>
  readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8').then(parseCsv);

// Minimal overlay row with every column the generator reads. Values are strings,
// as parseCsv produces them.
function overlayRow(fields) {
  return {
    ID: '1', UiMapArtID: '7', TextureWidth: '100', TextureHeight: '50',
    OffsetX: '10', OffsetY: '20',
    HitRectTop: '0', HitRectBottom: '0', HitRectLeft: '0', HitRectRight: '0',
    AreaID_0: '5', AreaID_1: '0', AreaID_2: '0', AreaID_3: '0',
    ...fields,
  };
}
const tileFor = (id) => ({ ID: '1', RowIndex: '0', ColIndex: '0', FileDataID: '42', WorldMapOverlayID: id });

test('buildDataset', async (t) => {
  const overlays = await fixture('overlay-2153.csv');
  const tiles = await fixture('tile-2153.csv');
  const ds = buildDataset(overlays, tiles);

  await t.test('groups entries under their UiMapArtID', () => {
    assert.deepEqual([...ds.keys()], [2153]);
  });

  await t.test('drops overlays that have no tiles', () => {
    assert.equal(ds.get(2153).length, 3);
    assert.ok(!ds.get(2153).some((e) => e.areaIDs[0] === 999));
  });

  await t.test('matches the live client for overlay 5157', () => {
    // Verified against C_MapExplorationInfo.GetExploredMapTextures on 1.60.1.69913.
    const e = ds.get(2153).find((x) => x.areaIDs[0] === 18);
    assert.deepEqual(
      { w: e.width, h: e.height, x: e.offsetX, y: e.offsetY },
      { w: 256, h: 256, x: 422, y: 332 },
    );
    assert.deepEqual(e.fileDataIDs, [272806]);
  });

  await t.test('orders tiles by RowIndex then ColIndex', () => {
    const e = ds.get(2153).find((x) => x.areaIDs[0] === 60);
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

  await t.test('reads the hit rect as [left, top, right, bottom]', () => {
    // Fixture row 5157: HitRectTop=380 Bottom=475 Left=450 Right=605.
    const e = ds.get(2153).find((x) => x.areaIDs[0] === 18);
    assert.deepEqual(e.hitRect, [450, 380, 605, 475]);
  });

  await t.test('collects every non-zero AreaID column, in column order', () => {
    const d = buildDataset(
      [overlayRow({ AreaID_0: '61', AreaID_1: '0', AreaID_2: '63', AreaID_3: '62' })],
      [tileFor('1')],
    );
    assert.deepEqual(d.get(7)[0].areaIDs, [61, 63, 62]);
  });

  await t.test('a single-area overlay yields a one-element list', () => {
    const d = buildDataset([overlayRow({})], [tileFor('1')]);
    assert.deepEqual(d.get(7)[0].areaIDs, [5]);
  });

  await t.test('an all-zero hit rect falls back to the overlay bounds', () => {
    const d = buildDataset([overlayRow({})], [tileFor('1')]);
    // offset (10, 20), size 100 x 50
    assert.deepEqual(d.get(7)[0].hitRect, [10, 20, 110, 70]);
  });

  await t.test('a partly-zero hit rect is kept as-is', () => {
    const d = buildDataset(
      [overlayRow({ HitRectLeft: '0', HitRectTop: '0', HitRectRight: '30', HitRectBottom: '40' })],
      [tileFor('1')],
    );
    assert.deepEqual(d.get(7)[0].hitRect, [0, 0, 30, 40]);
  });
});
