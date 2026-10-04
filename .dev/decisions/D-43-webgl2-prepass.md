# D-43: How WebGL2 draws the depth prepass

Status: decided for correctness, 2026-10-04; the device timings pending. Task: M2-R2.

## Question

The depth prepass draws the opaque objects' depth first. The opaque pass then shades only where its depth equals the prepass's depth. On WebGL2 the prepass drew with the shadow depth template's build, a program of its own, as WebGPU does. In Chrome on the Mac, the shadows image test then lost most of its ground, so WebGL2 drew without the prepass (M1-A7). Why do the two programs give different depths, and how should WebGL2 draw the prepass?

## Rule

- Each prepass image test gives the same image as its test without the prepass, on every GPU tier, on the Mac's GPU and on SwiftShader.
- The prepass works on every WebGL2 driver without a check of the GPU's name (hard rule 14).
- No extra fragment work in the prepass, which would remove its purpose.
- No per-frame allocation, and no growth of the shader files that a page downloads.

## Data

### What goes wrong

The shadows test with the prepass on WebGL2, drawn with the depth template's prepass build, against the image without the prepass:

| GPU | Pixels that differ |
| --- | --- |
| Chrome 154 on the Mac (ANGLE on Metal, Apple M5 Max) | 57.8% |
| SwiftShader (CI's software GPU) | Within the tolerance: the test passes |

On the Mac, the ground drew in blocks of about 32 pixels. Some blocks were empty, some striped along lines of equal depth, and some whole. The test for equal depth failed wherever the two depths differed by a rounding step. The cubes, which the near plane does not cut, drew correctly.

The GLSL of the two programs computes the position with the same calls in the same order. Both declare `invariant gl_Position`. The `WEBGL_debug_shaders` extension shows the Metal code that ANGLE writes. It is the same for both positions, and marks each one `[[invariant]]`. Still, Apple's shader compiler gave the two programs different positions. The shading program also passes the relative position to its fragment shader, and the depth-only program does not. So the compiler likely arranges the math in a different order in each program.

### Options

Each option was built and drawn on the shadows test in Chrome on the Mac.

| Option | Shadows test, pixels that differ | Fragment work in the prepass | Other cost |
| --- | --- | --- | --- |
| (a) The depth template's prepass build, as before | 57.8% | None | None |
| (b) The shading program itself, with color writes off | Within the tolerance | The whole shading of every pixel, twice | The prepass would cost more than it saves |
| (c) The shading pipeline's own vertex shader, linked with a fragment shader that writes nothing | 0 (none, bit for bit) | None | One more program per shading pipeline |
| (d) A test for nearer-or-equal depth with a small bias, in place of equal depth | Not built | None | Surfaces closer than the bias shade too, so the images would differ |
| (e) A `PREPASS` build of every mesh template in the shader build | Not built | None | The GLSL files grow by the vertex shaders of every template again |

### Option (c) on every prepass test

The prepass image tests draw seven scenes: shadows, masked cards, decals with a depth bias and see-through objects. The others are an orthographic camera whose near plane cuts a slab, S2, and skinned characters with shadows. Each image was compared with its test's image without the prepass, pixel for pixel.

| GPU | WebGL2 | WebGPU | Compatibility mode |
| --- | --- | --- | --- |
| Chrome on the Mac's GPU | 0 pixels differ in all seven | 0 in all seven | 0 in the first six |
| SwiftShader | 16 edge pixels in the orthographic test, 0 in the other five | 18 edge pixels in the orthographic test, 0 in the other five | 18 edge pixels in the orthographic test, 0 in the other five |

The skinned scene was compared pixel for pixel on the Mac's WebGL2 and WebGPU tiers only. Elsewhere it passes its tolerance.

Two more prepass copies joined later: the depth debug view, and a background texture. Both pass their tolerances on every tier and both GPU sets. The whole image manifest with `NULL3D_SWITCHES=prepass=on` on the Mac's GPU found two faults, both fixed here:

- The debug views replace every material with their own template. On WebGL2 the prepass asked for that template's `PREPASS` build, which does not exist, so the frame failed. The backend now reads the bit on the debug view template as on the mesh templates. On WebGPU the debug view's position was not invariant, and the depth view differed in 2.1% of its pixels with the prepass. Its position is now invariant, as in every other mesh template.
- The background texture draws after the prepass's meshes in the same render pass, so a vertex buffer was still bound. The WebGL2 backend refused a draw that makes its own vertices while a buffer was bound. It now ignores the buffer, as WebGPU does.

The same run showed one difference that every depth prepass has. The depth precision test puts two surfaces at exactly the same depth, and expects the one drawn first to win. With the prepass, both pass the test for equal depth, so the one drawn last shows, on all three tiers. WebGPU's prepass did the same before this change. The docs page `concepts/quality-presets` names this case.

The orthographic test's edge pixels lie along one edge of the slab, and WebGPU's prepass on main shows them too. All seven tests pass their tolerances on every tier and both GPU sets.

### Cost

`bun run bench:run --scenes s2 --pages null3d-webgl2,null3d-webgl2-prepass,null3d-webgpu,null3d-webgpu-prepass --runs 5 --seconds 5`, Chrome 154 on the MacBook Pro M5 Max, 4 October 2026 (run `target/bench/20261003-235529-bench`). The pages took turns. Other helpers used the Mac during the run.

| Measure | WebGL2 | WebGL2 with the prepass | WebGPU | WebGPU with the prepass |
| --- | --- | --- | --- | --- |
| Busiest thread, ms per frame | 0.27 | 0.28 | 0.23 | 0.22 |
| Render worker, ms per frame | 0.075 | 0.080 | 0.145 | 0.150 |
| GPU time, ms per frame | No timer | No timer | 0.28 | 0.40 |
| Draw calls | 101 | 201 | 101 | 201 |

With the prepass off, the change costs nothing. The command `bun run bench:run --compare <base>,. --scenes s2 --pages null3d-webgl2 --runs 10 --seconds 5` compared it with the commit before. The busiest thread took 0.273 ms and 0.275 ms (+1.8%), within the noise of S2's short frames. A first run of 6 rounds had flagged +6.5%, with runs from 0.215 to 0.355 ms on both sides.

The phones' and the iPad's figures, from the bench plan with the same pages, are still to come.

## Decision

WebGL2 draws the prepass with option (c). The pipeline key keeps the shading pipeline's template, permutation bits and vertex format, and adds the `PREPASS` bit. It takes the pair's faces and depth bias, with no color writes. The WebGL2 backend links the vertex shader of the template's build without the bit with a fragment shader of one empty `main`. WebGPU keeps option (a), which gives identical images there.

Option (c) gives identical images on every GPU that ran it, and it relies on no invariance across programs. It adds no fragment work and no shader source to download. Its one cost is one more program link per shading pipeline, when the scene's structure first needs it. Option (b) costs the prepass's purpose, (d) changes images, and (e) grows every GLSL file.

The same rule covers skinned meshes on WebGL2. Their skinning lives in the vertex shader, so the prepass skins them exactly as the opaque pass does.

## Custom materials and sprites

Added with ambient occlusion (M2-F2), 4 October 2026. The depth template places vertices as the engine's mesh templates do. A custom material's vertex offset can move them, and a sprite turns its quad to face the camera, so both stayed out of the prepass. With ambient occlusion on, which reads the prepass's depth, such an object then had no depth for it. It cast no occlusion, and took the occlusion of the surface behind it. The `ao-custom` image test showed it: a sphere whose custom material swells it in bands left no dark ring on the floor beneath it.

Both now draw their prepass depth with their own vertex shader on both paths, as option (c) does on WebGL2. WebGPU builds the pipeline from the template's build without the `PREPASS` bit, with a fragment shader that writes nothing (`ownPrepass` in `gpu/webgpu/pipelines.ts`). Its prepass bundle binds the frame group and the material's maps' group for these pairs, as the shading does. WebGL2's prepass now binds the material's textures too, since a vertex offset can read them: the `custom-textures` test lifts a plane by a texture's heights. With `NULL3D_SWITCHES=prepass=on`, every custom material and sprite image test matched its references on every tier, on the Mac's GPU: 36 tests. Before the WebGL2 binding, `custom-textures` differed in 1.85% of its pixels there. The custom textures test is among the prepass copies of the image tests, so every image run checks this case.

## Consequences

- `Prepass` in `crates/null3d-render/src/pipelines.rs` names the two ways, and each frame builder picks its own. The WebGL2 builder's prepass replays the opaque pass's calls first, from the same index list, draw records and frame group. It leaves out the draws without a prepass pipeline.
- `buildPermutation` in `packages/engine/src/gpu/webgl2/programs.ts` reads the `PREPASS` bit on a mesh template. The GLSL files no longer hold the shadow depth template's `PREPASS` builds.
- `depthPrepass` now works on both paths. Every preset still leaves it off, until device timings show where it pays.
- The prepass image tests run on all three tiers. The bench pages that end in `-prepass` time it in turns with the pages without it.
- The docs pages `concepts/quality-presets`, `concepts/backends`, `concepts/render-graph`, `concepts/architecture`, `api/engine`, `api/quality` and `guides/performance`, and the develop skill, no longer say that WebGL2 draws without the prepass.
