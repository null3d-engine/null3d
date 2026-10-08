# D-103: Object tables that grow on demand

Status: decided by the owner on 2026-10-08 at about 00:05 (UTC+8): option (d), tables that grow. The coordinator set a small start at about 00:55, so that small games stay small. Timed on the Mac, the Galaxy S25 and the Pixel 9 on 2026-10-08. Date: 2026-10-08. Task: M2-L3 needs it.

Summary: The scene's object tables start with room for 1,023 objects, not 16,383. They double when the scene needs more, up to 1,048,575, the most that a handle names. A small scene's engine memory is 6.2 to 6.5 MB smaller. A growth copies 263 bytes per object: 1 ms from 16,383 to 32,767 objects in Chrome on the Mac, and 2.4 to 5.3 ms on the Galaxy S25 and the Pixel 9. It comes at a frame's start once the scene is three quarters full, or at a create call that finds it full. The `expectedObjects` option sizes the tables from the start.

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

The scene's storage keeps about 25 arrays and bitsets indexed by slot. They are positions, rotations, scales, bounds, parents, flags, meshes, materials, skins, morphs, layers, cells and depths. They also hold the hierarchy order and its levels, change stamps, seven bitsets and the slot allocator's tables. Two world buffers hold a matrix and a sphere per row. Together they take 263 bytes per object, and 275 bytes in large-world mode. A unit test in `scene.rs` counts every array, so the figure stays current.

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
- Every scene place counts toward the GPU's limit on objects and instance rows. The limit is 2,097,152 on every WebGPU device, and 1,048,576 on WebGL2 devices whose textures reach 2,048 texels. A growth stops at that limit, beside the instance batches' rows. A growth past it fails with E1501, as a batch past it does.
- Memory: a growth to 1,048,575 objects holds 138 MB of old tables and 276 MB of new ones at once. A growth that memory cannot hold fails with E1109 and leaves the tables as they were.

So the ceiling is 1,048,575 objects. A larger ceiling would need more handle bits. Handles stay at 30 bits, so that JavaScript engines store them in the value with no allocation.

### The engine memory of a small scene

The engine's WebAssembly memory after the first frame of a scene with one camera, from `engine.measure(0.5).memory.wasmBytes`, in Chrome 155 on the Mac, 3 runs each:

| GPU path | Room for 16,383 objects | Room for 1,023 objects (the new start) | Saved |
| --- | --- | --- | --- |
| WebGPU | 29.3 to 29.4 MB | 22.8 to 23.2 MB | 6.2 to 6.5 MB |
| WebGL2 | 30.1 to 30.2 MB | 23.9 MB | 6.2 MB |

The saving is larger than the scene tables' 4.0 MB, because the renderer's tables per scene place shrink too.

### The cost of a growth

Each create call that grew the tables, timed with `performance.now()` around the call, in Chrome 155 on the Mac (WebAssembly), 3 runs on each GPU path. The Mac's 1-minute load was 5.9 before the runs. The time holds the core's copy and the renderer's room for the new places. The rebuild of the draw tables at the next frame comes with any frame that creates objects, so it is not counted.

| Growth | WebGPU | WebGL2 |
| --- | --- | --- |
| 1,023 to 2,047 | 0.52 to 0.64 ms | 0.36 to 0.50 ms |
| 2,047 to 4,095 | 0.20 to 0.31 ms | 0.21 to 0.27 ms |
| 4,095 to 8,191 | 0.34 to 0.50 ms | 0.27 to 0.37 ms |
| 8,191 to 16,383 | 0.68 to 0.78 ms | 0.44 to 0.58 ms |
| 16,383 to 32,767 | 0.86 to 1.11 ms | 0.81 to 0.98 ms |
| 32,767 to 65,535 | 1.66 to 1.94 ms | 1.70 to 1.81 ms |

The core's copy alone took these times in a native release build on the Mac (`growth_times` in `scene.rs`, load 7.1). Each growth ended at the room given: 0.09 ms to 2,047, 0.36 ms to 16,383 and 0.60 ms to 32,767. It took 1.15 ms to 65,535, 2.04 ms to 131,071 and 4.14 ms to 262,143. The time doubles with the size, as a copy's does.

In Chrome the first growth took longer than the second in every run, and these runs do not show why. Every growth to 16,383 objects or fewer costs under 1 ms on the Mac.

The device runner's `object-growth` plan runs `tests/pages/object-growth.html?timing` three times on each GPU path, and its summary gives the tables above ([Device sessions](../devices.md#the-object-growth-plan)).

The plan's first run, in Chrome 155 on the Mac on 2026-10-08 at a 1-minute load of 7.7, passed 6 of 6 loads. It gave 0.98 to 1.07 ms on WebGPU and 0.91 to 0.97 ms on WebGL2 for the growth from 16,383 to 32,767 objects, and 1.55 to 1.83 ms and 1.62 to 1.87 ms for the growth to 65,535. Those agree with the table above. The growths to 8,191 objects or fewer took 0.06 to 0.37 ms, less than the table's, and the first growth again varied the most. The engine memory was 22.8 to 22.9 MB on WebGPU and 23.5 to 23.6 MB on WebGL2 with the default start, and 29.3 to 29.4 MB and 30.1 MB with room for 16,383 objects.

### The cost of a growth on phones

Before the phone runs, this record estimated that a phone copies 2 to 4 times slower than the Mac. That made a growth to 32,767 objects about 2 to 4 ms, and one to 65,535 about 4 to 8 ms. The `object-growth` plan replaced the estimates on 2026-10-08, in Chrome 152 on BrowserStack Automate. Both phones passed 6 of 6 loads: 3 on WebGPU and 3 on WebGL2. Each cell is the lowest to the highest of the 3 loads.

| Growth | S25, WebGPU | S25, WebGL2 | Pixel 9, WebGPU | Pixel 9, WebGL2 |
| --- | --- | --- | --- | --- |
| 1,023 to 2,047 | 0.20 to 1.48 ms | 0.25 to 1.01 ms | 0.32 to 1.95 ms | 0.54 to 2.13 ms |
| 2,047 to 4,095 | 0.19 to 0.35 ms | 0.18 to 0.19 ms | 0.34 to 0.58 ms | 0.25 to 1.02 ms |
| 4,095 to 8,191 | 0.19 to 0.37 ms | 0.20 to 0.25 ms | 0.32 to 0.49 ms | 0.23 to 0.64 ms |
| 8,191 to 16,383 | 0.43 to 0.71 ms | 0.42 to 0.53 ms | 0.66 to 1.73 ms | 0.67 to 1.07 ms |
| 16,383 to 32,767 | 2.84 to 3.28 ms | 2.35 to 2.44 ms | 4.22 to 5.24 ms | 3.52 to 5.30 ms |
| 32,767 to 65,535 | 4.10 to 4.88 ms | 4.42 to 5.17 ms | 5.91 to 9.63 ms | 8.98 to 10.17 ms |

The runs are `20261008-010432-object-growth` on the Galaxy S25 and `20261008-010728-object-growth` on the Pixel 9.

- The Galaxy S25 is inside both estimates: 2.35 to 3.28 ms to 32,767 objects, and 4.10 to 5.17 ms to 65,535.
- The Pixel 9 is above both. A growth to 32,767 objects took 3.52 to 5.30 ms, up to 1.3 ms more than the estimate. One to 65,535 took 5.91 to 10.17 ms, up to 2.2 ms more. Its times also spread more from load to load.
- Every growth to 16,383 objects or fewer took under 2.2 ms on both phones. As on the Mac, the first growth varied the most.

What the Pixel 9's times mean for a game: a frame at 60 Hz has 16.7 ms. A growth in play adds its time to the frame in which it comes. A growth to 65,535 objects takes up to 10.2 ms on the Pixel 9, so it uses more than half of that frame. If the sketch's own work fills the rest, that frame shows late, and the player sees one hitch. A growth to 32,767 takes up to 5.3 ms, about a third of a frame. Each growth doubles the room, so a scene that grows in play pauses once per doubling, not every frame. The rules of this record therefore stay. A game that creates its objects in its setup does not see the growths. A game that passes 16,383 objects during play should set `expectedObjects` to the size it will reach. Its tables then never grow in play.

The phones' engine memory with the default start was 9.2 to 11.1 MB, and 17.6 to 19.7 MB with room for 16,383 objects. The default start saved about 7.3 to 8.6 MB there. The engine's memory is smaller on the phones than on the Mac, and these runs do not show why.

## Options

- (a) Raise the fixed limit for everyone, to 32,767. Every engine then takes about 4.3 MB more of scene tables, plus the renderer's tables, from its start. A scene past 32,767 objects still fails.
- (c) A start option that sets the fixed limit. Scenes that leave it out keep 16,383. A game that misjudges its size fails with E1102 in play.
- (d) Tables that grow on demand, with an optional start size. A small scene keeps small tables. A larger scene grows, with a short pause per growth, or asks for its size at the start and never grows.

The owner chose (d) on 8 October 2026, at about 00:05.

## Decision

Option (d), built as follows.

- The tables start with room for 1,023 objects. A first draft kept 16,383, so that no scene that works today would ever grow. The coordinator asked for a small start instead, because the owner was told that small games stay small. The start saves 6.2 to 6.5 MB of engine memory. A growth's cost follows the size of the tables, so the growths from a small start cost under 1 ms each on the Mac. A scene loads its objects in its setup, where the growths do no harm. S2 creates its 5,096 objects in its setup. Its tables grow to 8,191 then, 62% full, and never grow in play. S1 draws one instance batch, and holds a few objects.
- A smaller start, such as 255, saves only 0.2 MB more and adds two more growths to every scene of a few thousand objects. A larger one, such as 4,095, costs 0.8 MB more in every small scene.
- Each growth doubles the room: 1,023, 2,047, 4,095 and so on. Each step keeps the row count a power of two.
- At the start of each frame, after the frame's changes apply, the scene grows when it holds more than three quarters of its room. Objects that the sketch then creates in play rarely find the scene full. A growth that fails there is not tried again until the room changes, so a full memory costs no work per frame.
- A create call that finds the scene full grows it at once. A call that creates many objects together, as `instantiate` does, grows the scene so that a quarter of its room stays free after it. The next frame then needs no second growth.
- The early growth comes at the frame's start because a growth during the sketch's update pauses the sketch's own code. At the frame's start it shares the frame with the changes that the frame applies.
- `createEngine({ expectedObjects })` starts the tables with room for exactly that many objects. The scene then grows ahead of need only once it holds more than that number. A value that is not a whole number from 1 to 1,048,575 fails with E1213, as `maxLabels` does.
- A growth first makes room in every table, the renderer's included. Only once all of that succeeds does it change any table, so a growth that runs out of memory leaves the scene as it was.

### The thread that draws

The draw list of a frame points at the world matrices in place. The thread that draws copies them to the GPU when it replays the list. It can still be replaying frame `f` while the sketch thread steps frame `f + 1`. A growth in frame `f + 1` therefore moves the world buffers to new arrays and keeps the old pair. It frees them at the start of the second frame after the growth. By then the thread that draws has taken the frame after `f`, so it has finished frame `f`. Each growth marks the scene's structure changed, so the renderer rebuilds its tables at the new size and uploads every matrix again. Before the core frees the old pair, it marks every row in it hidden. A replay that still read them would then draw nothing, which a test sees, in place of rows that look right.

The world buffers are not the only memory that the list of frame `f` points at. A growth also makes room in the renderer for the new places, for both frame parities. That moved three more kinds of list while the thread that draws could still read them:

- the culled index lists of each view, on the path that culls on the CPU;
- each view's sorted entries of blended rows;
- the upload arenas, which hold the bytes that a frame copies to the GPU.

Each of these now keeps a replaced buffer (`reserve_keeping` in the core's `alloc.rs`) until its parity is used again: the next cull, sort or arena reset. By then the thread that draws has finished the list that read it. The cost is one more buffer per list, held for a frame or two after a growth.

A new instance batch makes the same room in the renderer, so before this change a batch created during play could move an upload arena too. The kept buffers cover that case as well.

A replaced buffer is at least twice the old one, as a vector's own growth is. Each new batch reserves the arenas for a bound that follows the frame's pending mesh uploads, so the bound creeps up as models load. A first version took exactly the bound. The memory test that loads and destroys models 100 times then saw the engine's memory grow once by 1.2 to 1.8 MB, at a round between the 10th and the 100th. It failed 2 of 12 runs, and 9 of 12 with room for 16,383 objects from the start. Main passed 12 of 12. With the doubling, the branch passed 12 of 12 both ways, on 8 October 2026 on the Mac's GPU.

### The page's views

Every array moves in a growth, but the memory need not grow, so the memory's buffer does not change. The core therefore counts its moves of viewed arrays in a word of its own. The page's `CoreMemory.refresh` compares that count as well as the buffer. The calls that create objects and the frame's start already refresh, so every view is made again before its next use.

## Consequences

- The core: `SceneStorage::try_grow`, `SlotAllocator::grow`, `Bitset::grow` and `WorldArrays::try_grown`. The WebAssembly entry point grows the scene in `reserveObject`, `reserveObjects` and `beginFrame`.
- The page: the `expectedObjects` option, and views that refresh after a growth.
- Tests: Rust unit tests check a grown scene against one that started large, and the old world buffers' lifetime. The object growth browser test grows the tables during play on WebGPU, compatibility mode and WebGL2. It checks the pictures before and after against an engine that never grew. It also checks every frame drawn while the tables grow, in pipelined mode.
- The test runs with the `?replay-delay=50` switch. It makes the thread that draws wait 50 ms before it replays each frame's list, so the sketch thread steps the next frame, and grows the tables, first. Without the wait, the thread that draws copies the last frame's matrices long before the growth comes. A first version of the test then passed with the old world buffers freed at once, in 2 runs on each GPU path.
- The switch is for engine tests only, and counts from 1 to 1,000 ms. It busy-waits on the thread that draws, so a page with it runs slowly.
- Checks of the test on the Mac's GPU in Chrome 155, 8 October 2026, 3 runs on each GPU path:

| Build | Frames that showed neither picture | Result |
| --- | --- | --- |
| This branch | 0 in each of 9 runs | passes |
| The old world buffers freed at once | 2 on WebGPU and compatibility mode, 3 on WebGL2, in each of 9 runs | fails |
| Without the kept index lists, sorted entries and arenas | 2 on WebGPU; compatibility mode hung the page for over 30 minutes | fails |

- The Rust unit tests check the rules themselves: the old world buffers' lifetime, and that `reserve_keeping` keeps the old buffer in place.
- Docs: the scene's limits, the engine's options and memory, handles, and E1102's example. The skill's quick reference lists the option.
