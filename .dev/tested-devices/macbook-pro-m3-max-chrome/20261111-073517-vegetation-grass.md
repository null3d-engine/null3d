Plans: vegetation-grass 2026-11-11, at `d822a8cc2` on the milestone branch. The page draws one hill
of grass at a preset's share of 20,000 tufts, with its sun casting, and measures five seconds after
an eight-second warm-up. The four creek-density pages draw the hill at Creek's own density, 2,312
and 6,820 tufts, with and without the view cull and far share. The runner opened the window in front,
because a hidden page gets no animation frames. Chrome 157.0.8103.39 on macOS.

Result: 13 passed, 0 skipped, 0 failed.

| Page | Preset | GPU (ms) | p95 (ms) | CPU (ms) |
| --- | --- | --- | --- | --- |
| vegetation-grass-low-webgpu | Low | 2.06 | 2.42 | 0.46 |
| vegetation-grass-medium-webgpu | Medium | 3.67 | 21.48 | 0.43 |
| vegetation-grass-high-webgpu | High | 6.68 | 22.07 | 0.44 |
| vegetation-grass-ultra-webgpu | Ultra | 9.31 | 38.69 | 0.45 |
| vegetation-grass-low-compat | Low | 1.97 | 13.75 | 0.49 |
| vegetation-grass-medium-compat | Medium | 4.06 | 15.10 | 0.56 |
| vegetation-grass-low-webgl2 | Low | 5.80 | 10.00 | 0.82 |
| vegetation-grass-medium-webgl2 | Medium | 9.19 | 15.41 | 0.91 |
| vegetation-grass-creek-2-webgpu | High | 2.98 | 3.21 | 0.49 |
| vegetation-grass-creek-2-nocull-webgpu | High | 3.34 | 3.71 | 0.50 |
| vegetation-grass-creek-5-9-webgpu | High | 4.00 | 4.43 | 0.37 |
| vegetation-grass-creek-5-9-nocull-webgpu | High | 5.24 | 5.70 | 0.47 |
| vegetation-grass-nograss-webgpu | High | 2.03 | 2.29 | 0.47 |

Every page drew and the run carried no warning about the drawing buffer, which the earlier attempt
did. The medians are the figures the ceilings compare; the p95 column shows the frames' tail, and
this window ran beside the test server rather than alone. The Ultra preset's tail, 38.69 ms, is the
largest in the row, so its median, not its worst frame, carries the comparison.

The session's results are in `target/runs/20261111-073517-vegetation-grass`.
