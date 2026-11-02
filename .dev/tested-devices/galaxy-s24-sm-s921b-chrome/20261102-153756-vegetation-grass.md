Plans: vegetation-grass 2026-11-02. The branch is `feat/m3-v8-gpu-grass` at `70a124e6d`, from `landing/range-7` at `a344b83d7`, whose pages the dev server in `/Users/ram/dev/null3d-grass` served. BrowserStack Automate served the pages over HTTPS through BrowserStack Local, in Chrome 152.0.7977.54 on the Samsung Galaxy S24, Android 16.0.

Result: 2 passed, 6 skipped, 0 failed. The device has no WebGPU path: its Samsung Xclipse 940 gives WebGL2 only, so the runner skipped the plan's four core-WebGPU pages and its two compatibility-mode pages, and the two WebGL2 pages are its rows. The display runs at 30 Hz, so both rows hold that rate and their frame time is the display's.

The plan runs `vegetation-grass` at each preset and GPU path that the tier offers. The page draws the hill of 20,000 tufts at the High count, a preset's share of them, on a canvas of 960 by 540 drawing pixels at one pixel per CSS pixel; WebGL2 fills the rows as an instance batch. The page measures five seconds after a three-second warm-up. Its sun does not cast shadows, so no shadow pass runs and these rows do not hold the near shadows' cost.

| GPU path | Preset | Tufts drawn | Frames | GPU median (ms) | GPU p95 (ms) | GPU p99 (ms) | CPU median (ms) | Draw calls |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| WebGL2 | Low | 7,000 | 155 | no timer | no timer | no timer | 3.39 | 49 |
| WebGL2 | Medium | 12,000 | 155 | no timer | no timer | no timer | 2.53 | 29 |

WebGL2 gives no GPU timer, and the runner's page counted 155 frames in each five-second measure, which is the display's 30 Hz. Both rows are therefore inside D-241's ceilings for the S24 class, 33.3 ms at Low and 166.6 ms at Medium; the Low row cannot show a figure under its ceiling because the display stops it at the ceiling's own frame time.
