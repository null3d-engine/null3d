Plans: vegetation-grass 2026-11-11, at `d822a8cc2` on the milestone branch. The page draws one hill
of grass at a preset's share of 20,000 tufts, with its sun casting, and measures five seconds after
an eight-second warm-up. The four creek-density pages draw the hill at Creek's own density, 2,312
and 6,820 tufts, with and without the view cull and far share. BrowserStack Automate served the
pages over HTTPS through BrowserStack Local, in Safari 26.6.1 on iPadOS 26.

Result: 13 passed, 0 skipped, 0 failed.

| Page | Preset | GPU (ms) | p95 (ms) | CPU (ms) |
| --- | --- | --- | --- | --- |
| vegetation-grass-low-webgpu | Low | 3.65 | 6.55 | 0.34 |
| vegetation-grass-medium-webgpu | Medium | 6.44 | 7.17 | 0.34 |
| vegetation-grass-high-webgpu | High | 10.04 | 10.30 | 0.34 |
| vegetation-grass-ultra-webgpu | Ultra | 12.14 | 12.48 | 0.16 |
| vegetation-grass-low-compat | Low | 3.52 | 5.75 | 0.40 |
| vegetation-grass-medium-compat | Medium | 6.72 | 7.20 | 0.34 |
| vegetation-grass-low-webgl2 | Low | none timed | | 3.48 |
| vegetation-grass-medium-webgl2 | Medium | none timed | | 1.74 |
| vegetation-grass-creek-2-webgpu | High | 6.10 | 7.41 | 0.36 |
| vegetation-grass-creek-2-nocull-webgpu | High | 5.88 | 6.99 | 0.36 |
| vegetation-grass-creek-5-9-webgpu | High | 6.42 | 7.27 | 0.36 |
| vegetation-grass-creek-5-9-nocull-webgpu | High | 6.45 | 7.21 | 0.36 |
| vegetation-grass-nograss-webgpu | High | unusable | | 0.36 |

The WebGL2 path takes no GPU timer on this device, so its column is empty and its CPU time stands
alone. The no-grass page's GPU timer spread from under a millisecond to twenty-three seconds inside
the window, the same hot-device fault the leaves' pages showed, so its figure is not reported; every
other page read a steady median with a flat p95.

These are the tablet rows above Low that M3-V8 named as missing. The window was 1,032 by 1,264 at a
pixel ratio of 2, and each page drew more than 300 frames.

The session is at
`https://automate.browserstack.com/builds/83607ec9f5abf5c3656e443ba306d7446eb48e82/sessions/568bd53437cf8decb83c7b4d479131bb01b77ab2`
and the results are in `target/runs/20261111-072527-vegetation-grass`.
