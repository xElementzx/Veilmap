// Veilmap - GPL-3.0-or-later
// Reads the per-chunk area IDs from a root ADT terrain tile. Discovery in the
// game is triggered by these area IDs, not by the world map's overlay art.

export const TILE_SIZE = 1600 / 3; // yards per ADT tile
export const CHUNK_SIZE = TILE_SIZE / 16; // yards per MCNK chunk

const HEADER = 8; // chunk magic + size
const MCNK_HEADER_MIN = 0x74; // through the position vector

// Chunk magics are stored byte-reversed on disk ("KNCM" for MCNK).
const MCNK = 'KNCM';

export function parseAdtChunks(buffer) {
  const chunks = [];
  let offset = 0;
  while (offset + HEADER <= buffer.length) {
    const magic = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + HEADER;
    if (magic === MCNK && size >= MCNK_HEADER_MIN && body + MCNK_HEADER_MIN <= buffer.length) {
      // The header's position is the chunk's top-left corner in world yards.
      chunks.push({
        indexX: buffer.readUInt32LE(body + 0x04),
        indexY: buffer.readUInt32LE(body + 0x08),
        areaID: buffer.readUInt32LE(body + 0x34),
        x: buffer.readFloatLE(body + 0x68) - CHUNK_SIZE / 2,
        y: buffer.readFloatLE(body + 0x6c) - CHUNK_SIZE / 2,
      });
    }
    offset = body + size;
  }
  return chunks;
}
