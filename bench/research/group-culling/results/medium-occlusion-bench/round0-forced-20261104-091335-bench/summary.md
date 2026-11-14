Benchmark pages: the production build, in a browser without its frame cap.

| Scene | Page | Runs | CPU ms per frame, median (lowest to highest run) | p95 | Busiest thread, ms | Own work, busiest thread | Scene update | All threads | GPU ms | Shadow pixels changed, % | Shadow edge offset, px | Contact gap, px | Flat-surface acne, % | Presented / finished fps | Frame interval p95 / p99 ms | GPU delay ms | Refresh Hz | Upload per frame | Visible entries | Upload per visible entry | Draw calls |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| s1 | null3d-webgpu | 1 | 2.69 (2.69 to 2.69) | 3.59 | sketch-worker 2.69 | n/a | 2.41 | 3.69 | 1.80 | n/a | n/a | n/a | n/a | 346.9 / 346.9 | 3.67 / 5.17 | 3.07 | 48 | 4.80 MB | n/a | n/a | 2 |
| s2 | null3d-webgpu | 1 | 0.11 (0.11 to 0.11) | 0.15 | sketch-worker 0.11 | n/a | 0.00 | 0.16 | 0.26 | n/a | n/a | n/a | n/a | 2379.6 / 2379.6 | 0.61 / 1.69 | 0.73 | 48 | 0.25 MB | n/a | n/a | 101 |
| s3 | null3d-webgpu | 1 | 0.19 (0.19 to 0.19) | 0.25 | sketch-worker 0.18 | n/a | 0.03 | 0.34 | 1.15 | n/a | n/a | n/a | n/a | 656.1 / 656.1 | 2.74 / 3.45 | 2.66 | 48 | 0.02 MB | n/a | n/a | 5 |
| s4 | null3d-webgpu | 1 | 0.33 (0.33 to 0.33) | 0.68 | sketch-worker 0.32 | n/a | 0.02 | 0.63 | 1.02 | n/a | n/a | n/a | n/a | 483.8 / 483.8 | 4.93 / 8.99 | 3.07 | 48 | 0.02 MB | n/a | n/a | 112 |
| s5 | null3d-webgpu | 1 | 2.47 (2.47 to 2.47) | 2.98 | sketch-worker 2.47 | n/a | 0.10 | 4.99 | 4.38 | n/a | n/a | n/a | n/a | 233.3 / 233.3 | 5.63 / 6.46 | 6.90 | 48 | 1.62 MB | n/a | n/a | 45 |
| s6 | null3d-webgpu | 1 | 0.25 (0.25 to 0.25) | 0.41 | render-worker 0.25 | n/a | 0.01 | 0.49 | 1.37 | n/a | n/a | n/a | n/a | 470.5 / 470.5 | 3.06 / 3.98 | 3.88 | 48 | 0.03 MB | n/a | n/a | 1134 |
| s7 | null3d-webgpu | 1 | 0.05 (0.05 to 0.05) | 0.14 | render-worker 0.04 | n/a | 0.00 | 0.07 | 0.37 | n/a | n/a | n/a | n/a | 1536.9 / 1536.9 | 1.26 / 1.99 | 1.04 | 48 | 0.00 MB | n/a | n/a | 5 |


| Scene | Page | Seconds | Target fps | Seconds at the target | Lowest fps | Lowest render scale | Quality steps |
| --- | --- | --- | --- | --- | --- | --- | --- |
| s4 | null3d-webgpu | 30 | 48 | 30 (100%) | 289 | 1 | 0 |
| s5 | null3d-webgpu | 30 | 48 | 30 (100%) | 178 | 1 | 0 |
| s6 | null3d-webgpu | 30 | 48 | 30 (100%) | 352 | 1 | 0 |

| Scene | Page | Runs | First frame, ms | Whole scene, ms | Kit file in, s | Tower file in, s | Content, MB |
| --- | --- | --- | --- | --- | --- | --- | --- |
| s6 | null3d-webgpu | 1 | 3193 | 3215 | 2.17 | 2.21 | 54.2 |

The 1-minute load average ran from 5.4 to 17.2 around the pages. It reached 8 or more, where other work spoils the timing figures: take them again on a quiet computer.
