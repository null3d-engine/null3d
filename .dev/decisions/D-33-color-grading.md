# D-33: Color grading and the vignette

Status: decided, 2026-10-03; by the owner on 2026-10-04, the vignette moves into HDR and the dither runs last. Date: 2026-10-03. Task: M2-F3.

Summary: Values of the final pass's settings, not shader builds, so turning them on builds no pipeline. Tables are 3D textures of the texture store in 8-bit color; `post.set` takes `LUTPass`'s and `VignetteShader`'s numbers, and draws on every path, the 8-bit path included.

## Question

1. Where do a color grading table and the vignette apply? Are they builds of the final pass's shader, a pass of their own, or settings of the final pass?
2. How does a table reach the GPU: its own upload code, or the texture store?
3. What do `post.set` and `assets.loadLut` take, so a port of three.js keeps its numbers?

## Rule

- Grading draws on every tier, the 8-bit path included ([D-21](D-21-effect-chain.md)'s rule for effects).
- A port that copies `LUTPass`'s table and intensity, and `VignetteShader`'s offset and darkness, keeps its look. The parity test passes three.js's rule, under 0.1% of the pixels.
- No extra full-screen pass, and no new frame of waiting when a sketch turns grading on.
- A page that grades nothing downloads nothing more for it (M2-R5's rule for features).

## Data

### Parity with three.js

Pixels that differ from three.js by its rule, Chrome on the Mac's GPU, 3 October 2026:

| Scene | Core WebGPU | Compatibility mode | WebGL2 |
| --- | --- | --- | --- |
| `lut-cube`: the warm `.cube` table alone | 0.000% | 0.000% | 0.000% |
| `lut-vignette`: the table at 0.7 of its intensity, then the vignette (offset 1.2, darkness 1.1) | 0.000% | 0.000% | 0.000% |

The parity test (`bun run parity -- --scene lut-cube,lut-vignette --tier webgpu,compat,webgl2`) compares null3D's `lut-cube` and `lut-vignette` images with the twin `bench/pages/threejs/grading.html`. The twin draws the same scene (`bench/scenes/grading.ts`) with an `EffectComposer`: a `RenderPass`, an `OutputPass` with ACES, a `LUTPass` with the warm table from `LUTCubeLoader`, and with `?mix` a `ShaderPass` of `VignetteShader`. Both sides draw without anti-aliasing, as the composer's targets have no MSAA.

### The files

The sample content's tables (`sources/luts/`): warm, cool and identity, each as a `.cube` file of 33 texels a side and a `.3dl` file of 17. Read on the Mac in Bun on 3 October 2026:

| Measure | Result |
| --- | --- |
| Each `.cube` table against three.js's `LUTCubeLoader` with float output | Within 0.5 of a step of 255 in every channel: the engine rounds to 8 bits |
| Each `.3dl` table against the `.cube` table at the same grid points | Within 1 step of 255 |
| Time to read a `.cube` table of 33 | 9.5 to 23 ms, the first with the reader's warm-up |
| The readers' file, which the first table loads | 1.6 KB after Brotli |
| three.js's `LUT3dlLoader` on the sample `.3dl` files | Refuses them: their input grid, `0 64 ... 512 575 ... 1023`, has steps of 63 and 64 from rounding |

### Cost

- With neither grading nor the vignette, the final pass reads one more uniform word and branches on it. The pass binds a blank table of one texel, so its bind group keeps one layout.
- A table adds one filtered read of a 3D texture per pixel, and the vignette a few operations. Both run in the final pass, so neither writes or reads the screen again.
- On the 8-bit path with MSAA, the scene resolves straight into the canvas. Grading needs the final pass there, so the scene resolves into a texture of one sample, which the final pass reads. That costs one more full-screen read and write, as when the render scale can drop.
- A table of 33 texels a side takes 144 KB of GPU memory, and one of 65 takes 1.1 MB.

## Decision

1. Grading and the vignette are values of the final pass's settings, not builds of its shader. The final pass's bind group always holds a table and its linear sampler, at bindings 9 and 10. While the sketch sets no table, it holds a blank table of one texel. Two flags of its settings turn each on. So turning grading on builds no pipeline, and the picture changes in the next frame with no wait. Both apply after the tone mapping and the sRGB encoding, as `LUTPass` and `VignetteShader` apply after `OutputPass`. They work on each pixel's color with its coverage divided out. On the 8-bit path the scene shaders encoded the color already, so grading draws there too. The final pass then runs in place of the resolve pass while the sketch grades.
2. A table is a 3D texture of the texture store, of its own, in linear 8-bit color. The store's uploads, budget, hold mode, release and GPU loss handling then cover it. Like every texture from data, a table whose texels the store released does not come back after a GPU loss.
3. `assets.loadLut(url)` reads `.cube` and `.3dl` files into a `Lut`. `post.set` takes `lut`, a table or `false`, and `lutIntensity`, `LUTPass`'s `intensity`. It takes `vignette: { offset, darkness }` with `VignetteShader`'s meanings, so a port copies the numbers. The `.cube` reader also maps the file's domain, which `LUTPass` leaves out. The `.3dl` reader accepts a grid whose steps differ by one from rounding. It takes the output's depth from a Lustre `Mesh` line, or else from the largest value.

## Options rejected

- A shader build for the table, picked by a permutation bit. It doubles the final pass's builds in every device module, from 4 to 8, and adds templates and a layout. A build turned on during play would also wait for its pipeline, and no frame shows until it is built. The permutation bits' own rule makes a cheap option a uniform value instead.
- A pass of its own for grading, as three.js's composer draws. It reads and writes the whole screen once more per frame.
- The table as a 2D array of slices, which the texture store already held, with the blend between two slices done by hand. It needs two filtered reads per pixel where a 3D texture needs one. It also leaves the GPU layer's 3D textures unused, which M2-E1 built for this.
- A table in half floats. Tables map display color in 0 to 1 for an 8-bit canvas, so half floats double the memory for no change on screen. three.js's loaders give 8-bit tables by default too.
- A `vignette: { amount }` setting, as the first sketch of the API had. `VignetteShader` and the postprocessing library's `VignetteEffect` both take an offset and a darkness. Ports keep their numbers with those.
- Dividing a `.3dl` file's values by 2 to the power of their bits, as `LUT3dlLoader` does. The largest value of a 12-bit file is 4,095, so the engine divides by that, and white stays white.

## Consequences

- Code: `crates/null3d-render/src/grading.rs`, the final pass's settings and bindings (`final_pass.rs`, `final.wgsl`), 3D textures in the texture store (`textures.rs`), the core calls `createVolumeTexture`, `setLut` and `setVignette`, `scene/lut.ts` and `scene/lut-files.ts`, and `post.ts`.
- Per frame: `post.set` writes its numbers, the exposure and bloom's among them, into a block of the core's memory (`postValues`), and the core calls take none. A fraction passed as an argument made a heap object per call, which the allocation check (`bun run bench:allocation --grading`) caught: 22 bytes per frame before, none after, on both GPU paths.
- Tests: the render crate's `grading.rs`, the readers' unit tests, the image tests `lut-cube`, `lut-3dl`, `vignette`, `lut-vignette`, `lut-vignette-8-bit` and `lut-vignette-scale-50`, and the parity scenes `lut-cube` and `lut-vignette`.
- Docs: `api/post`, `api/assets`, `concepts/post-processing`, the mapping's `lut` and `vignette` entries, and both skills.

## Addendum, 2026-10-04: the table and the vignette under intent parity

The owner's decision of 4 October 2026 ([D-52](D-52-intent-parity.md)) splits this record's second rule. A grading table is the author's own data, so applying it is intent parity: `LUTPass`'s table and intensity keep their strict parity test. The vignette is a look. Its default follows the best technique, and three.js's vignette is a candidate for the opt-in `three-compat` add-on module. The `lut-vignette` parity scene keeps its strict limit until the vignette's default changes.

## Addendum, 2026-10-04: the vignette moves into HDR, and the dither runs last

The owner settled the vignette's default that evening, as ruling 3 of [D-53](D-53-technique-defaults.md):

- The vignette multiplies HDR color before the tone curve, as Filament, URP, Bevy and Babylon.js do. Darkening before the curve keeps highlights from turning gray in the corners.
- three.js's formula leaves the core. The porting skill maps `VignetteShader`'s `offset` to the size and `darkness` to the intensity. The difference is small. Corners darken a little more in highlights. three.js's lift of dark corners at `darkness` below 1 is lost, and it is rarely intended. So three.js's vignette does not go to the `three-compat` add-on either.
- The dither becomes static triangle noise of one step, run last, after the table and the vignette, as Filament and URP do. Today white noise of half a step runs before the vignette, which shrinks the noise in the corners, where bands show first. Prototype P5 checks it with a dark vignette over a flat color.
- Tables stay after the tone curve: grading tools author them for display color. No grading controls come in M2 (ruling 25). When they come, a job worker bakes them with the tone curve into one 32³ table on each change, as Filament does.
- The `lut-vignette` parity scene keeps its strict limit until the vignette moves. Then the vignette gets null3D's own references and a sanity comparison, and the table keeps its strict test in a scene without a vignette.

The work is task M2-F9. Prototype P3 then measured `R11F_G11F_B10F` scene color on WebGL2, and WebGL2 keeps `RGBA16F` ([D-77](D-77-final-pass-order-and-formats.md#the-phones-p3)).

[D-77](D-77-final-pass-order-and-formats.md) records the build: the vignette's new settings and its falloff, the dither, and the WebGL2 format's probe and switch. The `lut-vignette` parity scene became a sanity comparison.

## Addendum, 2026-10-09: tables from numbers

Task M2-EX3 adds `assets.lutFromData({ size, data, domainMin, domainMax, title })`. It makes a table from numbers that code computes, as three.js's `LUTPass` takes a `Data3DTexture` that code fills. The demos make their content in code ([Examples](../examples.md#procedural-first)), so the post effects demo needed a way to grade with no file.

- Where it lives: it is a call of `assets`, beside `loadLut`, and not of `textures`. A `Lut` is not a texture: it holds a domain and a title, and `post.set` takes only a `Lut`. The assets page documents the `Lut` type. `assets.builtinEnvironment` already makes an asset with no file. The name follows `textures.fromData`, and so does its single object argument.
- One path: `lutFromData` and `loadLut` both make the same `LutTable` in `lut-files.ts`: 8-bit texels, red fastest. Both check its size and domain with the same functions, and both pass it to one private step that makes the 3D texture and the `Lut`. The numbers come in a `.cube` file's order, so a file and its numbers make the same bytes. A unit test checks this against `parseCube`, and the `lut-numbers` image test draws the warm table from its file's numbers against the `lut-cube` test's references on every tier.
- First use: the call returns a promise and imports `lut-files.ts` on its first table, as `loadLut` does. A synchronous call would put the conversion and its checks into the start's JavaScript, which has little room under its budget. The start grows only by the call itself.
- Checks: the call always checks its input, not only in development builds, because a wrong count would read past the data. A bad size, count, value or domain throws E1208, "Invalid texture", whose page now names grading tables. E1412 is for files that do not read. A new code would add a fix text to every page's download, for a case that E1208 covers.
- Four numbers per texel: the call accepts them and skips the fourth, so data laid out as three.js's RGBA `Data3DTexture` passes as it is. Grading changes color, not alpha.
- Not grading controls: the call takes a finished table. Grading controls, such as lift, gamma and gain as settings of `post.set`, are still a later task, as the addendum above says. The post effects demo shows that a sketch can compute such a grade itself in a few lines.

The demo's two grades use the formulas of the sample content's script that wrote `warm.cube` and `cool.cube`. Warm is lift, gamma and gain per channel. Cool is contrast 1.15, saturation 0.85 and a gain that cools the white balance. The demo's tables have 33 texels a side, as the files do. They differ from the files' tables by one 8-bit step at most. That step occurs in 1,089 of 143,748 bytes for warm, and in 97 for cool.
