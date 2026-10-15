# D-174: The Apple GPU gap, the measured start-up probe and the direct-draw path

Status: the owner chose the direct-draw path on 2026-10-14. The probe and the path are designed, and the path is not built. The probe runs have since shown the clamp is a fixed cost for each draw in each pass. So the draws the engine makes across its passes set the path's ceiling. Battle's own figures are below.

Summary: A WebKit validation pass makes an indexed indirect draw with vertex buffers expensive on Apple GPUs. The owner asked for a direct-draw path. A start-up probe that measures a real draw chooses it, never a browser or GPU name. The cost is a fixed amount for each draw in each pass it lands in. It does not grow with the instances per draw. On the Mac in Safari, 1,024 draws cost 27.0 ms of indirect time in three passes against 9.8 ms in one. That is about 8.5 us for each draw in each pass. Battle draws 324.6 times a frame, so the clamp may hold about 2.8 ms of its 12.68 ms on the Mac. On the iPhone 17 it may hold about 0.8 ms of its 23.2 ms. Battle now beats three.js on the iPhone 17; Factory does not, and Factory's cost is not the draw call.

## Question

Battle on the iPhone 17 runs at 13 fps in null3D and 40 fps in three.js, both on WebGPU at High. Factory runs at 26 fps against three.js's 59. null3D draws 115 times there and three.js 1,447 times, for the same 37 k triangles. Does a direct-draw path, chosen by a measurement and not by a browser name, close the gap?

## Rule

- Choose the draw path only from a measurement of a real draw, never from a browser or GPU name (hard rule 14).
- Keep per-instance data in vertex buffers (hard rule 7).
- Never draw wrongly. The probe picks from a real first-frame draw, and the current path stays the fallback.

## Data

The engine draws every bucket with `drawIndexedIndirect` on WebGPU. WebKit's `clampIndirectIndexBufferToValidValues` runs when a pipeline has vertex buffers. It adds two pipeline switches, an indirect point draw over the draw's whole index count, two vertex to vertex barriers and two scratch allocations. All of that sits inside the render pass. [D-87](D-87-webkit-indirect-arguments.md) covers the separate fault that this pass fixes. Chrome has no such cost.

A raw-WebGPU micro-probe measures the cost with no engine. It uses 1024x768, 4x MSAA, one depth pass, and the same 131 k triangles in every arm. It times each arm with GPU timestamps. Its page is at `logs/r34/indirect-probe/`. Its results are in `logs/r34/indirect-g256-safari.json`, `indirect-iphone17.json` and `indirect-ipad10.json`.

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

The probe runs on the render worker's device, in the first pass that hard rule 22 already asks for. That pass draws one point by a direct draw before the first frame. The probe records a small fixed workload twice on that device. The same buckets draw once with `drawIndexedIndirect` and once with `drawIndexed`, with the same pipelines, vertex buffers, attachments and drawn geometry. It times each arm with timestamp queries where the device has them. Otherwise it times several back-to-back frames to completion. The probe picks the direct path only when the direct arm is faster by a margin that covers the noise. The engine's current path stays the fallback, so an inconclusive device draws as it does today.

The probe reads a real first-frame draw, so it needs no browser name, no GPU name and no user agent. It runs once per device, and its answer is kept for the session.

## The direct-draw path

The engine cannot keep GPU culling and draw directly. The instance count is what the culling shader computes, a readback costs a frame of latency, and a late count draws the wrong instances. So the direct path culls on the CPU, as the WebGL2 builder already does. It keeps per-instance data in a vertex buffer, so hard rule 7 holds. In outline:

1. The job workers cull the same layout that the WebGPU builder draws. Each bucket's visible instances go into that view's instance vertex buffer, in the layout the mesh shaders already read.
2. Each bucket draws with `drawIndexed(indexCount, visibleCount, firstIndex, baseVertex)`, with no indirect buffer in the pass.
3. No mesh shader changes. Its vertex shader already reads each instance's matrix rows and ids from instance-rate vertex attributes. The culling shader's cell offset step moves to the CPU.

This reuses every WebGPU shader build, so it adds no shader variant and no download size.

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

## What this changes

Nothing in the engine yet. The probe and the path are the design above, and the instance-count probe has run. The Mac figures come from the R34 micro-probe runs, and the iPhone 17 figures from the R34 comparison run of 2026-10-14.
