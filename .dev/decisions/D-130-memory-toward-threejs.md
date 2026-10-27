# D-130: Memory toward three.js's

Status: decided. Built: the shared bucket-key table. Task: M2-EX19.

Summary: A frame builder keeps one sorted table of bucket keys for all its layouts, which rebuild one after another. At 50,000 Factory parts that cuts the engine's WebAssembly memory from 68.7 MiB to 61.7 MiB, about 147 bytes per object, at unchanged CPU time. The study also ranks the other per-object savings and the fixed floor, and records the ones rejected for their cost.

## Question

The owner asks for null3D's page memory to come closer to three.js's, without slower frames ([D-132](D-132-showcase-look-and-features.md)). Where does the memory go, and which cuts cost no frame time?

## Where the memory goes

Measured on a MacBook Pro (18 logical cores), Chrome, production builds of the comparison pages, 1280 x 720. Real memory is the renderer process footprint in MiB.

| Factory, 50,000 parts | null3D | three.js (WebGL) |
| --- | --- | --- |
| Scene graph, capacity 50k | 263 | 177 |
| Scene graph, default room | 240 | 169 |
| Instanced, capacity 50k | 199 | 79 |
| Instanced, default room | 112 | 70 |

- The engine's shared WebAssembly memory was 21.1 MiB at 10,000 parts, which is about 15,000 objects. At 50,000 parts it was 70.6 MiB. That is about 865 bytes per object.
- Sixteen job workers started at 50,000 parts, each about 3.5 MiB of real memory (D-126). They were the largest single item.
- A heap snapshot of the sketch worker found about 100 bytes of JavaScript per object. The gap is per-object WebAssembly data, not JavaScript objects.
- That data is about 660 bytes per object: core scene rows 263 and the bucket-key scratch 144 (three tables of 48). The rest is the shadow caster table 88 to 142, the upload arenas 40, cell culling 17 and the levels 12. Thread stacks add 1 MiB each in the memory (16 MiB at 16 job workers). They are almost never touched, so they are not real memory (D-126).
- three.js's per-object memory is about 140 to 200 bytes. The rest of the gap is the fixed floor: the sketch worker and the render worker with their isolates. Under D-126 the render worker holds no copy of the core, and the job workers start on demand.

## Options

| Fix | Saving | Risk | Frame time | Taken |
| --- | --- | --- | --- | --- |
| Share the frame builder's bucket-key scratch | Three tables of 48 B per object, 7.0 MiB at 50k | None: one sort, the same result | None | Yes |
| Grow the upload arenas exactly | Up to 40 B per object | Medium: a frame may reallocate mid-frame | None | No, left for later |
| The outlined table only with outlines | 48 B per object when outlines are off | Low | None | Already: the table is not filled when outlines are off |
| Exact `instance_buckets` and `source_layers` | 20 to 36 B per object | Low | None | No, left for later |
| Fewer job workers by default | Up to 52 MiB fixed | Loses speed | Slower | No: D-07, eight workers beat two by 6% of the sketch worker's frame on a phone |
| Smaller job-worker stacks | 0 MiB of real memory | None | None | No: D-126 measured no change |

## Rule

A frame builder keeps one `KeyCounts` table for all its layouts. Each layout's `rebuild` takes `&mut KeyCounts` and fills it. It reads the table before the next layout runs. The layouts rebuild one after another. So the table holds one layout's keys at a time, and no result changes. `collect_bucket_keys` and the level-key expansion write into the table.

## Cost

Measured on the MacBook Pro, Chrome, production build of the Factory comparison, 50,000 parts, scene graph, WebGPU, two runs each:

| Figure | Main's render code | This change |
| --- | --- | --- |
| Engine WebAssembly memory | 68.69 MiB | 61.69 MiB |
| Frame rate | 60.00 fps | 60.00 fps |
| Frame CPU time | 3.28 to 3.59 ms | 3.13 to 3.58 ms |

- The saving is 7,340,032 bytes, 10.2% of the memory, or about 147 bytes per object. The three per-layout tables of 48 bytes each, which the shared table replaces, account for 144 of it.
- Both columns read exactly 60.00 fps. That is a cap on the frame rate, most likely the window's display rate, so it cannot show a change in cost. The frame's CPU time is the evidence that the cost did not change. The builder fills the table once per frame and makes fewer allocations, not more.
- The allocation check passed on S1 with 100,000 instances on WebGPU. Every place stayed within its budget, with 222 bytes per frame in the sketch worker and 572 in the render worker.

## Open

- The upload arenas and the exact instance and layer tables are the next per-object savings. The arenas must grow without a reallocation in the middle of a frame.
- The two always-on threads remain the largest gap to three.js for a small scene (D-126).
