# D-22: Occlusion culling per preset on each path

Status: WebGPU rows proposed from the Mac's timings, for the owner to confirm; the iPad's WebGPU timings and the WebGL2 rows (T-36, M2-I3) pending. Date: 2026-10-04. Task: M2-I1 (WebGPU), M2-I3 (WebGL2).

## Question

On which presets does each path cull occluded objects: GPU occlusion culling on WebGPU ([D-40](D-40-gpu-occlusion.md)), and software occlusion culling on WebGL2 (M2-I2, T-36)?

## Rule

A preset turns a method on only where it saves more frame time than it costs on that preset's devices, with popping under M2-I3's threshold. GPU occlusion culling shows no object late (D-40), so on WebGPU the rule reduces to its GPU time per frame.

## Data

### GPU occlusion culling on WebGPU

The occlusion test page (`tests/pages/occlusion.html?gpu=webgpu&seconds=4&rounds=3`) fills the window with the occlusion scene, at the High preset, a render scale of 1 and the governor off. A room's walls hide 94.4% of 960 spheres of about 1,000 triangles each (the share comes from the scene's geometry, `hiddenShare` in `bench/scenes/occlusion.ts`). Each side runs 3 times, in turns, each in a new engine, 4 s each. The figures are the medians of each side's medians. Chrome's GPU timer counts in steps of 0.066 ms here.

| Device and browser | Canvas | Culling off | Culling on | Change |
| --- | --- | --- | --- | --- |
| Mac (Apple M5 Max), Chrome 154, WebGPU, MSAA | 1280 x 720 | 1.80 ms | 0.85 ms | -53% |
| The same, FXAA | 1280 x 720 | 0.52 ms | 0.59 ms | +13% |
| iPad Pro (A12X), Safari 26 | | pending | pending | |

Where little hides, the cost shows in the benchmark scenes. The command `bun run bench:run --compare <base>,<branch> --scenes s1,s3 --pages null3d-webgpu --runs 10 --seconds 5` runs the two builds in turns. Chrome on the Mac draws them at the High preset, which turns culling on in the branch:

| Scene | Measure | Base | Branch | Change |
| --- | --- | --- | --- | --- |
| S1 | CPU time per frame, busiest thread | 4.280 ms | 4.400 ms | +2.7%, within the rule |
| S1 | Own work on it | 0.381 ms | 0.389 ms | +1.6%, within the rule |
| S1 | GPU time per frame, not judged | 1.947 ms | 2.485 ms | +0.54 ms, +28% |
| S3 | CPU time per frame, busiest thread | 0.143 ms | 0.150 ms | +3.5%, within the rule |
| S3 | Own work on it | 0.115 ms | 0.120 ms | +4.3%, within the rule |
| S3 | GPU time per frame, not judged | 2.864 ms | 3.467 ms | +0.60 ms, +21% |

Every page held the display's 144 Hz in both builds, so the frame interval did not change. The added GPU time comes from the passes that every frame adds. With MSAA, the color and depth targets hold 4 samples a pixel, and the first opaque pass must store them for the second, where one pass kept them in tile memory. The Mac's GPU renders in tiles, as phone and tablet GPUs do. With FXAA the room scene shows the other side: its spheres cost little to draw, and the passes cost about what culling saved.

### Software occlusion culling on WebGL2

Pending: M2-I2 and M2-I3 (T-36).

## Decision

WebGPU, proposed: on at High and Ultra, off at Low and Medium, as the plan proposed. On the Mac it saves 53% of the GPU time per frame where walls hide most of the scene, with MSAA. Where little hides it costs about 0.55 ms of GPU time per frame, and no frame time, as the GPU had time to spare. The owner should confirm the High row with these figures: a desktop game whose GPU is the limit and where little hides would lose that time. Low and Medium serve phones and tablets. Their tile-based GPUs pay most for keeping color and depth in memory between the two opaque passes. The iPad's run decides whether Medium turns it on.

## Consequences

- `gpuOcclusion` in the preset table: false, false, true, true.
- The iPad run of the device runner's `occlusion` plan fills the pending row; M2-I3 adds the WebGL2 rows.
