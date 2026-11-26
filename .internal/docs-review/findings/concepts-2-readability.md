# Readability and layout review: slice concepts-2

Pages: concepts/materials, concepts/particle-buffer, concepts/post-processing, concepts/quality-preset-tables, concepts/quality-presets, concepts/render-graph, concepts/render-layers, concepts/shadows, concepts/static-dynamic.

Line numbers are file lines in `docs/concepts/<page>.md`, front matter included. A stats.json paragraph line is the file line less 7 on every page in this slice (each has 7 lines of front matter).

A "technical details block" means:

```
<details>
<summary>Technical details: what is inside</summary>

Markdown body.

</details>
```

The main text must read correctly with every block closed. No headings and no nested blocks inside.

Findings 1 to 30 are verified against the page text. Findings 31 to 43 are marked "not verified": I saw the issue, but I did not check every line it touches.

---

## 1. quality-presets: anti-aliasing and the memory maximum sit under "Texture memory" (high, structure)

- Anchor: `### Texture memory`, lines 182 to 206.
- Claim: The H3 "Texture memory" holds the texture budget (184 to 202), and then two unrelated paragraphs. Line 204 covers FXAA against MSAA. Line 206 covers the engine memory maximum. A reader who scans the outline for anti-aliasing finds nothing, and the outline says these paragraphs are about textures. The H2 "The settings of each preset" also opens with four paragraphs that have no headings: pixel ratio (167), shadow memory with a table (169 to 178), and anisotropy and uploads (180).
- Evidence: line 204 "Low smooths edges with FXAA, and the other presets with MSAA." Line 206 "The engine makes its memory while it tests the GPU paths." Both come after the texture mip-drop paragraphs, before `### Moment transparency`.
- Proposed edit: Give each topic in the H2 its own H3: "Pixel ratio cap" (167), "Shadow memory" (169 to 178), "Texture filtering and uploads" (180), "Texture memory" (182 to 202), "Anti-aliasing" (204), "Engine memory" (206), then the existing "Moment transparency", "The depth prepass" and "GPU occlusion culling".

## 2. quality-presets: the governor diagram and the step list number the steps differently (high, contradiction)

- Anchor: `## The frame-budget governor`, diagram lines 291 to 298 and list lines 302 to 311.
- Claim: The diagram numbers four steps: 1 sketch budgets and render scale, 2 levels of detail, 3 far cascades, 4 shadow filter. The list below it numbers ten steps from 1 = levels of detail to 10 = volumetric fog. So "step 3" is the far cascades in the diagram and the shadow filter in the list. The diagram also leaves out list steps 4 to 10 (bloom, AO twice, SSR, contact shadows, far animation, fog).
- Evidence: diagram `detail["2. Levels of detail ..."]`, `far["3. Far shadow cascades ..."]`, `filter["4. Shadow filter: 3 x 3 texels"]`. List: "1. The `lodThreshold` ... doubles", "2. The far shadow cascades draw half as often", "3. The shadow filter blends 3 x 3".
- Proposed edit: Remove the numbers from the diagram nodes. Draw three nodes: "Sketch budgets and render scale, in turn", "Detail, shadow and effect steps, in the order below", "One step back up, in reverse order". Or start the list with a step 1 for the budgets and render scale, and renumber the rest, so the diagram and the list share numbers.

## 3. post-processing: the opening paragraph is a 226-word wall that walks the whole chain (high, wall-of-text)

- Anchor: line 37, "Ambient occlusion and screen-space reflections run before the scene's opaque objects shade." (stats line 30: 226 words, 12 sentences).
- Claim: The first paragraph after the diagram gives the full order of the chain in prose. It covers the prepass, AO, SSR, HDR color, exposure, fog, custom effects, DOF, bloom, FXAA, vignette, AgX, sRGB, outlines, grading and dither. It also links three other pages and a later section. A newcomer cannot hold this order in their head. The diagram already shows it.
- Evidence: stats.json concepts/post-processing longParagraphs line 30, 226 words, 12 sentences.
- Proposed edit: Replace it with two short sentences ("Each frame draws the scene into an HDR target, runs the effects on it, and then one final pass turns it into the canvas's colors.") and a numbered list of the stages, one line each:
  1. Before the scene shades: depth prepass, ambient occlusion, screen-space reflections.
  2. Scene passes into linear HDR color, already exposed.
  3. HDR effects in order: volumetric fog, custom effects, depth of field, bloom.
  4. Final pass: FXAA, bloom blend, vignette, tone curve (AgX by default), sRGB.
  5. In the same pass: outline line, color grading table, dither.

  Keep the sentence about full-screen pass cost (line 39) after the list.

## 4. render-graph: the core idea comes after a 26-row table and six dense paragraphs (high, scan-order)

- Anchor: `## The engine's passes` (line 39) before `## Why passes are declarations` (line 116) and `## How the graph orders passes` (line 129).
- Claim: A newcomer needs three things first: what a declaration is, why passes are data, and how the order follows from reads and writes. Today they first meet a 26-row pass table and the paragraphs at lines 68 to 80 (GPU occlusion, views, row flips, final against resolve). The page also has no `render.addPass` example. A concept page should show an example after its explanation.
- Evidence: heading outline in stats.json. The only code is the DOT dump at line 191.
- Proposed edit: Use this order: intro (33 to 37), "Why passes are declarations", "How the graph orders passes", a short `render.addPass` example (a scene pass whose texture a material shows, like the security camera demo), "Targets and memory", "Phone GPUs", "Switching passes on and off", "Passes that nothing uses", "Checks", "The text dump". Then "The engine's passes" as a reference section, with "Scene inputs" and "Motion vectors" after it.

## 5. shadows: spot and point lights break up the directional light's story, and "who casts" comes last (high, scan-order)

- Anchor: `## Spot and point light shadows` (line 62) and `## Which objects cast and receive` (line 405).
- Claim: The page opens on the sun's cascades (25 to 60). Then it switches to the spot and point light atlas (62 to 135). Then it goes back to the sun's `shadow` settings, the cascade split, stability, blending and update rates (137 to 271). The basic rules a newcomer needs first come near the end, at line 405: the first directional light alone casts, layer masks choose casters, and unlit objects show no shadows. Line 27 adds instance batch and `followMovingCasters` detail before the reader knows what a cascade is.
- Evidence: heading outline in stats.json. Line 407: "The first directional light created casts the shadows ... A fifth directional light lights nothing."
- Proposed edit: Order: intro and first example, "Which objects cast and receive", "Settings", the cascade sections (split, stable, blending, update rates), "Filtering", "Bias", "Contact shadows", "Spot and point light shadows", "A hero shadow", "What shadows cost", "On each GPU path". Move the instance-batch paragraph (27) into "Which objects cast and receive".

## 6. post-processing: one page of 7,853 words holds two kinds of effect (high, split-page)

- Anchor: whole page. 27 headings, 10 long paragraphs.
- Claim: The page holds the chain, the final pass, and eleven effects. Ambient occlusion, screen-space reflections and screen-space bounce light are not post effects: they run before the opaque pass and feed its shading. They share a grid, a depth copy and the prepass (lines 37, 272, 301, 319). They make one natural page. The rest (bloom, depth of field, exposure, custom effects, outlines, grading, sharpening, dithering, still-camera accumulation, devices without HDR) is the true chain.
- Evidence: stats.json words 7,853. Line 301: "Screen-space reflections and ambient occlusion share one grid". Line 319: "The light draws on ambient occlusion's grid ... and it reuses that feature's depth copy and normals".
- Proposed edit: Split out `concepts/screen-space-lighting` ("Ambient occlusion, reflections and bounce light"), with the AO, SSR and bounce light sections and one shared section on the grid, the prepass and the frame-before color copy. Keep a one-paragraph summary and a link on the post-processing page. Add the new page to AREAS/PAGES in tools/lib/docs.ts, and update the links from shadows.md (343), quality-presets.md (220) and lighting pages.

## 7. quality-presets: one page of 6,748 words covers three topics, as its title says (high, split-page)

- Anchor: title "Quality presets, dynamic resolution and frame budgets". 29 long paragraphs.
- Claim: Choosing a preset (how, crashes, the check, switching, settings) is a start-up topic. Dynamic resolution and the governor are a during-play topic with their own diagrams, rules and API (`quality.renderScale`, `quality.setBudget`, `quality.governor`). Together they make the longest page in the slice after post-processing, with 29 paragraphs over the limit.
- Evidence: stats.json words 6,748, longParagraphs count 29.
- Proposed edit: Keep `concepts/quality-presets` for lines 9 to 239. Move "Dynamic resolution", "The frame-budget governor", "The lowest quality tier" and "Settings of an add-on's feature" (241 to 333) to a new `concepts/frame-budget` ("Dynamic resolution and the frame-budget governor"). Give each page its own diagram, and link them both ways. Inbound links to `quality-presets.md#dynamic-resolution` and `#the-frame-budget-governor` (post-processing.md 60, 107; render-graph.md 142; guides/phones.md 91) move with them.

## 8. shadows: one page of 7,488 words, with artifact fixes mixed into setup (medium, split-page)

- Anchor: whole page. 22 headings, 30 long paragraphs.
- Claim: "Bias", "Where shadows meet their casters", "Flat casters", "Contact shadows" and "Grass and other thin surfaces" (279 to 358) explain how the engine fights acne, peter-panning and lost contact. A reader who only wants to turn shadows on must scroll past them to reach the hero shadow, the cost and the casting rules. The page is long enough to split.
- Evidence: stats.json words 7,488, 30 long paragraphs.
- Proposed edit: Move lines 279 to 358 to a new `concepts/shadow-bias` ("Shadow bias and contact shadows"). Keep a short "Bias" section on the shadows page: what acne is, the two settings, "raise them in small steps", and a link. If the split is refused, put the algorithm parts in technical details blocks instead (finding 26).

## 9. quality-presets: the moment transparency section holds a note to maintainers (medium, internal-note)

- Anchor: `### Moment transparency`, line 214.
- Claim: "at High on this computer's GPU in Chrome 156" names a machine the reader cannot know. "A phone's figure is owed" promises a later measurement, which the writing rules forbid. Line 212 (192 words) is byte arithmetic that helps implementers but buries the point.
- Evidence: line 214 "In the S1 benchmark with its smoke switch, at High on this computer's GPU in Chrome 156, ... A phone's figure is owed, and a desktop GPU's fill rate is not a phone's."
- Proposed edit: Name the machine as the other pages do ("on a MacBook Pro in Chrome"). Remove "A phone's figure is owed". Keep "A desktop GPU's fill rate is not a phone's, so measure on the phone." Main text: "The layer adds 32 to 36 bytes per pixel of targets, and about 0.6 ms of GPU time a frame on WebGPU in the S1 benchmark." Move line 212's breakdown into "Technical details: the moment layer's memory".

## 10. Cross-page: benchmark and scene names appear with no explanation (medium, term-before-definition)

- Pages: concepts/static-dynamic, concepts/quality-presets, concepts/shadows.
- Claim: The pages cite "S1", "S2", "S4", "Skyway" and "the Island showcase" as if the reader knows them. Only guides/performance.md line 82 says what S1 and S4 are. S2 is never described on these pages. Skyway is never explained anywhere a reader can find from here.
- Evidence: static-dynamic 74 "In the S2 benchmark on a MacBook Pro". quality-presets 63 "In the S4 benchmark", 122 "while Skyway drew", 212 "on the Island showcase", 214 "In the S1 benchmark with its smoke switch", 222. shadows 192 "as in the S4 benchmark scene 42 m up", 241, 243, 245, 271, 292, 302, 304.
- Proposed edit: At the first mention on each page, add a short gloss and a link: "the S4 benchmark, a town of 5,000 still objects and 200 moving vehicles ([Performance guide](../guides/performance.md#phones-and-tablets))". For S2: "a scene graph of 5,096 objects, 6 levels deep". Replace "while Skyway drew" with a plain description of the scene, or remove it. Later mentions on the same page can use the short name.

## 11. post-processing: algorithm steps and long paragraphs come before the call that turns each effect on (medium, technical-details-block)

- Anchor: bloom 76 to 81, depth of field 122 to 127, automatic exposure 170 to 175, ambient occlusion 223 to 229, SSR 272 to 277, bounce light 321 to 323, outlines 344 to 346. Long paragraphs (stats line + 7): 39, 101, 155, 263, 299, 305, 307, 358, 392 (the opening at 37 is finding 3).
- Claim: Each effect section opens with a numbered list of how the GPU builds the effect: 13-tap downsample, Karis average, spiral gather, horizon slices, Hi-Z march. Only after that comes the `post.set` call and the settings table. A user wants "what it does, how to turn it on, what to set". The implementer wants the steps. The steps are correct and useful, so they belong in blocks, not cut. Line 392 (104 words) packs the whole still-camera life cycle into one paragraph.
- Evidence: stats.json long paragraphs at lines 30, 32, 94, 148, 256, 292, 298, 300, 351, 385. Line 79 "with the weights of Call of Duty: Advanced Warfare's bloom ... a Karis average".
- Proposed edit: Use the same shape in every effect section: one or two sentences on what it looks like, the code example, the settings table, the user-facing bullets, then "Technical details: how bloom draws" (and so on) holding the numbered steps. Split line 155 into a sentence on passes and a cost list. Split line 263 so the three.js comparison is its own sentence group. Turn line 392 into a list: what happens while still, when it stops, what restarts it.

## 12. post-processing: seven H3s all named "Cost" (medium, heading-depth)

- Anchor: `### Cost` under Bloom (109), Depth of field (153), Automatic exposure (194), Ambient occlusion (261), Screen-space reflections (303), Screen-space bounce light (335), Outlines (356).
- Claim: The page outline shows "Cost" seven times. The anchors become `#cost`, `#cost-1` and so on, so other pages cannot link to one effect's cost in a stable way. Each block is mostly benchmark figures and byte counts: dense, correct, implementer-facing.
- Evidence: stats.json heading outline.
- Proposed edit: Rename each to "What bloom costs", "What depth of field costs", and so on. Or keep one sentence of cost in the main text ("Bloom adds about 0.8 ms on a MacBook Pro at 1920 x 1080.") and move the rest into "Technical details: bloom's passes, memory and timings". Either way, each anchor becomes unique.

## 13. quality-presets: the depth prepass section is four long paragraphs, and it reads against the table (medium, structure)

- Anchor: `### The depth prepass`, lines 218 to 226.
- Claim: Line 220 (151 words, 12 sentences) mixes four topics: which objects skip the prepass, the default on each path, which effects force it on, and how to override it. It ends with "So High and Ultra draw it on WebGPU outside compatibility mode, where the bounce light runs." The settings table on quality-preset-tables says `depthPrepass` is "no (WebGL2: yes)" on High and Ultra. The reader must work out that the setting and what draws are two different things. Line 224 (exact depth equality on each path) is implementer detail.
- Evidence: stats.json lines 211, 213, 215, 217, 219 (file 218 to 226). quality-preset-tables line 85.
- Proposed edit: Add a small table, "When the prepass draws", with rows WebGL2, WebGPU and compatibility mode. Give it these columns: "Preset default", "Turned on by" (AO, contact shadows, SSR, bounce light), "Turned off by" (lowest tier, `depthPrepass: false`). State that High and Ultra on WebGPU draw it because bounce light is on there. Keep the Apple figures (222) as two short sentences. Move line 224 into "Technical details: why both passes compute the same depth". Keep the tie advice in 226 (give decals a depth bias) in the main text.

## 14. particle-buffer: the `frame` array's slots are spread over the page, and a second `frame` means something else (medium, term-before-definition)

- Anchor: line 58 "`frame[1]` says how many records ...", the example (95, 116 to 117), line 130 "`frame[0]`", line 190 "`frame[2]` ... `frame[3]`", and the emitter example (152 to 162) with `const frame = new Float64Array(5)`.
- Claim: Line 58 uses `frame[1]` before the page has said what `buffer.frame` is. Slot 0 comes 70 lines later, and slots 2 and 3 come under "Limits". The table at line 33 says the frame's values are "the time, the record count, the time shift and the wind texture's number" but gives no slot numbers. The emitter example then names a different five-number array `frame` too, with other slot meanings.
- Evidence: lines 33, 58, 95, 130, 155, 190.
- Proposed edit: Under "What the buffer holds", add a table "The frame's values": slot 0 time, 1 record count, 2 first record on the old time base, 3 seconds to take off, 4 wind texture (who writes it, the sketch or the emitter). Move the `frame[1]` paragraph (58) after the first example. In the emitter example, rename the array `emitArgs`, and list its five slots in a small table under the code, not in a code comment.

## 15. render-graph: lines 68 to 80 are six long paragraphs about different subjects under one heading (medium, long-paragraph)

- Anchor: `## The engine's passes`, file lines 37, 68, 70, 74, 76, 78, 80. Elsewhere: 93, 114, 142, 144, 158, 162.
- Claim: Line 76 (211 words, 12 sentences) defines a view, says who culls it on each path, explains scene passes, `scene.createView` viewports and WebGPU's row flip, and adds a reflection exception. Line 78 (175 words) covers full-screen and compute passes that a sketch adds, and when each runs. Line 80 (131 words) covers the final pass against the resolve pass. None has a heading, so they cannot be scanned or linked.
- Evidence: stats.json lines 30, 61, 63, 67, 69, 71, 73, 86, 107, 135, 137, 151, 155.
- Proposed edit: Add H2 "Views" for line 76. Make it a list: what a view is; one culling per view on each path; scene passes run before the camera; `createView` draws after, into a rectangle. Move the row flip and the `reflection_uv` exception into "Technical details: image rows on WebGPU and WebGL2". Turn line 78 into a table: "Pass a sketch adds | Runs | A material that shows it sees". Turn line 80 into a two-row table, "HDR path" and "8-bit path with MSAA", with "Pass that draws the canvas" and "Extra cost". Move the "so far" ordering rule at line 74 into a technical details block. Split 142 into two paragraphs: temporary targets, then kept targets.

## 16. quality-presets: 29 paragraphs over the limit (medium, long-paragraph)

- Anchor: file lines 63, 85, 111, 120, 124, 128, 137, 163, 178, 184, 200, 202, 204, 212, 218, 220, 222, 224, 226, 237, 252, 287, 300, 313, 315, 317, 321, 323, 333.
- Claim: Most of these mix a rule with its device figures. Examples: line 63 has the iPad heat story inside "How the engine chooses a preset". Line 124 has check timings on a MacBook and an iPad. Line 128 has repeat-visit first-frame times. Line 184 has the iPad tab-crash point.
- Evidence: stats.json longParagraphs for concepts/quality-presets (29 entries).
- Proposed edit:
  - 63: keep "Tablets start at Medium; name Low for a steady rate", with the code. Move the iPad figures into "Technical details: tablets that heat up".
  - 85: make a list of the crash note's rules (named presets, `?preset=`, `engine.mode.crashedStarts`, refused storage, hold mode, one note per module and origin).
  - 120 and 124: split into "What the target does" and "What the check skips"; move the timings into a block.
  - 128 and 137: move the figures and the "stores no result below 60" rule into a block.
  - 204 and 206: see finding 1.
  - 212 to 226: see findings 9 and 13.
  - 287, 300 to 333: see finding 19, and the split in finding 7.

## 17. shadows: 30 paragraphs over the limit (medium, long-paragraph)

- Anchor: file lines 27, 29, 76, 115, 117, 133, 155, 157, 161, 208, 224, 243, 271, 275, 277, 286, 292, 300, 304, 308, 310, 318, 343, 347, 403, 427, 429, 433, 435, 439.
- Claim: The worst cases are 439 (196 words, finding 25), 310 (161 words, 10 sentences), 208 (139 words, 8 sentences), 292 (133 words) and 427 (121 words). 208 packs three methods into one paragraph: sphere-fit boxes, texel snapping and depth-step snapping. 243 mixes the rule (far cascades follow moving casters) with S4 and three.js comparisons.
- Evidence: stats.json longParagraphs for concepts/shadows (30 entries).
- Proposed edit:
  - 208: main text "Shadow edges stay still while the camera moves and turns", plus the debug tip. A three-item list in "Technical details: how cascades stay stable".
  - 155 and 157: list "How `'auto'` picks the distance" and "When `'auto'` picks too far".
  - 243: rule first, then "A town whose cars drive through every cascade ..." as a separate example sentence.
  - 427 to 433: a cost table, "Part | Passes | Memory | Reads per receiving pixel", with rows for cascade, tile, hero tile and contact shadows.
  - 435: keep it as a bulleted checklist "To make shadows cheaper".

## 18. post-processing: "Below the whole canvas's render scale" comes second, before any effect (medium, scan-order)

- Anchor: `## Below the whole canvas's render scale`, lines 58 to 72.
- Claim: Right after the intro, the reader meets an 8-bit intermediate target, GSR 1's green-channel edge vote and twelve-texel weights, and a one-step 8-bit rounding difference. None of the effects have been introduced yet. The section is correct and needed, but it is an edge case of the final pass. Line 60 also says "exactly as before the split", which reads like a change log.
- Evidence: lines 60, 62, 63, 72.
- Proposed edit: Move the section to just before "Effects on devices without HDR color". Main text: "While the render scale can drop below 1, the final pass runs in two steps: tone map at the render size, then upscale with GSR 1 to the canvas. This costs one extra 8-bit target and stops custom effects joining passes. `quality.set({ minRenderScale: 1 })` avoids both." Move list items 1 and 2 and line 72 into "Technical details: the two steps and the upscaler". Remove "exactly as before the split".

## 19. quality-presets: dynamic resolution's bullets are dense, and line 287 repeats the post-processing page (medium, duplication)

- Anchor: `## Dynamic resolution`, bullets 256 to 264 and paragraph 287.
- Claim: The nine bullets mix the main rule (down 0.05 after one bad second, up 0.05 after 5 good seconds) with edge rules: the 2% quarter-second test, Safari timers, display-rate tracking, and 30-second trials that double up to 80 seconds. Line 287 (176 words) covers hold mode, the 8-bit paths, and the two-step final pass with GSR 1 and sharpening. post-processing.md lines 58 to 72 already explain the two steps.
- Evidence: line 287 "Below a scale of 1, the final pass runs in two steps: ... GSR 1, an edge-aware upscaler. [The post-processing chain](post-processing.md#below-the-whole-canvass-render-scale) describes both steps".
- Proposed edit: Keep four bullets in the main text: what it watches, when it steps down, when it steps up, and when it does not step. Move the quarter-second rule, Safari, the display-rate fall and the trial rule into "Technical details: how the controller judges a second". Cut line 287 to three sentences: a `minRenderScale` of 1 keeps the whole canvas; hold mode draws at `maxRenderScale`; below 1 the final pass runs in two steps (link). Drop the GSR and sharpening detail that the linked page owns.

## 20. render-graph: "Motion vectors" says "Today" and names features that do not read them (medium, wrong-claim)

- Anchor: `## Motion vectors`, line 104.
- Claim: "Temporal anti-aliasing, motion blur and reflections that reuse the last frame need them. Today the motion debug view ... reads them." A reader takes this to mean the engine has TAA or motion blur that reads motion vectors. "Today" also hints at later features, which the rules forbid. Line 93 says the adapters refuse `'motionVectors'`, so no add-on or sketch can read them.
- Evidence: line 104. Line 93: "the adapters refuse `'motionVectors'`".
- Proposed edit: "Motion vectors record how far each pixel's surface moved on screen since the last frame. Only the motion debug view, `debug.view('motion')`, reads them. Add-on features and custom materials cannot read them." Remove "Today" and the list of features that need them.

## 21. shadows: "A fixed distance and a camera that zooms" holds two paragraphs that are not about zooming (medium, structure)

- Anchor: `### A fixed distance and a camera that zooms`, lines 159 to 185.
- Claim: After the zoom example, line 183 says a new cascade count or map size remakes the shadow map. Line 185 gives the `shadow` options of spot and point lights. Both are general settings facts, but the outline files them under the zoom case. A reader who looks for spot light settings will not look there.
- Evidence: line 183 "A new cascade count or map size makes the shadow map again, so set them at setup." Line 185 "The `shadow` option and `setShadow` of spot and point lights take `bias`, `normalBias` and `intensity` alone".
- Proposed edit: Move 183 to directly after the settings table (after line 153). Move 185 into "Spot and point light shadows", or into a new H3 "Spot and point light settings" under "Settings".

## 22. materials: "The transparent pass" has nine paragraphs and no subheadings (medium, heading-depth)

- Anchor: `## The transparent pass`, lines 89 to 113. Long paragraphs on the page: 23, 85, 97, 113, 117.
- Claim: One H2 covers sorting, the limits of sorting, weighted blending, moment transparency, transmission and cost. A reader who wants "how do I stop smoke popping" must read all of it. Line 85 (alpha to coverage, 82 words, 6 sentences) mixes the user rule (on by default, smooths mask edges with MSAA) with how WebGPU writes coverage itself.
- Evidence: stats.json lines 16, 78, 90, 106, 110 (file 23, 85, 97, 113, 117).
- Proposed edit: Add H3s: "Sorting" (97 to 99), "Where sorting fails" (101 to 105), "Blending without a sort" (107 to 109), "Surfaces that let light through" (111), "What blending costs" (113, as a short list). Split 97 into two: why blended objects draw last, then how they sort (`setRenderOrder`). In 85, keep the first two sentences and the last one. Move the format and shader-written coverage detail into "Technical details: alpha to coverage on each path". In 117, put the advice ("reuse one WGSL for materials that differ only in values") first.

## 23. materials: the warm-up advice is the last section and has no example (medium, example-placement)

- Anchor: `## Why a new combination can make a frame late`, line 119. Front matter summary "pipeline warm-up".
- Claim: The section that explains the cost of the option table comes after transparency and custom materials, far from the table it explains (48 to 69). It tells the reader to "use its combinations in the first frames", but shows no code and does not link the loading-screens guide, which has a "Pipelines and warm-up" section. The summary promises warm-up, and the page gives one sentence on it.
- Evidence: line 121. docs/guides/loading-screens.md heading "## Pipelines and warm-up" (line 118).
- Proposed edit: Move the section to directly after "Fixed options choose the pipeline". Add a short example that creates every material variant in setup, and a link: "[Loading screens and warm-up](../guides/loading-screens.md#pipelines-and-warm-up) shows how to build them before play."

## 24. post-processing: bounce light gives its cost twice, with different rounding (medium, duplication)

- Anchor: `## Screen-space bounce light`, bullet at line 329 and `### Cost` at line 337.
- Claim: The bullet says "2.475 ms at High and 1.326 at Ultra on WebGPU, and 0.825 ms at WebGL2's Medium". The Cost section says "2.5 ms at High and 1.3 ms at Ultra ... 0.8 ms at WebGL2's Medium". The reader sees the same numbers twice at two precisions, and wonders if they differ. The "1.326 at Ultra" also drops its unit. The section has stray double blank lines at 311 to 312 and 338 to 339.
- Evidence: lines 329, 337.
- Proposed edit: Remove the timing sentence from the bullet at 329. Keep the Cost section's rounded figures, with units on each. Remove the extra blank lines.

## 25. shadows: "On each GPU path" is a 196-word paragraph of formats and samplers (medium, technical-details-block)

- Anchor: `## On each GPU path`, line 439.
- Claim: One paragraph of 12 sentences covers `depth16unorm` against `DEPTH_COMPONENT16`, a 32-bit atlas, perspective depth precision, comparison samplers, gather reads against single reads, and Apple GPU sampling speed. A user needs one fact: both paths draw the same shadows, and WebGL2 does four times the map reads.
- Evidence: stats.json line 432, 196 words, 12 sentences.
- Proposed edit: Main text: "WebGPU and WebGL2 draw the same shadows. WebGL2 reads each shadow map texel on its own, so it takes four times as many reads per pixel." Move the rest into "Technical details: shadow formats and reads on each path".

## 26. shadows: depth precision and the flat-caster method sit in the main text (medium, technical-details-block)

- Anchor: `## Bias` line 292, `### Where shadows meet their casters` 300 to 304, `### Flat casters` 308 to 312.
- Claim: Line 292 explains 16-bit depth steps, millimeters per step in S4's last cascade, and a floor of one and a half steps. Line 302 gives contact-check pixel figures. Lines 308 to 310 describe comparing against the receiver's plane per texel. All are correct and useful to implementers. A user needs the outcome: shadows meet their casters, slabs do not shadow themselves, raise biases in small steps.
- Evidence: stats.json lines 285, 293, 297, 301, 303.
- Proposed edit: Keep the outcomes in the main text: line 294's advice, "the engine moves back faces toward the light, so no lit line shows at a box's base", "a low flat caster does not shadow its own top", and the 20 cm floor advice. Move 292, 302 and the mechanism in 308 to 312 into "Technical details: depth precision, back-face offset and plane comparison".

## 27. static-dynamic: the development check is one 158-word paragraph, and the next one repeats it (medium, long-paragraph)

- Anchor: `## Setters and direct writes`, lines 74 and 76.
- Claim: Line 74 (11 sentences) says what the check compares, re-checks after `onLateUpdate`, the batch row turns of 4,096 a frame, live against hold behavior, and the S2 cost. Line 76 then says again that static batch rows are checked in turns and raise E1110 "within a few frames".
- Evidence: stats.json lines 67 (158 words, 11 sentences) and 69 (88 words, 6 sentences).
- Proposed edit: Main text as a list: development builds raise [E1110] when a static object changes without a setter; a live engine logs once and carries on; hold mode stops, so the test fails; release builds leave the check out. Move the comparison details, the `onLateUpdate` re-check, the 4,096-row turns and the S2 cost into "Technical details: how the static check runs". In 76, drop the last sentence, which repeats the block.

## 28. quality-preset-tables: 49 settings rows in one ungrouped table, with no key for "Changes" (medium, structure)

- Anchor: `## Settings of each preset`, lines 44 to 94.
- Claim: The table runs 49 rows in source order. Related rows are apart: "Far-animation updates" sits among the shadow rows (56). Bloom's size comes before "Bloom" (63, 64). The culling rows are spread (77, 86, 88). The reader cannot scan for "everything about shadows". The "Changes" column uses "during play", "at the start" and "before loading", but only quality-presets.md line 163 explains them.
- Evidence: lines 54 to 58, 63 to 64, 86 to 88. Row order comes from `settingRows()` in packages/engine/src/quality/preset-docs.ts.
- Proposed edit: Add a `group` to each setting's doc entry in preset-docs.ts (Resolution, Anti-aliasing and transparency, Shadows, Effects, Lighting and sky, Detail and culling, Textures and memory, Animation). In `presetSettingsTable()` / `presetTablesPage()` (tools/lib/docs.ts), print one H3 and table per group. Add a one-line key under the H2: "During play: `quality.set` changes it at any time. At the start: fixed while the engine runs. Before loading: fixed before the engine loads."
- Generated source: tools/lib/docs.ts (presetTablesPage, presetSettingsTable) and packages/engine/src/quality/preset-docs.ts.

## 29. render-graph: the scene inputs table lists inputs that nothing can read (medium, unclear)

- Anchor: `## Scene inputs`, lines 86 to 93.
- Claim: The table offers four inputs. Two are not usable: `'normals'` ("No pass makes them") and `'motionVectors'` ("the adapters refuse"). The paragraph after the table then lists in negations who may read what. A reader must read the table and the paragraph side by side to learn what they can use.
- Evidence: line 90 "No pass makes them". Line 93 "A full-screen effect reads only `'sceneColor'` and `'sceneDepth'`, and a custom material reads only `'sceneDepth'`. No pass makes `'normals'`, and the adapters refuse `'motionVectors'`."
- Proposed edit: Add a column "Who can read it": sceneColor, full-screen effects; sceneDepth, full-screen effects and custom materials; normals, nothing (no pass makes them); motionVectors, the motion debug view only. Then cut the second, third and fourth sentences of line 93.

## 30. particle-buffer: batch writes and time shifts come before the first example (medium, example-placement)

- Anchor: `## A record` line 52 and `## Layout in practice` 54 to 69, before `## Write into the buffer` (71).
- Claim: Line 52 (103 words) brings in `writeRecords` with its nine-number block, wrapping, size stability and `shiftRecords`, before the reader has seen one `write` call in context. The fountain example comes at line 75, after three sections of layout rules.
- Evidence: stats.json line 45 (103 words, 6 sentences).
- Proposed edit: Order: "What the buffer holds", "A record" (table and the `write` signature only), "Write into the buffer" (the example and its notes), then an H3 "Write many births in one call" for `writeRecords`, then "Layout in practice". Move `shiftRecords` next to the time base item in "Limits" (190), or into "Technical details: moving the time base".

---

## Findings after the top 30 (not verified)

## 31. quality-presets: the preset check's reporting example sits under "Repeat visits" (medium, example-placement) - not verified

- Anchor: lines 141 to 153.
- Claim: The `engine.mode.presetCheck` example reports any check, not just a reused one. The match rules (130 to 139) are cache detail.
- Proposed edit: Move 141 to 153 to the end of "## The preset check". Move the match rules list and line 139 into "Technical details: when a stored result applies".

## 32. Cross-page: the "Roadmap step" line uses planning words, and the status blockquotes grow into summaries (low, internal-note) - not verified

- Pages: all eight written pages in the slice.
- Claim: "Roadmap step 0.1" names a plan step, and the rules keep plans out of docs. The docs check enforces the sentence (tools/lib/steps.ts `shipsSentence`, tools/lib/docs.test.ts). On quality-presets (line 11, 9 sentences) and post-processing (line 11) the blockquote also lists the page's contents, and that list repeats the opening paragraph.
- Proposed edit: Change `shipsSentence` to "First released in null3D 0.1.0." Keep each blockquote to the status and limits, and move feature lists into the opening paragraph.
- Generated source: tools/lib/steps.ts.

## 33. quality-presets: the lowest tier uses undefined window terms (low, unclear) - not verified

- Anchor: lines 321 and 325, "through the sustained window", "the window that raises a step".
- Proposed edit: Name the times: "after the render scale has stayed at its floor for N seconds and frames still miss", and "after 5 seconds with time to spare".

## 34. particle-buffer: "Coding agents must not use these calls." in the human page header (low, unclear) - not verified

- Anchor: line 11.
- Claim: A human reader does not know why. The skills can carry this rule.
- Proposed edit: "Most apps use the particles add-on. These calls are for writing your own emitter." Keep the agent rule in the skill.

## 35. particle-buffer: `configureEmitter`'s options are listed in prose (low, wall-of-text) - not verified

- Anchor: line 165.
- Proposed edit: A table "Option | What it sets" for seed, shape, direction, spread, speed, lifetime, velocity, bursts, duration, loop, follow, subEmitters, or a link to the API reference for the full list.

## 36. render-layers: implementation section and an unlinked error code (low, technical-details-block) - not verified

- Anchor: `## How the engine tests layers` (96 to 103), line 66 "throws E1207".
- Proposed edit: Keep line 103's user fact (a new mask rebuilds nothing). Put the per-path bullets in "Technical details: where the mask test runs". Link E1207 to `../errors/E1207.md`, as the other pages link their codes.

## 37. shadows: three one-line `quality.set` calls, each wrapped in a whole sketch (low, example-placement) - not verified

- Anchor: lines 228 to 235, 249 to 256, 262 to 269.
- Proposed edit: Show bare `quality.set({ ... })` lines, as post-processing does (line 104), or merge them into one example with a comment per line.

## 38. post-processing: outlines and color grading have no code example; a date in prose (low, example-placement) - not verified

- Anchor: `## Outlines` (340), `## Color grading and the vignette` (360), line 385 "(2016)".
- Proposed edit: Add `mesh.setOutlined(true); post.set({ outline: { ... } })`, and an `assets.loadLut` plus `post.set` example. Remove the year from the citation, because the style check blocks dates in prose.

## 39. static-dynamic: grid cell and phone upload detail (low, technical-details-block) - not verified

- Anchor: line 47 (grid cells in "The two kinds"), line 106 (105 words, phone list sizes).
- Proposed edit: Keep "Marking still objects static keeps these savings" in the main text. Put the 1,024 m cells, the 4-byte entries and the 6 KB example in "Technical details: what a static object saves".

## 40. materials: the standard model's lighting terms in the materials list (low, technical-details-block) - not verified

- Anchor: line 35, "Lambert diffuse light and a GGX highlight ... split-sum terms".
- Proposed edit: Main text: "The standard material follows glTF's metallic-roughness model." Move the BRDF terms into "Technical details: the standard material's lighting".

## 41. shadows: hero shadow rules mix use and internals (low, technical-details-block) - not verified

- Anchor: bullets 391 to 395.
- Proposed edit: Keep the rules a user must follow (it must cast, needs bounds, first directional light only, the 1 GiB limit). Move the box shape, the atlas layer sizing and the memory figures into "Technical details: the hero tile".

## 42. render-graph: the passes table's "Kind" column also holds the run conditions (low, structure) - not verified

- Anchor: lines 41 to 66.
- Proposed edit: Split it into "Kind" (compute, scene, fullscreen, resolve) and "Runs when". Group the rows by phase: lights and culling, shadows, scene, copies, motion, sketch passes, output.

## 43. post-processing: change-log wording (low, wrong-claim) - not verified

- Anchor: line 158 "where it could be thrown away before", line 358 the same, line 60 "exactly as before the split".
- Proposed edit: State the present fact: "The scene's render pass stores its depth, so the setup and composite can read it." Remove "before".
