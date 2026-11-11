Plans: vegetation-grass 2026-11-11, at `d822a8cc2` on the milestone branch. The page draws one hill
of grass at a preset's share of 20,000 tufts, with its sun casting, and measures five seconds after
an eight-second warm-up. The four creek-density pages draw the hill at Creek's own density, 2,312
and 6,820 tufts, with and without the view cull and far share. BrowserStack Automate served the
pages over HTTPS through BrowserStack Local, in Chrome on Android 14.0.

Result: 13 passed, 0 skipped, 0 failed. The pages above Low drew this time, where the earlier run drew
no frame at High.

| Page | Preset | GPU (ms) | p95 (ms) | CPU (ms) | D-241 ceiling (ms) |
| --- | --- | --- | --- | --- | --- |
| vegetation-grass-low-webgpu | Low | 170.98 | 182.38 | 1.99 | 1,268.5 |
| vegetation-grass-medium-webgpu | Medium | 425.33 | 428.75 | 1.86 | 1,820.8 |
| vegetation-grass-high-webgpu | High | 754.52 | 754.52 | 2.52 | no row |
| vegetation-grass-ultra-webgpu | Ultra | 941.49 | 941.49 | 1.79 | no row |
| vegetation-grass-low-compat | Low | 169.80 | 176.59 | 2.08 | 1,268.5 |
| vegetation-grass-medium-compat | Medium | 467.93 | 467.93 | 1.41 | 1,820.8 |
| vegetation-grass-low-webgl2 | Low | none timed | | 5.65 | 1,268.5 |
| vegetation-grass-medium-webgl2 | Medium | none timed | | 3.40 | 1,820.8 |
| vegetation-grass-creek-2-webgpu | High | 237.73 | 247.02 | 2.72 | none |
| vegetation-grass-creek-2-nocull-webgpu | High | 294.68 | 294.77 | 2.55 | none |
| vegetation-grass-creek-5-9-webgpu | High | 377.42 | 377.42 | 2.68 | none |
| vegetation-grass-creek-5-9-nocull-webgpu | High | 492.31 | 492.31 | 3.69 | none |
| vegetation-grass-nograss-webgpu | High | 151.45 | 152.52 | 2.39 | none |

The budgets that exist hold: Low reads 170.98 against 1,268.5 and Medium 425.33 against 1,820.8,
where the recorded branch run read 2,243 ms at Medium. D-241 sets no High or Ultra row for this
tablet, so 754.52 and 941.49 ms are recorded without a ceiling; the 208.3 and 499.8 in its table
are the S24 class's. The no-grass page reads 151.45 ms at High against the same page's 754.52 with
the grass, so the scene alone is cheap and the grass carries the rise. The WebGL2 path takes no GPU
timer here, so only its CPU time is reported, and
the creek-density pages are the stress rows with no ceiling.

The session is at
`https://automate.browserstack.com/builds/24209ea473af395adb4bf9a55e3949b6467f75ec/sessions/8f1d0ed688c31468620c2634fae67e567c052762`
and the results are in `target/runs/20261111-073421-vegetation-grass`.
