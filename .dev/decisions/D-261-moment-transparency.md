# D-261: Moment transparency, and what it beats

Status: proposed. Date: 2026-10-25. Task: M3-F13.
Built: not built yet. This record fixes the shape, the figures and the fallbacks before the code
lands.

Summary: Order-independent transparency from a store of four depth moments beats the weighted blending's own weight in a model of the composite. It is nearer the exact result in 78% of stacks. The layer draws the transparent surfaces twice, and a phone run must settle that cost.

## Question

Does a store of depth moments give a better picture than the weighted blending that the engine
draws today, and at what cost? Task M3-F13 asks for order-independent transparency in which
overlapping glass, foliage and particles blend correctly whatever order they draw in.

## Rule

The better look decides between options (hard rule 40). The test is whether the new technique is
nearer the exact back-to-front result than the weighted blending is. The cost then decides how it
ships. A technique that a phone cannot afford becomes a documented limit or a preset choice. It is
never a dropped feature (hard rule 39).

## Data

The figures come from a model of the composite, not from a GPU. Each stack holds two to six
surfaces. Each surface has a random depth from 1 to 30 meters, a random optical depth from 0.15 to
1.2 and a random color. Each engine's result is compared with the exact back-to-front composite of
the same stack. The measure is the largest difference in any color channel.

| Measure | Four moments | Weighted blending |
| --- | --- | --- |
| Mean error over 400 stacks | 0.050 | 0.086 |
| Median error | 0.042 | 0.077 |
| 90th percentile | 0.102 | 0.167 |
| Worst stack | 0.188 | 0.279 |
| Stacks that four moments draws nearer | 314 of 400 (78%) | 86 of 400 |
| Two panes 8 meters apart | 0.000 | 0.183 |

The model evaluates the four-moment reconstruction as the shader does. It fits two atoms in the
warped depth. The weighted blending uses the engine's own weight: `alpha * clamp(0.03 / (1e-5 +
z^4), 1e-2, 3e3)`, where `z` is the depth over 200 meters.

Weighted blending loses because of that weight. It reaches its ceiling of 3e3 at every depth below
about 20 meters. Within a room it therefore weighs every surface alike. What is left is a plain
average of the surfaces' colors, with no term for which one is in front.

A first attempt fitted the moments with a two-point Gaussian. It placed the atoms at the mean plus
and minus one standard deviation. It did not beat weighted blending. That is why the store holds
four power moments, and why the fit is the orthogonal-polynomial one and not a moment-matching
approximation. The fit is exact for one and for two surfaces. That is why the two-pane case shows
no error at all.

## The reconstruction

The record keeps the formula here because it is the part that takes work to derive. The moments
`b` are `(b0, b1, b2, b3)`, where `b0` is the total optical depth. The depth `u` is warped into 0 to
1 by a logarithm between the camera's planes. This gives the transmittance from the eye to `u`:

```wgsl
let mean = b.y / b.x;
let second = b.z / b.x;
let third = b.w / b.x;
let spread = second - mean * mean;          // the variance of the depth
let a0 = (mean * third - second * second) / spread;
let a1 = (mean * second - third) / spread;
let root = sqrt(max(a1 * a1 - 4.0 * a0, 0.0));
let low = clamp((-a1 - root) * 0.5, 0.0, 1.0);
let high = clamp((-a1 + root) * 0.5, 0.0, 1.0);
let near_share = clamp((high - mean) / (high - low), 0.0, 1.0);
let far_share = 1.0 - near_share;
let absorbed = select(0.0, near_share, u > low) + select(0.0, far_share, u > high);
let shown = exp(-b.x * absorbed);
```

A spread of nearly zero puts all the optical depth at the mean depth. A span of nearly zero does
the same. This form was checked against a reference implementation in Python: it is exact for one
surface and for two, and close for more.

## Look

No pictures exist yet. The model says the moment layer keeps a near pane's color. The weighted
blending washes that color toward what lies behind it. The image test that settles it compares both
against an exact sorted render of the same scene.

## Decision

Build the layer with the four-moment store. Judge it by the image test, and not by the model alone.
The layer draws the transparent surfaces twice:

1. a moment pass, which adds four power moments of each fragment's optical depth into one target;
2. a color pass, which draws the same surfaces again. Each color is weighted by the transmittance
   that the moments give at that fragment's depth;
3. a composite, which reads both and blends the result over the scene.

The second draw cannot be avoided in this shape. A fragment's share of the picture depends on every
surface in front of it. No single draw knows its own transmittance. The one-pass alternative stores
color moments as well. That takes four color targets of 16-bit floats. No backend supports more
than two targets today, so that form is out of reach.

The store costs 16 bytes per pixel, written by each of the two passes. At 1920 by 1080 that is 33 MB
written a frame. The traffic is about 66 MB. The weighted blending writes 10 bytes a pixel. These
figures are arithmetic, not measurements. A run on an S24-class phone must replace them. The result
goes in this record and in the preset table.

## Consequences

- The setting is one flag on the quality settings. It is fixed at the start, and it is off on every
  preset. The preset table carries its row and its cost, so a page sees what it pays.
- The scene color keeps MSAA's samples for opaque geometry. The layer's targets have one sample, so
  its surfaces get none. The composite writes the share it covers into a mask. SMAA 1x runs under
  that mask, not over the whole image, so opaque edges keep MSAA's smoothing.
- SMAA's two lookup tables are made at first use, like the engine's other generated assets. Their
  build cost goes in this record when it is measured.
- A masked surface is opaque, so it keeps today's path. The setting covers the blended surfaces
  only: glass, blended foliage and particles.
- The permutation word is full, so no value is free for the moment builds. A uniform switch cannot
  stand in for one either. The moment layer's second target is four-float, and the weighted layer's
  is one, and a target's format is part of the pipeline rather than of a uniform.
- The share is legal. The engine lets two names take one value when no template lists both
  (D-156). The moment pass takes the outline view's value. No mesh template lists that bit, its own
  template loads by device, and the guard test at the end of `drawlist.rs` refuses any share that
  is not listed.
- The color pass cannot share a second value. The shader build names a build's first-use file by
  the names of its bits. A shared value would pull another template's builds into the moment file.
  The color pass becomes six shader entries instead, one for each mesh template with a moment
  build.
- Both paths fall back to today's sort where the device cannot draw into 16-bit float targets.
- A page without the setting draws exactly as it does today. No demo changes.

## Why four moments, and what that costs

Two color targets of 16-bit floats hold eight values. They carry four power moments in one target,
and the color sum and its weight in the other. So four moments are the most that fits. Eight values, and every one of them is used. Six
moments would store a better curve, and they need a third target that neither backend has. The
limit shows in one place: a stack where one surface carries most of the optical depth is fitted
with two atoms, and the fit places them around that surface rather than at it. A scene of two
surfaces is exact, which the acceptance test uses.

## Acceptance

The image test draws one scene twice, with moment transparency on and with today's sort. It draws
the same scene a third time with the weighted blending. The test measures each image's distance from the sorted one, as the mean of every color channel
over the whole picture. It passes when the moment image is nearer than the weighted image. That is measurable, and it cannot be fudged by a tolerance.

Two more tests guard the property that gives the feature its name. The same surfaces in two draw
orders must draw the same picture. Overlapping glass must show each layer's own color at chosen
pixels.

## Remaining work, in order

1. The setting end to end, drawing nothing new. Start in `packages/engine/src/quality/presets.ts`:
   a `momentTransparency` flag, off on all four presets, `changes: 'start'`. Then
   `packages/engine/src/page/engine.ts` (the option), `packages/engine/src/page/limits.ts` (the
   device answer), `packages/engine/src/page/switches.ts` (`?moments=on` or `off`),
   `crates/null3d-wasm/src/lib.rs` (`init_engine`'s argument), and the two renderer configs in
   `crates/null3d-render/src/gpu_driven/mod.rs` and `cpu_culled/mod.rs`.
2. The permutation value and its rules, in `crates/null3d-gpu/src/drawlist.rs`: `MOMENTS` takes
   `OUTLINE_VISIBLE`'s value, with the `SHARED` entry and the `APART` pairs that the weighted layer
   has. The guard test at the end of that file must pass.
3. The moment maths, in a new `crates/null3d-shaders/wgsl/lib/moments.wgsl`: the warped depth, the
   optical depth and the reconstruction above. It also holds the two fragment helpers and the
   moment store's binding for the color pass. Add the branches to `lit.wgsl`, `unlit.wgsl`, `unlit_map.wgsl` and
   `sprite.wgsl`.
4. The shader templates and layouts: `MOMENTS` in the six mesh entries of
   `crates/null3d-shaders/shaders.toml`, six `moment_*` entries for the color pass with the
   `MOMENT_COLOR` and `MOMENT_MAPS` defs, the composite entry, and `[first_use.moments]`. The
   color entries must not carry the caster variants. The template ids and the composite's bind
   layout go in `drawlist.rs`; the backends' mappings go in
   `packages/engine/src/gpu/webgpu/pipelines.ts` and `packages/engine/src/gpu/webgl2/programs.ts`.
   The color pass binds the moment store where a material reads the scene's depth, so those
   templates take `LAYOUT_MATERIAL_SCENE` after the maps' group.
5. The pipeline keys and the sorted layout: `crates/null3d-render/src/pipelines.rs` gains
   `moments()` and `moment_color()`, and `crates/null3d-render/src/sorted.rs` gains the two bucket
   fields and the two `SortedRows` kinds.
6. The layer, in a new `crates/null3d-render/src/moments.rs`: the composite and the depth copy,
   their bind groups, and their tests. It mirrors `crates/null3d-render/src/weighted.rs`.
7. The frame graph plumbing, in `crates/null3d-render/src/frame_graph.rs`: the two roles, the two
   declarations, the build group and the recording. Then the draw arms in
   `crates/null3d-render/src/gpu_driven/mod.rs` and `cpu_culled/mod.rs`.
8. SMAA 1x under the coverage mask. Its two lookup tables are generated at first use, like the
   engine's other generated assets. Start in a new `crates/null3d-shaders/wgsl/smaa.wgsl` and the
   pass declarations beside the moment composite. This is the largest single piece left.
9. The image tests and their references, in `tests/image/manifest.ts` and a new sketch under
   `tests/pages/sketches/`. The acceptance test's three entries, the two draw orders, and the
   overlapping glass read-back.
10. The docs and the skills: `docs/api/materials.md` (fix the wrong claim at line 642, that FXAA
    smooths weighted surfaces), `docs/concepts/materials.md`,
    `docs/concepts/backends.md`, `docs/data/threejs-mapping.json`,
    `skills/null3d-develop/references/api-quickref.md`, and the porting skill's
    `references/post-processing.md`.
11. The cost run on an S24-class phone, which replaces the arithmetic figures above and fills the
    preset table's row.
