Plans: vegetation-scatter 2026-11-02. The branch is `test/m3-v6-device-row` at `b4b023e49`. BrowserStack Automate served the pages over HTTPS through BrowserStack Local, in Chrome 152.0.7977.54 on Android 16.

Result: 2 passed, 0 skipped, 0 failed. Timing figures unreliable, because the display ran at 30 Hz.

The `vegetation-scatter` plan places Creek's valley with the vegetation add-on's ecological rules, once on WebGL2 and once with the `gpu=webgpu` switch. The placement reads no GPU, so both pages must give the same points. The page compares its checksum with the current reference for seed 7. It fails when the tiles arrive in the reverse order or at another size and the points change. The device has no WebGPU adapter, so the second page's switch names no engine that this device started. Both pages run the same CPU work.

| GPU path | Seed | Plants | Checksum | Placement (ms) | Worst (ms) | Ground maps (ms) |
| --- | --- | --- | --- | --- | --- | --- |
| WebGL2 | 7 | 956 | 3358570449 | 7.35 | 9.61 | 71.54 |
| `gpu=webgpu` page | 7 | 956 | 3358570449 | 7.19 | 12.17 | 55.19 |

Both pages gave the reference checksum and the same 956 plants: 104 in the canopy layer, 174 young, 652 ground cover and 26 deadwood. The reverse tile order and the second tile size, 17 m, gave the same checksum too. The placement took 7.35 and 7.19 ms, each the middle of three runs. Building the ground maps took 71.54 and 55.19 ms once, before the timed runs.

A placement time is the page's own reading, so the display's 30 Hz cannot change it. The cloud reported the phone hot, so the figure is an upper bound. Chrome's local network prompt held its pages once until the driver tapped Allow.

results: /Users/ram/dev/null3d-v6/target/runs/20261102-013756-vegetation-scatter
