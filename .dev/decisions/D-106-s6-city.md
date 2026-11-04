# D-106: How S6, the city, gets its models, loads, and draws in its three.js twin

Status: decided by the owner for the object limit, the load, the layout fix and one tower mesh per material. The owner also ruled on the CI check of the streamed load: option (a), with no extra shard ([below](#a-ci-check-of-the-streamed-load)). Built: the city's files, the two-stage load, the merged tower meshes and blockers by connected part. Pending: the Mac timing of S6's draws, CPU and GPU, which waits for a quiet Mac. Also pending: the device runs on the iPad, the S24+ and the cloud phones, and load times on a network. Task: M2-L3.

Summary: S6 builds two model files from the sample content's city layout, and loads them in two stages, kit models first and towers second. The towers hold one mesh per material with float positions, so the city makes 19,089 objects, and the page asks for room for 19,100 ([D-103](D-103-growing-object-tables.md)). The optimized city takes about 35.5 MB to download and 87 MB of GPU memory as ETC2 or ASTC.

## Question

S6's design asks for a generated city of about 20,000 objects in about 200 materials, which streams in. It comes from optimized glTF with KTX2 textures and meshopt. The sample content gives a layout of rows, not model files. How does S6 get its model files, and how does it load them? How do its objects fit in one engine, and what does its three.js twin draw?

## Rule

- Both engines load the same files, as a developer ships them: optimized by the asset tool.
- Equal work ([D-52](D-52-intent-parity.md)): the same content and comparable settings. Each engine uses its own best technique.
- No generated file goes into git without a recorded reason.
- The first frame comes as soon as the camera's first view can draw.

## Data

| Measure | Figure | Source |
| --- | --- | --- |
| Layout rows | 19,173: 1,849 boxes and 17,324 copies of 98 Kenney models | `sources/city/layout/layout.json` |
| Kenney models with more than one part | 22 with two, 1 with three, of 98 | The models' glTF files |
| Engine objects for the whole city, one mesh per tower box | 20,702 meshes (one per model part and row), 32 point lights, the sun, the ambient light, the camera and a marker group: 20,738 | `bench/scenes/s6.ts` and the sketch |
| The same with `scene.instantiate` per row | About 38,000: a group per copy as well | The same count |
| Triangles drawn | About 3.85 million | The models' accessors times their rows |
| Kit file, optimized | 8.5 MB to 1.8 MB, 122 parts, 103,871 triangles; 63 parts got blockers; 4 textures of 512 x 512 | `assets optimize` on the owner's Mac |
| Tower file of one mesh per box, optimized | 107.4 MB to 35.7 MB (2.8 MB of meshes), 1,849 meshes; 1,705 got blockers; 121 textures | The same run |
| Texture memory of the towers | 87.3 MB with ETC2 and ASTC, 133.3 MB with BC7 only, 533.3 MB uncompressed | The tool's report |
| Time to build the files | About 27 s to generate, about 100 s to optimize | The same Mac, under load |
| Object tables per object | About 263 bytes | [D-103](D-103-growing-object-tables.md) |
| Props that reach into the streets without the layout fix | 7 industrial tanks, 15 m wide and 9.6 m tall; the camera drives through them for 123 m of its 2,240 m route | A check of the route at the camera's height against each object's bounds |
| With the fix (null3d-engine/sample-assets#1) | No object on the route; 5,595 of 19,173 props moved; the same models, materials, lights, labels and route | The same check |

With one tower mesh per material, the city makes 19,089 objects, and the tower file takes 842,132 bytes besides its textures ([One tower mesh per material](#one-tower-mesh-per-material)).

Load on the owner's Mac, with one mesh per tower box, files from the local disk, the whole city, one function run each (not a timing run):

| Page | First frame | City whole | Bytes of content | CPU per frame |
| --- | --- | --- | --- | --- |
| null3D, WebGPU | 1.12 s | 1.20 s | 42.4 MB | 0.49 ms |
| null3D, WebGL2 | 1.44 s | 1.51 s | 42.4 MB | 1.24 ms |
| three.js, WebGLRenderer | 0.43 s | 0.52 s | 45.7 MB | 5.87 ms |
| three.js, WebGPURenderer | 5.74 s, mostly its shader compiles | 5.74 s | 45.7 MB | 13.94 ms |

The times count from the page's start. null3D's include the engine's start and the preset check. The byte counts differ mostly by the environment: null3D loads the asset tool's KTX2 map, and three.js the HDR file for `PMREMGenerator`. A first run of three.js's WebGPU page took 9.1 s to its first frame.

Texture sharing: two model files that name one texture each upload their own GPU copy. And `loadGltf` waits for all of a file's textures. Split into 16 tiles, the city would put most of its 121 tower textures into most tiles. That means up to 16 copies of 87 MB.

## Options

| Question | Option | For | Against |
| --- | --- | --- | --- |
| Object limit | (a) A fixed limit of 32,767 for every engine | One line | About 5 MB more for every engine, scenes of 10 objects included |
| | (b) A `createEngine` start option, default 16,383 | Pays only where asked | A page must know its count before it starts |
| | (c) Instance batches for small props | No engine change | Roads keep the buildings' shadows only with batch shadows ([D-115](D-115-batch-shadows.md)) |
| | (d) Tables that grow on demand (chosen) | Every scene pays for what it holds | Engine work: a copy of the tables when they grow |
| Load | (a) Tiles nearest the camera first, with textures shared between files | The finest stream | Needs texture sharing in the engine first |
| | (b) Two stages: the kit file, then the tower file (chosen) | No engine change; each texture loads once | The towers' textures arrive as one block |
| Layout | (a) Fix the generator, so props stay inside their lots (chosen) | A drive with nothing in the way | A new pin of the sample content |
| | (b) Keep the layout | No change | The showcase drives through tanks |

## Decision

- Object limit: option (d), the owner's ruling, which [D-103](D-103-growing-object-tables.md) builds. S6's page passes `expectedObjects` of 19,100 to `createEngine`, so its tables never grow in play.
- Layout: option (a), the coordinator's ruling. The fix is null3d-engine/sample-assets#1, and S6 pins it.
- Load: option (b), the owner's ruling. The kit file holds each part of the Kenney models once. The tower file holds one mesh per material for the layout's 200 materials, whose texture coordinates count meters. The sketch creates the kit's objects nearest the camera's start first, up to 3,000 rows a frame, then the towers when their file is in.
- Objects: one kit mesh per model part and row, and one tower mesh per material, each with `createMesh`. Each keeps the asset tool's blocker choice through the node's `occluder` field.
- Files: built from the layout at build time into the shared samples cache, never into git. The asset tool's output stays in the Vite plugin's cache. CI keeps both in the Actions cache.
- Twin: three.js draws each kit part as one `InstancedMesh`, and the towers as the loader's meshes. three.js's docs advise instanced meshes for many copies of one mesh, and they cast and receive shadows. Bloom and ambient occlusion are each engine's own, so S6 has no pixel parity with three.js.

## Consequences

- The engine has `PrefabNode.occluder`.
- S6 is in the benchmark lists, the page tests and the image manifest. The parity checks leave it out, with the reason in `LEFT_OUT_OF_PARITY`.
- CI builds the city's files once per run, in the `load-pages` job ([CI](#ci)). S6's image tests run in a job of their own. The benchmark job's Mac shards share one folder of optimized models.
- The street tiles stand 1 cm apart in a checkerboard, so no shared edge is a tie of equal depth. S6's image test draws one thread mode, because other copies of one mesh still meet. [Benchmarks](../benchmarks.md#what-s6-found) gives the figures.
- The benchmark report has a table of each streamed scene's load, so a run compares the load times and the bytes of both engines.
- Texture sharing between model files is a task of its own. This record's texture figures and S6's load times feed it.

## One tower mesh per material

### Question

A tower file that gives each of the 1,849 boxes a mesh of its own takes 1,849 of the city's 1,971 draws in each pass. An asset pipeline that ships a city merges static meshes by material. Should S6 do the same, and how do the corners of boxes that meet stay exact?

### Decision

- The tower file holds one mesh per material, 200 in all, each with every box in that material. Its node stands at the center of its boxes' base, so the positions stay near zero. Each pass then takes about 322 draws, against 1,971. The city makes 19,089 objects, against 20,738, and the page asks for room for 19,100.
- A click on a tower mesh finds its building with `s6BuildingAt`: the box of that material nearest the hit point. Both engines use it.
- The asset tool quantizes positions in steps of 1/16,383 of a mesh's longest side. The tower meshes spread over 134 to 760 m, so the steps would move corners by centimeters, and boxes that meet would open gaps. A per-mesh setting in the glTF extras, `"quantizePositions": false`, keeps that mesh's positions as 32-bit floats. The other vertex data still takes integers, and meshopt still compresses the buffers. The default quantizes ([D-18](D-18-asset-tool.md#the-settings)).
- Each tower mesh sets `"occluder": true` too. The tool's blocker of one or two boxes cannot fit boxes spread over the city, so each mesh blocks with its own triangles, 12 per box.

### Data

The tower file's meshes after the asset tool, without textures, on the owner's Mac. The corner error is each vertex's distance to the nearest true corner of the layout's boxes, over all 44,376 vertices. three.js's `GLTFLoader` with its `MeshoptDecoder` read the same files and gave the same errors.

| Tower file | Meshes | Positions | Largest error | Mean error | Corners off by over 1 mm | Bytes |
| --- | --- | --- | --- | --- | --- | --- |
| One mesh per box | 1,849 | 16-bit integers | 1.74 mm | 0.15 mm | 480 | 2,925,592 |
| One mesh per material, integers | 200 | 16-bit integers | 28.1 mm | 12.5 mm | 44,022 | 645,300 |
| One mesh per material, floats (chosen) | 200 | 32-bit floats | 0.015 mm | 0.003 mm | 0 | 801,456 |

- A box with its own mesh keeps errors under 2 mm: its longest side sets its steps, and its shorter sides fall between steps.
- The whole optimized tower file, as the pages load it, takes 842,132 bytes, against 2,966,784 with one mesh per box, besides its 33 MB of textures. The floats add 156 KB to the merged file, and the merge saves 2.1 MB against one mesh per box. Most of that saving is the 1,849 blockers, 20,460 triangles, that a file of one mesh per box stores.
- The tool's blockers: with one mesh per box, 1,705 boxes get a box blocker and the 144 ground slabs none. None of the 200 merged meshes fits a blocker, so all 200 block with their own triangles, the slabs among them.

### Options

| Option | For | Against |
| --- | --- | --- |
| (a) Merged meshes with quantized positions | Smallest file | Corners off by up to 28 mm; gaps where boxes meet |
| (b) Merged meshes in tiles, such as 100 m squares, quantized | Steps of 6 mm or less | More draws; still not exact; a generator of tiles |
| (c) Merged meshes with float positions, set per mesh (chosen) | Exact corners; any tool user can choose it for such a mesh | 156 KB more for the towers |
| (d) A tool option for all meshes of a file | One flag | Every mesh of the file pays, the kit's included |

## Blockers by connected part

The WebGL2 path draws blockers nearest first, up to 16,384 triangles a frame ([D-50](D-50-blockers-and-stored-trees.md)). A tower mesh's sphere centers on its node and reaches its farthest box, up to about 400 m. So the camera stands inside most of those spheres, and each counts as 0 m away. With one candidate per object, the tower meshes in view draw first, all their boxes, near and far, and fill most of the budget. The kit buildings near the camera then no longer fit ([D-41](D-41-software-occlusion.md)). So the engine gives a blocker one candidate per connected part:

- When it builds a blocker mesh, it splits the welded triangles into connected parts, the triangles that share corners. It keeps a bounding sphere for each part. Boxes whose corners meet weld into one part.
- The frame's pick sorts each part by the nearest point of its own sphere. The object's matrix moves and grows that sphere. Each box of a tower mesh then competes as a box with its own mesh does.
- A blocker of one part, such as a kit building or the asset tool's box, keeps the object's own sphere. So a scene without merged meshes picks as it would with one candidate per object.
- A mesh's blocker builds the first time the frame's budget reaches the object. The object's sphere places it, and that sphere lies no farther than any of its parts. That frame draws the mesh whole; later frames sort its parts. So a view full of new meshes builds no more blockers than with one candidate per object.
- The 4,096-triangle limit counts the whole mesh, and the asset tool needs no change.

A replay of the engine's choice along the route gave these figures per frame. It took one frame a second over the 187 s loop, 186 samples, at the bench window of 1,400 x 800. It takes the blockers from both optimized files and the rules of `crates/null3d-render/src/occlusion.rs`.

| Per frame, median (90th percentile) | One mesh per box | One mesh per material | One mesh per material, blocker parts |
| --- | --- | --- | --- |
| Kit blockers drawn | 274 (327) | 12 (230) | 277 (329) |
| Kit blocker triangles | 15,944 (16,356) | 468 (14,104) | 15,996 (16,240) |
| Tower blockers drawn | 33 (269) | 129 (161) | 31 (203) |
| Tower blocker triangles | 396 (3,228) | 15,744 (16,200) | 372 (2,436) |
| Distance where the budget ran out | 127 m (151 m) | 0 m (109 m) | 127 m (154 m) |

With one mesh per material and one candidate per object, the frames lose 254 (306) of the kit blockers that one mesh per box draws, 47 (81) of them within 50 m. The tower meshes split into 1,849 parts, 22,188 triangles. With blocker parts, against one mesh per box, the frames lose no kit blocker at the median, 2 at the 90th percentile, and none within 50 m.

S6's occlusion turns on WebGL2 measured the engine itself, with culling off and on in turns. They ran on the owner's Mac in Chrome, at Medium, 1,400 x 800, governor off. Each side had 4 rounds of 8 s. Each build ran 4 times, and the table gives the median. The counts barely moved between runs. One mesh per box with blocker parts counts only 2 runs of the final form of the change. The times come from runs in a quiet window: 2 runs per build with one mesh per box, and 1 with one mesh per material. Runs beside other work on the Mac gave times up to twice as long.

| Per frame, median | One mesh per box | The same, blocker parts | One mesh per material | The same, blocker parts |
| --- | --- | --- | --- | --- |
| Index list entries that occlusion hid | 2,879 | 2,914 | 300 | 2,753 |
| Index list entries drawn, culling on | 5,984 | 5,907 | 7,833 | 5,389 |
| Draw calls, culling on | 1,826 | 1,805 | 986 | 976 |
| Culling time, culling off | 0.20 ms | 0.19 ms | 0.17 ms | 0.17 ms |
| Culling time, culling on | 0.94 ms | 0.99 ms | 0.66 ms | 0.99 ms |
| Job time, culling on | 0.80 ms | 0.71 ms | 0.68 ms | 0.84 ms |

So the merged towers with blocker parts hide about as much as one mesh per box does, with about half the draw calls. With one mesh per material, the parts cost 0.33 ms more culling a frame. The frame draws about 280 kit blockers in place of 12, and hides 9 times as many entries. With one mesh per box, the parts change little: two-box blockers from the asset tool sort box by box.

## CI

A build of the city's files takes 369 seconds, 6.2 minutes, on a CI runner whose Actions cache has no copy (run 37704989364). When every job that loads S6 builds the files itself, all 7 browser shards and the second benchmark shard hit their 15-minute limit. Their tests pass, but 4 to 6 minutes short.

The browser shards load no city page but S6's 3 image tests. The benchmark job needs the files in both shards, because its build of the pages holds S6's. A change to the asset tool's source misses the cache, so every such run would pay the build in each job.

| Option | For | Against |
| --- | --- | --- |
| (a) Raise the jobs' time limits | No change to the jobs | Every shard pays 6 minutes on a miss; the limits catch slow tests |
| (b) Build the city only in the shard that runs S6's tests | One build | Playwright picks the shard by the test count, and the benchmark build needs the files in both shards |
| (c) One job builds the files once and hands them over as artifacts (chosen) | One build per run; the other jobs only download | The jobs that load S6 start after it, up to 7 minutes later on a miss |

The `load-pages` job builds the files. It needs them for the benchmark pages anyway, and every job that loads S6 waits for it. A separate job for the city would add 3.8 minutes to the longest chain of a full run. The browser shards leave S6's image tests out, by the pattern `CITY_TESTS` in `ci.yml`, and the `browser-city` job runs them after `load-pages`. The benchmark and real-browser jobs wait for `load-pages` too. `bun run test:browser-weights` leaves those tests out of the shards' times. The coordinator asked for a fix that keeps the time limits, so the limits stay.

### A CI check of the streamed load

S6's page tests are the only tests that stream the city in. On CI's SwiftShader runners, null3D's city pages took 30 to 45 seconds to start and drew 0.14 to 0.23 frames a second at 1,000 objects. Two of five short runs gave no result in 90 seconds, and they pushed the second benchmark shard past its 15-minute limit (run 37709876565). So those pages run on real GPUs only, and CI checks the streamed load on no GPU path. The image tests draw held frames, which load everything before they draw. The Mac's runs and the device runs stream the city.

| Option | What CI checks | Cost |
| --- | --- | --- |
| (a) No CI check of the streamed load (chosen) | Held frames of the city on 3 tiers and the scene-code page | None |
| (b) A third benchmark shard for S6 alone, with a longer wait for each page's result | The streamed load and the load report on null3D's 5 S6 pages, on SwiftShader | About 11 minutes of one runner in every CI run, and a page wait above the usual 90 seconds |

The owner chose (a): CI keeps no check of the streamed load, and gets no extra shard. The held frames and the real-GPU runs on the Mac and the devices cover the city.

### three.js's WebGL city page on SwiftShader

S6's three.js WebGL page draws about one frame in 8 seconds on SwiftShader, and its tests take 35 to 45 seconds each. The busy software GPU then holds the next test's browser context past its limit. The test `s2's shadows stay still and keep their edges on webgpu` timed out after 2 minutes while it set up its context (runs 37721322396, 37722644771 and 37726871551). A passing run took 1.9 of its 2 minutes. So `s6 on threejs-webgl` runs on real GPUs only, and CI runs no three.js city twin. The Mac and device runs compare both engines on S6.
