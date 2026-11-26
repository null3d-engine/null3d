# Readability and layout review: slice api-1

Pages: api/animation, api/assets, api/cameras, api/controls, api/debug, api/engine, api/feature-draws, api/feature-effects, api/feature-instances, api/features, api/geometry, api/grass.

All twelve pages are hand-written (docs/api/<page>.md). None is generated, so no finding names a generator source.

Line numbers are file lines. stats.json counts lines after the front matter, so a stats line is the file line minus 7. Word and sentence counts come from stats.json.

A "details block" below means:

```md
<details>
<summary>Technical details: what is inside</summary>

Markdown body.

</details>
```

The main text must read correctly with every block closed. Blocks hold no headings and no nested blocks.

Findings 1 to 30 are verified. Findings 31 to 50 are marked "not verified".

---

## 1. api/assets: one table cell holds about 420 words (high, wall-of-text)

- Anchor: "## glTF models", table row "A material", line 89.
- Claim: the "A material" row of the mapping table is one cell of about 420 words. It covers 15 material extensions and the rules for which textures a layered material keeps. On the website it renders as a very tall, narrow cell that nobody can scan. A reader who wants to know what `KHR_materials_sheen` sets has to read the whole cell.
- Evidence: line 89 starts "`materials.standard`, or `materials.unlit` with `KHR_materials_unlit`." and runs through "`scatterAnisotropy` is not drawn". The table's other rows are one to three sentences long.
- Proposed edit: make the row read "A material | `materials.standard`, or `materials.unlit` with `KHR_materials_unlit`. [Material extensions](#material-extensions) lists what each extension sets." Add an H3 "Material extensions" after the table, with a table of Extension | What it sets | See. Use one row per extension: emissive_strength, specular, ior (with the 0 to 1000 rule), transmission, volume, dispersion, diffuse_transmission, clearcoat, sheen, iridescence, anisotropy and volume_scatter. Move the texture-slot rules into a details block under that table: specular and transmission families, thickness beside a specular color texture, layered materials dropping maps, coat and sheen roughness pairs, and the volume-scatter formula. Use the summary "Technical details: which textures a material with many extensions keeps".

## 2. api/engine: "The running engine" is a list of 22 bullets, several over 100 words (high, wall-of-text)

- Anchor: "## The running engine", lines 161 to 184.
- Claim: the list mixes one-line calls with long rules. It is the only place that says which failures stop the frames. That rule is buried in the middle of the `onFailure` bullet (line 163, about 150 words). A reader cannot tell at a glance which codes end the engine and which let it draw on. Bullets are not counted by stats.json, so this wall does not show in the paragraph counts.
- Evidence: line 163 (`onFailure`, about 150 words, 11 sentences), line 173 (`inspect`, about 110 words), line 176 (`requestPointerLock`, about 150 words) and lines 178 to 182 (memory reuse, canvas reuse, Safari, page hide, back-forward cache, 80 to 120 words each). None of lines 178 to 182 describes a call.
- Proposed edit: replace the list with a Call | What it does table, one sentence per row, with links. Add an H3 "Failures after the start" with a table Code | What happens next: E1302, E1404 and E1424 stop the frames; E1405 is a job worker that did not start; E1304, E1305 and E1307 drop the failed objects and draw on. Follow it with two sentences on handler order (`onFailure` before `onStop`, a late handler still hears it). Add an H3 "Destroy and start again" for lines 177 to 179. Put lines 180 to 182 (Safari memory, page hide and the back-forward cache) in a details block with the summary "Technical details: memory and the GPU when a page goes away". Move the pointer-lock detail of line 176 to a one-row summary plus a link to [Pointer lock](controls.md#pointer-lock), which already explains it.

## 3. api/animation: the page is 6,712 words and should split (medium, split-page)

- Anchor: whole page; sections "## Skinned meshes" (line 416) to "## Morph targets" (line 453), and "## Property animation" (line 124).
- Claim: the page is the longest in the slice, with 24 long paragraphs. It mixes four topics: playing clips, animating properties, how skinning runs on the GPU, and morph targets. A newcomer who wants to play a clip scrolls past GPU memory limits and three.js comparisons.
- Evidence: stats.json gives 6,712 words and 24 long paragraphs. Lines 416 to 467 (skinning, crowds, limits of skinning, morph targets) are about drawing, not the animator API.
- Proposed edit: keep the animator on api/animation: models, playing clips, weights, inertial transitions, 1D blends, layers, additive clips, joint overrides, events and errors. Move "Skinned meshes", "Crowds", "Limits of skinning" and "Morph targets" to a new page, api/skinning ("Skinned meshes and morph targets"), and link it from "Models from glTF files". Move "Property animation" and "Files with KHR_animation_pointer" to the end of the page under one H2, or to their own page, api/property-animation. Put "Clips", "Blending" and "Speed compared with three.js" (lines 389 to 478) under one H2, "How the animator works", near the end.

## 4. api/debug: the page is 6,807 words and holds two pages (medium, split-page)

- Anchor: "## Stats overlay and frame figures" (line 177) to "### GPU time" (line 423).
- Claim: about two thirds of the page is the stats overlay, the frame figures and `engine.measure`. Those are measurement, not debug drawing. The page has 21 headings and 3 Mermaid diagrams. A reader who wants `debug.line` lands on a long page whose summary lists 14 subjects.
- Evidence: stats.json gives 6,807 words. Lines 177 to 442 cover the overlay, the card, the memory figures, GPU memory, cost, the overlay for another engine, and frame measurement.
- Proposed edit: keep "Debug drawing", "Debug views" and "The in-page inspector" on api/debug. Move "Stats overlay and frame figures" and "Frame measurement" to a new page, api/stats ("Stats overlay and frame measurement"). Leave a two-sentence pointer section on api/debug. Update the links in engine.md (lines 123 and 168) and features.md (line 318) to the new page.

## 5. api/animation: 24 long paragraphs (medium, long-paragraph)

- Anchor: lines 50, 56, 97, 101, 120, 126, 176, 183, 203, 227, 232, 242, 268, 321, 358, 406, 420, 422, 424, 428, 442 and 455, among others.
- Claim: these paragraphs pass 4 sentences or 90 words. The worst are lines 442 (162 words, 11 sentences), 455 (154 words, 11 sentences), 420 (151 words, 10 sentences), 422 (144 words, 10 sentences), 183 (121 words, 9 sentences), 358 (117 words) and 176 (112 words).
- Evidence: stats.json lines 43, 49, 90, 94, 113, 119, 169, 176, 196, 220, 225, 235, 261, 314, 351, 399, 413, 415, 417, 421, 435 and 448.
- Proposed edit:
  - Line 97 (`crossFade`): split after "...weight too." Make the replay rule ("A clip that already plays... starts again.") its own paragraph.
  - Line 242 (1D blends): make the three rules (at a point, between points, past the ends) a bullet list.
  - Line 268: split after "...keeps the step." and start a new paragraph at "`play` or `crossFade` on the layer ends the blend."
  - Line 406: split after "...room to spare." and make the eviction rule its own paragraph.
  - Line 455 (morph targets): first paragraph is what a target is and the two calls. Second is "What a target can move", as bullets for positions, normals, tangents and colors with the `COLOR_0` rules. Third is where targets come from.
  - Line 442: keep the first four sentences. Move "A character that stands still..." to the end in a details block (see finding 11).
  - Lines 183, 358, 420, 422 and 424: see finding 11.
  - Lines 50, 56, 101, 120, 126, 176, 203, 227, 232 and 321: break each into two paragraphs at the sentence where the subject changes.

## 6. api/geometry: 14 long paragraphs, three over 180 words (medium, long-paragraph)

- Anchor: lines 50, 83, 128, 155, 161, 178, 208, 228, 238, 240, 277, 279, 295 and 303.
- Claim: "Levels of detail" holds the three longest paragraphs in the slice: line 238 (226 words, 13 sentences), line 240 (182 words) and line 228 (121 words, 5 sentences). Line 178 (morph targets) is 171 words and 12 sentences. A reader looking for when a mesh plans levels must read 121 words to find the two numbers.
- Evidence: stats.json lines 43, 76, 121, 148, 154, 171, 201, 221, 231, 233, 270, 272, 288 and 296.
- Proposed edit:
  - Line 228: "A mesh made in code plans its own levels the first time the scene draws it." Then a bullet list: 4,096 triangles or more; or at least 256 whose copies hold 65,536 together. Then "The plan runs on the job workers..." as its own paragraph before the example.
  - Line 238: keep the first three sentences (halving, error, fading). Move the rest to a details block (finding 12).
  - Line 240: one sentence in the main text ("Large levels also split into pieces that a copy skips when they lie outside the view; [Pieces of a large level](../concepts/lod.md#pieces-of-a-large-level) explains them.") Move the rest to a details block.
  - Line 178: split into (a) weights and the demo, (b) a "Limits" bullet list (up to 255 targets per vertex, 4,194,304 deltas or 32 MiB in all, E1206 past them), and (c) storage precision in a details block.
  - Line 208: split after "...hold every shape, with `setBounds`." Make the raycast rebuild its own paragraph.
  - Lines 277 and 279: make the three measures (`error`, `distance`, `coverage`) a table: Measure | Unit | Draws while | Fades. Make the per-level rules of line 279 a bullet list.
  - Lines 50, 83, 128, 155, 161, 295 and 303: split each at the change of subject.

## 7. api/engine: the start is one 158-word paragraph, and the memory figures are dense (medium, long-paragraph)

- Anchor: "## The start", line 36; "## Memory", line 149.
- Claim: line 36 (158 words, 10 sentences) describes a sequence: tests, threads, sketch, setup, first frame, preset check. A sequence reads best as numbered steps. Two promises (`firstFrame` and `presetChecked`) and two `presetCheck` modes are buried in it. Line 149 (93 words) mixes advice with per-row byte figures.
- Evidence: stats.json lines 29 (158 words, 10 sentences) and 142 (93 words, 6 sentences).
- Proposed edit: rewrite line 36 as an ordered list:
  1. `createEngine` tests the browser and picks the build and the GPU path.
  2. It starts the engine's threads and loads the sketch module.
  3. It runs the setup, then resolves.
  4. `engine.firstFrame` resolves once the GPU has finished the first frame, or rejects with the failure that stopped it (E1404, or E1420 after a destroy).
  5. With an engine-chosen preset, the preset check measures the first frames, and `engine.presetChecked` resolves when it ends.

  Follow with two sentences on `presetCheck: 'before-play'` and the stored result on a repeat visit. For line 149, keep "Ask for more only when a scene needs it" and the E1109 and E1409 sentences. Put the per-row and per-object byte figures in a details block with the summary "Technical details: how much memory a scene takes".

## 8. api/grass: the options are in one 149-word paragraph (medium, wall-of-text)

- Anchor: "## Grass on the ground", line 69.
- Claim: `createGrass` takes about a dozen options. They appear in a 10-sentence paragraph (line 69) and scattered through lines 75, 92, 94 and 100. The page has no options table, unlike controls and engine. A newcomer cannot see the options or their defaults at a glance.
- Evidence: line 69 names `height`, `area`, `count`, `seed`, `mask`, `maxSlope` and `where`. Line 75 names `blade` and `color`, line 92 `camera`, line 94 `compute`, and line 100 `swayDistance`. stats.json line 62 gives 149 words and 10 sentences.
- Proposed edit: after the first example, add "## Options" with a table Option | What it does: `height`, `area`, `count` (tufts at High; Low, Medium and Ultra draw 0.35, 0.6 and 1.25 of it), `seed`, `mask`, `where`, `maxSlope`, `color`, `blade`, `wind`, `camera`, `swayDistance` and `compute`. Cut line 69 to three sentences: what the call draws, that one seed places the same grass on every device, and "Await the call in the setup, because WebGPU makes its draw then." Keep `grass.fit(preset)` as a short line under the table.

## 9. api/features: the adapters come last, but a newcomer needs them first (medium, scan-order)

- Anchor: "## Adapters", line 282; banner, line 11.
- Claim: a reader writes a description to get work into a frame. The call that turns each `kind` into work is the first thing they need. It sits in the second-to-last section. The banner (line 11) half-covers it in five crowded sentences. The Mermaid diagram shows only two of the five adapters.
- Evidence: line 11 names three adapters. Line 284 says "Five exist". The diagram (lines 13 to 24) shows `addFeatureDraw` and `addFeatureEffect` only.
- Proposed edit: move "Adapters" to sit right after the opening paragraph (line 26), as a table Kind | Frame point | Call | Page. Include draws, instance draws, full-screen effects, compute passes and sky layers. Keep the "Some kinds of add-on have no hook" table at the end under "Limits". Cut the banner to the standard first sentence. Add the instance, compute and sky-layer adapters to the diagram, or say in its caption that it shows two of five.

## 10. api/debug: the stats card uses bold labels as hidden headings (medium, heading-depth)

- Anchor: "### The card", lines 226 to 250; "### Memory figures", line 312.
- Claim: seven bold run-in labels act as H4 headings: "The target.", "The work bars.", "The thread modes.", "The colors.", "Held back by.", "The add-ons' rows." and "Figures that the browser gives." A ninth, "Memory by system.", sits at line 312. They do not show in the outline or the page's table of contents, and no link can point at them. The reader sees one 37-line block under one H3.
- Evidence: the stats.json outline has "### The card" and nothing under it. Lines 226, 228, 236, 244, 246, 248, 250 and 312 each open with a bold label.
- Proposed edit: on the new stats page (finding 4), make "The card" an H2 and each label an H3: "The target", "Work bars", "Thread modes", "Colors", "Held back by", "Add-on rows" and "Figures that the browser gives". Make "Memory by system" an H3 under "Memory figures". Fold "The colors" into a small table, Color | Work bar | Memory bar | Time, instead of a paragraph.

## 11. api/animation: dense engine internals that belong in details blocks (medium, technical-details-block)

- Anchor: lines 50 to 52 ("### Load cost"), 183, 358 to 374, 389 to 414, 420 to 424 and 442.
- Claim: these passages are correct and useful to implementers, but a reader who uses the API does not need them to play a clip. Today they sit in the main flow. Examples are the KayKit Knight's 16.5 ms load, the browser boxing a fraction into a 12-byte number, the skinning pass's skip rules, and the list of pointers the loader leaves out.
- Evidence: line 52 gives benchmark times. Line 358 explains V8 inlining. Lines 420 to 422 give per-path skinning internals. Line 183 lists ten unread pointer kinds in prose. Lines 393 to 402 give the key storage.
- Proposed edit:
  - "Load cost": keep line 50's first and fourth sentences. Put the rest and line 52's figures in a details block, "Technical details: how clips load".
  - Line 183: keep "A pointer that the engine does not read leaves the value as the file has it, and development builds warn about each one." Put the list as bullets in a details block, "Technical details: pointers the loader leaves out".
  - Lines 358 to 374: keep one sentence ("A crowd whose weights change in each frame can make garbage; call the joint calls from a small function of their own."). Put the explanation and the code in a details block, "Technical details: keeping a crowd's weights from boxing".
  - Lines 420 to 424: keep three sentences (every material skins in the vertex shader; skinned meshes that share a mesh and a material draw in one instanced draw; call `await scene.warmUp()` on WebGPU). Put the skinning pass, the `?skinning=compute` switch and the culling spheres in a details block, "Technical details: how each GPU path skins".
  - Line 442, from "A character that stands still": details block, "Technical details: what a still character costs".
  - "Clips" (lines 389 to 402): keep line 391 and the three-bullet grid rule. Put byte sizes and the cubic resampling in a details block.

## 12. api/geometry: level planning internals belong in details blocks (medium, technical-details-block)

- Anchor: "## Levels of detail", lines 238 and 240; "## Morph targets", line 178; "## Large meshes", line 303.
- Claim: the planner's timings, its per-frame spreading, how parts share vertices, the 23 KB download and the piece rules (8 to 16 pieces, facing pieces for 1,024 triangles or more) are implementer detail. They hide the two facts a user acts on: levels arrive a few frames late, and `levels: false` turns them off.
- Evidence: line 238 from "The levels name the mesh's own vertices" to the end. Line 240 entire. Line 178 from "The engine stores, for each vertex" to the end.
- Proposed edit: add three details blocks: "Technical details: how the planner works" (line 238 tail), "Technical details: pieces of a large mesh" (line 240) and "Technical details: how morph targets are stored" (line 178 tail, the 16-bit float precision). For "Large meshes", keep "For the fewest draw calls, keep meshes under 65,535 vertices" in the main text. Put the WebGL2 primitive-restart reason and the shared-vertex copies in a details block.

## 13. api/assets: 14 long paragraphs (medium, long-paragraph)

- Anchor: lines 59, 63, 77, 79, 81, 104, 126, 171, 173, 229, 263, 283, 310 and 357.
- Claim: the worst are line 77 (128 words, 10 sentences, staged models), line 310 (125 words, 8 sentences, `onProgress`) and line 59 (99 words, hold mode). Line 173 (97 words) packs required against used extensions and two warnings into one block.
- Evidence: stats.json lines 52, 56, 70, 72, 74, 97, 119, 164, 166, 222, 256, 276, 303 and 350.
- Proposed edit:
  - Line 77: H3 "Models in stages". Paragraph one: the coarse level loads first and finer levels download as the camera comes close. Paragraph two: `maxLevels`, and cluster-tree bands.
  - Line 310: make the counting rules a bullet list (expected bytes, a response with no length, a failed download, the download list) under one lead sentence.
  - Line 173: split into "A file that requires the extension" and "A file that only uses it", with the warnings as a third short paragraph.
  - Line 263: make the face order and the size rules two bullets.
  - Line 283: split after "...and the light's direction at each texel."
  - Lines 59, 79 and 81: see finding 14.
  - Lines 63, 104, 126, 171, 229 and 357: split at the change of subject.

## 14. api/assets: implementer detail in the main flow (medium, technical-details-block)

- Anchor: line 59 (hold mode), lines 79 to 81 (how the loader loads), lines 245 to 254 (environment costs), line 250 (OpenEXR compressions), lines 355 to 357 (storage budgets).
- Claim: the hold-mode paragraph sits between the calls table and "glTF models". It is the second thing a newcomer reads, but it only matters to image tests. Lines 79 to 81 give download sizes and how code loads on first call. The environment bullets give GPU times on a MacBook Pro and phones, and the 20-stage refresh of the sky map.
- Evidence: line 59 opens "In hold mode, and while a recording replays...". Line 81 says "Three calls answer at once". Lines 251 and 254 give 20 ms, 50 to 110 ms and 1 ms per stage.
- Proposed edit: move line 59 to the end of "Loading screens" inside a details block, "Technical details: loads in hold mode and replays". Put lines 79 to 81 in a details block under "glTF models", "Technical details: what the first load downloads". Keep one sentence in the main text: "A worker parses the file outside the sketch's frames." Split the environment bullets (finding 24). Put the per-device timings, the sky-map refresh rules and the OpenEXR compression list in a details block, "Technical details: environment costs and formats". Put lines 355 to 357 (per-browser budgets and eviction) in a details block after "The cache of derived data".

## 15. api/debug: 12 long paragraphs (medium, long-paragraph)

- Anchor: lines 24, 66, 70, 138, 158, 209, 215, 234, 310, 401, 427 and 446.
- Claim: the worst are line 310 (146 words, 10 sentences), line 215 (120 words) and line 24 (104 words, 7 sentences). Line 24 is the first paragraph a reader meets, and it ends with a hold-mode rule.
- Evidence: stats.json lines 17, 59, 63, 131, 151, 202, 208, 227, 303, 394, 420 and 439.
- Proposed edit:
  - Line 24: keep the first three sentences (draws for one frame; call it in `onUpdate` each frame; each call adds its lines). Make the camera-relative drawing a second paragraph. Move the hold-mode sentence to a details block (finding 16).
  - Line 209: split after "...from either side." Move "Each `debug.stats` call sends a message..." and the four-times-a-second refresh to a separate "Cost" bullet.
  - Line 215: make the keyboard keys a short list. Move the header format (`120 Hz ≥60 fps · 16.7 ms`) to "The target".
  - Line 310: see finding 16.
  - Line 70: split after "...do nothing." and start the second paragraph with the `import.meta.env.DEV` advice.
  - Lines 66, 138, 158, 234, 401, 427 and 446: split each at the change of subject.

## 16. api/debug: measurement internals that belong in details blocks (medium, technical-details-block)

- Anchor: line 24 (last sentence), lines 123 to 130, 297 to 298, 310 to 314, 323 to 328, and 427.
- Claim: the hold-mode extra frame, the motion view's GPU history, the 2.4 KB that stays in release builds, how WebGPU copies culled counts back, how the browser counts shared memory, and the texture counting rules are all correct. But they bury the user-facing facts.
- Evidence: line 130 gives "about 2.4 KB after Brotli". Line 310 explains how job workers leave the job loop to run a memory measurement. Line 427 gives Chrome flags.
- Proposed edit: add details blocks:
  - "Technical details: debug lines in hold mode" (line 24, last sentence).
  - "Technical details: how the views draw" (lines 124, 128 and 130 after its first two sentences).
  - "Technical details: triangle counts on WebGPU" (lines 297 to 298). Keep in the main text: "In a production build on WebGPU, call `debug.frameStats()` once to count every triangle."
  - "Technical details: how the page measures its memory" (line 310 from "The browser counts a shared memory once", and line 314).
  - "Technical details: what the GPU memory figures count" (lines 323 to 328).
  - "Technical details: timestamp rounding" (line 427 from "A browser gives no period").

## 17. api/engine: the options table has 34 rows and long cells (medium, structure)

- Anchor: "## Options", lines 90 to 123.
- Claim: one flat table mixes required inputs, quality overrides, threading, memory, start handlers and test switches. Several cells run to 60 to 80 words (`hdr`, line 97; `cloudSteps`, line 99; `keepTextureCopies`, line 103). "Another value fails with E1213" repeats in seven cells. A reader looking for the handler options scrolls past the quality overrides.
- Evidence: lines 92 to 123. The E1213 sentence appears in the rows at lines 94, 99, 100, 102, 111, 112 and 113.
- Proposed edit: split into four tables under H3 headings: "Quality" (preset, presetCheck, targetFps, maxPixelRatio, antialias, hdr, shadows, cloudSteps, the preset overrides, depthPrepass, momentTransparency, still); "Threads and memory" (latency, sketchThread, memory, expectedObjects, largeWorld, keepTextureCopies, powerPreference); "The page" (transparent, input, stats, maxLabels, maxLabels3d, preload); and "Start and messages" (onProgress, onSketchMessage, onSketchError, onWorkerRetry, signal). Put `gpu` and `hold` in a fifth table, "Tests". Cut each cell to one sentence and a link. State once, under the tables: "A value out of its range fails the start with E1213."

## 18. api/features: the callbacks are described three times (medium, duplication)

- Anchor: "## The fields" (lines 81 to 89), "## Callbacks" (lines 267 to 271 and 275 to 280).
- Claim: `ready`, `quality`, `resize`, `reset` and `destroy` each get a fields-table row, a bullet and a second table row. The three versions differ slightly. For example, the bullet for `destroy` says "The registry does not call it", but the fields table says "Called once when the feature is removed or the engine stops". A reader has to merge them to learn who calls what.
- Evidence: line 89 against lines 271 and 280.
- Proposed edit: keep one table in "Callbacks": Callback | What it gets | Who calls it, and when. In the fields table, make each callback row "A callback: see [Callbacks](#callbacks)". Fix the `destroy` row so that it says what line 280 says.

## 19. api/feature-instances: the page lacks the sections its sibling pages have (medium, structure)

- Anchor: end of page, line 154.
- Claim: feature-draws and feature-effects end with "Errors", "Related pages" and "API reference". This page ends inside "Limits". Its API reference sentence reads as a tenth limit. The errors that the page raises (E1223, E1506 and E1406) are not listed.
- Evidence: the stats.json outline ends at "## Limits". Line 154 is the API reference sentence. Line 151 is the only mention of E1506.
- Proposed edit: add "## Errors" with E1223 (description), E1506 (a direct-draw device that got the draw after its first frame) and E1406 (adapter download). Add "## Related pages" with features.md, feature-draws.md, render.md#compute-passes and grass.md. Put "## API reference" above line 154.

## 20. api/assets: the page is 6,408 words and mixes glTF with lighting files (medium, split-page)

- Anchor: "## glTF models" (line 61) to "## Extensions that add-ons read" (line 173).
- Claim: about a third of the page is glTF: the mapping table, freeing models and add-on extension handlers. The rest is textures, LUTs, environments, cube maps, baked light, addresses, loading and caching. A reader who wants `loadEnvironment` must scroll past the extension tables. glTF readers and add-on authors also have different goals.
- Evidence: stats.json gives 6,408 words. Lines 61 to 173 cover glTF.
- Proposed edit: move "glTF models", "Freeing a model" and "Extensions that add-ons read" to a new page, api/gltf ("glTF models"). Keep the `loadGltf` row in the calls table, with a link. Leave a three-sentence section on api/assets with the short `loadGltf` example. Link the new page from animation.md (line 27) and scene.md.

## 21. api/controls, api/debug, api/geometry: docs point at repo test files and bench scripts (medium, internal-note)

- Anchor: controls.md line 106; debug.md line 335; geometry.md line 204.
- Claim: `tests/image/controls.spec.ts` and `bun run bench:allocation --calls` live in the engine's repository. A developer who installed the packages cannot run them. They read as maintainer notes and break the flow of a list of user-facing facts.
- Evidence: controls.md line 106 says "`tests/image/controls.spec.ts` checks it through every gesture, and `bun run bench:allocation --calls` samples it in every frame." debug.md line 335 and geometry.md line 204 end with "`bun run bench:allocation --calls` checks it."
- Proposed edit: cut the test file name and the bench command, and keep the fact: "`update` allocates nothing, so you can call it in every frame." If the proof matters to readers, put it in a details block, "Technical details: how the engine checks this", that names the engine's allocation benchmark without a repo path.

## 22. api/features: seven long paragraphs (medium, long-paragraph)

- Anchor: lines 26, 178, 180, 233, 257, 261 and 303.
- Claim: line 303 (111 words, 8 sentences) lists the throw conditions in prose and repeats the Errors table at line 311. Line 178 (80 words, 6 sentences) lists namespace rules in prose. Line 257 (108 words) explains GPU timing internals.
- Evidence: stats.json lines 19, 171, 173, 226, 250, 254 and 296.
- Proposed edit:
  - Line 178: make the rules a bullet list: name, package, reserved `null3d`, error-code range 2000 to 9999 with no overlap, and quality keys.
  - Line 303: replace with "`defineFeature` returns a frozen description with the defaults filled, and throws E1223 for any of the faults in [Errors](#errors)." Make the Errors cell a bullet list.
  - Line 257: keep the first sentence ("names no scope, and its row reads `gpu not measured`"). Put the one-frame-in-eleven, seven-pass and `later passes` rules in a details block, "Technical details: how the overlay times a feature". Line 261 joins it.
  - Lines 26, 180 and 233: split each at the change of subject.

## 23. api/feature-instances: the Limits list mixes topics and repeats earlier sections (medium, structure)

- Anchor: "## Limits", lines 143 to 152.
- Claim: ten bullets cover shadows, readiness, culling, capacity, memory, the camera conversion, back-face culling, pass order and setup timing. Three bullets repeat text from "The buffers" and "The count...". Facts a user must act on (run the compute with `band: 'before'`, create the draw in the setup, keep the count under `capacity`) are mixed with notes.
- Evidence: line 147 repeats line 112 (two buffers, double memory). Line 148 repeats line 139 (shadow views draw the count word).
- Proposed edit: put the three must-do rules first, as a numbered list under H3 "Rules": `band: 'before'`, create and await in the setup (E1506), and keep the count at or under `capacity`. Then H3 "Shadows" (lines 143, 148 and 149) and H3 "Culling" (lines 144 and 145). Cut lines 147 and 152, which repeat earlier text.

## 24. api/assets: "Environments" puts the choice of file in its last bullet (medium, scan-order)

- Anchor: "## Environments", lines 245 to 257.
- Claim: 13 bullets mix what an `Environment` holds, download sizes, GPU times, format limits, the sky map's refresh and advice. The advice a newcomer needs first ("prefer the tool's file for maps that ship with a game; HDR files suit maps that change", line 257) is the last bullet.
- Evidence: line 257 begins "The tool's file needs no reading or filtering at load, so prefer it...". Lines 248, 251 and 253 each repeat "loads the code and shaders ... resolves once they are ready".
- Proposed edit: after the list of two file kinds (lines 226 to 227), add a short H3 "Which to use" with line 257. Group the remaining bullets under H3 "When each one is ready": one bullet each for a KTX2 file, an HDR file, the room and the sky. Put the timings, the 65,408 clamp, the OpenEXR list and the 20-stage refresh in the details block from finding 14.

## 25. api/feature-draws, api/feature-effects, api/feature-instances, api/features, api/geometry: limits crowd the status banner (low, scan-order)

- Anchor: the blockquote at line 11 of each page.
- Claim: on most pages the banner is one sentence on status. On these five pages it also carries limits or an overview, so the first thing a reader sees is a crowded blockquote. features.md line 11 is five sentences. Its last ("A feature's preset settings, budget, GPU scope and stats work today") reads like a changelog.
- Evidence: feature-draws.md line 11 ("A draw records in the main view alone..."), feature-effects.md line 11, feature-instances.md line 11, features.md line 11, and geometry.md line 11 ("No call skins a mesh that you build...").
- Proposed edit: keep only the standard status sentence in each banner. Move each limit to the page's "Limits" section, or for geometry to the `joints` rule at line 118, which already says it. Cut the "work today" sentence from features.md.

## 26. api/controls: two long paragraphs (low, long-paragraph)

- Anchor: line 21 (opening), line 281 (gizmo layers).
- Claim: line 21 (97 words, 6 sentences) lists five kinds of control in prose. It reads better as a list that names each create call. Line 281 (119 words, 8 sentences) explains raycast layers that most users never change.
- Evidence: stats.json lines 14 and 274.
- Proposed edit: line 21 becomes a table Controls | Call | Moves like: orbit (`createOrbitControls`, model viewer), map (`createMapControls`, strategy map), fly, first-person, gizmos and drag. Line 281: keep two sentences ("The handles draw over the scene and answer the pointer before any scene object. They use layers 30 and 29; give `layers` and `pickLayers` another pair when your camera draws those."). Put the rest in a details block, "Technical details: the gizmo's layers".

## 27. api/controls: the "Pointer lock" section holds the first-person walk example (low, structure)

- Anchor: "## Pointer lock", lines 226 to 241.
- Claim: the `moveForward` and `moveRight` example and the walk-and-fly demo link are about first-person and fly controls, not pointer lock. A reader looking for how to drive first-person controls from code looks under "First-person controls" and does not find it.
- Evidence: line 226 opens "To move the camera from the sketch's own code, set `movementSpeed: 0`...". Line 241 links the demo for "first-person and fly controls".
- Proposed edit: move lines 226 to 239 to the end of "First-person controls", under an H3 "Moving from code". Move the demo link (line 241) to the top of "Fly controls" or "First-person controls", next to the first example.

## 28. api/engine: "What the engine reports" packs many fields into two long bullets (low, wall-of-text)

- Anchor: "## What the engine reports", lines 155 to 157.
- Claim: the `capabilities` bullet (about 110 words) and the `mode` bullet (about 130 words) each list about eight fields in prose. A reader looking for `maxInstances` or `renderFallback` must read the whole bullet.
- Evidence: line 155 names `tier`, `hdr`, `maxInstances`, `directDraws`, `drawPath` and `halfPrecision`. Line 156 names the build, latency, threads, job workers, preset, `presetCheck`, crashes, memory, `keepTextureCopies` and `renderFallback`.
- Proposed edit: make two tables, Field | What it gives, one for `engine.capabilities` and one for `engine.mode`. Keep `engine.report` as one sentence. Put the direct-draw measurement (Apple GPU in Safari) in a details block.

## 29. api/grass: six long paragraphs (low, long-paragraph)

- Anchor: lines 25, 69, 75, 92, 94 and 100.
- Claim: line 69 is fixed by finding 8. Line 92 (93 words, 7 sentences) and line 94 (70 words) explain per-view culling and the CPU path in detail. Line 100 (89 words, 7 sentences) ends with an unrelated tip about ground color.
- Evidence: stats.json lines 18, 62, 68, 85, 87 and 93. Line 100 ends "The ground's own color and the blades' root colors should meet at the hill's foot."
- Proposed edit: line 25: split after "...wind add-on's field." Line 75: split after "...so its two halves light apart." Lines 92 to 94: keep "Give the pass the drawing `camera`, so it culls tiles outside the view and thins far tufts" and "`compute: false` keeps the instance batch on both paths". Put the rest in a details block, "Technical details: how each path culls and thins". Line 100: split into sway distance (two sentences) and matching plants (two sentences). Move the ground-color tip to "The blade shape", beside `color`.

## 30. api/features: "Scene resources" and "Published outputs" read like change notes (low, unclear)

- Anchor: "## Scene resources", lines 131 to 133; "## Published outputs", line 145.
- Claim: "No pass makes a normals target today" and "A custom material reads the scene's depth now" use "today" and "now", which read as notes on a moving project. The docs rules ask for present facts. Line 131 repeats the `'normals'` row at line 124. Line 133 is a two-sentence paragraph whose link the reader already has.
- Evidence: line 124 says "No pass makes them". Line 131 says "No pass makes a normals target today". Line 133 says "A custom material reads the scene's depth now".
- Proposed edit: cut lines 131 to 133 to one sentence: "The first four resources are the scene inputs that a custom material can also declare (`SceneInput`); `FeatureResource` adds `'history'` and `'shadowAtlas'`." Put the motion-pass rule in the `'motionVectors'` row: "The motion pass runs only while a reader wants them." Rewrite line 145 as one present fact about where a compute pass's texture goes.

---

## Findings after the top 30 (not verified)

## 31. api/feature-draws: the `'resolve'` bullet is a dense paragraph (low, technical-details-block). Not verified.

- Anchor: "## Where it sorts", line 112.
- Claim: the bullet is about 130 words on MSAA, one-sample layers and fringes.
- Proposed edit: keep "`'resolve'` blends after the camera's other blended objects, once per pixel. Use it for soft, heavily overlapping surfaces such as Gaussian splats." Put the MSAA layer, the fringe and the fallback cases in a details block, "Technical details: the resolve layer".

## 32. api/feature-draws: the opening paragraph is dense, and part of the page is hard-wrapped (low, long-paragraph). Not verified.

- Anchor: line 24 (86 words, 5 sentences; stats line 17); lines 118 to 145.
- Proposed edit: split line 24 after "...that change its look." Join the hard-wrapped lines 118 to 145 into one line per paragraph, like the rest of the page.

## 33. api/feature-draws: the heading "A point cloud" shows one quad (low, unclear). Not verified.

- Anchor: "## A point cloud", line 28.
- Claim: the example draws a single quad with `addFeatureDraw`. A point cloud needs `addFeatureInstances`, which comes later.
- Proposed edit: rename the heading "A soft glowing quad". Or add a sentence: "The next section repeats this quad into a cloud."

## 34. api/feature-effects: the opening paragraph is dense (low, long-paragraph). Not verified.

- Anchor: line 22 (90 words, 7 sentences; stats line 15).
- Proposed edit: split after "...as it would to `post.addEffect`." Make "where it runs" (the custom-effect chain, after exposure and before bloom and the tone curve) a second paragraph.

## 35. api/feature-effects: the example uses calls that the page has not explained (low, example-placement). Not verified.

- Anchor: "## A depth of field", lines 28 to 76.
- Claim: the example calls `declareAddonNamespace`, `FeatureHost` and a `quality` callback with no lead-in. "Readiness and values" explains their order 30 lines later.
- Proposed edit: add a lead-in sentence before the code: "The add-on claims a namespace, registers its description with a `FeatureHost`, then places the effect. [Namespaces](features.md#namespaces) explains the first step." Add a comment at line 69: "Add the feature before you place it."

## 36. api/feature-instances: three long paragraphs and a dense row-layout bullet (low, long-paragraph). Not verified.

- Anchor: lines 26, 126 and 139 (stats lines 19, 119 and 132); bullet at line 109.
- Proposed edit: split line 26 after "On WebGL2 the page gives it." Put the row layout of line 109 (three matrix rows, `w` translation, ids, material index) in a details block, "Technical details: the layout of a row". Split line 139 after "...in the same frame."

## 37. api/geometry: the same rule appears twice (low, duplication). Not verified.

- Anchor: line 203 and line 259; line 228 and the "Left out" row at line 246.
- Claim: `updateVertices` taking away levels is stated in both places. The automatic-level thresholds also appear in prose and in the table.
- Proposed edit: keep the rule at line 203 and make line 259 a link. Keep the thresholds in the table and cut them from the prose.

## 38. api/geometry: the impostor paragraph is off-topic under "Levels by hand" (low, structure). Not verified.

- Anchor: lines 281 to 284.
- Claim: the paragraph is hard-wrapped and talks about baking impostor cards, not `setLevels`.
- Proposed edit: replace it with one line under "Levels of detail": "A far object can draw as a card instead: see [Impostors](impostors.md#make-a-card-read-as-its-mesh)."

## 39. api/grass: "Related pages" comes after "API reference" (low, structure). Not verified.

- Anchor: lines 106 to 114.
- Claim: every other page in the slice puts "Related pages" before "API reference".
- Proposed edit: swap the two sections.

## 40. api/grass: "The two GPU paths" reads as internals (low, technical-details-block). Not verified.

- Anchor: lines 88 to 96.
- Proposed edit: see finding 29. Keep three sentences of user-facing fact and put the per-view cull in a details block.

## 41. api/cameras: "Which frame a ray sees" is implementer detail (low, technical-details-block). Not verified.

- Anchor: lines 135 to 141.
- Proposed edit: keep "A click picks what the user saw: rays from `input.pointer` use the camera of the frame on screen at that event." Put the four-view history, the setup frames and the moving-object note in a details block, "Technical details: which camera a ray uses".

## 42. api/cameras: the views paragraph sits under the wrong heading (low, structure). Not verified.

- Anchor: line 143.
- Claim: `scene.createView`, `view.screenToRay` and `scene.viewAt` are about several cameras. The paragraph sits under "Which frame a ray sees".
- Proposed edit: move line 143 into "## Several cameras".

## 43. api/cameras: the focal length paragraph packs a table into prose (low, long-paragraph). Not verified.

- Anchor: line 47 (78 words, 6 sentences; stats line 40).
- Proposed edit: make the lens examples a small table, Focal length | Look: 24 mm wide, 50 mm normal, 85 mm portrait, and the default of about 25.7 mm (50 degrees).

## 44. api/debug: `gpuMs` and the ways to show the overlay are explained more than once (low, duplication). Not verified.

- Anchor: debug.md lines 279 and 427; debug.md lines 190 to 193 against engine.md lines 123 and 168.
- Proposed edit: keep the full `gpuMs` rule under "GPU time" and link to it from the table row. In engine.md, link to the overlay section instead of restating the last-call-wins rule.

## 45. api/debug: `debug.cullingSpheres` is hidden in a bullet about views (low, scan-order). Not verified.

- Anchor: line 129.
- Claim: a separate call with its own reader call (`cullingSpheresDrawn`) is the seventh bullet of the view notes. It does not show in the outline.
- Proposed edit: give it an H3, "Culling spheres", after the views table, with the two calls and a one-line example.

## 46. api/assets: the prefab members table has no lead-in or heading (low, scan-order). Not verified.

- Anchor: lines 104 to 114.
- Claim: a paragraph about vertex colors and light range sits between the mapping table and the `prefab.*` members table. The members table has no heading.
- Proposed edit: add an H3, "The prefab", with a lead-in sentence before the members table. Move line 104 under the mapping table as notes, or into a details block. Join the hard-wrapped lines 149 to 154.

## 47. Cross-page: hard-wrapped prose sits beside one-line paragraphs (low, structure). Not verified.

- Anchor: animation.md lines 209 to 238; assets.md lines 149 to 154; feature-draws.md lines 118 to 145; geometry.md lines 281 to 284; engine.md lines 40 to 48.
- Claim: most of the docs put one paragraph on one line. These blocks wrap at about 100 columns. In animation.md lines 232 to 235, the wrap joins two topics into one rendered paragraph: the inertial rules, then "A play that joins its layer keeps the weighted blend".
- Proposed edit: join each wrapped paragraph onto one line. Put a blank line before "A play that joins its layer" at animation.md line 234.

## 48. Cross-page: Errors tables without links (low, structure). Not verified.

- Anchor: feature-draws.md lines 156 to 161; feature-effects.md lines 121 to 126; features.md lines 309 to 311.
- Claim: other pages link each code to its error page, for example [E1218](../errors/E1218.md). These three tables give bare codes, though the pages exist (docs/errors/E1223.md among them).
- Proposed edit: link every code, as the other pages do.

## 49. Cross-page: Errors table cells that hold whole lists (low, wall-of-text). Not verified.

- Anchor: animation.md line 484 (E1218, about 110 words); assets.md line 368 (E1412).
- Proposed edit: make each long cell a short bullet list inside the cell, or split E1218 into rows by area: clips and layers, options, `animateProperty`, blends, joints and look-at.

## 50. api/animation: the reading order puts load cost and debug drawing before playing a clip (low, scan-order). Not verified.

- Anchor: "### Load cost" (line 48), "## Seeing the skeleton" (line 54).
- Claim: a newcomer loads a model and then meets benchmark times and a debug call before "Playing clips".
- Proposed edit: move "Load cost" into "Clips" (or the details block from finding 11). Move "Seeing the skeleton" after "Events", or to a one-line tip at the end of "Playing clips".
