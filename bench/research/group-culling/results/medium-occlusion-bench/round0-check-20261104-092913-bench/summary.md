Benchmark pages: the production build, in a browser without its frame cap.

| Scene | Page | Runs | CPU ms per frame, median (lowest to highest run) | p95 | Busiest thread, ms | Own work, busiest thread | Scene update | All threads | GPU ms | Shadow pixels changed, % | Shadow edge offset, px | Contact gap, px | Flat-surface acne, % | Presented / finished fps | Frame interval p95 / p99 ms | GPU delay ms | Refresh Hz | Upload per frame | Visible entries | Upload per visible entry | Draw calls |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| s1 | null3d-webgpu | 1 | 1.64 (1.64 to 1.64) | 1.77 | sketch-worker 1.64 | n/a | 1.49 | 2.20 | 1.15 | n/a | n/a | n/a | n/a | 587.8 / 587.8 | 1.87 / 2.11 | 2.16 | 48 | 4.80 MB | n/a | n/a | 2 |
| s2 | null3d-webgpu | 1 | 0.08 (0.08 to 0.08) | 0.09 | sketch-worker 0.08 | n/a | 0.00 | 0.11 | 0.13 | n/a | n/a | n/a | n/a | 2077.9 / 2077.8 | 1.75 / 1.85 | 0.53 | 48 | 0.25 MB | n/a | n/a | 101 |
| s3 | null3d-webgpu | 1 | 0.03 (0.03 to 0.03) | 0.05 | sketch-worker 0.03 | n/a | 0.00 | 0.05 | 0.82 | n/a | n/a | n/a | n/a | 1064.3 / 1064.3 | 1.92 / 2.03 | 1.77 | 48 | 0.02 MB | n/a | n/a | 3 |
| s4 | null3d-webgpu | 1 | 0.10 (0.10 to 0.10) | 0.16 | sketch-worker 0.10 | n/a | 0.00 | 0.18 | 0.47 | n/a | n/a | n/a | n/a | 1659.9 / 1659.9 | 0.95 / 1.84 | 1.10 | 48 | 0.02 MB | n/a | n/a | 94 |
| s5 | null3d-webgpu | 1 | 0.88 (0.88 to 0.88) | 1.06 | sketch-worker 0.88 | n/a | 0.03 | 1.80 | 3.59 | n/a | n/a | n/a | n/a | 384.6 / 384.6 | 3.66 / 3.79 | 4.51 | 48 | 1.62 MB | n/a | n/a | 42 |
| s6 | null3d-webgpu | 1 | 0.17 (0.17 to 0.17) | 0.22 | render-worker 0.17 | n/a | 0.00 | 0.32 | 1.21 | n/a | n/a | n/a | n/a | 650.9 / 650.9 | 2.34 / 3.13 | 2.84 | 48 | 0.03 MB | n/a | n/a | 981 |
| s7 | null3d-webgpu | 1 | 0.03 (0.03 to 0.03) | 0.08 | render-worker 0.03 | n/a | 0.00 | 0.05 | 0.26 | n/a | n/a | n/a | n/a | 1985.2 / 1985.2 | 1.22 / 1.96 | 0.80 | 48 | 0.00 MB | n/a | n/a | 4 |


| Scene | Page | Seconds | Target fps | Seconds at the target | Lowest fps | Lowest render scale | Quality steps |
| --- | --- | --- | --- | --- | --- | --- | --- |
| s4 | null3d-webgpu | 30 | 48 | 30 (100%) | 1439 | 1 | 0 |
| s5 | null3d-webgpu | 30 | 48 | 30 (100%) | 365 | 1 | 0 |
| s6 | null3d-webgpu | 30 | 48 | 30 (100%) | 581 | 1 | 0 |

| Scene | Page | Runs | First frame, ms | Whole scene, ms | Kit file in, s | Tower file in, s | Content, MB |
| --- | --- | --- | --- | --- | --- | --- | --- |
| s6 | null3d-webgpu | 1 | 2845 | 2862 | 2.06 | 2.11 | 54.2 |

The 1-minute load average ran from 4.9 to 6.4 around the pages.
