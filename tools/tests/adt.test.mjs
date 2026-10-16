// Veilmap - GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseAdtChunks, CHUNK_SIZE, TILE_SIZE } from '../lib/adt.mjs';

const fixture = () => readFile(new URL('./fixtures/azeroth_32_49-mcnk.adt', import.meta.url));

test('parseAdtChunks', async (t) => {
  const chunks = parseAdtChunks(await fixture());

  await t.test('reads all 256 chunks of a tile', () => {
    assert.equal(chunks.length, 256);
  });

  await t.test('reads area IDs from the header', () => {
    const counts = {};
    for (const c of chunks) counts[c.areaID] = (counts[c.areaID] ?? 0) + 1;
    // Verified against the full tile: Goldshire 87 x16, Crystal Lake 18 x133.
    assert.equal(counts[87], 16);
    assert.equal(counts[18], 133);
  });

  await t.test('chunk centres match the tile/index formula', () => {
    // File azeroth_32_49: tileX = 32, tileY = 49.
    for (const c of chunks) {
      const x = 32 * TILE_SIZE - 49 * TILE_SIZE - c.indexY * CHUNK_SIZE - CHUNK_SIZE / 2;
      const y = 32 * TILE_SIZE - 32 * TILE_SIZE - c.indexX * CHUNK_SIZE - CHUNK_SIZE / 2;
      assert.ok(Math.abs(c.x - x) < 0.01, `x for ${c.indexX},${c.indexY}`);
      assert.ok(Math.abs(c.y - y) < 0.01, `y for ${c.indexX},${c.indexY}`);
    }
  });

  await t.test('Goldshire chunks centre on Goldshire', () => {
    const g = chunks.filter((c) => c.areaID === 87);
    const cx = g.reduce((s, c) => s + c.x, 0) / g.length;
    const cy = g.reduce((s, c) => s + c.y, 0) / g.length;
    assert.ok(Math.abs(cx - -9440) < 5 && Math.abs(cy - -40) < 5, `${cx}, ${cy}`);
  });

  await t.test('an empty or non-ADT buffer yields no chunks', () => {
    assert.deepEqual(parseAdtChunks(Buffer.alloc(0)), []);
    assert.deepEqual(parseAdtChunks(Buffer.from('{"error":"not found"}')), []);
  });
});
