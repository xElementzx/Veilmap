# Veilmap phase 4: in-game checks

Run these on WoW Forever with the branch build installed, before merging to `main`.
Use a character with a partly explored zone (a fresh character in Elwynn Forest is ideal).
Chat lines must stay under 255 characters; the `/run` lines below do.

| # | Check | Pass when |
|---|---|---|
| 1 | Alt + left-click on empty map (no fog) on a zone map | Nothing happens. Blizzard has no native Alt-click there. If it does something, note what. |
| 2 | Enter combat, then Alt-click a fog patch | Chat: `Veilmap: can't set a waypoint in combat.` No "action blocked" popup. |
| 3 | Open the map (not maximized) | Tab and panel sit outside the map's right edge, below the title bar. Nothing Blizzard overlaps them (open the quest log too). |
| 4 | Hover a quest POI or flight master that sits over fog | Blizzard's tooltip shows, not Veilmap's. |
| 5 | Hover patch edges in Elwynn, Westfall and one Kalimdor zone | The tooltip appears roughly where the tinted patch is. |
| 6 | Alt-click a patch, walk into it | Arrow and distance show while walking. On discovery: `Veilmap: discovered <name>, waypoint cleared.` and the pin is gone. |
| 7 | Alt-click a patch, then Ctrl-click elsewhere to re-pin by hand, then discover the first patch | Your hand-placed pin stays. No Veilmap message. |
| 8 | Hover a multi-area patch | Every area name is listed: the tooltip shows two or more white lines. About 1 patch in 16 covers more than one area. |
| 9 | List in your own zone, then browse to another zone | Own zone: nearest first. Other zone: alphabetical. |
| 10 | Hover a list row | That area's patches brighten. Moving off restores the tint. |
| 11 | Click a list row | Waypoint set, with the chat confirmation. |
| 12 | Maximize the map | Tab and panel move inside the top-right corner and open inwards. Restoring moves them back outside. |
| 13 | Continent map, dungeon map | No tab, no panel, no tooltips. |
| 14 | Fully explore a small area set, or use a fully explored zone | Header reads `All explored`. |
| 15 | Toggle both new options off and on in `/vm` | Tooltips and the list disappear and return without `/reload`. |
| 16 | Tab arrow textures | Arrows render (not green squares). |
| 17 | Explore a new area with the map open | The fog patch disappears and the list updates without reopening the map. |

Useful one-liners:

    /run local c=Veilmap.FogProvider:GetUnexplored() print(c and c.mapID, c and #c.unexplored, c and c.layerWidth, c and c.layerHeight)
    /run local p=C_Map.GetUserWaypoint() print(p and p.uiMapID, p and p.position.x, p and p.position.y)
