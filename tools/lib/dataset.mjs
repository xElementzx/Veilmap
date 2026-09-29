// Veilmap - GPL-3.0-or-later
// Joins WorldMapOverlay to WorldMapOverlayTile and groups by UiMapArtID.

const num = (v) => Number(v ?? 0);

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

    entries.push({
      width: num(overlay.TextureWidth),
      height: num(overlay.TextureHeight),
      offsetX: num(overlay.OffsetX),
      offsetY: num(overlay.OffsetY),
      areaID: num(overlay.AreaID_0),
      fileDataIDs: tiles.map((t) => num(t.FileDataID)),
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
