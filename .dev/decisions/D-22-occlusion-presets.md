# D-22: Occlusion culling per preset on each path

Status: WebGPU rows decided from the Mac's timings, 2026-10-04, confirmed by the iPad's and the S25's timings, 2026-10-07, and by the Mac's G1 run, 2026-10-08. The WebGL2 rows (T-36, M2-I3) are pending. Task: M2-I1 (WebGPU), M2-I3 (WebGL2).

Summary: GPU occlusion culling is off on every preset for now. In a room scene whose walls hide 94% of its objects, a quiet Mac saved 37% on 4 October, but only 7% on 8 October. With another program drawing on the GPU, it cost 19% to 66% more. Desktops turn it on only if it saves 10% quiet and loses no more than 5% under load. A scene that marks no occluder pays nothing for it. On the owner's iPad and the cloud Galaxy S25, the same room cost 4% and 30% more GPU time with it.

## Question

On which presets does each path cull occluded objects: GPU occlusion culling on WebGPU ([D-40](D-40-gpu-occlusion.md)), and software occlusion culling on WebGL2 ([D-41](D-41-software-occlusion.md), T-36)?

## Rule

A preset turns a method on only where it saves more frame time than it costs on that preset's devices, with popping under M2-I3's threshold. GPU occlusion culling shows no object late (D-40), so on WebGPU the rule reduces to its GPU time per frame.

## Data

### GPU occlusion culling on WebGPU

All figures come from Chrome 154 on the Mac (Apple M5 Max), at the High preset, on 2026-10-04. Other helpers ran builds and tests on the Mac at the same time, so each comparison ran its two sides in turns. Chrome's GPU timer counts in steps of about 0.066 ms here.

Where nothing is marked as an occluder, each design's cost in the benchmark scenes, against main. The command was `bun run bench:run --compare <base>,<branch> --scenes s1,s3 --pages null3d-webgpu`, with 6 to 10 rounds of the two builds in turns. CPU time stayed within the job's rules in every run.

| Design | S1 GPU time per frame | S3 GPU time per frame |
| --- | --- | --- |
| Main | 1.95 ms | 2.87 to 3.09 ms |
| Every object in the first phase, drawn in color; a second opaque pass loads color and depth | 2.49 ms (+28%) | 3.47 ms (+21%) |
| Every object's depth in an occluders' pass, at the scene's 4 samples | 3.63 ms (+88%) | 3.70 ms (+22%) |
| Only marked objects occlude; a frame without one culls once (built) | 1.947 ms (0%) | 3.071 ms (-0.6%) |

Where walls hide most of the scene: the room scene of the GPU occlusion page (`tests/pages/gpu-occlusion.html?gpu=webgpu&seconds=4&rounds=3`). Its four walls are marked occluders. They hide 94.4% of 960 spheres from the camera (`hiddenShare` in `bench/scenes/room.ts`). The page fills a 1280 x 720 window, with the render scale fixed at 1 and the governor off. It times each side 3 times, in turns, in a new engine each time, and reports the medians.

| Spheres | Anti-aliasing | Culling off | Culling on | Change |
| --- | --- | --- | --- | --- |
| 32 segments, about 1,000 triangles each | MSAA | 0.98 ms | 1.57 ms | +60% |
| 32 segments | FXAA | 1.18 ms | 1.70 ms | +44% |
| 96 segments, about 9,000 triangles each | MSAA | 2.16 ms | 3.70 ms | +71% |

The culling works: in the 96-segment run the opaque pass took 0.92 ms with culling off and 0.39 ms with it on. But the frame grew elsewhere, as [D-40](D-40-gpu-occlusion.md#the-stall-between-passes) says.

The owner's iPad Pro 11-inch (A12X) ran the device runner's `gpu-occlusion` plan in Safari 26.6.2 on 2026-10-07. It ran main with this work, at a9ac1834d (run 20261007-054639-gpu-occlusion). The page was 1194 x 722 at a pixel ratio of 2, with 32-segment spheres, in 3 rounds of 4 s. All six views matched culling off in every pixel, and the walls hid 94.4% of the spheres.

| Culling off | Culling on | Change |
| --- | --- | --- |
| 7.76 ms | 8.10 ms | +4% |

Both sides held 59 Hz frames (15.6 and 15.4 ms), and the render worker's CPU time stayed at 0.16 to 0.18 ms. So on the iPad too, culling cost more GPU time than it saved.

The first phone, on 2026-10-07: BrowserStack's Galaxy S25 (Adreno 830) in Chrome 149, with the device runner's `gpu-occlusion` plan, on the M2-I1 branch at 89032719b (run 20261007-035830-gpu-occlusion). All six views matched culling off in every pixel. The room scene's GPU time per frame, with 32-segment spheres and the walls hiding 94% of them:

| Culling off | Culling on | Change |
| --- | --- | --- |
| 3.74 ms | 4.85 ms | +30% |

With culling on, the compute pass of the pyramid and the second phase took 0.98 ms, and the opaque pass 2.36 ms against 2.42 ms with it off. So on this GPU the opaque pass saved almost nothing, while the added passes cost about 1.1 ms. The cloud phone's screen ran at 30 Hz, so the runner marks the timings unreliable; GPU times come from the GPU's timer. This is one data point, and it fits "off on every preset" on Android.

### Software occlusion culling on WebGL2

Pending: M2-I2 and M2-I3 (T-36).

## Decision

WebGPU: off on every preset. On the Mac it cost more GPU time than it saved in every scene measured, even where it hid 94% of 8.8 million triangles. It stays as the `gpuOcclusion` option of `createEngine`, which costs nothing in a frame that marks no occluder.

The device runs of 7 October 2026 keep it off. The room scene hides 94% of its spheres, so it favors culling more than most scenes. Even there, culling cost 0.34 ms (4%) of GPU time per frame on the owner's iPad, and 1.1 ms (30%) on the cloud S25. Its images matched in every pixel on both. So a scene may still turn it on, once it measures a gain with `?occlusion=on` and `?occlusion=off`.

## Consequences

- `gpuOcclusion` in the preset table: false on every preset.
- The docs say to compare a scene's GPU time with `?occlusion=on` and `?occlusion=off` before keeping it on.
- The stall between passes is open for the owner (D-40). If a later change removes it, run the room scene and S1 again, and revisit these rows.
- M2-I3 adds the WebGL2 rows.

## Addendum, 2026-10-04: a quiet GPU

The figures above come from a Mac that other helpers' browser tests shared. On a quiet GPU, GPU occlusion culling took the room scene's frame (96 segments, MSAA) from 1.64 to 1.04 ms, 37% less ([D-40](D-40-gpu-occlusion.md#addendum-2026-10-04-culling-saves-time-on-a-quiet-gpu)). Under another program's GPU load it cost 19% to 40% more. So the decision's reason, that culling cost more than it saved in every scene, holds only on a busy GPU. High and Ultra may turn it on.

The rules decided in [D-53](D-53-technique-defaults.md) on 4 October 2026:

- Desktops: High and Ultra turn GPU occlusion culling on only if a second run on a quiet Mac saves time, and a run with another program loading the GPU loses no more than 5%. Today's loaded runs lose 19 to 40%, so it stays off for now.
- Android: it stays off until prototype G1 passes on the GPUs whose drivers Bevy and Unity block for GPU culling. These are Adreno 730 and older, Mali drivers before r48, and the PowerVR GPUs of the Pixel 10 and 11.

## Addendum, 2026-10-08: the Mac's G1 run

Prototype G1 ran the room scene on the quiet Mac again, in Chrome 155 with exact GPU timestamps. [D-40](D-40-gpu-occlusion.md#addendum-2026-10-08-prototype-g1-on-the-mac) gives the method and the pass times.

| Run | Culling off | Culling on | Change |
| --- | --- | --- | --- |
| Quiet (3 runs of 3 rounds) | 2.31 ms | 2.14 ms | 7% less |
| With a second Chrome loading the GPU (3 runs) | 2.53 ms | 3.83 ms | 38% to 66% more |

All six views matched culling off in every pixel. A first pyramid level at a quarter of the render size cost 3% more quiet, so it is not an option.

G1's rule for a device class is a 10% saving quiet and no more than 5% lost under load. The Mac fails both, so the desktop rows stay off on every preset, High and Ultra included. The `gpuOcclusion` option and the `?occlusion=on` switch remain for a scene that measures a gain of its own. The Android rows still wait for G1's image check on the GPUs that Bevy and Unity block.
