# D-270: More than one directional light

Status: decided. Built: the core's light gather, the renderer's frame values and the shaders light up to four directional lights. They do so on WebGPU, its compatibility mode and WebGL2, with no new pipeline. Six first-use shader files pass their uncompressed budget by up to 18,744 bytes, which needs the owner's ruling. The iPad and S24 cost runs are pending. Task: M3-K9.

Summary: A frame lights surfaces with up to four directional lights. The first one created casts the shadows. Up to three more light as fill and rim lights, without shadows, from three slots in the frame's values. A fifth directional light gives no light.

## Question

A `KHR_lights_punctual` file may hold several directional lights, as a key, a fill and a rim. three.js lights every one of them. How does the engine light several directional lights, with no new pipeline, and with a cost that follows only the lights a scene holds?

## Rule

- Intent parity with three.js ([D-52](D-52-intent-parity.md)): every directional light that a view sees lights surfaces. A file that three.js lights must look the same here.
- One look on WebGPU, WebGPU's compatibility mode and WebGL2 ([AGENTS.md](../../AGENTS.md#hard-rules), rule 9), with image references on the Mac's GPU and on SwiftShader.
- No new permutation bit, so a light added during play builds no pipeline ([D-156](D-156-template-scoped-permutation-bits.md)).
- The first directional light created keeps the shadows. A fill light casts none, and has no contact shadows.
- No allocation in the frame's work ([AGENTS.md](../../AGENTS.md#hard-rules), rule 1).

## Options

| Option | Per pixel | Frame values | Verdict |
| --- | --- | --- | --- |
| A: three fill slots in the frame's values, each gated by a count | One direct light term for each fill that the count names | Six vectors and a count | Chosen |
| B: directional records in the clustered light list, as point and spot lights use | A per-cluster loop that never culls them | The cluster grid | Rejected. A directional light has no position or range, so every cluster lists it, and a surface reads the grid for light it could take from one value |
| C: a uniform array binding of light records | As A | A binding and a buffer | Rejected. It adds a binding on both paths, and Adreno 830's WebGL2 driver copies no array member of a uniform struct out of its block. The frame's values therefore hold named fields, never arrays |
| D: a shader define for scenes with fill lights | As A, without the loop's branch | As A | Rejected. A new bit doubles the pipelines that can exist, and a light added during play would build them ([hard rule 27](../../AGENTS.md#hard-rules)) |

## Data

`bun run test:images -g "lights-fills|demo-gizmos|demo-css3d-labels"` draws the three tests on WebGPU, its compatibility mode and WebGL2, all nine pass on the Mac's GPU. CI run 40491125964 drew the six SwiftShader references.

`bun run parity -- --scene lights-fills` compares the scene with three.js on the Mac's GPU. WebGPU differs over 0.053% of the pixels, compatibility mode 0.082% and WebGL2 0.049%. The scene's limit is 0.15%, and three.js's two renderers differ by 0.025%.

GPU time per frame for one more directional light. The figures come from `NULL3D_FILL_COST=1 bun run test:browser -- fill-cost.spec.ts` on the MacBook Pro (Apple M5 Max), in Chrome. The window was 1600 x 900, with the render scale at 1. Each run draws one fewer fill and then the next, in turns, and prints the medians of three rounds. The load before each run was 2.7 to 6.8.

| GPU path | 1 light | 2 lights | 3 lights | 4 lights |
| --- | --- | --- | --- | --- |
| WebGPU | -0.188 ms | 0.058 ms | -0.289 ms | 0.063 ms |
| WebGL2 | 0.062 ms | 0.397 ms | 0.241 ms | 0.205 ms |

The WebGPU differences lie within the run's noise. The scene's own GPU time was 0.58 to 0.93 ms a frame, and the medians moved as much between repeats. The WebGL2 differences are 0.06 to 0.40 ms a light, about 0.2 ms in the middle, on a frame of 1.7 to 2.3 ms.

## Look

Three colored directional lights show three lit sides on the floor of shapes and on the spheres. That is what three.js draws. Two demos already created a second directional light: the gizmos gallery and the 3D labels hall. They now show the fill light that their code sets. Both look as their authors meant. A third light in the gizmos demo, a warm rim, separates the pieces from the dark hall.

## Decision

Option A. The core gathers the directional lights that the view sees, in creation order, in `LightTable::gather`. The first is the main light, and it keeps the shadows. The next three become `FrameLights::fills`, and a further one is dropped. The renderer writes their directions and exposed colors into six vectors of the frame's uniform block, with a count in a seventh. The block grows from 992 to 1,104 bytes. The shader library's `fill_light` adds `direct_light` for each slot that the count names, with no shadow lookup. The three slots are blocks of their own, gated by the count. A loop over them compiles to more GLSL than the first-use shader files' uncompressed budget allows. The lit material and lit lines call it. The coat and sheen layer and the translucency's back light treat each fill as the point and spot lights treat theirs.

## Consequences

- `docs/concepts/lighting.md`, `docs/concepts/shadows.md`, `docs/api/lights.md` and the three.js mapping state the limit. The develop skill follows.
- The image tests add `lights-fills`, a floor under three directional lights. It has a twin in the parity list, which compares it with three.js's three `DirectionalLight`s.
- The glTF page test loads a file of three directional lights, and checks that every one reaches the scene.
- The references of `demo-gizmos` and `demo-css3d-labels` are drawn again, in both sets. Their scenes already set a second directional light, which now lights.
- The frame's values grow by 112 bytes per view. The slot that holds them aligns to 256 bytes, so it grows by 256 bytes, from 1,024 to 1,280. A scene with no fill light pays one branch in the lit shaders.
- The fill code grows every lit variant. Six first-use GLSL combination files pass their Brotli and gzip budgets, but pass their uncompressed budget by 858 to 18,744 bytes. The owner's ruling on that budget is pending.
- `bun run test:browser -- fill-cost.spec.ts` with `NULL3D_FILL_COST` set times one more light on each GPU path. The `fills-cost` device plan does the same on a device.
