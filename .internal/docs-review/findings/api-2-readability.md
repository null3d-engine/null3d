# Readability and layout review: slice api-2

Pages: api/impostors, api/input, api/lights, api/lines, api/materials, api/math, api/objects, api/page, api/particles, api/points, api/post, api/quality.

Line numbers are lines of the files in `docs/api/<page>.md`, front matter included. The line numbers in `stats.json` count from the end of the front matter, so a file line here is the stats line plus 7.

All 12 pages are written pages, not generated ones. Edit them in `docs/api/`. The one exception is the top callout's first sentence, which `tools/lib/steps.ts` (`shipsSentence`) defines and the docs check enforces.

Findings 1 to 30 are ranked and verified against the page text. Findings 31 to 35 are lower ranked and marked "not verified".

---

## 1. api/materials: the page is too long to scan, so split it (high)

- Anchor: the whole page, `# Materials`.
- Claim: the page has 13,672 words and 50 headings. It covers five topics: the standard material, special surfaces, decals, transparency and custom materials. A newcomer who wants the basic options must scroll past glass, skin, car paint and moment transparency. A reader who wants custom WGSL must reach line 711.
- Evidence: stats.json gives `words: 13672` and 50 headings. 29 paragraphs are over the limit. `## Custom materials` starts at line 711, `## Decals` at line 362, and `## Alpha modes` at line 570.
- Proposed edit: split the page into five pages, and add each one to PAGES in `tools/lib/docs.ts`.
  1. `api/materials`: intro, The materials, Shadow catchers, Standard values, Specular reflection, Texture maps, Relief, Texture coordinate transform, Color, Changing a material, Destroying a material, Options fixed at creation, Ranges, Limits. Add a short "Special surfaces", "Transparency" and "Custom materials" pointer list near the top.
  2. `api/material-surfaces` ("Glass, leaves, skin and layered surfaces"): Transmission, Light through thin surfaces, Light under the surface, Clear coat and sheen, Iridescence and anisotropy.
  3. `api/decals`: Decals and its subsections.
  4. `api/transparency` ("Alpha, blending and depth"): Alpha modes, Alpha to coverage, Invisible surfaces that hide, Double-sided blended surfaces, Blending, Weighted blending, Moment transparency, Depth bias.
  5. `api/custom-materials`: Custom materials and its four subsections.
  Keep the anchors stable with a short link list on the old page.

## 2. api/quality: `quality.set` sits under the "Moment transparency" heading (high)

- Anchor: `### Moment transparency`, lines 65 to 71.
- Claim: `quality.set` is the main call on the page, but it has no heading of its own. Its paragraph (line 71) and an unrelated anti-aliasing link (line 69) sit under the H3 "Moment transparency". A reader who scans the outline for "change a setting" finds nothing, and a reader who opens "Moment transparency" gets the rules of `quality.set`.
- Evidence: line 65 `### Moment transparency`, line 69 "[GPU tiers and backends]... compares the anti-aliasing modes", line 71 "`quality.set(settings)` changes the settings it gets and keeps the others."
- Proposed edit: add `## Changing settings during play` before line 71, and put the `quality.set` paragraph there as a short list: what it takes, when it applies, what throws E1213. Move the anti-aliasing link to the end of `## Settings`. Keep `### Moment transparency` as the last part of `## Settings`, or fold its two sentences into `## Settings` and link to the materials page.

## 3. api/materials: the texture-array rules for transmission and layer maps appear four times (medium)

- Anchor: lines 169 to 170, 296, 346, 462. The diffuse transmission rules repeat at lines 213, 294 and 460.
- Claim: the same rule (which maps share a texture array, and which pairs throw E1217) appears in four places with slightly different words. A reader cannot tell if the copies differ. The rule is also dense and needs a table, not prose.
- Evidence: line 170 "`clearcoatNormalMap` and `iridescenceThicknessMap` fill the array that the transmission map samples"; line 296 says the same; line 346 says it again for iridescence; line 462 says it again under Texture maps.
- Proposed edit: keep the rule once, under `## Texture maps`, as a table "Maps that cannot share one material": map pair | why | result (E1217 in development builds, what production builds draw). Put the table in a block, `<details><summary>Technical details: which maps share a texture array</summary> ... </details>`. Replace the other three copies with one sentence and a link to that table.

## 4. api/post: the E1213 row of the Errors table is one cell of 336 words (medium)

- Anchor: `## Errors`, line 472.
- Claim: the cell lists every range check of every effect in one run-on paragraph. Nobody can scan it. The ranges are already in each effect's settings table.
- Evidence: line 472, 336 words in one table cell, from "A ninth effect." to "an `ev100` outside -20 to 30."
- Proposed edit: change the cell to "A ninth effect, a setting that the engine does not have, a tone mapping it does not know, or a value outside the range that the setting's table gives." Under the table, add `<details><summary>Technical details: every value that throws E1213</summary>` with one bullet per effect (auto exposure, bloom, ambient occlusion, reflections, depth of field, outlines, grading, vignette, sharpening, exposure). Better still, move this list to the E1213 error page through `packages/engine/src/errors/fixes.ts`.

## 5. api/impostors: two sections give the same bake advice, mixed with the history of a showcase scene (medium)

- Anchor: `## Make a card read as its mesh` (lines 133 to 169) and `## Bake several views, not one side` (lines 171 to 220).
- Claim: both sections give the worst view angles (53, 42.5 and 23 degrees) and the texels per cell (32 to 64 for 80 pixels). The first section also tells the story of "the island's trees", with past-tense measurements (lines 135 to 141, 163 to 165, 189 to 191). The reader does not know this scene, and the story hides the rules. These lines are also hard-wrapped at about 100 characters, unlike the rest of the page.
- Evidence: line 153 "a four by four grid holds 53 degrees at worst and five by five holds 42.5"; line 182 "53 degrees apart at worst on four by four, 42.5 on five by five"; line 136 "The island's trees once baked a card as one unlit side view".
- Proposed edit: merge the two sections into one, `## Bake a card that matches its mesh`.
  1. Start with a numbered checklist: bake the replaced level, bake unlit, store normals, choose views, choose texels, use the bake's size, check the card beside its mesh.
  2. Add a table: grid | worst angle | use (4 x 4, 53 degrees; 5 x 5, 42.5 degrees, a far crown; 10 x 10, 23 degrees, a landmark).
  3. Add a table: card size on screen | texels per cell.
  4. Keep the code sample at line 196.
  5. Move the measured comparison and the atlas memory figures into `<details><summary>Technical details: what a mismatched card looks like</summary>`, in present tense, with no history.
  Unwrap the hard-wrapped lines.

## 6. Every page in the slice: the top callout mixes the release status with feature limits (medium)

- Anchor: line 11 of each page, the `> Roadmap step 0.x, first released in null3D 0.1.0...` callout.
- Claim: readers skip a status box, so the limits in it go unread. Lights puts the four-directional-light limit there. Lines, points and particles put their shadow limits there. Materials puts a custom-material texture limit there, before the reader knows what `materials.shader` is. Quality puts the live-settings rule there. The phrase "Roadmap step" is also a maintainer planning term on a page for engine users.
- Evidence: lights.md:11 "Surfaces show up to four directional lights..."; materials.md:11 "`materials.shader` takes no standard texture maps. It takes up to 6 textures of its own."; lines.md:11, points.md:11, particles.md:11, quality.md:11.
- Proposed edit: keep the callout to the status alone, for example "First released in null3D 0.1.0. The API is experimental, so it can still change between versions." Change `shipsSentence` in `tools/lib/steps.ts` and the docs check in `tools/lib/docs.ts` to match. Move each limit to the section it limits: lights to "Which lights reach surfaces", materials to "Custom materials", lines and points to "Speed" or a `## Limits` section, particles to "Drawing", quality to "Settings".
- Generated source: tools/lib/steps.ts (the banner sentence); the limits are in each page.

## 7. api/post: the same notes repeat in every effect section (medium)

- Anchor: the bullet lists under Automatic exposure, Bloom, Ambient occlusion, Screen-space reflections, Depth of field, Outlines and Vignette.
- Claim: four notes repeat in nearly every section. "A setting that a call leaves out keeps its value" appears 11 times, and "allocates nothing" appears 9 times. The "needs HDR color; compatibility mode with MSAA moves to HDR with FXAA" note and the "turning it on or off adds passes, its shaders download the first time" note repeat too. Each repeat makes the lists longer and hides the facts that differ between effects.
- Evidence: lines 112, 141, 174, 218, 262, 299, 392, 415 ("keeps its value"); lines 113, 144, 175, 219, 263, 299 ("allocates nothing"); lines 111, 143, 261 (HDR); lines 175, 219, 263 (passes take a few frames).
- Proposed edit: add a short section after the intro, `## How post.set works`, with four bullets: left-out settings keep their values (also while an effect is off, and `{}` turns it back on); `post.set` allocates nothing; effects that need HDR color and what compatibility mode does; turning an effect on or off adds passes over a few frames and downloads its shaders once. Remove the repeats from each section, and keep only what is particular to the effect.

## 8. api/materials: the seven "Cost of ..." subsections should be technical details blocks (medium)

- Anchor: `### Cost of transmission` (172), `### Cost of light through thin surfaces` (215), `### Cost of light under the surface` (248), `### Cost of the layers` (304), `### Cost of iridescence and anisotropy` (358), `### Cost of decals` (416), `### Cost of weighted blending` (676).
- Claim: each one is a dense paragraph about render passes, bytes per pixel and shader downloads. Implementers need this detail, but a newcomer does not, and seven extra H3s make the outline harder to scan. Five of them start with the same sentence, "Nothing of it runs, and none of its shaders download".
- Evidence: lines 174, 217, 250, 418 start "Nothing of it runs, and none of its ... download"; line 250 "The targets take 36 bytes per pixel of the render size"; line 678 "10 bytes per pixel together".
- Proposed edit: replace each H3 with one main-text sentence ("Its shaders load on first use; list `'transmission'` in `createEngine`'s `preload` to load them before the first frame.") and a block `<details><summary>Technical details: what transmission costs</summary> ... </details>` that holds the passes, the memory and the samples. Do the same for the `### How it draws`, `### How the layers draw` and `### How the film and the stretch draw` lists where they only give the method.

## 9. api/materials: 29 paragraphs are over the length limit (medium)

- Anchor: lines 114, 174, 198, 217, 250, 294, 306, 346, 418, 462, 464, 466, 503, 516, 520, 526, 568, 583, 585, 600, 628, 678, 682, 729, 820, 847, 853, 855, 859 (stats lines 107 to 852).
- Claim: the longest are 182 words (847), 170 words (526), 146 words (516) and 133 words (346). They hold several rules each, so readers miss the one they need.
- Evidence: stats.json api/materials longParagraphs, 29 entries.
- Proposed edit:
  - 526 (`set` and `setUniform`): split into "Use `set` at setup" and "Use `setUniform` in a frame", with a two-row table of what each takes. Move the browser-boxing reason into `<details><summary>Technical details: why set boxes numbers</summary>`. Delete the maintainer benchmark command `bun run bench:allocation --setters`.
  - 516 (uvTransform): keep the first two sentences and `mapUvTransforms` in the main text. Move the formula and the shared-slot rule into a technical details block.
  - 847 (coverage function): make it a numbered list. When the shadow cuts at the cutoff, what the caster draws, why a flat caster needs `doubleSided`, and the mask requirement.
  - 346, 294, 462: see finding 3.
  - 198: unwrap the hard-wrapped lines, and move the measured leaf values into a two-column table (value, leaf range).
  - 583, 585, 600, 628: break each at the change of subject (what the mode draws; when to use it; loading). Put the preload names of 600 in a technical details block.
  - 682 (moment transparency accuracy): keep one sentence in the main text. Move the measured accuracy figures to a technical details block that names the benchmark scenes.
  - The other paragraphs: split after the second or third sentence, at the change from "what it does" to "rules and errors".

## 10. api/impostors: 12 long paragraphs, with the shadow rules in one 174-word paragraph (medium)

- Anchor: lines 24, 38, 79, 85, 107, 111, 127, 135, 160, 173, 236, 252 (stats lines 17, 31, 72, 78, 100, 104, 120, 128, 153, 166, 229, 245).
- Claim: line 79 holds five shadow rules in one paragraph. Line 24 (158 words) explains the whole technique before the reader sees code. Line 38 mixes the creation call with the reasons for culling in the shadow pass.
- Evidence: stats.json api/impostors longParagraphs: 174 words at stats line 72, 158 at 17, 128 at 31.
- Proposed edit:
  - 79: add `### Shadows of the cards` with a list: `castShadows` and the sun-only layer; `receiveShadows` and the stored depth; no contact shadows; still shadows and cached cascades; `castsStill: false` for cards that turn every frame.
  - 24: keep three sentences (what an impostor is, that it blends three views, that one batch draws many). Move the turn and light reasoning to a technical details block.
  - 38: keep the first sentence and `levels: false`. Move the "both faces, because the shadow pass culls front faces" reasoning to a technical details block.
  - 85: put `frameDirection` and `impostorFrame` in a two-row table, and the octahedral fold in a technical details block.
  - 107, 111, 127: split at the change from "what it returns" to "what it throws".
  - 236 and 238 (hand-over band math): put them in `<details><summary>Technical details: how the two dither bands avoid gaps</summary>`.
  - 252: split the normal, tangent and mirror rules into a list.

## 11. api/post: there is no overview of the effects, and the demo links sit at the bottom (medium)

- Anchor: intro line 13 and `## Related pages`, lines 489 to 490.
- Claim: the intro lists twelve effects in one sentence. A reader cannot see at a glance which effect is on by default, which quality setting gates it, or which needs HDR color. The two demo links appear only in "Related pages", after 480 lines.
- Evidence: line 13 "They are the tone mapping, the exposure, automatic exposure, bloom, ambient occlusion, ..."; lines 489 to 490 hold the only demo links on the page.
- Proposed edit: after line 13, add a table: effect | `post.set` key | default | quality setting that gates it | needs HDR color. Put the post effects demo link (https://github.com/null3d-engine/null3d/tree/main/examples/post-effects) under the intro. Put the depth of field demo link (https://github.com/null3d-engine/null3d/tree/main/examples/camera-lens) under `## Depth of field`, after its example. Keep them in Related pages too.

## 12. api/quality: the page options table mixes engine options with URL test switches (medium)

- Anchor: `## Choosing the preset on the page`, table at lines 42 to 57.
- Claim: one table holds ten `createEngine` options and six `?` URL switches for tests. The `?tier=lowest` cell is a paragraph of 75 words. A page author has to read past test switches to find the options.
- Evidence: line 54, the `?tier=lowest` row; lines 53 to 57 are URL switches; lines 44 to 52 are options.
- Proposed edit: split the table into "Options of createEngine" and "URL switches for tests and debugging". Cut the `?tier=lowest` cell to one sentence and a link to the lowest quality tier section of the quality presets page.

## 13. api/input: the "Input off" section holds maintainer-level listener detail (medium)

- Anchor: `## Input off`, lines 206 to 232.
- Claim: most readers need three facts: what `input: false` turns off, that `ctx.input` stays at rest, and that the pointer lock fails. The section adds a list of every listener it does not add, a table of the listeners it keeps, and module-load rules for workers. Line 225 also gives a maintainer test note: "The input test records the engine's listeners in every thread mode."
- Evidence: lines 210 to 213 (listeners not added), table at lines 217 to 223, line 225, line 232.
- Proposed edit: keep lines 208, 227, 229 and 234 in the main text. Put lines 210 to 223 and lines 230 to 232 in `<details><summary>Technical details: the listeners that stay and the warnings</summary>`. Delete the test note in line 225.

## 14. api/objects: the "Mesh calls" list should be a table, and two of its bullets are paragraphs (medium)

- Anchor: `## Mesh calls`, lines 109 to 123; `setPose` bullet at line 48.
- Claim: the list has eleven calls of mixed length. The `setOccluder` bullet is 129 words, and the `setBounds` bullet (118) is about 100 words. Line 123 then repeats which of these calls rebuild the draw tables, so the reader must match two lists.
- Evidence: line 121 (129 words), line 118, line 123 "`setMaterial`, `setMesh`, `setBounds`, ... rebuild the draw tables".
- Proposed edit: make a table: call | what it does | rebuilds the draw tables | more (link). Put the occluder details (WebGL2 blockers, the 4,096-triangle limit, WebGPU occlusion) in `<details><summary>Technical details: occluders on WebGL2 and WebGPU</summary>`. In line 48, keep "Give it the arrays that a pose lives in" and move the browser-inlining reason into a technical details block.

## 15. api/lights: the spot light map and area light bullets hold dense memory and loading detail (medium)

- Anchor: `## Spot light maps` bullets at lines 80 to 83; `## Area lights` bullets at lines 158 and 162.
- Claim: the bullet at line 158 is 164 words. It covers the image option, the light it gives, painting advice, texel limits and timing. Lines 81 to 82 and 158 repeat the same limits (512 texels a side, up to 32 lights with pictures, a few tens of milliseconds for a new picture). Memory figures and download sizes interrupt the how-to.
- Evidence: line 158 (164 words); line 81 "up to 512 texels a side ... Up to 32 lights show pictures at once"; line 158 "up to 512 texels a side ... Up to 32 lights show pictures at once"; line 82 memory figures; line 162 the 19 KB tables download.
- Proposed edit: split the line 158 bullet into "Pictures on a rectangle light" (a short paragraph and the painting tip). Collect the shared limits once, in a technical details block under Spot light maps: `<details><summary>Technical details: picture size, memory and timing</summary>` with lines 80 to 83. Link to it from Area lights. Put line 162 (downloads and `preload`) in a technical details block too.

## 16. api/quality: nine long paragraphs; the governor's order and the texture memory fields belong in lists or tables (medium)

- Anchor: lines 61, 67, 71, 75, 87, 102, 163, 177, 190 (stats lines 54, 60, 64, 68, 80, 95, 156, 170, 183).
- Claim: line 102 (140 words) gives the governor's step order as prose. Line 177 lists five fields of `quality.textureMemory` in prose. Line 75 gives four preset-switch rules in one paragraph.
- Evidence: stats.json api/quality longParagraphs, nine entries; line 102 "Then it lowers ... Then it lowers ..."; line 177 "Its `bytes` ... Its `budgetBytes` ... Its `droppedLevels` ...".
- Proposed edit:
  - 102: a numbered list of the governor's order (budgets and render scale; levels of detail, shadows, bloom, AO, reflections; contact shadows, far characters, fog; lowest tier), then one sentence on `quality.governor`.
  - 177: a table: field | what it reports.
  - 75: bullets: what takes the new preset's value; what keeps its value; the preset check exception; the GPU path cap and `quality.highest`.
  - 71: see finding 2.
  - 87, 163, 190: split at the change from behavior to errors.

## 17. api/lights: the point and spot range, decay and cone options sit inside "Color, intensity and units" (medium)

- Anchor: `## Color, intensity and units`, lines 121 and 123.
- Claim: line 121 explains `range`, `decay`, `angle` and `penumbra`, and line 123 says setters allocate nothing. Neither is about color or units. A reader who scans for "range" or "cone" will not look under this heading. The paragraph also comes after the real-units example, so it reads as part of that example.
- Evidence: line 121 "A point or spot light ends at its `range`, in meters ... Its `penumbra`, from 0 to 1"; line 123 "Every setter allocates nothing".
- Proposed edit: add `## Range, decay and the spot cone` after "Where a light points", with a table: option | lights | default | meaning (range, decay, angle, penumbra). Move line 123 to the end of the intro, after the first example, which already changes the lights every frame.

## 18. api/materials: the "Ranges" section is one wall paragraph (medium)

- Anchor: `## Ranges`, line 859.
- Claim: 123 words list the ranges of 20 options and five error rules in one paragraph. Most ranges are already in the "Standard values" table.
- Evidence: line 859 (stats line 852, 123 words, 9 sentences).
- Proposed edit: change the section to a short list of errors: "A value outside the range in [Standard values](#standard-values) throws E1108 in development builds. An unknown `alphaMode` or `blending` throws E1217. A depth bias that is not finite throws E1203." Add the missing ranges (`edgeFade`, the `angleFade` order) to the decal table and the Standard values table.

## 19. api/materials: a custom-material paragraph sits under "Mirrors, polished floors and water" (medium)

- Anchor: `### Mirrors, polished floors and water`, line 855.
- Claim: line 855 is about masks in custom materials, shared shaders, texture coordinates and the errors E1215 and E1216. It has nothing to do with mirrors. A reader looking for why E1215 is thrown will not find it under this heading.
- Evidence: line 855 "With `alphaMode: 'mask'`, the pixels where the surface function's `alpha` falls below `alphaCutoff` draw nothing ... WGSL as plain text ... throws E1215."
- Proposed edit: move line 855 to the main `## Custom materials` section, after the first example (line 725). Make it a list: masks, shared shaders, texture coordinates, errors.

## 20. api/materials: change-log wording and a maintainer command in user text (medium)

- Anchor: lines 306, 526, 602, 682, 693, 853.
- Claim: the docs rules say a page states what holds now. Some sentences compare with an earlier engine ("as before", "as it did before", "as it does today", "in this version"). Line 526 names a maintainer benchmark command. Line 682 cites "both test scenes" without naming the benchmark.
- Evidence: line 306 "Materials without layers draw as before"; line 602 "it casts its mesh's whole shape, as it did before"; line 693 "A page without the setting draws exactly as it does today"; line 853 "Standard materials take no reflection in this version"; line 526 "`bun run bench:allocation --setters` checks `setUniform`..."; line 682 "on both test scenes".
- Proposed edit: line 306 becomes "Materials without layers keep their own shaders and textures." Line 602 becomes "and it casts its mesh's whole shape." Line 693 becomes "Without the setting, blended surfaces draw in the sorted transparent pass." Line 853 becomes "Standard materials take no reflection." Delete the command in line 526. In line 682, name the benchmark scenes or drop the comparison.

## 21. api/post: four long paragraphs, one hard-wrapped (medium)

- Anchor: lines 41, 54, 332, 394 (stats lines 34, 47, 325, 387).
- Claim: line 41 (115 words) mixes when to use `ev100`, typical values and the formula. Line 54 explains how the engine applies the exposure internally. Line 332 is hard-wrapped. Line 394 mixes GPU paths, costs and the multisample resolve.
- Evidence: stats.json api/post longParagraphs.
- Proposed edit:
  - 41: keep "Most scenes need no camera setting" and the `ev100` meaning. Add a small table of typical EV100 values (sunny 15, overcast 12, lit room 7). Move the formula to a technical details block.
  - 54: `<details><summary>Technical details: where the engine applies the exposure</summary>`, keeping only "Background and unlit colors take the exposure too; at EV100 15 they draw black unless their values are in real units" in the main text.
  - 332: unwrap, and split into "what the controls do" and "when a change shows".
  - 394 and 396: put them in a technical details block under Vignette.

## 22. api/lights: eight long paragraphs (low)

- Anchor: lines 50, 98, 121, 138, 168, 196, 224, 252 (stats lines 43, 91, 114, 131, 161, 189, 217, 245).
- Claim: most are just over the limit, but 50 and 252 hold separate rules that read better as lists.
- Evidence: stats.json api/lights longParagraphs.
- Proposed edit: line 50 becomes a three-row table: light | axis it sends light along | how to aim it. Line 252 becomes a list: the object must cast shadows; where the tile comes from; tile sizes and how to name one. In line 138, move the method credit (linearly transformed cosines) into a technical details block. Split 98, 168, 196 and 224 after the second sentence.

## 23. api/impostors: the intro starts with the demo, not with what an impostor is, and the demo has no link (low)

- Anchor: lines 13 to 24, and line 248.
- Claim: the page opens with the forest demo's three bands and its L key. The diagram follows, and only then does line 24 say what an impostor is. A newcomer reads about a demo whose purpose they do not yet know. The demo is named by folder path twice, with no link.
- Evidence: line 13 "The demo \"Impostors\" in `examples/impostors` draws a pine forest three ways by distance"; line 248 "The demo's bake in `examples/impostors/forest.ts` shows the whole loop."
- Proposed edit: order the intro as three sentences on what an impostor is (from line 24), then the diagram, then the demo sentence with a link to https://github.com/null3d-engine/null3d/tree/main/examples/impostors/. Make line 248 a link too.

## 24. api/particles: the install command has no heading, and the page has no demo link (low)

- Anchor: lines 21 to 61.
- Claim: the install block sits between two paragraphs with no heading, unlike the impostors page, which uses `## Install`. The demo `particles/` exists in `examples/demos.ts` but the page does not link to it. Line 61 gives the rules for `update()` after a long example. They are the most important usage rules on the page.
- Evidence: line 25 "```sh bun add @null3d/particles"; `examples/demos.ts` line 690 `code: 'particles/'`; stats.json api/particles `exampleLinks: []`.
- Proposed edit: add `## Install` before line 25, as on the impostors page. Add a demo link after the first example: https://github.com/null3d-engine/null3d/tree/main/examples/particles/. Make line 61 a short list: pass `ctx`; call `update()` once a frame in `onLateUpdate`; `update(dt)` steps by a given time.

## 25. api/particles: the wind-field and birth-time paragraphs are implementer detail (low)

- Anchor: lines 143, 145, 177, 181, 193 (stats lines 136, 138, 170, 174, 186); also line 23 (stats 16).
- Claim: line 143 explains how the shader samples the field, and line 145 is for a page that drives a particle buffer itself. Line 193 explains how birth times move every 1,024 seconds. These are correct and useful, but they break up the how-to text.
- Evidence: stats.json api/particles longParagraphs.
- Proposed edit: under `### Wind`, keep "the field replaces `wind`" and "call the wind's `update()` first". Put lines 143 and 145 in `<details><summary>Technical details: how a particle reads the wind field</summary>`. Put line 193 in `<details><summary>Technical details: birth times and the sub-emitter table</summary>`. Split line 177 into "what softness does" and "what it costs, and the Low preset".

## 26. api/input: five long paragraphs; the slow-frame drag rules are technical detail (low)

- Anchor: lines 21, 85, 91, 110, 172 (stats lines 14, 78, 84, 103, 165).
- Claim: line 85 (108 words) explains how presses, drags and wheel scroll queue across slow frames. Most readers need only "each frame's drag belongs to one press". Line 110 mixes the calls, the batch types and the demo link.
- Evidence: stats.json api/input longParagraphs.
- Proposed edit: keep the first sentence of 85 in the main text, and put the rest in `<details><summary>Technical details: drags and clicks during a slow frame</summary>`. In 21, cut the sentence about the second drag (it points to this section anyway). Split 110 into "the calls", "batches take them too" (a list), and the demo link. Put 172 (costs) in a technical details block.

## 27. api/quality: the "Quality events" section comes last, but the page uses `onChange` from the first example (low)

- Anchor: `## Quality events`, line 188.
- Claim: `quality.onChange` appears in the first example (line 27), in Switching presets (line 87), in the governor section (line 104) and in Texture memory (line 180). Its own section comes at the end, so a reader meets the call four times before it is explained.
- Evidence: lines 27, 87, 104, 180 use `onChange`; line 188 explains it.
- Proposed edit: move `## Quality events` to just after `## Switching presets`. Make line 190 a list of when the handler runs.

## 28. api/lines: long paragraphs, and errors listed in prose (low)

- Anchor: lines 23, 104, 106, 117, 123, 153 (stats lines 16, 99, 110, 116, 146).
- Claim: line 106 mixes `material.set`, browser boxing and `setWidth`. Line 104 lists five error cases in one paragraph.
- Evidence: stats.json api/lines longParagraphs; line 104 "throw [E1206] ... throws [E1217] ... throws [E1108] ... throws [E1203]".
- Proposed edit: line 104 becomes a table: input | error. Line 106 becomes "`lines.material.set` changes color, opacity and dashes at any time (lit lines: metalness, roughness, emissive). `lines.setWidth` changes the width. Other options are fixed." Put the boxing note in a technical details block. Split 117 into "how colors are stored" and "how to make a line glow".

## 29. api/materials: two cells of the "Options fixed at creation" table are paragraphs (low)

- Anchor: `## Options fixed at creation`, table rows `toneMapped` (line 558) and `contactShadows` (line 559).
- Claim: the `toneMapped` cell is 103 words. It explains how both color paths skip the curve. Paragraph-sized cells make the table hard to scan.
- Evidence: line 558, 103 words in one cell.
- Proposed edit: cut each cell to one sentence ("With `false`, the tone curve leaves the color alone. See [Color management]"). Put the 8-bit and HDR path detail in `<details><summary>Technical details: toneMapped on each color path</summary>` under the table.

## 30. api/points: four long paragraphs, and errors in prose (low)

- Anchor: lines 21, 59, 83, 94, 120 (stats lines 14, 52, 87, 113; line 83 is the error list).
- Claim: line 21 (100 words) mixes what a point cloud is, how it draws, and the row arrays. Line 83 lists errors in prose, as the lines page does.
- Evidence: stats.json api/points longParagraphs; line 83.
- Proposed edit: cut line 21 to what a point cloud is and how it is drawn, and move the row-array sentence to the next paragraph. Make line 83 a table: input | error, matching the lines page. Split 94 after "even when `colors` in the options held 3".

---

## Lower-ranked findings (not verified)

## 31. api/math: the list of helpers left out of the maths entry is in prose (low, not verified)

- Anchor: `## The maths entry, for a deterministic simulation`, line 125 (stats line 118); `## Arrays` bullet at line 31.
- Claim: line 125 lists eight helpers left out of the maths entry inside a sentence. Line 31 explains a Chrome boxing case that most readers can skip.
- Proposed edit: make line 125 a list, "Helpers that need `createMath`", with the eight names. Put the Chrome detail of line 31 in a technical details block, and keep "Make the arrays that helpers write into with `create()`" in the main text.

## 32. api/objects: three long paragraphs (low, not verified)

- Anchor: lines 99, 103, 127 (stats lines 92, 96, 120).
- Claim: line 99 mixes development, release and model-copy rules for destroyed objects.
- Proposed edit: make line 99 a list by build: development builds; every build after the frame removes the object; release builds. Split line 103 after the second sentence.

## 33. api/impostors: "The surface atlas" comes after the hand-over section (low, not verified)

- Anchor: `## The surface atlas`, line 242.
- Claim: the first example already loads the surface atlas (line 52), and the bake sections use it, but the page explains it only after the hand-over section.
- Proposed edit: move `## The surface atlas` after `## The atlas and its cells`, or make it an H3 under it.

## 34. api/lights: the Shadows section has no subheadings (low, not verified)

- Anchor: `## Shadows`, lines 210 to 254.
- Claim: the section covers directional shadows, spot and point shadows, contact shadows and hero shadows in one run of text and code.
- Proposed edit: add H3s: "Sun shadows", "Spot and point light shadows", "Contact shadows", "A hero shadow".

## 35. api/page: the message buffering rules read better as a list (low, not verified)

- Anchor: `## When messages arrive`, lines 74 to 76.
- Claim: two paragraphs give three rules for the sketch's early messages (the 256-message buffer, the first handler gets them, the option gets every message).
- Proposed edit: fold lines 74 to 76 into the bullet list above them, one bullet per rule.
