Plans: vegetation-scatter 2026-11-11, at `396cab7df` on the milestone branch, with the machine's
load average 7.6 when the run started. The page places Creek's valley from the ground's own numbers
for one seed and checks two things: that its checksum equals the reference the tree ships, and that
the same points arrive when the tiles are handed back in reverse order and when the tiles are drawn
at a second size. The runner opened the window in front, because a hidden page gets no animation
frames, and served the page over the local HTTP server. Chrome 157.0.8103.39 on macOS.

Result: 2 passed, 0 skipped, 0 failed.

| Page | Seed | Plants | Checksum | Placement (ms) | Worst (ms) | Ground maps (ms) | Display |
| --- | --- | --- | --- | --- | --- | --- | --- |
| vegetation-scatter-webgl2 | 7 | 1,020 | 2,006,477,110 | 5.89 | 6.85 | 24.58 | 60 Hz |
| vegetation-scatter-webgpu | 7 | 1,020 | 2,006,477,110 | 6.15 | 6.25 | 24.17 | 60 Hz |

The 1,020 plants are 101 canopy, 170 young, 731 ground and 18 dead wood. The placement is the middle
of three timed runs and the ground maps are read once, both from the page's own timers, for a
placement that reads no GPU and starts no engine; the two paths place the same points, which is what
the matching checksums show.
