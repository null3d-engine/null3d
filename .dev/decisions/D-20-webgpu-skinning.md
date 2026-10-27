# D-20: WebGPU skinning

Status: decided by the owner: the vertex shaders skin on WebGPU by default, as the rule asks. Built: the vertex shader default (M2-EX41), the compute pass for the objects that the vertex shaders cannot skin, and `?skinning=compute`. Also built: shared buckets for skinned copies, and custom materials' SKIN builds that load on first use, the owner's option B. Not run yet: the timing page in the Mac's Safari, and S5 on the owner's iPad. Neither can change the result. Task: M2-C3, M2-C8, M2-EX41.

Summary: The vertex shaders skin on WebGPU by default, as on WebGL2, and skinned copies of one mesh and material share an instanced draw. A compute pass saved at most 4.3% of S5's GPU time, against the rule's 10%, and cost 4% to 79% more on the timing page's phones. It stays for morphed meshes, a sketch's full shaders and the debug views, and behind `?skinning=compute`.

## Question

On WebGPU, should the engine skin each animated mesh once per frame in a compute pass? The shadow and main passes would then draw the skinned vertices. Or should it skin each mesh in the vertex shader of every pass that draws it, as WebGL2 does ([D-10](D-10-webgl2-skinning.md))?

## Rule

Keep the compute pass if it saves at least 10% of the frame time with two or more cascades. It must do so on the Mac and on the iPad, with identical images. This is D-10's rule on the other GPU path.

[D-53](D-53-technique-defaults.md) adds where it is decided: in S5 as well as on the timing page, and on an Android phone with WebGPU. The Galaxy S24+ has no WebGPU adapter, so BrowserStack's Galaxy S25 (Adreno 830) and Pixel 9 (Mali-G715) run it (ruling 10). Prototype A1 runs S5 with each of the switches below.

## Both ways in the engine

The engine builds both, so the data can pick either. The vertex shader is the default, and `?skinning=compute` picks the compute pass. What both share:

- A loader links a mesh object to an animated instance with the scene command `SET_SKIN`.
- Each frame's skinning matrices reach the GPU in one RGBA32F texture: 512 joints per row, three texels per joint. A row is then 1,536 texels wide, as the WebGL2 data textures' rows are, so it fits the 2,048 texels that every WebGL2 device allows. A row of 1,024 joints would take 3,072 texels, which a device at that floor cannot create. The texture's height has the same floor, so an animation table holds at most 2,048 rows, 1,048,576 joints. The animation step writes one of two matrix buffers in turn. So each frame uploads straight from the buffer of its own step, with no copy. The WebGL2 path (M2-C4) reads the same texture.
- A skinned object culls with a sphere that its pose moves. Each mesh keeps a sphere per joint around the vertices that the joint moves. After each animation step the core moves those spheres by the pose and writes the sphere around them all. A skinned vertex is a weighted average of its joints' matrices applied to it, so it lies inside that sphere, whatever the pose. A Rust test checks every vertex of a column against 200 random poses. Each joint turns up to half a turn, scales by 0.5 to 2 and moves up to 3 m.
- Every SKIN build and the compute pass sit in the skinning feature's own shader files, which a page downloads with its first skinned mesh ([D-56](D-56-first-use-shader-files.md)). Every pass leaves a page's skinned meshes out until their pipelines are built: the skinning pass's, and every one that draws them. So no pass draws vertices that the skinning pass has not written.

### The vertex shaders (the default)

- The lit, standard maps, unlit, unlit map and shadow depth templates have SKIN builds, and so do the casters' and the outline mask's templates. Each blends its vertex's four joints from the joint texture. A bind group of its own holds the texture, after the frame's group or after the maps' group.
- Custom materials built from the standard template have SKIN builds, which load on first use ([below](#shared-buckets-and-custom-materials-skin-builds-on-first-use)).
- At each new layout, a skinned object takes the vertex shaders only when its pair's pipeline has SKIN builds. The pair's pipeline already folds in the debug view, and turning a debug view on or off rebuilds the layouts, so the choice follows it.
- Skinned objects that the vertex shaders skin share a bucket by mesh and material, as on WebGL2. The culling pass copies each object's first joint beside the material into each instance it draws.
- When a page preloads skinning, WebGPU creates the shader modules of the SKIN builds. It also builds the pass's pipelines, which morphed meshes and full shaders need.

### The compute pass

The pass (`gpu_driven/skin.rs`, `skin.wgsl`) skins morphed objects. It also skins objects whose pair draws with a template without SKIN builds: a sketch's full shaders, the debug views and the test templates. With `?skinning=compute` it skins every skinned object. Its buffers, table and dispatches cover only the objects it takes. A scene with neither kind of object records no skinning pass. It keeps no skinned vertex buffer either.

- Each object that the pass takes draws from a bucket of its own, since it has vertices of its own. It gets a region of a skinned vertex buffer for each part of its mesh, when the scene's structure changes. A region holds the mesh's vertices without joints and weights. The views' bundles draw the regions with the mesh page's indices, so they are recorded only when the structure changes.
- The regions fill up to 8 skinned vertex buffers, each at most the device's largest storage binding. That is 1 GiB in all at WebGPU's default of 128 MiB. Each run of one mesh page's parts in one buffer is a segment of the pass's table. At most 32 mesh pages hold skinned meshes. A scene past either cap gets E1501, which names it ([D-57](D-57-capacities.md)). With one buffer and one dispatch per page, a crowd past a binding or past 65,535 workgroups would lose characters with no error.
- Each frame, the CPU tests each skinned object's world sphere against the views that draw. These are the cameras, and for casters, the cascades and the shadow tiles that draw that frame. One dispatch per segment skins the parts of the objects that some view draws, one thread per vertex, 64 to a workgroup. A dispatch past 65,535 workgroups spreads them over rows. The shader reads every vertex type that glTF allows (D-25).
- The passes then draw the skinned vertices with the pipelines of plain meshes. So every template skins, with no shader variant of its own.
- It skips each object whose regions already hold its pose. The core gives each animated instance a pose step: the frame step that last changed its skinning matrices (`Animations::pose_step`). The step compares the new matrices with the step before's. A character keeps its step while it stands still or a paused clip holds it. It keeps it too while a slower update rate (M2-C6) leaves it alone. An object skins when its pose step or its morph weights changed since its last skin.
- The regions keep no pose after a new layout, a new skinned vertex buffer or a new GPU device. They keep none in frames whose skinning pipelines may still build either, since a dispatch of a pipeline that is not built writes nothing. Each of these skins every object that a view draws once more. Held poses count from the first frame that waits for every pipeline, as the pipeline cache counts that frame's pipelines as built.
- The joint texture uploads nothing while no pose changed. A new layout uploads it again, which also covers a frame that failed before its list replayed.
- It writes positions as 32-bit floats, and normals and tangents as 8-bit normalized integers, one word each, as unit directions. A tangent keeps its handedness in the fourth byte, which stores -1 and 1 exactly. The Knight's skinned vertex takes 20 bytes, against 28 with 32-bit directions. A knight draws 4,957 vertices: the body's six skinned meshes, the helmet, the cape, a sword and a shield. With every knight in the pass, S5's 500 knights take 49.6 MB of skinned vertices, against 69.4 MB.
- A pipeline constant (`@id(1100)`, `narrow_directions`) picks floats instead, so one shader module serves both layouts. The constant is fixed when the pipeline is built, so no driver sees a runtime branch around the writes. That matters on Adreno: the Galaxy S25's driver ran a write of the skinning pass behind a runtime check that was false.
- The pass keeps one build per tangent and color bit. The pipeline constant applies to each build, so it adds no build.
- A morphed mesh's color stays four 32-bit floats, after the 8-bit normal and tangent, since morph targets may push it outside what 8 bits hold. A unit test checks that layout.

Why 8 bits:

- The asset tool already stores optimized meshes' normals in 8 bits, so a skinned normal in 8 bits keeps the precision the mesh had. Its largest error is under half a degree.
- 16-bit normals would take 24 bytes per Knight vertex, for precision that the source lacks.
- An octahedral 16-bit normal in one word would be more precise for the same 4 bytes. But no vertex format decodes it, so every vertex shader of every template, custom materials' included, would need a decode step and a second build. 8-bit normals need no shader change: the vertex fetch reads them as fractions.

### Switches for the runs

The `?skinning=` switch picks the way. Without the switch, the vertex shaders skin. With `compute`, the pass skins every skinned object, with both savings above. With `full` it has neither saving. With `skip` it has the pose skip and 32-bit directions, and with `narrow` 8-bit directions without the skip. The benchmark page kinds `null3d-webgpu-skin-compute`, `-skin-full`, `-skin-skip` and `-skin-narrow` carry them. S5's knights all walk in every frame, so the pose skip saves nothing there by itself. S5's `?still=<share>` switch makes that share of the knights stand still, so the runs can measure the skip too.

## Data

### Images and parity

| Measure | Result | Where |
| --- | --- | --- |
| The skinning scene against three.js's `SkinnedMesh` (`bun run parity -- --scene skinning`) | 0.000% of pixels differ on core WebGPU and 0.043% in compatibility mode; three.js's two renderers differ by 0.032% | Chrome on the Mac's GPU, 2026-10-03 |
| The vertex shader's images against the compute pass's: the skinning scene, with shadows, and with a see-through character | Within the default tolerance of the same references, on both WebGPU tiers | `bun run test:images -g skinning`, the Mac's GPU and SwiftShader |
| A quantized mesh (positions in 16-bit whole millimeters, 8-bit normals, joints and weights) against floats | Within the default tolerance of the float image | the same run |
| `skinning-normal-map`: the characters lit through a normal map of grooves, so the light shows each skinned tangent, with 8-bit and with 32-bit tangents | At most 4 levels apart in any pixel. WebGL2's vertex shaders, which skin in floats, match the same reference | the Mac's GPU and SwiftShader |

The skinning image tests also draw the compute pass with `?skinning=compute`, against the vertex shaders' references. `skinning-normal-map-compute` checks the pass's 8-bit tangents against the vertex shaders' floats. The skinning pass page checks both of the pass's layouts against the CPU.

### Download size

Built with and without skinning, each WebGPU shader module grows from about 19.2 KB to 23.4 KB after Brotli. The SKIN builds take 2.3 to 3.5 KB of that. The compute pass's shader and the culling shader's extra word take the rest. Each core WebAssembly file grows 3.3%, from 210.4 to 217.3 KB, for the bounds, the layout and the skinned passes, which both ways share. The WebGL2 modules do not change. The skinning feature's files load on first use, so none of this counts at a page's start.

### Timing

The WebGPU skinning page (`tests/pages/skinning-webgpu.html`) is the twin of D-10's WebGL2 page. It draws the same scene both ways with WebGPU calls of its own, so no engine code runs. [Device sessions](../devices.md#the-skinning-plan) describes the scene and the timing. In short:

- A crowd of 50 to 500 generated characters. Each has 2,560 vertices, 5,040 triangles and a chain of 32 joints, with four joint weights per vertex. The page bends each chain every frame.
- A directional light with 1 to 4 cascades of 2048 x 2048 texels, each fitted to its slice of the view. Both paths cull the crowd per pass on the CPU.
- A frame of 1280 x 720 pixels on every device, with four shadow map taps per pixel.
- Both paths upload the joint matrices to a float texture each frame, as the engine does. The vertex shader path skins each character in each pass that draws it. The compute path skins each character that some pass draws once, with one thread per vertex. Each pass then draws its output with plain vertex shaders.
- The compute path writes what the engine writes for the Knight: positions as floats, 8-bit normals and 16-bit texture coordinates. That is 20 bytes per vertex, or 28 with `?normals=float`.
- Each frame goes to the GPU in a submit of its own. Each batch of frames ends when the GPU has finished its last frame. Where the adapter has timestamp queries, the page also times the GPU from each batch's first pass to its last.

The page runs with `bun tests/real-browsers.ts --plan skinning-webgpu --lan ipad-safari "Google Chrome"`. S5 (M2-L2) gives a second check in a real scene through the engine's `?skinning=` switch.

Mali compiles each vertex shader into a position shader and a varying shader, and Adreno's binning pass runs a position-only vertex shader. So a joint blend that feeds both the position and the normal can run twice there ([Arm's Mali Offline Compiler guide](https://documentation-service.arm.com/static/648aeb7f153eb247a5450a90), [Qualcomm's best practices](https://docs.qualcomm.com/bundle/publicresource/topics/80-78185-2/mobile_best_practices.html)). Compute skinning blends once. That favors the compute pass on Android, but no vendor advises either way, and Qualcomm advises keeping graphics submits apart from compute dispatches.

### Runs of prototype A1

- The Mac, Chrome, at a load below 8: `bun run bench:run --scenes s5 --pages null3d-webgpu,null3d-webgpu-skin-compute,null3d-webgpu-skin-full,null3d-webgpu-skin-skip,null3d-webgpu-skin-narrow --switches "governor=off&preset=high"`, then the same with `still=0.5` added to the switches.
- The Mac, Safari: `bun tests/real-browsers.ts --plan bench --scenes s5 --pages <the same five> --switches "governor=off&preset=high" Safari`.
- The iPad: `bun tests/real-browsers.ts --plan bench --lan ipad-safari --scenes s5 --pages <the same five> --n <S5's iPad count> --switches governor=off`.
- BrowserStack's Galaxy S25 (Adreno), Pixel 9 (Mali) and Pixel 11 (PowerVR): the same plan with `--cloud`.

In the tables of A1's runs, "Lean pass" is the pass with both savings, which `compute` gives, and `vertex` is the vertex shaders, the default.

### A1 on the Mac, Chrome

The Mac ran S5's 500 knights at High (3 cascades), with the governor off. Each page had 3 runs of 10 seconds' warm-up and 10 measured, in turns (`target/bench/20261005-183445-bench` and `20261005-184001-bench`, commit 807e6ea9c). The first set started at a load of 4.1 and ended at 6.4. The second started at 6.4 and ended at 9.4, above the limit of 8 for timing, so its figures are rougher.

| Page | GPU ms, every knight walks | CPU ms | GPU ms, half the knights still | CPU ms |
| --- | --- | --- | --- | --- |
| Lean pass | 3.60 | 1.81 | 3.99 | 2.23 |
| `full`: neither saving | 3.70 | 2.00 | 4.22 | 2.41 |
| `skip`: pose skip only | 3.58 | 1.78 | 4.22 | 2.39 |
| `narrow`: 8-bit directions only | 3.63 | 1.82 | 4.01 | 2.64 |
| `vertex`: the vertex shaders skin | 3.63 | 1.54 | 4.10 | 2.14 |

- The lean pass takes 3% less GPU time than the full one with every knight walking, and 5% less with half of them still. Both differences lie near the runs' spread.
- On the Mac, the compute pass saves nothing against the vertex shaders: 3.60 against 3.63 ms of GPU time, far from D-20's 10%. The vertex shaders' frames cost 0.27 ms less CPU time, since they record no skinning dispatch and upload no table.
- The skinning itself is a small part of S5's GPU frame on the Mac. The 20,002 draw calls, one per skinned object in each pass, cost more. So the Mac alone cannot settle the rule; the iPad and the Android phones, whose GPUs repeat vertex work, decide it.

### A1 on the Mac, Safari

A Safari run at a load below 4 passed 16 of 16 runs. Every page drew about 5 fps, with about 155 ms of GPU time per frame, where Chrome needs about 3.6 ms. The run's build lacked the fix for Safari 26's stall on indirect draws that share arguments ([D-85](D-85-safari-indirect-arguments.md)). That stall most likely sets these figures, so they do not count for this rule. The only reading within the run: the vertex shaders took about 11% more GPU time than the compute pass pages (172.3 against 155.2 ms). The run has not repeated on a build with the fix.

### A1 on the Galaxy S25

BrowserStack's Galaxy S25 (Adreno 830, Chrome 152) ran commit 27cccd28d. Its screen ran at 30 Hz, so the frame times show only the screen's pace. The figures below are GPU times from the GPU's timer, and the main thread's CPU times. The run files are in the [S25's folder](../tested-devices/galaxy-s25-sm-s931b-chrome/README.md).

The checks passed 21 of 21 (run `20261007-213008-checks`). They cover the skinning pass page on both WebGPU tiers, and the skinning, morph and glTF images with 8-bit and 32-bit directions.

S5 drew 150 knights at High, with 3 cascades and the governor off. Each page had 3 runs in turns. Each figure is the middle of the 3 runs' medians (runs `20261007-213535-bench` and `20261007-215025-bench`).

| Page | GPU ms, every knight walks | CPU ms | GPU ms, half the knights still | CPU ms |
| --- | --- | --- | --- | --- |
| Lean pass | 22.28 | 3.42 | 20.94 | 4.36 |
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
- With half the knights still, the compute pass takes 12% less GPU time than the vertex shaders. The pose skip gives none of that: `full`, which skins every knight in every frame, takes 20.84 ms. The vertex shaders took 2.6 ms more than with every knight walking, and the run does not show why. So this reading does not count as a saving of the compute pass unless a repeat explains it.
- Adreno's binning pass runs the joint blend twice in the vertex shaders, yet the vertex shaders are faster on the S25.

### A1 on the Pixel 9 and the Pixel 11

BrowserStack's Pixel 9 (Mali-G715) and Pixel 11 (PowerVR C-Series) ran the same commit and plans as the S25, on Chrome 152. Both screens ran at 60 Hz, so their frame times count too. The figures are GPU times from the GPU's timer, each the middle of 3 runs' medians. The run files are in the folders of the [Pixel 9](../tested-devices/pixel-9-chrome/README.md) and the [Pixel 11](../tested-devices/pixel-11-chrome/README.md).

The checks passed 21 of 21 on each phone. Every page of S5 and of the timing page passed on both. The timing page's two ways differed in 0 of 921,600 pixels, except 1 pixel on the Pixel 11 with 4 cascades, within the page's limit.

S5 drew 150 knights at High, with 3 cascades and the governor off.

| Page | Pixel 9, every knight walks | Pixel 9, half still | Pixel 11, every knight walks | Pixel 11, half still |
| --- | --- | --- | --- | --- |
| Lean pass | 30.93 | 28.64 | 24.44 | 26.41 |
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

### A1 on a cloud iPad

BrowserStack's iPad (10th generation) (A14, Safari 27.0, iPadOS 27) ran the same commit and plans. This cloud run adds a device; it does not stand in for the owner's own iPad. Its screen ran at 60 Hz. The run files are in the [iPad's folder](../tested-devices/ipad-10th-generation-safari/README.md).

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

### All five devices

The compute pass's saving against the vertex shaders, in GPU time. A negative figure means the compute pass costs more.

| Device | S5, every knight walks | S5, half the knights still | Timing page, 2 cascades | Timing page, 4 cascades |
| --- | --- | --- | --- | --- |
| Mac, Chrome (500 knights) | 1% | 3% | not run | not run |
| Galaxy S25 (Adreno 830) | -5.6% | 12% | -38% | -9% |
| Pixel 9 (Mali-G715) | 4.1% | 6.2% | -79% | -61% |
| Pixel 11 (PowerVR) | 0% | -8.1% | -14% | -4% |
| Cloud iPad (A14) | 4.3% | 5.6% | -26% | -30% |

- With every knight walking, the compute pass never saves the rule's 10%. The best saving is the cloud iPad's 4.3%.
- On the timing page, the vertex shaders are faster on every phone and on the cloud iPad, at both cascade counts.
- The compute pass leads most with half the knights still: by 6.2% on the Pixel 9, 5.6% on the cloud iPad, 12% on the S25. The pose skip gives none of the S25's lead, and the run does not show why.
- The lean savings help most on the Pixel 9 and the Pixel 11: the lean pass takes 4% to 7% less GPU time there than `full`. The Pixel 11's share lies within its runs' spread. On the S25, the Mac and the cloud iPad they change little.

### The default against the pass on the Mac

The Mac's Chrome ran S5 with the vertex shader default: 500 knights at High, with the governor off. Each page had 3 runs of 10 s, in turns, at a load of 4.7 to 7.4. The page kind `null3d-webgpu` is the default, and `null3d-webgpu-skin-compute` skins every knight in the pass (runs `20261011-074653-bench` and `20261011-074904-bench`).

| Page | CPU ms per frame | GPU ms | Presented fps |
| --- | --- | --- | --- |
| Every knight walks: vertex shaders | 1.81 (1.32 to 1.97) | 5.31 | 120.0 |
| Every knight walks: the pass | 2.40 (1.97 to 2.43) | 5.16 | 114.8 |
| Half the knights still: vertex shaders | 1.64 (1.28 to 1.76) | 5.36 | 120.0 |
| Half the knights still: the pass | 2.18 (1.81 to 2.40) | 5.20 | 118.1 |

The pass saves 2.8% to 3.0% of the GPU time, under the rule's 10%. The vertex shaders save 0.54 to 0.59 ms of CPU time per frame, and hold 120 frames per second, where the pass drops frames.

### The timing page on the owner's iPad

The owner's iPad Pro 11 (2018, A12X, Safari 26.6.2) ran the `skinning-webgpu` plan over the local network, on main at f854dd72d (run `20261011-082012-skinning-webgpu`). Every page passed: 16 of 16. In every page the two ways' images differed in 0 of 921,600 pixels. The iPad was on its charger, with Limit Frame Rate on, and the screen held 59 Hz before every page. The Mac that served the pages ran at a load of 15 to 18. That slows only the serving, not the iPad's GPU timings. S5 has not run on this iPad.

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

### The pass on an iPhone 17, and why it is not a default

The iPhone 17's Safari ran Battle's comparison at 100 units, on a 603 x 1009 canvas at a pixel ratio of 1.5, on the direct path. The first four pages of one session put the skinning pass about 6.6 ms ahead (run `20261019-043500-battle-webgpu`):

| Page | Presented fps | GPU time | Draws |
| --- | --- | --- | --- |
| Battle, the vertex shaders | 24.4 | 32.01 ms | 304 |
| Battle, `?skinning=compute` | 28.0 | 25.36 ms | 1,238 |
| Factory, the vertex shaders | 45.6 | 15.86 ms | 152 |

The figures do not hold. In the same session the first page is about 5 ms slower than every page after it with the same settings. That first page carried the vertex shaders. A second run took the same Battle page eight times in one session, in turns (run `20261019-052000-battle-webgpu-ab`):

| Page | Presented fps | GPU time | Draws |
| --- | --- | --- | --- |
| The vertex shaders, first page of the session | 25.1 | 29.90 ms | 298 |
| The vertex shaders | 30.0 | 23.81 ms | 266 |
| The vertex shaders | 29.8 | 24.06 ms | 266 |
| The vertex shaders | 28.5 | 25.63 ms | 265 |
| `?skinning=compute` | 27.1 | 25.36 ms | 1,238 |
| `?skinning=compute` | 27.3 | 26.04 ms | 1,238 |

- Warm, the pass is no faster than the vertex shaders on this phone. It draws each skinned unit on its own: 1,238 draws against 265. On the indirect path it fell to 10.4 frames and 79.35 ms, because WebKit charges for each of its indexed indirect draws.
- So the vertex shaders stay the default on every device, and `?skinning=compute` remains the switch for a page that measures the pass.

This phone gives no reason to revisit the owner's ruling. A phone's crowd would need a pass whose skinned copies share one instanced draw. The pass cannot do that: each copy keeps vertices of its own.

## Decision

The vertex shaders skin on WebGPU by default, as on WebGL2. The owner ruled so by the rule, from the figures above:

- With every knight walking in S5, the compute pass saved at most 4.3% of the GPU time (the cloud iPad), against the rule's 10%. It saved 4.1% on the Pixel 9, 1% on the Mac's Chrome and 0% on the Pixel 11. It cost 5.6% more on the Galaxy S25.
- On the timing page, the vertex shaders were faster on every phone and on the cloud iPad, at 2 and 4 cascades. The compute pass took 4% to 79% more GPU time.
- The vertex shaders' frames also cost less CPU time, as they record no dispatch and upload no table. They saved 0.27 ms on the Mac, 0.43 ms on the S25 and about 1.5 ms on the Pixel 11.
- The rule needs a saving on every device. So runs on the Mac's Safari and the owner's iPad cannot keep the compute pass. They would record the vertex shaders' figures there.

The compute pass stays in the engine for the objects that the vertex shaders cannot skin, and for measurements.

### Why the compute pass stays

- WebGPU morphs only in the pass ([D-51](D-51-morph-targets.md)). It has no MORPH builds, so morphed meshes, skinned or not, need the pass.
- A sketch's full shaders and the debug views have no SKIN builds on WebGPU. Without the pass their skinned meshes would draw at rest, which breaks the intent parity rule ([D-52](D-52-intent-parity.md)).
- `?skinning=compute` keeps the comparison open for any device where the figures change.

### Options rejected

- Keep the compute pass as the default. It failed the rule on every device measured.
- Take the compute pass out, with MORPH builds for WebGPU and SKIN builds for full shaders. That adds a MORPH build to every WebGPU template, to save one compute shader in a file that loads on first use.
- Leave skinned meshes at rest where the material has no SKIN builds. That draws them wrong.

## Shared buckets, and custom materials' SKIN builds on first use

Battle's comparison (task M2-EX41, [D-121](D-121-comparison-tier.md#battle)) needs skinned copies to share draws. When each skinned object draws from a bucket of its own, each unit costs one indirect draw in each view. At 1,000 units that is 10,214 draws a frame: about 2,100 in the camera's view, 2,000 in the depth prepass and 6,000 in the 3 cascades. WebGL2 draws the same scene in 289 draws. Its skinned copies of one mesh and material share an instanced draw.

- Skinned objects that the vertex shaders skin share a bucket by mesh and material, as on WebGL2. They need no vertices of their own. The bucket's record names `PER_SOURCE_JOINT` (`u32::MAX`) as its first joint. The culling pass then takes each copy's first joint from a texture of 32-bit indices, one per source. It writes the joint into the copy beside the material. A texture keeps the culling group within the eight storage buffers that every device allows a shader stage. The bucket's sphere holds every object's sphere, around their centers' mean, and the animation step moves it each frame.
- The objects that the skinning pass skins keep a bucket each, as each has vertices of its own.
- Custom materials built from the standard template have SKIN builds on WebGPU, as on WebGL2. So the vertex shaders skin them, and a crowd with a custom material draws in one instanced draw per view. Battle's soldiers and mechs have custom materials.
- A sketch's full shader has no SKIN builds. Its skinned meshes go to the skinning pass, which a full shader's flag (`Shading::is_full_shader`) picks. A full shader on a skinned mesh would otherwise fail its pipeline.

### The owner's ruling on the size of the SKIN builds

SKIN builds double each custom material's WebGPU builds, as they double its WebGL2 builds. [D-10](D-10-webgl2-skinning.md) measured 17.0 KB against 22.7 KB after Brotli for one surface function. Most custom materials never draw a skinned mesh. So the owner chose option B: a custom material's WGSL SKIN builds load only when the material first draws a skinned mesh. The engine's own first-use shader files load the same way. A page with no skinned custom material pays nothing: no download and no pipeline.

- The shader compiler puts a material's WebGPU SKIN builds apart from its other builds (`skinVariants`). The Vite plugin puts them in a module of their own, `virtual:null3d/skin/<hash>`, which the material's value imports with `skinBuilds()`. A production build puts that module in a file of its own.
- The thread that draws holds a custom material's shader without its SKIN builds. The first pipeline that needs one parks, as a pipeline waits for a shader file. It asks the sketch's thread for them once, through the port of the images. The sketch's thread imports the module and sends the builds of its GPU path. The pipeline then builds. A failed import fails the pipelines that need the builds, with the reason.
- `scene.warmUp()` waits for these pipelines too, so a game that must fetch nothing during play warms its skinned objects up in the setup.
- WebGL2 keeps its SKIN builds in the material's module.

Options rejected:

- SKIN builds in every custom material's module. They double each material's WebGPU builds for pages that never skin with it.
- Keep the skinning pass for custom materials. Each object then draws on its own, and Battle's units cost a draw per view each.
- Build the SKIN variant in the browser. The engine compiles no WGSL at run time.

### Figures

Battle on the Mac's Chrome 155, WebGPU, with a bucket per skinned unit and with shared buckets ([D-121](D-121-comparison-tier.md#battles-gpu-cost-and-memory) has the whole run):

- Draws a frame: 333 against 10,214 at 1,000 units, and 343 against 10,464 on the 4,000-unit pages.
- The busiest CPU thread's time on the 4,000-unit pages: 5.7 to 9.6 ms against 8.6 to 13.9 ms. With shared buckets the sketch worker lays out no bucket for each unit.
- The run's 4,000-unit pages held only 1,024 soldiers, in a scene that stood still: the run's engine held at most 1,024 animated objects ([D-158](D-158-growable-animation-table.md)). Their figures compare the two builds on that same scene, not null3D's cost at 4,000 units.
- The frame's compute work: 0.1 ms against 1.4 to 1.6 ms, as the vertex shaders skin Battle's custom materials.
- The GPU's frame time: 9.7 to 16.7 ms against 12.6 to 17.1 ms, in runs that varied as much as that from page to page. Its largest render pass took 6.8 to 9.6 ms in both builds. So the draw count does not bind Battle's GPU time on the Mac.

## How three.js handles it

three.js's WebGPU renderer (0.186) skins in the vertex shader, as its WebGL renderer does, and its shadow passes skin each mesh again. Its skinning node reads each mesh's bone matrices from a uniform buffer of 4 × 4 matrices. Skeletons too large for the uniform buffer limit read them from a bone texture. A `computeSkinning` helper lets an app skin a mesh in a compute pass of its own, but the renderer never uses it itself. three.js culls a `SkinnedMesh` with a sphere that `computeBoundingSphere` works out from every skinned vertex. It does so once, at the pose of the mesh's first frustum test, and again only when the app calls it. So a limb that later swings out of that sphere can vanish at the view's edge. null3D moves its bounds with the pose each frame, from a sphere per joint.

## Consequences

- Both ways stay in the engine, and so does the `?skinning=` switch, for the reasons above.
- WebGL2 (M2-C4) skins in the vertex shader, by D-10, with the same joint texture and the GLSL builds of the same SKIN code.
