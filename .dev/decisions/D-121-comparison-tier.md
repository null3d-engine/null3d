# D-121: The comparison tier with three.js, and Factory

Status: built, 2026-10-09, from the owner's decisions of 8 October 2026 ([Examples](../examples.md#decisions-of-8-october-2026)). Two modes added 2026-10-10, from the owner's decision that day, with the Mac's figures. The batched mode dropped 2026-10-20, from the owner's decision of that day (M2-R34): the comparisons keep the scene graph route alone. Task: M2-EX5. Factory does not go on the page until a device sitting shows that null3D holds the higher count on every device class.

Summary: The comparisons with three.js live in `examples/compare/`, one folder per scene, with one shared description that both engines draw. A shell in `examples/lib/` starts either engine on a canvas with the same settings, sets the count, measures and runs the ramp, so the website can draw its own controls. `@null3d/engine/stats` now exports the overlay's panel, so the three.js half shows its figures in the engine's own card. Factory is the first comparison. Each comparison builds its scene one way, the same way in both engines: a scene graph of one object per part. Batches of copies, posed in closed form, were a second mode from 10 October 2026 until 20 October 2026, when the owner dropped them. The first Factory build set a null3D tree against three.js's batches, which was not a fair test.

## Question

The old `demos-vs-threejs` repository compared the engines in an app of its own. The owner moved the comparisons into `examples/` on 8 October 2026. How do the comparisons run there, so that the clone's page and the website both show them, both engines draw the same scene by the same rules, and the headline figure is fair?

## Rule

- One description per scene, with no engine imports, which both engines run: the seed, the layout, the fixed-step simulation, the meshes, the surfaces, the lights and the camera path.
- The fairness rules of [Examples](../examples.md#fairness-rules): the same pixel ratio and MSAA, null3D's governor off with a fixed preset, three.js on its faster renderer in one worker, one engine at a time, one memory definition.
- Each engine draws each effect with its own best technique for the same intent ([D-52](D-52-intent-parity.md)), and each effect is a switch.
- The headline figure is the largest count that each engine holds at the display rate on the viewer's device.

## Two modes

The first Factory build set a null3D tree of objects against three.js's most tuned build: one `InstancedMesh` per part kind, posed by a closed-form loop with no scene graph. It also made room in null3D for the ramp's top count at every count, and ran on the development server. So it measured two different programs. On 10 October 2026 the owner decided that each comparison has two modes, and that both engines build the scene the same way in each:

- **Scene graph**, the default. Each arm is a tree of one object per part, as each engine's own examples build jointed models. The code writes each joint that moved, and each engine works out the world transforms of the trees and draws the parts its own way. This is how most apps build such a scene, so it is the headline.
- **Instanced.** Each part kind is one batch of copies: null3D's instance batches and three.js's `InstancedMesh`. One closed-form loop (`examples/compare/factory/pose.ts`) poses every moving part. three.js takes its results as matrices, and null3D as batch rows. A unit test checks both forms against the walk of each arm's tree.

The rules of each mode:

- In the scene graph mode, each engine holds only the objects of the cells that show. null3D makes cells as the count rises, and destroys them as it falls. Hidden objects cost null3D work in every frame when they are dynamic, so making room for the ramp's top would charge null3D for parts that never draw. The joints that turn in most frames are dynamic objects. The fingers, which move only at a grip, and the crates, which stand still on the pallet and wait on the belt, are static objects ([Static and dynamic objects](../../docs/concepts/static-dynamic.md)).
- three.js turns off `matrixAutoUpdate` on every node and calls `updateMatrix` after a write, as its docs advise for objects that do not move in every frame. Its renderer's walk of the scene graph works out the world matrices, and it draws each part on its own. A held crate hangs under the wrist, since reparenting is cheap in three.js.
- In the instanced mode, both engines make their batches for the ramp's maximum and draw the copies in use.
- Both modes draw the same frame, so the instanced image tests borrow the scene graph's references.
- The page's mode switch loads the page again, as the engine switch does, and the ramp keeps each engine's result per mode. `startComparison` takes `mode`, so the website can switch it too. The switch and the mode went with the batched mode on 20 October 2026.
- Figures come from production builds only. The development server keeps the engine's development checks in every setter, which three.js does not have.

### The batched mode dropped, 20 October 2026

The owner's question was which route a comparison should measure, and his decision was the canonical one: each engine builds the scene the way its own users build it, one object per part in a tree. Batches exist for scenes of many copies of a few meshes, and the comparisons are not that scene. So the mode switch went, and both engines run the scene graph route alone.

What the runs showed before the removal (M2-R34, iPhone 18 Pro, WebGPU, 200 to 1,000 units):

- On the scene graph route, null3D led three.js at every count: 35.2 against 32.7 frames a second at 200 units, 30.2 against 14.3 at 500, and 24.8 against 7.3 at 1,000.
- three.js's batched route was the only place it led, at 63 and 49.8 frames a second at 100 and 500 units. That route drew 49 to 63 draws against the scene graph's 163 to 298.
- null3D's shadow cascades cost about 1.1 ms each, and about 45 draws each. The batched route could not show that cost at all.

The batched route's code went with it: `three-crowd.ts`, the closed-form pose module, its mode branches in both engines' halves, and its image references.

## Decision

1. **Files.** `examples/compare/<name>/` holds `scene.ts`, `sketch.ts` (null3D) and `three.ts` (three.js 0.186.1 in a worker). `examples/compare/comparisons.ts` lists them, with literal addresses of the sketch and the worker, so a production build ships both. `examples/lib/compare-scene.ts` holds what every scene shares: the fixed-step clock, rotations, camera loops, meshes as arrays with texture coordinates in meters, textures made in code and the grading table. The old repository's measuring tools stay behind: `bench/` and `tests/real-browsers.ts` do that work here.
2. **The shell.** `startComparison({ canvas, comparison, engine })` starts one engine and returns `setCount`, `measure`, `collapseStats` and `destroy`. `rampComparison(run)` runs the ramp. The clone's page (`examples/compare-page.ts`) is one layout over them: an engine switch, a count slider, effect switches, "Run the ramp" and an "about this comparison" panel. Each engine runs on a page of its own, as each demo does, so the switch and the ramp load the page again. A page that swapped engines in place would hold two engines' memories on an iPad ([Examples](../examples.md#each-pick-is-a-new-page)).
3. **The ramp.** Each step sets the count, settles for half a second and measures a second of presented frames. A step holds at 95% of the display rate or more. The ramp stops after two missed steps in a row, or at its maximum. The old ramp grew the count once a second on the wall clock and stopped after three misses past 20 seconds, to line up recordings of both engines. A comparison on one device needs no such alignment, and the shorter rule finishes sooner.
4. **The three.js half.** In the scene graph mode, each arm is a tree of `Object3D` nodes, one `Mesh` per part, and a held crate hangs under the wrist. In the instanced mode, it is the old repository's tuned version: one `InstancedMesh` per part kind, and a loop of game code that writes every moving part's world matrix in closed form. Its worker (`examples/lib/three-worker.ts`) draws the effects with three.js's own techniques. On WebGLRenderer, these are `EffectComposer` with `GTAOPass`, `UnrealBloomPass`, `OutputPass` (AgX) and `LUTPass`. On WebGPURenderer, they are the GTAO node, the bloom node, the output transform and the 3D LUT node. The room environment comes from `RoomEnvironment` through `PMREMGenerator`. three.js has no height fog, so the worker gives it null3D's fog formula: GLSL in place of `FogExp2`'s chunks, and a fog node.
5. **The null3D half.** In the scene graph mode, each arm is a tree of scene objects: the base stands still, and six parts move under their parents. The sketch writes each joint that changed, and the engine works out the world transforms on its job workers. The still parts and the crates hang under the base. A held crate follows the wrist. After the engine moves the trees, `onLateUpdate` reads the wrist's world transform and places the crate in the same frame. Reparenting the crate at each grip would rebuild the draw tables several times a second. In the instanced mode, each part kind is one instance batch, and the closed-form loop writes the moving rows. The batches cast and receive the spot lights' shadows, as three.js's `InstancedMesh` does ([D-115](D-115-batch-shadows.md)).
6. **Making the cells.** The engine queues at most 65,536 structural changes between two frames ([Scene](../../docs/api/scene.md)). Making 5,000 cells at once, 75,000 objects, failed with E1102. Each object takes about four changes, so the sketch makes or destroys 250 cells in each frame until the scene holds the cells that show.
7. **The stats panel.** The engine's overlay now builds its header and card through `StatsPanel`, which `@null3d/engine/stats` exports. `examples/lib/stats-three.ts` fills one with three.js's figures: the worker's frame time split into the scene's code and the render calls, `renderer.info` draws and triangles, instances counted per draw, GPU time from WebGL2's timer queries or WebGPURenderer's timestamps where the page starts with the panel open, and the page's heap and whole-page memory with the overlay's calls. three.js reports no GPU bytes, so those parts stay out of the card. A new frame mode, `'one-thread'`, explains a renderer that prepares and draws each frame on one thread. The overlay's file, which loads at its first showing, grew from 6,375 to 6,602 bytes after Brotli, 3.6%, for the panel's class and the new mode's words. That is 40% of the 16 KB budget of a file that loads on first use. The engine's start files do not change.
8. **Factory's scale.** The ramps top out at 50,000 moving parts on desktops, 30,000 on tablets and 20,000 on phones, where three.js's per-object work was expected to show on phones. Each row waits for a device sitting. The Mac's timing raised the desktop maximum to 200,000 with the page's `?max=` switch, since null3D held the default maximum in every run.
9. **three.js's renderer.** In Chrome on the Mac, WebGLRenderer used a quarter of WebGPURenderer's CPU time per frame on Factory. So WebGLRenderer is the default on every GPU path until a device sitting shows otherwise, and `?renderer=webgpu` picks the other.

## Options rejected

- **A null3D tree against three.js's batches**, the first build. It measured two different programs, so each mode now builds the scene the same way in both engines.
- **The instanced mode as the headline.** It is the most tuned build, but most apps build jointed models as trees, and a tree of objects is what the scene is about.
- **One page that swaps engines in place.** Safari reserves address space for each engine's memory, and frees a dropped memory late.
- **An effect only where both engines draw it pixel for pixel**, the old repository's rule. The owner replaced it on 8 October 2026 with intent parity and a review of both engines' held frames.

## The look match

On 10 October 2026 the owner saw a brighter floor and a shimmer in three.js's held frames. The fix made the setups mean the same, and kept each engine's own technique where the techniques differ.

- **Bloom.** The look gave the same strength to UnrealBloomPass, the bloom node and null3D's chain. Each spreads its light in its own steps, so the same number made different glows. The port skill's mapping (`skills/null3d-port-threejs/scripts/map-bloom.mjs`) puts UnrealBloomPass at strength 0.35 equal to null3D's intensity 3.07, and the bloom node at 0.35 equal to 1.02. So null3D drew about a ninth of WebGLRenderer's glow and a third of WebGPURenderer's. Now the look sets bloom once, as UnrealBloomPass's settings. The bloom node takes three times the strength. null3D takes the mapped intensity, knee and level weights for a canvas 720 pixels high, the ramps' size. On a larger canvas, null3D's glow looks a little wider, because it keeps its share of the screen.
- **Ambient occlusion and MSAA on WebGPURenderer.** The GTAO node cannot read a multisampled depth buffer, so the scene pass drew without MSAA whenever ambient occlusion was on. Edges then shimmered as the camera moved. Now a depth and normal pass of its own, without MSAA, feeds the GTAO node, and the denoise node smooths the result. It darkens only the ambient light inside the scene pass, which keeps 4x MSAA. three.js's own ambient occlusion example builds it this way. GTAOPass on WebGLRenderer draws such a pass too.
- **A technique difference that stays.** null3D and the GTAO node darken only the ambient light, as ambient occlusion means. GTAOPass darkens the whole image, so WebGLRenderer looks a little darker where parts meet. The page's notes say so.
- **The test page.** The comparison's test page passed no effect switches, so every held frame drew every effect. It passes them now, so a frame can show one effect alone.

Held frames at 640 x 360, scene graph mode, in Chrome on the Mac's GPU. The figure is the mean brightness (0 to 255, sRGB) of the lower 45% of the frame, mostly the floor:

| Effects | null3D WebGPU | null3D WebGL2 | three.js WebGLRenderer | three.js WebGPURenderer |
| --- | --- | --- | --- | --- |
| None | 97.9 | 98.1 | 95.3 | 95.4 |
| Bloom alone, before | 100.1 | 100.4 | 116.0 | 104.0 |
| Bloom alone, after | 117.0 | 117.4 | 116.0 | 116.2 |
| All, before | 88.3 | 88.5 | 101.3 | 93.3 |
| All, after | 103.5 | 103.2 | 101.3 | 102.9 |

- Shadows, fog and the grade each moved the engines' floors by the same amount, within 1 step. Ambient occlusion darkened null3D's floor by 3.3 steps and three.js's by 1.0 to 1.6. With no effects, null3D's floor is about 3 steps brighter, under 3%. This run did not trace that small gap.
- A measure of fine detail, the mean step between neighbouring pixels, shows the MSAA. With ambient occlusion alone, WebGPURenderer's frame measured 5.48 before and 5.07 after, against 5.06 for WebGLRenderer.

## Figures on the Mac

All runs are from 10 October 2026, in Chrome 155 on the owner's Mac (Apple M5 Max). The scene graph runs and the three.js runs used the branch's build before main's merge of that evening. The instanced null3D runs used the build after it.

### How the runs were measured

- A production build of the comparison page, served by `vite preview`. The development server keeps the engine's development checks in every setter, which three.js does not have.
- A Chrome window that Playwright opened on the Mac's built-in display, which presented 120 frames a second. The canvas was 1280 x 720 CSS pixels at pixel ratio 1, with 4x MSAA and every effect on.
- The page's fairness rules: null3D's governor off with a fixed preset, High on WebGPU and Medium on WebGL2, and three.js 0.186.1 in one worker. One engine ran at a time, each on a page of its own.
- Each run started only while the Mac's 1-minute load was below 8. The loads at the pages' ends were 2.2 to 5.4.
- The ramp made room for 200,000 moving parts, warmed up for 10 seconds, then grew from 2,000 by a fifth at each step. A step held at 114 frames a second or more, 95% of the display's rate.
- A fixed count warmed up for 4 seconds and measured 10. The busiest thread is the thread with the most CPU time per frame. In null3D, that was the sketch worker in every run. three.js prepares and draws each frame on its one worker.
- Memory is the browser's measurement of the whole page and its workers, with null3D's shared memory counted once. It holds no GPU memory.

The [run's record](../tested-devices/macbook-pro-chrome/20261010-092218-factory-modes.md) has each step.

### Scene graph mode

| Engine and path | Held (of 200,000) | Busiest thread at 10,000 | At 20,000 | At 50,000 | Page memory at 50,000 |
| --- | --- | --- | --- | --- | --- |
| null3D, WebGPU, High | 110,412 | 0.97 ms | 1.62 ms | 3.04 ms | 240 MiB |
| null3D, WebGL2, Medium | 132,495 | 1.29 ms | 1.90 ms | 2.90 ms | 257 MiB |
| three.js, WebGLRenderer | 4,977 | 15.5 ms (64 fps) | 34.6 ms (29 fps) | 112 ms (9 fps) | 108 MiB |
| three.js, WebGPURenderer | 0 | 81 ms (12 fps) | 158 ms (6 fps) | 381 ms (3 fps) | 489 MiB |

- null3D held 22 to 27 times the count of three.js's faster renderer. Every null3D figure in the table ran at 120 frames a second.
- three.js's time is almost all in its render calls: at 50,000 parts, 108 of its 112 ms. Its renderer walks the scene graph to work out the world matrices, and draws each part on its own. null3D works out the trees on its job workers. It draws the parts that share a mesh and a material together, in 117 draws at every count.
- WebGPURenderer held no step: at 2,000 parts it drew 50 frames a second.
- null3D's page needs more memory at small counts. At 10,000 parts, null3D's page took 134 MiB on WebGPU, and three.js's 35 MiB. An earlier probe put null3D's floor at about 84 MiB at 2,000 parts: its WebAssembly memory, and the JavaScript of each engine worker. From 10,000 to 50,000 parts, each added object took 1.9 KB in null3D and 1.3 KB in three.js.

### Instanced mode

| Engine and path | Held (of 200,000) | Busiest thread at 10,000 | At 20,000 | At 50,000 | Page memory at 50,000 |
| --- | --- | --- | --- | --- | --- |
| null3D, WebGPU, High | 200,000, the most | 0.35 ms | 0.56 ms | 1.17 ms | 115 MiB |
| null3D, WebGL2, Medium | 63,896 | 0.56 ms | 0.86 ms | 1.36 ms | 149 MiB |
| three.js, WebGLRenderer | 190,792 | 0.67 ms | 0.84 ms | 1.52 ms | 17 MiB |
| three.js, WebGPURenderer | 0 | 5.92 ms | 6.37 ms | 7.71 ms | 26 MiB |

- null3D on WebGPU held the ramp's top, and three.js's WebGLRenderer held 190,792. null3D's busiest thread took less time at every count.
- null3D on WebGL2 stopped at 63,896, with only 2.1 ms on its busiest CPU thread at that step. So the limit is in the GPU's work or the browser's WebGL2 layer. These runs did not find it.
- three.js's page needs far less memory here: 17 MiB against null3D's 115 MiB on WebGPU. Each copy is one matrix in three.js, and null3D's floor of threads and memory stays.
- The null3D rows in this table come from a later build than the rest, after main's merge of 10 October 2026. In it, the batches cast and receive the spot lights' shadows, as three.js's batches did in every run. Before that merge, null3D's batches drew no shadows, and its page took 252 MiB, since every job worker started at once. The three.js half did not change between the builds.
- WebGPURenderer held no step at the display's full rate. It held 2,400 parts at half the rate.

### The first run

The first run, on 9 October 2026, measured the first build: a null3D tree against three.js's batches, on the development server. null3D made room for the ramp's top at every count, and the window ran at 60 frames a second. Every engine held the ramp's top of 50,000. Its figures measured two different programs, so these figures replace them. Its [record](../tested-devices/macbook-pro-chrome/20261009-125644-factory-ramp.md) stays.

## Device sitting before Factory goes on the page

Factory's ramp on the Mac in Chrome (at 120 Hz) and Safari, the Galaxy S24+, a Pixel, the iPad, and a WebGL-only iPhone, each with the runs recorded in [tested devices](../tested-devices.md).

## Night town and Busy page

Added on 11 October 2026, task M2-EX7. Night town is a rainy downtown at night. Each block brings 12 lights: four street lamps, two neon signs, and two cars, each with two headlights and a tail light. So the count is in lights. The ramps top out under 1,024 lights, the most that both engines' clustered lighting lists at once. Busy page draws the same town beside a page that keeps its own thread busy, and measures that thread's long tasks and input delay. Both comparisons follow the owner's look bar of [D-132](D-132-showcase-look-and-features-2026-10-11.md).

### How each engine draws the town

- null3D lists the point and spot lights of each part of the view in clusters, on WebGPU and WebGL2. Surface functions in WGSL draw the facades with their lit windows and the wet street with its puddles and rain rings. Others draw the neon tubes that stutter. The awnings' edges ripple in a vertex function. A reflection pass mirrors the town in the puddles, with the lights that it sees in clusters of its own (since main's merge of 12 October 2026; before it, the pass drew no point or spot light).
- three.js's WebGPURenderer lists point lights in clusters with its ClusteredLighting add-on, and shades every spot light in every pixel. Its WebGLRenderer shades every light in every pixel, in one shader per material. The same looks come from GLSL that `onBeforeCompile` adds, and from TSL nodes on WebGPU. CSM or CSMShadowNode casts the moon's shadows, and a Reflector or the reflector node mirrors the puddles.
- The scene writes its particles as rows of sprites, from the simulation time: four layers, for the steam, the exhaust, the glows and the rain. Battle's layers use the same rows (`examples/lib/particles.ts`). null3D draws each layer as a sprite batch, and three.js as an instanced quad that faces the camera. The particles add-on of D-132 can take null3D's side.

### three.js's light limit on WebGLRenderer

WebGLRenderer builds every light into each material's shader, and a GPU builds such a shader with only so many lights. The three.js half finds the limit when it starts. It builds a standard material with the moon's cascades and each count of blocks' lights, in a binary search. A shader that fails to build counts as too many. In Chrome on the Mac, 192 lights fit, which is 16 blocks. The town stops there, the page shows the limit, and the ramp stops at it.

### The look

The first frames, on 11 October 2026, showed shop windows that burned white and neon signs too small to read. The sky over the town was grey, the rain streaks long and the steam faint. A moving car stood right in front of the street shot. The fixes:

- Windows glow at a fifth of their first strength, and shops at a tenth. Shops show rows of shelves. The tone curve turns a bright warm light white, so a weaker light keeps its color.
- The signs are 4.4 m tall, not 3.2 m, with thicker tubes, and their glows are larger.
- The sky formula that both engines share is white at the horizon whatever its haze settings, since three.js's Sky follows the Preetham model. A model of the formula showed this for five settings. So the analytic sky now only lights the town, and a sky dome draws the sky that shows (see the second round below). The grade lifts the shadows toward blue.
- Rain drops are shorter, and fade out as they near the camera. Steam is brighter. The street is darker and glossier, with more puddles.
- The street shot moved from 30 to 33 seconds, when no car drives beside the camera, and the camera rides at about 2 m.

The coordinator's review of that round against the owner's bar asked for a moonlit, cloudy sky, textured facades, more neon and color at street level, and stronger reflections in the wet street. The second round, the same evening:

- **The sky.** A dome around the camera draws the sky as light alone, without fog, from one shader in each language: WGSL for null3D, and GLSL and TSL for three.js's two renderers. Clouds of layered noise drift overhead and reach down to the horizon. Their edges that face the moon shine silver. The moon's disc shows through thin cloud with a halo, stars show in the gaps, and a faint sodium glow lights the low air. The moon moved from the north-west to the far end of the street shot, which `timeOfDay(23)` gives with a heading of 0.4. Its height stays 27.6 degrees, and the street camera looks up a little more to show it. The analytic sky stays, hidden behind the dome, because it makes the environment light in both engines.
- **The facades.** The facade maps are made in code at 512 texels a side, not 256. Bricks have uneven shades and a few dark or orange ones, in light mortar, with a course of upright bricks over each window. Concrete has panel seams, tie holes and rain stains under the windows. Plaster has grooved courses on the ground floor. Every window has a frame, with mullions and a transom, and soot gathers under the sills. The normal maps take their relief from the same heights, and the trim is a lighter stone.
- **Neon at street level.** The facade shader draws neon over most shops: five letters of straight tubes on the fascia over the window, or a tube around the window, in one of six colors. Each shop's neon stutters like the blade signs, and some shops glow in their neon's tint. These are emissive pixels, not lights, so the count of lights and the ramps stay the same. The blade signs' tubes are dimmer, because the tone curve turned their bright light white.
- **The wet street.** Puddles cover 60% of the street, not 50%. The asphalt between them is glossier and shows the mirror at half strength. Its grain moves each pixel's sample up or down the screen, so each light leaves a broken streak, as on real wet asphalt. Both engines do this with one sample a pixel. three.js's reflector node has no second sample: a copy of the node never receives the mirror's texture.
- **Screen-space reflections.** These are planned for both engines but not built yet. When they join the comparison, they take the wet asphalt's share of the mirror (`wetMirror`) and the reflections in cars and windows. The puddles keep the planar mirror, which wins on its plane. `NIGHT_LOOK.ssr` holds the settings that both engines will take.

The owner approved the look on 11 October 2026, after a third round that fixed the facade shader on three.js's WebGLRenderer, which had failed to build. The owner allowed five last changes:

- **three.js's walls on WebGL.** The facade shader now builds there, so WebGLRenderer draws the walls and the shops' neon as the other paths do.
- **The moon.** The street camera looks up a little more, so the whole moon and its halo show in the street shot.
- **The near asphalt.** Its bump is half as deep, so the street close to the camera looks smoother.
- **The low sky.** The haze is a deeper blue and the city's glow is fainter and lower, so the low sky no longer turns brown. The cloud layer squashes less toward the horizon, so the clouds keep their shapes lower down, and their low undersides catch a grey light.
- **The blade signs.** Their tubes are dimmer.

### A three.js fault: CSM on WebGLRenderer

On WebGLRenderer, Night town's street looked dull and dark with shadows on, and fine with them off. The roofs had no shine either. Debug output showed that the street's lights still reached it, but gave no highlights. The cause is three.js 0.186.1's CSM add-on. It puts its own copy of the chunk that starts the lighting in place of three.js's. That copy predates the standard material's energy terms (`material.dfg` and `multiScatteringCompensation`). Every direct light's highlight and the environment's reflection multiply by them, so they stay zero. The three.js worker now puts three.js's own setup lines back in front of CSM's lights, for every comparison that casts its sun's or moon's shadows with CSM on WebGLRenderer: Night town and Battle. three.js's WebGPU path and null3D did not have the fault.

This fix keeps the comparison fair. Without it, three.js's WebGL frames would look worse because of a three.js bug, not because of a weaker technique. The fix changes no lighting math, and it adds no work to a frame. The fault is a three.js bug to report upstream. The report should name `examples/jsm/csm/CSMShader.js`, whose `lights_fragment_begin` lacks the `#ifdef STANDARD` block of the current chunk. The fix in `examples/lib/three-worker.ts` (`withCsmLightFix`) shows the missing lines. When three.js fixes the add-on, remove the fix and check the WebGL frames again.

### Night town's figures on the Mac

To follow. Night town's and Busy page's timing runs measure the build with the job worker fix below, and they wait for a quiet Mac.

### Browser faults met while timing

These faults came up in the timing runs of 12 and 13 October 2026, on the owner's MacBook Pro (Apple M5 Max). The timing scripts open the Mac's installed Chrome, as people run it ([Examples](../examples.md#the-ramp)).

- **Chrome 155, three.js's WebGLRenderer, 60 lights.** Night town on three.js 0.186.1 drew no frame at 60 lights, its ramp's first count, and drew at 72. A page that held 60 lights from its start failed too, so the ramp's change of count is not the cause. Each try logged "THREE.WebGLProgram: Shader Error 0 - VALIDATE_STATUS false" for a `MeshNormalMaterial`, with an empty program log. The error number was 1282 where the light-limit search ran first. Playwright's Chromium 153 drew 60 lights with no error. The ramp now steps past one count that draws no frame, when the next count draws, and the page names that count as a fault of the browser. The owner decides whether to report it upstream.
- **Chromium 153, three.js's WebGPURenderer.** Its shader compiler failed to build `renderPipeline_RTT_57`, one of three.js's render-to-texture pipelines for Night town: "An error occurred while generating Tint IR. error: swizzle view instruction still has usages after lowering". Chrome 155 built it.
- **Chromium 153, null3D on WebGL2.** Night town at 300 lights or more took about 90 s to its first frame. Chrome 155 took 1 to 2 s.

### An engine fault: the page's memory measurement and job workers

In the same timing runs, Night town's pages at 1,020 lights started 2 to 16 job workers. Each of them took about 120 s longer than the pages without job workers, or stopped answering. Chrome's measurement of the page's memory answers only after every worker of the page has run it. An idle job worker blocks in the job loop, so it never does. With the measurement taken out of the page, the same pages answered in 3 s. The engine now lets its job workers run the measurement ([Measuring the page's memory](../implementation-notes.md#measuring-the-pages-memory), hard rule 24 in `AGENTS.md`).

- `tests/image/memory-measurement.spec.ts` starts 3 job workers with a busy scene. On the build with the fix, the measurement answered and its test ended in 19 s. The open stats overlay showed the page's memory in a test of 18 s. On the build before the fix, the measurement gave no answer in 40 s, and the overlay still said "measuring" after 30 s.
- The fix adds no work while no measurement runs. Night town at 1,020 lights ran twice on the build before the fix and twice on the build after it, in turn. Both builds ran with the measurement taken out. The table gives the busiest thread's time per frame in the second round, at a Mac load under 8. There, each pair started the same count of job workers. Every page drew 120 frames a second.

| Path and mode | Job workers | Before the fix | After the fix |
| --- | --- | --- | --- |
| WebGL2, scene graph | 2 | 1.19 ms | 1.25 ms |
| WebGL2, instanced | 16 | 1.30 ms | 1.33 ms |
| WebGPU, scene graph | 0 | 1.24 ms | 1.10 ms |
| WebGPU, instanced | 0 | 1.27 ms | 1.15 ms |

The WebGPU pages started no job workers, so the fix has no part in them, and their changes show the spread from run to run. The WebGL2 changes are smaller than that spread.

### Image tests

three.js builds its shaders again for each count of lights, and takes a long time at large counts. Each figure is the time from opening the page to the held frame, on a quiet Mac:

| Path | 300 lights | 96 lights | 48 lights |
| --- | --- | --- | --- |
| three.js WebGPURenderer, Mac GPU | 95 s | 35 s | 21 s |
| three.js WebGLRenderer, Mac GPU | 6 s | 6 s | 3 s |
| three.js WebGPURenderer, SwiftShader | over 180 s | 93 s | 40 s |
| three.js WebGLRenderer, SwiftShader | not measured | 51 s | 20 s |
| null3D, both paths, SwiftShader | 10 s | 10 s | 9 s |

The first tests held 300 lights, 25 blocks, and 48 lights on SwiftShader. On 11 October 2026, with the Mac's load near 20, WebGPURenderer gave no frame within 180 s at 300 lights on the Mac's GPU, and none at 48 lights on SwiftShader in one of four tests. So the tests now hold 96 lights, 8 blocks, and 24 lights, 2 blocks, on SwiftShader, in both engines' tests. They wait up to 180 s. The SwiftShader references show that smaller town.

On 13 October 2026, CI's first run of the landed tests failed every Night town and Busy page test on SwiftShader, and some in Firefox and Safari. The shaders' sine hashes drew other ripples, clouds and stars on other machines, so the shaders now use the integer hash. Firefox on Linux filters the facades' textures another way, so it keeps references of its own. [Image tests](../image-tests.md#ci) gives the figures.

### The test page's 404

The first runs logged one "404 (Not Found)" on the first page of each browser. The comparison test page named no icon, so the browser asked the server for `/favicon.ico`. The page now names an empty icon, as the examples page does. The fault was in every comparison's test page, Battle's too.

## Addendum, 14 October 2026

The owner decided on 14 October 2026 to remove the Busy page comparison. It measured the page's long tasks and input delay beside a scene, which was its reason to exist. The engine's own test pages already cover that work now. It also drew Night town's scene, which Night town's own comparison draws. So it added no figure and no look that the other comparisons do not give. The history above stays as it was written. The comparison, its tests and its page are gone from the repository.

## Battle

Built 2026-10-11, task M2-EX6. Battle is the second comparison, and the comparison of ready-made assets. Two armies of animated soldiers and mechs, with tanks behind each line, meet on a cratered field at dusk. Its mechanism is S5's: three.js pays per animated character on one thread. The count is the soldiers and mechs of both armies.

### The models

- Both engines load the same two files from the [sample content](../sample-content.md). The soldier is Quaternius's CC0 Character Soldier. The sample-assets repository keeps the source as published, and its script `scripts/battle-soldier.ts` builds `characters/battle-soldier` from it. The body's parts, head and shoulder pads become one skinned mesh with vertex colors. The AK stays a mesh of its own under the right hand's joint, and the other 13 weapons go. The four clips that the battle plays stay, as idle, run, shoot and die.
- The rifle stays in the file, because null3D attaches a rigid mesh to a joint only from the file: its joints are not objects. three.js's `SkeletonUtils.clone` keeps the mesh under the bone. So the weapon follows the hand the same way in both engines.
- The mech is Quaternius's CC0 George, as the old repository converted it: one skinned mesh of 3,000 triangles with four clips. The old repository's source links on Google Drive refused downloads on 11 October 2026 (quota exceeded), and no other copy of George was found. The sample-assets entry `characters/quaternius-mech` records the conversion and the source file's SHA-256.
- A search on 11 October 2026 found no CC0 soldier or mech that is more realistic and ready to use. Quaternius's Universal Base Characters have human proportions and a CC0 animation library, but no helmet, rifle or uniform. The CC0 soldiers on OpenGameArt have rigs and no clips. The one more detailed CC0 mech, Colorado Stark's on OpenGameArt, has no clips. So Battle keeps the two Quaternius models.
- The soldier keeps the source's detail: 5,828 triangles for the body and 1,122 for the rifle, about three times the old repository's simplified soldier. A comparison of ready-made assets draws them as made.
- The skinned body's node in the source has a scale and a turn. The glTF rules ignore a skinned mesh's node transform, and three.js's loader applies it. The script bakes it into the vertices and into the inverse bind matrices, and puts the node at the origin. So both readings draw the same model. Baking it into the vertices alone drew each soldier 58 times too large and bent out of shape.

### How each engine builds it

- **Scene graph**, the default. null3D makes each unit a copy of its model with `scene.instantiate`. The copy is a group with the skinned body and the rifle, and an animator that runs on the job workers. When the battle changes a unit's clip, the sketch cross-fades to it. three.js makes each unit a `SkeletonUtils.clone` with its own `AnimationMixer`, as its animation examples build characters. Each frame, the unit's two clips in play take their times and weights from the shared simulation. Then `mixer.update(0)` blends them into the bones. That is the work of `mixer.update(delta)` with a cross-fade, and a held frame shows the state's exact pose. Each tank is a tree of three objects in both engines: the hull, the turret on it and the barrel on the turret.
- **Instanced.** three.js takes the route of its crowd example (`webgpu_skinning_instancing_individual`). One mixer per model poses each unit in turn, and one draw per model skins every unit from a table of bone matrices. The example's compute pass stores each copy's skinned vertices, which would take gigabytes at 20,000 soldiers. So the skinning runs as the units draw, as the old repository did. The rifles are an `InstancedMesh`, each placed by its hand's joint. The route needs WebGPURenderer. The comparison's entry names it for the mode. So on the WebGL2 path, three.js runs WebGPURenderer in its WebGL2 mode, with the tables in float textures. null3D has one way to draw animated characters: an object per character, which it already draws in batches. So it builds the units as in the scene graph mode. Each tank part is one batch of copies in both engines, posed in closed form.
- Tracers, shells and particles are batches in both modes, as games draw effects.
- null3D's joints are not objects, so neither engine turns the torso toward its aim, as the old repository's three.js poser did. Each unit turns its whole body toward its target. A switch in the scene's description (`AIM_WITH_WHOLE_BODY`) keeps the body's heading instead, for when joint overrides (task M2-EX24) turn the spine.

### The look

The owner raised the bar on 11 October 2026: every comparison meets the look bar of the feature demos and showcases ([Examples](../examples.md#the-look)). The owner approved Battle's look the same evening, from frames of both engines at 21 seconds and a wide shot at 85 seconds. Battle's look is made from features that both engines have today, each by its own technique:

| Part | null3D | three.js |
| --- | --- | --- |
| Sky | The generated sky, with clouds, as the background | `Sky` on WebGLRenderer, `SkyMesh` on WebGPURenderer |
| Light from the sky | `assets.skyEnvironment()`, which leaves out the sun's disc | `PMREMGenerator.fromScene` of a sky without the sun's disc |
| Sun shadows | The directional light's 3 cascades over 320 m | The CSM add-on, or the CSM shadow node, with the same reach |
| Fog | Height fog with a glow toward the sun | The same formula in GLSL chunks or a fog node, with the glow |
| Ground | A surface function that mixes five layers made in code: grass, earth, wet mud, scorched earth and rock. Each layer has a color map and a normal map. The terrain's vertex colors give the shares of grass, mud and scorch, and how dry the grass is. Rock shows on steep and high ground. Each layer shows through the one over it where its heights rise higher | The same mix in GLSL added to `MeshStandardMaterial`, or in a node material, from the same textures |
| Rocks, ruins, tank paint, bark | Surfaces made in code (`rock`, `masonry`, `camo`, `bark`) | The same textures |
| Scenery | Rough hills with meadow and bare stone, 1,400 pines in clumps, broadleaf and dead trees, rubble on the crater rims, ruins, tank traps and grass, all from the shared description. The trees follow the Creek's: a trunk in bark under cards of needles or leaves, which their textures cut out with a mask | The same meshes, places and textures, cut out with `alphaTest` |
| Soldiers, mechs and rifles | A surface function on each army's material reads each vertex color's surface class, which the sample files carry in alpha, and texture coordinates projected along each vertex's main axis. Cloth shows a woven texture made in code, with its normal map and worn patches. Helmets and the mech's armor are painted steel that chips to bare metal, and the armor shows panels with seams. Metal's roughness varies. Mud climbs the legs, and soot darkens patches above it. The mech's vents glow. The palette is darker and less saturated than the models' colors, and a soft rim of the dusk sky's light outlines each unit | The same in GLSL added to `MeshStandardMaterial`, or in node materials, which the crowd's own material takes too |
| Tanks | One detailed model made in code: armor with bevelled edges, bolted plates on the glacis and the turret's cheeks, access panels, turned road wheels with tyres and hubs, a toothed drive sprocket, track links with grousers and guide horns, skirts in bolted panels, a cupola with vision blocks, smoke dischargers and a muzzle brake | The same mesh |
| Tracers | Two thin crossed strips that narrow and fade toward the tail, glowing and added to what lies behind | The same mesh, with additive blending |
| Grass and flags in the wind, embers on wrecks | WGSL vertex offsets and a surface function | GLSL added to `MeshStandardMaterial`, or node materials |
| Smoke, fire, sparks, muzzle flashes | Sprite batches, from the shared rows of `examples/lib/particles.ts` | An instanced quad that faces the camera, from the same rows |
| Light of each blast and fire | A pool of 6 point lights for the newest blasts, and one light for each of the 7 fires on wrecks and in craters | The same lights |
| Bloom, ambient occlusion, curve, grade | null3D's chain, AO, AgX and grading table | As for Factory |

- Each sprite atlas keeps its frames as an upright image, top row first. null3D reads it that way. A three.js `DataTexture` without a flip puts the top row at v = 0. So the three.js sprite shader turns each frame's v around, to draw it upright too.
- three.js draws a layer's sprites in one draw, unsorted. null3D sorts blended sprites from back to front. Smoke is soft enough that the order shows little.
- The particles add-on (D-131) will take the null3D side of each layer. The scene's rows and the three.js side stay.
- The sky's clouds are a broken deck of heavy cloud, low and large, which the dusk light leaves dark.
- The sky's clouds stand still in both engines. Moving clouds would refresh null3D's sky light every frame, and three.js's PMREM pass would need to run again.

### Battle's figures on the Mac

**Invalid above 1,024 units (13 October 2026, task M2-R36).** Every null3D figure in this section above 1,024 units measured a scene that stood still. The engine's animation table held at most 1,024 animated objects. At about 1,030 units, Battle's next soldier failed with E1102 in the sketch's update. From then on the update threw in every frame before it moved the soldiers, the bullets and the camera. The engine logged the error once and kept presenting frames, so the ramp and the fixed counts measured 1,024 soldiers frozen in place. The null3D "held" counts of 3,698 and 7,668, and the null3D columns at 4,000 and 10,000 units, are void. The figures at 1,000 units stand. The owner found the fault by eye on 13 October 2026. The true figures follow M2-R36's fix.

The runs are from 12 October 2026, measured as for Factory, on the approved look. Each count had room for that count only. The ramps had room for 40,000 units and started at 200. The [run's record](../tested-devices/macbook-pro-chrome/20261012-002614-battle-modes.md) has each figure.

| Mode | Engine and path | Held | 1,000 units | 4,000 | 10,000 | Page memory at 4,000 |
| --- | --- | --- | --- | --- | --- | --- |
| Scene graph | null3D, WebGPU, High | 3,698 | 64.6 fps | 42.4 fps | 58.2 fps | 516 MiB |
| Scene graph | null3D, WebGL2, Medium | 200 | 55.8 fps | 30.0 fps | 26.8 fps | 341 MiB |
| Scene graph | three.js, WebGLRenderer | 0 | 8.0 fps | 1.9 fps | 1.0 fps | 435 MiB |
| Scene graph | three.js, WebGPURenderer | 0 | 7.5 fps | 1.7 fps | 0.7 fps | 630 MiB |
| Instanced | null3D, WebGPU, High | 7,668 | 64.7 fps | 53.1 fps | 35.8 fps | 560 MiB |
| Instanced | null3D, WebGL2, Medium | 0 | 54.6 fps | 26.9 fps | 25.8 fps | 341 MiB |
| Instanced | three.js, WebGPURenderer | 240 | 87.5 fps | 29.3 fps | 11.1 fps | 58 MiB |

- In the scene graph mode, null3D drew 7 to 58 times the frames of three.js's faster renderer. three.js spent 95% of its frame in its render calls: each soldier is a skinned mesh that it poses and draws on its own.
- In the instanced mode, three.js drew more frames at 1,000 units, and null3D more from 4,000 up. three.js's frame time grows with the count, as its one thread poses every unit.
- null3D's GPU sets its rate. At 1,000 units its busiest thread took 3.5 ms a frame, yet it drew 65 frames a second. The two ramps of the same null3D scene held 3,698 and 7,668 units, as a GPU-bound rate wanders.
- null3D's page took 6 to 10 times three.js's memory in the instanced mode.

### Image tests and memory

- Hold mode draws every frame up to the held one. On SwiftShader, CI's software GPU, Battle's held frame at 600 units took 17 to 72 seconds a test. So the SwiftShader references hold 120 units (`swiftShaderHoldCount`), and the Mac's hold 600.
- With the approved look, the three.js tests still took 22 to 58 seconds each at 120 units. That was on SwiftShader on the Mac, one test at a time. The null3D tests took 25 to 33 seconds, six tests at once. Factory's tests took 2.2 to 3.5 times as long in CI as on the Mac. So Battle's image tests may take 240 seconds (`holdTimeoutSeconds`), not the default 90.
- The page's memory at 400 soldiers was 304 MB in null3D, with the effects off, and the browser's whole use 425 MB. Factory took 50 MB at 400 parts. The memory task looks into what takes it.

### Battle's GPU cost and memory, 12 October 2026

Task M2-EX41 looked into why null3D's page took 6 to 10 times three.js's memory in the instanced mode, and where its GPU time went.

The memory:

- Most of it was not real memory. Chrome's page figure (`performance.measureUserAgentSpecificMemory`) counts each `SharedArrayBuffer` object of a shared memory at its full length. The engine's memory grows in many steps while a sketch sets up, and each growth gives `memory.buffer` a new object. Parts of the scene that the sketch set up once and then left alone kept views made at older sizes: static instance batches and the setting blocks of the sky, the environment and the effects. A heap snapshot of the sketch worker found 11 such objects on one 63 MiB memory. Chrome charged the worker 420 MiB, while its own heap was 22 MiB. A real-RAM run at 400 units with the effects off had already measured the page's renderer process at 196 MiB, against three.js's 201 MiB.
- So every view of the engine's memory now comes from one place, and every object that keeps views drops them when the memory grows. A static check and a browser test keep it so ([Views of the shared memory](../implementation-notes.md#views-of-the-shared-memory), hard rule 20).
- The thread that draws held both GPU paths' text of every custom material. It now gets its own path's text only, and the sketch's module builds only that path's text. At 1,000 units, the render worker's strings fell from 34.1 to 8.8 MiB, and its heap from 36.2 to 10.5 MiB. The sketch worker's strings fell from 15.7 to 10.0 MiB.

The GPU time:

- At 1,000 units on WebGPU, null3D drew 10,214 draws a frame: about 2,100 in the camera's view, 2,000 in the depth prepass and 6,000 in the 3 cascades. Each skinned unit drew from a bucket of its own. WebGL2 drew the same scene in 289 draws. Skinned copies of one mesh and material now share an instanced draw on WebGPU too, custom materials included ([D-20](D-20-webgpu-skinning.md#addendum-2026-10-12-shared-buckets-and-custom-materials-skin-builds-on-first-use)).

The figures, before and after, on the Mac's Chrome 155 with WebGPU at High, on 13 October 2026:

- "Before" is main of 12 October 2026 (`16a710a2f`). Main's only engine change since then lets game code turn joints, which Battle does not use.
- Each page ran in a production build in a visible window, for 10 seconds after 4 seconds of warm-up. Each count ran twice, before and after in turn, and once more with the memory figure. Two "before" pages ended at a load just over 8 and are left out. The table gives the range of the other runs.
- The ramps wait for the fix to the ramp's reading of the display rate, from task M2-EX7. Without it, a ramp can report a held count that it never held.
- The 4,000-unit pages held only 1,024 soldiers, and their scene stood still. The engine's table of animated objects held at most 1,024 objects, so each frame stopped at the first unit past it, before the units, the bullets and the camera moved (found on 13 October 2026, task M2-R36). Those rows compare the two builds on the same still scene of 1,024 soldiers. They do not give null3D's cost at 4,000 units.

| Mode | Units | Draws a frame | Frames a second | Busiest CPU thread | GPU frame time |
| --- | --- | --- | --- | --- | --- |
| Instanced | 1,000 | 10,214 → 333 | 68 → 79 to 90 | 3.0 → 1.8 to 2.5 ms | 16.8 → 13.9 to 16.7 ms |
| Instanced | 4,000 (1,024 held, still) | 10,464 → 343 | 55 to 61 → 68 to 91 | 9.3 to 13.9 → 5.7 to 9.6 ms | 13.2 to 14.9 → 9.7 to 13.7 ms |
| Scene graph | 1,000 | 10,214 → 333 | 61 to 68 → 91 to 94 | 2.9 to 4.4 → 1.7 to 2.9 ms | 12.6 to 17.1 → 12.0 to 13.2 ms |
| Scene graph | 4,000 (1,024 held, still) | 10,464 → 343 | 60 to 63 → 89 to 90 | 8.6 to 10.7 → 5.8 to 6.2 ms | 12.7 to 13.9 → 13.3 to 13.6 ms |

| Memory at the 4,000-unit pages (1,024 soldiers, still) | Instanced | Scene graph |
| --- | --- | --- |
| Page, the shared memory counted once | 525 → 115 MiB | 567 → 115 MiB |
| The browser's whole figure | 669 → 252 MiB | 710 → 252 MiB |
| Sketch worker | 479 → 94 MiB | 521 → 94 MiB |
| Render worker | 112 → 84 MiB | 112 → 84 MiB |

- The page's memory fell to a fifth. three.js's instanced page took 58 MiB at 4,000 units in the run of 12 October. null3D's page held only 1,024 soldiers, so the two figures do not compare.
- The draws fell by 97%, and the CPU time by about 40% on the 4,000-unit pages. The sketch worker no longer lays out a bucket for each unit.
- The GPU's frame time did not change. It varied from 9.7 to 17.1 ms from page to page in both builds. Its largest render pass took 6.8 to 9.6 ms in both. The frame's compute work fell from 1.4 to 1.6 ms to 0.1 ms, as the vertex shaders now skin Battle's custom materials. So on the Mac, the draw count was not what bound Battle's GPU time. Its largest pass is, and the next step is to find what that pass spends its time on.
- On the 4,000-unit pages, null3D now draws about 89 frames a second in both modes, against about 60 before. There the busiest CPU thread had set the rate. The rate rose at 1,000 units too, though the GPU's frame time did not fall. Apple's GPUs work on two frames at once, so a frame time from GPU timestamps does not bound the rate ([Frames in flight](../implementation-notes.md#frames-in-flight)).

## Addendum, 18 October 2026: three.js's renderer follows the GPU path

The owner's bar for M2-R34 compares the engines on the same GPU path. So a WebGPU query must put three.js on WebGPURenderer, and a WebGL2 query on WebGLRenderer. The comparisons now choose the renderer this way. `?renderer=webgl` still puts the WebGPU path on WebGLRenderer, to compare the two three.js renderers.

This replaces decision 9. On 10 October 2026 WebGLRenderer used a quarter of WebGPURenderer's CPU time per frame on Factory in Chrome on the Mac. That made it the fair default for a headline about each engine's fastest build. It stopped being fair once the question became whether null3D's WebGPU path beats three.js's WebGPU path. A WebGLRenderer figure answers another question. [D-174](D-174-apple-gpu-direct-draws.md) holds the new figures.
