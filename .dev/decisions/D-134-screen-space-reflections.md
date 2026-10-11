# D-134: Screen-space reflections

Status: proposed, 2026-10-11. Date: 2026-10-11. Task: M2-EX22.

Summary: `post.set({ ssr })` adds screen-space reflections to the camera's opaque surfaces: wet streets, puddles, polished floors and metal. Before the opaque pass, a depth pyramid and a trace at half the render size find how far each surface's reflected ray travels before it hits something on the screen. The opaque pass then casts its own reflected ray along its shading normal, for that length, and reads last frame's color where the ray ends. Its roughness picks a blurrier mip level. The reflection takes the place of the environment's reflection by its confidence, which fades at the screen's edges and on misses. So the environment's light takes over with no hard edge. Planar reflections win on their plane, and surfaces that let light through keep the environment. The quality setting `ssrScale` keeps it off on Low, which phones run. Nothing runs or downloads while it is off. The figures come with the build.

## Question

The owner's ruling of 11 October 2026 (D-132) pulls screen-space reflections before 1.0, for Night town's wet streets and puddles, polished floors and metal. Planar reflections ([D-120](D-120-planar-reflections.md)) mirror one flat plane. A wet street with puddles, a lamp post's metal and a curved floor need reflections on any surface. Which technique draws them on WebGPU, compatibility mode and WebGL2, how do they meet planar reflections and transmission, and what does each quality preset pay?

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
| B: stochastic rays by the GGX lobe, with a temporal denoise (Frostbite, AMD's FidelityFX SSSR) | Each pixel traces one random ray inside its roughness's lobe, and frames average the noise | Rejected for now. It needs motion vectors and a temporal pass, which the engine does not have (D-129 is a prototype). Without them, rough surfaces shimmer or smear behind moving objects |
| C: the trace inside every lit shader | Each surface pixel marches its own ray in the opaque pass | Rejected. The cost lands on every pixel of every reflective material at full size, and the march's code lands in every lit build |
| D: a hierarchical depth trace at half size before the opaque pass, then cone sampling in the opaque pass | Below | Chosen |

Option D follows Uludag's cone-traced reflections (GPU Pro 5): a mirror ray through a depth pyramid, and a mip level that the roughness's cone sets in place of random rays. It gives no noise, so it needs no history of its own and no motion vectors. The owner's coordinator approved this on 11 October 2026: the roughness blur with no temporal pass stays until the engine has temporal anti-aliasing. If that ships, this record is revisited, and stochastic rays may come as a step above the blur.

### The passes

While screen-space reflections draw, the camera's view runs these passes between its depth prepass and its opaque pass. The prepass runs then, as ambient occlusion makes it run.

1. **Depth pyramid**, six steps: each writes the nearest depth of each 2 x 2 block of the step before it, from half the render size down to 1/64. The first step reads the prepass's depth, sample 0 of a multisampled one. The levels are six targets of the graph, not one mip chain: WebGL2 draws into a mip level of a texture that a pass samples only through spare copies.
2. **Trace**, at the screen texture's size: it rebuilds the surface's normal from the depth, as ambient occlusion does, and marches the mirror ray through the pyramid. Empty cells let it jump up a level, and a cell with something nearer sends it down. At a hit it checks the thickness, so a ray that passes behind a thin pole does not count. It writes the ray's length, or 0 for a miss.
3. **Opaque pass**: each pixel reads the length. It casts its own reflected ray, along its shading normal, for that length. A normal map's ripples and a smooth mesh's normals thus bend the reflection. The ray's end goes through last frame's camera onto the copy of last frame's opaque color. The pixel samples the copy there, at the level that its roughness's cone covers over the ray's length.

The opaque pass works out the reflection's confidence. A miss gives 0, and the share of the nearby texels that hit softens the edge between hits and misses. The confidence then fades near the screen's edges, for rays that turn toward the camera, near the most distance, and for surfaces rougher than the most roughness.

### Where the result goes

The screen texture of ambient occlusion, at binding 11 of the frame group, holds the occlusion in x and the depth in y. The owner's coordinator ruled on its channels and order on 11 October 2026:

| Channel | Holds | Written by |
| --- | --- | --- |
| x | The occlusion | Ambient occlusion's denoise |
| y | The depth of the scene pixel under the texel | Ambient occlusion's denoise, or the reflections' trace |
| z | The reflected ray's length, 0 for no hit | The reflections' trace |
| w | Contact shadows | Contact shadows (D-135) |

The trace runs first. It writes z, and leaves x, y and w neutral: no occlusion, the pixel's depth, and no contact shadow. The last step, ambient occlusion's denoise or the contact shadows' step, writes x, y and w, and copies z through. When both are off, the trace is the last writer. All the features draw on one grid: the largest of their scales. So the lit shader reads them from one texture, and the frame group needs no new binding. The coordinator gave the last free texture of the opaque pass to lit fog. Both features then draw on one grid: the larger of `aoScale` and `ssrScale`.

The lit shader mixes the reflection into the environment's specular radiance, as planar reflections do, before the split-sum terms weigh it. So the material's Fresnel, metalness and specular values apply. The order is the environment, then the screen-space reflection by its confidence, then a planar reflection by its share. A planar reflection with a share of 1 replaces the other two. Blended surfaces and surfaces that let light through take none, as they take no ambient occlusion: the screen texture describes the opaque surfaces behind them.

### Last frame's color

Transmission copies the camera's opaque color into a target with a whole mip chain after the opaque pass. While screen-space reflections draw, that copy becomes a kept target, made in every frame. The opaque pass reads it as the frame before left it, and the transparent pass reads it after this frame's copy. So the two features share one copy and one binding. A new reprojection matrix in the frame's values takes a point from this frame's camera into last frame's view. The confidence is 0 in the first frame after the reflections start, and after the copy is made again.

On the 8-bit path the copy holds display color, so reflections look a little greyer there, as planar reflections do.

### Quality settings

| Setting | Values | What it changes |
| --- | --- | --- |
| `ssrScale` | 0, 0.25 or 0.5 | The trace's size as a share of the render size. 0 draws none, with the environment's light alone |
| `ssrSteps` | to be set | The most steps of the march per pixel |

Low keeps `ssrScale` at 0: phones keep the environment's light. The other presets' values come from the measurements below.

## Data

To come: GPU and CPU time per frame on WebGPU and WebGL2 per preset, and with the reflections off; the allocation check; the size check; the GPU check; and the image tests.

## Decision

Option D, pending the measurements and the owner's review of the look.

## Consequences

- Code: `crates/null3d-render/src/ssr.rs` (the steps, their blocks, the frame's values and the reprojection), `frame_graph.rs` (the steps between the depth copy and ambient occlusion's search, the shared grid, the color copy as a kept target, the last view), `ao.rs` (the denoise copies z), `frame.rs` and both builders, `crates/null3d-wasm/src/lib.rs` (`setSsr`, `setSsrQuality`, `readsLastFrame`), `ssr.wgsl`, `lib/ssr.wgsl`, `lit.wgsl`, `ao.wgsl` and the frame's values in `globals.wgsl`. `packages/engine/src/scene/post.ts` (`ssr`), the preset table's `ssrScale` and `ssrSteps`, the governor's last step, and hold mode's second frame (`HeldFrom`).
- Hold mode: when the last frame reads the frame before, the sketch thread records it twice and the thread that draws draws both. Temporal anti-aliasing would need the same, so it is a general rule, not one for reflections.
- Docs: `api/post` (Screen-space reflections), `concepts/post-processing`, `porting/threejs-postprocessing`, the quality preset tables, and the mapping entry `ssr`.
- Skills: the develop skill's task table and quick reference, and the port skill's post-processing table.
- Tests: `ssr.rs` and `frame_graph.rs` unit tests, the `ssr-*` image tests and `ssr.spec.ts`, the `wet-street` demo, `--ssr` in `bench:allocation`, and the S1 switch `ssr`.
- Later: stochastic rays with a temporal pass if temporal anti-aliasing ships; motion vectors would also remove the one-frame lag of moving objects' reflections.
