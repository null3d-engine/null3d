Plans: vegetation-grass 2026-10-30. The branch is `feat/m3-v8-grass` at `5d884f094` with the grass slice. The page came from the dev server in `/Users/ram/dev/null3d-evidence`, through the job queue's quiet window. It ran in Chrome 156.0.8078.79 on macOS 26.2. The display ran at 120 Hz.

Result: 1 passed, 0 skipped, 0 failed.

The `vegetation-grass` plan starts the test page at High on core WebGPU. The page draws a hill of 20,000 tufts in one instance batch through the add-on's CPU path. It measures five seconds after a three-second warm-up, and its canvas is 960 by 540 CSS pixels at one device pixel per CSS pixel.

| Preset | Tufts drawn | Frames | GPU median (ms) | GPU p95 (ms) | GPU p99 (ms) | CPU median (ms) | Draw calls |
| --- | --- | --- | --- | --- | --- | --- | --- |
| High | 20,000 | 601 | 3.15 | 3.71 | 3.87 | 0.76 | 3 |

The opaque pass took 2.88 ms of the GPU time at the median, the final pass 1.44, the compute pass 0.07 and the copies 0.02. The ground is a 48 by 48 grid. The opaque pass is therefore almost all grass: about 1.3 million triangles for the 20,000 tufts at 65 triangles each, a tuft being 13 blades of three segments.

The grass's High figure is well inside the add-on's 49.0 ms budget on the Apple devices. The iPad, the S24-class phone and the Tab A9 Plus rows are owed. The compute-built blade path is not built yet, so the Ultra preset draws wider rows rather than more of them.

results: /Users/ram/dev/null3d-evidence/target/runs/20261030-125440-vegetation-grass
