# D-21: The effect chain: bloom's method, and effects on the 8-bit path

Status: decided for bloom's method and the 8-bit path, 2026-10-03; bloom's cost on the iPad and the S24+ pending the `bloom` plan. Where ambient occlusion applies comes with M2-F2. Date: 2026-10-03. Task: M2-F1.

## Question

1. How does bloom spread light: the chain of half-size steps down and back up that the plan drew, or the steps of three.js's `UnrealBloomPass`?
2. Bloom needs the scene's HDR color. On the 8-bit path, the scene shaders tone map their own output. What happens there? The path serves WebGPU's compatibility mode with MSAA, and WebGL2 devices whose float targets fail.
3. Where does ambient occlusion apply (M2-F2)?

## Rule

- Every effect draws on every tier, or the docs name the tier where it is off.
- A port that copies `UnrealBloomPass`'s strength, radius and threshold keeps its look: the parity test passes three.js's rule, under 0.1% of the pixels.
- Bloom adds as little memory traffic as it can, and a new render scale makes no GPU object.
- The owner's answer of 3 October: where a GPU's mode has no HDR target, bloom and AO may move it to HDR color with FXAA.

## Data

### Bloom's method

| Measure | Down and back up (the plan) | `UnrealBloomPass`'s steps (built) |
| --- | --- | --- |
| Passes before the final pass | 15 for a glow as wide as three.js's: 8 levels down and 7 back up. 9 with 5 levels, whose widest glow is about 6 times narrower | 11: the bright pass, then a blur across and a blur down for each of 5 levels |
| Texture reads per pixel of the canvas, counted over all passes | About 8.3 with 8 levels: 13 per pixel of each step down, 9 per pixel of each step up, and 1 in the final pass | About 10.8: 5.5 in the blurs, 0.25 in the bright pass, and 5 in the final pass, which reads each level once |
| Widest blur, as the standard deviation in pixels of the canvas | About 40 with 5 levels, estimated from the filters' widths | About 250: three.js's kernels of 6 to 22 taps, each with a third of its taps as sigma, at 1/2 to 1/32 size |
| Pixels that differ from three.js by its rule, on the Mac in Chrome | Not built: its glow has another shape | 0.000% on WebGPU, compatibility mode and WebGL2, at both test settings |

The counts are per pixel of the canvas at render scale 1. A pass at half size draws a quarter of the pixels. The final pass reads all five levels itself, so the chain needs no composite pass, and three.js's blend pass becomes the final pass's addition.

The parity test (`bun run parity -- --scene bloom-soft,bloom-strong --tier webgpu,compat,webgl2`, 3 October 2026) compares null3D's `bloom-soft` and `bloom-strong` images with the twin `bench/pages/threejs/bloom.html`. The twin draws the same scene (`bench/scenes/bloom.ts`) with an `EffectComposer`: a `RenderPass`, an `UnrealBloomPass` with the same settings, and an `OutputPass` with ACES. Both sides draw without anti-aliasing, as the composer's targets have no MSAA.

### The 8-bit path

| Measure | Bloom off on the 8-bit path | Move to HDR color with FXAA when bloom turns on (built) |
| --- | --- | --- |
| Bloom in compatibility mode with MSAA | None | Draws. The image matches the image of bloom turned on in the setup, pixel for pixel, on every tier |
| Frames until bloom's pipelines are built, live, on the Mac in Chrome | | 2 frames, 66 ms, in compatibility mode. 3 frames, 46 to 48 ms, on core WebGPU and WebGL2, where no switch happens |
| The 99th percentile of frame intervals across the change, live | | 21.0 ms in compatibility mode, against 16.7 ms before it. 16.7 ms on core WebGPU and WebGL2 |
| GPU objects made by the change | | 27 in compatibility mode: bloom's textures, bind groups, buffer and sampler, the scene targets again and the new pipelines. 25 to 27 on the other tiers |
| GPU objects made in the half second after the change | | 0 on every tier |
| Target memory per pixel of the canvas, scene and bloom | 32 bytes: MSAA's 4 samples of 8-bit color and of 32-bit depth | 17.3 bytes in `rgba16float`: 8 of color, 4 of depth and 5.3 of bloom's levels. 10.7 bytes in `rg11b10ufloat` where the device can draw it |

The live figures come from `tests/image/bloom-switch.spec.ts` on 3 October 2026, which logs them. The memory figures are computed. Bloom's targets are a half-size pair, a quarter-size pair, and so on, in the scene color's format. Together they cover 0.66 of the canvas's pixels.

A WebGL2 device whose RGBA16F targets fail has no HDR target in any mode, so bloom cannot draw there. The `bloom-8-bit` image test stands in for such a device with the page's switch that turns HDR off. It draws the scene without bloom, within the 8-bit path's usual edge differences: 0.05% of the pixels on the Mac and on SwiftShader. No device in the engine's tests lacks the targets (T-11).

### Bloom's cost

Pending: the `bloom` plan on the iPad and the S24+ ([device sessions](../devices.md#the-bloom-plan)). It measures each GPU path at render scales of 1 and 0.5, with bloom off and on in turns. The task asks for the iPad's GPU time at both scales and the S24+'s frame time.

## Decision

1. Bloom runs `UnrealBloomPass`'s steps. With three.js's steps, kernels and weights, a port's numbers keep their look. The parity test passes three.js's rule on every GPU path, with 0.000% of the pixels. The plan's chain down and back up reads about a quarter fewer texels for a glow as wide. But it needs 15 passes against 11, and it gives the glow another shape. With 5 levels its glow is about six times narrower. Four of the extra reads per pixel fall in the final pass, on the levels of a quarter size and below. The final pass reads the levels itself, so the chain has no composite pass of its own. The `bloom` plan's figures from the iPad and the S24+ can reopen this choice.
2. On the 8-bit path that serves only MSAA, turning bloom on moves the engine to HDR color with FXAA. It stays there for the rest of its life. One place decides both outputs, `effectsOutput` in `page/limits.ts`, so the start and the move agree. Where the device has no HDR target in any mode, bloom stays off, and development builds warn once. The docs name that case.
3. Ambient occlusion: M2-F2 adds its section here.

## How the move works

- The page computes the start's scene color and anti-aliasing mode and the effects' pair once, with the same function. A device that may move asks its WebGPU device for `rg11b10ufloat-renderable` at the start when the effects' format needs it.
- The sketch thread watches `post.set`'s bloom. When bloom first turns on there, it calls the core's `setCanvasOutput`. The core gives its frame graph the new format and samples. It declares the passes again and rebuilds the draw tables, whose pipelines take the new targets. The plan's textures that changed are made again under their ids, and the backends release the old ones.
- The new pipelines lack the tone mapping bit, whose builds the device's shader module does not hold. When a pipeline first asks for one, the thread that draws loads the module of those fixed bits (`gpu/device-shaders.ts`). It adds that module's builds to the shaders it holds. Until then the pipeline waits, as a custom material's pipeline waits for its shader.
- The frame of the move holds the screen as a preset change does (`Slot.PipelineHold`). The thread that draws keeps the frame before on screen until the new pipelines are built. Hold mode draws its frame once every pipeline is built, so the `bloom-later` image test matches `bloom-strong` exactly.
- The move is one way. Going back to MSAA when bloom turns off would build every pipeline a third time, for edges that FXAA already smooths.

## Options rejected

- Bloom on the 8-bit path's display color. The scene shaders clip color at white before bloom could see it, so an emissive light at 12 glows as one at 1. Its levels would also be 8-bit, which bands in the dark tails of a glow.
- Bloom off in compatibility mode with MSAA, with the docs naming the tier. The owner allowed the move, and the image tests' presets use MSAA there, so no test would draw bloom in that mode.
- An option of `createEngine` that names the effects a page will use, so the engine starts on HDR color. A page rarely knows its sketch's effects, and the move costs two frames once.
- A composite pass at half size that sums the levels, as three.js draws. It writes and reads a half-size target once more per frame, to save four texture reads per pixel in the final pass.
- `rgba16float` levels on devices whose scene color is `rg11b10ufloat`. The soft image differed between WebGPU and WebGL2 in 1.24% of its pixels with the smaller format and in 1.04% with the larger one. The cause was a sphere whose luminance sat on the threshold, which the test scene no longer has. The smaller format halves the levels' memory and traffic.

## Notes for later effects

- Below a render scale of 1, WebGPU draws a corner of a target into its first rows. WebGL2 counts rows from the bottom and draws the corner into its last ones. Every effect step that reads another step's target must place the corner on each path. Bloom's blocks carry the corner's origin for that.
- A step never reads the target that it draws into. The graph gives each step a target of its own. It shares memory only between targets whose lifetimes do not overlap, as a draw that reads its own target faults on some GPUs.
- The governor's last steps halve bloom's samples, down to a quarter, while bloom is on ([D-11](D-11-frames-in-flight.md)).

## Consequences

- Code: `crates/null3d-render/src/bloom.rs`, the frame graph's bloom passes and `setCanvasOutput`, `wgsl/bloom.wgsl` and the final pass's `BLOOM` build, the `bloomSamples` quality setting and the governor's bloom steps, `effectsOutput` in `page/limits.ts`, and `gpu/device-shaders.ts`.
- Tests: the bloom image tests, `bloom-switch.spec.ts`, the render scale test with bloom, the parity scenes `bloom-soft` and `bloom-strong`, and the `bloom` device plan.
- Docs: `concepts/post-processing`, `api/post`, `concepts/color-management`, `concepts/backends`, the mapping's composer and bloom entries, and both skills.

## Addendum, 2026-10-04: bloom's method is open again

The owner's decision of 4 October 2026 ([D-52](D-52-intent-parity.md)) withdraws this record's second rule. A port no longer keeps three.js's look by default. Each effect uses the best technique as its default, and the porting skill maps a port's settings onto it. So decision 1 is open again. The chain down and back up is cheaper per pixel, as the table above shows, and it flickers less on small bright points. The halo of `UnrealBloomPass` is a candidate for the opt-in `three-compat` add-on module. The combined technique analysis settles the default. Decision 2, the 8-bit path, stands.
