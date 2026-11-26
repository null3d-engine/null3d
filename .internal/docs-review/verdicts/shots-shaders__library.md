# Verdicts: shots and demo links for shaders/library

The page is generated from the WGSL library doc comments (tools/lib/shader-library.ts). Image and link proposals go into that generator.

## Shots

### noise-kinds: keep, with corrected steps

The picture helps. The page names five kinds of 2D noise in words only, and a reader picks one by how it looks.

The source needs work:
- No such page exists yet. The current shader library test page (tests/pages/shader-library.ts) checks numbers and draws no pictures, so a new test page must be built first.
- The steps do not give one gray scale for all five tiles. `perlin2`, `simplex2` and `fbm2` return about -1 to 1, so half of each tile would clip to black. `value2` returns 0 to 1, and `worley2` returns 0 to about 1.
- `fbm2` needs an octave count.
- Unlit quads cannot draw text labels.

Corrected steps: build a new test page with five unlit quads in a row at 960x200, and turn off tone mapping on each quad (`toneMapped: false`). The quads return a gray value from `value2(uv*8)`, `perlin2(uv*8)*0.5+0.5`, `simplex2(uv*8)*0.5+0.5`, `worley2(uv*8)` and `fbm2(uv*8, 4u)*0.5+0.5`. Put the labels in an HTML overlay, or name the tiles in the caption. The noise does not change with time, so wait zero seconds before the capture.

## Demo links

- aurora/ for "Noise in a sky layer": do not keep it here. The link opens examples/aurora, and the code there imports only `reflection_uv` for the ice. The `fbm2` calls are in examples/addons/aurora/aurora.wgsl, which is not a valid demo link code. A reader who follows this link finds no noise code.
- shader-inputs/ for `reflection_uv`: keep. pool.ts calls `reflection_uv` with an offset from the ripple slope. The page describes this same case. The floor reflection shows in the default view (reference demo-shader-inputs.png).
- showroom/ for "Lighting helpers in a lobe": do not keep. No showroom file imports `null3d::lighting`. Its floor.ts imports only `fbm2` and `reflection_uv`. No example anywhere imports `null3d::lighting`.
- New: shader-inputs/ for `null3d::noise`. pool.ts uses `fbm2` for the slate's clouding, its veins and its wet hollows, in code that a reader can see at the link. It replaces aurora/ under noise.

## Concepts without a demo

- `null3d::sdf`: confirmed. No example imports it.
- `null3d::depth`: confirmed. No example imports it.
- `null3d::fog`: confirmed. Many demos show scene fog, but no example shader imports this module.
- `null3d::lighting`: add it to this list, because the showroom link is wrong. No example imports it.
