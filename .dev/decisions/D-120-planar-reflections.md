# D-120: Planar reflections

Status: decided by the helper of M2-EX15 on 9 October 2026, for the owner's review. Date: 2026-10-09. Task: M2-EX15.

Summary: `render.addPass({ kind: 'reflection', writes, plane })` draws the camera's view mirrored across a plane into a texture. The plane is the projection's oblique near plane, so nothing below it shows and no shader pays for the clip. The reflection draws the scene's background, and, since 11 October 2026, the point and spot lights that it sees. A custom material reads the texture with `null3d::reflection::reflection_uv`. It sets the surface's new `reflection`, which the engine lights in place of the environment's reflection. The presets draw it at a quarter, half, half and the whole render size, from Low to Ultra. In S1 on the Mac's GPU, it added 0.63 ms per frame at half size and 0.73 ms at full size on WebGPU, and 0.35 and 0.24 ms on WebGL2.

## Question

The showcase scenes need water that reflects its banks, and polished floors ([D-117](D-117-showcase-features-before-1-0.md)). Scene passes ([D-104](D-104-scene-passes.md)) could draw a mirror by hand, but with no clip plane, so whatever lay below the water showed in its reflection. They drew no sky either. How does a sketch declare a reflection, what does the reflection draw, how does a material read it, and what does it cost?

## Rule

- Nothing below the plane shows in the reflection, on all three GPU paths.
- A reflection looks as a mirror does: the sky and the environment's background are in it.
- One way to declare it, in the style of `render.addPass`. A port of three.js's `Reflector` and `Water` maps onto it.
- The reflection draws in every frame by default, with an option for one frame in N. It draws at half the render size by default, and each quality preset has a size.
- No allocation per frame while the camera moves ([AGENTS.md](../../AGENTS.md#hard-rules), hard rule 1).
- The code that a page downloads at its start grows as little as it can. The pipelined start was at 137.8 KB of 140 KB after Brotli on the branch's base.

## Options

### The declaration

| Option | What a sketch writes | Verdict |
| --- | --- | --- |
| A: a kind of pass, `render.addPass({ kind: 'reflection', writes, plane })`, read through `textures.fromPass` | One pass and one material | Chosen |
| B: a mesh or material option, such as `materials.standard({ reflection: { plane } })` | One material | Rejected. Each reflective material would need its own pass, and a standard material would need a new build bit for every map combination. Most of those builds load at the start |
| C: a mirrored camera that a scene pass draws from, with a clip plane option on scene passes | A camera, a pass and code that mirrors the camera each frame | Rejected. Each sketch would repeat the mirror's math, and the pass would lag the camera by a frame |

Option A reuses what scene passes have: `textures.fromPass`, `setPassEnabled`, `removePass`, `dumpGraph` and the graph's errors. It also keeps the rule that a pass never draws an object that shows its own texture, so the water never reflects itself. The pass follows the active camera, its lens and the canvas's shape, so it needs no camera of its own. Its texture follows the render size, a share of it each way, as ambient occlusion's targets do.

### The mirrored view

The view keeps positions relative to the camera, as the camera's view does. Its view matrix is the camera's after the reflection across the plane, with x turned around. The reflection alone reverses every triangle's winding. WebGPU fixes the front face in each pipeline, so every material would need a second pipeline. Turning x around reverses the winding again, and the image comes out mirrored across x. `reflection_uv` turns the screen's x around when it reads the texture. three.js's `Reflector` makes the same image another way. Its virtual camera looks at the mirrored target with the mirrored up vector, which gives the same matrix.

Positions stay relative to the real camera, not to the mirrored one, for three reasons. The sun's shadow cascades take positions relative to the camera that fitted them. So shadows in the reflection fall in the right place. The cascade that a point reads is picked by its distance from that camera, which is how the cascades were fitted. And the view needs no grid cell of its own for the mirrored camera. The shaders' direction toward the camera reads the mirrored camera's place, which the frame's values give as a point. So highlights in the reflection are right.

The sky and cube backgrounds draw a box around the camera. The box now stands around the frame's camera place, which is the origin for every other view, so only the reflection's box moves.

### The clip at the plane

| Option | Cost | Verdict |
| --- | --- | --- |
| A: an oblique near plane, the plane itself, in the projection matrix (Eric Lengyel's method, as three.js's `Reflector` uses) | None in any shader. Depth precision falls a little, which a mirror image does not show | Chosen |
| B: clip distances in the vertex shader | WebGPU's `clip-distances` is an optional feature, and WebGL2 has none | Rejected: no fallback on WebGL2 |
| C: a test and a discard in each fragment shader | A second build of every material that a reflection draws, and the discard turns off early depth tests on many GPUs | Rejected |

The engine draws with reversed depth, so the method changes the depth row of the projection. Depth is w less a multiple of the plane's value. A point on the plane has depth 1, the near plane, and the GPU clips points below the plane. The far plane passes through the far corner of the view that lies farthest along the plane's normal. So it clips nothing that the camera's own far plane keeps. The view's culling frustum comes from the same matrix, so the culling leaves out objects wholly below the plane too. Unit tests in `mirror.rs` check the mirrored camera and the clip on both lenses, against points on both sides of the plane.

The view draws nothing when the camera stands on the plane or below it, or when no part of the mirrored view lies in front of the plane. Its texture then keeps its last image.

### How a material reads it

| Option | Verdict |
| --- | --- |
| A: a library function, `reflection_uv(clip, offset)`, and a new field of the surface, `reflection` | Chosen |
| B: a standard material option that samples the texture | Rejected for 0.2, as option B of the declaration |
| C: the color in the surface's `emissive`, with `envIntensity: 0` | Rejected. The sketch would have to apply the Fresnel term itself, and the environment's diffuse light would go too |

The surface's `reflection` holds the light from the mirror direction in `rgb`, and in `a` its share of the environment's reflection. The engine's lighting mixes it into the radiance of the environment's specular term, before the split-sum terms weigh it. So the material's Fresnel, metalness and specular values apply, with or without an environment. Water at a normal angle reflects about 2% of the light, and at a low angle nearly all of it. The field exists only in custom materials' builds, so the shaders of other materials compute what they computed before. Roughness does not blur the reflection: the texture has one level. A blurred reflection would need a mip chain or a blur pass, as drei's `MeshReflectorMaterial` draws, and that can come later.

`reflection_uv` takes the point's clip position, from `camera.viewProjection` that custom materials read, and an offset in texture coordinates. A tilted normal times a small factor makes the offset, as three.js's `Water` adds `distortionScale` times its normal map's tilt.

### What the reflection draws

| Part | In the reflection | Why |
| --- | --- | --- |
| Objects, the sun and its shadows, the ambient light, the environment's light and fog | Yes | As in a scene pass |
| The background: color, texture, environment, cube map or sky | Yes | A mirror shows the sky. The background pass records in the reflection's opaque pass as in the camera's |
| Point and spot lights | No | See below |
| Ambient occlusion | No | It reads the camera's depth, which the reflection does not have |

Point and spot lights stay out, as in scene passes. The light grid lists each cluster's lights for the camera's view, and a shader finds a point's cluster from the view's own matrix. The reflection's matrix finds the wrong cluster. Using the camera's grid would need the camera's matrix in every view's values and a change to every lit shader. It would still miss the lamps by the banks that only the mirror sees. A grid of its own for each view is D-104's follow-up task, about two days on both GPU paths. So the limit is documented, and development builds warn once. A lamp's own glowing material still shows in the reflection.

Update, 11 October 2026: D-104's follow-up task gave each camera view its own grid, the reflection's included. The reflection's grid takes its planes from the reflection's own matrix, so a shader finds the right cluster. The reflection now draws the lamps that it sees, and the warning is gone ([D-104](D-104-scene-passes.md#point-and-spot-lights-in-scene-passes-8-october-2026)).

The 8-bit path serves compatibility mode with MSAA and WebGL2 without float targets. There the reflection's texture holds tone mapped color, as a scene pass's does ([D-104](D-104-scene-passes.md#display-color-on-the-8-bit-path-owner-8-october-2026)). The material applies the tone curve again, so the reflected sky looks grayer there. The image tests show it in compatibility mode.

### Size and pace

A reflection draws the scene a second time, so its cost follows its pixels and what it sees. The option `scale` takes 1, 0.5 or 0.25 of the render size each way. Without it, the preset's `reflectionScale` sets it, and a change during play makes the texture again on the next frame. The option `every` draws the pass in one frame of N, the first included, through the view's own turns in the core: no sketch code runs per frame. The texture keeps its image between, so the reflection lags a moving camera by up to N - 1 frames. A view with its own size culls once, without occlusion culling, so the reflection does too.

## Data

GPU time per frame, S1 with 100,000 boxes and the water under them (`?reflection=half` or `full`), the camera orbiting so the reflection sees most of the swarm. MacBook Pro M5 Max, Chrome, through `bun run bench:run -- --scenes s1 --pages null3d-webgpu,null3d-webgl2 --runs 3 --seconds 10`, on 9 October 2026, with the Mac's load at about 6. Medians of 3 runs:

| Reflection | WebGPU GPU ms | Change | WebGL2 GPU ms | Change | Draw calls, WebGPU and WebGL2 | Busiest thread CPU ms, WebGPU and WebGL2 |
| --- | --- | --- | --- | --- | --- | --- |
| None | 2.13 | | 3.40 | | 2 and 3 | 1.64 and 1.73 |
| Half size | 2.76 | +0.63 | 3.75 | +0.35 | 5 and 7 | 1.67 and 1.87 |
| Full size | 2.86 | +0.73 | 3.64 | +0.24 | 5 and 7 | 1.91 and 2.09 |

The runs of one page spread by about 0.15 ms, so on WebGL2 half and full size cost the same within the noise. S1's boxes are small, so most of the reflection's cost is the second culling and the vertices of the boxes it sees, which do not shrink with its size. The reflection's pixels cost little on the Mac's GPU. Phones have far less fill rate, so the size matters more there: the cloud phone check below measures it.

A first run of these figures was void: the benchmark page passed only a fixed list of switches to its sketch, and `reflection` was not on it. The draw calls showed it, as they did not change. The harness now passes the switch.

**Cloud phone check, a rough guide.** The rule set beforehand: if half size costs more than 2 ms on the S25, Medium moves to a quarter. On 9 October 2026, at ea5cb60eb, BrowserStack Automate ran it on the Galaxy S25 and the Pixel 9. They ran the reflection image tests and the device runner's `reflection` plan. The plan plays S1 with 100,000 boxes, with no water and with the water's reflection at a quarter and at half size. It runs 3 rounds of 10 measured seconds, in turns within one session. Both phones chose Low. The runs: `20261009-031016-checks` and `20261009-032055-reflection`.

- The 9 reflection image tests passed on both phones, on WebGPU, compatibility mode and WebGL2.
- WebGPU GPU time per frame, the median of the 3 runs' medians:

| Phone | No reflection | A quarter | Half |
| --- | --- | --- | --- |
| Galaxy S25 (Adreno 830), Chrome 152 | 13.14 ms | 21.92 ms (+8.78) | 22.02 ms (+8.88) |
| Pixel 9 (Mali-G715), Chrome 152 | 11.30 ms | 13.96 ms (+2.66) | 14.09 ms (+2.79) |

- On the S25, the reflection's own passes took about 3.4 ms at either size. The second culling took 0.59 ms more and the mirrored scene 2.69 ms. The copy that turns the image upright took 0.07 ms at a quarter and 0.13 ms at half. The rest of the change, 5.4 ms, came in the main pass, which grew from 8.39 to 13.76 ms. That is the water's own material over much of the screen, which every size pays.
- On the Pixel 9, the mirrored scene took about 1.25 ms at a quarter and 2.3 ms at half. Mali's passes overlap, so the passes' times do not add up to the frame's.
- One S25 run at a quarter size measured 15.37 ms, with every pass faster: the GPU's clock changed during it. The median of the three runs leaves it out.
- WebGL2 has no GPU timer on either phone. Every WebGL2 page drew a frame each 33.3 ms, with and without the reflection. That is the S25's 30 Hz display and half the Pixel 9's 60 Hz. The draw calls went from 3 to 7.

So by the rule's test, half size costs more than 2 ms on the S25. It costs 8.9 ms against no reflection, and about 3.4 ms in the reflection's own passes. But a quarter costs within 0.1 ms of half on both phones. In S1, the reflection's cost follows the swarm's 100,000 boxes and the water's shading, not the reflection's pixels. So a quarter would save almost nothing in this scene. A scene with fewer, larger objects would show more of the pixels' share.

**The owner's ruling, 9 October 2026.** Medium keeps the reflection at half size, against the rule set beforehand. A quarter saved only 0.1 ms on both phones: 22.0 against 21.9 ms on the S25, and 14.1 against 14.0 ms on the Pixel 9. On the S25 most of the cost is the water's own shading, about 5.4 ms, not the reflection's passes, about 3.4 ms. A smaller reflection does not touch the shading. So the rule changes: a preset draws the reflection smaller only where a quarter size saves at least 1 ms on a phone.

The water's shading cost on phones is a known item for the Creek scene. Its water covers much of the screen, as S1's does, so the shading, not the reflection, sets its cost there.

Allocation, `bun run bench:allocation --reflection`, S1 with 100,000 boxes and the reflection under them, the camera orbiting, on 9 October 2026 on the Mac (Chrome): every place within its budget on both paths. On WebGPU the sketch worker took 318 bytes per frame and the render worker 708. The replay took 335 bytes, 137 more than without the reflection. The browser returns an encoder object for each of the reflection's three passes, about 46 bytes each: its culling, its scene, and the copy that turns its image upright. The check now allows 64 bytes per pass with `--reflection`, as it allows bloom's and the custom effects' passes. On WebGL2 the sketch worker took 403 bytes per frame and the render worker 150, within their budgets with no allowance.

Size, `bun run build:check-size` against the branch's base after Brotli: the page's start file grew 42 bytes, for the preset row, and the sketch worker's 99 bytes, for the reflection's branch of `render.addPass`. The render worker's shrank 20 bytes. So the pipelined start grew about 0.12 KB, to 137.9 KB. `render.addPass` returns the pass at once, so its code cannot load on first use. The first build grew the start by 0.3 KB. Two changes took most of it back: the option lists that only development checks read moved into those checks, which release builds leave out, and one core call, `addPass`, now adds both kinds of pass. The core's generated glue, which no start counts, grew 2.0 to 2.3% for that call's arguments and `setReflectionScale`. The WebAssembly files grew 0.5%.

GPU check, `bun run bench:gpu-check` against the branch's base on 9 October 2026: not judged, as the branch changes the benchmark pages (the `reflection` switch). In the first run, S4 at High drew 2.57 ms per frame on the base and 2.86 ms on the branch. The lit shaders of materials without a surface function had changed text: a value had become a variable. The branch then kept their text as it was, so every shader that S4 and S6 draw with is the same as the base's, byte for byte. S4 draws no background, so its GPU work is the same. Three runs gave S4 at High +12.8%, +5.8% and +7.5%, and at Medium -6.0%, +0.2% and -2.4%. S6 moved by -2.3% to +3.9%. Each figure stays below the check's line of 25% and 0.3 ms, and the two presets move in opposite ways, so the runs show noise.

Image tests: `reflection-mirror`, `reflection-water` and `reflection-quarter` on WebGPU, compatibility mode and WebGL2, with references on the Mac's GPU and on SwiftShader. `reflections.spec.ts` checks that each box's reflection hangs below it on its own side, and that the magenta box below the plane never shows. With the clip turned off on purpose, that check failed on all three paths.

## Decision

Options A throughout: a reflection pass, an oblique near plane, and the surface's `reflection` read through `reflection_uv`. Presets: Low draws the reflection at a quarter of the render size each way, a sixteenth of its pixels, since phones start on Low and their fill rate is low. Medium and High draw it at half size, as the task asked. Ultra, which only desktops start with, draws it whole: on the Mac it cost 0.1 ms more than half size. After the cloud phone check of 9 October 2026, the owner kept Medium at half size (above): a preset drops the size only where a quarter saves at least 1 ms on a phone.

## Consequences

- Code: `crates/null3d-render/src/mirror.rs` (the plane, the mirrored view and the oblique projection), `view.rs` (mirror views, sizes as a share of the render size, and turns), `frame.rs` (the mirrored view's values, `pace_views`, the background in mirror views), `frame_graph.rs`, both builders, `crates/null3d-wasm/src/lib.rs` (`addPass`, which adds scene and reflection passes in one call, and `setReflectionScale`), `packages/engine/src/scene/render.ts`, the preset table's `reflectionScale`, `lit.wgsl` (the surface's `reflection`), `lib/backdrop.wgsl` (the box around the frame's camera) and `lib/reflection.wgsl`.
- Docs: `api/render` (reflection passes), `shaders/surface-functions` (reflections), `api/materials`, `guides/custom-passes` (reflections and the water recipe), the shader library, the quality preset tables, and the mapping entries `reflector` and `ssr`.
- Skills: the develop skill's recipe 19, quick reference, shaders reference and task table, and the port skill's materials and post-processing notes.
- Tests: `mirror.rs` and `view.rs` unit tests, the reflection image tests and spec, the library test of `reflection_uv`, and `--reflection` in `bench:allocation`.
- Known item: the water's shading costs about 5.4 ms of GPU time per frame on the S25 in S1, more than the reflection's passes. The Creek scene's water must be measured and made cheaper on phones.
