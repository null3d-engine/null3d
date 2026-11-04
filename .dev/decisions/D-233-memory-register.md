# D-233: A memory register for the stats overlay

Status: decided and built. Task: M3-R3.

Summary: Each engine table and allocator reports the bytes that it reserves, uses and has used at most. The stats overlay's card lists these areas by system, in a development build. A report allocates nothing and runs only while the card shows, so a shipped page pays no frame time for it. On Battle, the rows that D-130 measured reproduce its per-object figures to the byte. They are 263 for the scene's rows, 17 for the cells, 12 for the levels and 48 for the bucket keys.

## Question

Without a register, the overlay shows one engine memory figure: the WebAssembly memory's size, and D-130's per-object study is done by hand. Which tables own the memory? How does the overlay show each one's reserved, used and peak bytes, without costing a page that does not look?

## Rule

- Every table and allocator reports `reserved` (the bytes its arrays hold), `used` (the part that holds values) and `peak` (the most it has used). An allocator that reuses its memory every frame reports its own high-water mark. A report on a quiet frame then still shows the busy one.
- A report allocates nothing, takes no lock and touches no GPU resource. It runs only while the overlay's card is open and only in a development build.
- The figures must agree with D-130's method within 5%. At two scene sizes, divide a table's growth by the objects between them. That figure must match a hand measurement of the table.

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

Battle on the Mac, Chrome, WebGPU, the High preset, every effect on. Each run measured at a fixed count with `tests/pages/compare.html?compare=battle&engine=null3d&gpu=webgpu&measure=<count>&seconds=12&warmup=2`, the overlay's card opened, and each row's exact bytes read from its tooltip:

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

How the data was produced: two runs of the comparison page in the worktree's development server, through `heavy.sh`. One ran at 1,500 units and one at 3,000. `battleObjects` gives the objects at each count. The engine's WebAssembly memory comes from the page's own measurement over each run.

- The four rows that D-130 measured on the Factory scene match to the byte. The scene's rows take 263 B per object against 263, the cells 17 against 17, and the levels 12 against 12. The bucket keys take 48 against the 48 of D-130's one shared table. The register uses D-130's method: two scene sizes, and the bytes between them. A shared table therefore appears once.
- The instance batches keep the capacity the page asked for at both counts. Their row does not grow. The animation table grows with the units, not the objects. Each unit has a skeleton and a joint buffer of its own.
- The upload arenas and the shadow casters' layout reserve room for what the frame records. Their shares therefore depend on the scene and the GPU path. Here they take 80 B per object against D-130's 40, because the builder also reserves each source's uniform and indirect-draw tables. A reader compares their level across scenes, not their share.
- The register's live tables hold 15.6 MB of the 27.7 MB that the engine's WebAssembly memory gained. The rest is the heap that tables which grew during setup kept. WebAssembly memory never shrinks, so the buffers that a growing table replaced stay in it. D-130 saw the same remainder and called it the rest, beyond the tables it named. No live table can report that memory. The register therefore reports what each table holds now, and the WebAssembly figure beside it shows what the heap holds.

### The hand check

The rule above asks for a hand measurement of each table. Two proofs stand beside each other. The test proves the five per cent match for each figure that it hand counts. The Battle run above proves that the card lists the rows on the scene the task names.

**Upload arenas.** The hand count is the byte lengths of the frame's own write commands, which the draw list records. The count covers every write that the frame records, not only a copy from the upload arena. In the test's scenes every write copies from the arena. A light table or an image may write from its own bytes instead, and the count would include that too. Each copy into an arena is one write command, and the arena holds those bytes, padded to four. The row counts both frame parities, and each arena keeps the frame it recorded last.

The test settles a scene at 512 and 1,024 scene slots, with 504 and 1,016 casting objects. On the WebGPU path the used arenas hold 8,560 bytes, against 8,368 bytes of write commands, at both sizes. The difference is 2.3 per cent. It is the list of volatile ranges that the still-camera comparison tracks, which are offsets into the bytes rather than copies. The WebGL2 path compares 736 bytes with 736, at both sizes. The used figure does not grow between the two sizes. A settled frame rebuilds no layout table, and each batch's rows upload from their own storage. The hand count is therefore the same at both sizes, and the check proves the measure rather than a per-object share.

The register reserves each arena's bound ahead of the frame, so the reserved figure is larger than the bytes a settled frame writes. The bound reserves each source's uniform and indirect-draw tables, which the frames do not always fill. The test asserts that the reserved and peak figures cover the used bytes. It does not hand count the reserved figure. On Battle the row's reserved bytes grow by 366,240 between the two sizes, or 80 B for each added object. That is twice D-130's 40 B per object, as the Data section says. The row's used bytes are the frame's own copies, and the test holds them to that measure at both sizes.

**Shadow casters.** The row is the casters' draw layout. Its tables that grow with the scene's slots take a fixed number of words for each slot. The test's scenes grow from 512 to 1,024 slots. The WebGPU path keeps three words for each slot: the source's bucket entry, its home bucket and its culling bucket. It measures 6,144 bytes against the hand's 6,144. The WebGL2 path keeps one word for each slot, and measures 2,048 against 2,048. The row also holds each casting mesh's bucket and draw records, which grow with those meshes and not with the objects. The test's casters share one mesh, so those records are equal at both sizes and cancel in the growth. The row also holds a skinned object's bounds and first row. The test's casters are unskinned, so those tables stay empty and the check does not cover them. The hand count therefore covers the three per-slot tables alone.

D-130's 88 to 142 B per object is a hand inventory of shadow-caster memory. D-130 does not say which tables that inventory covered. The register's row names the casters' draw layout alone, and the shadow culling tables and the per-view index lists are not areas. The two figures are not a discrepancy, because they measure different sets. The register's row matches its own tables, which is what the rule asks.

**The card's readings.** A run at commit `147c3093e`, on engine source `a3bbedbb5`, opened the card in a development build of the Battle comparison at 1,500 units. It ran in Chrome on the Apple M5 Max, on the WebGPU path at the High preset. Five readings agree to the one decimal the card shows: scene, cells, levels, bucket keys reserved and animation. Four reserved figures miss by a tenth of a mebibyte or more: draw tables, shadow casters, instances and draw lists. The record claims no match for any of them. The card rounds every figure to one decimal of a mebibyte. The reading came from the visible text, not from the tooltip's exact bytes. The Data table also labels only two of its cells by measure, and the rest carry no label. The run is a later build than the table, with 95.1 MiB of WebAssembly memory against the table's 94.8. The run proves that the card lists every area on the named scene.

## Decision

The register reports each live table's reserved, used and peak bytes, and the card lists them by system. It meets the rule. On Battle the four rows whose share is fixed reproduce D-130's per-object figures to the byte, and the upload arenas and the shadow casters measure sets of their own, as the hand check shows. A report allocates nothing. A page that does not show the card never asks for a report. The WebAssembly figure beside the rows keeps the memory that no live table holds. A reader then sees both what the tables hold and what the heap holds.

## Consequences

- `crates/null3d-core/src/memory.rs` holds the register, its areas and its bytes type. Each table adds an `account` method in its own module, so the register reads no private field.
- The areas are named in `packages/engine/src/shared/memory-area.ts`, in the core's order. A new area takes a constant in both files and one `account` call.
- The sketch thread fills the register while the page's card is open. It publishes three numbers per area in the metrics buffer's header, beside the memory figures. The card's `Memory by system` section shows them, and `debug.frameStats().memoryAreas` gives them to a sketch.
- A production build defines no development flag, so the runner never asks for a report and the area rows stay hidden.
- The material, mesh and texture tables and the CPU culling scratch of the WebGL2 path are not areas. They scale with the content and the path rather than with the scene's objects, so D-130's per-object comparison did not name them. A later area takes a constant, a name and an `account` call.
