# Slice api-3: sense and substance review

Pages: api/raycast, api/render, api/scene, api/sketch, api/sound, api/splats, api/sprites, api/tasks, api/terrain, api/textures, api/three-compat, api/time, api/ui, api/vertex-draws, api/water, api/wind.

Paths below are relative to the generated copy of the repository. Line numbers are those of the generated pages. Findings 1 to 30 are checked against the source. Findings 31 to 47 are "not verified": they were noted on a read but not checked further.

## Ranked findings

### 1. [high] internal-note: "Roadmap step" opens every page of the slice
- Pages: all 16 (api/raycast, render, scene, sketch, sound, splats, sprites, tasks, terrain, textures, three-compat, time, ui, vertex-draws, water, wind). Anchor: line 11, "> Roadmap step 0.2, first released in null3D 0.1.0."
- Claim: "Roadmap step" is the maintainers' build plan. The AGENTS.md rule forbids internal plans and milestones in docs. A user cannot act on "step 0.3"; it only tells the reader about the team's process. It appears on 103 pages in docs/.
- Evidence: tools/lib/steps.ts:16-30 (`releaseOf` writes "roadmap step ${since}, first released in null3D ..." when `since` is a roadmap step; `shipsSentence` capitalizes it); tools/lib/docs.ts:652 calls it; tools/lib/docs.test.ts:90,135-142 pin the wording.
- Proposed edit: make `shipsSentence` write only the release, such as "First released in null3D 0.1.0." Keep `since` in the front matter for the website. Update the tests in tools/lib/docs.test.ts and tools/lib/steps.test.ts.
- Generated source: tools/lib/steps.ts

### 2. [high] missing-content: api/terrain lists no options, and a height map cannot be used from the page
- Page: api/terrain. Anchor: "## How it works", line 70: "The height comes from a function or from a height map held as a `Float32Array`."
- Claim: The page never says how big the array must be or in what order its rows go. The `resolution` option that sets this is not named. Other options are missing too: `splatResolution`, `chunkQuads`, `skirt`, `metalness`, `castShadows`, `receiveShadows`. Line 94 says "Give `splat` to paint the weights yourself", but `splat` is a function `(x, z, out) => void`, not a texture, and the page does not say so. A newcomer with a height map image is blocked.
- Evidence: packages/terrain/src/terrain.ts:31-107 (`height` doc: "A `Float32Array` is a height map of `resolution` samples along each side, row by row from `z = -size / 2` upward"; `resolution` default 256; `chunkQuads` default 16; `skirt`, `metalness`, `castShadows`, `receiveShadows`); packages/terrain/src/splat.ts:12 (`SplatFunction`).
- Proposed edit: add "## Options" after the example with a table: `size`, `height` (function, or `Float32Array` of `resolution` by `resolution` samples, rows from -z), `resolution` (256), `layers` (1 to 4, with `map`, `tile`, `roughness`, `heightFrom`, `contrast`), `splat` (a function that writes four weights into `out`), `splatResolution` (256), `chunkQuads` (16), `maxLevel` (6), `camera`, `error`, `bakedNormals`, `steepFaces`, `skirt`, `morph`, `metalness`, `castShadows`, `receiveShadows`, `maxBlocks`, `blocksPerUpdate` (16). Add a 4-line height-map example.
- Generated source: none (hand-written page); option doc comments in packages/terrain/src/terrain.ts.

### 3. [medium] unclear: `water.update()` "changes nothing", yet every example calls it
- Page: api/water. Anchor: "## The water object", line 224: "Keeps the sketch's frame loop. The reflection pass carries its own cadence now, so the call changes nothing".
- Claim: A reader cannot tell whether to call it. "Now" is changelog language (the rule says a page states what holds now). Line 38 then says the ocean's reflection follows "the camera that `update()` follows", which is the ocean's `update`, not the water's. The two `update` calls do different things with no note.
- Evidence: packages/water/src/water.ts:214-218 ("Keeps the sketch's frame loop, as every sketch calls it. The reflection pass carries its own cadence, so this call changes nothing."); examples in water.md:73-74, 324.
- Proposed edit: either remove `update()` from the water object and from the examples, or write: "`update()` does no work. Call it once a frame, so a later version can use it." Pick one; do not use "now". In "The ocean object", say that `ocean.update()` moves the mesh and is required.
- Generated source: none; TSDoc in packages/water/src/water.ts:214-217.

### 4. [medium] wrong-claim: api/render says a pass can be 8192 texels wide
- Page: api/render. Anchor: "### State between runs", lines 403-404: "The 8192 by 8192 side that the device allows would take 2 GiB on the WebGPU paths".
- Claim: A pass's `size` is capped by `textures.maxSize`, which is 4096 at most. So 8192 is not possible. The largest history pass is 4096 by 4096, which takes 512 MiB.
- Evidence: packages/engine/src/sketch/runner.ts:957-963 (Render gets `textures.maxSize`); packages/engine/src/scene/render.ts:1160-1168 (`checkSize` caps at `maxSize`); packages/engine/src/scene/textures.ts:1359-1364 ("4096 texels, or less on a WebGL2 device"); docs/api/textures.md:230 ("at most 4096 texels").
- Proposed edit: "The largest side, 4096 by 4096, would take 512 MiB on the WebGPU paths, which no page should choose by accident."
- Generated source: none.

### 5. [medium] unclear: api/render points to a section that does not exist
- Page: api/render. Anchor: "### Reading a region back", lines 422-424: "A material shows a pass's image at the place that the section on a pass's texture gives below."
- Claim: No section "below" covers a pass's texture. The headings after it are WebGL2, Switching and removing passes, The graph as text, Cost and Errors. The fact the reader wants (v = 0 at the bottom row; `effectPassUv`) is at lines 59 and 218.
- Evidence: docs/api/render.md headings at lines 439, 447, 454, 462, 470; facts at 59, 218.
- Proposed edit: "A material shows the image with v = 0 at its bottom row ([Scene passes](#scene-passes)). A full-screen pass reads it at `effectPassUv(input.uv)` ([Full-screen passes](#full-screen-passes))."
- Generated source: none.

### 6. [medium] contradiction: "The engine draws a compute pass on WebGPU only" after a section on its WebGL2 form
- Page: api/render. Anchor: "### WebGL2", line 445, last sentence.
- Claim: The section says a WebGL2 page runs the `fallback` as a full-screen pass. The last sentence then says compute passes draw on WebGPU only. The reader cannot tell if a pass with a fallback works on WebGL2.
- Evidence: docs/api/render.md:441 ("A WebGL2 page runs the `fallback` WGSL as a full-screen pass"), 445; packages/engine/src/scene/render.ts:612-615 (fallback layer limit on WebGL2).
- Proposed edit: replace the last sentence with "Without a fallback, the pass runs on WebGPU only, and `render.addPass` throws E1220 on WebGL2."
- Generated source: none.

### 7. [medium] contradiction: api/tasks says add-ons do not sort through a task, then shows a sort task
- Page: api/tasks. Anchor: intro, line 13 ("so an add-on does not sort its drawn rows through a task") and the example at lines 20-31 (`SORT_TASK`, name `'splat-sort'`, `sortRound`), and "## Shared memory" line 63 ("A per-frame sort copies no data ...").
- Claim: The page's only example is the thing the first paragraph says not to do, and it is named after the splats add-on, which does not sort through a task (api/splats line 110: the task "chooses" prefixes). A reader learns the wrong pattern.
- Evidence: docs/api/tasks.md:13, 20-31, 63-73; docs/api/splats.md:110-119.
- Proposed edit: change the example to a task that selects rows, such as `name: 'pick-chunks'`, `chooseChunks(view)`, which writes chosen indices into the shared buffer. Rename the shared-memory example "A per-frame selection".
- Generated source: none.

### 8. [medium] missing-content: api/tasks omits the `transfer` argument and the `{ output, transfer }` contract of `run`
- Page: api/tasks. Anchor: line 15 ("The module exports `run`, and the worker calls it for each task.") and the module example at line 42 (`return { output: { order } }`).
- Claim: The page never says that `run` must return `{ output }`, that it may return `transfer`, or that `runTask` takes a third `transfer` list. It also does not say what values can pass (plain objects, typed arrays, buffers). A reader who returns the answer directly gets `undefined`.
- Evidence: packages/engine/src/shared/run-task.ts:50-61 (`runTask(task, input, transfer = NO_TRANSFER)`, and the list of values that pass); packages/engine/src/workers/tasks.ts:35-58 (`TaskModule.run` returns `TaskResult { output; transfer? }`).
- Proposed edit: add under the module example: "`run` returns `{ output }`. `runTask` resolves with `output`. Add `transfer: [buffer]` to move an `ArrayBuffer` back instead of copying it. `runTask(task, input, transfer)` takes the same list for the input. Input and output must be numbers, strings, plain objects and arrays, typed arrays, `ArrayBuffer`s or `SharedArrayBuffer`s."
- Generated source: none.

### 9. [medium] scan-order: api/raycast hides that one sprite or one glass object turns every pick into a raycast
- Page: api/raycast. Anchor: "## Pixel-exact picking", line 164 ("A scene with a source that the pick's id target cannot hold answers the whole pick with a raycast instead.").
- Claim: The section is named "Pixel-exact picking", and the status note says picking "draws each character as it is posed". But a single sprite, point, line, blended material or transmission material anywhere in the scene makes every pick a raycast: masks are ignored and skinned characters are tested in bind pose. The fact comes sixth in the section. Hold mode also answers with a raycast, and the page does not say so. "The pick's id target" is not explained.
- Evidence: packages/engine/src/scene/picks.ts:7-10 ("A scene whose sources the pass cannot draw whole, such as ... a blended surface or a sprite, answers with a raycast instead ... An engine that runs no frame loop, as hold mode does, answers with a raycast too.").
- Proposed edit: put a short paragraph right after the first code block: "A pick is pixel-exact only when every source in the scene draws into the pick's image. One sprite, point, line, blended or transmissive material, hashed alpha, or custom material without a vertex offset makes every pick a raycast. Hold mode answers with a raycast too." Move the list of sources and the cost detail into a `<details>` block.
- Generated source: none.

### 10. [medium] internal-note: pages tell users to run the engine repository's benchmark scripts
- Pages: api/raycast (line 23), api/scene (lines 246, 341, 462, 549), api/wind (line 372). Other slices have the same: api/controls:106, api/debug:335, api/geometry:204, api/materials:526.
- Claim: `bun run bench:allocation --calls` is a script of the engine's own repository. A user's project has no such script, so the sentence is a maintainer's test note. The useful fact is "allocates nothing".
- Evidence: the commands at the lines above; no `bench:allocation` script in a user project template (AGENTS.md: "Notes for maintainers belong in code comments ... public docs never link to them").
- Proposed edit: delete each "`bun run bench:allocation ...` checks it." sentence. Where the measure matters, write "The engine's allocation benchmark checks it." In api/wind:372 write "The add-on's code allocates nothing in a frame."
- Generated source: none.

### 11. [medium] term-before-definition: "hold mode", "a replay" and "a recording" are used and never explained
- Pages: api/sketch (lines 49, 101, 138, 140), api/time (lines 56, 65, 66, 111), api/tasks (line 56), api/render (line 450), api/wind (line 338), api/raycast (implicit in pick fallback).
- Claim: Each page uses hold mode as a known term. api/sketch:49 says "Hold mode, a replay and a recording" with a link to the whole testing guide, not its section. A newcomer reading the sketch page meets the term in its third section.
- Evidence: docs/guides/testing.md:52 has "## Hold mode"; api/render:450 links `../guides/testing.md#hold-mode`, the others link the page top or nothing.
- Proposed edit: at first use on each page, add one clause: "hold mode, in which the engine steps the sketch to a set time and draws one frame for a test ([Hold mode](../guides/testing.md#hold-mode))". In api/sketch, also say what a replay and a recording are, with a link to guides/deterministic-simulation.md.
- Generated source: none.

### 12. [medium] missing-content: `bakeProbes` options and its `step` result are not described
- Page: api/scene. Anchor: "## The light probe grid", lines 375-410.
- Claim: The prose names `albedo` and `spacing` and the example passes `box`, `environment` and `environmentOptions`, but there is no table. `samples` (8 to 1024, default 64) and `distance` (default: the box's diagonal) are not named. The example tests `!bake.step(4)` but the page never says that `step` returns true when every probe is baked, or that `bake.done` and `bake.finish()` exist.
- Evidence: packages/engine/src/scene/light-probes.ts:398-433 (options), 623-643 (`done`, `step(budget = 4): boolean`, `finish()`).
- Proposed edit: add a table: `box` (required), `spacing` (2), `samples` (64, 8 to 1024), `distance` (the box's diagonal), `environment`, `environmentOptions`, `albedo`. Then: "`bake.step(n)` bakes up to `n` probes and returns true once all are baked. `bake.done` counts the baked probes. `bake.finish()` bakes the rest at once and returns the grid."
- Generated source: none.

### 13. [medium] missing-content: api/sound gives error codes in a form that matches no message and lists only two
- Page: api/sound. Anchors: line 77 ("throws error 2504"), line 121 ("gets error 2501").
- Claim: The thrown message reads "sound E2504: ...", so a reader who searches for "error 2504" finds nothing. The page has no errors table, unlike api/splats. The add-on also throws E2500 (bad options, missing file, far not above near, destroyed system), E2502 (no room in the table: raise `capacity`) and E2503 (a member index out of range). None of these has an error page.
- Evidence: packages/sound/src/errors.ts:4-9 (`SOUND_CODES = 2500`, message `sound E${code}: ...`); packages/sound/src/sound.ts:256, 372 (2502), 395 (2501), 418, 520 (2503), 647 (2504).
- Proposed edit: write "E2504" and "E2501" in the text. Add "## Errors" with a table of E2500 to E2504 and their causes, in the same form as api/splats.
- Generated source: none.

### 14. [medium] contradiction: api/water says not to write water by hand; the custom passes guide teaches it
- Pages: api/water, guides/custom-passes. Anchor: api/water "## Costs and limits", line 466 ("**One way to make water.** Use this package rather than a hand-written custom material, so a scene's water has one owner."); guides/custom-passes.md summary line 6 ("reflections and a water recipe") and lines 166-211, 320-324; api/render:488 lists "a water recipe".
- Claim: A reader gets two opposite messages. "So a scene's water has one owner" gives no reason a user can weigh.
- Evidence: the lines above.
- Proposed edit: in api/water, replace the bullet with: "Use this package for rivers, lakes and seas. The water recipe in [Custom passes](../guides/custom-passes.md) shows the parts that the package is built from, for a look that the package does not give." Keep the guide as is.
- Generated source: none.

### 15. [medium] unclear: the `lowestTier` option of `defineSketch`
- Page: api/sketch. Anchor: "## Options" table, line 65: "False keeps the governor's lowest quality tier out, for a scene that its own sketch thread limits".
- Claim: "The governor" and "its lowest quality tier" are not explained on the page and have no link. "A scene that its own sketch thread limits" is hard to parse. The source gives the reason: the tier only cuts render size, which does not help when sketch code is the slow part.
- Evidence: packages/engine/src/sketch/define-sketch.ts:220-226; docs/concepts/quality-presets.md (the frame-budget governor).
- Proposed edit: "`false` stops the [frame-budget governor](../concepts/quality-presets.md) from dropping to its lowest tier, which draws a smaller picture. Use it when the sketch's own code, not the GPU, makes frames slow: a smaller picture would not help. The page's `?tier=off` switch does the same."
- Generated source: none; TSDoc at packages/engine/src/sketch/define-sketch.ts:220-226 could use the same words.

### 16. [medium] term-before-definition: compute passes use "feature description" and "frame point" with no link
- Page: api/render. Anchor: "## Compute passes", the example (`defineFeature({ name, frame: 'background', kind: 'compute', outputs })`) and the option table line 292 ("The feature description that places the pass").
- Claim: The page's own example of a texture pass needs `defineFeature`, which the page never explains or links. Lines 338-340 then talk about "frame point" values `'background'`, `'opaque'`, `'transparent'`, `'resolve'`, `'post'` without listing what each means.
- Evidence: docs/api/render.md:271-282, 292, 338-340; docs/api/features.md holds the feature descriptions (api/scene:252 links it as "[feature description](features.md)").
- Proposed edit: in the option row, write "A [feature description](features.md) from `defineFeature`. Its `frame` sets where the pass runs in the frame, and its one output names the texture." Link "frame point" at line 340 to the frame points section of features.md.
- Generated source: none.

### 17. [medium] internal-note: api/splats quotes before-and-after timings of a change
- Page: api/splats. Anchor: "## Detail levels, streaming and the budget", lines 121-124 ("In the splat demo, on a simulated phone connection, the reader arrived at 4.4 seconds instead of 7.9. The first parts showed at 7.0 seconds instead of 8.3.").
- Claim: "Instead of" compares with an older build, which is changelog content. The rule says pages state what holds now and name the benchmark for a figure.
- Evidence: AGENTS.md "Writing docs": "A page describes what exists now"; "Name the engine's benchmarks when you cite a figure".
- Proposed edit: "So the first selection and the first chunk's decode wait for neither download." Drop the timings, or give a present figure with its benchmark: "In the splats demo on a simulated phone connection, the first parts show after about 7 seconds."
- Generated source: none.

### 18. [medium] wall-of-text: api/wind pastes about 190 lines of WGSL that the reader must copy
- Page: api/wind. Anchor: "## Reading the field in your own WGSL", lines 83-270 (`// <wind-steady>` and `// <wind-sample>` blocks).
- Claim: The main text of the section is buried under two long blocks. Line 81 already says to copy them from `shaders/field.wgsl` in the package. The blocks are correct and useful, so they should stay, but not in the main flow.
- Evidence: docs/api/wind.md:81-270; stats.json api/wind words 4060.
- Proposed edit: keep line 81 and one sentence on what each block holds. Put each block in its own collapsible block: `<details><summary>Technical details: the steady field block (wind-steady)</summary>` ... `</details>` and the same for `wind-sample`. Keep the material and vertex offset examples (lines 274-320) in the main text.
- Generated source: none.

### 19. [medium] long-paragraph: api/render has nine long paragraphs and one huge table cell
- Page: api/render. Anchors: lines 21 (124 words), 67 (112), 81 (79), 146 (91), 152 (153), 382 (101), 395 (208 words, 13 sentences), 441 (58 words, 6 sentences), 445 (118), plus the bullet at 449 and the E1220 cell at 474 (about 190 words).
- Claim: The cost figures at 152, the memory math at 395-405, the 8-bit tone-curve note at 58 and the switching detail at 449 are dense facts for implementers.
- Evidence: stats.json api/render long paragraphs at 14, 60, 74, 139, 145, 375, 388, 434, 438 (stats count from the front matter-less body; same paragraphs).
- Proposed edit: split line 21 into a list of the four pass kinds. Move 152 (S1 benchmark figures), 395-405 (memory per texel) and the 8-bit bullet at 58 into `<details><summary>Technical details: ...</summary>` blocks, leaving one sentence each in the main text. Split the E1220 cell into one row per call (`addPass` options, reflection, compute, `readPass`, other calls).
- Generated source: none.

### 20. [medium] long-paragraph: api/scene has 28 long paragraphs
- Page: api/scene. Anchors (stats lines): 64, 68, 81, 108, 110, 151, 170, 199, 201, 235, 239, 245, 289, 291, 312, 314, 316, 334, 340, 368, 405, 443, 481, 505, 511, 542, 572, 576. Worst: page lines 246 (157 words), 296 (148 words, 3 sentences), 298 (128), 341 (166 words, 12 sentences), 488 (185), 518 (154).
- Claim: Many hold implementer detail that the main text does not need: how the sky layer reaches the environment map (296), fill timing (298), the browser's boxing of fractions (549), error lists (248, 341, 412, 452, 488, 514).
- Evidence: stats.json api/scene; page lines above.
- Proposed edit: move 296 and the second half of 298 into `<details><summary>Technical details: how a sky layer lights the scene</summary>`. Move the development-build error sentences of each section into one table per section or a closed block. Split 246 into "loading", "per-frame changes" and "orthographic cameras". Split 518 into a list of the returned values.
- Generated source: none.

### 21. [medium] long-paragraph: api/water has ten long paragraphs
- Page: api/water. Anchors: lines 34 (143 words), 86 (126), 160 (87), 188 (114), 213 (69), 241 (163), 274 (160), 285 (205 words, 12 sentences), 443-453 bullet (171), 459-465 bullet (86).
- Claim: The waterfall prose at 274-296 reads as art direction. The reader needs what the call draws and what to set. The reflection cadence bullet at 443 mixes five facts.
- Evidence: stats.json api/water.
- Proposed edit: cut line 34 to the four things the package draws, as a list. Put 285-296 (how the column is shaded) in `<details><summary>Technical details: how the fall is shaped and lit</summary>`. Split the reflection bullet into "cadence", "governor" and "stats overlay".
- Generated source: none.

### 22. [medium] long-paragraph: api/wind has ten long paragraphs, two with internal performance notes
- Page: api/wind. Anchors: lines 24 (93 words), 57 (99), 77 (128), 81 (57), 272 (91), 290 (78), 326 (110), 328 (75), 338 (72), 361 (171).
- Claim: Line 57 ("Until the browser has optimized the add-on's functions, a fraction that crosses one of its calls becomes an object") and 372 ("a call the browser does not inline boxes none of them") are engine-internal allocation notes. Line 361 explains the budget in terms the reader cannot use ("smaller than the room that each preset's frame leaves beside the plants' own budget").
- Evidence: stats.json api/wind.
- Proposed edit: keep "The calls allocate nothing; keep one array for the place you push." Move the rest of 57 and 372 into a closed block. Rewrite 361 as a list: the budget per preset; what the governor lowers; the overlay line.
- Generated source: none.

### 23. [medium] long-paragraph: api/textures has ten long paragraphs
- Page: api/textures. Anchors: lines 107 (69), 126 (71), 224 (163 words), 228 (141), 236 (96), 242 (73), 254 (62), 258 (110), 260 (73), 268 (109).
- Claim: 224 (how arrays grow and shrink) and 228 (WebGL2's 16 textures and which maps drop) are correct and useful for implementers but heavy for the main flow.
- Evidence: stats.json api/textures.
- Proposed edit: keep the first two sentences of 224 and the advice at 226 in the main text. Put the rest of 224 in `<details><summary>Technical details: how texture arrays grow</summary>` and 228 in `<details><summary>Technical details: maps per material on WebGL2</summary>`. Make 258 a small table of bytes per texel by format.
- Generated source: none.

### 24. [medium] missing-content: pages with a matching demo do not link it
- Pages: api/raycast (picking), api/splats (splats), api/terrain (terrain), api/water (water, ocean, showcase/creek), api/wind (vegetation-wind, forest; line 326 names `examples/forest` as plain text), api/vertex-draws (rain), api/textures (canvas-screen), api/scene (multiple-views, reflection-probes, aurora, light-shafts), api/tasks (splats), api/time (hold-mode, replay).
- Claim: A reader learns faster from a running demo. The pages that do link demos (render, sound, sprites, ui, scene for two) show the format.
- Evidence: examples/demos.ts entries `picking` (code picking/), `splats` (no code), `terrain` (terrain/), `water` (water/), `ocean` (ocean/), `creek` (showcase/creek/), `vegetation-wind`, `forest`, `rain` (no code), `canvas-screen`, `multiple-views` (no code), `reflection-probes`, `aurora` (no code), `light-shafts`, `hold-mode` (no code), `replay`.
- Proposed edit: add the links listed under each page in "Screenshots and demos" below, in the form https://github.com/null3d-engine/null3d/tree/main/examples/<code>.
- Generated source: none.

### 25. [low] unclear: api/vertex-draws says copies cannot differ, and that raycasts test a triangle
- Page: api/vertex-draws. Anchors: line 24 ("You cannot change the shape per copy or hit-test it"), line 150 ("A raycast tests the small triangle that the engine keeps for the draw's object"), line 158 ("more draws than the scene holds").
- Claim: The rain example makes every copy differ by its instance index, so "cannot change the shape per copy" reads as false. The meaning is that every copy has the same vertex count and no per-copy data. Line 150 suggests a raycast can hit the draw. The triangle has all three corners at 0, so no ray hits it. The limit of 256 draws is not stated.
- Evidence: packages/engine/src/scene/scene.ts:5221-5236 (degenerate triangle `[0,0,0, 0,0,0, 0,0,0]`; `VERTEX_DRAW_MAX_DRAWS`); packages/engine/src/generated/core.ts:200-202 (256 draws, 1,048,576 vertices, 16,777,216 instances).
- Proposed edit: line 24: "Every copy has the same vertex count and no data of its own: the shader makes each one from its index." Line 150: "Raycasts and picks never hit a vertex draw." E1108 row: "more than 256 draws in a scene".
- Generated source: none.

### 26. [low] unclear: api/splats names things it never explains
- Page: api/splats. Anchors: line 142 ("A scene that offers the Quality control at run time"), line 212-213 (`feature` and `draw` members), lines 73-76 ("Each part takes `levels: false` ... so the engine plans no levels for it"), line 227 ("The cards need the scene's depth copy, which a material that reads the scene's depth makes").
- Claim: "The Quality control" is a control of the demo page, not an engine term. `feature` and `draw` are listed with no meaning. Line 227 reads as if the user must add a depth-reading material; the add-on's own material makes the copy.
- Evidence: docs/api/splats.md lines above; "Quality control" appears nowhere else in docs/.
- Proposed edit: line 142: "A scene that lets the user change the preset during play passes `capacity` for the highest preset". Line 212: add "`feature` is the add-on's feature handle and `draw` its feature draw ([Add-on feature draws](feature-draws.md))". Line 227: "The cards read the scene's depth copy. It costs one full-screen pass and four bytes a pixel, shared with every material that reads depth."
- Generated source: none.

### 27. [low] unclear: cloud steps in the environment map, and the sky layer's `refresh`
- Page: api/scene. Anchors: line 177 ("WebGL2 and compatibility mode stop at Medium, so a page there draws the tier with `quality.set({ cloudSteps })` ... It draws them only when the page starts with `cloudSteps` above 0"), line 298 ("at the default of a second that is 20 stage draws a second, and a page that asks for less waits for none of it. A layer of 0 stands still").
- Claim: Line 177 does not say which tier a WebGL2 page gets or what "above 0" means when the table shows "flat layer" for Low and Medium. Line 298's second sentence cannot be parsed. "A layer of 0" means `refresh: 0`.
- Evidence: docs/concepts/quality-preset-tables.md:82 (cloudSteps: flat layer, flat layer, 32, 48).
- Proposed edit: line 177: "WebGL2 and compatibility mode use the flat layer on every preset. To draw volumetric clouds there, set `quality.set({ cloudSteps: 32 })`. The sky's environment map shows volumetric clouds only when the page starts with volumetric clouds, at up to 16 steps." Line 298: "A fill takes about twenty frames, one stage a frame. `refresh` sets how often a moving layer is captured again: at the default of 1 second the map draws about 20 stages a second. Give `refresh: 0` for a layer that stands still."
- Generated source: none.

### 28. [low] long-paragraph: api/terrain has seven long paragraphs
- Page: api/terrain. Anchors: lines 21 (108 words), 78 (66), 80 (88), 82 (127), 92 (99), 102 (110), 104 (169 words, 11 sentences).
- Claim: Line 104 mixes the job worker build, block reuse, `building`, `setVisible` and `setTint`. The last two are API calls hidden in a speed paragraph.
- Evidence: stats.json api/terrain.
- Proposed edit: move `setVisible` and `setTint` to a "## The terrain object" table with `update`, `heightAt`, `normalAt`, `building`, `setVisible`, `setTint`, `destroy`. Put the morph detail of 82 in `<details><summary>Technical details: how blocks morph</summary>`.
- Generated source: none.

### 29. [low] duplication: `time.held` and `engine.held` look the same and are not told apart
- Pages: api/time (line 65), api/sketch (line 138).
- Claim: `time.held` is true only while hold mode steps; `engine.held` is true for hold mode and replays. Neither page names the other, so a reader picks one by chance.
- Evidence: packages/engine/src/sketch/define-sketch.ts:77-78 (`time.held`: "True while hold mode steps to its held frame"), 117-121 (`engine.held`: hold mode and a replay).
- Proposed edit: api/time row: "... Unlike `engine.held`, it is false in a replay." api/sketch: "Unlike `time.held`, it is also true in a replay."
- Generated source: none.

### 30. [low] missing-prerequisite: example add-ons named without a link or a word on what they are
- Pages: api/water (line 213, "The rings follow the wet surface of the weather example add-on"), api/scene (line 298, "The aurora example add-on in `examples/addons/aurora/`").
- Claim: A reader does not know what "the weather example add-on" is or where it lives. The aurora path is plain text.
- Evidence: examples/addons/weather and examples/addons/aurora exist.
- Proposed edit: water: drop the sentence, or "The rings match the wet ground of the [weather example add-on](https://github.com/null3d-engine/null3d/tree/main/examples/addons/weather)." Scene: link the aurora add-on and the [aurora demo](https://github.com/null3d-engine/null3d/tree/main/examples/aurora/).
- Generated source: none.

## Not verified (31 to 47)

31. [low] api/sound, line 152 ("Safari kept 576 at each end of a mono loop") is past tense about a test; and line 162 ("That figure comes from the mixer's module in Bun on a desktop computer") names no benchmark. Edit: "Safari keeps them, 576 at each end of a mono loop"; name the benchmark or drop the source sentence. Not verified.
32. [low] api/wind, line 328 ("Tests hold the readers' blocks equal to this page's.") is a maintainer note. Edit: delete. Not verified.
33. [low] api/sketch context table, lines 120 and 122: `assets` is described as "Downloads of textures, JSON and binary files" (it also loads glTF models, environments, cube maps) and `post` as "The tone mapping and the exposure" (it also holds effects, bloom, outlines). Edit: "glTF models, textures, environments and data files" and "Tone mapping, exposure and screen effects". Not verified.
34. [low] Cross-page jargon `levels: false` ("the engine plans no levels") in api/splats:75, api/terrain:84, api/water:454 without a link to the level-of-detail concept. Edit: link "levels" to concepts/lod.md and say "automatic levels of detail". Not verified.
35. [low] api/scene light probe grid (lines 345-347) and fog sections repeat concepts/lighting.md (lines 176, 331). Edit: keep the API table and options on the scene page; keep the explanation on the concept page and link it. Not verified.
36. [low] api/three-compat, line 32 and line 50: "a custom curve" has no link to the custom tone curve section of api/post, and "the engine keeps its built-in curve" does not say which. Not verified.
37. [low] api/tasks, line 48 and "## The task's module in a build" (lines 92-96) say the same thing about bundling. Edit: keep one. Not verified.
38. [low] api/raycast hit table, line 95: `uv` and `hasUv` are optional fields (the example literal at line 52 leaves them out), but the table does not say so. Edit: "Optional. Give an array of two numbers ...". Source packages/engine/src/scene/queries.ts:110-116. Not verified beyond the type.
39. [low] long-paragraph api/raycast: lines 21, 106, 119, 138, 149, 151, 155, 206, 263 (stats 14, 99, 112, 131, 142, 144, 148, 199, 256). Move 151-155 (how pick coordinates match a ray) into a closed block. Not verified.
40. [low] long-paragraph api/sketch: lines 45, 47, 108, 110, 134, 138, 140, 183. Not verified.
41. [low] long-paragraph api/sound: lines 22, 24, 71, 86, 115, 121, 134, 152. Put the MP3 padding detail of 152 in a closed block. Not verified.
42. [low] long-paragraph api/splats: lines 80, 102, 110, 148. Put the shader math of 80-85 in a closed block. Not verified.
43. [low] long-paragraph api/sprites: lines 115, 141, 145, 151. Not verified.
44. [low] long-paragraph api/vertex-draws: lines 22, 124. Not verified.
45. [low] long-paragraph api/time: line 74. Not verified.
46. [low] long-paragraph api/ui: line 81. Not verified.
47. [low] api/scene and api/sketch, api/tasks, api/time, api/ui have no Mermaid diagram, while the other pages of the slice do. Not a rule for API pages; a diagram of the frame's callbacks would help api/sketch and api/time. Not verified.

## Screenshots and demos

Reference images: tests/image/references/chrome-real-gpu/webgpu/demo-<name>.png (compat and webgl2 tiers hold the same 69 demos). Image names follow docs/images/<page-id>/<name>.webp.

### api/raycast
Shots:
- `picking-demo` (reference, picking/, tests/image/references/chrome-real-gpu/webgpu/demo-picking.png): the picking demo's default view, under "Rays from the pointer".
- `picking-hit-marker` (scripted, picking/): the demo after a click on one piece, with its outline and the marker at the ray's hit point, under "Pixel-exact picking". Steps: open the picking demo, click the second piece from the left, wait two frames, capture.
Demo links: picking/ under "Rays from the pointer".
Concepts with no demo: `raycastBatch`, overlap queries, `pointThreshold` and `lineThreshold`, the query trees.

### api/render
Shots:
- `security-camera` (reference, security-camera/, demo-security-camera.png): a scene pass shown on a monitor, under "Scene passes".
- `reflection-mirror` (scripted, test page reflection-mirror): a red box on a mirror floor, under "Reflection passes".
- `fullscreen-glow` (scripted, test page fullscreen-passes): a glow from the outline mask, under "Full-screen passes".
- `compute-waves` (scripted, test page compute-pass): the wave texture that a compute pass fills, under "Compute passes".
- `ocean-compute` (reference, ocean/, demo-ocean.png): an ocean whose heights come from compute passes, under "Compute passes".
- `dump-graph` (manual): `render.dumpGraph()` output of the security camera demo pasted into a Graphviz viewer, under "The graph as text".
Demo links: security-camera/ (exists), ocean/ under "Compute passes", water/ under "Reflection passes".
Concepts with no demo: passes with history, `render.readPass`, a pass that fills instance buffers.

### api/scene
Shots:
- `fog-curves` (scripted, test pages fog-exponential, fog-exp2, fog-linear, fog-height): four fog curves side by side, under "Fog".
- `clouds-flat-and-volume` (scripted, test pages clouds-flat and clouds-volume): the flat layer (Medium) beside volumetric clouds (High), under the analytic sky's `cloudSteps` paragraph.
- `atmosphere` (reference, atmosphere/, demo-atmosphere.png): the physical sky, under "The physical sky".
- `aurora-sky-layer` (reference, aurora/, demo-aurora.png): a sky layer over a frozen lake, under "Sky layers".
- `multiple-views` (reference, multiple-views/, demo-multiple-views.png): a split screen, under "Multiple views".
- `probe-grid-on-off` (scripted, test pages probe-grid-off and probe-grid): a room without and with the light probe grid, under "The light probe grid".
- `reflection-probes` (reference, reflection-probes/, demo-reflection-probes.png): two rooms with a probe each, under "Reflection probes".
- `light-shafts` (reference, light-shafts/, demo-light-shafts.png): volumetric fog with sun rays, under "Volumetric fog".
- `time-of-day-presets` (scripted, test pages time-of-day-afternoon, -golden-hour, -blue-hour, -night): the four presets side by side, under "Time of day".
Demo links: atmosphere/ and time-of-day/ (exist), aurora/ under "Sky layers", multiple-views/ under "Multiple views", reflection-probes/ under "Reflection probes", light-shafts/ under "Volumetric fog", environment/ under "The environment", instances/ under "Instance batches", decals/ under "Decals".
Concepts with no demo: `overrideMaterial`, `bakeProbes`, `scene.find` and `clone`, the scene's limits.

### api/sketch
Shots:
- `download-list-network` (manual): the browser's Network panel with the listed files downloading beside the engine's core, under "The download list".
- `serial-load-warning` (manual): the console warning that names two files loaded one after another, under "Loads one after another".
Demo links: input/ under "Example: a camera that follows a moving object" (its camera follows the robot), hold-mode/ under "Where the sketch runs".
Concepts with no demo: `downloads`, `engine.firstFrame`, errors in callbacks.

### api/sound
Shots:
- `sound-demo` (reference, sound/, demo-sound.png): the storm on the moor, under the sound demo paragraph.
Demo links: sound/ (exists).
Concepts with no demo: panning by preset, gapless MP3 loops.

### api/splats
Shots:
- `splats-demo` (reference, splats/, demo-splats.png): the priory scan, under the intro.
- `splats-budget` (scripted, test page splats-budget): Low and Ultra budgets side by side, under "Detail levels, streaming and the budget".
- `splats-gltf` (scripted, test page splats-gltf): a glTF splat model, under "A glTF model of splats".
- `splats-stats-overlay` (scripted, splats/): the stats overlay open on the splats row, under the budget paragraph at line 135. Steps: open the splats demo with the stats overlay on, wait for `settle`, capture.
Demo links: splats/ under the intro and under "A splat stream".
Concepts with no demo: `chunkSplats` and `encodeSpz`, `softness`.

### api/sprites
Shots:
- `sprites-lines` (reference, sprites-lines/, demo-sprites-lines.png): the spark fountain, under the intro.
- `sprites-100k` (scripted, test page sprites-100k): one batch of 100,000 sprites, under "Speed".
Demo links: sprites-lines/ (exists), particles/ under "Atlases" (flipbook flames).
Concepts with no demo: sizes in CSS pixels, clicks on sprites.

### api/tasks
Shots:
- `task-on-job-worker` (manual): the browser's Performance panel with a task on a job worker beside the frames, under "What the engine guarantees".
Demo links: splats/ under the intro, terrain/ under "What the engine guarantees".
Concepts with no demo: shared-memory tasks, `TaskFailure`.

### api/terrain
Shots:
- `terrain-demo` (reference, terrain/, demo-terrain.png): the valley, under the intro.
- `terrain-wireframe` (scripted, terrain/): the wireframe debug view, which shows fine blocks near the camera and coarse far blocks, under "How it works". Steps: open the terrain demo with the wireframe debug view on, capture.
- `terrain-baked-normals` (scripted, test page terrain-baked-normals): baked normals beside `bakedNormals: false`, under the normal map paragraph.
Demo links: terrain/ under the intro.
Concepts with no demo: `steepFaces`, a custom `splat` function, `heightAt` placement.

### api/textures
Shots:
- `canvas-screen` (reference, canvas-screen/, demo-canvas-screen.png): wall screens drawn on canvases, under "Canvases".
- `ktx2` (scripted, test page ktx2): a KTX2 texture, under "KTX2 files".
- `mipmaps-on-off` (scripted, test page texture-mipmaps): a floor with and without mip levels, under "Mip levels".
- `texture-budget` (scripted, test page texture-budget): textures past the memory budget with dropped levels, under "GPU memory".
- `transcoder-download` (manual): the Network panel with the transcoder's files on the first KTX2 load, under the transcoder paragraph.
Demo links: canvas-screen/ under "Canvases", gltf-model/ under "Options" (glTF textures).
Concepts with no demo: video textures, `fromData`, texture arrays.

### api/three-compat
Shots:
- `outline-plain-and-glow` (scripted, test pages outline-plain and outline-compat-glow): the core outline beside the add-on's soft glow, under "The outline".
- `tone-curves` (scripted, tone mapping test sketch): Reinhard, Cineon and ACES side by side on the same tiles, under "Tone curves". Steps: run the tone mapping test sketch three times with each curve, capture.
Demo links: none.
Concepts with no demo: Reinhard and Cineon curves, the soft outline pass.

### api/time
Shots:
- `hold-mode` (reference, hold-mode/, demo-hold-mode.png): the held frame of the bouncing balls, under the hold mode paragraph of "The step".
Demo links: hold-mode/ under "The step", replay/ under "Fixed steps", math/ under "Motion that looks the same at any frame rate".
Concepts with no demo: `maxFixedSteps`.

### api/ui
Shots:
- `picking-labels` (reference, picking/, demo-picking.png): HTML labels over turning pieces, under the intro.
- `css3d-labels` (reference, css3d-labels/, demo-css3d-labels.png): cards that turn with a ring, under "Labels as planes of the scene".
- `label-element-devtools` (manual): the Elements panel with a label element and the `transform` and `visibility` that the engine sets, under "Elements on the page".
Demo links: picking/ and css3d-labels/ (exist).
Concepts with no demo: the hidden cases (layers, near and far planes).

### api/vertex-draws
Shots:
- `rain` (reference, rain/, demo-rain.png): fifty thousand streaks from one draw, under "Rain around the camera".
Demo links: rain/ under "Rain around the camera".
Concepts with no demo: `wrap_around`, `setBounds`.

### api/water
Shots:
- `water-demo` (reference, water/, demo-water.png): a river into a lake, under the intro.
- `water-rain` (scripted, test page water-rain): rain rings on the surface, under "Rain on the surface".
- `waterfall` (scripted, test page water-fall): a fall with spray and mist, under "Waterfalls".
- `ocean-demo` (reference, ocean/, demo-ocean.png): the open sea, under "The ocean".
- `underwater-split` (scripted, water/): a camera half under the surface, split at the waterline, under "The view from under the water". Steps: open the water demo, place the camera at the lake's level, capture.
Demo links: water/ under the intro, ocean/ under "The ocean", showcase/creek/ under "Waterfalls".
Concepts with no demo: `windRipple` on a pool, `foamMap` options.

### api/wind
Shots:
- `vegetation-wind` (reference, vegetation-wind/, demo-vegetation-wind.png): a grove in the field's wind, under the intro.
- `forest-sway` (reference, forest/, demo-forest.png): trees whose bark reads the field, under "Trees and plants sway".
- `wind-stats-row` (scripted, vegetation-wind/): the stats overlay open on the wind row, under "Presets and the governor". Steps: open the demo on Medium with the stats overlay on, capture.
Demo links: vegetation-wind/ under the intro, forest/ under "Trees and plants sway" (replace the plain `examples/forest` text), light-shafts/ under "Reading the field in your own WGSL".
Concepts with no demo: `push` and wakes, `read` for a page's own motion.
