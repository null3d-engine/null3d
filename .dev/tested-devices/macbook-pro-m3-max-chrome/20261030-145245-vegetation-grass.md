Plans: vegetation-grass 2026-10-30

Result: 11 passed, 0 skipped, 0 failed

The branch is `feat/m3-v8-grass` on top of `1d89af7fa`, with the grass reading the wind add-on's
field and drawn in three distance bands. The page came from the dev server in
`/Users/ram/dev/null3d-evidence`, through the job queue's quiet window. It ran in Chrome
156.0.8078.79 on macOS 26.2, and the runner reported no timing problem.

The plan runs `vegetation-grass` at each preset and GPU path that its tier offers, then each of the
three bands alone at High on core WebGPU. The page draws a hill of 20,000 tufts at the High count
in the near band, measures five seconds after a three-second warm-up, and its canvas is 960 by 540
CSS pixels at one device pixel per CSS pixel. A preset draws 0.35, 0.6, 1 or 1.25 of each band's
tufts.

| GPU path | Preset | Tufts drawn | Frames | GPU median (ms) | GPU p95 (ms) | GPU p99 (ms) | CPU median (ms) | Draw calls |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| WebGPU | Low | 12,250 | 599 | 1.05 | 1.18 | 1.18 | 1.48 | 5 |
| WebGPU | Medium | 21,000 | 598 | 1.97 | 2.10 | 2.13 | 1.65 | 8 |
| WebGPU | High | 35,000 | 594 | 2.59 | 2.82 | 2.85 | 1.68 | 8 |
| WebGPU | Ultra | 43,750 | 599 | 3.08 | 3.28 | 3.53 | 1.76 | 8 |
| compatibility | Low | 12,250 | 600 | 1.05 | 1.18 | 1.21 | 1.60 | 5 |
| compatibility | Medium | 21,000 | 600 | 2.23 | 2.42 | 2.49 | 1.63 | 8 |
| WebGL2 | Low | 12,250 | 599 | 1.39 | 6.44 | 6.64 | 1.76 | 20 |
| WebGL2 | Medium | 21,000 | 598 | 4.94 | 7.70 | 7.95 | 1.94 | 34 |

Each band alone at High on WebGPU, with the other two bands' batches drawn at no rows:

| Band | Distances (m) | Tufts | Triangles a tuft | Frames | GPU median (ms) | Opaque pass (ms) | Final pass (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| near | 0 to 17 | 20,000 | 65 | 600 | 1.84 | 1.44 | 1.11 |
| middle | 17 to 30.6 | 10,000 | 39 | 600 | 1.44 | 1.05 | 0.79 |
| far | 30.6 to 54.4 | 5,000 | 13 | 600 | 0.85 | 0.46 | 0.46 |

The bands cheapen the frame. The whole hill at High took 2.59 ms of GPU time a frame, against
3.47 ms in the run of the same hill without bands (the 13:13 run, whose one mesh carried all 20,000
tufts at 65 triangles each). The far ground now draws 39 and 13 triangles a tuft where it drew 65.
The frame's opaque pass took 2.16 ms at the median, the final pass 1.44 and the wind add-on's
compute pass 0.07.

The sketch thread's median at High is 1.68 ms, against 0.93 ms without bands. The bands cost that
thread the band test and the culling of 43,750 rows where the hill held 25,000, so read the
difference as the bands' own CPU cost on this machine.

The plan allocates every band's rows once, for Ultra's share: 25,000 near, 12,500 middle and 6,250
far, 43,750 rows of 64 bytes, 2.8 MB. A preset changes only how many rows draw: 12,250 rows and
784 KB at Low, 21,000 and 1.34 MB at Medium, 35,000 and 2.24 MB at High, and all 43,750 and 2.8 MB
at Ultra. Each band places its tufts over the whole square and the engine drops the rows beyond the
band's distance of the camera, so a camera at the square's edge leaves rows undrawn that a tile
built around the camera would not place.

The High WebGPU figure is inside the add-on's 49.0 ms budget on the Apple devices by a wide margin.
The iPad, the S24-class phone and the Tab A9 Plus rows are owed. The compute-built blade path is
not built yet.

results: /Users/ram/dev/null3d-evidence/target/runs/20261030-145245-vegetation-grass
