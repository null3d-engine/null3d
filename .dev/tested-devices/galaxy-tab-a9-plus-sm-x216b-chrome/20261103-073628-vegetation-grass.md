Plans: vegetation-grass 2026-11-03. The branch is `feat/m3-v8-ao-cost` at `58ddebaa3`, whose pages the dev server in `/Users/ram/dev/null3d-grass` served over HTTPS. BrowserStack Automate served the pages through BrowserStack Local, in Chrome 152 on the Samsung Galaxy Tab A9 Plus, Android 14.0.

Result: 6 passed, 0 skipped, 0 failed. Chrome's local network prompt held the runner page's requests once, and the driver allowed it.

The block settles the far cover's distance. The row draws the hill at Creek's own density, 2,312 tufts on the 34 by 34 meter hill, at High, with the casting sun and with the sun's contact shadows and the bounce light off, after the owner ruled those two effects out of the demo. The same page with no grass at all is the known bracket at either end, so a drift in the machine shows itself. Each page warms for 8 seconds before the 5 second measure.

| Row | Far fade ends at (m) | GPU median (ms) | p95 (ms) | p99 (ms) | Frames | Samples |
| --- | --- | --- | --- | --- | --- | --- |
| Known page, before | n/a | 162.27 | 162.33 | 162.33 | 31 | 3 |
| Creek density | 24.31 | 209.72 | 221.33 | 222.37 | 24 | 3 |
| Creek density | 24.31 | 196.02 | 202.03 | 202.57 | 24 | 3 |
| Creek density | 25.59 | 217.45 | 223.11 | 223.61 | 24 | 3 |
| Creek density | 25.59 | 216.60 | 226.27 | 227.13 | 23 | 2 |
| Known page, after | n/a | 156.30 | 159.02 | 159.26 | 30 | 3 |

At 24.31 meters the two runs give 209.72 and 196.02, a mean of 202.87 and a spread of 13.7. At 25.59 both runs are over the target at 217.45 and 216.60, a spread of 0.85. The known page fell from 162.27 to 156.30 across the block, so the machine drifted about 6 milliseconds, 3.7 per cent, faster within it. D-241 sets no High ceiling for the tablet; 208.3 is the S24 class's target, and it sits inside the
row's spread at 24.31 rather than outside it, and the mean is 5.4 ms under.

The far cover's fade now reaches its floor at 24.31 meters, against the authored 45. Computed from the placement hash on the same camera, that removes 36.9 per cent of the drawn tufts, and the share bands become all under 10 meters, 71 per cent from 10 to 20, 28 from 20 to 30 and 25 past 30; the 20,000 tuft hill keeps 8,452 instead of 13,730.

The pictures compare the authored distance with the chosen one, on this Mac's GPU. The crest differs by 7,076 pixels, 0.768 per cent, with a mean channel difference of 1.064: the far slope is sparser and its blades read coarser, and the hill stays covered to the crest with no bare ground or edge. The demo's horizon differs by 781 pixels, 0.085 per cent, with a mean channel difference of 0.375, and the two look the same at full size. The files are `20261103-073628-far-cover-crest-45.png`, `20261103-073628-far-cover-crest-24-31.png`, `20261103-073628-far-cover-horizon-45.png` and `20261103-073628-far-cover-horizon-24-31.png` beside this record. The authored side is the repository's own stored picture of the hill, which still matched at the authored distance.

The demo also draws without the sun's contact shadows and the bounce light, which kept ambient occlusion's three passes: its pictures at Low, Medium and High are pixel for pixel the same with the two effects on and off, and the sketch pins the settings so a preset change does not bring them back.
