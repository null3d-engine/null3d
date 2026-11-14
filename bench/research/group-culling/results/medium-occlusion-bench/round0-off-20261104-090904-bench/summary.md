Benchmark pages: the production build, in a browser without its frame cap.

| Scene | Page | Runs | CPU ms per frame, median (lowest to highest run) | p95 | Busiest thread, ms | Own work, busiest thread | Scene update | All threads | GPU ms | Shadow pixels changed, % | Shadow edge offset, px | Contact gap, px | Flat-surface acne, % | Presented / finished fps | Frame interval p95 / p99 ms | GPU delay ms | Refresh Hz | Upload per frame | Visible entries | Upload per visible entry | Draw calls |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| s1 | null3d-webgpu | 1 | 1.65 (1.65 to 1.65) | 1.78 | sketch-worker 1.65 | n/a | 1.50 | 2.18 | 1.20 | n/a | n/a | n/a | n/a | 584.7 / 584.7 | 1.83 / 2.12 | 2.16 | 48 | 4.80 MB | n/a | n/a | 2 |
| s2 | null3d-webgpu | 1 | 0.08 (0.08 to 0.08) | 0.09 | sketch-worker 0.08 | n/a | 0.00 | 0.11 | 0.15 | n/a | n/a | n/a | n/a | 1988.9 / 1988.9 | 1.75 / 1.83 | 0.55 | 48 | 0.25 MB | n/a | n/a | 101 |
| s3 | null3d-webgpu | 1 | 0.03 (0.03 to 0.03) | 0.06 | sketch-worker 0.03 | n/a | 0.00 | 0.05 | 0.80 | n/a | n/a | n/a | n/a | 1060.5 / 1060.5 | 1.92 / 2.09 | 1.77 | 48 | 0.02 MB | n/a | n/a | 3 |
| s4 | null3d-webgpu | 1 | 0.10 (0.10 to 0.10) | 0.13 | sketch-worker 0.10 | n/a | 0.00 | 0.18 | 0.48 | n/a | n/a | n/a | n/a | 1695.6 / 1695.6 | 0.94 / 1.90 | 1.07 | 50 | 0.02 MB | n/a | n/a | 94 |
| s5 | null3d-webgpu | 1 | 1.13 (1.13 to 1.13) | 1.41 | sketch-worker 1.13 | n/a | 0.04 | 2.45 | 3.32 | n/a | n/a | n/a | n/a | 370.3 / 370.3 | 3.28 / 3.88 | 4.70 | 48 | 1.62 MB | n/a | n/a | 42 |
| s6 | null3d-webgpu | 1 | 0.17 (0.17 to 0.17) | 0.25 | render-worker 0.17 | n/a | 0.00 | 0.33 | 1.22 | n/a | n/a | n/a | n/a | 639.2 / 639.2 | 2.38 / 3.29 | 2.84 | 48 | 0.03 MB | n/a | n/a | 981 |
| s7 | null3d-webgpu | 1 | 0.02 (0.02 to 0.02) | 0.04 | render-worker 0.02 | n/a | 0.00 | 0.03 | 0.53 | n/a | n/a | n/a | n/a | 1292.3 / 1292.3 | 1.85 / 2.03 | 1.68 | 48 | 0.00 MB | n/a | n/a | 4 |


| Scene | Page | Seconds | Target fps | Seconds at the target | Lowest fps | Lowest render scale | Quality steps |
| --- | --- | --- | --- | --- | --- | --- | --- |
| s4 | null3d-webgpu | 30 | 50 | 30 (100%) | 1594 | 1 | 0 |
| s5 | null3d-webgpu | 30 | 48 | 30 (100%) | 350 | 1 | 0 |
| s6 | null3d-webgpu | 30 | 48 | 30 (100%) | 547 | 1 | 0 |

| Scene | Page | Runs | First frame, ms | Whole scene, ms | Kit file in, s | Tower file in, s | Content, MB |
| --- | --- | --- | --- | --- | --- | --- | --- |
| s6 | null3d-webgpu | 1 | 3097 | 3111 | 2.06 | 2.13 | 54.2 |

The 1-minute load average ran from 3.7 to 5.7 around the pages.
