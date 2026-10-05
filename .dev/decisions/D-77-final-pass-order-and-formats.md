# D-77: The final pass's order, the dither and the WebGL2 scene format

Status: decided for the vignette and the dither, 2026-10-05. The WebGL2 scene format waits on prototype P3's phone runs. Date: 2026-10-05. Task: M2-F9.

## Question

1. [D-53](D-53-technique-defaults.md) ruling 3 moves the vignette into HDR, before the tone curve. What are its settings, and how does a port of three.js's `VignetteShader` keep its look?
2. Where does the dither run, with what noise, and how deep?
3. Does WebGL2 draw scene color in `R11F_G11F_B10F`, as core WebGPU draws `rg11b10ufloat`?

## Rule

- The vignette multiplies HDR color before the tone curve, as Filament, URP, Bevy and Babylon.js do. A port maps `VignetteShader`'s `offset` to a size and `darkness` to an intensity (D-53, the analysis's porting table).
- The dither runs last, after the color grading table and the vignette, with static triangle noise of one step, as Filament and URP do. Prototype P5 checks it: a dark vignette over a flat color draws with no bands.
- WebGL2 takes `R11F_G11F_B10F` where the canvas is opaque and the probe passes, if prototype P3 shows that it costs no more and draws a dark gradient without bands on the cloud phones. Accumulation history keeps `rgba16float`.
- No new pipeline, no new full-screen pass, no allocation in the frame loop.

## Data

### The vignette's falloff

The first build used three.js's falloff, `1 - d²`, as a multiply of linear color. It darkened much less than three.js: `VignetteShader` multiplies display color, and a display factor f is about f^2.2 in linear color. On the grading scene with `VignetteShader`'s offset 1.2 and darkness 1.1, the top-left corner was sRGB (90, 99, 102) against three.js's (40, 42, 40). A falloff power of 2 brings the look back: against the old references, which drew three.js's formula, the `vignette` test differs in 1.32% of its pixels at the image tests' threshold on the Mac's WebGPU and WebGL2, and `lut-vignette` in 1.11 to 1.13%. So the default falloff is 2.

The parity scenes against three.js's `LUTPass` and `VignetteShader`, Chrome on the Mac's GPU, 5 October 2026 (`bun run parity -- --scene lut-cube,lut-vignette --tier webgpu,compat,webgl2`):

| Scene | Core WebGPU | Compatibility mode | WebGL2 |
| --- | --- | --- | --- |
| `lut-cube`: the table alone, three.js's rule | 0.000% | 0.000% | 0.000% |
| `lut-vignette`: the table at 0.7, then the vignette (offset 1.2, darkness 1.1 mapped) | 1.136% | 1.136% | 1.095% |

Only the outer corners differ: with a darkness above 1, three.js's blend passes black sooner. `lut-vignette` becomes a sanity comparison with a limit of 2% (`VIGNETTE_MAX_DIFFERENT_PERCENT`). A missing vignette differs in tens of percent.

### The 8-bit path

The 8-bit path holds display color, so the vignette multiplies the linear value of the display color there, before the outline. The tone curve bends between the two, so the 8-bit image differs from the HDR one a little. On `dark-vignette`, no pixel differs past pixelmatch's threshold, and no channel by more than 10 steps, on the Mac's GPU and on SwiftShader. `lut-vignette-8-bit` stays within its 3% tolerance against `lut-vignette`.

### The dither

| | Before | Now |
| --- | --- | --- |
| Noise | White noise from a hash of the pixel, one value for all channels | Triangle noise: the sum of the two 16-bit halves of the same hash, less 1 |
| Depth | Half a step: a color that 8 bits hold exactly kept its value | One step: noise of the same strength at every value (Mikkel Gjoel, "Banding in Games", 2016) |
| Place | In the output transform, before the table and the vignette | Last, after the table, the vignette and the outline |
| 8-bit path | The scene shaders dither | The scene shaders dither with the new noise, and the final pass dithers again only where it changes the color: with a table or the vignette |

The noise stays static, so hold-mode images stay the same from run to run.

Image tests whose tolerance counts every changed pixel needed new references: `cells` (and its three far-out tests), `debug` (and `debug-1000km`), `ortho-camera` (and `ortho-camera-1000km`) and `vertex-types-float` (and `vertex-types`). The Galaxy S24's own `debug` reference (`sm-s926b`) is from the old noise, and needs its next device run to accept a new one. Every other test stays within pixelmatch's threshold of 0.1, about 13 steps.

### The WebGL2 format

The probe tests `R11F_G11F_B10F` as it tests `RGBA16F` and `RGBA32F`: a complete framebuffer, a clear to (2, 0.5, 0.25) that reads back exactly, and the samples a renderbuffer takes. The small format needs `RGBA16F` too, because bloom's levels and the effects' targets keep 16-bit floats ([D-21](D-21-effect-chain.md)).

On 5 October 2026 Chrome on the Mac (Apple GPU) passed the probe for all three formats, and so did SwiftShader. With `?scene-format=rg11b10`, WebGL2 draws `dark-gradient`, a point light's falloff from sRGB 45 down to 0, within the default tolerance of the `RGBA16F` image on both. The phones are P3's: their cost, their banding, and whether a Valhall Mali older than the G710 compresses the small format (S-14).

## Decision

1. `post.set({ vignette: { intensity, size, falloff, roundness } })`. At a place `d` from the center, in canvas widths and heights times `size`, with the width scaled toward the height by `roundness`, HDR color is multiplied by `max(1 - intensity × (1 - (1 - d²)^falloff), 0)`. The defaults are intensity 1, size 1, falloff 2 and roundness 0. A port sets `size` to `offset` and `intensity` to `darkness`. The four values fill the vignette's existing vector in the final pass's settings, so the uniform block keeps its size. `offset` and `darkness` throw E1213 with the mapping.
2. The final pass dithers last with static triangle noise of one step. Scene shaders on the 8-bit path dither with the same noise.
3. WebGL2 keeps `RGBA16F` by default (`WEBGL2_SMALL_SCENE_COLOR` in `packages/engine/src/page/limits.ts`). The probe and the switch `?scene-format=rg11b10` let P3 measure the small format; P3's result sets that one value. The switch also takes `rgba16f`, which turns core WebGPU's small format off for comparisons.

## Options rejected

- three.js's falloff, `1 - d²`, on linear color. It darkens far less than three.js does on display color.
- A vignette color. Filament, URP and Bevy have one, but it needs another vector in the settings, and no port asks for it. It can come later as a setting.
- The vignette inside the scene shaders on the 8-bit path, before their tone curve. Every scene shader would need the vignette's settings, for a path that only some devices take.
- White noise of one step. It leaves bands at some values, and its noise level changes with the value.
- Noise that changes each frame, as Filament's does. It adds nothing until accumulation or TAA averages it, and it would change hold-mode images.

## Consequences

- Code: `final.wgsl` (the vignette before the tone curve, `finish` with the table and the dither), `lib/tonemap.wgsl` (the triangle noise), `grading.rs`, `final_pass.rs`, the core's post values (the falloff and roundness after bloom's weights), `post.ts`, the probe in `capabilities.ts`, and `sceneColorFormat` and the `?scene-format=` switch.
- Tests: the image tests `dark-vignette`, `dark-vignette-8-bit`, `dark-gradient` and `dark-gradient-small-float` on all three paths; new references for the vignette tests and the strict tests above; unit tests of the settings, the defaults and the format choice; the probe's browser test.
- Docs: `api/post`, `concepts/post-processing` (a dithering section), `concepts/color-management`, `concepts/backends`, `guides/testing`, the mapping's `vignette` entry, both skills.
- After P3: set `WEBGL2_SMALL_SCENE_COLOR` from its result, and record the phones' figures here.
