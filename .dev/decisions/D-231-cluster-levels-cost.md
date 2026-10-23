# D-231: What a tree of cluster patches costs

Status: measured for M3-L3 on 23 October 2026, for the owner's review. Built: the pass, its
pictures and the plan that times it on phones and tablets; the Mac's figures wait for a quiet
machine. The drawing method is [D-213](D-213-cluster-levels.md)'s addendum; this record holds what
it costs. Date: 2026-10-23. Task: M3-L3.

Summary: A heightfield of 32,768 triangles in a tree of 511 patches draws its frame in 3.1 to 4.8 ms
of GPU time on a Galaxy S25 and 4.1 to 5.1 ms on an iPad Pro 13, as the camera stands 12, 30 and 80
meters from the middle of the ground. The frame falls by about a third as the camera draws back,
which is the saving that coarser patches make, and the pass that picks them holds the chosen
patches' indices for one draw.

## Question

The cluster levels draw a mesh from its tree of patches on the WebGPU path. What does that cost the
frame, on the Mac, on a tablet and on a phone, and does the cost fall as the camera draws back and
the patches coarsen?

## Rule

The pass may cost a frame no more than the triangles it saves: on a scene that draws one large
static mesh, the frame's GPU time at a distance must not exceed its time close to the camera. A pass
that held every frame's cost near its closest figure would mean the saving never reaches the frame,
and several of the milestone's reds look like that.

## Data

The `cluster-cost` page draws `tests/pages/assets/models/cluster-terrain.glb` through
`assets.loadGltf`, with one directional light and one ambient light, and times two seconds at each
of three camera distances after two seconds of warm-up. It reports the median GPU time of a frame
where the device has a GPU timer, and the median frame interval and CPU time everywhere. The plan
`cluster-cost` runs the page on the devices below, one item for each GPU path, with `direct=off` so
the start-up probe cannot choose the path that draws the mesh whole.

| Device | GPU path | Warp | 12 m | 30 m | 80 m |
| --- | --- | --- | --- | --- | --- |
| Galaxy S25 (SM-S931B), Android 15, Chrome 152 | WebGPU | 1080 × 1863 | 4.72 ms | 4.39 ms | 3.41 ms |
| Galaxy S25, Android 15, Chrome 152 | compatibility | 1080 × 1863 | 4.78 ms | 4.46 ms | 3.15 ms |
| iPad Pro 13 (2025), iOS 26, Safari 26.6.1 | WebGPU | 2064 × 2528 | 4.58 ms | 4.15 ms | 4.12 ms |
| iPad Pro 13 (2025), iOS 26, Safari 26.6.1 | compatibility | 2064 × 2528 | 4.57 ms | 5.05 ms | 3.39 ms |

The figures are the GPU time of the whole frame, not of the pass alone. The page draws nothing else
that follows the camera, so the fall from the closest distance to the farthest is the saving that
coarser patches make: on the Galaxy S25 it is 1.31 ms of 4.72, or 28 percent, and on the iPad's
compatibility path 1.18 ms of 4.57, or 26 percent. The iPad's core WebGPU row falls less, by 0.46 ms,
because its 2,064 by 2,528 pixels cost more fill than the far patches save in triangles.

The WebGL2 path reports no GPU time on either device, since neither offers a timer there. Its frame
interval and CPU time hold at the same figures as the WebGPU paths, 33.3 ms and about 0.5 ms on the
Galaxy S25 at its 30 Hz display, and 15.5 ms and about 0.6 ms on the iPad at 59 Hz.

The memory is [D-213](D-213-cluster-levels.md)'s addendum: 4 bytes a patch for the runs and the
offsets, the view's list at 4 bytes an index for every patch in the tree, and the scene's tables at
32 bytes a patch. For the test model that is 813,004 bytes a view in use, about 1.16 MiB allocated,
and 824,480 bytes of scene tables.

## Decision

No change follows. The cost falls with distance on every row, which is what the pass exists for, and
the frames stay within a 60 Hz frame on the phone. The per-view list is sized for the whole tree
rather than for the patches a view draws, which costs a 1,000,000-triangle mesh about 8 MB a view;
sizing it per frame is the trim the drawing method's addendum names, and it waits for a scene that
needs it.

## Consequences

- The page and the plan stay as the way to measure the pass again when it changes.
- A device without a GPU timer reports no GPU figure; its frame interval and CPU time stand in.
- The Mac's figures are not in this table yet: the run needs the machine's load under eight, and the
  fleet kept it far above that while the milestone landed.
