# D-106: How S6, the city, gets its models, loads, and draws in its three.js twin

Status: decided by the owner on 2026-10-08 (UTC+8) for the object limit, the load and the layout fix. Pending: the Mac timing, which waits for a quiet Mac, the device runs on the iPad, the S24+ and the cloud phones, and load times on a network. Date: 2026-10-08. Task: M2-L3.

Summary: S6 builds two model files from the sample content's city layout. It loads them in two stages, kit models first and towers second, with no engine change. Its 20,738 objects needed more than the 16,383 that one engine held. So the engine's object tables grow on demand ([D-103](D-103-growing-object-tables.md)), and S6's page asks for room for 21,000 at its start. The optimized city takes 37.5 MB to download and 87 MB of GPU memory as ETC2 or ASTC. Texture sharing between model files becomes a task of its own.

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
| Engine objects for the whole city | 20,702 meshes (one per model part and row), 32 point lights, the sun, the ambient light, the camera and a marker group: 20,738 | `bench/scenes/s6.ts` and the sketch |
| The same with `scene.instantiate` per row | About 38,000: a group per copy as well | The same count |
| Triangles drawn | About 3.85 million | The models' accessors times their rows |
| Kit file, optimized | 8.5 MB to 1.8 MB, 122 parts, 103,871 triangles; 63 parts got blockers; 4 textures of 512 x 512 | `assets optimize`, owner's Mac, 8 October 2026 |
| Tower file, optimized | 107.4 MB to 35.7 MB (2.8 MB of meshes), 1,849 meshes; 1,705 got blockers; 121 textures | The same run |
| Texture memory of the towers | 87.3 MB with ETC2 and ASTC, 133.3 MB with BC7 only, 533.3 MB uncompressed | The tool's report |
| Time to build the files | About 27 s to generate, about 100 s to optimize | The same Mac, under load |
| Object tables per object | About 263 bytes | [D-103](D-103-growing-object-tables.md) |
| Props that reached into the streets, before the layout fix | 7 industrial tanks, 15 m wide and 9.6 m tall; the camera drove through them for 123 m of its 2,240 m route | A check of the route at the camera's height against each object's bounds |
| After the fix (null3d-engine/sample-assets#1) | No object on the route; 5,595 of 19,173 props moved; the same models, materials, lights, labels and route | The same check |

Load on the owner's Mac, 8 October 2026, files from the local disk, the whole city, one function run each (not a timing run):

| Page | First frame | City whole | Bytes of content | CPU per frame |
| --- | --- | --- | --- | --- |
| null3D, WebGPU | 1.12 s | 1.20 s | 42.4 MB | 0.49 ms |
| null3D, WebGL2 | 1.44 s | 1.51 s | 42.4 MB | 1.24 ms |
| three.js, WebGLRenderer | 0.43 s | 0.52 s | 45.7 MB | 5.87 ms |
| three.js, WebGPURenderer | 5.74 s, mostly its shader compiles | 5.74 s | 45.7 MB | 13.94 ms |

The times count from the page's start. null3D's include the engine's start and the preset check. The byte counts differ mostly by the environment: null3D loads the asset tool's KTX2 map, and three.js the HDR file for `PMREMGenerator`. A first run of three.js's WebGPU page took 9.1 s to its first frame.

Texture sharing: today two model files that name one texture each upload their own GPU copy. And `loadGltf` waits for all of a file's textures. Split into 16 tiles, the city would put most of its 121 tower textures into most tiles. That means up to 16 copies of 87 MB.

## Options

| Question | Option | For | Against |
| --- | --- | --- | --- |
| Object limit | (a) A fixed limit of 32,767 for every engine | One line | About 5 MB more for every engine, scenes of 10 objects included |
| | (b) A `createEngine` start option, default 16,383 | Pays only where asked | A page must know its count before it starts |
| | (c) Instance batches for small props | No engine change | Batch rows neither cast nor receive shadows, so roads would lose the buildings' shadows |
| | (d) Tables that grow on demand (chosen) | Every scene pays for what it holds | Engine work: a copy of the tables when they grow |
| Load | (a) Tiles nearest the camera first, with textures shared between files | The finest stream | Needs texture sharing in the engine first |
| | (b) Two stages: the kit file, then the tower file (chosen) | No engine change; each texture loads once | The towers' textures arrive as one block |
| Layout | (a) Fix the generator, so props stay inside their lots (chosen) | A drive with nothing in the way | A new pin of the sample content |
| | (b) Keep the layout | No change | The showcase drives through tanks |

## Decision

- Object limit: option (d), the owner's ruling of 8 October 2026. [D-103](D-103-growing-object-tables.md) builds it, and S6's branch merges after it. S6's page passes `expectedObjects: 21000` to `createEngine`, so its tables never grow in play.
- Layout: option (a), the coordinator's ruling of the same day. The fix merged as null3d-engine/sample-assets#1, and S6's branch pins it.
- Load: option (b), the owner's ruling of the same day. The kit file holds each part of the Kenney models once. The tower file holds each box with its own mesh, whose texture coordinates count metres, and the layout's 200 materials. The sketch creates the kit's objects nearest the camera's start first, up to 3,000 rows a frame, then the towers when their file is in.
- Objects: one mesh per model part and row with `createMesh`. Each keeps the asset tool's blocker choice through the node's `occluder` field.
- Files: built from the layout at build time into the shared samples cache, never into git. The asset tool's output stays in the Vite plugin's cache. CI keeps both in the Actions cache.
- Twin: three.js draws each kit part as one `InstancedMesh`, and the towers as the loader's meshes. three.js's docs advise instanced meshes for many copies of one mesh, and they cast and receive shadows. Bloom and ambient occlusion are each engine's own, so S6 has no pixel parity with three.js.

## Consequences

- The engine gains `PrefabNode.occluder`.
- S6 joins the benchmark lists, the page tests and the image manifest. The parity checks leave it out, with the reason in `LEFT_OUT_OF_PARITY`.
- The CI jobs that load S6 run `.github/actions/city`, and the benchmark job's Mac shards share one folder of optimized models.
- The street tiles stand 1 cm apart in a checkerboard, so no shared edge is a tie of equal depth. S6's image test draws one thread mode, because other copies of one mesh still meet. [Benchmarks](../benchmarks.md#what-s6-found) gives the figures.
- The benchmark report gains a table of each streamed scene's load, so a run compares the load times and the bytes of both engines.
- Texture sharing between model files becomes a task of its own after the texture budget (#346) merges. This record's texture figures and S6's load times feed it.
