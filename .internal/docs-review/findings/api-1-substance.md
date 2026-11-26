# Docs review, slice api-1: sense and substance

Pages: api/animation, api/assets, api/cameras, api/controls, api/debug, api/engine, api/feature-draws, api/feature-effects, api/feature-instances, api/features, api/geometry, api/grass.

Paths: pages are `docs/api/<page>.md` in the generated copy. Source paths are relative to the repository root. All 12 pages are written by hand, so a finding names a generated source only where a tool forces the text.

Findings 1 to 30 were checked against the source. Findings 31 and later are marked "not verified".

## Findings, ranked

### 1. features: the fields table says the engine calls callbacks that it never calls (high, contradiction)

- Anchor: "## The fields", the rows `ready`, `resize`, `reset` and `destroy` (lines 81, 87, 88, 89). Also "## Callbacks" line 267.
- Claim: The table says `resize` is "Called with the render size in device pixels when it changes", `reset` is "Called with 'resize', 'camera' or 'exposure'", and `destroy` is "Called once when the feature is removed or the engine stops". The same page then says that nothing in the engine calls `resize` or `reset` (line 279), and that the registry does not call `destroy` (line 271). Line 81 and line 267 say `ready: false` means "no cost at all", with no code or shader download. Line 278 says the draw, compute and sky-layer adapters never ask `ready`. An add-on author who reads the table writes callbacks that never run.
- Evidence: docs/api/features.md:81, 87-89, 267, 271, 278-280. packages/engine/src/scene/features.ts:903 and :962 only check and copy `resize`. No other code calls it (grep for `.resize(` and `.reset(` in scene/ and render/ finds only `this.renderer.resize` in render/loop.ts:417).
- Proposed edit: Make the table say who calls each callback, in the same words as the "Who calls it" table. For example: `resize`: "Kept on the description for the add-on's own use. The engine does not call it." `destroy`: "Called by the full-screen adapter's handle when you destroy it. Otherwise the add-on calls it." `ready`: "Asked by the full-screen adapter and the instance adapter. The draw, compute and sky-layer adapters do not ask it." Remove "no cost at all" from line 81 and line 267, or limit it to the two adapters that ask. Then delete the duplicate "Who calls it" table, or keep only that table and point the fields table to it.

### 2. features: outputs, lighting slots and the normals resource are described as working, then as inert (high, contradiction)

- Anchor: "## The fields" rows `outputs` and `provides` (lines 77-78); "## Scene resources" (lines 124, 131, 133); "## Published outputs" (line 145); "## Lighting slots" (line 149).
- Claim: The fields table says an output is "the textures that the feature publishes to materials, effects and passes". Line 145 says "No adapter binds a registered output to a texture". Line 149 says "No part of the engine reads a slot's provider". Line 124 says no pass makes normals. A reader learns three features that do nothing only after the table told them they work. Lines 11, 131 and 133 add "work today", "today" and "now", which read as a promise of later work.
- Evidence: docs/api/features.md:11, 77-78, 124, 131, 133, 145, 149. AGENTS.md "Writing docs": "A page describes what exists now ... It makes no promise of a later feature."
- Proposed edit: In the fields table, say what each field does now: `outputs`: "Names and neutral defaults that the registry keeps unique. No adapter binds them; a compute pass publishes its own texture." `provides`: "Slots that the registry keeps to one owner. The engine reads no provider." Drop "today" and "now" in lines 11, 131 and 133. Line 11 then ends: "A registration checks the shape, and the adapters place the work of each kind."

### 3. engine: the page says the engine never picks a path from GPU or browser names, then describes a path picked that way (medium, contradiction)

- Anchor: "## The start", line 36, first sentence; "## What the engine reports", line 155 (`directDraws`, `drawPath`).
- Claim: Line 36 says createEngine picks "the build and the GPU path from those tests, never from browser or GPU names". Line 155 says the direct draw path is measured only "on an Apple GPU in Safari, or in any browser on iPhone and iPad", and gives the reason `not-apple-gpu-in-webkit`. The probe runs only after a check of the adapter's names and the user agent. Line 155 also uses "draws buckets directly" with no explanation of a bucket.
- Evidence: docs/api/engine.md:36, 155. packages/engine/src/gpu/webgpu/draw-path-probe.ts:7-9 ("The cost belongs to one combination, an Apple GPU in Apple's WebKit, so the probe runs only there") and :95 (`if (!appleGpuInWebKit(info, userAgent)) return 'not-apple-gpu-in-webkit'`).
- Proposed edit: Line 36: "createEngine tests what the browser offers, and picks the build and the GPU tier from those tests. One measurement, the draw path on WebGPU, runs only on an Apple GPU in WebKit, where its cost is known." Line 155: replace "draws buckets directly" with "issues one draw call for each group of objects, instead of indirect draws that the GPU's culling fills".

### 4. all 12 pages: the note under each title names an internal "roadmap step" (medium, internal-note)

- Anchor: the blockquote under each title, for example "Roadmap step 0.2, first released in null3D 0.1.0."
- Claim: The roadmap's steps are the maintainers' build plan. No public page lists the roadmap, and every step ships in 0.1.0, so "step 0.2" tells a developer nothing. AGENTS.md forbids internal plans in docs/.
- Evidence: docs/api/animation.md:11, assets.md:11, cameras.md:11, controls.md:11, debug.md:11, engine.md:11, feature-draws.md:11, feature-effects.md:11, feature-instances.md:11, features.md:11, geometry.md:11, grass.md:11. The sentence is required by tools/lib/docs.ts:652-658 and built by tools/lib/steps.ts:25 (`shipsSentence`); the comment at tools/lib/steps.ts:1-3 cites a decision record.
- Proposed edit: Change `shipsSentence` to give "First released in null3D 0.1.0." for the steps 0.1, 0.2 and 0.3, and update the pages and `docs.test.ts` with it. Remove the step column wording from docs/index.md and docs/pages.md in the same change.

### 5. controls, debug, geometry, engine: repository test files, maintainer commands and the dev server reach user docs (medium, internal-note)

- Anchor: controls "## Each frame" line 106; debug "### Cost" line 335; geometry "## Vertices that change" line 204; engine "## The start" table row E1402, line 70.
- Claim: `tests/image/controls.spec.ts` and `bun run bench:allocation --calls` exist only in the engine's own repository. A developer who installs the packages cannot run them. Engine line 70 says "On null3D's own dev server, they also check that the core was built from the checkout's Rust sources", which is a maintainer note.
- Evidence: docs/api/controls.md:106; docs/api/debug.md:335; docs/api/geometry.md:204; docs/api/engine.md:70.
- Proposed edit: Keep the fact and drop the process: "`update` allocates nothing, so a call in every frame makes no garbage." Delete the test and bench names. In the E1402 row, delete the last sentence.

### 6. feature-draws: the page says splat scenes need another hook, but the splats add-on uses this one (medium, contradiction)

- Anchor: "## Limits", third bullet (line 151).
- Claim: "A compact buffer of many copies that a shader expands, as a large splat scene needs, is not this hook: compute instances draw ...". The engine's own splats add-on draws with `scene.addFeatureInstances`, the "Many copies of one shape" call on this page. It also passes `sceneInputs: ['sceneDepth']`, an option that the page does not list.
- Evidence: docs/api/feature-draws.md:151; packages/splats/src/system.ts:242-257.
- Proposed edit: Drop "as a large splat scene needs". Name a case that really needs compute instances: "A set whose live count a compute pass writes on the GPU, such as grass that the GPU culls, needs compute instances." Add one line under "## The payload" for `sceneInputs`, with a link to the materials page section on the scene behind a surface.

### 7. feature-draws: the "A point cloud" example draws one quad (medium, unclear)

- Anchor: "## A point cloud" (lines 28-72).
- Claim: The heading and the diagram promise a point cloud. The code makes one four-vertex quad and one draw. The reader must wait for "## Many copies of one shape" to learn how many points draw. The test page that the example comes from draws two clouds of points.
- Evidence: docs/api/feature-draws.md:28, 58-68; tests/pages/sketches/feature-draw-sketch.ts:1-5.
- Proposed edit: Rename the heading to "One soft disc" and say in one sentence that "Many copies of one shape" turns it into a cloud. Or make the example call `addFeatureInstances` with the same shader.

### 8. feature-instances: the main example uses names it never defines (medium, unclear)

- Anchor: "## A draw of quads", line 78; "## The buffers", line 118.
- Claim: `draw.setInstances(rows, liveCount)` runs at the end of the setup, but `rows` and `liveCount` do not exist. The comment above it says only a page without compute fills the rows, yet the call has no check. The compute example uses `fill`, which is never shown. A newcomer cannot run either snippet.
- Evidence: docs/api/feature-instances.md:76-78, 115-121.
- Proposed edit: Define the rows in the example (for example a `Float32Array(16 * 100)` that fills 100 identity rows with offsets) and put the call behind `if (engine.capabilities.tier === 'webgl2')`. In "## The buffers", show the 10 lines of `fill` WGSL that write the count and one row, or link to a demo that has one (the grass add-on in packages/grass/src/grass.ts:412).

### 9. feature-instances, features: "the page gives" the count on WebGL2, but the sketch does (medium, wrong-claim)

- Anchor: feature-instances intro line 26 ("On WebGL2 the page gives it") and line 77 comment; features "## Adapters" line 287 ("from the page on WebGL2").
- Claim: In null3D, "page" means the page's thread that calls createEngine. The count comes from `draw.setCount` and `draw.setInstances`, which the sketch calls. A reader looks for a page-side call that does not exist.
- Evidence: docs/api/feature-instances.md:26, 77, 133-134; docs/api/features.md:287; packages/engine/src/scene/feature-instances.ts:169 (`setInstances` on the draw that the sketch holds).
- Proposed edit: Replace "the page gives it" with "the sketch gives it with `draw.setCount`" in all three places.

### 10. assets: the material row of the glTF table is a 450-word wall with internal texture-slot detail (medium, technical-details-block)

- Anchor: "## glTF models", the table row "A material" (line 89).
- Claim: One table cell lists every material extension, then texture-array slot rules: "each transmission or thickness texture keeps a row slot of its own and samples a specular slot's texture array", "A thickness texture stays out beside a specular color texture, whose sRGB texels never share its array". These terms are not explained on the page. The row cannot be read on a phone.
- Evidence: docs/api/assets.md:89.
- Proposed edit: Keep a short row: "`materials.standard`, or `materials.unlit` with `KHR_materials_unlit`. Each KHR_materials extension sets the material values of the same name: see the list below." Under the table add a list of extension to values, one line each. Move the slot rules into a block after the list:

  ```
  <details>
  <summary>Technical details: which textures a layered material keeps</summary>

  (the sentences about row slots, specular slots, layer maps and the textures that the loader notes)

  </details>
  ```

### 11. animation: the paragraphs about boxed numbers are JavaScript engine internals in the main text (medium, technical-details-block)

- Anchor: "## Playing clips" line 101 ("The browser then makes a new 12-byte number for each fraction it reads"); "### Order and cost" lines 358-374.
- Claim: The rule a user needs is short: freeze repeated options, and keep fractions out of a large frame step. The text about inlining, 12-byte number objects and a helper function with a `Float64Array` is correct and useful to a tuner, but it interrupts the page.
- Evidence: docs/api/animation.md:101, 358-374.
- Proposed edit: Keep "Keep the options of the plays that a game repeats in frozen constants, so a clip switch allocates nothing" and the example. Move the rest of line 101 and lines 358-374 into one block at the end of "### Order and cost":

  ```
  <details>
  <summary>Technical details: why a fraction can allocate, and how to stop it</summary>

  (the inlining explanation, the 12-byte numbers, the aimCrowd example, and the note that 1 never boxes)

  </details>
  ```

### 12. animation: "Skinned meshes" mixes a past measurement with the current design, and leaves "skinning builds" unexplained (medium, unclear)

- Anchor: "## Skinned meshes", lines 420-422.
- Claim: Line 420 says the vertex shader skins on both paths, then "On the devices that the engine was measured on, this was as fast as skinning once per frame ... On WebGPU that was a compute pass". Line 422 then says WebGPU has a compute skinning pass. A reader cannot tell which meshes take which path until the second paragraph. "A custom material's skinning builds download" uses "builds" with no definition.
- Evidence: docs/api/animation.md:420-422.
- Proposed edit: Open with the rule: "The vertex shader of each pass skins a skinned mesh. On WebGPU, a compute pass skins two kinds of mesh once per frame instead: morphed meshes, and meshes that a debug view or a full shader draws." Give the measurement as a present fact with its benchmark name, or move it into a details block. Define builds: "the compiled variants of the material's shader that skin vertices".

### 13. animation: figures cite "the S5 benchmark" and "the engine's test page" without saying what they are (medium, term-before-definition)

- Anchor: "### Load cost" line 52; "### Limits of skinning" line 446.
- Claim: "S5 benchmark" appears with no explanation. The only public description is a row in the porting overview table. "On the engine's test page" does not say which test or machine. AGENTS.md asks docs to name the benchmark when they cite a figure.
- Evidence: docs/api/animation.md:52, 446; docs/porting/threejs-overview.md:36 ("S5: 500 animated characters with shadows").
- Proposed edit: Line 446: "In the S5 benchmark (500 animated knights with shadows, see [the porting overview](../porting/threejs-overview.md)), a knight takes ...". Line 52: name the machine and the measurement, or say "On a desktop with two job workers".

### 14. geometry: the levels-of-detail section holds planner internals that the concepts page already covers (medium, technical-details-block)

- Anchor: "## Levels of detail", lines 228, 238 and 240 (121, 226 and 182 words).
- Claim: The three paragraphs mix what a user does (leave `levels` out, or set it) with how the planner spreads work over frames, splits meshes over 65,535 vertices, sorts pieces of 32,768 triangles, and makes facing pieces. The facts are useful to an implementer, but a newcomer cannot find the rule. Most of line 240 repeats docs/concepts/lod.md "Pieces of a large level".
- Evidence: docs/api/geometry.md:228, 238, 240; stats.json (api/geometry long paragraphs at lines 221, 231, 233).
- Proposed edit: Keep three sentences: when a mesh plans levels, that the plan runs off the frame, and that the mesh draws its full shape until the levels arrive. Then:

  ```
  <details>
  <summary>Technical details: how the planner builds and splits levels</summary>

  (halving per level, the measured error, the fade above about 1.5 pixels, the 65,535-vertex parts, the timings, the 23 KB planner, the piece sorting)

  </details>
  ```

  Replace line 240 with one sentence and a link to concepts/lod.md#pieces-of-a-large-level.

### 15. geometry: the `targets` attribute is listed but never explained (medium, unclear)

- Anchor: "## Meshes from arrays", the `targets` row (line 112); also lines 119, 135, 221, 256.
- Claim: "the position that the vertex takes at a coarser level of detail, and that level's error, which a generated shape's material reads". The page does not say which material reads it, when a user would give it, or what "a generated shape" is. It appears in four more places as a rule without a purpose.
- Evidence: docs/api/geometry.md:112, 119, 135, 221, 256.
- Proposed edit: Add one sentence and a link where it is used, for example: "Use `targets` for a mesh whose custom material blends each vertex toward its coarser place as the camera backs away (see ...)." If no public material reads it, say so.

### 16. debug: the memory measurement and the "Memory by system" paragraphs are dense internals in the main text (medium, technical-details-block)

- Anchor: "### Memory figures", lines 310, 312 and 314; also "## Debug drawing" line 24 (the hold-mode extra frame).
- Claim: Line 310 (146 words) explains shared-memory double counting, worker measurement timing and job-loop exits. Line 312 lists internal tables such as "the frame builder's bucket-key scratch". Line 24 ends with a hold-mode detail that a user meets only in image tests. These are correct, but they bury the use of each figure.
- Evidence: docs/api/debug.md:24, 310, 312, 314.
- Proposed edit: Keep: "The whole page's figure comes from the browser and counts the engine's shared memory once per thread, so the overlay also gives it with the shared memory counted once." Move the rest into a block:

  ```
  <details>
  <summary>Technical details: how the page measures its memory, and the tables of Memory by system</summary>

  ...

  </details>
  ```

  Move the last sentence of line 24 into the same kind of block, or to the hold-mode section of the testing guide.

### 17. cameras: "Several cameras" says the canvas shows one camera at a time, four lines after views that show several (medium, contradiction)

- Anchor: "## Several cameras" (line 147).
- Claim: "The canvas shows the scene from one camera at a time." Line 143 and the Multiple views guide show `scene.createView` drawing several cameras into rectangles of one canvas.
- Evidence: docs/api/cameras.md:143, 147; examples/demos.ts entry `multiple-views` ("One scene drawn from two cameras in the same frame").
- Proposed edit: "The active camera fills the canvas. `scene.createView` draws more cameras into rectangles of it ([Multiple views](../guides/multiple-views.md)). Until you pick an active camera, ..."

### 18. grass: the example grows grass over nothing and ignores preset changes (medium, missing-content)

- Anchor: the first code block (lines 33-65).
- Claim: The example makes a height function but no ground mesh, so a newcomer sees blades over an empty background. Line 100 says "The ground's own color and the blades' root colors should meet", which needs a ground. The text also says to call `grass.fit(preset)` and `grass.setSwayDistance` when the preset changes, but the example does neither.
- Evidence: docs/api/grass.md:33-65, 69, 100. packages/grass/src/sway.ts:7-10 ("a governor step that lowers the preset shortens the distance").
- Proposed edit: Add a ground: `scene.createMesh({ mesh: geometry.fromArrays(...from height...), material: materials.standard({ color: '#4d6b2a' }) })`, or a plane with a comment. Add a `quality.onChange((q) => ...)` handler (packages/engine/src/sketch/quality.ts:287) that calls `grass.fit(preset)` and `grass.setSwayDistance(swayDistanceFor(preset))`.

### 19. grass: "near shadows" and "cached layer" are used and not explained (medium, term-before-definition)

- Anchor: "## Near shadows and the sway distance" (line 100); the summary in the front matter.
- Claim: The heading and the summary say "near shadows", but the section only says the grass casts and receives shadows on both paths. "A far cascade that only the grass reaches then keeps its cached layer" assumes the reader knows that far shadow cascades cache their layers and redraw only on change. The default of `swayDistance` (0, sway at every distance) is not given.
- Evidence: docs/api/grass.md:6, 98-100; packages/grass/src/grass.ts (`swayDistance` doc: "The default, 0, sways at every distance").
- Proposed edit: "Far shadow cascades keep their image until something in them moves. Swaying blades count as movement, so past `swayDistance` the blades stand still and those cascades stay cached ([Shadows](../concepts/shadows.md)). The default, 0, sways at every distance." Rename the heading to "Shadows and the sway distance", or explain "near".

### 20. engine: the opening paragraph of "The start" packs four topics into 158 words (medium, long-paragraph)

- Anchor: "## The start", line 36; also "## Memory" line 149.
- Claim: Line 36 covers the browser tests, the setup, `firstFrame` and its two rejections, and the preset check with its two options and the repeat-visit cache. A reader who wants to know when to hide the loading screen must parse all of it.
- Evidence: stats.json api/engine longParagraphs (line 29, 158 words, 10 sentences; line 142, 93 words).
- Proposed edit: Split into three paragraphs: what createEngine resolves on; `engine.firstFrame` and its rejections; the preset check and `presetChecked`. In line 149, split the memory figures into a short list.

### 21. assets: the handler example names its second argument `makers`, the text calls it `context` (low, unclear)

- Anchor: "## Extensions that add-ons read", the code block (line 138) and the table (lines 156-169).
- Claim: The example writes `load(data, makers)` and uses `makers.geometry`. The text and table say `context` and `context.geometry`. The type is `GltfExtensionContext`. A reader may think these are two things.
- Evidence: docs/api/assets.md:138-140, 156, 168-169; packages/engine/src/scene/assets.ts:170-176, 192-195.
- Proposed edit: Rename `makers` to `context` in the example.

### 22. assets: the page does not say that the add-on's registration replaces an earlier handler (low, missing-content)

- Anchor: "## Extensions that add-ons read", lines 147-154.
- Claim: Line 147 says "Two handlers cannot read one extension" and throws E1213. That holds for `assets.registerGltfExtension`. The module-level `registerGltfExtension` that lines 149-154 recommend for add-ons lets a later handler replace the earlier one, and does not throw. A reader takes the E1213 rule for both.
- Evidence: docs/api/assets.md:147-154; docs/api/reference/assets.md:335 ("A later handler for an extension replaces the earlier one ... Two add-ons that read one extension therefore give it to the one that loaded last"); packages/engine/src/scene/gltf-extensions.ts:61.
- Proposed edit: After line 147 add: "The engine's own `registerGltfExtension`, which an add-on calls as its module loads, replaces an earlier handler for the same extension instead, so a development reload works. Two add-ons that read one extension give it to the one that loaded last."

### 23. assets: "Three calls answer at once" does not say which three (low, unclear)

- Anchor: "## glTF models", line 81.
- Claim: The reader must guess the three calls from the next two sentences. "Answer at once" is also unclear for `cache`, whose reads still wait.
- Evidence: docs/api/assets.md:81.
- Proposed edit: "Three calls return at once, before that code arrives: `registerGltfExtension` and `onProgress` return their remove functions, and `cache` returns its namespace, whose reads and writes wait for the code."

### 24. animation: the errors table omits that the setWeight check runs in development builds only (low, wrong-claim)

- Anchor: "## Errors", the E1218 row (line 484).
- Claim: The row lists "`setWeight` on a clip that does not play" as an E1218 cause with no build qualifier. Line 203 says correctly that only development builds throw. In production the call does nothing.
- Evidence: docs/api/animation.md:203, 484; packages/engine/src/scene/animation.ts:696-699 (`if (DEV && set === 0) refuse(...)`).
- Proposed edit: In the row, write "`setWeight` on a clip that does not play (development builds)".

### 25. feature-instances: the same facts appear twice, and the page has no "Related pages" or "API reference" heading (low, duplication)

- Anchor: "## The buffers" line 112 and "## Limits" line 147 (two buffers double the memory); "## The count ..." line 139 and "## Limits" line 148 (shadow views draw the count word); line 154 (the API reference link sits under Limits).
- Claim: Two pairs of bullets say the same thing. Every other page in the slice ends with "## Related pages" and "## API reference"; this page has neither heading, so the link reads as a limit.
- Evidence: docs/api/feature-instances.md:112, 139, 147, 148, 154; stats.json api/feature-instances headings.
- Proposed edit: Delete the Limits bullets at lines 147 and 148, or the earlier sentences. Add "## Related pages" (feature descriptions, feature draws, render compute passes, the grass page as a real user) and an "## API reference" heading over line 154.

### 26. feature-instances: "A device that draws the scene directly" is not explained (low, term-before-definition)

- Anchor: "## Limits", line 151.
- Claim: The reader does not know which devices draw directly, or how to tell. The engine page calls this `engine.capabilities.directDraws`.
- Evidence: docs/api/feature-instances.md:151; docs/api/engine.md:155.
- Proposed edit: "A device whose `engine.capabilities.directDraws` is true ([Page API](engine.md#what-the-engine-reports)) fixes ..."

### 27. debug: the inspector is said to sit over the canvas, and "the MCP server" is not explained (low, unclear)

- Anchor: "## The in-page inspector", line 446.
- Claim: The page says `?inspect` "opens a panel over the canvas". The inspector's code docks the panel at the left edge of the page. "for the MCP server" names a tool with no explanation or link.
- Evidence: docs/api/debug.md:446; packages/engine/src/debug/inspector.ts:1 ("a panel docked at the left edge of the page"); docs/guides/debugging.md:176 ("## The MCP server").
- Proposed edit: "`?inspect` docks a panel at the left edge of the page ...", and link "the MCP server" to ../guides/debugging.md#the-mcp-server with a five-word gloss, such as "which lets an AI agent read the scene".

### 28. debug: "Four calls show the overlay", but one of the four is an address switch (low, unclear)

- Anchor: "## Stats overlay and frame figures", lines 188-193.
- Claim: The list holds `createEngine({ stats })`, `engine.stats`, the `?stats` switch and `debug.stats`. The switch is not a call. The text after the table then says "Each call also takes options in place of true", which does not apply to the switch.
- Evidence: docs/api/debug.md:188-195.
- Proposed edit: "Four ways show the overlay:" and "Each call also takes options in place of `true`; the switch takes `collapsed` and `open` instead."

### 29. controls: first-person controls limit the vertical look with two sets of options and do not say why (low, unclear)

- Anchor: "## First-person controls" line 199; "## Pointer lock" line 221.
- Claim: A drag tips the view at most 85 degrees and takes `constrainVertical`, `verticalMin` and `verticalMax`. The pointer lock takes `minPolarAngle` and `maxPolarAngle`. The page does not say that the two sets come from three.js's FirstPersonControls and PointerLockControls, or which one wins.
- Evidence: docs/api/controls.md:199, 221.
- Proposed edit: Add one sentence: "The drag limits follow three.js's FirstPersonControls, and the pointer-lock limits follow its PointerLockControls. Each applies only to its own input."

### 30. engine: "1024 MiB holds about 5 million rows with the rest of the scene" leaves no room for the rest (low, wrong-claim)

- Anchor: "## Memory", line 149.
- Claim: 5,000,000 rows at about 210 bytes take about 1,001 MiB, which leaves about 23 MiB of 1024 MiB for every other table, mesh copy and animation. "With the rest of the scene" overstates it.
- Evidence: docs/api/engine.md:149 (arithmetic from the page's own figures).
- Proposed edit: "so instance rows alone fill 1024 MiB at about 5 million. Leave room for the rest of the scene, or ask for a larger maximum."

### 31. (not verified) animation: "Each copy gets an animator" conflicts with the E1218 case for objects with no clips (low, contradiction)

- Anchor: "## Models from glTF files" line 27; "## Errors" line 484.
- Claim: Line 27 says each copy that `scene.instantiate` makes gets an animator. The errors table says `animator()` on an object with no clips throws E1218. Line 68 has the right rule.
- Proposed edit: Line 27: "Each copy of a model that has clips gets an animator on its group."

### 32. (not verified) animation: clip names change case between examples (low, unclear)

- Anchor: lines 32 (`'Idle'`) and 72 (`'idle'`).
- Claim: The first example plays `'Idle'` on the knight; the next plays `'idle'`. Names are case-sensitive, and the character demo uses `Idle`, `Walking_A`, `Running_A`. A reader who copies the second example gets E1218.
- Evidence: examples/character/sketch.ts:101.
- Proposed edit: Use one case in all examples, matching the KayKit knight's names.

### 33. (not verified) debug: the thread-mode table leaves out the `one-thread` mode that the stats panel takes (low, missing-content)

- Anchor: "**The thread modes.**" table (lines 238-242) and line 347.
- Claim: The overlay code has four modes; the table lists three. `mode: 'one-thread'` appears later only in the StatsPanel bullet.
- Evidence: packages/engine/src/debug/overlay-look.ts:651-678.
- Proposed edit: Add a row "One thread (another renderer) | A clock | One `Sketch + drawing` bar", or note it under the table.

### 34. (not verified) feature-effects: the example rebuilds the engine's own depth of field, and the `bloomLevel` option is missing (low, missing-content)

- Anchor: "## A depth of field"; "## Errors" E1213 row.
- Claim: The engine already has depth of field (post.md), and line 117 says it keeps its own place. A reader may wonder why to write one. The E1213 row mentions "a bloom level that the WGSL does not read", but the page never lists a `bloomLevel` option.
- Proposed edit: Retitle the example "A blur by distance (an add-on's own depth of field)" with one sentence on why. Add `bloomLevel` to the options or link to post.md#custom-effects for it.

### 35. (not verified) feature-draws: the errors table codes are not linked (low, structure)

- Anchor: "## Errors" (lines 156-161); same in feature-effects (lines 121-126) and features (line 311).
- Claim: Other pages link each code to docs/errors/E*.md. These three pages print bare codes.
- Proposed edit: Link each code, for example `[E1223](../errors/E1223.md)`.

### 36. (not verified) controls, engine: pointer lock is described twice with the same sentences (low, duplication)

- Anchor: controls "## Pointer lock" (lines 203-224); engine "## The running engine", the `requestPointerLock()` bullet (line 176).
- Claim: Both give the click-handler rule, E1425, E1426, Esc and `document.exitPointerLock()`.
- Proposed edit: Keep the full text on the engine page. On the controls page keep the example and the first-person behaviour, and link to the engine page for the rest.

### 37. (not verified) animation, geometry: morph targets are explained on both pages with repeated sentences (low, duplication)

- Anchor: animation "## Morph targets" (lines 453-467); geometry "## Morph targets" (lines 159-178).
- Claim: Both define a morph target, both give `setMorphWeight`, and both say "A morphed color stays between 0 and 1, as the glTF specification asks".
- Proposed edit: Keep building targets on geometry and playing weights on animation. Each page gives one line and a link for the other part.

### 38. (not verified) animation: the inertial-transitions section and the add-on paragraph in assets are hard-wrapped (low, structure)

- Anchor: animation lines 209-238; assets lines 149-154; geometry lines 281-284.
- Claim: These paragraphs break lines in mid-sentence, unlike the rest of each page. Some renderers keep the breaks.
- Proposed edit: Join each paragraph into one line.

### 39. (not verified) geometry: the card paragraph is off topic and names an undefined "matched-crop check" (low, unclear)

- Anchor: "### Levels by hand", lines 281-284.
- Claim: The paragraph lists bake rules for impostor cards on a page about meshes, and uses "the matched-crop check before a card is accepted", which reads like a review step.
- Proposed edit: Replace with one sentence: "A far object that draws as a card follows the rules of [Impostors](impostors.md#make-a-card-read-as-its-mesh)."

### 40. (not verified) geometry: the meshes-from-arrays demo is described as three shapes; it has two (low, wrong-claim)

- Anchor: "## Computing normals and tangents", line 155.
- Claim: "a smooth height field, an island with a color at each vertex, and a crystal". The demo summary has an island (the height field) and a crystal.
- Evidence: examples/demos.ts entry `mesh-arrays`.
- Proposed edit: "shows both: a smooth island with a color at each vertex, and a crystal with hard edges."

### 41. (not verified) grass: "API reference" comes before "Related pages" (low, structure)

- Anchor: the last two headings.
- Claim: Every other page in the slice puts "Related pages" first.
- Proposed edit: Swap the two sections.

### 42. (not verified) controls: the double-precision note is an implementation detail (low, technical-details-block)

- Anchor: "## Fly controls", the last bullet (line 168).
- Proposed edit: Move it into a details block: "Technical details: why the controls keep their own pose".

### 43. (not verified) cameras: "thread mode" is used without a link (low, term-before-definition)

- Anchor: "### Which frame a ray sees", line 137.
- Proposed edit: Link "thread mode" to ../concepts/architecture.md#latency-modes.

## Screenshots, demo links and concepts with no demo

Demo links use https://github.com/null3d-engine/null3d/tree/main/examples/<code>. Reference images are in tests/image/references/chrome-real-gpu/webgpu/.

### api/animation

Screenshots:
- `character-blend` (reference, demo `character`, tests/image/references/chrome-real-gpu/webgpu/demo-character.png): the knight that walks a circle with blended clips. Place under "## 1D blends". Alt: "A knight in armour walks a cobbled courtyard, mid-stride, sword in hand."
- `look-at-ring` (reference, demo `look-at`, demo-look-at.png): seven knights whose heads turn to a wisp. Place under "### Looking at a point". Alt: "Seven knights in a ring turn their heads toward a floating wisp of light."
- `animated-values` (reference, demo `property-animation`, demo-property-animation.png): neon plinths, lamp and lens moved by keyframes. Place under "## Property animation". Alt: "Neon plinths in mid-change of color under a glowing lamp."
- `morph-tulips` (reference, demo `morph-flowers`, demo-morph-flowers.png): tulips that open by one morph target. Place under "## Morph targets". Alt: "A bed of tulips, some open and some closed, in morning sun."
- `skeleton-lines` (scripted, test page `gltf-skeleton`): the Fox and the arm drawn with `debug.skeleton`, meshes hidden. Place under "## Seeing the skeleton". Steps: run tests/pages/sketches/gltf-skeleton-sketch.ts at its hold time. Alt: "Blue and green lines trace the joints of a running fox and a waving arm."

Demo links:
- Layers and joint masks: `character`, under "## Layers and joint masks".
- Joint overrides and look-at: `look-at`, under "### Looking at a point".
- Property animation: `property-animation`, under "## Property animation".
- Morph targets: `morph-flowers`, under "## Morph targets".
- Crowds: `showcase/island/` is not a crowd. No crowd demo.

Concepts with no demo: inertial transitions, additive clips, events, setUpdateInterval for crowds, KHR_animation_pointer files (the property-animation demo loads one, check), skinning limits.

### api/assets

Screenshots:
- `gltf-boombox` (reference, demo `gltf-model`, demo-gltf-model.png): the BoomBox on a turntable under the built-in room. Place under "## glTF models". Alt: "The Khronos BoomBox on a polished turntable in a dark studio."
- `environment-spheres` (reference, demo `environment`, demo-environment.png): spheres lit only by an environment. Place under "## Environments". Alt: "Rows of plastic and metal spheres, rough to smooth, lit by an HDR sunset."
- `room-vs-sky` (scripted, demo `environment`): three frames side by side at the times the demo switches (sunset HDR, studio EXR, generated sky). Place under "## Environments". Steps: hold the demo at 1 s, 5 s and 9 s. Alt: "The same spheres lit by a sunset file, a studio file and the generated sky."
- `devtools-network-gltf` (manual): the browser's network panel while a staged model loads, showing the coarse file first and finer levels later. Place under the `--stages` paragraph. Alt: "The browser's network panel lists a model's coarse file, then its finer stages."

Demo links:
- glTF models: `gltf-model` (already linked).
- Environments from HDR and EXR files: `environment`, under "## Environments".
- Models with levels and stages: `showcase/island/` (trees with levels and far cards), under the `--stages` paragraph.
- Extensions that add-ons read: `splats` (KHR_gaussian_splatting through @null3d/splats), under "## Extensions that add-ons read".

Concepts with no demo: color grading tables (`loadLut`, `lutFromData`), cube maps, baked light files, the cache of derived data, `rewriteUrl` for uploaded models, `onProgress` loading bars.

### api/cameras

Screenshots:
- `dolly-zoom` (reference, demo `camera-lens`, demo-camera-lens.png): the chess board with depth of field. Place under "### Focal length". Alt: "A low shot across a chess board, the far king sharp, string lights blurred into discs."
- `lens-35-85` (scripted, demo `camera-lens`): two frames side by side at the 35 mm and 85 mm ends of the dolly zoom. Steps: hold at the start and the end of the zoom. Alt: "The same chess board at 35 mm and at 85 mm, the board the same size in both."
- `two-views` (reference, demo `multiple-views`, demo-multiple-views.png). Place under "## Several cameras". Alt: "One canvas split into a high wide view and a low view among standing stones."
- `layers-street` (reference, demo `layers`, demo-layers.png). Place under "## Layers". Alt: "A street of brick cottages with roofs and map pins on their own layers."

Demo links:
- Layers: `layers`, under "## Layers".
- Several cameras and views: `multiple-views`, under "## Several cameras".
- Points on the screen and rays: `picking/`, under "## Points on the screen".

Concepts with no demo: orthographic cameras, the frame history that rays use.

### api/controls

Screenshots:
- `walk-and-fly` (reference, demo `walk-and-fly`, demo-walk-and-fly.png). Place under "## First-person controls". Alt: "A ruined temple at golden hour, seen from eye height between columns."
- `gizmo-handles` (reference, demo `gizmos`, demo-gizmos.png). Place under "## Gizmos". Alt: "Move handles, an arrow per axis and plane tiles, on a selected piece on a plinth."
- `gizmo-modes` (scripted, demo `gizmos`): translate, rotate and scale handles side by side on one piece. Steps: press each mode button, hold the frame. Alt: "The same piece with move arrows, rotate rings and scale cubes."
- `orbit-controls` (scripted, test page `controls`): the camera after the test's scripted drag. Place under "## Gestures". Alt: "A scene seen after an orbit drag around its target."

Demo links:
- Orbit controls: every demo's camera uses them through examples/lib/interact.ts; link `gltf-model` under "## Gestures".
- Fly and first-person controls, pointer lock: `walk-and-fly` (already linked).
- Gizmos: `gizmos` (already linked).

Concepts with no demo: map controls, drag controls, keys and saveState.

### api/debug

Screenshots:
- `debug-shapes` (scripted, test page `debug`): every debug shape over a small lit scene. Place under "## Debug drawing". Alt: "A grid, a box, axes on a spinning crate, an arrow and a camera frustum drawn as lines."
- `debug-views` (scripted, test pages `debug-view-normals`, `debug-view-depth`, `debug-view-overdraw`, `debug-view-wireframe`, `debug-view-shadows`): the five views side by side. Place under the views table. Alt: "One scene drawn five ways: normals, depth, overdraw, wireframe and shadows."
- `levels-view` (scripted, demo `forest/` with `?view=levels`): trees colored by level of detail. Place under the `'levels'` row. Alt: "A forest where near trees draw blue and far trees green, yellow and orange."
- `motion-view` (scripted, demo `math` with `?view=motion`): drones colored by their screen motion. Alt: "Moving drones in hues that show their direction on a black background."
- `stats-overlay-open` (scripted, any demo such as `instances/` with `?stats=open`): the overlay's card on the Frame tab. Place under "### The card". Alt: "The stats overlay's card: work bars for each thread and the GPU against the target."
- `stats-memory-tab` (scripted, same demo with `?stats=open`, Memory tab selected). Alt: "The Memory tab: one bar with engine, GPU and JavaScript heap parts."
- `inspector-panel` (scripted, any demo with `?inspect`): the inspector docked at the left with an object selected. Place under "## The in-page inspector". Alt: "The inspector lists the scene as a tree, with one object outlined in the view."
- `devtools-performance-memory` (manual): Chrome's Performance or Memory panel beside the overlay, to show the whole-page figure. Alt: "Chrome's Memory panel beside the overlay's whole-page line."

Demo links:
- Skeleton drawing: `character`, under the `skeleton` row.
- Shadow cascades from elsewhere: `hero-shadow/`, under "### Watch the shadow cascades from elsewhere".
- Levels view: `forest/`, under the `'levels'` row.

Concepts with no demo: debug drawing as such (only the test page), add-on debug views, StatsPanel for another engine, engine.measure.

### api/engine

Screenshots:
- `transparent-canvas` (reference, demo `depth-only`, demo-depth-only.png): a see-through canvas over a page. Place under "## A transparent canvas". Alt: "Glass panes over an embedded web page that shows through a see-through canvas."
- `devtools-console-failure` (manual): the console line that `onFailure` logs, with an engine error code. Place under "## The running engine". Alt: "The browser console shows an engine error with its code and fix."
- `devtools-memory-wasm` (manual): Chrome's Memory panel showing the reserved WebAssembly memory. Place under "## Memory". Alt: "Chrome's Memory panel lists the engine's shared WebAssembly memory."

Demo links:
- Transparent canvas: `depth-only`, under "## A transparent canvas".
- Large worlds: `large-world`, at the `largeWorld` option.
- Page part with input off: `replay/`, at the `input` option.

Concepts with no demo: the start stages and onProgress, the preset check, screenshots with capture(), add-on version checks.

### api/feature-draws

Screenshots:
- `feature-draw-clouds` (scripted, test page `feature-draw`): an opaque cloud of small discs behind a blended cloud of soft discs. Place under "## A point cloud". Alt: "Two clouds of colored discs, sharp in back and soft in front."
- `splats-priory` (reference, demo `splats`, demo-splats.png): the splats add-on, which draws with `addFeatureInstances`. Place under "## Many copies of one shape". Alt: "A drone scan of a priory drawn from Gaussian splats."

Demo links:
- Many copies and the resolve point: `splats`, under "## Many copies of one shape".

Concepts with no demo: a single feature draw, the band and order of a blended draw.

### api/feature-effects

Screenshots:
- `feature-effect-before-after` (scripted, a test page to make, since none exists): the example's blur by distance on and off side by side. Place under "## A depth of field". Alt: "The same scene sharp, and blurred away from the focus distance."

Demo links: none. No demo or test page calls `post.addFeatureEffect`.

Concepts with no demo: every concept on the page (the description fields, readiness, values, the chain order).

### api/feature-instances

Screenshots:
- `compute-instances` (scripted, test page `feature-instances-compute`): quads that a compute pass places. Place under "## A draw of quads". Alt: "Rows of small quads placed by a compute pass."
- `instances-shadow` (scripted, test page `feature-instances-shadow`): the same draw casting shadows. Place under "## Limits". Alt: "GPU-counted quads cast shadows on the ground below."
- `grass-hill` (reference, demo `vegetation-wind/`, demo-vegetation-wind.png): grass from @null3d/grass, which uses this hook. Place under the intro. Alt: "A grove with grass at its feet, drawn by a compute pass."

Demo links:
- Compute instances in use: `vegetation-wind/` (grass), under the intro.

Concepts with no demo: the WebGL2 path with setInstances, the conversion to camera-relative rows.

### api/features

Screenshots:
- `stats-steps-tab` (scripted, demo `water/` with `?stats=open`, Steps tab): the water feature's row with its GPU time, settings and budget. Place under "## Stats". Alt: "The Steps tab shows a water row with GPU time, settings and budget."
- `aurora-sky-layer` (reference, demo `aurora`, demo-aurora.png): a sky layer from a feature description. Place under the "Sky layers" adapter bullet. Alt: "Green and violet aurora curtains over a frozen lake at night."

Demo links:
- Sky layer adapter: `aurora`, under "## Adapters".
- Feature hosts with settings and budgets: `water/`, `ocean/`, `splats`, under "## Preset settings and the frame-budget governor".

Concepts with no demo: published outputs, lighting slots, namespaces, order bands.

### api/geometry

Screenshots:
- `generators` (reference, demo `generators`, demo-generators.png). Place under "## Generators". Alt: "Nine shapes in a row, from a box to a ring, in metal and plastic."
- `extra-shapes` (reference, demo `extra-shapes`, demo-extra-shapes.png). Place under "## Extra shapes". Alt: "A torus knot, polyhedra, a lathe vase, an extruded star and a tube on a stone floor."
- `mesh-arrays` (reference, demo `mesh-arrays`, demo-mesh-arrays.png). Place under "## Computing normals and tangents". Alt: "An island with smooth normals and vertex colors beside a hard-edged crystal."
- `vertex-updates` (reference, demo `vertex-updates`, demo-vertex-updates.png). Place under "## Vertices that change". Alt: "Rings spread over a pool from a glowing float."
- `morph-tulips` (reference, demo `morph-flowers`, demo-morph-flowers.png). Place under "## Morph targets".
- `lod-levels-view` (scripted, demo `forest/` with `?view=levels`). Place under "## Levels of detail". Alt: "Trees colored by the level of detail that each draws."

Demo links:
- Levels of detail: `forest/`, under "## Levels of detail".
- Morph targets: `morph-flowers` (already linked).

Concepts with no demo: integer attributes, vertex formats, levels by hand, destroying a mesh, large meshes over 65,535 vertices.

### api/grass

Screenshots:
- `grass-grove` (reference, demo `vegetation-wind/`, demo-vegetation-wind.png). Place under the intro. Alt: "Grass and ferns sway at the feet of oaks, birches and firs."
- `grass-garden` (reference, demo `contact-shadows/`, demo-contact-shadows.png): tufts of grass in the stone garden. Place under "## Near shadows and the sway distance". Alt: "Tufts of grass among mossy rocks and raked sand in low evening sun."
- `grass-presets` (scripted, test page `vegetation-grass`, or demo `vegetation-wind/` with `?preset=low` and `?preset=ultra`): Low and Ultra side by side, to show the 0.35 and 1.25 shares. Place under "## Grass on the ground". Alt: "The same hill of grass at the Low and the Ultra preset."
- `grass-shadow` (scripted, test page `vegetation-grass-shadow`). Place under "## Near shadows and the sway distance". Alt: "Blades cast fine shadows onto the ground."

Demo links:
- Grass with wind: `vegetation-wind/`, under the intro.
- Grass in a scene: `contact-shadows/`, under "## Grass on the ground".
- Grass at scale: `showcase/island/`, under "## The two GPU paths".

Concepts with no demo: the blade shape option, the placement hash, compute: false.
