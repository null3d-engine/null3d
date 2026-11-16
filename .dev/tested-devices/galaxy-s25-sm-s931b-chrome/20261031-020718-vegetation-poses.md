Plans: vegetation-poses 2026-10-31. The branch is `feat/m3-v10-branch-poses` at `8edc9c8cc`, which
the branch later merged into without changing the measured code. BrowserStack Automate served the
pages over HTTPS through BrowserStack Local, in Chrome 152.0.7977.54 on Android 15, on a Galaxy S25
(SM-S931B), which stands in for the S24 class by the owner's ruling.

Result: 28 passed, 0 skipped, 0 failed. The runner marks this run's timing figures unreliable: the
cloud phone's display ran at 30 Hz, where the runner expects 60. The figures below therefore compare
the two methods in turns and are not budgets.

The `vegetation-poses` plan times a dense grove of four oak variants in seven copies each, with the
per-vertex sway and with branch poses. Each pair of pages runs in turns at one preset and path, and
the order swaps. The frame is the median GPU time per frame over five seconds, after a settle. The
vertex view draws the same page at a quarter of the render scale with the sun's shadows off, so its
frame follows the vertex work that the two methods differ in. The window was 360 by 780 CSS pixels
at 3x.

| GPU path | Preset | Frame, per vertex (ms) | Frame, poses (ms) | Vertex view, per vertex (ms) | Vertex view, poses (ms) |
| --- | --- | --- | --- | --- | --- |
| WebGPU | Low | 25.69 | 25.89 | 13.96 | 14.71 |
| WebGPU | Medium | 328.53 | 335.15 | 26.61 | 26.87 |
| WebGPU | High | 379.06 | 508.56 | 26.97 | 25.46 |
| WebGPU | Ultra | 405.93 | 548.08 | 26.21 | 25.40 |
| compatibility | Low | 25.76 | 25.85 | - | - |
| compatibility | Medium | 406.06 | 372.97 | - | - |
| WebGL2 | Low | CPU 0.82 | CPU 0.99 | CPU 0.81 | CPU 0.91 |
| WebGL2 | Medium | CPU 0.71 | CPU 0.76 | CPU 0.83 | CPU 0.97 |

WebGL2 has no GPU timer on this device, so its cells give the CPU time of the busiest thread. That
figure does not separate the methods.

The frame figures at Low sit near the 30 Hz display's period, and the frames at the higher presets
run far past it, so this device's display rate distorts the whole-scale rows. Its quarter-scale rows
are flatter, between 14 and 27 ms, and the pose method is 5.4 and 1.0 per cent slower there at Low
and Medium, and 5.6 and 3.1 per cent faster at High and Ultra. The run cannot decide the pick; the
Mac's quiet run does that.
