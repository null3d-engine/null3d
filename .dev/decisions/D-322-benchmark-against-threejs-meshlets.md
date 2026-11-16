# D-322: Benchmark against three.js's meshlet renderer

Status: proposed. Built: the desert scene in `bench/`, its model build, its two pages, its place in `bun run bench:run` and its checks. Measured: the fair rematch, in [the results table](#results-of-the-fair-rematch). Pending: the owner's decision on slots, in a record of its own. Task: none.

Summary: The desert scene times null3D against three.js r187's meshlet renderer on WebGPU, under rules that make both engines do the same work. Both draw one layout of 63,469 objects, about 1.74 billion triangles at full detail, at 1920 x 1080, without the frame cap, in alternating rounds. The run fails when the engines draw different sizes, a fault that drew null3D at four times three.js's pixels in every earlier figure. In the fair rematch null3D's median time between frames is 1.77 against 2.45 ms walking, and 1.55 against 5.96 ms from above. With shadows it is 2.72 against 7.42 ms and 2.03 against 8.33 ms.

## Question

three.js r187 ships a meshlet renderer: WebGPURenderer's `MeshletDrawingPipeline`. It culls each copy's 64-triangle meshlets on the GPU and draws them by vertex pulling. This is the strongest renderer that three.js has for a scene of many detailed copies. How does the repository time null3D against it so that a reader can trust the result?

## Rule

A comparison measures equal work ([D-52](D-52-intent-parity.md)). For this scene, that takes these rules:

1. **The same scene.** Both pages build the layout from one module, `bench/scenes/desert.ts`, from fixed seeds. three.js loads the raw model files, and null3D loads what this checkout's asset tool writes from the same files.
2. **The same views.** The walking view and the aerial view follow one path, timed from each engine's first frame.
3. **The same pixels.** Both draw at 1920 x 1080, at a pixel ratio of 1. Each page reads back the size that its engine drew, and the run fails when the sizes differ.
4. **No frame cap.** The run starts Chrome without its frame cap, so each engine draws as fast as it can. The figure is each engine's median time between frames, with its GPU time beside it.
5. **Production builds.** Both pages come from the production build of the benchmark pages, minified, with null3D's development checks off.
6. **Alternating rounds.** Each round opens three.js's page, then null3D's, each in a fresh window. A slow spell of the computer then falls on both alike.
7. **The same light and surfaces.** One sun, one ambient light, no tone curve, MSAA in both, and the same base colors and roughness.
8. **Named settings.** three.js runs its meshlet pipeline with occlusion culling on and `minScreenRadius` at 0, so it leaves out no copy for its size on the screen. null3D runs at Medium, with GPU occlusion culling on.
9. **Shadows that each engine can draw.** With shadows, null3D draws 3 cascades of 2,048 texels over 150 m. three.js draws one map of 4,096 texels over the same 150 m around the camera. Its cascaded shadow node with the meshlet pipeline drew only the sky.
10. **A quiet computer.** A page counts only when the 1-minute load was under 8 as it opened, and no other process used more than one core while it ran. The runner's own processes, the browser among them, are part of the measure. The null3D page with shadows raises the load from about 5 to between 8 and 10 by itself, so the load after a page does not judge it. A page that fails this rule, or logs any error, runs again in its round ([Benchmarks](../benchmarks.md#what-a-report-measures)).

## The scene

- A dune ground of 2,000,000 triangles, drawn once.
- 3 fluted columns of 518,688 triangles, 3 rock arches of 1,023,360, 4 boulders of 81,920 and 6 pebbles of 20,480. Together they hold about 7 million triangles.
- 420 columns in seven temples and alone, 48 arches, 3,000 boulders in groups of 20, and 60,000 pebbles.
- The walking view loops at head height through the main temple, once in 40 seconds. The aerial view circles 140 m above the middle.

The layout and every mesh match the meshlet study's desert, vertex for vertex. A unit test pins a checksum of the layout.

## What each engine does in a frame

null3D, on WebGPU's indirect path:

- **Per copy.** The culling shader tests each copy against the view and picks its level by its size on the screen. It leaves out a copy too small to see ([D-137](D-137-lod-groups.md)).
- **Per piece.** Each level of 32,768 triangles or more holds 8 to 16 pieces, each with a sphere and a cone of facings. Each copy culls its pieces by the view, by the cone and by the depth pyramid. A mesh whose pieces cut less than a fifth of its triangles draws whole ([D-307](D-307-mesh-pieces.md)).
- **Occlusion.** GPU occlusion culling runs in two phases against a depth pyramid. A check during play keeps the passes only while they hide at least a tenth of what would draw and cost no time ([D-40](D-40-gpu-occlusion.md)).
- **The ground.** Its file holds a tree of cluster patches as well as whole levels ([D-213](D-213-cluster-levels.md)).
- **Instance data.** Each copy's matrix reaches the vertex shader through a vertex buffer (hard rule 7). A copy's level draws as one indexed draw, so the GPU draws a whole piece or none of it.

On the direct path, which the engine's start-up probe may choose, the CPU culls copies and pieces. The run leaves the choice to the probe, as a shipped page does. The report's table names each page's path, and `?direct=off` keeps the indirect one.

three.js r187's meshlet pipeline:

- **Build.** At load, it cuts six whole levels of each geometry into meshlets of exactly 64 triangles, each with a sphere and a normal cone.
- **Per copy.** A compute pass tests each copy against the view, against `minScreenRadius`, and picks its level by its error in pixels.
- **Per meshlet.** A second pass tests each meshlet of the copy's level against the view and its cone. Two-phase occlusion then tests copies and meshlets against the depth of the meshlets that showed last frame. The pipeline turns occlusion off where it hides under 30%.
- **Draw.** One indirect draw for each material and vertex layout reads each kept meshlet's vertices and its copy's matrix from storage buffers. That is vertex pulling.
- **Shadows.** Shadow passes cull by the view alone, with no cone or occlusion test.

## The canvas-size fault

Chrome under Playwright gives a parked window's page a pixel ratio of 1. On the Mac's Retina screen, its device-pixel box for the canvas is still twice as wide and high. The engine's canvas watcher trusted that box. So null3D drew the desert at 3840 x 2160 where the page asked for 1920 x 1080, and three.js drew 1920 x 1080. The level pick reads the render height, so null3D also drew every mesh at levels twice as fine.

Every desert figure that a parked window took from a build without the check carries the fault. That covers the figures in [D-22](D-22-occlusion-presets.md), [D-137](D-137-lod-groups.md) and [D-307](D-307-mesh-pieces.md). Their GPU times and their shares of three.js lean against null3D. The earlier runs recorded no drawn size, so nothing caught it. The watcher now takes the box only where it agrees with the ratio ([Canvas size](../implementation-notes.md#canvas-size)). Each desert result now carries the drawn size, and the run checks it.

A second fault skewed the same figures. Each mesh's bounding sphere lay around the mesh's origin. The asset tool stores positions from a corner of the box, so an arch's sphere had about twice the true radius. Culling and the level pick read that sphere. Each sphere now lies at the center of the mesh's box.

## The known gap: culling below a piece

three.js culls each 64-triangle meshlet of each copy. null3D's finest grain for a copy is a piece of about 4,096 triangles. So when a copy is partly in view, partly facing away or partly hidden, null3D draws more triangles. Hard rule 7 keeps per-instance data in vertex buffers. Vertex pulling would break that rule, and every material would need a build that reads storage ([D-307](D-307-mesh-pieces.md)).

A study of the culling code designed "slots", which keep the rules:

- The planner splits each piece into groups of 64 or 128 triangles, with a sphere and a cone for each. The groups stay inside their piece.
- Each frame, the CPU gives a few slots per mesh to the copies with the largest chosen level.
- For those copies, a GPU pass culls the level's groups by the view, the cone and the late depth pyramid. It then writes the kept triangles' indices into a list and draws each slot once.
- Other copies keep their pieces. WebGL2 and the direct path keep pieces, and the ground keeps its tree.

The study estimates 3 to 4 weeks of work. In the walking view, its model of the culling gives 3.6 million triangles with pieces. With groups, it gives 1.9 million. Slots on the heaviest copies would remove about 1.0 to 1.4 million triangles. That would save about 0.3 to 0.7 ms in the main pass. The group pass would cost 0.1 to 0.2 ms, so the GPU would save about 0.2 to 0.6 ms. These are estimates, not measurements, and the aerial view gains little. Whether the 1.9 million includes hidden copies is not known. If it does, most of the gain needs occlusion tests per group too. In the fair rematch null3D's GPU time is already below its time between frames in every view ([results](#results-of-the-fair-rematch)). So the saving would not shorten the frame. The owner decides whether the gap is worth the work.

## Data

### Results of the fair rematch

Each cell gives the median of 5 rounds, and the lowest and highest round in brackets. Frame is the median time between frames; GPU is the GPU time of a frame. Every page of both engines drew 1920 x 1080. Every null3D page drew on the indirect path at Medium. Its start-up probe gives that path to Chrome on an Apple GPU, which is not WebKit (`not-apple-gpu-in-webkit`). three.js drew with its meshlet pipeline.

| View | Shadows | null3D frame, ms | three.js frame, ms | null3D GPU, ms | three.js GPU, ms | null3D triangles, M | three.js triangles, M | Load as each page opened | Run |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Walk | Off | 1.77 (0.87–1.89) | 2.45 (1.74–2.65) | 1.17 (0.99–1.28) | 3.00 (2.11–3.17) | 3.64 | 1.76 | 3.7 to 7.6 | 20261104-151905-bench |
| Aerial | Off | 1.55 (1.48–1.63) | 5.96 (5.72–6.08) | 1.15 (1.14–1.21) | 6.98 (6.71–7.18) | 3.33 | 18.64 | 4.0 to 6.9 | 20261104-152824-bench |
| Walk | `shadows=3` | 2.72 (2.61–3.04) | 7.42 (7.02–7.56) | 1.87 (1.86–2.02) | 8.33 (8.09–8.53) | 7.94 | 1.79, without its shadow pass | 4.0 to 7.7 | 20261104-153548-bench |
| Aerial | `shadows=3` | 2.03 (1.82–2.22) | 8.33 (7.03–8.78) | 1.32 (1.18–1.36) | 9.38 (8.26–9.89) | 3.37 | 18.65, without its shadow pass | 4.6 to 7.5 | 20261104-154422-bench |

- **null3D's frame takes 27% to 76% less time than three.js's, and its GPU time 61% to 86% less.** null3D's time between frames is above its GPU time in every row. So the CPU side of its frame sets its rate, and a saving in the main pass would not shorten the frame.
- **three.js's triangle counter leaves out its shadow pass.** It reads back the meshlets that its main view drew and counts 64 triangles each. Its shadow pass culls by the view alone and draws far more. The triangle budget study measured that pass at 17.9 M triangles in the walking view, against 1.73 M in the main view. So three.js's frame with shadows draws about 19.7 M triangles, where its counter reads 1.79 M. null3D counts the triangles of every pass, its cascades included.
- **From above, three.js draws more than five times null3D's triangles.** Its level pick measures from each copy's center and keeps every copy, however small. null3D measures from the nearest point of each copy's sphere and hides copies under a pixel ([D-137](D-137-lod-groups.md)). The cascades cover 150 m around a camera 140 m up, so they hold few casters there. null3D's shadows then add 0.04 M triangles and 518 draws.
- **The walking row spreads more than the others.** In its first round both engines drew faster than in the next four: null3D at 0.87 ms and three.js at 1.74 ms. The order of the engines holds in every round.

How the data was produced: `bun run bench:run --scenes desert --runs 5 --switches "<view and shadows of the row>"`, one run per row. The engine was at e61ad018b and the runner at b7dda9a18. Chrome for Testing 156.0.8078.80 ran on the MacBook Pro M5 Max (18 cores, 128 GB), in parked windows, without its frame cap. Each page took 5 s of warm-up and 30 s of timing. Each page passed the quiet rule above: it logged no error, its load as it opened was under 8, and no other process used more than a core during it. In the walking row the Mac's Spotlight indexer used 1.10 and 1.06 cores during two pages, and both ran again. No other page ran twice. During the counted pages, the busiest other process used at most 0.85 of a core. The load after null3D's pages with shadows reached 10.4 and 11.0, from the page's own threads. Each run's record, `bench/results/<run>.json`, keeps every page's load at both ends, its draw path and drawn size, and the three busiest other processes.

### Image quality against full detail

Each engine's frame is compared with its own frame at full detail, in which every copy draws its finest level. A lower error means an image closer to full detail. The figures come from the triangle budget study. Its results are on the branch `research/triangle-budget` at 8cdcd1bc7, in `bench/research/triangle-budget/results/compare.json`.

- The study held 8 frames along the walking lap, at 1920 x 1080 with 4x MSAA, on a build with the canvas check.
- The error is the mean FLIP of the 8 frames. "Visible" is the share of pixels whose FLIP passes 0.1.
- The triangles and GPU times come from the held frames of a development build. They compare the settings with each other, and the timed rows above compare the engines.

| Engine and setting | Triangles, M | GPU, ms | FLIP | Visible |
| --- | --- | --- | --- | --- |
| null3D, Medium | 4.98 | 1.72 | 0.0119 | 2.4% |
| null3D, camera threshold of 2 px | 2.98 | 1.37 | 0.0196 | 6.1% |
| three.js, default | 1.73 | 2.77 | 0.0208 | 7.1% |
| null3D, Medium, 3 cascades | 14.05 | 2.91 | 0.0107 | n/a |
| three.js, one shadow map | 1.73 in view, 17.9 in the shadow pass | 7.68 | 0.0576 | n/a |

null3D's frame is closer to full detail than three.js's, without shadows and with them. With shadows, three.js's coarse casters shadow their own surfaces near the camera, and its error there reaches 0.104. null3D at a camera threshold of 2 px matches three.js's error with fewer GPU milliseconds. So null3D's extra triangles buy a better image, not wasted work.

## Look

This record decides how to measure, not how a frame looks. Both pages draw the same scene with the same light and surfaces. [Image quality against full detail](#image-quality-against-full-detail) compares each engine's frame with its own full detail, and null3D's is the closer. No parity check of the repository compares the two engines' frames, because the three.js page has no held frame.

## Decision

The desert becomes a scene of the repository, under the rules above.

- **A match scene.** `bun run bench:run` takes it in the protocol, with the same production build, parked windows and results format as the other scenes. The image tests, the parity checks, the device plans and CI's comparison of two builds leave it out. It needs model files that a run builds first, and SwiftShader cannot draw it in a test's time.
- **three.js r187 through an alias.** The bench's `three-r187` package is `npm:three@0.187.0`, and only the desert's page imports it. Every other twin stays on r186 with its patch. Moving every twin to r187 would change all their images and the stored parity baselines. The engine, add-on, example and test packages pin r186 as well.
- **Models built at run time.** The run writes the raw files under `target/desert`, from the scene module. Through the Vite plugin's cache, this checkout's asset tool writes null3D's files, so the scene always draws what the current tool writes. Git keeps no model file.

Options rejected:

- **Upgrade every twin to r187.** It changes the parity baselines and the image comparisons of every scene, for one scene's need.
- **Keep the comparison outside the repository.** Its runner loaded the CDN build, recorded no drawn size and checked nothing that would catch the canvas fault. Its scene also stood apart from the repository's checks and asset tool.
- **Commit the model files.** They take 170 MB raw. Committed null3D files would also fall behind the asset tool.
- **CSM for three.js.** Its cascaded shadow node with the meshlet pipeline drew an empty frame, so three.js gets one larger map.

## Consequences

- `bench/scenes/desert.ts` holds the layout, `bench/lib/desert-files.ts` builds and serves the model files, and `bench/pages/null3d/desert.html` and `bench/pages/threejs/desert.html` are the pages.
- `bun run bench:run` takes its pages in alternating rounds. It records the computer's load around each page. `--uncapped` turns Chrome's frame cap off, and the desert always turns it off.
- `bench/tests/desert.spec.ts` opens both pages on a real GPU and checks that both report the same drawn size.
- [Benchmarks](../benchmarks.md#the-desert-against-threejss-meshlet-renderer) says how to run the scene and lists the fairness rules.
- The rematch's figures are in [the results table](#results-of-the-fair-rematch). A decision on slots follows in a record of its own.
