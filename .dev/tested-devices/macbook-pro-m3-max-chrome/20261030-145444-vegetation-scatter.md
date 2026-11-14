Plans: vegetation-scatter 2026-10-30

Result: 2 passed, 0 skipped, 0 failed

The run used the checkout at `feat/m3-v8-grass` on top of `1d89af7fa`; the scatter is the
package's own code, which that branch does not change. The page came from the dev server in
`/Users/ram/dev/null3d-evidence`, through the job queue's quiet window. It ran in Chrome
156.0.8078.79 on macOS 26.2, whose display ran at 120 Hz, and each page reports the middle of three
placements.

| Page | Plants | Checksum | Placement (ms) | Ground maps (ms) | Tiles |
| --- | --- | --- | --- | --- | --- |
| WebGL2 | 955 | 916344353 | 5.81 | 26.49 | 17 m |
| WebGPU | 955 | 916344353 | 5.95 | 22.95 | 17 m |

The placement reads no GPU and starts no engine, so both pages run the same work on the page's own
thread. The two placements differ by 0.14 ms, which the machine's load explains, and both match the
reference checksum that the cloud devices recorded. The counts are the reference's: 104 canopy
trees, 174 young, 651 ground plants and 26 dead wood.

This is the plan's Mac Chrome row.

results: /Users/ram/dev/null3d-evidence/target/runs/20261030-145444-vegetation-scatter
