// Veilmap - GPL-3.0-or-later
// Guards against silently overwriting a good, verified fog dataset with an
// empty or truncated one. This deliberately does NOT hard-code expected
// counts (e.g. 1081 overlay rows, 84 art IDs) - those numbers will
// legitimately change across Forever content patches, and a generator that
// refuses to run after every patch is worse than useless. This only guards
// against empty/absurd input, never against content drift.

export function assertDatasetUsable({ overlayRows, tileRows, dataset }) {
  const overlayCount = overlayRows ? overlayRows.length : 0;
  const tileCount = tileRows ? tileRows.length : 0;

  if (overlayCount === 0) {
    throw new Error(
      `refusing to write dataset: WorldMapOverlay returned 0 rows (got ${overlayCount}) - ` +
        'source table is empty, truncated, or the fetch failed silently',
    );
  }

  if (tileCount === 0) {
    throw new Error(
      `refusing to write dataset: WorldMapOverlayTile returned 0 rows (got ${tileCount}) - ` +
        'source table is empty, truncated, or the fetch failed silently',
    );
  }

  const artCount = dataset ? dataset.size : 0;
  if (artCount === 0) {
    throw new Error(
      `refusing to write dataset: joined dataset has 0 map art IDs ` +
        `(from ${overlayCount} overlay rows and ${tileCount} tile rows) - ` +
        'the overlay/tile join produced nothing usable',
    );
  }

  const entryCount = [...dataset.values()].reduce((n, e) => n + e.length, 0);
  if (entryCount === 0) {
    throw new Error(
      `refusing to write dataset: joined dataset has 0 overlay entries across ` +
        `${artCount} map art IDs - the overlay/tile join produced nothing usable`,
    );
  }
}
