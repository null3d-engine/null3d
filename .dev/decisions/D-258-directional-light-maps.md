# D-258: Directional light maps, and reading Needle's light maps

Status: decided by the helper of M3-F4, for the owner's review. Built: the second texture, the
shader weighting, the glTF reader, the picture test, the memory figure, the cost page with its
figures, and the comparison with Needle's viewer that the done criterion needs. Task: M3-F4.

Summary: A directional light map carries the light's direction in a second texture of the
radiance's own size, format and color space, so both share one texture array, one binding and one
WebGL2 texture unit, and the map costs exactly twice the radiance's memory. The direction is a
unit vector in world space, and the shader weights the baked light by the surface's half-Lambert
term against the bake's, so a normal map's relief reacts to the baked light while a surface that
faces as the bake did keeps its light. The loader reads `NEEDLE_lightmaps` and each node's Needle
`MeshRenderer`, which gives a light map its RGBM decode, the second texture coordinates and its own
scale and offset.

## Question

A light map stores the light that reaches each texel, but not where it came from, so a normal map
cannot bend it and a scene lit by a bake looks flat. Which form carries the direction, how does it
reach the shader without another texture unit on WebGL2, and how does a light map that Needle's
viewer made reach the material that draws it?

## Rule

M3-F4's done criterion: a `NEEDLE_lightmaps` file draws as Needle's viewer shows it, the extra cost
is about 0.1 ms, and the light map takes at most twice the memory of a plain one. A plain light
map must draw the same picture whether or not the engine reads directions.

## Owner's ruling

Owner, 31 October 2026: a like-for-like comparison with Needle's viewer is owed before this task
closes. A frame of the viewer's own sample scene does not settle the done clause. Build a
comparison of the same file on both sides, and let it say what it settles. <!-- outside date -->

## Data

| Measure | Plain light map | Directional light map | Device |
| --- | --- | --- | --- |
| File bytes, per texel | 3 (`rgb8`) | 6 (`rgb8` and 3 direction bytes) | none |
| GPU bytes, 1,024 x 1,024, `rgb8` radiance uploaded as RGBA8 | 4,194,304 (4 MiB) | 8,388,608 (8 MiB) | none |
| GPU bytes, 1,024 x 1,024, `rgba16float` radiance | 8,388,608 (8 MiB) | 16,777,216 (16 MiB) | none |
| Ratio | 1.00 | 2.00 | none |
| GPU time per frame, 1600 x 900, WebGPU | 0.99 ms | 1.05 ms | Chrome on this Mac, 25 October 2026 |
| GPU time per frame, 1600 x 900, compatibility mode | 0.99 ms | 1.06 ms | Chrome on this Mac, 26 October 2026, High preset, pixel ratio 1, gate 7.8 (below) |
| GPU time per frame, 1600 x 900, WebGL2 | 1.48 ms | 1.58 ms | Chrome on this Mac, 25 October 2026 |

The GPU figures count the one level that `assets.loadLightMap` makes, which holds no mip chain for
either encoding, at 4 bytes for each texel of an `rgb8` radiance and 8 for one of `rgba16float`.
They are what the texture store holds for a texture of that size and format, not an estimate
from the file.

The `lightmap-cost` page measured the cost in headless Chrome on the Mac's GPU.
The figures were taken on `1c76d6cf8`, whose drawing code is the code that this record describes.
The page draws 24 lit quads that fill a 1600 by 900 view once, so every pixel shades one fragment.
The plain and directional builds swap in turns for four rounds each, and the order reverses on
alternate rounds. Before the timing the page draws one frame of each side and compares them. The
direction moved 55.71% of the pixels on WebGPU, 55.46% in compatibility mode and 55.48% on WebGL2,
so it reached the shader on every path. The direction costs about a tenth of a millisecond on every
path: 0.06 ms on WebGPU, 0.07 ms in compatibility mode and 0.10 ms on WebGL2.

The first run took its slot at 22:39:45. These facts bound how far its figures can be trusted. The
gate checks the load only before each path's page. It polls every 15 seconds until the load is
below 8, and it never checks during the rounds. The first run's three readings were 7.5, 7.9 and
7.5. WebGPU and WebGL2 then measured while the load drifted upward, to 9.9 and 9.2 by the end of
each path. The indexer ran between 180% and 280% through that run. Those two paths' medians match
their trials to 0.00 ms on WebGPU and 0.03 ms on WebGL2's directional side.

The compatibility path's first attempt ran from 22:41 to 22:46. That span contained the push
session's commit hook and shader-set copy from 22:43:45 to 22:44:06, about twenty seconds of another
job's work. It read 1.11 ms plain against 1.26 ms directional, so 0.15 ms, and that doubt stands:
the record discards it. A later run measured that path alone at the High preset and pixel ratio 1,
with the indexer quiet and the gate at 7.8 before the page and 6.9 after. It
read 0.99 ms plain against 1.06 ms directional, so 0.07 ms, and moved 55.46% of the pixels. That
is the compatibility figure in the table, and
[20261026-005236-lightmap-cost](../tested-devices/macbook-pro-chrome/20261026-005236-lightmap-cost.md)
holds the run. [Benchmarks](../benchmarks.md#directional-light-maps) gives the command.

The comparison with Needle's viewer is built, as the owner's ruling asks, and
[20261101-160830-needle-viewer-comparison](../tested-devices/macbook-pro-chrome/20261101-160830-needle-viewer-comparison.md)
holds both pictures and their difference. The viewer loads the same reduced `scene.gltf` through
the `needle-engine` element's `src` attribute, and the engine draws it through
`tests/pages/sketches/needle-viewer-sketch.ts`. The viewer reads the file's `Capture Camera` node
for its camera, its 55-degree field of view and its near and far planes. The sketch carries that
pose as constants of its own, so the two sides agree today, but a change to the node alone would
desync them. Neither side adds a light, an ambient light, an environment or a tone curve, and both
scale the exposure by one, so the baked light is the only light in both pictures.
`tools/needle-viewer-compare.ts` takes both pictures and reports the difference.

The engine's WebGPU picture differs from the viewer's at 0.051% of the pixels past the image tests'
threshold, compatibility mode at 0.025% and WebGL2 at 0.052%, all inside the 0.1% that the image
tests allow. At one step in 255 they differ at 8.486%, 5.121% and 8.400%, which is the dithering
and the rounding of surfaces that agree within a step. The pixels past the threshold lie on the
roof slab's and the wall's edges, where the two renderers smooth an edge with their own samples.

The comparison covers the plain light map alone, because the reduced sample carries no direction
texture; the direction rests on the cost page's movement between the plain and directional builds
and on the Rust test, not on the viewer, and a viewer comparison of it needs a sample with a
direction texture.

The comparison settles the done clause's picture: the reduced `NEEDLE_lightmaps` file draws as
Needle's viewer shows it. A wrong RGBM decode would change the brightness, and a wrong coordinate
set, scale or offset would smear the bake. The pictures show neither. The residue is the two
renderers' edges and their rounding, not the light map.

## Decision

- The direction travels in a texture of its own, in the radiance's format, size and color space,
  which the texture store therefore places in the radiance's own array. A shader reads it through
  the light map's binding at its own layer, so it needs no binding, no shader variant and no
  WebGL2 texture unit of its own. The materials' row keeps the direction's layer in the spare
  float of the transmission's vector.
- The direction is a unit vector in world space, one per texel. A bake tool knows the world, and a
  world-space direction needs no tangent frame at bake time, unlike the tangent-space form that a
  Unity bake uses.
- The shader weights the baked light by `(0.5 + 0.5 * dot(n, d)) / max(0.5 + 0.5 * dot(n0, d),
  0.25)`, capped at 2.5, where `n` is the shaded normal and `n0` the mesh's own. A surface with no
  normal map is unchanged, since the ratio is one, and the clamp keeps a surface that faces away
  from the bake's light from blowing up. The weight touches the light map's light alone, not the
  environment's or the ambient light's.
- A light map's scale and offset are its own, as three.js's `texture.repeat` and `texture.offset`
  are, so a bake can place each mesh's map apart from the other maps. The materials' row holds a
  vector of four floats for that transform.
- The glTF reader reads `NEEDLE_lightmaps.textures` for entries of the light map kind, and each
  node's `MeshRenderer` in `NEEDLE_components` for the map's index and its `lightmapScaleOffset`.
  The texture keeps its bytes in linear color, and the material decodes the RGBM texels: each color
  times the texel's alpha times 8, then the sRGB transfer. The map reads the second texture
  coordinates, and a mesh without them reads its first, as Needle's viewer does.
- A node that places a light map of its own takes a material of its own, since one glTF material
  can be drawn by many nodes with different bakes. The loader caches the material by material,
  variant, map and transform, so nodes that place their maps alike share one.

## Options rejected

- **The direction in the radiance texture's alpha or low bits.** Eight bits carry one axis at best,
  and the low bits of an 8-bit radiance band before the direction is usable.
- **An `rgba16float` radiance with the direction in its alpha.** One texture and no second
  binding, but the direction needs two axes and 16 bits cannot hold two 8-bit axes at the
  precision a half float keeps, and the radiance would lose its sRGB path.
- **A map slot of its own.** A ninth slot grows every material's map table, the flags that name
  each map's coordinates and the bind groups of every build, for a map that one material in a
  scene has.
- **A tangent-space direction, as Unity bakes it.** It needs the bake to know each mesh's tangent
  frame, which a bake outside the engine does not have, and a normal map would then need the same
  frame at draw time.

## Consequences

- `materials.standard` takes `lightMapDirection`, `lightMapOffset`, `lightMapRepeat` and
  `lightMapDecode`. `assets.loadLightMap` gives `directionTexture` beside the radiance's texture,
  and the [baked light data guide](../../docs/guides/baked-light-data.md) shows both.
- The material row is 592 bytes (`MATERIAL_BYTES`). The light map's transform is the `vec4f` at
  floats 68 to 71 (`LIGHT_MAP_SCALE` and `LIGHT_MAP_OFFSET` in `crates/null3d-render/src/materials.rs`).
  The shader's fragment stage reads the light map's transform and direction layer only for a
  material that has a light map.
- `NEEDLE_lightmaps` and `NEEDLE_components` join the extensions that the loader reads, and the
  [assets page](../../docs/api/assets.md) names what each gives.
- The guards: the picture test `needle-lightmap` holds the decode and the placement still, a unit
  test parses the reduced real sample's fields, the texture store drops a direction that is not in
  the radiance's array, and a material test covers each option's refusal.
- The viewer comparison is `tools/needle-viewer-compare.ts`. It needs a checkout of
  madjin/lightmap-tests at the pinned commit, starts the viewer and the dev server, and writes both
  pictures, their diffs and a JSON record. The reduced sample carries the capture camera as a node,
  so the viewer and the sketch take the same pose. The viewer reads a node's colliders too, so the
  sample keeps no collider whose mesh index the reduced file lacks.
