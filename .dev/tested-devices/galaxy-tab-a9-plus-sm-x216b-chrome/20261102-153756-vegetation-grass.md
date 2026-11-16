Plans: vegetation-grass 2026-11-02. The branch is `feat/m3-v8-gpu-grass` at `70a124e6d`, from `landing/range-7` at `a344b83d7`, whose pages the dev server in `/Users/ram/dev/null3d-grass` served. BrowserStack Automate served the pages over HTTPS through BrowserStack Local, in Chrome 152 on the Samsung Galaxy Tab A9 Plus, Android 14.0.

Result: 8 passed, 0 skipped, 0 failed. The runner restarted the compatibility-mode Medium page once, after Chrome's local network prompt held its requests, and that page then passed.

The plan runs `vegetation-grass` at each preset and GPU path that the tier offers. The page draws the hill of 20,000 tufts at the High count, a preset's share of them, on a canvas of 960 by 540 drawing pixels at one pixel per CSS pixel. On WebGPU and compatibility mode a compute pass builds the blade list and writes its count; on WebGL2 an instance batch draws the rows. The page measures five seconds after a three-second warm-up. Its sun does not cast shadows, so no shadow pass runs and these rows do not hold the near shadows' cost.

| GPU path | Preset | Tufts drawn | Frames | GPU median (ms) | GPU p95 (ms) | GPU p99 (ms) | CPU median (ms) | Draw calls |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| WebGPU | Low | 7,000 | 55 | 66.91 | 92.71 | 93.83 | 1.78 | 3 |
| WebGPU | Medium | 12,000 | 27 | 171.31 | 173.85 | 174.07 | 1.68 | 4 |
| WebGPU | High | 20,000 | 21 | 292.29 | 292.76 | 292.80 | 2.36 | 11 |
| WebGPU | Ultra | 25,000 | 13 | 344.49 | 345.17 | 345.23 | 2.19 | 11 |
| compatibility | Low | 7,000 | 76 | 64.36 | 94.84 | 95.67 | 1.77 | 3 |
| compatibility | Medium | 12,000 | 33 | 156.30 | 176.53 | 178.33 | 1.78 | 3 |
| WebGL2 | Low | 7,000 | 81 | no timer | no timer | no timer | 2.65 | 93 |
| WebGL2 | Medium | 12,000 | 33 | no timer | no timer | no timer | 3.52 | 26 |

The WebGPU times come from the GPU's timer, over two samples at High and at Ultra, so their spread is thin. At High the passes read 0.00 ms of copies, 0.46 of compute, the wind add-on's field and the blade list together, 0.85 of feature-row conversion, 17.66 of prepass, 0.43, 0.56 and 271.61 of ambient occlusion, where the frame's tail is folded. The Android Chrome gives no WebGL2 GPU timer, so those rows give the CPU time of the busiest thread and the frames drawn.

The High row, 292.29 ms, and the Ultra row, 344.49 ms, have no D-241 ceiling for this tablet, which
sets a row at Low and Medium only; the 208.3 and 499.8 beside them are the S24 class's, and these rows
were measured against them as targets. Its Medium row, 171.31 ms, is inside the 1,820.8 ms ceiling,
and its Low rows, 66.91 and 64.36 ms, are inside 1,268.5. The hill has no per-tile view cull or distance bands, so the High page draws every tuft in the preset's share.
