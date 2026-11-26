# Readability and layout review: slice concepts-1

Pages: concepts/architecture, concepts/assets, concepts/backends, concepts/color-management, concepts/culling, concepts/handles, concepts/instances, concepts/large-worlds, concepts/lighting, concepts/lod.

Line numbers are lines of the generated page file (`docs/concepts/<page>.md`, front matter included). The line numbers in stats.json count from the end of the front matter, so they are 7 less than the lines given here. All ten pages are hand-written. Only the cross-page banner finding (rank 49) has a generated source.

Findings 1 to 30 were checked by reading each page in full. Findings 31 to 49 are marked "not verified": I saw them while reading but did not check them against other pages or the source.

Block format used in the proposals:

```
<details>
<summary>Technical details: what is inside</summary>

Markdown body.

</details>
```

---

## 1. concepts/lighting: a showcase's internals presented as engine API (high, unclear)

- Anchor: "### A scene that shows a time of day", lines 162 and 164.
- Claim: The text says "The island showcase holds its hemisphere light at 0.8..." and "A demo stage offers the share of a town's lamps as `stage.lamps`". `stage.lamps` is not an engine API. It comes from the demo harness. The reader has no link to the showcase and no way to get `stage`. A newcomer will look for `stage.lamps` in the API and not find it.
- Evidence: lighting.md:162, 164. `grep lamps packages/engine/src` finds no such API. The island showcase has the demo code `showcase/island/` (examples/demos.ts:186).
- Proposed edit: Rewrite the section with no harness names: "Scale the hemisphere light with the hour, and shift its colors cool at night. For example, take it from 0.8 with warm colors by day to about 0.06 with cool colors at night. Drive the change from your own night value, such as the share of lamps that are lit." Delete the `stage.lamps` sentence. To show the source, link it: "[The island showcase](https://github.com/null3d-engine/null3d/tree/main/examples/showcase/island/) does this."

## 2. Cross-page: grid cells and precision are explained four times, with figures that seem to disagree (high, contradiction)

- Pages: concepts/architecture, concepts/culling, concepts/large-worlds, concepts/lighting.
- Anchor: architecture "## Precision far from the origin" (110-112); culling "## Grid cells" (174-183) and "## What this means for your sketch" (212-219); large-worlds "## Grid cells" (28-36) and "## Limits" (113-117); lighting "## Lights far from the origin" (166-168).
- Claim: Each page explains the 1,024 m cells, the 64-bit camera offsets and the 512-cell limit again in its own words. The precision figures use different measures. Architecture gives "about 8 mm at 100 km" (a step). Culling gives "within about 4 mm" at 100 km and "about 3 cm" at 1,000 km (half a step). Large-worlds gives "6 cm at 1,000 km" and "steps of 8 mm or more" past 100 km. A reader who compares them sees 4 mm against 8 mm and 3 cm against 6 cm, and cannot tell which is right. Lighting calls the cell "about 1 km wide" and the others say 1,024 m.
- Evidence: architecture.md:110; culling.md:214; large-worlds.md:22, 74, 99; lighting.md:168.
- Proposed edit: Make large-worlds "Grid cells" and "Limits" the only full text. On the other pages, keep one or two sentences and a link. Culling: keep only what culling does with cells ("Skipping cells out of view"). Change "## Grid cells" to two sentences that link to [Grid cells](large-worlds.md#grid-cells). Delete the precision bullets of "What this means for your sketch" and link to [Limits](large-worlds.md#limits). Architecture: shorten "Precision far from the origin" to two sentences and a link. Lighting: reduce "Lights far from the origin" to one sentence in "Lights as objects" ("Lights use grid cells too, so a lamp far from the origin stays precise: [Large worlds](large-worlds.md)"). Use one measure everywhere: the step size, and say "step".

## 3. concepts/lod: 30 long paragraphs, some near 300 words (high, long-paragraph)

- Anchor: lines 23, 29, 37, 59, 93, 97, 99, 103, 107, 109, 111, 113, 115, 117, 119, 125, 127, 129, 139, 145, 160, 169, 184, 198, 211, 215, 221, 233, 235, 237.
- Claim: Nearly every prose paragraph is past the limit. The worst are 129 (298 words, 15 sentences), 127 (267 words, 15 sentences), 97 (225 words, 15 sentences), 145 (206 words) and 93 (162 words). A newcomer cannot find the rule that matters ("levels switch where their error covers under a pixel") among the storage and planning detail.
- Evidence: stats.json concepts/lod longParagraphs (30 entries).
- Proposed edit, by paragraph:
  - 29: make the planning condition a list. "A mesh made in code plans its levels at its first draw when: it holds 4,096 triangles or more, or it holds 256 or more and its copies hold 65,536 or more together." Then 2 sentences on the job workers. Move the "same planner as `--lod`" sentence into a details block.
  - 37: keep "Each level about halves the triangles of the one above, and switches in where its error covers under `lodThreshold` pixels." Move the governor and fade sentences to "Fading between levels" (see rank 27). Make the list of meshes that plan none a bullet list.
  - 93: keep 3 sentences: "The loader downloads a finer stage only after a view draws the level above it. A level that the camera never draws costs no download. The loader checks again about every 1.5 seconds." Move the timing (2 seconds of drawn frames) into a details block.
  - 97: keep "The tool halves triangles per level and stores them with `MSFT_lod`. `loadGltf` gives each mesh its levels, so copies and batches pick levels with no code." Move the vertex order, the copies of vertices, `NULL3D_lod_error`, `MSFT_screencoverage` and the 1,080-pixel screen into `<summary>Technical details: how the file stores levels</summary>`.
  - 99: merge with 97's block. The measured-error rule goes to rank 27.
  - 103 to 119, 125 to 129: see rank 5 (move to their own page or into blocks).
  - 139, 145: see rank 11.
  - 160, 169, 184, 198, 211: split each in two at the first change of subject. For example, 169: "how the band works" (3 sentences), then "how the dither phase is chosen" in a details block.
  - 215, 221: split the debug view colors into a short list (base = blue, lower levels to cyan, past the sixth = gray, hidden = magenta marker).
  - 233 to 237: keep 233 as the overview. Move 235 (octahedral atlas, three-view blend, normal relighting) into `<summary>Technical details: what a card bake stores</summary>`.

## 4. concepts/lighting: one page of 9,783 words covers four topics (medium, split-page)

- Anchor: whole page; 25 headings, 6 Mermaid diagrams.
- Claim: The page is the longest in the slice by far. Each of its four parts is a page-sized subject: lights, fog, image-based light (environments, probes, the probe grid), and sky with time of day. A reader who wants fog must scroll past clustering. A reader who wants the sky must scroll past the probe grid.
- Evidence: stats.json concepts/lighting words 9783, 25 headings.
- Proposed edit: Split into four pages, each with its own diagram:
  1. concepts/lighting "Lights and units": opening, "Kinds of light and their units", "Units and exposure", "Clustered forward shading", "Lights as objects", "Ambient and hemisphere lights", "Lights in scene passes".
  2. concepts/fog "Fog": "Fog", "Volumetric fog", "Where the land ends".
  3. concepts/environment "Environment light and probes": "Environment maps" and its H3s, "Reflection probes", "Light probe grid".
  4. concepts/sky "Sky and time of day": "Sky and backgrounds", "The physical sky", "Background cost", "Time of day".
  Keep lighting.md's anchors working with a short "Moved" list, or update the links in other pages. Each new page gets its own Related pages list.

## 5. concepts/lod: cluster trees and level pieces are implementer depth inside the user page (medium, split-page)

- Anchor: "## Cluster levels" (101-119) and "## Pieces of a large level" (121-129).
- Claim: These two sections hold about 2,000 words of memory limits, buffer layouts, browser extensions and planning thresholds. Most of it the engine does by itself. A user needs to know three things: what a cluster tree is, how to make one (`--clusters`, `--clusters --stages`), and when the engine falls back to whole levels. The sections sit before "How the engine picks a level", so a newcomer meets them before the core rule.
- Evidence: lod.md:103-129; paragraphs 113 (119 words), 115 (121), 117 (131), 119 (162), 127 (267), 129 (298).
- Proposed edit: Move both sections to a new page, concepts/lod-clusters "Cluster trees and level pieces", linked from lod.md. On lod.md, keep a short section of each:
  - "Cluster levels": paragraph 103 (what a tree is) and one sentence on `--clusters`. Then a bullet list of fallbacks: several copies, instance batches, the direct-draw path, skinned or morphed meshes, blended or masked materials, and WebGL2 without `WEBGL_multi_draw`.
  - "Pieces of a large level": "`--lod` sorts each level of 32,768 triangles or more into 8 to 16 pieces that face about one way. Each copy skips the pieces outside the view or facing away. The picture does not change."
  If the split is not wanted, wrap 107 to 119 in `<summary>Technical details: how the engine walks and draws a tree</summary>` and 127 to 129 in `<summary>Technical details: which meshes get pieces</summary>`.

## 6. concepts/architecture: nine long paragraphs, one of 322 words (medium, long-paragraph)

- Anchor: lines 33, 47, 83, 89, 106, 110, 141, 143, 159.
- Claim: Line 47 ("### When the job workers start") is one paragraph of 322 words and 23 sentences. It mixes the rule for starting workers, decoder rules, the script download, the 4.5-second pause, clock allocation and a benchmark. The others are 87 to 125 words.
- Evidence: stats.json concepts/architecture longParagraphs.
- Proposed edit:
  - 47: keep 4 sentences in the main text: "Each job worker costs about 3.5 MiB, so the engine starts none at first. When the parallel loops take 0.2 ms or more per frame, it asks for 2, then doubles after each later busy window, up to the most. Workers that start stay until the engine stops, and a small scene never starts one. `engine.mode.jobWorkers` gives the most, and the stats overlay counts the ones that run." Move the rest into `<summary>Technical details: how the engine times the job workers</summary>`: the 30-frame or 2-second window, the decoders that ask for 2, the cached script, the 4.5-second pause and why, and the 18-core Mac figures.
  - 33: split after "...while the sketch runs." The memory-sharing sentences become a second paragraph.
  - 83: split into "pipelines build in the background" and "the first frame waits; use `scene.warmUp()`".
  - 89: end the paragraph at "...in this order." Move the sentence on the other effects' passes to after the list.
  - 106: split into "WebGL2 has no compute passes" and "a new environment adds GPU work once". Move the render-graph cost sentence to the end of the list's intro.
  - 141: make it a list of facts: where a worker can draw; the fallback; the low-latency fallback and its warning; `engine.mode`.
  - 143: split into "what `sketchThread: 'main'` gives" and "what it costs (shared main thread, E1415)".
  - 159: split into "the memory kept for 30 seconds" and "`destroy({ release: true })` and the 45-second retry".

## 7. concepts/backends: eighteen long paragraphs (medium, long-paragraph)

- Anchor: lines 21, 35, 37, 60, 78, 80, 82, 84, 96, 98, 118, 120, 140, 144, 158, 168, 176, 190.
- Claim: Most sections are one or two long paragraphs. The worst are 37 (198 words), 190 (170), 168 (162), 176 (161) and 21 (121).
- Evidence: stats.json concepts/backends longParagraphs.
- Proposed edit:
  - 21: keep 4 sentences: WebGPU or WebGL2; same sketch code; tier picked once from feature tests. Move the thread-that-draws rule and the crash fallback into a two-item list under it.
  - 37: keep "On WebGL2 the job workers cull on the CPU and group visible objects the same way." Move data textures, three rotating textures, the 4-byte list, `visibleEntries`, the 64-row groups and `WEBGL_multi_draw` into `<summary>Technical details: how WebGL2 draws a frame</summary>`.
  - 168: becomes the switch table (rank 12).
  - 176: make it a list: what the engine rebuilds; texture copies on phones (`keepTextureCopies`, its memory cost); what happens without a copy; E1302 after repeated loss.
  - 190: keep "Safari before 18 is not supported. `createEngine` fails with E1306 before it starts a worker. The check covers every browser on iPhone and iPad." Move the Safari 17 faults and the user-agent parsing (the `AppleWebKit/` 600 rule) into `<summary>Technical details: why Safari 18 and how the check reads the browser</summary>`.
  - 60, 78 to 84, 120: see rank 13 (cut the repeats of the HDR text).
  - 96, 98: split each at the change from "which browsers have the extension" to "what the engine does without it".
  - 118: move to the capability table (rank 32).
  - 140, 144: make a 3-row table, "Path | Most objects and rows | Where the limit comes from", and put the texel arithmetic in a details block.
  - 158: split after the second sentence.

## 8. concepts/lighting: nineteen long paragraphs (medium, long-paragraph)

- Anchor: lines 76, 92, 94, 112, 114, 142, 146, 154, 168, 176, 178, 254, 329, 331, 335, 377, 417, 500, 518.
- Claim: The long paragraphs mix the user rule with how it is computed.
- Evidence: stats.json concepts/lighting longParagraphs.
- Proposed edit:
  - 94: keep "The engine applies the exposure to each light at its source. The picture is the same, but the scene's colors stay small enough for 16-bit floats." Move the 65,504 example and the CPU/shader list into a details block.
  - 112 and 114: keep the 16 x 9 x 24 grid in 112. Move the fitted slices of 114 into `<summary>Technical details: how slices fit the depth in view</summary>`.
  - 142: make the limits a list (1,024 lights per frame, 128 per cluster, `areaLights` caps area lights).
  - 154: keep the first two sentences. Move the "half the sum ... three multiply-adds" math into a details block.
  - 176, 178: split 176 into height fog and sun glow. Split 178 into "where fog mixes in (no pass, no texture)" and "`background` share and `fog: false`".
  - 254: make a list of the `setEnvironment` options (`intensity`, `rotation`, `null`, `envIntensity`).
  - 331: keep "Each probe holds the light that arrives at its point, and a mask for probes inside geometry." Move the L1 coefficients, the 12 numbers and the four filtered reads into a details block.
  - 335: make the bake numbered steps: cast rays, sky hits, back-face hits, front-face hits, `step` and `finish`.
  - 377: split into "when the background draws" and "how each kind draws".
  - 417: end the paragraph after "The fog then blends the edge." The list that follows stands on its own.
  - 500: move into a details block under the table list ("Technical details: aerial perspective").
  - 518: keep 2 sentences on what `timeOfDay` returns. Move the fog-color reasoning into a details block.
  - 76, 92, 146, 168, 329: split each in two at the change of subject.

## 9. concepts/instances: six long paragraphs, one of 238 words (medium, long-paragraph)

- Anchor: lines 72, 130, 134, 180, 184, 194.
- Claim: Line 180 ("## Culling") is one paragraph of 238 words and 17 sentences. It covers bounding radius, WebGPU, direct draws, blended rows, WebGL2 groups, cells and marks.
- Evidence: stats.json concepts/instances longParagraphs.
- Proposed edit:
  - 180: keep 3 sentences and a call example: "Each row culls with its own sphere: the row's position, and the mesh's radius times the row's largest scale. Use `setBoundingRadius(r)` when a vertex shader moves rows away from their origins. Call it at setup, because it rebuilds the draw tables." Move the per-path detail into `<summary>Technical details: how each GPU path culls rows</summary>` as bullets: WebGPU, direct draws, blended rows, WebGL2 groups of 64, cells, and the marked frame.
  - 72: split into "the arrays are views that can empty" and "so read them from the batch each frame".
  - 130: keep "A mark past capacity throws E1108. Development builds find writes without a mark and raise E1110." Move the 4,096-rows-a-frame sampling into a details block.
  - 134: see rank 22.
  - 184, 194: see rank 21.

## 10. concepts/lod: the core rule comes after the advanced sections (medium, scan-order)

- Anchor: heading order, lines 27 to 239.
- Claim: The order is: levels in code, levels by hand, material per level, asset tool, cluster levels, pieces, then "How the engine picks a level", bias, fading. A newcomer reads 2,000 words of clusters and pieces before learning how a level is picked.
- Evidence: stats.json concepts/lod headings.
- Proposed edit: Use this order: opening; "How the engine picks a level"; "Levels of meshes made in code"; "Give a mesh its levels by hand"; "A material per level"; "Levels from the asset tool"; "Fading between levels"; "The bias of one object"; "Small objects"; "Distance bands"; "Shadows"; "See the levels"; "Cards beyond the levels"; "Cluster levels" and "Pieces of a large level" (or a link to their new page, see rank 5); "Related pages".

## 11. concepts/lod: "factor" is used before it is defined, and the two formulas do not match (medium, term-before-definition)

- Anchor: "## How the engine picks a level", lines 136 and 139; "## Small objects", line 194.
- Claim: Line 136 gives `pixels = error × scale × render height / (2 × distance × tan(fov/2))`. Line 139 then says "The factor is the render height in pixels times the projection's `P[1][1]`, over twice the threshold in pixels". The formula has no "factor". Line 194 gives `pixels = diameter × factor × threshold / distance`, which uses the factor and the threshold in a new way. Line 153 says "The bias divides the factor". A reader cannot connect the three.
- Evidence: lod.md:136, 139, 153, 194.
- Proposed edit: Define the factor once, in the main text, right after the first formula: "The engine folds the render height, the field of view and the threshold into one number per view, the factor. A level switches in where error × scale × factor / distance falls under 1." Use that form at 194 too. Move the `P[1][1]` form and the distance rules of 145 (center less half the radius, the cap at twice the nearest point, the 2 km ground) into `<summary>Technical details: how the engine measures the distance</summary>`.

## 12. concepts/backends: test switches are a run-on paragraph (medium, wall-of-text)

- Anchor: "## Choosing a tier for testing", lines 162 to 172.
- Claim: Line 168 puts six URL switches into one paragraph of 162 words (`?half`, `?hdr`, `?scene-format`, `?prepass`, `?occlusion`). Lines 164, 166, 170 and 172 add `?uploads`, `?compile`, `?depth` and `?compression`. A reader who wants one switch must read them all.
- Evidence: backends.md:162-172.
- Proposed edit: Replace lines 164 to 172 with one table, "Switch | Values | What it does", one row per switch. Keep line 162 (`?gpu=`) as the intro. Move the mantissa-bit comparison of `rg11b10` into a details block under the table. Better still, if the Testing guide lists switches, move the table there and link to it.

## 13. Cross-page: HDR and the 8-bit path are explained on three pages (medium, duplication)

- Pages: concepts/backends, concepts/color-management, concepts/architecture.
- Anchor: backends "## Color and anti-aliasing on each tier" (58-84) and "## Capability flags" line 120; color-management "## HDR color and the final pass" and "### The 8-bit path" (56-71); architecture "## The passes of a frame" item 14 (104).
- Claim: All three describe which devices fall to the 8-bit path, when MSAA resolves straight into the canvas, the two-step final pass below render scale 1, and that `engine.capabilities.hdr` reports the path. Backends says it twice (80-82 and 120). The pages use slightly different lists of the effects that force a final pass. Architecture 104 gives "color grading, sharpening, outlines or transmission". Color-management 67 adds screen-space reflections, bounce light, soft particles, depth-reading materials, the moment transparency layer and full-screen passes.
- Evidence: backends.md:74-82, 120; color-management.md:60-71; architecture.md:104.
- Proposed edit: Make color-management "The 8-bit path" the only full text, with the full list of effects as bullets. Backends keeps its tier table (72-76) and one sentence that links to it. Delete 80, 82 and 120, or cut them to one sentence each. Architecture item 14 keeps "On the 8-bit path the scene's shaders tone map, and the frame may have no final pass ([Color management](color-management.md#the-8-bit-path))."

## 14. Cross-page: how each GPU path culls is explained on four pages (medium, duplication)

- Pages: concepts/backends, concepts/culling, concepts/instances, concepts/architecture.
- Anchor: backends "## How each path draws" (35-37) and line 118; culling "## How each path culls" (36-40); instances "## Culling" (180); architecture "## The passes of a frame" item 2 (92).
- Claim: The Apple direct-draw measurement, the 64-row groups on WebGL2 and cell skipping are each told three or four times. The details differ (culling gives the 25% and 0.15 ms thresholds, backends does not), so a reader cannot tell which page is complete.
- Evidence: backends.md:35, 37, 118; culling.md:36-40; instances.md:180; architecture.md:92.
- Proposed edit: Make culling "How each path culls" the full text. Backends keeps one sentence per path and a link ("[Culling](culling.md#how-each-path-culls) gives the detail"), plus its draw-call and upload detail. Instances keeps only what is special to rows (see rank 9) and links to Culling. Architecture item 2 stays as is.

## 15. concepts/lighting: the sky environment's refresh is described four times (medium, duplication)

- Anchor: "Environment maps" line 240; "### Cost" line 271; "## Sky and backgrounds" lines 406-412; "## Time of day" line 570.
- Claim: The 20-step refresh, the half-degree threshold and the frame counts appear in four places, with slightly different words ("20 stages" and "20 short steps"; "about 20 frames").
- Evidence: lighting.md:240, 271, 409-411, 570.
- Proposed edit: Keep the full list once, under "Sky and backgrounds" (406-412). At 240, 271 and 570, use one sentence and a link to [Sky and backgrounds](#sky-and-backgrounds). Wrap the step-by-step refresh (409-411) in `<summary>Technical details: how the sky's map refreshes</summary>`. Keep only "The light follows a sun that moves about 320 ms later at 60 frames per second" in the main text.

## 16. concepts/lighting: the environment's "Cost" section is a dense dump (medium, technical-details-block)

- Anchor: "### Cost", lines 264 to 284.
- Claim: Ten bullets, two of them over 100 words (271 on the sky refresh, 275 on WebGL2 texture units), and a measurement table for the built-in room's generator. The one actionable rule ("load environments while the scene loads, not during play") is buried in bullets 267 and 270.
- Evidence: lighting.md:264-284.
- Proposed edit: Open the section with the rule: "Load or ask for an environment while the scene loads. A call during play makes one long frame." Keep the bullets on download size and GPU memory. Move 275 (texture units, the order in which maps drop, E1209) and the device table (277-284) into `<summary>Technical details: texture units and measured times</summary>`. Bullet 271 goes to rank 15.

## 17. concepts/lighting: misplaced and repeated sections in the heading outline (medium, structure)

- Anchor: "### A scene that shows a time of day" (158); "## Lights far from the origin" (166); "## Lights in scene passes" (572).
- Claim: The time-of-day advice is an H3 under "Ambient and hemisphere lights", while "## Time of day" is an H2 360 lines later. "Lights far from the origin" is a whole H2 for one paragraph that repeats large-worlds. "Lights in scene passes" at the end repeats line 37 at the top.
- Evidence: lighting.md:37, 158-168, 572-574.
- Proposed edit: Move "A scene that shows a time of day" into "## Time of day" as its last H3 (and fix it as in rank 1). Fold "Lights far from the origin" into "Lights as objects" as one sentence (rank 2). Merge line 37 and "Lights in scene passes" into one place, and keep it at the end.

## 18. concepts/culling: the common user task sits between two occlusion sections (medium, scan-order)

- Anchor: headings: "GPU occlusion culling on WebGPU" (51), "Bounds that you set" (103), "Software occlusion culling on WebGL2" (119), "Grid cells" (174).
- Claim: "Bounds that you set" fixes a common bug (objects that vanish while a shader moves their vertices). It sits between two long occlusion sections, so a reader scanning for it must pass 50 lines of the GPU occlusion check. The two occlusion sections are also split apart by it.
- Evidence: stats.json concepts/culling headings.
- Proposed edit: Order: "How each path culls", "What each kind of object culls with", "Bounds that you set", "Skipping cells out of view" (with the short cell text from rank 2), "GPU occlusion culling on WebGPU", "Software occlusion culling on WebGL2", "What this means for your sketch", "Related pages".

## 19. concepts/culling: "The check during play" is implementer detail (medium, technical-details-block)

- Anchor: "### The check during play", lines 77 to 87.
- Claim: Five bullets explain the 120-frame trial, the 10% and 2% thresholds, the occluder groups and the still-view pause. A user needs one fact: the engine turns the passes off when they do not pay.
- Evidence: culling.md:79-87.
- Proposed edit: Keep: "The extra passes cost GPU time. About every 120 frames the engine tries a few frames the other way and keeps the faster choice. `engine.measure` reports the hidden objects as `occludedEntries`. `?occlusion-check=off` keeps the passes on, for tests." Move the five bullets into `<summary>Technical details: how the engine checks that occlusion culling pays</summary>`.

## 20. concepts/culling: seven long paragraphs (medium, long-paragraph)

- Anchor: lines 32, 36, 38, 40, 105, 159, 181.
- Claim: The opening paragraph (32, 120 words) packs the frustum test, camera-relative positions, cells and the list of views. Line 159 packs a benchmark into the reason for a default.
- Evidence: stats.json concepts/culling longParagraphs.
- Proposed edit:
  - 32: keep 3 sentences (what culling does, occlusion skips hidden objects, every view culls separately). Make the kinds of view a list.
  - 36: split after "...tests the sphere."
  - 38: keep 2 sentences and the `directDraws` and `drawPath` fields. Move the 25% and 0.15 ms thresholds into a details block.
  - 40: split after "...4 bytes each."
  - 105: split into "the default sphere" and "when a shader moves vertices outside it".
  - 159: keep "Every preset leaves software occlusion off. In the engine's S6 city benchmark on WebGL2 phones, it cost at least 3.5 times what it saved." Move the per-device figures into `<summary>Technical details: the S6 measurements</summary>`.
  - 181: removed with rank 2.

## 21. concepts/instances: rebuild rules and batching splits are walls that should be lists (medium, wall-of-text)

- Anchor: "## Automatic batching", lines 184 and 194.
- Claim: Line 194 (133 words) lists about 15 calls that rebuild the draw tables and 8 that do not, all inside sentences. Line 184 lists the cases where groups split in sentences. A reader cannot check one call quickly.
- Evidence: instances.md:184, 194.
- Proposed edit: For 194, use a two-column table: "Rebuilds the draw tables next frame" (create or destroy a batch or object, lights included; `setMaterial`, `setMesh`, `setParent`, `setDynamic`, `setBounds`, `setFrustumCulled`, `setCastShadows`, `setReceiveShadows`; `texture.destroy()`; `texture.update()` at a new size; shadows on or off; a new debug view) and "Never rebuilds" (transform setters, row writes, `setVisible`, `setLayers`, `setActiveCount`, `setRenderOrder`, other light and camera setters, `material.set`). Keep the advice sentence after the table. For 184, keep the first 3 sentences and make the split cases a bullet list.

## 22. concepts/instances: the add-on chunk-row API interrupts the user flow (medium, structure)

- Anchor: "## Rows that arrive in chunks", lines 132 to 142.
- Claim: This section is for add-on authors (Gaussian splats). It sits between "Static and dynamic batches" and "Pools", the two sections most users need next. It is a sequence of calls written as one 147-word paragraph. The source is also hard-wrapped at about 100 characters, unlike every other paragraph on these pages.
- Evidence: instances.md:134-142; stats.json concepts/instances longParagraphs line 127 (file 134).
- Proposed edit: Move the section to just before "## Related pages". Make the calls numbered steps: 1. `batch.createChunkRows()`; 2. `writer.reserve(count)`; 3. `writer.write(slot, chunk)` per chunk; 4. `writer.pack(counts)` in each frame that the chosen rows change; 5. `writer.destroy()`. Then add one sentence on which batches cannot take chunked rows. Join the hard-wrapped lines into one line per paragraph.

## 23. concepts/architecture: pass list items hold paragraphs of detail (medium, technical-details-block)

- Anchor: "## The passes of a frame", items 3 (line 93), 8 (line 98) and 14 (line 104).
- Claim: Item 14 is about 230 words: HDR final pass steps, the two-step split below render scale 1, and the 8-bit path with its exceptions. Items 3 and 8 are about 100 words each. The list stops being scannable.
- Evidence: architecture.md:93, 98, 104.
- Proposed edit: Cut each item to one or two sentences and a link. Item 14: "The final pass draws the scene color into the canvas: bloom, vignette, exposure, tone mapping, outlines, color grading, sRGB and dither, and FXAA in that mode ([The post-processing chain](post-processing.md))." Put the render-scale split and the 8-bit path into `<summary>Technical details: the final pass on each path</summary>` under the list, or link to color-management (rank 13). Item 3: keep "Skinning: vertex shaders skin most meshes. A compute pass morphs and skins the rest, once per frame." Move the debug-view and pose-cache sentences into the same block.

## 24. concepts/assets: the glTF extension list is one 28-name sentence (medium, wall-of-text)

- Anchor: "## Models and prefabs", line 43.
- Claim: The supported extensions are a comma list inside a sentence. A reader who checks one extension must read all 32 names. The list mixes geometry, textures, materials, lights, animation and the engine's own extensions.
- Evidence: assets.md:43.
- Proposed edit: Keep in the main text: "The loader reads `.glb` and `.gltf` files and most Khronos extensions. A file that requires an extension the loader does not read fails with E1417. An extension that a file only uses is left out." Put a grouped table in `<summary>Technical details: the glTF extensions the loader reads</summary>`: Geometry (quantization, meshopt both names, Draco, GPU instancing, `MSFT_lod`), Textures (basisu, webp, avif, transform), Materials (unlit through anisotropy), Scene (lights_punctual, animation_pointer, node_visibility, NEEDLE_*), null3D's own (`NULL3D_mesh_bvh`, `NULL3D_occluder`, `NULL3D_clusters`, `NULL3D_pieces`).

## 25. concepts/assets: ten long paragraphs (medium, long-paragraph)

- Anchor: lines 25, 29, 43, 49, 59, 61, 63, 67, 118, 126.
- Claim: The opening (25, 114 words) restates the diagram and every section. Line 67 (146 words) mixes image formats, errors, the KTX2 transcode and the cache. Lines 49 to 63 tell the meshopt and Draco story over five paragraphs.
- Evidence: stats.json concepts/assets longParagraphs.
- Proposed edit:
  - 25: keep the first 3 sentences (what assets are, what a prefab is, copies share GPU data). Delete the rest, which the sections repeat.
  - 43: see rank 24.
  - 49 to 63: add a two-row table, "Format | Decoder size | Use it for", for meshopt (4 KB, the default, animated files) and Draco (60 KB, large static scans and product models, 14 to 27% smaller). Then keep one short paragraph each on fallback buffers, E1416 and the stored integer types.
  - 67: split into three paragraphs: images (formats, E1412); KTX2 (workers transcode it, a quarter or an eighth of RGBA); cache.
  - 118: move into `<summary>Technical details: limits inside meshopt blocks</summary>` under the limits table.
  - 29, 59, 61, 126: split each in two at the change of subject.

## 26. concepts/lod: no Related pages and no demo links (medium, example-placement)

- Anchor: "## API reference" (239-241); line 237 "the demo `examples/impostors`".
- Claim: It is the only page in the slice with no "Related pages" section. It names a demo as plain code text, not as a link. The forest demo, titled "Levels of detail", is not linked at all.
- Evidence: lod.md:237, 239-241; examples/demos.ts:955 (`forest/`, title "Levels of detail"), 973 (`impostors/`), 894 (`terrain/`).
- Proposed edit: Rename "## API reference" to "## Related pages", and list: [Geometry reference](../api/reference/geometry.md), [Quality](../api/quality.md), [The asset pipeline](../guides/assets-pipeline.md#levels-of-detail), [Impostors](../api/impostors.md), [Shadows](shadows.md), [The levels of detail demo](https://github.com/null3d-engine/null3d/tree/main/examples/forest/), [The impostors demo](https://github.com/null3d-engine/null3d/tree/main/examples/impostors/), [The terrain demo](https://github.com/null3d-engine/null3d/tree/main/examples/terrain/). At 237, link the demo name. Add the forest demo link under "Levels from the asset tool" too.

## 27. concepts/lod: when a level fades is explained four times (medium, duplication)

- Anchor: lines 37, 99, 166-167 and 178.
- Claim: "A measured error switches at once, and fades only when the governor raises the threshold above about 1.5 pixels" appears at 37, 166 and 178. "An error counts as measured only with the coverage beside it" appears at 99 and 166. Each copy has slightly different words.
- Evidence: lod.md:37, 99, 166, 178.
- Proposed edit: Keep the rule once, in "Fading between levels" (164-167), as the two bullets there. Delete the repeat at 178. At 37 and 99, use one sentence and a link to [Fading between levels](#fading-between-levels).

## 28. Cross-page: the banner under the title carries limits before the explanation (medium, scan-order)

- Pages: concepts/assets, concepts/lighting, concepts/lod.
- Anchor: the blockquote at line 11 of each page.
- Claim: Assets lists what is "built". Lighting gives the four-light cap and the area-light caps. LOD gives four exceptions (morphed objects, blends, skinned levels, hash masks, distance bands). A newcomer reads limits of features they have not met yet, before the diagram.
- Evidence: assets.md:11; lighting.md:11; lod.md:11.
- Proposed edit: Keep the banner to its first two sentences (release and stability). Move the limits to a "## Limits" section near the end of each page (LOD), or to the section they belong to (lighting: the four-light cap to "Kinds of light", the area-light cap to "Clustered forward shading"). Delete the assets status sentence ("... are built"): the page shows what exists.

## 29. concepts/color-management: six long paragraphs; the final pass steps and the 8-bit effects should be lists (medium, long-paragraph)

- Anchor: lines 25, 63, 67, 77, 104, 110.
- Claim: Line 63 (125 words) describes the final pass as a sequence in prose. Line 67 (152 words) lists about 12 effects that force the final pass inside sentences.
- Evidence: stats.json concepts/color-management longParagraphs.
- Proposed edit:
  - 63: numbered steps: 1. FXAA, in that mode; 2. vignette; 3. exposure and tone mapping; 4. color grading; 5. sRGB encode; 6. dither. Then one sentence on the two-step split below render scale 1, with its link.
  - 67: keep 3 sentences (which devices; shaders tone map; MSAA can resolve straight into the canvas). Then "These effects need the final pass:" as a bullet list.
  - 77: keep 2 sentences. Move the mask and the blended-surface rule into `<summary>Technical details: how each path keeps the display color</summary>`.
  - 25, 104, 110: split each in two. Line 110 and line 112 give the same advice ("`toneMapping: 'none'` at an exposure of 1"). Say it once, after both.

## 30. concepts/backends: "the demo" in an engine rule is unclear (medium, unclear)

- Anchor: "## Color and anti-aliasing on each tier", line 60.
- Claim: "when the start-up preset check lowers the preset, the demo draws with the lower preset's mode. The engine moves the canvas to a lighter mode for that, and never under the viewer's own preset change." The page is about the engine, so "the demo" reads as a mistake. "Never under the viewer's own preset change" is hard to parse.
- Evidence: backends.md:60.
- Proposed edit: "One exception: when the start-up check lowers the preset, the engine starts with the lower preset's mode. A preset change during play never changes the mode."

---

## Findings 31 to 49 (not verified)

## 31. concepts/lighting: "Where the land ends" is a how-to inside a concept page (medium, split-page) (not verified)

- Anchor: "### Where the land ends", lines 415 to 475.
- Claim: Sixty lines, two code blocks (a camera clamp and haze sheets) and a 4-step recipe. This is a cookbook recipe, not a concept.
- Proposed edit: Move the recipe and both code blocks to a cookbook page ("Hide where the land ends"). Keep two sentences and a link under the fog page (rank 4).

## 32. concepts/backends: capability fields are explained in scattered places (low, structure) (not verified)

- Anchor: "## Capability flags", lines 104 to 122.
- Claim: The code block lists ten fields with no meaning. `hdr` is explained at 82 and 120, `depth` at 98, `directDraws` and `drawPath` at 118, `maxInstances` at 140.
- Proposed edit: Replace the code comment with a table, "Field | What it says | More". Link each row to its section.

## 33. concepts/handles: two long paragraphs; the stale-handle rules should be a table (low, long-paragraph) (not verified)

- Anchor: lines 54 and 75.
- Claim: Line 75 (131 words, 9 sentences) mixes development and release behavior for setters, light setters, destroy, queued changes, batch arrays and world getters.
- Proposed edit: 75: a table, "Call on a destroyed object | Development build | Release build" (setters, light setters, a second `destroy()`, batch arrays, world getters). Keep "The call is still a bug" after it. 54: move the "read it in `onLateUpdate`" timing rule into its own paragraph, just before the code example.

## 34. concepts/culling: the software occlusion bullets mix guarantees, limits and advice (low, structure) (not verified)

- Anchor: lines 134 to 141.
- Claim: Eight bullets in one list. The advice ("Mark large, solid objects") sits between limits.
- Proposed edit: Three short lists: "What it guarantees" (134, 135), "Limits" (136, 139, 140, 141), "What to mark" (138). Move 137 (connected parts) into a details block.

## 35. concepts/architecture: the reason for the design comes after the dense detail (low, scan-order) (not verified)

- Anchor: "## Why the work is split this way" (49) after "### When the job workers start" (45).
- Claim: The four short reasons are the best newcomer text on the page. They come after the thread table and the 322-word job-worker paragraph.
- Proposed edit: Move "Why the work is split this way" to just after the opening paragraph. Make "When the job workers start" the last part of "The kinds of thread".

## 36. concepts/architecture: two mode tables overlap (low, duplication) (not verified)

- Anchor: "## Latency modes" (116) and "## Where the sketch runs" (132).
- Claim: Both tables list the modes. A reader must join them.
- Proposed edit: Merge into one H2 "Modes and threads". Keep the six-row thread table, and add a "Latency" column from the first table.

## 37. concepts/assets: meshopt against Draco should be a table (low, wall-of-text) (not verified)

- Anchor: "### Compressed meshes", lines 49 to 63.
- Claim: The comparison spreads over five paragraphs (part of rank 25).
- Proposed edit: See rank 25: a two-row table.

## 38. concepts/instances: the quaternion tolerance paragraph is hard to follow (low, unclear) (not verified)

- Anchor: line 74.
- Claim: "one that is wrong all the same can shear its row by up to about four per cent" is unclear.
- Proposed edit: "Write unit quaternions. The engine renormalizes a quaternion that is more than about 1% off unit length." Move the shear detail into a details block.

## 39. concepts/large-worlds: seven paragraphs a little over the limit (low, long-paragraph) (not verified)

- Anchor: lines 30, 32, 72, 74, 97, 103, 109.
- Claim: Each is 61 to 78 words, 5 or 6 sentences. Line 97 describes a test flight.
- Proposed edit: Split each at the change of subject. Move 97 and 99 into `<summary>Technical details: how the engine tests a moving camera</summary>`, and keep "A camera far from the origin moves as smoothly as one near it."

## 40. concepts/large-worlds: demo links only at the end (low, example-placement) (not verified)

- Anchor: "## Large-world mode" (38).
- Proposed edit: Add "[The large world demo](https://github.com/null3d-engine/null3d/tree/main/examples/large-world) drives along a road on the Earth's surface." after the second code block. Add the far-from-origin demo link under "Grid cells".

## 41. concepts/lighting: fog slices per preset should be a table (low, wall-of-text) (not verified)

- Anchor: line 203.
- Proposed edit: A table, "Preset | Slices | Cells on the short side": Low 0, Medium 32/64, High 64/96, Ultra 96/128.

## 42. Cross-page: British and American spelling are mixed (low, structure) (not verified)

- Pages: concepts/lighting ("colour", "coloured" at 335; "metre" at 357), concepts/color-management ("honours" at 77), concepts/lod ("Neighbours" at 107; "neighboring" at 169), concepts/instances ("per cent" at 74).
- Proposed edit: Use American spelling, as the API names do (`color`).

## 43. concepts/lighting: demo links only at the end (low, example-placement) (not verified)

- Anchor: "Environment maps", "Reflection probes", "Volumetric fog", "The physical sky", "Kinds of light".
- Proposed edit: Add inline links: environment demo under "Environment maps"; `reflection-probes/` under "Reflection probes"; `light-shafts/` under "Volumetric fog"; `atmosphere/` under "The physical sky"; `area-lights/` after the area-light paragraph (61); `time-of-day/` under "Time of day".

## 44. concepts/lighting: the opening puts setter mechanics before the kinds of light (low, scan-order) (not verified)

- Anchor: lines 28 to 37.
- Claim: The page opens with the light table, setter inlining and the per-frame steps. A newcomer first needs the kinds of light and their units.
- Proposed edit: Keep line 28. Move 30 to 37 to the end of "Clustered forward shading" as "What the engine does each frame". Delete the inlining tip or move it to the performance guide.

## 45. concepts/handles: the slot field list is implementer detail (low, technical-details-block) (not verified)

- Anchor: line 62.
- Proposed edit: Wrap the field list in `<summary>Technical details: what a slot holds</summary>`.

## 46. concepts/color-management: the background advice is said twice (low, duplication) (not verified)

- Anchor: lines 110 and 112.
- Proposed edit: Say "use `toneMapping: 'none'` at an exposure of 1" once, after both kinds of background.

## 47. concepts/color-management: the automatic exposure demo is not linked (low, example-placement) (not verified)

- Anchor: line 106.
- Proposed edit: Add "[The automatic exposure demo](https://github.com/null3d-engine/null3d/tree/main/examples/auto-exposure/)" to the paragraph.

## 48. concepts/instances: hard-wrapped source lines (low, structure) (not verified)

- Anchor: lines 134 to 142.
- Proposed edit: One line per paragraph, as on every other page (see rank 22).

## 49. Cross-page: "Roadmap step 0.x" means nothing to a reader (low, internal-note) (not verified)

- Pages: all ten pages in this slice, line 11.
- Claim: "Roadmap step 0.1, first released in null3D 0.1.0" names a maintainer plan step. Every page says the same release (0.1.0), so the step number tells a user nothing.
- Generated source: tools/lib/steps.ts (`releaseOf`, `shipsSentence`); the banner check in tools/lib/docs.ts.
- Proposed edit: Make `shipsSentence` give "First released in null3D 0.1.0." for the roadmap steps, and update the check in docs.ts and the pages.
