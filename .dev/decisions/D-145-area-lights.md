# D-145: Area lights

Status: proposed by the helper of M2-EX28 on 12 October 2026, for the owner's review. Date: 2026-10-12. Task: M2-EX28.

Summary: Rectangle lights and tube lights light the standard material with linearly transformed cosines (LTC), the technique of every engine with rectangle lights. A rectangle light gives the same light as three.js's `RectAreaLight`, with three.js's formulas and its fitted tables. A tube shades as the rectangle through its axis that faces the surface, so it costs the same. Area lights join the clustered point and spot lights in the same 64-byte records, culled by their range spheres, and each quality preset caps how many a frame shades. The two fitted tables load on first use from a gzip file of 19.2 KB, and share the frame group's binding of the split-sum table, so WebGPU gains no binding and WebGL2 one texture unit.

## Question

The showcase scenes need light from shop windows, neon tubes and studio panels ([D-142](D-142-more-techniques-before-1-0.md)). A point light gives such a source a pin-point highlight and a hard falloff. How does the engine shade light from an area, which shapes does it offer, and what does it cost when a scene uses none?

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

three.js has no tube light. Heitz and Hill fit LTC to line lights too, with a closed form for a thin line. A tube light here is instead the rectangle through the tube's axis that faces the shaded point, as long as the tube and as wide as its diameter. From any point a thin cylinder looks like that rectangle, so the integral is the rectangle's, and the shader reuses the rectangle's code. The round ends add no light, which a thin tube does not show. A tube seen end on, along its own axis, gives no light.

### The fitted tables

LTC needs two tables of 64 x 64 entries: the four values of the inverse matrix that fits GGX, and the two terms of its Fresnel weight. Fitting them takes minutes of optimization, so the engine cannot make them at run time. [D-53](D-53-technique-defaults.md) ruling 20 records them as an exception to the rule that built-in assets are made at run time. They are three.js 0.186.1's copy of Heitz's fit (`RectAreaLightTexturesLib`, from `selfshadow/ltc_code`, BSD two-clause licence).

How they ship (sizes in bytes; the tables' six used channels as half floats):

| Form | Raw | Brotli | gzip |
| --- | --- | --- | --- |
| three.js's eight channels, as stored | 65,536 | 40,516 | 49,005 |
| Six channels, interleaved | 49,152 | 37,980 | 42,012 |
| Six channels, one plane each | 49,152 | 32,874 | 37,544 |
| The same, each value less its left and upper neighbors, low and high bytes apart | 49,152 | 16,976 | 19,244 |

The engine ships the last form, gzipped, as `vendor/ltc/area-light-tables.bin` in the engine's package. Browsers unpack gzip with `DecompressionStream`, so every server and CDN sends 19.2 KB, whether or not it compresses files of its own. A JavaScript module of the same data would need a text form, which compresses worse, and would count against the 16 KB limit of first-use code.

The third channel of the second table is zero. Its fourth holds the form factor of a horizon-clipped sphere, which three.js replaces by an approximation (`LTC_ClippedSphereFormFactor`). So the file holds six channels.

### Where the shaders read the tables

| Option | WebGPU textures in the lit fragment stage | WebGL2 units of the largest lit stage | Verdict |
| --- | --- | --- | --- |
| A: a texture of its own at a new binding | 16 of 16: the last one | +1 | Rejected. The light probe grid and reflection probes need sampled textures too, and the stage would have none left |
| B: layers of the split-sum table's texture, at binding 3 | 15 of 16, as before | +1, at binding 3, which WebGL2 does not use | Chosen |
| C: columns of the material table's texture on WebGL2, as the split-sum table sits there | 15 of 16 | +0 | Rejected. The material texture would need 64 rows and 128 more columns for every scene, and the change clashes with the clearcoat work on the same columns |

So binding 3 of the frame group becomes the light tables: a 2D array of half floats, 64 x 64 texels. Layer 0 holds the split-sum table in its corner, which WebGPU reads there and WebGL2 still reads beside the material table. Layers 1 and 2 hold the area lights' tables. The shaders read them through the environment's filtering sampler, which the frame group already binds at binding 13, so the GPU filters between the four nearest entries in one read per table. A hand-made filter with `textureLoad` would take eight reads. On WebGL2 it would also pair the texture with no sampler as well as with the light images' sampler, which takes a second texture unit.

### Textured emission

A rectangle light can take an image, such as a shop window, a sign or a screen. Its light then varies across its area. The shader follows Heitz's demo code: in the frame that each lobe's LTC matrix makes, the image is read where the surface point's foot meets the light's plane. The mip level grows with the plane's distance over the light's size, so rough lobes and far surfaces see the image blurred, and mirror-like ones see it sharp. Heitz blurs each level of a prefiltered pyramid with a Gaussian and pads the image with a border. The engine uses plain mip levels and clamps at the edges, which costs no pass and looks the same on soft images.

The sketch thread resamples each image to 128 x 128 texels in linear light and makes its mip levels. In Bun on the Mac, at a load of 12, that took 0.5 to 1.4 ms for images up to 512 x 512 pixels, and 4.5 ms at 1,024 x 1,024. It joins the light tables' array as a layer of its own, so it needs no binding either. The tables' texture then grows to 128 x 128 texels with every level, with the tables in a corner of their layers, and room for 4 images, then 8, 16 and 32. The frame groups then bind it again. Up to 32 lights show images at once, which is 5.5 MiB of GPU memory with every level.

### Records and culling

Area lights use the 64-byte records of point and spot lights (`null3d_core::lights`, and [clustered forward shading](../../docs/concepts/lighting.md#clustered-forward-shading)). A rectangle needs its middle, its range, its color and two half sides, which is 13 floats. The record keeps its kind and row, and an area light needs neither the decay nor the cone, so the half sides take those places. Its texture's layer takes the place of the shadow tile, since area lights cast no shadows. The light grid culls each light by its range sphere, which holds an area light too. So the grid, its compute pass and its job worker code do not change, and point, spot and area lights share one loop in the shader.

A rectangle light needs a range, as point and spot lights do. three.js's `RectAreaLight` has none: its light reaches everything. The light fades to nothing at the range from its middle, with three.js's window for point lights.

### Cost limits

Each preset's `areaLights` caps the area lights that one frame shades. Past the cap, the frame keeps the area lights nearest the camera, as the light grid already does for all lights. The figures below set the caps.

## Data

### Parity with three.js

The `lights-rect` image test lights the floor of the light scenes with three rectangle lights: a panel that faces down, a tall window that faces the camera, and a long strip that tilts toward the middle. Its three.js twin draws the same scene with `RectAreaLight`. `bun run parity -- --scene lights-rect` compares them, with the spot lights as a control:

| Scene | WebGPU | Compatibility mode | WebGL2 | three.js's rule | three.js's renderers differ by |
| --- | --- | --- | --- | --- | --- |
| Rectangle lights | 0.000% | 0.005% | 0.000% | under 0.1% | 0.008% |
| Spot lights (control) | 0.000% | 0.019% | 0.000% | under 0.1% | 0.011% |

How the data was produced: Chrome on the Mac's GPU, 12 October 2026, through `heavy.sh`. The figures are the shares of pixels that differ.

The remaining figures, to be measured: the GPU time per frame of a scene with 1, 4 and 16 area lights against the same scene with point lights, on WebGPU and WebGL2; S4 and S6 with the change and without (`bun run bench:gpu-check`); and the start shader files' growth after Brotli.

## Decision

Proposed: options A for shading, the facing rectangle for tubes, the gzip file of the tables, option B for the tables' binding, layers of the same array for images, the shared records, and a cap per preset.

## Consequences

- The core's light table gains the kinds `RECT` and `TUBE`, and the numbers `WIDTH`, `HEIGHT`, `RADIUS` and `IMAGE`, the last of which the engine sets. A tube runs along its light's -Z axis, and a rectangle's light leaves along it, as a spot light's does.
- `scene.createRectAreaLight` and `scene.createTubeLight` make them, and `RectAreaLight.setImage` gives a rectangle light its picture. The first area light starts the tables' download, and a held frame waits for it. Until the tables arrive, the frame shades no area light. A failed download reports E1430.
- The lights page, the lighting concept page, the quality presets, the three.js mapping (`RectAreaLight` from post-1.0 to direct), and the develop and porting skills change with the feature.
- The WebGL2 test of texture units keeps three spare units, not four.
- The engine's third-party notices gain the LTC fit's licence.
