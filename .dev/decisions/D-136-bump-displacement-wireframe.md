# D-136: Bump maps, displacement maps and wireframe materials

Status: decided by the helper of M2-J4 on 11 October 2026. The owner approved the relief demo's look on 12 October 2026. Date: 2026-10-11. Task: M2-J4.

Summary: The standard material takes three.js's `bumpMap`, `bumpScale`, `displacementMap`, `displacementScale` and `displacementBias`, and every material takes `wireframe`. A bump map shares the normal map's slot, so it adds no texture binding, and its builds load on first use. A displacement map has a binding of its own that only the vertex stage reads. Its builds load on first use, and its shadows, depth prepass and culling follow the moved vertices. Where no normal or bump map bends the normals, the engine bends them by the displacement map's slope, which three.js does not do. `parallax: true` adds parallax occlusion mapping from the same map, on opaque and masked surfaces, which the Low preset turns off.

## Question

The showcase scenes need real relief: terrain, rocks, a cave and battle craters whose silhouettes and shadows move with their height maps, and fine relief on bricks and cobbles ([D-117](D-117-showcase-features-before-1-0.md), and the owner's ruling of 11 October 2026 that moved displacement before 1.0). How does the standard material read bump and displacement maps, how do the other passes follow moved vertices, and how does a material draw as a wireframe?

## Rule

- The intent of three.js's options, strictly ([D-52](D-52-intent-parity.md)): the same channel, the same scale and bias, the same direction, the same order with skinning and morph targets. The look may be better where three.js's is a known fault.
- One look on all three GPU paths. WebGPU stays within its default limits, and within compatibility mode's where the engine supports it ([AGENTS.md](../../AGENTS.md#hard-rules), hard rule 6).
- No cost while no material uses a feature: no bit, no download, no pass ([AGENTS.md](../../AGENTS.md#design-principles), principle 8).
- No allocation per frame.

## Data

### What three.js does (r186)

| Option | three.js's code | Behavior |
| --- | --- | --- |
| `bumpMap`, `bumpScale` (1) | `bumpmap_pars_fragment`: `dHdxy_fwd` and `perturbNormalArb` | Three taps of the red channel: at the pixel, one pixel across and one pixel up. The normal bends by the height change per pixel, against screen derivatives of the position that it normalizes. A normal map wins over a bump map. Wireframe materials ignore the bump map |
| `displacementMap`, `displacementScale` (1), `displacementBias` (0) | `displacementmap_vertex` | `transformed += normalize(objectNormal) * (texel.x * scale + bias)`, in the mesh's own space, after morph targets and skinning, at the top mip level. The depth and distance materials do the same, so shadows follow. Normals do not change |
| `wireframe` | `WebGLGeometries.getWireframeAttribute` | Each triangle's three edges as an index list (`a, b, b, c, c, a`), built once per geometry on first use, edges that two triangles share listed twice. Drawn as lines with the material's own shading. Shadows draw as lines too. Flat shading is off |

### Texture limits

| Stage | Today | With a ninth map in the maps group | With this design |
| --- | --- | --- | --- |
| WebGPU fragment, standard material with maps | 15 of 16 sampled textures | 16 of 16 | 15 of 16 |
| WebGPU vertex, standard material with maps | 10 to 12 of 16 | 11 to 13 | 11 to 13 |
| WebGL2 fragment, standard material with maps | 12 of 12 units that the test allows ([D-89](D-89-webgl2-texture-units.md)) | 13 | 12 |
| WebGL2 vertex | under 12 | +1 | +1 |

The material row is full: its eight map layers fill floats 24 to 31, and float 39 is its only spare float. On WebGPU the vertex stage cannot read the row at all, because the material buffer is visible to the fragment stage only.

How the data was produced: three.js 0.186.1's shader chunks and renderer, read on 11 October 2026; bind group layouts in `gpu/webgpu/pipelines.ts`; the WebGL2 unit test in `gpu/webgl2/programs.test.ts`.

### The frame group of the builds of parallax

The counts above held for every build except the ones of parallax. WebGPU counts every entry of a pipeline's bind group layouts against the per-stage limits, whether or not the shader reads it. A parallax material reads the displacement map in the fragment stage as well as the vertex stage, so the frame group's eight sampled textures and the maps' group's nine come to 17. Chrome rejected those pipelines while creating the pipeline layout:

> The number of sampled textures (17) in the Fragment stage exceeds the maximum per-stage limit (16). This adapter supports a higher maxSampledTexturesPerShaderStage of 48.

The draw list never pairs `PARALLAX` with `TRANSMISSION`, so no parallax build reads the frame group's copy of the opaque color at binding 15. Those builds therefore bind a frame group without it: bind layout 47, `FRAME_PARALLAX`, which puts their fragment stage at 16 of 16. The engine records it beside the view's frame group while a material takes parallax, and a pass binds it for the buckets whose material takes parallax, and keeps the view's frame group where that id holds the depth layout, as the shadow passes do. The decal pass solves the same limit the same way, with a frame group that leaves out the copy and the light probe grids' texture.

## Options

### Where the bump map goes

| Option | Verdict |
| --- | --- |
| A: the normal map's slot, with a row flag that says the slot holds a height map | Chosen. three.js never draws both, so the slot is free whenever a bump map draws. No binding and no row growth. `bumpScale` takes the normal scale's floats |
| B: a ninth slot | Rejected. It takes the last fragment texture on WebGPU, and the row has no room for its layer |
| C: an offline conversion to a normal map | Rejected as the only way. It was the earlier plan, but a port then needs a build step |

The bump map's code has a permutation bit of its own, `BUMP`, and its builds load on first use, as displacement's do. The first build bent the normal behind the row flag alone, in every build of the standard material with maps. That grew the shader files that every page loads by 2.1 to 2.7% after Brotli, about 0.5 KB each, for a feature that most pages never use. All 32 permutation bits were taken, so `BUMP` takes the bit of `NORMAL_MAP`, which nothing had used since normal maps became a row flag. Its builds never read the mesh's tangents, since the bump map takes the normal map's slot. A build without `BUMP` draws a bump-mapped material's normals unbent, which is what a wireframe material draws.

### Where the displacement map goes

| Option | Verdict |
| --- | --- |
| A: a binding of its own in the maps group that only the vertex stage sees. Its layer, scale, bias, texture coordinate set and transform go into the material's row of custom values, which both stages read and which standard materials left unused | Chosen. The fragment stage keeps its budget on both paths |
| B: a ninth slot in both stages | Rejected for the fragment budget, as above |
| C: a custom material's vertex offset only | Rejected. glTF tools and three.js ports set the standard options, and shadows, the prepass and bounds would stay the user's work |

The standard material with maps gets a permutation bit, `DISPLACEMENT`. Its builds sample the map in the vertex stage, with `textureSampleLevel` at level 0. They load on first use, so a page without displacement downloads none of them.

### Normals of displaced surfaces

three.js keeps the mesh's normals, so a displaced plane with no normal map lights as if it were flat. Its author meant a moved surface, so this design bends the normals where nothing else does:

- With a normal map or a bump map, that map bends the normal, as in three.js. A normal map made with the height map already holds its slope.
- With neither, the engine binds the displacement map into the normal slot as well, with a second row flag. The fragment shader bends the normal by the map's slope in world units. It uses the bump map's surface gradient with the position's plain derivatives. The object's scale along the normal scales the height. So the slope matches the moved vertices at any distance, and detail finer than the mesh still shades. The slope comes from the heights one texel to either side (four reads), not from the change between neighboring pixels as a bump map takes it (three reads). Filtering blends that slope between texels, so terrain seen close, where one texel covers many pixels, shades smoothly instead of in one flat facet per texel, as the first demo shots showed.

### The passes that must follow moved vertices

- Shadows: displaced materials cast with the standard template's caster builds, which move each vertex as the camera's view does. This is how custom materials with a vertex offset cast. A displacement map does not move with time, so its casters do not redraw every frame, unlike a custom vertex offset's.
- The depth prepass: a displaced material draws its prepass with its own vertex shader, so the shading pass's equal depth test matches.
- Culling: each object's bounding sphere grows by the largest distance that its material has moved a vertex: the largest of `|bias|` and `|scale + bias|`, in the mesh's units. An object with its own bounds keeps them. The margin only grows, so a scale that rises and falls grows each object's bounds once. Instance batches and skinned objects take it too.
- Kept shadows: a cascade or a light's tile that keeps its layer between frames holds the vertices where the old values put them. A change of the displacement's scale or bias, or a height map whose image arrives, makes every cascade and tile draw again in the next frame.
- The occluders' pass of GPU occlusion culling draws with the depth template, which does not move vertices. A pair that places its own vertices, a displaced material's or a custom vertex offset's, now hides nothing there, so a moved surface never hides what the camera sees.
- Outline masks, debug views and raycasts see the mesh before displacement, as they do for custom vertex offsets, and as three.js's raycasts do.

### Wireframe

| Option | Verdict |
| --- | --- |
| A: a material feature that draws the material's own pipeline with line lists, from each part's edge list | Chosen. The debug view's edge lists and both backends' line topology already exist |
| B: lines from `scene.createLines` | Rejected as the way to port `wireframe: true`. It loses the material's shading and needs the edges in user code |

Mesh storage keeps one edge list per part, built when the first wireframe material or the debug view needs them. Each draw now picks triangles or edges by its own pipeline, not by one switch for the whole scene. That also fixes the debug view's shadows and outlines, which read edge lists with triangle pipelines and came out empty. A wireframe material's shadows draw lines, as three.js's do. Flat shading and the bump map are off, as in three.js, since both read derivatives that lines do not have.

### Parallax occlusion mapping

Night town's bricks and cobbles need depth that flat quads with few vertices cannot hold. Parallax occlusion mapping steps along the view ray through a height map's relief, and every map of the pixel then reads where the ray meets it.

It needs the height map in the fragment stage, beside the normal map. The limit that this meets is the fragment stage's total of sampled textures on WebGPU, not the material's own count of maps. The frame's group takes 7 and the maps group 8, so the height map takes the 16th and last. The design first left parallax out for that reason. On 11 October 2026 the coordinator gave this feature that last slot, since lit fog no longer needed it (D-133, the lit fog record, keeps its own limit for see-through surfaces). On WebGL2 the height map shares a unit with a map of the same texture array, or else takes a free one of the six ([D-89](D-89-webgl2-texture-units.md)). A material whose maps leave no unit for it draws its displacement alone.

| Choice | Verdict |
| --- | --- |
| The map that parallax reads | The displacement map, with `parallax: true`. One height map gives the shape, the normals and the parallax. three.js has no such option |
| Which pipelines see the height map in the fragment stage | Only parallax builds, through a layout of their own (bind layout 34). Every other material keeps 15 of 16 fragment textures on WebGPU |
| See-through surfaces | Refused: the `blend` alpha mode or `transmission` with `parallax` throws E1217 in development builds. A silent fallback would hide the choice from the author. Parallax changes what each pixel shows, and a blended surface shows what lies behind it too |
| Where the march starts | At the top of the relief above the surface that the vertices give, which the vertex stage passes on. So parallax adds only the relief that the vertices miss, on a coarse quad or on dense terrain alike |
| Steps | 8 where the view meets the surface head on, up to 32 at grazing views, then a linear step between the last two samples |
| Quality governor | The quality setting `parallax`: off on Low, which phones run, on from Medium up. It changes during play: off, such materials draw with their displacement alone |

Silhouettes and shadows keep the vertices' shape, as with every parallax method. Wireframe materials draw no parallax.


## Decision

Option A for each part. A page pays nothing for a feature it does not use: no shader code, no download and no pass. A bump map costs three texture reads per pixel of the materials that have one. A displacement map costs one texture read per vertex in each pass that draws the material, and three per pixel where it bends the normals. The figures per preset follow in the measurements below.

## Measurements

The relief-cost page (`tests/pages/relief-cost.ts`) draws a hillside from the relief demo's height maps: displaced terrain, 40 displaced boulders, brick walls with parallax, bump-mapped cap stones and a wireframe frame, under the sun's shadows. It times one feature off and on in turns: displacement (the terrain and boulders draw their materials without the map), parallax (the quality setting), bump maps (the cap stones without the map) or wireframe (the frame's triangles instead of its edges). `NULL3D_RELIEF_COST=1 bun run test:browser -- relief-cost.spec.ts` runs it on each GPU path and preset.

GPU time per frame that each feature adds, in ms: the median with the feature on less the median with it off, at 1600 x 900. MacBook Pro (Apple M5 Max), Chrome through Playwright on the Mac's GPU, 13 October 2026, one run of each pair with the Mac to itself, at loads of 2.8 to 7.3:

| Feature | Path | Low | Medium | High | Ultra |
| --- | --- | --- | --- | --- | --- |
| Displacement | WebGPU | +0.72 | +0.92 | +0.91 | +1.05 |
| Displacement | Compatibility mode | +0.72 | +0.99 | +0.99 | +0.92 |
| Parallax | WebGPU | off | 0.00 | 0.00 | -0.26 |
| Parallax | Compatibility mode | off | -0.07 | +0.07 | +0.07 |
| Bump map | WebGPU | 0.00 | 0.00 | 0.00 | +0.26 |
| Bump map | Compatibility mode | 0.00 | 0.00 | 0.00 | -0.07 |
| Wireframe | WebGPU | +0.07 | +0.07 | +0.07 | +0.07 |
| Wireframe | Compatibility mode | +0.07 | +0.07 | +0.13 | +0.20 |

- Displacement's figure covers the whole hillside: the vertex reads in the main pass, the prepass and every shadow pass, and the four reads per pixel of the normals from its slope, over most of the screen.
- The GPU timer's medians fall on steps of about 0.07 ms, so the parallax and bump figures say only that their cost on this view is below a step or two. The walls with parallax and the cap stones with bump maps fill a small part of the screen. Parallax is off on Low by its quality setting.
- CPU time per frame did not change by more than 0.02 ms for any feature.
- WebGL2's timer gave no usable figures: the same scene with the feature off measured from 2.45 to 6.02 ms between runs, and its differences ran from -1.09 to +1.35 ms with no pattern.
- The page's frame interval read 16.67 ms throughout, because headless Chrome on the Mac reports a 60 Hz display. It is not a frame rate.

## Consequences

- Rust: map slot `Displacement` outside the row's eight layers; row flags `BUMP` (32) and `HEIGHT_NORMALS` (64); permutation bits `DISPLACEMENT` (1 << 26) and `PARALLAX` (1 << 27) and their first-use shader set; permutation bit `BUMP` (1 << 3, formerly the unused `NORMAL_MAP`) and its first-use shader set; material features `WIREFRAME` (16384) and `PARALLAX` (32768); bind layout 34, `MATERIAL_MAPS_PARALLAX`, the maps group with the displacement map visible to the fragment stage too, and bind layout 47, `FRAME_PARALLAX`, the frame group without the copy of the opaque color, which the parallax builds bind; per-draw edge lists in mesh storage; caster and prepass keys for displaced materials; bounds margins.
- Levels of detail (D-137): a level with a displaced material switches at once and never fades, as skinned levels do. Fading builds with displacement would double the standard maps template's fading builds, which every page with fading levels downloads.
- TypeScript: the options on `materials.standard`, `wireframe` on every material, checks in development builds, the quality setting `parallax`, and bounds that grow with a displaced material.
- First-use shader files: a build that mixes displacement with another feature that loads on first use, such as a displaced skinned mesh, goes into a file of its own, which a page loads only when it uses both. Filed under the other feature, those builds grew the skinning, morph, row-value, transmission, alpha-to-coverage and alpha-hash files by 20 to 30% for pages that never displace a vertex.
- Docs: `api/materials`, the three.js mapping entries for bump maps, displacement maps, wireframe and edges, both skills, and a feature demo.
- The relief demo (`examples/relief`) shows every part on a hillside at sundown: displaced hills and cut boulders, a brick wall that steps down the slope with parallax bricks and bump-mapped cap stones, and a geodesic frame drawn as a wireframe that casts line shadows. A button and the P key turn parallax off and on.
