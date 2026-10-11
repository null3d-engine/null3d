# D-136: Bump maps, displacement maps and wireframe materials

Status: decided by the helper of M2-J4 on 11 October 2026, for the owner's review. Date: 2026-10-11. Task: M2-J4.

Summary: The standard material takes three.js's `bumpMap`, `bumpScale`, `displacementMap`, `displacementScale` and `displacementBias`, and every material takes `wireframe`. A bump map shares the normal map's slot, so it adds no texture binding. A displacement map has a binding of its own that only the vertex stage reads. Its builds load on first use, and its shadows, depth prepass and culling follow the moved vertices. Where no normal or bump map bends the normals, the engine bends them by the displacement map's slope, which three.js does not do. `parallax: true` adds parallax occlusion mapping from the same map, on opaque and masked surfaces, which the Low preset turns off.

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

## Options

### Where the bump map goes

| Option | Verdict |
| --- | --- |
| A: the normal map's slot, with a row flag that says the slot holds a height map | Chosen. three.js never draws both, so the slot is free whenever a bump map draws. No binding, no bit and no row growth. `bumpScale` takes the normal scale's floats |
| B: a ninth slot | Rejected. It takes the last fragment texture on WebGPU, and the row has no room for its layer |
| C: an offline conversion to a normal map | Rejected as the only way. It was the earlier plan, but a port then needs a build step |

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
- With neither, the engine binds the displacement map into the normal slot as well, with a second row flag. The fragment shader bends the normal by the map's slope in world units. It uses the bump map's surface gradient with the position's plain derivatives. The object's scale along the normal scales the height. So the slope matches the moved vertices at any distance, and detail finer than the mesh still shades.

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

Option A for each part. A page pays nothing for a feature it does not use. A bump map costs three texture reads per pixel of the materials that have one. A displacement map costs one texture read per vertex in each pass that draws the material, and three per pixel where it bends the normals. The figures per preset follow in the measurements below.

## Measurements

To follow: GPU and CPU time per frame with each feature on and off, per preset, on the Mac in a quiet window, and the size of the first-use shader files.

## Consequences

- Rust: map slot `Displacement` outside the row's eight layers; row flags `BUMP` (32) and `HEIGHT_NORMALS` (64); permutation bits `DISPLACEMENT` (1 << 26) and `PARALLAX` (1 << 27) and their first-use shader set; material features `WIREFRAME` (16384) and `PARALLAX` (32768); bind layout 34, `MATERIAL_MAPS_PARALLAX`, the maps group with the displacement map visible to the fragment stage too; per-draw edge lists in mesh storage; caster and prepass keys for displaced materials; bounds margins.
- TypeScript: the options on `materials.standard`, `wireframe` on every material, checks in development builds, the quality setting `parallax`, and bounds that grow with a displaced material.
- Docs: `api/materials`, the three.js mapping entries for bump maps, displacement maps, wireframe and edges, both skills, and a feature demo.
