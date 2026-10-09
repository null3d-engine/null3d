# D-118: Environment light from the generated sky, and time of day

Status: decided, 2026-10-09. Date: 2026-10-09. Task: M2-EX14.

Summary: `assets.skyEnvironment()` makes an environment of the sky that `scene.setBackground({ sky })` draws, and the map follows the sky with no further call. The engine core refreshes it in 7 stages, one a frame, so no frame waits for the whole map. Frames draw with the old map until the last stage copies every new level in at once. The diffuse light changes in the same frame. On the Mac each stage costs under 1.1 ms, and the new light shows 6 frames after the move's frame. `timeOfDay(hours or preset)` works out the sun, the sky, the main light, the fog, an ambient light and the exposure from one value. It returns values, which the sketch applies to its own objects.

## Question

The showcase scenes need light that follows the time of day ([D-117](D-117-showcase-features-before-1-0.md)). The generated sky lit nothing: only the room and files made environments. How does the sky light the scene, matching its background? How does that light follow a moving sun without a long frame? And what helper sets a whole time of day from one value?

## Rule

- The environment shows the background's sky: the same sun, turbidity, Rayleigh, Mie and clouds.
- A sun move refreshes the light, and no frame waits for the whole map.
- No allocation per frame while the sun moves ([AGENTS.md](../../AGENTS.md#hard-rules), hard rule 1).
- The code that a page downloads at its start does not grow. The pipelined start was at 137.5 KB of 140 KB after Brotli.
- Each level of the map lies within half a step of 255, on average, of the same sky filtered as finely as a file's map.

## Options

### The call

| Option | What a sketch writes | Verdict |
| --- | --- | --- |
| A: `assets.skyEnvironment()`, a map of the scene's sky | `scene.setEnvironment(await assets.skyEnvironment())`, then only `setBackground({ sky })` as the sun moves | Chosen |
| B: an option of the sky background, such as `setBackground({ sky }, { light: true })` | One call | Rejected. The map needs its code and shaders first, so the light would come some frames late, with no promise to wait on. The environment's options and a blurred sky background would need a second way |
| C: `assets.skyEnvironment(settings)` and `environment.update(settings)` | Each change twice: once for the background, once for the map | Rejected. Two copies of the sky's settings can drift apart |

Option A works as `builtinEnvironment` works. The call resolves once the code and shaders are ready, and the next frame has the whole map. The map is an `Environment`, so `setEnvironment`'s intensity and rotation work, and so does an environment background's blur.

three.js makes the same light with `pmremGenerator.fromScene(sceneWithSky)`. It makes it again with another call after each change, as its ocean example does. Here no call is needed. Before the scene's first sky background, the map shows the sky's defaults, the sun of three.js's sky example.

The map leaves out the sun's disc. The scene's directional light gives the sun's own light, and a disc in the map would light every surface twice. The disc is 0.018 degrees wide, and a texel of the map's sharpest level is about 0.35 degrees. So the disc would show in few texels, and flicker as the sun moves.

### How a refresh spreads over frames

[D-66](D-66-step-sizes.md) makes the room and HDR maps whole at load, in one go. On the cloud phones, steps there cost 368 to 651 ms in all, against 39 to 116 ms in one go. The filter's small levels took up to 8,192 directions per texel, and a split step cannot be shorter than one texel's loop.

A sky map refreshes during play, so it cannot take one long frame at each move of the sun. Three changes keep its steps few and short:

1. **Each level of the chain comes from the sky itself.** The room's chain halves each level from the one before, so each level waits for the one before. The sky's draw averages 1, then 2 x 2 directions of the sky over each texel of each level, so every level draws at once. Against a chain of 16 x 16 directions per texel, the map's levels moved by less than 0.05 steps of 255.
2. **Fewer filter directions.** The sky has no sun disc and no small bright light. So the filter takes 128 directions at level 1, and twice as many at each smaller level, up to 2,048. That is a quarter of a file's map.
3. **The core runs the stages.** The engine core records one draw-list command per stage (`SkyMapStep`, opcode 55, in `crates/null3d-gpu/src/drawlist.rs`):
   - Stage 0 draws the sky into every level of the chain in one render pass, and into the map's level 0.
   - Stages 1 to 5 each filter one level.
   - Stage 6 copies all six levels into the map.

Until stage 6, the new levels wait in a buffer that frames do not read. So no frame draws a half-made map. The first fill records all 7 stages in one frame, the frame after the generator's code arrives, as for the room. A refresh records one stage a frame. A change during a refresh waits until it ends. Then the next refresh starts with the sky as it is then.

The core records the stages, so it knows the frame in which the new levels arrive. It switches the diffuse light in that frame. So reflections and diffuse light change together.

A first refresh at a lower size, then a finer one, was not needed: every stage stays under about 1.1 ms on the Mac.

On WebGL2 a stage packs its texels into pixel pack buffers, as the room does. Firefox on the Mac fills such a buffer late ([implementation notes](../implementation-notes.md#browser-faults)), so the room's generator waits for the GPU after each pack. The sky map unpacks a buffer only in a later stage. That stage asks a fence whether the GPU has run the packs. It waits for the GPU only when the GPU has not, and after a frame it has. The first fill, whose stages share one frame, waits as the room does.

### The diffuse light

| Option | Verdict |
| --- | --- |
| The GPU sums the coefficients from a small level, and the engine reads them back | Rejected. A readback arrives frames later, through a path that each GPU path would need, for 27 numbers |
| The core works them out on the CPU from the same sky model | Chosen |

The core holds a port of the shaders' sky model (`sky_light.rs`), clouds included. It sums the sky over 6 x 8 x 8 squares of a cube, each weighed by its solid angle. It splits the squares within about 32 degrees of the sun into 4 x 4, because the haze's glow there is narrow and bright.

On 12 squares a side without that split, a sun on the horizon put the coefficients up to 6.4% of the first one off. With the split, they lie within 1.6% of the first coefficient on a grid of 192, for a high sun and for a sun on the horizon. The sum took about 0.1 ms on the Mac, once per refresh, in the core's frame code, with no allocation.

### The filter's directions

This test compares the sky map with the same sky filtered with 1,024 directions at level 1 and a chain of 16 x 16 directions. It runs on WebGPU, as [D-19](D-19-environment-maps.md) compares the room with the asset tool's map: each channel tone mapped, in steps of 1/255, mean and 99th percentile. The sky had clouds and its sun 11.5 degrees up, the narrowest glow of the test's skies.

| Filter | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 |
| --- | --- | --- | --- | --- | --- |
| 64 directions at every level | 0.29 / 2.62 | 1.18 / 6.19 | 1.74 / 6.81 | 2.55 / 9.50 | 6.34 / 18.68 |
| 64 at level 1, doubled at each level | 0.29 / 2.62 | 0.73 / 3.95 | 0.57 / 2.23 | 0.36 / 1.71 | 0.47 / 2.20 |
| 128 at level 1, doubled at each level (chosen) | 0.17 / 1.67 | 0.30 / 2.17 | 0.33 / 1.38 | 0.19 / 0.85 | 0.19 / 0.74 |
| 1,024 at level 1, with a chain of 2 x 2 or 4 x 4 | 0.01 / 0.19 | 0.01 / 0.23 | 0.02 / 0.26 | 0.02 / 0.29 | 0.05 / 0.35 |

The last row shows that the chain's directions barely matter, and the filter's do. The chosen filter keeps each level's total light within 0.4% of the finer map's. SwiftShader gave the same figures within 0.01.

## Data

All Mac figures come from Chrome on the owner's Mac (Apple M5 Max) on 9 October 2026, while other work ran (load 10 to 15). The sky map test page (`tests/pages/sky-map-cost.ts`) times 8 refreshes with a sun that moves. It times each stage from its call until the GPU has finished it, on a queue with no other work. WebGL2 also gives its timer queries' GPU times.

| Path | Stage 0: the sky | Stages 1 to 5: one level each | Stage 6: the copy | The whole map at once |
| --- | --- | --- | --- | --- |
| Mac, WebGPU | 0.49 ms | 0.42 to 0.65 ms | 0.30 ms | 10.0 ms |
| Mac, compatibility mode | 0.52 ms | 0.44 to 0.74 ms | 0.27 ms | 9.7 ms |
| Mac, WebGL2, from the call to the GPU's end | 0.84 ms | 0.65 to 1.42 ms | 0.55 ms | 10.3 ms |
| Mac, WebGL2, timer queries | 0.46 ms | 0.35 to 0.69 ms | 0.01 ms | |
| SwiftShader on the Mac, WebGL2 timer queries | 10.5 ms | 27.8, 13.6, 6.9, 3.3 and 1.9 ms | 0.14 ms | |

Before the chain drew in one render pass, stage 0 took 0.96 ms on WebGPU. On the software GPU, stage 1 costs most: its level has the most texels. On a slow phone, that stage is the one to watch.

**Time to the new light.** The sky refresh test (`tests/image/sky-refresh.spec.ts`) moves the sun and captures every frame after the move, with the drawing held to 20 frames a second. On all three tiers, the mirror sphere's reflection and the rough sphere's diffuse light kept the old light for the move's frame and the next 5. Both showed the new light from the 6th frame after the move. At 60 frames a second, that is 100 ms from the move. When a refresh is under way at the move, it takes up to 13 frames, 217 ms.

**A sky that changes in every frame** refreshes the map without end, one stage a frame: under 1.1 ms of GPU time per frame on the Mac. A sketch that moves the sun in steps pays only after each step. So does a still scene that animates only the clouds' `time`.

**Memory.** Beside its 2 MB map, a sky map keeps its chain of 9 levels (2.1 MB) and the texture that the stages draw into (1,536 x 511 texels, 3.1 MB). It also keeps its levels on their way into the map: on WebGPU a buffer of 2.1 MB and a strip of 1.6 MB, on WebGL2 two pixel pack buffers of 2.1 MB. That is about 9 MB in all. The engine counts them in its GPU memory figures, and frees them with the map.

**Allocation.** `bun run bench:allocation --sky-environment` lights S1 with the sky's environment and moves the sun in every frame. So a stage runs in six of every seven frames. Both paths passed. Each stage makes one object that the browser returns: on WebGPU its render pass's encoder, 12 bytes per frame on average, and on WebGL2 its fence, 17 bytes per frame. Three places allocated before their fixes:

- The image table's `generator()` returns a new pair. The stage command reads the code with `generatorCodeFor()`, which makes none.
- A `for...of` loop over a step's targets allocated in the render worker's stage. An index loop does not.
- The WebGL2 backend forgot its bindings after the room's generator by setting `length = 0`. The arrays then grew again with the next draws. With `fill(undefined)`, Chrome took the slow path of `fill` on these sparse arrays, at 390 bytes per frame. A loop that stores `undefined` in each entry allocates nothing ([implementation notes](../implementation-notes.md#hot-paths-without-allocation)).

**Download size**, against main's build, after Brotli:

| File | Main | This change |
| --- | --- | --- |
| The pipelined start | 137.5 KB | 137.7 KB |
| `js/sketch-worker.js` | 45,891 bytes | 46,009 bytes (+0.3%) |
| `js/render-worker.js` | 35,738 bytes | 35,907 bytes (+0.5%) |
| The environment generators' code, `js/*-environment-generator.js` | 2,801 bytes | 4,508 bytes (+61%) |
| The environment shaders, `js/shaders-environment-*.js` | 4,833 to 4,925 bytes | 7,073 to 7,220 bytes (+46%) |
| The sky's shaders, `js/shaders-sky-*.js` | 3,785 to 4,898 bytes | 3,970 to 5,091 bytes (+4 to 5%) |
| The core, `null3d_bg.wasm` | 342,842 bytes | 346,801 bytes (+1.2%) |

The start grows by about 290 bytes. That is the call `assets.skyEnvironment`, which must exist before its first use, and each backend's handling of the stage command and of the map's cleanup. The rest of the work loads with the generators' code on first use. `timeOfDay` lies in the start's module, but no start file holds it: a page that does not import it drops it. The sky's shaders grew because they now call the shared module `null3d::atmosphere` with its settings in a struct. Their pixels did not change: the sky image tests pass against their old references.

## Time of day

| Option | Verdict |
| --- | --- |
| A function that returns the values of a time of day | Chosen |
| A call that applies them, such as `scene.setTimeOfDay(hours, { sun, fog })` | Rejected. It would need the sketch's light, its fog's curve and density, and the post settings, and it would overwrite them. Scenes differ in all three |
| A recipe in the docs only | Rejected. The values need the sky model in code. The showcase scenes and ports of three.js's time-of-day presets all need them |

`timeOfDay(time, { heading, noonElevation })` takes an hour from 0 to 24, or a preset:

- `afternoon`, 15:00;
- `goldenHour`, 17:36, with the sun 5 degrees up;
- `blueHour`, 18:24, with the sun 5 degrees down;
- `night`, 23:00.

The sun rises toward +X, stands toward -Z at noon, 60 degrees up by default, and sets toward -X. `heading` turns that path about +Y.

How it works out each value:

- **The sky's air.** Turbidity goes from 2.5 to 4 and Rayleigh from 1.2 to 2 as the sun nears the horizon, which warms a low sun.
- **The sky's brightness.** three.js's sky reaches about 5 at the horizon by day. Lights and fog take colors from 0 to 1, and a bright sun is about 3. So by day `skyIntensity` is 0.15, which brings the sky into the lights' range. The sun then outshines the sky's diffuse light about two to one.
- **The sky at dusk.** three.js's sky dims a hundredfold as its sun reaches the horizon, and goes dark about 2 degrees below it. So below 8 degrees, the sky's average light follows a table. It is 0.03 at sunset, 0.008 at 6 degrees down (blue hour) and 0.0015 at 12 degrees down (night), in log space between them. Under the horizon, the sky keeps its own sun at 1.2 degrees down, which keeps the sunset's glow. That sun sinks to 3 degrees down as night falls, which leaves an even, dark sky.
- **The main light.** By day it is the sun, colored by the air that its light crosses: three.js's extinction in the sun's direction. Its intensity is 3.2 times its brightest channel, and it fades over the last 6 degrees to the horizon. Under the horizon it is the moon: opposite the sun, at least 25 degrees up, a cool white of intensity 0.4. The moon brightens over the first 6 degrees of dusk. One directional light serves both, and the switch comes where both are dark.
- **The fog's color.** It is the sky's light 3 degrees up, averaged all around, times `skyIntensity`. At dusk it turns to the sky's average color, since only the sunset's side glows. A color past 1 scales down to 1.
- **The ambient light.** It is the sky's light 35 degrees up, averaged all around, about its average over the sky. An ambient light of π times that lights a surface as that sky does. A scene lit by the sky's environment needs none.
- **The exposure.** It is 1 above 15 degrees, 2 at sunset, 3 at 6 degrees down and 3.5 at night, linear between them.

The image tests `time-of-day-*` draw the four presets with the sky's environment, the sun or the moon, fog and the exposure. Spheres from mirror to rough show the light, on all three tiers.

## Decision

- `assets.skyEnvironment()` makes the map of the scene's sky, which follows the sky with no call. The core refreshes it in stages, one a frame.
- The sky map's filter takes 128 directions at level 1, and its chain 2 x 2 directions.
- `timeOfDay` returns the values of a time of day, and the docs show how to apply them.

## Consequences

- The phones' figures are open: the refresh cost and the time to the new light on the Galaxy S24+ (WebGPU and WebGL2) and on the iPad. The device runner can run `tests/pages/sky-map-cost.html` as it runs the generator page, and `tests/pages/sky-refresh.html`. If a stage passes 4 ms on a phone, that stage splits by faces.
- Each sky map keeps about 9 MB of GPU memory for its stages. A second sky map is rarely useful, since every sky map shows the one sky.
- The sky model now has three copies: the shaders' `null3d::atmosphere`, the core's `sky_light.rs` for the diffuse light, and the clear sky in `time-of-day.ts`. A change to three.js's sky must change all three. The sky refresh test and the time-of-day image tests compare the first two, through the rough sphere's diffuse light.
