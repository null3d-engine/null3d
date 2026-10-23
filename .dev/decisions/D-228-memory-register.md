# D-228: A memory register for the stats overlay

Status: decided, 23 October 2026. Task: M3-R3.

Summary: Each engine table and allocator reports the bytes that it reserves, uses and has used at most when the stats overlay's card is open in a development build, and the card lists the areas by system. A report allocates nothing and runs only while the card shows, so a shipped page pays no frame time for it. On Battle the rows that D-130 measured reproduce its per-object figures to the byte: the scene's rows 263, the cells 17, the levels 12 and the bucket keys 48.

## Question

The overlay shows one engine memory figure, the WebAssembly memory's size, and D-130's per-object study was done by hand. Which tables own the memory, and how does the overlay show each one's reserved, used and peak bytes without costing a page that does not look?

## Rule

- Every table and allocator reports `reserved` (the bytes its arrays hold), `used` (the part that holds values) and `peak` (the most it has used). An allocator that reuses its memory every frame reports its own high-water mark, so a report that lands on a quiet frame still shows the busy one.
- A report allocates nothing, takes no lock and touches no GPU resource. It runs only while the overlay's card is open and only in a development build.
- The figures must agree with D-130's method within 5%: at two scene sizes, a table's growth divided by the objects between them must match the per-object figure of a hand measurement of that table.

## Data

The areas cover the tables that D-130's study named, plus the animation table, which a skinned scene such as Battle fills:

| Area | What it holds |
| --- | --- |
| `scene` | The scene's rows, its slot allocator, its bitsets and both world buffers |
| `instances` | Every instance batch's rows, world output and the batch table |
| `cells` | The core's cell table and the frame builder's cell order |
| `levels` | The scene's level-of-detail table |
| `bucket keys` | The frame builder's shared scratch for a layout rebuild |
| `shadow casters` | The casters' draw layout |
| `draw tables` | The other draw layouts and their object ranges |
| `upload arenas` | The upload arenas of both frame parities, with their high-water marks |
| `draw lists` | The recorded draw lists and the still-camera snapshots |
| `animation` | Skeletons, clips, animated instances and their joint matrices |

Battle on the Mac, 23 October 2026, Chrome, WebGPU, the High preset, every effect on. Each run measured at a fixed count with `tests/pages/compare.html?compare=battle&engine=null3d&gpu=webgpu&measure=<count>&seconds=12&warmup=2`, the overlay's card opened, and each row's exact bytes read from its tooltip:

| Row | 1,500 units, 4,604 objects | 3,000 units, 9,182 objects | Bytes per object added | D-130's figure |
| --- | --- | --- | --- | --- |
| `scene` | 1,481,834 | 2,687,030 | 263 | 263 |
| `instances` | 8,115,602 | 8,115,602 | 0 | not measured |
| `cells` | 124,361 | 202,187 | 17 | 17 |
| `levels` | 67,560 | 122,496 | 12 | 12 |
| `bucket keys`, reserved | 271,344 | 491,088 | 48 | 48 |
| `shadow casters` | 467,033 | 545,729 | 17 | 88 to 142 |
| `draw tables` | 1,718,468 | 1,924,916 | 45 | not measured |
| `upload arenas`, reserved | 17,859,976 | 18,226,216 | 80 | 40 |
| `draw lists` | 19,136 | 20,224 | 0 | not measured |
| `animation` | 13,496,772 | 26,907,076 | 8,940 per unit | not measured |
| Engine WebAssembly memory | 99,418,112 | 127,074,304 | 6,041 | the method |

How the data was produced: two runs of the comparison page in the worktree's development server, through `heavy.sh`, on 23 October 2026, at 1,500 and 3,000 units. `battleObjects` gives the objects at each count. The engine's WebAssembly memory comes from the page's own measurement over each run.

- The four rows that D-130 measured on the Factory scene match to the byte: the scene's rows 263 B per object against 263, the cells 17 against 17, the levels 12 against 12, and the bucket keys 48 against the 48 of the one shared table that D-130's rule made. The register uses D-130's method, two scene sizes and the bytes between them, so a shared table appears once.
- The instance batches keep the capacity the page asked for at both counts, so their row does not grow. The animation table grows with the units, not the objects: each unit has a skeleton and a joint buffer of its own.
- The upload arenas and the shadow casters' layout reserve room for what the frame records, so their shares depend on the scene and the GPU path: 80 B per object here against D-130's 40, because the builder also reserves each source's uniform and indirect-draw tables. Their level, not their share, is what a reader compares across scenes.
- The register's live tables hold 15.1 MB of the 27.7 MB that the engine's WebAssembly memory gained. The rest is the heap that tables which grew during setup kept: WebAssembly memory never shrinks, so the buffers that a growing table replaced stay in it. D-130 saw the same remainder and called it the rest, beyond the tables it named. No live table can report that memory; the register therefore reports what each table holds now, and the WebAssembly figure beside it shows what the heap holds.

## Decision

The register reports each live table's reserved, used and peak bytes, and the card lists them by system. It meets the rule: on Battle the rows that D-130 named reproduce its per-object figures within 1%, a report allocates nothing, and a page that does not show the card never asks for one. The WebAssembly figure beside the rows keeps the memory that no live table holds, so a reader can see both what the tables hold and what the heap holds.

## Consequences

- `crates/null3d-core/src/memory.rs` holds the register, its areas and its bytes type. Each table adds an `account` method in its own module, so the register reads no private field.
- The areas are named in `packages/engine/src/shared/memory-area.ts`, in the core's order. A new area takes a constant in both files and one `account` call.
- The sketch thread fills the register while the page's card is open and publishes three numbers per area in the metrics buffer's header beside the memory figures. The card's `Memory by system` section shows them, and `debug.frameStats().memoryAreas` gives them to a sketch.
- A production build defines no development flag, so the runner never asks for a report and the area rows stay hidden.
- The material, mesh and texture tables and the CPU culling scratch of the WebGL2 path are not areas yet. They scale with the content and the path rather than with the scene's objects, so D-130's per-object comparison did not name them. A later area takes a constant, a name and an `account` call.
