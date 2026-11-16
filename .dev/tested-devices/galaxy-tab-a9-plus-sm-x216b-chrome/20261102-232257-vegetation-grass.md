Plans: vegetation-grass 2026-11-02. The branch is `feat/m3-v8-gpu-grass` at `fc2d55988`, whose pages the dev server in `/Users/ram/dev/null3d-grass` served over HTTPS. BrowserStack Automate served the pages through BrowserStack Local, in Chrome 152 on the Samsung Galaxy Tab A9 Plus, Android 14.0.

Result: 2 passed, 0 skipped, 0 failed. Chrome's local network prompt held the runner page's requests once, and the driver allowed it. The rows ran three times in the runs of 23:22, 23:33 and 23:37, because the tablet's frame times vary by more than a few percent between runs.

The plan's two Creek-density rows draw the hill at its own density, with the view cull and the far share, and with the cull now working in every view, the near cascades included. The sun casts, so the rows hold the near shadow pass, and each page warms for 8 seconds before the 5 second measure. The same rows before the per-view cull measured 306.09 ms at 2,312 tufts and 490.73 at 6,820.

| Density (tufts per m²) | Tufts | Run | GPU median (ms) | Frames |
| --- | --- | --- | --- | --- |
| 2.0 | 2,312 | 23:22 | 298.22 | 19 |
| 2.0 | 2,312 | 23:33 | 288.75 | 18 |
| 2.0 | 2,312 | 23:37 | 294.98 | 23 |
| 5.9 | 6,820 | 23:22 | 497.68 | 10 |
| 5.9 | 6,820 | 23:33 | 466.35 | 10 |
| 5.9 | 6,820 | 23:37 | 494.27 | 11 |

At 2,312 tufts the three runs sit between 288.75 and 298.22 ms, so the per-view cull takes about 8 to 17 ms back from 306.09, 3 to 6 per cent. At 6,820 tufts the three runs straddle the earlier row, 466.35 to 497.68 against 490.73, so the change there is inside the run-to-run spread.

The near cascades cost little at either density: the three passes together time at 2.1 to 2.2 ms a frame at 2,312 tufts and 6.3 at 6,820, so the shadow views were never the large part of these rows. Neither row reaches the 208.3 ms target, the S24 class's High ceiling; the grass at the valley's
density misses it by about 87 ms.
