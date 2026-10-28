# D-134: Screen-space reflections

Status: decided by the helper of M2-EX22, for the owner's review. The owner approved the wet street demo's look. Built: `post.set({ ssr })`, the quality settings `ssrScale` and `ssrSteps`, the join that a planar reflection pass makes over them, the `ssr-*` image tests and the wet street demo. Task: M2-EX22.

Summary: `post.set({ ssr })` reflects the screen in opaque surfaces: a half-size trace finds each ray's length, and the opaque pass samples last frame's color, blurred by roughness. The reflection fades into the environment's light at the screen's edges and on misses, and planar reflections win on their plane. Low keeps it off; Medium traces at a quarter size and High at half, for about 0.7 ms and 1.8 ms on the Mac's WebGPU.

## Question

The owner's ruling in [D-132](D-132-showcase-look-and-features.md) puts screen-space reflections before 1.0, for Night town's wet streets and puddles, polished floors and metal. Planar reflections ([D-120](D-120-planar-reflections.md)) mirror one flat plane. A wet street with puddles, a lamp post's metal and a curved floor need reflections on any surface. Which technique draws them on WebGPU, compatibility mode and WebGL2, how do they meet planar reflections and transmission, and what does each quality preset pay?

## Rule

- The intent of three.js's `SSRPass` and the WebGPU renderer's `ssr` node ([D-52](D-52-intent-parity.md)): what a shiny surface sees on the screen shows in it, blurred by its roughness, with the engine's own best technique.
- No hard edge where the screen runs out: the reflection fades into the environment's light.
- Planar reflections win on their plane ([D-120](D-120-planar-reflections.md)). Transmission ([D-122](D-122-transmission.md)) keeps working, and both features share one copy of the opaque color.
- One look on all three GPU paths, with image references in both sets.
- No new binding in the scene shaders' frame group. The lit shader's fragment stage reads 15 of the 16 textures that WebGPU allows by default, and other features may need the last one.
- Nothing costs anything while it is off, beyond one uniform test in the lit shader, and its shaders load on first use.
- No allocation per frame ([AGENTS.md](../../AGENTS.md#hard-rules), hard rule 1).
- Phones get a cheap preset, or the environment's light alone.

## Options

### The technique

| Option | What it does | Verdict |
| --- | --- | --- |
| A: three.js's `SSRPass` | A full-size post pass marches each pixel's ray in fixed steps through the depth, and adds the hit's color over the finished image | Rejected. Fixed steps miss thin objects or cost many reads, and adding over the image counts the environment's reflection twice |
| B: stochastic rays by the GGX lobe, with a temporal denoise (Frostbite, AMD's FidelityFX SSSR) | Each pixel traces one random ray inside its roughness's lobe, and frames average the noise | Rejected. It needs a temporal pass, which the engine does not have: [D-206](D-206-temporal-resolve.md) drops temporal anti-aliasing. Without one, rough surfaces shimmer or smear behind moving objects |
| C: the trace inside every lit shader | Each surface pixel marches its own ray in the opaque pass | Rejected. The cost lands on every pixel of every reflective material at full size, and the march's code lands in every lit build |
| D: a hierarchical depth trace at half size before the opaque pass, then cone sampling in the opaque pass | Below | Chosen |

Option D follows Uludag's cone-traced reflections (GPU Pro 5): a mirror ray through a depth pyramid, and a mip level that the roughness's cone sets in place of random rays. It gives no noise, so it needs no history of its own and no motion vectors. The owner's coordinator approved the roughness blur with no temporal pass, which stays while the engine has no temporal anti-aliasing.

### The passes

While screen-space reflections draw, the camera's view runs these passes between its depth prepass and its opaque pass. The prepass runs then, as ambient occlusion makes it run.

1. **Depth pyramid**, six steps: each writes the nearest depth of each 2 x 2 block of the step before it, from half the render size down to 1/64. The first step reads the prepass's depth, sample 0 of a multisampled one. The levels are six targets of the graph, not one mip chain: WebGL2 draws into a mip level of a texture that a pass samples only through spare copies.
2. **Trace**, at the screen texture's size: it rebuilds the surface's normal from the depth, as ambient occlusion does, and marches the mirror ray through the pyramid. Empty cells let it jump up a level, and a cell with something nearer sends it down. At a hit it checks the thickness, so a ray that passes behind a thin pole does not count. It writes the ray's length, or 0 for a miss. A ray that leaves the screen before it meets anything writes its length to the screen's edge, not a miss. The opaque pass then fades the reflection out by where each pixel's own ray ends. So the reflection fades smoothly where the screen runs out. Written as misses, those rays would show the steps of the half-size grid along the fade, as on the wet street demo's pavements.
3. **Opaque pass**: each pixel reads the length. It casts its own reflected ray, along its shading normal, for that length. A normal map's ripples and a smooth mesh's normals thus bend the reflection. The ray's end goes through last frame's camera onto the copy of last frame's opaque color. The pixel samples the copy there, at the level that its roughness's cone covers over the ray's length.

The opaque pass works out the reflection's confidence. A miss gives 0, and the share of the nearby texels that hit softens the edge between hits and misses. The confidence then fades near the screen's edges, for rays that turn toward the camera, near the most distance, and for surfaces rougher than the most roughness.

### Where the result goes

The screen texture of ambient occlusion, at binding 11 of the frame group, holds the occlusion in x and the depth in y. The owner's coordinator set its channels and order:

| Channel | Holds | Written by |
| --- | --- | --- |
| x | The occlusion | Ambient occlusion's denoise |
| y | The depth of the scene pixel under the texel | Ambient occlusion's denoise, or the reflections' trace |
| z | The reflected ray's length, 0 for no hit | The reflections' trace |
| w | Contact shadows | Contact shadows (D-135) |

The trace runs first. It writes z, and leaves x, y and w neutral: no occlusion, the pixel's depth, and no contact shadow. Ambient occlusion's denoise runs last while ambient occlusion or contact shadows draw. It writes x, y and w, and copies z through. When both are off, the trace is the last writer. All the features draw on one grid, at the largest of their scales. So the lit shader reads them from one texture, and the frame group needs no new binding.

The opaque pass reads the four channels in one pass over the four texels around each pixel (`screen_read` in the shaders' `gtao` library). Each texel's weight falls as its depth differs from the pixel's. The occlusion, depth and contact shadows take the weighted mean. The reflections take the share of the weight whose rays hit, and the mean length over those texels alone, as a miss holds no length.

The lit shader mixes the reflection into the environment's specular radiance, as planar reflections do, before the split-sum terms weigh it. So the material's Fresnel, metalness and specular values apply. The order is the environment, then the screen-space reflection by its confidence, then a planar reflection by its share. A planar reflection with a share of 1 replaces the other two. A surface that a custom material draws takes the screen's reflection too, and its own `surface.reflection` joins by its share. The mix sits outside every `#ifdef CUSTOM` in `lit.wgsl`, so every build mixes it: under the custom-material bit alone, a standard surface would lose the reflection in every build without that bit. Blended surfaces and surfaces that let light through take none, as they take no ambient occlusion: the screen texture describes the opaque surfaces behind them.

### Last frame's color

Transmission copies the camera's opaque color into a target with a whole mip chain after the opaque pass. While screen-space reflections draw, that copy becomes a kept target, made in every frame. The opaque pass reads it as the frame before left it, and the transparent pass reads it after this frame's copy. So the two features share one copy and one binding. A new reprojection matrix in the frame's values takes a point from this frame's camera into last frame's view. The confidence is 0 in the first frame after the reflections start, and after the copy is made again.

Every lit build samples the copy, so on WebGL2 each lit fragment stage uses one more texture unit. WebGL2 gives each stage at least 16 units, and the engine keeps 4 of them spare for later features, 3 in stages that sample the copy. The test of the GLSL programs keeps 3 spare in every stage that samples the copy, found by its binding. The largest lit stage uses 13 of 16: the engine's 7 and a material's 6. So a custom lit material can still sample all 6 of its own textures, and 3 units stay free after them. The lighting concepts page and the surface functions page say so. WebGPU's frame layout already holds the copy's binding for every lit pipeline, so WebGPU's count does not change. Two other options were rejected. A separate build of each lit shader that reads the copy only while reflections are on doubles the lit shader files and their compile time. No existing texture can hold the color: the screen texture's four channels are taken, and the copy has its own size and a chain of mip levels.

On the 8-bit path the copy holds display color, so reflections look a little grayer there, as planar reflections do.

### Quality settings

| Setting | Values | What it changes |
| --- | --- | --- |
| `ssrScale` | 0, 0.25 or 0.5 | The trace's size as a share of the render size. 0 draws none, with the environment's light alone |
| `ssrSteps` | 16, 24, 32, 48 or 64 | The most steps of the march per pixel |

Low keeps `ssrScale` at 0: phones keep the environment's light. Medium traces at 0.25 with 24 steps, High at 0.5 with 48, and Ultra at 0.5 with 64. The data below gives the cost.

## Data

GPU time per frame, S1 with 100,000 boxes over its polished floor, the camera orbiting. The switch `ssr` turns the reflections on, and `ssr=off` keeps the same floor with the reflections off. The governor was off, so each preset kept its settings. MacBook Pro M5 Max, Chrome 155, through `bun run bench:run -- --scenes s1 --pages null3d-webgpu,null3d-webgl2 --runs 3 --seconds 10`, at f0e374a43. The display ran at 120 Hz on every page. Medians of 3 runs:

| Preset (`ssrScale`, `ssrSteps`) | WebGPU GPU ms, off and on | Change | WebGL2 GPU ms, off and on | Change |
| --- | --- | --- | --- | --- |
| Medium (0.25, 24) | 3.25 and 3.91 | +0.66 | 3.69 and 4.93 | +1.24 |
| High (0.5, 48) | 3.22 and 5.03 | +1.81 | 4.84 and 5.12 | +0.28 |
| Ultra (0.5, 64) | 3.18 and 5.08 | +1.90 | 4.84 and 5.09 | +0.25 |

- On WebGPU the trace's pixels set most of the cost: a quarter of the render size costs about a third of half size. 64 steps cost 0.07 ms more than 48.
- On WebGL2 the figures spread more. On High and Ultra the floor without reflections already took 1.15 ms more than on Medium, and the reflections then added only about 0.25 ms. Take WebGL2's split as a rough guide.
- The draw calls went from 3 to 14 on WebGPU, and from 5 to 14 on WebGL2. The new ones are the prepass, the depth copy, the six pyramid levels, the trace, and the color copy with its mip levels.
- The busiest thread's CPU time did not change beyond its noise. It took 1.68 to 2.18 ms per frame with the reflections off, and 1.68 to 2.06 ms with them on.
- Each step started at a load below 8. During four of the six steps the load rose to between 8.9 and 14 by the step's end. GPU time changes little with the CPU's load.

Allocation, `bun run bench:allocation --ssr`: S1 with 100,000 boxes and the reflections on, at `fb6d411ff`. Every place stayed within its budget on both paths. On WebGPU the sketch worker took 225 bytes per frame and the render worker 1,525, and the replay kept within its 1,024 bytes. On WebGL2 the sketch worker took 228 bytes per frame and the render worker 166. The browser returns an encoder object for each of the reflections' passes. So with `--ssr` the check allows 64 bytes for each of 11 passes, as it does for bloom's passes.

GPU check, `bun run bench:gpu-check` against main `7d4b28ac9`: not judged, as the change adds the `ssr` switches to the benchmark pages. S4 at Medium drew 4.21 ms per frame on the base and 4.24 with the change, +0.3%. S6 at Medium moved +0.3%, S4 at High -6.9% and S6 at High -6.4%. Each stays far below the check's line of 25% and 0.3 ms.

Size, `bun run build:check-size` against main `7d4b28ac9`, after Brotli. The ambient occlusion shader set holds the pyramid and the trace, and loads on first use: 5.5 KB on WebGL2 and 5.3 KB on WebGPU, against main's 3.4 KB and 3.2 KB. Every lit shader build reads the trace's length and last frame's color copy, so the builds that need several features grow 3.5 to 13.6%. `Size-Growth:` trailers name those 124 combination files. The WebAssembly files grow 1.0 to 5.9%. The pipelined start grows 1.5 KB on WebGPU, to 143.1 KB, and 1.6 KB on WebGL2, to 139.4 KB. That growth is the engine's own code: `post.set({ ssr })` with its settings, the governor's step, hold mode's second frame, and the shared screen read.

Image tests: the `ssr-*` tests and the `wet-street` demo run on WebGPU, compatibility mode and WebGL2. They have references on the Mac's GPU and on SwiftShader. `ssr.spec.ts` checks that each box's reflection hangs below it on its own side. It also checks that a rough floor blurs it, and that the floor shows no box without the reflections. Its `ssr-planar` case draws a planar reflection pass over half of a custom material's floor. It checks that the red box's reflection shows on the floor's planar half, and the green box's on its screen half. `ssr.spec.ts` passes 7 of 7.

Worktrees that share the build cache's `~/.cache/null3d/cargo-target` can compile another checkout's crate. A page then fails with E1402, or the build with `cannot find value SSR_REDUCE in module template`. A stale core can also fail a picture for a reason outside the feature. `NULL3D_NO_CACHE=1` does not prevent it. A `touch` of the crate's files in that checkout clears it.

### The reflections' code in every lit build

Every lit build carries the reflections' code. So the start and the first-use combination builds that mix several features grow with it. A trim of the error text cannot reach that growth: the bundler already drops the errors' `example` strings, so moving them into a docs-only module saves no byte.

A `REFLECTIONS` permutation bit would move the reflections' lit code into a first-use module, as `TRANSMISSION` moves the builds that let light through. A measured version brought the pipelined WebGPU start to 141.0 KB, and it works. It costs about 900 extra GLSL programs, though, because the bit combines with each other feature bit and each combination needs a build for each of the device's bits. Safari's shaders shard then takes 12.0 minutes of pages against CI's guard of 10. Both cures that the guards allow are worse: a sixth Safari shard waits for GitHub's five macOS machines, and splitting the parts across shards costs about seven minutes more. So the owner raised the start and first-use budgets instead, because half a kilobyte is not worth 900 programs ([D-14](D-14-js-budget.md)). Only the owner raises a budget.

## Decision

Option D: a depth pyramid and a trace at the screen texture's size run before the opaque pass. The opaque pass then samples last frame's color by the roughness's cone. Presets: Low keeps the reflections off, so phones keep the environment's light. Medium traces at a quarter of the render size with 24 steps, which costs about a third of half size on the Mac. High traces at half size with 48 steps, and Ultra with 64, which costs only 0.07 ms more. When frames take too long, the governor lowers `ssrScale` to a quarter in the step after ambient occlusion's.

## Consequences

- Rust: `crates/null3d-render/src/ssr.rs` holds the steps, their blocks, the frame's values and the reprojection. `frame_graph.rs` places the steps between the depth copy and ambient occlusion's search. It also holds the shared grid, the color copy as a kept target and the last view. In `ao.rs` the denoise copies z. `frame.rs` and both builders set the steps. `crates/null3d-wasm/src/lib.rs` adds `setSsr`, `setSsrQuality` and `readsLastFrame`.
- Shaders: `ssr.wgsl`, `lib/ssr.wgsl`, `lit.wgsl`, `ao.wgsl` and the frame's values in `globals.wgsl`.
- TypeScript: `packages/engine/src/scene/post.ts` (`ssr`), the preset table's `ssrScale` and `ssrSteps`, the governor's step after ambient occlusion's, and hold mode's second frame (`HeldFrom`).
- Hold mode: when the last frame reads the frame before, the sketch thread records it twice and the thread that draws draws both. Motion vectors use the same rule ([D-140](D-140-motion-vectors.md)), so it is a general rule, not one for reflections.
- Docs: `api/post` (Screen-space reflections), `concepts/post-processing`, `porting/threejs-postprocessing`, the quality preset tables, and the mapping entry `ssr`.
- Skills: the develop skill's task table and quick reference, and the port skill's post-processing table.
- Tests: `ssr.rs` and `frame_graph.rs` unit tests, the `ssr-*` image tests and `ssr.spec.ts`, the `wet-street` demo, `--ssr` in `bench:allocation`, and the S1 switch `ssr`.
- Later: motion vectors ([D-140](D-140-motion-vectors.md)) can remove the one-frame lag of moving objects' reflections.
