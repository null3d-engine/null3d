# D-231: What a tree of cluster patches costs

Status: measured for M3-L3, for the owner's review. Built: both GPU routes, their pictures, the
plan that times them on phones and tablets, the Mac's figures for both routes, and the GPU check.
The WebGL2 rows for the iPad and the phone are in, from the device records
[`20261029-020306-cluster-cost`](../tested-devices/ipad-pro-13-safari/20261029-020306-cluster-cost.md)
and
[`20261029-020829-cluster-cost`](../tested-devices/galaxy-s25-sm-s931b-chrome/20261029-020829-cluster-cost.md).
[D-213](D-213-cluster-levels.md#drawing-on-webgpu) holds the WebGPU drawing method and
[D-234](D-234-what-webgl2-draws-for-a-cluster-tree.md) the WebGL2 one; this record holds what they
cost. The Mac's figures are measured on the current tree of the test model, of 514 patches and
196,941 indices, at `40e551ca3`. The device rows come from the earlier tree, of 511 patches and
202,032 indices ([The tree that the figures measured](#the-tree-that-the-figures-measured)).
Task: M3-L3.

Summary: A heightfield of 32,768 triangles in a tree of 514 patches draws its frame on the Mac in
0.8, 0.5 and 0.6 ms of GPU time on WebGPU and 2.0, 1.5 and 1.2 ms on WebGL2, as the camera stands
12, 30 and 80 meters from the middle of the ground. The GPU time falls by 25 percent on WebGPU and
40 percent on WebGL2 as the camera draws back, which is the saving that coarser patches make, while
the frame interval stays at the display's 60 Hz; the pass that picks the patches holds their
indices for one draw. The WebGL2 figures sit at or below the earlier 511-patch tree's 2.1, 2.5 and
1.7 ms. On the earlier tree the device rows draw in 3.1 to 4.8 ms on a Galaxy S25 and 3.4 to 5.1
ms on an iPad Pro 13 at those distances.

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

The WebGPU route. The Mac's row is the current tree; the device rows are the earlier 511-patch
tree's:

| Device | GPU path | Warp | 12 m | 30 m | 80 m |
| --- | --- | --- | --- | --- | --- |
| MacBook Pro, Chrome, Medium | WebGPU | 1600 × 900 at 1x | 0.8 ms | 0.5 ms | 0.6 ms |
| Galaxy S25 (SM-S931B), Android 15, Chrome 152 | WebGPU | 1080 × 1863 | 4.72 ms | 4.39 ms | 3.41 ms |
| Galaxy S25, Android 15, Chrome 152 | compatibility | 1080 × 1863 | 4.78 ms | 4.46 ms | 3.15 ms |
| iPad Pro 13 (2025), iOS 26, Safari 26.6.1 | WebGPU | 2064 × 2528 | 4.58 ms | 4.15 ms | 4.12 ms |
| iPad Pro 13 (2025), iOS 26, Safari 26.6.1 | compatibility | 2064 × 2528 | 4.57 ms | 5.05 ms | 3.39 ms |

The figures are the GPU time of the whole frame, not of the pass alone. The page draws nothing else
that follows the camera, so the fall in GPU time from the closest distance to the farthest is the
saving that coarser patches make: on the current tree the Mac's WebGPU route falls 0.2 ms of 0.8,
or 25 percent. On the earlier tree the Galaxy S25 fell 1.31 ms of 4.72, or 28 percent, and the
iPad's compatibility path 1.18 ms of 4.57, or 26 percent. The middle row of each route can be
higher than its close row, on WebGPU as on WebGL2, because the camera sees more of the ground from
that distance; the Mac's WebGPU middle row is instead 0.3 ms below its close row, within the
timer's resolution. The iPad's core WebGPU row falls less, by 0.46 ms, because its 2,064 by 2,528
pixels cost more fill than the far patches save in triangles. The Mac's row is the whole frame's
GPU time in 0.5 to 0.8 ms, where the frame runs at the display's 60 Hz; the tree costs it under a
millisecond at every distance, and the figures there are at the timer's resolution.

The WebGL2 route, on the Mac at Medium, from the clean rerun with no other run beside it:

| Distance | GPU time | Frame interval | CPU time | Busiest job |
| --- | --- | --- | --- | --- |
| 12 m | 2.0 ms | 16.7 ms | 0.2 ms | not reported |
| 30 m | 1.5 ms | 16.7 ms | 0.2 ms | not reported |
| 80 m | 1.2 ms | 16.7 ms | 0.1 ms | not reported |

The WebGL2 route on the two devices, from the runs on the earlier tree at the plan's High preset:

| Device | 12 m | 30 m | 80 m | CPU time | GPU timer |
| --- | --- | --- | --- | --- | --- |
| iPad Pro 13 (2025), Safari 26.6.1 | 15.6 ms | 15.5 ms | 15.6 ms | 0.84 to 1.08 ms | none |
| Galaxy S25 (SM-S931B), Chrome 152 | 33.3 ms | 33.3 ms | 33.3 ms | 0.61 to 0.70 ms | none |

Neither device offers a GPU timer on this path, so the interval and the CPU time are what this
record's own rule takes instead. The iPad's interval is its display's rate, and the page is not near
its budget there. The Galaxy S25's run marks its timing unreliable because its display ran at 30 Hz,
so its interval is the display's period and not the page's cost; its CPU figures are the page's own
work and do not depend on the display. The two device records hold the runs and say the same.

The WebGL2 route costs more GPU time than WebGPU at every distance, because it draws one range a
mesh at a time through the driver's multi-draw path, where WebGPU draws one indirect call. The
saving still reaches the GPU time: at 80 m it takes 1.2 ms against 2.0 ms at 12 m, 40 percent
less. The 30 m row is 0.5 ms below the close row, within the timer's resolution and the ground the
camera sees there. The CPU figure is the busiest thread's. The raw report names the sketch worker as
that thread in every row, at about twice the drawing thread's time, because the walk runs inline on
the caller that the report names `sketch-worker`; no job worker is listed.

The first WebGL2 run at this tree read 5.4, 7.3 and 3.5 ms beside a `test:images` run of
`demo-island` on WebGL2, whose SwiftShader GPU process used about one core, at a load of 6.6 before
and 5.8 after. A WebGL2-only rerun with no other run beside it read 2.0, 1.5 and 1.2 ms at a load of
7.9 before and 7.2 after, with the frame at 16.7 ms. The high first figures were the neighbour's,
not the model's, and the clean figures are the record's WebGL2 row.

The Mac's WebGPU row is the first window, at Medium, with the page at 1600 by 900 at 1x and its
frame at 60 Hz, at a one-minute load of 7.1 before and 6.6 after. A `test:images` run of
`demo-island` on WebGL2 started during that window, as the WebGL2 paragraph says. The WebGL2 row is
the clean rerun with no other run beside it, at a load of 7.9 before and 7.2 after. The earlier
tree's Mac rows held 0.6, 0.9 and 0.4 ms on WebGPU and 2.1, 2.5 and 1.7 ms on WebGL2. Both current
rows agree with their earlier rows within the timer's resolution.

The WebGL2 rows for the iPad and the phone come from the runs at the plan's High preset, which
matches the earlier device rows. The plan runs the page on `gpu=webgl2` with `direct=off`, as its
other items do, and the record wants the median GPU time where the device times it, and the frame
interval, CPU time and busiest job worker's time at 12, 30 and 80 meters. A table that mixed
presets would compare different work.

The memory is in [D-213](D-213-cluster-levels.md#what-it-costs) for the WebGPU route: 4 bytes a
patch for the runs and the offsets, the view's list at 4 bytes an index for each index the view
picks, and the scene's tables at 32 bytes a patch. For the earlier 511-patch test model the close
view held 813,004 bytes in use, about 1.16 MiB allocated, and its scene tables took 824,480 bytes;
the current tree's scene tables take 804,212 bytes. The WebGL2 route's memory is
in [D-234](D-234-what-webgl2-draws-for-a-cluster-tree.md): the tree's indices take 787,764 bytes a
mesh, a view's chosen runs at most 4,112 bytes, and the draw-record buffer 36,864 bytes a view for
the test model.

The GPU check compared this branch with the milestone head that it merged, `cff5625d4`, on the
Mac's GPU: `cff5625d4..24b9efcb0 passed: s4 medium 3.85 to 3.97 ms (+3.1%, same, noise 0.9%); s6
medium 4.51 to 4.58 ms (+1.7%, same, noise 5.3%); s4 high 4.42 to 4.27 ms (-0.7%, same, noise
6.5%); s6 high 5.37 to 5.37 ms (-0.2%, same, noise 0.5%)`. Every page carries its verdict and the
noise that decided it: all four are `same`, and none is faster or slower beyond its allowance. The
first line, taken before the merge, named an empty range and dropped the verdicts and the two High
noise figures; this line replaces it.

## Decision

No change follows. Both routes' GPU time falls from the close distance to the far one, which is
what the pass exists for, and the frames stay within a 60 Hz frame on the phone. The WebGL2 route
costs more absolute GPU time than WebGPU, and it still saves 40 percent of its GPU time at 80 m.
Its absolute figures agree with the earlier tree's within the timer's resolution; the first read
beside a software-rendered picture run was that neighbour's, and the clean rerun replaced it. The
view's list is sized to the indices that each view picks, with a sixteenth
more and three patches to spare, as [D-213](D-213-cluster-levels.md#what-it-costs) says; a list
sized for the whole tree would cost a 1,000,000-triangle mesh about 8 MB a view. The WebGL2
draw-record buffer's figures are in
[D-234](D-234-what-webgl2-draws-for-a-cluster-tree.md#the-draw-record-buffers-memory).

## Consequences

- The page and the plan stay as the way to measure either route again when it changes.
- A device without a GPU timer reports no GPU figure; its frame interval and CPU time stand in.
- The WebGL2 rows for the iPad and the phone are measured on the earlier tree at the High preset,
  and both devices report no GPU timer on that path, so their interval and CPU time are what stand
  in.
- The Mac's figures are one preset's, on the current tree. The WebGPU row is the first window at a
  load of 6.6 to 7.1, which shared the machine with a software-rendered picture run's start; the
  WebGL2 row is a clean rerun at a load of 7.2 to 7.9 with no other run beside it.

## The tree that the figures measured

The current tree holds 514 patches and 196,941 indices. Its errors are each patch's measured
distance from the mesh below it, and its top patch holds 15 triangles. The earlier tree held 511
patches and 202,032 indices: its errors added up along each chain, its spheres held their own
triangles alone, and its outer edge stayed locked, so its coarse patches switched in later than
they should ([D-213](D-213-cluster-levels.md#options-rejected)). A view at the far distance
therefore picks coarser patches sooner. The far rows against the earlier tree's: WebGPU reads 0.6
ms against 0.4 ms, within the timer's resolution, and WebGL2 1.2 ms against 1.7 ms, lower, with its
fall from its own close row 40 percent against 19 percent. The pass reads one more sphere for each
patch whose own error passes, which adds little to the count stage.

The Mac's figures above are measured at `40e551ca3` on the current tree, at Medium: the WebGPU row
in the first window and the WebGL2 row in a clean rerun with no other run beside it. The device rows
and the earlier Mac rows are the 511-patch tree's, kept with that model named.
