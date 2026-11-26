# Readability and layout review: slice guides-1

Role: readability and layout. Pages: guides/accessibility, add-ons, agents, assets-pipeline, audio, baked-light-data, car-paint, content-pages, custom-passes, custom-shaders, debugging, deploying, deterministic-simulation, first-use-shaders.

Line numbers are file lines in `docs/guides/<page>.md`. Every page in this slice has a 7-line front matter, so a stats.json line is the file line minus 7 (stats line 16 = file line 23).

Pages with no finding: guides/accessibility and guides/deploying. Both have short paragraphs, tables and lists where they help, and examples beside the text that needs them.

Findings 1 to 30 are verified against the page text. Findings 31 to 41 are "not verified": they are lower ranked and were checked less closely.

---

## 1. assets-pipeline: the page holds five commands and a build process, and should split

- Page: guides/assets-pipeline
- Anchor: `# The asset pipeline (the `assets` command)`
- Category: split-page. Severity: high.
- Claim: The page has 8,386 words, 20 headings and 25 long paragraphs. It covers `assets optimize` (meshes, clips, blockers, trees, textures, levels of detail, clusters, report, shader list, Vite), `assets convert`, `assets pack-orm`, `assets normal-from-bump`, `assets env`, and a shader-permutation build that is not an `assets` command. A newcomer who wants to optimize one model must scroll past all of it, and a person who wants an environment map must find it under H2 number 18.
- Evidence: stats.json `guides/assets-pipeline`: words 8386, 25 longParagraphs. Headings from `## Optimize a model` (line 25) to `## Build only the shader permutations you draw with` (line 465).
- Proposed edit: Split into:
  1. `guides/assets-pipeline` (keep the ID): what the tool does, `## Optimize a model`, `## In a Vite project` (moved up, see finding 7), `## What it does to meshes`, `## What it does to clips`, `## Blockers and stored trees`, `## Textures` (with `### The roughness bake` and the encode time, see finding 9), `## The budget report`, `## The shader list`, and a short `## Other commands` list that links to the new pages.
  2. `guides/assets-levels-of-detail`: `## Levels of detail`, `### Levels as separate downloads`, `### Cluster levels`, `### Fewer triangles in the full mesh` (lines 175 to 236).
  3. `guides/assets-convert`: `## Convert other formats` (lines 311 to 359).
  4. `guides/assets-textures`: `## Pack occlusion, roughness and metalness`, `## Normal maps from bump maps`, `## Environment maps` (lines 361 to 459).
  5. The permutation build goes to its own page (finding 3).
  Add the new pages to AREAS and PAGES in `tools/lib/docs.ts` so `docs/pages.md` lists them.

## 2. assets-pipeline: 25 long paragraphs, many of them file-format internals

- Page: guides/assets-pipeline
- Anchor: lines 23, 84, 86, 88, 117, 126, 128, 143, 151, 153, 165, 177, 187, 189, 201, 203, 207, 219, 234, 276, 278, 370, 396, 471, 485
- Category: long-paragraph. Severity: high.
- Claim: 25 paragraphs pass 4 sentences or 90 words. The longest are line 276 (212 words, 10 sentences), line 189 (176 words, 12 sentences), line 219 (167 words, 11 sentences), line 207 (142 words, 11 sentences) and line 128 (122 words, 8 sentences). Much of this is correct detail for someone who writes a loader or a tool, but it hides the few rules a user acts on.
- Evidence: stats.json lines 16, 77, 79, 81, 110, 119, 121, 136, 144, 146, 158, 170, 180, 182, 194, 196, 200, 212, 227, 269, 271, 363, 389, 464, 478 (file line = stats line + 7).
- Proposed edit, paragraph by paragraph:
  - Line 23 (intro): keep the first two sentences. Make the four outputs a list: "It stores vertices as small integers in GPU order; clips in the engine's own form; textures as KTX2; and a budget report." Keep "runs on your computer, from npm" as its own sentence.
  - Lines 84 and 86 (where the dequantize transform goes, and the step size): keep "The steps follow the mesh's longest side" and the `"quantizePositions": false` rule in the main text. Move the node, child, instancing and skin rules into `<details><summary>Technical details: where the position transform goes</summary>`.
  - Line 88 (Draco): split into two paragraphs, the command's output first, then the engine's Draco load.
  - Line 117 (ground): make it one sentence plus a list of the two cases (open at its bottom and upright: yes; turned or tipped: no). The table under it already covers this, so merge the cases into the table.
  - Line 126 (extras override): make a three-row table: `"occluder": false`, `"occluder": true`, `instantiate(..., { occluder: false })`/`setOccluder`.
  - Line 128 (stored trees): keep "use `--bvh` for large meshes, whose first raycast would wait". Move the build rates (0.2 to 0.3 µs per triangle), the 20 and 12 bytes per triangle, and the check against the mesh into a details block "Technical details: the cost of a stored tree".
  - Line 143 (texture sizes): turn into a numbered rule list: nearest power of two, halve to fit, at least 4 texels, KTX2 inputs not resized. Keep the 1000 x 600 example after rule 1.
  - Lines 151 and 153 (roughness bake): fine as an explanation, but split line 153 after "the command makes the metal-rough map's mip levels itself". Move the 0.4 cap and the green-channel detail into a details block.
  - Line 165 (UASTC for baked maps): keep the first sentence and the BoomBox size. Move the ETC1S palette reason and the Zstandard cost into a details block.
  - Line 177 (`--lod`): make the stop rules a list (about 32 triangles, 15 levels, three quarters, error reaches the mesh size).
  - Line 187 (shared vertices) and line 189 (`MSFT_lod`): keep in the main text "a level is good enough where its error covers less than one pixel" and "a file that already has levels keeps them". Move every extension name (`MSFT_lod`, `NULL3D_lod_error`, `MSFT_screencoverage`), the 1080-pixel coverage and the fade rules into `<details><summary>Technical details: how the file stores levels</summary>`.
  - Lines 201, 203 and 207 (stages): keep "the engine downloads the stages in order and refines in place" and `maxLevels`. Move the vertex ordering (line 201, sentences 3 to 5), the set-aside timing (line 203) and the whole kind 1 stage layout (line 207) into `<details><summary>Technical details: the stage files</summary>`.
  - Line 219 (cluster tree): split into three: the tree's size and vertices; which paths draw patches (make this a small table: WebGPU compute pass, WebGL2 with `WEBGL_multi_draw`, Firefox and direct draws use whole levels); the `--lod` levels it also gets. Move the 65,535-vertex WebGL2 copy and the shadow-map picking into a details block.
  - Line 234 (`--simplify`): fine content; split after the second sentence.
  - Line 276 (shader list): see finding 8.
  - Line 278: see finding 6.
  - Line 370 (pack-orm inputs): make the three missing-map defaults a list; the option table at line 379 already gives them, so the list can be cut to one sentence that points at the table.
  - Line 396 (`--scale`): split after "tilts the surface 45 degrees". Move the screen-pixel reasoning into a details block and keep "Give the material's `bumpScale` as `--scale`, and check the look up close."
  - Lines 471 and 485: see finding 3.

## 3. assets-pipeline and deterministic-simulation: the permutation build is not part of the `assets` command and repeats on two pages

- Page: guides/assets-pipeline, guides/deterministic-simulation
- Anchor: assets-pipeline `## Build only the shader permutations you draw with` (line 465); deterministic-simulation `## A production build of a game's engine files` (lines 212 to 222)
- Category: structure. Severity: high.
- Claim: The last H2 of the `assets` page is about a build of the engine's shader set from a null3D checkout (`bun tools/shader-permutations.ts`, `bun run examples:build`, `NULL3D_SHADER_PERMUTATIONS`). It is not an `assets` command, so a reader looking for it will not find it, and a reader of the `assets` page meets repository-only scripts. The section also holds notes for the repository's own demos: "The island's pages record with its highest walker count" (line 485), "for this repository's own dev server" (line 485), and "as before" twice (lines 469, 495), which describes a change, not the present. The deterministic-simulation page repeats the same steps (lines 214 to 218) with its own figures.
- Evidence: assets-pipeline line 476 `NULL3D_SHADER_PERMUTATIONS= bun run examples:build`; line 485 "The island's pages record with its highest walker count."; line 469 "A build without the list stays a full build, as before."; deterministic-simulation lines 214 to 216 repeat record, build, then build the game.
- Proposed edit: Move the section to a new page `guides/shader-permutations` ("Build only the shader permutations you draw with"). Order it as numbered steps: 1 record, 2 build the shader modules, 3 build the project, 4 record again when a scene gains a feature. Put the device bits (line 471), the HTTPS note (line 481) and the `--extra` word format (line 503) in a details block. Cut the island note and "for this repository's own dev server". Change "as before" to "compiles every permutation". On deterministic-simulation, keep only the click-started game case (line 218) and link to the new page for the steps. On the `assets` page, keep the last paragraph (line 505) as one sentence that links to the new page.

## 4. first-use-shaders: a decision record number in a published table row

- Page: guides/first-use-shaders
- Anchor: row `'taa'`, line 31
- Category: internal-note. Severity: high.
- Claim: The row ends with "(D-206)", a maintainer decision record number. The docs rules forbid decision record numbers in docs/. A reader cannot look it up. "a prototype for measuring only" also tells the reader nothing they can act on.
- Evidence: line 31 "when `post.set` turns the temporal resolve on, a prototype for measuring only (D-206)". Source `tools/lib/first-use-docs.ts` line 25.
- Proposed edit: In `FIRST_USE_DOWNLOADS.taa`, write: "when `post.set` turns the temporal resolve on. The resolve is for measurement only, and no preset turns it on." (Check the second sentence against the code.) Drop "(D-206)". Add a test in the docs style check that fails on `D-\d{3}` in generated pages.
- Generated source: tools/lib/first-use-docs.ts

## 5. custom-passes: one page for six features, and it should split

- Page: guides/custom-passes
- Anchor: `# Custom passes and render targets`
- Category: split-page. Severity: medium.
- Claim: The page has 5,698 words and 25 headings. It covers custom effects (8 H3s), tone curves, scene passes, reflections with a long water recipe, full-screen passes and compute passes. The first two are post-processing on the camera's image, and the rest are render-graph passes into textures. A reader who wants a tint effect gets the whole render graph in the same page.
- Evidence: stats.json `guides/custom-passes`: words 5698, 25 headings, 2 Mermaid diagrams (one for effects, one for render to a texture).
- Proposed edit: Split into `guides/custom-effects` ("Custom effects and tone curves": lines 13 to 252, with the first diagram and the E1213, E1215, E1216, E1203 and E1101 rows of the Errors table) and keep `guides/custom-passes` ("Render passes and render targets": lines 254 to 577, with the second diagram and the E1220, E1502, E1503, E1504 rows). Each page links to the other in its first paragraph. Keep `### A water recipe` on the passes page, or move it to the water API page as a "build your own" section.

## 6. assets-pipeline: the texture-memory warning is explained twice, and the file limits sit under the wrong heading

- Page: guides/assets-pipeline
- Anchor: line 257 (`warning` row), line 264, line 278
- Category: duplication. Severity: medium.
- Claim: The `warning` row of the report table (line 257) says what line 278 says again, under `## The shader list`, where it does not belong. Line 264 (the 256 MiB and 1 GiB file limits, and how to split a scene) sits at the end of `## The budget report`, but it is about what the command refuses to write.
- Evidence: line 257 "Each quality preset whose texture memory budget the model's textures pass"; line 278 "It warns for each quality preset whose texture memory budget the model's textures pass."; line 264 "The command writes no model that the engine would refuse to load."
- Proposed edit: Move line 278's two useful facts (phones take ETC2 or ASTC bytes, computers BC7; several models add together) into the `warning` row or one sentence under the table, and delete line 278 from the shader list. Move line 264 to the end of `## Optimize a model`, under a bold-free sentence such as "The command refuses a model that the engine could not load."

## 7. assets-pipeline: the Vite route comes after the internals

- Page: guides/assets-pipeline
- Anchor: `## In a Vite project` (line 280)
- Category: scan-order. Severity: medium.
- Claim: Most null3D projects use the Vite plugin, and `?optimized` is the easiest way to use the tool. It appears as H2 number 11, after levels of detail, cluster trees, the budget report and the shader list. A newcomer reads 4,000 words before finding the import that needs no command.
- Evidence: headings list in stats.json; `## In a Vite project` follows `## The shader list`.
- Proposed edit: Move `## In a Vite project` to right after `## Optimize a model`. Add one sentence to the intro (line 23): "Run it as a command, or let the null3D Vite plugin run it when a module imports a model with `?optimized`."

## 8. assets-pipeline: the shader list paragraph is 212 words of loader rules

- Page: guides/assets-pipeline
- Anchor: `## The shader list`, line 276
- Category: technical-details-block. Severity: medium.
- Claim: Line 276 is the longest paragraph in the slice (212 words, 10 sentences). It mixes what a user needs (the engine downloads the model's shader files with its textures, so nothing downloads while the game plays) with the loader's rules for `coverage`, `lod_fade`, measured and hand-set levels, and the governor.
- Evidence: stats.json line 269: 212 words, 10 sentences.
- Proposed edit: Keep two sentences in the main text: "The engine reads the list as it loads the file and downloads those shader files beside the textures. `scene.warmUp()` then builds the pipelines that the model's objects need, so nothing new downloads while the game plays." Move the rest into `<details><summary>Technical details: which listed files the engine holds back</summary>` as a list: `coverage` needs MSAA; `lod_fade` needs `lodFade`, which Low turns off; a hand-set level's fade always needs the file; measured levels name no fade file; a held file loads on first use when the governor raises the threshold or the settings change.

## 9. assets-pipeline: "Encode time" points back 300 lines to "those 40 sets"

- Page: guides/assets-pipeline
- Anchor: `## Encode time` (line 461), line 463
- Category: unclear. Severity: medium.
- Claim: The one-paragraph H2 says "those 40 sets, 144 textures in all". The 40 sets are defined at line 147, under `## Textures`, about 300 lines earlier. A reader who jumps to this section cannot tell what the sets are. The H2 is also too small to stand alone, and it sits between environment maps and the permutation build.
- Evidence: line 463 "On a MacBook Pro with 18 cores, those 40 sets, 144 textures in all, took 18 to 26 seconds."; line 147 "In 40 sets of photographed materials at 1024 x 1024".
- Proposed edit: Move the paragraph under `## Textures`, right after line 147, as `### Encode time`, and write "The same 40 sets, 144 textures in all, took 18 to 26 seconds on a MacBook Pro with 18 cores."

## 10. debugging: four long paragraphs that are lists or tables in disguise

- Page: guides/debugging
- Anchor: lines 97, 124, 138, 146
- Category: long-paragraph. Severity: medium.
- Claim: Line 138 (stats overlay) is 180 words and 12 sentences. Line 97 lists the three `renderFallback` values in running text. Line 124 lists debug views and a shadow tip in one paragraph. Line 146 lists the inspector panel's parts in running text.
- Evidence: stats.json lines 90 (93 words, 7 sentences), 117 (84 words, 6), 131 (180 words, 12), 139 (93 words, 6).
- Proposed edit:
  - Line 97: one lead sentence, then a table `| renderFallback | Meaning |` with rows `no-surface`, `no-answer`, `failed-to-start`. Keep "A development build also logs a warning" and the link after it.
  - Line 124: lead sentence "Draw the whole scene with a debug view", then a list: `debug.view('wireframe')`, `debug.view('lit')`, `?view=levels`. Put the shadow-crawl tip in its own paragraph.
  - Line 138: split into three. (1) What the overlay shows: a list of header, card, per-step GPU times, add-on rows, `Memory by system` in development builds. (2) How to turn it on: a list of `createEngine({ stats: true })`, `engine.stats(true)`, `?stats`, `debug.stats(true)`. (3) `debug.frameStats()`. Move the "uses, reserves and has used at most" detail into a details block.
  - Line 146: a list of the panel's parts: tree, search box, selection with outline, field editor, frame figures.

## 11. debugging: the common failures table is last, where a newcomer looks first

- Page: guides/debugging
- Anchor: `## Common failures` (line 216)
- Category: scan-order. Severity: medium.
- Claim: A newcomer with a black canvas or black objects opens Debugging to find the cause. The table that answers that is the last H2, after the inspector call table and the MCP tools table. The intro (line 22) does not mention it.
- Evidence: headings list in stats.json: `## Common failures` is H2 number 11 of 12.
- Proposed edit: Move `## Common failures` to right after the intro, before `## Error messages`, or add a sentence to line 22: "When nothing draws or a thing looks wrong, start with [Common failures](#common-failures)."

## 12. debugging and agents: the MCP server is described twice

- Page: guides/debugging, guides/agents
- Anchor: debugging `## The MCP server` (line 176); agents `## The MCP server` (line 63)
- Category: duplication. Severity: medium.
- Claim: Both pages explain the default headless mode and `--connect`, say a development build is needed, give the same `claude mcp add` command, list what the tools do and say "Live changes are for exploring". The two texts can drift. Agents line 67 is also a long paragraph (78 words, 5 sentences).
- Evidence: agents line 65 "The server needs a development build, because a production build leaves the inspection channel out." and debugging line 178 "The page needs a development build, because a production build leaves the inspection channel out."; `claude mcp add null3d -- bunx @null3d/cli mcp` at agents line 72 and debugging line 211.
- Proposed edit: Keep the full description (modes, options, tools table) on debugging. On agents, keep one paragraph: what the server is for, the `claude mcp add` line, and a link to [Debugging](debugging.md#the-mcp-server). This also removes the long paragraph at agents line 67.

## 13. first-use-shaders: 43 rows in manifest order, with no grouping

- Page: guides/first-use-shaders
- Anchor: the feature table, lines 15 to 57
- Category: scan-order. Severity: medium.
- Claim: The table lists 43 features in the order of the shader manifest. Post effects (`bloom`, `dof`, `exposure`, `taa`), material features (`coat_sheen`, `transmission`, `hash`) and scene features (`sky`, `clouds`) mix together. Two rows are for the engine's own tests only (`texcoords`, `instance_index`), and a user cannot pass them usefully. A reader who wants "what do I preload for my scene" must read all 43. Several cells are 2 to 3 sentences (`clouds`, `color_copy`, `cluster_levels`).
- Evidence: lines 22 and 52 ("only in the engine's own tests"); row order from `Object.keys(manifest.first_use)` in tools/lib/first-use-docs.ts.
- Proposed edit: In `firstUsePage`, sort the rows by a group, then by name. Add a group to each entry of `FIRST_USE_DOWNLOADS` (Post-processing, Materials, Lights and shadows, Sky and background, Meshes and animation, Transparency, Engine tests) and print one table per group under an H2. Put the two test-only features last, under "Engine tests", with one line saying a page never needs them. Keep each cell to one sentence, and move the second sentence of long cells into the group's intro or drop it.
- Generated source: tools/lib/first-use-docs.ts

## 14. add-ons: eight long paragraphs, most of them in the levels of detail section

- Page: guides/add-ons
- Anchor: lines 33, 35, 55, 59, 71, 73, 117, 153
- Category: long-paragraph. Severity: medium.
- Claim: `## Give every mesh levels of detail` has four long paragraphs in a row (lines 55, 59, 71, 73). The add-on author's rule is short: "make meshes with `fromArrays` or a generator, leave `levels` out, and pass `levels: false` with a comment only for the table's cases". The planning thresholds, the refusal cases and the pieces rules bury it.
- Evidence: stats.json lines 26 (74 words, 5 sentences), 28 (69, 5), 48 (102, 5), 52 (93, 7), 64 (102, 6), 66 (131, 8), 110 (98, 7), 146 (106, 6).
- Proposed edit:
  - Line 33: make the naming rules a list: name format; package value stays the same so a reload takes back the namespace; `null3d` and codes below 2000 are the engine's; a taken name or code is refused.
  - Line 35: split after the second sentence. Put "Widen the range only after..." on its own line as the action.
  - Lines 55 to 59: open the section with the rule (line 57, first sentence). Move the thresholds (4,096, 256 and 65,536 triangles), the governor's 1.5-pixel fade and the vertex order note into `<details><summary>Technical details: when a mesh plans its levels</summary>`. Keep "Use `buildLevels()` after `updateVertices`" and the leaf-card exception in the main text.
  - Line 71: make the automatic refusals a list (joints, morph targets, `targets`, flat meshes, displacement or `vertexOffset`, first `updateVertices`, `setLevels`). Keep "Still pass `levels: false`" as the closing sentence.
  - Line 73 (pieces): move into a details block "Technical details: pieces of a large mesh". Keep one main-text sentence: "Meshes made in code also get pieces, and a mesh that spans the view without levels asks for `levels: 'pieces'`."
  - Line 117: keep "Custom materials, effects and tone curves load on first use, in files that take the shader budget." Move the whole-shader, sky-layer and effect-piece accounting into a details block.
  - Line 153: keep "The gate counts the bytes that the add-on's own code allocates each frame, on each preset. Aim at zero." Move the heap-reading and file-matching rules into a details block.

## 15. add-ons: the reader meets "gates" before the page says what the check runs

- Page: guides/add-ons
- Anchor: intro (line 13), `## Name a page` (line 119)
- Category: term-before-definition. Severity: medium.
- Claim: The intro says `check-addon` "runs these rules", but the page never lists the rules together. `## Name a page` (line 121) says "The browser gates open a page", before `## Run the check` shows the gates. A reader cannot tell which section is a rule the check enforces and which is advice (the Rust hot path is advice; public imports and shaders are gates).
- Evidence: line 121 "The browser gates open a page of the add-on's project."; the gates list only appears as sample output at lines 139 to 146.
- Proposed edit: After the intro, add a short table "What the check runs": gate name (`package`, `public API`, `interface`, `shaders`, `sizes`, `page`, `cost per preset`, `allocation per preset`), what it checks, and the section that explains it. Mark the sections that are advice, not gates. Move `## Name a page` under `## Run the check` as an H3.

## 16. custom-passes: long paragraphs and a ten-bullet cost list

- Page: guides/custom-passes
- Anchor: lines 25, 306, 312, 314, 336; `### Cost` (lines 215 to 224)
- Category: long-paragraph. Severity: medium.
- Claim: The intro (line 25, 106 words) defines four kinds of pass in one paragraph. Lines 306, 312 and 314 pack several rules each. `### Cost` has ten bullets, several of 4 to 5 sentences, about how the engine joins and folds effects. A user needs two rules from it: one pass costs about 0.05 to 0.3 ms, and effects that read only their own pixel join for free. The underwater example's three tips and caustics paragraph (lines 207 to 211) are dense too.
- Evidence: stats.json lines 18 (106 words, 6 sentences), 299 (111, 5), 305 (77, 6), 307 (89, 7), 329 (74, 5).
- Proposed edit:
  - Line 25: one sentence, then a four-row table: kind (custom effect, tone curve, scene pass, full-screen pass), what it reads, what it writes, link.
  - `### Cost`: keep bullets 1 (memory and GPU time) and a short form of 2 and 3 ("Effects that read only their own pixel join into one pass. An effect that reads other pixels starts a new pass."). Move the fold rules, background joined shaders, the WebGL2 background-compile note, precision, shared targets and pipeline timing into `<details><summary>Technical details: how the engine joins effects</summary>`. Keep "Add your effects before the first frame" in the main text as an action.
  - Line 306: split into two paragraphs: cadence (first two sentences), and on/off (the rest, see finding 18).
  - Line 312: make a list of what a scene pass draws and does not draw.
  - Line 314: keep "A light that only the pass sees lights it without a shadow." Move the light-list memory note into a details block.
  - Line 316 (color in the texture by device): a three-row table by device kind, or a details block.
  - Line 336: fine; split after "the reflection of the banks and the sky".

## 17. custom-shaders: "WGSL in sketch code" explains the tag two sections after the page uses it

- Page: guides/custom-shaders
- Anchor: `## WGSL in sketch code` (line 98)
- Category: scan-order. Severity: medium.
- Claim: The first example (line 30) uses `/* wgsl */` and the second (line 51) uses `#import`. The page explains the tag's rules (no `${...}`, no backquotes in comments, each literal compiles on its own) only at line 98, after the full-shader section. A newcomer who writes `${value}` in the first material fails before reaching the rule.
- Evidence: line 30 `const rings = /* wgsl */ \``; line 132 "The literal cannot hold `${...}`."
- Proposed edit: Move `## WGSL in sketch code` to right after the intro (before `## Custom materials`). Order the page: WGSL in sketch code, Custom materials, Full shaders, What the plugin compiles, Shader errors, Hot reload, TypeScript.

## 18. custom-passes: "the switch" is never introduced

- Page: guides/custom-passes
- Anchor: `### Drawing less often`, line 306
- Category: term-before-definition. Severity: medium.
- Claim: Line 306 says "Pace a pass with the cadence, not with the switch" and "the switch only skips its recording". The page never names the call that switches a pass off. `render.setPassEnabled` appears only in the Related pages list at line 582. A reader cannot follow the advice.
- Evidence: line 306; line 582 lists `render.setPassEnabled`.
- Proposed edit: Name the call: "`render.setPassEnabled(pass, false)` switches a pass off. Pace a pass with `setPassEvery`, not with `setPassEnabled`." Then move the plan and recompile rules into a details block "Technical details: what switching a pass costs".

## 19. custom-shaders: long paragraphs, and bundler internals in the main text

- Page: guides/custom-shaders
- Anchor: lines 43, 175, 187; `### Where a custom material's builds go` and `### Where a custom effect's and a tone curve's builds go` (lines 166 to 185); line 219
- Category: technical-details-block. Severity: medium.
- Claim: Line 43 (100 words) lists four WGSL hooks in running text. The two "Where ... builds go" H3s explain file splitting (4 files for WebGPU, 8 for WebGL2, `material-*.js`) and line 175 gives size figures from the battle comparison. A user needs one action from them: deploy every file the build writes (line 185). Line 219 (worker threads, 20 MB each) is dev-server internals.
- Evidence: stats.json lines 36 (100 words, 6 sentences), 168 (87, 5), 180 (85, 5).
- Proposed edit:
  - Line 43: lead sentence, then a list: `struct Uniforms` (changed by `set()`), `var name: texture_2d<f32>` or `texture_2d_array<f32>` (from `textures`), `fn vertexOffset`, `fn lobe`. Keep the two links after the list.
  - Merge the two H3s into one H3 "Where the builds go": two sentences ("The plugin puts each custom material's, effect's and tone curve's builds in small files of their own. A device downloads its file when the sketch first uses the shader.") and the deploy rule with E1424. Move the file counts, names, the skinned and no-tone-mapping files and line 175's figures into `<details><summary>Technical details: the build files and their sizes</summary>`.
  - Line 187: see finding 20.
  - Line 219: move into a details block under `## Hot reload`.

## 20. custom-shaders: the arrays paragraph sits under the wrong heading

- Page: guides/custom-shaders
- Anchor: line 187, under `### Where a custom effect's and a tone curve's builds go`
- Category: structure. Severity: medium.
- Claim: The paragraph on WGSL arrays and the WebGL2 rewrite follows the E1424 deploy note, inside the H3 about effect build files. It has nothing to do with build files. A reader who wants to know whether arrays work will not look there.
- Evidence: line 185 "Deploy every file that the build writes." then line 187 "You can use arrays in every form that WGSL allows."
- Proposed edit: Move line 187 to `## What the plugin compiles`, after line 164 (the WGSL rules link). Keep the first sentence in the main text and put the GLSL rewrite (`out` parameter, element-by-element fill) in a details block "Technical details: arrays in the WebGL2 build".

## 21. deterministic-simulation: long paragraphs with build and bundle figures

- Page: guides/deterministic-simulation
- Anchor: lines 56, 110, 166, 218, 222
- Category: long-paragraph. Severity: medium.
- Claim: Line 56 gives the rule (never import `@null3d/engine` in simulation code) and then five sentences of bundle sizes for two Bun versions. Line 110 lists listeners in running text. Lines 218 and 222 are two paragraphs of build figures (see finding 22).
- Evidence: stats.json lines 49 (82 words, 5 sentences), 103 (84, 6), 159 (74, 5), 211 (108, 7), 215 (81, 6).
- Proposed edit:
  - Line 56: keep the first sentence and "The rest is engine code that the simulation never calls, with a top-level `FinalizationRegistry`, which a replaying engine's scan refuses." Move the 9,133, 1,202 and 87,857 byte figures and the Bun 1.3.11 detail into `<details><summary>Technical details: bundle sizes</summary>`.
  - Line 110: lead sentence, then two lists: listeners it leaves out (pointers, keys, wheel, focus, pointer lock, gamepads, pointer capture, context menu) and listeners it keeps (`visibilitychange`).
  - Line 166: split after "draws it in `onUpdate`". Make "Send a new array each time" its own sentence with the reason.
  - Lines 218 and 222: see findings 3 and 22.

## 22. deterministic-simulation: two near-identical build reports give different figures

- Page: guides/deterministic-simulation
- Anchor: lines 218 and 222
- Category: contradiction. Severity: medium.
- Claim: Line 218 says "A real game recorded this way drew with 5 words, and its folder held 300 files and 26 MB. The same folder built with the 172-word example list held 762 files and 226 MB." Line 222 says "A small game scene with three lanes and a ship drew with 5 words. Its folder held 297 files and 26,057,130 bytes ... The same folder built with the 172 words ... held 759 files and 225,683,678 bytes." These look like the same measurement in two versions. The reader cannot tell if they are two games.
- Evidence: line 218 and line 222 as quoted.
- Proposed edit: Keep one report, in a details block "Technical details: what a narrowed set saves", as a small table: words, files, bytes, bytes after Brotli, for the narrowed set, the example list and the full set. Delete the other paragraph.

## 23. baked-light-data: the Needle section is another format, and it holds the error paragraph

- Page: guides/baked-light-data
- Anchor: `## Needle light maps` (line 126), line 137
- Category: structure. Severity: medium.
- Claim: The page is the reference of the null3D baked light file. `## Needle light maps` describes a glTF extension that the glTF loader reads, not this file. It sits between "Load a file" and "Save a grid", so it breaks the load, save, check order. Line 137 (both calls throw E1434) belongs with `## What the loader checks`, but it sits at the end of the Needle section.
- Evidence: line 128 "A model made for Needle's viewer carries its light maps in glTF's `NEEDLE_lightmaps` extension"; line 137 "Both calls throw [E1434](../errors/E1434.md) for a file that the engine cannot read."
- Proposed edit: Move line 137 to the top of `## What the loader checks`. Move `## Needle light maps` to the end of the page (after `## Limits`) as "Light maps in Needle models", or to the glTF loading page with a link from here.

## 24. baked-light-data: long paragraphs, and GPU layout detail for a file-format reference

- Page: guides/baked-light-data
- Anchor: lines 33, 64, 66, 94, 122, 124; `## Limits` first bullet (line 174)
- Category: long-paragraph. Severity: medium.
- Claim: Line 122 (107 words, 7 sentences) mixes what each call returns with the engine's texture formats and the reader's download size. Line 64 gives the coefficient order in running text, which a tool author must get exactly right. Lines 66, 94 and 124 and the sub-volume bullet at line 174 are GPU-side detail.
- Evidence: stats.json lines 26 (61 words, 5 sentences), 57 (65, 5), 115 (107, 7).
- Proposed edit:
  - Line 33: cut the sentences that repeat the banner (see finding 25). Keep "The rest of the file depends on its kind. A reader ignores members that it does not know."
  - Line 64: make the layout a list: probe order (x fastest, then y, then z); 12 floats per probe; coefficient order L0, L1 y, L1 z, L1 x, each RGB. Keep "`bakeProbes` writes the same values" after it.
  - Line 66: split into three sentences on coefficients, validity and sky visibility, or a three-row table.
  - Line 122: keep what each call returns (texture, `directionTexture`). Move the `rgba8unorm`/`rgba16float` texture formats, the opaque fourth channel and the shared binding into `<details><summary>Technical details: the textures that the loader makes</summary>`. Keep the 2 KB reader size as its own sentence.
  - Lines 94 and 124: move into the same details block.
  - Line 174: keep "at most 256 x 256 x 62 probes" in Limits. Move the four sub-volumes and padding slices into a details block.

## 25. baked-light-data: the banner holds format rules and an unrelated light map sentence

- Page: guides/baked-light-data
- Anchor: the note under the title, line 11
- Category: duplication. Severity: medium.
- Claim: The note is four sentences. The middle two repeat line 33 (a reader ignores unknown members; a new version only when an older reader would misread). The last sentence, "A directional light map bends its light with a normal map, as the light of the bake came from a direction", is a feature description that has nothing to do with the stability note and is repeated in line 124.
- Evidence: line 11; line 33 "The `version` number changes only when a reader that predates the file would read it wrongly."
- Proposed edit: Cut the note to its first two sentences: "Roadmap step 0.3, first released in null3D 0.1.0. The format is stable: version 1 holds the members that this page lists." Keep the versioning rules at line 33 only. Delete the directional light map sentence from the note.

## 26. assets-pipeline: "Blockers and stored trees" joins two unrelated features

- Page: guides/assets-pipeline
- Anchor: `## Blockers and stored trees` (line 107)
- Category: heading-depth. Severity: low.
- Claim: Blockers are for occlusion culling on WebGL2. Stored trees are for raycasts. They share only their storage in engine extensions (line 130). A reader who wants `--bvh` will not look under a heading that leads with blockers.
- Evidence: line 109 starts on WebGL2 occlusion; line 128 starts "Raycasts walk a tree over each mesh's triangles."
- Proposed edit: Use two H3s under one H2 "Blockers and raycast trees": `### Blockers` (lines 109 to 126) and `### Stored raycast trees` (line 128). Keep line 130 at the end of the H2.

## 27. custom-passes: a paragraph-sized bullet and a broken list in the water recipe

- Page: guides/custom-passes
- Anchor: `### A water recipe`, lines 421 to 423
- Category: structure. Severity: low.
- Claim: The bullet at line 421 is seven sentences on soft shores from scene depth. A blank line after it splits the list, so line 423 renders as a second list. The soft-shore method is a technique of its own, not a note on the recipe's uniforms.
- Evidence: line 421 starts "Without a height map of the bed, a blended sheet reads the depth..."; line 422 is blank; line 423 starts a new bullet.
- Proposed edit: Keep the recipe's short bullets together with no blank line. Move line 421 into its own paragraph after the list, titled with a short lead sentence ("For a soft shore without a height map, read the scene's depth."), and put the steps as a numbered list: read `sceneDepth`, convert the pixel's depth with `engine_frame.camera_range`, subtract from `sceneDistance(uv)`, fade alpha over the last centimeters.

## 28. car-paint: the flake model and the cost are dense paragraphs

- Page: guides/car-paint
- Anchor: `## How the parts draw` line 78; `## Cost` line 100
- Category: technical-details-block. Severity: low.
- Claim: Line 78 (125 words, 7 sentences) explains the glint model. The user-facing point is "the flakes sparkle up close and look like smooth metal far away, and the clear coat stays smooth". Line 100 lists per-pixel costs in hashes and derivatives in a paragraph.
- Evidence: stats.json lines 71 (125 words, 7 sentences), 93 (77, 5).
- Proposed edit: Keep the first sentence of line 78 and add the user-facing point. Move the footprint counting and the lobe average into `<details><summary>Technical details: the glint model</summary>`. Make line 100 a three-row table: part, cost per pixel, cost per light. Keep "A material without flakes, seams or a weave draws the same surface as a plain metallic paint."

## 29. custom-shaders: the full-shader rule list is dense

- Page: guides/custom-shaders
- Anchor: `## Full shaders`, rules at lines 89 to 96
- Category: wall-of-text. Severity: low.
- Claim: The rule list has eight bullets, and lines 90, 94 and 96 are 4 to 6 sentences each. The attribute locations in line 90 are a lookup table written as prose.
- Evidence: line 90 "The position is at 0, the normal at 1, the first texture coordinates at 2 and the second at 3. The tangent is at 4, and the color at 5. The joints are at 6, as a `vec4u`, and the weights at 7."
- Proposed edit: Put the locations in a table `| Location | Attribute | Type |`. Split line 94 into two bullets: `finish` (exposure applied) and `finish_exposed` (for light sums). Split line 96 into "Options that apply" and "Options that do not reach a full shader".

## 30. audio: the waterfall example sits after the table and a warning

- Page: guides/audio
- Anchor: `## Sources at places`, lines 75 to 96
- Category: example-placement. Severity: low.
- Claim: Line 75 introduces `near` and `far` with a waterfall at `near: 6` and `far: 200`. The code for that waterfall comes at line 93, after a nine-row table and a warning. The reader sees the options, then a table, and only then the call. The table also gives the waterfall `near 5, far 400`, which differs from the example's values.
- Evidence: line 75 "A waterfall heard across a valley might take `near: 6` and `far: 200`."; line 86 "| A waterfall, which is loud and carries | 5 | 400 |"; line 94 `near: 6, far: 200`.
- Proposed edit: Move the code block (lines 93 to 96) to right after line 75. Make the example's values match the table, or say why they differ ("a waterfall in a narrow valley"). Keep the table and the warning after the code.

---

The findings below are "not verified": lower ranked, checked less closely.

## 31. (not verified) custom-shaders: the banner holds a progress note

- Page: guides/custom-shaders. Anchor: line 11. Category: internal-note. Severity: low.
- Claim: "Custom materials with surface functions, vertex offsets, uniforms, textures and full shaders are built, and so is hot reload on the dev server." reads as a build-status report, not a description of the feature.
- Evidence: line 11.
- Proposed edit: Delete the sentence. The page's sections already say what exists.

## 32. (not verified) debugging: one row of the "Where problems appear" table is a paragraph

- Page: guides/debugging. Anchor: line 48 (E1307 row). Category: wall-of-text. Severity: low.
- Claim: The cell has five sentences on pipeline rebuilds, E1307 and the E1404 exception. Table cells over two sentences are hard to scan, and the row is much taller than the others.
- Evidence: line 48.
- Proposed edit: Keep "`engine.onFailure` receives E1307, once per GPU device, with the pipeline's name. The engine draws on without those objects." Move the one-retry rule and the E1404 exception to a details block under the table.

## 33. (not verified) deterministic-simulation: step 1 of "Where the player looks" is six sentences

- Page: guides/deterministic-simulation. Anchor: line 133. Category: wall-of-text. Severity: low.
- Claim: Step 1 holds the lock, the drag rule, the `pointerLockElement` check, pointer capture and E1426. The other steps are one or two sentences.
- Evidence: line 133.
- Proposed edit: Keep "The page's input code locks the pointer with `canvas.requestPointerLock()`, in a click handler." Put the four caveats as a sub-list under step 1.

## 34. (not verified) audio: the kilometre warning appears twice

- Page: guides/audio. Anchor: line 91 and line 131. Category: duplication. Severity: low.
- Claim: Line 91 ("A source whose `far` reaches a kilometre is heard from the whole map, and a scene's opening view roars") and the bullet at line 131 ("A bed that carries a thousand meters makes an opening view over open water roar") say the same thing. The page also mixes "kilometre" with "meters".
- Evidence: lines 91, 131.
- Proposed edit: Keep the warning once, in `## A mix that works`, and write "1 km" or "a thousand meters" in one spelling.

## 35. (not verified) audio: "How the sound reaches the speakers" is implementation detail

- Page: guides/audio. Anchor: line 139. Category: technical-details-block. Severity: low.
- Claim: The 97-word paragraph explains the shared table and the audio thread. Only the last sentence (sound fades when the engine pauses or the page hides) changes what a user does.
- Evidence: stats.json line 132 (97 words, 6 sentences).
- Proposed edit: Keep the pause sentence in the main text. Move the rest into `<details><summary>Technical details: how the sketch drives the audio thread</summary>`.

## 36. (not verified) audio: long bullets in "A mix that works"

- Page: guides/audio. Anchor: lines 131 to 135. Category: wall-of-text. Severity: low.
- Claim: Five of the nine bullets are three or four sentences. The bold-free first sentence of each is the rule, but it is hard to pick out.
- Evidence: lines 131, 132, 133, 134, 135.
- Proposed edit: Cut each bullet to its rule plus one reason. Move the decibel arithmetic (line 133) into a details block.

## 37. (not verified) content-pages: "Second visits and navigation" holds two topics

- Page: guides/content-pages. Anchor: line 172; long paragraph line 181. Category: heading-depth. Severity: low.
- Claim: The section has a lifetime table, a long paragraph on the back/forward cache (70 words, 5 sentences) and then a full cache recipe with rules and code. The recipe is a separate task.
- Evidence: stats.json line 174 (70 words, 5 sentences); line 183 starts the derived-data cache.
- Proposed edit: Split the back/forward paragraph after "Build the page so that a full reload works too." Add `### Keep generated data between visits` before line 183.

## 38. (not verified) first-use-shaders: no example of `preload`

- Page: guides/first-use-shaders. Anchor: line 13. Category: example-placement. Severity: low.
- Claim: The page says `createEngine`'s `preload` takes these names but shows no call. The reader must open Loading screens to see the syntax.
- Evidence: line 13.
- Proposed edit: In `firstUsePage`, add a short code block after line 13: `await createEngine({ canvas, sketch, preload: ['bloom', 'skinning'] });` (check the option shape against the engine API).
- Generated source: tools/lib/first-use-docs.ts

## 39. (not verified) first-use-shaders: the note under the title speaks to maintainers

- Page: guides/first-use-shaders. Anchor: line 11. Category: internal-note. Severity: low.
- Claim: "The engine's shader manifest makes it, so it lists every feature of this version" tells the reader how the page is built. The reader only needs "this table lists every feature of this version".
- Evidence: line 11; tools/lib/first-use-docs.ts line 124.
- Proposed edit: Write "This table lists every feature of this version. [Loading screens](...) explains when to preload."
- Generated source: tools/lib/first-use-docs.ts

## 40. (not verified) car-paint: area lights are explained twice

- Page: guides/car-paint. Anchor: lines 87 to 88 and lines 111 to 112. Category: duplication. Severity: low.
- Claim: "Area lights draw their own smooth highlight, with no glints" (line 88) and the Limits bullet "Area lights draw the base highlight alone" (line 112) say the same.
- Evidence: lines 88, 112.
- Proposed edit: Keep it in `## Limits` only.

## 41. (not verified) all hand-written pages: the "Roadmap step" note is confusing for a reader

- Page: guides/accessibility, guides/add-ons, guides/agents, guides/assets-pipeline, guides/audio, guides/baked-light-data, guides/car-paint, guides/content-pages, guides/custom-passes, guides/custom-shaders, guides/debugging, guides/deploying, guides/deterministic-simulation
- Anchor: line 11 of each page. Category: unclear. Severity: low.
- Claim: Every note opens "Roadmap step 0.x, first released in null3D 0.1.0." A user has no roadmap to look at, and "step 0.3, first released in 0.1.0" reads as two version numbers that disagree. It is the first line under each title, so every reader meets it.
- Evidence: e.g. guides/deploying line 11 "Roadmap step 0.3, first released in null3D 0.1.0."; tools/lib/steps.ts `shipsSentence`.
- Proposed edit: For `since` values before the first release, make `shipsSentence` return "First released in null3D 0.1.0." and update the docs test that requires the current wording. Keep the experimental or stable sentence.
- Generated source: tools/lib/steps.ts (the wording rule that the hand-written notes must follow)
