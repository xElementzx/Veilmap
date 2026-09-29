// Veilmap - GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseCsv } from '../lib/csv.mjs';
import { buildDataset } from '../lib/dataset.mjs';
import { assertDatasetUsable } from '../lib/verify.mjs';

const fixture = (name) =>
  readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8').then(parseCsv);

test('assertDatasetUsable', async (t) => {
  const overlayRows = await fixture('overlay-2153.csv');
  const tileRows = await fixture('tile-2153.csv');
  const healthyDataset = buildDataset(overlayRows, tileRows);

  await t.test('throws when overlayRows is empty, naming the actual count', () => {
    assert.throws(
      () => assertDatasetUsable({ overlayRows: [], tileRows, dataset: healthyDataset }),
      /WorldMapOverlay returned 0 rows/,
    );
  });

  await t.test('throws when tileRows is empty, naming the actual count', () => {
    assert.throws(
      () => assertDatasetUsable({ overlayRows, tileRows: [], dataset: healthyDataset }),
      /WorldMapOverlayTile returned 0 rows/,
    );
  });

  await t.test('throws when the dataset has zero art IDs', () => {
    assert.throws(
      () => assertDatasetUsable({ overlayRows, tileRows, dataset: new Map() }),
      /0 map art IDs/,
    );
  });

  await t.test('throws when the dataset has art IDs but zero entries', () => {
    const emptyEntriesDataset = new Map([[1234, []]]);
    assert.throws(
      () => assertDatasetUsable({ overlayRows, tileRows, dataset: emptyEntriesDataset }),
      /0 overlay entries/,
    );
  });

  await t.test('does not throw for a healthy dataset', () => {
    assert.doesNotThrow(() =>
      assertDatasetUsable({ overlayRows, tileRows, dataset: healthyDataset }),
    );
  });
});
