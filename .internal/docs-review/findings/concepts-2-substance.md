# Concepts slice 2: sense and substance review

Pages: concepts/materials, concepts/particle-buffer, concepts/post-processing, concepts/quality-preset-tables, concepts/quality-presets, concepts/render-graph, concepts/render-layers, concepts/shadows, concepts/static-dynamic.

Paths: pages are under `docs/` in the generated copy. Source paths are relative to the repository root. Line numbers are file lines (the stats file counts from the end of the front matter, so its numbers are 7 lower).

Findings 1 to 30 are ranked and checked against the source. Findings 31 onward are marked "not verified": they are lower ranked and were not re-checked against the code.

---

## Ranked findings

### 1. [high] quality-presets: internal notes reach the page
- Anchor: "### Moment transparency", line 214: "at High on this computer's GPU in Chrome 156" and "A phone's figure is owed".
- Category: internal-note
- Claim: "this computer" is the maintainer's machine, not the reader's. "A phone's figure is owed" is a to-do note that promises later work. Both break the rule that pages state what holds now and name the benchmark and the hardware.
- Evidence: docs/concepts/quality-presets.md:214; AGENTS.md "Writing docs" ("Never mention ... internal plans", "makes no promise of a later feature", "Name the engine's benchmarks when you cite a figure").
- Proposed edit: "In the S1 benchmark with its smoke switch, at High on a MacBook Pro in Chrome, the layer added about 0.05 ms of CPU time and 0.58 ms of GPU time per frame on WebGPU (about 16% of that scene's GPU frame), and about 1.12 ms on WebGL2 (about 20%). A phone's GPU has much less fill rate, so expect a larger share there." Remove "A phone's figure is owed".

### 2. [high] post-processing (and two guides): custom effects keep their joins at every render scale
- Anchor: "## Below the whole canvas's render scale", line 70, and "## Custom effects and tone curves", line 217.
- Category: wrong-claim
- Claim: The page says that while the render scale can drop, effects "do not join into fewer passes" and "each effect draws a pass of its own, at every scale". The renderer joins effects at every scale. Only the fold of the last effect into the final pass stops while the scale can drop. Because Low, Medium and High all let the scale drop, the wrong claim tells most readers that their effects never join. Line 60 also says "which the default presets allow", but Ultra keeps `minRenderScale` at 1.
- Evidence: crates/null3d-render/src/frame_graph.rs:2692-2698 ("The sketch's joins run at every render scale ... Folding is another matter ... a sketch whose scale can drop does not fold"); effects.rs:511-534 (`plan_units` uses the joins with no scale test); docs/concepts/quality-preset-tables.md:47 (Ultra's lowest scale is 1). The same wrong claim is in docs/guides/custom-passes.md:216 and docs/guides/lens-kit.md:109.
- Proposed edit: Line 70: "While the scale can drop, the last custom effect does not fold into the final pass. It draws a full-screen pass of its own, at every scale. Effects still join each other." Line 217: "The engine joins an effect that reads only its own pixel into the pass of the effect before it, at every render scale. While the render scale cannot drop below the whole canvas, and with bloom and FXAA off, the last pass also folds into the final pass." Line 60: "which the Low, Medium and High presets allow". Make the same fix in custom-passes.md:216 and lens-kit.md:109.

### 3. [high] quality-presets vs quality reference: GPU occlusion culling and the depth prepass
- Anchor: "### GPU occlusion culling", line 239: "It runs beside the depth prepass".
- Category: contradiction
- Claim: The concept page says occlusion culling runs beside the depth prepass. The generated reference says `gpuOcclusion` "is always false on WebGL2, and when the depth prepass is on". The renderer runs both: the prepass draws what the late culling kept. A reader who believes the reference turns off ambient occlusion, bounce light or contact shadows to keep occlusion culling, and gains nothing. It also matters because High and Ultra turn the prepass on through bounce light.
- Evidence: docs/concepts/quality-presets.md:239; docs/api/reference/quality.md:188; source packages/engine/src/quality/presets.ts:838-839; crates/null3d-render/src/frame_graph.rs:1724-1728 ("With the depth prepass, the prepass draws the objects that the second phase kept, after it"); docs/concepts/render-graph.md:74 agrees with the concept page.
- Proposed edit: In packages/engine/src/quality/presets.ts:838-839, change the TSDoc to "It is always false on WebGL2. With the depth prepass on, the prepass draws the objects that the late culling kept." Keep the concept page.
- Generated source: packages/engine/src/quality/presets.ts

### 4. [medium] post-processing: does the vignette run in one step or both?
- Anchor: "## Below the whole canvas's render scale", lines 62-63.
- Category: contradiction
- Claim: Step 1 "darkens the edges with the vignette", and step 2 also "darkens the edges with the vignette". Line 364 says the vignette multiplies HDR color before the tone mapping, which only step 1 holds. A reader cannot tell whether the picture is darkened once or twice below scale 1. The code sets the vignette flag in the settings of both steps, and the shader darkens the display color in step 2 as well. So either the doc of step 2 is wrong or the code darkens twice.
- Evidence: docs/concepts/post-processing.md:62, 63, 364; crates/null3d-render/src/final_pass.rs:459-476 (`settings()` sets `VIGNETTE` for any flags), 406-411 (step 1) and 438 (step 2 calls the same `settings`); crates/null3d-shaders/wgsl/final.wgsl:638-647 and 740 (`shade` is applied in `corner_display` in the upscale build).
- Proposed edit: Check with an image test at scale 0.5 with a strong vignette (the `lut-vignette-scale-50` test exists). If the vignette applies once, remove "darkens the edges with the vignette" from step 2. If it applies twice, fix the code (clear the flag for the second step) and keep step 1's text.

### 5. [medium] post-processing: the order of FXAA and the tone curve
- Anchor: diagram line 27 ("then the vignette, FXAA and tone mapping") and line 219 ("after bloom and before FXAA and dithering").
- Category: contradiction
- Claim: Lines 37 and 164, the API page and the shader all run FXAA first, on squeezed HDR color, then the vignette and the tone curve. The diagram puts FXAA after the vignette. Line 219 says a custom tone curve runs before FXAA, which is wrong. A writer of a tone curve may expect smoothed edges in display space.
- Evidence: crates/null3d-shaders/wgsl/final.wgsl:1-3 ("The FXAA build smooths edges first"), 753-771 (`pixel_color` then `shaded` then `display`); docs/api/post.md:109.
- Proposed edit: Diagram node: "Final pass: FXAA, then bloom and the adapted exposure, the vignette and tone mapping". Line 219: "The final pass calls it in place of the built-in curve, after FXAA, bloom and the vignette, and before the outline, the grading table and the dither."

### 6. [medium] shadows: "the default settings" assume a 200 m distance
- Anchor: "## Where the cascades split", line 194, and "## Blending between cascades", line 226.
- Category: wrong-claim
- Claim: Both say "With the default settings" and then use cascades that end at 200 m. The default `distance` is `'auto'` (line 145), so there is no fixed 200 m. A reader who works out texel sizes from this table gets wrong numbers.
- Evidence: docs/concepts/shadows.md:145, 155 ("than a fixed 200 m"), 194-200, 226; packages/engine/src/scene/scene.ts:705-713 (`'auto'`, the default).
- Proposed edit: Line 194: "With `distance: 200`, the other defaults, a 60 degree view and a 16:9 canvas, ...". Line 226: "With `distance: 200` and three cascades, the first cascade blends into the second from about 21.6 m to 24 m."

### 7. [medium] quality-preset-tables: rows that read as the whole truth but are not
- Anchor: "## Settings of each preset", rows `depthPrepass` (line 85), `gpuOcclusion` (line 86) and `bloom` (line 64).
- Category: unclear
- Claim: "Depth prepass: no (WebGL2: yes)" reads as "no prepass on WebGPU". But bounce light (on by default at High and Ultra) and contact shadows (High and Ultra) turn the prepass on, so a desktop at High draws it in every scene (quality-presets.md:220). "GPU occlusion culling: yes" on High and Ultra holds for desktops only; phones and tablets keep it off unless the page asks (quality-presets.md:237). "Bloom: yes" on every preset reads as "presets turn bloom on", but it only allows the bloom that `post.set` turns on; the lowest tier clears it.
- Evidence: docs/concepts/quality-preset-tables.md:64, 85, 86; docs/concepts/quality-presets.md:220, 237; packages/engine/src/quality/presets.ts:174-176 (bloom), 463-473 (gpuOcclusion), 240-251 (bounceRays on High and Ultra); packages/engine/src/page/engine.ts:2661-2666 (device rule); crates/null3d-render/src/frame_graph.rs:1730-1734 (effects turn the prepass on).
- Proposed edit: In tools/lib/docs.ts (or the labels in preset-docs.ts), add a short note column or footnotes: "Depth prepass: ambient occlusion, contact shadows, bounce light and screen-space reflections turn it on while they draw, so High and Ultra draw it on WebGPU too." "GPU occlusion culling: desktops only; phones and tablets keep it off unless the page sets `gpuOcclusion`." Rename the bloom row "Bloom allowed (`bloom`)" with the note "The sketch turns bloom on with `post.set`. The lowest quality tier turns it off."
- Generated source: packages/engine/src/quality/preset-docs.ts, tools/lib/docs.ts

### 8. [medium] quality-presets: the governor's diagram disagrees with its list
- Anchor: "## The frame-budget governor", diagram lines 291-298 and list lines 302-311.
- Category: contradiction
- Claim: The diagram shows four steps, numbered 1 to 4 (budgets and render scale, levels of detail, far cascades, filter). The list below numbers ten steps from 1 (levels of detail) to 10 (fog), so "step 2" means two different things. The diagram leaves out bloom, ambient occlusion, reflections, contact shadows, far animation and fog.
- Evidence: docs/concepts/quality-presets.md:293-297, 302-311; packages/engine/src/quality/governor.ts:1-9.
- Proposed edit: Drop the numbers from the diagram nodes, and end it with a node "Then bloom, ambient occlusion, reflections, contact shadows, far animation and fog, one step each". Or number the list from 2 so that the render scale is step 1 in both.

### 9. [medium] post-processing: screen-space bounce light is on by default and its costs are muddled
- Anchor: "## Screen-space bounce light", lines 313-337.
- Category: missing-content
- Claim: The section never says plainly that High and Ultra draw bounce light in every scene, without a `post.set` call, and that this turns the depth prepass on. It never says how to turn it off (`quality.set({ bounceRays: 0 })`). The costs appear twice: line 329 (2.475 ms and 1.326) and line 337 (2.5 ms and 1.3 ms). Both say Ultra with 8 rays costs half of High with 4 rays, with no reason, which looks like an error. The diagram at the top and the summary on line 11 leave bounce light out.
- Evidence: docs/concepts/post-processing.md:11, 13-35, 329, 337; packages/engine/src/quality/presets.ts:240-251 (same figures in the comment); docs/concepts/quality-presets.md:220.
- Proposed edit: Open the section with "High and Ultra draw bounce light in every scene, and it turns the depth prepass on. `quality.set({ bounceRays: 0 })` turns it off." Keep the figures only under "### Cost". Check the Ultra figure; if it is right, give the reason, for example that Ultra's scene took a different path. Add a "Bounce light" node beside ambient occlusion in the diagram.

### 10. [medium] render-graph: scene inputs that a reader cannot use, and a promise of later features
- Anchor: "## Scene inputs" table, lines 86-93, and "## Motion vectors", line 104.
- Category: unclear
- Claim: The table lists `'normals'` ("No pass makes them") and `'motionVectors'` beside the two usable inputs. Line 93 then says the "adapters" refuse `'motionVectors'`, a term the page never explains. So two of four rows are inputs no sketch can read. Line 104 lists temporal anti-aliasing and motion blur as users of motion vectors and then says "Today the motion debug view ... reads them". This reads as a promise of those features, and the engine has neither.
- Evidence: docs/concepts/render-graph.md:86-93, 104; AGENTS.md "makes no promise of a later feature".
- Proposed edit: Keep `'sceneColor'` and `'sceneDepth'` in the table. Add one sentence: "The names `'normals'` and `'motionVectors'` exist, but no pass makes normals, and custom materials and effects cannot read motion vectors." Line 104: "Only the motion debug view, `debug.view('motion')`, reads them." Remove the list of features that are not in the engine.

### 11. [medium] post-processing vs post API: settings tables in two places
- Anchor: bloom table lines 83-89, ambient occlusion table lines 235-243, reflections table lines 284-289.
- Category: duplication
- Claim: The same settings, defaults and ranges are in docs/api/post.md, and the copies have started to differ. The API page says reflections "fade out over the last fifth" of `maxDistance`. The concept page says they fade as a ray "nears `maxDistance`".
- Evidence: docs/concepts/post-processing.md:83-89, 235-243, 284-289, 292; docs/api/post.md:131-133, 163-169, 205-207.
- Proposed edit: Keep the settings tables on the API page. On the concept page keep one sentence per effect and a link, such as "[The post-processing API](../api/post.md#bloom) lists the settings." If the tables stay, put them in a `<details>` block "Technical details: the settings and their defaults", and make the text agree.

### 12. [medium] render-graph, post-processing and quality-presets: three versions of "final pass or resolve, one step or two"
- Anchor: render-graph lines 37, 65-66 and 80; post-processing lines 58-72; quality-presets line 287.
- Category: duplication
- Claim: Three pages each explain when the final pass runs, when the resolve pass replaces it, and when the final pass splits in two. The render-graph table row for the final pass reads as a list of conditions that all hold ("on the HDR path, with FXAA or no anti-aliasing, while the render scale can drop below 1, and while an effect needs it"). It is meant as alternatives. Line 37 ("So it does in the FXAA and no anti-aliasing modes") is hard to parse. quality-presets line 287 mixes hold mode, the 8-bit paths, the two steps and sharpening in one 176-word paragraph.
- Evidence: docs/concepts/render-graph.md:37, 65, 66, 80; docs/concepts/post-processing.md:58-72; docs/concepts/quality-presets.md:287.
- Proposed edit: Keep the full rule in post-processing "Below the whole canvas's render scale". Render-graph row: "Runs when any of these holds: the scene draws HDR color; the anti-aliasing is FXAA or none; the render scale can drop below 1; an effect needs it." Line 37: "The final pass takes the scene color to the canvas, except on the 8-bit path with MSAA, where the resolve pass does it." Cut quality-presets 287 to two sentences and a link.

### 13. [medium] Cross-page: "hold mode" used with no explanation
- Anchor: quality-presets lines 85, 124, 287, 317; post-processing lines 178, 400; static-dynamic line 74.
- Category: term-before-definition
- Claim: These pages say "hold mode" with no link and no definition. The reader learns what it is only from the testing guide.
- Evidence: docs/guides/testing.md (defines hold mode); docs/api/page.md.
- Proposed edit: At the first use on each page write "[hold mode](../guides/testing.md), which draws one fixed frame for image tests,".

### 14. [medium] Cross-page: benchmark and showcase names used with no explanation
- Anchor: quality-presets lines 63, 122 ("Skyway"), 212 ("the Island showcase"), 214 ("S1"), 222 ("S4"); shadows lines 192, 241, 243, 245, 271, 292, 302, 304 ("S4"); static-dynamic line 74 ("S2").
- Category: term-before-definition
- Claim: The reader is not told what S1, S2 or S4 are, or that Skyway and Island are showcase demos. The performance guide defines S4 ("a town of 5,000 still objects and 200 moving vehicles").
- Evidence: docs/guides/performance.md:82; examples/demos.ts (`skyway`, `island`).
- Proposed edit: At first use write "the S4 benchmark ([a town of 5,000 still objects and 200 vehicles](../guides/performance.md))". Link Skyway and Island to https://github.com/null3d-engine/null3d/tree/main/examples/showcase/skyway/ and .../showcase/island/.

### 15. [medium] render-graph and shadows: "GPU-driven path" and "a device that draws directly"
- Anchor: render-graph diagram line 15 ("GPU-driven path only") and line 76; shadows line 420.
- Category: term-before-definition
- Claim: Both terms appear with no explanation or link. A reader cannot tell which devices take the direct path, or that the job workers then cull on WebGPU too.
- Evidence: docs/concepts/culling.md:38; docs/concepts/backends.md:35.
- Proposed edit: Diagram: "Culling<br/>on WebGPU, unless the device draws directly". Line 76 and shadows 420: "On a device that draws directly ([Culling](culling.md#how-each-path-culls): some Apple GPUs, after a start-up measurement), ...".

### 16. [medium] materials: the page promises pipeline warm-up but gives no way to do it
- Anchor: front matter summary ("pipeline warm-up") and "## Why a new combination can make a frame late", line 121.
- Category: missing-content
- Claim: The page says to "use its combinations in the first frames", but it does not name the warm-up tools: the `preload` option of `createEngine` (shadows.md:425 shows `preload: ['cutout']`) and the loading screens guide. It does not link the guide. The summary says "permutations", and the body says "variants".
- Evidence: docs/concepts/materials.md:6, 121, 123-128; docs/concepts/shadows.md:425; docs/guides/loading-screens.md.
- Proposed edit: Add: "Pass the shader features you know you will need to `createEngine({ preload })`, and keep a loading screen until `engine.firstFrame` resolves. [Loading screens and warm-up](../guides/loading-screens.md) shows how." Add the guide to "Related pages". Use "variants" in the summary.

### 17. [medium] particle-buffer: "Coding agents must not use these calls" and "the core"
- Anchor: the note under the title, line 11; lines 15, 24, 33, 138-169 ("the core", "the engine's core").
- Category: unclear
- Claim: The note gives an order to AI agents in a page for people, with no reason, while the rest of the page teaches the calls. A human reader cannot tell whether the calls are safe. "The core" is used as a name and never explained or linked.
- Evidence: docs/concepts/particle-buffer.md:11, 15, 24, 140.
- Proposed edit: "This is a low-level API. The particles add-on fills the buffer for you, and the null3D agent skills always use the add-on. Write records yourself only for an emitter that the add-on does not fit." At first use: "the engine's core ([Architecture](architecture.md), the compiled part that runs the frame)".

### 18. [medium] post-processing: long paragraphs
- Anchor: lines 37 (226 words, 12 sentences), 39, 101, 155, 263, 299, 305, 307, 358, 392.
- Category: long-paragraph
- Claim: Line 37 holds the whole chain in one paragraph. Several sections bury implementer detail in the main text: GSR 1's taps (line 63), the bloom kernel and Karis average (lines 78-79), the meter's bins (lines 172-175, 187-188), RCAS (line 376) and the grading table (line 369).
- Evidence: stats.json concepts/post-processing longParagraphs (30, 32, 94, 148, 256, 292, 298, 300, 351, 385).
- Proposed edit: Split line 37 into three paragraphs: before the scene (AO and reflections), the HDR effects, the final pass. Move the dense parts into blocks that the main text does not need, for example:
  `<details><summary>Technical details: how GSR 1 scales the image</summary>` (line 63, from "The pass blends the four nearest texels") `</details>`; the same for bloom's kernel (lines 78-79), the meter (steps 1-3 and the meter table), RCAS (line 376) and the grading table (line 369). Split lines 305-307 into "what it adds" and "what it cost in the benchmark".

### 19. [medium] render-graph: long paragraphs
- Anchor: lines 33, 37, 68, 70, 74, 76 (211 words), 78 (175 words), 80, 93, 114, 142, 144, 158, 162.
- Category: long-paragraph
- Claim: Line 76 mixes what a view is, how each path culls, scene passes, `createView`, row order, the copy pass and a WGSL helper name (`reflection_uv`). Line 78 mixes full-screen passes, compute passes, order rules and vertex offsets.
- Evidence: stats.json concepts/render-graph longParagraphs.
- Proposed edit: Give line 76 a heading "Views" and split it: what a view is; scene passes and `createView`. Move row order, the copy pass and `reflection_uv` into `<details><summary>Technical details: image rows on WebGPU and WebGL2</summary> ... </details>`. Split line 78 into "Full-screen passes" and "Compute passes", with the vertex offset rule in a details block.

### 20. [medium] quality-presets: long paragraphs
- Anchor: lines 63, 85, 111, 120, 124, 128, 137, 163, 178, 184, 200, 202, 204, 212, 218, 220, 222, 224, 226, 237, 252, 287, 300, 313, 315, 317, 321, 323, 333 (29 paragraphs).
- Category: long-paragraph
- Claim: The page is 6,748 words, and most paragraphs run past 90 words. The dense parts are useful to implementers but stop the reader: the stored check's match rules (lines 128-139), moment transparency's bytes (line 212), the prepass's bit-exact depth (line 224), the governor's display-rate rules (lines 257-259).
- Evidence: stats.json concepts/quality-presets longParagraphs.
- Proposed edit: Keep one short paragraph per idea in the main text, and move these into details blocks: "Technical details: when a stored check result applies" (lines 130-139); "Technical details: the memory of moment transparency" (line 212); "Technical details: why both passes compute the same depth" (line 224); "Technical details: how the governor judges a second" (bullets at lines 256-259). Split line 63 into "tablets heat up" and "the iPad figures".

### 21. [medium] shadows: long paragraphs
- Anchor: lines 27, 29, 76, 115, 117, 133, 155, 157, 161, 208, 224, 243, 271, 275, 277, 286, 292, 300, 304, 308, 310, 318, 343, 347, 403, 427, 429, 433, 435, 439 (30 paragraphs).
- Category: long-paragraph
- Claim: The page is 7,488 words. Several sections are implementer detail that the main text does not need: depth steps and the bias floor (line 292), the face move and its measured figures (lines 300-304), flat casters' plane test (line 310), the GPU formats (line 439).
- Evidence: stats.json concepts/shadows longParagraphs.
- Proposed edit: Put these into details blocks: "Technical details: the depth precision of the shadow map" (line 292), "Technical details: how the engine moves casters' faces" (lines 300-304), "Technical details: the plane test of flat casters" (line 310), "Technical details: formats and reads on each GPU path" (line 439). Keep one sentence of each in the main text, such as "The engine moves each caster's back faces toward the light, so no lit line shows at an object's base."

### 22. [low] quality-presets: the lowest tier uses undefined windows
- Anchor: "### The lowest quality tier", lines 321-327.
- Category: unclear
- Claim: "the sustained window" and "the window that raises a step" are not defined. "a third-size render scale floor" is unclear. A start in the tier (after two crashes, or `?tier=lowest`) also fixes `maxRenderScale` at the floor, which the page does not say.
- Evidence: docs/concepts/quality-presets.md:321, 325; packages/engine/src/quality/presets.ts:938-959 (`lowestTierSettings` adds `maxRenderScale`).
- Proposed edit: "The governor enters the tier when the render scale has stayed at its floor for a second over budget and the frames still miss. Its cuts: a render scale floor of one third, ... A start in the tier also caps the render scale at one third." Replace "the window that raises a step" with "5 seconds with time to spare".

### 23. [low] post-processing: the phone bloom example uses a base that phones do not run
- Anchor: "### Cost" under Bloom, line 114.
- Category: contradiction
- Claim: Line 101 says Low, which phones run, uses a base of 64. Line 114 gives the phone figure "at a base of 128".
- Evidence: docs/concepts/post-processing.md:101, 114; docs/concepts/quality-preset-tables.md:63.
- Proposed edit: Give the figure at 64, or say "at a base of 128, which a sketch can set".

### 24. [low] quality-preset-tables: bounce light printed as "rays each way"
- Anchor: row "Screen-space bounce light (`bounceRays`)", line 71.
- Category: wrong-claim
- Claim: "4 rays each way" copies the wording of the skin blur row. The setting is the rays that each texel casts.
- Evidence: packages/engine/src/quality/preset-docs.ts:106-108; presets.ts:240 and 658 ("The rays that each texel of screen-space bounce light casts").
- Proposed edit: In preset-docs.ts:108 print `${value} rays per texel`.
- Generated source: packages/engine/src/quality/preset-docs.ts

### 25. [low] post-processing and quality-presets: wording that tells history
- Anchor: post-processing line 60 ("exactly as before the split"), 158 and 358 ("where it could be thrown away before"), 398 ("as before"); quality-presets line 287 ("which the pass at the whole canvas's scale always did").
- Category: wrong-claim
- Claim: These phrases describe what changed, not what holds now.
- Evidence: AGENTS.md "Every file ... states what holds now".
- Proposed edit: "At the whole canvas's scale one pass does that work." "The scene's render pass keeps its depth for the setup and the composite." "Those views draw every frame." "the first draws at the render size and smooths edges with FXAA".

### 26. [low] particle-buffer: "softness" used before it is explained
- Anchor: "## Limits", line 192.
- Category: term-before-definition
- Claim: "A softness above 0" is the first mention of the option. The page never says what it does.
- Evidence: packages/engine/src/scene/particles.ts:149-153.
- Proposed edit: "The `softness` option fades particles near the surfaces behind them. A value above 0 makes the camera copy its opaque depth in each frame ...".

### 27. [low] materials: moment transparency called a quality setting
- Anchor: "## The transparent pass", line 109.
- Category: unclear
- Claim: "The quality setting `momentTransparency`" makes a reader try `quality.set`. It is a `createEngine` option and a page switch, fixed while the engine runs.
- Evidence: docs/concepts/quality-presets.md:210; docs/api/materials.md:686.
- Proposed edit: "The `momentTransparency` option of `createEngine`, which stays fixed while the engine runs, blends the same surfaces ...".

### 28. [low] shadows: "the demo's 4.4 m car" with no demo named
- Anchor: "## A hero shadow", line 392.
- Category: unclear
- Claim: The demo is named only in "Related pages".
- Evidence: docs/concepts/shadows.md:392, 448.
- Proposed edit: "the [hero shadow demo](https://github.com/null3d-engine/null3d/tree/main/examples/hero-shadow/)'s 4.4 m car".

### 29. [low] static-dynamic: the row check is described twice, in long paragraphs
- Anchor: "## Setters and direct writes", lines 74 (158 words) and 76; line 106.
- Category: duplication
- Claim: Line 74 and line 76 both say that the development check reads static batch rows in turns and raises E1110 within a few frames. Line 74 also holds the benchmark cost and hold mode.
- Evidence: stats.json concepts/static-dynamic longParagraphs (67, 69, 99).
- Proposed edit: Keep the batch rule in line 76 only. Move the turn size (4,096 rows a frame), the S2 cost and the hold mode note into `<details><summary>Technical details: the development check</summary> ... </details>`.

### 30. [low] render-layers: E1207 not linked, unclear limit
- Anchor: "## Setting layers", line 66.
- Category: unclear
- Claim: E1207 is the only error code in the slice with no link. "a mask that is not a whole number of 32 bits" is hard to parse.
- Evidence: docs/errors/E1207.md exists.
- Proposed edit: "In development builds, a mask that is not a whole number from `-(2 ** 31)` to `0xffffffff` throws [E1207](../errors/E1207.md)."

---

## Lower-ranked findings (not verified)

### 31. [low] Cross-page: "Roadmap step 0.x" in the note under every title (not verified)
- Pages: all nine. Source: tools/lib/steps.ts. "Roadmap step" is plan language. The docs home explains it (docs/index.md:34), but a reader who lands on a page does not know what a roadmap step is. Proposed: "Added in null3D 0.1.0." and keep the step in the front matter only. This is a maintainer policy (.dev/releases.md:45), so raise it with them.

### 32. [low] quality-presets: `?fps=` switch used with no explanation (not verified)
- Lines 132, 258. Proposed: explain it once, or link the page switches list in docs/api/page.md.

### 33. [low] materials: lighting jargon in the main text (not verified)
- Line 35: "split-sum terms", "light that bounces more than once". Move into `<details><summary>Technical details: the standard material's lighting model</summary>`.

### 34. [low] materials: long paragraphs (not verified)
- Lines 23, 85, 97, 113, 117. Split line 85 (alpha to coverage on WebGPU's HDR target) into a details block. Split line 97 into "why the pass exists" and "how the sort works".

### 35. [low] particle-buffer: long paragraphs (not verified)
- Lines 36, 52, 58, 140, 167, 173. Move `writeRecords` and `shiftRecords` detail (line 52) and the wind field (line 173) into details blocks.

### 36. [low] post-processing: vague test claim (not verified)
- Line 409: "The devices that the engine was tested on all draw HDR color". Name the device classes or remove.

### 37. [low] quality-presets: "one more layer" for a hero on Ultra (not verified)
- Line 178 says a hero adds a layer. On Ultra, at the limit of 24 layers, the hero takes one of them (shadows.md:393; crates/null3d-render/src/shadow_tiles.rs:877-882). Add "up to the atlas's limit of 24 layers".

### 38. [low] quality-preset-tables: "Frames drawn before each measurement: 250 ms" (not verified)
- Line 39 gives a time for a count of frames. Use "Time drawn before each measurement". Source: tools/lib/docs.ts.

### 39. [low] quality-presets: "tune from release to release" (not verified)
- Line 163 reads as a promise of change. Use "Each value is a starting point, measured on phones, tablets and desktops."

### 40. [low] post-processing: front matter summary is a 70-word list (not verified)
- Line 6. Shorten to "The effects after the scene: bloom, depth of field, exposure, ambient occlusion, reflections, outlines and the final pass."

---

## Screenshots and demos, per page

Reference images are in tests/image/references/chrome-real-gpu/<tier>/. A test image that is not a demo's default view counts as "scripted", with its test name.

### concepts/materials
Screenshots:
- `alpha-modes-side-by-side` (scripted). Under "## Alpha modes". Shows the mask, hash and alpha-to-coverage test images side by side, labeled. Steps: put the webgpu test images `alpha-mask.png`, `alpha-hash.png` and `alpha-coverage.png` (and `alpha-coverage-no-msaa.png`) in one row with captions. Alt: "The same cut-out leaves drawn with mask, hash and alpha to coverage". Sources: tests/image/manifest.ts, crates/null3d-shaders/wgsl/lit.wgsl.
- `weighted-transparency` (reference). Under "## The transparent pass", beside the weighted blending paragraph. Image: tests/image/references/chrome-real-gpu/webgpu/demo-weighted-transparency.png. Alt: "A glass pavilion whose overlapping panes blend without a sort".
- `pipeline-compile-stall` (manual). Under "## Why a new combination can make a frame late". Chrome DevTools Performance panel: one long frame when a material with a new option first draws, with the stats overlay open. Alt: "A long frame in the browser's performance panel when a new pipeline compiles".
Demo links: coat-and-sheen/ and iridescence-and-anisotropy/ (layer variants) under "## Fixed options choose the pipeline"; translucency/ (diffuseTransmission) and subsurface/ (subsurfaceRadius) under the same heading; weighted-transparency/ under "## The transparent pass"; shader-inputs/ under "## Custom materials share shaders"; decals/ under "## The built-in materials"; property-animation/ under "## Values cost almost nothing".
No demo: the shadow catcher material, the hash alpha mode, flat shading, `colorWrite: false`, the pipeline compile stall.

### concepts/particle-buffer
Screenshots:
- `particles-campfire` (reference). Under the opening paragraph. Image: webgpu/demo-particles.png. Alt: "Flames, embers and smoke in a campfire glade, all moved by the GPU".
- `particles-wind-field` (scripted). Under "## The wind field". The `particles-wind` test image. Alt: "Particles that drift with a wind field".
Demo links: particles/ under "## An emitter in the core" (it uses the add-on, which drives this path).
No demo: writing records by hand from sketch code, `writeRecords`, `shiftRecords` and the time base move, soft particles.

### concepts/post-processing
Screenshots:
- `post-effects-alley` (reference). Under the opening diagram. Image: webgpu/demo-post-effects.png. Alt: "A neon alley with bloom, ambient occlusion, reflections, an outline, depth of field and a vignette".
- `bloom-off-on` (scripted). Under "## Bloom". Test images `bloom-off`, `bloom-soft` and `bloom-strong` side by side. Alt: "The same scene without bloom, with soft bloom and with strong bloom".
- `bloom-size-presets` (scripted). Under "### The size of the base". One demo (post-effects) at `bloomSize` 64 and 512 side by side. Steps: hold the demo's default pose, `quality.set({ bloomSize })` with each value. Alt: "Bloom's glow at a base of 64 and of 512".
- `depth-of-field` (reference). Under "## Depth of field". Image: webgpu/demo-camera-lens.png. Alt: "A chess board with the near pawn sharp and the far pieces blurred".
- `auto-exposure` (reference). Under "## Automatic exposure". Image: webgpu/demo-auto-exposure.png. Alt: "A dark stone hall after the eye has adapted".
- `ao-off-on` (scripted). Under "## Ambient occlusion". Test images `ao-off` and `ao-default` side by side. Alt: "A scene without and with ambient occlusion".
- `ssr-wet-street` (reference). Under "## Screen-space reflections". Image: webgpu/demo-wet-street.png. Alt: "Puddles that mirror lit windows and neon signs".
- `bounce-off-on` (scripted). Under "## Screen-space bounce light". Test images `bounce-off` and `bounce-bounce` side by side. Alt: "A red and green room without and with bounce light".
- `outline` (scripted). Under "## Outlines". Test images `outline-plain` and `outline-hidden`. Alt: "An outlined object, with the hidden part in its second color".
- `vignette-and-grade` (scripted). Under "## Color grading and the vignette". Test images `lut-cube` and `lens-vignette`. Alt: "A grading table and a vignette on the same scene".
- `sharpen` (scripted). Under "## Sharpening". Test image `sharpen` beside the same frame without it, cropped to show fine detail. Alt: "Fine detail before and after sharpening".
- `still-accumulation` (scripted). Under "## Still-camera accumulation". Test image `still` beside a moving frame, cropped at an edge. Alt: "An edge in a moving frame and in a still view after blending".
- `render-scale-half` (scripted). Under "## Below the whole canvas's render scale". Test images `render-scale-50` and a scale-1 frame, cropped. Alt: "A frame at half the render scale, scaled up by GSR 1".
Demo links: post-effects/ under the opening; camera-lens/ under "## Depth of field"; auto-exposure/ under "## Automatic exposure"; wet-street/ under "## Screen-space reflections"; bounce-light/ under "## Screen-space bounce light"; picking/ under "## Outlines"; atmosphere/ or light-shafts/ under the volumetric fog mention.
No demo: custom tone curves, color grading tables (no demo loads a table), dithering, the 8-bit path's fallbacks.

### concepts/quality-preset-tables
Screenshots:
- `presets-side-by-side` (scripted). Under "## Settings of each preset". The island showcase at its default pose with `?preset=low`, `medium`, `high` and `ultra`, four tiles in one row. Alt: "The same island view at Low, Medium, High and Ultra". Sources: packages/engine/src/quality/presets.ts.
- `stats-overlay-preset` (scripted). Under "## Starting preset of each device". The stats overlay open over a demo, showing the preset, target and render scale. Alt: "The stats overlay with the chosen preset and the target frame rate".
Demo links: showcase/island/ under "## Settings of each preset".
No demo: the device rules, the GPU path caps and the check rules.

### concepts/quality-presets
Screenshots:
- `presets-side-by-side` (scripted). Under "## The settings of each preset". Same as on the tables page. Alt: "The same view at each preset".
- `stats-overlay-governor` (scripted). Under "## The frame-budget governor". The stats overlay while the governor has lowered the render scale and a shadow step, on a heavy demo (forest). Alt: "The stats overlay with the render scale and the governor's steps".
- `render-scale-softness` (scripted). Under "## Dynamic resolution". Test images `render-scale-75` and `render-scale-50` cropped beside scale 1. Alt: "A detail at render scales 1, 0.75 and 0.5".
- `devtools-localstorage` (manual). Under "### Repeat visits". Chrome DevTools Application panel with the stored check result in localStorage. Alt: "The stored preset check in the browser's local storage".
Demo links: forest/ (heavy scene for the governor) under "## The frame-budget governor"; showcase/island/ under "### Moment transparency" (it starts with moment transparency); hold-mode/ under the first hold mode mention.
No demo: the crash notes, the preset check before play, texture memory budgets, the lowest quality tier, add-on feature settings.

### concepts/render-graph
Screenshots:
- `graph-dump` (scripted). Under "## The text dump". The `render.dumpGraph()` output of the post-effects demo rendered with Graphviz. Alt: "The render graph of a frame, with passes in order".
- `motion-view` (scripted). Under "## Motion vectors". Test image `motion-vectors` (the `debug.view('motion')` view). Alt: "The motion debug view, colored by each pixel's motion".
- `devtools-webgpu-passes` (manual). Under "## Phone GPUs". A GPU capture or the browser's WebGPU inspector showing load and store ops of the scene render pass. Alt: "The scene's render pass with its attachments' load and store".
Demo links: security-camera/ (scene pass into a texture) under "## The engine's passes"; multiple-views/ (createView) under the views paragraph; post-effects/ under "## The text dump".
No demo: compute passes added by a sketch, pass switching, the graph's errors.

### concepts/render-layers
Screenshots:
- `layers-cottages` (reference). Under the opening paragraph. Image: webgpu/demo-layers.png. Alt: "A cottage street with roofs and map pins on layers of their own".
- `layers-two-masks` (scripted). Under "## Setting layers". The layers demo held at two layer masks, side by side (pins on and off). Alt: "The same street drawn with and without the map pin layer".
Demo links: layers/ (already linked) under "## Setting layers"; multiple-views/ under "## Layers and visibility" if its views use masks.
No demo: layers and shadows (an object off the light's layers).

### concepts/shadows
Screenshots:
- `cascades-debug-view` (scripted). Under "## Where the cascades split". The `'shadows'` debug view with cascades colored (test image `debug-view-shadows`). Alt: "The shadow cascades colored by distance".
- `cascade-count` (scripted). Under the settings table. Test images `shadows-cascades-1`, `shadows-cascades-2` and `shadows-cascades-4` side by side. Alt: "The same shadows with one, two and four cascades".
- `filter-3-and-5` (scripted). Under "## Filtering". Test image `shadows-filter-5` beside the 3 x 3 default, cropped at an edge. Alt: "A shadow edge with the 3 x 3 and the 5 x 5 filter".
- `contact-shadows` (reference). Under "## Contact shadows". Image: webgpu/demo-contact-shadows.png, beside test image `contact-shadows-off`. Alt: "Pebbles on sand with and without contact shadows".
- `hero-shadow` (reference). Under "## A hero shadow". Image: webgpu/demo-hero-shadow.png, with demo-hero-shadow-tile-1024.png beside it. Alt: "A car's sharp hero shadow beside cascade shadows".
- `spot-point-shadows` (scripted). Under "## Spot and point light shadows". Test images `spot-shadows` and `point-shadows`. Alt: "Shadows from a spot light and from a point light".
- `cascade-camera-debug` (scripted). Under "## Stable cascades". `debug.shadowCamera` placing the cascades from a moving camera, seen from a still one. Alt: "The cascade boxes seen from outside the camera".
Demo links: contact-shadows/ under "## Contact shadows"; hero-shadow/ under "## A hero shadow"; spot-cookies/ under "## Spot and point light shadows"; forest/ under "## What shadows cost" (levels of detail in shadows).
No demo: point light shadows, flat casters, followMovingCasters and far cascade intervals, cascade blending.

### concepts/static-dynamic
Screenshots:
- `instances-columns` (reference). Under "## Dirty ranges in instance batches". Image: webgpu/demo-instances.png. Alt: "100,000 columns in one batch, with hover cars above them".
- `e1110-console` (manual). Under "## Setters and direct writes". The browser console showing the E1110 error that names the object after a direct write to a static batch row. Alt: "The development build's E1110 error in the console".
Demo links: instances/ under "## Dirty ranges in instance batches"; terrain/ or impostors/ (they call `markDirty`) under the static batch example; hold-mode/ under the hold mode mention.
No demo: hidden groups that stop recomputing, grid cells kept in view by a static object.
