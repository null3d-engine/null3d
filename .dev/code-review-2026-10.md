# Code review, October 2026

On 4 October 2026 eight reviewers read all the code that ships in a game: the engine package and the controls package, at main fe137a6b. Each finding was confirmed by reading the code path end to end, by a probe, or by a test. The same evening the findings were ranked again against the [technique review](technique-review-2026-10.md) and the owner's decisions of that day.

This page keeps the high findings by fix group, and the order of the fixes with their reasons. It also keeps the code issues that the technique review found, and the challenges to recorded decisions. Finding IDs name the reviewer's area and number, such as R7-01.

| Area | Critical | High | Medium | Low |
| --- | --- | --- | --- | --- |
| R1: scene, objects, file loaders | 0 | 3 | 7 | 9 |
| R2: WebGPU and WebGL2 backends, render loop | 0 | 1 | 3 | 7 |
| R3: threads, workers, start-up, API, controls | 0 | 3 | 3 | 8 |
| R4: Rust core (scene, BVH, raycasts, animation) | 0 | 3 | 4 | 13 |
| R5: Rust renderer | 0 | 2 | 7 | 14 |
| R6: GPU layer, WebAssembly boundary, shader build | 0 | 0 | 3 | 8 |
| R7: WGSL shader library | 0 | 1 | 0 | 4 |
| R8: packaging and what a game's build gets | 0 | 2 | 5 | 4 |
| Total | 0 | 15 | 32 | 67 |

## High findings by fix group

One pull request per group, each with tests that fail before the fix.

### E. Shading

- R7-01: color above 65,504, the largest 16-bit float, becomes infinity or NaN on SwiftShader, and probably on Vulkan phones. The tone curves then draw black, and bloom vanishes. Limit color where it is written and read, and add a CI test.

What the technique review adds:

- The roughness floor drops from 0.0525 to 0.045 ([D-53](decisions/D-53-technique-defaults.md) ruling 5). The GGX peak is 1 / (π r⁴), so it rises about 1.85 times. The black highlight then appears at a sun of about 16 instead of 30. The limit must land with the floor change or before it.
- Exposure in the lights (ruling 12) keeps real-unit scenes in range, but not scenes at exposure 1, which most ports have. So the limit stays.
- HDR files prefiltered at load can write infinite texels into an `rgba16float` cube. Limit or compress them on upload, as Filament does.
- Limit bloom's input as URP does (65,472). Never write `f32::MAX` as a WGSL literal: Bevy found that it breaks Chrome.
- R7-02 (HALF builds clamp at 64): the HALF builds also need a roughness floor of 0.089 before the floor drops.
- R6-02 (Mali rejects some custom-material GLSL) joins the Android device checks, with two driver faults. Mali may crash with MSAA unless all uniforms are in bind group 0. Some Adreno drivers treat `int` as medium precision.
- The cascade `while` loop becomes a fixed loop of four passes. It costs nothing, and #277 showed that Adreno faults on loops whose pass count differs between pixels.

Rank: up. It is small, and it blocks a lighting default.

### C. Fixed capacities that fail silently

- R5-01: the per-frame GPU command list has a fixed size. It fills at about 300 animated characters with 4 cascades on WebGPU, or 1,500 meshes on WebGL2 without multi-draw (Firefox). After that the scene never draws again.
- R5-02: WebGPU's skinning pass silently skips characters past fixed GPU limits: 83 of 500 never animate, and they are invisible. A larger crowd asks for a 360 MB buffer, which WebGPU refuses, so none animate. No error.

What the technique review adds:

- R5-01: on WebGPU, the crowd branch (commit 53841331) reserves room per bucket and draw for the camera, prepass, cascade and tile bundles. A Rust test of 5,000 skinned copies checks both builders. Still open: WebGL2's per-frame draws without multi-draw, and R5-03's partial frames. New features add draws per bucket. Examples are one indirect draw per detail level, a second draw for double-sided blended runs, dithered fades and joint rows for wide lines. So the list must grow, or every writer must reserve its bound. Characters that share one pose can share one skinned region and one bucket.
- R5-02 pairs with lean skinning (proposed M2-C8). It skips unchanged poses, and writes normals and tangents in 8 bits: from 28 to 20 bytes per vertex for the Knight. S5's skinned memory is 69 MB, against Low's 256 MiB for all GPU memory. The dispatch takes 65,535 workgroups of 64 threads, about 4.19 million vertices per mesh page per frame: 500 knights fit, 1,000 do not.
- R7-03 joins from the lows: the joint texture is 3,072 texels wide, and WebGL2 promises only 2,048. Baked joint clips for crowds add rows to it.
- The morph branch keeps every delta in one 2,048 x 2,048 RGBA32F texture, 64 MiB. Half floats halve it. The error and the docs state the cap.
- The S24+ has no WebGPU adapter, so a cloud phone shows R5-02 on Android.

Rank: R5-01 up; R5-02 unchanged; R7-03 joins.

### F. Packaging

- R8-01: a threaded page does not start under a normal strict Content Security Policy. Vite inlines the core's 46-byte memory-limits file as a `data:` URL, which the policy blocks, and the error (E1406) blames the host.
- R8-02: shader files are 1.7 to 3.4 MB uncompressed. The budget measures Brotli only, about 24 KB. With gzip (GitHub Pages, default nginx), a page downloads 378 to 496 KB at its start; uncompressed, 3.6 MB. 35 of 164 GLSL sources are exact copies (R6-03), and parsing takes 15 to 20 ms on the Mac against D-13's 2.2 ms.

What the technique review adds:

- R8-02 and R6-03 pair with per-feature shader files that load on first use (M2-R11, with its own record D-56). Every feature grows every page's start file today. GPU occlusion culling adds 8.7 to 8.9%, although it is off by default. AO adds 9 to 15%, wide lines 2.0 to 2.9 KB, and sprites and outlines 0.7 KB each. The start is projected at 115 to 120 KB of 140 KB.
- The add-on rule needs per-feature shader files and a start under a strict policy (R8-01, R8-05). It also needs a clear rule for plain bundlers (R8-07) and notices for third-party code (R8-03). R8-06 conflicted with "works with CDNs": a dedicated worker's script must have the page's origin. The owner settled it with one shared `blob:` bootstrap ([D-54](decisions/D-54-addon-modules.md)), which the core's own workers use too.
- R8-03: Draco's decoder and each add-on's code join the notices file.
- R8-04 is settled: the room is made in the browser, so `room.ktx2` leaves the package.

Rank: R8-02 and R6-03 up; they gate every new feature and the add-ons.

### B. Failures that freeze or leak instead of reporting

- R3-01, R3-02: when the frame loop or a job worker breaks after start, the engine freezes and the page's failure handler is never called. With the sketch on the main thread, the tab hangs.
- R3-03: a new engine on the same canvas after `destroy()` fails (InvalidStateError), and the 18 workers of the first try are never stopped. React StrictMode does this on every mount.
- R2-01: on WebGL2, a GPU reset noticed mid-frame ends the engine with E1404 instead of recovering.
- R3-04 (found by reading only): an un-awaited warm-up can record a frame while the main loop records one. The render worker can then replay a list while it is overwritten.

What the technique review adds:

- R2-04 (medium: WebGPU validation and out-of-memory errors are never seen) joins this group. R5-02's crowd asks for a 360 MB buffer, and R5-05's texture arrays briefly double. Both fail as WebGPU errors that nothing reports, so the canvas goes black with no code.
- The room is made over several frames at first use. A GPU loss in that time must restart it through R2-01's recovery.
- Add-ons run inside the engine's job workers, so their failures reach the page through the paths that R3-01 and R3-02 add.

Rank: unchanged; R2-04 joins.

### D. Queries

- R4-01: a zero-length or NaN ray crashes the engine, and so does an origin past the float range or an infinite overlap box. The BVH walk follows an empty child slot. The checks run in development builds only.
- R4-03: a static object moved in `onLateUpdate` right after a query in the same frame stays at its old place in the query trees for good.

What the technique review adds: raycasts against sprite, point and line rows (proposed M2-D7) use the same walks. So R4-01's mask of empty slots covers them. R4-07 (characters tested in their bind pose) stays: no engine read does better than D-30's planned capsules per bone.

Rank: unchanged.

### A. Untrusted files

- R1-02: a glTF accessor type such as "constructor" defeats the size checks. A 450-byte file hangs the glTF worker for about 11 minutes per accessor.
- R1-03: no limit on a file's total allocation. A 1.8 KB file returned 600 MB, and strips can build a 1 GB index array. With R1-04, the parent-loop check is quadratic.
- R4-02: a 1 KB clip with keys at 0 s and 34,000 s resamples for 11 s and holds hundreds of MB.
- R1-01: valid sparse accessors with 2 or more values are refused, so real Blender exports with morph targets fail to load.

What the technique review adds:

- R1-01 matters more: Blender writes morph targets as sparse accessors by default, and morph targets make such files useful. Fix it with M2-C5 or before it.
- R4-02 pairs with the clip step in the asset tool (proposed M2-B7), whose output loads with a copy. Files from other tools still resample, so the bound on frames times tracks stays.
- New decoders join the same per-file limits. They are Draco (59 KB after Brotli, loaded on demand), WebP and AVIF images, and UASTC HDR files, which the Basis transcoder already reads.
- R1-10 (the KTX2 size check) pairs with two transcode issues below (issues 5 and 6).
- R4-06 (the stored-tree reader accepts a damaged slot) stays. The owner ruled on 4 October 2026 that S6's buildings ship with no stored trees. The engine builds each tree at the first raycast. The tool keeps its default: a stored tree for each mesh part of 20,000 triangles or more. Files from the tool still carry trees for large meshes, so the reader's checks matter.

Rank: R1-01 up; the rest unchanged.

## The order of the fixes

1. E, shading: the HDR limit and its CI test, and Mali array lowering for custom materials. Also the HALF floor and the fixed cascade loop (R7-01, R6-02, R7-02). First, because it is small and must land before the roughness floor drops. Pair it with the exposure task (proposed M2-E6).
2. C, capacities: a draw list that grows or is sized, skinning split by GPU limits, and a joint texture within 2,048 (R5-01, R5-02, R7-03). Also R5-03's all-or-nothing frame. Build on the crowd branch's fix. S5 is a gate scene, and new features add draws per bucket.
3. F, packaging: CSP-safe core loading, and the shader size (duplicates, gzip and uncompressed columns, D-13's figures). Also licence notices, the CSP and hosting docs, and the build without the Vite plugin (R8-01 to R8-08, R6-03). Do R8-01 and R8-04 now: both are small. Per-feature shader files follow as M2-R11 (D-56), before any new feature that adds shader code.
4. B, failure handling: failure reporting, restart and GPU-loss recovery (R3-01 to R3-07, R2-01 to R2-07, R5-03, R6-01), with R2-04.
5. D, queries: checks in every build, the BVH's empty-slot mask, stale query trees (R4-01, R4-03, R4-07, the ray batch length). Small, and a zero-length ray in game code aborts the engine today.
6. A, untrusted files: the file loader's limits and hardening (R1-01 to R1-04, R4-02, R4-06, R5-04, the KTX2 size check). R1-01 goes earlier, with M2-C5 or before it.

The low findings go with the group whose files they touch. The issues below go with the task in their row.

## Notable medium findings

- R8-03: no licence notice reaches a game's build (Basis with its NOTICE, Zstandard, meshopt, the three.js lighting table). R8-05, R8-06: the docs never state the policy the engine needs, and the hosting guide wrongly allows workers from another origin.
- R6-02: custom materials can still produce GLSL that Mali rejects (array forms). The precision check runs only on the engine's own shaders.
- R6-01: a multi-object reserve can grow WebAssembly memory without refreshing views. The single-threaded build then loses writes and throws.
- R5-03: a frame that fails part way is still drawn, with half-applied state. Textures can lose their mips for good.
- R2-02, R2-04: a WebGL2 context loss during the shader download is never restored. WebGPU never listens for GPU errors, so out-of-memory leaves a black canvas.
- R1: a failed glTF load leaks textures, materials and the skeleton. Models can never be freed. Each destroyed sprite batch leaks a material, against a cap of 1,024.
- R4-04 to R4-07: an additive play stops base clips on its layer. Step tracks hold the wrong key at a clip's end. The stored-tree reader accepts a damaged slot. Raycasts test characters in their rest pose, though the docs say otherwise.
- R5-05 to R5-09: texture memory briefly doubles past the iPad's crash point. Narrow views get lit holes in shadows. Spot and point shadows go stale after a layer change, or on a still animated character. One light's shadow toggle rebuilds the whole pass plan.
- R3-05, R3-06: a page-thread sketch's leftovers reach the next engine after `destroy()`; the preset check counts hidden-tab time and stores a lower preset for a week.

Pairings with M2 work:

- R5-06 (lit holes for cameras of 45 degrees or narrower) shares its cause with the cascade blend's fit. Each cascade's sphere fits only its slice along the view. Fix both in M2-R1, with a test that picks each point's cascade as the shader does.
- R5-07, R5-08 and R5-09 are fixed with the tile changes of M2-R9: per-face marks, a margin of the filter's reach, and a cap on redraws per frame ([D-61](decisions/D-61-shadow-tile-redraws.md)).
- R5-05 pairs with M2-A4's texture budget, which drops over-quality textures first, in Godot's order.
- R4-04 pairs with the animator changes (proposed M2-C9).

## Code issues from the technique review

Each was read on main fe137a6b.

| # | Issue | Where | Severity | With |
| --- | --- | --- | --- | --- |
| 1 | The culling shader adds 1 to its bucket's single counter for every surviving object, and once more for each further mesh part. Instance batches put thousands of rows on one address. Qualcomm, Arm and Apple advise adding per workgroup first | `crates/null3d-shaders/wgsl/cull.wgsl` | Medium (speed) | Proposed M2-I5, after G2 |
| 2 | Below render scale 1 the final pass runs 4 tone curves, 4 sRGB encodes and 4 dither hashes per canvas pixel, and skips FXAA, so Low at scale 0.5 has no anti-aliasing | `crates/null3d-shaders/wgsl/final.wgsl` | Medium (speed, image) | Proposed M2-F10, after P1 |
| 3 | WebGPU skinning skins every seen object every frame with no test that its pose changed, and copies UVs and colors into each object's region | `crates/null3d-render/src/gpu_driven/skin.rs`; `wgsl/skin.wgsl` | Medium (speed, memory) | Proposed M2-C8, with group C |
| 4 | Spot and point shadow tiles keep a margin of 1 texel, but the 5x5 filter reads 3 texels past the point. A moved caster marks all six faces of a point light dirty | `crates/null3d-render/src/shadow_tiles.rs` | Low | Fixed in M2-R9 |
| 5 | On desktop Linux, Mesa offers ETC2 and ASTC on GPUs that lack them and decodes them in software on the main thread. The transcoder picks ETC2 first for ETC1S data, so such a page stalls. three.js has a guard | `packages/engine/src/scene/ktx2.ts` | Medium | Proposed M2-A7 |
| 6 | KTX2 textures whose sizes are not a multiple of 4 transcode to RGBA8, 4 to 8 times the memory, and the tool does not enforce whole blocks | `packages/engine/src/scene/ktx2.ts` | Low | M2-B1 follow-up, M2-A4 |
| 7 | `assets optimize --lod` simplifies positions only, with no weld, `Prune` or `Regularize`, skips quantized inputs, and bakes a 1,080-pixel screen into the file. 122 of the 213 Kenney models get no levels | `packages/cli/src/assets/geometry.js` | Medium | Proposed M2-B8, after A3 |
| 8 | A double-sided blended material draws in one pass, in triangle order; three.js draws back faces, then front faces. No alpha to coverage and no alpha hash | `crates/null3d-render/src/frame.rs` | Medium (port look) | Proposed M2-J6, after G3 |
| 9 | The animator has no start time and no per-clip weight. S5 works around it with two layers, which matches its three.js twin only for two clips whose weights sum to 1 | `packages/engine/src/scene/animation.ts` | Medium (API gap) | Proposed M2-C9 |
| 10 | The D-20 timing page writes 24 bytes per skinned vertex; the engine writes 28 to 48, so D-20's figures understate the compute path | `tests/pages/lib/skinning-wgsl.ts` | Low (test) | D-20, A1 |
| 11 | The dither runs before the color table and the vignette, so the vignette shrinks the noise in the corners, where bands show first | `crates/null3d-shaders/wgsl/final.wgsl`; `lib/tonemap.wgsl` | Low | Proposed M2-F9 |
| 12 | The HALF builds have no roughness floor of their own. At a floor of 0.045, roughness⁴ is below the smallest normal 16-bit float | `crates/null3d-shaders/wgsl/lib/half.wgsl` | Low (latent until the floor changes) | Group E |
| 13 | The render graph merges passes without checking the color attachment limits: 8 on core WebGPU, 4 in compatibility mode and 4 as WebGL2's minimum, and 32 bytes per sample | `crates/null3d-render/src/graph/compile.rs` | Low (latent until custom passes) | M2-F6 |
| 14 | A full cell table is never reported | `crates/null3d-core/src/cells.rs` (`is_full`) | Low | M2-H1 follow-up |
| 15 | Docs: the fog mapping note says three.js mixes fog after encoding, which holds only for `WebGLRenderer`'s 8-bit default; `docs/concepts/lod.md` still says "Planned for null3D 0.2" | `docs/porting/threejs-mapping.md`; `docs/concepts/lod.md` | Low | M2-M4 |

One device risk, not a bug: three.js turns off hardware shadow comparison on every Android browser on WebGPU. The reason is wrong shadow results on Adreno phones, with no error ([three.js PR #32548](https://github.com/mrdoob/three.js/pull/32548)). From Chrome 149, Dawn works around it on Qualcomm GPUs for 2D and 2D-array depth textures, which are the only depth textures null3D's shadows use (`lib/shadows.wgsl`). [D-53](decisions/D-53-technique-defaults.md) ruling 28 decides the test and the guard.

## Challenges to recorded decisions

From the code review:

- [D-13](decisions/D-13-shader-variants.md) (shader variants): its size and parse figures are 8 times out of date (R6-03, R8-02). Per-feature shader files are needed for every new feature and for add-ons.
- [D-19](decisions/D-19-environment-maps.md) (the room's file): it broke the owner's rule that built-in assets are made at run time (R1, R8-04). Settled: the room is made in the browser with the asset tool's filter. #283 rewrites D-19.
- [D-07](decisions/D-07-job-workers.md): no upper limit on job workers (R3).
- [D-28](decisions/D-28-animator.md): freed joint runs should merge (R4). The technique review adds start time, clip weight and inertial transitions.

From the technique review, settled in [D-53](decisions/D-53-technique-defaults.md):

- [D-21](decisions/D-21-effect-chain.md): the mip chain replaces `UnrealBloomPass`'s steps after P2.
- D-36 (on #280): a crisp outline. Rework #280 before it merges: keep its mask pass, replace the edge step and the blurs. `OutlinePass`'s glow and pulse move to `three-compat`.
- [D-33](decisions/D-33-color-grading.md): the vignette in HDR before the tone curve; three.js's formula leaves the core.
- AgX as the default tone curve; ACES, Reinhard and Cineon move to `three-compat`.
- D-22 and D-40 (on the GPU occlusion branch): GPU occlusion culling saves 37% on a quiet Mac. On for High and Ultra on desktops only if a second quiet Mac run saves time. A run with another program loading the GPU must lose no more than 5%. Off on Android until G1 passes on the GPUs that Bevy and Unity block.
- [D-20](decisions/D-20-webgpu-skinning.md): decide in S5 as well as on the timing page, and on an Android WebGPU phone. Mali and Adreno repeat a vertex shader's position work in some cases, which favors compute skinning on Android.
- [D-09](decisions/D-09-half-precision.md): low priority. The iPad's A12X already runs 16-bit floats at twice the rate, and saved only 1.5%. A re-measure runs on the Pixel 9, with the half math written as vectors.
- Physics as a non-goal for 1.0: a Rapier add-on in M3.
- M2-F2 (AO): no separate depth pass for compatibility mode, since the specification allows M2-F2's read of depth as `unfilterable-float`. Phones get AO only where S3 shows it fits.
