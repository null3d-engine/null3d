# D-19: Environment maps: format, size, levels and where they are prefiltered

Status: decided, 2026-10-04: the file and the tool with M2-B2, then the lookup, the built-in environment's name and the lit scenes' parity with M2-E2. The lookup's cost on the iPad and the S24+ is pending. Date: 2026-10-04. Tasks: M2-B2, M2-E2.

## Question

Image-based light needs the environment's light filtered for each roughness of the engine's materials, and its diffuse light. Which texture format, face size and levels hold the filtered light? Where does the filtering run: in the asset tool before release, or in the browser at load? And how far may the result lie from three.js's `PMREMGenerator` for the same file?

Then, for the shader (M2-E2): which level does a material of a given roughness read? What is the built-in environment called? And how does the lookup reach the lit template: as a build of its own, or as a value of each frame?

## Rule

- The format filters on both GPU paths and in WebGPU's compatibility mode, with no optional feature.
- Parity with three.js's PMREM within a tolerance that this record sets from measured data.
- At most 4 MiB of GPU memory for an environment at the default size.
- The tool's output has the same bytes on every machine, as [D-18](D-18-asset-tool.md) requires.

## The options

| Choice | Options | Taken |
| --- | --- | --- |
| Where the filtering runs | In the tool, once, before release; or in the browser on every visit, as three.js does | The tool. Loading an HDR file at run time is M2-E4, a later path whose result must match the tool's |
| Texel format | `rgb9e5ufloat` (4 bytes) or `rgba16float` (8 bytes): both filter on every path and in compatibility mode. `rg11b10ufloat` filters too, but WebGL2 uploads no packed data for it, and 6 bits of mantissa band in a sky | `rgb9e5ufloat` by default, `rgba16float` on request |
| Layout | A cube map with a mip chain, one roughness per level; or three.js's CubeUV atlas, a 2D texture of faces and extra blurred levels | A cube map. The GPU filters across face edges and between levels, so the lookup is one `textureSampleLevel` |
| Face size | 128, 256 or 512, down to faces of 8 texels | 256 |
| Diffuse light | Nine spherical harmonics coefficients, or the roughest level | Nine coefficients, as three.js's `LightProbe` holds them |

## Data

All figures read 4,096 directions on a Fibonacci spiral. The tool's file is sampled on the CPU, as a shader samples a cube map. three.js 0.186.1's PMREM is sampled with its own `textureCubeUV`, in Chrome on the Mac's GPU. Each value is tone mapped with Reinhard's operator, at an exposure that puts the environment's average light at a third of white. The figures are steps of 1/255: the mean step, and the step that 99% of the values stay within (p99). Tone mapping first makes a sun count as much as it shows on screen. Raw light values gave errors of over 2,000% at roughness 0. They all came from a few sun texels, which one side spread over a texel four times as large.

The files are Poly Haven's Venice Sunset (a low sun, peak light 8,320) and Potsdamer Platz (an overcast street, peak 12.8). Both are 2048 x 1024 Radiance files.

### Texel format and face size

| Option | GPU memory | Against 256 `rgb9e5ufloat` at roughness 0 / 0.3 / 1, mean / p99 | Against three.js at roughness 0, mean / p99 |
| --- | --- | --- | --- |
| 128, `rgb9e5ufloat` | 512 KiB | 0.95 / 10.9, 0.55 / 3.1, 0.14 / 0.6 | 1.54 / 15.7 |
| 256, `rgb9e5ufloat` | 2.0 MiB | | 0.80 / 8.4 |
| 256, `rgba16float` | 4.0 MiB | 0.03 / 0.1, 0.02 / 0.1, 0.03 / 0.1 | 0.80 / 8.4 |
| 512, `rgb9e5ufloat` | 8.0 MiB | 0.65 / 7.7, 0.59 / 3.0, 0.02 / 0.2 | 0.34 / 3.2 |

The worst of the two files is shown. The shared exponent costs nothing that a picture shows: 0.03 steps at most. So `rgb9e5ufloat` halves the memory for free. Size 512 sharpens mirror reflections only, at four times the memory. The `--size` option gives it for scenes that need it. three.js prefilters a 2048-wide file at 512.

### The level of each roughness

Level 0 holds the environment. Level i of n holds perceptual roughness 1 - sqrt(1 - i / (n - 1)), so the lookup is `lod = (n - 1) * r * (2 - r)`, as Filament's is. At 256 that gives roughness 0, 0.11, 0.23, 0.37, 0.55 and 1. Levels spaced evenly in roughness (0, 0.2, 0.4 and up) put no level between 0 and 0.2, where reflections change fastest. With them, roughness 0.1 lay 38.6% (root mean square, Venice) from the best match to three.js, and 11.9% with the levels above.

### The filter

Each level filters the environment with the GGX distribution, view along the normal (the split-sum view of Karis, 2013). The directions come from GGX importance sampling of half vectors in a Hammersley set, the same for every texel. Each direction reads a smaller level of the source as its share of the sphere grows (filtered importance sampling, Křivánek and Colbert, 2008). Level 1 takes 512 directions per texel, and each smaller level twice as many as the one before, up to 8,192. The smaller levels have a quarter of the texels each, and their wide lobes need more directions.

| Directions at level 1 | Venice, mean / largest step against 16,384, levels 1 to 5 |
| --- | --- |
| 256 | 0.24 / 14.8, 0.31 / 7.9, 0.24 / 4.6, 0.16 / 2.9, 0.14 / 0.9 |
| 512 | 0.16 / 13.3, 0.18 / 5.4, 0.13 / 4.0, 0.08 / 2.0, 0.00 / 0.0 |
| 1024 | 0.10 / 10.7, 0.09 / 3.8, 0.06 / 2.3, 0.00 / 0.0, 0.00 / 0.0 |

The largest steps lie at the sun's edge. With the same 512 directions at every level, level 5 lay 1.17 steps from the reference on average, so the doubling matters. A 2048 x 1024 file took 4.7 s of CPU time at the defaults on the Mac (Apple M5 Max), in one thread.

### Parity with three.js's PMREM

three.js's PMREM blurs less than the GGX distribution of its own materials. At each material roughness, its `textureCubeUV` reads a level filtered for a lower roughness. Read at the material's own roughness, the tool's map lay at most 4.5 steps from three.js on average. Its worst p99 was 19.1 steps, at roughness 0.05 on the street. Read at the GGX roughness that matches three.js best, every roughness lay within 2.6 steps on average and 11.2 at p99:

| Material roughness in three.js | 0.1 | 0.2 | 0.3 | 0.4 | 0.5 | 0.6 | 0.7 | 0.8 | 0.9 | 1 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GGX roughness that matches best | 0.07 | 0.19 | 0.255 | 0.345 | 0.41 | 0.50 | 0.61 | 0.775 | 0.875 | 0.98 |
| Mean / p99 at its own roughness, Venice | 0.95 / 8.6 | 1.13 / 6.2 | 2.22 / 9.5 | 2.86 / 11.5 | 3.91 / 14.1 | 3.64 / 12.4 | 2.25 / 9.0 | 1.14 / 5.7 | 1.83 / 6.9 | 2.66 / 8.7 |
| Mean / p99 at the matching roughness, Venice | 0.73 / 6.6 | 1.06 / 6.5 | 1.10 / 6.6 | 0.95 / 4.4 | 0.77 / 3.5 | 0.59 / 2.8 | 0.60 / 2.1 | 1.04 / 3.5 | 1.72 / 6.0 | 2.52 / 8.6 |

The full table, in steps of 0.05, is `THREE_PMREM_ROUGHNESS` in `tests/lib/environment-maps.ts`. Both files gave the same best roughness within 0.02 at every step. The total light of the tool's levels lay within 1.2% of three.js's at every roughness from 0.1 up.

Diffuse light: three.js lights diffuse surfaces with pi times its PMREM at roughness 1. The nine coefficients' irradiance over pi lay 2.74 / 11.3 steps from that on Venice, and 2.31 / 8.8 on the street. The total light matched within 0.2%. The GGX filter at roughness 1 gives the cosine-weighted average of the hemisphere. Against the tool's own level of roughness 1, the coefficients lay 1.55 / 6.2.

Where three.js and the tool differ on purpose:

- three.js samples the HDR file at one point per CubeUV texel. The tool averages 2 to 8 directions per side of each texel, so a sun keeps its light at every size.
- three.js's PMREM keeps 16-bit floats, so light above 65,504 becomes infinite or clamps. The tool filters in 32-bit floats and clamps only the stored texels, at 65,408. Poly Haven's Kloofendal sky peaks at 73,216. There the two differed by 2 to 5% in total light, against at most 1.2% on the other files.

How the data was produced: `NULL3D_ENV_PARITY_FIT=1 NULL3D_PORT=<port> bun run --cwd tests test environment-parity.spec.ts --project chrome-real-gpu` prints the best match at each roughness and the size and format figures. The sample-count figures came from a script that built Venice at each count with `environmentMap` and compared the levels texel by texel.

### The lookup in lit scenes

Two lookups were built and drawn against three.js's `scene.environment`, through `PMREMGenerator`, on the standard material's grid of 15 spheres (`tests/pages/sketches/standard-sketch.ts?scene=grid&env=...`, `bench/pages/threejs/environment.ts`). One reads each material's own roughness from the levels. The other reads the GGX roughness of the table above, `THREE_PMREM_ROUGHNESS`, blended between its steps. The scenes light the grid with the environment alone, with no tone mapping, on the Mac's GPU in Chrome. The figures are steps of 1/255 between the two engines' pixels, mean / p99, over the pixels that either image covers with a sphere. "Rule" is the share of pixels that three.js's image rule counts as different. It allows under 0.1%, or under the share by which three.js's own two renderers differ.

| Scene and tier | Own roughness | Table | Rule, own / table | three.js's renderers differ by |
| --- | --- | --- | --- | --- |
| Venice, WebGPU | 2.45 / 8.3 | 1.97 / 7.3 | 0.000% / 0.000% | 0.133% |
| Venice, WebGL2 | 2.47 / 8.7 | 1.96 / 7.0 | 0.000% / 0.000% | |
| Venice, compatibility mode | 2.96 / 16.3 | 2.48 / 16.3 | 0.046% / 0.044% | |
| Venice turned a quarter about +Y, WebGPU | 2.52 / 10.7 | 2.13 / 10.7 | 0.002% / 0.002% | 0.201% |
| Room, WebGPU | 5.01 / 24.0 | 4.01 / 13.3 | 0.183% / 0.064% | 0.316% |
| Room, WebGL2 | 5.21 / 24.3 | 4.21 / 14.3 | 0.191% / 0.060% | |
| Room, compatibility mode | 6.02 / 28.3 | 5.07 / 26.3 | 0.428% / 0.301% | |

Take the columns of roughness 0, 0.25, 0.5, 0.75 and 1, on Venice and WebGPU. With the material's roughness, their mean steps were 1.70, 2.28, 3.08, 2.89 and 2.30. With the table, they were 1.57, 1.65, 1.67, 2.67 and 2.27. The room's went from 4.03, 6.42, 5.96, 4.39 and 4.27 to 4.04, 4.37, 3.43, 4.09 and 4.14. The table helps most at roughness 0.25 to 0.5, where three.js's PMREM is sharpest against its own materials. Compatibility mode differs more on both lookups, at the spheres' edges. With MSAA it takes the 8-bit path, which encodes each sample's color before it averages them.

The turned scene sets `scene.environmentRotation` in three.js and `rotation` in the engine. It matches as closely as the scene that is not turned, so both engines turn the map the same way.

### The built-in room

The built-in room is three.js's `RoomEnvironment`, which the tool traces from the room's center. three.js's examples prefilter it with `fromScene(room, 0.04)`: a blur of 0.04 radians before the levels. The room's file has no such blur. On the CPU, against three.js's PMREM with no blur, its level 0 lay 1.53 / 3.0 steps away. Its total light lay 0.7% above three.js's. With the blur, level 0 lay 5.49 / 108 steps away, all of it at the panels' sharp edges. From roughness 0.1 up, the room lay 2.6 to 5.3 steps from three.js at the table's roughness, with p99 up to 34. Its light lay 1.2% to 2.4% above three.js's. The diffuse light lay 3.20 / 7.9 steps away. The panels are small and over 50 times as bright as the walls. So small differences in a filter's shape show at their edges, as a sun's edge shows in an HDR file. The lit spheres meet three.js's rule all the same (0.064% and 0.060% of pixels, above).

### The lookup as a value, not a build

The engine builds a shader for each combination of its permutation bits. A bit for the environment would double the variants of the standard material and of its maps build. Every device module would then nearly double in size. Instead, the frame's group always binds a cube: the environment's, or a blank cube of one texel. The frame uniform says whether to read it. Without an environment, each pixel pays one branch on a uniform, which every pixel takes the same way. Color grading tables work the same way (D-33).

The lookup's code adds 0.7 to 2.2 KB after Brotli to each device module, 2.9% to 9.2%. It holds the table, the nine coefficients and the split-sum terms of image light. The frame uniform grows from 288 to 512 bytes per view. Bytes 304 to 511 hold the nine coefficients, the turn's three rows, and the map's last level, intensity and switch. Bytes 288 to 303 and binding 11 belong to ambient occlusion (M2-F2).

## Decision

- The asset tool prefilters, once, in its WebAssembly module (`crates/null3d-assets-wasm/src/environment/`). The module is single-threaded and uses no host math, so every machine writes the same bytes, in Node and in Bun.
- The file is a KTX2 cube map of `rgb9e5ufloat` texels (`VK_FORMAT_E5B9G9R9_UFLOAT_PACK32`) with 256 x 256 faces. Its six levels go down to 8 x 8, in 2.0 MiB of GPU memory. `--format rgba16float` and `--size` from 32 to 2048 change it.
- Each level holds the GGX-filtered light of one perceptual roughness, with the lookup `lod = (n - 1) * r * (2 - r)`.
- The file's key-value data holds `null3d.environment`: JSON with `version` 1, `sh`, the nine coefficients' red, green and blue values in three.js's order, and `roughness`, each level's roughness.
- Tolerances against three.js's PMREM, in steps of 1/255 after tone mapping, as mean / p99. The test `tests/image/environment-parity.spec.ts` checks them:
  - 6 / 24 at the material's own roughness;
  - 3.5 / 14 at the matching roughness of the table;
  - 4 / 14 for diffuse light;
  - the total light within 2% from roughness 0.1 up.
- The built-in room repeats three.js's `RoomEnvironment` scene. The tool traces it from the center. It shades it as `MeshStandardMaterial` does with its defaults, with no shadows, as three.js draws it.
- The built-in environment is named `room`, after three.js's `RoomEnvironment`, which porters know. A sketch calls `assets.builtinEnvironment('room')` for it. The tool, the docs, the skills and the mapping all use that name. The studio preset of drei is an HDR file of its own, which ports through the tool.
- The lit template reads each material's roughness from the level of the table's GGX roughness, `THREE_PMREM_ROUGHNESS`, blended between its steps of 0.05: `lod = (n - 1) * g * (2 - g)`. The porting promise is the look of the three.js scene, and three.js's PMREM sets that look. The table brings the lit spheres within three.js's image rule on both environments and every tier, which the material's own roughness misses on the room. The table lives in `crates/null3d-shaders/wgsl/lib/ibl.wgsl`.
- Diffuse light comes from the nine coefficients. Specular light comes from the cube map along the reflection, bent toward the normal by roughness to the fourth power, as three.js's `getIBLRadiance` bends it. Both go through three.js's `RE_IndirectSpecular_Physical`, and the occlusion map darkens the specular light by `computeSpecularOcclusion`.
- `scene.setEnvironment(env, { intensity, rotation })` sets the scene's environment from the next frame, with three.js's `environmentIntensity` and `environmentRotation` (Euler angles in the order X, Y, Z). A material's `envIntensity` multiplies the intensity. three.js uses `environmentIntensity` in place of a material's `envMapIntensity` under a scene environment. The engine multiplies them, so the material's value keeps its meaning.
- The environment is a value of each frame, not a permutation bit. The frame's group binds the environment's cube, or a blank one, at bindings 12 and 13. A frame builder reads the environment after the frame's texture uploads, so a held frame, which uploads everything, draws with it.
- Tolerances for lit scenes: three.js's image rule, as for every feature scene (`FEATURE_SCENES` in `bench/lib/parity.ts`). The CPU test of the room's file compares it with three.js's room with no blur. Its own limits are 9 / 50 at the material's roughness, 6 / 40 at the table's, and 3% of total light. The panels' edges set them.

## Consequences

- `bunx @null3d/cli assets env <in.hdr|in.exr> <out.ktx2>` writes the file, and `--builtin room` writes the built-in room. `packages/engine/environments/room.ktx2` is the room's file in the engine's package. A unit test checks that it matches the tool's output byte for byte, and `NULL3D_WRITE_ENVIRONMENTS=1 bun test packages/cli/src/assets/env.test.ts` writes it again.
- OpenEXR files read through the `exr` crate (BSD-3-Clause), which reads every compression but DWAA and DWAB. The tool's module grew from 16 KB to 115 KB after Brotli, most of it the reader.
- `assets.loadEnvironment(url)` reads the tool's files, and `assets.builtinEnvironment('room')` the room's. The reader loads on first use, under 1 KB after Brotli, and the room's file downloads only when a sketch asks for it.
- The image tests `environment-room`, `environment-venice` and `environment-venice-rotated` draw the grid on all three tiers, and the parity scenes of the same names compare it with three.js. The dev server builds the Venice map from the sample content's HDR file with the tool, on the first request (`tools/lib/sample-environments.ts`).
- On WebGL2 the cube map takes one texture unit of the fragment stage. The standard material with all six maps reads 13 of the 16 that every device allows.
- Open: the lookup's GPU cost on the iPad, and the frame time at a GPU-bound size on the S24+. The device runner's `environment` plan measures both (`tests/pages/environment-cost.html`). Its scene draws 8 planes of the standard material over the whole window, without and with the room in turns. The difference over the layers is the lookup's cost. A functional run in Chrome on the Mac (Apple M5 Max) drew 1280 x 800 pixels. It gave 0.46 ms of GPU time without the room and 0.52 ms with it.
- Open: blur the room's level 0 by three.js's 0.04 radians in the tool, if ports of mirror-like surfaces need it.
- Open: after the browser replaces the GPU, an environment whose texels the store freed draws as none until the sketch loads it again. Every texture from data does the same, as M2-R6 notes for #76.
- Open for M2-E3: a blurred background reads the same levels. A sharp background may want `--size 512` or larger.
- Open: KTX2 supercompression. The room's 2.0 MB file is 331 KB with Brotli and 497 KB with gzip, so a host that compresses `.ktx2` files saves most of it. Zstandard in the file would need a decoder in the engine.
