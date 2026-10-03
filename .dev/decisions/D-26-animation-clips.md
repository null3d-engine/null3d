# D-26: How clips are stored, sampled and blended

Status: decided by its rule on 2026-10-03; the iPad timings are in, and the phone timings are pending. Date: 2026-10-03. Task: M2-C1.

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

- Key rate. A clip keeps the grid of its source keys when every key lies on one grid of at most 30 keys per second. Files exported at 24, 25 or 30 frames per second then lose nothing. Other clips take 30 keys per second, adjusted so that the last key falls on the clip's end. A finer grid such as 60 keys per second becomes 30, which halves its memory.
- Rotations. Four signed 16-bit integers per key, the quaternion times 32767. One step is 3.1e-5. Resampling turns each key into the hemisphere of the key before, so interpolation never takes the long way round. Sampling normalizes the result, which also removes the scale. The smallest-three layout of 48 bits would save 2 bytes a key, a quarter of the rotation memory. But each sample would then rebuild the largest component with a square root and move it into place. It would do so for every joint, in the loop where a crowd spends its time. That layout was not measured.
- Between keys, plain nlerp, as the plan says. At 30 keys per second it stays within 3.2e-5 rad of `slerp` up to 6 rad/s.
- Blends follow three.js's mixer, joint by joint and channel by channel. Each clip with a track there moves the blend so far by its share of the weight so far. Below a total weight of 1, the rest pose makes up the remainder. Rotations blend with the corrected nlerp, which stays within 7.7e-5 rad of `slerp` up to 2 rad apart.
- Step tracks take the key at or before the time. Linear tracks interpolate. Cubic spline input waits for the glTF loader, which converts it while it resamples. A key within a millionth of a frame's time counts as reached. A clip's key times are 32-bit floats, which can round up past the frame time that resampling computes. Without that, a step track on its own grid took the key before ([D-28](D-28-animator.md) found it).
- Each animated object had 4 sample slots: a clip, a time and a weight each. [D-28](D-28-animator.md) raised them to 8, with layers, and gave each slot its play state.
- Output: one row-major 3 × 4 skinning matrix of 48 bytes per joint, with the inverse bind matrix applied. The joints compose in index order, so a skeleton lists its joints parents first.
- The frame step runs one parallel loop over the animated objects, 4 to a chunk. Each thread samples into scratch memory of its own, sized when a skeleton is added, so the step allocates nothing.

The data meets the rule: 1.0e-4 against 2e-4 and 3.6e-4 against 1e-3, less memory per key than three.js, and no allocation in the no-allocation test.

## How three.js handles it

A three.js clip keeps each track's key times and values as 32-bit floats. Each frame, each action's interpolants find the keys around the time, then `slerp` the quaternions. A `PropertyMixer` per property blends the actions in turn, each by its share of the weight so far. It fills a weight below 1 with the original value. Then the scene graph updates each bone's world matrix, and `Skeleton.update` multiplies in the inverse bind matrices. All of it runs on the main thread, one bone at a time. null3D keeps the mixer's blending rules, so poses match. It stores keys at a fixed rate, so the keys around a time are a direct index. It samples four joints per SIMD operation, and spreads the characters across the job workers.

## Consequences

- `crates/null3d-core/src/animation/` holds skeletons, clips, resampling and the frame step. The WebAssembly entry point exposes them to the animation test page. The animator (M2-C2) builds its API on the sample slots, as [D-28](D-28-animator.md) records.
- The glTF loader (M2-C7) calls `resample` on a job worker when it reads a file, and converts cubic spline input there.
- The skinning passes (M2-C3, M2-C4) read the 48-byte matrices.
- The phone timings come from the animation plan. Add them to this record when it runs on the S24+.
- The record is in the table in [README.md](README.md).
