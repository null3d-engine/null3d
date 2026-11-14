# D-310: Meshes made in code plan their levels on the job workers

Status: decided and built: the shared planner, `mesh.buildLevels`, the automatic levels at a mesh's first draw with the `levels` option, their guards, and the pieces of large code meshes, on WebGPU and WebGL2. The owner accepted the thresholds, and asked that no frame be late for a large mesh and that meshes drawn only by blended materials plan nothing; both are built. The add-ons take the default, and opt out only the meshes whose levels are wrong. Pending: the adoption by the demos that set levels by hand today. Task: none.

Summary: The asset tool's level planner moved into `packages/engine/levels/planner.js`, which the tool runs in Node and the engine runs on a job worker with the same build of meshoptimizer's simplifier, so one mesh gets one set of levels, index for index. A mesh made in code plans its levels at its first draw when it holds 4,096 triangles or more, or 256 or more in copies of 65,536 triangles together; `levels: false` opts out. A million triangles take about 6 s of one job worker's CPU. The engine reads such a mesh one part a frame and hands over one level a frame, so no frame is late for the plan.

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

The levels' indices take about as much memory again as the mesh's own (0.94 to 1.00 of them). A mesh split into parts, past 65,535 vertices, shares its vertices with its levels part by part, and copies only the vertices of the triangles that cross a seam between parts. On the job worker, meshoptimizer's heaps grow with the largest mesh and never shrink, so a worker lets them go after a plan that took them past 32 MiB.

The planner's files load with the first plan: `js/sketch-worker-mesh-levels.js` 0.4 KB, `js/job-worker-levels.js` 3.0 KB, `meshopt_simplifier.wasm` 13.5 KB and `meshopt_encoder.wasm` 5.7 KB after Brotli.

### Frames while a mesh plans

`tests/pages/levels-frames.ts` runs `tests/pages/sketches/levels-large-sketch.ts`, which makes a bumpy grid two seconds in, and measures the frame interval in one-second windows. Chrome 156, the Mac's GPU, pipelined, Low preset; the 99th percentile of each window. Without levels the grid has `levels: false`.

A first build read the whole mesh from the core in the frame that first drew it, and made every level at once when the plan's answer came, giving a split mesh's levels copies of their vertices. Its figures:

| Grid, first build | The window of the frame that makes and draws the mesh: without levels, with them | Windows while the plan runs | The window that takes the levels |
| --- | --- | --- | --- |
| 64,800 triangles, WebGPU | not run, 23.7 ms | 16.7 ms | 16.7 ms |
| 131,072 triangles, WebGPU | not run, 23.7 ms | 16.7 ms | 16.7 ms |
| 524,288 triangles, WebGPU | 38.7 ms, 46 ms | 16.7 ms | 23.7 ms |
| 1,048,352 triangles, WebGPU | 64.5 ms, 100 ms | 16.7 ms | 64.7 ms |
| 1,048,352 triangles, WebGL2 | 55 ms, 91.7 ms | 16.7 ms | 38.2 ms |

On the planner of fifteen levels, the same million-triangle grid made its nine levels in 101.6 ms of the sketch worker's time on WebGPU and 81.0 ms on WebGL2, between two frames, with the finest level alone taking 49.0 ms and 43.6 ms. The windows that took them reached 69.2 ms and 46.7 ms.

Three changes take that work out of the frames:

- The engine reads the mesh from the core one part a frame, from the frame after the one that first drew it. A part holds at most 65,535 vertices, so each read takes a few milliseconds.
- A split mesh's level shares the base's vertices part by part (`createSplitLevel`): each triangle draws from a part that holds its three vertices, and only the triangles that cross a seam between parts copy their vertices. The million-triangle grid's finest level of 524,176 triangles then takes 14.3 ms on WebGPU and 15.1 ms on WebGL2, against 49.0 ms and 43.6 ms for a copy.
- The plan makes one level a frame, coarsest first. It gives the scene the whole set when the plan ends. The scene's draw tables then rebuild once, however many levels the plan made. Hold mode takes them all at once, since its held frame waits for the plan.

| Grid, as built | The window of the frame that makes and draws the mesh: without levels, with them | Windows while the parts read and the plan runs | Windows while the plan makes the levels |
| --- | --- | --- | --- |
| 1,048,352 triangles, WebGPU | 72.7 ms, 82 ms | 16.7 ms | 16.7 ms |
| 1,048,352 triangles, WebGL2 | 63.7 ms, 71.5 ms | 16.7 ms | 16.7 ms |

No frame but the one that makes the mesh is late. Making a mesh of a million triangles in a frame costs about 60 ms on its own. The mesh's first draw adds only the start of the plan; between the two runs the window differs by 8 to 9 ms, within this machine's spread from run to run under its load. Each level's mesh took 3 to 15 ms of the sketch worker's time between frames, and the plan made its nine levels over nine frames.

The Island showcase scene ran on the same page for 20 one-second windows, once as built and once with the automatic default turned off in a local build (the thresholds set past any mesh), on WebGPU and WebGL2. The 99th percentile of the frame interval, per window:

| Island | Windows at 16.7 ms | Windows from 23 to 66 ms | Windows past 100 ms |
| --- | --- | --- | --- |
| WebGPU, automatic levels | 11 of 20 | 9, the first at 55.8 ms | none |
| WebGPU, none | 11 of 20 | 9, the first at 64.7 ms | none |
| WebGL2, automatic levels | 8 of 20 | 11, the first at 48.3 ms | 1, at 912 ms, nine seconds in |
| WebGL2, none | 9 of 20 | 9, the first at 56.3 ms | 2, at 983 ms and 306 ms, nine and ten seconds in |

The scene's late windows come in the same places with the default on and off, so they are the scene's own, and so is the WebGL2 stall nine seconds in. The plans add no late window.

How the data was produced: `bun test` of the two unit tests named above; a temporary log of each level's time around `levelMesh`; a scratch Bun test that times the task's `run` with `process.cpuUsage`; `tests/image/runtime-levels.spec.ts`; and a scratch Playwright test that opened `levels-frames.html?sketch=...` with the grid's sizes and `levels=off`, and with the Island's sketch, on this record's branch.

## Pieces of meshes made in code

The plan gives a mesh made in code the pieces that `--lod` gives a file's large levels ([D-307](D-307-mesh-pieces.md)). The pieces planner moved beside the level planner (`packages/engine/levels/pieces.js`, `@null3d/engine/pieces-planner`), and the levels task runs it on the job worker after the levels (`scene/level-pieces.ts`). The mesh and each level of 32,768 triangles or more get 8 to 16 pieces. A smaller list gets facing pieces by the rule that the asset tool follows too ([D-307](D-307-mesh-pieces.md#smaller-lists-that-many-copies-draw)): the plan takes the copies that the scene has drawn of the mesh, and a list of 1,024 to 32,767 triangles whose copies hold 65,536 triangles or more together gets a piece for each way it faces, where the pieces pay.

- The mesh keeps its own list, for raycasts and `updateVertices`. Its pieces draw a sorted list of their own that shares its vertices (`setMeshPieceList`), which arrives in the frame after the last level. A later plan's list takes the place of the earlier one, so a plan after `updateVertices` gives the new shape pieces too.
- A list of 32,768 triangles or more gets that list only where one object draws the mesh, or none yet. The list costs a copy of the mesh's indices, and copies of a mesh draw their base only near the camera, where their finest level's pieces take over a little further out. The desert made in code shows the cost: with a list for every large mesh, its indices passed the room of the shared index buffer, and a level failed to fit. A smaller list's copy costs at most 393 KB, and its copies draw the base wherever its own levels have not switched in, so a smaller mesh gets that list whatever draws it.
- A level's list is sorted before the level is made. A level over a base in one part takes its pieces with `setMeshPieces`, and one over a split base with `createSplitLevel`.
- A list whose triangles face one way by 0.7 or more, as their facings summed by area show it, splits by space alone: a ground, a road or a wall. Groups by facing would each spread over the whole list, so the view would cut none of them.
- A mesh of more than 65,535 vertices draws a list part by part: a triangle draws from the part where one of its corners first appears, trying its corners in turn, once that part holds all three, and the triangles that no part holds whole draw last from copies. The task notes which parts hold each vertex, one bit a part, and plans pieces within each of those groups, so the sorted list still comes part by part. The core checks the order and draws a list in another order without pieces. A list of more groups than 16 takes one piece a group, since its parts draw a range each without pieces too. A mesh of more than 32 parts gets none.
- The guards are the levels' and the engine's: a mesh with `levels: false` gets no pieces, and the engine skips the pieces of a draw that a skin, morph targets, a displacement or a custom vertex offset moves, and the cone test where a material draws both faces.
- A mesh whose levels are set by hand plans no levels, but its copies draw its base out to where its own levels switch in. The Island's house walls are such meshes: a far house of about 50 triangles switches in about 460 m out, so a town view draws every near wall whole. Such a mesh of 1,024 to 32,767 triangles plans its facing pieces alone, with no levels, at the draw that brings its copies' triangles to 65,536 together. A material that draws both faces, blends, lets light through or moves the vertices plans none, and neither does a mesh with joints, morph targets or a vertex record. A later `setLevels` ends a plan that runs. A file's mesh plans its facing pieces in the same way where the file holds none, and takes the file's held pieces once its copies pay ([D-307](D-307-mesh-pieces.md#smaller-lists-that-many-copies-draw)).
- `levels: 'pieces'` plans no levels and sorts a mesh of 32,768 triangles or more into pieces by space alone, at its first draw by a material that keeps its vertices and does not blend or let light through. The impostors' merged far cells take it. The water and ocean surfaces of the water add-on do not: they blend and let light through, so the transparent pass sorts and draws each one whole, and pieces would never draw; their waves also move their vertices in the shader.
- A check during play draws a mesh whole while its pieces leave out less than a fifth of its triangles in view, and tries them again every 600 frames ([D-307](D-307-mesh-pieces.md#the-check-during-play)).
- A held frame waits for every level plan until its levels are in, and says every 10 seconds which meshes still plan. Past five minutes, hold mode fails with E1408 and names them, so a held picture never depends on how fast the job workers planned.

### What the pieces of code meshes measured

The Island showcase builds three meshes in code that get pieces, and two of them are split into parts, so the pieces had to follow the parts:

| Island mesh | Triangles | Vertices | Parts | Pieces of the mesh | Pieces of its finest level |
| --- | --- | --- | --- | --- | --- |
| Sea bed | 97,670 | 90,601 | 2 | 16 | 12, of 48,834 triangles |
| Roads | 67,780 | 59,734 | 1 | 16 | 8, of 33,890 triangles |
| Stone walls | 50,750 | 101,500 | 2 | 12 | none: 25,268 triangles |

Its frames on WebGPU kept the pattern of the levels alone: 10 of 20 one-second windows at 16.7 ms, the first at 55.8 ms, none past 100 ms. Its GPU time per frame, over the same 20 seconds of its camera route after the plans, was 11.8 and 12.55 ms with pieces and 10.35 and 11.08 ms without them, in two pairs of runs. A third pair gave 9.37 ms with pieces, and its run without them timed nothing. The Mac's load stayed near 50 on 18 cores, so these runs cannot tell a change of a millisecond. The pieces cut the triangles by less than 1% and added 170 to 830 draws.

The desert benchmark has no scene in code, so a temporary sketch built its meshes with `geometry.fromArrays` from the benchmark's own module and drew the same placements. Every mesh planned its levels and pieces; the ground of 2,000,000 triangles in 16 parts took 17 pieces on each level down to 62,500 triangles. Medians of one 10-second run each, WebGPU, on the camera path from the moment the levels were in:

| Desert in code | GPU ms, pieces / none | Triangles a frame, M | Draws |
| --- | --- | --- | --- |
| Walk | 2.69 and 2.75 / 2.88 | 4.17 / 4.57 | 951 / 732 |
| Aerial | 3.05 / 3.28 | 2.68 / 2.67 | 951 / 732 |

With a piece list for every large prop, two of four runs ended with a level that the core could not make: `createLevelMesh` failed as the ground's large lists arrived, and the core reported only that the mesh did not fit. So only a mesh that one object draws plans a list of its own. With that rule one of four runs with pieces still failed so, and none of three without them. The cause is open.

How the data was produced: a temporary log of each code mesh's size and each plan's pieces, the frame page of the Island, and a temporary page that measured the Island's sketch and the desert sketch with the pieces turned off on the sketch's thread, on this branch at `3c342e79`.

## Look

Planned levels switch where their measured error covers under the `lodThreshold` setting's pixels, as a file's measured levels do, so a mesh looks as it did. Option (a) of the planner's place and option (b) of the copy look the same; the rules of which meshes plan differ only in where the GPU's time goes.

## Decision

The planner is option (c): `packages/engine/levels/planner.js`, exported as `@null3d/engine/levels-planner`. The tool depends on the engine for it, and passes the npm package's simplifier; the engine passes its own calls of the vendored modules (`scene/level-meshopt.ts`). Option (a) breaks the Vite plugin in the repository, and (b) keeps two copies to change.

The run-time API:

- `mesh.buildLevels(options?)` plans on the job workers and resolves with the levels. A call while a plan with the same options runs returns its promise.
- `levels` in `geometry.fromArrays`'s arrays and every generator's options: left out, the default below; `false`, none; `true` or `{ cards }`, a plan when the mesh is made.
- The engine reads the mesh back from the core one part a frame (`meshPlanningPart`), so every mesh plans from what it draws, and generators plan too. The levels are index lists over the mesh's own vertices (`createLevelMesh`). A split mesh's level shares the base's vertices part by part and copies only the vertices of the triangles that cross a seam (`createSplitLevel`). A level of cards copies its vertices and writes its grown positions (`createLevelCopy`).
- The plan makes one level a frame, coarsest first, and gives the scene the whole set once, outside hold mode.
- Levels keep their measured errors and switch at once. An error of 0, where the simplifier found a step exact, takes a millionth of the mesh's size, and each error is at least 1.5 times the one before.
- The cap is the core's: `LEVELS_MAX` from `null3d_render::levels::MAX_LEVELS`, less the base mesh, in both `setLevels` and the plan.

The default is rule (c). It plans at a mesh's first draw, so a mesh that nothing draws costs nothing, and the plan knows the material and the copies.

Guards:

- Joints, morph targets and the vertex record (`targets`) plan none; `buildLevels` refuses them with E1221.
- A material with a displacement map or a custom `vertexOffset` draws another shape than the levels simplify: the mesh takes no automatic levels and drops the ones it has.
- A mesh that lies flat plans no automatic levels, because a shader may give it its shape.
- A blended material, or one that lets light through, draws the base level at every distance. Its copies do not count toward the default, and a mesh that only such materials draw plans nothing until another material draws it.
- The first `updateVertices` drops the planned levels and turns the default off; `buildLevels` plans for the new shape.
- `setLevels` ends a plan and frees the planned meshes that it leaves out.
- The card step runs only when asked (`cards: true`): a building kit's walls are separate quads, and thinning them as cards cuts holes. Without it, a level drops only whole small pieces, and only where its error is under a pixel.
- A plan counts as a task from its start until its levels are in, so hold mode's frame draws them.
- glTF meshes, whose levels come from the file, pass `levels: false`. So do the add-on meshes whose levels are wrong. A shader shapes or places some (water, grass tufts, splats, floating leaves). The terrain blocks have their own quadtree. The impostor cards and merged far cells are far stand-ins, and the gizmo handles keep one size on the screen. So do the compare scenes, whose three.js twins draw every mesh whole. Every other add-on mesh takes the default.

## Consequences

- `packages/engine/levels/` holds the planner and its declarations; the engine package ships it, and so does the CDN build. `tools/vendor-meshopt.ts` writes the simplifier and the encoder beside the decoder.
- The core gains `meshPlanningPart`, `createSplitLevel`, `createLevelCopy` and the `LEVELS_MAX` constant.
- `docs/api/geometry.md` and `docs/concepts/lod.md` describe the planned levels; the skills and the three.js mapping name them. [D-91](D-91-level-planning.md) and [D-137](D-137-lod-groups.md) point here.
- E1221 covers a mesh that cannot plan, and E1406 the planner's files.
- A large mesh's levels are made over as many frames as it has levels, after its parts have read over as many frames as it has parts, and the scene takes the whole set once.
