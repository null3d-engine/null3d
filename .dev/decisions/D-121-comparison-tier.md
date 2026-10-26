# D-121: The comparison tier with three.js, and Factory

Status: built, from the owner's decisions ([Examples](../examples.md#the-owners-decisions-on-the-examples)). Each comparison builds its scene as a scene graph in both engines, by the owner's decision (M2-R34). Task: M2-EX5. Factory does not go on the page until a device sitting shows that null3D holds the higher count on every device class. Battle's null3D figures above 1,024 units wait for runs after M2-R36's fix.

Summary: The comparisons with three.js live in `examples/compare/`, one folder per scene, with one shared description that both engines draw. A shell in `examples/lib/` starts either engine on a canvas with the same settings, sets the count, measures and runs the ramp, so the website can draw its own controls. `@null3d/engine/stats` exports the overlay's panel, so the three.js half shows its figures in the engine's own card. Factory is the first comparison. Each comparison builds its scene one way, the same way in both engines: a scene graph of one object per part. three.js draws on the renderer of the GPU path that the page tests.

## Question

The `demos-vs-threejs` repository compares the engines in an app of its own. By the owner's decision, the comparisons live in `examples/` instead. How do they run there, so that the clone's page and the website both show them, both engines draw the same scene by the same rules, and the headline figure is fair?

## Rule

- One description per scene, with no engine imports, which both engines run: the seed, the layout, the fixed-step simulation, the meshes, the surfaces, the lights and the camera path.
- The fairness rules of [Examples](../examples.md#fairness-rules): the same pixel ratio and MSAA, null3D's governor off with a fixed preset, three.js on the renderer of the GPU path in one worker, one engine at a time, one memory definition.
- Each engine draws each effect with its own best technique for the same intent ([D-52](D-52-intent-parity.md)), and each effect is a switch.
- The headline figure is the largest count that each engine holds at the display rate on the viewer's device.

## How both engines build the scene

Each comparison builds its scene the same way in both engines, the way each engine's own users build it. In Factory, each arm is a tree of one object per part, as each engine's own examples build jointed models. The code writes each joint that moved, and each engine works out the world transforms of the trees and draws the parts its own way.

- Each engine holds only the objects of the cells that show. null3D makes cells as the count rises, and destroys them as it falls. Hidden objects cost null3D work in every frame when they are dynamic, so making room for the ramp's top would charge null3D for parts that never draw. The joints that turn in most frames are dynamic objects. The fingers, which move only at a grip, and the crates, which stand still on the pallet and wait on the belt, are static objects ([Static and dynamic objects](../../docs/concepts/static-dynamic.md)).
- three.js turns off `matrixAutoUpdate` on every node and calls `updateMatrix` after a write, as its docs advise for objects that do not move in every frame. Its renderer's walk of the scene graph works out the world matrices, and it draws each part on its own. A held crate hangs under the wrist, since reparenting is cheap in three.js.
- Figures come from production builds only. The development server keeps the engine's development checks in every setter, which three.js does not have.

## Decision

1. **Files.** `examples/compare/<name>/` holds `scene.ts`, `sketch.ts` (null3D) and `three.ts` (three.js 0.186.1 in a worker). `examples/compare/comparisons.ts` lists them, with literal addresses of the sketch and the worker, so a production build ships both. `examples/lib/compare-scene.ts` holds what every scene shares: the fixed-step clock, rotations, camera loops, meshes as arrays with texture coordinates in meters, textures made in code and the grading table. The measuring tools of the `demos-vs-threejs` repository are not part of it: `bench/` and `tests/real-browsers.ts` do that work here.
2. **The shell.** `startComparison({ canvas, comparison, engine })` starts one engine and returns `setCount`, `measure`, `collapseStats` and `destroy`. `rampComparison(run)` runs the ramp. The clone's page (`examples/compare-page.ts`) is one layout over them: an engine switch, a count slider, effect switches, "Run the ramp" and an "about this comparison" panel. Each engine runs on a page of its own, as each demo does, so the switch and the ramp load the page again. A page that swapped engines in place would hold two engines' memories on an iPad ([Examples](../examples.md#each-pick-is-a-new-page)).
3. **The ramp.** Each step sets the count, settles for half a second and measures a second of presented frames. A step holds at 95% of the display rate or more. The ramp stops after two missed steps in a row, or at its maximum. A ramp that grows the count once a second on the wall clock, and stops after three misses past 20 seconds, lines up recordings of both engines. A comparison on one device needs no such alignment, and the shorter rule finishes sooner.
4. **The three.js half.** Each arm is a tree of `Object3D` nodes, one `Mesh` per part, and a held crate hangs under the wrist. Its worker (`examples/lib/three-worker.ts`) draws the effects with three.js's own techniques. On WebGLRenderer, these are `EffectComposer` with `GTAOPass`, `UnrealBloomPass`, `OutputPass` (AgX) and `LUTPass`. On WebGPURenderer, they are the GTAO node, the bloom node, the output transform and the 3D LUT node. The room environment comes from `RoomEnvironment` through `PMREMGenerator`. three.js has no height fog, so the worker gives it null3D's fog formula: GLSL in place of `FogExp2`'s chunks, and a fog node.
5. **The null3D half.** Each arm is a tree of scene objects: the base stands still, and six parts move under their parents. The sketch writes each joint that changed, and the engine works out the world transforms on its job workers. The still parts and the crates hang under the base. A held crate follows the wrist. After the engine moves the trees, `onLateUpdate` reads the wrist's world transform and places the crate in the same frame. Reparenting the crate at each grip would rebuild the draw tables several times a second.
6. **Making the cells.** The engine queues at most 65,536 structural changes between two frames ([Scene](../../docs/api/scene.md)). Making 5,000 cells at once, 75,000 objects, fails with E1102. Each object takes about four changes, so the sketch makes or destroys 250 cells in each frame until the scene holds the cells that show.
7. **The stats panel.** The engine's overlay builds its header and card through `StatsPanel`, which `@null3d/engine/stats` exports. `examples/lib/stats-three.ts` fills one with three.js's figures: the worker's frame time split into the scene's code and the render calls, `renderer.info` draws and triangles, instances counted per draw, GPU time from WebGL2's timer queries or WebGPURenderer's timestamps where the page starts with the panel open, and the page's heap and whole-page memory with the overlay's calls. three.js reports no GPU bytes, so those parts stay out of the card. A frame mode, `'one-thread'`, explains a renderer that prepares and draws each frame on one thread. The panel's class and the mode's words add 227 bytes after Brotli (3.6%) to the overlay's file, which loads at its first showing. The file then takes 6,602 bytes, 40% of the 16 KB budget of a file that loads on first use. The engine's start files do not change.
8. **Factory's scale.** The ramps top out at 50,000 moving parts on desktops, 30,000 on tablets and 20,000 on phones, where three.js's per-object work is expected to show. Each row waits for a device sitting. For the Mac's timing, the page's `?max=` switch raises the desktop maximum to 200,000, since null3D holds the default maximum in every run.
9. **three.js's renderer.** The comparisons compare the engines on the same GPU path, by the owner's bar for M2-R34. So a WebGPU query puts three.js on WebGPURenderer, and a WebGL2 query on WebGLRenderer. `?renderer=webgl` puts the WebGPU path on WebGLRenderer, to compare the two three.js renderers. [D-174](D-174-apple-gpu-direct-draws.md) holds the figures.

## Options rejected

- **Batches of copies, a second mode.** Each part kind as one batch of copies, null3D's instance batches against three.js's `InstancedMesh`, posed by one closed-form loop. The owner rejected it (M2-R34): each engine builds the scene the way its own users build it, one object per part in a tree. Batches exist for scenes of many copies of a few meshes, and the comparisons are not that scene. On an iPhone 18 Pro with WebGPU, from 200 to 1,000 units, null3D led three.js on the scene graph route at every count. It drew 35.2 against 32.7 frames a second at 200 units, 30.2 against 14.3 at 500, and 24.8 against 7.3 at 1,000. three.js led only on its batched route, at 63 and 49.8 frames a second at 100 and 500 units, in 49 to 63 draws against the scene graph's 163 to 298. The batched route also hides the cost of null3D's shadow cascades, about 1.1 ms and about 45 draws each.
- **A null3D tree against three.js's batches.** It measures two different programs. Its run ([record](../tested-devices/macbook-pro-chrome/20261009-125644-factory-ramp.md)) also made room in null3D for the ramp's top at every count, and ran on the development server at 60 frames a second. Every engine held the ramp's top of 50,000 there.
- **One page that swaps engines in place.** Safari reserves address space for each engine's memory, and frees a dropped memory late.
- **An effect only where both engines draw it pixel for pixel**, the rule of the `demos-vs-threejs` repository. The owner chose intent parity and a review of both engines' held frames instead.
- **WebGLRenderer on every GPU path.** In Chrome on the Mac, WebGLRenderer uses a quarter of WebGPURenderer's CPU time per frame on Factory. That makes it the fair default for a headline about each engine's fastest build. But the question is whether null3D's WebGPU path beats three.js's WebGPU path, and a WebGLRenderer figure answers another question.
- **A Busy page comparison**: Night town's scene beside a page that keeps its own thread busy, to measure that thread's long tasks and input delay. The owner rejected it. The engine's own test pages cover that work, and Night town's own comparison draws the scene, so it adds no figure and no look.

## The look match

The setups mean the same in both engines, and each engine keeps its own technique where the techniques differ. Without that, three.js's held frames show a brighter floor and a shimmer.

- **Bloom.** Each engine spreads bloom's light in its own steps, so one strength makes different glows. The port skill's mapping (`skills/null3d-port-threejs/scripts/map-bloom.mjs`) puts UnrealBloomPass at strength 0.35 equal to null3D's intensity 3.07, and the bloom node at 0.35 equal to 1.02. With one strength for all three, null3D draws about a ninth of WebGLRenderer's glow and a third of WebGPURenderer's. So the look sets bloom once, as UnrealBloomPass's settings. The bloom node takes three times the strength. null3D takes the mapped intensity, knee and level weights for a canvas 720 pixels high, the ramps' size. On a larger canvas, null3D's glow looks a little wider, because it keeps its share of the screen.
- **Ambient occlusion and MSAA on WebGPURenderer.** The GTAO node cannot read a multisampled depth buffer. A scene pass that drops MSAA for it makes edges shimmer as the camera moves. So a depth and normal pass of its own, without MSAA, feeds the GTAO node, and the denoise node smooths the result. It darkens only the ambient light inside the scene pass, which keeps 4x MSAA. three.js's own ambient occlusion example builds it this way. GTAOPass on WebGLRenderer draws such a pass too.
- **A technique difference that stays.** null3D and the GTAO node darken only the ambient light, as ambient occlusion means. GTAOPass darkens the whole image, so WebGLRenderer looks a little darker where parts meet. The page's notes say so.
- **The test page.** The comparison's test page passes the effect switches, so a held frame can show one effect alone.

Held frames at 640 x 360, scene graph mode, in Chrome on the Mac's GPU. The figure is the mean brightness (0 to 255, sRGB) of the lower 45% of the frame, mostly the floor:

| Effects | null3D WebGPU | null3D WebGL2 | three.js WebGLRenderer | three.js WebGPURenderer |
| --- | --- | --- | --- | --- |
| None | 97.9 | 98.1 | 95.3 | 95.4 |
| Bloom alone, one strength for all | 100.1 | 100.4 | 116.0 | 104.0 |
| Bloom alone, mapped | 117.0 | 117.4 | 116.0 | 116.2 |
| All, one strength for all | 88.3 | 88.5 | 101.3 | 93.3 |
| All, mapped | 103.5 | 103.2 | 101.3 | 102.9 |

- Shadows, fog and the grade each moved the engines' floors by the same amount, within 1 step. Ambient occlusion darkened null3D's floor by 3.3 steps and three.js's by 1.0 to 1.6. With no effects, null3D's floor is about 3 steps brighter, under 3%. This run did not trace that small gap.
- A measure of fine detail, the mean step between neighboring pixels, shows the MSAA. With ambient occlusion alone, WebGPURenderer's frame measured 5.48 with a scene pass without MSAA, and 5.07 with the pass of its own, against 5.06 for WebGLRenderer.

## Figures on the Mac

All runs are in Chrome 155 on the owner's Mac (Apple M5 Max).

### How the runs were measured

- A production build of the comparison page, served by `vite preview`. The development server keeps the engine's development checks in every setter, which three.js does not have.
- A Chrome window that Playwright opened on the Mac's built-in display, which presented 120 frames a second. The canvas was 1280 x 720 CSS pixels at pixel ratio 1, with 4x MSAA and every effect on.
- The page's fairness rules: null3D's governor off with a fixed preset, High on WebGPU and Medium on WebGL2, and three.js 0.186.1 in one worker. One engine ran at a time, each on a page of its own.
- Each run started only while the Mac's 1-minute load was below 8. The loads at the pages' ends were 2.2 to 5.4.
- The ramp made room for 200,000 moving parts, warmed up for 10 seconds, then grew from 2,000 by a fifth at each step. A step held at 114 frames a second or more, 95% of the display's rate.
- A fixed count warmed up for 4 seconds and measured 10. The busiest thread is the thread with the most CPU time per frame. In null3D, that was the sketch worker in every run. three.js prepares and draws each frame on its one worker.
- Memory is the browser's measurement of the whole page and its workers, with null3D's shared memory counted once. It holds no GPU memory.

The [run's record](../tested-devices/macbook-pro-chrome/20261010-092218-factory-modes.md) has each step.

### Factory's figures

| Engine and path | Held (of 200,000) | Busiest thread at 10,000 | At 20,000 | At 50,000 | Page memory at 50,000 |
| --- | --- | --- | --- | --- | --- |
| null3D, WebGPU, High | 110,412 | 0.97 ms | 1.62 ms | 3.04 ms | 240 MiB |
| null3D, WebGL2, Medium | 132,495 | 1.29 ms | 1.90 ms | 2.90 ms | 257 MiB |
| three.js, WebGLRenderer | 4,977 | 15.5 ms (64 fps) | 34.6 ms (29 fps) | 112 ms (9 fps) | 108 MiB |
| three.js, WebGPURenderer | 0 | 81 ms (12 fps) | 158 ms (6 fps) | 381 ms (3 fps) | 489 MiB |

- null3D held 22 to 27 times the count of three.js's faster renderer. Every null3D figure in the table ran at 120 frames a second.
- three.js's time is almost all in its render calls: at 50,000 parts, 108 of its 112 ms. Its renderer walks the scene graph to work out the world matrices, and draws each part on its own. null3D works out the trees on its job workers. It draws the parts that share a mesh and a material together, in 117 draws at every count.
- WebGPURenderer held no step: at 2,000 parts it drew 50 frames a second.
- null3D's page needs more memory at small counts. At 10,000 parts, null3D's page took 134 MiB on WebGPU, and three.js's 35 MiB. A probe put null3D's floor at about 84 MiB at 2,000 parts: its WebAssembly memory, and the JavaScript of each engine worker. From 10,000 to 50,000 parts, each added object took 1.9 KB in null3D and 1.3 KB in three.js.

## Device sitting before Factory goes on the page

Factory's ramp on the Mac in Chrome (at 120 Hz) and Safari, the Galaxy S24+, a Pixel, the iPad, and a WebGL-only iPhone, each with the runs recorded in [tested devices](../tested-devices.md).

## Night town

Task M2-EX7. Night town is a rainy downtown at night. Each block brings 12 lights: four street lamps, two neon signs, and two cars, each with two headlights and a tail light. So the count is in lights. The ramps top out under 1,024 lights, the most that both engines' clustered lighting lists at once. The comparison follows the owner's look bar of [D-132](D-132-showcase-look-and-features.md).

### How each engine draws the town

- null3D lists the point and spot lights of each part of the view in clusters, on WebGPU and WebGL2. Surface functions in WGSL draw the facades with their lit windows and the wet street with its puddles and rain rings. Others draw the neon tubes that stutter. The awnings' edges ripple in a vertex function. A reflection pass mirrors the town in the puddles, with the lights that it sees in clusters of its own.
- three.js's WebGPURenderer lists point lights in clusters with its ClusteredLighting add-on, and shades every spot light in every pixel. Its WebGLRenderer shades every light in every pixel, in one shader per material. The same looks come from GLSL that `onBeforeCompile` adds, and from TSL nodes on WebGPU. CSM or CSMShadowNode casts the moon's shadows, and a Reflector or the reflector node mirrors the puddles.
- The scene writes its particles as rows of sprites, from the simulation time: four layers, for the steam, the exhaust, the glows and the rain. Battle's layers use the same rows (`examples/lib/particles.ts`). null3D draws each layer as a sprite batch, and three.js as an instanced quad that faces the camera. The particles add-on of D-132 can take null3D's side.

### three.js's light limit on WebGLRenderer

WebGLRenderer builds every light into each material's shader, and a GPU builds such a shader with only so many lights. The three.js half finds the limit when it starts. It builds a standard material with the moon's cascades and each count of blocks' lights, in a binary search. A shader that fails to build counts as too many. In Chrome on the Mac, 192 lights fit, which is 16 blocks. The town stops there, the page shows the limit, and the ramp stops at it.

### The look

The owner approved Night town's look against the look bar. The same look draws on null3D's paths and on both three.js renderers.

- **The sky.** The sky formula that both engines share is white at the horizon whatever its haze settings, since three.js's Sky follows the Preetham model. A model of the formula shows this for five settings. So the analytic sky only lights the town: it makes the environment light in both engines, and a dome hides it. The dome around the camera draws the sky that shows, as light alone, without fog, from one shader in each language: WGSL for null3D, and GLSL and TSL for three.js's two renderers. Clouds of layered noise drift overhead and reach down to the horizon. Their edges that face the moon shine silver. The cloud layer squashes little toward the horizon, so the clouds keep their shapes low down, and their low undersides catch a gray light. The moon's disc shows through thin cloud with a halo, stars show in the gaps, and a faint sodium glow lights the low air. The haze is a deep blue and the city's glow faint and low, so the low sky does not turn brown. The grade lifts the shadows toward blue.
- **The moon.** It stands at the far end of the street shot, 27.6 degrees up, which `timeOfDay(23)` gives with a heading of 0.4. The street camera looks up enough to show the whole moon and its halo.
- **The facades.** The facade maps are made in code at 512 texels a side. Bricks have uneven shades and a few dark or orange ones, in light mortar, with a course of upright bricks over each window. Concrete has panel seams, tie holes and rain stains under the windows. Plaster has grooved courses on the ground floor. Every window has a frame, with mullions and a transom, and soot gathers under the sills. The normal maps take their relief from the same heights, and the trim is a lighter stone. The facade shader builds on three.js's WebGLRenderer too, so it draws the walls and the shops' neon as the other paths do.
- **Windows and shops.** The tone curve turns a bright warm light white, so windows and shops glow weakly enough to keep their color. Shops show rows of shelves.
- **Neon.** The blade signs are 4.4 m tall, with thick tubes and large glows. Their tubes are dim, because the tone curve turns a bright light white. The facade shader draws neon over most shops: five letters of straight tubes on the fascia over the window, or a tube around the window, in one of six colors. Each shop's neon stutters like the blade signs, and some shops glow in their neon's tint. These are emissive pixels, not lights, so they leave the count of lights and the ramps alone.
- **The wet street.** The street is dark and glossy. Puddles cover 60% of the street. The asphalt between them shows the mirror at half strength. Its grain moves each pixel's sample up or down the screen, so each light leaves a broken streak, as on real wet asphalt. Both engines do this with one sample a pixel. three.js's reflector node has no second sample: a copy of the node never receives the mirror's texture. The near asphalt's bump is shallow, so the street close to the camera looks smooth.
- **Rain and steam.** Rain drops are short, and fade out as they near the camera. Steam is bright.
- **The street shot.** It comes at 33 seconds, when no car drives beside the camera, and the camera rides at about 2 m.
- **Screen-space reflections.** They are not in the comparison yet. When they join it, they take the wet asphalt's share of the mirror (`wetMirror`) and the reflections in cars and windows. The puddles keep the planar mirror, which wins on its plane. `NIGHT_LOOK.ssr` holds the settings that both engines will take.

### A three.js fault: CSM on WebGLRenderer

Without a fix, Night town's street on WebGLRenderer looks dull and dark with shadows on, and fine with them off, and the roofs have no shine. The street's lights still reach it, but give no highlights. The cause is three.js 0.186.1's CSM add-on. It puts its own copy of the chunk that starts the lighting in place of three.js's. That copy predates the standard material's energy terms (`material.dfg` and `multiScatteringCompensation`). Every direct light's highlight and the environment's reflection multiply by them, so they stay zero. The three.js worker puts three.js's own setup lines back in front of CSM's lights, for every comparison that casts its sun's or moon's shadows with CSM on WebGLRenderer: Night town and Battle. three.js's WebGPU path and null3D do not have the fault.

This fix keeps the comparison fair. Without it, three.js's WebGL frames would look worse because of a three.js bug, not because of a weaker technique. The fix changes no lighting math, and it adds no work to a frame. The fault is a three.js bug to report upstream. The report should name `examples/jsm/csm/CSMShader.js`, whose `lights_fragment_begin` lacks the `#ifdef STANDARD` block of the current chunk. The fix in `examples/lib/three-worker.ts` (`withCsmLightFix`) shows the missing lines. When three.js fixes the add-on, remove the fix and check the WebGL frames again.

### Night town's figures on the Mac

Not measured yet. Night town's timing runs measure a build with the job worker fix below, on a quiet Mac.

### Browser faults met while timing

These faults show in timing runs on the owner's MacBook Pro (Apple M5 Max). The timing scripts open the Mac's installed Chrome, as people run it ([Examples](../examples.md#the-ramp)).

- **Chrome 155, three.js's WebGLRenderer, 60 lights.** Night town on three.js 0.186.1 draws no frame at 60 lights, its ramp's first count, and draws at 72. A page that holds 60 lights from its start fails too, so the ramp's change of count is not the cause. Each try logs "THREE.WebGLProgram: Shader Error 0 - VALIDATE_STATUS false" for a `MeshNormalMaterial`, with an empty program log. The error number is 1282 where the light-limit search runs first. Playwright's Chromium 153 draws 60 lights with no error. The ramp steps past one count that draws no frame, when the next count draws, and the page names that count as a fault of the browser. The owner decides whether to report it upstream.
- **Chromium 153, three.js's WebGPURenderer.** Its shader compiler fails to build `renderPipeline_RTT_57`, one of three.js's render-to-texture pipelines for Night town: "An error occurred while generating Tint IR. error: swizzle view instruction still has usages after lowering". Chrome 155 builds it.
- **Chromium 153, null3D on WebGL2.** Night town at 300 lights or more takes about 90 s to its first frame. Chrome 155 takes 1 to 2 s.

### An engine fault: the page's memory measurement and job workers

Chrome's measurement of the page's memory answers only after every worker of the page has run it. An idle job worker that blocks in the job loop never runs it. Night town's pages at 1,020 lights, which start 2 to 16 job workers, then take about 120 s longer than pages without job workers, or stop answering. With the measurement taken out of the page, the same pages answer in 3 s. So the engine lets its job workers run the measurement ([Measuring the page's memory](../implementation-notes.md#measuring-the-pages-memory), hard rule 24 in `AGENTS.md`).

- `tests/image/memory-measurement.spec.ts` starts 3 job workers with a busy scene. The measurement answers, and the test ends in 19 s. The open stats overlay shows the page's memory in a test of 18 s. Without the fix, the measurement gives no answer in 40 s, and the overlay still says "measuring" after 30 s.
- The fix adds no work while no measurement runs. Night town at 1,020 lights ran twice on a build without the fix and twice on a build with it, in turn. Both builds ran with the measurement taken out. The table gives the busiest thread's time per frame in the second round, at a Mac load under 8. There, each pair started the same count of job workers. Every page drew 120 frames a second.

| Path and mode | Job workers | Without the fix | With the fix |
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

The tests hold 96 lights, 8 blocks, and 24 lights, 2 blocks, on SwiftShader, in both engines' tests. They wait up to 180 s. The SwiftShader references show that smaller town. With the Mac's load near 20, WebGPURenderer gives no frame within 180 s at 300 lights on the Mac's GPU. At 48 lights on SwiftShader it gave none in one of four tests.

Sine hashes draw other ripples, clouds and stars on other machines, so the shaders use the integer hash. Firefox on Linux filters the facades' textures another way, so it keeps references of its own. [Image tests](../image-tests.md#ci) gives the figures.

### The test page's 404

Every comparison's test page names an empty icon, as the examples page does. A page that names no icon makes the browser ask the server for `/favicon.ico`, which logs one "404 (Not Found)" on the first page of each browser.

## Battle

Task M2-EX6. Battle is the second comparison, and the comparison of ready-made assets. Two armies of animated soldiers and mechs, with tanks behind each line, meet on a cratered field at dusk. Its mechanism is S5's: three.js pays per animated character on one thread. The count is the soldiers and mechs of both armies.

### The models

- Both engines load the same two files from the [sample content](../sample-content.md). The soldier is Quaternius's CC0 Character Soldier. The sample-assets repository keeps the source as published, and its script `scripts/battle-soldier.ts` builds `characters/battle-soldier` from it. The body's parts, head and shoulder pads become one skinned mesh with vertex colors. The AK stays a mesh of its own under the right hand's joint, and the other 13 weapons go. The four clips that the battle plays stay, as idle, run, shoot and die.
- The rifle stays in the file, because null3D attaches a rigid mesh to a joint only from the file: its joints are not objects. three.js's `SkeletonUtils.clone` keeps the mesh under the bone. So the weapon follows the hand the same way in both engines.
- The mech is Quaternius's CC0 George, as the `demos-vs-threejs` repository converted it: one skinned mesh of 3,000 triangles with four clips. That repository's source links on Google Drive refuse downloads (quota exceeded), and no other copy of George is known. The sample-assets entry `characters/quaternius-mech` records the conversion and the source file's SHA-256.
- A search found no CC0 soldier or mech that is more realistic and ready to use. Quaternius's Universal Base Characters have human proportions and a CC0 animation library, but no helmet, rifle or uniform. The CC0 soldiers on OpenGameArt have rigs and no clips. The one more detailed CC0 mech, Colorado Stark's on OpenGameArt, has no clips. So Battle keeps the two Quaternius models.
- The soldier keeps the source's detail: 5,828 triangles for the body and 1,122 for the rifle, about three times the simplified soldier of the `demos-vs-threejs` repository. A comparison of ready-made assets draws them as made.
- The skinned body's node in the source has a scale and a turn. The glTF rules ignore a skinned mesh's node transform, and three.js's loader applies it. The script bakes it into the vertices and into the inverse bind matrices, and puts the node at the origin. So both readings draw the same model. Baking it into the vertices alone draws each soldier 58 times too large and bent out of shape.

### How each engine builds it

- null3D makes each unit a copy of its model with `scene.instantiate`. The copy is a group with the skinned body and the rifle, and an animator that runs on the job workers. When the battle changes a unit's clip, the sketch cross-fades to it. three.js makes each unit a `SkeletonUtils.clone` with its own `AnimationMixer`, as its animation examples build characters. Each frame, the unit's two clips in play take their times and weights from the shared simulation. Then `mixer.update(0)` blends them into the bones. That is the work of `mixer.update(delta)` with a cross-fade, and a held frame shows the state's exact pose. Each tank is a tree of three objects in both engines: the hull, the turret on it and the barrel on the turret.
- Tracers, shells and particles are batches in both engines, as games draw effects.
- null3D's joints are not objects, so neither engine turns the torso toward its aim, as the three.js poser of the `demos-vs-threejs` repository does. Each unit turns its whole body toward its target. A switch in the scene's description (`AIM_WITH_WHOLE_BODY`) keeps the body's heading instead, for when joint overrides (task M2-EX24) turn the spine.

### The look

Every comparison meets the look bar of the feature demos and showcases, by the owner's ruling ([Examples](../examples.md#the-look)). The owner approved Battle's look from frames of both engines at 21 seconds and a wide shot at 85 seconds. It is made from features that both engines have, each by its own technique:

| Part | null3D | three.js |
| --- | --- | --- |
| Sky | The generated sky, with clouds, as the background | `Sky` on WebGLRenderer, `SkyMesh` on WebGPURenderer |
| Light from the sky | `assets.skyEnvironment()`, which leaves out the sun's disc | `PMREMGenerator.fromScene` of a sky without the sun's disc |
| Sun shadows | The directional light's 3 cascades over 320 m | The CSM add-on, or the CSM shadow node, with the same reach |
| Fog | Height fog with a glow toward the sun | The same formula in GLSL chunks or a fog node, with the glow |
| Ground | A surface function that mixes five layers made in code: grass, earth, wet mud, scorched earth and rock. Each layer has a color map and a normal map. The terrain's vertex colors give the shares of grass, mud and scorch, and how dry the grass is. Rock shows on steep and high ground. Each layer shows through the one over it where its heights rise higher | The same mix in GLSL added to `MeshStandardMaterial`, or in a node material, from the same textures |
| Rocks, ruins, tank paint, bark | Surfaces made in code (`rock`, `masonry`, `camo`, `bark`) | The same textures |
| Scenery | Rough hills with meadow and bare stone, 1,400 pines in clumps, broadleaf and dead trees, rubble on the crater rims, ruins, tank traps and grass, all from the shared description. The trees follow the Creek's: a trunk in bark under cards of needles or leaves, which their textures cut out with a mask | The same meshes, places and textures, cut out with `alphaTest` |
| Soldiers, mechs and rifles | A surface function on each army's material reads each vertex color's surface class, which the sample files carry in alpha, and texture coordinates projected along each vertex's main axis. Cloth shows a woven texture made in code, with its normal map and worn patches. Helmets and the mech's armor are painted steel that chips to bare metal, and the armor shows panels with seams. Metal's roughness varies. Mud climbs the legs, and soot darkens patches above it. The mech's vents glow. The palette is darker and less saturated than the models' colors, and a soft rim of the dusk sky's light outlines each unit | The same in GLSL added to `MeshStandardMaterial`, or in node materials |
| Tanks | One detailed model made in code: armor with beveled edges, bolted plates on the glacis and the turret's cheeks, access panels, turned road wheels with tires and hubs, a toothed drive sprocket, track links with grousers and guide horns, skirts in bolted panels, a cupola with vision blocks, smoke dischargers and a muzzle brake | The same mesh |
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

The runs are measured as for Factory, on the approved look. Each count had room for that count only. The ramps had room for 40,000 units and started at 200. The [run's record](../tested-devices/macbook-pro-chrome/20261012-002614-battle-modes.md) has each figure.

null3D's figures above 1,024 units are void (task M2-R36). The build that these runs measured held at most 1,024 animated objects in the engine's animation table. At about 1,030 units, Battle's next soldier failed with E1102 in the sketch's update. The update then threw in every frame before it moved the soldiers, the bullets and the camera. The engine logged the error once and kept presenting frames, so the ramps and the fixed counts measured 1,024 soldiers frozen in place. The table marks those cells void.

| Engine and path | Held | 1,000 units | 4,000 | 10,000 | Page memory at 4,000 |
| --- | --- | --- | --- | --- | --- |
| null3D, WebGPU, High | void | 64.6 fps | void | void | void |
| null3D, WebGL2, Medium | 200 | 55.8 fps | void | void | void |
| three.js, WebGLRenderer | 0 | 8.0 fps | 1.9 fps | 1.0 fps | 435 MiB |
| three.js, WebGPURenderer | 0 | 7.5 fps | 1.7 fps | 0.7 fps | 630 MiB |

- At 1,000 units, null3D drew 7 to 8 times the frames of three.js's faster renderer. three.js spent 95% of its frame in its render calls: each soldier is a skinned mesh that it poses and draws on its own.
- null3D's GPU sets its rate. At 1,000 units its busiest thread took 3.5 ms a frame, yet it drew 65 frames a second.

### Battle's image tests

- Hold mode draws every frame up to the held one. On SwiftShader, CI's software GPU, Battle's held frame at 600 units took 17 to 72 seconds a test. So the SwiftShader references hold 120 units (`swiftShaderHoldCount`), and the Mac's hold 600.
- At 120 units, the three.js tests take 22 to 58 seconds each, on SwiftShader on the Mac, one test at a time. The null3D tests take 25 to 33 seconds, six tests at once. Factory's tests take 2.2 to 3.5 times as long in CI as on the Mac. So Battle's image tests get a longer limit (`holdTimeoutSeconds`) than the default 90 seconds.

### Battle's GPU cost and memory

Task M2-EX41 measures where Battle's memory and GPU time go in null3D.

The memory:

- Chrome's page figure (`performance.measureUserAgentSpecificMemory`) counts each `SharedArrayBuffer` object of a shared memory at its full length. The engine's memory grows in many steps while a sketch sets up, and each growth gives `memory.buffer` a new object. A part of the scene that keeps a view made at an older size keeps that object alive. Static instance batches and the setting blocks of the sky, the environment and the effects do so, since the sketch sets them up once and then leaves them alone. With 11 such objects on one 63 MiB memory, Chrome charges the sketch worker 420 MiB, while its own heap is 22 MiB. So most of that figure is not real memory: at 400 units with the effects off, the page's renderer process takes 196 MiB of real memory, against three.js's 201 MiB.
- So every view of the engine's memory comes from one place, and every object that keeps views drops them when the memory grows. A static check and a browser test keep it so ([Views of the shared memory](../implementation-notes.md#views-of-the-shared-memory), hard rule 20).
- The thread that draws gets only its own GPU path's text of each custom material, and the sketch's module builds only that path's text. At 1,000 units, against both paths' text, this takes the render worker's strings from 34.1 to 8.8 MiB, and its heap from 36.2 to 10.5 MiB. The sketch worker's strings fall from 15.7 to 10.0 MiB.

The GPU time:

- Skinned copies of one mesh and material share an instanced draw on WebGPU, custom materials included ([D-20](D-20-webgpu-skinning.md#shared-buckets-and-custom-materials-skin-builds-on-first-use)). With a bucket of its own for each skinned unit, null3D draws 10,214 draws a frame at 1,000 units on WebGPU. That is about 2,100 in the camera's view, 2,000 in the depth prepass and 6,000 in the 3 cascades. WebGL2 draws the same scene in 289 draws.

The figures, without and with these changes, on the Mac's Chrome 155 with WebGPU at High:

- "Before" is main at `16a710a2f`. The only engine change between it and the "after" build lets game code turn joints, which Battle does not use.
- Each page ran in a production build in a visible window, for 10 seconds after 4 seconds of warm-up. Each count ran twice, before and after in turn, and once more with the memory figure. Two "before" pages ended at a load just over 8 and are left out. The table gives the range of the other runs.
- These runs have no ramp. A ramp without the fix to its reading of the display rate (task M2-EX7) can report a held count that it never held.
- The 4,000-unit pages held only 1,024 soldiers, and their scene stood still. Both builds' table of animated objects held at most 1,024 objects, so each frame stopped at the first unit past it, before the units, the bullets and the camera moved (task M2-R36). Those rows compare the two builds on the same still scene of 1,024 soldiers. They do not give null3D's cost at 4,000 units.

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

- The page's memory falls to a fifth.
- The draws fall by 97%, and the CPU time by about 40% on the 4,000-unit pages, since the sketch worker lays out no bucket for each unit.
- The GPU's frame time does not change. It varied from 9.7 to 17.1 ms from page to page in both builds, and its largest render pass took 6.8 to 9.6 ms in both. The frame's compute work falls from 1.4 to 1.6 ms to 0.1 ms, as the vertex shaders skin Battle's custom materials. So on the Mac, the draw count does not bound Battle's GPU time; its largest pass does. What that pass spends its time on is open.
- On the 4,000-unit pages, null3D draws about 89 frames a second in both modes, against about 60 without these changes. There the busiest CPU thread set the rate. The rate rises at 1,000 units too, though the GPU's frame time does not fall. Apple's GPUs work on two frames at once, so a frame time from GPU timestamps does not bound the rate ([Frames in flight](../implementation-notes.md#frames-in-flight)).
