# D-122: Transmission and screen-space refraction

Status: proposed, 2026-10-09. Date: 2026-10-09. Task: M2-EX16.

Summary: A standard or custom material with `transmission` lets the light behind it through, as three.js's `MeshPhysicalMaterial` does. After the camera's opaque pass, the frame copies the scene color into a target with a whole chain of mip levels. Such surfaces draw in the transparent pass. Each samples the copy where its refracted ray leaves the volume, with three.js's bicubic filter, at a level that its roughness picks. `ior`, `thickness`, `attenuationColor` and `attenuationDistance` take three.js's names and formulas. The glTF extensions `KHR_materials_transmission` and `KHR_materials_volume` load into them. The glass scene matches three.js in 0.001% of the pixels on WebGPU, 0.000% on WebGL2 and 0.086% in compatibility mode. Nothing runs or downloads until a material lets light through.

## Question

The showcase scenes need water that shows its stony bed, bent by its ripples, and glass that reads rough or smooth ([D-117](D-117-showcase-features-before-1-0.md)). The technique review put transmission after 1.0. It pointed at a copy of the opaque color ([Technique review](../technique-review-2026-10.md), S-06). Where does the light behind a surface come from, and when does the frame make it? How does a material ask for it, and what does it cost?

## Rule

- The intent of three.js's transmission ([D-52](D-52-intent-parity.md)). The light behind a surface bends by its index of refraction and its thickness. It blurs by the surface's roughness and takes the color of its volume.
- One look on all three GPU paths, with image references on the Mac's GPU and on SwiftShader.
- Zero cost while no material lets light through: no pass, no target, no bind group change and no shader download.
- No allocation per frame ([AGENTS.md](../../AGENTS.md#hard-rules), hard rule 1).
- The code that a page downloads at its start grows as little as it can, and new shader code loads on first use. The pipelined start was at 129.9 KB of 140 KB after Brotli on the branch's base.

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

- The camera's opaque and transparent passes then draw in two render passes. A multisampled scene color resolves at the end of each. The graph's compiler now resolves a target in the middle of a frame when a pass samples it there.
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

`transmission` picks a shader variant, so the option is fixed at creation, as the alpha mode is. Given at all, even as 0, it gives the material the feature, and `set` changes its value. A material that lets light through draws in the transparent pass, sorted back to front with the blended ones. It takes no mask, so `mask` and `hash` throw E1217 in development builds. The surface's `transmission` and `thickness` exist in every custom build. Only WGSL that names `.transmission` builds the TRANSMISSION variants, so other custom materials keep as few builds as before. A custom material with the option but without such WGSL throws E1217.

The material row grew from nine `vec4f`s to eleven: the transmission, the thickness and the index of refraction, then the volume's color and distance. Shaders copy the first nine as before, and only the TRANSMISSION builds read the last two. The row is 176 bytes, so the table of 1,024 materials holds 32 KB more. On WebGL2 the split-sum table's columns move from 9 to 11.

### Maps

`transmissionMap` and `thicknessMap` are not drawn. WebGPU allows 16 sampled textures per shader stage. The standard material's maps take 8, the frame group 6 and the copy 1. Two more maps would pass the limit. glTF files that name them load without them, and the loader's notes say so. On WebGL2 the copy takes a texture unit too. The standard material with maps, shadows and morph targets then reads 13 of the 16 units that every device gives a stage. The unit test of the programs keeps 4 units spare for later features. Transmission is one of those features, so its builds keep 3.

### glTF

`KHR_materials_transmission` sets `transmission`, and `KHR_materials_volume` sets `thickness`, `attenuationColor` and `attenuationDistance`. A missing `attenuationDistance` absorbs nothing, as glTF's default of infinity does. A masked material lets no light through, as the engine draws transmission without a mask.

### Two faults that the tests found

- The frame turned the copy on after it asked for the pipelines. A frame held at one time then declared no copy, and glass showed only the ambient light. The builders now turn it on first.
- On WebGL2 with multi-draw, the first glass downloaded two shader files. The copy's pipeline has no draw index bit, since its shader has no build with it. So the shader set loaded the module without the bit too. A feature's module now always takes the device's draw index bit.

## Data

**Parity with three.js.** On 9 October 2026 on the Mac's GPU, `bun run parity -- --scene transmission --tier webgpu,compat,webgl2`, without tone mapping as the twin draws. The scene has a smooth, a rough and a tinted glass ball in front of a striped wall.

| Tier | Pixels that differ from three.js | three.js's two renderers |
| --- | --- | --- |
| WebGPU | 0.001% | 0.052% |
| Compatibility mode | 0.086% | 0.052% |
| WebGL2 | 0.000% | 0.052% |

In compatibility mode the 8-bit path averages the edge samples of the tinted ball and the wall after it encodes them. Every differing pixel lies on those edges, so the scene's limit is 0.2%.

**Checks of the look.** `tests/image/transmission.spec.ts` measures each effect against the same scene drawn another way, on all three tiers. A ball with no thickness shows the wall within 0.019 of the empty scene's colors, and a thick one differs by 0.071. The smooth ball's stripes are about 5 times as sharp as the rough ball's. The tinted ball's red falls from 0.67 to 0.004. On the water, ripples change the bed's colors by 0.019 on average against flat water.

**Cost.** TBD.

**Allocation.** TBD.

**Size.** TBD.

**GPU check.** TBD.

## Decision

Options A throughout. The camera's opaque color goes into a copy with a whole chain of mip levels, which surfaces sample as three.js samples it. Four options of the standard material ask for it. The copy, its target and its shaders exist only while some material lets light through.

## Consequences

- Code: `crates/null3d-render/src/transmission.rs` (the copy), `frame_graph.rs` (the pass, its target and its levels) and `graph/compile.rs` (the resolve between render passes). Both builders bind the copy at binding 15 of the frame groups, and set the frame's flag. `materials.rs`, `pipelines.rs` and `sorted.rs` hold the feature, the variant and the transparent pass. The shaders are `lib/refraction.wgsl`, `lit.wgsl` and `transmission_copy.wgsl`, in the shader manifest's `transmission` feature. The options live in `packages/engine/src/scene/resources.ts`, and the glTF reader takes the extensions.
- Docs: `api/materials` (Transmission), `shaders/surface-functions`, `concepts/materials`, `api/assets` and `concepts/assets` (the glTF extensions), and the mapping entries `mat-transmission`, `mat-physical` and `reflector`.
- Skills: the develop skill's task table, quick reference and shaders reference, and the port skill's materials notes and evals.
- Tests: the frame graph's and the builders' tests, the image tests `transmission`, `transmission-custom`, `transmission-blend` and `transmission-water`, the parity scene, the transmission spec, the first-use download test, and `--transmission` in `bench:allocation`.
- Later: the two maps, a Gaussian chain if a scene needs a softer blur, and the back faces of double-sided glass in the copy.
