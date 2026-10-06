# D-20: WebGPU skinning

Status: proposed; the Mac and iPad timings pending. Date: 2026-10-04. Task: M2-C3.

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
