Plans: vegetation-scatter 2026-11-11, at `396cab7df` on the milestone branch. The page places Creek's
valley from the ground's own numbers for one seed and checks two things: that its checksum equals the
reference the tree ships, and that the same points arrive when the tiles are handed back in reverse
order and when the tiles are drawn at a second size. BrowserStack Automate served the page over HTTPS
through BrowserStack Local, in Safari 26.6.1 on iPadOS 26.

Result: 2 passed, 0 skipped, 0 failed.

| Page | Seed | Plants | Checksum | Placement (ms) | Worst (ms) | Ground maps (ms) |
| --- | --- | --- | --- | --- | --- | --- |
| vegetation-scatter-webgl2 | 7 | 1,020 | 2,006,477,110 | 5.10 | 5.36 | 36.02 |
| vegetation-scatter-webgpu | 7 | 1,020 | 2,006,477,110 | 5.22 | 5.50 | 40.30 |

The 1,020 plants are 101 canopy, 170 young, 731 ground and 18 dead wood. The placement is the middle
of three timed runs and the ground maps are read once, both from the page's own timers, for a
placement that reads no GPU and starts no engine; the two paths place the same points, which is what
the matching checksums show. The runner read the display at 59 Hz.

The session is at
`https://automate.browserstack.com/builds/2135310740438f35fa86ad3879b5ac8779b5f038/sessions/8173e69f9abfde23add387ef05e86a471237d830`.
