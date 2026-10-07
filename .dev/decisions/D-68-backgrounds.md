# D-68: Sky, environment and cube map backgrounds

Status: decided, 2026-10-05. The Galaxy S25's cost recorded as a known device cost of the Adreno 830, its cause not found, 2026-10-07. Date: 2026-10-05. Task: M2-E3.

Summary: Environments, cube maps and three.js's sky draw as a box around the camera. They draw after the opaque objects, at the far plane behind the depth test, so they shade only uncovered pixels. On a Galaxy S25 any background adds about 4.8 ms of GPU time to S1. A small box adds the same, so the cost comes from the device.

## Question

How does the engine draw an environment, a cube map of six images and three.js's analytic sky behind every object? Where do their settings live, how does an environment blur, and which three.js sky does a port match?

## Rule

- Intent parity (D-52): each background matches three.js under three.js's own image rule on every GPU path, against both of its renderers where both draw it.
- Setting or moving a background builds no pipeline and allocates nothing per frame, so a sketch can move the sun in every frame. The allocation check must pass with the sky changing every frame.
- The common frame data does not grow for a feature that most scenes do not use.
- The start download does not grow: no start shader file may gain more than 0.3 KB after Brotli. The M1 gate's cold first load on the S24+ passes with about 2 KB to spare.

## Data

The feature parity test compares each scene with three.js 0.186.1 (`bench/tests/parity.spec.ts`), with the scenes of `bench/scenes/backgrounds.ts`. Share of pixels that differ by three.js's rule, which passes under 0.1%:

| Scene | WebGPU | Compatibility | WebGL2 | three.js's two renderers |
| --- | --- | --- | --- | --- |
| `background-sky`: the sky example's settings, sun 4 degrees up, clouds | 0.014% | 0.000% | 0.015% | 0.006% |
| `background-environment`: Venice sunset, blur 0.3, intensity 0.7, a quarter turn | 0.000% | 0.000% | 0.000% | 0.002% |
| `background-cubemap`: six 4 x 4 pictures, seen toward a corner | 0.000% | 0.000% | 0.000% | 0.000% |

The allocation check with `--sky` moves the sun and the clouds in every frame of S1. It ran 100,000 instances in the production build, with 2 samples of 5 s after 30 s:

| GPU path | Sketch worker, bytes per frame | Render worker, bytes per frame | Places of the background |
| --- | --- | --- | --- |
| WebGPU | 361 | 553 | none |
| WebGL2 | 364 | 147 | none |

### The cost on phones

S1 at the Low preset with the governor off, on WebGPU. Each run took 5 rounds of each page, in turns, in one session per phone. GPU time per frame comes from timestamp queries, and "scene pass" is the camera's opaque and transparent pass. WebGL2 has no GPU timer on either phone.

The first two runs compared S1 with and without the sky:

| Run, build | Phone, GPU | GPU time, no sky | GPU time, sky | Change | Scene pass, no sky to sky |
| --- | --- | --- | --- | --- | --- |
| `20261005-124327-bench`, sky drawn first (3891ba01e) | Galaxy S25, Adreno 830 | 12.71 ms | 19.43 ms | +6.72 ms | 8.26 to 15.01 ms |
| same | Pixel 9, Mali-G715 | 11.80 ms | 12.12 ms | +0.32 ms | 9.18 to 9.57 ms |
| `20261005-234436-bench`, sky drawn last (e8d10fd1d) | Galaxy S25 | 12.91 ms | 18.61 ms | +5.70 ms | |
| same | Pixel 9 | | | +0.33 ms | |

These runs suggested that the Adreno GPU shaded the sky under the swarm, and that drawing it last would fix that. It saved only about 1 ms. So three more S25 runs split the cost with pages that add one thing each to S1. Median of 5 runs, in ms; the runs of each page agreed within 0.1 ms:

| Page | What it adds to S1 | GPU time | Scene pass | Scene pass change |
| --- | --- | --- | --- | --- |
| `null3d-webgpu` | nothing | 12.91 | 8.45 | |
| `null3d-webgpu-box` | a small unlit box that writes depth | 17.69 | 13.24 | +4.79 |
| `null3d-webgpu-first` | the same box with a material that writes no depth | 17.69 | 13.24 | +4.79 |
| `null3d-webgpu-sky-texture` | a texture background, one triangle | 17.76 | 13.30 | +4.85 |
| `null3d-webgpu-sky-room` | the room as background, a box of 12 triangles | 17.76 | 13.30 | +4.85 |
| `null3d-webgpu-sky-room-first` | the room drawn first, and the box that writes no depth | 17.96 | 13.50 | +5.05 |
| `null3d-webgpu-sky-texture-first` | the texture drawn first, and the box that writes no depth | 17.96 | 13.50 | +5.05 |
| `null3d-webgpu-sky-clear` | the sky without clouds | 18.09 | 13.63 | +5.18 |
| `null3d-webgpu-sky` | the sky with clouds (run `20261006-010942-bench`) | 18.64 | 14.22 | +5.77 |

The other passes took the same time on every page: compute 1.31 ms, the second render pass 3.08 ms. What the S25 data show:

- The S25 pays one step of about 4.8 ms in the scene pass as soon as the pass draws anything besides S1's swarm. A background costs it, and so does a small box with no background.
- The step does not depend on depth writes. Run `20261007-013600-bench` first suggested that it did: a box whose material writes no depth cost the same 4.8 ms as a background, which writes none either. The theory was that any draw without depth writes makes the Adreno driver turn off its coarse depth test for the whole pass. Run `20261007-051203-bench` dropped it. The box costs the same with or without depth writes: 13.24 ms of scene pass either way. A test build whose background wrote depth cost the same as the one that writes none (run `20261007-051203-bench`). It took 17.83, 17.76 and 18.09 ms for the room, the texture and the clear sky.
- The step does not depend on the shape. The texture's one triangle costs the same as the room's box of 12 triangles.
- It comes once per pass, not per draw. A background and the box together add 5.05 ms, against 4.79 to 4.85 ms for either alone.
- The background's own cost is what remains above the step. That is about 0.06 ms for the room or the texture, 0.4 ms for the clear sky and 1 ms for the sky with clouds. Drawn first, the room and the texture cost 0.2 ms more than drawn last.

On the Pixel 9 (run `20261007-022248-bench`), only the first of each page's 5 runs was cool; the phone was hot after it. In that run the box cost 0.07 ms: 11.67 against 11.60 ms. The backgrounds cost 0.5 to 1.4 ms. The room and the texture took 12.06 to 12.45 ms, first or last, and the clear sky 12.98 ms. So the step is the S25's alone.

On the Mac (MacBook Pro, M5 Max, Chrome), S1 ran with one object, so that the sky filled 1280 x 720 pixels. Its GPU time per frame was 0.18 ms with no background, 0.36 ms with the sky, and 0.24 ms with the sky and no clouds.

How the data was produced: the phone runs on BrowserStack Automate, Chrome 149.0.7827.160, with the S25's screen at 30 Hz. On 5 October 2026: `bun tests/devices-cloud.ts --only bsgalaxys25-chrome,bspixel9-chrome --plan bench -- --scenes s1 --pages null3d-webgpu,null3d-webgpu-sky,null3d-webgl2,null3d-webgl2-sky --switches governor=off`. On 6 October 2026 (run `20261006-010942-bench`, 397e2ed09), the sky pages with `null3d-webgpu-sky-clear` and `null3d-webgpu-sky-room`. On 7 October 2026 (runs `20261007-013600-bench` on the S25 and `20261007-022248-bench` on the Pixel 9, 3b7d44a5b): `bun run devices:cloud --only bsgalaxys25-chrome,bspixel9-chrome --plan bench -- --scenes s1 --pages null3d-webgpu,null3d-webgpu-first,null3d-webgpu-sky-room,null3d-webgpu-sky-room-first,null3d-webgpu-sky-texture,null3d-webgpu-sky-texture-first,null3d-webgpu-sky-clear --switches governor=off`. Run `20261007-051203-bench` ran the S25 alone, with `null3d-webgpu-box` in place of `null3d-webgpu-sky-texture-first`, on a test build whose background wrote depth; 36 of 36 pages passed. The other data on 5 October 2026, on a MacBook Pro (Apple M5 Max) in Chrome. The image tests ran with `bun run test:images -g background`, on the Mac's GPU and with `CI=1` on SwiftShader. The parity test ran with `bunx playwright test tests/parity.spec.ts -g background-` in `bench/`. `bun run bench:allocation --sky` and `--sky --gpu webgl2` on the same Mac. The first allocation run failed with 91 bytes per frame in the sky's writer. It read its settings in a loop by a changing key, so the browser boxed each fraction. It now reads each setting by its name, once.

## Decision

- Drawing. The cube map and the sky draw a box of 36 vertices around the camera, as three.js's `WebGLBackground` and `Sky` draw them. The vertex index gives each corner, and the view's own matrix projects it. A box needs no inverse of the view matrix, which the frame data lacks. An orthographic camera gets one triangle over the view, in the view's direction, since its rays are parallel. The texture draws one triangle over the view.
- Order. Every background draws at the far plane, depth 0 in reversed depth. It draws after the opaque objects in the camera's opaque pass, and before the debug lines and the transparent objects. Its depth test passes where the target still holds the far plane. So it shades only the pixels that no object covers, on every GPU. Drawn first, it shades the whole view on a GPU that does not drop covered fragments. On the S25, the room and the texture cost 0.2 ms more first than last in one session. The sky cost about 0.8 ms more, across two sessions. The 4.8 ms step that the S25 pays for any extra draw does not depend on the order (Consequences).
- No depth write. The background writes no depth. Writing it would store the far plane where the target already holds the far plane, so no image changes. The S25 test build that wrote depth cost the same as the one without, so the background keeps the cheaper state.
- The depth test is the new state flag `DEPTH_OR_EQUAL` (1024): WebGPU's `greater-equal`, and GL's `GEQUAL`, or `LEQUAL` in the standard depth mode. The far plane passes against a target cleared to it, which the plain test, `greater`, refuses. An equal test passes the same pixels, since nothing in the target lies beyond the far plane. But Adreno drivers turn off their coarse depth test (LRZ) for equal tests. Mesa's Turnip driver notes that Qualcomm's own driver does so, and does the same.
- An opaque material with `depthWrite: false` or `depthTest: false` writes no depth, so a background drawn after it would cover it where nothing lies behind it. While any bucket of the opaque pass writes no depth, the background draws first with no depth test instead. three.js draws `scene.background` so, and every object draws over it. Each layout notes this when it rebuilds, and the background's pipeline follows it. Such a scene pays the full cost again; the docs say so.
- The texture background moves with the others. It is the same kind of draw, one texel per pixel over the whole view, so it also skips covered pixels. One order for every kind also keeps one rule for materials that write no depth.
- Settings. Each builder keeps a uniform block of 128 bytes (`sizes::BACKGROUND_UNIFORM_BYTES`), written only when its values change. A bind group of layout 19 holds it with the cube texture and its sampler. The frame uniform is full at 512 bytes, and growing it would grow every view of every scene. The cube and sky pipelines bind the group at index 1, the texture background at index 2 for its intensity.
- Blur. An environment background reads its cube map at the level that `null3d::ibl::roughness_level` gives for the blur. three.js reads its PMREM the same way, with `textureCubeUV(envMap, direction, backgroundBlurriness)`. It costs one texel per pixel at any blur. Only environments blur. A cube map of images has one level, and three.js turns a blurred `CubeTexture` into a PMREM first. Ports load an environment with `assets.loadEnvironment` instead.
- Cube maps. `assets.loadCubemap` decodes six images without a flip. Each uploads into its face through the texture store's image path: a cube texture of `rgba8unorm-srgb` and one level takes six image ids. The shader mirrors x, as three.js's `WebGLBackground` premultiplies a `CubeTexture`'s rotation. So a port's faces land where three.js shows them.
- The sky. `sky.wgsl` follows three.js r186's `Sky.js` formula by formula, clouds and sun disc included, with its uniforms' names and defaults. The vertex shader finds the per-sky values that three.js's vertex shader finds, and passes them flat. Clouds move with a `time` setting, as in `Sky`; `SkyMesh` reads the renderer's clock, which no twin can set, so the parity scene keeps `cloudSpeed` at 0.
- Numbers: render templates 35 (`BACKGROUND_CUBE`) and 36 (`BACKGROUND_SKY`), bind layout 19 (`BACKGROUND`), state flag 1024 (`DEPTH_OR_EQUAL`).

## Consequences

- `scene.setBackground(background, { intensity, blur, rotation })` takes a texture, an environment, a `Cubemap` or `{ sky }`. `assets.loadCubemap(urls)` returns a `Cubemap`. Docs: `api/scene`, `api/assets`, `concepts/lighting`. Mapping entries: `scene.background`, `backgroundRotation`, `backgroundBlurriness / backgroundIntensity`, `CubeTextureLoader / CubeTexture`, `Sky / SkyMesh`.
- The shaders load on first use (D-56). The cube map's builds (`background_cube.wgsl`) join the texture background's in the `background` feature. The sky's builds (`sky.wgsl`) have a `sky` feature of their own. `setBackground` asks for the feature's file with the first background of its kind, and `createEngine({ preload })` takes both names. The view shows the background color until the pipeline is built.
- Against the first-use branch, no start shader file grew more than 90 bytes after Brotli (+0.4%). The `background` files grew by about 1.1 KB, to 2.2 to 3.4 KB, and the `sky` files take 3.6 to 4.8 KB. A first build that kept both in the device modules added 2.6 to 2.9 KB to every start shader file.
- The bench pages `null3d-webgpu-sky` and `null3d-webgl2-sky` run S1 with the sky (`?sky`), so a bench run takes turns between a page and its sky twin.
- The pages `null3d-webgpu-sky-clear`, `null3d-webgpu-sky-room`, `null3d-webgpu-sky-texture`, `null3d-webgpu-first`, `null3d-webgpu-box` and the two `-first` background pages split a background's cost. The benchmarks guide lists them.
- Known device cost: on the Galaxy S25 (Adreno 830, Chrome 149), S1's scene pass takes about 4.8 ms more GPU time per frame. It pays this once the pass draws anything besides the swarm. A background pays it, and so does any other object, so a background does not cause it. The engine cannot avoid it with the background's order, shape or depth state. Runs: `20261007-013600-bench` and `20261007-051203-bench` (S25), `20261007-022248-bench` (Pixel 9, no step). A Galaxy Tab A9 Plus (Adreno 619, Chrome 149) shows no step either (run `20261007-100817-bench`). Its scene pass took 79.50 ms plain, 79.46 ms with the box and 80.05 ms with the room background. So the step is the Adreno 830's, not every Adreno GPU's. [Implementation notes](../implementation-notes.md#browser-faults) lists it among the browser faults.
- The cause is not found. These probes would narrow it, cheapest first. Only probe 5 has run.
  1. The box with the swarm's own material, so the pass gains a draw but no pipeline. If it costs nothing, the step comes from a second pipeline in the pass. If it costs 4.8 ms, any second draw sets it off.
  2. The draw list of `null3d-webgpu` and `null3d-webgpu-box` side by side on the Mac: the draws, pipeline changes and bind group changes of the scene pass. More than one extra draw would point at the engine. Probe 5 makes this less likely: the Tab A9 Plus ran the same build and paid nothing for the box.
  3. S1 with fewer instances, with and without the box. A step that shrinks with the swarm means the S25 loses a saving on the swarm's hidden pixels, such as its coarse depth test. A step that stays the same means a cost per pass, such as a change of the driver's rendering mode or tile loads and stores.
  4. The background in a render pass of its own after the opaque pass. It would move the background out of the scene pass, but each new pass loads and stores the targets again. Worth it only if probes 1 to 3 point at the pass.
  5. Done: `null3d-webgpu`, `null3d-webgpu-box` and `null3d-webgpu-sky-room` on the cloud Galaxy Tab A9 Plus (Adreno 619). The box added 0.03 ms and the room 1.1 ms of GPU time, so the step does not show on that older Adreno GPU. Next, a GPU profiler such as Android GPU Inspector could show the rendering mode and the coarse depth test's counters. It needs an Adreno 830 phone over USB. The owner's Galaxy S24+ cannot: its Xclipse GPU has no WebGPU in Chrome.
  - A full-screen triangle for the cube map and the sky needs no run. The texture's one triangle already costs the same as the room's box.
