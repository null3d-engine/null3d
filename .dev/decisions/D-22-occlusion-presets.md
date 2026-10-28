# D-22: Occlusion culling per preset on each path

Status: decided: both methods are off on every preset. The WebGL2 rows (T-36) are the owner's decision, from the device runs of S6. The desktop WebGPU rows follow prototype G1's rules, and the iPad's and the cloud Galaxy S25's runs agree. Not run yet: G1's image check on the Android GPUs that Bevy and Unity block for GPU culling, so the Android rows stay off. Task: M2-I1 (WebGPU), M2-I3 (WebGL2).

Summary: Both methods are off on every preset. On WebGL2, software occlusion culling in S6 costs the job workers at least 3.5 times the render time it saves. On WebGPU, GPU occlusion culling saves a quiet Mac 7% in a walled room, and costs 38% to 66% more under load.

## Question

On which presets does each path cull occluded objects: GPU occlusion culling on WebGPU ([D-40](D-40-gpu-occlusion.md)), and software occlusion culling on WebGL2 ([D-41](D-41-software-occlusion.md), T-36)?

## Rule

A preset turns a method on only where it saves more frame time than it costs on that preset's devices, with popping within M2-I3's limits. Popping means both objects wrongly hidden at rest and objects late in motion ([below](#software-occlusion-culling-on-webgl2)). GPU occlusion culling shows no object late (D-40), so on WebGPU the rule reduces to its GPU time per frame.

[D-53](D-53-technique-defaults.md) sets prototype G1's rules for GPU occlusion culling on each class of device:

- Desktops: High and Ultra turn it on only if a run on a quiet Mac saves time. A run with another program loading the GPU must also lose no more than 5% ([D-53](D-53-technique-defaults.md), ruling 15).
- Android: it stays off until G1 passes on the GPUs whose drivers Bevy and Unity block for GPU culling. These are Adreno 730 and older, Mali drivers before r48, and the PowerVR GPUs of the Pixel 10 and 11.

## Data

### GPU occlusion culling on WebGPU

These figures come from Chrome 154 on the Mac (Apple M5 Max), at the High preset. Other helpers ran builds and tests on the Mac at the same time, so each comparison ran its two sides in turns. Chrome's GPU timer counts in steps of about 0.066 ms here.

Where nothing is marked as an occluder, each design's cost in the benchmark scenes, against the engine without occlusion culling. The command was `bun run bench:run --compare <base>,<branch> --scenes s1,s3 --pages null3d-webgpu`, with 6 to 10 rounds of the two builds in turns. CPU time stayed within the job's rules in every run.

| Design | S1 GPU time per frame | S3 GPU time per frame |
| --- | --- | --- |
| No occlusion culling | 1.95 ms | 2.87 to 3.09 ms |
| Every object in the first phase, drawn in color; a second opaque pass loads color and depth | 2.49 ms (+28%) | 3.47 ms (+21%) |
| Every object's depth in an occluders' pass, at the scene's 4 samples | 3.63 ms (+88%) | 3.70 ms (+22%) |
| Only marked objects occlude; a frame without one culls once (built) | 1.947 ms (0%) | 3.071 ms (-0.6%) |

Where walls hide most of the scene: the room scene of the GPU occlusion page (`tests/pages/gpu-occlusion.html?gpu=webgpu&seconds=4&rounds=3`). Its four walls are marked occluders. They hide 94.4% of 960 spheres from the camera (`hiddenShare` in `bench/scenes/room.ts`). The page fills a 1280 x 720 window, with the render scale fixed at 1 and the governor off. It times each side 3 times, in turns, in a new engine each time, and reports the medians.

| Spheres | Anti-aliasing | Culling off | Culling on | Change |
| --- | --- | --- | --- | --- |
| 32 segments, about 1,000 triangles each | MSAA | 0.98 ms | 1.57 ms | +60% |
| 32 segments | FXAA | 1.18 ms | 1.70 ms | +44% |
| 96 segments, about 9,000 triangles each | MSAA | 2.16 ms | 3.70 ms | +71% |

The culling works: in the 96-segment run the opaque pass took 0.92 ms with culling off and 0.39 ms with it on. But the frame grew elsewhere, as [D-40](D-40-gpu-occlusion.md#the-stall-between-passes) says. Those runs shared the Mac's GPU with other helpers' browser tests.

#### Prototype G1 on a quiet Mac

Prototype G1 ran the room scene on a quiet Mac, in Chrome 155 with exact GPU timestamps. [D-40](D-40-gpu-occlusion.md#prototype-g1-on-the-mac) gives the method and the pass times.

| Run | Culling off | Culling on | Change |
| --- | --- | --- | --- |
| Quiet (3 runs of 3 rounds) | 2.31 ms | 2.14 ms | 7% less |
| With a second Chrome loading the GPU (3 runs) | 2.53 ms | 3.83 ms | 38% to 66% more |

All six views matched culling off in every pixel. A first pyramid level at a quarter of the render size cost 3% more quiet, so it is not an option. Another quiet run gave 37% less with 96-segment spheres and MSAA, 1.64 against 1.04 ms. Under another program's GPU load it gave 19% to 40% more ([D-40](D-40-gpu-occlusion.md#culling-on-a-quiet-gpu)).

#### The owner's iPad and a cloud Galaxy S25

The owner's iPad Pro 11-inch (A12X) ran the device runner's `gpu-occlusion` plan in Safari 26.6.2. It ran main with this work, at a9ac1834d (run 20261007-054639-gpu-occlusion). The page was 1194 x 722 at a pixel ratio of 2, with 32-segment spheres, in 3 rounds of 4 s. All six views matched culling off in every pixel, and the walls hid 94.4% of the spheres.

| Culling off | Culling on | Change |
| --- | --- | --- |
| 7.76 ms | 8.10 ms | +4% |

Both sides held 59 Hz frames (15.6 and 15.4 ms), and the render worker's CPU time stayed at 0.16 to 0.18 ms. So on the iPad too, culling cost more GPU time than it saved.

BrowserStack's Galaxy S25 (Adreno 830) ran the same plan in Chrome 149, on the M2-I1 branch at 89032719b (run 20261007-035830-gpu-occlusion). All six views matched culling off in every pixel. The room scene's GPU time per frame, with 32-segment spheres and the walls hiding 94% of them:

| Culling off | Culling on | Change |
| --- | --- | --- |
| 3.74 ms | 4.85 ms | +30% |

With culling on, the compute pass of the pyramid and the second phase took 0.98 ms, and the opaque pass 2.36 ms against 2.42 ms with it off. So on this GPU the opaque pass saved almost nothing, while the added passes cost about 1.1 ms. The cloud phone's screen ran at 30 Hz, so the runner marks the timings unreliable; GPU times come from the GPU's timer. This is one data point, and it fits "off on every preset" on Android.

### Software occlusion culling on WebGL2

T-36 runs on the cloud Galaxy S24, which has the S24+'s chip. It also runs on the owner's iPad and the cloud Galaxy S25 and Pixel 9, all with WebGL2 forced. The [results](#results) follow the method (M2-I3):

- The scene is S6, the city, whole, from the benchmark pages' production build. Its towers and many kit buildings block the view, so it is the scene that the culling serves. The device runner's `occlusion-s6` plan loads `bench/pages/null3d/s6.html` with `?occlusion-turns` ([Devices](../devices.md#the-s6-occlusion-plan)).
- Each load runs one preset, Low, Medium or High, with the governor off, so the render scale holds while the sides take turns. Every load forces WebGL2, where the job workers cull.
- The culling runs off and on in turns in one engine: 4 rounds of 10 seconds a side. Each round flies its own quarter of the route, and both sides fly the same stretch from the same start. The side that runs first changes each round, so a device that warms through the run slows both sides alike.
- Each side reports the medians of its rounds. They are the share of the entries in the view that the culling hid, the job workers' time and the sketch thread's culling step. Then come the render worker's time, the GPU time where the device has a timer, the frame interval and the draw calls.
- The culling's cost is the job workers' added time plus the culling step's added time. The step includes the calling thread's share of the blockers' drawing. Its saving is the render worker's time plus the GPU's. It pays where the saving is larger than the cost, which is gate item 3's rule.
- The buffer comes in two sizes: the core's 256 x 144, and 384 x 216. The `?occlusion-buffer=` switch sets the size. Its rows are bands of 16, so the larger size is 384 x 224 at 16:9.

Popping. The gate's popping check means two figures, and both must stay within M2-I3's limits. In both, a pixel counts by the image tests' rule. Its color must move past their threshold of a tenth of the range. A count of every changed level would flag rounding changes on Apple's GPU as hidden objects. It would flag shading noise between frames too.

- Wrongly hidden at rest: objects that the culling hides while they show, with the camera still. This plan measures it. After the timed rounds, the page holds the camera at 24 stops spread along the route. At each stop it reads the frame back twice with the culling off, then once with it on. The two frames with the culling off differ only by the device's own noise. A stop counts when the frame with the culling on differs from the first one by more than that noise plus 8 pixels. A small prop far down a street covers about that many. The limit is no such stop in any load. The culling hides only what lies wholly behind blockers, so one such stop is a fault, not a rate to allow. The page sends the frames of the first two such stops, and the runner saves them beside the run's results.
- Late in motion: objects that show one or more frames late while the camera moves. The page measures it after the stops, at 24 points spread along the route (M2-L6). At each point it reads back the frames with the culling off at both ends of a jump of a thousandth of the route, twice each, for the references and their noise. A thousandth of the route is about a fifth of a second of the drive. Then, with the culling on, the camera jumps between the two ends in every frame, and the page reads back 4 frames. Each frame shows the view one jump from the frame before, so a culling that used an earlier frame's camera would hide what just came into view. A frame counts as late when it differs from the nearer end's reference by more than the noise plus 8 pixels. The figure is the count of late frames, and the limit is none. The page sends the frames of the first two points with a late frame.

A count of every changed level finds 1 or 2 late frames in 4 of 6 runs on the Mac, all at the route's start. Those frames differ from the references in 18 to 22 pixels, by at most 8 levels, spread over the buildings' shading. Two still frames with the culling off there differ by up to 19 pixels too. So the shading changes a little between frames, and nothing is hidden. A building that the culling hid would change hundreds of pixels by far more than the rule's threshold. Under the image tests' rule, 6 runs in a row on the Mac found no late frame. Under a rule that let each pixel change by 24 levels, 11 runs in a row found none. The page also records how many pixels differ between the two ends. The browser test checks that each jump changes more pixels than the noise and the margin, so a frame one jump late would show. On the Mac each jump changed 457 to 66,454 pixels. The culling uses the frame's own camera and matrices and keeps nothing from earlier frames ([D-41](D-41-software-occlusion.md#same-frame-no-readback)), so no object can show late.

The preset rows follow from the table that the runner prints for each device. It has one row per preset and buffer size. Each row gives the hidden share, the added and saved times, the frame interval with the culling off and on, and both popping figures.

#### Results

All four devices ran main at e06b0daba with the `occlusion-s6` plan. The cloud phones ran in BrowserStack Automate sessions, and the iPad on the local network. WebGL2's highest preset is Medium, so the loads that asked for High ran at Medium. The figures below are per frame, with culling on against off.

| Device | Hidden in view | Draw calls fewer | Added worker time | Saved render time | Pays |
| --- | --- | --- | --- | --- | --- |
| iPad Pro 11-inch (A12X), Safari 26.6.2 | 35 to 39% | 17 to 19 of 795 to 995 | 7.5 to 10.3 ms | 0.9 to 2.1 ms | No |
| Pixel 9 (Mali-G715), Chrome 152 | 23 to 33% | 3 to 8 of 640 to 790 | 10.8 to 19.0 ms | 0.1 to 0.3 ms | No |
| Galaxy S25, Chrome 152 | 28 to 33% | 3 to 5 of 650 to 800 | 7.0 to 7.7 ms | under 0.1 ms | No |
| Galaxy S24, Chrome 152 | 28 to 33% | 2 to 5 of 650 to 800 | 13.0 to 21.6 ms | 0.5 to 0.9 ms | No |

No device has a GPU timer in this page, so the saved GPU time is unknown. The S25's and the S24's displays ran at 30 Hz, so their timings are a rough guide only. On the Pixel 9, 3 of 6 loads ran at 25 ms per frame with culling off and 16.7 ms with it on. The GPU time that culling saved may explain that, but no timer measured it.

The culling hides many objects but removes few draw calls. Most hidden objects are rows of instance batches whose other rows still show, so the batch still draws. Its cost is at least 3.5 times its saving on the iPad, and 20 times or more on the phones.

Wrongly hidden at rest: the phones drew the frames with culling on and off exactly alike at all 24 stops of every load. On the iPad, a count of every changed level flagged 2 to 4 stops in 5 of its 6 loads. Each had 9 to 79 differing pixels, out of 1.9 to 3.3 million. The page saved the frames of 10 such stops. None shows a missing object. The differing pixels lie scattered over walls. Most differ by 1 to 6 steps of 255, and only 4 pixels in the 10 pairs differ by more than 8 steps. By the image tests' rule the 10 saved pairs differ in no pixel at all. The iPad's 6 loads under that rule all passed, with 0 of 24 stops flagged in every load (run 20261011-091154-occlusion-s6). Culling added 7.4 to 9.8 ms of worker time there and saved at most 2.3 ms of render time.

## Decision

WebGL2: software occlusion culling is off on every preset, decided by the owner. In S6 it cost the job workers 7 to 22 ms per frame on every device, and saved 2.3 ms of render time at most. That is at least 3.5 times its saving on the iPad, and 20 times or more on the phones. It hid 23% to 39% of the entries in view, but fewer than 3% of the draw calls. Most rows it hid belong to batches that still draw. It stays as the `softwareOcclusion` option of `createEngine` and the quality setting of that name. A scene that measures a gain with `?occlusion=on` and `?occlusion=off` may turn it on.

WebGPU: off on every preset. On a quiet Mac it saves 7% in the room scene, which meets the quiet rule. Under another program's GPU load it costs 38% to 66% more, past the 5% that the loaded rule allows. So the desktop rows stay off, High and Ultra included. The room scene hides 94% of its spheres, so it favors culling more than most scenes. Even there, culling cost 0.34 ms (4%) of GPU time per frame on the owner's iPad, and 1.1 ms (30%) on the cloud S25. Its images matched in every pixel on both. The Android rows stay off until G1's image check passes on the GPUs that Bevy and Unity block. It stays as the `gpuOcclusion` option of `createEngine`, which costs nothing in a frame that marks no occluder. A scene may turn it on once it measures a gain with `?occlusion=on` and `?occlusion=off`.

## Consequences

- `gpuOcclusion` and `softwareOcclusion` in the preset table: false on every preset.
- The docs say to compare a scene with `?occlusion=on` and `?occlusion=off` before keeping either method on. GPU occlusion culling compares GPU time. Software occlusion culling compares the frame time on the slowest WebGL2 device ([Culling](../../docs/concepts/culling.md#turn-it-on-where-it-pays)).
- S6 draws without software occlusion culling on WebGL2, as every preset leaves it off. Its `?occlusion-turns` still turns it on and off, to measure it again.
- The stall between passes is open for the owner (D-40). A change that removes it calls for new runs of the room scene and S1, and a new look at these rows.
- Software occlusion culling may learn to skip whole draw calls, such as a batch whose rows all hide. Then run the `occlusion-s6` plan again, and revisit the WebGL2 rows.
