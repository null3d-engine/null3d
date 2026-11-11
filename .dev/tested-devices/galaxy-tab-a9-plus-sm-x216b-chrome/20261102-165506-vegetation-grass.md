Plans: vegetation-grass 2026-11-02. The branch is `feat/m3-v8-gpu-grass` at `8f69e5146`, from `landing/range-7` at a344b83d7, whose pages the dev server in `/Users/ram/dev/null3d-grass` served. BrowserStack Automate served the pages over HTTPS through BrowserStack Local, in Chrome 152 on the Samsung Galaxy Tab A9 Plus, Android 14.0.

Result: 4 passed, 0 skipped, 0 failed. Chrome's local network prompt held the runner page's requests once, and the driver allowed it.

The plan's four `vegetation-grass-creek-*` items draw the hill at Creek's own density, not the 17.3 tufts on each square meter of the stress hill: 2,312 tufts for its valley's 2.0 on each square meter over 34 by 34 meters, and 6,820 for its densest bank strip's 5.9. Each density runs with and without the view cull and the far share, so the cull's own change shows. The sun casts, so the rows hold the near shadow pass, and each page warms for 8 seconds before the 5 second measure.

| Density (tufts per m²) | Tufts | View cull | GPU median (ms) | GPU p95 (ms) | GPU p99 (ms) | Frames | CPU median (ms) | Draw calls |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2.0 | 2,312 | with | 306.09 | 307.59 | 307.72 | 16 | 2.21 | 15 |
| 2.0 | 2,312 | without | 318.77 | 320.01 | 320.12 | 17 | 2.72 | 14 |
| 5.9 | 6,820 | with | 490.73 | 490.73 | 490.73 | 12 | 3.51 | 14 |
| 5.9 | 6,820 | without | 527.17 | 527.17 | 527.17 | 10 | 3.10 | 15 |

The WebGPU times come from the GPU's timer, over two samples at 2.0 and one at 5.9, so the top rows' spread is thin and the bottom rows' p95 is their only sample. The cull takes 12.68 ms back at 2.0, 4.0 per cent, and 36.44 ms at 5.9, 6.9 per cent.

Neither row reaches 208.3 ms, the S24 class's High ceiling that these rows were measured against as
a target; the tablet has no row above Medium. The same page with the grass switched off measured 179.18 ms in the run of 2026-11-02 17:13 (`.dev/tested-devices/galaxy-tab-a9-plus-sm-x216b-chrome/20261102-171133-vegetation-grass.md`), so the scene's own passes with the casting sun sit 29.12 ms inside that target and the grass at Creek's density is what carries the row past it: it adds 126.91 ms at 2,312 tufts and 311.55 ms at 6,820.

The 20,000 tuft hill stays a separate stress case with no ceiling. Its High row on this tablet is 961.54 ms with the casting sun and 283.97 ms without, measured in runs of their own.
