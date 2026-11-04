Benchmark pages: the production build, in a browser without its frame cap.

| Scene | Page | Runs | CPU ms per frame, median (lowest to highest run) | p95 | Busiest thread, ms | Own work, busiest thread | Scene update | All threads | GPU ms | Shadow pixels changed, % | Shadow edge offset, px | Contact gap, px | Flat-surface acne, % | Presented / finished fps | Frame interval p95 / p99 ms | GPU delay ms | Refresh Hz | Upload per frame | Visible entries | Upload per visible entry | Draw calls |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| s1 | null3d-webgpu | 1 | 1.93 (1.93 to 1.93) | 2.04 | sketch-worker 1.93 | n/a | 1.76 | 2.52 | 1.33 | n/a | n/a | n/a | n/a | 515.4 / 515.4 | 2.08 / 2.31 | 2.50 | 48 | 4.80 MB | n/a | n/a | 2 |
| s2 | null3d-webgpu | 1 | 0.10 (0.10 to 0.10) | 0.16 | sketch-worker 0.10 | n/a | 0.00 | 0.13 | 0.15 | n/a | n/a | n/a | n/a | 2247.5 / 2247.5 | 1.73 / 1.82 | 0.61 | 48 | 0.25 MB | n/a | n/a | 101 |
| s3 | null3d-webgpu | 1 | 0.03 (0.03 to 0.03) | 0.05 | sketch-worker 0.03 | n/a | 0.01 | 0.06 | 1.29 | n/a | n/a | n/a | n/a | 891.6 / 891.6 | 1.98 / 2.12 | 1.99 | 48 | 0.02 MB | n/a | n/a | 3 |
| s4 | null3d-webgpu | 1 | 0.18 (0.18 to 0.18) | 0.25 | sketch-worker 0.18 | n/a | 0.00 | 0.31 | 0.57 | n/a | n/a | n/a | n/a | 1194.3 / 1194.3 | 1.24 / 1.53 | 1.51 | 48 | 0.02 MB | n/a | n/a | 94 |
| s5 | null3d-webgpu | 1 | 1.32 (1.32 to 1.32) | 1.51 | sketch-worker 1.32 | n/a | 0.05 | 2.72 | 4.63 | n/a | n/a | n/a | n/a | 288.4 / 288.4 | 4.41 / 4.69 | 6.11 | 48 | 1.62 MB | n/a | n/a | 42 |
| s6 | null3d-webgpu | 1 | 0.22 (0.22 to 0.22) | 0.35 | render-worker 0.21 | n/a | 0.01 | 0.43 | 1.24 | n/a | n/a | n/a | n/a | 529.0 / 529.0 | 2.66 / 3.71 | 3.42 | 48 | 0.03 MB | n/a | n/a | 981 |
| s7 | null3d-webgpu | 1 | 0.02 (0.02 to 0.02) | 0.03 | render-worker 0.02 | n/a | 0.00 | 0.03 | 0.54 | n/a | n/a | n/a | n/a | 1169.6 / 1169.6 | 1.83 / 1.91 | 1.71 | 48 | 0.00 MB | n/a | n/a | 4 |


| Scene | Page | Seconds | Target fps | Seconds at the target | Lowest fps | Lowest render scale | Quality steps |
| --- | --- | --- | --- | --- | --- | --- | --- |
| s4 | null3d-webgpu | 30 | 48 | 30 (100%) | 919 | 1 | 0 |
| s5 | null3d-webgpu | 30 | 48 | 30 (100%) | 265 | 1 | 0 |
| s6 | null3d-webgpu | 30 | 48 | 30 (100%) | 377 | 1 | 0 |

| Scene | Page | Runs | First frame, ms | Whole scene, ms | Kit file in, s | Tower file in, s | Content, MB |
| --- | --- | --- | --- | --- | --- | --- | --- |
| s6 | null3d-webgpu | 1 | 3007 | 3028 | 2.02 | 2.06 | 54.2 |

The 1-minute load average ran from 3.7 to 5.4 around the pages.
