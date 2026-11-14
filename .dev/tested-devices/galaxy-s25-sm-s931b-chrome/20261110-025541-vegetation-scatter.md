Plans: vegetation-scatter 2026-11-10, at `4cd20aa36` on the range branch. The page places Creek's
valley from the ground's own numbers for one seed and checks two things: that its checksum equals the
reference the tree ships, and that the same points arrive when the tiles are handed back in reverse
order and when the tiles are drawn at a second size. BrowserStack Automate served the page over HTTPS
through BrowserStack Local, in Chrome 152 on Android 15.0.

Result: 2 passed, 0 skipped, 0 failed.

| Page | Seed | Plants | Checksum | Placement (ms) | Ground maps (ms) |
| --- | --- | --- | --- | --- | --- |
| vegetation-scatter-webgpu | 7 | 1,245 | 2,493,806,866 | 6.42 | 49.40 |
| vegetation-scatter-webgl2 | 7 | 1,245 | 2,493,806,866 | 6.42 | 49.40 |

The 1,245 plants are 101 canopy, 170 young, 956 ground and 18 dead wood. This is the reference the
tree ships today; the reference moved twice after the runs of 2 November, so those rows and the
figure they quote describe a placement the page no longer makes.

The run's timing figures are unreliable: the cloud device's display ran at 30 Hz where 60 was
expected, which the runner reports as a hot device or a changed display setting. The placement and
ground-map figures are read from the page's own timers rather than the frame, so they are reported;
no frame rate is claimed from this run.

The session is at
`https://automate.browserstack.com/builds/a3cf7deef0da9f5263484133f185d569ea13ad0e/sessions/5b085bfab565f771497cad5c0e9e906b2ae49087`.
Chrome's local-network prompt held the runner page's requests once, and the driver allowed it.
