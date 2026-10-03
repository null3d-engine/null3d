# D-35: Skins, clips and morph targets from glTF files

Status: decided, 2026-10-04. Date: 2026-10-04. Task: M2-C7.

## Question

How does a glTF file's animation reach the engine core? A file has skins, which name nodes as joints, and clips, whose channels move any node. The core takes one skeleton per animated object ([D-26](D-26-animation-clips.md)) and plays its clips through the animator ([D-28](D-28-animator.md)). So the loader must decide which nodes become joints and which stay objects. It must also decide how meshes that hang on bones follow them, and where clips are resampled. Cubic spline keys need converting too.

## Rule

- The sample characters pose as three.js's `GLTFLoader` and `AnimationMixer` pose them, within D-26's tolerance of 1e-3 for a skinning matrix element. A clip that the core cannot store exactly may differ more, if this record names it and gives the figure.
- No frame of the sketch waits for a model's clips to resample.
- A page that loads no glTF file downloads none of the animation code (M2-R5's rule, as [D-29](D-29-gltf-loader.md) keeps it).
- A crowd of copies costs no object per joint.
- Morph targets load and wait for the task that draws them (M2-C5).

## Data

### Poses against three.js

`tests/pages/gltf-poses.ts` loads seven sample models with the engine's parser. It hands their clips to the core, which the job workers resample, and plays each clip of `tests/pages/lib/gltf-poses.ts` at chosen times. Then it compares each skin joint's skinning matrix with what three.js r186 gives for the same file and time. `bun bench/three-fixtures.ts` records three.js's values in `tests/pages/lib/gltf-poses.json`. For meshes that clips move without a skin, it compares their world matrices. Chrome on the Mac (MacBook Pro M5 Max, 4 October 2026), 2 job workers:

| Model | Joints | Clips | Clips resampled | Largest difference: rotation and scale | Translation, as a share of the largest |
| --- | --- | --- | --- | --- | --- |
| KayKit Knight | 51 | 76 | 16 ms | 7.2e-5 | 4.6e-5 |
| Fox | 25 | 3 | 1.4 ms | 5.0e-3 | 3.0e-3 |
| RiggedFigure | 21 | 1 | 1.6 ms | 4.0e-5 | 8.3e-5 |
| RiggedSimple | 4 | 1 | 1.3 ms | 2.7e-5 | 3.7e-5 |
| SimpleSkin | 2 | 1 | 1.3 ms | 3.0e-4 | 3.0e-4 |
| BoxAnimated (no skin) | 3 | 1 | 1.3 ms | 1.1e-5 | 1.9e-7 |
| InterpolationTest (no skin; step, linear and cubic spline keys) | 9 | 9 | 2.3 ms | 2.5e-4 | 1.1e-5 |

A script evaluated the parsed keys of Fox and the Knight directly, with `slerp`, and composed the skeleton in three.js. It matched three.js within 2.8e-7. So the parser and the skeleton match three.js, and any larger difference comes from how the core stores and samples clips.

### Faults the comparison found

| Fault | Before | After |
| --- | --- | --- |
| A clip's end is a 32-bit float. 32 thirtieths of a second lie 1.7 millionths of a frame past frame 32, and D-26's resampler allowed a millionth. So the Knight's clips got 33 frames at 30.9 keys per second, and no frame fell on the file's keys. The resampler now allows a thousandth of a frame, as its grid check does | Knight 1.1e-2 | Knight 7.2e-5 |
| D-26 sampled rotations between keys with plain normalized linear interpolation, and judged it good up to 6 rad/s at 30 keys per second. Files turn joints faster: Fox's run turns a joint 1.5 radians in one key of 1/24 s, and SimpleSkin 0.8 radians in half a second. Sampling now applies the correction that D-26's blends use, one dot product and a short polynomial for four joints | RiggedFigure 1.4e-3, SimpleSkin 1.3e-3 | RiggedFigure 4.0e-5, SimpleSkin 3.0e-4 |

The correction also brought D-26's own fixtures closer to three.js. Poses went from 1.0e-4 to 2.1e-5, and skinning matrices from 3.6e-4 to 1.7e-4.

Below 0.2 radians between keys, plain interpolation stays within 3.2e-5 radians of `slerp`, about one step of a 16-bit key. So the resampler marks each rotation track that turns further between two frames, and puts the marked tracks first among the groups of four. Sampling tests only those groups, and corrects a group only at the frames where one of its joints turns further. Groups of unmarked tracks take the same steps as before the correction. Most clips at 30 keys per second have no marked track.

The benchmark `bench_animation_crowd` timed the native frame step of main and of this branch on 4 October 2026, in turns, 20 rounds each. Other work kept the Mac busy throughout, with load averages from 60 to 180 on 18 cores. So each figure is the fastest of a round's 500 frames, which filters out most of that work. The table gives the median of the 20 rounds with their range, and the median of the changes from round to round. The benchmark's first clip turns joints at most 0.16 radians between keys. Its second turns them up to 0.32 radians, so all of its tracks are marked.

| Characters of 48 joints | main | This branch | Change | Rounds the branch was faster |
| --- | --- | --- | --- | --- |
| 100, 1 thread | 120.5 µs (108 to 124) | 129.9 µs (126 to 131) | +5.9% | 0 of 20 |
| 500, 1 thread | 621.7 µs (599 to 631) | 654.1 µs (568 to 790) | +5.5% | 1 of 20 |
| 500, 8 threads | 97.9 µs (93 to 106) | 102.8 µs (99 to 110) | +4.7% | 2 of 20 |

The same build with the correction turned off ran at main's speed, within 1% on one thread. So the 5% is the correction itself, on the second clip's joints. At 0.32 radians apart, plain interpolation strays up to about 1.3e-4 radians from `slerp`, between D-26's figures for 0.2 and 0.5 radians. The correction keeps it under 3.3e-5.

The first version of this branch tested every group at every frame. A second run slowed the benchmark's second clip to turn at most 0.15 radians between keys, so that no track was marked. There that version took 1% to 2% more than main in 7 of the 8 cases. The marked tracks bring it to main's speed, within 0.5% on one thread.

Fox stays at 5.0e-3. Its run clip changes its key spacing at 0.87 s, so its keys lie on no single grid. The core therefore stores it at 30 keys per second, as D-26 decided. Its fastest joints turn 1.5 radians between keys, and the resampled curve cuts their corners. That is 0.3 degrees. A finer rate for such clips would double their memory; no measured clip needs it yet.

### The Knight as joints and objects

| Measure | Value |
| --- | --- |
| Nodes in the file | 57 |
| Joints of its skeleton | 51: the 41 of its skin, its 9 accessories' nodes, and the root above them |
| Objects per copy | 16: the copy's group and its 15 meshes |
| Vertices that the skin moves | 3,716, in 6 meshes |
| Vertices of the 9 meshes on bones (5 shields, 3 swords, the helmet and the cape) | 3,308 |
| Parse in Bun, warm | 38 to 190 ms, most of it garbage collection of the 8,839 accessors' JSON |

With every node an object, as three.js makes it, a copy would hold 58 objects.

### Sizes

| File | Before | After Brotli |
| --- | --- | --- |
| `js/sketch-worker-gltf.js` and `js/page-gltf.js`, the loader with the animator and `debug.skeleton`'s data | 3.1 KB | 6.1 KB |
| `js/gltf-worker.js`, the parser with skins, clips and morph targets | 6.0 KB | 8.9 KB |
| `threaded/null3d.js` and `single/null3d.js`, the core's JavaScript glue, with three more calls | 8.3 KB | 8.4 KB |
| The engine's first download, `js/page.js` and `js/sketch-worker.js` | unchanged | unchanged |

How the data was produced: `bun bench/three-fixtures.ts`, then `NULL3D_PORT=9373 bunx playwright test gltf-poses.spec.ts` in `tests`, on 4 October 2026. The direct evaluation and the counts came from scripts over `parseGltf`, and the sizes from `bun run build`.

## Decision

### One skeleton per model

The loader builds one skeleton for the whole model. Its joints are every node that a skin names or a clip moves, and every node below those. Every node above them, up to the scene's roots, is a joint too. Joints come parents first, and the roots' parent is the copy's group, which gets the animator. These nodes are joints, not objects.

- A skinned mesh goes in the copy's group with no transform of its own, as glTF says a skinned mesh's node transform does not count. Its vertices name the skin's joints by their place in the skin, so the parser rewrites them to name the skeleton's joints.
- A node below a joint that the skins and clips leave still becomes an object in the copy's group. It takes the place its joints give it at rest.
- A light on a moving node is left out, with a warning in development builds.

The rejected option made one skeleton per skin, as three.js makes one `Skeleton` per `SkinnedMesh`. Clips that move nodes outside any skin, and meshes on bones, would then need a second mechanism. A model whose skins share joints would sample them once per skin.

### Meshes that joints move

A mesh without a skin on a moving node, such as the Knight's sword, gets joints and weights from the parser. They give its whole weight to its node's joint. It then moves through the same skinning as a skinned mesh, on both GPU paths. The parser keeps one copy of the mesh for each joint that moves it.

The rejected option, a joint follower, would make such a mesh an object. The core would write its world matrix from its joint after each animation step. It costs no skinning, but the core would need a second transform pass after the step, before culling and the snapshot. That pass would run in every frame and need its own place in the frame's order, for objects that the transform update already handles. The one-joint skin reuses the skinning passes and their culling bounds. Its cost is 8 bytes per vertex, and skinning work for every vertex that some view draws. A mesh that the sketch hides costs no skinning. If S5's crowd shows the cost, a follower for meshes of one joint can come later without changing the files.

### Several skins on one joint

A node that two skins bind with different inverse bind matrices gets one joint per matrix. The first matrix stays with the node's joint, and each other one goes to a child joint at rest under it. A mesh on a node that is also a skin joint takes such a child too, with no inverse bind matrix.

### Where clips resample

The core resamples each clip as a background task on the job workers. The job system runs such tasks when no frame chunk waits. The call `createClipLater` stages the clip and queues its task. Then `clipReady` adds the finished clip to its skeleton. The loader asks for finished clips in rounds of at most 4 ms. Between rounds, the thread runs frames. In the single-threaded build, which has no job workers, `clipReady` resamples the clip itself.

| Option | Frames wait | Notes |
| --- | --- | --- |
| Resample on the sketch's thread at load, with `createClip` | Yes, for every clip of the model | The Knight's 76 clips would hold its frames |
| Resample in the glTF worker | No | The worker would need a second copy of the core's WebAssembly, 550 KB, or a resampler in TypeScript beside the core's |
| Background tasks on the job workers (chosen) | No | The resampler that D-26 tested runs as it is |

### The correction between rotation keys

Sampling corrects rotations between keys for tracks that turn more than 0.2 radians between frames, and only there. Accuracy against three.js is the point of loading a file's clips, so the correction stays on. It costs about 5% of the frame step in `bench_animation_crowd`, whose second clip turns joints up to 0.32 radians between keys ("Faults the comparison found").

The rejected option computes part of the correction at load time. The polynomial terms that depend only on the two keys' dot product would be stored for each group and frame, beside the keys. That doubles the rotation memory of the marked tracks, which D-26 kept small for crowds, and saves perhaps half of the 5%. It was not measured. A crowd scene whose clips turn fast could justify it later.

### Cubic spline keys

The core evaluates glTF's cubic spline keys as three.js's `GLTFCubicSplineInterpolant` does, with tangents scaled by the time between keys, while it resamples. A clip with such a track keeps a source grid only at the finest multiple of it up to 30 keys per second. Keys every half second thus get 30 keys per second, 14 between each two, and the file's keys stay exact. InterpolationTest's cubic spline clips match three.js within 2.5e-4.

### Clip names

A clip without a name takes three.js's name, `animation_` and its index. A second clip of the same name becomes `Name 2`, so `play` finds each clip.

### Morph targets

The parser reads each primitive's position, normal and tangent deltas as floats, the mesh's default weights and target names, and each clip's weights tracks. The prefab keeps them, on the template nodes and in `morphClips`, for M2-C5. Until then the mesh draws its shape at rest, and development builds say so.

### `debug.skeleton`

`debug.skeleton(object)` draws a line from each skin joint to its parent joint, where the parent is a skin joint too. three.js's `SkeletonHelper` draws bones so. A line is blue at the joint and green at its parent, as there. Each joint's place comes from its skinning matrix and its place at bind time, the inverse of its inverse bind matrix. So the drawing needs no change in the core. It draws in the pose of the frame's animation step, in development builds only.

### The animation code loads with the loader

The loader imports the animator's module, which joins the loader's file. That module imports no engine module but constants. It takes the scene API's checks and error class from the scene (`Scene.checks`). An import of the shared error modules would make the bundler move them into a file of their own. Every page would then download that file at its start. A copy calls back into the module through the prefab, and `clone` through the source's animator.

## How three.js handles it

Its `GLTFLoader` makes an `Object3D` for every node and a `Bone` for every skin joint. It binds each `SkinnedMesh` to a `Skeleton` of its skin's bones. A mesh under a bone is the bone's child, so the scene graph moves it. Clips keep the file's keys and evaluate them on the main thread, with `GLTFCubicSplineInterpolant` for cubic splines. `SkeletonUtils.clone` copies the bones and rebinds the copies. null3D keeps the same poses, but its joints live in the core and its clips resample on the job workers. A copy costs one object per mesh.

## Consequences

- `packages/engine/src/scene/gltf-animation.ts` reads skins, clips and morph targets in the glTF worker; `gltf-json.ts` and `gltf-math.ts` hold the checks and matrix arithmetic that the parser and the loader share.
- `animation.ts` has `loadAnimationRig`, `skinObject` and `debug.skeleton`'s data. `skinObject` records the link until the skinning passes (M2-C3, M2-C4) merge, which make it a scene command.
- The core's resampler takes cubic spline keys and a thousandth of a frame at a clip's end. It marks rotation tracks that turn more than 0.2 radians between frames and groups them first. Sampling corrects those groups' rotations between keys, which D-26 records.
- The WebAssembly entry point has `createClipLater`, `clipReady` and `animatedInstanceJoints`.
- `tests/pages/gltf-poses.ts` and `tests/image/gltf-poses.spec.ts` compare the sample models with three.js, and the `gltf-skeleton` image test draws `debug.skeleton`.
- The record is in the table in [README.md](README.md).
