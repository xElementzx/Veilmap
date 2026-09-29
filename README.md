# Veilmap

A World Map addon for WoW Forever.

Fog data covers 84 map art IDs / 1073 overlays, generated from WoW build 1.60.1.69913.

- Reveals fog of war as a tinted overlay in a colour you choose, rather than removing it
- Scales the world map
- Sets map transparency, so the map stays usable while you move
- Shows player and cursor coordinates

## Development

Fog data is generated from [wago.tools](https://wago.tools) DB2 exports:

    node tools/genfogdata.mjs --build 1.60.1.69913 --out Fog/Data_Forever.lua

Tests:

    cd tools && npm test

## Licence

GPL-3.0-or-later. See `LICENSE`.
