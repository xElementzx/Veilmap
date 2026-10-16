// Veilmap - GPL-3.0-or-later
// Joins WorldMapOverlay to WorldMapOverlayTile and groups by UiMapArtID.

const num = (v) => Number(v ?? 0);

const AREA_COLUMNS = ['AreaID_0', 'AreaID_1', 'AreaID_2', 'AreaID_3'];

// Every non-zero area the overlay covers, in column order. AreaID_0 is
// non-zero on every Forever row, so this is never empty in practice.
function areaIDsOf(overlay) {
  return AREA_COLUMNS.map((c) => num(overlay[c])).filter((id) => id !== 0);
}

// [left, top, right, bottom] in map-art pixels. Rows whose hit rect is all
// zeros fall back to the overlay's own bounds, so the Lua side never needs a
// fallback of its own.
function hitRectOf(overlay, width, height, offsetX, offsetY) {
  const rect = [
    num(overlay.HitRectLeft),
    num(overlay.HitRectTop),
    num(overlay.HitRectRight),
    num(overlay.HitRectBottom),
  ];
  if (rect.every((v) => v === 0)) return [offsetX, offsetY, offsetX + width, offsetY + height];
  return rect;
}

export function buildDataset(overlayRows, tileRows) {
  const tilesByOverlay = new Map();
  for (const tile of tileRows) {
    const id = num(tile.WorldMapOverlayID);
    let list = tilesByOverlay.get(id);
    if (!list) tilesByOverlay.set(id, (list = []));
    list.push(tile);
  }

  const byArt = new Map();
  for (const overlay of overlayRows) {
    const tiles = tilesByOverlay.get(num(overlay.ID));
    if (!tiles || tiles.length === 0) continue; // tile-less overlays render nothing

    // Explicit ordering. Blizzard indexes tiles row-major; do not assume file order.
    tiles.sort(
      (a, b) => num(a.RowIndex) - num(b.RowIndex) || num(a.ColIndex) - num(b.ColIndex),
    );

    const art = num(overlay.UiMapArtID);
    let entries = byArt.get(art);
    if (!entries) byArt.set(art, (entries = []));

    const width = num(overlay.TextureWidth);
    const height = num(overlay.TextureHeight);
    const offsetX = num(overlay.OffsetX);
    const offsetY = num(overlay.OffsetY);
    entries.push({
      width,
      height,
      offsetX,
      offsetY,
      areaIDs: areaIDsOf(overlay),
      fileDataIDs: tiles.map((t) => num(t.FileDataID)),
      hitRect: hitRectOf(overlay, width, height, offsetX, offsetY),
    });
  }

  for (const entries of byArt.values()) {
    entries.sort(
      (a, b) =>
        a.offsetY - b.offsetY ||
        a.offsetX - b.offsetX ||
        a.width - b.width ||
        a.height - b.height,
    );
  }
  return byArt;
}
