# D-174: The Apple GPU gap, the measured start-up probe and the direct-draw path

Status: built and measured on the Mac. The owner chose the direct-draw path on 2026-10-14. The probe and the path are implemented, and their figures are below. The probe runs have shown the clamp is a fixed cost for each draw in each pass. So the draws the engine makes across its passes set the path's ceiling. Battle's own figures are below. The same-path run on the cloud iPhone 17 holds the bar on WebGL2 and misses it on WebGPU.

Summary: A WebKit validation pass makes an indexed indirect draw with vertex buffers expensive on Apple GPUs. The owner asked for a direct-draw path. A start-up probe that measures a real draw chooses it, never a browser or GPU name. The cost is a fixed amount for each draw in each pass it lands in. It does not grow with the instances per draw. On the Mac in Safari, 1,024 draws cost 27.0 ms of indirect time in three passes against 9.8 ms in one. That is about 8.5 us for each draw in each pass. Battle draws 324.6 times a frame, so the clamp may hold about 2.8 ms of its 12.68 ms on the Mac. On the iPhone 17 it may hold about 0.8 ms of its 23.2 ms. On the cloud iPhone 17 the bar holds on WebGL2 and misses on WebGPU, where three.js's WebGPURenderer holds more frames. Factory's cost is not the draw call.

The path is built. On the Mac in Safari on 2026-10-18 the probe chose it, and Battle's GPU time fell from 15.55 ms to 7.79 ms, which took the frame from 51.2 to 59.9 fps; three.js held 44.1. Factory did not move, as this record expected: it draws 49 to 115 times, so the clamp is not its cost. Chrome kept the indirect path, and there null3D beat three.js on both Battle backends while Factory tied at the display's 120 frames.

## Question

Battle on the iPhone 17 runs at 13 fps in null3D and 40 fps in three.js, both on WebGPU at High. Factory runs at 26 fps against three.js's 59. null3D draws 115 times there and three.js 1,447 times, for the same 37 k triangles. Does a direct-draw path, chosen by a measurement and not by a browser name, close the gap?

## Rule

- Choose the draw path only from a measurement of a real draw, never from a browser or GPU name (hard rule 14). One exception, added on 2026-10-18 by the coordinator's ruling: a software renderer identified from the adapter's reported description never takes the direct path. Its slow indirect draws say nothing about the per-draw GPU cost that the path removes, and its held frames must stay the ones the current path draws. The stop is a capability exclusion, not a way to pick between real GPUs; the choice among those stays measured.
- Keep per-instance data in vertex buffers (hard rule 7).
- Never draw wrongly. The probe picks from a real first-frame draw, and the current path stays the fallback.

## Data

The engine draws every bucket with `drawIndexedIndirect` on WebGPU. WebKit's `clampIndirectIndexBufferToValidValues` runs when a pipeline has vertex buffers. It adds two pipeline switches, an indirect point draw over the draw's whole index count, two vertex to vertex barriers and two scratch allocations. All of that sits inside the render pass. [D-87](D-87-webkit-indirect-arguments.md) covers the separate fault that this pass fixes. Chrome has no such cost.

A raw-WebGPU micro-probe measures the cost with no engine. It uses 1024x768, 4x MSAA, one depth pass, and the same 131 k triangles in every arm. It times each arm with GPU timestamps. Its page is [`bench/probes/indirect-draws/index.html`](../../bench/probes/indirect-draws/index.html), which runs from any static server and prints its figures. Its query takes `grid`, `draws`, `passes`, `msaa` and `arms`. The results that this record cites are beside it: `indirect-g256-safari.json`, `indirect-iphone17.json` and `indirect-ipad10.json`.

GPU ms per frame, 1,024 draws, one instance and 128 triangles each:

| Arm | Mac Safari | iPhone 17 | iPad 10 |
| --- | --- | --- | --- |
| direct, vertex buffers | 0.06 | 0.32 | 0.47 |
| indirect, vertex buffers | 7.53 | 3.20 | 4.77 |
| indirect, own arguments per draw ([D-87](D-87-webkit-indirect-arguments.md)) | 7.58 | 3.00 | 4.60 |
| indirect, plus 1,024 empty draws | 13.81 | 5.88 | 8.85 |
| direct or indirect, instances pulled from storage (no vertex buffers) | 0.06 | 0.32 | 0.46 |

An empty draw costs almost as much as a drawn one, so the cost does not follow the drawn work. It follows the draw. That is about 2.8 us per draw on the iPhone 17, 4.3 on the iPad 10 and 7.3 on the Mac. The separate argument buffers of D-87 cost nothing extra.

Battle's device figures split the frame by feature (the iPhone 17 ablation run of 2026-10-13, Safari 26.5). On WebGPU the shadow passes cost 83.1 ms at 973 draws. The effects cost 41.6 ms at 276 draws. Factory's shadows cost 18.1 ms at 82 draws, and its effects-off frame is 13.6 ms.

The iPhone 17 demo run of 2026-10-13 (Safari 26.6) gives the gap against three.js at equal settings:

| Page | null3D | three.js |
| --- | --- | --- |
| Battle, scene graph | 13 fps, 79.0 ms GPU, 1,230 draws, 2.6 M triangles | 40 fps, 1,628 draws, 11.8 M triangles (WebGL) |
| Battle, instanced | 10 fps, 89.6 ms GPU | 35 fps, 260 draws, 8.1 M triangles (WebGPU) |
| Factory | 26 fps, 25.3 ms GPU, 115 draws, 37 k triangles | 59 fps, 1,447 draws, 38 k triangles |

Factory draws 115 times and still pays about 25 ms. three.js draws twelve times more and finishes in 17 ms, so Factory's cost is not per draw.

A later run on main (2026-10-14, the same device and settings, with M2-EX41's draw merging landed) changes Battle's side of that table. null3D now draws 261 times instead of 1,230. Battle leads three.js on both backends: 32 fps against 31 on WebGPU, and 50 against 33 on WebGL2. Factory does not move. It pays 25 fps against three.js's 41 on WebGPU, and it draws 115 times, so its cost is not the draw call either. So the bar holds for Battle and misses for Factory, whose 35.3 ms of GPU time over 37 k triangles is pass and pixel work.

## The probe

The probe runs on a device of its own, in the probe worker that already checks what a worker can draw. The engine picks its GPU tier before its core starts, so the choice must be known then: the answer travels with the capability report into `initEngine`, and the core builds its frame builder for it. The probe worker's device is a dedicated worker's, like the render worker's own, and the per-draw cost it measures is a browser and driver property, so the answer holds for the device that draws.

The probe draws a fixed workload twice: 512 indexed draws of a small mesh with a vertex buffer, once with the engine's indirect draws and once with direct draws, into a 64 pixel target. The indirect arm has the shape the engine records on this browser: an argument buffer for each draw on Apple's WebKit, whose indirect draws from one buffer race ([D-87](D-87-webkit-indirect-arguments.md)), and one buffer for every draw elsewhere. Each arm runs six frames, three times, and its fastest run is its figure; both arms warm up first, so a driver that drops a device's first indirect pass misleads neither. An arm whose warm-up frame takes over 50 ms ends the probe, so a very slow device keeps the current path instead of spending seconds in it. A software renderer, named by the adapter's reported description, never takes the direct path at all. The probe worker requests its adapter without a power preference, as the capability probe does, so a machine with two GPUs measures the browser's own pick.

The probe picks the direct path only when the direct arm is at least 25 percent faster and at least 0.15 ms a frame faster. Any other answer, a failure or a device lost during the probe keeps the engine's current path. The engine reads no browser or GPU name for the choice, and the answer is kept for the session.

## The direct-draw path

The engine cannot keep GPU culling and draw directly. The instance count is what the culling shader computes, a readback costs a frame of latency, and a late count draws the wrong instances. So the direct path culls on the CPU, as the WebGL2 builder already does. It keeps per-instance data in a vertex buffer, so hard rule 7 holds. As built:

1. The CPU culling is `null3d_core::culling::cull_into_buckets`, the job workers' culling that the WebGL2 builder uses, against the WebGPU layout's own bucket table and levels of detail. It writes each view's compacted instance buffer: one 64-byte copy per visible source, in the layout the mesh shaders already read, with the cell offset added to its matrix as the culling shader adds it.
2. Each bucket draws with `drawIndexed(indexCount, visibleCount, firstIndex, baseVertex)`, with no indirect buffer in the pass. A direct draw's count changes every frame, so the direct path records these draws in the pass itself, not in a render bundle. The traffic is one upload of each view's instance buffer a frame.
3. No mesh shader changes. Its vertex shader already reads each instance's matrix rows and ids from instance-rate vertex attributes. The culling shader's cell offset step moves to the CPU.
4. GPU occlusion culling and the `?instances=index` test switch are off on this path: both need the counts that the GPU culls.
5. A scene that holds a feature-instance draw, whose live count the GPU writes, takes the indirect path instead. Its count exists only in a buffer that a compute pass writes, and a direct draw needs a count on the CPU. The first frame picks the path, so the scene never mixes the two. An add-on that creates such a draw after the first frame is not supported, and D-229 records that limit.

This reuses every WebGPU shader build, so it adds no shader variant and no download size. `engine.capabilities.directDraws` reports the choice.

The shortcut is to run the WebGL2 CPU-culled builder on the WebGPU backend. That needs WebGPU builds of its shaders, which read instance data from data textures under the `WEBGL2` shader def. The manifest builds those for GLSL alone. Adding them would double the mesh shader builds in the start module. The start's JavaScript is already at 141 KB of its 145 KB budget, so the shortcut is blocked on size. The path above changes no shader, and it is the one to build.

## The instance-count probe

The micro-probe's draws are small, with one instance and 128 triangles each. The engine's draws are big, with thousands of triangles and many instances. So one question decided whether the path was worth building. Does the clamp's cost grow with the draw's work? The probe's `inst` and `depthonly` arms answer it, and they had already run on 2026-10-13.

GPU ms per frame at 1,024 draws, 16 instances per draw, indirect with vertex buffers against direct:

| Arm | Mac Safari | iPhone 17 | iPad 10 |
| --- | --- | --- | --- |
| colour, 4x MSAA, indirect | 9.77 | 5.82 | 9.99 |
| colour, 4x MSAA, direct | 0.51 | 4.17 | 6.91 |
| depth only, 1x, indirect | 9.33 | 5.74 | 9.45 |
| depth only, 1x, direct | 0.40 | 4.16 | 10.85 |

Per draw the clamp costs about 9 us on the Mac, and 1.5 to 3 us on the phones. That matches its cost at one instance. Multiplying the draw's vertex work by 16 changed almost nothing. The two barriers are a fixed cost per draw, not a drain that follows the drawn work.

The pass count changes that. One pass per frame is not the engine's shape, because Battle draws its casters once for each shadow cascade. A Mac Safari run with three passes per frame, the same draws and the same 16 instances, gives this, in GPU ms:

GPU ms per frame, 16 instances per draw, measured at a load near 6:

| Draws | Indirect, 1 pass | Indirect, 3 passes | Direct, 3 passes |
| --- | --- | --- | --- |
| 64 | 1.17 | 3.02 | 1.08 |
| 256 | 2.98 | 8.14 | 1.11 |
| 1,024 | 9.77 | 27.01 | 1.14 |

At 1,024 draws the indirect cost is 27.0 ms with three passes against 9.8 ms with one. So it grows about with the passes and not faster. Per draw and per pass it is about 8.5 us on the Mac's Safari. The clamp is a fixed cost for each draw in each pass it lands in, so the pass count sets what a frame pays.

An earlier three-pass run at a load of 22 gave 54.4 ms for the same cell. That figure is inflated, and the cleaner run above replaces it. The table's one-pass column comes from the 2026-10-13 runs.

The iPhone 17 gives the same shape, from its own slices on 2026-10-15 (Safari 26.6, three passes, 16 instances). Colour at 64, 256 and 1,024 draws cost 9.20, 8.69 and 8.80 ms of direct GPU time against 9.56, 9.09 and 13.93 indirect. Depth only at 256 and 1,024 draws cost 7.26 and 7.25 against 7.37 and 13.86. The clamp adds about 5.3 to 6.9 us for each draw, so about 1.8 to 2.3 us for each draw in each pass. The phone agrees with the Mac that the cost is a fixed amount per draw and per pass.

## Battle's own passes

Battle draws its buckets indirectly in six passes. Its render graph on main 8c1e39af6 holds 34 passes. Five are compute (LightClusters, Culling and ShadowCulling0 to 2). Three are shadow cascades at 2048 by 2048, and three are scene passes (DepthPrepass, Opaque and Transparent). The other 23 are fullscreen, three for ambient occlusion, 19 for bloom and the final pass. The six that draw the buckets with `drawIndexedIndirect` are ShadowCascade0, ShadowCascade1, ShadowCascade2, DepthPrepass, Opaque and Transparent.

The engine's pass timer lumps every pass after the fifth into its last bucket, so it cannot separate those six. On the Mac in Safari, a Battle frame at High drew 324.6 times and took 12.68 ms of GPU time. Its timer gave copies 0.004 ms and compute 0.096 ms. Render 1 to 6 took 0.641, 0.657, 0.602, 0.569, 0.080 and 10.461 ms. Render 6 holds every pass from the sixth on. Chrome, over a larger canvas, drew 335.7 times in 5.51 ms. The page is `compare=battle&r34probe=1`, and both runs were marked at a load above 8.

Those six passes are what the direct path would change, and the 324.6 draws count each draw in each pass. The probe's cost on the Mac is 8.5 us for each draw in each pass. So they come to about 2.8 ms, a fifth of the 12.68 ms. The iPhone 17's cost is 2.5 us, so the same draws come to about 0.8 ms of its 23.2 ms. So on the phone the prize is near a millisecond, and its frames are dominated by other work.

Factory's own graph on the same main holds 39 passes with the same shape. Eight are compute, six are shadow tiles at 1024 by 1024, five are scene and full screen passes, and twenty are bloom and final passes. The eight that draw the buckets indirectly are ShadowTile0 to ShadowTile5, DepthPrepass and Opaque. On the Mac, Factory costs 4.88 ms of GPU time in Safari over 115 draws. In Chrome it is 4.76 ms over 117 draws, both at a load above 8. On the iPhone 17 the same scene costs 35.3 ms, about seven times the Mac. So Factory's gap is device-side work, and its 115 draws cannot hold more than about a fifth of a millisecond of it.

## Options

1. Build the direct-draw path now. Its measured ceiling reaches several milliseconds of Battle's GPU time, which its several passes may make worth a dedicated session.
2. Build the direct-draw path after the instance-count probe. That probe has run, and the passes widened its ceiling, so it no longer rules the build out.
3. Reduce the number of draws, as M2-EX41's draw merging does. It is on main, and it moved Battle from 13 fps and 1,230 draws to 32 fps and 261 draws.
4. Pull instances from storage buffers. The probe's `direct-pull` and `own-pull` arms remove the clamp with no probe at all, and they cost as much as direct draws. Per-instance data would leave the vertex buffers, which hard rule 7 refuses.
5. Leave the draw path alone and measure the frame's other work. Factory pays 25 fps against three.js's 41 on WebGPU over 115 draws, so its gap is pass and pixel work.

## Decision

The owner chose option (b) on 2026-10-14: the direct-draw path, chosen by a measured start-up probe. This record keeps that ruling and settles the probe and the path as above. The three-pass run widens the path's ceiling to tens of milliseconds at 1,024 draws. So the passes that the engine's own draws land in decide whether a dedicated session is worth it. The short slices and the iPhone run measure that number.

## The measured result

On 2026-10-18 the comparison pages ran on this Mac, in Safari 26.6.2 and Chrome 155, at High with the governor off. Both engines drew into a 1040 by 848 canvas in Safari, so the work was equal. Chrome drew null3D into 2080 by 1600 and three.js into 1040 by 800, so its null3D figures do four times the pixels.

Safari chose the direct path and Chrome kept the indirect one, as their probes measured. Battle and Factory against three.js, in frames a second, at the canvas given beside each figure:

| Page | Safari, null3D | Safari, three.js | Chrome, null3D | Chrome, three.js |
| --- | --- | --- | --- | --- |
| Battle, WebGPU | 59.9 fps, 7.79 ms GPU, 1040x848 | 44.1 fps, 1040x848 | 91.1 fps, 15.84 ms, 2080x1600 | 38.6 fps, 1040x800 |
| Battle, WebGL2 | 58.9 fps, 1040x848 | 43.5 fps, 1040x848 | 52.1 fps, 19.99 ms, 2080x1600 | 39.2 fps, 1040x800 |
| Factory, WebGPU | 59.8 fps, 5.60 ms, 1040x848 | 52.6 fps, 1040x848 | 120.0 fps, 5.41 ms, 2080x1600 | 120.0 fps, 1040x800 |
| Factory, WebGL2 | 60.3 fps, 1040x848 | 52.5 fps, 1040x848 | 120.0 fps, 6.16 ms, 2080x1600 | 120.0 fps, 1040x800 |

Safari with the same pages forced to the indirect path, `?direct=off`: Battle 51.2 fps and 15.55 ms of GPU time at 1040x848, Factory 59.8 fps and 5.03 ms at 1040x848. So the direct path halved Battle's GPU time and took the frame from 51.2 to 59.9 fps. Factory did not move, and its GPU time stayed within the noise either way. The loads were 6.4 to 8.9, recorded beside each figure.

The three.js WebGPU columns of that table came from WebGLRenderer, which was the comparison's default until 2026-10-18 ([D-121](D-121-comparison-tier.md#addendum-18-october-2026-threejss-renderer-follows-the-gpu-path)). The same-path Mac figures are not measured. The phone run below measures them on a cloud device.

So the bar holds on the Mac: null3D beats three.js on Battle and Factory on both backends in Safari, where every run drew 1040 by 848. In Chrome null3D beats three.js on both Battle backends at four times the pixels, and Factory reaches the display's 120 frames like three.js. Factory's remaining gap on the iPhone 17 is pass and pixel work that no draw path removes.

## The two paths draw one frame

A forced comparison on SwiftShader held one scene at 320 by 180 and drew it with `?direct=on` and with `?direct=off`. The first run differed by 0.2153% of pixels, against a 0.1% limit, on two crates.

The direct path recorded every shadow view with the opaque pipeline. A view of one shadow atlas tile draws with the tile pipeline. The opaque pipeline draws nothing where the scene has no sun cascades, so the tile's casters went missing. After the fix both paths draw 33 calls, and the frames differ in no pixel.

`tests/image/direct-draws.spec.ts` now draws one scene both ways in one browser and compares the two frames. It reads the path from `HeldFrame.directDraws`, so it proves its switch took effect. It needs no reference pictures, so a divergence fails even on a device whose pictures were never saved. The fix changed no reference.

## The iPhone 17's own run

On 2026-10-18 the same comparison pages ran on a cloud iPhone 17 in Safari 26.5, with every page at 603 by 1009. The probe chose the direct path on both scenes, and the forced pages reported the path asked for.

| Page | Indirect | Direct | Gain |
| --- | --- | --- | --- |
| Battle, WebGPU | 26.1 fps, 29.10 ms GPU | 26.4 fps, 27.84 ms | 1.26 ms |
| Factory, WebGPU | 22.3 fps, 35.03 ms | 22.4 fps, 34.27 ms | 0.76 ms |

The clamp holds about a millisecond of Battle's frame there, which matches this record's estimate of 0.8 ms.

## The same-path run

The comparison pages now put three.js on the renderer of the GPU path, as [D-121](D-121-comparison-tier.md#addendum-18-october-2026-threejss-renderer-follows-the-gpu-path) records. On 2026-10-18 the pages ran again on the cloud iPhone 17 in Safari 26.5, every page at 603 by 1009. Each page warmed for 15 seconds, then measured 8 seconds with the page's own measure. Every three.js page reported the renderer that its GPU path names.

| Page | null3D | three.js |
| --- | --- | --- |
| Battle, WebGPU | 26.0 fps, 29.09 ms GPU, 295 draws, direct | 31.5 fps, WebGPURenderer |
| Battle, WebGL2 | 49.7 fps, 217 draws | 33.8 fps, WebGLRenderer |
| Factory, WebGPU | 24.0 fps, 31.91 ms GPU, 115 draws, direct | 41.1 fps, WebGPURenderer |
| Factory, WebGL2 | 60.0 fps, 115 draws | 59.2 fps, WebGLRenderer |

With `?renderer=webgl` on the WebGPU query, three.js drew Battle at 34.1 fps and Factory at 59.4, on WebGLRenderer. Those are the figures that the earlier WebGPU column measured.

So the bar holds on the iPhone 17's WebGL2 path, where null3D wins Battle and ties Factory at the screen's rate. It misses on its WebGPU path in this run. three.js holds 31.5 frames on Battle to null3D's 26.0, and 41.1 on Factory to null3D's 24.0. Battle's WebGPU result moves between sessions: on 2026-10-14 null3D held 32 frames and three.js 31 on WebGPURenderer. Factory's does not.

The cloud Galaxy S25 in Chrome 152 ran the four bar pages. Every page drew at a canvas backing size of 540 by 907 (360 by 604 CSS pixels). Its screen runs at 30 Hz, so the cap is 30 frames. Every null3D page held the cap.

| Page | null3D | three.js |
| --- | --- | --- |
| Battle, WebGPU | 30.0 fps, 25.34 ms GPU, 294 draws | 25.5 fps, WebGPURenderer |
| Battle, WebGL2 | 30.0 fps, 221 draws | 28.0 fps, WebGLRenderer |
| Factory, WebGPU | 30.0 fps, 19.07 ms GPU, 115 draws | 29.1 fps, WebGPURenderer |
| Factory, WebGL2 | 30.0 fps, 115 draws | 30.0 fps, WebGLRenderer |

On the S25 the bar holds for both scenes and both paths, as far as a 30 frame cap can show. three.js misses the cap on Battle on both renderers, and on Factory on WebGPURenderer. The cap bounds every win above 30 frames, so Factory's WebGL2 result is a tie.

So the direct path helps the phone as far as the clamp reaches, and the phone's gap is other work: pass and pixel cost, as Factory's figures have shown since the first device run.

## What this changes

The engine has the start-up probe and the direct-draw path, and `engine.capabilities.directDraws` reports the choice. `?direct=on|off` forces either path for a test. GPU occlusion culling and `?instances=index` do not run on the direct path, which needs the instance counts that the GPU culls. The probe and the Mac comparisons above ran on the Mac, and the same pages ran on a cloud iPhone 17 and Galaxy S25.

## Addendum 26 October 2026: the instance buffer follows the largest buffer

The direct path's compacted instance buffer takes the vertex and copy-destination usages and no storage usage. It binds at vertex slot 1 and no group reads it. So the device's largest buffer bounds it. The engine asks a device for at least 256 MiB of that, and for as much as its largest storage binding where that is bigger.

The frame builder sized that buffer by the largest storage binding instead, as it must for the buffers that a group binds. On a device whose binding is 128 MiB, a compacted layout past that size failed every frame with E1501. The same scene drew before. The rows went up in small writes, and their destination offsets lay past 128 MiB. A batch of about 1.05 million rows that draws inside a distance band, or with levels that fade, takes a fading bucket beside its bucket. That doubles its rows, so its compacted layout passes 128 MiB at about half that many.

`crates/null3d-render/src/frame.rs` sizes such a buffer with two functions. `unbound_buffer_bytes` gives the largest buffer of a path. It is the larger of the storage binding and 256 MiB. That is the floor of the device's largest buffer, not the largest request that the engine makes. A path that binds no storage buffer takes the portable limit alone. `grown_size_within` grows a buffer with room inside that figure. It refuses the frame when the need passes the figure.

The direct path's instance buffer uses them. So do the blended, decal and redraw instance buffers. Those had no limit at all, and could ask a device for a buffer past its largest. So does the debug line buffer, which had no limit either. The WebGPU path gives it the larger figure. The WebGL2 path gives it the portable buffer limit alone, since WebGL2 binds no storage buffer.

Four tests hold this. One records a frame whose compacted layout passes its binding: `the_direct_path_sizes_its_instance_buffer_past_the_storage_binding` in `crates/null3d-render/tests/gpu_driven.rs`. Another covers both branches of the figure and the sizing within a limit: `a_buffer_that_no_group_binds_grows_to_the_device_s_largest_buffer` in `crates/null3d-render/src/frame.rs`. A third holds the blended rows' buffer at the boundary: `a_sorted_instance_buffer_is_capped_at_the_device_s_largest_buffer` in `crates/null3d-render/src/gpu_driven/transparent.rs`. The fourth holds the line buffer's: `a_line_buffer_is_capped_at_the_largest_buffer_of_its_path` in `crates/null3d-render/src/debug_lines.rs`. Last, a test in `packages/engine/src/render/renderer.test.ts` ties the figure to the maximum buffer size that the page asks a device for. A smaller request fails it.
