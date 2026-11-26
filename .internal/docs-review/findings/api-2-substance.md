# Slice api-2: sense and substance review

Pages: api/impostors, api/input, api/lights, api/lines, api/materials, api/math, api/objects, api/page, api/particles, api/points, api/post, api/quality.

Paths below are relative to the generated copy of the repository. "G" stands for that copy.

Findings 1 to 30 are checked against the source. Findings 31 and later are marked "not verified": they were noted while reading, but were not checked as closely.

## Findings, ranked

### 1. api/objects: `setLevelBias` works the opposite way to Godot's `lod_bias` (high, wrong-claim)
- Anchor: "## Mesh calls", the `setLevelBias(bias)` bullet (line 119).
- Claim: The page says the bias works "as Godot's `lod_bias` does", and that "A bias above 1 draws coarser levels". Godot's `lod_bias` does the reverse: larger values keep the higher level of detail at farther distances. A reader who ports from Godot will set the bias the wrong way.
- Evidence: docs/api/objects.md:119; docs/concepts/lod.md:153 repeats the comparison; TSDoc packages/engine/src/scene/scene.ts:1815-1817 ("as Godot's `lod_bias` does. A bias above 1 makes every switch happen nearer"). Godot GeometryInstance3D.lod_bias: "larger values will keep the mesh in a higher level of detail at farther distances."
- Proposed edit: Replace "as Godot's `lod_bias` does" with "the inverse of Godot's `lod_bias`: a Godot bias of 2 is a null3D bias of 0.5". Make the same change in docs/concepts/lod.md:153 and in the TSDoc at scene.ts:1815, which feeds docs/api/reference/objects.md.
- Generated source: packages/engine/src/scene/scene.ts (TSDoc of setLevelBias) for the reference page; the main page is hand-written.

### 2. api/impostors: internal history of the showcase island in user docs (high, internal-note)
- Anchor: "## Make a card read as its mesh" (lines 135-141), the "Bake the views with the engine's baker" bullet (lines 163-165), and "## Bake several views, not one side" (lines 189-191).
- Claim: The page tells the story of the maintainers' showcase scene: "The island's trees once baked a card as one unlit side view ... that card was 34 to 79 per cent brighter", "their hand bakes read as stacked plates there; the engine's bake is their card now", "The island's five plants bake a five by five grid". This is a changelog of an internal project. The rules say a page states what holds now, and gives no history.
- Evidence: docs/api/impostors.md:135-141, 163-165, 189-191; AGENTS.md "Writing docs" (states what holds now; leave when it happened to git).
- Proposed edit: Delete the history paragraph at 135-141. Keep one present-tense sentence: "A card that is brighter or flatter than its mesh reads as another species at the hand-over. Most of the difference comes from how the crown lights." Change the end of the baker bullet to "A hand-painted card holds up only while it covers a few tens of pixels." Replace the island figures at 189-191 with a neutral example: "A five by five grid at 128 texels a cell gives two 640-pixel-square atlases, 3.3 MB of texture together at four bytes a texel." Put the measured brightness and spread figures, if they stay, in a `<details>` block titled "Technical details: how a card was measured against its mesh".
- Generated source: none.

### 3. api/lines: the dash text gets `dashScale` the wrong way round (medium, wrong-claim)
- Anchor: "## Dashes", "Both count in world units along the line, times `dashScale`" (line 135); options table rows `dashSize` and `dashScale` (lines 85, 87).
- Claim: The shader multiplies the distance along the line by `dashScale`, then compares it with `dashSize` and `gapSize`. So a dash is `dashSize / dashScale` world units long, and a larger `dashScale` gives shorter dashes. The page suggests the opposite, and the table calls `dashSize` "in world units", which is true only at the default scale. The table text "A factor of the line's length, which the dash and gap sizes measure" is hard to read.
- Evidence: crates/null3d-shaders/wgsl/line.wgsl:123-124 (`out.distance = dash_scale * ...`) and :225 (`modulo(in.distance + dash.w, dash.x + dash.y) > dash.x`); TSDoc packages/engine/src/scene/lines.ts:54.
- Proposed edit: Line 135: "Both are lengths along the line. `dashScale` multiplies the line's length before the dashes are measured, so a scale of 2 makes each dash and gap half as long in the world. `dashOffset` counts in the same scaled units." Table row for `dashScale`: "Multiplies the line's length before the dash and gap sizes measure it. 2 gives dashes half as long". Change the TSDoc at lines.ts:54 to match.
- Generated source: packages/engine/src/scene/lines.ts (LineValues.dashScale) for docs/api/reference/lines.md.

### 4. api/materials: the basics come after 400 lines of advanced features (medium, scan-order)
- Anchor: heading outline from "## Transmission" to "## Texture maps".
- Claim: The page has 13,672 words. A newcomer who wants texture maps, colors, `set`, alpha modes or blending must scroll past transmission, diffuse transmission, subsurface light, clear coat, sheen, iridescence, anisotropy and decals first. "Texture maps" starts at line 420 and "Alpha modes" at line 570. The page also has no picture of what a material does.
- Evidence: stats.json headings for api/materials; docs/api/materials.md:131-418 against 420-700.
- Proposed edit: Reorder the page: The materials, Standard values, Color, Texture maps, Texture coordinate transform, Changing a material, Destroying a material, Options fixed at creation, Alpha modes, Blending, Depth bias, Shadow catchers. Then put the advanced surfaces in this order: Transmission, Light through thin surfaces, Light under the surface, Clear coat and sheen, Iridescence and anisotropy, Relief, Decals. Then Custom materials, Ranges, Limits. Add a contents line under the intro that names the two parts. Splitting the advanced surfaces into their own page is an alternative.
- Generated source: none.

### 5. api/materials: the texture-array clash rule appears four times, and the specular-slot rule three times (medium, duplication)
- Anchor: "### How it draws" (lines 169-170), "### Maps of the layers" (lines 294, 296), "### Maps of iridescence and anisotropy" (line 346), "## Texture maps" (lines 460, 462).
- Claim: Four places say which maps fill which texture array and which pairs throw E1217, each in slightly different words. Lines 212-213, 294 and 460 each say that layer and diffuse-transmission maps take the specular maps' places. A reader cannot tell whether the versions differ.
- Evidence: docs/api/materials.md:169-170, 294, 296, 346, 460, 462.
- Proposed edit: Keep one statement under "## Texture maps", as a table of slots (light map slot, specular intensity slot, specular color slot) against the maps that may use each slot. Put the table in `<details><summary>Technical details: which maps share a texture slot</summary>`. In the other sections, replace the text with one line: "These maps share slots with other maps. See [Texture maps](#texture-maps)."
- Generated source: none.

### 6. api/impostors: two sections repeat the same view and texel guidance (medium, duplication)
- Anchor: "## Make a card read as its mesh" bullets (lines 151-156) and "## Bake several views, not one side" (lines 173-187).
- Claim: Both sections give the grid angles (53, 42.5 and 23 degrees) and the rule "80 pixels wants 32 to 64 texels". Both say that `bakeImpostorAtlas` stores a normal per texel and that cards blend three views. The second section adds only the 215-pixel figure and the example.
- Evidence: docs/api/impostors.md:151-156 against 182-187; 159-162 against 173-178.
- Proposed edit: Merge the two sections into one, "Bake a card that reads as its mesh". Use a list of rules, then a small table of grid size against worst angle (4x4: 53, 5x5: 42.5, 10x10: 23) and card pixels against texels per cell (80: 32 to 64; 215: 128 to 256), then the code example. Also remove the hard line wraps in these sections, which break the source mid-sentence.
- Generated source: none.

### 7. api/impostors: the page opens with the demo and uses words before it explains them (medium, term-before-definition)
- Anchor: line 13, the paragraph before the Mermaid diagram.
- Claim: The first paragraph names "the hand-over band", "the far band" and an L key before the page says what an impostor is. The demo is named as `examples/impostors` with no link. The diagram uses "copy's turn" and "octahedral grid" before they are explained. The page has no GitHub demo link at all.
- Evidence: docs/api/impostors.md:13, 17-21; stats.json exampleLinks for api/impostors is empty.
- Proposed edit: Start with the Mermaid diagram and the paragraph now at line 24 ("A far object covers few pixels ..."). Then add: "The [impostors demo](https://github.com/null3d-engine/null3d/tree/main/examples/impostors) draws a pine forest three ways by distance: meshes near, merged meshes per grid cell in the middle, and cards far out. Press L to draw the far trees as meshes and compare, and T to sweep the sun." Define "hand-over" where `handOverToCards` is described.
- Generated source: none.

### 8. api/impostors: the first example loads atlases by hand and leaves out `room` and `depth` (medium, unclear)
- Anchor: "## Create the cards" code block (lines 44-66).
- Claim: The example loads two PNG files with `assets.loadTexture` and passes `size: 6` with no `room` or `depth`. A PNG pair from `bunx @null3d/cli assets impostor` needs the bake's `room`, or the picture fills the card at the wrong height. `loadImpostorAtlas` gives all of these values, and the page introduces it only at line 111. The square `size: 6` also does not match a bake's `[width, height]` size. `trees` is never used.
- Evidence: docs/api/impostors.md:44-66, 107, 111; packages/impostors/src/batch.ts:61-77 (`size`, `room` default 1); examples/impostors/sketch.ts:88-101 passes `room` and `depth` from the bake.
- Proposed edit: Rewrite the first example with `const pine = await loadImpostorAtlas(assets, 'trees/pine-impostor.json'); createImpostors({ scene, materials, geometry }, { ...pine, positions, turn: turns });`. Keep the hand-made texture case for "Bake the atlases".
- Generated source: none.

### 9. api/impostors: `room` is used but never explained clearly (medium, term-before-definition)
- Anchor: "## Bake the atlases", "taller than that height by the bake's `room`, which `createImpostors` takes as `room`" (line 107).
- Claim: The reader cannot tell what `room` is: a length, a margin or a factor. The source says it is a factor: how many times taller a view's picture is than the card. The sentence "A picture that you paint yourself fills its card, and takes the default of 1" only makes sense once you know that.
- Evidence: docs/api/impostors.md:107; packages/impostors/src/batch.ts:74-77; packages/impostors/src/bake.ts:267 (`room: Math.hypot(2 * reach, objectHeight) / objectHeight`).
- Proposed edit: "Each view's picture is taller than the card, because a view from above must hold the object's whole width too. `room` is that factor: the picture's height divided by the card's height. Pass the bake's `room` to `createImpostors`. A picture that you paint to fit the card takes the default, 1."
- Generated source: none.

### 10. api/impostors: the page does not say why shadow casting needs a second batch (medium, missing-content)
- Anchor: "## Create the cards", "Give a batch `castShadows: true` and a layer that the sun draws and no camera does" (line 79).
- Claim: The text implies that a batch which casts must sit on a layer that no camera draws. So a scene needs two batches: one that the camera sees and one that only casts. The page does not say this, give the reason, or show the code. The paragraph is 174 words long and also covers receiving, contact shadows and `castsStill`.
- Evidence: docs/api/impostors.md:79; TSDoc packages/impostors/src/batch.ts:88-92 ("A card batch that only casts draws on a layer that the light sees and no camera does, so it costs nothing in the camera's view"); test page tests/pages/sketches/impostor-shadow-sketch.ts (manifest.ts:3290-3295 "cast the sun's shadow through a batch that only the light draws").
- Proposed edit: Give shadows their own subsection with a short example: a visible batch with `receiveShadows`, and a second batch with the same rows, `castShadows: true` and a caster-only layer. Say why: each card turns toward the view that draws it, so the caster turns toward the sun. Move the `castsStill` and contact-shadow detail into `<details><summary>Technical details: how cards cast and receive shadows</summary>`.
- Generated source: none.

### 11. api/lights: "the first directional light created casts them" does not say what happens to the others (medium, unclear)
- Anchor: "## Shadows", first paragraph (line 212).
- Claim: The sentence reads as if `castShadows: true` on any directional light makes it cast. In fact only the first directional light created can cast, and `castShadows` on a later one has no effect. The page lists `castShadows` as an option of every directional light (line 38) and never says this.
- Evidence: docs/api/lights.md:38, 127, 212; docs/concepts/shadows.md:407 ("The first directional light created casts the shadows, if it has `castShadows`"); TSDoc packages/engine/src/scene/scene.ts:664-667 and 2378-2380.
- Proposed edit: "Only the first directional light that you create can cast shadows, and only when it has `castShadows: true` or `setCastShadows(true)`. The option does nothing on a later directional light." Change the two TSDoc comments the same way.
- Generated source: packages/engine/src/scene/scene.ts (DirectionalLightOptions.castShadows, DirectionalLight.setCastShadows) for docs/api/reference/lights.md.

### 12. api/quality: `quality.set` is documented under the "Moment transparency" heading (medium, structure)
- Anchor: "### Moment transparency" (lines 65-71).
- Claim: The subsection on moment transparency is followed, under the same heading, by a line about anti-aliasing (69) and by the main paragraph on `quality.set` (71). A reader looking for `quality.set` will not find it under "Settings". Moment transparency is a fixed setting with no special API, so it does not need a subsection here.
- Evidence: docs/api/quality.md:59-71; stats.json headings for api/quality.
- Proposed edit: Move the paragraph at line 71 up to just after line 63, under "## Settings", and put the code example from the page top there. Reduce "Moment transparency" to one sentence in the fixed-settings list, with its link, or move it into the options table at line 50.
- Generated source: none.

### 13. api/quality: when the change handlers run is stated two different ways (medium, contradiction)
- Anchor: "## The frame-budget governor" (line 104) and "## Quality events" (line 190).
- Claim: Line 104 says the `onChange` handlers run "after each of these steps": detail, shadows, bloom, ambient occlusion, reflections, contact shadows, animation interval and fog. Line 190 says "after each shadow step of the frame-budget governor". The code calls the handlers after every governed step past the render scale. Line 190 and the TSDoc are too narrow.
- Evidence: packages/engine/src/sketch/runner.ts:1588-1604 (every setLevelQuality, setShadowQuality, setBloomChain, setAoScale, setSsrQuality, setContactSteps, setFogHalvings, then `this.quality.governed()`); packages/engine/src/sketch/quality.ts:594-597 (comment says "shadow settings").
- Proposed edit: Line 190: "It also calls it after each step that the governor takes past the render scale, as [The frame-budget governor](#the-frame-budget-governor) lists, and after the texture memory budget drops levels or asks for them again." Change the comment at quality.ts:595 to match.
- Generated source: none (the TSDoc of `onChange` at quality.ts:283-286 does not name the governor).

### 14. Cross-page: maintainer bench commands in user docs (medium, internal-note)
- Pages: api/materials, api/debug, api/geometry, api/raycast, api/scene, api/controls, api/wind.
- Anchor: in api/materials, "`bun run bench:allocation --setters` checks `setUniform` in every frame and `set` at setup" (line 526).
- Claim: `bench:allocation` is a script of the engine's own repository (package.json:57). A developer who uses the engine cannot run it in their project. It tells them how the maintainers test, not what to do. api/controls also cites `tests/image/controls.spec.ts`.
- Evidence: docs/api/materials.md:526; docs/api/debug.md:335; docs/api/geometry.md:204; docs/api/raycast.md:23; docs/api/scene.md:246, 341, 462, 549; docs/api/controls.md:106; docs/api/wind.md:372; G/package.json:57.
- Proposed edit: Delete the sentences. Where a claim needs support, write "The engine's allocation benchmark checks it in every frame." Or put the command in a `<details>` block for contributors, titled "Technical details: how the engine checks this".
- Generated source: none.

### 15. api/materials: `setUniform` text says `ior` and `attenuationDistance` take more than one number (medium, wrong-claim)
- Anchor: "## Changing a material" (line 526), "A value that takes more than one number, as `uvTransform`, `normalScale`, `clearcoatNormalScale`, `angleFade`, `ior` and `attenuationDistance` do, goes through `set`."
- Claim: To the user, `ior` and `attenuationDistance` are single numbers (Standard values table, lines 85 and 92). They go through `set` because the engine stores each as several internal parameters, not because they take several numbers. A reader will think the table is wrong.
- Evidence: docs/api/materials.md:85, 92, 526; packages/engine/src/scene/resources.ts:3355-3360 ("A value that takes more than one parameter, as ... the index of refraction do, goes through `set`") and the ONE_VALUE_PARAMS list at 3361-3389, which has neither name.
- Proposed edit: "`setUniform` takes the values listed below. Every other value, such as `uvTransform`, `normalScale`, `clearcoatNormalScale`, `angleFade`, `ior` and `attenuationDistance`, goes through `set`." List the names that `setUniform` takes, from ONE_VALUE_PARAMS. Move the paragraph on how the browser boxes numbers into `<details><summary>Technical details: why set can allocate</summary>`.
- Generated source: none.

### 16. Cross-page: the "Roadmap step" banner names an internal plan (medium, internal-note)
- Pages: all 12 pages in this slice (and 103 pages in total).
- Anchor: the note under each title, such as "> Roadmap step 0.2, first released in null3D 0.1.0."
- Claim: A "roadmap step" is a stage of the maintainers' build plan. The rules forbid internal plans in docs. Every step ships in 0.1.0, so the step number tells a user nothing that "first released in null3D 0.1.0" does not.
- Evidence: G/tools/lib/steps.ts:1-36 (`releaseOf`, `shipsSentence`); the check in G/tools/lib/docs.ts:652-662 requires the wording; docs/index.md:34.
- Proposed edit: Change `shipsSentence` to give "First released in null3D 0.1.0." for the pre-release steps. Change the check at docs.ts:652-662 and its test (tools/lib/docs.test.ts:90, 135-142, steps.test.ts:12), then update each page's banner. Remove the "step" column wording in pages.md and index.md, or call it "Since".
- Generated source: tools/lib/steps.ts and tools/lib/docs.ts.

### 17. Cross-page: pages with demos give no demo links (medium, missing-content)
- Pages: api/lights, api/materials, api/particles, api/impostors, api/quality, api/page.
- Anchor: none of these pages has a GitHub example link (stats.json exampleLinks is empty).
- Claim: Demos exist for nearly every feature on these pages: area-lights, spot-cookies, hero-shadow, contact-shadows, time-of-day (lights); coat-and-sheen, iridescence-and-anisotropy, translucency, subsurface, decals, relief, weighted-transparency, shader-inputs, water (materials); particles, rain (particles); impostors, forest (impostors); showroom (page: the tablet that sends choices to the sketch). materials.md:203 names "the translucency demo" in plain text with no link.
- Evidence: G/examples/demos.ts codes; stats.json; docs/api/materials.md:203.
- Proposed edit: Add one sentence with a link under each section heading, as the demo-links lists in this file give them, such as "The [area lights demo](https://github.com/null3d-engine/null3d/tree/main/examples/area-lights) lights a wet street with shop windows and a neon sign."
- Generated source: none.

### 18. api/input: the "Input off" section is full of internal names (medium, unclear)
- Anchor: "## Input off", the listener table and the lines that follow (lines 215-232).
- Claim: The table uses names that the user cannot know: "The canvas watch counts a page that shows again as a resume", "Without the device-pixel box, a query also notices a new pixel ratio", "It stops the job workers, ends the start's crash note". Line 225, "The input test records the engine's listeners in every thread mode", is about the maintainers' tests. Lines 231-232, about a warning that misses controls loaded by another sketch in the same worker, are detail for very few readers.
- Evidence: docs/api/input.md:215-232.
- Proposed edit: Keep in the main text: what `input: false` removes, that `ctx.input` stays at rest, and that `requestPointerLock` throws E1426. Move the table of kept listeners and lines 230-232 into `<details><summary>Technical details: the listeners that stay with input off</summary>`. In the table, write plain reasons: "so time while the page was hidden does not count as play", "to pass the user's reduced-motion choice and notice a new pixel ratio", "to stop the engine's workers and free memory when the page closes". Delete line 225's sentence about the test.
- Generated source: none.

### 19. api/post: the E1213 row of the errors table is one 400-word cell (medium, wall-of-text)
- Anchor: "## Errors", row E1213 (line 472).
- Claim: The cell lists about 40 causes in one run of text. A reader with an E1213 cannot find their cause.
- Evidence: docs/api/post.md:472.
- Proposed edit: Shorten the cell to "A setting or value that `post.set` or `post.addEffect` does not take, such as a value outside its range. See the list below." Below the table, add `<details><summary>Technical details: every cause of E1213</summary>` with a bulleted list grouped by effect (tone mapping and exposure, automatic exposure, bloom, ambient occlusion, reflections, depth of field, outlines, grading, vignette, sharpening, effects). Each effect's own table already gives its ranges.
- Generated source: none.

### 20. api/post: "folded effects" is not explained, and the sentence seems to contradict itself (medium, unclear)
- Anchor: "## Automatic exposure", "The final pass multiplies the scene's color, bloom's glow and folded effects by the adapted exposure ... Custom effects and depth of field see the camera's exposure." (line 109)
- Claim: "Folded effects" are custom effects that the engine joins into the final pass. So the bullet says custom effects get the adapted exposure and then says they see the camera's exposure. The page never says what folding is.
- Evidence: docs/api/post.md:109; docs/concepts/post-processing.md:70, 177, 217.
- Proposed edit: "The final pass multiplies the scene's color and bloom's glow by the adapted exposure. A custom effect that runs in a pass of its own, and depth of field, see the camera's exposure instead. An effect that the engine joins into the final pass ([The post-processing chain](../concepts/post-processing.md#cost)) takes the adapted exposure with the rest of that pass."
- Generated source: none.

### 21. api/objects: `setOccluder` does nothing on WebGL2 by default, and the page buries this (medium, unclear)
- Anchor: "## Mesh calls", `setOccluder(true)` bullet (line 121).
- Claim: The bullet says the mesh blocks the view "while software occlusion culling runs, which every preset leaves off". So by default the call has no effect. The bullet is 160 words long and mixes WebGL2 and WebGPU rules.
- Evidence: docs/api/objects.md:121; docs/concepts/culling.md:159 (every preset leaves software occlusion culling off, because it cost more than it saved on the engine's S6 benchmark).
- Proposed edit: Open with the condition: "`setOccluder(true)` matters only on WebGL2 with `softwareOcclusion: true`, which every preset leaves off. On WebGPU, GPU occlusion culling picks occluders itself, and `setOccluder(false)` keeps a mesh out of them." Move the blocker, triangle-limit and material rules into `<details><summary>Technical details: which meshes can block</summary>`.
- Generated source: none.

### 22. api/materials: internal benchmarks and time words reach the page (medium, internal-note)
- Anchor: "### Moment transparency" (lines 682, 693); "### Alpha to coverage" (line 602); "### Mirrors, polished floors and water" (line 853).
- Claim: Line 682 says "on both test scenes" without naming them, and the rules ask for the benchmark's name. Line 693 says "A page without the setting draws exactly as it does today". Line 602 ends "as it did before". Line 853 says "in this version". These words describe change over time, not the current state.
- Evidence: docs/api/materials.md:602, 682, 693, 853; AGENTS.md "Name the engine's benchmarks when you cite a figure", "states what holds now".
- Proposed edit: 682: name the scenes, or write "in the engine's moment-transparency image tests (moment-layer and moment-spread-layer)". 693: "A page without the setting draws blended surfaces with the sort." 602: "... and it casts its mesh's whole shape." 853: "Standard materials take no reflection pass."
- Generated source: none.

### 23. api/materials: "standard, basic and sprite materials": the engine has no basic material (low, unclear)
- Anchor: "### Moment transparency", first bullet (line 690).
- Claim: The factories are standard, unlit, shader, shadowCatcher and decal. "Basic" is the three.js name for unlit, so the reader cannot match the term to the API.
- Evidence: docs/api/materials.md:36-42, 690; docs/data/threejs-mapping.json, which feeds docs/porting/threejs-mapping.md:151 and uses the same wording.
- Proposed edit: "The setting covers standard and unlit materials, and sprite batches, whose blending is normal or weighted." Make the same change in the mapping notes.
- Generated source: docs/data/threejs-mapping.json for the porting page.

### 24. api/impostors: long paragraphs (medium, long-paragraph)
- Anchor: lines 17, 31, 72, 78, 100, 104, 120, 128, 153, 166, 229 and 245 (line numbers from stats.json; the file lines are 24, 38, 79, 85, 107, 111, 127, 135, 159, 173, 236 and 252).
- Claim: 12 paragraphs are over the limit. The longest are 24 (158 words: what an impostor is), 79 (174 words: shadows) and 38 (128 words: how a card faces the eye, culling and `levels: false`).
- Evidence: stats.json api/impostors longParagraphs.
- Proposed edit: Split 24 into "what an impostor is" and "how a card lights". Move into `<details>` blocks: the face-culling reason and `levels: false` (38), the shadow detail (79), the octahedral fold (85), and the dither phases (236-238). Make 252 a list.
- Generated source: none.

### 25. api/materials: long paragraphs (medium, long-paragraph)
- Anchor: stats.json lines 107, 167, 191, 210, 243, 287, 299, 339, 411, 455, 457, 459, 496, 509, 513, 519, 561, 576, 578, 593, 621, 671, 675, 722, 813, 840, 846, 848, 852 (29 paragraphs).
- Claim: The longest are 526 (setUniform, 170 words), 847 (masked custom material shadows, 182 words), 346 (133 words), 516 (uvTransform with its formula, 146 words) and 558 (`toneMapped` in a table cell). Most of the "Cost of ..." paragraphs are dense implementer detail.
- Evidence: stats.json api/materials.
- Proposed edit: Put each "### Cost of ..." section's body in a `<details><summary>Technical details: cost of ...</summary>` block, and keep one sentence in the main text ("Nothing of it runs until the first such material. List `'x'` in `preload` to load it before the first frame."). Split 526 into "set at setup" and "setUniform in a frame". Move the uvTransform formula and the 847 caster rules into details blocks.
- Generated source: none.

### 26. api/quality: long paragraphs, and a few sentences that are hard to follow (medium, long-paragraph)
- Anchor: file lines 67, 71, 75, 87, 102, 163, 177, 190 (stats.json lines 54, 60, 64, 68, 80, 95, 156, 170, 183).
- Claim: Line 71 (121 words) packs the rules of `quality.set` together with the render-scale cap in the lowest tier ("a `minRenderScale` above the tier's cap of the scale raises the cap to it instead. Only a `maxRenderScale` that the sketch set itself throws"). Line 75 mixes `setPreset` with the preset check ("The preset check is different: ..."). Line 102 (140 words) lists every governor step in running text.
- Evidence: stats.json api/quality; docs/api/quality.md:71, 75, 102.
- Proposed edit: Make the `quality.set` rules a list. Move the lowest-tier interaction into `<details><summary>Technical details: render scale limits in the lowest tier</summary>`. Turn the governor's order at 102 into a numbered list, or link to the concept page's order and keep one sentence here.
- Generated source: none.

### 27. api/input: the pointer and drag paragraph is hard to follow (low, long-paragraph)
- Anchor: "## The pointer", file line 85 (108 words); also lines 21, 91, 110, 172.
- Claim: Line 85 explains how presses and wheel scroll are held for the next frame in a slow frame. It is correct but dense, and most readers need only "use `dragDx`". Line 21 says "input works the same in every thread mode" with no link to where thread modes are explained.
- Evidence: stats.json api/input; docs/api/input.md:21, 85; docs/concepts/architecture.md#where-the-sketch-runs.
- Proposed edit: Keep line 83's advice in the main text. Move line 85 into `<details><summary>Technical details: drags and scroll in a slow frame</summary>`. On line 21, link "every thread mode" to [Where the sketch runs](../concepts/architecture.md#where-the-sketch-runs).
- Generated source: none.

### 28. api/post: the grading controls paragraph repeats itself and uses "job worker" without explaining it (low, duplication)
- Anchor: "### Grading controls" (lines 332-336) and its last bullet (line 371).
- Claim: The sentence "The frame that lands a bake uploads the table, 256 KB" appears at 335-336 and again at 371. "A job worker bakes them" uses a term that the page does not explain. Lines 332-336 are hard-wrapped mid-sentence, unlike the rest of the page.
- Evidence: docs/api/post.md:332-336, 371.
- Proposed edit: Rewrite 332-336 as one unwrapped paragraph: "The grading controls set a look from a few numbers, without a table file. One of the engine's background workers bakes them into a table, so a change never stalls a frame. The new grade shows within a few frames." Keep the 256 KB figure and the no-worker case in the bullet at 371 only, inside `<details>`.
- Generated source: none.

### 29. api/objects: the paragraph on destroyed objects is hard to follow (low, unclear)
- Anchor: "## Visibility, kind and removal", line 99.
- Claim: "A model's copy also keeps `find` and `setOutlined`, which skip its destroyed parts. So does a call that gets a destroyed object, such as `setParent`." The first "So does" seems to mean that passing a destroyed object also throws E1101, but it reads as "also keeps working".
- Evidence: docs/api/objects.md:99.
- Proposed edit: "In development builds, every call on a destroyed object throws E1101, except `describe` and `off`. A model's copy also allows `find` and `setOutlined`, which skip its destroyed parts. Passing a destroyed object to a call, such as `setParent(destroyed)`, throws E1101 too. Once the frame removes the object, its world getters throw E1101 in every build. In a release build, other calls on a destroyed object do nothing." Link E1101.
- Generated source: none.

### 30. api/post: the still-view section leaves out sharpening (low, contradiction)
- Anchor: "## Still views" (line 466) against "## Sharpening" (line 414).
- Claim: Line 466 says "Bloom, outlines and automatic exposure keep a view drawing every frame". Line 414 says sharpening also keeps a still view drawing.
- Evidence: docs/api/post.md:414, 466.
- Proposed edit: "Bloom, outlines, automatic exposure and sharpening keep a view drawing every frame."
- Generated source: none.

## Further findings (not verified)

### 31. api/lights: long and dense paragraphs (not verified; medium, long-paragraph)
Stats lines 43, 91, 114, 131, 161, 189, 217, 245. Also the spot-light map bullets (file lines 80-82), with the 0.2 MB / 2.8 MB / 11 MB memory figures and "room for four pictures", and the rectangle-light picture bullet (158). Move the memory figures and the "pictures share a table" fact into `<details><summary>Technical details: memory of light pictures</summary>`. Explain "keeps room for four pictures" (the table grows in steps of four?) or cut it.

### 32. api/lights: the banner repeats the four-directional-lights rule (not verified; low, duplication)
Line 11 adds "Surfaces show up to four directional lights ..." to the banner, which "Which lights reach surfaces" (127) says again. Also "each throws E1112" (80) has no link. Keep the banner to its release sentence, and link E1112.

### 33. api/lines: long paragraphs and browser-internals detail (not verified; low, long-paragraph)
Stats lines 16, 99, 110, 116, 146. File line 106 explains how the browser boxes numbers ("The browser boxes each number of it where the same call has seen objects of a few shapes") and says "A change of the dashes alone converts nothing", which is unclear. Move both into a `<details>` block. Line 117 (8-bit sRGB colors, range 0 to 1) differs from points (0 to 1,024): add a sentence that says lines clip at 1 and points do not.

### 34. api/lines: the example builds color arrays from integer literals (not verified; low, unclear)
`color.fromHex([0, 0, 0], ...)` and `(red[k] ?? 0)` go against the math page's advice to make arrays with `vec3.create()`. Use `vec3.create()` and plain indexing.

### 35. api/points: culling is described two ways (not verified; low, contradiction)
Line 23 says points cull "as it does for sprites". Line 124 says they "share the culling, sorting and drawing of instance batches". Say once that sprites, points and lines all pack into instance-row data and share one culling path.

### 36. api/points: long paragraphs (not verified; low, long-paragraph)
Stats lines 14, 52, 87, 113. Split line 21 (what a point cloud is, how it draws, when it leaves view, the row arrays).

### 37. api/particles: "a page that drives a particle buffer itself" (not verified; low, unclear)
Line 145 says "page", but this is sketch code that drives the buffer (concepts/particle-buffer). Line 23 says "The sketch starts the frame and reads settings", which is unclear. Line 193 (re-basing birth times every 1,024 seconds) should go in a `<details>` block.

### 38. api/particles: long paragraphs (not verified; low, long-paragraph)
Stats lines 16, 54, 136, 138, 170, 174, 186. Move the wind-field internals (143-145) and the time re-basing (193) into `<details>` blocks.

### 39. api/post: long paragraphs (not verified; low, long-paragraph)
Stats lines 34, 47, 325, 387. Line 54 (16-bit float scene color, exposure folded into lights) and line 394 (vignette without HDR, multisample resolve) are implementer detail for `<details>` blocks.

### 40. api/post: terms used without explanation (not verified; low, term-before-definition)
"the 8-bit path" (217), "compatibility mode with MSAA" (111, 143, 261), "HDR target" and "float target". Link the first use of each to color-management.md#the-8-bit-path and backends.md.

### 41. api/objects: browser-inlining detail in the `setPose` bullet (not verified; low, technical-details-block)
Line 48: "A number passed to a call that the browser does not inline becomes an object of its own." Move this into a `<details>` block and keep "Use `setPose` with the arrays that hold a pose, for code that moves many objects every frame."

### 42. api/objects: error codes are not linked (not verified; low, unclear)
E1203, E1104, E1101, E1207, E1108 and E1218 appear without links, while E1205 is linked. Link each one.

### 43. api/objects: "take effect in the next frame" (not verified; low, contradiction)
Line 109 says the mesh calls take effect "in the next frame". Line 97 and scene.md say they apply after `onUpdate` returns and show in the frame drawn after the call. Use the scene page's wording.

### 44. api/math: an unnamed exact-math library (not verified; low, missing-prerequisite)
The example imports `@clockwork2/engine/dmath` with only the comment "an exact math library". The guide explains it. Add "such as clockwork2's `dmath`; see [the deterministic simulation guide](../guides/deterministic-simulation.md)" and say that any library with exact `sin`, `cos`, `acos` and `exp` works.

### 45. api/math: long paragraph on the maths entry (not verified; low, long-paragraph)
Line 125 (91 words): make the eight left-out helpers a list.

### 46. api/input: the diagram says "shared memory" (not verified; low, wrong-claim)
On a page without cross-origin isolation, the single-threaded build has no shared memory, but the diagram's ring is "in shared memory". Write "Input ring in engine memory".

### 47. api/input: dropped events during a long setup (not verified; low, missing-content)
packages/engine/src/page/input-ring.ts:21-30: while half the ring waits, the page leaves out pointer moves and wheel events. The page says the sketch takes "every event". Add one sentence about busy frames, inside a details block.

### 48. api/page: "held frame" and "hold mode" used without explanation (not verified; low, term-before-definition)
"## Hold mode" assumes the reader knows what hold mode is. Add one sentence: "Hold mode draws a fixed frame for tests and screenshots."

### 49. api/impostors: the octahedral corner wording (not verified; low, unclear)
Line 85: "The back pole ... lands on the corner at the bottom right." The TSDoc says the code (1, 1). Line 83 says cells count from the top left, but texture rows run from the bottom up. Give the code pair and say which texture corner that is.

### 50. api/impostors: `EDGE_BAND` named as a constant (not verified; low, unclear)
Line 236 names an exported constant in prose. Write "the last 8 per cent of that range (the `EDGE_BAND` export)".

### 51. api/quality: switch table detail (not verified; low, technical-details-block)
The `?tier=lowest` row (54) holds four effects of the tier. Link to the concept page and keep one clause.

### 52. api/materials: the `emissive` range says "An sRGB color" (not verified; low, contradiction)
The Standard values table gives `emissive` as "An sRGB color", while `color` is "A [color](#color)". Line 520 says that `emissive` also takes linear components. Use "A [color](#color)".

## Screenshots, demo links and concepts with no demo

Reference images are in tests/image/references/chrome-real-gpu/<tier>/. Test pages are in tests/image/manifest.ts.

### api/impostors
Screenshots:
- impostors-forest-three-ways (reference: webgpu/demo-impostors.png). Shows the demo's default view: near meshes, merged middle cells and far cards. Place it under the opening paragraph.
- impostors-cards-off (scripted: impostors demo, press L once, same camera pose). Every tree drawn as a mesh, for comparison. Place it beside the first picture, under "Hand the near meshes over to the cards".
- impostor-atlas-pair (scripted: write `bakeImpostorAtlas` output from examples/impostors/forest.ts to PNG). The color atlas and the surface atlas side by side, with the cell grid drawn over them. Place it under "The atlas and its cells".
- impostor-handover (scripted: test page impostor-handover; webgpu/impostor-handover.png exists). Cards and meshes at the hand-over band. Place it under "Hand the near meshes over to the cards".
- impostor-shadow (scripted: test page impostor-shadow; webgpu/impostor-shadow.png exists). Cards with crown-shaped shadows from a caster-only batch. Place it under the shadows text.
Demo links: impostors/ (intro and "Create the cards"); forest/ (cut-out cards on phones, under "Hand the near meshes over to the cards").
No demo: loadImpostorAtlas with a CLI bake; card shadows (test page only); encodeImpostorSurface.

### api/input
Screenshots:
- input-robot (reference: webgpu/demo-input.png). The robot that the action map moves. Under the first example.
- picking-hover (scripted: picking demo, pointer at the centre of one piece, one frame). The lit piece under the pointer and the outlined selection. Under "Pointer events on objects".
Demo links: input/ (Actions, Gamepads); picking/ (Pointer events on objects); walk-and-fly/ (pointer lock); gizmos/ (drags that handlers take first); replay/ (Input off: the page records input, and the engine takes none).
No demo: multi-touch `input.touches`; trackpad pinch; gamepad dead zone.

### api/lights
Screenshots:
- lights-kinds (scripted: test pages lights-spot, lights-rect, lights-tube, lights-hemisphere; references exist in webgpu/). The kinds of light side by side. Under "Kinds of light".
- area-lights-street (reference: webgpu/demo-area-lights.png). Rectangle and tube lights on a wet street. Under "Area lights".
- spot-cookies (reference: webgpu/demo-spot-cookies.png). Spot light pictures. Under "Spot light maps".
- real-units (scripted: test page real-units; webgpu/real-units.png). Sun in lux and bulb in lumens. Under "Color, intensity and units".
- hero-shadow (reference: webgpu/demo-hero-shadow.png). Under the hero shadow text.
- contact-shadows-on-off (scripted: contact-shadows and contact-shadows-off test pages). Side by side. Under the contact shadows paragraph.
Demo links: area-lights/, spot-cookies/, hero-shadow/, contact-shadows/, time-of-day/ (Light from the sky), wet-street/.
No demo: hemisphere lights alone; intensityUnit lumen on a spot light; point light shadows on High.

### api/lines
Screenshots:
- sprites-lines (reference: webgpu/demo-sprites-lines.png). The neon helix and the dashed rim. Under the intro.
- lines-lit-vs-unlit (scripted: test pages lines and lines-lit; references exist). Under "Lit lines".
- lines-widths (scripted: one batch in pixels and one in world units, camera pulled back). Under "Widths in pixels and in the world".
Demo links: sprites-lines/ (intro, Dashes, Lit lines).
No demo: debug lines; segment raycast with `lineThreshold`; `setActiveCount` growing a trail.

### api/materials
Screenshots:
- standard-grid (scripted: test page standard-grid; webgpu/standard-grid.png). Metalness against roughness. Under "Standard values".
- coat-and-sheen (reference: webgpu/demo-coat-and-sheen.png). Under "Clear coat and sheen".
- iridescence-and-anisotropy (reference: webgpu/demo-iridescence-and-anisotropy.png). Under "Iridescence and anisotropy".
- translucency (reference: webgpu/demo-translucency.png). Under "Light through thin surfaces".
- subsurface-on-off (scripted: subsurface and subsurface-off test pages). Under "Light under the surface".
- transmission-glass (scripted: gltf-transmission-mask or a test page with the three glass balls from the example). Under "Transmission".
- decals (reference: webgpu/demo-decals.png). Under "Decals".
- relief (reference: webgpu/demo-relief.png); relief-heights against relief-heights-no-parallax (scripted, references exist). Under "Relief".
- alpha-modes (scripted: alpha-mask, alpha-hash, alpha-coverage, blending test pages side by side). Under "Alpha modes".
- weighted-vs-moments (scripted: moment-weighted, moment-layer, moment-sorted test pages). Under "Weighted blending" and "Moment transparency".
- shader-inputs (reference: webgpu/demo-shader-inputs.png). Under "Custom materials".
Demo links: coat-and-sheen/, iridescence-and-anisotropy/, translucency/, subsurface/, decals/, relief/, weighted-transparency/, shader-inputs/, water/ (The scene behind a surface), reflection-probes/ (Mirrors, polished floors and water), extra-shapes/ (dispersion glass), depth-only/ (Invisible surfaces that hide), vegetation-wind/ (Values per row of a batch).
No demo: shadow catchers; light maps and directional light maps; wireframe; depth bias; forceSinglePass.

### api/math
Screenshots:
- math-drones (reference: webgpu/demo-math.png). The drone swarm. Under the chase example.
Demo links: math/ (already linked); replay/ (The maths entry, for a deterministic simulation).
No demo: color helpers into row colors (test page row-colors exists); seeded random.

### api/objects
Screenshots:
- objects-turntable (reference: webgpu/demo-objects.png). Under "Parents".
- objects-one-material (reference: webgpu/demo-objects-one-material.png). Under "Mesh calls", for `setMaterial`.
- layers (reference: webgpu/demo-layers.png). Under "Layers".
Demo links: objects/ (already linked); layers/ (Layers); picking/ (Pointer events); forest/ (setLevelBias, its hero fir); post-effects/ (setOutlined).
No demo: setOccluder; setDrawRange alone; parent loops.

### api/page
Screenshots:
- showroom-tablet (reference: webgpu/demo-showroom.png). The tablet whose taps the page sends to the sketch. Under the color-picker example.
- devtools-messages (manual: browser's developer tools, Console, with the sketch's `page.post` logged by the page's handler). Under "When messages arrive".
Demo links: showroom/ (Example: a color picker on the page); css3d-labels/ (page and sketch together); hold-mode/ (Hold mode).
No demo: the `transfer` list; messages on the page's thread.

### api/particles
Screenshots:
- campfire (reference: webgpu/demo-particles.png). Under the intro.
- rain (reference: webgpu/demo-rain.png). Under "facing: velocity" in "Look" (note: the rain demo uses a vertex-count draw, not this package; say so).
- particles-wind (scripted: test page particles-wind; webgpu/particles-wind.png). Under "Wind".
- soft-particles-on-off (scripted: particles demo with `softness` 0 and the default, close to the ground). Under "Soft particles".
Demo links: particles/ (intro, Look, sub-emitters for embers if used); vegetation-wind/ (Wind field shared with plants).
No demo: sub-emitters (fireworks); follow trails; ground bounce.

### api/points
Screenshots:
- galaxy (reference: webgpu/demo-galaxy.png). Under "Create a batch".
- points (scripted: test page points; webgpu/points.png). Size attenuation on and off. Under "Sizes in the world and on the screen".
Demo links: galaxy/ (already linked).
No demo: masked round points; weighted blending of points; pointThreshold picking.

### api/post
Screenshots:
- tone-curves (scripted: tone-agx-punchy, tone-agx, tone-neutral, tone-aces test pages side by side; references exist). Under "Tone mapping and exposure".
- auto-exposure (reference: webgpu/demo-auto-exposure.png); exposure-off against exposure-center (scripted). Under "Automatic exposure".
- bloom-strengths (scripted: bloom-off, bloom-soft, bloom-strong). Under "Bloom".
- ao-on-off (scripted: ao-off and ao-default). Under "Ambient occlusion".
- ssr-wet (scripted: ssr-off and ssr-wet). Under "Screen-space reflections".
- camera-lens (reference: webgpu/demo-camera-lens.png). Under "Depth of field".
- outline (scripted: outline-plain and outline-hidden). Under "Outlines".
- grades (scripted: post-effects demo at the three grade steps, none, warm, cool, one frame each). Under "Grading controls".
- lens-vignette and sharpen (scripted: lens-vignette, sharpen test pages). Under "Vignette" and "Sharpening".
- quality-presets-post (scripted: one scene on Low, Medium, High and Ultra, side by side, to show which effects each preset draws). Under the intro, or on the concept page.
Demo links: post-effects/, camera-lens/ (already linked); auto-exposure/ (Automatic exposure); tone-mapped/ (Tone mapping and exposure); wet-street/ (Screen-space reflections); picking/ (Outlines); light-shafts/ (Custom effects, if it uses them).
No demo: custom tone curve; `ev100` real units alone (test page real-units); still-view accumulation.

### api/quality
Screenshots:
- presets-side-by-side (scripted: one demo, such as creek, held at one pose on Low, Medium, High and Ultra with `?preset=`). Under "Quality API" intro.
- render-scale (scripted: render-scale-50 test page against full scale). Under "Render scale".
- debug-overlay-governor (scripted: debug overlay open with the governor's steps and render scale shown). Under "The frame-budget governor".
- devtools-performance (manual: browser developer tools Performance panel during a governor step). Under "Budgets for the sketch's own systems".
Demo links: island/ or creek/ (preset menu, if the demo has one); instances/ (counts that drop on phones).
No demo: setBudget; texture memory budget; setPreset menu.
