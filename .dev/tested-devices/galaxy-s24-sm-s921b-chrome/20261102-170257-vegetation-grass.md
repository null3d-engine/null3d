Plans: vegetation-grass 2026-11-02. The branch is `feat/m3-v8-gpu-grass` at `8f69e5146`, from `landing/range-7` at a344b83d7, whose pages the dev server in `/Users/ram/dev/null3d-grass` served. BrowserStack Automate served the pages over HTTPS through BrowserStack Local, in Chrome 152.0.7977.54 on the Samsung Galaxy S24, Android 16.0.

Result: 2 passed, 0 skipped, 0 failed.

The device has no WebGPU path: its Samsung Xclipse 940 gives WebGL2 only, so the run took the plan's two WebGL2 pages. They draw the 20,000 tuft stress hill at the High count, a preset's share of them, on a canvas of 960 by 540 drawing pixels at one pixel per CSS pixel; this is 17.3 tufts on each square meter, and the stress hill holds no ceiling. The sun casts, so the rows hold the near shadow pass, and each page warms for 8 seconds before the 5 second measure. The display runs at 30 Hz.

| GPU path | Preset | Tufts drawn | Frames | GPU median (ms) | CPU median (ms) | Draw calls |
| --- | --- | --- | --- | --- | --- | --- |
| WebGL2 | Low | 7,000 | 155 | no timer | 4.51 | 51 |
| WebGL2 | Medium | 12,000 | 164 | no timer | 5.56 | 32 |

WebGL2 gives no GPU timer, so the rows give the CPU time of the busiest thread and the frames drawn. Both rows hold the display's 30 Hz, so each frame is inside D-241's ceilings for the S24 class, 33.3 ms at Low and 166.6 ms at Medium; the Low row cannot show a figure under its ceiling because the display stops it at the ceiling's own frame time.
