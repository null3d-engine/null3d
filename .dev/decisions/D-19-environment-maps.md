# D-19: Environment maps: format, size, levels and where they are prefiltered

Status: decided, 2026-10-04: the file and the tool with M2-B2, then the lookup, the built-in environment's name and the lit scenes' parity with M2-E2. The same day, the owner moved the built-in room out of the engine's package: the GPU makes it at first use. That is now the rule for every built-in asset. D-53 then decided the lookup: each material reads its own roughness. A later task makes that change, so the table of three.js's roughness below stays until then. On 2026-10-05 the owner ruled that the GPU makes the room whole at load, in one submit (D-66), and M2-E9 built it. The same day M2-E4 added HDR files at load, on the room's generator. The lookup's cost and the HDR load time on the iPad and the S24+ are pending. Date: 2026-10-04. Tasks: M2-B2, M2-E2, M2-E9, M2-E4.

## Question

Image-based light needs the environment's light filtered for each roughness of the engine's materials, and its diffuse light. Which texture format, face size and levels hold the filtered light? Where does the filtering run: in the asset tool before release, or in the browser at load? And how far may the result lie from three.js's `PMREMGenerator` for the same file?

Then, for the shader (M2-E2): which level does a material of a given roughness read? What is the built-in environment called? And how does the lookup reach the lit template: as a build of its own, or as a value of each frame?

Last: how does the built-in room reach a page? As a file in the engine's package, or made on the GPU when a sketch first asks for it?

## Rule

- The format filters on both GPU paths and in WebGPU's compatibility mode, with no optional feature.
- Parity with three.js's PMREM within a tolerance that this record sets from measured data.
- At most 4 MiB of GPU memory for an environment at the default size.
- The tool's output has the same bytes on every machine, as [D-18](D-18-asset-tool.md) requires.

Note, 2026-10-04: the owner's decision of that day ([D-52](D-52-intent-parity.md)) changes two points of this record. First, a material's roughness means one GGX distribution. three.js's PMREM blurs less than that distribution, as a trait of its technique. So keeping a three.js port's look is no longer a reason to read the matching roughness of the table. Second, built-in assets are made at run time and never ship as files in the engine's package. That rule replaces the room's file in the consequences below.

## The options

| Choice | Options | Taken |
| --- | --- | --- |
| Where the filtering runs | In the tool, once, before release; or in the browser on every visit, as three.js does | The tool, as the fast path. HDR files also load as they are, and the GPU filters them at load with the tool's steps (M2-E4) |
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
- No environment texel reaches the scene color above its HDR limit, 65,472 (`limit_hdr` in the shader library). The tool stores at most 65,408 in `rgb9e5ufloat` and 65,504 in `rgba16float`, never infinity. The room's generator stores at most 65,408. A file from another tool can hold infinite texels. Every shader that reads the cube still writes the scene color through `finish`, which applies the limit, so the color stays finite.

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

The first room was a file in the engine's package: `packages/engine/environments/room.ktx2`, 2.0 MB, 393 KB with Brotli. The engine found it with `new URL('../../environments/room.ktx2', import.meta.url)`. A bundler copies every such file into every game's build, so each game shipped 2 MB that most never load. An offline web app would download it ahead too. The owner decided on 4 October 2026 that built-in assets are made at run time, never shipped as files in the engine's package ([D-52](D-52-intent-parity.md#built-in-assets)).

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

The GPU makes the whole room in one submit, at load (D-66, M2-E9). `assets.builtinEnvironment` resolves once the generator's code has loaded and its pipelines are built. The core then records one command for the whole map in the next frame, outside the upload budget and before the frame's passes. So the first frame that uses the room already has its light, and no frame draws the scene without it. That frame takes longer by the map's GPU time. A room asked for during play costs one long frame.

The generator builds its pipelines in the background, after its code loads and before it counts as arrived. So no frame waits for a compile. A new GPU device builds them at its first map.

The whole map in one go, from the call until the GPU had finished it, in Chrome. The Mac's figures come from `tests/image/environment-generator.spec.ts` with `NULL3D_ENV_RUNS=4`, three rounds, on 5 October 2026. The Mac's load average was 23 to 37. The phones' come from prototype L1's second cloud run, `load=1`, on a first page with no shader cache. It has the same steps and shaders, and draws one texel with each pipeline first. On the phones, WebGPU's figure is the GPU's own time.

| Device, path | Pipelines, in the background | The first map, at load | Later maps |
| --- | --- | --- | --- |
| Mac (Apple M5 Max), WebGPU | 7.7 to 14.1 ms, once 300 ms | 19.6 to 21.1 ms | 8.7 to 9.4 ms |
| Mac, compatibility mode | 7.5 to 11.9 ms | 19.6 to 20.1 ms | 8.6 to 9.1 ms |
| Mac, WebGL2 | 9.4 to 15.3 ms | 19.8 to 26.6 ms (16.2 to 17.3 ms by timer queries) | 7.9 to 12.9 ms |
| Galaxy S25, Pixel 9, 10 and 11, WebGPU | 92.7 to 128.7 ms | 47.8 to 99.7 ms | 16.6 to 95.0 ms |
| The same phones, WebGL2 | 100.3 to 225.5 ms | 57.7 to 107.3 ms | 42.8 to 111.6 ms |

The thread that draws spends under 1 ms of its own time in the call on the Mac; the rest is the GPU's. Since 6 October 2026, the WebGL2 generator waits for the GPU after each step's pack. Firefox fills the pack buffer late ([implementation notes](../implementation-notes.md#browser-faults)). The thread that draws then waits in the call for most of the map. In Firefox on the Mac it waited 15.4 ms of the 20.8 ms map. The table's WebGL2 times above were taken before that wait. The engine makes no such one-texel draws. On the Mac its first map on WebGL2 showed no wait for the driver, since the pipelines build in the background first. SwiftShader on the Mac took 0.8 to 0.9 s for the whole room.

Before M2-E9, M2-E2 made the room in 32 slices, one a frame. The Mac timed each slice from its call until the GPU had finished it:

| Path | The whole room, slices back to back | A slice, median / most | Pipelines, in the background |
| --- | --- | --- | --- |
| WebGPU | 17.4 ms, the first one 29 to 38 ms | 0.8 / 2.5 ms | 9 ms, or 285 to 305 ms when the GPU's shader cache does not hold them |
| Compatibility mode | 17.4 ms | 0.8 / 2.5 ms | 8 to 10 ms |
| WebGL2 | 16.6 ms (19.0 ms by timer queries) | 1.2 / 3.0 ms (0.25 / 1.8 ms by timer queries) | 15 to 19 ms, or 127 to 135 ms when the GPU's shader cache does not hold them |

The Mac was busy with other work at the time, with a load average of 37 to 80. A copy of the shader with one constant changed showed the cost of an empty shader cache. SwiftShader on the same Mac took 1.0 to 1.5 s for the room at that load.

The trace once worked out the sine and cosine of each box's turn four times for each box and ray. It also shaded every nearer surface that a ray met. On SwiftShader it was then the costliest step: 570 ms of 1.5 s by WebGL2's timer queries. Each ray now finds its nearest surface first and shades only that one, and the turns are constants. The trace fell to 75 ms on SwiftShader, and from 9 to 5 ms on the Mac's GPU. The whole room fell from 21.2 to 17.4 ms on WebGPU and in compatibility mode. On WebGL2 it fell from 19.8 to 16.6 ms, or from 24.4 to 19.0 ms by timer queries. The map did not change: level 0 lies 0.002 / 0.09 steps from the tool's, as before.

The image tests hold their frame, so each of their runs makes the whole room in one frame. CI's runners share a few cores among the tests that run side by side. Before the change, a run of the room there took more than 30 s on WebGPU and in compatibility mode. On WebGL2 it took about 27 s. The Mac's SwiftShader ran the room's image test on three tiers side by side. Each tier took 45 to 52 s for its five thread modes before the change, and 23 to 25 s after it. Each run of the room's image test may take 60 s, not the usual 30. The rest of the time is the software GPU's alone: the Mac's GPU makes the room in 17 ms.

Cheaper work was measured against a map made with 8 x 8 rays per texel, a finer blur and 4,096 directions at level 1. The engine's map lay 0.32 / 2.5 steps from it at its worst roughness, and the options below lay further:

| Option | Worst mean / p99 | Where |
| --- | --- | --- |
| 2 x 2 rays per texel, a quarter of the trace | 0.34 / 2.7 | Everywhere, slightly |
| 256 directions at level 1, half its reads | 0.49 / 4.6 | Roughness 0.1 |
| 128 directions at level 1 | 0.74 / 6.9 | Roughness 0.1 |
| Blur taps a sigma apart, a third of the reads | 0.55 / 11.6 | Roughness 0 |
| Faces of 128, 5 levels | 1.65 / 11.2 against the engine's map | Roughness 0.1 to 0.6 |

None was taken. Fewer rays was nearly free, but the trace no longer costs much. The blur and the filter spend most of their time on texture reads on SwiftShader. With their sums and sines moved out of the loops, they took as long as before.

The work is about 66 million texel reads for the blur and 100 million for the filter, and the trace's rays. Before the faces drew side by side, each face of each level drew alone. The room then took 31.5 ms on WebGPU, and its slices up to 9.3 ms. The filter's smallest levels read up to 8,192 directions per texel over 64 texels a face. A draw of one face kept few of the GPU's lanes busy and waited on each texel's long loop. The first room also compiled its pipelines in its first slice. With an empty shader cache that took 382 ms on WebGPU and 195 to 394 ms on WebGL2.

The code and the shaders load on first use:

| File | After Brotli | Budget |
| --- | --- | --- |
| The generators of both paths, in the thread that draws | 2.1 KB | 16 KB |
| The room's numbers, in the thread that runs the sketch | 0.2 KB | 16 KB |
| The shaders, WGSL or GLSL, in the thread that draws | 4.2 KB or 4.4 KB | 32 KB |

The engine's JavaScript at a page's start grew by 1.0 KB, to 107.1 KB in pipelined mode. The backends' new command, the image table's generators and the texture call make it.

How the parts fit:

- The sketch thread makes a cube texture and asks the core for a generator. The generator takes the next image id, and its name, `room`, goes to the thread that draws as an image does. That thread loads the generators' code and the shaders of its GPU path, and builds the pipelines. Then it counts the generator among the images it received. `builtinEnvironment` waits for that count before it resolves, and the core waits for it as it waits for an image. Then the core records one command, `GenerateTexture`, which makes the whole map at once, before the frame's passes. Held frames wait for every image to arrive, so they wait for the generator too.
- The core keeps the generator after it ran. A new GPU device makes the room again from it, with no work from the sketch.
- The generator makes its own textures and buffers for each map and frees them once the map's work has run. A capture that replays the list makes the map again. The WebGPU generator submits the map's commands in one command buffer of their own. The WebGL2 generator changes the context's bindings, so the backend's state cache forgets them afterwards.
- WebGL2 writes the packed bytes through a spare RGBA8 texture and a pixel buffer on every device. That path needs no float render target, so it needs no fallback. Half floats through a spare texture also matched the tool's file on the cloud phones (prototype L1). They stay the fallback for a device whose pixel buffer copy fails or is slow; none has shown that, so the engine has no such path. The 11-11-10 format and drawing straight into the cube failed there, and the engine never had them.
- The shader build writes a shader marked `first_use` into a module of its own for each target, `generated/shaders-environment-wgsl.ts` and `-glsl.ts`. The main shader module stays as it was. The size report gives such files a budget of 24 KB each after Brotli, by the owner's decision of 4 October 2026.

The options rejected:

- Templates and bind groups of the draw list, with the core recording each draw. A draw of a template whose pipeline still builds draws nothing, and a map made once cannot skip a draw. The shader text would also have to reach the backends by another way, since it loads on first use.
- Float render targets for every step. WebGL2 renders into `rgba16float` only with an extension that some devices lack, and the map would still need packing for `rgb9e5ufloat`.
- The nine coefficients of diffuse light on the GPU. The room never changes, so its coefficients never change. Reading them back would need a path from the thread that draws to the sketch's thread in every thread mode. In hold mode that thread draws only when a capture asks, so the sketch would wait for a frame that never comes. The engine keeps the tool's 27 numbers instead, nine for a gray room, in the file that loads on first use. They are derived data, not a shipped file, so they fit the owner's rule (agreed on 4 October 2026). A test of the tool checks that they are its own.

### HDR files at load

`assets.loadEnvironment` also takes Radiance (`.hdr`) and OpenEXR (`.exr`) files. three.js ports load them with `HDRLoader` or `EXRLoader` and `PMREMGenerator`. The owner moved this to P0 on 4 October 2026 (decision 8 of D-53), on the room's generator. On 5 October the owner ruled that HDR maps are made whole at load, in one submit. The room is made the same way (option A of prototype L1, D-66). The earlier plan of steps sized by the kind of draw no longer applies.

How a file becomes a map:

1. The sketch's thread downloads the file. The environment reader tells the file's kind by its first bytes: KTX2, Radiance (`#?`) or OpenEXR.
2. A worker of its own, `null3d-panorama`, reads the file off the sketch's frames. It decodes each row into 32-bit floats of red, green and blue.
3. The worker projects each row onto the nine coefficients of diffuse light. It averages squares of texels while the image is wider than 2,048 texels, eight for each texel across a face of 256. Then it packs the panorama as shared-exponent texels.
4. The panorama's texels move to the thread that draws, as an image does. The generator maps them onto the cube with a new step, `panorama`. Then it runs the room's chain and filter steps. All of it is one submit, before the first frame that uses the map.

The `panorama` step averages 2 to 8 directions a side over each cube texel, by the tool's rule (`samples_per_texel`). It reads the panorama with the GPU's linear filter, as the tool's sampler does. The filter repeats across the width and clamps at the top and bottom rows. The map has faces of 256 and 6 levels, the tool's default. `loadEnvironment` takes no size option yet.

#### Light past the format's limit

A file can hold a sun far brighter than 65,408, the largest shared-exponent value. The tool filters in 32-bit floats and clamps only the stored texels. The analysis asked to limit bright texels on upload, as Filament compresses HDR before it sums samples. A plain limit loses the sun's share of the rough levels and of the diffuse light. Kloofendal's sky peaks at 73,216; a sky with an unclipped sun can peak near a million.

The options:

| Option | Rough levels and diffuse light | Cost |
| --- | --- | --- |
| Limit each texel at 65,408 on upload | Lose the light above the limit | None |
| Compress the range before the sums and expand it after, as Filament's `IBLPrefilterContext` does | Lose some light: the expansion of an average is not the average of the expansions | A few operations per sample |
| Divide the panorama by a power of two that brings its peak within the limit, and multiply it back where the map is stored | Keep all of it, as the tool's 32-bit filter does | One multiply per stored texel |

The engine takes the power of two, the gain. The panorama and the chain hold the light divided by it. A power of two lowers only each texel's shared exponent, so its 9 bits stay. Only light below a few millionths of the peak grows coarse. The `panorama` step that fills level 0 of the map, and the `prefilter` step, multiply the gain back. Their texels then stop at 65,408, as the tool's do. With a gain above 1, level 0 takes a second `panorama` draw, since the chain and the map hold different light. The diffuse light comes from the worker's 32-bit sums, so it keeps all the light too. Nothing reaches an `rgba16float` target above 65,504, which R7-01 asked for.

#### The readers

The Radiance reader follows the tool's: flat rows, or Radiance's run-length rows, from the top row down. The OpenEXR reader ports three.js's `EXRLoader` decoders (MIT, after TinyEXR and OpenEXR, BSD-3-Clause; `THIRD-PARTY-NOTICES.txt` holds their notices). It reads single-part scanline files with R, G and B channels of any pixel type. It reads every compression but DWAA and DWAB, as the tool does: none, RLE, ZIPS, ZIP, PIZ, PXR24, B44 and B44A. ZIP data inflates through the browser's `DecompressionStream`, so the engine ships no inflate code. Up to 8 chunks inflate at once. Tiled, deep and multi-part files fail with E1412, which says how to save the file. The tool reads tiled files through the `exr` crate; the engine does not, since HDR panoramas are saved with scanlines.

Options rejected for the readers:

- The tool's own readers, built to WebAssembly for the engine. The same bytes would come out on every machine. But the `exr` crate is most of the tool's 115 KB after Brotli, against 5.8 KB for the TypeScript readers.
- Reading on the sketch's thread. A 2K file takes about 100 ms on the Mac, and several times that on a phone. That would hold the sketch's frames, and in the modes without a sketch worker, the page.
- Reading on the thread that draws. That thread must keep drawing frames.

#### Memory

The panorama on the GPU is at most 2,048 texels wide, 8 MB as shared-exponent texels. The thread that draws keeps the panorama's texels in its image table, as it keeps a room generator. So a new GPU device makes the map again. `environment.destroy()` releases them with the texture. A larger image becomes the averages of squares of texels in the worker, before the panorama exists. The worker's sums take 12 bytes a texel of the panorama, up to 25 MB for a short time.

#### Results

The test `tests/image/environment-generator.spec.ts` makes each file's map with the engine's readers and generator on every GPU path. It compares each level with the tool's map of the same file, tone mapped as above. The figures are steps of 1/255 as mean / p99, and the total light over the tool's. Chrome on the Mac's GPU, 5 October 2026:

| File | Level 0 | Level 1 | Level 5 | Total light, levels 0 to 5 | Diffuse light, largest difference |
| --- | --- | --- | --- | --- | --- |
| Venice Sunset, 2K `.hdr` | 0.003 / 0.10 | 0.024 / 0.38 | 0.094 / 0.32 | 1.0000 to 1.0018 | 0.18% of the first coefficient |
| Kloofendal, 2K `.hdr`, gain 2 | 0.002 / 0.11 | 0.018 / 0.24 | 0.074 / 0.26 | 0.9999 to 1.0016 | 0.07% |
| Studio, 1K `.exr`, PIZ floats | 0.004 / 0.16 | 0.023 / 0.23 | 0.082 / 0.23 | 1.0001 to 1.0015 | 0.01% |

The three paths gave the same figures. Each level stays within the room's tolerance of 0.25 / 1 step and 0.5% of total light, which the test now asks of HDR files too. Kloofendal's peak passes the format's limit, and its map matches the tool's as closely as the others. A plain limit would drop the light above 65,408 from its rough levels.

The sunset from its Radiance file draws the sphere grid as its tool map does. Its image test, `environment-venice-hdr`, borrows the references of `environment-venice`. On all three tiers they lie at most 2 steps of 255 apart per pixel, with no pixel past the image rule. Against three.js's `HDRLoader` and `PMREMGenerator`, 0.000% of pixels differ on WebGPU and WebGL2, and 0.044% in compatibility mode. The studio's OpenEXR file passes three.js's image rule against `EXRLoader` on WebGPU (0.086%) and WebGL2 (0.093%). In compatibility mode 0.498% differ, past three.js's own 0.350% between its renderers. The differences lie on the spheres' bright edges, where that mode's 8-bit MSAA path differs, as above. The studio's map matches the tool's on every path, so the parity list keeps only the sunset.

The times come from Chrome on the Mac (Apple M5 Max), at a load of 15 to 26. The readers took 94 to 125 ms per file on the page's main thread. The worker runs the same code. The map took 19 to 21 ms from the call until the GPU had finished, as the room's does. On WebGL2 it took 16 to 17 ms by timer queries. The `panorama` step replaces the trace and the blur, and the filter costs most.

On cloud devices, the device runner's `environment-load` plan asked for each environment during play (runs `20261005-134447-environment-load` and `20261005-134805-environment-load`, BrowserStack Automate). Every item passed: iPad 6 of 6, Pixel 10 6 of 6, and Galaxy S24 3 of 3, which has no WebGPU. In every frame that used an environment, the sphere showed its light. The figures are milliseconds from the request until the first captured frame that used the environment. The figure in brackets is the time until the environment resolved. The HDR files came through the cloud's tunnel from the Mac, so their times include a download of 5.7 MB (`.hdr`) or 1.3 MB (`.exr`).

| Device, path | Room | Venice Sunset, 2K `.hdr` | Studio, 1K `.exr` |
| --- | --- | --- | --- |
| iPad Pro 13, Safari 26.6.1, WebGPU | 1,204 (1,071) | 2,291 (2,213) | 1,613 (1,570) |
| iPad Pro 13, WebGL2 | 912 (784) | 1,544 (1,467) | 1,554 (1,490) |
| Pixel 10, Chrome 149, WebGPU | 965 (815) | 2,621 (2,448) | 2,390 (2,259) |
| Pixel 10, WebGL2 | 974 (840) | 2,681 (2,554) | 2,128 (2,003) |
| Galaxy S24 (Xclipse 940), Chrome 149, WebGL2 | 1,120 (1,006) | 3,191 (3,066) | 2,278 (2,186) |

Two parts make each figure:

- Until the environment resolves, the frames go on as before; the captures in that time drew the sphere unlit, 145 to 4,583 of them. This part holds the download, the reading, the generator's code and the background build of its shaders.
- From then until the first lit frame, the next frame makes the map, draws, and comes back to the page. It took 114 to 150 ms for the room, and 43 to 173 ms for the HDR files. The one long frame lies in this part.

Why the iPad's `.hdr` took 2,291 ms on WebGPU and 1,544 ms on WebGL2: the gap lies before the environment resolved. That part took 2,213 against 1,467 ms, and the part after it 77 ms on both paths. The room shows that the setup before it resolves costs about 290 ms more on WebGPU on this iPad (1,071 against 784 ms). That setup is the generator's code and the build of its shaders. That leaves about 460 ms. The `.exr` file differs by only 80 ms between the paths, and the readers run the same code on both. So the rest most likely came from the 5.7 MB download through the tunnel, which varies from load to load. Each item ran once, and the page does not time the download apart, so the record cannot prove it.

The task's done-when line asks only that an HDR file lights a scene on all three tiers, and sets no time. Its note took prototype L1's rule: under 200 ms in all on the slowest cloud phone. Option A (D-66) then made the map in one submit, and the rule's 200 ms is the map's own cost. Here, the part after the environment resolved holds the map, its frame and the capture. It stayed under 200 ms on every device and path: at most 150 ms for the room and 173 ms for a file. The first second or more is the download and the background setup, during which frames keep their pace. So the room's 1 s on phones passes the rule.

In those runs, the generator's code and shaders started to load only when the first generator reached the thread that draws. For an HDR file, that was after the download and the reading, so the two waits added up. Now `loadEnvironment` asks for them at the call, when the address ends in `.hdr` or `.exr`. It asks once the file's first bytes show an HDR file otherwise. It starts the reader's worker then too. The sketch sends a reserved name among the shader features to preload. The thread that draws then loads the code and builds the pipelines, before any generator arrives.

The same plan measured the change on the same devices, the old commit against the new one in turns: old, new, old, new. The runs are `20261005-145731` to `20261005-151647`, each ending in `-environment-load`. Every run passed. In each pair, one run was slowed by a stall of 10 to 14 s in the cloud's tunnel. So the table takes the faster run of each pair. A stall only adds time. Milliseconds to the first lit frame, before and after:

| Device, path | `.hdr` | `.exr` | Room |
| --- | --- | --- | --- |
| iPad Pro 13, WebGPU | 2,160 to 989 (-1,171) | 1,615 to 887 (-728) | 1,203 to 720 |
| iPad Pro 13, WebGL2 | 1,592 to 842 (-750) | 1,537 to 846 (-691) | 962 to 751 |
| Pixel 10, WebGPU | 2,633 to 2,176 (-457) | 1,920 to 1,666 (-254) | 1,080 to 1,093 |
| Pixel 10, WebGL2 | 2,428 to 1,326 (-1,102) | 2,138 to 1,687 (-451) | 1,090 to 1,016 |
| Galaxy S24, WebGL2 | 2,884 to 2,455 (-429) | 2,379 to 1,812 (-567) | 926 to 1,233 |

The HDR files' times fell by 0.25 to 1.2 s on every device and path. The room's path did not change, and its figures moved both ways. The S24's old runs ranged from 926 to 1,061 ms and its new runs from 1,233 to 1,259 ms. Four more pairs of the S24's room page alone settled it (runs `20261005-153346` to `20261005-153913`). The first lit frame's median was 1,140 ms before and 1,095 ms after. The pairs differed by -328 to +163 ms, so the change makes no difference that the runs can show.

On the Mac (Apple M5 Max, Chrome on its GPU), the room light test ran 3 times with each commit. The load was 3.4 to 4.0. All 27 tests passed in each round. The table gives median milliseconds to the environment resolving, then to the first lit frame, before and after:

| File, path | Before | After |
| --- | --- | --- |
| `.hdr`, WebGPU | 112 / 161 | 104 / 162 |
| `.hdr`, compatibility mode | 111 / 161 | 103 / 161 |
| `.hdr`, WebGL2 | 120 / 177 | 103 / 161 |
| `.exr`, WebGPU | 97 / 142 | 88 / 143 |
| `.exr`, compatibility mode | 95 / 139 | 86 / 141 |
| `.exr`, WebGL2 | 103 / 160 | 87 / 141 |

The files resolved 8 to 17 ms sooner. The first lit frame came up to 19 ms sooner on WebGL2 and at the same time on WebGPU. The room took 10 to 17 ms to resolve and 53 to 61 ms to light, in both rounds. The Mac downloads the file from its own server in a few milliseconds and builds the shaders fast, so there is little to overlap. The saving shows on phones, where the download and the shader builds take far longer.

The code that loads on first use, after Brotli: the reader's worker 5.8 KB, and its loader 0.6 KB in the sketch's thread. The generators' file grew from 2.1 to 2.7 KB. The environment shaders grew from 4.2 to 4.7 KB in WGSL, and from 4.4 to 4.8 KB in GLSL.

A KTX2 map from the tool is not always the smaller download. After Brotli, Venice Sunset's 2K Radiance file takes 3.8 MB and its map 1.4 MB. The studio's 1K OpenEXR file takes 1.23 MB, and its map 1.36 MB.

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
- `assets.loadEnvironment` reads Radiance and OpenEXR files as well as the tool's files. A worker reads them; the GPU filters them at load with the tool's steps, in one submit before the first frame that uses the map. A power-of-two gain keeps light past 65,408 in the rough levels and the diffuse light. Each level lies within 0.25 / 1 step of the tool's map, and its total light within 0.5% (`tests/image/environment-generator.spec.ts`).
- The engine makes the built-in room on the GPU when a sketch first asks for it, with the tool's steps, on every tier. It makes the whole map in one submit, before the first frame that uses it (D-66); `tests/image/room-light.spec.ts` checks that no frame with the room lacks its light. Its package ships no file for it. Its map lies within 0.25 / 1 step of the tool's at every level, and its total light within 0.5% (`tests/image/environment-generator.spec.ts`). The tool's `--builtin room` stays: it is the reference of that test and of the parity test.
- Built-in assets are made at run time, never shipped as files in the engine's package: the owner's rule of 4 October 2026, which [D-52](D-52-intent-parity.md#built-in-assets) records. A built-in asset's code and shaders load on first use, within the budgets for such files.
- The built-in environment is named `room`, after three.js's `RoomEnvironment`, which porters know. A sketch calls `assets.builtinEnvironment('room')` for it. The tool, the docs, the skills and the mapping all use that name. The studio preset of drei is an HDR file of its own, which ports through the tool.
- The lit template reads each material's roughness from the level of the table's GGX roughness, `THREE_PMREM_ROUGHNESS`, blended between its steps of 0.05: `lod = (n - 1) * g * (2 - g)`. The table brings the lit spheres within three.js's image rule on both environments and every tier, which the material's own roughness misses on the room. Under [D-52](D-52-intent-parity.md) that match is no reason on its own. A material's roughness means one GGX distribution, and its own roughness reads exactly that. The table stays until a later task makes the lookup that D-53 decided: each material's own roughness. It lives in `crates/null3d-shaders/wgsl/lib/ibl.wgsl`, so a switch changes one function.
- Diffuse light comes from the nine coefficients. Specular light comes from the cube map along the reflection, bent toward the normal by roughness to the fourth power, as three.js's `getIBLRadiance` bends it. Both go through three.js's `RE_IndirectSpecular_Physical`, and the occlusion map darkens the specular light by `computeSpecularOcclusion`.
- `scene.setEnvironment(env, { intensity, rotation })` sets the scene's environment from the next frame, with three.js's `environmentIntensity` and `environmentRotation` (Euler angles in the order X, Y, Z). A material's `envIntensity` multiplies the intensity. three.js uses `environmentIntensity` in place of a material's `envMapIntensity` under a scene environment. The engine multiplies them, so the material's value keeps its meaning.
- The environment is a value of each frame, not a permutation bit. The frame's group binds the environment's cube, or a blank one, at bindings 12 and 13. A frame builder reads the environment after the frame's texture uploads, so a held frame, which uploads everything, draws with it.
- Tolerances for lit scenes: three.js's image rule, as for every feature scene (`FEATURE_SCENES` in `bench/lib/parity.ts`). The CPU test of the room's file compares it with three.js's room blurred by 0.04 radians. Its own limits are 9 / 40 at the material's roughness and 4.5 / 25 at the table's. The panels' edges set them.

## Consequences

- `bunx @null3d/cli assets env <in.hdr|in.exr> <out.ktx2>` writes the file, and `--builtin room` writes the built-in room. A unit test of the tool checks that the room's nine coefficients are those that the engine keeps (`packages/engine/src/scene/builtin-environments.ts`).
- OpenEXR files read through the `exr` crate (BSD-3-Clause), which reads every compression but DWAA and DWAB. The tool's module grew from 16 KB to 115 KB after Brotli, most of it the reader.
- `assets.loadEnvironment(url)` reads the tool's files. Its reader loads on first use, under 1 KB after Brotli. An HDR file loads its reader and worker, 6.4 KB after Brotli, and the generator. `assets.builtinEnvironment('room')` makes the room on the GPU. Its code and shaders load on first use, about 6.6 KB after Brotli in all.
- The image tests `environment-room`, `environment-venice` and `environment-venice-rotated` draw the grid on all three tiers, and the parity scenes of the same names compare it with three.js. The dev server builds the Venice map from the sample content's HDR file with the tool, on the first request (`tools/lib/sample-environments.ts`).
- On WebGL2 the cube map takes one texture unit of the fragment stage. The standard material with all six maps read 13 of the 16 that every device allows. With the eight maps of [D-63](D-63-specular-and-ior.md), an alpha mask and shadows, it reads all 16.
- Open: the lookup's GPU cost on the iPad, and the frame time at a GPU-bound size on the S24+. The device runner's `environment` plan measures both (`tests/pages/environment-cost.html`). Its scene draws 8 planes of the standard material over the whole window, without and with the room in turns. The difference over the layers is the lookup's cost. A functional run in Chrome on the Mac (Apple M5 Max) drew 1280 x 800 pixels. It gave 0.46 ms of GPU time without the room and 0.52 ms with it.
- Open: after the browser replaces the GPU, an environment whose texels the store freed draws as none until the sketch loads it again. Every texture from data does the same, as M2-R6 notes for #76.
- Open for M2-E3: a blurred background reads the same levels. A sharp background may want `--size 512` or larger.
- Open: the HDR load time on the owner's iPad and S24+. The cloud's iPad Pro 13, Pixel 10 and Galaxy S24 ran the `environment-load` plan on 5 October 2026, as above.
- Open: a size option for HDR files at load, such as `--size 512` for sharp backgrounds.
- Open: KTX2 supercompression. A map of 256 is 2.0 MB. The room's was 393 KB with Brotli and 562 KB with gzip, so a host that compresses `.ktx2` files saves most of a map's bytes. Zstandard in the file would need a decoder in the engine.
- The tool and the GPU's generator keep their filter, and do not copy three.js r187's. Release r187 shares the tool's GGX lobe, its 256 cube with 6 levels and its roughness of each level. It differs in three ways. Its levels 1 and 2 take 256 samples of the visible normals, with a bias of half a level. The tool takes 512 and then 1,024 there, with a bias of one level. Its levels 3 to 5 weigh every texel of a 16 x 16 copy of the source. The tool samples 2,048 to 8,192 directions of the full chain there. Its blur takes two passes of a 20-tap golden-angle spiral. The tool's takes one pass of a 13 x 13 grid. Under [D-52](D-52-intent-parity.md) a look need not match three.js's pixels. The tool's method takes more samples than r187's at every level, so its map is at least as good. The generator's counts, biases and blur match the tool's. They are in `packages/engine/src/gpu/environment-steps.ts` and `crates/null3d-shaders/wgsl/environment.wgsl`.
