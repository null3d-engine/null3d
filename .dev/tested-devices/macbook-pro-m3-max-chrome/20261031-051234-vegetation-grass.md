Plans: vegetation-grass 2026-10-31

Result: 10 passed, 0 skipped, 0 failed

This is the second split hill, the one that keeps every band's tufts at the same blade width and
takes its saving from the blade segments alone. It drew on the branch's tree just after the rebase
onto a360b7e97, through the job queue's quiet window, in Chrome 156.0.8078.79 on macOS 26.2. The
page draws the hill at 960 by 540 drawing pixels and measures five seconds after a three-second
warm-up.

| GPU path | Preset | Tufts drawn | Frames | GPU median (ms) | GPU p95 (ms) | CPU median (ms) | Draw calls |
| --- | --- | --- | --- | --- | --- | --- | --- |
| WebGPU | Low | 14,000 | 601 | 1.38 | 1.57 | 1.70 | 4 |
| WebGPU | Medium | 24,000 | 600 | 2.49 | 2.62 | 1.48 | 6 |
| WebGPU | High | 40,000 | 600 | 3.54 | 4.06 | 1.58 | 6 |
| WebGPU | Ultra | 50,000 | 600 | 4.06 | 4.62 | 1.53 | 6 |
| compatibility | Low | 14,000 | 600 | 1.38 | 1.59 | 1.58 | 4 |
| compatibility | Medium | 24,000 | 600 | 2.88 | 3.17 | 1.54 | 6 |
| WebGL2 | Low | 14,000 | 600 | 5.09 | 6.89 | 1.62 | 7 |
| WebGL2 | Medium | 24,000 | 600 | 5.47 | 8.56 | 1.72 | 20 |

Each band alone at High on core WebGPU:

| Band | Distances (m) | Tufts | Triangles a tuft | Frames | GPU median (ms) | Opaque pass (ms) |
| --- | --- | --- | --- | --- | --- | --- |
| near | 0 to 17 | 20,000 | 65 | 600 | 1.70 | 1.31 |
| far | 17 to 54.4 | 20,000 | 39 | 600 | 2.49 | 2.10 |

The whole hill at High reads 3.54 ms, a little above the 3.47 ms of the one-band hill
([that run](20261030-131312-vegetation-grass.md)), so this split buys no time: the far band's
triangles fall to 60 per cent, but the second batch and its band test cost the frame their own
share. The first split hill, which thinned the far band and widened its blades, took 2.59 ms and a
look review rejected it ([that run](20261030-145245-vegetation-grass.md)). The grass therefore draws
one band by default and a page that wants the split asks for it; D-241 records both attempts.

results: /Users/ram/dev/null3d-evidence/target/runs/20261031-051234-vegetation-grass
