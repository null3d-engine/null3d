# D-258: Directional light maps, and reading Needle's light maps

Status: decided by the helper of M3-F4 on 25 October 2026, for the owner's review. Built: the
second texture, the shader weighting, the glTF reader, the picture test, the memory figure and the
page that measures the cost, as the consequences list. Date: 2026-10-25. Task: M3-F4.

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
map must draw exactly as it did.

## Data

| Measure | Plain light map | Directional light map | Device |
| --- | --- | --- | --- |
| File bytes, per texel | 3 (`rgb8`) | 6 (`rgb8` and 3 direction bytes) | none |
| GPU bytes, 1,024 x 1,024, `rgb8` radiance uploaded as RGBA8 | 4,194,304 (4 MiB) | 8,388,608 (8 MiB) | none |
| GPU bytes, 1,024 x 1,024, `rgba16float` radiance | 8,388,608 (8 MiB) | 16,777,216 (16 MiB) | none |
| Ratio | 1.00 | 2.00 | none |

The GPU figures count the one level that `assets.loadLightMap` makes, which holds no mip chain for
either encoding, at 4 bytes for each texel of an `rgb8` radiance and 8 for one of `rgba16float`.
They are what the texture store holds for a texture of that size and format, not an estimate
from the file.

The cost is owed. The `lightmap-cost` page measures it. The page draws 24 lit quads that fill a
1600 by 900 view once, so every pixel shades one fragment. The plain and directional builds swap in
turns for four rounds each. The order reverses on alternate rounds, so a clock that drifts through
the run does not favour either side. Before the timing the page draws one frame of each side and
compares them, so a direction that the engine dropped fails the run instead of reporting no cost.
On 25 October 2026 the Mac's 1-minute load read between 34 and 156. The spec refuses to measure
above 8, so the run waits for a quiet window and then takes about a minute:
`NULL3D_LIGHTMAP_COST=1 bun run test:browser -- lightmap-cost.spec.ts --workers=1`. Its medians go
into the table above. The trials so far are preliminary and not figures. At a load of 84, before
the sides alternated, the directional side read 1.08 ms against 0.99 ms on WebGPU. With alternating
rounds at a load of about 100, it read 1.05 against 0.99 in compatibility mode and 1.55 against
1.48 on WebGL2, while WebGPU read 1.04 against 1.26. That last figure shows what a loaded machine
does to the order, and why the figure waits. About 55.5% of the pixels moved on every path.
[Benchmarks](../benchmarks.md#directional-light-maps) gives the paths and the queue form.

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
  are, so a bake can place each mesh's map apart from the other maps. The materials' row gained a
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
- The material row grew from 272 to 288 bytes, and the split-sum table's column in the material
  data texture moved one texel. The shader's fragment stage reads the light map's transform and
  direction layer only for a material that has a light map.
- `NEEDLE_lightmaps` and `NEEDLE_components` join the extensions that the loader reads, and the
  [assets page](../../docs/api/assets.md) names what each gives.
- The guards: the picture test `needle-lightmap` holds the decode and the placement still, a unit
  test parses the reduced real sample's fields, the texture store drops a direction that is not in
  the radiance's array, and a material test covers each option's refusal.
