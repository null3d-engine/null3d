# D-21: The effect chain: bloom's method, effects on the 8-bit path, and where ambient occlusion applies

Status: decided for bloom's method and the 8-bit path, 2026-10-03. Decided for ambient occlusion's placement and method, 2026-10-04. Pending: bloom's cost on the iPad and the S24+ (the `bloom` plan), and ambient occlusion's on the iPad (the `ao` plan). Date: 2026-10-03. Tasks: M2-F1, M2-F2.

## Question

1. How does bloom spread light: the chain of half-size steps down and back up that the plan drew, or the steps of three.js's `UnrealBloomPass`?
2. Bloom needs the scene's HDR color. On the 8-bit path, the scene shaders tone map their own output. What happens there? The path serves WebGPU's compatibility mode with MSAA, and WebGL2 devices whose float targets fail.
3. Where does ambient occlusion apply (M2-F2)?

## Rule

- Every effect draws on every tier, or the docs name the tier where it is off.
- A port that copies `UnrealBloomPass`'s strength, radius and threshold keeps its look: the parity test passes three.js's rule, under 0.1% of the pixels.
- Bloom adds as little memory traffic as it can, and a new render scale makes no GPU object.
- The owner's answer of 3 October: where a GPU's mode has no HDR target, bloom and AO may move it to HDR color with FXAA.
- Ambient occlusion: a port that copies `GTAOPass`'s settings keeps its look within a recorded parity limit, and it draws on every tier. Its placement costs at most a set share of the GPU time on the presets that turn it on.

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

Pending: the `bloom` plan on the iPad and the S24+ ([device sessions](../devices.md#the-effect-cost-plans)). It measures each GPU path at render scales of 1 and 0.5, with bloom off and on in turns. The task asks for the iPad's GPU time at both scales and the S24+'s frame time.

### Ambient occlusion

Where it applies. The plan's design reads the depth before the opaque pass, so the opaque pass multiplies only its ambient light by the occlusion. three.js's `GTAOPass` runs after the scene and multiplies the whole image, direct light included. The two give the same image where ambient light alone lights a surface. The engine's parity scene (`bench/scenes/ao.ts`) has ambient light alone, so the images compare like with like.

The occlusion is ready before the opaque pass only if the depth is. So the depth prepass runs while ambient occlusion is on, also on presets that leave the prepass off. Applying it after shading would need no prepass. The extra cost of this placement is therefore the prepass's.

| Measure | Applied to ambient light (built) | Applied after shading, as `GTAOPass` |
| --- | --- | --- |
| What darkens | The ambient light and light maps | The whole image, direct light and highlights included |
| Needs the depth prepass | Yes | No: it reads the opaque pass's depth |
| Draws on the 8-bit path | Yes: the opaque pass applies it, so it needs no HDR color | Only through the final pass, which the 8-bit path with MSAA does not run |
| GPU time on the Mac, WebGPU, 3,024 x 1,518, render scale 1 | 2.42 ms more than without it | About 2.42 ms less the prepass's cost: the steps are the same |
| The prepass's share of it in the parity scene | Close to 0: with the prepass on in both halves, ambient occlusion still adds 2.42 ms | |

The figures are medians of 4 to 5 runs of the `ao` plan in Chrome 154 on the MacBook Pro M5 Max, 4 October 2026. The runs are `20261004-030442-ao` to `20261004-031836-ao`. Each page plays 2 s with ambient occlusion off and 2 s with it on, three times each, with the governor off. At render scale 0.5 ambient occlusion adds 1.18 ms, and its passes alone about 1.0 ms. Chrome's GPU timer counts in steps of about 0.07 ms. Other helpers used the Mac during the runs, so single runs differed by up to 0.7 ms. WebGL2 has no GPU timer in Chrome; its frames kept the display's 120 Hz with ambient occlusion on.

The prepass's own cost grows with the scene's vertices: in S2 it made the GPU time per frame 0.12 ms longer on the Mac (D-43). The iPad's figures, which the rule asks for, come from the `ao` plan on the iPad.

Against three.js. The `ao` plan also draws `GTAOPass` with its defaults on the same scene and canvas (`bench/pages/threejs/ao-cost.html`). It added 4.38, 5.79 and 5.27 ms in three runs, by WebGL2's timer queries. null3D's added 2.42 ms in each, so it costs about 46% of three.js's.

How it is found. The steps follow `GTAOPass` at half the render size each way:

| Step | What it does | Target |
| --- | --- | --- |
| Depth | Copies the prepass's depth of the pixel under each texel. With MSAA, sample 0 | `r32float` |
| Horizon | three.js's GTAO: the normal rebuilt from the depth around the texel, then the horizons along 3 slices of 6 steps each side for 16 samples. The 5 x 5 magic square turns the slices from texel to texel | `rgba16float`: the occlusion and the normal |
| Denoise | three.js's Poisson denoise: 16 taps in 2 rings, weighted by occlusion, distance from the texel's plane and normal | `rgba16float`: the occlusion and the depth |

The opaque pass reads the four texels around each pixel, weighted by how near their depth lies to its own, within 3%. Where none lies near, as on a thin edge, the nearest one in depth gives the occlusion. Blended materials draw over surfaces that the occlusion saw, so they take none.

| Parity with `GTAOPass`, pixels that differ by three.js's rule | WebGPU | Compatibility mode | WebGL2 |
| --- | --- | --- | --- |
| `GTAOPass`'s defaults (`ao-default`) | 0.036% | 0.036% | 0.040% |
| A wider search, gathered toward the surface, and darker (`ao-wide`) | 0.659% | 0.659% | 0.608% |

`bun run parity -- --scene ao-default,ao-wide --tier webgpu,compat,webgl2`, Chrome 154 on the Mac, 4 October 2026. Both sides draw without anti-aliasing, as the composer's targets have no MSAA. The defaults pass three.js's own limit of 0.1%. The wide search differs along the soft edges of the darkened areas. null3D rebuilds normals from the depth at half size, and three.js reads them from a normal pass at the whole size. The parity check holds ambient occlusion to 1%.

One search sample's place matters. A first build read each sample's position at the center of the texel under it. On a flat floor that moved samples off the search's line, so the floor seemed to hide itself, in grain and in bands. three.js keeps the sample's own place on the screen and takes only the depth of the texel under it. The build does the same, and the floor stays clean.

Reading the depth on every tier. Compatibility mode refuses `textureLoad` on WebGPU's depth texture types (the proposal's restriction 16). It also refuses a depth texture with a non-comparison sampler (restriction 20) and copies of multisampled textures (restriction 12). No restriction covers a depth format bound as a plain float texture (`unfilterable-float`). A probe page read a depth target of 1 sample and of 4 samples that way, with `textureLoad`. It ran in Chrome 154 on the Mac's GPU and on SwiftShader, in core WebGPU and in compatibility mode. Each read the depth that the pass wrote. Safari 26.6.2 and Firefox 157 on the Mac passed the same 8 cases; both give a core adapter when asked for compatibility mode. So every WebGPU path binds the depth as unfilterable floats. Compatibility mode needs no copy and no move away from MSAA. WebGL2 has no multisampled textures. Its backend keeps a copy of one sample of a multisampled depth target that a shader reads. It blits into the copy at the end of each render pass that stores the depth.

Where it stays off. Its targets are float: one 32-bit float and two of four 16-bit floats. On WebGL2 they need `EXT_color_buffer_float`, so ambient occlusion draws where the device check's 32-bit float target passes. Elsewhere it stays off, and development builds warn once. It needs no HDR color, so the 8-bit path draws it.

Its preset rows. The quality setting `aoScale` sets its targets' share of the render size. It is half on High and Ultra, which desktops run, and 0, off, on Low and Medium. A sketch turns it on with `post.set({ ao })`, as three.js adds `GTAOPass`. On Low and Medium it draws only after `quality.set({ aoScale })`. The governor's last step halves the scale to a quarter while it draws.

## Decision

1. Bloom runs `UnrealBloomPass`'s steps. With three.js's steps, kernels and weights, a port's numbers keep their look. The parity test passes three.js's rule on every GPU path, with 0.000% of the pixels. The plan's chain down and back up reads about a quarter fewer texels for a glow as wide. But it needs 15 passes against 11, and it gives the glow another shape. With 5 levels its glow is about six times narrower. Four of the extra reads per pixel fall in the final pass, on the levels of a quarter size and below. The final pass reads the levels itself, so the chain has no composite pass of its own. The `bloom` plan's figures from the iPad and the S24+ can reopen this choice.
2. On the 8-bit path that serves only MSAA, turning bloom on moves the engine to HDR color with FXAA. It stays there for the rest of its life. One place decides both outputs, `effectsOutput` in `page/limits.ts`, so the start and the move agree. Where the device has no HDR target in any mode, bloom stays off, and development builds warn once. The docs name that case.
3. Ambient occlusion darkens the ambient light in the opaque pass, as the plan drew it. It costs the depth prepass, which is close to nothing in the parity scene on the Mac. It draws on the 8-bit path with no HDR color. It also keeps direct light and highlights bright in the shade, where `GTAOPass` darkens them. The steps are `GTAOPass`'s at half size, with its settings, kernels and denoise. So a port keeps its look: 0.04% of the pixels differ with its defaults. They cost 46% of `GTAOPass`'s GPU time on the same scene. The iPad's figures from the `ao` plan can reopen the placement. The proposed rule: the prepass takes at most 10% of the iPad's GPU time where a preset turns ambient occlusion on.

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

## Notes for ambient occlusion

- The steps' settings live in one uniform block of 208 bytes. A frame uploads it only when a setting, the camera's lens, the canvas, the render scale or the occlusion's scale changed. A new scale draws a corner of the same targets and makes no GPU object.
- While ambient occlusion is on, the camera's depth prepass draws in a render pass of its own. The pass has a stand-in color target of the scene color's format, which no pass reads. Its render pass drops that target, which shares a texture with the scene color, whose life starts later. So the prepass's pipelines need no second build for a pass without color. The render graph's reads "so far" (M2-I1) let the depth step read the depth between the prepass and the opaque pass.
- Turning ambient occlusion on or off adds or removes the prepass and the steps. The frame holds the screen while the pipelines build, as bloom's move does.

## Consequences

- Code: `crates/null3d-render/src/bloom.rs`, the frame graph's bloom passes and `setCanvasOutput`, `wgsl/bloom.wgsl` and the final pass's `BLOOM` build, the `bloomSamples` quality setting and the governor's bloom steps, `effectsOutput` in `page/limits.ts`, and `gpu/device-shaders.ts`.
- Ambient occlusion's code: `crates/null3d-render/src/ao.rs`, the frame graph's ambient occlusion passes, `wgsl/ao.wgsl` and `wgsl/lib/gtao.wgsl`. Also the frame uniform's `occlusion` values, the frame group's binding 11, the `aoScale` quality setting and the governor's step. Also `occlusionTargets` in `page/limits.ts`, and the WebGL2 backend's copy of a multisampled depth.
- Ambient occlusion's tests: the `ao-*` image tests, the parity scenes `ao-default` and `ao-wide`, `crates/null3d-render/tests/ambient_occlusion.rs`, and the `ao` device plan with its three.js page.
- Tests: the bloom image tests, `bloom-switch.spec.ts`, the render scale test with bloom, the parity scenes `bloom-soft` and `bloom-strong`, and the `bloom` device plan.
- Docs: `concepts/post-processing`, `api/post`, `concepts/color-management`, `concepts/backends`, the mapping's composer and bloom entries, and both skills.
