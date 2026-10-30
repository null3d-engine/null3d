Plans: vegetation-wind 2026-10-30, the page `vegetation-cost` at every preset and GPU path. The branch is `feat/m3-v7-leaf-bark-r2` at `70a0e583d`, whose dev server in `/Users/ram/dev/null3d-v7` served on port 5283. The page is `tests/pages/vegetation-cost.html` with `?gpu=<path>&preset=<preset>&seconds=5&target-fps=1`: the target rate is one, so the governor holds the whole render scale and each preset's own cost shows. The browser was the installed Chrome 156 on this Mac's Apple M3 Max, at macOS 26.2, in a 1280 by 720 window at a device pixel ratio of 1. The run started at 16:59:13 and took 96 seconds.

Result: 10 readings, all passing. The frame reads 6.29 to 7.44 ms on WebGPU, 6.46 and 8.22 at Low and Medium on compatibility, and 11.48 and 15.40 on WebGL2. Compatibility mode and WebGL2 cap the preset at Medium, so their High and Ultra pages draw Medium's settings.

The machine was shared with other sessions and the load sat between 4 and 7 through the run, so these are not quiet-window figures. A row that differs from its neighbour by less than about a millisecond sits inside the run's variation.

| GPU path | Preset asked | Preset drawn | GPU time (ms) | p95 (ms) | Shadow cascades (ms) | Ambient occlusion (ms) | Draw calls | CPU (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| WebGPU | Low | Low | 6.29 | 7.42 | 3.21 | 0 | 26 | 0.20 |
| WebGPU | Medium | Medium | 7.37 | 10.28 | 2.82 | 0 | 26 | 0.17 |
| WebGPU | High | High | 7.44 | 8.96 | 2.39 | 10.55 | 38 | 0.17 |
| WebGPU | Ultra | Ultra | 6.55 | 7.70 | 2.13 | 6.39 | 42 | 0.19 |
| compatibility | Low | Low | 6.46 | 7.78 | 3.28 | 0 | 26 | 0.20 |
| compatibility | Medium | Medium | 8.22 | 9.68 | 2.88 | 0 | 25 | 0.16 |
| compatibility | High | Medium | 7.44 | 10.27 | 2.59 | 0 | 25 | 0.16 |
| compatibility | Ultra | Medium | 7.83 | 10.33 | 2.75 | 0 | 25 | 0.16 |
| WebGL2 | Low | Low | 11.48 | 18.63 | - | - | 53 | 0.19 |
| WebGL2 | Medium | Medium | 15.40 | 16.21 | - | - | 56 | 0.20 |

Compatibility mode and WebGL2 cap the preset at Medium, so their High and Ultra pages draw Medium again and are named for the preset they draw.

## What the figures say

The page draws a grove of grown oaks in the scene's one wind field, with the leaf and bark materials swaying and the sun's shadows following, over a lit ground and sky. The figures are the whole frame, so they carry the ground, the sky, the final pass and the copy work as well as the plants. They are the cost of the look that M3-V7 ships at each preset, not the add-on's own share: D-241's 5, 12, 49.0 and 62.5 ms are the add-on's own GPU time, and the benchmark that isolates it is `bun run bench:gpu-check`.

On WebGPU the frame reads 6.29 to 7.44 ms across the four presets. The presets do not separate here: Low to Ultra spread by 1.15 ms, with the run's load moving the readings by more than that. High and Ultra carry the ambient occlusion passes that Low and Medium do not, 10.55 and 6.39 ms, and pay less for the shadow cascades, 2.39 and 2.13 against 3.21 and 2.82, so the two changes cancel in the total.

The distance that the sway reaches grows with the preset, so a heavier preset moves more of the grove and draws more: 26 calls a frame at Low and Medium, 38 at High and 42 at Ultra on WebGPU, and 53 and 56 on WebGL2.

WebGL2 costs more: 11.48 ms at Low and 15.40 at Medium, against the same presets' 6.29 and 7.37 on WebGPU. It draws each shadow cascade in its own pass and has no per-pass timer, so its cascade cost is inside the frame figure.

Every row holds the frame under D-241's ceilings for the Apple devices: the slowest is WebGL2's Medium at 15.4 ms, against Medium's 43.9 to 90.8 ms. The page at 1280 by 720 is a small view of the grove, and a demo that covers the valley draws more of it.
