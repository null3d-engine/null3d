# D-09: Half precision on phones

Status: decided by the rule on both paths: half precision stays off. The iPad's image check with half precision on is pending. Date: 2026-10-03. Task: M1-H5. Test: T-22.

## Question

Phone and tablet GPUs can run 16-bit float math faster than 32-bit math, and keep more of it in registers. Should the scene shaders do their color math at half precision: in `f16` on WebGPU, where the device has the optional feature `shader-f16`, and at `mediump` on WebGL2?

## Rule

Turn half precision on by default for a GPU path when both of these hold:

- It saves at least 5% of the GPU time of S3 or S4 on a device of that path. It costs time on no device of that path. On WebGPU the iPad measures GPU time with timestamp queries. WebGL2 has no GPU timers on phones, so the S24+ and the iPad measure frame time where the GPU sets the frame rate.
- Every image test passes with it on that path. That holds on the Mac in Chrome, on its GPU and on SwiftShader, and on the device at the device tolerance.

The engine cannot choose by GPU name (hard rule 14), so the choice is per GPU path. Otherwise, half precision stays off, and `?half=on` keeps it for measurement.

## What half precision covers

The HALF permutation bit is a bit that the device fixes, like the draw index and tone mapping in the shader. Its builds load from device modules of their own, so a page downloads only one set.

- The library module `null3d::half` holds the color math at half precision. That is the direct light of a PBR surface (GGX, Smith visibility and Schlick's Fresnel), and the ambient light. It is also the ACES, AgX and Neutral tone mapping curves, and sRGB encoding. Each function takes and returns 32-bit values, with the name of its full precision twin in `null3d::lighting` or `null3d::color`, so the templates switch modules by their imports.
- The standard material (`lit`), its texture maps (`standard_maps`) and the final pass have HALF builds. Their positions, light distances, shadow lookups and fog depth stay at full precision. The unlit materials do no lighting, so they have no HALF builds, and custom materials build without HALF, so their builds stay half as many.
- WGSL builds of HALF get the module as written. Every other build gets it with 32-bit floats, and in GLSL each of its functions and constants sits between `precision mediump float;` and `precision highp float;`.
- The 16-bit GGX distribution takes 1 minus the squared cosine from a cross product, as Filament does. The usual form loses its digits near the highlight's peak. Values that could pass the largest 16-bit float, 65504, are clamped first, because an infinite light turns into NaN in the tone mapping.
- `?half=on` asks for half precision and `?half=off` keeps full precision. WebGPU takes it only where the adapter offers `shader-f16`, and then asks the device for that feature. `engine.capabilities.halfPrecision` says what the engine took.

## Data

### Image tests

`NULL3D_SWITCHES=half=on bun run test:images` gives every page `?half=on`. On 3 October 2026, Chrome on the MacBook Pro M5 Max drew with half precision on all three tiers. SwiftShader drew with it on WebGL2 only, because its WebGPU adapter has no `shader-f16`.

- SwiftShader (`CI=1`): all 299 tests passed.
- The Mac's GPU: 285 of 299 passed. S4 failed on each tier, by the same share of pixels as with half precision off: 0.300%, 0.174% and 0.180%. Its references on main no longer match this Mac. The other 11 failures were the tests that allow no change of color. These are the scenes 100 km and 1,000 km out, which compare with the image at the origin, and the debug drawing test. Half precision changed 0.2% to 6.6% of their pixels, nearly all by one step of 255, below the output's dither. Those tests check positions, which stay at full precision, so they now keep `?half=off`, and they pass.
- Six tests also draw with `?half=on` in every run, against their own test's references: `standard-grid-half`, `standard-maps-half`, `lights-16-half`, `shadows-half`, `tone-agx-half` and `tone-aces-8-bit-half`. All pass on both reference sets.
- The S24+ in Chrome 154 ran the device checks with `--switches half=on` on 3 October 2026 (run `20261002-211135-checks`). It has no WebGPU, so it drew WebGL2 only. 202 of its 203 checks passed. 138 of its 168 WebGL2 image tests drew at `mediump`, and the rest keep `?half=off`.
- The one failure was `shadows-cascades-1`: 0.508% of its pixels differed from the reference, and the device tolerance allows 0.5%. Half precision moved every shadow test further from its reference. In the S24+'s last run at full precision (`20261002-133711-checks`), the shadow tests differed by 0.17%. With half precision on, they differed by 0.25% to 0.51%.

### The Mac

`bun run bench:run --scenes s3,s4 --pages null3d-webgpu,null3d-webgpu-half,null3d-webgl2,null3d-webgl2-half --runs 3 --seconds 10`, Chrome on the MacBook Pro M5 Max, 3 October 2026 (run `target/bench/20261002-171200-bench`). The GPU time is the median of each run's frames, from timestamp queries. Other helpers used the Mac's GPU during the run, so single runs moved by up to 25%.

| Scene | Path | GPU ms, full precision | GPU ms, half precision | Saved |
| --- | --- | --- | --- | --- |
| S3 | WebGPU | 2.68 | 2.53 | 6% |
| S4 | WebGPU | 1.23 | 1.21 | 2% |

S4's opaque pass took 0.932 ms at full precision and 0.918 ms at half, and its final pass 0.883 ms and 0.870 ms. Chrome has no GPU timer for WebGL2 there, and both settings held 129 to 144 frames per second on the 144 Hz display. The Mac is no phone, so its rows do not count for the rule.

### The S24+ (WebGL2)

`bun tests/real-browsers.ts --plan bench --allow-no-webgpu --android chrome --scenes s3,s4 --pages null3d-webgl2,null3d-webgl2-half --switches preset=ultra`, Chrome 154 on the Galaxy S24+ (Xclipse 940), 3 October 2026 (run `20261002-205909-bench`). There were 5 runs of each page, which took turns between the two settings. All 20 passed. The phone stayed cool, at a skin temperature of 36 °C at most, and it never throttled.

| Scene | Setting | CPU ms per frame, median | Busiest thread, ms | Frames per second | Frame interval p95, ms |
| --- | --- | --- | --- | --- | --- |
| S3 | Full precision | 3.73 | 3.70 | 59.9 | 16.79 |
| S3 | Half precision | 3.72 | 3.71 | 59.9 | 16.80 |
| S4 | Full precision | 4.16 | 4.14 | 59.9 | 16.79 |
| S4 | Half precision | 4.07 | 4.05 | 59.9 | 16.81 |

The phone held 60 frames per second at its 60 Hz refresh with both settings, even at the Ultra preset. So the display set the frame rate, not the GPU, and the frame time cannot show a GPU saving. Nothing in the run showed a gain from half precision. The CPU times differ by less than the spread between runs. In the governor's S4 stage, both settings held the 60 fps target all the time, at full render scale.

### The iPad (WebGPU and WebGL2)

`bun tests/real-browsers.ts --plan bench --lan ipad-safari --scenes s3,s4 --pages null3d-webgpu,null3d-webgpu-half,null3d-webgl2,null3d-webgl2-half`, Safari 26.6 on the iPad Pro with Limit Frame Rate on (60 Hz), 3 October 2026 (run `20261002-234410-bench`). There were 5 rounds, and in each round the four pages of a scene took turns. A full precision run and its half precision twin started 37 s apart. All 40 runs passed. The iPad's WebGPU adapter offers `shader-f16`, and with `?half=on` the engine reported `halfPrecision: true` on WebGPU in the device checks of the same build (run `20261003-002947-checks`).

GPU time per frame on WebGPU, the median of each run's frames, from timestamp queries:

| Round | S3, full | S3, half | Change | S4, full | S4, half | Change |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 9.33 | 9.31 | -0.2% | 24.47 | 23.85 | -2.5% |
| 2 | 15.63 | 15.72 | +0.6% | 24.24 | 23.52 | -3.0% |
| 3 | 15.59 | 15.75 | +1.0% | not compared | 23.63 | |
| 4 | 15.61 | 15.74 | +0.8% | 23.22 | 23.48 | +1.1% |
| 5 | 15.52 | 15.73 | +1.3% | not compared | 23.75 | |

Reading the table:

- In rounds 3 and 5, the preset check lowered the full precision S4 page to Low, at a pixel ratio of 1.5. So it drew fewer pixels than its twin at Medium. Those two pairs do not compare. In the three pairs that do, half precision changed S4's GPU time by -3.0% to +1.1%, by -1.5% on average.
- S3 took 0.6% to 1.3% longer with half precision in each round after the first.
- Heat. The tablet was warm from the runs before it. S3 took 9.3 ms in round 1 and 15.6 ms from round 2 on, on the same code. Each pair ran within 37 s, so both of its runs saw about the same heat. The changes therefore compare the runs of each pair. A cooler tablet gives shorter times, and the share that half precision saves could differ there. Nothing in this run points to a saving near 5%.
- The run came from the H5 branch, before #212 and #222 merged. The first changes how Safari's WebGL2 path waits for the GPU. The second changes how the governor reads Safari's frame rate. Neither changes the shaders' work, and the governor took no step in any run.

On WebGL2 the iPad has no GPU timer. Before #212, Safari's WebGL2 frames were bound by the drawing worker's waits for the GPU. In all 5 rounds, both S4 pages drew at Low. The half precision page's frames took about 5% longer, with a median interval of 33.6 ms against 31.9 ms. S3's half precision page drew at Low from round 2 on, and its twin at Medium, so S3 does not compare.

### The iPad's image tests with half precision on

Pending. The device checks with `--switches half=on` ran on 3 October 2026 (run `20261003-002947-checks`). 23 of the 107 image pages passed. The other 84 never drew: Safari refused the engine's shared memory (E1109). No page failed on its pixels, but 23 pages are too few to judge. Their rerun waits for #223, which frees the job workers' memory when a page leaves. No result can turn half precision on, because the iPad showed no saving.

## Decision

- WebGL2: half precision stays off. On the S24+ it showed no gain, and one image test failed with it on. On the iPad, S4's frames took about 5% longer with it.
- WebGPU: half precision stays off. The iPad is the only device in the lab with WebGPU and `shader-f16`. There it saved 1.5% of S4's GPU time on average, against the 5% that the rule needs. It cost S3 about 1%. So it gives no gain on either scene. The Mac's 6% saving in S3 does not count, because the Mac is no phone.

`?half=on` keeps half precision on both paths for measurement. A new phone or tablet GPU can be measured with the same two runs.

## Consequences

- The HALF builds double the builds of the standard material and the final pass. The device modules grow from 6 to 12, and the shaders page compiles 261 GLSL programs instead of 163. A page still downloads one module.
- The shader build lets library modules use 16-bit floats. Entry shaders and custom materials still may not, as `shaders/wgsl-rules` says.
- If half precision ships on a path, `guides/performance` describes it, and the image references of that path are drawn with it.
- The record is in the table in README.md.
