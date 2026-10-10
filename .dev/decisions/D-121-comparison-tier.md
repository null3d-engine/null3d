# D-121: The comparison tier with three.js, and Factory

Status: built, 2026-10-09, from the owner's decisions of 8 October 2026 ([Examples](../examples.md#decisions-of-8-october-2026)). Two modes added 2026-10-10, from the owner's decision that day, with the Mac's figures. Task: M2-EX5. Factory does not go on the page until a device sitting shows that null3D holds the higher count on every device class.

Summary: The comparisons with three.js live in `examples/compare/`, one folder per scene, with one shared description that both engines draw. A shell in `examples/lib/` starts either engine on a canvas with the same settings, sets the count, measures and runs the ramp, so the website can draw its own controls. `@null3d/engine/stats` now exports the overlay's panel, so the three.js half shows its figures in the engine's own card. Factory is the first comparison. Each comparison builds its scene in two modes, the same way in both engines: a scene graph of one object per part, the default, and batches of copies posed in closed form. The first Factory build set a null3D tree against three.js's batches, which was not a fair test.

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
- The page's mode switch loads the page again, as the engine switch does, and the ramp keeps each engine's result per mode. `startComparison` takes `mode`, so the website can switch it too.
- Figures come from production builds only. The development server keeps the engine's development checks in every setter, which three.js does not have.

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
- three.js's time is almost all in its render calls: at 50,000 parts, 108 of its 112 ms. Its renderer walks the scene graph to work out the world matrices, and draws each part on its own. null3D works out the trees on its job workers and draws the parts that share a mesh and a material together, in 117 draws at every count.
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
- The null3D rows in this table come from a later build than the rest: after main's merge of 10 October 2026, with the batches casting and receiving the spot lights' shadows, as three.js's batches did in every run. Before that merge, null3D's batches drew no shadows, and its page took 252 MiB, since every job worker started at once. The three.js half did not change between the builds.
- WebGPURenderer held no step at the display's full rate. It held 2,400 parts at half the rate.

### The first run

The first run, on 9 October 2026, measured the first build: a null3D tree against three.js's batches, on the development server, with room in null3D for the ramp's top at every count, at 60 frames a second. Every engine held the ramp's top of 50,000. Its figures measured two different programs, so these figures replace them. Its [record](../tested-devices/macbook-pro-chrome/20261009-125644-factory-ramp.md) stays.

## Device sitting before Factory goes on the page

Factory's ramp on the Mac in Chrome (at 120 Hz) and Safari, the Galaxy S24+, a Pixel, the iPad, and a WebGL-only iPhone, each with the runs recorded in [tested devices](../tested-devices.md).
