# D-19: Environment maps: format, size, levels and where they are prefiltered

Status: decided, 2026-10-04: the file and the tool with M2-B2, then the lookup, the built-in environment's name and the lit scenes' parity with M2-E2. The same day, the owner moved the built-in room out of the engine's package: the GPU makes it at first use. That is now the rule for every built-in asset. The lookup's cost on the iPad and the S24+ is pending. Date: 2026-10-04. Tasks: M2-B2, M2-E2.

## Question

Image-based light needs the environment's light filtered for each roughness of the engine's materials, and its diffuse light. Which texture format, face size and levels hold the filtered light? Where does the filtering run: in the asset tool before release, or in the browser at load? And how far may the result lie from three.js's `PMREMGenerator` for the same file?

Then, for the shader (M2-E2): which level does a material of a given roughness read? What is the built-in environment called? And how does the lookup reach the lit template: as a build of its own, or as a value of each frame?

Last: how does the built-in room reach a page? As a file in the engine's package, or made on the GPU when a sketch first asks for it?

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
| The built-in room | A file in the engine's package; or the GPU makes it at first use, as three.js's `PMREMGenerator.fromScene` does | The GPU, by the owner's rule that built-in assets are made at run time |

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

The built-in room is three.js's `RoomEnvironment`, which the tool traces from the room's center. three.js's examples prefilter it with `fromScene(room, 0.04)`: a Gaussian blur of 0.04 radians before the levels. Nearly every three.js scene that uses the room makes it that way, so the tool blurs the traced room by the same 0.04 radians. Each texel weighs the directions around it on a grid of half a sigma, out to three sigmas.

The first room file had no blur, and shaded the walls with only part of three.js's standard material. On the CPU, against three.js's blurred room, its level 0 lay 5.49 / 108 steps away, all of it at the panels' sharp edges. Its total light lay 0.7% to 2.4% above three.js's, rising with roughness. The gap was a real difference in the walls' light. The tool's diffuse light kept the light that the specular layer reflects, where three.js's `RE_Direct_Physical` takes it away by `(1 - F)`. Its specular light also lacked three.js's compensation for multiple scattering, and its Fresnel term used the fifth power where three.js uses its exponential fit.

The room now shades as `RE_Direct_Physical` does, with three.js's table of split-sum terms at roughness 1 for the compensation, and takes the blur. Against three.js's blurred room:

| | Before | After |
| --- | --- | --- |
| Level 0, mean / p99 | 5.49 / 108 | 0.79 / 13.7 |
| Total light against three.js's, roughness 0.1 to 1 | +1.1% to +2.2% | -0.8% to +0.3% |
| Diffuse light, mean / p99, and total | 3.20 / 7.9, +2.4% | 3.27 / 9.2, +0.5% |
| Table's roughness, worst mean / p99 | 5.27 / 34.3 | 3.95 / 22.9 |
| Lit spheres, WebGPU: mean / p99, and the rule | 4.01 / 13.3, 0.064% | 3.27 / 10.7, 0.008% |
| Lit spheres, WebGL2 | 4.21 / 14.3, 0.060% | 3.39 / 11.0, 0.008% |
| Lit spheres, compatibility mode, the rule | 0.301% | 0.268% |

The light left over sits in the rough levels, as with the HDR files, and at the panels' edges. The panels are small and over 50 times as bright as the walls, so small differences between the two blurs show there. The blur leaves the file less compressible: 393 KB with Brotli, up from 331 KB, and 562 KB with gzip.

### The built-in room on the GPU

The first room was a file in the engine's package: `packages/engine/environments/room.ktx2`, 2.0 MB, 393 KB with Brotli. The engine found it with `new URL('../../environments/room.ktx2', import.meta.url)`. A bundler copies every such file into every game's build, so each game shipped 2 MB that most never load. An offline web app would download it ahead too. The owner decided on 4 October 2026 that built-in assets are made at run time, never shipped as binary files in the engine's package.

The engine now makes the room on the GPU, in the thread that draws, with the tool's steps:

1. Trace three.js's room from its center, 4 x 4 directions per texel, at faces of 256.
2. Blur it by 0.04 radians into the map's level 0 and into a chain. The taps lie on the tool's grid, half a sigma apart, out to three sigmas.
3. Halve the chain down to one texel: a linear filter reads four texels at their shared corner.
4. Filter each level from 1 to 5 with the GGX distribution, from the chain, with the tool's Hammersley set, sample counts and levels of detail.

Each draw fills rows of one level, with the level's six faces side by side in its target. So the texels of every face run at once.

No GPU path draws into `rgb9e5ufloat`. So each draw packs its texels into the four bytes of an `rgba8unorm` target, rounded as the tool rounds them. A buffer then carries the bytes into the face's level of a shared-exponent cube. WebGPU copies through a buffer, and WebGL2 through a pixel pack and unpack buffer. Every step reads shared-exponent texels with the GPU's own filtering. One path serves all three tiers. It needs no float render target, which some WebGL2 devices lack.

The table compares each texel with the tool's map of the room, tone mapped as above. It gives mean / p99 steps of 1/255, then the total light of each level over the tool's:

| Level (roughness) | Chrome on the Mac's GPU, every tier | SwiftShader, every tier |
| --- | --- | --- |
| 0 (0) | 0.003 / 0.12, 1.0000 | 0.002 / 0.11, 1.0000 |
| 1 (0.11) | 0.015 / 0.15, 1.0004 | 0.014 / 0.15, 1.0003 |
| 2 (0.23) | 0.046 / 0.20, 1.0011 | 0.036 / 0.20, 1.0009 |
| 3 (0.37) | 0.062 / 0.22, 1.0013 | 0.050 / 0.21, 1.0011 |
| 4 (0.55) | 0.073 / 0.21, 1.0014 | 0.058 / 0.21, 1.0011 |
| 5 (1) | 0.083 / 0.21, 1.0016 | 0.063 / 0.21, 1.0012 |

The lit spheres did not move. Against three.js, 0.008% of the pixels differ on WebGPU and on WebGL2, as with the file. In compatibility mode 0.268% differ, as before.

The work splits into 32 slices of about the same cost, and the core records one slice in each frame. So the room takes 32 frames, about half a second at 60 frames per second, and no frame carries all of it. A held frame records every slice at once. The cost of a slice comes from a model of each step's texel reads (`sliceBands` in `packages/engine/src/gpu/environment-steps.ts`), fitted to these measurements. The scene draws without the environment until the last slice has run, as it does while a file's map uploads.

The generator builds its pipelines in the background, after its code loads and before it counts as arrived. So no frame waits for a compile. A new GPU device builds them at its first slice.

Time on the Mac (Apple M5 Max) in Chrome, each slice from its call until the GPU had finished it:

| Path | The whole room, slices back to back | A slice, median / most | Pipelines, in the background |
| --- | --- | --- | --- |
| WebGPU | 21 ms, the first one 23 to 31 ms | 0.9 / 2.5 ms | 5 ms |
| Compatibility mode | 21 ms | 0.9 / 2.3 ms | 7 ms |
| WebGL2 | 19 ms (24 ms by timer queries) | 1.4 / 2.2 ms (0.5 / 1.8 ms by timer queries) | 10 ms |

SwiftShader took 0.7 to 1.0 s for the room, and 24 / 47 ms for a slice.

The work is about 66 million texel reads for the blur and 100 million for the filter, and the trace's rays. Before the faces drew side by side, each face of each level drew alone. The room then took 31.5 ms on WebGPU, and its slices up to 9.3 ms. The filter's smallest levels read up to 8,192 directions per texel over 64 texels a face. A draw of one face kept few of the GPU's lanes busy and waited on each texel's long loop. The first room also compiled its pipelines in its first slice. With an empty shader cache that took 382 ms on WebGPU and 195 to 394 ms on WebGL2.

The code and the shaders load on first use:

| File | After Brotli | Budget |
| --- | --- | --- |
| The generators of both paths, in the thread that draws | 2.1 KB | 16 KB |
| The room's numbers, in the thread that runs the sketch | 0.2 KB | 16 KB |
| The shaders, WGSL or GLSL, in the thread that draws | 4.2 KB or 4.4 KB | 24 KB |

The engine's JavaScript at a page's start grew by 1.0 KB, to 107.1 KB in pipelined mode. The backends' new command, the image table's generators and the texture call make it.

How the parts fit:

- The sketch thread makes a cube texture and asks the core for a generator. The generator takes the next image id, and its name, `room`, goes to the thread that draws as an image does. That thread loads the generators' code and the shaders of its GPU path, and builds the pipelines. Then it counts the generator among the images it received. The core waits for that count as it waits for an image. Then it records one command, `GenerateTexture`, in each of 32 frames, each with the next slice. A slice runs at once, before the frame's passes. Held frames wait for every image to arrive, so they wait for the generator too.
- The core keeps the generator after it ran. A new GPU device makes the room again from it, with no work from the sketch.
- The generator keeps its own textures and buffers from the first slice to the last. A slice of a map that is done, as when a capture replays a list again, does nothing. The WebGPU generator submits each slice's commands on their own. The WebGL2 generator changes the context's bindings, so the backend's state cache forgets them afterwards.
- The shader build writes a shader marked `first_use` into a module of its own for each target, `generated/shaders-environment-wgsl.ts` and `-glsl.ts`. The main shader module stays as it was. The size report gives such files a budget of 24 KB each after Brotli, by the owner's decision of 4 October 2026.

The options rejected:

- Templates and bind groups of the draw list, with the core recording each draw. A draw of a template whose pipeline still builds draws nothing, and a map made once cannot skip a draw. The shader text would also have to reach the backends by another way, since it loads on first use.
- Float render targets for every step. WebGL2 renders into `rgba16float` only with an extension that some devices lack, and the map would still need packing for `rgb9e5ufloat`.
- The nine coefficients of diffuse light on the GPU. The room never changes, so its coefficients never change. Reading them back would need a path from the thread that draws to the sketch's thread in every thread mode. In hold mode that thread draws only when a capture asks, so the sketch would wait for a frame that never comes. The engine keeps the tool's 27 numbers instead, nine for a gray room, in the file that loads on first use. They are derived data, not a shipped file, so they fit the owner's rule (agreed on 4 October 2026). A test of the tool checks that they are its own.

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
- The built-in room repeats three.js's `RoomEnvironment` scene. The tool traces it from the center. It shades it as `MeshStandardMaterial` does with its defaults, with no shadows, as three.js draws it. It then blurs it by 0.04 radians, as three.js's examples prefilter it.
- The engine makes the built-in room on the GPU when a sketch first asks for it, with the tool's steps, on every tier. Its package ships no file for it. Its map lies within 0.25 / 1 step of the tool's at every level, and its total light within 0.5% (`tests/image/environment-generator.spec.ts`). The tool's `--builtin room` stays: it is the reference of that test and of the parity test.
- General rule, from the owner on 4 October 2026: built-in assets are made at run time, never shipped as binary files in the engine's package. A built-in asset's code and shaders load on first use, within the budgets for such files.
- The built-in environment is named `room`, after three.js's `RoomEnvironment`, which porters know. A sketch calls `assets.builtinEnvironment('room')` for it. The tool, the docs, the skills and the mapping all use that name. The studio preset of drei is an HDR file of its own, which ports through the tool.
- The lit template reads each material's roughness from the level of the table's GGX roughness, `THREE_PMREM_ROUGHNESS`, blended between its steps of 0.05: `lod = (n - 1) * g * (2 - g)`. The porting promise is the look of the three.js scene, and three.js's PMREM sets that look. The table brings the lit spheres within three.js's image rule on both environments and every tier, which the material's own roughness misses on the room. The table lives in `crates/null3d-shaders/wgsl/lib/ibl.wgsl`.
- Diffuse light comes from the nine coefficients. Specular light comes from the cube map along the reflection, bent toward the normal by roughness to the fourth power, as three.js's `getIBLRadiance` bends it. Both go through three.js's `RE_IndirectSpecular_Physical`, and the occlusion map darkens the specular light by `computeSpecularOcclusion`.
- `scene.setEnvironment(env, { intensity, rotation })` sets the scene's environment from the next frame, with three.js's `environmentIntensity` and `environmentRotation` (Euler angles in the order X, Y, Z). A material's `envIntensity` multiplies the intensity. three.js uses `environmentIntensity` in place of a material's `envMapIntensity` under a scene environment. The engine multiplies them, so the material's value keeps its meaning.
- The environment is a value of each frame, not a permutation bit. The frame's group binds the environment's cube, or a blank one, at bindings 12 and 13. A frame builder reads the environment after the frame's texture uploads, so a held frame, which uploads everything, draws with it.
- Tolerances for lit scenes: three.js's image rule, as for every feature scene (`FEATURE_SCENES` in `bench/lib/parity.ts`). The CPU test of the room's file compares it with three.js's room blurred by 0.04 radians. Its own limits are 9 / 40 at the material's roughness and 4.5 / 25 at the table's. The panels' edges set them.

## Consequences

- `bunx @null3d/cli assets env <in.hdr|in.exr> <out.ktx2>` writes the file, and `--builtin room` writes the built-in room. A unit test of the tool checks that the room's nine coefficients are those that the engine keeps (`packages/engine/src/scene/builtin-environments.ts`).
- OpenEXR files read through the `exr` crate (BSD-3-Clause), which reads every compression but DWAA and DWAB. The tool's module grew from 16 KB to 115 KB after Brotli, most of it the reader.
- `assets.loadEnvironment(url)` reads the tool's files. Its reader loads on first use, under 1 KB after Brotli. `assets.builtinEnvironment('room')` makes the room on the GPU. Its code and shaders load on first use, about 6.6 KB after Brotli in all.
- The image tests `environment-room`, `environment-venice` and `environment-venice-rotated` draw the grid on all three tiers, and the parity scenes of the same names compare it with three.js. The dev server builds the Venice map from the sample content's HDR file with the tool, on the first request (`tools/lib/sample-environments.ts`).
- On WebGL2 the cube map takes one texture unit of the fragment stage. The standard material with all six maps reads 13 of the 16 that every device allows.
- Open: the lookup's GPU cost on the iPad, and the frame time at a GPU-bound size on the S24+. The device runner's `environment` plan measures both (`tests/pages/environment-cost.html`). Its scene draws 8 planes of the standard material over the whole window, without and with the room in turns. The difference over the layers is the lookup's cost. A functional run in Chrome on the Mac (Apple M5 Max) drew 1280 x 800 pixels. It gave 0.46 ms of GPU time without the room and 0.52 ms with it.
- Open: after the browser replaces the GPU, an environment whose texels the store freed draws as none until the sketch loads it again. Every texture from data does the same, as M2-R6 notes for #76.
- Open for M2-E3: a blurred background reads the same levels. A sharp background may want `--size 512` or larger.
- Open: KTX2 supercompression. A map of 256 is 2.0 MB. The room's was 393 KB with Brotli and 562 KB with gzip, so a host that compresses `.ktx2` files saves most of a map's bytes. Zstandard in the file would need a decoder in the engine.
- Open: three.js r187 shares the tool's GGX lobe, its 256 cube with 6 levels and its roughness of each level. It filters another way, though. Its levels 1 and 2 take 256 samples of the visible normals with a bias of half a level. Its levels 3 to 5 weigh every texel of a 16 x 16 copy of the source. Its blur takes two passes of a 20-tap golden-angle spiral. Whether parity moves to r187 is the owner's choice. Then the tool and the generator change together. The generator's counts, biases and blur live in `packages/engine/src/gpu/environment-steps.ts` and `crates/null3d-shaders/wgsl/environment.wgsl`.
