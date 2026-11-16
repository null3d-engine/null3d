Benchmark pages: the production build, in a browser without its frame cap.

| Scene | Page | Runs | CPU ms per frame, median (lowest to highest run) | p95 | Busiest thread, ms | Own work, busiest thread | Scene update | All threads | GPU ms | Shadow pixels changed, % | Shadow edge offset, px | Contact gap, px | Flat-surface acne, % | Presented / finished fps | Frame interval p95 / p99 ms | GPU delay ms | Refresh Hz | Upload per frame | Visible entries | Upload per visible entry | Draw calls |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| s1 | null3d-webgpu | 1 | 1.79 (1.79 to 1.79) | 2.02 | sketch-worker 1.79 | n/a | 1.63 | 2.34 | 1.32 | n/a | n/a | n/a | n/a | 532.7 / 532.7 | 2.06 / 2.17 | 2.30 | 48 | 4.80 MB | n/a | n/a | 2 |
| s2 | null3d-webgpu | 1 | 0.11 (0.11 to 0.11) | 0.18 | sketch-worker 0.11 | n/a | 0.00 | 0.15 | 0.15 | n/a | n/a | n/a | n/a | 2348.7 / 2348.7 | 1.63 / 1.79 | 0.64 | 48 | 0.25 MB | n/a | n/a | 101 |
| s3 | null3d-webgpu | 1 | 0.03 (0.03 to 0.03) | 0.05 | sketch-worker 0.03 | n/a | 0.01 | 0.06 | 1.24 | n/a | n/a | n/a | n/a | 901.0 / 901.0 | 1.96 / 2.07 | 1.97 | 50 | 0.02 MB | n/a | n/a | 3 |
| s4 | null3d-webgpu | 1 | 0.17 (0.17 to 0.17) | 0.25 | sketch-worker 0.17 | n/a | 0.00 | 0.30 | 0.56 | n/a | n/a | n/a | n/a | 1222.2 / 1222.2 | 1.21 / 1.47 | 1.49 | 48 | 0.02 MB | n/a | n/a | 94 |
| s5 | null3d-webgpu | 1 | 1.19 (1.19 to 1.19) | 1.38 | sketch-worker 1.19 | n/a | 0.04 | 2.40 | 4.92 | n/a | n/a | n/a | n/a | 287.1 / 287.1 | 4.20 / 4.31 | 6.20 | 50 | 1.62 MB | n/a | n/a | 42 |
| s6 | null3d-webgpu | 1 | 0.18 (0.18 to 0.18) | 0.28 | render-worker 0.18 | n/a | 0.00 | 0.34 | 1.32 | n/a | n/a | n/a | n/a | 586.1 / 586.2 | 2.61 / 3.44 | 3.10 | 48 | 0.03 MB | n/a | n/a | 981 |
| s7 | null3d-webgpu | 1 | 0.02 (0.02 to 0.02) | 0.03 | render-worker 0.02 | n/a | 0.00 | 0.02 | 0.53 | n/a | n/a | n/a | n/a | 1323.7 / 1323.7 | 1.81 / 1.88 | 1.67 | 48 | 0.00 MB | n/a | n/a | 4 |


| Scene | Page | Seconds | Target fps | Seconds at the target | Lowest fps | Lowest render scale | Quality steps |
| --- | --- | --- | --- | --- | --- | --- | --- |
| s4 | null3d-webgpu | 30 | 48 | 30 (100%) | 917 | 1 | 0 |
| s5 | null3d-webgpu | 30 | 50 | 30 (100%) | 269 | 1 | 0 |
| s6 | null3d-webgpu | 30 | 48 | 30 (100%) | 453 | 1 | 0 |

| Scene | Page | Runs | First frame, ms | Whole scene, ms | Kit file in, s | Tower file in, s | Content, MB |
| --- | --- | --- | --- | --- | --- | --- | --- |
| s6 | null3d-webgpu | 1 | 2945 | 2963 | 2.03 | 2.07 | 54.2 |

The 1-minute load average ran from 5.0 to 8.1 around the pages. It reached 8 or more, where other work spoils the timing figures: take them again on a quiet computer.
