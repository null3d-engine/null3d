# D-09: Half precision on phones

Status: proposed. The S24+ and iPad rows are pending. Date: 2026-10-03. Task: M1-H5. Test: T-22.

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

### The Mac

`bun run bench:run --scenes s3,s4 --pages null3d-webgpu,null3d-webgpu-half,null3d-webgl2,null3d-webgl2-half --runs 3 --seconds 10`, Chrome on the MacBook Pro M5 Max, 3 October 2026 (run `target/bench/20261002-171200-bench`). The GPU time is the median of each run's frames, from timestamp queries. Other helpers used the Mac's GPU during the run, so single runs moved by up to 25%.

| Scene | Path | GPU ms, full precision | GPU ms, half precision | Saved |
| --- | --- | --- | --- | --- |
| S3 | WebGPU | 2.68 | 2.53 | 6% |
| S4 | WebGPU | 1.23 | 1.21 | 2% |

S4's opaque pass took 0.932 ms at full precision and 0.918 ms at half, and its final pass 0.883 ms and 0.870 ms. Chrome has no GPU timer for WebGL2 there, and both settings held 129 to 144 frames per second on the 144 Hz display. The Mac is no phone, so its rows do not count for the rule.

### The iPad (WebGPU and WebGL2) and the S24+ (WebGL2)

Pending. The coordinator runs these from a checkout of the branch, after `bun run build` and a restart of the dev server. The page kinds that end in `-half` add `?half=on`, so each run takes turns between the two settings:

```sh
# iPad, Safari: GPU time per pass on WebGPU, frame time on WebGL2
bun tests/real-browsers.ts --plan bench --lan ipad-safari --scenes s3,s4 --pages null3d-webgpu,null3d-webgpu-half,null3d-webgl2,null3d-webgl2-half
# S24+, Chrome: S4 at the device's full pixel ratio, where the GPU sets the frame rate
bun tests/real-browsers.ts --plan bench --allow-no-webgpu --android chrome --scenes s3,s4 --pages null3d-webgl2,null3d-webgl2-half --switches preset=ultra
# Both devices: the image tests at the device tolerance, with half precision on
bun tests/real-browsers.ts --allow-no-webgpu --android chrome --lan ipad-safari --switches half=on
```

## Decision

Pending the device rows. Until then half precision stays off on both paths, and `?half=on` turns it on.

## Consequences

- The HALF builds double the builds of the standard material and the final pass. The device modules grow from 6 to 12, and the shaders page compiles 261 GLSL programs instead of 163. A page still downloads one module.
- The shader build lets library modules use 16-bit floats. Entry shaders and custom materials still may not, as `shaders/wgsl-rules` says.
- If half precision ships on a path, `guides/performance` describes it, and the image references of that path are drawn with it.
- The record is in the table in README.md.
