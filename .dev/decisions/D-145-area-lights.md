# D-145: Area lights

Status: decided by the helper of M2-EX28 on 13 October 2026, for the owner's review. The owner approved the demo's look. The coordinator ruled that the cap keeps the lights with the most light at the camera and fades them across it, in the same pull request. Built: area lights are on main (`efb65024b`). The owner's review of the design is pending. Date: 2026-10-12. Task: M2-EX28.

Summary: Rectangle and tube lights light the standard material with linearly transformed cosines (LTC). A rectangle light matches three.js's `RectAreaLight`: it uses the same formulas and fitted tables. A tube shades as the rectangle through its axis that faces the surface, at the same cost. Area lights share the 64-byte records and the clusters of point and spot lights, and each quality preset caps how many shade in a frame. The tables load on first use from a 19.3 KB gzip file. They share the split-sum table's binding, so WebGPU gains no binding and WebGL2 one texture unit.

## Question

The showcase scenes need light from shop windows, neon tubes and studio panels ([D-142](D-142-more-techniques-before-1-0.md)). A point light gives such a source a pin-point highlight and a hard falloff. How does the engine shade light from an area? Which shapes does it offer, and what does it cost when a scene uses none?

## Rule

- The best technique by default, and three.js's intent where three.js has the feature ([D-52](D-52-intent-parity.md)). A rectangle light matches three.js's `RectAreaLight` for the same size, color and intensity.
- One look on WebGPU, WebGPU's compatibility mode and WebGL2, with image references on the Mac's GPU and on SwiftShader.
- Near zero cost while a scene has no area light: no download, no pass, and no measurable GPU time in the lit shaders.
- The WebGPU path stays within the portable budget of 16 sampled textures per stage. The WebGL2 lit stages keep spare texture units ([D-89](D-89-webgl2-texture-units.md)).
- No allocation per frame ([AGENTS.md](../../AGENTS.md#hard-rules), hard rule 1).

## Options

### How a surface takes light from an area

| Option | Who does it | Verdict |
| --- | --- | --- |
| A: LTC: the integral of a fitted BRDF over the light's polygon, in closed form | three.js, Babylon.js, Unity HDRP, Unreal | Chosen. Exact diffuse light, and specular light within the fit's error, for any size and distance |
| B: the most representative point: a point light moved to where the area reflects most | Unreal before LTC, Frostbite's tubes | Rejected. Its highlight has the right place but the wrong shape and energy on smooth surfaces, which wet streets show |
| C: many point lights spread over the area | None for real time | Rejected. Cost grows with the size, and the highlight breaks into dots |

### Tube lights

three.js has no tube light. Heitz and Hill fit LTC to line lights too, with a closed form for a thin line. Here a tube light is instead a rectangle: the one through the tube's axis that faces the shaded point. It is as long as the tube and as wide as its diameter. From any point, a thin cylinder looks like that rectangle. So the integral is the rectangle's, and the shader reuses the rectangle's code. The round ends add no light, which a thin tube does not show. A tube seen end on, along its own axis, gives no light.

### The fitted tables

LTC needs two tables of 64 x 64 entries. One holds the four values of the inverse matrix that fits GGX, and the other the two terms of its Fresnel weight. Fitting them takes minutes of optimization, so the engine cannot make them at run time. [D-53](D-53-technique-defaults.md) ruling 20 records them as an exception to the rule that built-in assets are made at run time. They are three.js 0.186.1's copy of Heitz's fit: `RectAreaLightTexturesLib`, from `selfshadow/ltc_code`, under the BSD two-clause licence.

How they ship (sizes in bytes; the tables' six used channels as half floats):

| Form | Raw | Brotli | gzip |
| --- | --- | --- | --- |
| three.js's eight channels, as stored | 65,536 | 40,516 | 49,005 |
| Six channels, interleaved | 49,152 | 37,980 | 42,012 |
| Six channels, one plane each | 49,152 | 32,874 | 37,544 |
| The same, each value less its left and upper neighbors, low and high bytes apart | 49,152 | 16,976 | 19,244 |

The engine ships the last form, gzipped, as `vendor/ltc/area-light-tables.bin` in the engine's package: 19,299 bytes with three.js's own half floats. Browsers unpack gzip with `DecompressionStream`. So every server and CDN sends 19.3 KB, whether or not it compresses files itself. A JavaScript module of the same data would need a text form, which compresses worse. It would also count against the 16 KB limit of first-use code. `bun tools/area-light-tables.ts` writes the file from the engine's three.js, and a unit test checks it. The test and `--check` compare the unpacked bytes, never the gzip bytes. A gzip header names the system that wrote it: 19 on the Mac, 3 on Linux. So the packed bytes differ between machines.

The third channel of the second table is zero. Its fourth holds the form factor of a horizon-clipped sphere, which three.js replaces by an approximation (`LTC_ClippedSphereFormFactor`). So the file holds six channels.

### Where the shaders read the tables

| Option | WebGPU textures in the lit fragment stage | WebGL2 units of the largest lit stage | Verdict |
| --- | --- | --- | --- |
| A: a texture of its own at a new binding | 16 of 16: the last one | +1 | Rejected. The light probe grid and reflection probes need sampled textures too, and the stage would have none left |
| B: layers of the split-sum table's texture, at binding 3 | 15 of 16, as before | +1, at binding 3, which WebGL2 does not use | Chosen |
| C: columns of the material table's texture on WebGL2, as the split-sum table sits there | 15 of 16 | +0 | Rejected. The material texture would need 64 rows and 128 more columns in every scene. The change also clashes with the clearcoat work on the same columns |

So binding 3 of the frame group becomes the light tables: a 2D array of half floats, 64 x 64 texels. Layer 0 holds the split-sum table in its corner. WebGPU reads it there, and WebGL2 still reads its copy beside the material table. Layers 1 and 2 hold the area lights' tables. The shaders read them through the environment's filtering sampler, which the frame group already binds at binding 13. So the GPU filters between the four nearest entries in one read per table. A hand-made filter with `textureLoad` would take eight reads. On WebGL2 it would also pair the texture with no sampler as well as with the images' sampler, which takes a second unit.

### Textured emission

A rectangle light can take an image, such as a shop window, a sign or a screen. Its light then varies across its area. The shader follows Heitz's demo code. In the frame that each lobe's LTC matrix makes, it reads the image where the surface point's foot meets the light's plane. The mip level grows with the plane's distance over the light's size. So rough lobes and far surfaces see the image blurred, and mirror-like ones see it sharp. Heitz blurs each level of a prefiltered pyramid with a Gaussian, and pads the image with a border. The engine uses plain mip levels and clamps at the edges, which costs no pass and looks the same on soft images.

The sketch thread resamples each image to 128 x 128 texels in linear light and makes its mip levels. In Bun on the Mac, at a load of 12, that took 0.5 to 1.4 ms for images up to 512 x 512 pixels, and 4.5 ms at 1,024 x 1,024. Each image takes a layer of the light tables' array, so it needs no binding either. The texture then grows to 128 x 128 texels with every level, with the tables in a corner of their layers. It makes room for 4 images, then 8, 16 and 32, and the frame groups bind it again. Up to 32 lights show images at once: 5.5 MiB of GPU memory with every level.

### Records and culling

Area lights use the 64-byte records of point and spot lights (`null3d_core::lights`, and [clustered forward shading](../../docs/concepts/lighting.md#clustered-forward-shading)). A rectangle needs its middle, its range, its color and two half sides: 13 floats. The record keeps its kind and its row. An area light needs neither the decay nor the cone, so the half sides take those places. Its image's layer takes the place of the shadow tile, since area lights cast no shadows. The light grid culls each light by its range sphere, which holds an area light too. So the grid, its compute pass and its job worker code do not change. Point, spot and area lights share one loop in the shader.

A rectangle light needs a range, as point and spot lights do. three.js's `RectAreaLight` has none: its light reaches everything. The light fades to nothing at the range from its middle, with three.js's window for point lights.

### Cost limits

Each preset's `areaLights` caps the area lights that one frame shades: 4 on Low, 8 on Medium, 16 on High and 32 on Ultra. Demos keep the presets' caps, so a scene must read well with the lights that the cap keeps.

Which lights the cap keeps:

| Option | Verdict |
| --- | --- |
| A: the lights whose range spheres come nearest the camera (distance less range), as the frame's cap of all lights does | Rejected. Brightness and size count for nothing, so a big dim light with a long range pushes out a small bright one beside it. A light also switched on or off at once when it crossed the cap, so lights popped while the camera orbited |
| B: an estimate of each light's light at the camera: its luminance (color times intensity) times its area, over the squared distance to its nearest point, with the light's own window as a cut-off at its range | Chosen. It takes a few dozen operations per area light, on the CPU, and only in frames with more area lights than the cap |
| C: each light's light over the visible surfaces, per cluster or per screen tile | Rejected. It costs work per cluster and light, and the clusters are listed after the choice |

A light past its range keeps a ten-thousandth of its estimate, so lights out of range still rank among themselves. Equal estimates fall back to option A's order.

How a light crosses the cap:

| Option | Verdict |
| --- | --- |
| A: on or off at once | Rejected. The pop shows on wet streets and shiny floors |
| B: keep a kept light until another beats it by a margin | Rejected. It makes a swap rarer, but each swap still pops |
| C: fade each light's color over 8 frames, in when it joins the kept lights and out when it leaves them | Chosen. A light that leaves keeps shading while it fades, so for those frames more lights than the cap shade. A light that comes into view, and every light of the first frame, starts at its end weight, so held frames show no fade |

The fade counts frames, not seconds, so a held frame and its test images do not depend on the frame rate. At 60 frames a second it lasts 133 ms. Each view's light grid keeps its own fades, by the lights' rows, in a list that grows only when the scene makes more lights. The coordinator asked for this change in the same pull request on 12 October 2026. Then no scene with more area lights than the cap pops.

## Data

### Parity with three.js

The `lights-rect` image test lights the floor of the light scenes with three rectangle lights. They are a panel that faces down, a tall window that faces the camera, and a long strip that tilts toward the middle. Its three.js twin draws the same scene with `RectAreaLight`. `bun run parity -- --scene lights-rect` compares them, with the spot lights as a control:

| Scene | WebGPU | Compatibility mode | WebGL2 | three.js's rule | three.js's renderers differ by |
| --- | --- | --- | --- | --- | --- |
| Rectangle lights | 0.000% | 0.005% | 0.000% | under 0.1% | 0.008% |
| Spot lights (control) | 0.000% | 0.019% | 0.000% | under 0.1% | 0.011% |

How the data was produced: Chrome on the Mac's GPU, 12 October 2026, through `heavy.sh`. The figures are the shares of pixels that differ.

### Cost

The light grid ranks the area lights and fades them on the CPU, in each view's grid, before it slices the lights. Its whole step, the choice and the slicing, took this long per frame in a release build on the Mac (Apple M5 Max), at a load below 8, on 13 October 2026:

| Area lights in view | No cap reached | Cap of 4 |
| --- | --- | --- |
| 64 | 0.71 µs | 0.77 µs |
| 256 | 2.57 µs | 2.80 µs |

The ranking adds 0.06 µs for 64 lights and 0.23 µs for 256. It allocates only when the light table or the visible list grows past what an earlier frame met.

The area lights' code first sat in the light loop of every lit build. S4 has no area light, and still drew 5.3% slower at Medium and 5.4% slower at High. [D-156](D-156-template-scoped-permutation-bits.md) gives the figures. That code now loads only in the lit templates' `AREA_LIGHTS` builds, on first use. UNUSED

## Decision

Decided: option A for shading, the facing rectangle for tubes, and the gzip file of the tables. Option B for the tables' binding, with the images as layers of the same array. The records of point and spot lights, and a cap per preset. The cap keeps the lights with the most light at the camera, with a fade of 8 frames across it.

## Consequences

- The core's light table gains the kinds `RECT` and `TUBE`, and the numbers `WIDTH`, `HEIGHT`, `RADIUS` and `IMAGE`. The engine sets the last. A rectangle's light leaves along its -Z axis, as a spot light's does, and a tube runs along it.
- `scene.createRectAreaLight` and `scene.createTubeLight` make them, and `RectAreaLight.setImage` gives a rectangle light its picture. The first area light starts the tables' download, and a held frame waits for it. Until the tables arrive, the frame shades no area light. A failed download reports E1431.
- The lights page, the lighting concept page, the performance guide, the quality presets and the develop and porting skills describe the feature. The three.js mapping's `RectAreaLight` moves from post-1.0 to a changed mapping, which needs a range.
- Scene passes and reflection passes list the area lights that their cameras see, in their own light grids ([D-104](D-104-scene-passes.md)). Each grid applies the cap on its own. So a wet street in a reflection shows the shop windows too.
- The WebGL2 test of texture units keeps three spare units, not four.
- The engine's third-party notices gain the LTC fit's licence.
- `bench:allocation --area-lights` samples area lights in S1, and the effect cost page measures them (`?effect=area`).
