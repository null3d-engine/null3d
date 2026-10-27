# D-122: Transmission and screen-space refraction

Status: decided by the helper of M2-EX16, for the owner's review. Built: transmission is on main (`e9a45c81d`), and its transmission and thickness maps (M3-G4) are on m3-start (`7ac324c76`, `e13f60200`). The owner ruled that the engine draws both maps, and M3-G6 built it: a specular map beside a transmission or a thickness map keeps its own slot, and the volume map keeps a row slot of its own beside it. Open fault: a cut-out material drops its transmission. The review of the rest is pending. Task: M2-EX16.

Summary: A standard or custom material with `transmission` lets the light behind it through, as three.js's `MeshPhysicalMaterial` does. After the camera's opaque pass, the frame copies the scene color into a target with a whole chain of mip levels. Such surfaces draw in the transparent pass. Each samples the copy where its refracted ray leaves the volume, with three.js's bicubic filter, at a level that its roughness picks. `ior`, `thickness`, `attenuationColor` and `attenuationDistance` take three.js's names and formulas. The glTF extensions `KHR_materials_transmission` and `KHR_materials_volume` load into them. `transmissionMap` and `thicknessMap` keep row slots of their own and sample the specular slots' texture arrays at layers of their own, so a specular map draws beside them. The glass scene matches three.js in 0.001% of the pixels on WebGPU, 0.000% on WebGL2 and 0.086% in compatibility mode. Nothing runs or downloads until a material lets light through.

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

`transmission` picks a shader variant, so the option is fixed at creation, as the alpha mode is. Given at all, even as 0, it gives the material the feature, and `set` changes its value. A material that lets light through draws in the transparent pass, sorted back to front with the blended ones. It takes no mask, so `mask` and `hash` throw E1217 in development builds. The surface's `transmission` and `thickness` exist in every custom build. Only WGSL that names `.transmission` builds the TRANSMISSION variants, so other custom materials gain no builds. A custom material with the option but without such WGSL throws E1217.

The material row is thirty-seven `vec4f`s, 592 bytes (`MATERIAL_BYTES` in `crates/null3d-gpu/src/drawlist.rs`). Two of them hold the transmission, the thickness and the index of refraction, then the volume's color and distance, and only the TRANSMISSION builds read those two. One holds the layers of the transmission and thickness maps in the specular slots' arrays. On WebGL2 each row is a row of thirty-seven texels of a data texture.

### Maps

`transmissionMap` and `thicknessMap` keep row slots of their own, after the eight map slots, and sample the specular intensity and specular color slots' texture arrays at layers of their own. So do `transmissionTexture` of `KHR_materials_transmission` and `thicknessTexture` of `KHR_materials_volume`. The transmission map's red multiplies the transmission, and the thickness map's green multiplies the thickness, as three.js's `transmission_fragment` chunk reads them.

No slot with a binding of its own is free for them. WebGPU allows 16 sampled textures per shader stage. The standard material's maps take 8, the frame group 7 and the copy 1. A ninth and tenth binding would pass the limit, so the two maps take no binding: each keeps a row slot, which holds its layer and its own transform, and samples the texture array that the specular slot of its family binds. Two textures share an array when their size, format, levels and kind agree, so both the specular map and the volume map draw wherever a material gives two textures that share one. On WebGL2 the copy takes a texture unit too. The standard material with maps, shadows and morph targets still reads 13 of the 16 units that every device gives a stage, since the row slots add no unit.

A layer map can fill the array that a transmission or a thickness map samples:

| Slot | The map of a material that lets light through | The layer maps that fill its array |
| --- | --- | --- |
| Specular intensity | `transmissionMap` | `clearcoatNormalMap`, `iridescenceThicknessMap` |
| Specular color | `thicknessMap` | `sheenColorMap`, `sheenRoughnessMap`, `anisotropyMap` |

The owner ruled that the engine draws a specular map beside a transmission or a thickness map, each in its own slot. M3-G6 built that: a specular map keeps its slot, and the volume map takes a row slot of its own beside it. A layer map in the array that a volume map samples still clashes, and development builds refuse it with E1217. The stained-glass lamp's glass, which packs a clear coat and a transmission in one texture, keeps both its `clearcoatMap` and its `transmissionTexture`.

The glTF loader keeps both textures: it leaves a volume texture out only where a layer map fills its slot in a layered material. It notes each texture that it leaves out, such as `material 1's transmissionTexture, which it leaves out where the clear coat's normal texture fills the same slot`.

**How a row names its maps.** A material's row names the family in each group of shared slots, in its anisotropy `vec4f`'s third float. Two bits name the light map's slot, two the specular intensity map's, and two the specular color map's. Two bits suffice, since each group names one family: the coat's and the sheen's, or iridescence's and the anisotropy's. A layer map in the array of a specular slot names its family there; the volume maps add no family, since their own row slots name them. `LayerMap::kind` names the families, `set_layer_map` writes the bits of the slot that a map fills, and the lit shader decodes the three where it samples each slot. Bits 6 and 7 of the same float say that the transmission and thickness maps read the second texture coordinates.

The lit shader reads each slot by its group's family. The light slot holds the coat map or the film. The specular intensity slot holds the coat's normals or the film's thickness. The specular color slot holds the sheen or the anisotropy. A row slot of its own holds each volume map's layer and transform, and the shader samples the specular slot's array at that layer, so both draw.

**Cost of the maps.** The row grows by one `vec4f`, which holds the two volume layers. No map slot gains a binding and no WebGL2 unit is added, so neither path's bindings nor its shader stage count grows. A build that lets light through and reads maps loads one more texel of its material's row per fragment, which holds the two volume layers.

### glTF

`KHR_materials_transmission` sets `transmission`, and `KHR_materials_volume` sets `thickness`, `attenuationColor` and `attenuationDistance`. A missing `attenuationDistance` absorbs nothing, as glTF's default of infinity does. A masked material lets no light through, as the engine draws transmission without a mask.

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
- Tests: the frame graph's and the builders' tests, the image tests `transmission`, `transmission-custom`, `transmission-blend` and `transmission-water`, the parity scene, the transmission spec, the first-use download test, and `--transmission` in `bench:allocation`.
- Later: a Gaussian chain if a scene needs a softer blur, and the back faces of double-sided glass in the copy.
