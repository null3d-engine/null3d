# D-43: How WebGL2 draws the depth prepass

Status: decided for correctness, 2026-10-04. The addendum of 2026-10-07 turns the prepass on for WebGL2 at every preset, by the owner's decision. Tasks: M2-R2 and M2-R22.

Summary: With each shading pipeline's own vertex shader and a fragment shader that writes nothing. A depth-only program of its own gave other depths in Chrome on the Mac, though both mark the position invariant, and the shadows test lost 57.8% of its image. The shared vertex shader gives the seven prepass tests' images bit for bit on the Mac. Since 2026-10-07, every preset draws the prepass on WebGL2. On Apple GPUs, ANGLE's sample mask writes make hidden layers shade, and the prepass brings back one shade per pixel.

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

Line batches stay out of the prepass on both paths. Their fragment shader cuts out the round caps and the dashes. The prepass's fragment shader cuts nothing out, so it would write depth where the line draws nothing ([D-46](D-46-wide-lines.md)).

## Consequences

- `Prepass` in `crates/null3d-render/src/pipelines.rs` names the two ways, and each frame builder picks its own. The WebGL2 builder's prepass replays the opaque pass's calls first, from the same index list, draw records and frame group. It leaves out the draws without a prepass pipeline.
- `buildPermutation` in `packages/engine/src/gpu/webgl2/programs.ts` reads the `PREPASS` bit on a mesh template. The GLSL files no longer hold the shadow depth template's `PREPASS` builds.
- `depthPrepass` now works on both paths. Every preset still leaves it off, until device timings show where it pays. Since 7 October 2026, every preset turns it on for WebGL2 ([the addendum](#addendum-2026-10-07-the-prepass-on-for-webgl2-at-every-preset)).
- The prepass image tests run on all three tiers. The bench pages that end in `-prepass` time it in turns with the pages without it.
- The docs pages `concepts/quality-presets`, `concepts/backends`, `concepts/render-graph`, `concepts/architecture`, `api/engine`, `api/quality` and `guides/performance`, and the develop skill, no longer say that WebGL2 draws without the prepass.

## Addendum, 2026-10-07: the prepass on for WebGL2 at every preset

Owner decision, 7 October 2026: every preset draws the depth prepass on WebGL2, on every device. WebGPU and its compatibility mode keep it off on every preset. The `depthPrepass` option of `createEngine` and the `?prepass=` switch still replace the preset's choice on each path.

### Why WebGL2 was slow on Apple GPUs

On the owner's iPad Pro 11-inch, WebGL2 took about three times WebGPU's GPU time per pixel in S4, at every preset. Apple GPUs remove hidden surfaces before they shade (HSR), so each pixel is normally shaded about once. On WebGL2, much of that saving was lost.

- Safari and Chrome on Apple hardware draw WebGL2 through ANGLE's Metal backend. ANGLE writes an all-enabled sample mask in a fragment shader that uses derivatives, even in single-sampled passes. It does this on every Apple GPU (`AddSampleMaskDeclaration` in `TranslatorMSL.cpp`, under `ANGLEWriteHelperSampleMask`, which `DisplayMtl.mm` sets for `supportsAppleGPUFamily(1)`).
- The workaround is deliberate and still needed. Apple GPUs merge neighbouring triangles of a draw, which gives wrong derivatives along their shared edges. Mesa's open driver for these GPUs turns triangle merging off for such shaders (commit `c12153cd`, "asahi: Identify & disable triangle merging for shaders using derivatives"). Metal has no such switch, and the sample mask write is the known indirect fix. On an M5 Max with macOS 26.6.2, native Metal without the mask still picked wrong mip levels within 3 pixels of a shared edge.
- ANGLE counts as derivatives `dFdx`, `dFdy`, `fwidth`, and every texture read at the texture's own level, such as `texture()` (`UsesDerivatives` in `ParseContext.cpp`). The engine's lit fragment shaders use both. They take UV gradients, and position and normal derivatives for normal maps and the highlight softening. Flat shading takes its face normal from derivatives, and the shadow reads use `texture()`.
- With multisampling, ANGLE writes the sample mask in every fragment shader, whatever the shader reads (`ANGLESampleMaskWriteEnabled` is multisampled or the helper mask, in `ProgramPrelude.cpp`). Medium and above draw with MSAA.
- A fragment function that writes the sample mask is a "punch-through" shader, the same class as one that uses `discard`. Mesa's driver gives such shaders the punch-through pass type and no early depth test (`agx_linker.c`), and the hardware implements `discard` with the same instruction. HSR then defers fewer layers before it must shade, so hidden layers are shaded.
- HSR is weakened, not off. A native Metal test on the M5 Max drew full-screen opaque layers back to front. Against one layer, the sample mask cost 1.1x at 16 layers, 2.3x at 32 and 4x at 64. A never-taken `discard` gave the same. Plain opaque shaders stayed at 1.0x to 1.25x, and a shader that writes its own depth cost about one layer per layer. In Chrome on the same Mac, turning ANGLE's `writeHelperSampleMask` off halved the GPU time of the derivative rows of a 32-layer page. How many layers the iPad's GPU defers is not measured.
- Apple documents only `discard` and depth writes as things that reduce HSR. That a sample mask output reduces it too is measured, not documented.
- The prepass shades each pixel only where its depth equals the prepass's, so early depth rejection skips the hidden layers whatever HSR does. That brings back one shade per pixel.

### Figures

S4 on the owner's iPad Pro 11-inch in Safari, the governor off, `?render=main`, 20-second runs with 90-second rests. Two rounds ran in reverse order at Low, and one round at Medium.

| Run | Low, frames per second | Medium, frames per second (frame time) |
| --- | --- | --- |
| WebGPU | 60.0 and 60.0 (GPU 10.18 ms) | 59.3 (GPU 14.73 ms), 6 October |
| WebGPU with the prepass | | 57.1 (GPU 18.60 ms) |
| WebGL2 | 38.5 and 37.5 | 17.3 (57 ms) |
| WebGL2 with the prepass | 60.0 and 60.0 | 37.1 (27 ms) |
| WebGL2 with derivatives taken out | 60.0 | 16.1 (61 ms) |
| WebGL2 with the pixel ratio at 1 | 60.0 and 60.0 | |
| WebGL2 with unlit materials | 60.0 and 60.0 | |
| WebGL2 with half precision | 37.4 and 37.0 | |
| WebGL2 with 8-bit color | 35.7 and 35.6 | |

| Runs | Names |
| --- | --- |
| The Low set | `20261007-030718-bench` to `20261007-040019-bench` |
| Low with derivatives out | `20261007-040356-bench` |
| Medium, and with derivatives out | `20261007-040637-bench`, `20261007-040914-bench` |
| Medium with the prepass, WebGL2 and WebGPU | `20261007-042807-bench`, `20261007-043049-bench` |
| WebGPU at Medium without the prepass | `20261006-010647-bench` |

Half precision and 8-bit color changed nothing, so the cost was not in the shading math or the target format. The derivatives switch was a test build only: it made `dFdx`, `dFdy` and `fwidth` give zero, and read every texture at level 0.

The prepass's cost where the GPU removes hidden surfaces itself came from BrowserStack's Galaxy S25 and Pixel 9 in Chrome. S4 ran with and without it, in two rounds in reverse order (runs `20261007-041042-bench` to `20261007-050909-bench`).

| Device | Frame rate | WebGPU GPU time with the prepass | WebGL2 |
| --- | --- | --- | --- |
| Galaxy S25 | 30 fps in every run, the screen's rate | +0.1 ms at Low (7.34 to 7.44 ms), +0.35 ms at Medium (12.26 to 12.62 ms) | CPU time 0.86 to 0.98 ms either way. No GPU timer |
| Pixel 9 | 59.4 to 60.1 fps in every run | No change above the noise: Low 7.18 against 7.05 ms, Medium 9.08 against 8.95 ms | CPU time 3.13 to 3.49 ms, with no pattern. No GPU timer |

On WebGPU, the prepass costs 0.1 to 0.35 ms on the S25 and nothing measurable on the Pixel 9. It costs about 4 ms at Medium on the iPad. So WebGPU keeps it off. On WebGL2 on Android, both phones held their frame caps with it. The render worker's CPU time did not change. The prepass doubles WebGL2's draw calls, as in S2 above.

### Options

- (a) The prepass on for WebGL2 at every preset, WebGPU unchanged. It fixes Low and Medium on the iPad, and the images stay the same: the prepass image tests above match their images without it. Its costs are the doubled draw calls and a second pass over the vertices.
- (b) Take derivatives out of the WebGL2 shaders. Rejected. It fixes only Low and below, as MSAA writes the sample mask in every shader from Medium up: Medium drew 16.1 fps with it. It also changes the look. The highlight softening measures the normal's change across the pixel, and has no equal without derivatives. Texture reads would need gradients from ray differentials, which match only where the tangent frame is exact.

The change itself ran on the same iPad on 7 October 2026, after a heat check at 60 fps (commit `ad8cc15b6`, runs `20261007-074151-bench` to `20261007-080409-bench`). Each figure is round 1, then round 2 in reverse order.

| S4 on WebGL2 | Frames per second | CPU time per frame |
| --- | --- | --- |
| Low, the prepass by default | 60.0 and 60.0 | 0.94 ms |
| Low with `?prepass=off` | 37.4 and 35.9 | 1.38 ms |
| Medium, the prepass by default | 37.0 and 36.7 | 1.82 ms |
| Medium with `?prepass=off` | 16.8 and 16.8 | 4.31 and 4.35 ms |

### Ties of equal depth

The prepass changes which surface wins where two opaque surfaces have exactly the same depth.

| Path | Opaque pass's depth test | Winner of a tie |
| --- | --- | --- |
| WebGPU and compatibility mode (prepass off) | `greater` in reversed depth (`depthCompare` in `gpu/webgpu/pipelines.ts`) | The surface drawn first |
| WebGL2 without the prepass | `GREATER`, or `LESS` in the standard depth mode (`nearerPasses` in `gpu/webgl2/backend.ts`) | The surface drawn first |
| Either path with the prepass | The prepass draws with the test above, and the opaque pass then tests `equal` and writes no depth (`DrawKey::after_prepass`) | The surface drawn last |
| three.js | `LessEqualDepth` by default | The surface drawn last |

- The prepass changes no picture that the image tests cover. On 7 October 2026, with the prepass on by default, all 230 WebGL2 image tests passed in Chrome on the Mac's GPU. They compared with the existing references. The prepass copies drew with `?prepass=off`, and they passed too.
- So, by default, WebGL2 and WebGPU now disagree on ties. WebGL2 then agrees with three.js. The depth precision test's tie tile shows the flip on every path with `?prepass=on`.
- The draw order behind "first" and "last" is the engine's own: the opaque pass draws in pipeline and mesh order, not in the scene's order. So no page can choose the winner of a tie on either path, before or after this change. The docs tell users to give such surfaces a depth bias.
- Objects that stay out of the prepass (alpha-masked, blended, lines, materials that skip depth writes) draw with the strict test against the prepass's depth. A masked surface at exactly the depth of a prepass surface therefore always loses, where without the prepass the draw order decides.
- No engine feature depends on a tie. Decals and ground markings use the material's `depthBias`, which the prepass keeps (the `depth-bias` image test matches with the prepass). The transparent pass, sprites and lines test against the same nearest depth with or without the prepass. Outlines draw their mask in a pass of their own. Only the depth precision page's tie tile tests a tie, and that page now turns the prepass off.
- Making the paths agree would mean `greater-equal` (`LEQUAL` in the standard mode) in the opaque pass without the prepass, on both paths. Every path would then show the surface drawn last, as three.js does. That changes WebGPU's images wherever surfaces tie, and the depth precision page would draw its nearer surface first.
- Owner decision, 7 October 2026: ties stay as they are. WebGL2 with the prepass shows the surface drawn last, and WebGPU shows the surface drawn first. The depth tests do not change. The draw order is the engine's own, so no page could choose a tie's winner before either. Overlapping surfaces should use a depth bias. The user docs say that an exact tie has no defined winner, and that the winner may differ between GPU paths.

### Consequences of the addendum

- The preset table (`quality/presets.ts`) takes a `webgl2` row of values where WebGL2 differs. Only `depthPrepass` has one. `presetValue`, `presetSettings` and `checkedSettings` take the GPU path, and the docs table prints WebGL2's value beside the others.
- GPU occlusion culling stays WebGPU-only, so the prepass turns nothing off on WebGL2. Ambient occlusion and software occlusion culling work with it as before.
- Two opaque surfaces at exactly the same depth now show the one drawn last on WebGL2 by default. The depth precision page turns the prepass off, as its tie tile counts that case.
- The prepass image copies draw on WebGL2 with `?prepass=off`, and on the WebGPU tiers with `?prepass=on`. Each must match its test's image.

### Open

- S4 at Medium on WebGL2 still takes about 27 ms per frame on the iPad, against WebGPU's 15 ms. The MSAA resolve and the 5 x 5 shadow filter are the likely costs. A task of its own measures and fixes them.
- ANGLE's helper sample mask is not reported to WebKit and ANGLE yet. The report asks for a cheaper fix that keeps HSR, as the workaround itself is correct. WebKit bug 234006, an MSAA slowdown under ANGLE's Metal backend with no known cause, may share the MSAA cause.
