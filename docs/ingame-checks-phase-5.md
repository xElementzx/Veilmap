# Veilmap phase 5: in-game checks

Run these on WoW Forever with the branch build installed, before merging to `main`.
Defaults: close-zoom detail on, strength 60%. Blizzard's own zoom (up to 2.14x) is unchanged.
For the combat checks, turn on the taint log first with `/console taintLog 1`, and turn it off
afterwards with `/console taintLog 0`. The log is `Logs\taint.log` in the game folder.
Chat lines must stay under 255 characters; the `/run` lines below do.

| # | Check | Pass when |
|---|---|---|
| 1 | Open Elwynn Forest fully zoomed out | Looks identical to before: no minimap terrain visible. |
| 2 | Wheel-zoom in as far as it goes | Blizzard's normal limit. One-liner B prints `1.00 1.57 2.14`. |
| 3 | Zoom from 1x to 2x around Goldshire and Crystal Lake | Terrain fades in gradually, and roads, rivers and the lake line up with the painted map. |
| 4 | Zoom into a partly unexplored zone | The fog tint covers the terrain over unexplored areas. Quest blobs and pins sit above both. One-liner C: fog level > detail level. |
| 5 | Zoom and pan along every edge of a zone map | No terrain spills past the map's painted area. |
| 6 | Pan around the Barrens and Stranglethorn Vale at 2x | Smooth: no stutter beyond normal map panning. |
| 7 | Eastern Kingdoms, Kalimdor, Azeroth, and a dungeon map | No terrain. |
| 8 | Move the Detail strength slider while zoomed in | Changes immediately; 0% shows no terrain. |
| 9 | Untick Close-zoom detail (also try it in combat) | Terrain disappears at once. |
| 10 | Maximize and restore the map while zoomed in | Terrain stays aligned. |
| 11 | **Combat:** open the map in combat on a zone and zoom to 2x | Terrain shows. No "Interface action failed because of an AddOn", and no new Veilmap lines in the taint log. |
| 12 | **Combat:** with the map open and zoomed, change zones in combat | Terrain on the new map is correct, not the old map's. |
| 13 | **Combat:** wheel-zoom, pan, maximize, and click quest and flight pins | No "action blocked" and no Lua errors. |

One-liners:

A. Map world rectangle (prints the map ID, a continent of 0 or 1, then the world X and Y of the map's top-left corner):

    /run local m=WorldMapFrame:GetMapID() local c,p=C_Map.GetWorldPosFromMapPos(m,CreateVector2D(0,0)) print(m,c,p:GetXY())

B. Zoom levels, relative to fully zoomed out:

    /run local s=WorldMapFrame.ScrollContainer local o={} for i,l in ipairs(s.zoomLevels) do o[i]=("%.2f"):format(l.scale/s.zoomLevels[1].scale) end print(table.concat(o," "))

C. Frame levels (fog must be higher than detail):

    /run print("detail",WorldMapFrame:GetPinFrameLevelsManager():GetValidFrameLevel("PIN_FRAME_LEVEL_EVENT_OVERLAY")) for p in WorldMapFrame:EnumeratePinsByTemplate("VeilmapFogPinTemplate") do print("fog",p:GetFrameLevel()) end
