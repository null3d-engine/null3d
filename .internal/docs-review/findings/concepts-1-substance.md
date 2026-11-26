# Sense and substance review: slice concepts-1

Pages: concepts/architecture, concepts/assets, concepts/backends, concepts/color-management, concepts/culling, concepts/handles, concepts/instances, concepts/large-worlds, concepts/lighting, concepts/lod.

Line numbers are lines of the generated page files in `docs/concepts/<page>.md`, front matter included. The lines in `stats.json` count from the end of the front matter, so they are 7 lower. Where a finding lists long paragraphs, it gives the file line and the stats line.

Paths to source files are relative to the generated copy of the repository.

## Findings, ranked

The first 30 findings are verified against the source or the pages. Findings 31 to 38 are "not verified": they were read on the page but were not checked against the code.

### 1. lighting: the time-of-day fog color contradicts itself and the code (high, contradiction)

- Anchor: "## Time of day", line 518 ("The fog takes the sky's mean light at every hour..."), the table row `fog` at line 550 and the physical-model row `fog` at line 561.
- Claim: Line 518 says the fog takes the sky's mean light at every hour, and that a horizon-colored fog washes out the scene. The table at line 550 says the analytic model's fog takes "the `color` of the sky's horizon". The physical table at line 561 says "The color of the sky's horizon, with no glow". The code does something else again. With the analytic model, the fog takes the horizon color by day and fades to the sky's average color at dusk. With the physical model, it takes the sky's mean light at every hour. So line 518 is right only for the physical model, line 550 is half right, and line 561 is wrong.
- Evidence: `packages/engine/src/scene/time-of-day.ts:315-323` (analytic: `mix(DAY_HORIZON, DAY_AVERAGE, dusk)`). `packages/engine/src/scene/time-of-day.ts:619-625` (physical: `scale(fogColor, SET_MEAN, sunShare)`). The code comment at :619-622 says "The analytic model's fog takes the mean too", which the analytic branch at :323 contradicts. The TSDoc at :107 and :203 says the fog takes the horizon color.
- Proposed edit: Rewrite the last two sentences of line 518 as: "With the analytic sky, the fog takes the color of the sky's horizon by day and fades to the sky's average color at dusk. With the physical sky, the fog takes the sky's mean light at every hour, the light that the exposure follows. A fog of the horizon's color would carry the sky's brightest band over the whole scene." Change row `fog` at line 561 to "The sky's mean light, with no glow: the aerial perspective already glows toward the sun". Fix the TSDoc of the `fog` field (time-of-day.ts:107) and the code comment at :619-622 to match.

### 2. backends: "the mode stays fixed" leaves out the bloom switch, and "the demo" is wrong (high, contradiction)

- Anchor: "## Color and anti-aliasing on each tier", line 60: "The mode stays fixed while the engine runs ... One exception: when the start-up preset check lowers the preset, the demo draws with the lower preset's mode."
- Claim: There are two exceptions, not one. In compatibility mode with MSAA, the first effect that needs HDR color (bloom, depth of field, automatic exposure and others) moves the engine to HDR color with FXAA for the rest of its run. Line 82 of the same page says this, and so do color-management line 69 and post-processing line 406. The sentence also says "the demo draws": that is an engine rule, not a demo rule.
- Evidence: `docs/concepts/post-processing.md:406` ("The first of them moves the engine to HDR color with FXAA, for the rest of its life."). `docs/concepts/backends.md:82`. `docs/concepts/quality-presets.md:204` names only the preset check.
- Proposed edit: "The mode stays fixed while the engine runs, because the scene's targets and pipelines depend on it. Two cases move it. When the start-up preset check lowers the preset, the engine draws with the lower preset's mode. In compatibility mode with MSAA, the first effect that needs HDR color moves the engine to FXAA ([The post-processing chain](post-processing.md#effects-on-devices-without-hdr-color)). A sketch's own preset change never moves it." Make the same change in quality-presets.md:204.

### 3. architecture: the page says the WebGL2 job workers always test occluders, but that test is off by default (medium, wrong-claim)

- Anchor: table "## The kinds of thread", line 42 ("On WebGL2 they also cull, hide what occluders hide"). Step 8 of "## One frame", line 72 ("test them against the occluders"). Line 106 ("On WebGL2 the job workers cull, test the occluders and list the lights").
- Claim: The three sentences read as if every WebGL2 frame tests objects against occluders. Software occlusion culling is off on every preset, and a page must ask for it with `softwareOcclusion: true`.
- Evidence: `docs/concepts/culling.md:159` ("Every quality preset leaves software occlusion culling off."). `docs/concepts/culling.md:164` (`softwareOcclusion: true`).
- Proposed edit: At each place, add "when software occlusion culling is on". For example, at line 72: "On the WebGL2 path, they also cull the objects of the cells in view, and test them against marked blockers when [software occlusion culling](culling.md#software-occlusion-culling-on-webgl2) is on."

### 4. instances: the vertex count sum is wrong (medium, wrong-claim)

- Anchor: "## Limits", last bullet, line 204: "A hull of 72 vertices drawn 30,000 times is 2,165,760 vertex shader runs".
- Claim: 72 × 30,000 is 2,160,000. The figure 2,165,760 is 72 × 30,080.
- Evidence: plain arithmetic.
- Proposed edit: "A hull of 72 vertices drawn 30,000 times is 2,160,000 vertex shader runs for one pass."

### 5. lighting: the page sends readers to the demos' private helper (`stage.lamps`) and an unlinked showcase (medium, internal-note)

- Anchor: "### A scene that shows a time of day", lines 162 and 164: "The island showcase holds its hemisphere light at 0.8 ..." and "A demo stage offers the share of a town's lamps as `stage.lamps`".
- Claim: `stage` is the demos' shared helper code, not an engine API. A developer has no `stage.lamps`. "The island showcase" has no link, so a reader cannot find it.
- Evidence: `examples/lib/stage.ts` defines the lamps share. `examples/showcase/island/sketch.ts:103-104` and `:455` use it. `packages/engine/src` has no `lamps` API.
- Proposed edit: Link the showcase: "[The island showcase](https://github.com/null3d-engine/null3d/tree/main/examples/showcase/island/) holds its hemisphere light...". Replace the `stage.lamps` sentence with: "Drive the light from a value of your own, such as the share of the town's lamps that are lit, from 0 by day to 1 at night."

### 6. instances: the options table leaves out four options (medium, missing-content)

- Anchor: "## Create a batch", the options table at lines 49-56 ("`scene.createInstances(mesh, count, options)` takes these options").
- Claim: The table lists 6 options. The type has 10. It leaves out `ranges`, `castShadows`, `receiveShadows` and `occluder`. The page mentions the shadow options later, under "Limits". It never mentions `ranges` or `occluder`, but lod.md:211 and culling.md:75 rely on them.
- Evidence: `packages/engine/src/scene/scene.ts:542-590` (`InstanceOptions`: material, dynamic, colors, values, ranges, layers, origin, castShadows, receiveShadows, occluder).
- Proposed edit: Add rows. `castShadows`, default `false`: every row casts shadows ([Shadows](shadows.md)). `receiveShadows`, default `false`: every row receives shadows. `occluder`, default `true`: rows may hide others in occlusion culling ([Culling](culling.md#which-objects-hide-others)). `ranges`, default `false`: adds a `ranges` array, one distance band per row ([Levels of detail](lod.md#distance-bands)).

### 7. All pages: the banner names the internal roadmap and its steps (medium, internal-note)

- Anchor: line 11 of every page: "> Roadmap step 0.1, first released in null3D 0.1.0." The assets banner also says "... and the upload budget are built."
- Claim: "Roadmap step" is a word from the maintainers' plan. A developer cannot look up a roadmap step, and the only release is 0.1.0. "Are built" also reads as a status report. The rules forbid internal plan words in docs/. The banner is on 103 pages.
- Evidence: `tools/lib/steps.ts:5-29` (`ROADMAP_STEPS`, `shipsSentence`). `tools/lib/docs.ts:651-658` makes the docs check demand that sentence. AGENTS.md "Writing docs": "Never mention the maintainers' milestones, checkpoints, task IDs, proposals or internal plans".
- Proposed edit: Make `shipsSentence` return "First released in null3D 0.1.0." for every roadmap step, and change the check in `tools/lib/docs.ts:651-658` and its tests (`tools/lib/docs.test.ts`, `tools/lib/steps.test.ts`) to match. In the assets banner, change "are built" to plain present facts, or drop the list: the page body states each feature.
- Generated source: `tools/lib/steps.ts`.

### 8. architecture, culling, large-worlds, lighting: grid cells and float precision are explained four times (medium, duplication)

- Anchor: architecture "## Precision far from the origin" (lines 108-112); culling "## Grid cells" and "## What this means for your sketch" (lines 174-219); large-worlds "## Grid cells" (lines 28-36) and "## Limits" (line 115); lighting "## Lights far from the origin" (line 168).
- Claim: Each page restates cell size, cell choice, per-frame 64-bit offsets and the 512-cell limit. The precision figures also change form from page to page. Architecture gives the step ("about 8 mm at 100 km"), culling gives the rounding error ("within about 4 mm"), and large-worlds gives the step again. A reader can take these as a contradiction.
- Evidence: architecture.md:110, culling.md:214, large-worlds.md:22 and :74, culling.md:217 and large-worlds.md:115.
- Proposed edit: Keep the full explanation on large-worlds. On architecture and lighting, keep one sentence and a link. On culling, keep only what culling does with cells ("Skipping cells out of view"). Change "## Grid cells" to two sentences and a link, and move the precision bullets of "What this means for your sketch" to large-worlds. Use one form for precision on every page: the step size.

### 9. architecture, backends, color-management: the final pass, the 8-bit path and the two-step upscale are described three times (medium, duplication)

- Anchor: architecture step 14 (line 104); backends "## Color and anti-aliasing on each tier" (lines 70-82, 120); color-management "## HDR color and the final pass" and "### The 8-bit path" (lines 63-71).
- Claim: All three pages describe the final pass's order (FXAA, vignette, tone curve, sRGB, dither), the split into two steps below the full render scale, and when the 8-bit path skips the final pass. The lists of effects that need the final pass differ: architecture names 4, color-management names 11. The reader cannot tell which list is complete.
- Evidence: architecture.md:104 ("such as color grading, sharpening, outlines or transmission"), color-management.md:67 (adds screen-space reflections, bounce light, soft particles, depth-reading materials, moment transparency, full-screen passes).
- Proposed edit: Make color-management the one home of the final pass and the 8-bit path. In architecture step 14, keep two sentences and link to color-management. In backends, keep the tier table and link to color-management for the order of the work. Put the full list of effects that need the final pass in one `<details>` block on color-management.

### 10. lod: no demo links and no "Related pages", and the impostors demo is plain text (medium, missing-content)

- Anchor: the whole page; line 237 ("the demo `examples/impostors` draws a forest three ways by distance").
- Claim: The page has no example links (`stats.json` lists none). The other nine pages end with "## Related pages", and this one does not. The forest demo shows trees made in code at four levels, the per-object bias and an understory with its own distance band, which is this page's core.
- Evidence: `examples/demos.ts:952-968` (forest: "Levels of detail", code `forest/`, key B toggles the hero fir's bias, key L toggles levels). `examples/demos.ts:970` (impostors, code `impostors/`).
- Proposed edit: At the end of "## Levels of meshes made in code", add: "[The levels of detail demo](https://github.com/null3d-engine/null3d/tree/main/examples/forest) plants 56,000 trees made in code at four levels." Change line 237 to "[the impostors demo](https://github.com/null3d-engine/null3d/tree/main/examples/impostors) draws a forest three ways by distance". Add a "## Related pages" list: geometry, quality presets, asset pipeline, impostors, culling, shadows.

### 11. lod: 30 long paragraphs; move the implementation detail into collapsible blocks (medium, wall-of-text)

- Anchor: file lines 23, 29, 37, 59, 93, 97, 99, 103, 107, 109, 111, 113, 115, 117, 119, 125, 127, 129, 139, 145, 160, 169, 184, 198, 211, 215, 221, 233, 235, 237 (stats lines 16 to 230). The longest are line 129 (298 words, "A mesh made in code gets pieces..."), line 127 (267 words, "A smaller list gets pieces..."), line 97 (225 words) and line 145 (206 words).
- Claim: The page is 5,956 words. A developer who wants to know when a level switches must read past the rules for vertex buffers, provoking vertices, index list sizes and piece planning. Most of it is correct and useful to implementers, but it hides the main rules.
- Evidence: stats.json `concepts/lod` longParagraphs (30 entries).
- Proposed edit: Keep one short paragraph per section. Move the rest into blocks, for example:
  - In "## Cluster levels", after line 107: `<details><summary>Technical details: how each GPU path draws the patches</summary>` holding lines 109-115 (dispatches, list sizes, 65,535-vertex parts, `WEBGL_provoking_vertex`).
  - In "## Pieces of a large level": keep line 123 and the first two sentences of line 125. Put lines 127-129 in `<details><summary>Technical details: which meshes get pieces</summary>`.
  - In "## Levels from the asset tool": keep the first three sentences of line 97. Put the `MSFT_lod`, `NULL3D_lod_error` and `MSFT_screencoverage` storage rules and line 99 in `<details><summary>Technical details: how the file stores levels</summary>`.
  - In "## How the engine picks a level": keep the formula and line 141. Put line 145 in `<details><summary>Technical details: the distance that each kind of level measures</summary>`.
  - In "## Levels from the asset tool", line 93: keep "The loader downloads a finer stage only after a view draws the level above it." Put the timing rules in a block.

### 12. architecture: the job worker paragraph is 322 words, and the frame steps are dense (medium, wall-of-text)

- Anchor: "### When the job workers start", line 47 (stats line 40, 322 words, 23 sentences). Also lines 33, 83, 89, 106, 110, 141, 143, 159 (stats 26, 76, 82, 99, 103, 134, 136, 152).
- Claim: The reader needs three facts: no job workers start at first, they start as parallel work grows, and they stay until the engine stops. The timing windows, the 0.2 ms rule, the decoder rule, the 4.5-second pause and the 18-core Mac figures are implementer detail. Some sentences cannot be read alone, such as "Each reading of the browser's clock allocates. A slow frame rate makes that wait no longer."
- Evidence: stats.json `concepts/architecture`. The cap matches `packages/engine/src/page/switches.ts:398-402` (cores less a reserve, at least 1).
- Proposed edit: Keep: "A job worker is a whole browser thread and costs about 3.5 MiB even when it waits. So the engine starts none at first. It times the parallel loops that it hands out, and starts job workers as the work grows, up to the logical cores minus 2. A small scene never starts one. `engine.mode.jobWorkers` gives the most that may start, and the stats overlay counts the ones that run." Move the rest into `<details><summary>Technical details: when the engine asks for more job workers</summary>`, and explain the clock sentence there: "The engine stops timing for 4.5 seconds after a quiet window, because each read of the browser's clock allocates memory." In "## One frame", put steps 3 to 9 of the sketch worker in a block with a two-line summary above it.

### 13. backends: 18 long paragraphs; the test switches need a table (medium, wall-of-text)

- Anchor: file lines 21, 35, 37, 60, 78, 80, 82, 84, 96, 98, 118, 120, 140, 144, 158, 168, 176, 190 (stats 14 to 183). Line 168 ("The switch `?half=on` ...", 162 words) lists five URL switches in prose. Line 190 (170 words) explains how the engine reads the user agent.
- Claim: The switches under "## Choosing a tier for testing" are a reference list written as prose. A reader cannot scan for a switch. The user-agent rules at line 190 are implementer detail.
- Evidence: stats.json `concepts/backends`.
- Proposed edit: Turn lines 162-172 into a table with three columns: switch, values, what it tests (`?gpu=`, `?uploads=copy`, `?compile=wait`, `?half=on`, `?hdr=off`, `?scene-format=`, `?prepass=`, `?occlusion=`, `?depth=`, `?compression=`, `?wake=message`). Put the `rg11b10` mantissa detail in the table cell or in a block. At line 190, keep "null3D does not support Safari before 18, and `createEngine` fails there with E1306." Move the Safari 17 faults and the user-agent rules into `<details><summary>Technical details: how the engine detects old Safari</summary>`.

### 14. lighting: a 9,783-word page; the cost sections and texture-unit rules should collapse (medium, wall-of-text)

- Anchor: file lines 76, 92, 94, 112, 114, 142, 146, 154, 168, 176, 178, 254, 329, 331, 335, 377, 417, 500, 518 (stats 69 to 511). Also "### Cost" (lines 264-284), "### Cost of probes" (319-325), "### Background cost" (506-514) and the WebGL2 texture-unit bullet at line 275.
- Claim: The page covers lights, fog, volumetric fog, environments, probes, probe grids, skies and time of day. The cost sections hold build sizes, MacBook and phone timings, and texture-unit budgets. Implementers need them, but they break up the explanation for everyone else. Line 275 alone has 120 words on WebGL2 texture units.
- Evidence: stats.json `concepts/lighting` (9,783 words, 19 long paragraphs).
- Proposed edit: Wrap each cost list in `<details><summary>Technical details: download sizes, memory and timings</summary>` and keep one sentence above it, such as "An environment from a file costs one cube map read per pixel; the built-in room and the sky's environment cost one long frame when they are made." Put line 275 in its own block: "Technical details: texture units on WebGL2". Put the device timing table (lines 277-284) in the same block as "### Cost". The page could also split into "Lights" and "Environment and sky". That is a structure question for the structure reviewer.

### 15. instances: long paragraphs, one of which repeats the culling page (medium, wall-of-text)

- Anchor: file lines 72, 130, 134, 180, 184, 194 (stats 65, 123, 127, 173, 177, 187). Line 180 ("## Culling", 238 words) restates culling.md:36-40 and :192-194. Line 194 (133 words) lists the calls that rebuild the draw tables in one sentence chain.
- Claim: The culling paragraph repeats the per-path culling rules that culling.md owns. The rebuild rule is a lookup list, and prose makes it hard to check one call.
- Evidence: culling.md:36-40, culling.md:192-194.
- Proposed edit: Cut line 180 to: "Each row has its own bounding sphere: the row's position, and the mesh's radius times the row's largest scale. `setBoundingRadius(r)` gives a batch's rows a radius of their own, for a vertex shader that moves rows far from their origins. Call it at setup, because it rebuilds the draw tables. [Culling](culling.md) explains how each GPU path culls rows." Turn line 194 into a two-column table, "Rebuilds the draw tables" and "Never rebuilds", or move it into `<details><summary>Technical details: calls that rebuild the draw tables</summary>`. Put the development check of unmarked writes (line 130, from "Development builds check the rule") in a block too.

### 16. lighting: three passages repeat each other on the same page (medium, duplication)

- Anchor: (a) line 33 and line 76, on which directional light casts shadows. (b) line 271 ("### Cost") and lines 409-410 ("## Sky and backgrounds"), on the 20-step refresh of the sky's environment. (c) line 37 and "## Lights in scene passes" (line 574).
- Claim: Each fact appears twice with different wording. Line 33 says "The first one created that remains casts the shadows". Line 76 says "The first one created that remains in the view casts the shadows". A directional light is not "in the view", so the reader cannot tell which rule holds.
- Evidence: lighting.md:33, :76, :271, :409-410, :37, :574.
- Proposed edit: (a) Keep line 76 and change it to "The first directional light created that still exists casts the shadows, when it has `castShadows`". In step 2 at line 33, write only "Standard materials reflect up to four directional lights ([below](#kinds-of-light-and-their-units))". (b) Keep the refresh steps at 409-410, and cut the refresh sentences from line 271 down to its GPU cost. (c) Delete line 37 or the last section. Keep one.

### 17. lod: the "factor" in two formulas is never defined (medium, unclear)

- Anchor: "## How the engine picks a level", line 139 ("The factor is the render height in pixels times the projection's `P[1][1]`, over twice the threshold in pixels") and "## Small objects", line 193 (`pixels = diameter × factor × threshold / distance`).
- Claim: The formula at line 136 has no term named "factor", so line 139 explains a word that the reader has not seen. The formula at line 193 multiplies by the threshold, and the factor divides by it, so the threshold cancels. The reader must work this out alone.
- Evidence: lod.md:136, :139, :193.
- Proposed edit: Write one formula with named parts: "pixels = size × H × P[1][1] / (2 × distance), where H is the render height in pixels and P[1][1] = 1 / tan(fov / 2)". Then say: "a level switches in where its error × scale gives fewer pixels than `lodThreshold`. An object hides where its diameter gives fewer pixels than `lodThreshold`." Put the bias's effect on the factor (line 153) in one sentence: "The bias divides the pixels."

### 18. lod: "the governor" appears before it is explained or linked (medium, term-before-definition)

- Anchor: line 37 ("the governor can raise it to 4 or 8 pixels"), line 166 and line 178.
- Claim: "Governor" first appears at line 37 with no explanation and no link. Line 139 says "frame-budget governor" but has no link either. Architecture links the term to quality-presets#dynamic-resolution.
- Evidence: architecture.md:66 links "[dynamic resolution and the frame-budget governor](quality-presets.md#dynamic-resolution)".
- Proposed edit: At line 37: "... and the [frame-budget governor](quality-presets.md#dynamic-resolution), which lowers quality when frames run late, can raise it to 4 or 8 pixels."

### 19. architecture, backends, culling: "draws directly", "bucket" and "the probe" are used before they are explained (medium, term-before-definition)

- Anchor: architecture line 92 ("On a device that draws directly, the job workers cull on the CPU"); backends line 35 ("each bucket draws directly"); culling line 38 ("The probe takes the direct path only when...").
- Claim: Architecture is the entry page, and it uses "draws directly" with no explanation. Backends explains it later, at line 118. "Bucket" appears in backends and culling, but the pages call the same thing "group". "The probe" in culling means the probe worker, which only architecture names (line 43).
- Evidence: backends.md:118, architecture.md:43.
- Proposed edit: Architecture line 92: "On an Apple GPU in Safari, a start-up test can pick direct draws, where the job workers cull on the CPU as on WebGL2 ([GPU tiers and backends](backends.md#capability-flags))." Backends line 35 and culling line 38: write "group" for "bucket". Culling line 38: write "The start-up test takes the direct path...".

### 20. instances: the quaternion rule is hard to follow (medium, unclear)

- Anchor: "## The row arrays", line 74: "The engine scales a rotation whose length is more than about one per cent from unit length. A quaternion inside that band is used exactly as written, so a rounded rotation is not moved, but one that is wrong all the same can shear its row by up to about four per cent. Well outside the band, a mistyped quaternion is scaled and only turns its row."
- Claim: "Wrong all the same" and "only turns its row" do not tell the reader what to do. The rule is: write unit quaternions, because the engine does not fix small errors.
- Evidence: `crates/null3d-core/src/math.rs:67-96` (within about 1% of unit length, used as is; beyond that, scaled).
- Proposed edit: "Write unit quaternions. The engine uses a quaternion within about 1% of unit length as written, so a small error stretches or shears the row by up to about 4%. It scales a quaternion further from unit length, so a larger error only turns the row." Then the existing sentence on the math helpers.

### 21. color-management: the intro says the scene always draws into an HDR target (low, wrong-claim)

- Anchor: line 25 ("The scene therefore draws into a high dynamic range (HDR) target.") and the Mermaid diagram (`HDR scene color` before the final pass).
- Claim: On the 8-bit path, which compatibility mode with MSAA and some WebGL2 devices take, the scene does not draw into an HDR target, and the shaders tone map. The page says so at line 67. A reader of the intro alone gets the wrong picture.
- Evidence: color-management.md:67, backends.md:75-76.
- Proposed edit: "On most devices the scene therefore draws into a high dynamic range (HDR) target. Devices without a float target draw an 8-bit path ([below](#the-8-bit-path))."

### 22. assets: the list of 32 glTF extensions is inside a paragraph (medium, wall-of-text)

- Anchor: "## Models and prefabs", line 43 (stats line 36), "It reads these extensions: `KHR_mesh_quantization`, ...".
- Claim: A developer who asks "does it read `KHR_materials_sheen`?" must scan a run of 32 code names. The useful rule (a file that requires another extension fails with E1417; a file that only uses one draws without it) is at the end.
- Evidence: stats.json `concepts/assets` line 36.
- Proposed edit: Keep "The loader reads `.glb` files, and `.gltf` files with the files they name. A file that requires an extension the loader does not read fails with E1417. A file that only uses one draws without it." Then put the extension list in `<details><summary>Technical details: the glTF extensions that the loader reads</summary>` as a bulleted list grouped by kind (compression, textures, materials, scene).

### 23. assets: other long paragraphs (low, long-paragraph)

- Anchor: file lines 25, 29, 49, 59, 61, 63, 67, 118, 126 (stats 18, 22, 42, 52, 54, 56, 60, 111, 119). Line 67 ("`assets.loadTexture` loads PNG, ...", 146 words) mixes formats, decoders, transcoding workers and the cache.
- Claim: Line 67 holds four topics. Line 118 on meshopt blocks over 256 MiB is implementer detail.
- Evidence: stats.json `concepts/assets`.
- Proposed edit: Split line 67 into "formats" and "KTX2 transcoding". Put line 118 in `<details><summary>Technical details: meshopt blocks and the 256 MiB limit</summary>`.

### 24. culling: benchmark names S1, S6 and S1-cells mean nothing to a reader (low, unclear)

- Anchor: culling line 159 ("in S6, its benchmark city"), line 196 ("The benchmark scene S1-cells"); architecture line 124 ("In the S1 benchmark").
- Claim: The rules ask the docs to name the benchmark behind a figure, but the reader learns nothing from "S1". The page gives no link or description. Architecture does not say what S1 draws.
- Evidence: architecture.md:124, culling.md:159, :196.
- Proposed edit: Describe each benchmark once where it is cited, such as "the engine's S1 benchmark, 100,000 moving boxes". Link to a public page of benchmarks if one exists. Move the S1-cells sentence (line 196) into a block or delete it: it gives no figure.

### 25. lighting: internal test setup in the cost section (low, internal-note)

- Anchor: "### Cost", line 277: "The tests of the room's generator measured these times in Chrome. The phones ran in a device cloud, on a page with no shader cache."
- Claim: "The tests of the room's generator" and "a device cloud" describe the maintainers' test setup. The reader needs the conditions (Chrome, no shader cache), not the test's name.
- Evidence: lighting.md:277.
- Proposed edit: "These times come from Chrome, with no shader cache." Put the table and this sentence in the block from finding 14.

### 26. lighting, color-management, lod: British spellings in American English pages (low, polish)

- Anchor: lighting line 335 ("colour", "coloured"), line 357 ("metre"); color-management line 77 ("honours"); lod lines 107 and 111 ("Neighbours", "neighbours").
- Claim: Every other line and the API use American spelling ("color", "meter", `colorSpace`).
- Evidence: the lines above.
- Proposed edit: color, colored, meter, honors, neighbors.

### 27. handles: the stale-handle paragraph mixes rules for each build (low, long-paragraph)

- Anchor: "## Stale handles", line 75 (stats line 68, 131 words).
- Claim: The paragraph states what release builds do, what the core logs, what batch arrays throw, and when world getters throw. The main point (a call on a destroyed object never harms the object that takes its slot) gets lost. The page also never says that a slot's generation wraps after 1,024 reuses, or that a dead wrapper keeps a reserved generation that never matches.
- Evidence: `crates/null3d-core/src/handle.rs:1-31` (slot 0 never handed out; `REUSE_DELAY` 1,024; `DEAD_GENERATION` never handed out).
- Proposed edit: Keep the first and last sentences of line 75. Put the rest in `<details><summary>Technical details: what each build does with a destroyed object</summary>`, and add: "Slot 0 is never used, so handle 0 means none. A destroyed object's wrapper keeps a generation that no live object gets, so it never matches a later object in its slot."

### 28. large-worlds: "no free cell" is unclear, and the test flight is implementer detail (low, unclear)

- Anchor: "## A moving camera", line 97 ("A test checks this with a flight...") and line 99 ("The same flight without large-world mode, or with no free cell, jitters.").
- Claim: "With no free cell" means "when all 512 cells are in use". The reader meets that limit only later, at line 115. The test's camera path (six squares, 12 cm a frame, 16 frames) is useful only to implementers.
- Evidence: large-worlds.md:115.
- Proposed edit: Line 99: "... or when all 512 cells are in use ([Limits](#limits)), jitters." Put lines 97-99 in `<details><summary>Technical details: how the engine tests a moving camera</summary>` and keep one sentence above it: "A camera that flies past objects 1,000 km out, or at the Earth's radius, in large-world mode, moves them on screen as smoothly as at the origin, on every GPU path."

### 29. large-worlds: the "420 km²" limit assumes the largest device limit (low, wrong-claim)

- Anchor: "## Limits", line 116: "A city of 20,000 objects per square kilometer reaches that most at about 420 km² of flat ground: about 420 cells."
- Claim: 20,000 × 420 is 8.4 million, the most that a device with large storage bindings holds. A device with WebGPU's default limits holds 2,097,152, which is about 105 km². On WebGL2 with small textures, it is about 52 km². The sentence does not say which device it means.
- Evidence: backends.md:138-144 (2,097,152 by default; 8,388,480 at most; 1,048,576 on the smallest WebGL2 textures).
- Proposed edit: "A city of 20,000 objects per square kilometer reaches a device's limit long before it fills the cells: at about 105 km² with WebGPU's default limits, and about 420 km² on a device that allows the most."

### 30. backends: the occlusion row and the `?occlusion=` switch leave out software culling (low, missing-content)

- Anchor: the table under "## How each path draws", row "Occlusion culling", line 49 (WebGL2 cell: "Not on the GPU"); "## Choosing a tier for testing", line 168 ("`?occlusion=on` or `?occlusion=off` turns GPU occlusion culling on or off").
- Claim: On WebGL2, software occlusion culling exists and is off by default. The same `?occlusion=` switch turns it on or off (culling.md:167). Backends mentions neither.
- Evidence: culling.md:159-172.
- Proposed edit: WebGL2 cell: "On the job workers, against marked blockers, when `softwareOcclusion` is on ([Culling](culling.md#software-occlusion-culling-on-webgl2))". Line 168: "... turns occlusion culling on or off: on the GPU on WebGPU, and on the job workers on WebGL2."

### 31. lighting: unclear advice on setter inlining (low, unclear) — not verified

- Anchor: line 30: "Call a per-frame setter from a small function of its own, so the browser inlines it."
- Claim: The reader cannot tell why a setter inside a large function would be slower, or by how much. Without a figure or a reason, this reads as folklore.
- Proposed edit: Give the reason and a figure, or delete the sentence.

### 32. lod: the banner's limits are hard to parse (low, unclear) — not verified

- Anchor: line 11: "A skinned object draws a level while the level names the base mesh's own vertices, as the asset tool's levels do. ... A distance band cuts at once for them too."
- Claim: "While the level names the base mesh's own vertices" is unclear. "For them" has no clear referent (hash masks?).
- Proposed edit: "A skinned object draws a level only when the level shares the base mesh's vertices, as the asset tool's levels do. Masks with the `'hash'` alpha mode switch levels and cross distance bands at once, with no fade."

### 33. lod: the direct-draw WebGPU path is missing from the opening claim (low, missing-content) — not verified

- Anchor: line 25: "The engine picks the level on the GPU on WebGPU, and on its job workers on WebGL2."
- Claim: Line 119 says the direct-draw WebGPU path has no cluster pass. On that path the job workers cull, so they probably pick levels too. The opening does not say so.
- Proposed edit: "... on the GPU on WebGPU, and on its job workers on WebGL2 and on a device that draws directly."

### 34. architecture: the skinning step has a broken sentence (low, unclear) — not verified

- Anchor: pass list, item 3, line 93: "It also skins the meshes that a debug view or a full shader of the sketch's draws."
- Claim: "A full shader of the sketch's draws" does not parse.
- Proposed edit: "It also skins the meshes that a debug view draws, and the meshes that the sketch's full custom shaders draw."

### 35. color-management: the list of effects that need the final pass is a long sentence chain (low, long-paragraph) — not verified

- Anchor: "### The 8-bit path", line 67 (stats line 60, 152 words).
- Claim: Eleven effects are listed over two sentences ("Such effects are ... So are ..."). See finding 9.
- Proposed edit: A bulleted list in `<details><summary>Technical details: effects that need the final pass</summary>`.

### 36. assets: "the sample models" is not explained (low, unclear) — not verified

- Anchor: "## Limits on each file", line 116: "The sample models decode to at most 3 times their bytes".
- Claim: The reader does not know which sample models (Khronos glTF samples? the engine's test models?).
- Proposed edit: "The Khronos glTF sample models decode to at most 3 times their bytes" (if that is the set), or name the engine's test set.

### 37. culling: the culling page names WebGL2 custom materials as non-blockers, but GPU culling lets them hide (low, unclear) — not verified

- Anchor: line 73 ("A custom material that moves its vertices hides others with its own vertex shader") and line 139 ("Objects that ... use a custom material or are skinned never block").
- Claim: Both are correct for their own path. They sit far apart and do not name their path in the sentence, so a reader can take them as a contradiction.
- Proposed edit: Line 139: "On WebGL2, objects that blend, ... use a custom material or are skinned never block."

### 38. architecture: the latency table and "Where the sketch runs" table overlap (low, duplication) — not verified

- Anchor: "## Latency modes" (lines 116-122) and "## Where the sketch runs" (lines 132-139).
- Claim: Both tables list pipelined, low latency and single-threaded modes. The second adds the main-thread variants. A reader compares two tables to get one picture.
- Proposed edit: Keep the second table and add the "Added latency" column to it. Keep the frame-rate cost text of "Latency modes" as prose under it.

## Screenshots and demos, per page

Reference images live in `tests/image/references/chrome-real-gpu/<tier>/demo-<name>.png` for the tiers `webgpu`, `compat` and `webgl2`. Every demo named below has a reference image on all three tiers.

### concepts/architecture

Screenshots:
- `stats-overlay-threads` (scripted): the stats overlay on the instances demo, showing the CPU time of the sketch worker, the render worker and each job worker, and the count of job workers that run. Place it at the end of "### When the job workers start". Steps: open the instances demo with `?stats` on WebGPU on a desktop, wait 3 seconds for the job workers to start, capture the overlay with the scene behind it. Alt: "The stats overlay over 100,000 columns, with a row of CPU time for each thread and the number of job workers."
- `devtools-threads` (manual): the browser's Performance panel during one frame, with the main thread, the sketch worker, the render worker and the job workers as separate tracks. Place it under "## The kinds of thread". Alt: "The browser's performance panel, with one track for each null3D thread."

Demo links:
- instances, under "### When the job workers start": "[The instance batch demo](https://github.com/null3d-engine/null3d/tree/main/examples/instances/) moves 100,000 columns and starts its job workers as the work grows."

Concepts with no demo: latency modes; `sketchThread: 'main'`; the single-threaded build; the passes of a frame; the engine's lifetime (`destroy`, `detach`, `attach`).

### concepts/assets

Screenshots:
- `gltf-model` (reference, `tests/image/references/chrome-real-gpu/webgpu/demo-gltf-model.png`): the BoomBox model with all its maps from the file. Place it under "## Models and prefabs". Alt: "The Khronos BoomBox on a turntable, with its color, normal, roughness and emissive maps from the glTF file."
- `devtools-decoder-download` (manual): the browser's Network panel, filtered to WebAssembly, showing that the meshopt decoder downloads only with the first meshopt file. Place it under "### Compressed meshes". Alt: "The network panel, with the meshopt decoder as one small download after the model file."

Demo links:
- gltf-model, under "## Models and prefabs": https://github.com/null3d-engine/null3d/tree/main/examples/gltf-model/
- mesh-arrays, under "## Meshes and vertex data": https://github.com/null3d-engine/null3d/tree/main/examples/mesh-arrays/

Concepts with no demo: Draco compression; KTX2 textures and UASTC HDR; integer vertex attributes; the limits on each file; the texture upload budget; `prefab.destroy`.

### concepts/backends

Screenshots:
- `three-tiers` (scripted): the environment demo's reference images on WebGPU, compatibility mode and WebGL2, side by side, to show that one sketch draws the same on each tier. Place it under "## The three tiers". Steps: join `webgpu/demo-environment.png`, `compat/demo-environment.png` and `webgl2/demo-environment.png` into one image with a label under each. Alt: "The same sphere gallery drawn on WebGPU, WebGPU compatibility mode and WebGL2."
- `depth-modes` (scripted): z-fighting at long range with `?gpu=webgl2&depth=standard` beside `?depth=reversed`, on a scene of two surfaces 1 cm apart. Place it under "## Depth on each tier". Steps: use the depth precision test page (`tests/image/depth.spec.ts`), camera 250 m out, near plane 0.1 m. Alt: "Two surfaces 1 cm apart, 250 m away: standard depth flickers, reversed depth stays clean."
- `devtools-capabilities` (manual): the browser console with `engine.capabilities` expanded, showing `tier`, `hdr`, `depth`, `directDraws` and `drawPath`. Place it under "## Capability flags". Alt: "The console with the engine's capability flags expanded."

Demo links: none fits the tier rules directly.

Concepts with no demo: tier choice; capability flags; the portable budget; devices with two GPUs; device loss; minimum browsers.

### concepts/color-management

Screenshots:
- `tone-mapped` (reference, `tests/image/references/chrome-real-gpu/webgpu/demo-tone-mapped.png`): two rows of seven colors, with `toneMapped: false` and without. Place it under "### Materials that keep their display color". Alt: "Two rows of the same seven bright colors: the top row keeps its display color, the bottom row takes the tone curve."
- `tone-curves` (scripted): the gltf-model demo drawn with each `toneMapping` value (`agx-punchy`, `agx`, `aces`, `neutral`, `none`) in a row. Place it under "## Exposure and tone mapping". Steps: open the demo in hold mode, set `post.set({ toneMapping })` for each value, capture the same frame. Alt: "One model under five tone curves."
- `color-space-wrong` (scripted): a normal map loaded with `colorSpace: 'srgb'` beside the same map with `'linear'`. Place it under "## Texture color spaces". Steps: a test page with two spheres and one normal map. Alt: "A normal map read as color looks flat and dark; read as data it shows its bumps."

Demo links:
- tone-mapped (already linked).
- auto-exposure, under "## Exposure and tone mapping" after the paragraph on automatic exposure: https://github.com/null3d-engine/null3d/tree/main/examples/auto-exposure/

Concepts with no demo: texture color spaces; the 8-bit path against the HDR path; transparent canvases; exact background colors.

### concepts/culling

Screenshots:
- `far-from-origin` (reference, `tests/image/references/chrome-real-gpu/webgpu/demo-far-from-origin.png`): keys 2 cm wide, 1,000 km from the origin. Place it under "## What this means for your sketch". Alt: "A tray of small keys and a brass wheel, drawn sharp 1,000 km from the origin."
- `occlusion-on-off` (scripted): the stats overlay's `occludedEntries` and `gpuMs` with `?occlusion=on` beside `?occlusion=off`, on a scene with buildings. Place it under "### The check during play". Steps: open compare/night-town on WebGPU on the High preset with `?stats&occlusion-check=off`, capture once with `?occlusion=on` and once with `?occlusion=off` from the same camera. Alt: "The same street with GPU occlusion culling on and off, and the count of hidden objects in the stats overlay."

Demo links:
- far-from-origin (already linked under "Related pages"; move it up under "## What this means for your sketch").
- large-world, under "## Grid cells": https://github.com/null3d-engine/null3d/tree/main/examples/large-world/
- instances, under "## How each path culls": https://github.com/null3d-engine/null3d/tree/main/examples/instances/

Concepts with no demo: GPU occlusion culling (no demo toggles it); software occlusion culling on WebGL2; blockers from the asset tool; `setBounds` and `setFrustumCulled`.

### concepts/handles

Screenshots:
- `devtools-stale-handle` (manual): the browser console in a development build, showing the E1101 message that names the object, its slot and the frame it was destroyed in. Place it under "## Stale handles". Alt: "The console with error E1101 for a call on a destroyed crate."

Demo links:
- objects, under "## Wrapper objects": https://github.com/null3d-engine/null3d/tree/main/examples/objects/
- math, under "## Keep per-object data in your own arrays": https://github.com/null3d-engine/null3d/tree/main/examples/math/ (300 drones with per-drone data and no allocation).

Concepts with no demo: the handle's bit layout; slot reuse.

### concepts/instances

Screenshots:
- `instances` (reference, `tests/image/references/chrome-real-gpu/webgpu/demo-instances.png`): 100,000 columns in one batch. Place it under the opening paragraphs. Alt: "100,000 columns of different heights in one instance batch at golden hour."
- `per-row-colors` (scripted): the page's own per-row colors sketch, ten spheres with ten hues. Place it under "## Per-row colors". Steps: draw the code block in hold mode. Alt: "Ten spheres in one batch, each in its own color."

Demo links:
- instances (already linked).
- math, under "## The row arrays": https://github.com/null3d-engine/null3d/tree/main/examples/math/
- splats, under "## Rows that arrive in chunks": https://github.com/null3d-engine/null3d/tree/main/examples/splats/
- sprites-lines and galaxy, under "## Related pages", beside the sprite and point links.

Concepts with no demo: pools and `setActiveCount`; static batches and `markDirty`; automatic batching; per-row values.

### concepts/large-worlds

Screenshots:
- `large-world` (reference, `tests/image/references/chrome-real-gpu/webgpu/demo-large-world.png`): a road on the Earth's surface with sharp 15 cm lane marks. Place it under "## Large-world mode". Alt: "A road at golden hour, 6,378 km from the origin, with sharp lane marks."
- `jitter-compare` (scripted): two frames of the same flight at the Earth's radius, with and without `largeWorld`, with an overlay of the squares' movement. Place it under "## A moving camera". Steps: the camera flight of line 97, frames 0 and 1, both modes. Alt: "Without large-world mode, squares jump several pixels between frames; with it, they move smoothly."

Demo links:
- large-world (already linked).
- far-from-origin, under "## Grid cells": https://github.com/null3d-engine/null3d/tree/main/examples/far-from-origin/

Concepts with no demo: floating-origin geometry; depth far from the camera; the cell limit.

### concepts/lighting

Screenshots:
- `area-lights` (reference, `tests/image/references/chrome-real-gpu/webgpu/demo-area-lights.png`): rectangle and tube lights on a wet street. Place it under "## Kinds of light and their units", after the paragraph on rectangle and tube lights. Alt: "Shop windows and a neon sign as area lights, stretched in a wet street."
- `light-shafts` (reference, `tests/image/references/chrome-real-gpu/webgpu/demo-light-shafts.png`): rays of a low sun through pines. Place it under "### Volumetric fog". Alt: "Sun rays through a pine wood in haze, with the trunks' shadows in the fog."
- `environment` (reference, `tests/image/references/chrome-real-gpu/webgpu/demo-environment.png`): rough and smooth spheres in an environment's light. Place it under "## Environment maps". Alt: "Plastic and metal spheres, rough to smooth, lit only by an environment."
- `reflection-probes` (reference, `tests/image/references/chrome-real-gpu/webgpu/demo-reflection-probes.png`): two rooms over one floor. Place it under "## Reflection probes". Alt: "A warm room and a cool room over one polished floor, each reflected in place."
- `atmosphere` (reference, `tests/image/references/chrome-real-gpu/webgpu/demo-atmosphere.png`): the physical sky over a valley. Place it under "### The physical sky". Alt: "A valley under the physical sky, with ridges hazed by distance."
- `time-of-day-presets` (scripted): the time-of-day demo at the four presets `afternoon`, `goldenHour`, `blueHour`, `night`, side by side. Place it under the preset table in "## Time of day". Steps: hold mode, set each hour (15:00, 17:36, 18:24, 23:00), capture from the default camera. Alt: "One lighthouse at four times of day."
- `volumetric-presets` (scripted): the light-shafts demo at Medium, High and Ultra, to show the effect of `fogSlices`. Place it after the `fogSlices` paragraph. Steps: `?preset=medium`, `high`, `ultra`, same frame. Alt: "Sun rays in fog at three quality presets."

Demo links:
- environment, time-of-day (already linked).
- area-lights, under "## Kinds of light and their units": https://github.com/null3d-engine/null3d/tree/main/examples/area-lights/
- math, under "## Clustered forward shading": https://github.com/null3d-engine/null3d/tree/main/examples/math/ (300 drones, each with its own light).
- compare/night-town, under "## Clustered forward shading": https://github.com/null3d-engine/null3d/tree/main/examples/compare/night-town/
- showcase/island, under "### A scene that shows a time of day": https://github.com/null3d-engine/null3d/tree/main/examples/showcase/island/
- light-shafts, under "### Volumetric fog": https://github.com/null3d-engine/null3d/tree/main/examples/light-shafts/
- reflection-probes, under "## Reflection probes": https://github.com/null3d-engine/null3d/tree/main/examples/reflection-probes/
- atmosphere, under "### The physical sky": https://github.com/null3d-engine/null3d/tree/main/examples/atmosphere/

Concepts with no demo: lights in real units with `ev100`; the light probe grid; hiding where the land ends with haze sheets; ambient and hemisphere lights alone.

### concepts/lod

Screenshots:
- `forest` (reference, `tests/image/references/chrome-real-gpu/webgpu/demo-forest.png`): 56,000 trees made in code at four levels. Place it under the opening paragraphs. Alt: "A mixed forest over rolling hills, each tree at its own level of detail."
- `levels-view` (scripted): the forest demo with `?view=levels`, each level in its color and the fade bands dithered. Place it under "## See the levels". Steps: development build, `?view=levels`, default camera. Alt: "The forest in the levels view: blue near trees, cyan and gray far ones."
- `bias-compare` (scripted): the forest demo's hero fir with its bias on and off (key B), cropped to the fir. Place it under "## The bias of one object". Alt: "The hero fir keeps its detail beside coarser trees of the same distance."
- `impostors` (reference, `tests/image/references/chrome-real-gpu/webgpu/demo-impostors.png`): a forest drawn three ways by distance. Place it under "## Cards beyond the levels". Alt: "A pine forest: meshes near, merged cells in the middle, cards far out."

Demo links:
- forest, under "## Levels of meshes made in code": https://github.com/null3d-engine/null3d/tree/main/examples/forest/
- forest, under "## The bias of one object" (key B).
- forest, under "## Distance bands" (the understory fades out at its own distance).
- impostors, under "## Cards beyond the levels": https://github.com/null3d-engine/null3d/tree/main/examples/impostors/
- terrain, under "## Fading between levels", for the terrain add-on's morph: https://github.com/null3d-engine/null3d/tree/main/examples/terrain/

Concepts with no demo: cluster levels; pieces of a large level; staged downloads (`--stages`, `maxLevels`); a material per level; shadow-map levels.
