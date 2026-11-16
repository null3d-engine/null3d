Benchmark pages: the production build, in a browser without its frame cap.

| Scene | Page | Runs | CPU ms per frame, median (lowest to highest run) | p95 | Busiest thread, ms | Own work, busiest thread | Scene update | All threads | GPU ms | Shadow pixels changed, % | Shadow edge offset, px | Contact gap, px | Flat-surface acne, % | Presented / finished fps | Frame interval p95 / p99 ms | GPU delay ms | Refresh Hz | Upload per frame | Visible entries | Upload per visible entry | Draw calls |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| s1 | null3d-webgpu | 1 | 2.65 (2.65 to 2.65) | 3.48 | sketch-worker 2.65 | n/a | 2.40 | 3.58 | 1.78 | n/a | n/a | n/a | n/a | 364.7 / 364.7 | 3.57 / 4.45 | 3.01 | 48 | 4.80 MB | n/a | n/a | 2 |
| s2 | null3d-webgpu | 1 | 0.11 (0.11 to 0.11) | 0.15 | sketch-worker 0.11 | n/a | 0.00 | 0.15 | 0.25 | n/a | n/a | n/a | n/a | 2417.7 / 2417.7 | 0.62 / 1.71 | 0.70 | 48 | 0.25 MB | n/a | n/a | 101 |
| s3 | null3d-webgpu | 1 | 0.05 (0.05 to 0.05) | 0.14 | sketch-worker 0.05 | n/a | 0.01 | 0.08 | 1.48 | n/a | n/a | n/a | n/a | 748.7 / 748.7 | 2.36 / 2.89 | 2.39 | 48 | 0.02 MB | n/a | n/a | 5 |
| s4 | null3d-webgpu | 1 | 0.19 (0.19 to 0.19) | 0.32 | sketch-worker 0.19 | n/a | 0.01 | 0.35 | 0.73 | n/a | n/a | n/a | n/a | 948.6 / 948.6 | 1.57 / 2.03 | 1.84 | 48 | 0.02 MB | n/a | n/a | 112 |
| s5 | null3d-webgpu | 1 | 1.55 (1.55 to 1.55) | 1.89 | sketch-worker 1.55 | n/a | 0.07 | 3.06 | 4.68 | n/a | n/a | n/a | n/a | 266.3 / 266.3 | 4.74 / 5.17 | 6.61 | 48 | 1.62 MB | n/a | n/a | 45 |
| s6 | null3d-webgpu | 1 | 0.21 (0.21 to 0.21) | 0.30 | render-worker 0.21 | n/a | 0.00 | 0.39 | 1.26 | n/a | n/a | n/a | n/a | 552.4 / 552.4 | 2.43 / 3.14 | 3.28 | 48 | 0.03 MB | n/a | n/a | 1134 |
| s7 | null3d-webgpu | 1 | 0.03 (0.03 to 0.03) | 0.07 | render-worker 0.03 | n/a | 0.00 | 0.05 | 0.31 | n/a | n/a | n/a | n/a | 2093.8 / 2093.8 | 0.77 / 1.74 | 0.83 | 48 | 0.00 MB | n/a | n/a | 5 |


| Scene | Page | Seconds | Target fps | Seconds at the target | Lowest fps | Lowest render scale | Quality steps |
| --- | --- | --- | --- | --- | --- | --- | --- |
| s4 | null3d-webgpu | 30 | 48 | 30 (100%) | 695 | 1 | 0 |
| s5 | null3d-webgpu | 30 | 48 | 30 (100%) | 223 | 1 | 0 |
| s6 | null3d-webgpu | 30 | 48 | 30 (100%) | 450 | 1 | 0 |

| Scene | Page | Runs | First frame, ms | Whole scene, ms | Kit file in, s | Tower file in, s | Content, MB |
| --- | --- | --- | --- | --- | --- | --- | --- |
| s6 | null3d-webgpu | 1 | 3256 | 3273 | 2.33 | 2.37 | 54.2 |

The 1-minute load average ran from 5.0 to 8.9 around the pages. It reached 8 or more, where other work spoils the timing figures: take them again on a quiet computer.
