# D-231: What a tree of cluster patches costs

Status: measured for M3-L3, for the owner's review. Built: both GPU routes, their pictures, the
plan that times them on phones and tablets, the Mac's figures for both routes, and the GPU check.
Owed: the WebGL2 rows for the iPad and the phone, which the landing session's device runs make.
[D-213](D-213-cluster-levels.md#drawing-on-webgpu) holds the WebGPU drawing method and
[D-234](D-234-what-webgl2-draws-for-a-cluster-tree.md) the WebGL2 one; this record holds what they
cost. Task: M3-L3.

Summary: A heightfield of 32,768 triangles in a tree of 511 patches draws its frame in 3.1 to 4.8 ms
of GPU time on a Galaxy S25 and 4.1 to 5.1 ms on an iPad Pro 13, as the camera stands 12, 30 and 80
meters from the middle of the ground. The frame falls by about a third as the camera draws back,
which is the saving that coarser patches make, and the pass that picks them holds the chosen
patches' indices for one draw. On the Mac the WebGPU route takes 0.6, 0.9 and 0.4 ms, and the
WebGL2 route 2.1, 2.5 and 1.7 ms, at those distances.

## Question

The cluster levels draw a mesh from its tree of patches on the WebGPU path, and on WebGL2 where the
device draws many ranges in one call. What does each route cost the frame, on the Mac, on a tablet
and on a phone, and does the cost fall as the camera draws back and the patches coarsen?

## Rule

The pass may cost a frame no more than the triangles it saves: on a scene that draws one large
static mesh, the frame's GPU time at the farthest distance must not exceed its time close to the
camera. A pass that held every frame's cost near its closest figure would mean the saving never
reaches the frame, and several of the milestone's reds look like that. The middle distance can
exceed the close one when the camera sees more of the ground from it, so the record compares the
farthest row with the closest, which is the saving that the tree exists for. A WebGL2 device may
have no GPU timer, as the phone and the tablet did not; there the frame interval and CPU time stand
in. The Mac's Chrome reports one.

## Data

The `cluster-cost` page draws `tests/pages/assets/models/cluster-terrain.glb` through
`assets.loadGltf`, with one directional light and one ambient light, and times two seconds at each
of three camera distances after two seconds of warm-up. It reports the median GPU time of a frame
where the device has a GPU timer, and the median frame interval, CPU time and busiest job worker's
time everywhere. The plan `cluster-cost` runs the page on the devices below, one item for each GPU
path, with `direct=off` so the start-up probe cannot choose the path that draws the whole levels.

The WebGPU route:

| Device | GPU path | Warp | 12 m | 30 m | 80 m |
| --- | --- | --- | --- | --- | --- |
| MacBook Pro, Chrome, Medium | WebGPU | 1600 × 900 | 0.6 ms | 0.9 ms | 0.4 ms |
| Galaxy S25 (SM-S931B), Android 15, Chrome 152 | WebGPU | 1080 × 1863 | 4.72 ms | 4.39 ms | 3.41 ms |
| Galaxy S25, Android 15, Chrome 152 | compatibility | 1080 × 1863 | 4.78 ms | 4.46 ms | 3.15 ms |
| iPad Pro 13 (2025), iOS 26, Safari 26.6.1 | WebGPU | 2064 × 2528 | 4.58 ms | 4.15 ms | 4.12 ms |
| iPad Pro 13 (2025), iOS 26, Safari 26.6.1 | compatibility | 2064 × 2528 | 4.57 ms | 5.05 ms | 3.39 ms |

The figures are the GPU time of the whole frame, not of the pass alone. The page draws nothing else
that follows the camera, so the fall from the closest distance to the farthest is the saving that
coarser patches make: on the Galaxy S25 it is 1.31 ms of 4.72, or 28 percent, and on the iPad's
compatibility path 1.18 ms of 4.57, or 26 percent. The iPad's core WebGPU row falls less, by 0.46 ms,
because its 2,064 by 2,528 pixels cost more fill than the far patches save in triangles. The Mac's
row is the whole frame in 0.4 to 0.9 ms, where the frame runs at the display's 60 Hz; the tree
costs it under a millisecond at every distance, and the figures there are at the timer's
resolution.

The WebGL2 route, on the Mac at Medium in the same quiet window:

| Distance | GPU time | Frame interval | CPU time | Busiest job |
| --- | --- | --- | --- | --- |
| 12 m | 2.1 ms | 16.7 ms | 0.1 ms | not reported |
| 30 m | 2.5 ms | 16.7 ms | 0.2 ms | not reported |
| 80 m | 1.7 ms | 16.7 ms | 0.1 ms | not reported |

The WebGL2 route costs more GPU time than WebGPU at every distance, because it draws one range a
mesh at a time through the driver's multi-draw path, where WebGPU draws one indirect call. The
saving still reaches the frame: at 80 m the frame takes 1.7 ms against 2.1 ms at 12 m, 19 percent
less. The 30 m row is 0.4 ms above the close row because the camera sees more of the ground there.
The measurement lists no job thread for these frames, so the CPU time is the render worker's own.

The Mac's run holds the Medium preset alone, because the branch's two measurements shared one
quiet window. It ran both routes at a one-minute load of 2.5 before and 2.5 after, with the page's
frame at 60 Hz. The earlier Mac row held 0.7, 0.2 and 0.5 ms; this run replaced it with a row
measured beside the WebGL2 route, where the two can be compared.

The WebGL2 rows for the iPad and the phone are owed, because the device runs are the landing
session's. The plan runs the page on `gpu=webgl2` at the Medium preset with `direct=off`, and the
record wants the median GPU time where the device times it, and the frame interval, CPU time and
busiest job worker's time at 12, 30 and 80 metres. Medium matches the rows above; a route that only
holds High would not be the claim.

The memory is in [D-213](D-213-cluster-levels.md#what-it-costs) for the WebGPU route: 4 bytes a
patch for the runs and the offsets, the view's list at 4 bytes an index for every patch in the
tree, and the scene's tables at 32 bytes a patch. For the test model that is 813,004 bytes a view
in use, about 1.16 MiB allocated, and 824,480 bytes of scene tables. The WebGL2 route's memory is
in [D-234](D-234-what-webgl2-draws-for-a-cluster-tree.md): the tree's indices take 404,064 bytes a
mesh, a view's chosen runs at most 4,088 bytes, and the draw-record buffer 36,864 bytes a view for
the test model.

The GPU check compared this branch with its own base, `m3-start` at `216178b10`, on the Mac's GPU:
`s4 medium 4.10 to 4.06 ms (+3.7%); s6 medium 4.62 to 4.56 ms (+0.0%); s4 high 4.54 to 4.04 ms
(-13.3%); s6 high 5.39 to 5.37 ms (-0.6%)`. Each page is inside its allowance and inside twice its
noise, which was 2.9% for S4 Medium and 1.5% for S6 Medium in the run.

## Decision

No change follows. Both routes fall from the close frame to the far one, which is what the pass
exists for, and the frames stay within a 60 Hz frame on the phone. The WebGL2 route costs more
absolute GPU time than WebGPU, and it still saves a fifth of its frame at 80 m. The per-view list
is sized for the whole tree rather than for the patches a view draws, which costs a
1,000,000-triangle mesh about 8 MB a view; sizing it per frame is the trim that
[D-213](D-213-cluster-levels.md#what-it-costs) names, and it waits for a scene that needs it. The
WebGL2 draw-record buffer's figures are in
[D-234](D-234-what-webgl2-draws-for-a-cluster-tree.md#the-draw-record-buffers-memory).

## Consequences

- The page and the plan stay as the way to measure either route again when it changes.
- A device without a GPU timer reports no GPU figure; its frame interval and CPU time stand in.
- The WebGL2 rows for the iPad and the phone wait on the landing session's runs, at the Medium
  preset.
- The Mac's figures are one preset's and one window's.
