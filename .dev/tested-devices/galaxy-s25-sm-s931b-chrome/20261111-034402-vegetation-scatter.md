Plans: vegetation-scatter 2026-11-11, at `396cab7df` on the milestone branch. The page places Creek's
valley from the ground's own numbers for one seed and checks two things: that its checksum equals the
reference the tree ships, and that the same points arrive when the tiles are handed back in reverse
order and when the tiles are drawn at a second size. BrowserStack Automate served the page over HTTPS
through BrowserStack Local, in Chrome 152.0.7977.54 on Android 15.0.

Result: 2 passed, 0 skipped, 0 failed.

| Page | Seed | Plants | Checksum | Placement (ms) | Worst (ms) | Ground maps (ms) |
| --- | --- | --- | --- | --- | --- | --- |
| vegetation-scatter-webgl2 | 7 | 1,020 | 2,006,477,110 | 5.77 | 6.97 | 46.61 |
| vegetation-scatter-webgpu | 7 | 1,020 | 2,006,477,110 | 6.35 | 8.51 | 46.35 |

The 1,020 plants are 101 canopy, 170 young, 731 ground and 18 dead wood. The placement is the middle
of three timed runs and the ground maps are read once, both from the page's own timers, for a
placement that reads no GPU and starts no engine; the two paths place the same points, which is what
the matching checksums show.

The run's frame timing is unreliable: the display ran at 30 Hz where 60 was expected, which the
runner reports as a hot device or a changed display setting. No frame rate is claimed from this run.

The session is at
`https://automate.browserstack.com/builds/20ebd56d601adfc52b3320a67792bdcd4fb6dd85/sessions/4e16f3089aecbde8493c15361b54ebfbcf00c483`.
