# D-174: The Apple GPU gap, the measured start-up probe and the direct-draw path

Status: the owner chose the direct-draw path on 2026-10-14. The probe and the path are designed, and the path is not built. The instance-count probe has since run, and its answer is below. It shows the path's win is bounded, so the path needs no dedicated session on this evidence.

Summary: A WebKit validation pass makes an indexed indirect draw with vertex buffers expensive on Apple GPUs. The owner asked for a direct-draw path. A start-up probe that measures a real draw chooses it, never a browser or GPU name. The probe's figures show the cost is real. The cost per draw does not grow with the instances per draw or with the drawn work. So the direct path removes about 2 to 4 ms of Battle's 79 ms on the iPhone 17. It removes none of Factory's 25 ms, which is per-frame work. The path alone cannot beat three.js on the iPhone 17.

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

Factory draws 115 times and still pays about 25 ms. three.js draws twelve times more and finishes in 17 ms, so Factory's cost is not per draw. The probe's 2.8 us per draw explains about 3.5 ms of Battle's 1,230 draws. The rest of Battle's 79 ms, and all of Factory's 25 ms, lie elsewhere in the frame.

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

So the direct path removes about 2 to 4 ms of Battle's 79 ms on the iPhone 17, and nothing of Factory's 25 ms. The engine's shadow pass costs 83.1 ms at 973 draws, about 85 us per draw, which is far above the clamp's few microseconds. That cost is something else, and the direct path does not explain it or remove it.

The one arm still missing is more than one pass per frame. The clamp's cost is per draw and per pass, so the passes multiply it, but they do not change its per-draw size. The Mac run of that arm is queued; the iPhone run is owed to the cloud lane.

## Options

1. Build the direct-draw path now. Its measured ceiling is a few milliseconds of Battle's gap. It cannot beat three.js on the iPhone 17.
2. Build the direct-draw path after the instance-count probe. That probe has run, and it shows the win is bounded, so it no longer forces the build.
3. Reduce the number of draws instead, as M2-EX41's draw merging does. It takes the same few milliseconds and it is partly on main.
4. Pull instances from storage buffers. The probe's `direct-pull` and `own-pull` arms remove the clamp with no probe at all, and they cost as much as direct draws. Per-instance data would leave the vertex buffers, which hard rule 7 refuses.
5. Leave the draw path alone and measure the rest of the frame. Battle's shadow pass costs 85 us per draw, and Factory pays 25 ms at 115 draws. So the gap is in the pass and frame work, not in the draw call.

## Decision

The owner chose option (b) on 2026-10-14: the direct-draw path, chosen by a measured start-up probe. This record keeps that ruling and settles the probe and the path as above. The instance-count probe has since run, and it puts the path's ceiling at a few milliseconds of Battle's 79 ms. So the path's build waits on a measurement of the frame's other work, which holds the rest of the gap.

## What this changes

Nothing in the engine yet. The probe and the path are the design above, and the instance-count probe has run. The Mac figures come from the R34 micro-probe runs. The iPhone 17 figures come from the cloud demo run of 2026-10-13.
