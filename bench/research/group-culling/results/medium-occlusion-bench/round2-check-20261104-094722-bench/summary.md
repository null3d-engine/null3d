Benchmark pages: the production build, in a browser without its frame cap.

| Scene | Page | Runs | CPU ms per frame, median (lowest to highest run) | p95 | Busiest thread, ms | Own work, busiest thread | Scene update | All threads | GPU ms | Shadow pixels changed, % | Shadow edge offset, px | Contact gap, px | Flat-surface acne, % | Presented / finished fps | Frame interval p95 / p99 ms | GPU delay ms | Refresh Hz | Upload per frame | Visible entries | Upload per visible entry | Draw calls |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| s1 | null3d-webgpu | 1 | 1.94 (1.94 to 1.94) | 2.09 | sketch-worker 1.94 | n/a | 1.77 | 2.53 | 1.33 | n/a | n/a | n/a | n/a | 503.7 / 503.7 | 2.13 / 2.28 | 2.52 | 48 | 4.80 MB | n/a | n/a | 2 |
| s2 | null3d-webgpu | 1 | 0.11 (0.11 to 0.11) | 0.16 | sketch-worker 0.11 | n/a | 0.00 | 0.14 | 0.13 | n/a | n/a | n/a | n/a | 2595.5 / 2595.5 | 0.70 / 1.78 | 0.59 | 48 | 0.25 MB | n/a | n/a | 101 |
| s3 | null3d-webgpu | 1 | 0.05 (0.05 to 0.05) | 0.09 | sketch-worker 0.05 | n/a | 0.01 | 0.09 | 1.13 | n/a | n/a | n/a | n/a | 871.5 / 871.5 | 2.25 / 2.44 | 2.10 | 48 | 0.02 MB | n/a | n/a | 3 |
| s4 | null3d-webgpu | 1 | 0.17 (0.17 to 0.17) | 0.25 | sketch-worker 0.17 | n/a | 0.00 | 0.30 | 0.57 | n/a | n/a | n/a | n/a | 1236.2 / 1236.2 | 1.18 / 1.46 | 1.46 | 48 | 0.02 MB | n/a | n/a | 94 |
| s5 | null3d-webgpu | 1 | 1.23 (1.23 to 1.23) | 1.45 | sketch-worker 1.23 | n/a | 0.04 | 2.56 | 4.74 | n/a | n/a | n/a | n/a | 291.9 / 291.9 | 4.28 / 4.56 | 6.18 | 48 | 1.62 MB | n/a | n/a | 42 |
| s6 | null3d-webgpu | 1 | 0.18 (0.18 to 0.18) | 0.22 | render-worker 0.18 | n/a | 0.00 | 0.34 | 1.28 | n/a | n/a | n/a | n/a | 625.6 / 625.6 | 2.33 / 3.06 | 2.91 | 48 | 0.03 MB | n/a | n/a | 981 |
| s7 | null3d-webgpu | 1 | 0.02 (0.02 to 0.02) | 0.03 | render-worker 0.02 | n/a | 0.00 | 0.03 | 0.20 | n/a | n/a | n/a | n/a | 2064.3 / 2064.3 | 1.72 / 1.86 | 0.57 | 48 | 0.00 MB | n/a | n/a | 4 |


| Scene | Page | Seconds | Target fps | Seconds at the target | Lowest fps | Lowest render scale | Quality steps |
| --- | --- | --- | --- | --- | --- | --- | --- |
| s4 | null3d-webgpu | 30 | 48 | 30 (100%) | 1045 | 1 | 0 |
| s5 | null3d-webgpu | 30 | 48 | 30 (100%) | 271 | 1 | 0 |
| s6 | null3d-webgpu | 30 | 48 | 30 (100%) | 547 | 1 | 0 |

| Scene | Page | Runs | First frame, ms | Whole scene, ms | Kit file in, s | Tower file in, s | Content, MB |
| --- | --- | --- | --- | --- | --- | --- | --- |
| s6 | null3d-webgpu | 1 | 2673 | 2679 | 1.82 | 1.86 | 54.2 |

The 1-minute load average ran from 4.1 to 5.7 around the pages.
