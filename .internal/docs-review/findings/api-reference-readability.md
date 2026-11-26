# API reference pages: readability and layout review

Slice: `api-reference` (39 generated pages under `docs/api/reference/`).
Role: readability and layout.

All 39 pages come from TSDoc comments, read by `tools/lib/api-docs.ts` (`readApi`, `renderSymbol`, `renderReference`) and wrapped by `referencePage` in `tools/lib/docs.ts`. Most issues repeat on many pages because they come from the generator. Those are written once, as cross-page findings, with the generator as the source to change.

Line numbers are page file lines in the generated copy. The `line` values in stats.json count from after the 7-line front matter, so page line = stats line + 7.

Numbers used below:

- 2,704 member table rows. 119 of them have a description over 90 words. The longest has 462 words (`MeshGeometry.buildLevels`, geometry line 492).
- 41 long paragraphs on 22 pages (stats.json). 14 of them are several TSDoc paragraphs that the generator joined into one.
- 364 error code mentions (E1xxx) on the reference pages. None is a link.
- 787 option rows (`name?:`). 600 of them give their default inside the prose.
- No page has an H3. Every export is an H2, in name order.

Findings 1 to 30 are verified against the pages and the source. Findings 31 and later are marked "not verified".

---

## 1. The generator joins TSDoc paragraphs, lists and code blocks into one line

- Pages: tasks, scene, impostors, engine, debug, features, render, splats, geometry, lights, assets (every page with a multi-paragraph comment).
- Severity: high. Category: wall-of-text.
- Source: `tools/lib/api-docs.ts`, `summaryOf` calls `flat()`, which replaces every newline run with one space.
- Claim: a comment with blank lines between its paragraphs renders as one paragraph. A bullet list renders as inline "- `x`: ..." text. A fenced code example renders as inline text with its "```ts" markers visible.
- Evidence:
  - `runTask` (tasks line 19): the source (`packages/engine/src/shared/run-task.ts:21-53`) has 7 paragraphs. The page has one paragraph of 381 words and 18 sentences.
  - `timeOfDay` (scene line 492): the source example (`packages/engine/src/scene/time-of-day.ts:211-221`) renders as "``` ```ts const day = emptyTimeOfDay(); timeOfDay('goldenHour', {}, day); ... ```" in one line of prose.
  - `loadImpostorAtlas` (impostors line 316): the same broken code example.
  - `DrawPathReason` (engine line 78): the source list (`packages/engine/src/gpu/webgpu/draw-path-probe.ts:54-61`) renders as "...drawPath`: - `probe-faster`: ... - `probe-not-faster`: ...".
  - `EngineMode.reason` source list (`packages/engine/src/page/engine.ts:656-659`) has the same problem.
  - 14 of the 41 long paragraphs in stats.json have 2 or more source paragraphs: debug 25, engine 78, features 65, geometry 229 and 457, impostors 142 and 325, lights 33, render 43, scene 115 and 492, splats 55, tasks 19, assets 335.
- Proposed edit: keep the comment's block structure for export summaries. Split the comment text on blank lines, keep fenced code blocks and list items as they are, and flatten only the lines inside one prose paragraph. Use `flat()` only for text that goes into a table cell. Add a generator test with a two-paragraph comment, a bullet list and a code fence.

## 2. Long member descriptions are locked inside table cells

- Pages: 22 pages. The worst: scene (21 cells over 90 words), engine (24), assets (12), materials (11), debug (7), geometry (6), quality (5), lights, objects, post, render, textures (4 each).
- Severity: high. Category: structure.
- Source: `tools/lib/api-docs.ts`, `renderSymbol` puts every member in a `| Member | Description |` row.
- Claim: a table cell holds one line of text. It cannot hold paragraphs, lists, code or a details block. So the longest, most important member docs are the hardest to read. On a phone the reader scrolls sideways through 200 to 460 words.
- Evidence: 119 of 2,704 rows are over 90 words. `MeshGeometry.buildLevels` (geometry line 492) is 462 words in one cell. `render.addPass` (render line 173) is 302 words. `engine.preload` (engine line 212) is 287 words. `Debug.view` (debug line 31) is 280 words. `Scene.pick` (scene line 412) is 262 words. The `Scene` class has 47 rows and 4,398 words in one table. `EngineOptions` has 42 rows and 3,375 words. `QualitySettings` has 48 rows and 3,326 words.
- Proposed edit: keep the table as the index of members. When a member's summary has more than about 40 words or more than 2 sentences, the cell keeps the first sentence and a link, "[More](#scenepick)". The full text goes under an H3 below the table, such as "### `Scene.pick`", with the signature in a `ts` code block and the summary in its own paragraphs. This keeps headings at H3 or above and makes finding 3 possible.

## 3. There is no way to put dense detail into a technical details block

- Pages: every reference page.
- Severity: high. Category: technical-details-block.
- Source: `tools/lib/api-docs.ts` (`DOC_TAGS`, `misreadTags`, `renderSymbol`), and the TSDoc comments.
- Claim: many comments mix what a reader needs (what the call does, when to call it) with dense detail for implementers (how the engine splits work, buffer layouts, browser quirks). Today both render as one block of prose. There is no TSDoc form that the generator turns into a collapsible block.
- Evidence: `MeshGeometry.buildLevels` (geometry line 492) explains part splitting past 65,535 vertices, pieces of 32,768 triangles, one part read per frame and sorted index copies, inside the same cell as its basic use. `Engine.destroy` (engine line 111) explains the page keeping 2 shared memories for about 30 seconds and Safari's memory delay. `render` compute pass options (render line 43) list the bind groups and the uniform block layout. `mergeFarGeometry` (impostors line 325) gives the inverse-transpose maths for normals and the winding rule for mirrored copies. `Debug` (debug line 25) mentions "one traversal of the scene's objects whose meshes have levels, which the culling spheres read".
- Proposed edit: add a custom block tag, `@details`, to `DOC_TAGS`, so `misreadTags` stops reading it as text. Render its text after the summary as:

  ```
  <details>
  <summary>Technical details</summary>

  (the tag's text, with its paragraphs and lists)

  </details>
  ```

  Allow it on exports and on members that render as H3 (finding 2). The check should reject a heading or a nested `<details>` inside it, and the main summary must read well alone. Then move the detail listed in findings 8, 13 to 22 into `@details`.

## 4. Pages that mix packages do not say which package an export comes from

- Pages: geometry, particles, debug, math, sound.
- Severity: high. Category: missing-prerequisite.
- Source: `tools/lib/api-docs.ts` (`API_PACKAGES`, `ApiSymbol`, `renderSymbol`).
- Claim: a newcomer cannot tell what to import from where. The geometry page holds `BoxOptions` and `MeshGeometry` from `@null3d/engine` next to `EllipseCurve`, `extrude` and `Shape` from `@null3d/geometry`, with no mark. On the particles page, the pairs `EmitterShape` and `ParticleEmitterShape`, `ParticleBurst` and `ParticleEmitterBurst`, `SubEmitter` and `ParticleEmitterSub` look like duplicates. `EmitterShape` (line 21) and `ParticleEmitterShape` (line 122) have the same type and the same 100-word text (lines 32 and 133). The reader does not know which one to use.
- Evidence: `packages/particles/src/index.ts:10` exports `EmitterShape`. `packages/engine/src/index.ts:225` exports `ParticleEmitterShape`. The geometry page lists exports of both `packages/engine/src/index.ts` and `packages/geometry/src/index.ts` (`API_PACKAGES`).
- Proposed edit: store the package name (and subpath, such as the math or stats entry) on each `ApiSymbol`. Under each H2, print "From `@null3d/geometry`." in place of, or next to, the kind line. When two exports share a type, make one comment say "The same shape as [`ParticleEmitterShape`](#particleemittershape), for code that imports `@null3d/particles`." and keep the full text in one place.

## 5. The generator drops `@param` and `@returns` text

- Pages: impostors, geometry, grass, engine (version helpers).
- Severity: high. Category: missing-content.
- Source: `tools/lib/api-docs.ts`. `summaryOf` uses `getDocumentationComment`, which leaves out tags, and `renderSymbol` never prints `param` or `returns` tags. The TSDoc comments in `packages/impostors/src/hand-over.ts:127-131`, `packages/engine/src/scene/level-rule.ts:147-204`, `packages/grass/src/hash.ts`, `packages/engine/src/shared/version.ts`.
- Claim: the parameter docs exist in the source but not on the page. `handOverToCards` (impostors line 136) shows no word about `switchDistance` or `start`. `levelAt` (geometry line 344) does not say what `scale`, `radius` or `distance` mean, though the source does.
- Evidence: `hand-over.ts:129` "@param switchDistance The distance from the camera at which these trees hand over, in meters." The page section at impostors lines 136-142 has no such text.
- Proposed edit: render a "Parameters" table (Name, Description) and a "Returns" line after the summary of any function or method with these tags. A member with tags renders as an H3 (finding 2), since a table cell cannot hold them.

## 6. "which extends `Omit`" hides what an options type inherits

- Pages: feature-draws (line 33), feature-effects (line 30), feature-instances (line 34), materials (line 56), lines (line 75), particles (line 252), vertex-draws (line 42).
- Severity: high. Category: wrong-claim.
- Source: `tools/lib/api-docs.ts`, `readApi`: `bases = extended.map((t) => t.expression.getText())` keeps only the name and drops the type arguments.
- Claim: "Interface `FeatureDrawOptions`, which extends `Omit`." tells the reader nothing. The source is `extends Omit<ShaderOptions<Wgsl>, 'wgsl'>` (`packages/engine/src/scene/feature-draws.ts:53`): every shader material option except `wgsl`. The reader cannot find the inherited options. `LineValues` reads "which extends `Omit`, `Pick`."
- Proposed edit: print the full heritage type, `Omit<ShaderOptions<Wgsl>, 'wgsl'>`, and link the base name to its section. Better, say it in words: "It takes every option of [`ShaderOptions`](materials.md#shaderoptions) but `wgsl`."

## 7. A decision record number and a maintainer command appear in user docs

- Pages: engine (line 618), scene (line 492).
- Severity: high. Category: internal-note.
- Source: `packages/engine/src/page/capabilities.ts:115` and `packages/engine/src/scene/time-of-day.ts:207-208`.
- Claim: AGENTS.md forbids decision record numbers in docs. `WebGPUReport.directDraws` ends with "the direct path removes (D-174)". `timeOfDay` says "`bun run bench:allocation --time-of-day` checks that.", a repository benchmark that a user of the engine cannot run.
- Proposed edit: in `capabilities.ts:115`, delete "(D-174)". In `time-of-day.ts`, delete the benchmark sentence and keep "a day cycle then allocates nothing, so a sketch can move the time in every frame." The docs style check could also block `D-\d{3}` in generated pages.

## 8. Tasks page: one 381-word paragraph holds the whole of `runTask`

- Page: api/reference/tasks. Anchor: `runTask`, line 19.
- Severity: high. Category: wall-of-text.
- Source: `packages/engine/src/shared/run-task.ts:21-53`.
- Claim: the page's main export is one 18-sentence paragraph. Finding 1 restores the 7 source paragraphs. Some of the content still reads better as a list or a details block.
- Proposed edit, after finding 1:
  - Keep paragraphs 1 to 3 (what runs where, when the promise resolves, order of answers) as the main text.
  - Turn the last paragraph into a list: "A task's input and output can hold: numbers, strings, plain objects and arrays; typed arrays; `ArrayBuffer`s and `SharedArrayBuffer`s; the objects that the transfer list names."
  - Turn the failure paragraph into a list of the three cases that reject with `TaskFailure`.
  - Move the `SharedArrayBuffer` and `Atomics` paragraph and the paragraph about the task worker fallback into `@details`.

## 9. No page map: exports are in name order, and the main entry is buried

- Pages: every reference page. Worst on scene (36 exports), geometry (69), debug (44), engine (40), controls (30).
- Severity: medium. Category: scan-order.
- Source: `tools/lib/api-docs.ts`, `readApi` sorts by name (`symbols.sort((a, b) => a.name.localeCompare(b.name))`), and `renderReference` prints them in that order.
- Claim: a newcomer looks for the main object first, and the page hides it. On scene, `Scene` is at line 365 of 540, after 24 option and sky types. On engine, `CapabilityReport` comes first and `createEngine` fourth (line 48). On geometry, `buildLevels` is a method and `BuildLevelsOptions` is at line 34, far from `MeshGeometry` (line 476). On controls, each `create*Controls` function is far from its class and options. There is no list of exports at the top, so a 69-export page can only be scrolled.
- Proposed edit: after the intro quote, print an index table: Export, Kind, first sentence of the summary, each name linked to its H2. Order the H2 sections as: functions and classes that create or run things, then their options interfaces, then other types and constants. A `@group` order is another option. Let the page declare its main exports in `PAGES` (`tools/lib/docs.ts`) so they come first.

## 10. Names in the reference are not links: types, base classes and error codes

- Pages: every reference page.
- Severity: medium. Category: structure.
- Source: `tools/lib/api-docs.ts`, `renderSymbol`.
- Claim: a reader who sees `options?: PlayOptions` in a signature, or "which extends `Object3D`", must search for that name by hand, often on another page. 364 error codes, such as "Throws E1101 for a destroyed mesh", are plain text, though each code has its own page under `docs/errors/`. Apart from the intro quote, only assets (lines 31-33) and engine (line 104) have a link, and scene line 115 has a broken one.
- Evidence: animation `Animator.play(name: string, options?: PlayOptions)` (line 45), cameras "Class `Camera`, which extends `Object3D`." (line 15), engine `onFailure` "(E1302" (line 97).
- Proposed edit: after rendering, link each code span or signature word that names an export to its section, on the same page or `../reference/<page>.md#<anchor>`. Link each `E\d{4}` to `../../errors/E1101.md`. Inside table signature cells, link the type names after the code span, or in an "Uses" line, since links inside a code span do not work.

## 11. Value lists are written as prose walks; they fit a table

- Pages: materials (`AlphaMode` line 19, `Blending` line 27), post (`ToneMapping` line 220), scene (`FogCurve` line 151), particles (`ParticleFacing` line 154, `EmitterShape` line 32, `ParticleEmitterShape` line 133), engine (`DrawPathReason` line 78, `DepthMode` line 62).
- Severity: medium. Category: wall-of-text.
- Source: the TSDoc comments of those types, and `renderSymbol`.
- Claim: each paragraph says "The `opaque` mode ... The `mask` mode ... The `hash` mode ...". A reader scans for one value and must read every sentence. Six of these paragraphs are in stats.json as long.
- Proposed edit: write the values as a TSDoc list, "- `mask`: draws nothing where the alpha falls below `alphaCutoff`, and draws the rest opaque." After finding 1, the list renders as a list. Or let the generator turn a type whose comment is a list of "`value`: text" items into a Value | Meaning table. Keep a one-sentence lead: "How a material uses its alpha: its opacity, times its base color map's alpha, and times its vertex alpha."

## 12. Error rules are buried inside long prose

- Pages: features (line 65), render (line 173), materials (line 142), scene, engine, geometry. 97 "Throws", "rejects with" or "fail with" sentences in all.
- Severity: medium. Category: wall-of-text.
- Source: the TSDoc comments; `tools/lib/api-docs.ts`.
- Claim: a developer looks up an error code to find which call threw it and why. Today the rules sit at the end of long cells. `defineFeature` (features line 65) packs ten throw conditions for E1223 into one 90-word sentence. `render.addPass` (render line 173) lists E1220, E1215, E1216, E1502, E1503, E1504 and E1505 in four sentences.
- Proposed edit: support `@throws` tags, one per code: "@throws E1223 for an option that a description does not take." Render them as an "Errors" list under the member's H3, with each code linked to its error page (finding 10). For E1223 in `defineFeature`, make the conditions a bullet list.

## 13. Engine page: long paragraphs and cells, and detail for test tools

- Page: api/reference/engine.
- Severity: medium. Category: long-paragraph.
- Source: `packages/engine/src/page/engine.ts:568` and `:1803`, `packages/engine/src/gpu/webgpu/draw-path-probe.ts:52`, and the member comments of `Engine` and `EngineOptions`.
- Long paragraphs (stats.json): line 54 `createEngine` (77 words, 5 sentences), line 62 `DepthMode` (96 words, 7 sentences), line 78 `DrawPathReason` (140 words, 10 sentences). 24 cells are over 90 words: `preload` (line 212, 287 words), `Engine.destroy` (line 111, 238), `input` (line 211, 202), `onFailure` (line 97, 180), `captureFrame` (line 107, 166).
- Proposed edit:
  - `createEngine`: keep the first two sentences. Move hold mode, `window.__null3dHold` and the `?bench` switch into `@details`. They are for test and benchmark tools.
  - `DepthMode`: make a three-row table (`reversed`, `reversed-gl`, `standard`: what the near and far planes store, and where it applies).
  - `DrawPathReason`: one sentence and a Value | Meaning table (findings 1 and 11).
  - `preload`: keep "Features whose shaders load before the first frame, for a game that must fetch nothing while it plays." Move the list of what triggers each feature into `@details` as a Feature | Loads with table.
  - `Engine.destroy`: keep the first five sentences. Move shared-memory reuse, the two kept memories and Safari's memory delay into `@details`.

## 14. Engine page: long value unions and the hold-mode types crowd the page

- Page: api/reference/engine.
- Severity: medium. Category: structure.
- Source: `tools/lib/api-docs.ts` (`aliasOf`, `renderSymbol`); `packages/engine/src/page/hold.ts`.
- Claim: `ErrorCode` (line 216) prints 88 lines of bare codes, with no link to any error page. `ShaderFeature` (line 476) prints about 45 lines. Nine hold-mode and replay types (`HeldFrame` to `HoldScriptStep`, lines 303-401, and `ReplayResult`, line 463) are for test scripts, and they sit between `ErrorCode` and `LatencyMode`. A newcomer reading about `createEngine` scrolls past all of this.
- Proposed edit: when a union of string literals has more than about 12 members, print the first line and put the full union in a `<details>` block, "Technical details: every value". For `ErrorCode`, link to the errors index in place of the list. Group the hold-mode types under the index (finding 9) as "Hold mode and replays", or tag them for the testing guide's API page.

## 15. Scene page: the `Scene` class and three long paragraphs

- Page: api/reference/scene.
- Severity: medium. Category: long-paragraph.
- Source: `packages/engine/src/scene/chunk-rows.ts:64`, `packages/engine/src/scene/fog.ts:20`, `packages/engine/src/scene/time-of-day.ts:200`, and the `Scene` member comments in `packages/engine/src/scene/scene.ts`.
- Long paragraphs (stats.json): line 115 `ChunkRowWriter` (106 words), line 151 `FogCurve` (67 words), line 492 `timeOfDay` (191 words, with the broken code example). The `Scene` class (line 365) has 47 rows and 4,398 words. 21 cells are over 90 words: `pick` (line 412, 262), `addFeatureDraw` (385, 254), `setSkyLayer` (404, 222), `setBackground` (403, 212), `createView` (394, 193), `addComputeInstances` (387, 192), `createVertexDraw` (388, 187), `animateProperty` (379, 178).
- Proposed edit:
  - `timeOfDay`: paragraph 1 (what it returns), paragraph 2 (`out` and no allocation, without the benchmark command), then the code example as a real code block (finding 1).
  - `FogCurve`: a table of the three curves with their formulas (finding 11).
  - `ChunkRowWriter`: the first paragraph as two numbered steps ("1. Store each chunk once with `write`. 2. Call `pack` with one count for each slot."). Fix the links (finding 25).
  - `Scene.pick`: keep the first two sentences. Move the frame timing, the skinned-mesh mismatch and the raycast fallback into `@details`.
  - Group `Scene`'s 47 members in the member index by task: objects and batches, background and sky, environment and fog, probes, views, feature draws.

## 16. Geometry page: 69 exports on three topics, and seven long paragraphs

- Page: api/reference/geometry.
- Severity: medium. Category: split-page.
- Source: `PAGES` in `tools/lib/docs.ts`; `packages/geometry/src/*`, `packages/engine/src/scene/resources.ts`, `packages/engine/src/scene/level-rule.ts`.
- Claim: the page holds three topics in name order: shape options of the engine (`BoxOptions`, `SphereOptions`), curves and shapes of `@null3d/geometry` (`ArcCurve`, `Path`, `Shape`, `extrude`, `lathe`), and levels of detail (`levelAt`, `LevelSwitch`, `MeshLevel`, `BuildLevelsOptions`). The three are mixed letter by letter.
- Long paragraphs (stats.json): lines 141, 229, 369, 388, 457, 498, 524. Six cells are over 90 words: `buildLevels` (line 492, 462), `setLevels` (line 491, 204), `updateVertices` (line 489, 190).
- Proposed edit: group the index (finding 9) into "Shapes", "Curves and paths (`@null3d/geometry`)" and "Levels of detail". If the website shows long pages poorly, split the levels-of-detail exports onto their own reference page. For `buildLevels`, keep the first two sentences and the paragraph on automatic levels. Move part sharing, pieces and frame spreading into `@details`. `MeshArrays` (line 457) lists each array: make it a list.

## 17. Classes that a user constructs show no constructor

- Pages: geometry (curve and shape classes), controls, math.
- Severity: medium. Category: missing-content.
- Source: `tools/lib/api-docs.ts`, `membersOf`. It reads members and parameter properties, but never the `constructor` signature.
- Claim: a reader cannot see how to make an `EllipseCurve`, a `LineCurve` or a `Shape`. The section lists fields such as `aX` and `aStartAngle` (geometry lines 213-220), but not the call that sets them. `packages/geometry/src/curves.ts` has constructors at lines 55, 106, 140, 191 and 247.
- Proposed edit: print the constructor signature in a `ts` code block under the kind line, such as `new EllipseCurve(aX = 0, aY = 0, xRadius = 1, ...)`, with its comment.

## 18. Quality page: `QualitySettings` is one table of 3,326 words

- Page: api/reference/quality.
- Severity: medium. Category: structure.
- Source: the `QualitySettings` member comments in `packages/engine/src/quality/`.
- Claim: 48 settings in name order, with five cells over 90 words. `governor` (line 177, 163 words) describes the step-down order as one long sentence chain.
- Proposed edit: group the settings in the member index by area (resolution, shadows, lighting, post effects, levels of detail, culling). For `governor`, keep the first sentence and the last three. Move the step-down order into `@details` as a numbered list: "1. A sketch's budget and the render scale, in turn. 2. `lodThreshold`, up to four times. 3. Far shadow cascades ..."

## 19. Debug page: a long module summary, a 280-word `view`, and 44 mixed exports

- Page: api/reference/debug.
- Severity: medium. Category: long-paragraph.
- Source: `packages/engine/src/debug/debug.ts:64`, the `Debug.view` comment, `packages/engine/src/stats.ts`.
- Long paragraph: line 25 (132 words, 9 sentences). Cell: `Debug.view` (line 31, 280 words, 16 sentences).
- Proposed edit:
  - Line 25: split into "Drawing" (what the calls draw, one frame only, in `onUpdate`) and "Builds" (only development builds draw; `stats` and `frameStats` work in every build). Move the sentence about the one scene traversal in release builds into `@details`.
  - `view`: one lead sentence, then a View | What it shows table for `lit`, `normals`, `depth`, `overdraw`, `wireframe`, `shadows`, `motion`, `levels`. Keep the release-build rule and the first-frame note as plain sentences after the table.
  - Group the index into "Debug drawing" and "Frame figures and memory". About 30 of the 44 exports are `Stats*`, `Frame*` and `Memory*` types.

## 20. Render page: `addPass` and the compute pass options

- Page: api/reference/render.
- Severity: medium. Category: technical-details-block.
- Source: `packages/engine/src/scene/render.ts:274` and the `addPass` comment.
- Long paragraph: line 43 (141 words, 6 sentences). Cell: `addPass` (line 173, 302 words, 15 sentences).
- Proposed edit:
  - `addPass`: one lead sentence, then a list of the four pass kinds (scene, reflection, full-screen, compute), one line each. Then what scene and reflection passes draw. The errors go to an "Errors" list (finding 12).
  - Compute pass options (line 43): keep the first four sentences. Move the bind group layout and the uniform block's contents into `@details`. That detail is for shader authors.

## 21. Materials page: three long type paragraphs and the `shader` cell

- Page: api/reference/materials.
- Severity: medium. Category: long-paragraph.
- Source: `packages/engine/src/scene/resources.ts:1812`, `:1824`, `:2442`, and the `Materials.shader` comment.
- Long paragraphs (stats.json): line 19 `AlphaMode` (96 words), line 27 `Blending` (83 words), line 148 `ShaderOptions` (74 words). Cell: `Materials.shader` (line 142, 260 words). `StandardValues` has 35 rows and 1,588 words.
- Proposed edit: `AlphaMode` and `Blending` become value tables (finding 11). For `shader`, keep the first three sentences. Make E1215, E1216 and E1217 an "Errors" list, and move the development-build E1217 rules on alpha and transmission into `@details`.

## 22. Impostors page: three long paragraphs, one full of maths

- Page: api/reference/impostors.
- Severity: medium. Category: technical-details-block.
- Source: `packages/impostors/src/batch.ts:165`, `hand-over.ts:119`, `merge.ts:105`.
- Long paragraphs (stats.json): line 27 `createImpostors` (106 words), line 142 `handOverToCards` (99 words), line 325 `mergeFarGeometry` (169 words, 10 sentences).
- Proposed edit:
  - `mergeFarGeometry`: keep the first three sentences and the attribute rules as a short list. Move normals by the inverse transpose, tangents, and mirrored copies into `@details`.
  - `handOverToCards`: put the dithered-edge timing into `@details`. Keep the call order ("Write the cards' turns and sizes before this call, and call it at setup") in the main text. Render its `@param` tags (finding 5).
  - `createImpostors`: split after "the material reads the eye from the frame's camera."

## 23. Particles page: four long paragraphs, two of them the same

- Page: api/reference/particles.
- Severity: medium. Category: long-paragraph.
- Source: `packages/particles/src/system.ts:37`, `packages/engine/src/scene/particles.ts:72` and `:547`.
- Long paragraphs (stats.json): line 32 `EmitterShape` (100 words), line 38 `ParticleBuffer` (103 words), line 133 `ParticleEmitterShape` (the same 100 words as line 32), line 154 `ParticleFacing` (57 words, 5 sentences).
- Proposed edit: make the shapes a Shape | Where particles start | Direction table, in one place (findings 4 and 11). Make `ParticleFacing` a four-row table. Split `ParticleBuffer` into "what it is" and "how to fill it".

## 24. Controls page: four long paragraphs and a scattered layout

- Page: api/reference/controls.
- Severity: medium. Category: scan-order.
- Source: `packages/controls/src/orbit-controls.ts:1311` and `:1326`, `first-person-controls.ts:109`, `fly-controls.ts:40`.
- Long paragraphs (stats.json): line 43 `createMapControls` (39 words, 5 sentences), line 51 `createOrbitControls` (39 words, 5 sentences), line 132 `FirstPersonControls` (73 words), line 187 `FlyControls` (79 words).
- Claim: each map and orbit paragraph lists gestures in prose: "A left drag or one finger pans ... The wheel ...". The six `create*` functions (lines 13-53) are far from their classes (lines 69-389) and options.
- Proposed edit: write the gestures as an Input | Action table (left drag or one finger, wheel or pinch, right drag or two fingers). Order the page by control: `createOrbitControls`, `OrbitControls`, `OrbitControlsOptions`, then the next control (finding 9). `OrbitControls` has 47 members: group them in the index into state, limits and methods.

## 25. Scene page: `ChunkRowWriter` has broken link syntax

- Page: api/reference/scene. Anchor: `ChunkRowWriter`, line 115.
- Severity: medium. Category: unclear.
- Source: `packages/engine/src/scene/chunk-rows.ts:64-65`.
- Claim: "Store each chunk once with [`write`], then call [`pack`]" renders with literal square brackets. Markdown has no target for these reference-style links.
- Proposed edit: write "Store each chunk once with `write`, then call `pack`" in the source. Finding 10 can then link the members.

## 26. Long inline types make the member column too wide

- Pages: engine (line 598), debug (line 126), scene (line 503), assets (line 128), and 77 rows in all with a signature over 80 characters.
- Severity: medium. Category: structure.
- Source: `tools/lib/api-docs.ts` (`propertyOf`, `callableOf`, `singleLine`).
- Claim: `WebGL2Report.floatRenderTargets` prints a 315-character object type in the first column. `FrameStats.load` prints 275 characters. Long generic signatures such as `addComputeInstances<const Wgsl extends string | CompiledWgsl = ...>` (scene line 387, 193 characters) do the same. The table becomes wider than a laptop screen, and the description column becomes narrow.
- Proposed edit: when a signature is over about 80 characters, print only the name and a short form in the cell, such as `floatRenderTargets: { ... }`, and print the full type in a code block under the member's H3 (finding 2). Or name the object type in the source and export it.

## 27. Other pages with long single-paragraph comments

- Pages: water (lines 51, 367), lights (lines 33, 174), assets (lines 265, 335), splats (line 55), features (line 65), input (line 17), math (line 33), post (line 220).
- Severity: medium. Category: long-paragraph.
- Source: `packages/water/src/waterfall.ts:212` and `ocean.ts:55`; `packages/engine/src/scene/scene.ts:2362` and `:2581`; `packages/engine/src/scene/prefab.ts:195` and `gltf-extensions.ts:48`; `packages/splats/src/system.ts:174`; `packages/engine/src/scene/features.ts:980`; `packages/engine/src/sketch/input.ts:137`; `packages/engine/src/math/create-math.ts:282`; `packages/engine/src/scene/post.ts:41`.
- Proposed edit, one line each:
  - water 51 `createWaterfall`: make "Give it the lip, the way the water runs, the river's half width, its surface height and its current there, and the drop" a list of the inputs. Shorten the first sentence (it is 50 words).
  - water 367 `OceanValues`: split after the first sentence. Put the attenuation advice (a shallow creek needs a pale colour over a long distance) in its own paragraph.
  - lights 33 `DirectionalLight`: split after "Its position does not matter." Then the four-light rule as its own paragraph.
  - lights 174 `RectAreaLight`: split after the first two sentences.
  - assets 335 `registerGltfExtensions`: keep the first three sentences. Move the replacement rule for a development reload into `@details`.
  - assets 265 `PrefabTemplate`: 5 sentences in 44 words. Split after the first sentence.
  - splats 55 `createSplats`: three short paragraphs: sources, how a cloud draws, streams. End with the call rule ("Call `splats.update(eye)` once in each frame ...") as its own line.
  - features 65 `defineFeature`: errors as a list (finding 12).
  - input 17, math 33, post 220: split each after its second sentence; post 220 becomes a value table (finding 11).

## 28. Defaults are hidden in prose

- Pages: every page with options interfaces. 600 of 787 option rows say "The default is ..." inside the text.
- Severity: low. Category: structure.
- Source: `tools/lib/api-docs.ts`; the TSDoc comments.
- Claim: a developer often wants only the default. Today they read each cell to find it.
- Proposed edit: support the standard `@defaultValue` tag and print a Default column in the member table of options interfaces. Move "The default is X" out of the prose into the tag.

## 29. No reference page shows a working example

- Pages: every reference page.
- Severity: low. Category: example-placement.
- Source: the TSDoc comments; `tools/lib/api-docs.ts`.
- Claim: only two comments hold a code example (`timeOfDay`, `loadImpostorAtlas`), and both render broken (finding 1). A reader who lands on `createEngine`, `Scene`, `loadGltf` or `createParticles` from search sees no call. The intro quote links the concept page, which has the examples, but it does not say so.
- Proposed edit: change the intro quote in `referencePage` (`tools/lib/docs.ts`) to "[Animation](../animation.md) explains these exports, with examples." Add a short `@example` to each page's main entry function after finding 1 lands.

## 30. Some page titles repeat "API" or hold two colons

- Pages: engine ("Page API: createEngine: API reference"), sketch ("Sketch API: defineSketch and the context: API reference"), post ("Post-processing API: API reference"), quality ("Quality API: API reference"), render ("Render graph API: API reference").
- Severity: low. Category: structure.
- Source: `referencePage` in `tools/lib/docs.ts`, which appends ": API reference" to the page title from `PAGES`.
- Proposed edit: give each `PAGES` entry an optional short reference title, or strip a trailing " API" and any text after the first colon. The results: "Engine: API reference", "Sketch: API reference", "Post-processing: API reference", "Quality: API reference", "Render graph: API reference".

---

## Not verified (ranked below the top 30)

## 31. The kind line repeats the heading, and only some kinds have one (not verified)

- Pages: every reference page. Source: `renderSymbol` in `tools/lib/api-docs.ts`.
- Severity: low. Category: structure.
- Claim: "Interface `AnimationEvent`." under "## `AnimationEvent`" repeats the name. Functions, types and constants get no kind line, so the reader sees no kind for them.
- Proposed edit: print one short line for every kind: "Interface, from `@null3d/engine`." (with finding 4), or "Function", "Type", "Constant".

## 32. Long cells on the smaller pages (not verified)

- Pages: assets (`loadGltf` line 23, 180 words; `loadEnvironment` line 28, 177 words), ui (`bind` line 21, 175 words), lights (`setMap` line 211, 196 words), cameras (line 26, 159 words), sketch (line 93, 159 words), terrain (`update` line 83, 163 words), textures (line 142, 129 words), post (line 151, 158 words), animation (line 106, 112 words), objects (`setOccluder` line 36, 210 words).
- Severity: medium. Category: long-paragraph.
- Proposed edit: apply finding 2. For `setOccluder`, show the WebGL2 rule and the WebGPU rule as two short paragraphs or a two-row table, and move the 4,096-triangle limit and the asset tool's blocker boxes into `@details`. For `lights.setMap`, move the 512-texel limit and the 32-light limit into `@details`.

## 33. Properties and methods share one table with no split (not verified)

- Pages: classes with many members: `Scene`, `Engine`, `OrbitControls`, `Object3D`, `Debug`, `TransformControls`.
- Severity: low. Category: scan-order.
- Proposed edit: print two tables, "Properties" and "Methods", as bold lead-ins (not headings, to keep the depth at H3).

## 34. The small add-on feature pages could join one page (not verified)

- Pages: feature-effects (259 words, 3 headings), feature-instances (599 words), feature-draws (983 words), vertex-draws (554 words).
- Severity: low. Category: split-page.
- Claim: each is a reference for one call (`post.addFeatureEffect`, `scene.addFeatureInstances`, `scene.addFeatureDraw`, `scene.createVertexDraw`). A reader of add-on draws moves between four short pages.
- Proposed edit: keep the concept pages, but consider one "Add-on draws: API reference" page with an H2 per call. This changes `PAGES` and the categories, so the owner decides.

## 35. Repeated sentence "It writes engine memory, so calling it every frame costs nothing" (not verified)

- Page: animation (`setWeight`, `setBlend`, `setLayerWeight`, `setUpdateInterval`, `setJointRotation`).
- Severity: low. Category: duplication.
- Proposed edit: say it once in the `Animator` summary ("Every setter writes engine memory, so calling it every frame costs nothing.") and drop it from the five rows.

## 36. The intro quote speaks of how the page is made (not verified)

- Pages: every reference page. Source: `referencePage` in `tools/lib/docs.ts`.
- Severity: low. Category: unclear.
- Claim: "The engine's doc comments make this page." tells a user how the docs are built, not what the page gives them. The front matter summary says the same.
- Proposed edit: "This page lists every export of the Animation API. [Animation](../animation.md) explains them, with examples." (see finding 29).
