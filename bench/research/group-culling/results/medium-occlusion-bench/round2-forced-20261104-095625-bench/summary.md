Benchmark pages: the production build, in a browser without its frame cap.

| Scene | Page | Runs | CPU ms per frame, median (lowest to highest run) | p95 | Busiest thread, ms | Own work, busiest thread | Scene update | All threads | GPU ms | Shadow pixels changed, % | Shadow edge offset, px | Contact gap, px | Flat-surface acne, % | Presented / finished fps | Frame interval p95 / p99 ms | GPU delay ms | Refresh Hz | Upload per frame | Visible entries | Upload per visible entry | Draw calls |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| s1 | null3d-webgpu | 1 | 1.93 (1.93 to 1.93) | 1.99 | sketch-worker 1.93 | n/a | 1.75 | 2.55 | 1.36 | n/a | n/a | n/a | n/a | 512.2 / 512.2 | 2.07 / 2.13 | 2.51 | 48 | 4.80 MB | n/a | n/a | 2 |
| s2 | null3d-webgpu | 1 | 0.09 (0.09 to 0.09) | 0.11 | sketch-worker 0.09 | n/a | 0.00 | 0.12 | 0.15 | n/a | n/a | n/a | n/a | 2251.0 / 2251.0 | 1.78 / 1.87 | 0.57 | 48 | 0.25 MB | n/a | n/a | 101 |
| s3 | null3d-webgpu | 1 | 0.03 (0.03 to 0.03) | 0.05 | sketch-worker 0.03 | n/a | 0.01 | 0.06 | 1.34 | n/a | n/a | n/a | n/a | 872.0 / 872.0 | 2.07 / 2.18 | 2.07 | 50 | 0.02 MB | n/a | n/a | 5 |
| s4 | null3d-webgpu | 1 | 0.16 (0.16 to 0.16) | 0.17 | sketch-worker 0.16 | n/a | 0.00 | 0.29 | 0.62 | n/a | n/a | n/a | n/a | 1206.4 / 1206.4 | 1.20 / 1.32 | 1.52 | 50 | 0.02 MB | n/a | n/a | 112 |
| s5 | null3d-webgpu | 1 | 1.10 (1.10 to 1.10) | 1.35 | sketch-worker 1.10 | n/a | 0.04 | 2.25 | 4.98 | n/a | n/a | n/a | n/a | 288.6 / 288.6 | 4.22 / 4.37 | 6.20 | 48 | 1.62 MB | n/a | n/a | 45 |
| s6 | null3d-webgpu | 1 | 0.19 (0.19 to 0.19) | 0.22 | render-worker 0.19 | n/a | 0.00 | 0.34 | 1.22 | n/a | n/a | n/a | n/a | 621.0 / 621.0 | 2.18 / 2.62 | 2.97 | 50 | 0.03 MB | n/a | n/a | 1134 |
| s7 | null3d-webgpu | 1 | 0.02 (0.02 to 0.02) | 0.03 | render-worker 0.02 | n/a | 0.00 | 0.03 | 0.27 | n/a | n/a | n/a | n/a | 2565.5 / 2565.4 | 0.59 / 1.70 | 0.69 | 50 | 0.00 MB | n/a | n/a | 5 |


| Scene | Page | Seconds | Target fps | Seconds at the target | Lowest fps | Lowest render scale | Quality steps |
| --- | --- | --- | --- | --- | --- | --- | --- |
| s4 | null3d-webgpu | 30 | 50 | 30 (100%) | 1155 | 1 | 0 |
| s5 | null3d-webgpu | 30 | 48 | 30 (100%) | 276 | 1 | 0 |
| s6 | null3d-webgpu | 30 | 50 | 30 (100%) | 571 | 1 | 0 |

| Scene | Page | Runs | First frame, ms | Whole scene, ms | Kit file in, s | Tower file in, s | Content, MB |
| --- | --- | --- | --- | --- | --- | --- | --- |
| s6 | null3d-webgpu | 1 | 2680 | 2686 | 1.85 | 1.88 | 54.2 |

The 1-minute load average ran from 4.4 to 6.2 around the pages.
