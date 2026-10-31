# D-122: Transmission and screen-space refraction

Status: decided by the helper of M2-EX16, for the owner's review. Built: transmission draws on all three GPU paths, and its two maps keep row slots of their own beside the specular maps (M3-G6). A masked material keeps its transmission (M3-G5). The review of the rest is pending. Task: M2-EX16.

Summary: A standard or custom material with `transmission` lets the light behind it through, as three.js's `MeshPhysicalMaterial` does. After the camera's opaque pass, the frame copies the scene color into a target with a whole chain of mip levels. Such surfaces draw in the transparent pass. Each samples the copy where its refracted ray leaves the volume, with three.js's bicubic filter, at a level that its roughness picks. `ior`, `thickness`, `attenuationColor` and `attenuationDistance` take three.js's names and formulas. The glTF extensions `KHR_materials_transmission` and `KHR_materials_volume` load into them. `transmissionMap` and `thicknessMap` keep row slots of their own and sample the specular maps' texture arrays at layers of their own, so a specular map draws beside them. The glass scene matches three.js in 0.001% of the pixels on WebGPU, 0.000% on WebGL2 and 0.086% in compatibility mode. Nothing runs or downloads until a material lets light through.

## Question

The showcase scenes need water that shows its stony bed, bent by its ripples, and glass that reads rough or smooth ([D-117](D-117-showcase-features-before-1-0.md)). The technique review points at a copy of the opaque color ([Technique review](../technique-review.md), S-06). Where does the light behind a surface come from, and when does the frame make it? How does a material ask for it, and what does it cost?

## Rule

- The intent of three.js's transmission ([D-52](D-52-intent-parity.md)). The light behind a surface bends by its index of refraction and its thickness. It blurs by the surface's roughness and takes the color of its volume.
- One look on all three GPU paths, with image references on the Mac's GPU and on SwiftShader.
- Zero cost while no material lets light through: no pass, no target, no bind group change and no shader download.
- No allocation per frame ([AGENTS.md](../../AGENTS.md#hard-rules), hard rule 1).
- The code that a page downloads at its start grows as little as it can, and new shader code loads on first use. At the base of pull request #473, the pipelined start without transmission measured 129.9 KB after Brotli, against that base's budget of 140 KB.

## Options

### Where the light behind comes from

| Option | Who does it | Verdict |
| --- | --- | --- |
| A: a copy of the scene color after the opaque pass, with a whole chain of mip levels | Filament, three.js's `WebGPURenderer` | Chosen |
| B: the opaque meshes drawn again into a target of its own, such as 1,024 x 1,024 | three.js's `WebGLRenderer`, Babylon.js | Rejected. The scene's vertex work runs twice, which S1's 100,000 boxes cannot afford, for a picture that the frame already holds |
| C: a Gaussian blur chain in place of plain mip levels | Filament | Rejected for now. It costs a pass per level and direction. The linear filter's levels, read with three.js's bicubic filter across two levels, already draw three.js's look |

Option A reads what the camera's view drew: the opaque objects, the background and the debug lines. Blended objects and other surfaces that let light through do not show through glass. three.js's copy holds the opaque objects too. It also draws the back faces of double-sided glass into its copy, which this design leaves out.

### When the frame makes the copy

The render graph declares one fullscreen pass, `Transmission`, after the camera's opaque pass and the debug lines. It reads the scene color so far, and creates `transmissionColor`: a target with a whole chain of mip levels, in the scene color's format. After the copy's render pass, `Op::GenerateMipmaps` makes the other levels, each from the one before with a linear filter. The camera's transparent pass then reads the target. The pass is declared only while some mesh and material pair lets light through, and its pipeline is built. Until the pipeline builds, glass shows the environment's light along the refracted ray.

- The camera's opaque and transparent passes then draw in two render passes. A multisampled scene color resolves at the end of each. The graph's compiler resolves a target in the middle of a frame when a pass samples it there.
- On the 8-bit path, the resolve pass resolves the scene color into the canvas and nothing else. So while the copy draws there, the final pass takes the scene color to the canvas, as it does when the render scale can drop.
- The copy has the canvas's size, and at a render scale below 1 the frame draws into its corner, as the other targets do. The shader clamps its samples to that corner.
- Views other than the camera's have no copy. Scene passes and reflection passes draw such surfaces with the environment's light along the refracted ray. The frame's values say which, in the spare float of `camera_world`.

### How a surface samples it

The shader follows three.js's `getIBLVolumeRefraction` (`lib/refraction.wgsl`). The view ray refracts at the surface by `1 / ior`. It travels the thickness, in the mesh's own units times the object's scale on each axis, and the exit point projects onto the screen. The copy is sampled there at the level `log2(width) × roughness × clamp(2 ior - 2, 0, 1)`, with three.js's bicubic B-spline filter across the two nearest levels. Beer's law absorbs the volume's color over the ray's length. The result, times the diffuse color and less the specular share, replaces that share of the surface's diffuse light. The reflections stay.

On the 8-bit path the copy holds display color. Its target is an sRGB texture, so the copy writes the decoded color and the levels average linear color. The TONE_MAP builds add the light from behind after the tone curve, as far as the fog lets it.

### The material API

| Option | Verdict |
| --- | --- |
| A: options of `materials.standard` with three.js's names: `transmission`, `thickness`, `attenuationColor`, `attenuationDistance`, with the existing `ior` | Chosen |
| B: a new factory, `materials.physical` | Rejected. It would split one material model in two for four values |
| C: a surface function only | Rejected. glTF files need the standard material to take the values |

`transmission` picks a shader variant, so the option is fixed at creation, as the alpha mode is. Given at all, even as 0, it gives the material the feature, and `set` changes its value. A material that lets light through draws in the transparent pass, sorted back to front with the blended ones. It takes the `opaque`, `mask` or `blend` alpha mode, and the mask decides which pixels draw, while the light from behind fills the pixels that remain, as three.js's `alphaTest` draws one; `hash` throws E1217 in development builds, since three.js has no counterpart for it. The surface's `transmission` and `thickness` exist in every custom build. Only WGSL that names `.transmission` builds the TRANSMISSION variants, so other custom materials keep as few builds as before. A custom material with the option but without such WGSL throws E1217.

The material row is thirty-seven `vec4f`s, 592 bytes (`MATERIAL_BYTES` in `crates/null3d-gpu/src/drawlist.rs`). Two of them hold the transmission, the thickness and the index of refraction, then the volume's color and distance, and only the TRANSMISSION builds read those two. Another holds the texture array layers of the transmission and thickness maps. On WebGL2 each row is a row of thirty-seven texels of a data texture.

### Maps

`transmissionMap` and `thicknessMap` keep map row slots of their own, the ninth and the tenth of a material's row. So do `transmissionTexture` of `KHR_materials_transmission` and `thicknessTexture` of `KHR_materials_volume`. The transmission map's red multiplies the transmission, and the thickness map's green multiplies the thickness, as three.js's `transmission_fragment` chunk reads them.

Each volume map samples a specular slot's texture array at a layer of its own: the transmission map the specular intensity slot's array, and the thickness map the specular color slot's. The specular maps keep their slots, so a material draws both families. Two maps of one slot draw together when their textures share one array, which holds when their images have one size, format and sampling. A specular color texture is sRGB and a thickness texture is linear, so those two never share an array: a development build refuses the pair with E1217, and a production build draws the thickness map without the specular color map's array, so it leaves the thickness map out. The glTF loader notes that texture, as it notes each texture that it leaves out.

No map slot gains a binding. WebGPU allows 16 sampled textures per shader stage. The standard material's maps take 8, the frame group 7 and the copy 1. Two more bindings would take the fragment stage past that count, and two more map units would take the WebGL2 lit build past the reserve that a build reading the copy keeps. On WebGL2 the copy takes a texture unit too. The standard material with maps, shadows and morph targets reads 13 of the 16 units that every device gives a stage.

A layer map can fill the array that a transmission or a thickness map samples:

| Slot | The map of a material that lets light through | The layer maps that fill its array |
| --- | --- | --- |
| Specular intensity | `transmissionMap` | `clearcoatNormalMap`, `iridescenceThicknessMap` |
| Specular color | `thicknessMap` | `sheenColorMap`, `sheenRoughnessMap`, `anisotropyMap` |

The stained-glass lamp's glass, which packs a clear coat and a transmission in one texture, keeps both its `clearcoatMap` and its `transmissionTexture`. A coat normal texture or a sheen texture in the array that a volume map samples still clashes, and a development build refuses it with E1217.

**How a row names its slots.** A material's row names the family in each group of shared slots, in its anisotropy `vec4f`'s third float. Two bits name the light map's slot, two the specular intensity map's, and two the specular color map's. Two bits suffice, since each group names one family: the coat's and the sheen's, or iridescence's and the anisotropy's. The specular slots name their families apart, because one may hold a layer map of one family while the other holds a layer map of the other. Bits 6 and 7 of the same float say which of the two volume maps reads the second texture coordinates. `LayerMap::kind` names the families, `LayerMap::row_slot` gives each volume map's row slot, `set_layer_map` writes the bits of the slot that a map fills, and the lit shader decodes them where it samples each map.

The lit shader reads each shared slot by its group's family. The light slot holds the coat map or the film. The specular intensity slot holds the coat's normals, the film's thickness or the specular intensity map. The specular color slot holds the sheen, the anisotropy or the specular color map. A separate block reads the transmission and thickness maps at the layers that the row holds.

**Cost of the maps.** The material row grows by five `vec4f`s, from 512 to 592 bytes: 606 KB for the 1,024 materials that the table holds. The WebGL2 data texture widens from 32 to 37 texels per row, and the split-sum table moves to column 37. Every map slot keeps its binding, so neither path's bindings or sampled-texture counts grow. A build that lets light through loads one more texel of the row per fragment, which holds the two layers, in a row that it already reads.

### glTF

`KHR_materials_transmission` sets `transmission`, and `KHR_materials_volume` sets `thickness`, `attenuationColor` and `attenuationDistance`. A missing `attenuationDistance` absorbs nothing, as glTF's default of infinity does. A masked material keeps its transmission, as three.js draws one: the cut-out decides which pixels draw, and the light from behind fills the rest. Until M3-G5 the loader dropped the transmission of such a material, with the note that the engine did not draw it.

### Three faults to avoid

- The builders turn the copy on before they ask for the pipelines. Otherwise a frame held at one time declares no copy, and glass shows only the ambient light.
- A feature's module always takes the device's draw index bit. The copy's pipeline has no draw index bit, since its shader has no build with it. Without the rule, the shader set loads the module without the bit too, and the first glass on WebGL2 with multi-draw downloads two shader files.
- On WebGL2, a render target of the frame with one layer, in a linear format, takes GL's own `generateMipmap`. Made as the levels of uploaded images are, with a draw into a spare texture of the full size and then a copy into the level, each level takes two passes. The copy's levels then cost about 3.3 ms of GPU time per frame on the Mac, while the whole glass water, its copy and its shading, costs WebGPU 0.89 ms. With the water, WebGL2 took 8.61 and 8.44 ms per frame with those draws, 5.04 and 5.16 ms with `generateMipmap`, and 5.53 and 5.28 ms with no levels at all. A comparison in the runs of pull request #473 named this cause. The Mac's load was 8 to 12, so only the differences count. Uploaded images and sRGB targets keep the draws, for the faults on Adreno and in Firefox that the backend records.

## Data

**Parity with three.js.** In the runs of pull request #473 (`e9a45c81d`), whose logs are not kept, on the Mac's GPU, `bun run parity -- --scene transmission --tier webgpu,compat,webgl2`, without tone mapping as the twin draws. The scene has a smooth, a rough and a tinted glass ball in front of a striped wall.

| Tier | Pixels that differ from three.js | three.js's two renderers |
| --- | --- | --- |
| WebGPU | 0.001% | 0.052% |
| Compatibility mode | 0.086% | 0.052% |
| WebGL2 | 0.000% | 0.052% |

In compatibility mode the 8-bit path averages the edge samples of the tinted ball and the wall after it encodes them. Every differing pixel lies on those edges, so the scene's limit is 0.2%.

**Checks of the look.** `tests/image/transmission.spec.ts` measures each effect against the same scene drawn another way, on all three tiers. A ball with no thickness shows the wall within 0.019 of the empty scene's colors, and a thick one differs by 0.071. The smooth ball's stripes are about 5 times as sharp as the rough ball's. The tinted ball's red falls from 0.67 to 0.004. On the water, ripples change the bed's colors by 0.019 on average against flat water.

**Cost.** `bun run bench:run -- --scenes s1 --pages null3d-webgpu,null3d-webgl2 --runs 3 --seconds 10`, without and with `--switches transmission`, on the Mac's GPU (Apple M5 Max, 120 Hz) at e2ecb6120, at a load of 2 to 5. The switch puts clear water that lets light through under S1's 100,000 boxes. Medians of 3 runs of 10 seconds:

| Page | GPU ms without | GPU ms with | CPU ms without | CPU ms with | Draw calls |
| --- | --- | --- | --- | --- | --- |
| WebGPU | 2.90 | 3.79 | 1.66 | 1.64 | 2 to 4 |
| WebGL2 | 5.32 | 5.11 | 1.78 | 2.18 | 3 to 5 |

On WebGPU the water, its copy and its levels cost 0.89 ms of GPU time. On WebGL2 the difference is smaller than the noise of the timer: the same page without the water took 4.36 ms in the first timing. With levels made by draws, the water cost WebGL2 4.0 ms (4.36 to 8.36 ms). The CPU time does not change on WebGPU. On WebGL2 the median moved with one run of three, and the lowest runs were 1.75 ms both times. Every page held 120 fps.

**Allocation.** `bun run bench:allocation --transmission` on the Mac's GPU, S1 with the clear water, in the same runs of pull request #473. Both paths pass. On WebGL2 the sketch worker allocated 376.6 bytes per frame and the render worker 148.6. On WebGPU they allocated 314.1 and 885.4. Most of WebGPU's share is the browser's encoder objects, which the check allows per pass. The replay allocated 333.3 bytes per frame, 13 more than its budget without the water, so the copy's render pass takes 64 bytes on top, as each of bloom's passes does. The mip levels allocated 174.4 bytes per frame, about 17 per level's pass, and may allocate 32 per pass for up to 11 levels.

**Size.** `bun run build:check-size` against main at c93bbaf5, after Brotli. The pipelined start grew from 129.8 to 130.4 KB on WebGPU, and from 127.1 to 127.6 KB on WebGL2. The material options, the copy's pipeline and binding, and the WebGPU backend's cached mip chains make most of it. The glTF worker grew by 2.1%, since it reads the two extensions, and the renderer that the sketch worker loads in its own thread modes by 1.4%. The WebAssembly files grew 0.5% and 0.6%. Each shader file of the `transmission` feature takes 18.3 to 22.4 KB of its 32 KB budget, and loads only with the first material that lets light through. A skinned or morphed mesh's builds that let light through have files of their own ([D-56](D-56-first-use-shader-files.md#builds-that-need-several-features)). In the skinning and morph files, they would grow those files by 16% to 20%.

**GPU check.** `bun run bench:gpu-check` at e2ecb6120 against main at c93bbaf5d, on the Mac. It did not judge, since the benchmark pages changed between the commits. The GPU time per frame changed by -0.1% on S4 at Medium (3.91 ms), +2.8% on S6 at Medium (5.21 to 5.25 ms), -0.2% on S4 at High (3.92 to 3.91 ms) and -1.2% on S6 at High (5.36 to 5.29 ms). Neither scene has a material that lets light through, so each is within the noise and far below the check's limit of 25% and 0.3 ms.

**Tests of the maps.** `materials.rs` checks that a coat map and the volume maps name their families apart, and that the kinds float sits in the anisotropy `vec4f`, which the shaders read. `materials.test.ts` checks that a clear coat's and a sheen's values keep the two maps while their maps displace one each. `gltf-parse.test.ts` checks a coated glass that keeps both textures, and a coat normal texture that displaces the transmission texture. `transmission.spec.ts` draws the glass twice, with and without the maps beside a clear coat, and the two pictures differ on every tier, so the coat does not hide the maps.

The `gltf-ktx2` test, which draws the lamp, matches its references on all three tiers of the Mac's set with the maps drawn: the lamp's transmission texture leaves that picture within the comparison's limit, so no reference moved. CI's own drawing judges the software-GPU set. The scene's parity check passes on the three tiers at 0.253%, 0.265% and 0.276% of the pixels, against its limit of 0.5%, where three.js's two renderers differ by 0.093%.

The GPU check reports `not judged` for the maps, because the benchmark pages changed between main's commit and the branch. Its figures are s4 Medium 4.24 to 4.20 ms, s6 Medium 4.69 to 4.61 ms, s4 High 4.54 to 2.24 ms and s6 High 6.51 to 6.70 ms. Neither scene draws a material with a clear coat and transmission, so the maps add nothing to their work.

The merge of m3-start into the maps' branch made the shader build compile 39 of its 80 entries and reuse 41, in 23 minutes of wall time and 77 minutes of processor time at about three cores, at a machine load of 100 to 175.

## Decision

Options A throughout. The camera's opaque color goes into a copy with a whole chain of mip levels, which surfaces sample as three.js samples it. Four options of the standard material ask for it. The copy, its target and its shaders exist only while some material lets light through.

## Consequences

- Code: `crates/null3d-render/src/transmission.rs` (the copy), `frame_graph.rs` (the pass, its target and its levels) and `graph/compile.rs` (the resolve between render passes). Both builders bind the copy at binding 15 of the frame groups, and set the frame's flag. `materials.rs`, `pipelines.rs` and `sorted.rs` hold the feature, the variant and the transparent pass. The shaders are `lib/refraction.wgsl`, `lit.wgsl` and `transmission_copy.wgsl`, in the shader manifest's `transmission` feature. The options live in `packages/engine/src/scene/resources.ts`, and the glTF reader takes the extensions.
- Docs: `api/materials` (Transmission), `shaders/surface-functions`, `concepts/materials`, `api/assets` and `concepts/assets` (the glTF extensions), and the mapping entries `mat-transmission`, `mat-physical` and `reflector`.
- Skills: the develop skill's task table, quick reference and shaders reference, and the port skill's materials notes and evals.
- Tests: the frame graph's and the builders' tests, the image tests `transmission`, `transmission-custom`, `transmission-blend`, `transmission-maps`, `transmission-specular` and `transmission-water`, the parity scene, the transmission spec, the first-use download test, and `--transmission` in `bench:allocation`.
- Later: a Gaussian chain if a scene needs a softer blur, and the back faces of double-sided glass in the copy.

## Addendum: a masked material keeps its transmission

Until this change, a glTF material with the alpha mode `MASK` lost its transmission, and with it the volume and both maps. The loader noted that the engine did not draw such a material. three.js r186 draws the other way: its render list takes any material whose transmission is above zero, whatever its alpha mode (`WebGLRenderLists.js`). Its transmission pass draws the opaque objects into a target, then draws those materials over it with the scene's depth. Its `alphaTest` discards in the same fragment shader, so the cut-out decides the pixels that draw and the survivors shade with the light from behind.

null3D now does the same. The loader keeps the factor, the volume and both maps. `permutation::APART` no longer keeps `TRANSMISSION` apart from `ALPHA_MASK`. The shader samples the copy of the opaque color while it lights the surface, and tests the mask last, after every derivative, so a build with both bits takes the light from behind and then cuts its holes. The visible result is three.js's. `feature::masks` counts a material that lets light through, which gives it the mask bit, its cut-out shadow and its motion, and `materials.standard` takes `mask` with `transmission`. The hash stays apart, since three.js has no counterpart for it.

Four Khronos files carry this case: StainedGlassLamp, TransmissionTest (its three BlueTransWithMask materials), CompareIor and AnimationPointerUVs. The sample content holds the lamp and the animation-pointer file, and not the other two.

The builds grew, as the mask shapes multiply the transmission words. The manifest makes 57,484 GLSL builds and 20,777 WGSL builds, 78,261 in all, against the recorded 53,762 and 19,227. The shader build compiled 78,249 programs in the run that wrote the modules. Each new build carries `TRANSMISSION` with `ALPHA_MASK`, in one of three mask shapes (the plain cutoff, alpha to coverage, and the sample mask of a target without alpha), beside every combination of the other bits that its template lists: vertex colors, shadows, skinning, morph targets, area lights, a clear coat, tangents, a bump map and displacement. Every one of those bits comes from the public API or the device, and the refusals in the permutation table keep the pair out of translucency, row values, weighted blending, level fades, index-read instances, parallax and the alpha hash.

The shader build compiles all 80 entries and 78,249 programs in 386 s with its per-entry cache off and no module set to restore, so it reuses none. Its wall time is 410 s. It ran on an otherwise idle Mac: the queue's one-minute load read 1.8 when it started, and its own threads took it to 23.7 while it ran. The generated set grew from 3,125,085,314 bytes in 5,741 files to 3,439,750,427 bytes in 6,381 files, up 10.1% uncompressed. The largest first-use module is 51,806 bytes after Brotli against its 56 KB budget.

Tests: `crates/null3d-render/tests/transmission.rs` checks that the masked pair draws with its mask bit and its own pipeline, while the clear pair keeps the unmasked one. `gltf-parse.test.ts` checks a masked file that keeps its factor, volume and both maps, and the picture test's own file. `materials.test.ts` checks that `mask` is accepted with transmission and `hash` refused. `transmission.spec.ts` measures the two panes of the new picture against each other on every tier, and the lamp's picture and parity judge the case in a Khronos file. The mirror measure is 0.0325, 0.0327 and 0.0328 on WebGPU, compatibility mode and WebGL2, and the same in the software set. The spec's floor is 0.01. The new scene matched three.js in 0.000% of the pixels on WebGPU and 0.098% in compatibility mode. It differed in 0.220% on WebGL2, in a one-pixel column at each pane's outer edge, so it takes the alpha-coverage scene's 0.25%.

CI run 40221250824, five commits before this head, found five faults of this change. The shader build budget was stale, and the two whole-set checks went over their memory ceilings. The new scene's three software pictures were missing, and the parity test's list lacked the scene. The size check lacked its trailer. All five are fixed at this head. The run failed fifteen jobs, several outside this task. No run covered this head when the first check read it. The build-order test passed in that run. It failed once in a separate loaded local run, and its assertion now holds under any scheduling.
