Plans: vegetation-poses 2026-10-31. The branch is `feat/m3-v10-branch-poses` at `8edc9c8cc`, which
the branch later merged into without changing the measured code. BrowserStack Automate served the
pages over HTTPS through BrowserStack Local, in Safari 26.6.1 on iOS 26, on an iPad Pro 13 2025.

Result: 28 passed, 0 skipped, 0 failed.

The `vegetation-poses` plan times a dense grove of four oak variants in seven copies each, with the
per-vertex sway and with branch poses. Each pair of pages runs in turns at one preset and path, and
the order swaps. The frame is the median GPU time per frame over five seconds, after a settle. The
vertex view draws the same page at a quarter of the render scale with the sun's shadows off, so its
frame follows the vertex work that the two methods differ in. The window was 1,032 by 1,376 CSS
pixels at 2x. The cloud session controls neither the tablet's heat nor its refresh rate, so the rows
compare the methods in turns and are not budgets.

| GPU path | Preset | Frame, per vertex (ms) | Frame, poses (ms) | Vertex view, per vertex (ms) | Vertex view, poses (ms) |
| --- | --- | --- | --- | --- | --- |
| WebGPU | Low | 6.14 | 6.62 | 4.49 | 5.56 |
| WebGPU | Medium | 33.91 | 34.93 | 6.24 | 6.30 |
| WebGPU | High | 43.36 | 44.68 | 6.48 | 6.18 |
| WebGPU | Ultra | 43.90 | 47.54 | 5.95 | 6.22 |
| compatibility | Low | 6.56 | 6.89 | - | - |
| compatibility | Medium | 37.98 | 38.69 | - | - |
| WebGL2 | Low | CPU 3.47 | CPU 1.24 | CPU 2.42 | CPU 2.56 |
| WebGL2 | Medium | CPU 1.06 | CPU 2.88 | CPU 2.49 | CPU 2.72 |

The pose method is slower at every WebGPU preset: 7.9 per cent at Low, 3.0 at Medium and High, and
8.3 at Ultra. Its vertex view is 23.9 per cent slower at Low, level at Medium, 4.6 per cent faster
at High and 4.6 per cent slower at Ultra. Few trees stand inside the eight meter sway distance at
Low, so the pass costs more than the branches save.

The iPad's WebGL2 pages give the CPU time of the busiest thread instead of a GPU time, and it does
not separate the methods. The Mac's WebGL2 timer gives that answer: the pose method is 34 and 16.6
per cent slower on the frame there.
