Plans: vegetation-grass 2026-11-02. The branch is `feat/m3-v8-gpu-grass` at `8f69e5146`, from `landing/range-7` at a344b83d7, whose pages the run's dev server served. BrowserStack Automate served the pages over HTTPS through BrowserStack Local, in Chrome 152 on the Samsung Galaxy Tab A9 Plus, Android 14.0.

Result: 1 passed, 0 skipped, 0 failed. Chrome's local network prompt held the runner page's requests once, and the driver allowed it.

The plan's `vegetation-grass-nograss-webgpu` item draws the same page, preset, sun and window as the Creek-density rows, with the grass switched off, so the row gives the frame that the grass adds to: the hill, the ground, the wind field and the High preset's passes under a casting sun, on a canvas of 800 by 1,088 CSS pixels at one and a half drawing pixels each. It warms for 8 seconds before the 5 second measure.

| Grass | GPU median (ms) | GPU p95 (ms) | GPU p99 (ms) | Frames | CPU median (ms) | Draw calls |
| --- | --- | --- | --- | --- | --- | --- |
| off | 179.18 | 189.91 | 190.86 | 27 | 0.78 | 10 |

The GPU's timer gives the frame's total over three samples. The per-pass timer puts 176.36 ms of it in the second ambient occlusion pass and 1.18 in the first, with the shadow cascades and the wind's compute pass together under 1 ms, so the base frame is the preset's screen-space pass rather than its geometry. The page drew 27 frames in 5 seconds, so the display did not hold it back.

The 208.3 ms target, the S24 class's High ceiling, is 29.12 ms above this row. The grass at Creek's own density then adds 126.91 ms at 2,312 tufts and 311.55 ms at 6,820, which is why those rows sit past it. The derivation from the two rows without the cull put the frame before the grass at 211.9 ms; that figure carries about 33 ms of the grass's own fixed cost, its shadow pass and its draw setup, which leave with the grass.
