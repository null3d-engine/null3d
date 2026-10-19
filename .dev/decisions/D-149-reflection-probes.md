# D-149: Box-projected reflection probes

Status: decided by the helper of M2-EX32 on 12 October 2026, for the owner's review. Built: on the M2-EX32 branch; main takes it after the review. Date: 2026-10-12. Task: M2-EX32.

Summary: `scene.createReflectionProbe({ box, position })` captures the scene around a point on the GPU, through six square views, and filters it for each roughness as the environment's map is. Each probe is an octahedral map in one layer of one half-float texture array. A surface inside a probe's box reflects along a ray that meets the box's sides, so a room's walls and a street's houses reflect where they stand. Up to two probes blend at their boxes' edges, inner probes first, and the environment takes the rest. Mirror reflections win over the probes, and screen-space reflections will sit between them. The array takes the texture slot of the split-sum table on WebGPU, which moves into the columns of an existing data texture, as on WebGL2. So probes add no texture slot to the main pass on WebGPU, and one texture unit on WebGL2. A scene without probes draws as before and pays one uniform test per lit pixel.

## Question

The owner pulled box-projected reflection probes into M2 ([D-142](D-142-more-techniques-before-1-0.md)): reflections of streets and rooms in Night town and the other showcase scenes. The environment's map reflects a sky infinitely far away, so a polished floor in a room reflected the sky, not the room's walls. Planar reflections ([D-120](D-120-planar-reflections.md)) serve one flat mirror. How does a sketch place probes, how does the engine capture and filter them in the browser, how do surfaces read and blend them, and how do they fit the main pass's texture slots?

## Rule

- The best technique by default ([D-52](D-52-intent-parity.md)): parallax-corrected (box-projected) cube maps, prefiltered for roughness, blended where boxes overlap, as Unity, Unreal, Godot and Frostbite draw them.
- One look on all three GPU paths. Compatibility mode has no cube arrays, so probes are octahedral maps in one 2D array ([Technique review, October 2026](../technique-review-2026-10.md#webgl2-texture-units), rule 3).
- No new texture binding on WebGPU's main pass, which used 15 of its 16 sampled textures with the material's maps, and lit fog takes the 16th. On WebGL2 at most one more unit.
- No new shader build bit: every permutation bit is claimed.
- Near zero cost while a scene has no probe: no pass, no download, no pipeline build, no GPU object beyond a blank texel.
- No allocation per frame, also for probes that capture in every frame ([AGENTS.md](../../AGENTS.md#hard-rules), hard rule 1).

## Options

### Where the maps live, and how the main pass reads them

| Option | Slots on WebGPU | Verdict |
| --- | --- | --- |
| A: a new binding for a texture array of probes | 16 of 16 for the standard material with maps, and none for lit fog | Rejected: no slot left |
| B: the environment becomes layer 0 of the probes' array, as an octahedral map, in every scene | None new | Rejected. Every image with an environment would change, its reflections would blur at the array's size, and the sky's staged refresh and the loaded cube files would need a conversion |
| C: a build bit that swaps the environment's cube binding for the probes' array in scenes with probes | None new | Rejected. No bit is free, the frame group's layout is shared by every pipeline, and a scene's first probe would build every lit pipeline again |
| D: the split-sum table leaves its texture on WebGPU for 16 columns of the custom values texture, as WebGL2 keeps it in the material texture. The probes' array takes its binding 3 | None new: 7 for lit materials and 15 with maps, as before | Chosen |

The split-sum table is 16 x 16 entries of two floats that the lit shaders read with `textureLoad`. In the custom values texture, an `RGBA32_FLOAT` data texture that shaders read the same way, the values and the reads stay the same, so no image changes. The probes' array has a binding of its own in every build, and a blank texel while the scene has none. The view's list of probes says how many there are, so a lit shader reads the array only when a probe lights its view, as it reads the environment's cube only when the scene has one. On WebGL2 the array takes one more unit: the standard material with maps uses 13 of 16, and 14 with transmission. The spare units rule for those builds drops from 4 to 3; its comment kept the spare units for probes.

### What a probe's map holds

| Option | Verdict |
| --- | --- |
| A: an octahedral map in a layer of a 2D array, every level filtered for a roughness | Chosen |
| B: a cube array | Rejected: compatibility mode has none |
| C: six layers of a 2D array per probe, a face each | Rejected: no filtering across the faces' edges, so seams show on rough surfaces |
| D: dual paraboloid maps | Rejected: two lookups per sample, and uneven texels at the rim |

The map folds the sphere into one square, up at its center. Each level's edge texels lie on the folds (texel `i` of `n` holds point `2i / (n - 1) - 1`), so a linear filter never reads across a fold. Each level then has texture coordinates of its own, so the shader reads the two nearest levels and mixes them. Level `i` of `n` holds perceptual roughness `1 - sqrt(1 - i / (n - 1))`, as the environment's maps do, so one function finds a roughness's level in both. The levels go down to 4 texels across. The maps hold half floats (`rgba16float`), which every GPU path draws into where probes run. So each filter draws straight into its level. The environment's maps hold shared-exponent texels, which no GPU path draws into: WebGL2 packs them into bytes, reads them back and waits for the GPU (`gl.finish`). That suits a map made once, not a probe that captures during play.

### How the engine captures

A probe's six capture views are views of the scene, as scene passes and reflection passes are ([D-104](D-104-scene-passes.md), [D-120](D-120-planar-reflections.md)). They cull on their own and draw the sun, its shadows, the ambient and environment light, fog and the background. Point and spot lights come with the views' own light lists ([PR #499](https://github.com/null3d-engine/null3d/pull/499)). Each view looks along a face of the cube, 90 degrees square, at half the map's size. The cube map table is mirrored against a camera's view, so each view keeps the engine's camera turns, and the filter turns its image around as it copies it. The views take 6 of the 32 views while the scene has a probe.

One probe captures per frame: first the probes that wait for a capture, then in turns the probes that refresh always. The camera's passes read the capture views' targets, so the render graph orders every capture pass before them. Between the two, the draw list's `ProbeFilter` command makes the probe's map, and the probe lights surfaces in the frame that captured it:

1. `gather` copies each view's image into its layer of the chain, a six-layer half-float array.
2. The chain gets its smaller levels: `half` draws on WebGPU, `generateMipmap` on WebGL2.
3. `prefilter` fills each level of the probe's layer: GGX importance sampling with a level of the chain per sample, as the environment's filter does, from 128 directions at level 1 up to 1,024. The probe's layer is its slot plus the light tables' three layers, which the shared array holds first.

The array grows by doubling its layers, and a new quality size makes it again; either way every probe captures again. A new array takes the other of two pairs of texture ids, and the next frame's list destroys the old pair: a capture replays a frame's list, so a list never destroys a texture that its own bind groups name. The light tables share that array, and a light's first image makes it again too. Because the next frame destroys the old array, every camera view's frame group binds the new array in the frame that makes it. A Rust test covers the rebind on both frame builders. The capture views list no probe, so a probe sees the environment alone, and no map reads itself. Hold mode, which the image tests draw, records the held frame once more while a probe waits for its capture, as screen-space reflections need the frame before (D-134). The thread that draws keeps two frames' lists, so a held frame shows up to two probes. The filter's code loads with the environment's generators, the first time a sketch makes a probe or an environment. Its draws' uniform values, views, bind groups and passes stay with the textures, so a filter allocates nothing after its first.

### How a surface reads probes

Each view lists up to 8 probes in a uniform block of its own: the ready probes whose boxes it may see, relative to its camera, inner probes first (by priority, then by the size of the box). A lit pixel walks the list. A probe has its whole weight in its box, and fades out over the blend distance beyond the box's sides. Each probe takes its weight of the share that the probes before it left. The first design faded a probe in over the blend distance inside its box. In the first image tests, a floor on the box's bottom side then took no light from the probe, black in a scene without an environment, and floors lie there whenever a box follows its room. Fading outward keeps the box the room's shape, which box projection needs, and lights the floor. It stops after two probes, or once they cover it. A point within a centimeter outside the box counts as inside, since a floor that lies on the box's side falls either side of it by rounding: the first image tests showed such a floor striped black where the probe skipped it. Each probe's reflection follows the bent reflection ray, as the environment's does, to the box's far side, and reads the map in the direction from the capture point to that place (Lagarde and Zanuttini, 2012). Its diffuse light reads the roughest level along the normal, times pi, as three.js reads an environment map's. The environment lights the share that the probes leave.

The priority of reflections, from the top: a mirror's reflection (D-120), screen-space reflections (D-134, in progress), the probes, the environment. In the shaders: `radiance = mix(mix(probes + environment, ssr, ssr share), mirror, mirror share)`.

Decal builds read no probes: a decal modulates the surface under it, which reflects the probes already. The probes' maps share the array at binding 3. A decal build that read them would take one unit more than its spare units leave (D-144).

### The 8-bit path

On the 8-bit path, views draw display color ([D-104](D-104-scene-passes.md#display-color-on-the-8-bit-path-owner-8-october-2026)). That is compatibility mode with MSAA. There the probes hold display color, and their reflections look grayer, as reflection passes do. WebGL2 devices that draw into no half-float targets have no probes: the scene keeps the environment's light, and development builds warn once.

## Data

To come: GPU and CPU cost per preset with probes on and off, the capture's and the filter's cost, the allocation check, the size check and the GPU check.

## Decision

Options D, A and the capture and blend above. The quality setting `probeSize` sets each map's size: 128 on Low, 256 from Medium up, 512 as a choice.

## Consequences

- Code: `crates/null3d-render/src/probes.rs` (probes, their scheduling, the filter command, the capture views' cameras and each view's list), `view.rs` (capture views), `frame.rs`, both frame builders (the array, the lists, the split-sum table's move on WebGPU), `dfg.rs`, `textures.rs` (image ids for generators without a texture), `crates/null3d-gpu` (`Op::ProbeFilter`), the core's calls, `lib/probes.wgsl`, `lib/cubemap.wgsl`, `lib/tables.wgsl`, `lit.wgsl`, `probe.wgsl`, and the backends' `probes.ts`.
- Docs: `api/scene`, `concepts/lighting`, the quality preset table, the error page E1430, and the three.js mapping's `cube-camera` entry.
- Skills: the develop skill's quick reference and lighting notes, and the port skill's mapping notes.

## Addendum, 2026-10-14: binding 3 is now shared with the area lights

The area lights (D-145, M2-EX28) landed with their tables texture at frame-group binding 3, which
this record gives the probes' maps. The owner ruled on 14 October 2026 that the two share one texture
array at binding 3, the probes' maps first and the light tables' layers between them and the lights'
images, so binding 10 stays for the light probe grid (D-146). [D-146](D-146-light-probe-grid.md)
records the choice and the copy on a regrow. The probes' maps, the blend, the capture and the API are
unchanged.

## Addendum, 2026-10-18: the probe sampling stays in every lit build

The probes' sampling moved into the light probe grid's first-use templates on 15 October, to bring
the start under its then budget: the standard lit builds stopped carrying it, and the engine drew
lit meshes through the probe templates while a scene set a probe. That move is **reverted** (the
commit `1181a0532` and its test fix `72878e4ec`), because it changed what WebGL2 draws.

The evidence, measured on 18 October with the picture tests for the probes and their demo: at the
commit before the move, `probe-rough` matches its reference on WebGPU, compatibility and WebGL2. At
the move's own commit, WebGPU and compatibility still match, while `probe-rough` differs by 5.240%
on WebGL2: the floor's reflection loses its roughness blur. The same five WebGL2 pictures differ at
every later commit of the branch, and the merges do not change them (the pictures are identical
byte for byte before and after). The cause inside those builds is not found; a later session should
compare the two templates' WebGL2 output rather than assume the pictures are stale.

The cost of the revert is the start size: the probes' sampling sits in every lit build again. The
owner raised the start budget to 165 KB after the move was written, which covers it.
