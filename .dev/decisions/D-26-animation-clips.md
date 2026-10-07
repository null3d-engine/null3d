# D-26: How clips are stored, sampled and blended

Status: decided by its rule on 2026-10-03; the iPad timings are in, and the phone timings are pending. Changed by the owner on 2026-10-05: a track that moves by under a millionth counts as constant ([Near-constant tracks](#near-constant-tracks-5-october-2026)). Date: 2026-10-03. Tasks: M2-C1, and M2-B7 for the change.

Summary: Keys at one rate per clip, 30 per second unless the file's own grid is coarser; rotations in 16 bits per component; a track that moves by under a millionth stored once; blends as three.js's mixer, joint by joint. Poses stay within 1.0e-4 of three.js, skinning matrices within 3.6e-4.

## Question

How should the core store, sample and blend animation clips? Sampling a crowd on the job workers must be cheap, and poses must match three.js's `AnimationMixer`.

The plan fixes the outline. Keys sit at a fixed rate per clip, rotations take 16 bits per component, and constant tracks are stored once. Joints are laid out by field for SIMD, and rotations use normalized linear interpolation. This record settles the details that the outline leaves open, with the data behind each.

## Rule

- Poses match three.js's `AnimationMixer` and `Skeleton` on the test skeleton: each local translation, scale and quaternion component within 2e-4, and each skinning matrix element within 1e-3.
- A clip takes no more memory than three.js's clip of the same keys.
- A frame of sampling allocates nothing.

## Data

### Accuracy against three.js

`bun bench/three-fixtures.ts` builds a skeleton of 8 joints in three.js. One rest rotation is near a half turn, and one scale differs per axis. It also builds three clips: keys every thirtieth of a second, keys every 24th, and keys at uneven times. The clips hold linear and step tracks, constant tracks, a joint that no track moves, and a key stored negated. The script records what `AnimationMixer` and `Skeleton.update` give in 18 cases. The cases are the rest pose, single clips at chosen times, and blends of two and three clips. `crates/null3d-core/tests/animation.rs` runs the same cases through the core.

| Measure | Largest difference from three.js | Tolerance |
| --- | --- | --- |
| Local translation, scale or quaternion component, single clips | 1.0e-4 | 2e-4 |
| Skinning matrix element, all 18 cases, with 0 and with 3 job workers | 3.6e-4 | 1e-3 |

### Rotations between keys and in blends

Normalized linear interpolation (nlerp) moves too slowly near the ends of an arc and too fast in the middle. The table gives the largest rotation error against `slerp` over every weight from 0 to 1, for two rotations an angle apart. A polynomial fit to that drift corrects the weight (Arseny Kapoulkine, "Approximating slerp", 2015).

| Rotations apart | Plain nlerp | Corrected nlerp |
| --- | --- | --- |
| 0.1 rad | 4.0e-6 rad | 9.2e-6 rad |
| 0.2 rad | 3.2e-5 rad | 1.8e-5 rad |
| 0.5 rad | 5.0e-4 rad | 3.3e-5 rad |
| 1 rad | 4.1e-3 rad | 3.3e-5 rad |
| 2 rad | 3.4e-2 rad | 7.7e-5 rad |
| 3.14 rad | 1.4e-1 rad | 7.8e-4 rad |

At 30 keys per second, a joint that turns at 6 rad/s moves 0.2 rad between keys. Two clips in a blend can hold a joint 2 rad apart or more.

### Blends

A first version summed every clip's quaternions by weight and normalized once. It also let every clip count for every joint, holding the rest pose where it had no track. Against three.js, a blend of two clips at 0.6 and 0.4 differed by 0.028 in a skinning matrix. A blend at 0.7 and 0.7 differed by 0.56. The second clip moved no spine joint, yet it pulled the spine halfway to its rest pose. three.js counts a clip's weight only for the properties it has tracks for.

### Memory per key

| Track | null3D | three.js |
| --- | --- | --- |
| Rotation key | 8 bytes: four 16-bit integers | 20 bytes: four 32-bit floats and a 32-bit time |
| Translation or scale key | 12 bytes | 16 bytes |
| Constant track | Stored once, in the clip's base pose | Every key |

The core shares one time base across a clip's tracks, so a key needs no time of its own.

### Speed

`bench_animation_crowd` in `crates/null3d-core/tests/bench.rs` times the frame step natively for characters of 48 joints, each blending two clips. One short run on the Mac (MacBook Pro M5 Max, 3 October 2026), while other work ran:

| Characters | 1 thread | 2 threads | 4 threads | 8 threads |
| --- | --- | --- | --- | --- |
| 100 | 0.090 ms | 0.054 ms | 0.030 ms | 0.018 ms |
| 500 | 0.38 ms | 0.17 ms | 0.094 ms | 0.062 ms |

These are medians of 500 frames. Treat them as a rough guide only: the Mac was shared.

The [animation plan](../devices.md#the-animation-plan) times the same step in WebAssembly, on the engine's job workers, for the same characters. One run on the iPad Pro 11-inch in Safari 26.6.2, on 3 October 2026, gave the figures below. It used 6 job workers and timed 240 frames per crowd. The iPad was warm from earlier runs.

| Characters | Step median | Step p90 | Step mean | Job worker time per frame, all workers |
| --- | --- | --- | --- | --- |
| 100 | 0.12 ms | 0.14 ms | 0.12 ms | 0.29 ms |
| 500 | 0.38 ms | 0.44 ms | 0.40 ms | 1.78 ms |

The step is the time on the core's thread from waking the job workers until the update call returns. It includes setting every character's clip times. A crowd of 500 thus takes about 2% of a 60 Hz frame of 16.7 ms. The figures for the S24+ are still to come.

How the data was produced: `bun bench/three-fixtures.ts`, then `cargo test -p null3d-core --test animation -- --nocapture`. The nlerp table came from a script that compares both interpolations with `slerp` on a grid of 901 angles and 201 weights. The speed came from `cargo test -p null3d-core --release --test bench bench_animation_crowd -- --ignored --nocapture --test-threads=1`.

## Decision

- Key rate. A clip keeps the grid of its source keys when every key lies on one grid of at most 30 keys per second. Files exported at 24, 25 or 30 frames per second then lose nothing. A clip whose end lies within a thousandth of a frame past a whole frame ends on that frame. Its end is a 32-bit float, and D-35 found clips that a millionth did not cover. Other clips take 30 keys per second, adjusted so that the last key falls on the clip's end. A finer grid such as 60 keys per second becomes 30, which halves its memory.
- Rotations. Four signed 16-bit integers per key, the quaternion times 32767. One step is 3.1e-5. Resampling turns each key into the hemisphere of the key before, so interpolation never takes the long way round. Sampling normalizes the result, which also removes the scale. The smallest-three layout of 48 bits would save 2 bytes a key, a quarter of the rotation memory. But each sample would then rebuild the largest component with a square root and move it into place. It would do so for every joint, in the loop where a crowd spends its time. That layout was not measured.
- Between keys, plain nlerp, as the plan says. At 30 keys per second it stays within 3.2e-5 rad of `slerp` up to 6 rad/s. [D-35](D-35-gltf-animation.md) found sample files that turn joints much faster, up to 1.5 radians between keys. Sampling now uses the corrected nlerp that blends use, for tracks that turn more than 0.2 rad between keys. That brought this record's fixtures to 2.1e-5 in a pose and 1.7e-4 in a skinning matrix.
- Blends follow three.js's mixer, joint by joint and channel by channel. Each clip with a track there moves the blend so far by its share of the weight so far. Below a total weight of 1, the rest pose makes up the remainder. Rotations blend with the corrected nlerp, which stays within 7.7e-5 rad of `slerp` up to 2 rad apart.
- Step tracks take the key at or before the time. Linear tracks interpolate. Cubic spline tracks follow glTF's curve, which the resampler evaluates as three.js's `GLTFLoader` does ([D-35](D-35-gltf-animation.md)). A key within a millionth of a frame's time counts as reached. A clip's key times are 32-bit floats, which can round up past the frame time that resampling computes. Without that, a step track on its own grid took the key before ([D-28](D-28-animator.md) found it).
- Constant tracks. A constant track goes into the clip's base pose with its first key. A track is constant when no key moves from the first by a millionth of the track's largest value or more. For a track whose values all lie within 1, the limit is a millionth. A rotation compares as a quaternion, with each key's sign turned to the first key's, so q and -q count as the same. A rotation whose keys all round to the same 16-bit integers is constant too. Until 5 October 2026 a track was constant only when every key equalled the first exactly. The owner changed that on 5 October 2026 ([Near-constant tracks](#near-constant-tracks-5-october-2026)).
- Each animated object had 4 sample slots: a clip, a time and a weight each. [D-28](D-28-animator.md) raised them to 8, with layers, and gave each slot its play state.
- Output: one row-major 3 × 4 skinning matrix of 48 bytes per joint, with the inverse bind matrix applied. The joints compose in index order, so a skeleton lists its joints parents first.
- The frame step runs one parallel loop over the animated objects, 4 to a chunk. Each thread samples into scratch memory of its own, sized when a skeleton is added, so the step allocates nothing.

The data meets the rule: 1.0e-4 against 2e-4 and 3.6e-4 against 1e-3, less memory per key than three.js, and no allocation in the no-allocation test.

## Near-constant tracks, 5 October 2026

The owner ruled on 5 October 2026: a track whose values change by under a millionth counts as constant and keeps one key. Before, the core stored a track once only when every key equalled the first exactly. That meant the same 32-bit float, or for a rotation the same 16-bit integers.

The reason: exporters leave rounding noise in tracks that never move. Prototype A2 tested the asset tool's clip step ([D-18](D-18-asset-tool.md#the-clip-step-5-october-2026)). It found such noise in 459 of the KayKit Knight's 3,114 translation tracks and 519 of its 2,482 scale tracks. Each of those tracks kept a key per frame. Noise of a millionth does not show in a pose, so it should not cost file size or sampling time.

The rule lives in the core, in `resample`, so it holds for every file the loader reads. The asset tool calls the core's `bake`, so it follows the same rule. A clip the core builds from the tool's file thus still equals the clip it builds from the source file, key for key.

### The tolerance

The tolerance is a millionth of the track's largest value, or a millionth when every value lies within 1. That is the form the prototype measured. A translation of 400 units may then move by up to 4e-4 and still count as constant. That is a millionth of the value, and [D-35](D-35-gltf-animation.md) measures translations against the model's largest translation. Rotations are unit quaternions, so their tolerance is a millionth of a component, against 2e-4 in this record's rule.

A tolerance relative to the track's own spread cannot work. A track's largest move from its first key is always at least half its spread, so no track would pass.

### Data

The KayKit Knight, after the asset tool, on the Mac on 5 October 2026. The binary part of the `.glb` after Brotli at quality 11:

| | Exact constants | Near-constant rule |
| --- | --- | --- |
| Binary part after Brotli | 455,487 B | 404,663 B (-50,824 B, -11%) |
| JSON part after Brotli | 42,115 B | 41,047 B |
| Translation tracks with one key, of 3,114 | 2,102 | 2,561 |
| Scale tracks with one key, of 2,482 | 1,952 | 2,471 |
| Rotation tracks with one key, of 3,116 | 1,749 | 1,749 |
| Tracks with a key per frame, which sampling reads | 2,909 | 1,931 |

The prototype measured 404,598 B for the same rule outside the core. gltfpack 1.3 with `-c` gives 434,451 B. Of the other sample models, only RiggedSimple (1,443 B to 1,201 B) and RiggedFigure (5,568 B to 5,551 B) changed.

Poses: the `gltf-poses` test plays all 7 pose models, from the source and after the tool, against three.js r186. Every figure stayed as it was before the change, to three significant digits, in Chrome on the Mac's GPU and in SwiftShader. The Knight after the tool differs by 6.65e-5 in a skinning matrix's rotation and scale and 4.08e-5 in translation, against limits of 1e-3. All 14 loads pass, and the tool's 7 load with 0 clips resampled.

How the data was produced: `node packages/cli/bin/null3d.js assets optimize` ran on the sample models before and after the change. One script compressed each file's chunks with Brotli, and one counted each file's one-key channels by path. The poses came from `cd tests && bunx playwright test image/gltf-poses.spec.ts`, with `--project=chrome-real-gpu` and with `CI=1 --project=chromium-swiftshader`.

The test `tracks_that_move_under_a_millionth_count_as_constant` in `crates/null3d-core/tests/animation.rs` checks the edges. A track that moves by 0.9 of the tolerance is stored once, and one that moves by 1.1 of it keeps its keys. It checks translations, scales past 1, and rotations of either sign.

### What it changes

- Files that the tool wrote before the change keep their noisy keys until they are written again. The Vite plugin's cache keys its files by the tool's version, the options and the model's files. So a project must clear `node_modules/.cache/null3d-assets` once to get the smaller files.
- A clip stores fewer animated tracks, so a frame samples fewer joint groups.

## How three.js handles it

A three.js clip keeps each track's key times and values as 32-bit floats. Each frame, each action's interpolants find the keys around the time, then `slerp` the quaternions. A `PropertyMixer` per property blends the actions in turn, each by its share of the weight so far. It fills a weight below 1 with the original value. Then the scene graph updates each bone's world matrix, and `Skeleton.update` multiplies in the inverse bind matrices. All of it runs on the main thread, one bone at a time. null3D keeps the mixer's blending rules, so poses match. It stores keys at a fixed rate, so the keys around a time are a direct index. It samples four joints per SIMD operation, and spreads the characters across the job workers.

## Consequences

- `crates/null3d-core/src/animation/` holds skeletons, clips, resampling and the frame step. The WebAssembly entry point exposes them to the animation test page. The animator (M2-C2) builds its API on the sample slots, as [D-28](D-28-animator.md) records.
- The glTF loader (M2-C7) calls `resample` on a job worker when it reads a file, and converts cubic spline input there. A track whose keys already lie on the clip's frames is copied, not evaluated, as the asset tool writes every track ([D-18](D-18-asset-tool.md#clips)). The copy keeps a key's 16-bit integers when the key's length lies within a few steps of 1.
- The skinning passes (M2-C3, M2-C4) read the 48-byte matrices.
- The phone timings come from the animation plan. Add them to this record when it runs on the S24+.
- The record is in the table in [README.md](README.md).
