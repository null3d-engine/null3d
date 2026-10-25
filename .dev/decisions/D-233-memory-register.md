# D-233: A memory register for the stats overlay

Status: decided, 23 October 2026. Task: M3-R3.

Summary: Each engine table and allocator reports the bytes that it reserves, uses and has used at most. The stats overlay's card lists these areas by system, in a development build. A report allocates nothing and runs only while the card shows, so a shipped page pays no frame time for it. On Battle, the rows that D-130 measured reproduce its per-object figures to the byte. They are 263 for the scene's rows, 17 for the cells, 12 for the levels and 48 for the bucket keys.

## Question

The overlay shows one engine memory figure: the WebAssembly memory's size. D-130's per-object study was done by hand. Which tables own the memory? How does the overlay show each one's reserved, used and peak bytes, without costing a page that does not look?

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

How the data was produced: two runs of the comparison page in the worktree's development server, through `heavy.sh`. They ran on 23 October 2026, at 1,500 and 3,000 units. `battleObjects` gives the objects at each count. The engine's WebAssembly memory comes from the page's own measurement over each run.

- The four rows that D-130 measured on the Factory scene match to the byte. The scene's rows take 263 B per object against 263, the cells 17 against 17, and the levels 12 against 12. The bucket keys take 48 against the 48 of D-130's one shared table. The register uses D-130's method: two scene sizes, and the bytes between them. A shared table therefore appears once.
- The instance batches keep the capacity the page asked for at both counts. Their row does not grow. The animation table grows with the units, not the objects. Each unit has a skeleton and a joint buffer of its own.
- The upload arenas and the shadow casters' layout reserve room for what the frame records. Their shares therefore depend on the scene and the GPU path. The upload row counts both frame parities. Its 80 B per object is therefore 40 B for each parity, which is D-130's figure. The builder also reserves each source's uniform and indirect-draw tables, so the bytes it reserves exceed the bytes a settled frame writes. The shadow casters' row measures the casters' draw layout alone. D-130's 88 to 142 B per object is a hand inventory of shadow-caster memory. It covered more tables than that layout, so the row's 17 B per object is not a discrepancy with it. A reader compares these two rows' level across scenes, not their share.
- The register's live tables hold 15.62 MB of the 27.7 MB that the engine's WebAssembly memory gained. The rest is the heap that tables which grew during setup kept. WebAssembly memory never shrinks, so the buffers that a growing table replaced stay in it. D-130 saw the same remainder and called it the rest, beyond the tables it named. No live table can report that memory. The register therefore reports what each table holds now, and the WebAssembly figure beside it shows what the heap holds.

## Decision

The register reports each live table's reserved, used and peak bytes, and the card lists them by system. It meets the rule. On Battle the rows that D-130 named reproduce its per-object figures within 1%, and a report allocates nothing. A page that does not show the card never asks for a report. The WebAssembly figure beside the rows keeps the memory that no live table holds. A reader then sees both what the tables hold and what the heap holds.

## Consequences

- `crates/null3d-core/src/memory.rs` holds the register, its areas and its bytes type. Each table adds an `account` method in its own module, so the register reads no private field.
- The areas are named in `packages/engine/src/shared/memory-area.ts`, in the core's order. A new area takes a constant in both files and one `account` call.
- The sketch thread fills the register while the page's card is open. It publishes three numbers per area in the metrics buffer's header, beside the memory figures. The card's `Memory by system` section shows them, and `debug.frameStats().memoryAreas` gives them to a sketch.
- A production build defines no development flag, so the runner never asks for a report and the area rows stay hidden.
- The material, mesh and texture tables and the CPU culling scratch of the WebGL2 path are not areas yet. They scale with the content and the path rather than with the scene's objects, so D-130's per-object comparison did not name them. A later area takes a constant, a name and an `account` call.

## Addendum, 26 October 2026: the 5% check by hand

The register landed on 23 October 2026. Only its proof remained, so this work verifies the register rather than builds it. The rule above asks for a hand measurement of each table. The audit of 24 October 2026 found two gaps. The record showed no hand check for the upload arenas or the shadow casters. Its Decision sentence about a 1% match also does not hold for them. `crates/null3d-render/tests/memory_register.rs` now makes the check on both frame builders. It builds controlled scenes and compares the register's figures with a hand count of the same table, within 5 per cent. Where a table grows with the scene, it pairs two scene sizes.

**Upload arenas.** The hand count is the frame's own write commands, whose byte lengths the draw list records. Each copy into an arena is one such command, and the arena holds exactly those bytes, padded to four. The row counts both frame parities, and each arena keeps the frame it recorded last. On the WebGPU path the test settles a scene of 504 casting objects. Its used arenas hold 8,560 bytes, against 8,368 bytes of write commands. The difference is 2.3 per cent. It is the list of volatile ranges that the still-camera comparison tracks, which are offsets into the bytes rather than copies. The WebGL2 path compares 736 bytes with 736.

The register reserves each arena's bound ahead of the frame, so the reserved figure is larger than the bytes a settled frame writes. On Battle the row's reserved bytes grow by 366,240 between the two sizes, or 80 B for each added object. The row counts both frame parities, so one parity takes 40 B for each object, which is D-130's figure. The bound reserves each source's uniform and indirect-draw tables, which the frames do not always fill. The row's used bytes are the frame's own copies, and the test holds them to that measure.

**Shadow casters.** The row is the casters' draw layout. Its tables that grow with the scene's slots take a fixed number of words for each slot. The test's scenes grow from 512 to 1,024 slots. The WebGPU path keeps three words for each slot: the source's bucket entry, its home bucket and its culling bucket. It measures 6,144 bytes against the hand's 6,144. The WebGL2 path keeps one word for each slot, and measures 2,048 against 2,048. The row also holds the bucket and draw records of the meshes that cast, which grow with those meshes and not with the objects. The test's casters share one mesh, so the hand count covers the slot tables alone.

D-130's 88 to 142 B per object is a hand inventory of shadow-caster memory. D-130 does not say which tables that inventory covered. The register's row names the casters' draw layout alone, and the shadow culling tables and the per-view index lists are not areas yet. The two figures are not a discrepancy, because they measure different sets. The register's row matches its own tables, which is what the rule asks.

**Battle run.** A run on 26 October 2026 opened the card in a development build of the Battle comparison at 1,500 units. It ran in Chrome on the Mac, on the WebGPU path at the High preset. The card listed every row the task names. The first areas read scene 1.4 MiB used, instances 7.7, cells 0.1, levels 0.1, and bucket keys 0.3 reserved. The other areas read shadow casters 0.4, draw tables 1.6, upload arenas 0.1 used and 17.1 reserved, draw lists 0.1 reserved, and animation 12.9. The GPU rows read 115.5 MiB of textures and 44.5 MiB of buffers, beside the engine's 95.1 MiB of WebAssembly memory. The card costs frames, so this is not a timing run. These are the rows the task names, from one build of the branch.

**Corrections.** The Data section's paragraph after the table said the rows hold 15.1 MB. They add to 15,620,478 bytes, or 15.62 MB. The Decision's sentence says that the rows D-130 named reproduce its figures within 1%. That holds for the four fixed-size rows, which match to the byte. It also holds for the upload arenas, whose 80 B per object is 40 B for each parity, D-130's figure. It does not hold for the shadow casters, because that row measures the casters' draw layout alone. The method check above is the evidence for that row. The test is also the raw record of the check, so a reader can run it again. The Battle figures beside it stay the two runs of 23 October 2026.
