# D-20: WebGPU skinning

Status: decided on 2026-10-08. The owner ruled that the vertex shaders skin on WebGPU by default, as the rule asks. The compute pass failed it on all five devices measured: the Mac, three Android phones and a cloud iPad. The compute pass stays for morphed meshes, for materials without SKIN builds, behind `?skinning=compute`, and, since the owner's ruling of 19 October 2026, on a device whose start-up probe measures it clearly faster (last addendum). The owner's iPad ran the timing page on 2026-10-11, where the compute pass saved 0% to 9% with two or more cascades. The engine's default change landed on main on 2026-10-13 with M2-EX41. The Mac's Safari, and S5 on the owner's iPad, are still to run; neither can change the result. On 2026-10-12 the owner ruled that custom materials' SKIN builds load on first use (option B, last addendum). Date: 2026-10-04, updated 2026-10-13. Task: M2-C3, M2-C8, M2-EX41.

Summary: Skin once per frame in a compute pass, or in the vertex shader of every pass, as WebGL2 does. The engine builds both, and both draw the same images. The compute pass now skips still poses and writes 8-bit normals, so S5's 500 knights take 49.6 MB of skinned vertices, not 69.4 MB. On the Mac's Chrome it saves nothing against the vertex shaders (3.60 against 3.63 GPU ms), far from the rule's 10%. In S5 it saves at most 4.1% on the Android phones and 4.3% on a cloud iPad. On the timing page it costs 4% to 79% more on each phone, and 26% to 30% more on the iPad. So it fails the rule on all five devices measured. On 8 October 2026 the owner made the vertex shaders WebGPU's default. The compute pass still skins morphed meshes, and meshes whose material has no SKIN build: the debug views and a sketch's full shaders. Since 12 October 2026, skinned copies of one mesh and material share an instanced draw, and custom materials have SKIN builds, which load on first use by the owner's ruling (last addendum).

## Question

On WebGPU, should the engine skin each animated mesh once per frame in a compute pass? The shadow and main passes would then draw the skinned vertices. Or should it skin each mesh in the vertex shader of every pass that draws it, as WebGL2 does ([D-10](D-10-webgl2-skinning.md))?

## Rule

Keep the compute pass if it saves at least 10% of the frame time with two or more cascades. It must do so on the Mac and on the iPad, with identical images. This is D-10's rule on the other GPU path.

## Both ways in the engine

The engine builds both, so the data can pick either. Until 8 October 2026 the compute pass was the default, and `?skinning=vertex` picked the vertex shader on WebGPU. Since then the vertex shader is the default, and `?skinning=compute` picks the compute pass. What both share:

- A loader links a mesh object to an animated instance with the scene command `SET_SKIN`. A skinned object draws from a bucket of its own, as any object with bounds of its own does.
- Each frame's skinning matrices reach the GPU in one RGBA32F texture: 512 joints per row, three texels per joint. A row is then 1,536 texels wide, as the WebGL2 data textures' rows are, so it fits the 2,048 texels that every WebGL2 device allows. Until 4 October 2026 a row held 1,024 joints, 3,072 texels, which a device at that floor could not create. The texture's height has the same floor, so an animation table holds at most 2,048 rows, 1,048,576 joints. The animation step writes one of two matrix buffers in turn. So each frame uploads straight from the buffer of its own step, with no copy. The WebGL2 path (M2-C4) can read the same texture.
- A skinned object culls with a sphere that its pose moves. Each mesh keeps a sphere per joint around the vertices that the joint moves. After each animation step the core moves those spheres by the pose and writes the sphere around them all. A skinned vertex is a weighted average of its joints' matrices applied to it, so it lies inside that sphere, whatever the pose. A Rust test checks every vertex of a column against 200 random poses. Each joint turns up to half a turn, scales by 0.5 to 2 and moves up to 3 m.

The compute pass (`gpu_driven/skin.rs`, `skin.wgsl`, and `?skinning=compute`):

- Each skinned object gets a region of a skinned vertex buffer for each part of its mesh, when the scene's structure changes. A region holds the mesh's vertices without joints and weights, with positions, normals and tangents as 32-bit floats. The views' bundles draw the regions with the mesh page's indices, so they are recorded only when the structure changes.
- The regions fill up to 8 skinned vertex buffers, each at most the device's largest storage binding. That is 1 GiB in all at WebGPU's default of 128 MiB. Each run of one mesh page's parts in one buffer is a segment of the pass's table. At most 32 mesh pages hold skinned meshes. A scene past either cap gets E1501, which names it ([D-57](D-57-capacities.md)). Until 4 October 2026 the pass had one buffer and one dispatch per page. So a crowd past a binding or past 65,535 workgroups lost characters with no error.
- Each frame, the CPU tests each skinned object's world sphere against the views that draw. These are the cameras, and for casters, the cascades and the shadow tiles that draw that frame. One dispatch per segment skins the parts of the objects that some view draws, one thread per vertex, 64 to a workgroup. A dispatch past 65,535 workgroups spreads them over rows. The shader reads every vertex type that glTF allows (D-25).
- The passes then draw the skinned vertices with the pipelines of plain meshes. So every template skins, custom materials and the debug views too, with no shader variant of its own.

The vertex shader (the default since 8 October 2026):

- The lit, standard maps, unlit, unlit map and shadow depth templates gain SKIN builds. Each blends its vertex's four joints from the joint texture. A bind group of its own holds the texture, after the frame's group or after the maps' group.
- Each skinned object's bucket names the first joint of its skin, and the culling pass copies it beside the material into each instance it draws.
- Custom materials and the debug views have no SKIN builds. Giving custom materials SKIN builds would double their WebGPU builds. Until 8 October 2026 they drew skinned meshes at rest in this mode. Now the compute pass skins their objects, as it morphs morphed ones (see the last addendum).

## Data

### Images and parity

| Measure | Result | Where |
| --- | --- | --- |
| The skinning scene against three.js's `SkinnedMesh` (`bun run parity -- --scene skinning`) | 0.000% of pixels differ on core WebGPU and 0.043% in compatibility mode; three.js's two renderers differ by 0.032% | Chrome on the Mac's GPU, 2026-10-03 |
| The vertex shader's images against the compute pass's: the skinning scene, with shadows, and with a see-through character | Within the default tolerance of the same references, on both WebGPU tiers | `bun run test:images -g skinning`, the Mac's GPU and SwiftShader |
| A quantized mesh (positions in 16-bit whole millimeters, 8-bit normals, joints and weights) against floats | Within the default tolerance of the float image | the same run |

### Download size

The WebGPU shader modules hold both ways while the decision is open. Against main on 2026-10-04, each WebGPU module grew from about 19.2 KB to 23.4 KB after Brotli. The SKIN builds take 2.3 to 3.5 KB of that, measured by building the modules with and without them. The compute pass's shader and the culling shader's new word take the rest. Each core WebAssembly file grew 3.3%, from 210.4 to 217.3 KB, for the bounds, the layout and the skinned passes, which both ways share. The WebGL2 modules did not change.

### Timing

The WebGPU skinning page (`tests/pages/skinning-webgpu.html`) is the twin of D-10's WebGL2 page. It draws the same scene both ways with WebGPU calls of its own, so no engine code runs. [Device sessions](../devices.md#the-skinning-plan) describes the scene and the timing. In short:

- A crowd of 50 to 500 generated characters. Each has 2,560 vertices, 5,040 triangles and a chain of 32 joints, with four joint weights per vertex. The page bends each chain every frame.
- A directional light with 1 to 4 cascades of 2048 x 2048 texels, each fitted to its slice of the view. Both paths cull the crowd per pass on the CPU.
- A frame of 1280 x 720 pixels on every device, with four shadow map taps per pixel.
- Both paths upload the joint matrices to a float texture each frame, as the engine does. The vertex shader path skins each character in each pass that draws it. The compute path skins each character that some pass draws once, with one thread per vertex, into one buffer of positions and normals. Each pass then draws that buffer with plain vertex shaders.
- Each frame goes to the GPU in a submit of its own. Each batch of frames ends when the GPU has finished its last frame. Where the adapter has timestamp queries, the page also times the GPU from each batch's first pass to its last.

The page runs with `bun tests/real-browsers.ts --plan skinning-webgpu --lan ipad-safari "Google Chrome"`. S5 (M2-L2) gives a second check in a real scene through the engine's `?skinning=` switch. The addenda below give both sets of runs.

## Decision

The vertex shaders skin on WebGPU by default, as on WebGL2. The owner ruled so on 8 October 2026, by the rule: the compute pass never saved 10% of the frame time on any device measured. The compute pass stays in the engine for the objects that the vertex shaders cannot skin, and for measurements. The last addendum gives the ruling, its figures and what changed.

## How three.js handles it

three.js's WebGPU renderer (0.186) skins in the vertex shader, as its WebGL renderer does, and its shadow passes skin each mesh again. Its skinning node reads each mesh's bone matrices from a uniform buffer of 4 × 4 matrices. Skeletons too large for the uniform buffer limit read them from a bone texture. A `computeSkinning` helper lets an app skin a mesh in a compute pass of its own, but the renderer never uses it itself. three.js culls a `SkinnedMesh` with a sphere that `computeBoundingSphere` works out from every skinned vertex. It does so once, at the pose of the mesh's first frustum test, and again only when the app calls it. So a limb that later swings out of that sphere can vanish at the view's edge. null3D moves its bounds with the pose each frame, from a sphere per joint.

## Consequences

- The plan was that the losing way leaves the engine, with the `?skinning=` switch. The compute pass lost, but it stays: WebGPU morphs only in it ([D-51](D-51-morph-targets.md)), custom materials and the debug views skin only in it, and a device whose start-up probe measures it clearly faster takes it. The last addendum gives the reasons. So both ways stay, and so does the switch.
- WebGL2 (M2-C4) skins in the vertex shader, by D-10, with the same joint texture and the GLSL builds of the same SKIN code.
- The record is in the table in [README.md](README.md).

## Addendum, 2026-10-04: what decides this record

The technique review and the owner's rulings of 4 October 2026 ([D-53](D-53-technique-defaults.md)) change how this record is decided:

- Decide it in S5 as well as on the timing page, and on an Android phone with WebGPU. The Galaxy S24+ has no WebGPU adapter, so BrowserStack's Galaxy S25 (Adreno 830) and Pixel 9 (Mali-G715) run it (ruling 10). Prototype A1 runs S5 with the compute pass, with `?skinning=vertex`, and with the lean changes below.
- Mali compiles each vertex shader into a position shader and a varying shader, and Adreno's binning pass runs a position-only vertex shader. So a joint blend that feeds both the position and the normal can run twice there ([Arm's Mali Offline Compiler guide](https://documentation-service.arm.com/static/648aeb7f153eb247a5450a90), [Qualcomm's best practices](https://docs.qualcomm.com/bundle/publicresource/topics/80-78185-2/mobile_best_practices.html)). Compute skinning blends once. That favors the compute pass on Android, but no vendor advises either way, and Qualcomm advises keeping graphics submits apart from compute dispatches.
- The timing page writes 24 bytes per skinned vertex; the engine writes 28 to 48. So the page's figures understate the compute pass's cost.
- If the compute pass stays, it gets lean (proposed M2-C8). It skips objects whose pose did not change, and writes normals and tangents in 8 bits. The Knight's skinned vertex falls from 28 to 20 bytes, and S5's skinned memory from 69 MB to about 49 MB. It carries the fixes of R5-02: a dispatch split by GPU limits, and an error past them.

## Addendum, 2026-10-04: skinning loads on first use

[D-56](D-56-first-use-shader-files.md) moves the skinning pass and every SKIN build into the skinning feature's own shader files, which a page downloads with its first skinned mesh. Every pass leaves a page's skinned meshes out until their pipelines are built: the skinning pass's, and every one that draws them. So no pass draws vertices that the skinning pass has not written. So neither way's shaders count at a page's start any longer.

## Addendum, 2026-10-06: the lean skinning pass

M2-C8 builds the lean pass that the first addendum proposes. The decision itself still waits for prototype A1's runs, listed below. No report of A1 existed when this work started, so its runs start from this branch.

### What the pass does now

- It skips each object whose regions already hold its pose. The core gives each animated instance a pose step: the frame step that last changed its skinning matrices (`Animations::pose_step`). The step compares the new matrices with the step before's. A character keeps its step while it stands still or a paused clip holds it. It keeps it too while a slower update rate (M2-C6) leaves it alone. An object skins when its pose step or its morph weights changed since its last skin.
- The regions keep no pose after a new layout, a new skinned vertex buffer or a new GPU device. They keep none in frames whose skinning pipelines may still build either, since a dispatch of a pipeline that is not built writes nothing. Each of these skins every object that a view draws once more.
- The joint texture uploads nothing while no pose changed. A new layout uploads it again, which also covers a frame that failed before its list replayed.
- It writes normals and tangents as 8-bit normalized integers, one word each, as unit directions. A tangent keeps its handedness in the fourth byte, which stores -1 and 1 exactly. The Knight's skinned vertex falls from 28 to 20 bytes. A knight draws 4,957 vertices: the body's six skinned meshes, the helmet, the cape, a sword and a shield. S5's 500 knights so take 49.6 MB of skinned vertices, down from 69.4 MB.
- A pipeline constant (`@id(1100)`, `narrow_directions`) picks floats instead, so one shader module serves both layouts. The constant is fixed when the pipeline is built, so no driver sees a runtime branch around the writes. That matters on Adreno. On the Galaxy S25 in October 2026, its driver ran a write of the skinning pass behind a runtime check that was false.

### Why 8 bits

- The asset tool already stores optimized meshes' normals in 8 bits, so a skinned normal in 8 bits keeps the precision the mesh had. Its largest error is under half a degree.
- 16-bit normals would take 24 bytes per Knight vertex, for precision that the source lacks.
- An octahedral 16-bit normal in one word would be more precise for the same 4 bytes. But no vertex format decodes it, so every vertex shader of every template, custom materials' included, would need a decode step and a second build. 8-bit normals need no shader change: the vertex fetch reads them as fractions.

### Switches for the runs

`?skinning=` picks the way. Without the switch, the pass has both savings. `full` has neither, as main had before this change. `skip` has the pose skip with 32-bit directions, and `narrow` has 8-bit directions without the skip. `vertex` skins in the vertex shaders. The benchmark page kinds `null3d-webgpu-skin-full`, `-skin-skip`, `-skin-narrow` and `-skin-vertex` carry them. S5's knights all walk in every frame. So the pose skip saves nothing there until M2-C6 slows far characters' updates. S5's `?still=<share>` switch makes that share of the knights stand still, so the runs can measure the skip too.

The D-20 timing page now writes what the engine writes for the Knight: positions as floats, 8-bit normals and 16-bit texture coordinates. That is 20 bytes per vertex, or 28 with `?normals=float`. It wrote 24 bytes before, against the engine's 28 to 48 (review new issue 10).

### Runs that decide this record (prototype A1)

- The Mac, Chrome, at a load below 8: `bun run bench:run --scenes s5 --pages null3d-webgpu,null3d-webgpu-skin-full,null3d-webgpu-skin-skip,null3d-webgpu-skin-narrow,null3d-webgpu-skin-vertex --switches "governor=off&preset=high"`, then the same with `still=0.5` added to the switches.
- The Mac, Safari: `bun tests/real-browsers.ts --plan bench --scenes s5 --pages <the same five> --switches "governor=off&preset=high" Safari`.
- The iPad: `bun tests/real-browsers.ts --plan bench --lan ipad-safari --scenes s5 --pages <the same five> --n <S5's iPad count> --switches governor=off`.
- BrowserStack's Galaxy S25 (Adreno), Pixel 9 (Mali) and Pixel 11 (PowerVR): the same plan with `--cloud`, as the coordinator's commands give.

The rule stays: keep the compute pass if it saves at least 10% of S5's frame time with two or more cascades, with identical images.

### A1 on the Mac, Chrome

The Mac ran S5's 500 knights at High (3 cascades), with the governor off, on 6 October 2026. Each page had 3 runs of 10 seconds' warm-up and 10 measured, in turns (`target/bench/20261005-183445-bench` and `20261005-184001-bench`, commit 807e6ea9c). The first set started at a load of 4.1 and ended at 6.4. The second started at 6.4 and ended at 9.4, above the limit of 8 for timing, so its figures are rougher.

| Page | GPU ms, every knight walks | CPU ms | GPU ms, half the knights still | CPU ms |
| --- | --- | --- | --- | --- |
| Lean pass (default) | 3.60 | 1.81 | 3.99 | 2.23 |
| `full`: neither saving | 3.70 | 2.00 | 4.22 | 2.41 |
| `skip`: pose skip only | 3.58 | 1.78 | 4.22 | 2.39 |
| `narrow`: 8-bit directions only | 3.63 | 1.82 | 4.01 | 2.64 |
| `vertex`: the vertex shaders skin | 3.63 | 1.54 | 4.10 | 2.14 |

- The lean pass takes 3% less GPU time than the full one with every knight walking, and 5% less with half of them still. Both differences lie near the runs' spread.
- On the Mac, the compute pass saves nothing against the vertex shaders: 3.60 against 3.63 ms of GPU time, far from D-20's 10%. The vertex shaders' frames cost 0.27 ms less CPU time, since they record no skinning dispatch and upload no table.
- The skinning itself is a small part of S5's GPU frame on the Mac. The 20,002 draw calls, one per skinned object in each pass, cost more. So the Mac alone cannot settle the rule; the iPad and the Android phones, whose GPUs repeat vertex work, decide it.
- Safari's run gave no figures: the Mac's screen was locked, so its runner page stopped on the first page. It runs again once the screen is unlocked.

### A1 on the Mac, Safari

A second Safari run, on 7 October 2026 at a load below 4, passed 16 of 16 runs. Every page drew about 5 fps, with about 155 ms of GPU time per frame, where Chrome needs about 3.6 ms. The branch then predated the fix for Safari 26's stall on indirect draws that share arguments ([D-85](D-85-safari-indirect-arguments.md)). That stall most likely sets these figures, so they do not count for this rule. The only reading within the run: the vertex shaders took about 11% more GPU time than the compute pass pages (172.3 against 155.2 ms). The run is to repeat on the rebuilt branch.

## Addendum, 2026-10-08: the branch made again on main

Since this work began, main merged three changes that touch the skinned vertex. They are the index-instance switch (M2-K1), the S25 fix that builds the pass with and without tangent code, and color morph targets (M2-C11). The lean pass now fits beside them:

- The pass keeps one build per tangent and color bit. The pipeline constant for 8-bit directions applies to each build, so the constant adds no build.
- A morphed mesh's color stays four 32-bit floats, after the 8-bit normal and tangent, since morph targets may push it outside what 8 bits hold. Its offset in the skinned vertex moves up with the narrower directions, and a unit test checks that layout.
- Held poses count from the first frame that waits for every pipeline, as the pipeline cache counts that frame's pipelines as built.

Checks of the rebuilt branch on the Mac's GPU, on 8 October 2026:

- The image tests of skinning, morph targets and glTF passed 115 of 120 on every GPU path. The 5 others were the new normal-map test below, which had no references yet. No existing reference moved.
- The skinning, skinning pass and animation browser tests passed 13 of 13. The skinning pass page checks both layouts against the CPU.
- A new image test, `skinning-normal-map`, lights the characters through a normal map of grooves, so the light shows each skinned tangent. With 8-bit tangents and with 32-bit ones, the images differ by at most 4 levels in any pixel, on the Mac's GPU and on SwiftShader. WebGL2's vertex shaders, which skin in floats, match the same reference.

## Addendum, 2026-10-08: A1 on the Galaxy S25

BrowserStack's Galaxy S25 (Adreno 830, Chrome 152) ran the rebuilt branch at 27cccd28d on 7 October 2026. Its screen ran at 30 Hz, so the frame times show only the screen's pace. The figures below are GPU times from the GPU's timer, and the main thread's CPU times. The run files are in the [S25's folder](../tested-devices/galaxy-s25-sm-s931b-chrome/README.md).

The checks passed 21 of 21 (run `20261007-213008-checks`). They cover the skinning pass page on both WebGPU tiers, and the skinning, morph and glTF images with 8-bit and 32-bit directions.

S5 drew 150 knights at High, with 3 cascades and the governor off. Each page had 3 runs in turns. Each figure is the middle of the 3 runs' medians (runs `20261007-213535-bench` and `20261007-215025-bench`).

| Page | GPU ms, every knight walks | CPU ms | GPU ms, half the knights still | CPU ms |
| --- | --- | --- | --- | --- |
| Lean pass (default) | 22.28 | 3.42 | 20.94 | 4.36 |
| `full`: neither saving | 22.28 | 3.48 | 20.84 | 4.21 |
| `skip`: pose skip only | 22.12 | 3.41 | 20.71 | 4.28 |
| `narrow`: 8-bit directions only | 22.28 | 3.39 | 21.10 | 4.26 |
| `vertex`: the vertex shaders skin | 21.10 | 2.99 | 23.72 | 3.38 |

The timing page drew 200 characters at 20 bytes per skinned vertex (run `20261007-220602-skinning-webgpu`). The two ways' images differed in 0 of 921,600 pixels.

| Cascades | Vertex shaders, GPU ms | Compute pass, GPU ms | Compute pass against the vertex shaders |
| --- | --- | --- | --- |
| 2 | 1.98 | 2.73 | 38% more |
| 4 | 3.37 | 3.68 | 9% more |

What the figures show:

- With every knight walking, the compute pass takes 5.6% more GPU time than the vertex shaders. It also takes 0.43 ms more CPU time. On the timing page it takes 9% to 38% more GPU time.
- The lean savings change nothing on the S25. In each set, the lean, `full`, `skip` and `narrow` pages lie within 0.4 ms of each other.
- With half the knights still, the compute pass takes 12% less GPU time than the vertex shaders. The pose skip gives none of that: `full`, which skins every knight in every frame, takes 20.84 ms. The vertex shaders took 2.6 ms more than with every knight walking, and the run does not show why. So this reading does not count as a saving of the compute pass until a repeat explains it.
- The first addendum expected Adreno's binning pass to favor the compute pass, since it runs the joint blend twice in the vertex shaders. On the S25 the vertex shaders are faster all the same.

### What this means for the rule

The rule keeps the compute pass only if it saves at least 10% of the frame time on every device that decides it. On the Mac's Chrome it saved 1%. On the S25 it costs more than the vertex shaders, in S5 with every knight walking and on the timing page. So the compute pass fails the rule on both devices measured so far. No run on the iPad, the Pixel 9 or the Pixel 11 can make it pass. By the rule, the vertex shaders become the WebGPU default, and the compute pass leaves the engine.

This branch does not make that change. The compute pass stays the default until the owner rules on this record. The Pixel 9 and Pixel 11 figures follow in the next addendum.

## Addendum, 2026-10-08: A1 on the Pixel 9 and the Pixel 11

BrowserStack's Pixel 9 (Mali-G715) and Pixel 11 (PowerVR C-Series) ran the same commit and plans as the S25, on Chrome 152, on 7 October 2026. Both screens ran at 60 Hz, so their frame times count too. The figures are GPU times from the GPU's timer, each the middle of 3 runs' medians. The run files are in the folders of the [Pixel 9](../tested-devices/pixel-9-chrome/README.md) and the [Pixel 11](../tested-devices/pixel-11-chrome/README.md).

The checks passed 21 of 21 on each phone. Every page of S5 and of the timing page passed on both. The timing page's two ways differed in 0 of 921,600 pixels, except 1 pixel on the Pixel 11 with 4 cascades, within the page's limit.

S5 drew 150 knights at High, with 3 cascades and the governor off.

| Page | Pixel 9, every knight walks | Pixel 9, half still | Pixel 11, every knight walks | Pixel 11, half still |
| --- | --- | --- | --- | --- |
| Lean pass (default) | 30.93 | 28.64 | 24.44 | 26.41 |
| `full`: neither saving | 32.24 | 29.85 | 26.15 | 27.72 |
| `skip`: pose skip only | 30.47 | 28.57 | 25.17 | 27.79 |
| `narrow`: 8-bit directions only | 31.85 | 29.56 | 25.85 | 26.54 |
| `vertex`: the vertex shaders skin | 32.24 | 30.54 | 24.44 | 24.44 |

On the Pixel 11, each page's 3 runs spread by up to 3.7 ms. So its differences of 1 to 2 ms lie within the spread. With every knight walking, its vertex shaders took 4.03 ms of CPU time. The compute pass pages took 5.51 to 5.57 ms. On the Pixel 9, every page took 10.2 to 10.6 ms of CPU time.

The timing page drew 200 characters at 20 bytes per skinned vertex.

| Phone | Cascades | Vertex shaders, GPU ms | Compute pass, GPU ms | Compute pass against the vertex shaders |
| --- | --- | --- | --- | --- |
| Pixel 9 | 2 | 2.95 | 5.27 | 79% more |
| Pixel 9 | 4 | 4.19 | 6.73 | 61% more |
| Pixel 11 | 2 | 4.92 | 5.61 | 14% more |
| Pixel 11 | 4 | 7.49 | 7.78 | 4% more |

### All four devices

The compute pass's saving against the vertex shaders, in GPU time. A negative figure means the compute pass costs more.

| Device | S5, every knight walks | S5, half the knights still | Timing page, 2 cascades | Timing page, 4 cascades |
| --- | --- | --- | --- | --- |
| Mac, Chrome (500 knights) | 1% | 3% | not run | not run |
| Galaxy S25 (Adreno 830) | -5.6% | 12% | -38% | -9% |
| Pixel 9 (Mali-G715) | 4.1% | 6.2% | -79% | -61% |
| Pixel 11 (PowerVR) | 0% | -8.1% | -14% | -4% |

- With every knight walking, the compute pass never saves the rule's 10%. The best saving is the Pixel 9's 4.1%.
- On the timing page, the vertex shaders are faster on every phone, at both cascade counts.
- The compute pass leads in two places only. On the Pixel 9 it leads by 4.1% and 6.2% in S5. In the S25's set with half the knights still, it leads by 12%. The pose skip gives none of that, and the run does not show why (see the S25 addendum).
- The lean savings help most on the Pixel 9 and the Pixel 11: the lean pass takes 4% to 7% less GPU time there than `full`. The Pixel 11's share lies within its runs' spread. On the S25 and the Mac they change little.

### The rule's result

The compute pass fails the rule on all four devices. It never saves 10% of the GPU time with every knight walking, and the timing page favors the vertex shaders on every phone. The Mac's Safari and the iPad are still to run. The rule needs a saving on every device, so they cannot make the compute pass pass. By the rule, the vertex shaders become the WebGPU default, and the compute pass leaves the engine.

The vertex shaders are not faster everywhere: the Pixel 9's S5 favors the compute pass by up to 6.2%, under the rule's 10%. The switch of the default waits for the owner's ruling on this record. Until then the engine skins in the compute pass.

## Addendum, 2026-10-08: A1 on a cloud iPad

BrowserStack's iPad (10th generation) (A14, Safari 27.0, iPadOS 27) ran the same commit and plans on 8 October 2026. The owner's own iPad runs stay owed; this cloud run adds a device, and does not replace them. Its screen ran at 60 Hz. The run files are in the [iPad's folder](../tested-devices/ipad-10th-generation-safari/README.md).

The checks passed 21 of 21 (run `20261008-023705-checks`), and every page of S5 and of the timing page passed.

S5 drew 150 knights at High, with 3 cascades and the governor off (runs `20261008-024213-bench` and `20261008-025817-bench`). Each figure is the middle of 3 runs' medians, in GPU ms.

| Page | Every knight walks | Half the knights still |
| --- | --- | --- |
| Lean pass | 149.15 | 146.97 |
| `full`: neither saving | 148.73 | 149.64 |
| `skip`: pose skip only | 148.34 | 146.24 |
| `narrow`: 8-bit directions only | 149.92 | 145.75 |
| `vertex`: the vertex shaders skin | 155.81 | 155.75 |

The timing page drew 200 characters at 20 bytes per skinned vertex (run `20261008-031725-skinning-webgpu`). The two ways' images differed in 0 of 921,600 pixels.

| Cascades | Vertex shaders, GPU ms | Compute pass, GPU ms | Compute pass against the vertex shaders |
| --- | --- | --- | --- |
| 2 | 4.13 | 5.19 | 26% more |
| 4 | 5.32 | 6.89 | 30% more |

What the figures show:

- At 150 knights, S5 is far past this iPad's frame budget on every page: about 150 ms of GPU time and 4 frames per second. The cloud iPad's known issue applies: work outside the page holds its GPU, so its figures compare only within one session.
- In S5 the compute pass saves 4.3% of the GPU time with every knight walking, and 5.6% with half of them still. Both are under the rule's 10%. The pose skip and the 8-bit directions change little.
- On the timing page the vertex shaders are faster, by 26% and 30%, as on every phone.
- The vertex shaders' frames cost 0.3 to 0.5 ms less CPU time: 2.30 ms against 2.62 to 2.80 ms.

So the compute pass fails the rule on this iPad too.

## Addendum, 2026-10-08: the owner's ruling

On 8 October 2026 the owner ruled on this record: the vertex shaders skin on WebGPU by default. The rule decided it. The figures that decided it are in the addenda above:

- With every knight walking in S5, the compute pass saved at most 4.3% of the GPU time (the cloud iPad), against the rule's 10%. It saved 4.1% on the Pixel 9, 1% on the Mac's Chrome and 0% on the Pixel 11, and cost 5.6% more on the Galaxy S25.
- On the timing page, the vertex shaders were faster on every phone and on the cloud iPad, at 2 and 4 cascades. The compute pass took 4% to 79% more GPU time.
- The vertex shaders' frames also cost less CPU time, as they record no dispatch and upload no table. They saved 0.27 ms on the Mac, 0.43 ms on the S25 and about 1.5 ms on the Pixel 11.
- The rule needs a saving on every device. So the runs still to come on the Mac's Safari and the owner's iPad cannot keep the compute pass. They run all the same, to record the vertex shaders' figures there.

### Why the compute pass stays

The plan had the losing way leave the engine. The compute pass stays, for three reasons:

- WebGPU morphs only in the pass ([D-51](D-51-morph-targets.md)). It has no MORPH builds, so morphed meshes, skinned or not, need the pass.
- Custom materials and the debug views have no SKIN builds on WebGPU. Before this change, `?skinning=vertex` drew their skinned meshes at rest. As a default, that would break the intent parity rule ([D-52](D-52-intent-parity.md)). SKIN builds would double each custom material's WebGPU builds, as they doubled its WebGL2 builds. [D-10](D-10-webgl2-skinning.md) measured 17.0 KB against 22.7 KB after Brotli for one surface function. Most custom materials never draw a skinned mesh, so the pass serves the few that do.
- `?skinning=compute` keeps the comparison open for the runs still to come, and for any device where the figures change.

Options not taken:

- Keep the compute pass as the default. It failed the rule on every device measured.
- Take the compute pass out, with SKIN builds for custom materials and MORPH builds for WebGPU. That doubles every custom material's builds and adds a MORPH build to every WebGPU template. It would save one compute shader in a file that loads on first use.
- Leave custom materials' skinned meshes at rest. That draws them wrong.

### What changed

- The core's default skinning mode is the vertex shader (`SkinningMode::VERTEX`). Without the switch, the engine starts in it.
- At each new layout, a skinned object takes the vertex shaders only when its pair's pipeline has SKIN builds. These are the lit, standard maps, unlit and unlit map templates. The casters' and outline mask's templates all have SKIN builds. The pass takes morphed objects, and objects whose pair draws with any other template. Those are custom materials, the debug views and the test templates. The pair's pipeline already folds in the debug view, and turning a debug view on or off rebuilds the layouts, so the choice follows it.
- The pass's buffers, table and dispatches cover only the objects it takes. A scene with no morphed object and no custom material on a skinned mesh records no skinning pass, and keeps no skinned vertex buffer. S5's 500 knights so no longer take 49.6 MB of skinned vertices.
- `?skinning=compute` replaces the switch's old default, `lean`: the pass with both savings, for every skinned object. `full`, `skip` and `narrow` stay. The benchmark page kind `null3d-webgpu-skin-compute` replaces `-skin-vertex`.
- When a page preloads skinning, WebGPU now also creates the shader modules of the SKIN builds while the vertex shaders skin. It still builds the pass's pipelines, which morphed meshes and custom materials need.
- The image tests that drew the vertex shaders with `?skinning=vertex` now draw the compute pass with `?skinning=compute`. They keep the same references. `skinning-normal-map-compute` joins them: it checks the pass's 8-bit tangents against the vertex shaders' floats.
- The shader modules did not change, so the download sizes did not change either.

### The new default on the Mac

The Mac's Chrome ran S5 on 11 October 2026, with the change merged with main: 500 knights at High, governor off, 3 runs of 10 s each, the two pages in turns, at a load of 4.7 to 7.4. `null3d-webgpu` is the new default, and `null3d-webgpu-skin-compute` skins every knight in the pass, as the old default did (runs `20261011-074653-bench` and `20261011-074904-bench`).

| Page | CPU ms per frame | GPU ms | Presented fps |
| --- | --- | --- | --- |
| Every knight walks: vertex shaders | 1.81 (1.32 to 1.97) | 5.31 | 120.0 |
| Every knight walks: the pass | 2.40 (1.97 to 2.43) | 5.16 | 114.8 |
| Half the knights still: vertex shaders | 1.64 (1.28 to 1.76) | 5.36 | 120.0 |
| Half the knights still: the pass | 2.18 (1.81 to 2.40) | 5.20 | 118.1 |

The pass saves 2.8% to 3.0% of the GPU time, under the rule's 10%, as before. The vertex shaders save 0.54 to 0.59 ms of CPU time per frame, and hold 120 frames per second, where the pass drops frames.

## Addendum, 2026-10-11: the timing page on the owner's iPad

The owner's iPad Pro 11 (2018, A12X, Safari 26.6.2) ran the `skinning-webgpu` plan over the local network on 11 October 2026, on main at f854dd72d (run `20261011-082012-skinning-webgpu`). Every page passed: 16 of 16. In every page the two ways' images differed in 0 of 921,600 pixels. The iPad was on its charger, with Limit Frame Rate on, and the screen held 59 Hz before every page. The Mac that served the pages ran at a load of 15 to 18. That slows only the serving, not the iPad's GPU timings. S5 did not run on this iPad in this sitting.

Each figure is the GPU time per frame, vertex shaders / compute pass, and how much the compute pass saves.

| Characters | 1 cascade | 2 cascades | 3 cascades | 4 cascades |
| --- | --- | --- | --- | --- |
| 50 | 1.89 / 1.75 ms, 7% | 1.90 / 1.77 ms, 7% | 2.12 / 1.90 ms, 10% | 2.33 / 2.03 ms, 13% |
| 100 | 3.04 / 3.01 ms, 1% | 3.06 / 3.06 ms, 0% | 3.52 / 3.34 ms, 5% | 3.85 / 3.59 ms, 7% |
| 200 | 5.29 / 5.13 ms, 3% | 5.37 / 5.22 ms, 3% | 6.04 / 5.65 ms, 6% | 6.74 / 6.13 ms, 9% |
| 500 | 11.43 / 11.08 ms, 3% | 11.81 / 11.31 ms, 4% | 12.94 / 12.08 ms, 7% | 14.34 / 13.02 ms, 9% |

What the figures show:

- On this iPad the compute pass is faster on every page but one, where the two tie. Its saving grows with the cascades, as each cascade skins the crowd again in the vertex shaders.
- At 200 characters, the size of the other devices' rows, it saves 3% with 2 cascades and 9% with 4. The cloud iPad (A14, Safari 27) showed the opposite: the compute pass took 26% and 30% more there.
- It saves 10% or more only at 50 characters with 3 or 4 cascades, where the whole frame takes about 2 ms.
- The vertex shaders cost 0.01 to 0.08 ms less CPU time per frame.

The rule needs a saving of 10% in S5 on every device. The compute pass failed it on the Mac, the three phones and the cloud iPad, so this run does not change the owner's ruling. It does show that on the A12X the compute pass is the faster way, by up to 9% at sizes that matter.

## Addendum, 2026-10-12: shared buckets, and custom materials' SKIN builds on first use

Battle's comparison (task M2-EX41, [D-121](D-121-comparison-tier.md#battle)) found that each skinned object drew from a bucket of its own on WebGPU, so each unit cost one indirect draw in each view. At 1,000 units that was 10,214 draws a frame: about 2,100 in the camera's view, 2,000 in the depth prepass and 6,000 in the 3 cascades. WebGL2 drew the same scene in 289 draws, as its skinned copies of one mesh and material share an instanced draw.

What changed:

- Skinned objects that the vertex shaders skin share a bucket by mesh and material, as on WebGL2. They need no vertices of their own. The bucket's record names `PER_SOURCE_JOINT` (`u32::MAX`) as its first joint. The culling pass then takes each copy's first joint from a texture of 32-bit indices, one per source, and writes it into the copy beside the material. A texture keeps the culling group within the eight storage buffers that every device allows a shader stage. The bucket's sphere holds every object's sphere, around their centres' mean, and the animation step moves it each frame.
- The objects that the skinning pass skins keep a bucket each, as each has vertices of its own.
- Custom materials built from the standard template now have SKIN builds on WebGPU, as on WebGL2. So the vertex shaders skin them, and a crowd with a custom material draws in one instanced draw per view. Battle's soldiers and mechs have custom materials.
- A sketch's full shader has no SKIN builds. Its skinned meshes go to the skinning pass, which a full shader's flag (`Shading::is_full_shader`) picks. Before, a full shader on a skinned mesh would have failed its pipeline.

### The owner's ruling on the size of the SKIN builds

This record rejected SKIN builds for custom materials on 8 October 2026, for their size: they double each material's WebGPU builds, and most custom materials never draw a skinned mesh. On 12 October 2026 the owner chose option B: a custom material's WGSL SKIN builds load on first use only, when the material first draws a skinned mesh, as the engine's own first-use shader files do. A page with no skinned custom material pays nothing: no download and no pipeline.

- The shader compiler puts a material's WebGPU SKIN builds apart from its other builds (`skinVariants`). The Vite plugin moves them to a module of their own, `virtual:null3d/skin/<hash>`, which the material's value imports with `skinBuilds()`. A production build puts that module in a file of its own.
- The thread that draws holds a custom material's shader without its SKIN builds. The first pipeline that needs one parks, as a pipeline waits for a shader file, and asks the sketch's thread for them through the port of the images, once. The sketch's thread imports the module and sends the builds of its GPU path. The pipeline then builds. A failed import fails the pipelines that need the builds, with the reason.
- `scene.warmUp()` waits for these pipelines too, so a game that must fetch nothing during play warms its skinned objects up in the setup.
- WebGL2 keeps its SKIN builds in the material's module, as before.

Options rejected:

- SKIN builds in every custom material's module. They double each material's WebGPU builds for pages that never skin with it.
- Keep the skinning pass for custom materials. Each object then draws on its own, and Battle's units cost a draw per view each.
- Build the SKIN variant in the browser. The engine compiles no WGSL at run time.

### Figures

Battle on the Mac's Chrome 155, WebGPU, on 13 October 2026, before and after the change ([D-121](D-121-comparison-tier.md#battles-gpu-cost-and-memory-12-october-2026) has the whole run):

- Draws a frame fell from 10,214 to 333 at 1,000 units, and from 10,464 to 343 on the 4,000-unit pages.
- The busiest CPU thread's time fell from 8.6 to 13.9 ms to 5.7 to 9.6 ms on the 4,000-unit pages.
- The 4,000-unit pages held only 1,024 soldiers, in a scene that stood still: the engine's table of animated objects held at most 1,024 objects (found on 13 October 2026, task M2-R36). Their figures compare the two builds on that same scene, not null3D's cost at 4,000 units. The sketch worker no longer lays out a bucket for each unit.
- The frame's compute work fell from 1.4 to 1.6 ms to 0.1 ms, as the vertex shaders now skin Battle's custom materials.
- The GPU's frame time did not change: 12.6 to 17.1 ms before, 9.7 to 16.7 ms after, in runs that varied as much as that from page to page. Its largest render pass took 6.8 to 9.6 ms in both builds. So the draw count was not what bound Battle's GPU time on the Mac.

## Addendum, 2026-10-13: the default change landed on main

The engine's default change landed on main on 2026-10-13 with M2-EX41. The core starts in `SkinningMode::VERTEX` (`9f93d1a19`, merged from `feat/webgpu-vertex-skinning-default`), so no branch carries it any longer. Its Mac S5 figures are in [The new default on the Mac](#the-new-default-on-the-mac) above, and its Battle figures are in [D-121](D-121-comparison-tier.md#battles-gpu-cost-and-memory-12-october-2026).

Still to run, and neither can change the ruling: the Mac's Safari run of the timing page, and S5 on the owner's iPad. The compute pass failed the rule on every device that can decide it, and the rule needs a saving on every device measured.

## Addendum, 2026-10-19: the pass measured on an iPhone 17, and why it is not a default

The iPhone 17's Safari ran Battle's comparison on 19 October 2026, at 100 units on a 603 x 1009 canvas at a pixel ratio of 1.5, on the direct path. The first four pages of one session put the skinning pass about 6.6 ms ahead of the vertex shaders:

| Page | Presented fps | GPU time | Draws |
| --- | --- | --- | --- |
| Battle, the vertex shaders | 24.4 | 32.01 ms | 304 |
| Battle, `?skinning=compute` | 28.0 | 25.36 ms | 1,238 |
| Factory, the vertex shaders | 45.6 | 15.86 ms | 152 |

The figures do not hold. In the same session the first page is about 5 ms slower than every page after it with the same settings, and that first page carried the vertex shaders. A later run took the same Battle page eight times in one session and alternated the two routes:

| Page | Presented fps | GPU time | Draws |
| --- | --- | --- | --- |
| The vertex shaders, first page of the session | 25.1 | 29.90 ms | 298 |
| The vertex shaders | 30.0 | 23.81 ms | 266 |
| The vertex shaders | 29.8 | 24.06 ms | 266 |
| The vertex shaders | 28.5 | 25.63 ms | 265 |
| `?skinning=compute` | 27.1 | 25.36 ms | 1,238 |
| `?skinning=compute` | 27.3 | 26.04 ms | 1,238 |

- Warm, the pass is no faster than the vertex shaders on this phone, and it draws each skinned unit on its own: 1,238 draws against 265. On the indirect path it fell to 10.4 frames and 79.35 ms, because WebKit charges for each of its indexed indirect draws.
- So the vertex shaders stay the default on every device. `?skinning=compute` remains the switch for a page that measures the pass, and no default changed.

The owner's ruling of 8 October 2026 stood until later that day, when the owner ruled that a start-up probe decides the way for each device. The next addendum records the probe, and the measured figures above stand for the phone.

## Addendum, 2026-10-19: the start-up probe picks the way

The owner ruled on 19 October 2026 that the compute skinning pass stays only where a start-up probe measures it cheaper than skinning in the vertex shader. Battle's Mac measurements show that the pass saves no frame time. It raises the draw count from 302 to 10,196, because each object that the pass skins draws from a bucket of its own. The vertex shaders stay the default, and the probe decides for each device.

What the engine does now:

- `?skinning=auto`, the default, takes the probe's answer. `?skinning=vertex`, `compute`, `full`, `skip` and `narrow` still force a way, and they win over the probe. WebGL2 is unchanged: it skins in the vertex shader.
- The probe runs in the probe worker after the direct-draw probe, on the same device. It draws a fixed crowd of 64 characters of 1,024 vertices in four passes: three shadow cascades and the main pass.
  - The vertex arm draws one instanced draw in each pass, and every vertex blends four joints from the joint texture.
  - The compute arm dispatches once over the crowd, then each pass draws each character from its own region of a buffer of 20-byte skinned vertices. The draw path that the direct-draw probe chose decides whether those draws are direct or indirect, so the compute arm pays the draw count that the engine pays.
- Both arms warm up, then take turns in four timing rounds of six frames. Each arm keeps its fastest run. The probe picks the compute way only when it is at least 5% and at least 0.05 ms a frame faster. A warm-up over 50 ms, a failure, or a software renderer keeps the vertex shaders.
- The answer travels with the capability report as `webgpu.computeSkinning`, and `coreDevice` turns it into the core's mode before the first frame. The worker reports the two figures as `worker.skinningProbe`.

Measured on the Mac on 2026-10-19, in milliseconds a frame from submit to GPU completion, the fastest of four rounds, in four runs each:

| Browser | Vertex shaders | Skinning pass | Probe's choice |
| --- | --- | --- | --- |
| Safari 26.6.2 | 0.147 to 0.220 | 0.300 to 0.370 | vertex |
| Chrome 155 | 0.308 to 0.354 | 0.290 to 0.378 | vertex |

Safari measured the pass costing 45% to 104% more. Chrome measured a near tie: the pass was 7% and 13% cheaper in two runs and 3% and 23% more expensive in the other two. The smallest gain that the probe counts is 0.05 ms a frame, so every Chrome run kept the vertex shaders. The 5% margin and the absolute gain together keep a near tie from changing the way on noise.

The renderer allocates no skinned vertex buffer and no skinning pipeline for an object that the vertex shaders skin. The Rust test `with_vertex_skinning_the_skinned_builds_read_the_joints_and_no_pass_skins` checks that no skinning compute pipeline is created.

Battle on the Mac in Safari 26.6.2 on 2026-10-19: 1,000 units, WebGPU, High, the governor off, into a 450 by 719 canvas. Each figure is the page's own measurement of 8 seconds, after 8 seconds of warm-up.

| Route | Frames a second | GPU ms | CPU ms, every thread | Draws |
| --- | --- | --- | --- | --- |
| auto, which the probe left on the vertex shaders | 30.0 | 25.17 | 10.81 | 313 |
| vertex shaders, forced | 30.5 | 25.30 | 10.40 | 316 |
| skinning pass, forced | 25.3 | 22.43 | 16.42 | 10,193 |

The pass cut the GPU time by 2.9 ms. It added 9,880 draws a frame. Their CPU cost raised the CPU time across the threads by 6.0 ms, and the frame lost 5.2 frames a second. The probe's choice draws what the forced vertex route draws.

Battle on the Mac in Chrome 155 on 2026-10-19, at the same settings and canvas:

| Route | Frames a second | GPU ms | CPU ms, every thread | Draws |
| --- | --- | --- | --- | --- |
| auto, which the probe left on the vertex shaders | 119.9 | 4.94 | 6.26 | 312 |
| vertex shaders, forced | 120.0 | 4.86 | 6.13 | 313 |
| skinning pass, forced | 79.7 | 5.66 | 10.38 | 10,194 |

Chrome draws the vertex route at the display's cap. The pass added 0.8 ms of GPU time and 4.1 ms of CPU time across the threads. It lost 40.3 frames a second. Again the probe's choice matches the forced vertex route.

On the cloud iPhone 17 in Safari 26.6 on 2026-10-19, on the shared head, the probe's answer flipped between page loads. It chose the pass on the capabilities page, where it measured vertex at 0.657 ms a frame against the pass's 0.560, and it kept the vertex shaders on the Battle page minutes later, where Battle drew 305 draws. Warm, the forced routes put the vertex shaders at 25.5 frames a second and 30.98 ms of GPU time against the pass's 23.6 and 32.47, with 302 draws against 1,277. So the pass was worse in the engine, as the addendum above records; the cold first pages of a session read the other way. The probe's iPhone measurement lies too near its bar to choose reliably, so the vertex shaders stay the safer route until a warm measurement with the sun filter changes the balance. The other pages are in the [tested devices record](../tested-devices.md).
