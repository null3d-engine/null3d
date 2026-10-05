# D-82: Transparency parity: two-sided blending, alpha to coverage, the alpha hash and cut-out shadows

Status: decided. Date: 2026-10-05. Task: M2-J6.

## Question

Three.js has three ways to draw see-through and cut-out surfaces that null3D lacked:

1. A double-sided material with `transparent: true` draws twice, back faces then front faces, unless `forceSinglePass` is set.
2. `alphaToCoverage` turns the alpha into MSAA coverage, with an alpha ramp one pixel wide above `alphaTest`.
3. `alphaHash` keeps a fragment when its alpha passes a hash of its position in the mesh's own space.

How does null3D draw each one on all three GPU paths? In particular, alpha to coverage needs a target with alpha on WebGPU, and null3D's usual WebGPU scene color, `rg11b10ufloat`, has none.

## Rule

- Intent parity ([D-52](D-52-intent-parity.md)): these are material options with one meaning in three.js. So each draws what three.js draws, on every path, and the parity scenes compare with three.js's rule.
- No change to opaque materials, to masked materials without the new options, or to the start file's size beyond what the new shader code needs. New shader builds load on first use ([D-56](D-56-first-use-shader-files.md)).
- The double-sided draw costs under 5% of GPU time in S2 with every material double-sided (the technique analysis's rule, prototype G3).
- Stay within WebGPU's default limits and compatibility mode (AGENTS.md hard rule 6).

## Data

### What WebGPU allows

The WebGPU specification (`gpuweb/gpuweb`, `spec/index.bs`, read on 5 October 2026) says:

- "validating GPUMultisampleState": if `alphaToCoverageEnabled` is true, `count` must be greater than 1.
- "validating GPURenderPipelineDescriptor": if `alphaToCoverageEnabled` is true, `fragment.targets[0]` must exist, and its format "must be a GPUTextureFormat which is blendable and has an alpha channel".
- A fragment shader that writes `@builtin(sample_mask)` must keep `alphaToCoverageEnabled` false. Compatibility mode forbids `sample_mask` as a shader input or output.

So `rg11b10ufloat` cannot turn alpha into coverage. PlayCanvas reads the specification the same way and drops the flag for such targets (`webgpu-render-pipeline.js`). The scene color's format by path, from `sceneColorFormat` in `packages/engine/src/page/limits.ts`:

| Path | Anti-aliasing | Scene color | Alpha channel | Alpha to coverage |
| --- | --- | --- | --- | --- |
| WebGPU | MSAA, opaque canvas | `rg11b10ufloat` where the device draws into it | No | The shader writes `sample_mask` |
| WebGPU | MSAA, transparent canvas, or no `rg11b10ufloat` | `rgba16float` | Yes | The pipeline |
| Compatibility mode | MSAA | The canvas's 8-bit format | Yes | The pipeline |
| Compatibility mode, WebGPU, WebGL2 | FXAA or none | Any | | None: one sample, a plain alpha test |
| WebGL2 | MSAA | `RGBA16F` or the canvas's 8-bit format | Yes | The pipeline (`SAMPLE_ALPHA_TO_COVERAGE`) |

### Parity and cost

Filled in from the runs below.

## Options

### Alpha to coverage on `rg11b10ufloat`

1. The shader writes the coverage itself through `@builtin(sample_mask)`, in builds of the masked templates that load on first use. Chosen. It needs no new target and no copy, and core WebGPU allows it. The mask takes the coverage rounded to quarters of the 4 samples, with samples on a diagonal first.
2. Switch the scene color to `rgba16float` while any material turns alpha to coverage on. Rejected: it doubles the scene color's bytes for the whole frame, for the sake of a few edges. A format change also rebuilds every scene pipeline.
3. Drop alpha to coverage there, as PlayCanvas does. Rejected: core WebGPU is the main path, and foliage edges would then differ from the other paths.

### Where the new shader code lives

The first build put the ramp and the hash in every masked build, and flags in the material's row chose one. That grew the start's GLSL file by 10% and the skinning files past their limit of 1,536 KB uncompressed ([D-56](D-56-first-use-shader-files.md)). The skinning files stood at 98% of that limit before. So the ramp and the hash have permutation bits of their own, `ALPHA_COVERAGE` and `ALPHA_HASH`, and the plain mask's builds stay as they were. Their builds load on first use, in the files `coverage` and `hash`.

A build with SKIN and one of these bits would belong to the skinning file, by D-56's rule of the lowest bit. So a feature table can now claim the builds that it shares with features of lower bits (`claims_shared_builds`). Both new features do, and the skinning and morph files keep their size.

Custom materials build none of the three bits. Each custom material builds every variant of the standard template with its own WGSL. The bits would add half again to each one's shader file. They take the `mask` mode's cutoff, and `materials.shader` throws E1217 for `alphaToCoverage` and the `hash` mode.

### The ramp

The ramp is three.js's: `smoothstep(cutoff, cutoff + fwidth(alpha), alpha)`, with the fragment discarded at 0. Bevy, Godot and Filament centre the ramp on the cutoff (Golus's sharpening). Under D-52 the cutoff's meaning is intent, so null3D keeps three.js's. `fwidth` takes a floor of 0.0001, where three.js's `smoothstep` with equal edges is undefined.

### The alpha hash

A port of three.js's `getAlphaHashThreshold`, Wyman and McGuire's hashed alpha test. It hashes the vertex position in the mesh's own space, before morphs and skinning, as three.js's `vPosition` holds it. Sprites hash the corner on their quad: three.js's sprite shader never sets `vPosition`, so its sprites have no pattern to match. The hash is an alpha mode, `alphaMode: 'hash'`, since a surface uses either a cutoff or a hash. It ignores `alphaCutoff`.

### Alpha to coverage by default

three.js leaves `alphaToCoverage` off. Filament turns it on for every masked material, and Bevy and Godot offer it as an alpha mode. Under D-52 part 2 the best technique is the default. So the owner ruled on 5 October 2026 that masked materials take it whenever MSAA is on. The option costs no draw and no pass: the ramp is a few instructions, and the GPU or the sample mask does the rest. The option `alphaToCoverage: false` gives three.js's hard `alphaTest` edges. A three-compat add-on can set it off for ports. The owner may still overrule.

The parity tests follow from it. The `alpha-mask` scene turns the option off, so it still checks three.js's `alphaTest`. The glTF twin turns `alphaToCoverage` on for every material with an alpha test, so the glTF scenes compare like with like. The scenes that change images are listed under Data.

### Masked shadows

Before this record, a masked material cast its mesh's whole shape: the shadow depth template drew no fragment shader. The glTF alpha mode `MASK` cuts the surface, and the shadow is part of the surface's look. So the owner ruled that masked materials cut their shadows in this change.

- Two templates draw masked casters. The first, `SHADOW_CUTOUT`, tests the opacity and the vertex alpha. The second, `SHADOW_CUTOUT_MAP`, adds the base color map's alpha, from the map's own bind group, as the unlit map template binds it. Both are builds of the shadow depth shader with the `CUTOUT` def, so the caster's vertices stay exactly where the depth template puts them. Their builds load on first use, in the file `cutout`.
- A masked caster's bucket keeps its material and its map's group, where other casters share one bucket per mesh and template. Only masked casters pay for the split.
- The mask and alpha to coverage cut at the material's own cutoff. Three.js cuts alpha to coverage's shadow at a fixed 0.5 (`WebGLShadowMap.js`, "approximate alphaToCoverage"). The cutoff is the author's intent, and the ramp starts there, so null3D keeps it. With alpha to coverage on by default, a fixed 0.5 would also move every glTF mask's shadow.
- The alpha hash casts a hashed shadow, as Godot does, with the pattern in the light's pixels. The shadow filter blends it into a partial shadow as dense as the alpha. three.js casts the whole shape there.
- Custom materials cast their whole shape. Their alpha comes from their own WGSL, which the shadow pass does not run.

### The double-sided draw

A run of the transparent pass is a set of neighbors in the sorted order that share a mesh and a material. Each run draws its back faces with one pipeline, then its front faces with another, as three.js's WebGLRenderer does per object. A run of several objects therefore draws all its back faces before its front faces. three.js draws object by object. Blended surfaces write depth. So where two objects of one run overlap on screen, the far object's front faces fail the depth test behind the near one's back faces. Neighbors that share a bucket sit next to each other in depth, and splitting runs would undo the batching of blended rows. Sprites and lines face the camera, so they draw once.

## Decision

- Double-sided blended runs draw back faces, then front faces; `forceSinglePass: true` draws one pass.
- `alphaToCoverage: true` with `alphaMode: 'mask'`: the pipeline's alpha to coverage where the target has alpha, the shader's `sample_mask` on `rg11b10ufloat`, and a plain alpha test with one sample. Off by default, as in three.js.
- `alphaMode: 'hash'`: three.js's hash on the mesh's own positions.
- Alpha to coverage is on by default for masked materials; `alphaToCoverage: false` turns it off.
- Masked materials of the engine's mesh templates cut their shadows: templates 37 `SHADOW_CUTOUT` and 38 `SHADOW_CUTOUT_MAP`.
- New numbers: material features 512 `ALPHA_TO_COVERAGE`, 2048 `ALPHA_HASH` and 4096 `SINGLE_PASS`; state flag 512 `ALPHA_TO_COVERAGE`; permutation bits `SAMPLE_MASK` (1 << 20), `ALPHA_COVERAGE` (1 << 21) and `ALPHA_HASH` (1 << 22).
- A bit builds only beside the bits it needs, and `ALPHA_COVERAGE` and `ALPHA_HASH` never build together (`permutation::NEEDS` and `APART`). The builds load on first use (`[first_use.coverage]` and `[first_use.hash]`).

## Consequences

- `null3d::cutout` holds the ramp, the hash and the sample mask, which the lit, unlit, unlit map and sprite templates share.
- The docs pages `api/materials` and `concepts/materials`, the three.js mapping entries `side: DoubleSide`, `alphaToCoverage`, `alphaHash` and `forceSinglePass`, and both skills' material references describe the options.
- The image tests `alpha-coverage`, `alpha-coverage-no-msaa`, `alpha-hash`, `transparency-solids`, `alpha-mask-shadows`, `alpha-coverage-shadows` and `alpha-hash-shadows`, with three.js twins for four of them.
- The shadows page no longer says that masked materials cast their whole shape.
