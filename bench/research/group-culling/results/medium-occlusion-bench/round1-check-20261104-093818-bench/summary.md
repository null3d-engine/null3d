Benchmark pages: the production build, in a browser without its frame cap.

| Scene | Page | Runs | CPU ms per frame, median (lowest to highest run) | p95 | Busiest thread, ms | Own work, busiest thread | Scene update | All threads | GPU ms | Shadow pixels changed, % | Shadow edge offset, px | Contact gap, px | Flat-surface acne, % | Presented / finished fps | Frame interval p95 / p99 ms | GPU delay ms | Refresh Hz | Upload per frame | Visible entries | Upload per visible entry | Draw calls |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| s1 | null3d-webgpu | 1 | 2.20 (2.20 to 2.20) | 2.59 | sketch-worker 2.20 | n/a | 1.99 | 2.89 | 1.35 | n/a | n/a | n/a | n/a | 455.3 / 455.2 | 2.64 / 2.89 | 2.49 | 48 | 4.80 MB | n/a | n/a | 2 |
| s2 | null3d-webgpu | 1 | 0.11 (0.11 to 0.11) | 0.17 | sketch-worker 0.11 | n/a | 0.00 | 0.15 | 0.15 | n/a | n/a | n/a | n/a | 2463.0 / 2462.9 | 0.75 / 1.78 | 0.63 | 48 | 0.25 MB | n/a | n/a | 101 |
| s3 | null3d-webgpu | 1 | 0.03 (0.03 to 0.03) | 0.05 | sketch-worker 0.03 | n/a | 0.01 | 0.06 | 1.30 | n/a | n/a | n/a | n/a | 874.6 / 874.6 | 2.03 / 2.16 | 2.03 | 48 | 0.02 MB | n/a | n/a | 3 |
| s4 | null3d-webgpu | 1 | 0.18 (0.18 to 0.18) | 0.24 | sketch-worker 0.18 | n/a | 0.00 | 0.31 | 0.58 | n/a | n/a | n/a | n/a | 1175.2 / 1175.2 | 1.24 / 1.46 | 1.54 | 48 | 0.02 MB | n/a | n/a | 94 |
| s5 | null3d-webgpu | 1 | 1.28 (1.28 to 1.28) | 1.47 | sketch-worker 1.28 | n/a | 0.04 | 2.75 | 4.72 | n/a | n/a | n/a | n/a | 286.2 / 286.2 | 4.47 / 4.66 | 6.22 | 48 | 1.62 MB | n/a | n/a | 42 |
| s6 | null3d-webgpu | 1 | 0.19 (0.19 to 0.19) | 0.24 | render-worker 0.19 | n/a | 0.00 | 0.35 | 1.27 | n/a | n/a | n/a | n/a | 603.5 / 603.5 | 2.38 / 3.15 | 3.00 | 48 | 0.03 MB | n/a | n/a | 981 |
| s7 | null3d-webgpu | 1 | 0.02 (0.02 to 0.02) | 0.03 | render-worker 0.02 | n/a | 0.00 | 0.03 | 0.20 | n/a | n/a | n/a | n/a | 2248.2 / 2248.2 | 1.70 / 1.84 | 0.56 | 48 | 0.00 MB | n/a | n/a | 4 |


| Scene | Page | Seconds | Target fps | Seconds at the target | Lowest fps | Lowest render scale | Quality steps |
| --- | --- | --- | --- | --- | --- | --- | --- |
| s4 | null3d-webgpu | 30 | 48 | 30 (100%) | 1091 | 1 | 0 |
| s5 | null3d-webgpu | 30 | 48 | 30 (100%) | 252 | 1 | 0 |
| s6 | null3d-webgpu | 30 | 48 | 30 (100%) | 536 | 1 | 0 |

| Scene | Page | Runs | First frame, ms | Whole scene, ms | Kit file in, s | Tower file in, s | Content, MB |
| --- | --- | --- | --- | --- | --- | --- | --- |
| s6 | null3d-webgpu | 1 | 2895 | 2910 | 2.02 | 2.08 | 54.2 |

The 1-minute load average ran from 5.1 to 6.2 around the pages.
