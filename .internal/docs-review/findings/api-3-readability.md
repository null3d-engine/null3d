# Readability and layout review: slice api-3

Pages: api/raycast, api/render, api/scene, api/sketch, api/sound, api/splats, api/sprites, api/tasks, api/terrain, api/textures, api/three-compat, api/time, api/ui, api/vertex-draws, api/water, api/wind.

All pages in this slice are written pages (`docs/api/<id>.md`), so the file to edit is the page itself, except where a finding names another source.

Line numbers are file lines in `docs/api/<id>.md`. The line numbers in stats.json count from the end of the front matter, so they are 7 lower (stats line 64 on api/scene is file line 71).

The "technical details block" in the proposals is this form. The main text must still make sense with every block closed. Put no headings and no nested blocks inside.

```
<details>
<summary>Technical details: what is inside</summary>

Markdown body.

</details>
```

Findings 1 to 30 are verified against the page text. Findings 31 to 41 are lower ranked and marked "not verified".

---

## 1. api/wind: a 190-line WGSL copy blocks the page, and the concept comes after it

- Severity: high. Category: technical-details-block.
- Anchor: "## Reading the field in your own WGSL", lines 79 to 328.
- Claim: Right after the calls table, the page shows two WGSL blocks of about 190 lines (lines 83 to 224 and 226 to 270). A reader who wants to know what the field is, how presets change it, or what it costs must scroll past all of it. "## What the field is" (line 330) comes after this wall, so the plain explanation follows the deepest detail.
- Evidence: line 81 "Copy both from `shaders/field.wgsl` in the package, or from the blocks below." Line 328 "Tests hold the readers' blocks equal to this page's." stats.json: 4,060 words, headings jump from "The calls" to the WGSL section.
- Proposed edit:
  1. Move "## What the field is" (lines 330 to 344) to come right after "## The calls".
  2. In "## Reading the field in your own WGSL", keep lines 81, 272, 290 to 324 in the main text: the short uniforms example and the `vertexOffset` example.
  3. Put each copy block in a technical details block: `<summary>Technical details: the steady field block to copy (wind-steady)</summary>` and `<summary>Technical details: the sampling block to copy (wind-sample)</summary>`. Keep the `// <wind-steady>` markers unchanged inside the code fences, so the test that compares the blocks still finds them.
  4. Change line 81 to "Copy both from `shaders/field.wgsl` in the package, or open the two blocks below."
- Generated source: none.

## 2. api/sketch: the context table, the page's main reference, sits under module-loading detail

- Severity: high. Category: scan-order.
- Anchor: "## The context", line 112.
- Claim: A newcomer opens this page to learn what the setup gets and which callbacks exist. The context table is at line 112 and the callbacks at line 165. Before them come module retry rules (E1401, E1410), top-level code and core download timing, hold-mode seeding, the download list and the serial-load warning. Those are advanced loading topics.
- Evidence: headings order in stats.json: "Where the sketch runs", "The setup function", "Options", "The download list", "Loads one after another", "The context", "The engine field", "The callbacks". Line 45 starts "A module whose default export is not `defineSketch(...)` fails the start with E1401".
- Proposed edit: Reorder to: intro and example; "The setup function"; "The context"; "The callbacks"; "When changes show"; "Example: a camera that follows a moving object"; "The engine field"; "Options" with "The download list" and "Loads one after another"; "Where the sketch runs"; "Errors in callbacks". Put the E1401/E1410 retry text (line 45) and the top-level-code timing (line 47) in one technical details block, `<summary>Technical details: how the engine loads the module</summary>`. Keep one main-text sentence: "Code at the top of the module runs before the engine starts, so it must not call the engine."
- Generated source: none.

## 3. api/scene: an 8,672-word page that should split

- Severity: medium. Category: split-page.
- Anchor: "## The camera and the background" (line 113) to "## Time of day" (line 516).
- Claim: The scene page is the first API page a newcomer opens, to create meshes and cameras. About two thirds of it is backgrounds, skies, sky layers for add-on authors, environment light, probe grids, reflection probes, fog and time of day. The object calls (creation, models, find, views, override, change timing, warm-up, limits) get lost.
- Evidence: stats.json: 8,672 words, 28 paragraphs over the limit, 24 headings. Sky and lighting sections run from line 113 to 551.
- Proposed edit: Split into three pages and link them from a short "Backgrounds, light and fog" paragraph on api/scene:
  - api/scene keeps: What the scene creates, Models and copies, Finding objects by name, the first paragraph of The camera and the background (active camera and a color background), Multiple views, Lights, Decals, Drawing every mesh with one material, When changes take effect, Warm-up, Instance batches, Limits.
  - New page "Backgrounds and skies" (for example api/sky): texture backgrounds, Environments, cube maps and the sky, The physical sky, Sky layers, Time of day.
  - New page "Environment light and fog" (for example api/environment): The environment, The light probe grid, Reflection probes, Fog, Volumetric fog.
  - Add both new pages to PAGES and AREAS in `tools/lib/docs.ts`, and fix the anchors that other pages link to (for example `scene.md#time-of-day`, `scene.md#multiple-views`).
- Generated source: tools/lib/docs.ts (PAGES entry for the new pages only).

## 4. api/terrain: no options table and no table of the terrain object

- Severity: high. Category: missing-content.
- Anchor: "## How it works", lines 68 to 106.
- Claim: `createTerrain` takes many options, but the page gives them only inside prose: `size`, `height`, `camera`, `layers` (with `map`, `tile`, `roughness`, `heightFrom`, `contrast`), `splat`, `error`, `maxLevel`, `bakedNormals`, `steepFaces`, `morph`, `blocksPerUpdate`, `maxBlocks`. The terrain object's members (`update`, `heightAt`, `normalAt`, `building`, `setVisible`, `setTint`) are spread over "Placing things on the ground" and the end of a 169-word paragraph in "Speed". A reader cannot scan for an option or its default.
- Evidence: line 76 "The `error` option sets the allowed error in pixels."; line 104 "`terrain.setVisible(false)` hides the ground ... `terrain.setTint(color)` multiplies the ground's own colors". The water, sprites and render pages give an options table for each create call.
- Proposed edit: After the example, add "## Options" with a table (Option, Takes, Default, What it sets) of every option above, and a "## The terrain object" table of its members. Then cut the option definitions out of the prose in "How it works", "Layers and the splat map" and "Speed", and keep only the explanation of what each part does.
- Generated source: none.

## 5. api/water, api/sound, api/wind: the API reference link has no "API reference" heading

- Severity: medium. Category: structure.
- Anchor: water line 477, sound line 168, wind line 374.
- Claim: On these three pages the link to the generated reference is a loose paragraph at the end of "Costs and limits". Every other page in the slice puts it under "## API reference". A reader who scans the headings does not find the reference. The rule in AGENTS.md says the written page links to it under its "API reference" heading. On api/water the paragraph also sits above "## Related pages", so the order differs from the rest. api/wind has no "Related pages" section at all.
- Evidence: stats.json headings for api/water, api/sound and api/wind have no "API reference" entry. AGENTS.md, "Docs and skills stay in sync", rule 5.
- Proposed edit: On each page, put "## Related pages" (add one to api/wind: links to grass, water, features and quality) and then "## API reference" as the last heading, with the existing link paragraph under it.
- Generated source: none. The docs check in tools/lib/docs.ts could also test for the heading, so the gap cannot come back.

## 6. api/scene: 28 long paragraphs

- Severity: medium. Category: long-paragraph.
- Anchor: lines 71, 75, 88, 115, 117, 158, 177, 206, 208, 242, 246, 252, 296, 298, 319, 321, 323, 341, 347, 375, 412, 450, 488, 512, 518, 549, 579, 583.
- Claim: 28 paragraphs go past 4 sentences or 90 words. The worst are line 296 (148 words in 3 sentences), line 246 (157 words), line 488 (185 words), line 341 (166 words, 12 sentences), line 375 (160 words) and line 518 (154 words, 11 sentences).
- Evidence: stats.json longParagraphs for api/scene.
- Proposed edit (how to break each kind):
  - Option lists in prose (line 71 object options; line 518 timeOfDay arguments): turn into a bulleted list or add the options to the table that already follows.
  - Lines 246, 341, 412, 452, 488 (end), 514: these end in error codes. Move the codes to an Errors table (see finding 13) and the rest falls under 90 words.
  - Line 296 and line 298 (how a sky layer reaches the environment map, the nine diffuse coefficients, fills over twenty frames): keep one main-text sentence, "The layer also shows in reflections and in the sky's light on the scene.", and put the rest in `<summary>Technical details: how a sky layer reaches the environment map</summary>`.
  - Lines 319 to 323 (multiple views): turn into three bullet groups, "What a view draws", "What a view costs", "What a view leaves out". The 8-bit path sentence (line 319, last two sentences) goes in a technical details block.
  - Line 347 (LightProbeGridData packing: L0 and L1 order, validity, sky visibility): technical details block, `<summary>Technical details: what each probe holds</summary>`.
  - Line 375 (bakeProbes ray rules): numbered steps, "1. Rays that reach the sky ... 2. Rays that meet a back face ... 3. Rays that meet a front face ...", then one closing sentence on what the bake leaves out.
  - Line 177 (cloudSteps tiers, WebGL2 limits, environment-map limits): split into "Which clouds draw" (two sentences) and a details block for the environment map's 16-step limit and start-time rule.
  - Lines 75, 88, 115, 117, 158, 206, 208, 242, 252, 450, 512, 549, 579, 583: break after the fourth sentence, at the change of topic (for example line 75 breaks before "The engine reserves the places").
- Generated source: none.

## 7. api/render: the E1220 row is a 170-word wall in one table cell

- Severity: medium. Category: wall-of-text.
- Anchor: "## Errors", line 474.
- Claim: The E1220 cell lists about 25 different causes in one run of sentences. In a table cell it cannot wrap into a list, so a reader cannot find the cause of the error they got.
- Evidence: line 474 starts "Options that `render.addPass` does not take, a `writes` or `name` that another pass has, or a 32nd pass. Both a `size` and a `scale` ..." and ends with the list of eight calls.
- Proposed edit: Keep the table row short: "E1220 | An option or value that a pass does not take. The list below gives each cause." Under the table add a list grouped by pass kind: "Any pass", "Scene passes", "Reflection passes", "Full-screen passes", "Compute passes", "render.readPass", "Calls given something that is not a pass". Each bullet holds one cause.
- Generated source: none.

## 8. api/render: long paragraphs, and dense path detail in the main text

- Severity: medium. Category: technical-details-block.
- Anchor: lines 21, 67, 81, 146, 152, 382, 395, 441, 445; bullets at lines 58 and 465.
- Claim: Nine paragraphs are over the limit. The intro (line 21, 124 words) names four pass kinds in one paragraph. "What a scene pass draws" (line 67) and "What a reflection draws" (line 146) are lists written as prose. Line 395 (208 words, 13 sentences) gives the memory of a history pass. Line 152 gives benchmark numbers. The 8-bit and tone-curve bullet (line 58) and the copy bullet (line 465) are correct, but only implementers need them.
- Evidence: stats.json longParagraphs for api/render.
- Proposed edit:
  - Line 21: keep the first two sentences, then a table "Pass kind | What it does | Section" with four rows (scene, reflection, fullscreen, compute).
  - Lines 67 and 146: bulleted lists "It draws: ... It does not draw: ambient occlusion, occlusion culling."
  - Line 395: keep the first sentence and "Size a history pass for its grid, not the canvas." Put the byte figures in a small table (format, bytes per texel on WebGPU, bytes per texel on WebGL2, 128 x 128, 256 x 256) inside `<summary>Technical details: the memory of a pass with history</summary>`.
  - Line 152: keep "Each quality preset gives it a share of the render size" and the preset shares. Put the S1 benchmark figures in `<summary>Technical details: measured cost</summary>`.
  - Line 58 and line 465: technical details blocks, `<summary>Technical details: pass textures on 8-bit devices</summary>` and `<summary>Technical details: how each path turns the image upright</summary>`.
  - Lines 81, 382, 441, 445: break at the fourth sentence. Line 445 breaks before "Give no fallback when the work needs atomics".
- Generated source: none.

## 9. api/water: one page for three products, with one diagram for all of them

- Severity: medium. Category: split-page.
- Anchor: "## Waterfalls" (line 272) and "## The ocean" (line 368); the Mermaid diagram at lines 13 to 32.
- Claim: The page covers rivers and lakes, waterfalls and the open ocean. The diagram joins all three in 20 nodes, so it explains none of them at a glance. A reader who wants the ocean reads river shapes, foam, wind, rain, tint and underwater first.
- Evidence: stats.json: 6,086 words, 18 headings. The intro paragraphs at lines 34, 36 and 38 each describe a different product.
- Proposed edit: Keep api/water for rivers and lakes (shape, options, foam, wind, rain, object, tint, underwater). Move "## Waterfalls" to a new page api/waterfalls and "## The ocean" to a new page api/ocean, each with its own short diagram and its own "Costs and limits" bullets (the waterfall bullet at line 459 and the ocean bullet at line 471). If the pages stay together, at least split the diagram into three small ones, one at the top of each section. Add any new page to PAGES in tools/lib/docs.ts.
- Generated source: tools/lib/docs.ts (only if new pages are added).

## 10. api/water: long paragraphs and long cost bullets

- Severity: medium. Category: long-paragraph.
- Anchor: lines 34, 86, 160, 188, 213, 241, 274, 285, 443, 459.
- Claim: Ten paragraphs or bullets are over the limit. The intro (line 34, 143 words) lists features in prose. The waterfall description (line 274, 160 words; line 285, 205 words, 12 sentences) reads as art direction, not as what a developer sets. The "The reflection" cost bullet (line 443, 171 words) mixes cadence, the lowest tier, the governor and the stats overlay.
- Evidence: stats.json longParagraphs for api/water.
- Proposed edit:
  - Line 34: one sentence, then a bulleted list of what the surface draws (long waves, ripples, caustics, foam, soft shore, reflection, view from below).
  - Lines 274 and 285: keep one sentence each in the main text ("The fall rolls over the lip, drops as a white column and dissolves into mist at its foot." and "The sheet's material moves the streaks on the GPU, so the fall costs the CPU nothing in a frame."). Put the rest in `<summary>Technical details: how the fall is shaped and lit</summary>`.
  - Line 443: split into sub-bullets "Cadence by preset", "A moving camera", "The lowest tier", "The governor", "In the stats overlay".
  - Lines 86, 160, 188, 213, 241, 459: break at the fourth sentence. Line 241 (the tint) reads better as two short paragraphs: what attenuation does, then the clear-creek and dark-water examples.
  - The text at lines 86 to 92, 118 to 121, 148 to 164, 201 to 216, 235 to 270, 274 to 296, 333 to 334, 354 to 355, 365 to 378, 417 to 418 and 433 to 434 is hard-wrapped, but the rest of the page is not. Unwrap it so that later edits show clean diffs.
- Generated source: none.

## 11. api/raycast: "Pixel-exact picking" is nine paragraphs with no structure

- Severity: medium. Category: structure.
- Anchor: "## Pixel-exact picking", lines 136 to 170; long paragraphs at lines 21, 106, 119, 138, 149, 151, 155, 206, 263.
- Claim: The picking section runs nine paragraphs and one list. Texture coordinates, pixel tests, sources, fallback to a raycast, timing, cost and device loss come in one stream. A reader who wants "why did my pick return null" or "what does a pick cost" must read all of it. Six of the page's nine long paragraphs are here or next to it.
- Evidence: stats.json longParagraphs for api/raycast (lines 138, 149, 151, 155 in this section).
- Proposed edit:
  - Break the section with H3 headings: "### What a pick finds" (lines 155 to 164), "### Texture coordinates" (lines 149 to 153), "### When a pick answers null or fails" (lines 166, 168 last sentence, 170), "### Cost" (line 168).
  - Line 151 (pick and raycast use the same camera; a ray that names another object): technical details block, `<summary>Technical details: how a pick finds its texture coordinates</summary>`.
  - Line 21: split after "Raycasts also hit sprites, points and lines where they draw." The tree sentence starts a second paragraph.
  - Lines 106, 119, 206, 263: break at the fourth sentence. Line 106 breaks before "Over a view from `scene.createView`".
- Generated source: none.

## 12. api/textures: long paragraphs, and GPU internals that sit between the user topics

- Severity: medium. Category: technical-details-block.
- Anchor: lines 107, 126, 224, 228, 236, 242, 254, 258, 260, 268.
- Claim: Ten paragraphs are over the limit. "Texture arrays" (line 224, 163 words) and the WebGL2 map-drop rule (line 228, 141 words) are correct, dense detail. Only a reader who debugs memory or a missing map needs it. The same is true of the transcoder paragraph (line 107) and the memory figures (line 258).
- Evidence: stats.json longParagraphs for api/textures.
- Proposed edit:
  - Line 224: keep the first three sentences of "Texture arrays" in the main text, then the advice of line 226. Put the growth, cap, shrink and own-array rules in `<summary>Technical details: how arrays grow, shrink and split</summary>`.
  - Line 228: keep "On WebGL2 a standard material samples at most six maps. Past six, it drops the maps that change its look least." Put the order of the drops in `<summary>Technical details: which maps WebGL2 drops first</summary>`.
  - Line 258: make a small table "Format | Bytes per texel" (rgba8unorm 4, rgba16float 8, compressed 1, etc2-rgb8unorm 0.5, rgb9e5ufloat 4) and keep the 1024 x 1024 example under it.
  - Line 126: numbered steps for `refresh(rect)`: give the rectangle, what it counts from, what uploads.
  - Lines 107, 236, 242, 254, 260, 268: break at the fourth sentence.
- Generated source: none.

## 13. api/scene: error codes are spread over nine paragraphs

- Severity: medium. Category: structure.
- Anchor: lines 248, 323, 341, 412, 452, 488, 514, 565, 575, 589 to 592.
- Claim: Most sections end with a sentence like "Development builds throw E1203 for ..., E1108 for ..., E1213 for ...". The codes have no links, and they add to the long paragraphs. A reader with an error cannot find it by scanning. api/render, api/splats and api/vertex-draws each have an Errors table, so this page is out of line.
- Evidence: line 248 "Development builds throw E1203 for a number that is not finite, and E1108 for a number out of its range. They throw E1213 for `blur` ..."; line 412 "Development builds throw E1203 ..., E1108 ..., and E1213 ... Every build throws E1101 ..., and E1222 ...".
- Proposed edit: Add "## Errors" before "## Related pages", with a table "Code | Cause | Builds", one row per cause, each code linked to `../errors/E….md`. In each section, cut the code sentences down to one link, "[Errors](#errors) lists what this call refuses." If a section must keep its codes close by, put them in `<summary>Technical details: errors this call throws</summary>`. Do the same on api/textures (E1208 at lines 72, 101, 102, 105, 120, 146, 189, 204, 230) and api/wind (no codes yet).
- Generated source: none.

## 14. Every page in the slice: the status callout carries feature limits, and says "Roadmap step"

- Severity: medium. Category: scan-order.
- Anchor: line 11 on each page.
- Claim: The callout at the top of each page starts with "Roadmap step 0.x". That is the maintainers' plan, which the AGENTS.md rules keep out of docs. On four pages the same callout also holds feature limits that readers skip as boilerplate. On raycast these are skinned characters in bind pose. On sprites, no shadows and no overlap queries. On terrain, no collision, the morph and the skirt. On textures, no cube-map sampling. The limits on raycast and terrain repeat later in the page (raycast line 234, terrain lines 82 to 86 and 98).
- Evidence: raycast line 11 "Queries test a skinned character in its bind pose ..."; terrain line 11 "The ground has no collision. A block morphs toward its parent block's surface ..."; tools/lib/steps.ts `shipsSentence` writes "Roadmap step <since>, first released in null3D 0.1.0.", and the docs check in tools/lib/docs.ts requires a callout that starts with it (tools/lib/docs.test.ts line 137).
- Proposed edit: Change the sentence to "First released in null3D 0.1.0. The API is experimental, so it can still change between versions." in tools/lib/steps.ts, and update the check and its tests. On raycast, sprites, terrain and textures, move the limit sentences out of the callout into the body. Raycast: "What queries test" already says it, so delete it from the callout. Sprites: add a "## Limits" bullet list after "Speed". Terrain: "Placing things on the ground" already says no collision, and the morph and skirt text goes to "How it works". Textures: add the cube-map sentence to "Options" or a "Limits" list.
- Generated source: tools/lib/steps.ts (shipsSentence) and tools/lib/docs.ts (the check of the callout).

## 15. api/sketch: long paragraphs on the engine field and the loading rules

- Severity: medium. Category: long-paragraph.
- Anchor: lines 45, 47, 108, 110, 134, 138, 140, 183.
- Claim: Eight paragraphs go over the limit. Line 140 (`engine.firstFrame`, 134 words, 8 sentences) mixes what the promise is, when to use it, why a frame number does not work, and how hold mode behaves. Line 47 (131 words) explains module timing.
- Evidence: stats.json longParagraphs for api/sketch.
- Proposed edit:
  - "The engine field": make one H3 or one bold-free sub-list per field: `engine.viewport`, `engine.capabilities`, `engine.held`, `engine.firstFrame`. For `firstFrame`, keep "resolves when the GPU finishes the first frame; start later downloads then; never await it in setup" in the main text. Put the frame-number caveat and the hold-mode rule in `<summary>Technical details: firstFrame in hold mode and replays</summary>`.
  - Lines 108 and 110 (serial-load warning): numbered "When the warning shows / How to fix it / When to turn it off".
  - Lines 45, 47: see finding 2 (details block).
  - Lines 134, 138, 183: break at the fourth sentence.
- Generated source: none.

## 16. api/wind: long paragraphs, and allocation detail right after the first example

- Severity: medium. Category: technical-details-block.
- Anchor: lines 24, 57, 77, 81, 272, 290, 326, 328, 338, 361, 372.
- Claim: The paragraph after the quick-start example (line 57) moves from "Call `update` once in each frame" to task promises and "a fraction that crosses one of its calls becomes an object". A newcomer gets lost at the first step. The `read` queue rules (line 77, 128 words), the budget paragraph (line 361, 171 words, with a stats-overlay line) and the last cost bullet (line 372) are dense, correct implementer detail.
- Evidence: stats.json longParagraphs for api/wind.
- Proposed edit:
  - Line 57: keep the first three sentences. Put the rest in `<summary>Technical details: what the calls allocate</summary>`, together with the last bullet of "Costs and limits" (line 372).
  - Line 77: keep "`read` works the air out on the job workers, up to about five thousand places a call, and the answer lands before the next frame's update." Put the queue and drop rules in `<summary>Technical details: how read queues its asks</summary>`.
  - Line 361: split into two paragraphs: budgets by preset (or add a "Budget" row to the presets table), then what the governor does. Put the overlay example line in a code block, inside a technical details block.
  - Line 326 (forest demo): split after "as the example above does." Make the forest demo a link (`https://github.com/null3d-engine/null3d/tree/main/examples/forest/`, the demo's code value in examples/demos.ts is `forest/`) instead of the path `examples/forest`.
  - Lines 24, 81, 272, 290, 328, 338: break at the fourth sentence.
- Generated source: none.

## 17. api/sound: internals before the install step, and long paragraphs

- Severity: medium. Category: scan-order.
- Anchor: lines 22, 24, 71, 86, 115, 121, 134, 152.
- Claim: The second paragraph (line 24) explains the main thread, the worker, the shared table, the Rust mixer and messages, before the reader has seen `bun add`. The Files section (line 152) mixes how addresses resolve with MP3 encoder padding and a Safari sample count. Eight paragraphs are over the limit.
- Evidence: stats.json longParagraphs for api/sound. Line 152 "Safari kept 576 at each end of a mono loop, which would dip at every join."
- Proposed edit:
  - Line 24: keep "The sketch runs in a worker and the browser's audio runs on the page, so the add-on has a sketch half and a page half." Put the rest in `<summary>Technical details: how the sketch drives the audio thread</summary>`. The diagram already shows the flow.
  - Line 152: keep the address rules (first three sentences) and "A file made to loop joins its end to its start, with no gap." Put the MP3 padding detail in `<summary>Technical details: gapless MP3 loops</summary>`.
  - Line 86: turn the members of a loop, a group and a shot into a table "Sound | Members".
  - Line 71: split into two paragraphs: when to call `update`, then how the page starts audio.
  - Lines 115, 121, 134: break at the fourth sentence. Line 115 breaks before "A voice that moves to another member fades out first".
- Generated source: none.

## 18. api/splats: long, hard-wrapped paragraphs on the shader and the selection

- Severity: medium. Category: technical-details-block.
- Anchor: lines 80, 102, 110, 121, 148.
- Claim: Line 80 (covariance, card axes, standard deviations) and line 102 (prefix coverage and growth) explain the method, not the API. Line 110 (165 words, 10 sentences) mixes how the budget picks chunks with where the work runs. Line 121 gives demo timings as "instead of" figures, a comparison with an unnamed earlier setup. Line 148 mixes `ready`, streams and `settle()`.
- Evidence: stats.json longParagraphs for api/splats. Line 123 "the reader arrived at 4.4 seconds instead of 7.9."
- Proposed edit:
  - Line 80: keep "Each splat draws as a camera-facing card that fades as a Gaussian, so overlapping splats read as one surface." Put the rest in `<summary>Technical details: how a card covers its splat</summary>`.
  - Lines 102 and 110: keep a three-step list in the main text: "1. Each chunk keeps an eighth of itself. 2. The budget gives nearer chunks finer levels. 3. A budget too small for every level thins the whole cloud." Put the prefix-coverage and Rust-module detail in `<summary>Technical details: how the add-on chooses splats</summary>`.
  - Line 121: put it in that same block. Name what the figures compare: the reader started at load time against the reader started after the index arrived.
  - Line 148: a small table "Promise | Resolves when", with rows for `ready` (file), `ready` (stream) and `settle()`.
  - Move line 145 (lighting and shadows) to "## What it draws". It is about how splats draw, not about the budget.
- Generated source: none.

## 19. api/render: compute passes make up half the page

- Severity: medium. Category: split-page.
- Anchor: "## Compute passes", lines 225 to 452.
- Claim: Compute passes run for about 220 lines with seven H3 sections (shader bindings, buffers, same-frame reads, history, readback, WebGL2, switching). A reader who wants a minimap or a reflection meets the largest share of the page in a topic for advanced add-on authors. "Switching and removing passes" applies to every kind but sits as an H3 under compute.
- Evidence: stats.json headings for api/render: six of the eight H3s are under "Compute passes". 6,480 words.
- Proposed edit: Move "## Compute passes" and its H3s (lines 225 to 445) to a new page "Compute passes" (for example api/compute-passes), linked from the intro table (finding 8). Promote "Switching and removing passes" to an H2 on api/render. Add the new page to PAGES in tools/lib/docs.ts.
- Generated source: tools/lib/docs.ts (PAGES entry for the new page).

## 20. api/terrain: long paragraphs in "How it works" and "Speed"

- Severity: medium. Category: long-paragraph.
- Anchor: lines 21, 78, 80, 82, 92, 102, 104.
- Claim: Seven paragraphs go over the limit. Line 104 (169 words, 11 sentences) runs from the WebAssembly module to `setVisible` and `setTint`. Line 82 (the morph, 127 words) is implementer detail.
- Evidence: stats.json longParagraphs for api/terrain.
- Proposed edit:
  - Line 104: move `setVisible`, `setTint` and `building` to "The terrain object" table (finding 4). Put the task and block-reuse rules in `<summary>Technical details: how blocks build on the job workers</summary>`.
  - Line 82 and line 86 (skirt): keep "Blocks morph toward their parent before they switch, so the ground does not pop. `morph: false` switches at once." Put the rest in `<summary>Technical details: the morph and the skirt</summary>`.
  - Line 21: split after "the far hills stay cheap."
  - Lines 78, 80, 92, 102: break at the fourth sentence.
- Generated source: none.

## 21. api/tasks: the example is named for a sort that the text says add-ons do not do

- Severity: medium. Category: unclear.
- Anchor: intro (line 13) and the first example (lines 17 to 44).
- Claim: Line 13 says "an add-on does not sort its drawn rows through a task". The example right under it defines `SORT_TASK` named 'splat-sort', with a "splat sorter" WebAssembly file and a `sortRound` function. A reader cannot tell whether to sort in a task or not. The intro also opens with the splats add-on's internals before it says what a task is.
- Evidence: line 13 "so an add-on does not sort its drawn rows through a task"; line 21 "name: 'splat-sort'"; line 24 "what: 'the splat sorter'".
- Proposed edit: Open with lines 15 and 46 (what a task is and how a worker runs it). Rename the example to work that fits the text, such as a selection or a chunk build ('chunk-select', `selectChunks`), and use the same name in the Shared memory example. Move the sentence about the transparent pass sorting rows into a short note after the example: "The engine sorts blended rows itself, so a task chooses rows but does not sort them for drawing."
- Generated source: none.

## 22. api/splats: no install command

- Severity: medium. Category: missing-prerequisite.
- Anchor: after the file list, before the first example (line 41).
- Claim: The other add-on pages in the slice (sound, terrain, water, wind, three-compat) show `bun add @null3d/<name>` before the first example. api/splats does not. A newcomer copies the example and the import fails. The H1 "Gaussian splats" also drops the package name, but the front matter title "Gaussian splats (@null3d/splats)" keeps it.
- Evidence: line 9 "# Gaussian splats"; line 3 title: "Gaussian splats (@null3d/splats)"; no `bun add` in the page.
- Proposed edit: Add a `sh` block with `bun add @null3d/splats` before the first `ts` block. Make the H1 match the title: "# Gaussian splats (@null3d/splats)".
- Generated source: none.

## 23. api/water: `update()` says it "changes nothing", but every example calls it

- Severity: medium. Category: unclear.
- Anchor: "## The water object", line 224.
- Claim: The row reads "Keeps the sketch's frame loop. The reflection pass carries its own cadence now, so the call changes nothing". "Now" reads as a change note. A reader cannot tell whether to call it. The examples at lines 74, 179 and 324 call it every frame.
- Evidence: line 224.
- Proposed edit: "`update()` | Does no work. The reflection keeps its own cadence. Calling it once a frame is harmless and keeps code that calls it working." Or, if the call is meant to stay, say what it is for. Fix the same "now" wording in the `reflectionEvery` rows (lines 226 and 427): "The frames between two draws of the reflection, as the preset and the governor set it".
- Generated source: none.

## 24. api/scene, api/raycast, api/wind: benchmark commands in the reader's text

- Severity: low. Category: technical-details-block.
- Anchor: scene lines 246, 341, 462, 549; raycast line 23; wind line 372.
- Claim: Sentences such as "`bun run bench:allocation --sky` and `--atmosphere` check it" interrupt the user-facing text. A user of the engine cannot run the repository's benchmark scripts from their own project. The fact behind them ("the call allocates nothing, so you may call it every frame") is what the reader needs.
- Evidence: scene line 246 "`bun run bench:allocation --sky` and `--atmosphere` check it."; raycast line 23 "`bun run bench:allocation --calls` checks it."
- Proposed edit: Keep "The call allocates nothing, so a sketch may call it in every frame." Move the benchmark name into a technical details block on each page (`<summary>Technical details: how this is measured</summary>`), or name it as "the engine's allocation benchmark" in that block, as the rule on citing figures asks.
- Generated source: none.

## 25. api/textures: the KTX2 section comes before the common sources, and internals are scattered

- Severity: low. Category: scan-order.
- Anchor: "## KTX2 files" (line 74); "## Texture arrays" (220), "## From texels to GPU" (232), "## Mip levels" (240), "## Both GPU paths" (262).
- Claim: Right after "Options", the reader meets two format tables and six bullets on transcoding. That section is longer than Images, Canvases, Videos and Data together. Sections about how textures live on the GPU then sit between user topics ("Updating and destroying", "Sampling", "Color spaces").
- Evidence: stats.json headings for api/textures.
- Proposed edit: Order: Options, Images, Canvases, Videos, Data, Textures of render passes, KTX2 files, Updating and destroying, Sampling, Color spaces, GPU memory. Then one H2 "How textures reach the GPU" that holds From texels to GPU, Mip levels, Texture arrays, Both GPU paths and When the browser takes the GPU away. In "KTX2 files", keep the first paragraph and the bullets on mip levels, color space and row order in the main text. Put the two format tables and the device bullets in `<summary>Technical details: which compressed format each device gets</summary>`.
- Generated source: none.

## 26. api/splats, api/sound: object members are listed in prose

- Severity: low. Category: wall-of-text.
- Anchor: splats line 212; sound line 86.
- Claim: Splats line 212 names 13 members of `Splats` in one sentence and says what none of them does. Sound line 86 lists the setters of loops, groups and shots in one paragraph. Other pages (water, ocean, waterfall) give members in tables.
- Evidence: splats line 212 "`Splats` gives `update(eye)`, `setBudget(count)`, `settle()`, `ready`, `total`, `drawn`, `chunks`, `loaded`, `failed`, `bytes`, `loadedBytes`, `feature` and `draw`, and `destroy()` frees it."
- Proposed edit: Add a table "Member | What it does" for `Splats` under "## The calls". On api/sound, add a table "Sound | Members | Notes" with rows for a loop, a group and a shot.
- Generated source: none.

## 27. api/sketch and api/scene: two sections explain when changes show

- Severity: low. Category: duplication.
- Anchor: sketch "## When changes show" (line 179); scene "## When changes take effect" (line 569).
- Claim: Both sections explain that `onUpdate` sees last frame's world positions, `onLateUpdate` sees this frame's, setters in `onLateUpdate` show in the same frame, and structural changes wait. A reader reads it twice, and the two can drift apart.
- Evidence: sketch line 183 "In `onLateUpdate`, world positions already hold the frame's changes ..."; scene line 573 "In `onLateUpdate` they already hold the frame's changes ...".
- Proposed edit: Keep the callback-timing rules on api/sketch. On api/scene keep only the list of structural calls (line 571) and the skipped-change rule (line 575), and link to `sketch.md#when-changes-show` for the timing.
- Generated source: none.

## 28. api/raycast: "How queries find objects" is implementer detail in the main text

- Severity: low. Category: technical-details-block.
- Anchor: "## How queries find objects", lines 252 to 265.
- Claim: The section explains the two tree levels, rebuild rules, four-child nodes and SIMD, pixel-sized rows and 64-bit cell frames. Two facts matter to a user: the first query on a large mesh can be slow, and a large dynamic batch adds to each frame that runs a query. They sit inside the detail.
- Evidence: line 256 "A large mesh can make that first query slow."; line 257 "So a large dynamic batch of particles adds to each frame that runs a query."
- Proposed edit: Lead the section with a short "What this means for your scene" list: the first query per mesh builds its tree; dynamic objects and rows rebuild in each frame that queries; cost does not grow with scene size; far objects keep precision. Put lines 257 to 265 in `<summary>Technical details: the query trees</summary>`.
- Generated source: none.

## 29. api/ui: one long CSS paragraph, and frame internals at the end

- Severity: low. Category: long-paragraph.
- Anchor: line 81; "## Which frame the labels follow" (line 115).
- Claim: Line 81 (102 words, 7 sentences) gives five separate rules for the container and the element. As prose they are easy to miss. "Which frame the labels follow" explains threads and layout batching. Most readers only need its result: labels sit over the object in the frame on screen.
- Evidence: stats.json longParagraphs for api/ui (line 74 in stats, file line 81).
- Proposed edit: Turn line 81 into a checklist: "Put the elements in a container that covers the canvas exactly"; "Give the container `pointer-events: none`"; "Do not set the element's `transform`, the engine owns it"; "Offset the content inside the element to anchor another point"; "Screen labels stack in page order, not by distance". In "Which frame the labels follow", keep line 119's last-but-one sentence as the main text. Put lines 117 to 121 in `<summary>Technical details: how labels stay in step with the frame</summary>`.
- Generated source: none.

## 30. api/scene: sky examples sit away from the tables they show

- Severity: low. Category: example-placement.
- Anchor: lines 140 to 202.
- Claim: The analytic sky table is at line 160, but its example (lines 186 to 202) comes after the second-sky table. The example shows a sun that rises and sets, not a second sky. The environment example at line 140 calls `setEnvironment`, which the page explains only at line 327.
- Evidence: line 179 "Two more settings add a second sky"; line 195 "The sun rises and sets, and the clouds drift with the sketch's time."
- Proposed edit: Move the moving-sun example to just after the analytic sky table, before "Two more settings add a second sky". In the environment example at line 140, add a comment that links ahead ("setEnvironment lights the scene: see The environment"), or move the example under "## The environment" and keep a background-only example here.
- Generated source: none.

---

## Not verified (lower ranked)

## 31. api/sprites: four long paragraphs (not verified)

- Severity: low. Category: long-paragraph.
- Anchor: lines 115, 141, 145, 151.
- Claim: Line 115 (row index arithmetic) would read better as a table column. The row arrays table could gain a column "Sprite i starts at". Line 141 mixes screen-size rules with culling. Line 145 mixes sorting with advice.
- Proposed edit: Add a "Starts at" column to the row arrays table and cut the first sentence of line 115. Split line 141 before "The engine never culls these sprites". Split line 145 before "For particles that add light".

## 32. api/three-compat: the pass chain is in the main text (not verified)

- Severity: low. Category: technical-details-block.
- Anchor: line 81.
- Claim: The description of the gradient pass, the two blurs and the two wider blurs is implementer detail. The cost bullets repeat the counts.
- Proposed edit: Keep "The core draws the outline's mask, and the add-on blurs it into the edge and the glow." Put the pass chain in `<summary>Technical details: the outline's passes</summary>`.

## 33. api/vertex-draws: two paragraphs just over the limit (not verified)

- Severity: low. Category: long-paragraph.
- Anchor: lines 22, 124.
- Proposed edit: Line 22: split before "So the draw needs no vertex buffer". Line 124: turn the two choices for a field that follows the camera into a two-item list.

## 34. api/time: the `time.drawn` cell is a paragraph in a table (not verified)

- Severity: low. Category: wall-of-text.
- Anchor: line 66.
- Proposed edit: Keep "False in a hold-mode step that the GPU never draws, true otherwise." in the cell. Put the solver example under the table in a short paragraph, or in a technical details block. Split line 74 (fixed steps) before "At 30 frames per second".

## 35. api/wind: `createWind` options hide in one table cell (not verified)

- Severity: low. Category: missing-content.
- Anchor: line 63.
- Claim: `camera`, `box` and `grid` are described inside the `createWind` row. There are no defaults, and no other options are named.
- Proposed edit: Add an options table under the calls table: Option, Takes, Default, What it sets.

## 36. api/tasks: the build rule appears twice (not verified)

- Severity: low. Category: duplication.
- Anchor: line 48 and "## The task's module in a build" (lines 92 to 96).
- Proposed edit: Delete line 48 and keep the section, or move the section's text up to line 48 and delete the section.

## 37. api/render: hard-wrapped text in two sections (not verified)

- Severity: low. Category: structure.
- Anchor: "### State between runs" (lines 347 to 405) and "### Reading a region back" (lines 419 to 437).
- Claim: Only these sections are hard-wrapped. The rendered page shows no change, but later edits give noisy diffs.
- Proposed edit: Unwrap the lines to one paragraph per line, as in the rest of the page.

## 38. api/raycast: texture coordinates are explained three times (not verified)

- Severity: low. Category: duplication.
- Anchor: hit table rows `uv` and `hasUv` (lines 95 to 96), lines 98 to 100, line 149.
- Proposed edit: Keep the table rows and lines 98 to 100. In the pick section, write "A pick's hit carries `uv` and `hasUv`, as a raycast's hit does ([Raycasts](#raycasts))." and cut the rest of line 149.

## 39. api/sound: error codes written as bare numbers (not verified)

- Severity: low. Category: structure.
- Anchor: lines 77 and 121.
- Claim: "throws error 2504" and "gets error 2501" do not match the E-code form and links that other pages use.
- Proposed edit: docs/errors has no E2501 or E2504 page. Write the codes as "E2504" and "E2501" and add an Errors table like the one on api/splats.

## 40. api/splats: the budget section mixes four topics (not verified)

- Severity: low. Category: structure.
- Anchor: "## Detail levels, streaming and the budget" (lines 100 to 154).
- Proposed edit: Use H3 headings: "### How chunks pick a level", "### The budget by preset", "### Capacity and preset changes", "### When the cloud is ready".

## 41. api/wind: no "Related pages" section (not verified)

- Severity: low. Category: structure.
- Anchor: end of page.
- Claim: Other add-on pages end with links to the pages they work with. Wind is read by grass, water and custom materials, but the page has no list of those pages. It is part of finding 5, listed here for tracking.
- Proposed edit: Add "## Related pages" with grass.md, water.md, materials.md (custom materials), features.md and quality.md.
