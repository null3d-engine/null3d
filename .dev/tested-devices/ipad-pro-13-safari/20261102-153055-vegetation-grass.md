Plans: vegetation-grass 2026-11-02. The branch is `feat/m3-v8-gpu-grass` at `70a124e6d`, from `landing/range-7` at `a344b83d7`, whose pages the dev server in `/Users/ram/dev/null3d-grass` served. BrowserStack Automate served the pages over HTTPS through BrowserStack Local, in Safari 26.6.1 on iOS 26.

Result: 8 passed, 0 skipped, 0 failed.

The plan runs `vegetation-grass` at each preset and GPU path that the tier offers. The page draws the hill of 20,000 tufts at the High count, a preset's share of them, on a canvas of 960 by 540 drawing pixels at one pixel per CSS pixel. On WebGPU and compatibility mode a compute pass builds the blade list and writes its count; on WebGL2 an instance batch draws the rows. The page measures five seconds after a three-second warm-up. Its sun does not cast shadows, so no shadow pass runs and these rows do not hold the near shadows' cost.

| GPU path | Preset | Tufts drawn | Frames | GPU median (ms) | GPU p95 (ms) | GPU p99 (ms) | CPU median (ms) | Draw calls |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| WebGPU | Low | 7,000 | 332 | 5.68 | 5.98 | 6.04 | 0.32 | 3 |
| WebGPU | Medium | 12,000 | 308 | 5.42 | 6.57 | 7.74 | 0.34 | 3 |
| WebGPU | High | 20,000 | 317 | 6.81 | 7.24 | 7.38 | 0.34 | 11 |
| WebGPU | Ultra | 25,000 | 375 | 7.45 | 8.29 | 8.35 | 0.36 | 11 |
| compatibility | Low | 7,000 | 397 | 2.86 | 5.22 | 5.60 | 0.34 | 3 |
| compatibility | Medium | 12,000 | 368 | 5.91 | 7.63 | 7.85 | 0.38 | 3 |
| WebGL2 | Low | 7,000 | 309 | no timer | no timer | no timer | 3.20 | 27 |
| WebGL2 | Medium | 12,000 | 310 | no timer | no timer | no timer | 1.56 | 11 |

The WebGPU times come from the GPU's timer. At High the passes read 0.03 ms of copies, 0.07 of compute, the wind add-on's field and the blade list together, 0.01 of feature-row conversion, 0.79 of prepass, 0.42, 0.44 and 6.05 of ambient occlusion, where the frame's tail is folded. Safari gives no WebGL2 GPU timer, so those rows give the CPU time of the busiest thread and the frames drawn; their two figures disagree in direction because the machine's own work varies.

The High row, 6.81 ms, is inside the add-on's 49.0 ms figure on the Apple devices with a wide margin. Its Ultra row is 7.45 ms.
