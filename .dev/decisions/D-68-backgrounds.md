# D-68: Sky, environment and cube map backgrounds

Status: decided. Date: 2026-10-05. Task: M2-E3.

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

The sky's GPU cost on phones, drawn first in the opaque pass with no depth test (commit 3891ba01e). S1 at the Low preset with the governor off, its WebGPU page and its sky twin in turns, 5 rounds each, GPU time per frame from timestamp queries:

| Phone, GPU | GPU time, sky off | GPU time, sky on | Change | Scene pass, off to on |
| --- | --- | --- | --- | --- |
| Galaxy S25, Adreno 830 | 12.71 ms | 19.43 ms | +6.72 ms (+53%) | 8.26 to 15.01 ms |
| Pixel 9, Mali-G715 | 11.80 ms | 12.12 ms | +0.32 ms (+3%) | 9.18 to 9.57 ms |

All the cost on the S25 is in the scene pass, and it is the sky's shading of pixels that the swarm covers. The Mali GPU drops most fragments that later opaque fragments cover, so it pays little; the Adreno GPU shades them all. WebGL2 has no GPU timer on either phone. The sky drawn last has no phone figures yet (Consequences).

How the data was produced: the phone runs on 5 October 2026 with `bun tests/devices-cloud.ts --only bsgalaxys25-chrome,bspixel9-chrome --plan bench -- --scenes s1 --pages null3d-webgpu,null3d-webgpu-sky,null3d-webgl2,null3d-webgl2-sky --switches governor=off` on BrowserStack Automate, Chrome 149 (run `20261005-124327-bench`). The other data on 5 October 2026, on a MacBook Pro (Apple M5 Max) in Chrome. The image tests ran with `bun run test:images -g background`, on the Mac's GPU and with `CI=1` on SwiftShader. The parity test ran with `bunx playwright test tests/parity.spec.ts -g background-` in `bench/`. `bun run bench:allocation --sky` and `--sky --gpu webgl2` on the same Mac. The first allocation run failed with 91 bytes per frame in the sky's writer. It read its settings in a loop by a changing key, so the browser boxed each fraction. It now reads each setting by its name, once.

## Decision

- Drawing. The cube map and the sky draw a box of 36 vertices around the camera, as three.js's `WebGLBackground` and `Sky` draw them. The vertex index gives each corner, and the view's own matrix projects it. A box needs no inverse of the view matrix, which the frame data lacks. An orthographic camera gets one triangle over the view, in the view's direction, since its rays are parallel. The texture draws one triangle over the view.
- Order. Every background draws at the far plane, depth 0 in reversed depth, after the opaque objects in the camera's opaque pass and before the debug lines and the transparent objects. Its depth test passes where the target still holds the far plane, and it writes no depth. So it shades only the pixels that no object covers, on every GPU. The S25's figures show why: drawn first, the sky shaded the whole view, and covered pixels cost 6.7 ms a frame.
- The depth test is the new state flag `DEPTH_OR_EQUAL` (1024): WebGPU's `greater-equal`, and GL's `GEQUAL`, or `LEQUAL` in the standard depth mode. The far plane passes against a target cleared to it, which the plain test, `greater`, refuses. An equal test passes the same pixels, since nothing in the target lies beyond the far plane, but Adreno drivers turn off their coarse depth test (LRZ) for equal tests: Mesa's Turnip driver notes that Qualcomm's own driver does, and does the same.
- An opaque material with `depthWrite: false` or `depthTest: false` writes no depth, so a background drawn after it would cover it where nothing lies behind it. While any bucket of the opaque pass writes no depth, the background draws first with no depth test instead, as three.js draws `scene.background`, and every object draws over it. Each layout notes this when it rebuilds, and the background's pipeline follows it. Such a scene pays the full cost again; the docs say so.
- The texture background moves with the others. It is the same kind of draw, one texel per pixel over the whole view, so it also skips covered pixels, and one order for every kind keeps one rule for materials that write no depth.
- Settings. Each builder keeps a uniform block of 128 bytes (`sizes::BACKGROUND_UNIFORM_BYTES`), written only when its values change. A bind group of layout 19 holds it with the cube texture and its sampler. The frame uniform is full at 512 bytes, and growing it would grow every view of every scene. The cube and sky pipelines bind the group at index 1, the texture background at index 2 for its intensity.
- Blur. An environment background reads its cube map at the level that `null3d::ibl::roughness_level` gives for the blur. three.js reads its PMREM the same way, with `textureCubeUV(envMap, direction, backgroundBlurriness)`. It costs one texel per pixel at any blur. Only environments blur. A cube map of images has one level, and three.js turns a blurred `CubeTexture` into a PMREM first. Ports make an environment with the asset tool instead.
- Cube maps. `assets.loadCubemap` decodes six images without a flip. Each uploads into its face through the texture store's image path: a cube texture of `rgba8unorm-srgb` and one level takes six image ids. The shader mirrors x, as three.js's `WebGLBackground` premultiplies a `CubeTexture`'s rotation. So a port's faces land where three.js shows them.
- The sky. `sky.wgsl` follows three.js r186's `Sky.js` formula by formula, clouds and sun disc included, with its uniforms' names and defaults. The vertex shader finds the per-sky values that three.js's vertex shader finds, and passes them flat. Clouds move with a `time` setting, as in `Sky`; `SkyMesh` reads the renderer's clock, which no twin can set, so the parity scene keeps `cloudSpeed` at 0.
- Numbers: render templates 35 (`BACKGROUND_CUBE`) and 36 (`BACKGROUND_SKY`), bind layout 19 (`BACKGROUND`), state flag 1024 (`DEPTH_OR_EQUAL`).

## Consequences

- `scene.setBackground(background, { intensity, blur, rotation })` takes a texture, an environment, a `Cubemap` or `{ sky }`. `assets.loadCubemap(urls)` returns a `Cubemap`. Docs: `api/scene`, `api/assets`, `concepts/lighting`. Mapping entries: `scene.background`, `backgroundRotation`, `backgroundBlurriness / backgroundIntensity`, `CubeTextureLoader / CubeTexture`, `Sky / SkyMesh`.
- The shaders load on first use (D-56). The cube map's builds (`background_cube.wgsl`) join the texture background's in the `background` feature. The sky's builds (`sky.wgsl`) have a `sky` feature of their own. `setBackground` asks for the feature's file with the first background of its kind, and `createEngine({ preload })` takes both names. The view shows the background color until the pipeline is built.
- Against the first-use branch, no start shader file grew more than 90 bytes after Brotli (+0.4%). The `background` files grew by about 1.1 KB, to 2.2 to 3.4 KB, and the `sky` files take 3.6 to 4.8 KB. A first build that kept both in the device modules added 2.6 to 2.9 KB to every start shader file.
- The bench pages `null3d-webgpu-sky` and `null3d-webgl2-sky` run S1 with the sky (`?sky`), so a bench run takes turns between a page and its sky twin.
- Pending: the same S25 and Pixel 9 run with the sky drawn last, which should bring the S25's cost close to the Pixel 9's. The commands are in the pull request.
