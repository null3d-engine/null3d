# D-77: The final pass's order, the dither and the WebGL2 scene format

Status: decided for the vignette and the dither, 2026-10-05; for the WebGL2 scene format after prototype P3's phone runs, 2026-10-07. Date: 2026-10-05. Task: M2-F9.

Summary: The vignette multiplies HDR color before the tone curve, with intensity, size, falloff and roundness. A falloff power of 2 by default darkens about as `VignetteShader` does, so a port maps `offset` to size and `darkness` to intensity. The final pass dithers last with static triangle noise of one step. WebGL2 probes `R11F_G11F_B10F` and takes it with `?scene-format=rg11b10`. It keeps `RGBA16F` by default. On five cloud phones the small format showed no bands, but it drew no faster, and the Pixel 6 lost 0.8 to 2.2 fps.

## Question

1. [D-53](D-53-technique-defaults.md) ruling 3 moves the vignette into HDR, before the tone curve. What are its settings, and how does a port of three.js's `VignetteShader` keep its look?
2. Where does the dither run, with what noise, and how deep?
3. Does WebGL2 draw scene color in `R11F_G11F_B10F`, as core WebGPU draws `rg11b10ufloat`?

## Who decided

- The owner ruled on 4 October 2026 that the vignette moves into HDR and the dither runs last ([D-53](D-53-technique-defaults.md) ruling 3, [D-33](D-33-color-grading.md)'s status).
- The settings, the falloff, the noise and the WebGL2 format's rule were chosen in this record on 5 October 2026, from the data below. The format's default was chosen on 7 October 2026, by this record's rule, from P3's phone runs.

## Rule

- The vignette multiplies HDR color before the tone curve, as Filament, URP, Bevy and Babylon.js do. A port maps `VignetteShader`'s `offset` to a size and `darkness` to an intensity (D-53, the analysis's porting table).
- The dither runs last, after the color grading table and the vignette, with static triangle noise of one step, as Filament and URP do. Prototype P5 checks it: a dark vignette over a flat color draws with no bands.
- WebGL2 takes `R11F_G11F_B10F` where the canvas is opaque and the probe passes, if prototype P3 allows it. On the cloud phones it must cost no more, and draw a dark gradient without bands. Accumulation history keeps `rgba16float`.
- No new pipeline, no new full-screen pass, no allocation in the frame loop.

## Data

### The vignette's falloff

The first build used three.js's falloff, `1 - d²`, as a multiply of linear color. It darkened much less than three.js: `VignetteShader` multiplies display color, and a display factor f is about f^2.2 in linear color. On the grading scene with `VignetteShader`'s offset 1.2 and darkness 1.1, the top-left corner was sRGB (90, 99, 102) against three.js's (40, 42, 40). A falloff power of 2 brings the look back. The old references drew three.js's formula. At the image tests' threshold, the `vignette` test differs from them in 1.32% of its pixels on the Mac's WebGPU and WebGL2. The `lut-vignette` test differs in 1.11 to 1.13%. So the default falloff is 2.

The parity scenes against three.js's `LUTPass` and `VignetteShader`, Chrome on the Mac's GPU, 5 October 2026 (`bun run parity -- --scene lut-cube,lut-vignette --tier webgpu,compat,webgl2`):

| Scene | Core WebGPU | Compatibility mode | WebGL2 |
| --- | --- | --- | --- |
| `lut-cube`: the table alone, three.js's rule | 0.000% | 0.000% | 0.000% |
| `lut-vignette`: the table at 0.7, then the vignette (offset 1.2, darkness 1.1 mapped) | 1.136% | 1.136% | 1.095% |

Only the outer corners differ: with a darkness above 1, three.js's blend passes black sooner. `lut-vignette` becomes a sanity comparison with a limit of 2% (`VIGNETTE_MAX_DIFFERENT_PERCENT`). A missing vignette differs in tens of percent.

### The 8-bit path

The 8-bit path holds display color, so the vignette multiplies the linear value of the display color there, before the outline. The tone curve bends between the two, so the 8-bit image differs from the HDR one a little. On `dark-vignette`, on the Mac's GPU and on SwiftShader, no pixel differs past pixelmatch's threshold. No channel differs by more than 10 steps. `lut-vignette-8-bit` stays within its 3% tolerance against `lut-vignette`.

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

The probe tests `R11F_G11F_B10F` as it tests `RGBA16F` and `RGBA32F`. It checks for a complete framebuffer, a clear to (2, 0.5, 0.25) that reads back exactly, and the samples a renderbuffer takes. The small format needs `RGBA16F` too, because bloom's levels and the effects' targets keep 16-bit floats ([D-21](D-21-effect-chain.md)).

On 5 October 2026 Chrome on the Mac (Apple GPU) passed the probe for all three formats, and so did SwiftShader. With `?scene-format=rg11b10`, WebGL2 draws `dark-gradient`, a point light's falloff from sRGB 45 down to 0, within the default tolerance of the `RGBA16F` image on both. The phones are P3's: their cost, their banding, and whether a Valhall Mali older than the G710 compresses the small format (S-14).

### The phones (P3)

Prototype P3 ran on BrowserStack Automate on 7 October 2026, in Chrome 149 on five phones. They are the Galaxy S25 (Adreno 830), the Pixel 9 (Mali-G715) and the Pixel 10 (PowerVR D-Series DXT). The other two are the Pixel 11 (PowerVR C-Series) and the Pixel 6 (Mali-G78, a Valhall Mali older than the G710). Builds "null3D 20261007-062702-checks", "null3D 20261007-063914-bench" and "null3D 20261007-082124-bench".

- The probe: on all five, the WebGL2 `R11F_G11F_B10F` target is complete and reads back. It takes 4 samples on the S25, Pixel 9 and Pixel 6, and 8 on the Pixels 10 and 11.
- Banding: the checks plan's dark tone tests passed 10 of 10 on every phone, `dark-gradient-small-float` on WebGL2 among them. The small format draws the dark gradient within the default tolerance of the `RGBA16F` image, so the dither hides its shorter mantissa.
- Cost: S4 at Low on WebGL2, 5 runs of each format in turns in one session per phone. These phones have no GPU timer on WebGL2, so the table gives medians of frames per second and CPU time per frame, small format against `RGBA16F`.

| Phone | Screen | Frames per second | CPU ms |
| --- | --- | --- | --- |
| Galaxy S25 | 30 Hz | 30 against 30 | 0.90 against 0.90 |
| Pixel 9 | 60 Hz | 60 against 60 | 2.17 against 2.32 |
| Pixel 10 | 60 Hz | 60 against 60 | 1.14 against 1.16 |
| Pixel 11 | 60 Hz | 60 against 60 | 1.32 against 1.40 |
| Pixel 6, `RGBA16F` first in each pair | 90 Hz | 52.5 against 53.3 | 2.80 against 2.64 |
| Pixel 6, the small format first in each pair | 90 Hz | 52.5 against 54.7 | 2.30 against 2.29 |

Four phones held their screen's rate with both formats, so the small format saved them nothing they could show. The Pixel 6 held neither format at 90 Hz. There, `RGBA16F` drew more frames in 8 of 10 pairs over the two orders. Its medians led by 0.8 and 2.2 fps. Its median frame interval was 22.2 ms with both, so the gap is in how many frames land at 11.1 ms, not a steady cost. The small format led only in the first two pairs of the second order, while the phone was still cool.

Memory needs no run. The small format takes 4 bytes a pixel against 8. At 1080 x 2400 with no MSAA, it saves about 9.9 MiB of scene color. The memory plan measures which memory maximum starts the engine, not a peak. Its run also drew on WebGPU, where the format switch does not apply.

P3's plan also named the iPad, which this record does not need. One default covers every device, because the engine cannot pick the format by GPU (hard rule 14). The Pixel 6's cost already keeps that default at `RGBA16F`, so no iPad result could change it. The dither and the dark tone tests draw on the Mac's Apple GPU, and the merge queue's Safari job runs them against the same references. P3's anti-aliasing part on Low belongs to the presets, not to this record.

## Decision

1. The vignette takes `post.set({ vignette: { intensity, size, falloff, roundness } })`. Take a place `d` from the center, in canvas widths and heights times `size`. The roundness scales the width toward the height. HDR color there is multiplied by `max(1 - intensity × (1 - (1 - d²)^falloff), 0)`. The defaults are intensity 1, size 1, falloff 2 and roundness 0. A port sets `size` to `offset` and `intensity` to `darkness`. The four values fill the vignette's existing vector in the final pass's settings, so the uniform block keeps its size. The old `offset` and `darkness` throw E1213 with the mapping.
2. The final pass dithers last with static triangle noise of one step. Scene shaders on the 8-bit path dither with the same noise.
3. WebGL2 keeps `RGBA16F` by default (`WEBGL2_SMALL_SCENE_COLOR` in `packages/engine/src/page/limits.ts` stays `false`). The rule asked that the small format cost no more on the cloud phones. It drew no bands. But it cost the Pixel 6 0.8 to 2.2 fps in both orders, and it gained no frame on the other four. The engine cannot pick the format by GPU (hard rule 14), so one default covers every phone, and the one with a cost decides it. Its saving of 4 bytes a pixel does not outweigh a slower frame on an older Mali phone. This record does not change core WebGPU, which keeps `rg11b10ufloat` where the device draws it.

   The probe and the switch `?scene-format=rg11b10|rgba16f` stay. They cost nothing, and they let a later run measure the format on more phones, or with a GPU timer, without a new build. Before the runs, the default was off for three reasons. No phone had drawn the small format, and its 6 and 5 mantissa bits might band in dark gradients. Also, Arm documents frame buffer compression of 32-bit formats on Valhall Mali GPUs older than the G710 for Vulkan only (S-14).

## Options rejected

- three.js's falloff, `1 - d²`, on linear color. It darkens far less than three.js does on display color.
- A vignette color. Filament, URP and Bevy have one, but it needs another vector in the settings, and no port asks for it. It can come later as a setting.
- The vignette inside the scene shaders on the 8-bit path, before their tone curve. Every scene shader would need the vignette's settings, for a path that only some devices take.
- White noise of one step. It leaves bands at some values, and its noise level changes with the value.
- Noise that changes each frame, as Filament's does. It adds nothing until accumulation or TAA averages it, and it would change hold-mode images.

## Consequences

- Code: `final.wgsl` (the vignette before the tone curve, `finish` with the table and the dither) and `lib/tonemap.wgsl` (the triangle noise). Also `grading.rs`, `final_pass.rs`, the core's post values (the falloff and roundness after bloom's weights) and `post.ts`. The probe is in `capabilities.ts`, and `sceneColorFormat` and the `?scene-format=` switch in `limits.ts` and `switches.ts`.
- Tests: the image tests `dark-vignette`, `dark-vignette-8-bit`, `dark-gradient` and `dark-gradient-small-float` on all three paths. New references for the vignette tests and the strict tests above. Unit tests of the settings, the defaults and the format choice, and the probe's browser test.
- Docs: `api/post`, `concepts/post-processing` (a dithering section), `concepts/color-management`, `concepts/backends`, `guides/testing`, the mapping's `vignette` entry, both skills.
- P3's runs are rows of `.dev/tested-devices.md`. The Pixel 6 ran from a runner list of that run alone. It is not in the cloud device list.
