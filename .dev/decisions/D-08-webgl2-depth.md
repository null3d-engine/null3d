# D-08: WebGL2 depth mode

Status: proposed. Date: 2026-09-30. Task: M1-L1. Test: T-29.

## Question

Which depth mode should the WebGL2 path draw with? Where a browser has `EXT_clip_control`, is reversed depth with a range from 0 to 1 the most precise mode? Where it lacks the extension, should WebGL2 keep reversed depth in GL's own range from -1 to 1, or draw standard depth?

## Rule

On each device, keep the mode with the fewest fighting pixels in the precision scene. Where reversed depth without clip control is no better than standard depth, use standard depth.

## Data

The three modes, as the engine now draws them. All use a 32-bit float depth buffer and the engine's reversed projection. Each GLSL vertex shader maps WebGPU's clip depth through one uniform (`null3d_depth_mapping`), so all three run the same programs:

- `standard`: the vertex shader writes w - 2z, GL's range -1 to 1, depth test LESS, clear to 1. This is three.js's default depth.
- `reversed-gl`: 2z - w, GL's range -1 to 1, depth test GREATER, clear to 0. This is what WebGL2 drew before this change, everywhere.
- `reversed`: z as it is, with `clipControlEXT(LOWER_LEFT_EXT, ZERO_TO_ONE_EXT)`, depth test GREATER, clear to 0. This is the same depth as on WebGPU.

The precision scene (`tests/pages/depth-precision.html`): 11 tiles, each with two surfaces 1 cm apart along their normal. The nearer surface sits at 1, 2.5, 6.3, 16, 40, 100, 250, 630, 1,600, 4,000 or 10,000 m. Each pair turns 30 degrees about the vertical axis, so depth changes across it by about 12% of its distance either way. The camera has a near plane at 0.1 m, a far plane at 20 km and a 60-degree vertical field of view. The frame is 640 x 360 pixels, with the engine's usual MSAA. The farther surface draws first, so a depth tie counts as fighting. A twelfth tile holds two surfaces at the same depth to check that. In every run below, the farther surface won all 6,912 tied pixels. A fighting pixel shows the farther surface in at least one sample.

Fighting pixels over all 11 distances, WebGL2 forced (`?gpu=webgl2&depth=<mode>`):

| Device and browser | `standard` | `reversed-gl` | `reversed` (`EXT_clip_control`) | WebGPU (reversed) | Default the engine picks | Run |
| --- | --- | --- | --- | --- | --- | --- |
| MacBook Pro M5 Max, Chrome 153.0.8010.53 | 16,591 | 5,441 | 0 | 0 | `reversed` | 20260929-191110-depth |
| MacBook Pro M5 Max, Safari 26.6.2 | 16,591 | 5,441 | 0 | 0 | `reversed` | 20260929-191110-depth |
| MacBook Pro M5 Max, Brave (Chromium 153), Shields not recorded | 16,591 | 5,441 | 0 | 0 | `reversed` | 20260929-191110-depth |
| MacBook Pro M5 Max, Firefox 156 | 14,148 | 9,156 | no `EXT_clip_control`: the forced page draws `reversed-gl` | 0 | `reversed-gl` | 20260929-191110-depth |
| Galaxy S24+, Chrome | pending | pending | pending | no WebGPU | pending | |
| Galaxy S24+, Brave | pending | pending | pending | no WebGPU | pending | |
| iPad Pro 11-inch, Safari | pending | pending | pending | pending | pending | |
| iPad Pro 11-inch, Brave | pending | pending | pending | pending | pending | |

Share of each distance's pixels that fight on the Mac (every mode fights in none up to 100 m):

| Browser and mode | 250 m | 630 m | 1.6 km | 4 km | 10 km |
| --- | --- | --- | --- | --- | --- |
| Chrome, Safari, Brave: `standard` | 37.2% | 100% | 100% | 63.5% | 42.1% |
| Chrome, Safari, Brave: `reversed-gl` | 0 | 14.4% | 37.8% | 0 | 57.0% |
| Chrome, Safari, Brave: `reversed` | 0 | 0 | 0 | 0 | 0 |
| Firefox: `standard` | 0 | 100% | 100% | 0 | 100% |
| Firefox: `reversed-gl` | 0 | 30.4% | 99.7% | 0 | 68.9% |

For reference, not a user device: SwiftShader, the software GPU of the CI machines (Chromium 153 headless shell, through the Playwright image tests), fought in 22,859 pixels in `standard`, 8,822 in `reversed-gl` and 14,867 in `reversed`. WebGPU on SwiftShader fought in 14,867 too, at 250 m, 4 km and 10 km. SwiftShader appears to lose depth precision in its rasterizer, so it is the one place where `reversed` fights more than `reversed-gl`.

How the data was produced: `NULL3D_PORT=20173 bun tests/real-browsers.ts --plan depth Safari Firefox "Google Chrome" "Brave Browser"`, on 30 September 2026 (the run names use UTC), from the worktree of the branch `feat/webgl2-clip-control`. After the image test manifest merged, the depth precision tests moved into it (`depth-precision` on every tier, and `depth-precision-<mode>` on WebGL2). A second run of the depth plan (20260929-203132-depth) gave the same counts in all four browsers. Both runs' results are in the main checkout's `target/runs`. The behavior test `tests/image/depth.spec.ts` gave the same Chrome counts, and the SwiftShader counts with `CI=1`. The unit test `packages/engine/src/gpu/webgl2/depth.test.ts` models the vertex shader's 32-bit arithmetic without the rasterizer. For 100 pairs from 5 to 10 km, only `reversed` ordered every pair; `standard` and `reversed-gl` ordered fewer than half.

Reading the counts: Chrome, Safari and Brave give identical counts, because all three draw WebGL2 through ANGLE on Metal. Firefox draws through Apple's OpenGL. Each tile's count depends on how its surfaces' corner depths round, so a farther tile can fight less than a nearer one (4 km in both modes). The totals over the 11 tiles decide.

## Decision

Proposed, pending the phone and tablet rows:

- Where the browser has `EXT_clip_control`: `reversed`. It fought in the fewest pixels in every browser that has the extension: none, against 5,441 in `reversed-gl` and 16,591 in `standard`, out to 10 km.
- Where it does not: `reversed-gl`. The rule's second clause does not apply, because `reversed-gl` is better than `standard` in all four Mac browsers. It fought in 5,441 pixels against 16,591 in the three ANGLE browsers, and in 9,156 against 14,148 in Firefox, the one browser measured that needs the fallback. In the ANGLE browsers it also keeps the surfaces apart at 250 m, where `standard` already fights in 37% of the pixels.
- `standard` stays a test mode (`?depth=standard`).

The engine already applies this: `webgl2Depth` in `packages/engine/src/page/limits.ts` picks `reversed` where the capability probe finds `EXT_clip_control`, and `DEPTH_WITHOUT_CLIP_CONTROL` (`reversed-gl`) elsewhere. `engine.capabilities.depth` reports the mode. A render context that answers no `EXT_clip_control`, such as one lost while the WebGL2 backend starts, draws `reversed-gl` instead of failing, so the engine's recovery from the loss goes on.

The S24+ (Chrome, run 20260929-074614-checks) and the iPad (Safari, run 20260929-150841-checks; Brave, run 20260929-153640-checks) reported `EXT_clip_control` in earlier capability checks, so they will draw `reversed`. Their rows check that `reversed` also fights least on their GPUs. They add their `reversed-gl` and `standard` counts to the fallback's evidence. Revisit this record if a device's `reversed` row fights more than its `reversed-gl` row, or if a device's `reversed-gl` row is no better than its `standard` row. S24+ Brave has no recorded `EXT_clip_control` answer yet; its depth run records one.

Command that fills the pending rows, from the main checkout on its usual ports (5173 and 5174):

```sh
bun tests/real-browsers.ts --plan depth --allow-no-webgpu --android chrome,brave --lan ipad-safari,ipad-brave --shields on
```

The phone connects by USB with USB debugging on; the runner forwards the port and opens each Android browser's runner page. On the iPad, open `https://<mac>.local:5174/tests/pages/runner.html?listen&runner=ipad-safari` in Safari and `...&runner=ipad-brave` in Brave. Record Brave's Shields with `--shields on` or `--shields off` to match. The run prints one table per browser: the depth each page drew, its fighting pixels, and the share at each distance.

## Consequences

- Code: pull request #47 (https://github.com/null3d-engine/null3d/pull/47, "feat(engine): draw WebGL2 depth with EXT_clip_control where the browser has it", branch `feat/webgl2-clip-control`). It holds the uniform depth mapping in the GLSL build (`crates/null3d-shaders/src/glsl.rs`) and the three modes in the WebGL2 backend (`packages/engine/src/gpu/webgl2/depth.ts`). It also holds the `?depth=` switch, `engine.capabilities.depth`, the precision scene, its image tests, and the runner's `depth` plan.
- Shadows (M1-F2): in `reversed` and `reversed-gl`, depth textures hold WebGPU's depth values, so shadow comparisons and their reference depths work unchanged on WebGL2. Choosing `standard` anywhere would have needed a flipped comparison and a flipped reference in every shader that reads depth.
- Docs: `concepts/backends` has a section on depth on each tier. The mapping entry `logarithmicDepthBuffer / reverseDepthBuffer` points there. `api/engine` lists `DepthMode` and `EngineCapabilities.depth`.
- Follow-ups for M1-L4, the decision records task:
  - Large worlds: reversed depth on WebGL2 too, with clip control.
  - Logarithmic depth: "WebGL2 keeps standard depth unless a clip-control extension exists" becomes `reversed-gl` without the extension.
  - T-29: partial on 2026-09-30 with the Mac data, closed once the S24+ and iPad rows are in.
