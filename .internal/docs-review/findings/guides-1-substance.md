# Sense and substance review: slice guides-1

Pages: guides/accessibility, guides/add-ons, guides/agents, guides/assets-pipeline, guides/audio, guides/baked-light-data, guides/car-paint, guides/content-pages, guides/custom-passes, guides/custom-shaders, guides/debugging, guides/deploying, guides/deterministic-simulation, guides/first-use-shaders.

Paths below are relative to the generated copy of the repository. Line numbers are lines of the page file. The statistics file counts lines after the 7-line front matter, so a statistics line N is page line N + 7.

Findings 1 to 30 are checked against the source. Findings 31 and later are "not verified": I read them but did not check every claim against the source.

## Ranked findings

### 1. [high] guides/first-use-shaders: a decision record number and a prototype note reach the user table
- Anchor: the `'taa'` row, "a prototype for measuring only (D-206)".
- Claim: The row names a decision record (D-206) and calls the feature a prototype for measuring. Readers cannot follow D-206, and the rules forbid decision record numbers in docs. A reader also cannot tell if `'taa'` is a feature they may preload.
- Evidence: docs/guides/first-use-shaders.md:31; source tools/lib/first-use-docs.ts:25 (`taa: '... a prototype for measuring only (D-206)'`). docs/data/threejs-mapping.json:1762 says TAA "is a prototype that does not ship".
- Proposed edit: In tools/lib/first-use-docs.ts, change the `taa` text to "when `post.set` turns the temporal resolve on. The resolve is not part of any quality preset, and a page that never turns it on downloads none of it". Remove "(D-206)". Add a check to the docs style test that fails on `D-\d+` in generated rows.
- Source to edit: tools/lib/first-use-docs.ts

### 2. [high] guides/assets-pipeline: the shader permutation section is a maintainer procedure inside the `assets` command page
- Anchor: "## Build only the shader permutations you draw with" (lines 465 to 505).
- Claim: This section does not describe the `assets` command. It tells the reader to run `bun run examples:build`, `bun run examples:preview` and `bun tools/shader-permutations.ts --pages demos`, which exist only in the engine repository. It names `examples/shader-permutations.txt`, "this repository's own dev server", "a showcase scene", "the island's pages record with its highest walker count". It uses changelog words: "A build without the list stays a full build, as before" (469) and "the build compiles every permutation, as before" (495). A project developer who follows it fails at the first command.
- Evidence: package.json:66-67 (`examples:build`, `examples:preview` run `examples/vite.build.config.ts`); examples/vite.build.config.ts:37-38; tools/lib/shader-modules.ts:316-333 (the engine's own shader build reads `NULL3D_SHADER_PERMUTATIONS`); docs/guides/deterministic-simulation.md:212-222 is the only user flow that needs it.
- Proposed edit: Move the section out of the asset pipeline page, into the deterministic simulation page's "A production build of a game's engine files" (or a page of its own, "Narrow the engine's shader set"). Rewrite it for a reader who has a checkout of the engine at their release: (1) check out the tag; (2) run the recorder against the game's own pages with `--page`; (3) build the set; (4) point `NULL3D_ENGINE_SHADERS` at it. Delete the demo, island and `examples/` references, and the two "as before" phrases. Keep one sentence in assets-pipeline that links to the new place, beside "The shader list". Put the bit-layout detail (device bits, both GPU paths) in a "Technical details: what a permutation word holds" block.

### 3. [high] guides/baked-light-data: the direction encoding is stated backwards
- Anchor: the light map table row `direction`, and the paragraph "The direction is a unit vector in world space" (lines 90 and 94).
- Claim: The page says each byte is "each axis of the light's direction divided by 127", and "Each curve of the map's ranges from -1 to 1, then divided by 127 and stored as a signed byte". A bake tool that follows this stores values near 0. The reader must multiply each axis by 127 and round to a signed byte. The engine divides by 127 when it reads. The second sentence is also garbled ("Each curve of the map's ranges").
- Evidence: packages/engine/src/scene/baked-light.ts:77 ("Three signed bytes per texel, from -127 to 127"), :56. The page is the format's reference for third-party writers (line 21).
- Proposed edit: Row: "Optional. Base64 of three signed bytes per texel: each axis of the unit direction, from -1 to 1, times 127 and rounded. A reader divides each byte by 127." Paragraph: "The direction is a unit vector in world space, from the surface toward the light." Fix the TSDoc at baked-light.ts:56 and :77 in the same way.

### 4. [high] guides/assets-pipeline: two sentences give opposite results for a build without the variable
- Anchor: "The empty variable makes a full set ... Without it, the build narrows to the list that a recorded run wrote." (line 483) and "Without the variable, the build compiles every permutation, as before." (line 495).
- Claim: Line 483 says a build without the variable narrows. Line 495 says a build without the variable is full. Both are true only for different commands (`examples:build` reads the repository list by default; `bun run build` does not). The page does not say so.
- Evidence: examples/vite.build.config.ts:37-38 sets the list only for the examples build; tools/lib/shader-modules.ts:319-322 treats unset or empty as a full build.
- Proposed edit: When the section moves (finding 2), state one rule: "Leave `NULL3D_SHADER_PERMUTATIONS` unset or empty for the full set. Set it to a list file to narrow the set." Remove the examples-build default from user docs.

### 5. [medium] cross-page: every page opens with "Roadmap step 0.x", an internal plan step
- Anchor: the note under each title, such as "> Roadmap step 0.3, first released in null3D 0.1.0."
- Claim: No published page shows the roadmap, so "step 0.3" means nothing to a reader. It also reads as a contradiction: step 0.3 but released in 0.1.0. The writing rules forbid internal plans in docs.
- Evidence: all 14 pages of this slice, line 11 (first-use-shaders excepted); tools/lib/steps.ts:5-30 (`releaseOf`, `shipsSentence`); docs/index.md:34 and docs/pages.md:11 describe a "step column" of an unpublished roadmap.
- Proposed edit: In tools/lib/steps.ts, make `shipsSentence` give "First released in null3D 0.1.0." for the three pre-release steps. Drop the step column from pages.md, or rename it "First release". Update tools/lib/docs.ts checks and tools/lib/docs.test.ts:90-142 to match.
- Source to edit: tools/lib/steps.ts, tools/lib/docs.ts

### 6. [medium] guides/audio: the -20 LUFS claim about the sample loops is wrong
- Anchor: "A mix that works", first bullet: "The sample loops are normalized to -20 LUFS."
- Claim: The repository's sound files measure from -44.0 to -12.9 LUFS. The demos multiply each level by a gain to reach -20 LUFS. "The sample loops" is also never introduced: the reader does not know which files are meant.
- Evidence: docs/guides/audio.md:127; examples/lib/sound-gain.ts:1-30 ("The generated sounds were left at the level that their generator gave them, some forty decibels apart").
- Proposed edit: "Normalize the files to one loudness, such as -20 LUFS, so a level of 1 means the same for each. If you cannot change the files, multiply each sound's level by a gain that brings it there."

### 7. [medium] guides/audio, api/sound: three pages give three different ranges for a waterfall
- Anchor: "Sources at places" prose and code (lines 75, 94), the range table row "A waterfall" (line 86), and line 91.
- Claim: The prose and the code use `near: 6, far: 200`. The table, on the same page, gives 5 and 400. The API page gives 4 and 120. Line 91 says a `far` of a kilometre is heard from the whole map, but the table gives thunder 4000.
- Evidence: docs/guides/audio.md:75, 86, 91, 94; docs/api/sound.md:41-42.
- Proposed edit: Pick one set of values and use it in all three places, or say in the prose that the example is a small fall heard across a valley, unlike the table's large fall. Change line 91 to "A source whose `far` is far larger than its view, other than thunder, is heard from the whole map".

### 8. [medium] guides/deterministic-simulation: one build is reported twice, with different figures
- Anchor: "A real game recorded this way drew with 5 words, and its folder held 300 files and 26 MB ... 762 files and 226 MB" (line 218) and "A small game scene ... Its folder held 297 files and 26,057,130 bytes ... 759 files and 225,683,678 bytes" (line 222).
- Claim: The two sentences describe the same comparison with different counts (300 against 297, 762 against 759). The reader cannot tell if these are two games. Line 220 also names "the folder's file and byte limits" without saying whose limits.
- Evidence: docs/guides/deterministic-simulation.md:218, 220, 222.
- Proposed edit: Keep one summary sentence in the main text: "A small game drew with 5 words. Its folder held about 300 files and 26 MB, against about 760 files and 226 MB with the 172-word example list." Move the exact byte counts, the Brotli size and the full set's 4.1 GB into a "Technical details: measured folder sizes" block. Replace "the folder's file and byte limits" with the real limit, such as a host's limit on files per deploy, or remove it.

### 9. [medium] guides/deterministic-simulation: the narrowed-shader steps lack their prerequisites
- Anchor: "In a checkout of null3D, build the shader modules from the list" (line 215).
- Claim: The steps need a checkout of the engine repository at the same release as the installed `@null3d/engine`, and the tools that `bun run shaders` needs. The page names neither. The plugin uses the named folder as it is, so a checkout at another version gives modules that do not match the engine.
- Evidence: package.json:30 (`"shaders": "bun tools/shaders.ts"`); packages/vite-plugin/src/engine-shaders.ts:37-41, :68-72 (the folder is used when it holds `shaders.ts`, with no version check).
- Proposed edit: Add before step 1: "You need a checkout of the null3D repository at the tag of your engine version, such as `git checkout 0.1.0`, and the tools that its contributor guide lists for a shader build." Add after step 3: "Build the set again after each engine upgrade."

### 10. [medium] guides/custom-shaders, guides/custom-passes: how a material reads its uniforms is never said, and the effect page implies the wrong name
- Anchor: custom-shaders "Custom materials" (line 43) and the typed-uniforms example (line 244); custom-passes "Uniforms" (line 87).
- Claim: A material reads its uniforms as `material.<name>`, and an effect reads them as `uniforms.<name>`. The custom-shaders page never states the material form. Its example uses `material.width` with no word about it. The effects page says "read them as `uniforms.name`. The rules are those of custom materials", which suggests materials use `uniforms.` too.
- Evidence: docs/guides/custom-shaders.md:43, 244; docs/guides/custom-passes.md:87; docs/shaders/surface-functions.md:226-227 (`material.count`, `material.tint`).
- Proposed edit: custom-shaders line 43: "The WGSL can declare uniforms as `struct Uniforms`, and reads each as `material.<name>`. `set()` changes them at any time." custom-passes line 87: "Declare uniforms as `struct Uniforms`, and read them as `uniforms.name`. (A material reads its own as `material.name`.) The other rules are those of custom materials."

### 11. [medium] guides/custom-shaders: a "whole shader" is shown but the page never says how to draw one
- Anchor: "WGSL in sketch code" example `glow` (lines 111-127), "What the plugin compiles" last bullet (line 146), "A whole shader reloads the page, because your own code draws it" (line 216).
- Claim: The page's longest WGSL example is a whole shader. It is used before the term is defined (line 146), and no page says which call draws a whole shader. A reader cannot use the example.
- Evidence: docs/guides/custom-shaders.md:111-127, 146, 216; a search of docs/ for "whole shader" finds only this page, guides/add-ons.md and api/materials.md:855 (which only says it throws E1215).
- Proposed edit: Replace the `glow` example with a surface function or an effect, which a reader can use. If whole shaders have a public use, add one sentence with the call that draws them and a link. If not, say "A whole shader is for the engine's own passes. A sketch has no call that draws one."

### 12. [medium] guides/custom-passes: "the switch" is used before it is introduced
- Anchor: "### Drawing less often", "Pace a pass with the cadence, not with the switch." (line 306).
- Claim: The page never introduces `render.setPassEnabled` in the main text. It appears only in "Related pages". The paragraph also says "its passes stay in the plan", which the reader cannot parse.
- Evidence: docs/guides/custom-passes.md:306, 582; packages/engine/src/scene/render.ts:989 (`setPassEnabled`), :1005 (`setPassEvery`).
- Proposed edit: Rewrite line 306 as: "`setPassEvery` compiles nothing, so a sketch may change it every frame. A material that samples the texture in a skipped frame shows the last image. `render.setPassEnabled(pass, false)` turns a pass off. Use the cadence, not on and off, to pace a pass: turning on a pass that has never drawn compiles the render graph again." Move the rest into a "Technical details: cadence and the compiled plan" block.

### 13. [medium] guides/custom-passes: the Cost list is dense implementation detail
- Anchor: "### Cost" (lines 213-224).
- Claim: Ten bullets explain pass joining, folding, the render scale that "cannot drop below the whole canvas", background compiles on Android and 32-bit precision. "Render scale cannot drop" is a term that the page never explains. A reader who wants to know what an effect costs must read all of it.
- Evidence: docs/guides/custom-passes.md:215-224; docs/concepts/post-processing.md (#below-the-whole-canvass-render-scale).
- Proposed edit: Keep three bullets in the main text: the per-pass cost with the device figures; "effects that read only their own pixel join into one pass"; "add your effects before the first frame". Put the rest in a "Technical details: how the engine joins and folds effects" block, with one sentence that explains dynamic render scale and links to the post-processing page.

### 14. [medium] guides/car-paint: copying the folder needs the null3D Vite plugin, and the folder is not linked
- Anchor: "The paint is an example add-on in the repository, in the `examples/addons/car-paint` folder ... Copy the folder into your project and import its entry point." (line 28).
- Claim: The entry point imports `./paint.wgsl`, which only the null3D Vite plugin compiles. The page does not say so. The folder name has no link, so a reader must search for it.
- Evidence: examples/addons/car-paint/index.ts:7 (`import paintShader from './paint.wgsl'`); examples/addons/car-paint/paint.wgsl.d.ts:3.
- Proposed edit: "The paint is an example add-on, not an npm package: [examples/addons/car-paint](https://github.com/null3d-engine/null3d/tree/main/examples/addons/car-paint). Copy the folder into your project, with its `paint.wgsl`. Your project needs the null3D Vite plugin, which compiles the WGSL ([Install null3D](../getting-started/install.md))."

### 15. [medium] guides/assets-pipeline: 25 long paragraphs, with file-format detail in the main text
- Anchor: page lines 23, 84, 86, 88, 117, 126, 128, 143, 151, 153, 165, 177, 187, 189, 201, 203, 207, 219, 234, 276, 278, 370, 396, 471, 485 (statistics lines minus 7).
- Claim: The page is 8,386 words. Many paragraphs mix what the reader does with how the file stores it. Line 207 gives the stage file layout ("A kind 1 stage holds one band. Its header comes first, then the patch count, each patch's sphere, run, parent and error"), and "kind 1" is never defined. Line 189 (176 words) mixes how to use `--lod` with how `MSFT_screencoverage` marks a measured error. Line 276 (212 words) mixes the shader list with fade rules.
- Evidence: .internal/docs-review/stats.json, guides/assets-pipeline longParagraphs.
- Proposed edit: Keep the main text to what each option does and when to use it. Move these into blocks: "Technical details: the stage file layout" (line 207); "Technical details: how levels mark their errors" (line 189 from "The levels go into the file with `MSFT_lod`"); "Technical details: how the cluster tree is built" (lines 213-219); "Technical details: which shader files the list holds back" (line 276); "Technical details: the engine's glTF extensions" (line 130 and the extras names). Split lines 128, 143 and 219 at their topic changes.

### 16. [medium] guides/add-ons: the levels-of-detail section repeats the concept page at length
- Anchor: "## Give every mesh levels of detail" (lines 51-73).
- Claim: The section repeats the thresholds, the planner, the fade, the refusals and the pieces rules that concepts/lod.md gives. Two copies drift: the add-on page gives the pieces rules in a shorter form that leaves out the 1,024 to 32,767 range. An add-on author needs only the rule (make meshes through `fromArrays` or a generator, and opt out with a reason).
- Evidence: docs/guides/add-ons.md:55, 59, 71, 73; docs/concepts/lod.md:29, 127, 129; packages/engine/src/scene/resources.ts:306-315.
- Proposed edit: Keep line 57 (the rule), the opt-out table, and one sentence each for `levels: { cards: true }` and `levels: 'pieces'`. Replace lines 55, 59 (after its first two sentences), 71 and 73 with a link to [Levels of meshes made in code](../concepts/lod.md#levels-of-meshes-made-in-code). If any detail must stay, put it in a "Technical details: when the engine plans or drops levels" block.

### 17. [medium] guides/baked-light-data: the error paragraph sits in the Needle section
- Anchor: "Both calls throw [E1434](../errors/E1434.md) for a file that the engine cannot read." (line 137).
- Claim: The paragraph follows "Needle light maps", so "Both calls" reads as the Needle loader. It means `loadLightProbeGrid` and `loadLightMap`. The Needle section is also about glTF, not this file format, and it splits "Load a file" from "Save a grid".
- Evidence: docs/guides/baked-light-data.md:126-137, 157-170; packages/engine/src/errors/codes.ts:543-548 (E1434 names `assets.loadLightProbeGrid()`).
- Proposed edit: Move line 137 into "What the loader checks", as its first sentence: "`loadLightProbeGrid` and `loadLightMap` throw E1434 for a file that they cannot read, and the message names the fault:". Move "Needle light maps" after "Limits", or to the glTF loading page with a link from here.

### 18. [medium] guides/custom-shaders: the title note is a status report
- Anchor: the note under the title: "Custom materials with surface functions, vertex offsets, uniforms, textures and full shaders are built, and so is hot reload on the dev server." (line 11).
- Claim: "are built" reports build progress. It reads as a maintainer's checklist, and the rules say a page describes what exists, not progress.
- Evidence: docs/guides/custom-shaders.md:11.
- Proposed edit: Delete the sentence. The page's body already describes each part.

### 19. [medium] guides/debugging: four long paragraphs, one of 180 words
- Anchor: page lines 97, 117 (124 in the page), 131 (138 in the page), 139 (146 in the page). Statistics lines 90, 117, 131, 139.
- Claim: The stats overlay paragraph (line 138, 180 words) covers the header, the card, add-on rows, `Memory by system`, three ways to show it, and `debug.frameStats`. The `renderFallback` paragraph (line 97) lists three reason codes inline. The debug views paragraph (line 124) mixes views, an address switch and shadow cascades.
- Evidence: .internal/docs-review/stats.json, guides/debugging.
- Proposed edit: Line 138: keep "what it shows" and "how to show it" as two short paragraphs. Put add-on rows and `Memory by system` in a "Technical details: the rows of the stats card" block. Line 97: make the three reasons a table. Line 124: split at "To see whether shadow edges crawl".

### 20. [medium] guides/add-ons: eight long paragraphs
- Anchor: page lines 33, 35, 55, 59, 71, 73, 117, 153 (statistics lines 26, 28, 48, 52, 64, 66, 110, 146).
- Claim: Long paragraphs pack rules that an add-on author must act on together with background. Line 33 repeats itself ("A second add-on that takes the name is refused" and "The engine refuses a name or a code that another add-on holds"). Line 117 explains which compiled WGSL counts as shader data in a way that is hard to act on.
- Evidence: .internal/docs-review/stats.json, guides/add-ons.
- Proposed edit: Line 33: one list of the name rules, with the error code range "2000 to 9999" (packages/engine/src/scene/namespaces.ts:47, 77) and the error E1225. Line 117: keep "custom materials, effects and tone curves load in files of their own, held to the shader budget". Put the rest in a "Technical details: how the size gate counts shader bytes" block. Line 153: put the heap-reading method in a "Technical details: how the allocation gate measures" block. Lines 55 to 73: see finding 16.

### 21. [medium] guides/custom-passes: five long paragraphs, and a dense water-sheet bullet
- Anchor: page lines 25, 306, 312, 314, 336 (statistics 18, 299, 305, 307, 329), and the bullet at line 421.
- Claim: The opening paragraph (line 25) defines four kinds of pass in one block. Lines 312 and 314 list what a scene pass draws and how point-light shadows work. Line 421 introduces `sceneInputs`, `engine_frame.camera_range` and `sceneDistance(uv)` with no example, and a stray blank line (422) breaks the list.
- Evidence: .internal/docs-review/stats.json, guides/custom-passes; docs/guides/custom-passes.md:421-423.
- Proposed edit: Line 25: a four-row table (effect, tone curve, scene pass, full-screen pass, compute pass), each with one line and a link. Lines 312 and 314: a short list of what a scene pass draws, with the shadow rules in a "Technical details: lights and shadows in a scene pass" block. Line 421: make it a separate subsection "A blended sheet without a height map", or put it in a "Technical details" block with a short WGSL example. Remove the blank line at 422.

### 22. [medium] guides/deterministic-simulation: five long paragraphs, with bundle sizes in the main text
- Anchor: page lines 56, 110, 166, 218, 222 (statistics 49, 103, 159, 211, 215).
- Claim: Line 56 gives four bundle sizes from two Bun versions to make one point: import the sub-paths. It also names "a replaying engine's scan" with no explanation. Line 110 lists every listener that `input: false` keeps and drops.
- Evidence: .internal/docs-review/stats.json, guides/deterministic-simulation.
- Proposed edit: Line 56: main text "Never import `@null3d/engine` itself in simulation code. It brings engine code that uses `Math.sin`, `Math.random` and page APIs, which a replay must not run." Put the byte counts and Bun versions in a "Technical details: measured bundle sizes" block, and explain or remove "a replaying engine's scan". Line 110: keep the first two sentences and the link. Lines 218 and 222: see finding 8.

### 23. [low] guides/agents, guides/debugging, cli/null3d: the MCP server is described three times
- Anchor: agents "## The MCP server" (lines 63-77); debugging "## The MCP server" (lines 176-214); cli/null3d "## mcp" (line 189 on).
- Claim: The three pages repeat the default mode, `--connect`, the registration command and the tool summary in different words. agents line 75 lists the tools in prose, debugging lists them in a table. A change to the server must be made in three places.
- Evidence: docs/guides/agents.md:65-75; docs/guides/debugging.md:178-214; docs/cli/null3d.md:189-196.
- Proposed edit: Keep the full tool table and the options on the cli page. In debugging, keep the three ways to reach the scene and the tool table, and link to the cli page for options. In agents, keep two sentences and the `claude mcp add` command, and link to debugging.

### 24. [low] guides/baked-light-data: the title note holds an unrelated sentence
- Anchor: the note under the title (line 11): "A directional light map bends its light with a normal map, as the light of the bake came from a direction."
- Claim: The note is about the format's stability. The last sentence is about directional light maps, which the page explains later (line 124). The stability text also repeats line 33.
- Evidence: docs/guides/baked-light-data.md:11, 33, 124.
- Proposed edit: End the note after "takes a new version number." Delete the duplicate sentences at line 33 ("A bake tool may write members ... This engine refuses any version that it does not know.") or keep them and shorten the note.

### 25. [medium] guides/custom-shaders: three long paragraphs, and the arrays paragraph is in the wrong section
- Anchor: page lines 43, 175, 187 (statistics 36, 168, 180).
- Claim: Line 43 lists uniforms, textures, vertex offsets and lobes in one paragraph. Line 175 gives build sizes of the battle comparison in the main text. Line 187, about arrays in WGSL, sits under "Where a custom effect's and a tone curve's builds go", where it does not belong.
- Evidence: .internal/docs-review/stats.json, guides/custom-shaders; docs/guides/custom-shaders.md:177-187.
- Proposed edit: Line 43: a short list, one item for each part. Line 175: keep one sentence ("A device downloads one small file, about 20 KB after Brotli, instead of every build") and put the figures in a "Technical details: measured build sizes" block, with a link to compare/battle/. Line 187: move to "What the plugin compiles", or to the WGSL rules page.

### 26. [low] guides/car-paint: the weave's defaults and the seams' shade are missing
- Anchor: "## Options" table and the bullets under it (lines 51-74).
- Claim: The table says `weave` defaults to `false`, but not what a weave takes when the look gives `weave: {}` or only some of its fields. The code fills `cells: [90, 150]` and `shine: 0.85`. The table lists `seams.shade`, but no bullet explains it.
- Evidence: examples/addons/car-paint/index.ts:49 (shade "from 0 for none to 1 for black. The default is 0.85"), :96, :98 (`DEFAULT_WEAVE = { cells: [90, 150], shine: 0.85 }`).
- Proposed edit: Table, `weave` default column: "`false`. An object fills its missing fields from `{ cells: [90, 150], shine: 0.85 }`." Add a bullet: "`seams.shade` is how dark the groove draws, from 0 for none to 1 for black."

### 27. [low] guides/audio: beds and "points" are used in ways the page does not define
- Anchor: "A mix that works", bullets 5 and 7 (lines 131, 133).
- Claim: Line 56 says a bed has no `near` and no `far`. Line 131 then speaks of "a bed that carries a thousand meters". Line 133 says "three points at full level" and "a group's points", but the page calls them members and voices.
- Evidence: docs/guides/audio.md:56, 102, 131, 133.
- Proposed edit: Line 131: "A source whose `far` reaches a thousand meters makes an opening view over open water roar." Line 133: "Count the voices of a group. They add as power, so three voices at full level sound about five decibels louder than one loop. Give a group's members a lower level than a loop's."

### 28. [low] guides/content-pages: the reveal after `placed` has no page code, and `engine` is out of scope
- Anchor: "Drive the camera from the scroll position", "the page reveals the canvas only after both `placed` and `engine.firstFrame`" (line 145); the deadline code (lines 71-84).
- Claim: The page shows the sketch's `placed` message but no page code that waits for it. The deadline code uses `engine`, which the first code block declares inside `try`, so a reader who joins the blocks gets an error.
- Evidence: docs/guides/content-pages.md:43-49, 79, 145-170.
- Proposed edit: Add a short page snippet: `const placed = new Promise<void>((done) => engine.onSketchMessage((type) => { if (type === 'placed') done(); })); await Promise.all([engine.firstFrame, placed]); root.classList.add('ready');`. In the first block, declare `let engine` before `try`, or add a comment that the later blocks run inside the same `try`.

### 29. [low] guides/deterministic-simulation: an unlinked third-party library
- Anchor: "clockwork2's `dmath` is one" (line 67).
- Claim: The page names `@clockwork2/engine/dmath` with no link or description. A reader cannot tell what it is or where to get it.
- Evidence: docs/guides/deterministic-simulation.md:67, 73; examples/package.json:6 (`"@clockwork2/engine": "0.10.0"`).
- Proposed edit: "`@clockwork2/engine/dmath` (on npm) is one. The [replay demo](https://github.com/null3d-engine/null3d/tree/main/examples/replay) uses it." Add a one-line note on what "exact" means: the same bits on V8, JavaScriptCore and SpiderMonkey.

### 30. [low] guides/first-use-shaders: two rows are for the engine's tests only
- Anchor: the `'texcoords'` and `'instance_index'` rows (lines 22, 52).
- Claim: The intro says `preload` takes every name in the table. Two names are used only by the engine's tests. A reader may preload them, which downloads shaders the page never uses.
- Evidence: docs/guides/first-use-shaders.md:13, 22, 52; tools/lib/first-use-docs.ts (descriptions of `texcoords` and `instance_index`).
- Proposed edit: In tools/lib/first-use-docs.ts, mark test-only features so the generator leaves them out of the table, or add "Do not preload it" to their rows.
- Source to edit: tools/lib/first-use-docs.ts

## Findings not verified (lower ranked)

### 31. [low] guides/debugging: `?view` is an engine switch, not a demo switch (not verified)
- Anchor: "`?view=levels` in the page's address shows a demo's levels with no code change" (line 124).
- Claim: The engine reads `?view` on any page in a development build. "a demo's" suggests it works only in the examples. The switch table (lines 101-107) leaves it out.
- Evidence: packages/engine/src/page/switches.ts:350-353, :503.
- Proposed edit: "`?view=levels` shows the page's levels with no code change." Add `?view=<name>` to the switch table.

### 32. [low] guides/deploying: the size budget leaves out the start shader file, and the HTTP rule has an exception (not verified)
- Anchor: "## Size budgets" table (lines 90-95); "Over plain HTTP, the engine draws with WebGL2." (line 57).
- Claim: The start also downloads a shader file of about 0.04 to 0.05 MB after Brotli, which the table omits. `localhost` counts as a secure page, so WebGPU runs there over plain HTTP.
- Evidence: docs/guides/start-time.md:119-120.
- Proposed edit: Add a row "The start shader file: about 0.05 MB". Change line 57 to "Over plain HTTP from another host, the engine draws with WebGL2. `localhost` counts as secure."

### 33. [low] guides/accessibility: the keyboard advice does not say why focus matters (not verified)
- Anchor: "## Keyboard" (lines 42-46).
- Claim: The engine reads keys from the whole window, yet the page tells the reader to make the canvas focusable. The link between the two is not explained: focus is for screen-reader and Tab users who need to know where they are.
- Evidence: docs/guides/accessibility.md:42, 46.
- Proposed edit: Add: "The engine hears keys wherever focus is, so the focus outline is for the user: it shows that the scene is the active control."

### 34. [low] guides/add-ons: "a listing", "the cost gate stays owed" (not verified)
- Anchor: line 13 "before a listing publishes it"; line 149 "the cost gate stays owed".
- Claim: "listing" (an add-on directory?) and "owed" are not defined.
- Evidence: docs/guides/add-ons.md:13, 149.
- Proposed edit: Line 13: "before you publish it" or name the directory. Line 149: "the cost gate prints that it did not run, and the check does not pass until it runs".

### 35. [low] guides/baked-light-data: British "colour" beside American "color" (not verified)
- Anchor: lines 122, 130, 174.
- Claim: The rest of the docs write "color". "kilometre" in guides/audio.md:91 and "maths" in guides/deterministic-simulation.md are the same issue.
- Evidence: docs/guides/baked-light-data.md:122, 130, 174.
- Proposed edit: Use "color", "kilometer" and "math" throughout.

### 36. [low] guides/custom-passes: a full-screen pass's uniforms have no "change" call in its section (not verified)
- Anchor: "## Full-screen passes" (lines 425-503).
- Claim: The compute section gives `render.setPassUniforms`. The full-screen section gives `uniforms` at creation but not `render.setPassUniform(pass, name, value)`.
- Evidence: packages/engine/src/scene/render.ts:839, 865.
- Proposed edit: Add "Change a value with `render.setPassUniform(pass, 'levels', 4)`." under "What a full-screen pass reads".

### 37. [low] guides/audio: the `muffle` option is not named (not verified)
- Anchor: "With `far`, the sound also loses its highs with distance" (line 75).
- Claim: The reader does not learn that `muffle: false` turns this off.
- Evidence: packages/sound/src/sound.ts:70-71, :442.
- Proposed edit: Add "`muffle: false` keeps the highs."

### 38. [low] guides/baked-light-data: "the live sky" and "the hour" are unexplained (not verified)
- Anchor: line 66 "multiplies it by the environment's live light, so the hour needs no new bake"; line 68 "no probe adds the live sky".
- Claim: The page assumes a time-of-day sky. A reader without one does not know what "the hour" refers to.
- Evidence: docs/guides/baked-light-data.md:66, 68.
- Proposed edit: "so a sky that changes, such as a time-of-day sky, needs no new bake."

### 39. [low] guides/content-pages: after one crash, the scene stays off for a week (not verified)
- Anchor: "## After a crash" code (lines 209-228).
- Claim: A crash marker sends every visit to the fallback for seven days, with no retry. The page says "let a marker expire" but not how long the scene stays off, or how this interacts with the engine's own crash note (line 232), which already lowers the preset.
- Evidence: docs/guides/content-pages.md:212, 220, 232.
- Proposed edit: State the effect: "After a crash, this code shows the fallback for a week." Suggest a shorter expiry, or one retry at a lower preset, since the engine already lowers it.

### 40. [low] guides/baked-light-data: three long paragraphs (not verified)
- Anchor: page lines 33, 64, 122 (statistics 26, 57, 115).
- Claim: Line 122 mixes texture formats, channel layout and the reader's download size.
- Evidence: .internal/docs-review/stats.json, guides/baked-light-data.
- Proposed edit: Line 122: keep the API sentences. Put the formats and the 2 KB reader size in a "Technical details: the textures the loader makes" block. Put "Limits" first bullet's sub-volume layout (line 174) in a block too.

### 41. [low] guides/car-paint: "lobe" and "tow" are used before they are explained (not verified)
- Anchor: diagram node "lobe" (line 21); "a tow's rounded cross-section" (line 74).
- Claim: Neither word is defined on the page.
- Evidence: docs/guides/car-paint.md:21, 74, 94.
- Proposed edit: Line 74: "a tow (one bundle of carbon fibres)". Diagram: "the flakes' glint (an extra highlight lobe)".

### 42. [low] guides/custom-shaders: the battle comparison is named but not linked (not verified)
- Anchor: "For example, the battle comparison's sketch has 5 custom materials" (line 175).
- Claim: The reader does not know what the battle comparison is.
- Evidence: examples/compare/comparisons.ts:99 (`code: 'compare/battle/'`).
- Proposed edit: Link "the [battle comparison](https://github.com/null3d-engine/null3d/tree/main/examples/compare/battle/)".

### 43. [low] guides/add-ons: the error range and the name error are not given (not verified)
- Anchor: "codes below 2000 are the engine's own" (line 33).
- Claim: The upper bound (9999) and the error for a clash (E1225) are missing.
- Evidence: packages/engine/src/scene/namespaces.ts:47, 77, 209-210, 445-450; packages/engine/src/errors/codes.ts:254-259.
- Proposed edit: "An add-on's codes lie from 2000 to 9999. A name, a code range or a quality key that another add-on holds throws E1225." (Merge with finding 20 when editing.)

## Screenshots, demo links and concepts with no demo, per page

Demo link base: https://github.com/null3d-engine/null3d/tree/main/examples/<code>. Reference images: tests/image/references/chrome-real-gpu/webgpu/demo-<name>.png.

### guides/accessibility
Shots:
- `canvas-accessibility-tree` (manual): Chrome DevTools, Elements panel with the Accessibility pane open, on the glTF models demo page. The canvas is selected and shows role "img" with its `aria-label`. Goes under "Tell assistive technology what the canvas is". Alt: "Chrome's accessibility pane shows the canvas as one image with a text label."
Demo links:
- input/ under "Keyboard" (keyboard actions for every pointer action).
Concepts with no demo: aria-live status updates; reduced motion through `preferences`; a pause button with `setPaused`; progress bar markup; text contrast over the scene.

### guides/add-ons
Shots:
- `addon-stats-row` (scripted): tests/pages/water-stats.html (or the water demo with `?stats`), the stats card open, the water feature's row visible ("water ... reflectionEvery 2 budget 1.7 of 1.7 ms"). Goes under "Follow the preset and show the cost".
- `levels-debug-view` (scripted): forest demo with `?view=levels`, from its default camera, each level in its own color. Goes under "Give every mesh levels of detail".
Demo links:
- water/ under "Follow the preset and show the cost".
- forest/ under "Give every mesh levels of detail".
- terrain/ under the opt-out table (terrain blocks).
- impostors/ under the opt-out table (impostor cards).
- splats/ under "Claim the add-on's names" (the namespace example uses splats).
Concepts with no demo: namespace claim; plugin interface range and E1433; public entry points; Rust hot path on job workers; `check-addon` gates; size budgets; allocation gate.

### guides/agents
Shots:
- `in-page-inspector` (scripted): tests/pages/inspect.html, or the objects demo with `?inspect`: the panel at the left, one object selected and outlined, its fields shown, frame figures at the foot. Goes under "The MCP server", last paragraph.
Demo links:
- objects/ under "The MCP server" (a scene with named objects and parents to inspect).
Concepts with no demo: installing skills; docs by ID; the test loop; the MCP server.

### guides/assets-pipeline
Shots:
- `boombox-optimized` (reference): tests/image/references/chrome-real-gpu/webgpu/demo-gltf-model.png, the BoomBox that the example output describes. Goes under "Optimize a model".
- `lod-levels-view` (scripted): forest demo with `?view=levels`. Goes under "Levels of detail".
- `roughness-bake-side-by-side` (scripted): the BoomBox at a far camera pose, optimized with and without `--no-roughness-bake`, side by side, showing flicker-free rough highlights with the bake. Goes under "The roughness bake".
- `environment-map` (reference): tests/image/references/chrome-real-gpu/webgpu/demo-environment.png. Goes under "Environment maps".
Demo links:
- gltf-model/ under "Optimize a model".
- character/ under "What it does to clips" (the KayKit Knight the page measures).
- forest/ under "Levels of detail".
- showcase/island/ under "Levels as separate downloads" (optimized glTF models with levels).
- environment/ under "Environment maps".
Concepts with no demo: blockers; stored raycast trees; cluster levels; `--stages` bands; `convert`; `pack-orm`; `normal-from-bump`; the budget report; the shader list; the `?optimized` Vite import.

### guides/audio
Shots:
- `positional-sound` (reference): tests/image/references/chrome-real-gpu/webgpu/demo-sound.png, the moor with the speaker button. Goes after the intro.
Demo links:
- sound/ under "Sources at places" and "Events" (brook, thunder one-shots).
- showcase/creek/ under "Beds whose level the scene sets" (wind and leaves loops).
- showcase/skyway/ under "Groups of many sources" (hover cars).
- showcase/island/ under "Groups of many sources" (cars and the bus).
Concepts with no demo: how the sound reaches the speakers (shared table and mixer).

### guides/baked-light-data
Shots:
- `probe-grid-on-off` (scripted): tests/pages/sketches/probe-grid-sketch.ts, with and without the probe grid, side by side. Goes under "A probe grid".
- `directional-light-map` (scripted): tests/pages/lightmap-cost.html, a wall with a normal map lit by a plain and a directional light map, side by side. Goes under "Load a file", after the `lightMapDirection` paragraph.
Demo links: none.
Concepts with no demo: probe grid files; light map files; directional light maps; Needle light maps; `bakeProbes` and `lightProbeGridFile`.

### guides/car-paint
Shots:
- `car-paint-showroom` (reference): tests/image/references/chrome-real-gpu/webgpu/demo-showroom.png. Goes after the intro.
- `car-paint-flakes-close` (scripted): coat-and-sheen demo at a close camera pose on a door panel, showing flakes, a seam and the carbon weave. Goes under "How the parts draw".
Demo links:
- showroom/ (exists, under "Related pages").
- coat-and-sheen/ under "How the parts draw" (flakes, door seams and carbon weave).
Concepts with no demo: none.

### guides/content-pages
Shots:
- `poster-then-canvas` (scripted): a test page with the fallback poster and the same view after `firstFrame`, side by side. Goes under "Build the fallback page first".
- `network-save-data` (manual): Chrome DevTools Network panel with throttling set to a slow connection, for "Set a load deadline".
Demo links: none.
Concepts with no demo: fallback page; load deadline; reduced motion at rest; pausing off screen; scroll-driven camera; `assets.cache`; crash marker.

### guides/custom-passes
Shots:
- `render-to-texture` (reference): tests/image/references/chrome-real-gpu/webgpu/demo-security-camera.png. Goes under "Render to a texture".
- `post-effects` (reference): tests/image/references/chrome-real-gpu/webgpu/demo-post-effects.png. Goes under "Custom effects".
- `reflection-pass` (reference): tests/image/references/chrome-real-gpu/webgpu/demo-shader-inputs.png (the pool with a reflection pass). Goes under "Reflections".
- `outline-glow` (scripted): tests/pages/sketches/fullscreen-sketch.ts, an outlined object with the soft glow. Goes under "A soft outline glow".
- `render-graph-dot` (scripted): `render.dumpGraph()` output rendered as a graph for the minimap example. Goes under "When a full-screen pass runs".
Demo links:
- security-camera/ (exists).
- post-effects/ under "Custom effects".
- shader-inputs/ under "Reflections" (its pool uses a reflection pass).
- water/ under "A water recipe".
- compare/battle/ under "Custom effects" (it adds custom effects).
Concepts with no demo: custom tone curves; full-screen passes; compute passes; layer masks for passes; pass cadence.

### guides/custom-shaders
Shots:
- `custom-shader-inputs` (reference): tests/image/references/chrome-real-gpu/webgpu/demo-shader-inputs.png. Goes under "Custom materials".
- `shader-error-overlay` (manual): Vite's error overlay in the browser for a WGSL error, with file, line and column. Goes under "Shader errors".
Demo links:
- shader-inputs/ under "Custom materials".
- compare/battle/ under "Where a custom material's builds go".
Concepts with no demo: full shaders; whole shaders; hot reload; typed uniforms.

### guides/debugging
Shots:
- `stats-overlay-card` (scripted): tests/pages/stats.html or any demo with `?stats`, the card open. Goes under "Measure".
- `in-page-inspector` (scripted): tests/pages/inspect.html, as for guides/agents. Goes under "The in-page inspector".
- `debug-view-wireframe` (scripted): objects demo with `?view=wireframe`. Goes under "See the scene with debug drawing".
- `sketch-worker-breakpoint` (manual): Chrome DevTools Sources panel with the sketch worker's thread selected and a breakpoint in sketch.ts. Goes under "Logs and breakpoints in the sketch".
Demo links:
- objects/ under "The in-page inspector".
- hold-mode/ under "Reproduce a frame".
Concepts with no demo: error codes; development checks; `renderFallback`; the MCP server; simulated GPU loss.

### guides/deploying
Shots:
- `network-wasm-brotli` (manual): Chrome DevTools Network panel on a deployed page, the core's `.wasm` row with its transferred size against its size and `Content-Type: application/wasm`. Goes under "Compress with Brotli".
- `cross-origin-isolated-console` (manual): the console showing `crossOriginIsolated` as `true`. Goes under "Check the deployed page".
Demo links: none.
Concepts with no demo: headers; caching; Brotli; size budgets.

### guides/deterministic-simulation
Shots:
- `replay-demo` (reference): tests/image/references/chrome-real-gpu/webgpu/demo-replay.png. Goes under "Where the player looks".
Demo links:
- replay/ (exists) also under "Angles and exponentials: createMath" (replay/sim.ts uses it) and "Input that another library records" (replay/page.ts passes `input: false`).
Concepts with no demo: a production build of a game's engine files; narrowed shader sets.

### guides/first-use-shaders
Shots:
- `first-use-network` (manual): Chrome DevTools Network panel filtered to shader files, a feature's file downloading the first time the sketch uses it. Goes after the intro.
Demo links: none (a table page).
Concepts with no demo: `preload`.
