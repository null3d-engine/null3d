# D-118: Environment light from the generated sky, and time of day

Status: decided, 2026-10-09. Date: 2026-10-09, updated 2026-10-10 (the night sky). Task: M2-EX14.

Summary: `assets.skyEnvironment()` makes an environment of the sky that `scene.setBackground({ sky })` draws, and the map follows the sky with no further call. The engine core refreshes it in 20 stages, one a frame, so no frame waits for the whole map. Each stage draws one cube face or a few. On a software GPU, the longest stage fell from 27 to 30 ms to under 6 ms. Frames draw with the old map until the last stage copies every new level in at once. The diffuse light changes in the same frame. The new light shows 19 frames after the move's frame, against 6 with the first design's 7 stages. `timeOfDay(hours or preset)` works out the sun, the sky, the main light, the fog, an ambient light and the exposure from one value. It returns values, which the sketch applies to its own objects. At night the sky's own sun stands at the moon's place, so the night sky is a dim navy blue, not black ([The night sky](#the-night-sky)).

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
3. **The core runs the stages.** The engine core records one draw-list command per stage (`SkyMapStep`, opcode 55, in `crates/null3d-gpu/src/drawlist.rs`). The first design had 7 stages: the sky into every level of the chain, one stage for each of the 5 filtered levels, and the copy. The cloud phones then split them further (see [Stages by faces](#stages-by-faces)). Now there are 20:
   - Stages 0 to 5 each draw one face of the cube into every level of the chain, in one render pass, and into the map's level 0.
   - Stages 6 to 18 filter the levels: level 1 in 6 stages of one face, level 2 in 3 stages of 2 faces, level 3 in 2 stages of 3 faces, and levels 4 and 5 in one stage each.
   - Stage 19 copies all six levels into the map.

Until the last stage, the new levels wait in a buffer that frames do not read. So no frame draws a half-made map. The first fill records all 20 stages in one frame, the frame after the generator's code arrives, as for the room. A refresh records one stage a frame. A change during a refresh waits until it ends. Then the next refresh starts with the sky as it is then.

The thread that draws plans the stages (`skyStages` in `packages/engine/src/gpu/environment-steps.ts`), and both GPU paths follow that one plan. The core only counts them: `assets.skyEnvironment()` passes the count, which a unit test checks against the plan.

The core records the stages, so it knows the frame in which the new levels arrive. It switches the diffuse light in that frame. So reflections and diffuse light change together.

A first refresh at a lower size, then a finer one, was not needed: every stage stays under about 1.1 ms on the Mac, and under 6 ms on a software GPU.

On WebGL2 a stage packs its texels into pixel pack buffers, as the room does. Firefox on the Mac fills such a buffer late ([implementation notes](../implementation-notes.md#browser-faults)), so the room's generator waits for the GPU after each pack. The sky map unpacks a buffer only in a later stage. That stage asks a fence whether the GPU has run the packs. It waits for the GPU only when the GPU has not, and after a frame it has. The first fill, whose stages share one frame, waits as the room does.

### Stages by faces

The cloud phones ran the first design's 7 stages (see [Data](#data)). The Galaxy S24 took 6.09 ms for the filter of level 1, past the line of 4 ms. So the stages now split by cube faces.

| Option | Verdict |
| --- | --- |
| Each stage draws whole faces, and no filtered level shares a stage with another | Chosen |
| Pack the faces of levels 3 and 4, then 4 and 5, into shared stages: 19 stages | Rejected. On the Mac, those mixed stages cost the most: 1.25 and 0.79 ms of WebGL2's GPU time |
| Split a texel's directions over frames, with partial sums in a float target | Not done. Only this would shorten level 5 (below), at the cost of a float target and more stages |

The plan weighs a face of level `k` as its texels times its directions per texel: `(size >> k)² × 2^k`. Each level splits into as few stages as keep each one within the weight of one face of level 1. Level 1 takes 6 stages of one face, level 2 three of 2 faces, level 3 two of 3 faces, and levels 4 and 5 one each.

A small level has too few texels to fill a GPU. Its time then follows its directions per texel, not its texels, so two such draws in a row add up. That is why the packed plan's mixed stages cost the most. The S24's figures fit this: its stages 3, 4 and 5 took 2.95, 3.59 and 4.81 ms. Its copy stage draws nothing and took 2.63 ms. Less that, they took about 0.3, 1.0 and 2.2 ms, which double as the directions per texel double. So no split by faces can shorten level 5.

Both plans ran on the owner's Mac on 9 October 2026, with the load at 7 to 9. The 7 stages ran at main's dc0bce314. Each figure is the median of 16 refreshes. The table gives the costliest stage of each plan, and the whole map at once.

| Path | 7 stages: costliest | 20 stages: costliest | Whole map, 7 stages | Whole map, 20 stages |
| --- | --- | --- | --- | --- |
| Mac, WebGPU | 1.06 ms (level 4) | 1.00 ms (level 4) | 9.6 ms | 14.0 ms |
| Mac, compatibility mode | 1.31 ms (level 4) | 1.07 ms (level 4) | 9.5 ms | 13.5 ms |
| Mac, WebGL2, from the call to the GPU's end | 1.39 ms (level 4) | 1.53 ms (levels 3 and 4) | 10.5 ms | 14.2 ms |
| Mac, WebGL2, timer queries | 0.70 ms (levels 3 and 4) | 0.69 ms (levels 3 and 4) | | |
| SwiftShader, WebGPU | 27.31 ms (level 1) | 5.70 ms (a face of level 1) | 183 ms | 174 ms |
| SwiftShader, compatibility mode | 27.25 ms (level 1) | 5.82 ms (a face of level 1) | 162 ms | 166 ms |
| SwiftShader, WebGL2, timer queries | 30.26 ms (level 1) | 4.92 ms (a face of level 1) | | |

- The Mac's GPU gains nothing. Its stages cost about 1 ms either way: most of a stage's time there does not grow with its texels. Its GPU time of a whole refresh doubles: on WebGL2's timer queries, from 3.1 ms to 6.6 ms, spread over 20 frames.
- The software GPU pays for texels, as a phone's GPU does. Its costliest stage falls to a fifth or a sixth. Its whole refresh costs about the same: 73.6 ms and 66.7 ms of WebGL2's GPU time.
- The light did not change: the levels lie as far from the finer filter as before, to the last digit (see [The filter's directions](#the-filters-directions)).
- On WebGL2 the browser puts off the upload of the map from its pixel buffer. It runs it when a draw reads the map, or when a later call writes the buffer. The engine's frame reads the map just after the copy. The test page did not. So the next refresh's first stage took the cost: 1.85 ms of GPU time on the Mac, against 0.21 ms for the next face. The page now reads the map after the copy, as a frame does, in both plans' runs above.

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

The figures in this section come from the first design's 7 stages. [Stages by faces](#stages-by-faces) compares them with the 20 stages. All Mac figures come from Chrome on the owner's Mac (Apple M5 Max) on 9 October 2026, while other work ran (load 10 to 15). The sky map test page (`tests/pages/sky-map-cost.ts`) times 8 refreshes with a sun that moves. It times each stage from its call until the GPU has finished it, on a queue with no other work. WebGL2 also gives its timer queries' GPU times.

| Path | Stage 0: the sky | Stages 1 to 5: one level each | Stage 6: the copy | The whole map at once |
| --- | --- | --- | --- | --- |
| Mac, WebGPU | 0.49 ms | 0.42 to 0.65 ms | 0.30 ms | 10.0 ms |
| Mac, compatibility mode | 0.52 ms | 0.44 to 0.74 ms | 0.27 ms | 9.7 ms |
| Mac, WebGL2, from the call to the GPU's end | 0.84 ms | 0.65 to 1.42 ms | 0.55 ms | 10.3 ms |
| Mac, WebGL2, timer queries | 0.46 ms | 0.35 to 0.69 ms | 0.01 ms | |
| SwiftShader on the Mac, WebGL2 timer queries | 10.5 ms | 27.8, 13.6, 6.9, 3.3 and 1.9 ms | 0.14 ms | |

Before the chain drew in one render pass, stage 0 took 0.96 ms on WebGPU. On the software GPU, stage 1 costs most: its level has the most texels. On a slow phone, that stage is the one to watch. On WebGL2, these runs' stage 0 took the upload of the refresh before it ([Stages by faces](#stages-by-faces) says why).

**Cloud devices, a rough guide.** The device runner's `sky` plan ran both test pages on BrowserStack Automate on 9 October 2026, at ea5cb60eb: runs `20261009-030547-sky` and `20261009-030816-sky`. Neither browser gave WebGL2 timer queries. So every figure runs from the stage's call until the GPU has finished it. On the Mac, that wait added 0.3 to 0.7 ms to each stage. The cloud's Galaxy S24 has no WebGPU adapter, so it ran WebGL2 only. Its display ran at 30 Hz.

| Device and path | Stage 0: the sky | Stages 1 to 5: one level each | Stage 6: the copy | The whole map at once |
| --- | --- | --- | --- | --- |
| iPad 10th (A14), Safari 27, WebGPU | 3.12 ms | 3.48, 2.94, 3.24, 2.08 and 1.58 ms | 1.08 ms | 89.3 ms |
| iPad 10th, compatibility mode | 5.02 ms | 4.08, 4.08, 3.84, 2.80 and 2.12 ms | 1.42 ms | 30.1 ms |
| iPad 10th, WebGL2 | 3.50 ms | 3.40, 1.94, 1.46, 1.50 and 1.22 ms | 0.70 ms | 111.6 ms |
| Galaxy S24 (Xclipse 940), Chrome 152, WebGL2 | 3.96 ms | 6.09, 3.84, 2.95, 3.59 and 4.81 ms | 2.63 ms | 50.2 ms |

Each figure is the median of 8 refreshes. The longest single stages were 7.97 ms on the S24 (stage 4) and 8.28 ms on the iPad in compatibility mode (stage 3).

- As on the software GPU, the first filter stage is the S24's slowest, at 6.09 ms. It passes the line of 4 ms that splits a stage by faces. So do the S24's stage 5 (4.81 ms) and the iPad's stage 0 in compatibility mode (5.02 ms). Stage 5 filters the second smallest level, so much of the S24's time there is the wait for the GPU's end, not the filter. Timer queries would tell the two apart, and neither phone has them. On WebGL2, the stage 0 of both devices may also have taken the upload of the refresh before it, as the Mac's did.
- On every path of both devices, the new sky's light showed 6 frames after the move, as on the Mac.
- These figures led to the split by faces. The cloud devices have not run the 20 stages yet.

**Time to the new light.** The sky refresh test (`tests/image/sky-refresh.spec.ts`) moves the sun and captures every frame after the move, with the drawing held to 20 frames a second. On all three tiers, the mirror sphere's reflection and the rough sphere's diffuse light kept the old light for the move's frame and the next 18. Both showed the new light from the 19th frame after the move. At 60 frames a second, that is 317 ms from the move. When a refresh is under way at the move, it takes up to 39 frames, 650 ms. The first design's 7 stages showed the new light from the 6th frame, 100 ms after the move.

**A sky that changes in every frame** refreshes the map without end, one stage a frame: under 1.1 ms of GPU time per frame on the Mac. A sketch that moves the sun in steps pays only after each step. So does a still scene that animates only the clouds' `time`.

**Memory.** Beside its 2 MB map, a sky map keeps its chain of 9 levels (2.1 MB) and the texture that the stages draw into (1,536 x 511 texels, 3.1 MB). It also keeps its levels on their way into the map: on WebGPU a buffer of 2.1 MB and a strip of 1.6 MB, on WebGL2 two pixel pack buffers of 2.1 MB. That is about 9 MB in all. The engine counts them in its GPU memory figures, and frees them with the map.

**Allocation.** `bun run bench:allocation --sky-environment` lights S1 with the sky's environment and moves the sun in every frame. So a stage that draws runs in 19 of every 20 frames. The sky map's places stayed within their budgets on both paths. Each stage makes one object that the browser returns: on WebGPU its render pass's encoder, 15 bytes per frame on average, and on WebGL2 its fence, 15 bytes per frame. With 7 stages, they were 12 and 17 bytes. Three places allocated before their fixes:

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

- **The sky's air.** Turbidity goes from 2.5 to 4 and Rayleigh from 1.2 to 2 as the sky's sun nears the horizon, which warms a low sun. The night sky's sun stands high, so the night keeps clear air.
- **The sky's brightness.** three.js's sky reaches about 5 at the horizon by day. Lights and fog take colors from 0 to 1, and a bright sun is about 3. So by day `skyIntensity` is 0.15, which brings the sky into the lights' range. The sun then outshines the sky's diffuse light about two to one.
- **The sky at dusk.** three.js's sky dims a hundredfold as its sun reaches the horizon, and goes dark about 2 degrees below it. So below 8 degrees, the sky's average light follows a table. It is 0.03 at sunset, 0.008 at 6 degrees down (blue hour) and 0.0015 at 12 degrees down (night), in log space between them. Under the horizon, the sky keeps its own sun at 1.2 degrees down, which keeps the sunset's glow. From 6 to 9 degrees down that sun sinks to 3 degrees down, and the glow fades out. Then the night sky takes over ([The night sky](#the-night-sky)).
- **The main light.** By day it is the sun, colored by the air that its light crosses: three.js's extinction in the sun's direction. Its intensity is 3.2 times its brightest channel, and it fades over the last 6 degrees to the horizon. Under the horizon it is the moon: opposite the sun, at least 25 degrees up, a cool white of intensity 0.4. The moon brightens over the first 6 degrees of dusk. One directional light serves both, and the switch comes where both are dark.
- **The fog's color.** It is the sky's light 3 degrees up, averaged all around, times `skyIntensity`. At dusk it turns to the sky's average color, since only the sunset's side glows. A color past 1 scales down to 1.
- **The ambient light.** It is the sky's light 35 degrees up, averaged all around, about its average over the sky. An ambient light of π times that lights a surface as that sky does. A scene lit by the sky's environment needs none.
- **The exposure.** It is 1 above 15 degrees, 2 at sunset, 3 at 6 degrees down and 3.5 at night, linear between them.

The image tests `time-of-day-*` draw the four presets with the sky's environment, the sun or the moon, fog and the exposure. Spheres from mirror to rough show the light, on all three tiers.

### The night sky

The first design sank the sky's own sun to 3 degrees under the horizon at night. three.js's sky gives no sun light past its cutoff, about 2.3 degrees down. What is left is its flat night term, a grey of 0.1 times the air's extinction. The dusk table scales the sky's average to 0.0015, and at an exposure of 3.5 the tone curve maps that grey to black. The night preset's sky showed sRGB (4, 4, 3) at the zenith and (3, 3, 2) at 35 degrees up. Its horizon was (0, 0, 0), and its fog (3, 3, 2). The night references showed the same black sky. So did the showcase scenes' night presets.

The fix lights the night sky as by day, from the moon's place, and dims it with `skyIntensity`. This is the "day for night" sky of film. The sky's average luminance still follows the dusk table, 0.0015 at night. That light is blue, and luminance weighs blue little, so the sky shows as a navy blue.

How the sky's sun gets from its dusk place to the moon's place:

| Option | Verdict |
| --- | --- |
| A: turn it along the arc between them from 6 to 12 degrees down | Rejected. The arc crosses the horizon and passes over the zenith. `skyIntensity` scales the sky's average to the table, so a low sun's glow and a high sun's glow both flare. Halfway, the horizon on the sunset's side reached sRGB (254, 238, 208), and 12 minutes of the day later the zenith reached (51, 88, 123) |
| B: switch at 12 degrees down | Rejected. One frame jumps from the dark grey sky to the navy one |
| C: fade the dusk sky out, move the sun where the sky has no sun light, then fade the moon's sky in | Chosen |

Option C works in steps of the real sun's height:

1. From 6 to 9 degrees down, the sky's sun sinks from 1.2 to 3 degrees down, and the sunset's glow fades, as before.
2. At 9 degrees down, the sky's sun moves to the moon's side, still 3 degrees down. Past the cutoff the sky's light does not depend on the sun's heading, so no pixel changes. A unit test checks that the sky's sun stands past the cutoff on both sides of the move.
3. From 9 to 10 degrees down, `skyIntensity` moves in log space from the dusk's scale to the scale of the risen moon's sky. The sky goes from (13, 13, 11) to black.
4. From 10 to 12 degrees down, the sky's sun rises to the moon's place at that scale. The model's own light grows as the sun rises, so the moon's sky fades in. At first a dim warm glow shows on the moon's horizon, like a moonrise. Below 12 degrees down, `skyIntensity` scales the sky's average to the table again, and the two scales meet there.

At dawn the same steps run the other way. A unit test samples the day from 17:30 to 19:30 and from 4:30 to 6:30. Every value's largest step shrinks tenfold with the time step, so no value jumps.

The night sky's figures, from the helper's sky model with three.js's ACES curve at an exposure of 3.5, at 23:00:

| Where | sRGB before | sRGB after |
| --- | --- | --- |
| Zenith | (4, 4, 3) | (0, 1, 7) |
| 35 degrees up, toward the moon | (3, 3, 2) | (2, 11, 27) |
| Horizon, toward the moon | (0, 0, 0) | (22, 39, 47) |
| Horizon, away from the moon | (0, 0, 0) | (7, 18, 24) |
| Fog | (3, 3, 2) | (0, 3, 12) |

The ambient light's color is (0.13, 0.38, 1), a dim blue. The sky's environment gets the same blue from the same sky, and its diffuse light now matches. The sky's sun disc draws a small moon in the main light's direction. Its light is the sun's disc times `skyIntensity`, bright enough for bloom to give it a halo. `showSunDisc: false` hides it.

The moon's light keeps its floor of 25 degrees, so the sky's sun stands at least 25 degrees up at night. While the moon's sky rises, from 10 to 12 degrees down, its disc rises from the horizon to the moon's place. The moon's light stands there from sunset, so the disc follows it late.

## Decision

- `assets.skyEnvironment()` makes the map of the scene's sky, which follows the sky with no call. The core refreshes it in stages, one a frame.
- The sky map's filter takes 128 directions at level 1, and its chain 2 x 2 directions.
- `timeOfDay` returns the values of a time of day, and the docs show how to apply them.

## Consequences

- The cloud's S24 and iPad 10th ran the first design's 7 stages (above). Three stages passed 4 ms there, by figures that include the wait for the GPU's end. They were the S24's stages 1 and 5 on WebGL2, and the iPad's stage 0 in compatibility mode. The stages now split by faces ([Stages by faces](#stages-by-faces)). The `sky` plan runs again on the cloud's S24 after this change lands. The S24's level 5 may still pass 4 ms, since no split by faces shortens it. Only a split of each texel's directions over frames would. The owner's S24+ (WebGPU and WebGL2) and iPad have not run the `sky` plan yet.
- A refresh now takes 20 frames, not 7. So the light lags a moved sun by about 320 ms at 60 frames a second, not 100 ms. On the Mac, the GPU time of a whole refresh doubles, though no frame's share grows.
- Each sky map keeps about 9 MB of GPU memory for its stages. A second sky map is rarely useful, since every sky map shows the one sky.
- The sky model now has three copies: the shaders' `null3d::atmosphere`, the core's `sky_light.rs` for the diffuse light, and the clear sky in `time-of-day.ts`. A change to three.js's sky must change all three. The sky refresh test and the time-of-day image tests compare the first two, through the rough sphere's diffuse light.
