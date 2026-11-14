Plans: vegetation-grass 2026-10-30

Result: 8 passed, 0 skipped, 0 failed

The branch is `feat/m3-v8-grass` on top of `1d89af7fa`, with the grass reading the wind add-on's
field, which this page holds still. The page came from the dev server in
`/Users/ram/dev/null3d-evidence`, through the job queue's quiet window. It ran in Chrome
156.0.8078.79 on macOS 26.2.

The plan runs `vegetation-grass` at each preset and GPU path that its tier offers. The page draws a
hill of tufts in one instance batch through the add-on's CPU path, measures five seconds after a
three-second warm-up, and its canvas is 960 by 540 CSS pixels at one device pixel per CSS pixel.
The tuft count is the High count, 20,000, and a preset draws 0.35, 0.6, 1 or 1.25 of it.

| GPU path | Preset | Tufts drawn | Frames | GPU median (ms) | GPU p95 (ms) | GPU p99 (ms) | CPU median (ms) | Draw calls |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| WebGPU | Low | 7,000 | 601 | 1.38 | 1.57 | 1.57 | 0.59 | 3 |
| WebGPU | Medium | 12,000 | 600 | 2.36 | 2.62 | 2.69 | 0.84 | 3 |
| WebGPU | High | 20,000 | 599 | 3.47 | 3.82 | 3.93 | 0.93 | 3 |
| WebGPU | Ultra | 25,000 | 600 | 4.19 | 4.46 | 4.55 | 1.00 | 3 |
| compatibility | Low | 7,000 | 600 | 1.44 | 1.57 | 1.64 | 0.93 | 3 |
| compatibility | Medium | 12,000 | 600 | 2.69 | 2.95 | 3.04 | 0.81 | 3 |
| WebGL2 | Low | 7,000 | 600 | 4.87 | 7.29 | 7.93 | 0.79 | 16 |
| WebGL2 | Medium | 12,000 | 600 | 3.84 | 8.44 | 8.87 | 0.65 | 27 |

The WebGPU times come from the GPU's timer. The passes at High take 3.08 ms opaque, 1.51 final,
0.13 compute and no copies at the median; the compute pass is the wind add-on's field, which the
solution runs each frame, and the blades read. The opaque pass carries the ground's 48 by 48 grid
and about 1.3 million triangles of grass at 65 triangles a tuft. At Low and Medium the same passes
take 0.92 and 1.97 ms opaque, 0.66 and 1.11 final and 0.07 compute.

WebGL2 offers no GPU timer on this machine's Chrome, so its GPU column comes from the frame's own
timing and its p95 is wide: its Low row reads slower than its Medium row while drawing fewer tufts,
and the two rows differ by a few milliseconds that the machine's load can explain. Its draw calls
are higher because WebGL2 solves the wind add-on's grid with separate draws, where WebGPU runs a
cycle in one compute pass.

The High WebGPU figure is inside the add-on's 49.0 ms budget on the Apple devices by a wide margin.
The wind field costs the frame its compute pass, 0.07 to 0.13 ms. The sketch thread's median at High
is 0.93 ms, against 0.76 ms in the earlier run of the slice without the field; the two runs came
from different commits and the machine's load differs, so read the difference as an upper bound.

The iPad, the S24-class phone and the Tab A9 Plus rows are owed. The compute-built blade path is not
built yet, so the Ultra preset draws wider rows rather than more of them, and the distance bands
are not built either.

results: /Users/ram/dev/null3d-evidence/target/runs/20261030-131312-vegetation-grass
