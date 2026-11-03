# D-306: Meshes made in code plan their levels on the job workers

Status: decided and built: the shared planner, `mesh.buildLevels`, the automatic levels at a mesh's first draw with the `levels` option, and their guards, on WebGPU and WebGL2. Pending: the owner's review of the thresholds, and the adoption by the add-ons and demos that set levels by hand today. Task: none.

Summary: The asset tool's level planner moved into `packages/engine/levels/planner.js`, which the tool runs in Node and the engine runs on a job worker with the same build of meshoptimizer's simplifier, so one mesh gets one set of levels, index for index. A mesh made in code plans its levels at its first draw when it holds 4,096 triangles or more, or 256 or more in copies of 65,536 triangles together; `levels: false` opts out. A million triangles take about 6 s of one job worker's CPU, and no frame is late while the plan runs.

## Question

Only meshes from files that the asset tool optimized get measured, deep levels. A mesh from `geometry.fromArrays` or a generator gets levels only from `mesh.setLevels` with meshes and switch distances made by hand: the Island showcase builds 46 meshes from arrays and sets levels on 5. How does a mesh made in code get the levels that the same mesh gets in a file, without frame work on the main thread or the sketch thread, and which meshes should plan them without being asked?

## Rule

- One planner: the tool and the engine give the same levels for the same arrays, and the tool's output stays byte for byte as it was.
- The plan runs on the job workers, never in a frame (principle 6), and the planner downloads only with the first mesh that plans (principle 8).
- The levels name the mesh's own vertices: the base mesh keeps its vertex and triangle order, which raycasts, `updateVertices` and the generators' match with three.js depend on.
- Both GPU paths draw the levels (principle 9).
- Hand-set levels win. A mesh whose shape poses or moves, or whose shape a shader gives it, takes no planned levels.

## Options

### Where the shared planner lives

| Option | Node in the repository | The published tool | The engine |
| --- | --- | --- | --- |
| (a) A TypeScript module in the engine's `src/`, exported for the tool | The Vite plugin loads the tool in Node, which resolves the export to `lib/`, unbuilt in the repository | Works | Works |
| (b) A copy in the tool, kept equal by a test | Works | Works | Two files to change at once |
| (c) A plain JavaScript module beside the engine's `src/`, with a declaration file, exported as `@null3d/engine/levels-planner` (chosen) | Works: the export names the file itself | Works: the tool depends on the engine | The engine's TypeScript imports it with its types, as it imports `vendor/` |

### Which meshes plan without being asked

The levels cost buckets: each level adds a draw bucket for each pipeline key of each mesh. Measured levels switch at once and add no fade bucket. A mesh drawn a few times with a few thousand triangles saves the GPU little. A batch of small meshes saves much: the survey of meshes made in code found 640 pebbles of 960 triangles in the contact shadows demo, 614,400 triangles in all.

| Rule | Plans | Leaves out |
| --- | --- | --- |
| (a) Every mesh of 64 triangles or more, as the tool does | Every shape a demo makes | Nothing: a sphere of 960 triangles drawn once pays buckets for no gain |
| (b) 4,096 triangles or more, when the mesh is made | Single large meshes | Batches of small meshes; and it plans meshes that never draw, or that a material with a displacement map then draws |
| (c) 4,096 triangles or more, or 256 or more whose copies hold 65,536 triangles, at the mesh's first draw (chosen) | Single large meshes and heavy batches | Small meshes drawn a few times, meshes that no object draws, and meshes that a material that moves vertices draws first |

## Data

All runs were on the owner's MacBook Pro, with other agents' builds and tests running beside them: the load average stood at 48 to 60. So the planner's cost is given in CPU time, which the load does not stretch, and wall times are an upper bound.

### One planner

| Check | Result | Where |
| --- | --- | --- |
| The tool's output before and after the move, and after the faster weld: 26 models (the KayKit Knight, Creek's trees and plants, a mech, 19 Kenney buildings and the tool's three test models), with `--lod --stages`, and with `--lod --clusters --simplify 0.5` | 137 files, equal byte for byte | A script that hashes every output file |
| The planner through the npm package against the engine's task with the vendored modules, in Bun: a bumpy grid of 4,608 triangles, 144 separate cards, and a wall of 576 panels | The same indices, errors and moved positions | `packages/engine/src/scene/levels-task.test.ts` |
| A bumpy grid of 32,768 triangles: Node's planner against the task on a job worker in Chrome 156 with the Mac's GPU, on WebGPU and WebGL2, pipelined and single-threaded | The same triangles of every level (a hash of each) and the same errors | `tests/image/runtime-levels.spec.ts` |
| The vendored `meshopt_simplifier.wasm` and `meshopt_encoder.wasm` against meshoptimizer 1.3.0's packed modules | Equal | The same unit test |

### What the levels save

The bumpy grid of 32,768 triangles, scaled to 20 m, drawn alone at the Low preset in Chrome 156 with the Mac's GPU. The figures are the medians of a second of frames.

| Path | Triangles drawn, camera 6 m away | Camera 400 m away |
| --- | --- | --- |
| WebGPU | 32,769 | 1,025 |
| WebGL2, whose depth prepass counts each triangle again | 65,537 | 2,049 |

### A building kit of separate quads

The Island's house walls are separate quads and boxes, each piece with vertices of its own: frames, shutters, sills and doors. The planner ran on the first six house kinds' walls, with normals as `computeNormals` makes them, without cards. Locked borders keep every piece's outline, so the levels drop whole pieces, which pruning takes, and each level's error is the size of the pieces that it drops:

| House kind | Triangles | Levels: triangles at error, in meters |
| --- | --- | --- |
| 0 | 1,776 | 814 at 0.50, 406 at 0.75, 70 at 1.13, 32 at 1.70 |
| 1 | 4,218 | 1,662 at 0.52, 662 at 0.78, 124 at 1.17, 42 at 3.31 |
| 2 | 3,337 | 1,161 at 0.67, 319 at 1.01, 159 at 1.93, 74 at 2.89, 30 at 6.19 |
| 3 | 3,050 | 1,450 at 0.47, 246 at 0.90, 122 at 3.00, 20 at 6.48 |
| 4 | 2,589 | 1,253 at 0.50, 625 at 0.88, 217 at 1.33, 63 at 1.99 |
| 5 | 2,036 | 592 at 0.72, 136 at 1.08, 62 at 1.72 |

An error of half a meter switches in about 580 m out on a 1,080-pixel screen at a 50-degree lens, where the scene's hand-made far house, at an error of 0.35 m, switches in at about 400 m. No level opens a hole that a pixel shows. With cards asked for, kind 5's walls read as cards and plan no level, which is why the card step runs only when asked. The scene keeps its hand-made far houses, which keep the shadow that a near house casts, so these walls take no planned levels there.

### What a plan costs

CPU time of the task's `run` on one thread in Bun 1.4.3, for bumpy grids with normals and texture coordinates, with the planner that halves to the floor in at most fifteen levels and the faster weld (below):

| Triangles | CPU time | Levels | Level indices against the mesh's |
| --- | --- | --- | --- |
| 2,048 | 49 ms | 1,024 > 512 > 256 > 130 | 0.94 |
| 4,232 | 35 ms | 2,116 > 1,058 > 528 > 264 > 192 | 0.98 |
| 32,768 | 127 ms | 16,384 > 8,192 > 4,096 > 2,048 > 1,024 > 532 | 0.98 |
| 131,072 | 677 ms | 65,536 > ... > 2,048 > 1,048 | 0.99 |
| 524,288 | 2,799 ms | 262,144 > ... > 4,096 > 2,070 | 1.00 |
| 1,048,352 | 6,172 ms | 524,176 > ... > 4,094 > 2,924 | 1.00 |

The grids keep a locked open border, as in the tool, so the last level keeps about a triangle per border edge. The weld first keyed each vertex by the text of its values. It now hashes their bits and compares the values: the same welds, and the tool's output stays equal. In Chrome the plans of the 64,800, 131,072 and 524,288-triangle grids took 0.37 s, 0.66 s and 2.7 s from the mesh's first draw to its levels, with the load above, before the planner went to fifteen levels; the deeper levels add about a tenth.

The levels' indices take about as much memory again as the mesh's own (0.94 to 1.00 of them). A mesh split into parts, past 65,535 vertices, also copies the vertices of each level: about as many again as the mesh's. On the job worker, meshoptimizer's heaps grow with the largest mesh and never shrink, so a worker lets them go after a plan that took them past 32 MiB.

The planner's files load with the first plan: `js/sketch-worker-mesh-levels.js` 0.4 KB, `js/job-worker-levels.js` 3.0 KB, `meshopt_simplifier.wasm` 13.5 KB and `meshopt_encoder.wasm` 5.7 KB after Brotli.

### Frames while a mesh plans

`tests/pages/levels-frames.ts` runs `tests/pages/sketches/levels-large-sketch.ts`, which makes a bumpy grid two seconds in, and measures the frame interval in one-second windows. Chrome 156, the Mac's GPU, pipelined, Low preset; the 99th percentile of each window. Without levels the grid has `levels: false`.

| Grid | The window of the frame that makes and draws the mesh: without levels, with them | Windows while the plan runs | The window that takes the levels |
| --- | --- | --- | --- |
| 64,800 triangles, WebGPU | not run, 23.7 ms | 16.7 ms | 16.7 ms |
| 131,072 triangles, WebGPU | not run, 23.7 ms | 16.7 ms | 16.7 ms |
| 524,288 triangles, WebGPU | 38.7 ms, 46 ms | 16.7 ms | 23.7 ms |
| 1,048,352 triangles, WebGPU | 64.5 ms, 100 ms | 16.7 ms | 64.7 ms |
| 1,048,352 triangles, WebGL2 | 55 ms, 91.7 ms | 16.7 ms | 38.2 ms |

No frame is late while a plan runs. The frame that first draws a large mesh reads its vertices from the core for the plan. The sketch worker's busiest frame shows it: 35 ms against 26 ms without levels for 524,288 triangles, and 72 ms against 45 ms for a million on WebGL2. Making such a mesh costs those 26 ms and 45 ms anyway. The frame that takes the levels of a split mesh of a million triangles copies their vertices and uploads them; a mesh under 65,536 vertices shares them, and no window was late when such a mesh took its levels.

How the data was produced: `bun test` of the two unit tests named above; a scratch Bun test that times the task's `run` with `process.cpuUsage`; `tests/image/runtime-levels.spec.ts`; and a scratch Playwright test that opened `levels-frames.html?sketch=...` with the grid's sizes and `levels=off`, on commit `930b01bb` with this record's changes.

## Look

Planned levels switch where their measured error covers under the `lodThreshold` setting's pixels, as a file's measured levels do, so a mesh looks as it did. Option (a) of the planner's place and option (b) of the copy look the same; the rules of which meshes plan differ only in where the GPU's time goes.

## Decision

The planner is option (c): `packages/engine/levels/planner.js`, exported as `@null3d/engine/levels-planner`. The tool depends on the engine for it, and passes the npm package's simplifier; the engine passes its own calls of the vendored modules (`scene/level-meshopt.ts`). Option (a) breaks the Vite plugin in the repository, and (b) keeps two copies to change.

The run-time API:

- `mesh.buildLevels(options?)` plans on the job workers and resolves with the levels. A call while a plan with the same options runs returns its promise.
- `levels` in `geometry.fromArrays`'s arrays and every generator's options: left out, the default below; `false`, none; `true` or `{ cards }`, a plan when the mesh is made.
- The engine reads the mesh back from the core (`meshPlanningArrays`), so every mesh plans from what it draws, and generators plan too. The levels are index lists over the mesh's own vertices (`createLevelMesh`). A split mesh's level copies the vertices that it draws (`createLevelCopy`). A level of cards copies its vertices and writes its grown positions.
- Levels keep their measured errors and switch at once. An error of 0, where the simplifier found a step exact, takes a millionth of the mesh's size, and each error is at least 1.5 times the one before.
- The cap is the core's: `LEVELS_MAX` from `null3d_render::levels::MAX_LEVELS`, less the base mesh, in both `setLevels` and the plan.

The default is rule (c). It plans at a mesh's first draw, so a mesh that nothing draws costs nothing, and the plan knows the material and the copies.

Guards:

- Joints, morph targets and the vertex record (`targets`) plan none; `buildLevels` refuses them with E1221.
- A material with a displacement map or a custom `vertexOffset` draws another shape than the levels simplify: the mesh takes no automatic levels and drops the ones it has.
- A mesh that lies flat plans no automatic levels, because a shader may give it its shape.
- The first `updateVertices` drops the planned levels and turns the default off; `buildLevels` plans for the new shape.
- `setLevels` ends a plan and frees the planned meshes that it leaves out.
- The card step runs only when asked (`cards: true`): a building kit's walls are separate quads, and thinning them as cards cuts holes. Without it, a level drops only whole small pieces, and only where its error is under a pixel.
- A plan counts as a task from its start until its levels are in, so hold mode's frame draws them.
- glTF meshes, whose levels come from the file, and the add-ons whose shapes live in their shaders (terrain blocks, water, grass tufts, splats), pass `levels: false`. So do the compare scenes, whose three.js twins draw every mesh whole.

## Consequences

- `packages/engine/levels/` holds the planner and its declarations; the engine package ships it, and so does the CDN build. `tools/vendor-meshopt.ts` writes the simplifier and the encoder beside the decoder.
- The core gains `meshPlanningArrays`, `createLevelCopy` and the `LEVELS_MAX` constant.
- `docs/api/geometry.md` and `docs/concepts/lod.md` describe the planned levels; the skills and the three.js mapping name them. [D-91](D-91-level-planning.md) and [D-137](D-137-lod-groups.md) point here.
- E1221 covers a mesh that cannot plan, and E1406 the planner's files.
- The frame that first draws a mesh of hundreds of thousands of triangles pays the read of its vertices, and the frame that takes a split mesh's levels pays their copies. Both stay under the cost of making such a mesh.
