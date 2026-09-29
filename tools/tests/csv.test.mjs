// Veilmap - GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../lib/csv.mjs';

test('parseCsv', async (t) => {
  await t.test('parses a header and rows into objects', () => {
    const rows = parseCsv('ID,UiMapArtID\n5157,2153\n5161,2153\n');
    assert.deepEqual(rows, [
      { ID: '5157', UiMapArtID: '2153' },
      { ID: '5161', UiMapArtID: '2153' },
    ]);
  });

  await t.test('ignores a trailing newline', () => {
    assert.equal(parseCsv('A,B\n1,2\n').length, 1);
  });

  await t.test('handles CRLF line endings', () => {
    const rows = parseCsv('A,B\r\n1,2\r\n');
    assert.deepEqual(rows, [{ A: '1', B: '2' }]);
  });

  await t.test('respects quoted fields containing commas', () => {
    const rows = parseCsv('A,B\n"x,y",2\n');
    assert.deepEqual(rows, [{ A: 'x,y', B: '2' }]);
  });

  await t.test('unescapes doubled quotes inside a quoted field', () => {
    const rows = parseCsv('A\n"say ""hi"""\n');
    assert.deepEqual(rows, [{ A: 'say "hi"' }]);
  });

  await t.test('returns an empty array for header-only input', () => {
    assert.deepEqual(parseCsv('A,B\n'), []);
  });

  await t.test('strips leading UTF-8 BOM', () => {
    const rows = parseCsv('﻿ID,Name\n42,test\n');
    assert.deepEqual(rows, [{ ID: '42', Name: 'test' }]);
  });

  await t.test('throws on row with fewer fields than header', () => {
    assert.throws(
      () => parseCsv('A,B,C\n1,2\n'),
      /CSV line 2: expected 3 fields, got 2/
    );
  });

  await t.test('throws on row with more fields than header', () => {
    assert.throws(
      () => parseCsv('A,B\n1,2,3\n'),
      /CSV line 2: expected 2 fields, got 3/
    );
  });
});
