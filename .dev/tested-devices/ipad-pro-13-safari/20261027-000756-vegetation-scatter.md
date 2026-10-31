Plans: vegetation-scatter 2026-10-27. The branch is `chore/devices-today` at `dc1e9d557`, cut from `m3-start`, whose pages the dev server in `/Users/ram/dev/null3d-devices` served. BrowserStack Automate served the pages over HTTPS through BrowserStack Local, in Safari 26.6.1 on iOS 26.

Result: 2 passed, 0 skipped, 0 failed.

The `vegetation-scatter` plan places Creek's valley with the vegetation add-on's ecological rules, once on WebGL2 and once on WebGPU. The placement reads no GPU, so both pages must give the same points. The page compares its checksum with the one that another device recorded for seed 7, and fails when the tiles arrive in the reverse order or at another size and the points change. Safari on iPadOS draws and runs with WebKit and JavaScriptCore, so this is the second JavaScript engine that the task asks for beside Chrome's V8.

| GPU path | Seed | Plants | Checksum | Placement (ms) | Worst (ms) | Ground maps (ms) |
| --- | --- | --- | --- | --- | --- | --- |
| WebGL2 | 7 | 955 | 916344353 | 5.44 | 5.52 | 41.34 |
| WebGPU | 7 | 955 | 916344353 | 5.02 | 5.70 | 41.14 |

Both paths gave the recorded checksum 916344353 and the same 955 plants: 104 in the canopy layer, 174 young, 651 ground cover and 26 deadwood. The reverse tile order and the second tile size, 17 m, gave the same checksum too. The placement takes 5.0 to 5.4 ms for the valley, and building the ground maps takes 41 ms once, before the timed runs.

The window was 1,032 by 1,376 CSS pixels at 2x. A cloud session's heat and display settings are not controlled, but this page times no frames: its figures are the placement's own times, which the JavaScript engine sets, not the GPU.
