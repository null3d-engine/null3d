Plans: vegetation-scatter 2026-11-11, at `396cab7df` on the milestone branch. The page places Creek's
valley from the ground's own numbers for one seed and checks two things: that its checksum equals the
reference the tree ships, and that the same points arrive when the tiles are handed back in reverse
order and when the tiles are drawn at a second size. BrowserStack Automate served the page over HTTPS
through BrowserStack Local, in Chrome 152.0.7977.54 on Android 16.0.

Result: 2 passed, 0 skipped, 0 failed.

| Page | Seed | Plants | Checksum | Placement (ms) | Worst (ms) | Ground maps (ms) |
| --- | --- | --- | --- | --- | --- | --- |
| vegetation-scatter-webgl2 | 7 | 1,020 | 2,006,477,110 | 11.30 | 11.36 | 82.70 |
| vegetation-scatter-webgpu, drawn on WebGL2 | 7 | 1,020 | 2,006,477,110 | 9.33 | 11.17 | 69.05 |

The device has no WebGPU adapter, so the second page named that path and drew on WebGL2; the page
reports the same points either way. The 1,020 plants are 101 canopy, 170 young, 731 ground and 18 dead
wood. The placement is the middle
of three timed runs and the ground maps are read once, both from the page's own timers, for a
placement that reads no GPU and starts no engine; the two paths place the same points, which is what
the matching checksums show.

The run's frame timing is unreliable: the display ran at 30 Hz where 60 was expected, which the
runner reports as a hot device or a changed display setting. No frame rate is claimed from this run.

The session is at
`https://automate.browserstack.com/builds/c8c2281e3303e95119df16a608994925f1f0bfdc/sessions/3199d25f2d3fec486b166212b52e2cead63166f3`.
Chrome's local-network prompt held the runner page's requests once, and the driver tapped Allow.
