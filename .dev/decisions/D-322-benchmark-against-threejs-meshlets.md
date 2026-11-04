# D-322: Benchmark against three.js's meshlet renderer

Status: proposed. Built: the desert scene in `bench/`, its model build, its two pages, its place in `bun run bench:run` and its checks. Pending: the fair rematch figures, which the owner takes on a quiet computer and enters in [the results table](#results-of-the-fair-rematch). Task: none.

Summary: The desert scene times null3D against three.js r187's meshlet renderer on WebGPU, under rules that make both engines do the same work. Both draw one layout of 63,469 objects, about 1.74 billion triangles at full detail, at 1920 x 1080, without the frame cap, in alternating rounds. The run fails when the engines draw different sizes, a fault that drew null3D at four times three.js's pixels in every earlier figure.

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
10. **A quiet computer.** A figure taken at a 1-minute load of 8 or more is not a figure ([Benchmarks](../benchmarks.md#what-a-report-measures)).

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

The study estimates 3 to 4 weeks of work. In the walking view, its model of the culling gives 3.6 million triangles with pieces. With groups, it gives 1.9 million. Slots on the heaviest copies would remove about 1.0 to 1.4 million triangles. That would save about 0.3 to 0.7 ms in the main pass. The group pass would cost 0.1 to 0.2 ms, so the GPU would save about 0.2 to 0.6 ms. These are estimates, not measurements, and the aerial view gains little. Whether the 1.9 million includes hidden copies is not known. If it does, most of the gain needs occlusion tests per group too. The fair rematch below decides whether the gap is worth the work.

## Data

### Results of the fair rematch

**To fill: no figure here is measured yet.** Each cell takes the median of 5 rounds from `bun run bench:run --scenes desert`, with the switches of its row, on a quiet computer.

| View | Shadows | null3D frame, ms | three.js frame, ms | null3D GPU, ms | three.js GPU, ms | null3D triangles, M | three.js triangles, M | Drawn | Load, lowest to highest |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Walk | Off |  |  |  |  |  |  |  |  |
| Aerial | Off |  |  |  |  |  |  |  |  |
| Walk | `shadows=3` |  |  |  |  |  |  |  |  |
| Aerial | `shadows=3` |  |  |  |  |  |  |  |  |

How the data was produced: the commit, the Chrome version, the computer and what else ran go here with the figures.

## Look

This record decides how to measure, not how a frame looks. Both pages draw the same scene with the same light and surfaces. No parity check compares their frames yet, because the three.js page has no held frame.

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
- When the rematch's figures are in, this record states them, and a decision on slots follows in a record of its own.
