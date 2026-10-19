Plans: Battle's page alternated between the engines, 2026-10-19, on the working tree of `perf/battle-webgpu` with local probe hooks only, in Safari 26.5 (iOS 26) on the iPhone 17, screen at 60 Hz. Four pages of `examples/index.html` at 100 units, 603 x 1009 backing pixels at a pixel ratio of 1.5, on the direct path, 15 seconds of warm-up and 8 seconds of the page's own measure, in the order three.js, null3D, three.js, null3D.

Result: four pages measured, none failed.

| Page | Presented fps | GPU time |
| --- | --- | --- |
| three.js, first page of the session | 30.7 | |
| null3D | 27.9 | 26.18 ms |
| three.js | 17.3 | |
| null3D | 27.7 | 26.85 ms |

The two null3D pages agree, 27.9 and 27.7. The two three.js pages do not: 30.7 and 17.3 a minute apart. On the same device earlier, three.js held 30.8 and 31.4, and null3D's page moved from 25.1 to 30.0 with settings that did not change ([the interleaved run](20261019-052000-battle-webgpu-ab.md)). So the page-to-page variance of this device is as large as the gap that this task set out to close, and a pair of pages cannot settle it. The same-session pairs of the day put null3D 2.8 to 7.5 frames behind three.js on WebGPU.

No engine change came from these runs: the sun filter's square and the skinning pass are both neutral warm ([D-20](../../decisions/D-20-webgpu-skinning.md#addendum-2026-10-19-the-pass-measured-on-an-iphone-17-and-why-it-is-not-a-default), [D-169](../../decisions/D-169-anti-acne-plane-cost.md#addendum-2026-10-19-the-filters-square-on-an-iphone-17-and-a-cold-first-page)). A firmer figure needs rounds that alternate the engines, discard the first page and repeat enough times to bound the variance.
