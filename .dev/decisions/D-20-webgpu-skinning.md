# D-20: WebGPU skinning

Status: proposed. The lean skinning pass is built (M2-C8). The figures of the Mac's Chrome, the Galaxy S25, the Pixel 9 and the Pixel 11 are in. The compute pass fails the rule on all four. The owner rules on the default. The Mac's Safari and the iPad are pending. Date: 2026-10-04, updated 2026-10-08. Task: M2-C3, M2-C8.

Summary: Skin once per frame in a compute pass, or in the vertex shader of every pass, as WebGL2 does. The engine builds both, and both draw the same images. The compute pass now skips still poses and writes 8-bit normals, so S5's 500 knights take 49.6 MB of skinned vertices, not 69.4 MB. On the Mac's Chrome it saves nothing against the vertex shaders (3.60 against 3.63 GPU ms), far from the rule's 10%. In S5 it saves at most 4.1% on the Android phones. On the timing page it costs 4% to 79% more on each of them. So it fails the rule on all four devices measured.

## Question

On WebGPU, should the engine skin each animated mesh once per frame in a compute pass? The shadow and main passes would then draw the skinned vertices. Or should it skin each mesh in the vertex shader of every pass that draws it, as WebGL2 does ([D-10](D-10-webgl2-skinning.md))?

## Rule

Keep the compute pass if it saves at least 10% of the frame time with two or more cascades. It must do so on the Mac and on the iPad, with identical images. This is D-10's rule on the other GPU path.

## Both ways in the engine

The engine builds both, so the data can pick either. The compute pass is the default, and the `?skinning=vertex` switch picks the vertex shader on WebGPU. What both share:

- A loader links a mesh object to an animated instance with the scene command `SET_SKIN`. A skinned object draws from a bucket of its own, as any object with bounds of its own does.
- Each frame's skinning matrices reach the GPU in one RGBA32F texture: 512 joints per row, three texels per joint. A row is then 1,536 texels wide, as the WebGL2 data textures' rows are, so it fits the 2,048 texels that every WebGL2 device allows. Until 4 October 2026 a row held 1,024 joints, 3,072 texels, which a device at that floor could not create. The texture's height has the same floor, so an animation table holds at most 2,048 rows, 1,048,576 joints. The animation step writes one of two matrix buffers in turn. So each frame uploads straight from the buffer of its own step, with no copy. The WebGL2 path (M2-C4) can read the same texture.
- A skinned object culls with a sphere that its pose moves. Each mesh keeps a sphere per joint around the vertices that the joint moves. After each animation step the core moves those spheres by the pose and writes the sphere around them all. A skinned vertex is a weighted average of its joints' matrices applied to it, so it lies inside that sphere, whatever the pose. A Rust test checks every vertex of a column against 200 random poses. Each joint turns up to half a turn, scales by 0.5 to 2 and moves up to 3 m.

The compute pass (`gpu_driven/skin.rs`, `skin.wgsl`):

- Each skinned object gets a region of a skinned vertex buffer for each part of its mesh, when the scene's structure changes. A region holds the mesh's vertices without joints and weights, with positions, normals and tangents as 32-bit floats. The views' bundles draw the regions with the mesh page's indices, so they are recorded only when the structure changes.
- The regions fill up to 8 skinned vertex buffers, each at most the device's largest storage binding. That is 1 GiB in all at WebGPU's default of 128 MiB. Each run of one mesh page's parts in one buffer is a segment of the pass's table. At most 32 mesh pages hold skinned meshes. A scene past either cap gets E1501, which names it ([D-57](D-57-capacities.md)). Until 4 October 2026 the pass had one buffer and one dispatch per page. So a crowd past a binding or past 65,535 workgroups lost characters with no error.
- Each frame, the CPU tests each skinned object's world sphere against the views that draw. These are the cameras, and for casters, the cascades and the shadow tiles that draw that frame. One dispatch per segment skins the parts of the objects that some view draws, one thread per vertex, 64 to a workgroup. A dispatch past 65,535 workgroups spreads them over rows. The shader reads every vertex type that glTF allows (D-25).
- The passes then draw the skinned vertices with the pipelines of plain meshes. So every template skins, custom materials and the debug views too, with no shader variant of its own.

The vertex shader (`?skinning=vertex`):

- The lit, standard maps, unlit, unlit map and shadow depth templates gain SKIN builds. Each blends its vertex's four joints from the joint texture. A bind group of its own holds the texture, after the frame's group or after the maps' group.
- Each skinned object's bucket names the first joint of its skin, and the culling pass copies it beside the material into each instance it draws.
- Custom materials and the debug views have no SKIN builds, so they draw skinned meshes at rest in this mode. Giving custom materials SKIN builds would double their WebGPU builds.

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

The runs are pending: `bun tests/real-browsers.ts --plan skinning-webgpu --lan ipad-safari "Google Chrome"`. The engine's switch gives a second check in a real scene once S5 exists (M2-L2): the same scene with and without `?skinning=vertex`.

## Decision

Pending the timings. Until then the engine skins in the compute pass, as the plan has it.

## How three.js handles it

three.js's WebGPU renderer (0.186) skins in the vertex shader, as its WebGL renderer does, and its shadow passes skin each mesh again. Its skinning node reads each mesh's bone matrices from a uniform buffer of 4 × 4 matrices. Skeletons too large for the uniform buffer limit read them from a bone texture. A `computeSkinning` helper lets an app skin a mesh in a compute pass of its own, but the renderer never uses it itself. three.js culls a `SkinnedMesh` with a sphere that `computeBoundingSphere` works out from every skinned vertex. It does so once, at the pose of the mesh's first frustum test, and again only when the app calls it. So a limb that later swings out of that sphere can vanish at the view's edge. null3D moves its bounds with the pose each frame, from a sphere per joint.

## Consequences

- Whichever way loses leaves the engine. For the compute pass, that is `skin.wgsl`, `gpu_driven/skin.rs`'s pass and the skinned vertex buffer. For the vertex shader, that is the WGSL modules' SKIN builds, the joint texture's bind group on WebGPU and the bucket's first joint. That frees 2.3 to 3.5 KB per WebGPU page. The `?skinning=` switch then goes too.
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
