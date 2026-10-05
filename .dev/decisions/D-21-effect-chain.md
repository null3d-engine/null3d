# D-21: The effect chain: bloom's method, effects on the 8-bit path, and where ambient occlusion applies

Status: decided for the 8-bit path, 2026-10-03. Decided for ambient occlusion's placement and method, 2026-10-04. Decided again for bloom's method, 2026-10-05: the mip chain, after [D-53](D-53-technique-defaults.md) ruling 1 and prototype P2. Pending: the final chain's GPU time on the Galaxy S25, the Pixel 9 and the Pixel 11 (the `bloom-sizes` plan). Also pending: bloom's and ambient occlusion's cost on the iPad (the `ao` plan). Date: 2026-10-03. Tasks: M2-F1, M2-F2, M2-F7.

## Question

1. How does bloom spread light: the chain of mip levels that most engines draw, or the steps of three.js's `UnrealBloomPass`? With the chain, which base size does each preset take, and in which format? Which side of the canvas sets the size, and how do ports keep their look?
2. Bloom needs the scene's HDR color. On the 8-bit path, the scene shaders tone map their own output. What happens there? The path serves WebGPU's compatibility mode with MSAA, and WebGL2 devices whose float targets fail.
3. Where does ambient occlusion apply (M2-F2)?

## Rule

- Every effect draws on every tier, or the docs name the tier where it is off.
- Bloom uses the best technique as its default ([D-52](D-52-intent-parity.md) part 2). A port maps `UnrealBloomPass`'s, the `bloom()` node's and pmndrs `BloomEffect`'s settings onto it. A sanity comparison with three.js checks that the glow falls in the same places with about the same light; the images keep null3D's own references.
- Bloom adds as little memory traffic as it can. A new render scale and the governor's step make no GPU object.
- On the phones that run a preset, its bloom costs no more GPU time than `UnrealBloomPass`'s steps did. That holds at render scale 1 and at the preset's lowest scale.
- The glow keeps its size as a share of the screen at any pixel ratio, render scale, base size and orientation.
- The owner's answer of 3 October: where a GPU's mode has no HDR target, bloom and AO may move it to HDR color with FXAA.
- Ambient occlusion draws on every tier, with the best image that its cost allows. Its placement costs at most a set share of the GPU time on the presets that turn it on. [D-52](D-52-intent-parity.md) asks a looser sanity comparison of an improved technique. With `GTAOPass`, it checks that the shade falls in the same places and is of the same size.

## Data

### Bloom's method

| Measure | Mip chain (built) | `UnrealBloomPass`'s steps (built before) |
| --- | --- | --- |
| Passes before the final pass | 15 with the default weights: 8 steps down and 7 up. 11 at Low's base of 128, and 9 after the governor's step there | 11: the bright pass, then a blur across and a blur down for each of 5 levels |
| Texture reads per pixel of the canvas, over all passes | 7.6 at 1920 x 1080 with a base of 512; 3.8 on the iPad's 2388 x 1668 at 512; 2.7 on a phone's 540 x 932 at Low's 128 | About 10.8 at any size: 5.5 in the blurs, 0.25 in the bright pass, and 5 in the final pass |
| Reads in the final pass | 1 | 5, one per level |
| Glow's size | A share of the canvas's shorter side, the same at any pixel ratio, render scale, base and orientation | A number of pixels, so it shrinks as the pixel ratio grows and grows at a lower render scale |
| Glow's measures across sizes (P2, bloom scene, strong) | Mean distance 0.437 of the height at 640 x 360, at 1280 x 720 and at render scale 0.5 | 0.467, 0.413 and 0.466 |
| Flicker of small bright points | A Karis average on the first step | None |
| Memory | About 5 MB at a base of 512, whatever the canvas's size; 0.3 MB at 128 on a phone | 0.66 of the scene color's pixels, in its format |

The counts come from `texels_per_pixel` in `crates/null3d-render/src/bloom.rs`. Every engine that the technique review read draws a mip chain, apart from three.js and Babylon.js ([D-53](D-53-technique-defaults.md)).

### The prototype's device timings

Prototype P2 drew the chain beside `UnrealBloomPass`'s steps (branch `proto/p2-bloom`). Its `bloom-p2` plan ran on BrowserStack Automate on 4 October 2026, runs `20261004-192853-bloom-p2` and `20261004-194005-bloom-p2`. Each figure is the GPU time with bloom on less the time with it off, the median of three rounds, on WebGPU. WebGL2 has no GPU timer on these phones. The prototype sized its base on the canvas's height, with 8 levels, so each row has 15 passes.

| Bloom | Galaxy S25 (Adreno) | Pixel 9 (Mali) | Pixel 11 (PowerVR) |
| --- | --- | --- | --- |
| `UnrealBloomPass`'s steps, scale 1 | 1.41 ms | 1.11 ms | 3.21 ms |
| `UnrealBloomPass`'s steps, scale 0.5 | 1.18 ms | 0.92 ms | 2.95 ms |
| Chain, 512 rows, scale 1 | 1.47 ms | 0.98 ms | 4.19 ms |
| Chain, 512 rows, scale 0.5 | 1.57 ms | 1.64 ms | 4.00 ms |
| Chain, 384 rows, scale 1 | 1.38 ms | 0.85 ms | 4.39 ms |
| Chain, 256 rows, scale 1 | 1.31 ms | 0.79 ms | 4.06 ms |

On the S25 the page drew a window of 360 x 621 CSS pixels at a pixel ratio of 3. On the Pixels it drew 411 x 753 at 2.625. At Low's cap of 1.5 the canvases are 540 x 932 and 617 x 1130, in portrait. So the 512-row base held 236 x 512 texels. That is nearly the scene's own size at scale 1, and more than the scene at scale 0.5. The old steps' work follows the render scale, and the chain's does not, so the 512-row chain cost more at scale 0.5. The S25's display ran at 30 Hz through these runs, so its rounds were slower and noisier.

The iPad has not run the plan yet.

### Why the Pixel 11 costs more

The cost on PowerVR does not follow the texels. The 512, 384 and 256-row chains read texels in a ratio of about 4 : 2.3 : 1. Yet they cost 4.19, 4.39 and 4.06 ms, all with 15 passes. The old steps, with 11 passes and more reads, cost 3.21 ms. Both fit a cost of 0.27 to 0.29 ms per render pass. The reads and the target format are a small part of it. A tile GPU finishes each pass before the next pass, which reads it, can start. Adreno and Mali show no such cost per pass: their chain times fall as the base shrinks.

So the passes are the lever on PowerVR. Each halving of the base removes one level and two passes. Low's base of 128 draws 11 passes, as the old steps did, and the governor's step brings it to 9. The engine cannot tell PowerVR apart (hard rule 14), so the preset and the governor do the work. The `bloom-sizes` plan times bases of 512, 256, 128 and 64, with 15, 13, 11 and 9 passes, to confirm the cost per pass.

### The base for each preset

The rule: the base is about half the render's shorter side at the preset's lowest render scale, on the devices that run the preset. A larger base adds cost and no detail that the scene has.

| Preset | Devices | Shorter side of the canvas | Lowest render scale | Half of it at that scale | Base |
| --- | --- | --- | --- | --- | --- |
| Low | Phones, at a pixel ratio of 1.5 | 540 to 620 | 0.5 | 135 to 155 | 128 |
| Medium | Tablets, at 2 | The iPad's 1668 | 0.6 | 500 | 512 |
| High | Desktops, at 2 | 1080 to 1440 | 0.75 | 405 to 540 | 512 |
| Ultra | Desktops | 1080 and up | 1 | 540 and up | 512 |

Low's 128 on the short side is close to the prototype's 256-row chain on the phones: 128 x 221 texels against 118 x 256. That chain cost 1.31 ms on the S25 and 0.79 ms on the Pixel 9, against 1.41 and 1.11 ms for the old steps. Low's chain has 4 fewer passes than that one, and its cost does not follow the render scale. So it should cost no more at scale 0.5 than the old steps' 1.18 and 0.92 ms on those phones. On the Pixel 11 the cost per pass gives about 3.0 to 3.2 ms for 11 passes, against 3.21 ms. The `bloom-sizes` plan checks these estimates.

384 rows, which the plan proposed for Low, keeps neither the glow's size nor a power of two. The glow's widest level would grow by a third. The base never takes more than half the canvas's shorter side, whatever the preset, so a small canvas drops its finest levels too.

### Keeping the glow's size

The glow's size is set by its widest levels, as a share of the screen. A chain whose base is half as large and which has one level fewer ends at the same widest level. Its finest level folds into the base, with the share of the light that the finest levels had. So the reference chain has 10 levels, from 512 texels on the shorter side down to 1. A base of 256 is reference level 1, and so on.

The governor's step uses the same rule. Every level draws into a corner of half its target, so level k takes the size of level k + 1. The passes of the last level do not run. That makes no GPU object. A new `bloomSize` makes the targets again, as a new shadow map size does.

### The shorter side, not the height

Bevy and Filament size the base on the height. On a portrait phone that makes the glow twice as wide, as a share of the width, as on a landscape screen. Turning the phone would change it. three.js's glow spans pixels, the same in both orientations. Sizing on the shorter side keeps the glow the same when the phone turns, and keeps a port's mapping valid in both orientations. On a portrait phone at Low it costs 128 x 221 texels against 74 x 128 on the height for the same detail.

### Ten levels

With 8 levels, the widest spreads light over about a quarter of the shorter side. three.js's widest Gaussian spans about 256 pixels at any canvas size. So on a canvas of 360 pixels the mapped chain could not reach it. The fit's largest gap was 3.4% for the soft test bloom and 8.4% for the strong one. The gap is the largest difference in the share of light within any distance of a bright line. With levels of 2 and 1 texel added, it is 1.0% and 0.4%. A frame draws only the levels up to the last one with a weight. The default gives the two extra levels none, so they cost nothing there.

### The levels' format

The first build kept the levels in the scene color's format, as the old steps did. On the Mac's GPU WebGPU draws the scene in `rg11b10ufloat`, with 6 bits of precision in red and green and 5 in blue. WebGL2 draws it in `rgba16float`. Each level is written twice in a row of dependent steps, and the rounding of those writes adds up.

| Strong test bloom, 640 x 360, WebGL2 against WebGPU | Levels in the scene color's format | Levels in `rgba16float` (built) |
| --- | --- | --- |
| Mean difference in red, green and blue, in steps of 255 | +3.8, +4.1, +7.1 | -0.07, +0.24, +0.11 |
| Pixels that differ by more than 8 steps | 29% | 0.005% |
| Largest difference | 22 | 19, on a shape's edge |

The old steps' references differed by 0.005% too. So the small format lost light, most in blue, and the 16-bit levels fix it. On the Mac they cost 0.07 to 0.13 ms more: one or two steps of the GPU timer. This likely explains the prototype's WebGL2 difference of up to 7 of 255 as well.

### Mapping three.js's settings

The porting skill's `scripts/map-bloom.mjs` holds the mapping, after the prototype's. It runs each source's steps on one row of texels, the response to a bright line one pixel wide. It uses three.js's sizes, taps, weights and bilinear reads. It runs the chain's steps the same way, one response per level. Then it picks each level's share of the glow, by least squares on the light summed outward from the line. A small penalty on uneven shares smooths them, as long as the fit's gap grows by at most half a point. Levels at the wide end with under 1% of the light drop, to save their passes. The source's total weight becomes the intensity: about 8.8 x `strength` for `UnrealBloomPass`.

| Source, at the canvas's shorter side | Largest gap | Half the light within, chain / source | 90% within, chain / source |
| --- | --- | --- | --- |
| `UnrealBloomPass` soft, 360 | 1.4% | 12 / 12 px | 134 / 136 px |
| `UnrealBloomPass` strong, 360 | 0.7% | 35 / 35 px | 237 / 240 px |
| `UnrealBloomPass` soft, 1080 | 0.7% | 12 / 12 px | 136 / 136 px |
| `UnrealBloomPass` strong, 1080 | 0.7% | 35 / 35 px | 238 / 241 px |
| pmndrs `BloomEffect` defaults, 1080 | 0.6% | 19 / 19 px | 326 / 337 px |

Soft is a strength of 0.5, a radius of 0.2 and a threshold of 1; strong 1, 0.8 and 0.8. The smoothed and the plain fits drew the same images. In the test scene they differ by at most 5 of 255, and both lie equally close to three.js. The skill holds tables by radius at 1080, and the script fits any canvas size. The match holds at one canvas size, because three.js's glow spans pixels.

### The sanity comparison with three.js

`bun run parity -- --scene bloom-soft,bloom-strong --tier webgpu,webgl2`, 5 October 2026, with the mapped settings at 640 x 360:

| Test bloom | WebGPU | WebGL2 |
| --- | --- | --- |
| Soft, pixels that differ by three.js's rule | 0.014% | 0.044% |
| Strong, pixels that differ by three.js's rule | 16.8% | 17.1% |

The strong bloom's differences all lie in the faint haze near the frame's edges. three.js's haze fades toward the corners, and the chain keeps light there, as engines that clamp at the edge do. Near the lights the two match. The prototype saw the same, with 3.7% at 1280 x 720, where less of the haze reaches the edges.

The chain keeps that haze by design. Each step up blends the level below into its own level by a mix, and the mixes come from weights that sum to 1. So the steps up keep the glow's light: what the wide levels spread toward the edges stays in the frame. Fading it as three.js does would need a three.js-look step in the core, which [D-52](D-52-intent-parity.md) part 3 rules out. A port that wants less haze lowers `strength` or `radius` before the mapping, or the chain's `intensity` or its widest `weights`.

The owner saw the strong bloom beside three.js's on 5 October 2026, and accepted the look. So the parity scene `bloom-strong` takes a sanity limit of 20% of the pixels (`BLOOM_STRONG_MAX_DIFFERENT_PERCENT` in `bench/lib/parity.ts`), against about 17% measured. `bloom-soft` keeps three.js's own 0.1%.

### Bloom's cost on the Mac

The bloom page of the effect cost test ran in Chrome on the MacBook Pro M5 Max on 5 October 2026. It drew with WebGPU at 1920 x 1080 CSS pixels, a pixel ratio of 1 and the governor off. Each figure is bloom's GPU time, on less off, the median of three rounds, in two runs. The timer counts in steps of about 0.066 ms, and other helpers used the Mac.

| Base | Scale 1 | Scale 0.5 |
| --- | --- | --- |
| 512, the preset's | 0.79, 0.85 ms | 0.79, 0.79 ms |
| 256 | 0.72, 0.72 ms | 0.59, 0.59 ms |
| 128 | 0.66, 0.66 ms | 0.52, 0.52 ms |
| 64 | 0.59, 0.46 ms | 0.52, 0.46 ms |
| 512, levels in `rg11b10ufloat` | 1.38 (one slow round), 0.72 ms | 0.66, 0.72 ms |

The prototype measured the old steps on the same Mac at about 0.6 to 0.7 ms, from 1.11 ms of GPU time with bloom on. WebGL2 has no GPU timer in Chrome.

### Allocation

`bun run bench:allocation --bloom` turns bloom on in S1 and changes its intensity every frame. So the core writes the chain's settings again in each frame. WebGL2 passes within every budget. On WebGPU the replay allocates 1,036 bytes per frame against 207 without bloom. The browser returns a render pass encoder for each of bloom's 15 passes, about 56 bytes each. The check gives `--bloom` a budget of 64 bytes for each of those passes. Nothing else allocates.

### The 8-bit path

| Measure | Bloom off on the 8-bit path | Move to HDR color with FXAA when bloom turns on (built) |
| --- | --- | --- |
| Bloom in compatibility mode with MSAA | None | Draws. The image matches the image of bloom turned on in the setup, pixel for pixel, on every tier |
| Frames until bloom's pipelines are built, live, on the Mac in Chrome | | 2 frames, 66 ms, in compatibility mode. 3 frames, 46 to 48 ms, on core WebGPU and WebGL2, where no switch happens |
| The 99th percentile of frame intervals across the change, live | | 21.0 ms in compatibility mode, against 16.7 ms before it. 16.7 ms on core WebGPU and WebGL2 |
| GPU objects made by the change | | 27 in compatibility mode: bloom's textures, bind groups, buffer and sampler, the scene targets again and the new pipelines. 25 to 27 on the other tiers |
| GPU objects made in the half second after the change | | 0 on every tier |
| Target memory per pixel of the canvas, scene and bloom | 32 bytes: MSAA's 4 samples of 8-bit color and of 32-bit depth | 12 bytes in `rgba16float`: 8 of color and 4 of depth. 8 bytes in `rg11b10ufloat` where the device can draw it. Bloom's levels add about 5 MB at a base of 512, whatever the canvas's size |

The live figures come from `tests/image/bloom-switch.spec.ts` on 3 October 2026, with `UnrealBloomPass`'s steps, which logs them. The memory figures are computed.

A WebGL2 device whose RGBA16F targets fail has no HDR target in any mode, so bloom cannot draw there. The `bloom-8-bit` image test stands in for such a device with the page's switch that turns HDR off. It draws the scene without bloom, within the 8-bit path's usual edge differences: 0.05% of the pixels on the Mac and on SwiftShader. No device in the engine's tests lacks the targets (T-11).

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

The upsample has no pass of its own. The opaque pass reads the four half-size texels around each pixel, weighted by how near their depth lies to its own, within 3%. Where none lies near, as on a thin edge, the nearest one in depth gives the occlusion. So no full-size occlusion target is written or read: each shaded pixel adds four texture reads and their weights. Its cost is inside the figures above, which time ambient occlusion as a whole. No run has timed it apart. Blended materials draw over surfaces that the occlusion saw, so they take none.

| Parity with `GTAOPass`, pixels that differ by three.js's rule | WebGPU | Compatibility mode | WebGL2 |
| --- | --- | --- | --- |
| `GTAOPass`'s defaults (`ao-default`) | 0.036% | 0.036% | 0.040% |
| A wider search, gathered toward the surface, and darker (`ao-wide`) | 0.659% | 0.659% | 0.608% |

`bun run parity -- --scene ao-default,ao-wide --tier webgpu,compat,webgl2`, Chrome 154 on the Mac, 4 October 2026. Both sides draw without anti-aliasing, as the composer's targets have no MSAA. The defaults pass three.js's own limit of 0.1%. The wide search differs along the soft edges of the darkened areas. null3D rebuilds normals from the depth at half size, and three.js reads them from a normal pass at the whole size. The sanity comparison with three.js holds ambient occlusion to 1%. The `ao-*` image tests keep null3D's own references.

One search sample's place matters. A first build read each sample's position at the center of the texel under it. On a flat floor that moved samples off the search's line, so the floor seemed to hide itself, in grain and in bands. three.js keeps the sample's own place on the screen and takes only the depth of the texel under it. The build does the same, and the floor stays clean.

Reading the depth on every tier. Compatibility mode refuses `textureLoad` on WebGPU's depth texture types (the proposal's restriction 16). It also refuses a depth texture with a non-comparison sampler (restriction 20) and copies of multisampled textures (restriction 12). No restriction covers a depth format bound as a plain float texture (`unfilterable-float`). A probe page read a depth target of 1 sample and of 4 samples that way, with `textureLoad`. It ran in Chrome 154 on the Mac's GPU and on SwiftShader, in core WebGPU and in compatibility mode. Each read the depth that the pass wrote. Safari 26.6.2 and Firefox 157 on the Mac passed the same 8 cases; both give a core adapter when asked for compatibility mode. So every WebGPU path binds the depth as unfilterable floats. Compatibility mode needs no copy and no move away from MSAA. WebGL2 has no multisampled textures. Its backend keeps a copy of one sample of a multisampled depth target that a shader reads. It blits into the copy at the end of each render pass that stores the depth.

Where it stays off. Its targets are float: one 32-bit float and two of four 16-bit floats. On WebGL2 they need `EXT_color_buffer_float`, so ambient occlusion draws where the device check's 32-bit float target passes. Elsewhere it stays off, and development builds warn once. It needs no HDR color, so the 8-bit path draws it.

Its preset rows. The quality setting `aoScale` sets its targets' share of the render size. It is half on High and Ultra, which desktops run, and 0, off, on Low and Medium. A sketch turns it on with `post.set({ ao })`, as three.js adds `GTAOPass`. On Low and Medium it draws only after `quality.set({ aoScale })`. The governor's last step halves the scale to a quarter while it draws.

## Decision

1. Bloom draws a mip chain, and it is the only bloom in the core. The first step down limits the scene color to 65,472 and keeps what passes the threshold and its soft knee. It takes a 13-tap filter with a normalized Karis average. Later steps take the 13-tap filter alone. Each step up blends a 3 x 3 tent of the level below into its own level by a mix, through premultiplied blending. The final pass reads the base once, and mixes, adds or screens it in.
   - Public settings: `intensity` (0.15), `threshold` (0), `knee` (0.1), `blend` (`'mix'`, energy-conserving), and `weights`, each of 10 reference levels' share of the glow. The default weights are the shares of Bevy's natural preset over 8 levels. The mixes of the steps up come from the weights, so no extra uniform layout or binding is needed.
   - The levels have the canvas's shape and a fixed number of texels on its shorter side, at most half of it. The quality setting `bloomSize` sets the base: 128 on Low, 512 on Medium, High and Ultra. The governor's step halves it once, by corners, with no GPU object.
   - The levels are always `rgba16float`.
   - The frame writes the settings only when an input changes, and finds the textures by name once per compile of the graph.
   - It meets the rules. It reads fewer texels than the old steps at every canvas size of the presets, and the final pass reads one texture. A new render scale and the governor's step make no GPU object, and the glow keeps its size. Low's chain should cost no more than the old steps on the phones, by the prototype's figures; the `bloom-sizes` plan confirms it. The mapping reaches `UnrealBloomPass`'s and pmndrs's look within the sanity comparison, so the `three-compat` add-on needs no `UnrealBloomPass` halo.
2. On the 8-bit path that serves only MSAA, turning bloom on moves the engine to HDR color with FXAA. It stays there for the rest of its life. One place decides both outputs, `effectsOutput` in `page/limits.ts`, so the start and the move agree. Where the device has no HDR target in any mode, bloom stays off, and development builds warn once. The docs name that case.
3. Ambient occlusion darkens the ambient light in the opaque pass, as the plan drew it. That gives the better image. Occlusion measures how much of the light from around a point reaches it, so it belongs to the ambient light. Direct light and highlights stay bright in the shade, where `GTAOPass` darkens them too. The placement costs the depth prepass, which is close to nothing in the parity scene on the Mac. It draws on the 8-bit path with no HDR color. The method is GTAO at half size, with three.js's kernels and denoise: a horizon search whose authors built it to match ray-traced occlusion. It costs 46% of `GTAOPass`'s GPU time on the same scene. With `GTAOPass`'s defaults, 0.04% of the pixels differ, so the shade falls in the same places at the same strength. The upsample is the opaque pass's depth-weighted read of four texels, with no pass of its own. It has not been timed apart from the rest. The iPad's figures from the `ao` plan can reopen the placement. The proposed rule: the prepass takes at most 10% of the iPad's GPU time where a preset turns ambient occlusion on.

## How the move works

- The page computes the start's scene color and anti-aliasing mode and the effects' pair once, with the same function. A device that may move asks its WebGPU device for `rg11b10ufloat-renderable` at the start when the effects' format needs it.
- The sketch thread watches `post.set`'s bloom. When bloom first turns on there, it calls the core's `setCanvasOutput`. The core gives its frame graph the new format and samples. It declares the passes again and rebuilds the draw tables, whose pipelines take the new targets. The plan's textures that changed are made again under their ids, and the backends release the old ones.
- The new pipelines lack the tone mapping bit, whose builds the device's shader module does not hold. When a pipeline first asks for one, the thread that draws loads the module of those fixed bits (`gpu/device-shaders.ts`). It adds that module's builds to the shaders it holds. Until then the pipeline waits, as a custom material's pipeline waits for its shader.
- The frame of the move holds the screen as a preset change does (`Slot.PipelineHold`). The thread that draws keeps the frame before on screen until the new pipelines are built. Hold mode draws its frame once every pipeline is built, so the `bloom-later` image test matches `bloom-strong` exactly.
- The move is one way. Going back to MSAA when bloom turns off would build every pipeline a third time, for edges that FXAA already smooths.

## Options rejected

- `UnrealBloomPass`'s steps in the core, or as a mode. Its glow follows the pixel ratio and the render scale, it reads more texels on every preset's canvas, and its final pass reads five textures. The mapping reaches its look, so no mode stays (D-53 ruling 1).
- Levels in the scene color's format. On WebGPU's `rg11b10ufloat` the chain lost light, most in blue, and drew differently from WebGL2.
- A base sized on the height, as Bevy and Filament do. Turning a phone would change the glow's size.
- A base of 384 on Low. It is no power of two, so the glow's widest level would grow by a third. It also cost more than 256 rows on all three phones.
- Filament's mobile kernels on Low. The Pixel 11's cost is in its passes, not its reads. On Adreno and Mali the chain at Low's size already costs less than the old steps. Fewer passes, through a smaller base, do more.
- A base that follows the render scale during play. It would make targets at each new scale, or need a second set of corners, for a glow whose cost hardly follows the scale.
- A three.js `UnrealBloomPass` halo in the `three-compat` add-on. The mapped chain stays within the sanity comparison on the test scenes.

- Bloom on the 8-bit path's display color. The scene shaders clip color at white before bloom could see it, so an emissive light at 12 glows as one at 1. Its levels would also be 8-bit, which bands in the dark tails of a glow.
- Bloom off in compatibility mode with MSAA, with the docs naming the tier. The owner allowed the move, and the image tests' presets use MSAA there, so no test would draw bloom in that mode.
- An option of `createEngine` that names the effects a page will use, so the engine starts on HDR color. A page rarely knows its sketch's effects, and the move costs two frames once.
- A composite pass at half size that sums the levels, as three.js draws. It writes and reads a half-size target once more per frame, to save four texture reads per pixel in the final pass.
- `rgba16float` levels on devices whose scene color is `rg11b10ufloat`. The soft image differed between WebGPU and WebGL2 in 1.24% of its pixels with the smaller format and in 1.04% with the larger one. The cause was a sphere whose luminance sat on the threshold, which the test scene no longer has. The smaller format halves the levels' memory and traffic.

## Notes for later effects

- Below a render scale of 1, WebGPU draws a corner of a target into its first rows. WebGL2 counts rows from the bottom and draws the corner into its last ones. Every effect step that reads another step's target must place the corner on each path. Bloom's blocks carry the corner's origin for that: its first step reads the scene's corner, and after the governor's step every level draws a corner.
- A draw never samples the target that it draws into. Bloom's step up blends into its level's target through the blend state and samples only the level below. The graph's reads "so far" let each step down read its source before the step up blends into it.
- The governor's step halves bloom's base once while bloom is on ([D-11](D-11-frames-in-flight.md)).

## Notes for ambient occlusion

- The steps' settings live in one uniform block of 208 bytes. A frame uploads it only when a setting, the camera's lens, the canvas, the render scale or the occlusion's scale changed. A new scale draws a corner of the same targets and makes no GPU object.
- While ambient occlusion is on, the camera's depth prepass draws in a render pass of its own. The pass has a stand-in color target of the scene color's format, which no pass reads. Its render pass drops that target, which shares a texture with the scene color, whose life starts later. So the prepass's pipelines need no second build for a pass without color. The render graph's reads "so far" (M2-I1) let the depth step read the depth between the prepass and the opaque pass.
- Turning ambient occlusion on or off adds or removes the prepass and the steps. The frame holds the screen while the pipelines build, as bloom's move does.
- Every opaque object must be in the prepass, or it has no depth for ambient occlusion. Custom materials and sprites were left out, so they now draw their prepass depth with their own vertex shader on both paths ([D-43](D-43-webgl2-prepass.md#custom-materials-and-sprites)). The `ao-custom` image test checks a custom material whose vertex offset swells a sphere.

## Consequences

- Code: `crates/null3d-render/src/bloom.rs`, `Size::ShortSide` in `graph.rs`, the frame graph's bloom passes and `setCanvasOutput`, `wgsl/bloom.wgsl` and the final pass's `BLOOM` build, the `bloomSize` quality setting and the governor's bloom step, `effectsOutput` in `page/limits.ts`, and `gpu/device-shaders.ts`.
- Ambient occlusion's code: `crates/null3d-render/src/ao.rs`, the frame graph's ambient occlusion passes, `wgsl/ao.wgsl` and `wgsl/lib/gtao.wgsl`. Also the frame uniform's `occlusion` values, the frame group's binding 11, the `aoScale` quality setting and the governor's step. Also `occlusionTargets` in `page/limits.ts`, and the WebGL2 backend's copy of a multisampled depth.
- Ambient occlusion's tests: the `ao-*` image tests, the parity scenes `ao-default` and `ao-wide`, `crates/null3d-render/tests/ambient_occlusion.rs`, and the `ao` device plan with its three.js page.
- Tests: the bloom image tests with null3D's own references, `bloom-switch.spec.ts` and the render scale test with bloom. Also the parity scenes `bloom-soft` and `bloom-strong` as sanity comparisons, and `bench:allocation --bloom`. Also the mapping's tests in `tools/lib/bloom-mapping.test.ts`, and the `bloom` and `bloom-sizes` device plans.
- Docs: `concepts/post-processing`, `api/post`, `api/quality`, `concepts/quality-presets`, `concepts/color-management`, `concepts/backends`, the mapping's composer and bloom entries, and both skills. The porting skill's `references/post-processing.md` holds the bloom tables, and its `scripts/map-bloom.mjs` the mapping.

## History

- 2026-10-03: decision 1 chose `UnrealBloomPass`'s steps, to keep a port's numbers and its look, with 0.000% of the pixels apart from three.js.
- 2026-10-04: [D-52](D-52-intent-parity.md) withdrew that rule, and [D-53](D-53-technique-defaults.md) ruling 1 chose the mip chain, after prototype P2 set its settings.
- 2026-10-05: M2-F7 built the chain as the only bloom, as decision 1 now says.
- 2026-10-05: the owner accepted the strong bloom's wider edge haze, about 17% of the pixels apart from three.js, with a sanity limit of 20%.
