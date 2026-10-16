# Veilmap phase 5: in-game checks

Run these on WoW Forever with the branch build installed, before merging to `main`.
Defaults: close-zoom detail on, strength 60%, deepest zoom 4x.
Chat lines must stay under 255 characters; the `/run` lines below do.

| # | Check | Pass when |
|---|---|---|
| 1 | Open Elwynn Forest fully zoomed out | Looks identical to before: no minimap terrain visible. |
| 2 | Wheel-zoom in as far as it goes | The deepest zoom is about 4x. One-liner B prints `1.00 1.57 2.14 3.00 4.00`. |
| 3 | Zoom from 1x to 2x around Goldshire and Crystal Lake | Terrain fades in gradually, and roads, rivers and the lake line up with the painted map. |
| 4 | Zoom into a partly unexplored zone | The fog tint covers the terrain over unexplored areas. Quest blobs and pins sit above both. One-liner C: fog level > detail level. |
| 5 | Zoom and pan along every edge of a zone map | No terrain spills past the map's painted area. |
| 6 | Pan around the Barrens and Stranglethorn Vale at 2-4x | Smooth: no stutter beyond normal map panning. |
| 7 | Eastern Kingdoms, Kalimdor, Azeroth, and a dungeon map | No extra zoom, no terrain. |
| 8 | Move the Detail strength slider while zoomed in | Changes immediately; 0% shows no terrain. |
| 9 | Set Deepest zoom to 8x, change zone and back | The new zone zooms to 8x (one-liner B ends `8.00`). At 2x: Blizzard's normal zoom (ends `2.14`). |
| 10 | Untick Close-zoom detail | Terrain disappears at once; after a map change the zoom is back to 2.14x. |
| 11 | Maximize and restore the map while zoomed in | Zoom levels and terrain stay correct (one-liner B still ends at the slider value). |
| 12 | **Combat (default):** in combat, wheel-zoom; change zones with the map open; open the map; maximize it; click quest and flight pins while deep-zoomed | No "Interface action failed because of an AddOn" message and no Lua errors. A map changed during combat may stop at 2.14x until the next map change; that's expected. |
| 13 | **Combat (debug):** type `/vm debug combatzoom` (prints ON), then repeat 12 several times, especially changing zones with the map open in combat | Report the result. Clean means the combat limit gets lifted before release; any "action blocked" means it stays. |

One-liners:

A. Map world rectangle (should print the map ID, a continent of 0 or 1, and two numbers):

    /run local m=WorldMapFrame:GetMapID() local c,p=C_Map.GetWorldPosFromMapPos(m,CreateVector2D(0,0)) print(m,c,p and p:GetXY())

B. Zoom levels, relative to fully zoomed out:

    /run local s=WorldMapFrame.ScrollContainer local o={} for i,l in ipairs(s.zoomLevels) do o[i]=("%.2f"):format(l.scale/s.zoomLevels[1].scale) end print(table.concat(o," "))

C. Pin frame levels (fog must be higher than detail):

    /run for p in WorldMapFrame:EnumeratePinsByTemplate("VeilmapDetailPinTemplate") do print("detail",p:GetFrameLevel()) end for p in WorldMapFrame:EnumeratePinsByTemplate("VeilmapFogPinTemplate") do print("fog",p:GetFrameLevel()) end
