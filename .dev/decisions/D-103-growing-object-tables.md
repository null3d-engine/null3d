# D-103: Object tables that grow on demand

Status: decided by the owner on 2026-10-08 at about 00:05 (UTC+8): option (d), tables that grow. The coordinator set a small start at about 00:55, so that small games stay small. The timings of a growth on the Mac are pending, and so is the phone estimate. Date: 2026-10-08. Task: M2-L3 needs it.

Summary: The scene's object tables start with room for 1,023 objects, not 16,383, and double when the scene needs more, up to 1,048,575, the most that a handle names. A small scene saves about 4 MB of tables. A growth copies about 263 bytes per object. It happens at a frame's start once the scene is three quarters full, or at the create call that finds it full. `createEngine({ expectedObjects })` sizes the tables from the start.

## Question

One engine held at most 16,383 objects, with every per-object table sized for that limit when the engine started. S6, the city, needs about 21,900 objects. How should the engine hold scenes larger than the limit, without making every scene pay for them?

## Rule

The owner set these requirements on 8 October 2026:

- Small games stay small: a scene of a few objects does not pay for thousands.
- S1 and S2 keep their speeds. Their tables reach their size while they load, not during play.
- A scene of any size up to a hard ceiling of at least 32,767 objects works without an option.
- A growth comes early, so a game rarely pauses for one mid-play. Its cost is measured on the Mac and estimated for a phone.
- A game that knows its size can ask for tables of that size at the start, as `maxLabels` and `memory.maximumMiB` work.
- The page's views of the tables refresh after a growth, as instance batches' views do after the memory grows.

## Data

### What the tables hold

The scene's storage keeps about 25 arrays and bitsets indexed by slot: positions, rotations, scales, bounds, parents, flags, meshes, materials, skins, morphs, layers, cells, depths, the hierarchy order and its levels, change stamps, seven bitsets, the slot allocator's tables, and two world buffers of a matrix and a sphere per row. Together they take 263 bytes per object, and 275 bytes in large-world mode. A unit test in `scene.rs` counts every array, so the figure stays current.

| Room for | Scene tables |
| --- | --- |
| 1,023 objects | 0.27 MB |
| 16,383 objects | 4.3 MB |
| 32,767 objects | 8.6 MB |
| 65,535 objects | 17.2 MB |
| 1,048,575 objects | 276 MB |

The renderer keeps its own tables per scene place: the GPU-driven path counts 60 bytes per place (`BYTES_PER_SOURCE`). It resizes them at each rebuild of its draw tables already.

### What limits the ceiling

- Handles keep the slot in 20 bits, so a scene names at most 1,048,575 objects. No other code packs a slot into fewer bits.
- Every scene place counts toward the GPU's limit on objects and instance rows: 2,097,152 on every WebGPU device, and 1,048,576 on WebGL2 devices whose textures reach 2,048 texels. A growth stops at that limit, beside the instance batches' rows, and a growth past it fails with E1501, as a batch past it does.
- Memory: a growth to 1,048,575 objects holds 138 MB of old tables and 276 MB of new ones at once. A growth that memory cannot hold fails with E1109 and leaves the tables as they were.

So the ceiling is 1,048,575 objects. A larger ceiling would need more handle bits, and handles stay at 30 bits so that JavaScript engines store them in the value with no allocation.

### The cost of a growth

Pending: the time of each growth on the Mac, from the object growth test page's timing mode, and an estimate for the S24+ and the iPad from their usual ratio to the Mac.

## Options

- (a) Raise the fixed limit for everyone, to 32,767. Every engine then takes about 4.3 MB more of scene tables, plus the renderer's tables, from its start. A scene past 32,767 objects still fails.
- (c) A start option that sets the fixed limit. Scenes that leave it out keep 16,383. A game that misjudges its size fails with E1102 in play.
- (d) Tables that grow on demand, with an optional start size. A small scene keeps small tables. A larger scene grows, with a short pause per growth, or asks for its size at the start and never grows.

The owner chose (d) on 8 October 2026, at about 00:05.

## Decision

Option (d), built as follows.

- The tables start with room for 1,023 objects. A first draft kept 16,383, so that no scene that works today would ever grow. The coordinator asked for a small start instead, because the owner was told that small games stay small. The start costs 0.27 MB of scene tables, against 4.3 MB at 16,383. A growth's cost follows the size of the tables, so the growths from a small start cost little: see the timings. A scene loads its objects in its setup, where the growths do no harm. S2 creates its 5,096 objects in its setup, so its tables grow to 8,191 then, 62% full, and never grow in play. S1 draws one instance batch, and holds a few objects.
- Each growth doubles the room: 16,383, 32,767, 65,535 and so on. Each step keeps the row count a power of two.
- At the start of each frame, after the frame's changes apply, the scene grows when it holds more than three quarters of its room. Objects that the sketch then creates in play rarely find the scene full. A growth that fails there is not tried again until the room changes, so a full memory costs no work per frame.
- A create call that finds the scene full grows it at once. A call that creates many objects together, as `instantiate` does, grows the scene so that a quarter of its room stays free after it. The next frame then needs no second growth.
- `createEngine({ expectedObjects })` starts the tables with room for exactly that many objects. The scene then grows ahead of need only once it holds more than that number. A value that is not a whole number from 1 to 1,048,575 fails with E1213, as `maxLabels` does.
- A growth first makes room in every table, the renderer's included. Only once all of that succeeds does it change any table, so a growth that runs out of memory leaves the scene as it was.

### The thread that draws

The draw list of a frame points at the world matrices in place: the thread that draws copies them to the GPU when it replays the list. It can still be replaying frame `f` while the sketch thread steps frame `f + 1`. A growth in frame `f + 1` therefore moves the world buffers to new arrays and keeps the old pair. It frees them at the start of the second frame after the growth. By then the thread that draws has taken the frame after `f`, so it has finished frame `f`. Each growth marks the scene's structure changed, so the renderer rebuilds its tables at the new size and uploads every matrix again.

### The page's views

Every array moves in a growth, but the memory need not grow, so the memory's buffer does not change. The core therefore counts its moves of viewed arrays in a word of its own. The page's `CoreMemory.refresh` compares that count as well as the buffer. The calls that create objects and the frame's start already refresh, so every view is made again before its next use.

## Consequences

- The core: `SceneStorage::try_grow`, `SlotAllocator::grow`, `Bitset::grow` and `WorldArrays::try_grown`. The WebAssembly entry point grows the scene in `reserveObject`, `reserveObjects` and `beginFrame`.
- The page: the `expectedObjects` option, and views that refresh after a growth.
- Tests: Rust unit tests check a grown scene against one that started large, and the old world buffers' lifetime. The object growth browser test grows the tables during play on WebGPU, compatibility mode and WebGL2. It checks the pictures before and after against an engine that never grew.
- Docs: the scene's limits, the engine's options and memory, handles, and E1102's example. The skill's quick reference lists the option.
