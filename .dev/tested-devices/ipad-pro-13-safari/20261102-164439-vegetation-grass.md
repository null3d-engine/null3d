Plans: vegetation-grass 2026-11-02. The branch is `feat/m3-v8-gpu-grass` at `8f69e5146`, from `landing/range-7` at a344b83d7, whose pages the dev server in `/Users/ram/dev/null3d-grass` served. BrowserStack Automate served the pages over HTTPS through BrowserStack Local, in Safari 26.6.1 on iOS 26.

Result: 8 passed, 0 skipped, 0 failed.

The plan runs `vegetation-grass` at each preset and GPU path that the tier offers. The page draws the hill of 20,000 tufts at the High count, a preset's share of them, on a canvas of 960 by 540 drawing pixels at one pixel per CSS pixel. This is the **stress hill**: 17.3 tufts on each square meter over 34 by 34 meters, which is 3 to 8 times Creek's density, so these rows hold no ceiling. The page culls each 4 meter tile against the camera's view, thins the far tufts and widens their blades so the cover holds. Its sun casts, so the rows hold the near shadow pass, and it warms for 8 seconds before the 5 second measure.

| GPU path | Preset | Tufts drawn | Frames | GPU median (ms) | GPU p95 (ms) | GPU p99 (ms) | CPU median (ms) | Draw calls |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| WebGPU | Low | 7,000 | 341 | 5.78 | 6.40 | 6.70 | 0.32 | 5 |
| WebGPU | Medium | 12,000 | 374 | 7.24 | 7.82 | 7.91 | 0.30 | 6 |
| WebGPU | High | 20,000 | 559 | 12.16 | 12.54 | 12.76 | 0.14 | 14 |
| WebGPU | Ultra | 25,000 | 331 | 15.19 | 15.47 | 15.57 | 0.16 | 15 |
| compatibility | Low | 7,000 | 333 | 3.96 | 6.16 | 6.85 | 0.34 | 5 |
| compatibility | Medium | 12,000 | 418 | 8.50 | 9.20 | 9.76 | 0.36 | 6 |
| WebGL2 | Low | 7,000 | 373 | no timer | no timer | no timer | 3.36 | 29 |
| WebGL2 | Medium | 12,000 | 583 | no timer | no timer | no timer | 1.86 | 14 |

The WebGPU times come from the GPU's timer. At High the passes read 0.02 ms of copies, 0.10 of compute, the wind add-on's field and the blade list together, no feature-row time, 0.26, 0.38 and 0.26 of the three shadow cascades, and 11.27 of prepass, where the frame's tail is folded. At Ultra the fourth cascade takes 13.68 ms. Safari gives no WebGL2 GPU timer, so those rows give the CPU time of the busiest thread and the frames drawn.
