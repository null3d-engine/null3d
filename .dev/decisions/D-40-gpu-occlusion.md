# D-40: Two-phase GPU occlusion culling on WebGPU

Status: method decided and built. Two-phase culling runs on WebGPU with occluders that the GPU picks itself, beside the depth prepass. A check during play turns the extra passes off while they do not pay. It is on at High and Ultra on desktops: the owner approved overturning the earlier off rows ([D-22](D-22-occlusion-presets.md)). Open: an under-load run on a quiet Mac, as every run here shared the Mac with other work. Task: M2-I1.

Summary: Opaque objects and instance rows that showed last frame and look large draw their depth into a depth pyramid. A second culling phase tests every object against it, so the image equals culling without it. A check reads the counts back without waiting and compares GPU frame times with the passes on and off. It keeps the passes only while they hide a tenth of the scene and the frame gets no longer.

## Question

How does the WebGPU path skip opaque objects that other objects hide, without a visible error? Which objects hide others, without the page marking them? Where does the depth it tests against come from? How does the engine avoid paying for the extra passes where they do not save time? [D-22](D-22-occlusion-presets.md) records the preset rows and their timings; this record covers the method.

## Rule

- The image with occlusion culling equals the image without it, pixel for pixel. That holds on the Mac's GPU and on SwiftShader, in core WebGPU and compatibility mode, with MSAA and with one sample.
- No object that shows draws a frame late, even when the camera turns a quarter turn in one frame.
- An occluder never hides what the scene shows. Its depth is the depth that the frame draws for it, at the level of detail and the vertex positions of this frame.
- It stays within WebGPU's default limits and compatibility mode's (AGENTS.md hard rule 6), uses no optional feature, and keeps first-instance at 0 (hard rule 8).
- No per-frame allocation (hard rule 1), and no thread waits for the GPU (hard rules 4 and 5).
- A preset turns it on only where it saves time on a quiet machine and loses no more than 5% with another program loading the GPU (D-53, ruling 15).

## Options

| Option | How | Why not, or why |
| --- | --- | --- |
| (a) Two phases in each frame | Keep what showed last frame, build a depth pyramid from its depth, test everything against it, draw what shows. The method of Haar and Aaltonen's "GPU-Driven Rendering Pipelines" (SIGGRAPH 2015) and of Arseny Kapoulkine's Niagara renderer | Exact: the pyramid holds only depth drawn in the same frame. The plan (6.6) names it. The ways to draw the first phase and to pick its objects follow |
| (a1) Every object that showed last frame draws in color; a second opaque pass draws the rest over it | The published form | With MSAA the first pass stores 4 samples of color and depth per pixel for the second pass to load, where one pass keeps them in tile memory. S1 and S3 take about 0.55 ms more GPU time per frame on the Mac, 21% to 28% |
| (a2) Every object that showed last frame draws its depth alone, at the scene's samples | The occluders' pass at 4 samples | Drawing every visible object twice makes S1's GPU time 88% longer, and reading 4 depth samples per pixel costs the pyramid 1.2 ms |
| (a3) Only objects that the page marks draw their depth, at one sample per pixel | `setOccluder(true)`, the mark of WebGL2's software culling (D-41) | A page that marks nothing gains nothing, and rows never hid others. The desert comparison of the meshlet study marks nothing, so the culling hid nothing there |
| (a4) Every opaque object and row that showed last frame and looks large draws its depth, at one sample per pixel, unless the page opts it out (chosen) | The entry of each source carries the mark of a source that may hide others; `setOccluder(false)` clears it | Nothing to mark: walls, the ground, hills and large rows hide what lies behind them. Small objects stay out by the size rule, on the GPU, per frame |
| (b) One phase against last frame's depth | Test against the pyramid of the frame before, moved to the new camera | Objects that come out from behind an occluder show a frame late, and a fast turn misses many. Moving the depth to the new camera leaves holes |
| (c) Occlusion queries | One query per object, read back a frame or more later | A readback per object, results a frame or more late, and a CPU loop over objects that GPU culling avoids |
| (d) A pyramid from a full depth prepass | Draw every object's depth first, then test | Draws every object's vertices twice, the hidden ones too. The prepass makes S2's GPU time 45% longer on the Mac (M1-A7) |
| (e) Occluders at a coarser level of detail | Draw each occluder's depth at a level coarser than the one that the frame draws | A coarser level can reach past the finer surface by its error, so its depth can hide a sliver that shows. The occluders draw at the level that the frame draws instead |

The check had these options:

| Option | Why not, or why |
| --- | --- |
| Off on every preset, the page turns it on (the earlier choice) | A page that does not measure never gains, and most pages do not measure |
| The share of hidden objects alone, as three.js r187's meshlet pipeline does (off while it culls under 30% of the visible clusters) | It cannot see the cost that another program's GPU work adds between the extra passes, the cost that kept culling off (below) |
| The GPU timer's pass times | Timestamps need an optional feature (hard rule 11), which the engine asks for only while a page measures, and they time each pass, not the waits between them |
| The share of hidden objects and the GPU's frame time from submit to completion, compared with the passes on and off in turns (chosen) | Every WebGPU device reports completions, the engine tracks them in every frame, and the time includes the waits behind other work |

## How it works

### Occluders

- Each source's entry in the bucket table carries an occluder bit, bit 22, below the cell index. So a layout holds at most 4,194,304 buckets. The bit is set for every scene object and every batch row whose bucket draws depth in the occluders' pass, unless the object's `NOT_OCCLUDER` flag (bit 9) or its batch's row bit says otherwise. A change of the flag rewrites the object's entry from the next frame, with no rebuild. A batch's change rebuilds the tables, as its shadow bits do.
- A bucket draws depth in the occluders' pass when its pair has a depth build: an opaque pair that does not blend, cut holes with a mask, skip the depth buffer or fade between levels. Most pairs draw with the depth template. A pair that places its own vertices, such as a custom material with a vertex offset, a displaced material or a sprite, draws with its own template's prepass build, as the depth prepass does. So the terrain add-on's hills, whose vertex offset morphs them, hide what lies behind them at the depth they draw at.
- The first phase (`early` in `cull.wgsl`) keeps the marked sources in view whose history is 1. Each must look large: its bounds span at least a sixteenth of the render size's longer side, or it reaches the camera's plane. It appends each to the level of detail that the frame draws it at, so an occluder's depth is the frame's own. A source inside a fading band appends to the fade buckets, which have no depth build, so it hides nothing.
- A mesh with a tree of cluster patches runs the cluster pass after the first phase too, with its own set of parameters that read the first set of indirect draws. The occluders' pass then draws this frame's patches of the occluders, not last frame's, and the second run picks the patches that the opaque pass draws.

### The passes

- Each camera view keeps a history: one word per source, 1 when the source showed in the view's last frame. The history sits after the view's indirect draws, in their buffer. The culling group binds eight storage buffers, the most that every device allows a shader stage.
- The occluders' pass draws the occluders' depth into a depth target of one sample per pixel, from the first set of indirect draws. Its bundle holds only the buckets that held occluders in the last three readings of the check, so it draws no draw of no instances for the rest. A new layout starts with every bucket that draws depth. A bucket that becomes an occluder between readings draws no depth until the next reading, which hides less, never more.
- The depth pyramid is one storage buffer: a word that counts the frame's occluders, then each level. Level 0 is half the render size each way, rounded up, and each level halves the one before, down to one texel. Each texel holds the farthest depth under it, the smallest value in reversed depth.
- Level 0 reads the occluders' depth as a float texture. Compatibility mode refuses `textureLoad` on depth texture types, but allows depth formats bound as float textures.
- The occluders' depth has one sample, at each pixel's center, where the scene may draw with 4. So each texel of level 0 keeps the farthest of the 4 x 4 pixels around its own 2 x 2.
- One dispatch builds up to four levels, from 8 x 8 threads per workgroup. At 1280 x 720 that is 3 dispatches for 10 levels.
- The second phase (`late`) tests every source in view against the pyramid and writes its history. It counts the visible ones in the second set of indirect draws, after the first, which the depth prepass and the opaque pass draw.
- The test: interval arithmetic on the rows of the view-projection matrix gives the sphere's bounds on the screen and its nearest depth. It holds for perspective and orthographic lenses. A sphere that reaches the camera's plane or the near plane never hides.
- The render graph runs the occluders' pass after the first phase and before the late phase, which writes the compacted instances again: the pass reads them "so far". The depth prepass reads them after their last writer, so it runs after the late phase. So culling runs beside the depth prepass, which ambient occlusion, contact shadows and screen-space bounce light turn on. Bounce light runs at High and Ultra, so without this the culling never ran on those presets.
- Shadow cascades and tiles cull with the frustum test alone. See-through objects draw from the transparent pass's sorted rows, and hide nothing.

### The check

`gpu_driven/occlusion_check.rs` holds the check. It never waits for the GPU.

- The late phase counts the sources in view that would draw and those that the pyramid hides. Each workgroup sums its own in workgroup memory, and adds them with one atomic each to two words after the history. Each frame resets the words and writes its frame number beside them.
- A frame that the check asks copies the counts and the first set of indirect draws into a buffer of a ring of two, after the frame's passes, and reads it into engine memory (`ReadBuffer`). The words land a few frames later, and name their frame, so the check takes them when the frame matches. A read that does not land within 90 frames is given up, and its buffer is made again.
- One read waits at a time, and a frame recorded again copies its counts no more. A capture draws the frame again while its read may still wait. So the WebGPU backend skips a capture's copies into a buffer that a read maps, as it skips its reads ([Implementation notes](../implementation-notes.md#draw-list-readback)).
- The render worker tracks each frame's completion in every frame (`gpu/completion.ts`). The sketch thread hands each completion's busy time, from the frame's submit to its completion, to the core (`gpuFrameTime`). It holds any wait behind another program's work.
- The check runs the passes in its mode, on or off. Every 120 frames it starts a trial of 10 frames in the other mode, and leaves out the trial's first 2 frames. It compares the median busy time of the trial's last 8 frames with the median of the 8 frames before the trial.
- The passes pay while the pyramid hides at least 10% of the sources that would draw, and a frame with them takes no longer than 102% of a frame without. The verdict sets the mode until the next trial. Without counts the frame times decide alone, and with neither the mode stays. Its first trial starts 30 frames after the passes can first run.
- So the passes cost a frame that does not gain 10 frames in 120 at most, about 8%. A frame that gains keeps the gain but in those 10 frames.
- The check rests while the camera's view holds still. The still-camera accumulation takes a view as still only while each frame records the commands of the frame two before it, and only a still view stops drawing. A trial or a frame that copies the counts records other commands, so a still scene would never come to rest. While the view is still, each frame keeps the check's mode and copies nothing. The next trial comes 30 frames after the view moves again. The frame number that each frame writes beside its counts is one of the values that the accumulation's comparison skips, as it skips the clock. The still view's browser test runs with the culling on, on both WebGPU tiers, and a renderer test holds a still view with the culling and its check for three periods.
- The `?occlusion-check=off` switch holds the passes on in every frame, each frame copying its counts, with no trials. The GPU occlusion page's image test starts with it and with `?direct=off`, and waits until the culling hides objects, so every view that it compares ran the passes. Without them, views draw without the passes, and those views match by default. The check's trials and verdicts turn the passes off. The culling's shaders load on first use. The start-up probe can pick the direct-draw path, which culls on the CPU, where indirect draws measure slower, as it does in about a third of the runs on a loaded Mac.

## Data

The tests, in Chrome on the Mac (Apple M5 Max) and on SwiftShader:

| Check | Result |
| --- | --- |
| The GPU occlusion page: six views of the room, each turned 65° to 180° from the one before, culled against unculled, at 320 x 180 and at 1280 x 720, with MSAA. Nothing is marked: the culling picks the walls, the ground and the spheres itself. The spheres plan their levels of detail on the job workers, and the first turn waits for them, so both engines draw each view at the same levels. Without that wait, the levels arrive at another frame in each engine, and 900 to 1,350 pixels of the first views differ in about half of the runs, with culling off on both sides too | 0 differing pixels in each view, on core WebGPU and in compatibility mode, in Chrome 156 on the Mac. At 1280 x 720 every timed run below matched in every pixel too |
| The same with FXAA | 4 to 38 differing pixels per view at 320 x 180, as two runs of FXAA without culling also differ |
| The renderer's mock backend: automatic occluders, the opt-out of objects and batch rows, the culling beside the depth prepass and ambient occlusion, the readback after the late phase, and the check that turns the passes off when they make the frame longer and keeps them when they make it shorter | Valid lists, and the passes as the rule says |
| The check's unit tests | The mode follows the counts and the frame times, a frame recorded twice keeps its plan, and the occluders' bundle keeps a bucket for three readings after its last occluder |

### The room with the check

Chrome 156 on the Mac drew the `gpu-occlusion` page on WebGPU at High, with 96-segment spheres, MSAA and 1280 x 720 at a pixel ratio of 1, in a visible parked window, with exact timestamps. At High the page draws screen-space bounce light, so the depth prepass runs, and occlusion culling runs beside it. Each run timed both sides 3 times, in turns, in a new engine each time. The load page was a second Chrome that drew a heavy fragment shader in 4 full-screen passes per frame, at 101 to 120 frames per second. Other helpers' builds and browser runs shared the Mac: its 1-minute load average was 24 to 34 in the forced runs and 45 to 80 in the others. So no run was quiet, and the spread between runs of one side reaches 2 ms.

GPU time per frame, each run's median, culling off and on:

| Build | Load page | Culling off | Culling on | Median change | Objects hidden |
| --- | --- | --- | --- | --- | --- |
| With the check | No | 3.49, 5.17, 5.10 ms | 4.17, 4.92, 3.05 ms | 18% less | 203 of 270 in view |
| With the check | Yes | 9.63, 5.05, 5.49 ms | 4.12, 5.08, 5.18 ms | 7% less | 0 in 2 runs: the check turned the passes off |
| Passes forced on, no check | No | 4.21, 5.06 ms | 4.76, 4.76 ms | No clear change | 203 of 270 in view |
| Passes forced on, no check | Yes | 4.33, 5.23 ms | 5.06, 5.05 ms | No clear change | 203 of 270 in view |

- The culling hides 75% of the spheres that would draw in view 0. The depth prepass falls from 0.9 to 1.3 ms to 0.44 ms, and the occluders' pass takes 0.1 ms.
- Where the passes did not pay, the check turned them off, and the engine with culling on took no more time than the one without it.
- The pass split of a forced run, by the GPU timer's slots: compute 0.03 ms, occluders 0.10 ms, prepass 0.44 ms. Bounce light's second step dominates the frame, at 3.5 to 4.1 ms on both sides.

### The desert of the meshlet study

The desert comparison's null3D page drew the walk and the aerial views at High, from a production copy of the CDN build, with `occluder=1`, which lets the ground hide others as an object without a mark does. Each view ran 3 times with culling on and off in turns, 10 s each after 4 s of warm-up.

| View | Culling off | Culling on |
| --- | --- | --- |
| Walk | 7.47, 6.74, 7.03 ms | 11.41, 6.91, 6.93 ms |
| Aerial | 9.66, 11.41, 11.23 ms | 10.93, 10.02, 11.29 ms |

The triangles drawn stayed the same, 31.0 to 33.8 million per frame on both sides. So the check kept the passes off in the desert, where they hide little. The medians of the two sides lie within 3% of each other, inside the runs' noise. The first walk run with culling on took 11.4 ms in one run only.

### The Island showcase

A temporary page timed the Island at High, 20 s into its route for 30 s: the low flight in toward the beach, the town's waterfront and the harbour. Ambient occlusion holds the depth prepass there, and the terrain add-on's hills are custom materials, which hide others with their own vertex shader. Two rounds per side, in turns, at a load average of 41 to 55:

| Culling off | Culling on | Objects hidden, median |
| --- | --- | --- |
| 15.15, 16.61 ms | 13.47, 14.95 ms | 0 |

The check kept the passes off over those shots, so the median frame hid nothing, and the side with culling took no more time. Its frames waited on the GPU at 60 frames per second, 24 ms from submit to completion, so the busy times that the check compares hold a frame's queue too.

### The stall between passes

Under another program's GPU work, culling made the frame longer in earlier runs, though it made the opaque pass shorter. In Chrome 154, the room's frame with culling took 2.56 ms between passes against 0.36 ms without it, and 3.70 ms in all against 2.16 ms. The time fell outside every pass. Culling makes a chain of 5 dependent passes in place of 3, so a frame has more points where it waits behind other work. Prototype G1 measured 38% to 66% more under load on the Mac with exact timestamps, and 7% less on a quiet GPU. A Metal trace under load, which would show whose work fills the gaps, is not read yet. The check is the answer to it: it measures the frame with those waits, and turns the passes off where they cost more.

### Prototype G1 on the Mac

Prototype G1 timed the room scene of marked walls, before the check and before culling ran beside the depth prepass. Chrome 155 on the Mac drew the `gpu-occlusion` page on WebGPU, with 96-segment spheres, MSAA and 1280 x 720. Each build had 3 runs of 3 rounds of 4 s quiet, then 3 runs beside a second Chrome that drew a heavy shader in 4 passes per frame, with exact timestamps. GPU time per frame, the mean of the 3 runs' medians:

| Build | Run | Culling off | Culling on | Change |
| --- | --- | --- | --- | --- |
| First level at half size | Quiet | 2.31 ms | 2.14 ms | 7% less |
| First level at half size | With the load page | 2.53 ms | 3.83 ms | 38% to 66% more |
| First level at a quarter size | Quiet | 2.30 ms | 2.38 ms | 3% more |
| First level at a quarter size | With the load page | 2.41 ms | 3.88 ms | 57% to 66% more |

- The opaque pass fell from 1.91 to 1.16 ms, and the pyramid and the second phase took 0.48 ms.
- A first level at a quarter size hides as much, but its compute pass takes 0.72 ms against 0.48 ms. The pyramid keeps a first level at half size.
- An earlier quiet run in Chrome 154 saved 37%, 1.64 against 1.04 ms, and cost 19% to 40% more under load.

## Decision

Option (a4) with the check. Every opaque object and row that showed last frame and looks large draws its depth at one sample per pixel, at the level of detail and the vertex positions that the frame draws. A pyramid in a storage buffer holds it, and the history sits after the indirect draws. Its shaders load on first use, once a scene holds an object that may hide others. It meets the image rule on every WebGPU tier tested with MSAA.

The check keeps the extra passes only while they hide at least 10% of the objects that would draw, and the GPU's frame from submit to completion is no longer than 102% of the frame without them. It runs a trial in the other mode every 120 frames.

High and Ultra turn it on for desktops, by the owner's approval to overturn the earlier off choice. The runs above show no loss with the check, quiet or under load, within their noise ([D-22](D-22-occlusion-presets.md)). Medium keeps it off: at Medium it made the frame longer in the desert, the Bistro street scene and four of the benchmark scenes, with the check deciding too, and its gain in the Island lay inside the noise ([D-22](D-22-occlusion-presets.md#medium-on-desktops-rejected)). Phones and tablets keep it off on every preset (D-53, ruling 15), unless the page asks for it.

## Consequences

- The preset table's `gpuOcclusion` row is on for High and Ultra. `createEngine`'s chooser leaves it off on phones and tablets unless the page's option or `?occlusion=` sets it. `?occlusion=on|off` sets it on WebGPU and `softwareOcclusion` on WebGL2.
- `setOccluder(false)` and the `occluder: false` option of `createMesh`, `instantiate` and `createInstances` keep an object or a batch's rows out of the occluders. `setOccluder(true)` keeps its meaning on WebGL2, and on WebGPU it equals no mark.
- `engine.measure` reports `occludedEntries` on WebGPU too: the hidden count of the newest frame whose counts landed, and 0 while the check keeps the passes off. It is null where GPU occlusion culling does not run. The software occlusion test checks both cases on WebGPU.
- `?occlusion-check=off` holds the passes on, for tests that compare the image with culling and without it.
- At Medium the check does not keep the cost near zero everywhere: in the Bistro street scene the main pass took about 2 ms longer with the setting on, while the check kept the passes off for most frames and culling hid at most 3 objects. The cause, outside the extra passes, is not known ([D-22](D-22-occlusion-presets.md#medium-on-desktops-rejected)).
- Control slot 60 (`OcclusionRead`) is the slot that the reads raise. Nothing reads it.
- The culling stage is full. Its group binds 8 storage buffers. The counts share the indirect draws' buffer, after the history.
- Safari 26 encodes a render bundle with indirect draws again at every `executeBundles`. The occluders' pass adds one bundle per camera view.
- FXAA images vary by a few dozen pixels from run to run, with or without culling. The cause is not known.
- Later options: run the under-load comparison on a quiet Mac, and on Safari. Test shadow casters against a light's own pyramid. Build every level in one dispatch, as AMD's single-pass downsampler does. Test the patches of cluster trees against the pyramid.
