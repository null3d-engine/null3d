# D-22: Occlusion culling per preset on each path

Status: WebGPU rows decided from the Mac's timings, 2026-10-04; the iPad's WebGPU timings and the WebGL2 rows (T-36, M2-I3) pending. Task: M2-I1 (WebGPU), M2-I3 (WebGL2).

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

The iPad Pro (A12X) in Safari 26 is pending: the device runner's `gpu-occlusion` plan measures it.

### Software occlusion culling on WebGL2

Pending: M2-I2 and M2-I3 (T-36).

## Decision

WebGPU: off on every preset. On the Mac it cost more GPU time than it saved in every scene measured, even where it hid 94% of 8.8 million triangles. It stays as the `gpuOcclusion` option of `createEngine`, which costs nothing in a frame that marks no occluder. The iPad's run decides whether a preset turns it on there.

## Consequences

- `gpuOcclusion` in the preset table: false on every preset.
- The docs say to compare a scene's GPU time with `?occlusion=on` and `?occlusion=off` before keeping it on.
- The stall between passes is open for the owner (D-40). If a later change removes it, run the room scene and S1 again, and revisit these rows.
- The iPad run of the `gpu-occlusion` plan fills the pending row. M2-I3 adds the WebGL2 rows.

## Addendum, 2026-10-04: a quiet GPU

The figures above come from a Mac that other helpers' browser tests shared. On a quiet GPU, GPU occlusion culling took the room scene's frame (96 segments, MSAA) from 1.64 to 1.04 ms, 37% less ([D-40](D-40-gpu-occlusion.md#addendum-2026-10-04-culling-saves-time-on-a-quiet-gpu)). Under another program's GPU load it cost 19% to 40% more. So the decision's reason, that culling cost more than it saved in every scene, holds only on a busy GPU. High and Ultra may turn it on.

The rules decided in D-53 on 4 October 2026:

- Desktops: High and Ultra turn GPU occlusion culling on only if a second run on a quiet Mac saves time, and a run with another program loading the GPU loses no more than 5%. Today's loaded runs lose 19 to 40%, so it stays off for now.
- Android: it stays off until prototype G1 passes on the GPUs whose drivers Bevy and Unity block for GPU culling. These are Adreno 730 and older, Mali drivers before r48, and the PowerVR GPUs of the Pixel 10 and 11.
