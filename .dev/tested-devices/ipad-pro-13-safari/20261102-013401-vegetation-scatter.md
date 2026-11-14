Plans: vegetation-scatter 2026-11-02. The branch is `test/m3-v6-device-row` at `b4b023e49`. BrowserStack Automate served the pages over HTTPS through BrowserStack Local, in Safari 26.6.1 on iOS 26.

Result: 2 passed, 0 skipped, 0 failed.

The `vegetation-scatter` plan places Creek's valley with the vegetation add-on's ecological rules, once on WebGL2 and once on WebGPU. The placement reads no GPU, so both pages must give the same points. The page compares its checksum with the current reference for seed 7. It fails when the tiles arrive in the reverse order or at another size and the points change. Safari on iPadOS runs WebKit and JavaScriptCore, so this is the second JavaScript engine beside Chrome's V8.

| GPU path | Seed | Plants | Checksum | Placement (ms) | Worst (ms) | Ground maps (ms) |
| --- | --- | --- | --- | --- | --- | --- |
| WebGL2 | 7 | 956 | 3358570449 | 5.20 | 5.22 | 37.02 |
| WebGPU | 7 | 956 | 3358570449 | 4.84 | 5.30 | 35.92 |

Both paths gave the reference checksum and the same 956 plants: 104 in the canopy layer, 174 young, 652 ground cover and 26 deadwood. The reverse tile order and the second tile size, 17 m, gave the same checksum too. The placement took 5.20 and 4.84 ms, each the middle of three runs. Building the ground maps took 37.02 and 35.92 ms once, before the timed runs.

The window was 1,032 by 1,376 CSS pixels. The display ran at 59 Hz. A cloud session's heat and display settings are not controlled. This page times no frames, though: its figures are the placement's own times, which the JavaScript engine sets, not the GPU.

results: /Users/ram/dev/null3d-v6/target/runs/20261102-013401-vegetation-scatter
