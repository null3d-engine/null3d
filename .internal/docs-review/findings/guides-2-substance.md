# Guides slice 2: sense and substance review

Pages: guides/lens-kit, guides/loading-screens, guides/multiple-views, guides/performance, guides/phones, guides/physics, guides/screens, guides/start-time, guides/testing, guides/ui-overlays, guides/video-textures.

Line numbers are file lines of `docs/guides/<page>.md` (as `cat -n` prints them). The stats file counts body lines, which are 7 lower.

`G` below is the generated copy of the repository.

Every relative link on these 11 pages resolves to an existing page and heading (checked by script).

## Ranked findings

### 1. start-time: the page reads as a changelog of engine work (high, wrong framing / internal history)

- Anchor: "## Where the time goes" (lines 29-106), "## Pipelines on phones" (lines 262, 272-280).
- Claim: The page reports the engine's own history. "Before the changes that this guide describes, a first visit spent its time on these steps" (line 29). "Each change below was then measured alone" (line 42). "With every change together, the same Mac timed the engine before and after the changes in turns" (line 60). "Before the changes, a first visit drew its first frame in these times" (line 86). "With the changes, on the same devices" (line 97). "With the changes, a first visit's builds took..." (line 262). Tables with Before and After columns (lines 44-58, 64-82, 274-280). A reader cannot act on "before": most of the "changes" are engine work that the reader already has (the core loads while the sketch module loads, the stored pipeline list, the import chain). A reader does not know which rows are their job and which the engine did.
- Evidence: AGENTS.md "Writing docs": "Every file ... states what holds now ... Give a fault or a figure as a present fact with its reason. Leave when it happened to git."
- Proposed edit: Rewrite "Where the time goes" as present facts in one short table: each step of a start, what it costs on the simulated phone link, and whose job it is (host, page, sketch, engine). State each saving as a present fact of the reader's choice: "An uncompressed core is 2.0 MB and takes about 2.3 s on this link. Brotli makes it about 0.6 MB." Drop the rows that describe engine work the reader does not control, or say "the engine does this for you". Move the measured demo tables (lines 44-58, 64-82, 88-104, 254-262, 274-280) into one block:
  `<details><summary>Technical details: measured starts of the engine's demos</summary> ... </details>`
  with the tables given as "a production build of today's engine, with and without the step".

### 2. phones: "The scaling also takes the place of FXAA" is wrong (high, wrong claim)

- Anchor: "## Render scale", line 57.
- Claim: The page says a lower render scale replaces FXAA. The final pass still runs FXAA below the whole canvas's scale. Its first step draws at the render size "with FXAA", and the second step upscales.
- Evidence: `G/crates/null3d-shaders/wgsl/final.wgsl:9-11` ("A frame below the whole canvas's scale draws in two steps. The first build ... draws one texel for each render pixel into a target of the render size, with FXAA"). `G/docs/concepts/quality-presets.md:287` ("the first draws at the render size and smooths edges with FXAA, which the pass at the whole canvas's scale always did"). `G/crates/null3d-render/src/final_pass.rs:1-8`.
- Proposed edit: Replace the sentence with: "Below a scale of 1, the final pass still smooths edges with FXAA at the render size, then scales the image up to the canvas."

### 3. performance: the presets do not change the prepass or occlusion culling on WebGL2 (medium, contradiction)

- Anchor: "### Quality presets", line 93: "On WebGL2 it sets the depth prepass, occlusion culling and the most morph targets per object."
- Claim: The sentence says the preset changes these settings on WebGL2. Every WebGL2 preset draws the prepass, and every preset leaves software occlusion off. The same page says so at line 288 ("every preset leaves it off") and line 298 ("On WebGL2, every preset draws the prepass").
- Evidence: `G/packages/engine/src/quality/presets.ts:362-366` (`softwareOcclusion` presets all false), `presets.ts:457-461` (`depthPrepass` webgl2 `[true, true, true, true]`).
- Proposed edit: "On WebGL2 it sets the most morph targets per object. WebGL2 draws the depth prepass on every preset, and no preset turns on occlusion culling there."

### 4. phones and loading-screens: two different answers for a preset picked in a menu (medium, contradiction)

- Anchor: phones "## The preset on a phone", line 29: "When a player picks one in a menu, pass it to `createEngine` with the `preset` option." loading-screens "## A change of preset", lines 221-230, shows the same menu case with `quality.setPreset`, during play, with no restart.
- Claim: A reader on the phones page restarts the engine to change a preset. The engine has a call that changes the preset during play.
- Evidence: `G/packages/engine/src/sketch/quality.ts:273` (`setPreset(preset: QualityPreset): Promise<void>`), `quality.ts:226` (it caps a heavier request at the GPU path's highest).
- Proposed edit: phones line 29: "When a player picks one in a menu, call `quality.setPreset` in the sketch, as [A change of preset](loading-screens.md#a-change-of-preset) shows. Pass the `preset` option of `createEngine` to start at a remembered choice."

### 5. screens: "A held frame runs no update" disagrees with how hold mode works (medium, contradiction, PLAUSIBLE)

- Anchor: "## Make a screen", line 50 ("so a held frame shows the picture"), and "## Limits", line 119 ("A held frame runs no update. Paint the picture through `draw` or in the setup.").
- Claim: The testing page says hold mode runs `onUpdate` on every step from time 0 to the held time: a hold at 1.5 seconds runs 91 frames (testing lines 70, 76). So the screens page's reason is wrong as stated. The advice (paint the whole first picture in `draw`) can still be right for another reason, such as a refresh rate that holds an upload back or a hold at time 0.
- Evidence: `G/docs/guides/testing.md:70,76`. `G/packages/engine/src/sketch/clock.ts:11` (`HOLD_STEPS_PER_SECOND = 60`). The add-on carries the same sentence in its TSDoc: `G/examples/addons/screens/index.ts:61-62,157`.
- Proposed edit: Check the real reason in the canvas texture path in hold mode, then fix both the page and the add-on comment. For example: "Hold mode runs `onUpdate` on each step, but a change that the refresh rate holds back may not reach the held frame. Give `draw` the whole first picture, so every held frame shows it."

### 6. start-time and loading-screens: demos named without saying which demo (medium, unclear)

- Anchor: start-time lines 46-57, 66-82, 88-104, 254-262 ("A small demo", "the creek demo", "the skyway demo", "the island", "the splat demo", "the character demo"); loading-screens line 172 ("the instances demo") and line 147 ("the island showcase").
- Claim: "Small demo" is never defined. The same figure (1.18 s against 0.49 s on a MacBook Pro with the check before play) is "A small demo" in start-time line 57 and "the instances demo" in loading-screens line 172. The instances demo draws 100,000 columns, which is not small. The other names have no link, so a reader cannot see what the scene holds.
- Evidence: `G/examples/demos.ts:163-207` (creek, island, skyway under `showcase/`), `demos.ts:903` (splats), `demos.ts:925-929` (instances, "100,000 columns"), `demos.ts:735` (character).
- Proposed edit: Name the small demo in its first use, and use the same name on both pages. Link each demo once: [Creek](https://github.com/null3d-engine/null3d/tree/main/examples/showcase/creek/), [Island](https://github.com/null3d-engine/null3d/tree/main/examples/showcase/island/), [Skyway](https://github.com/null3d-engine/null3d/tree/main/examples/showcase/skyway/), [splats](https://github.com/null3d-engine/null3d/tree/main/examples/splats/), [character](https://github.com/null3d-engine/null3d/tree/main/examples/character/), [instances](https://github.com/null3d-engine/null3d/tree/main/examples/instances/).

### 7. loading-screens, start-time, phones: the phone pipeline figures appear three times (medium, duplication)

- Anchor: loading-screens line 134 (showcase pipeline counts and times on the Galaxy S25, iPhone 17 and Galaxy Tab A9 Plus) and lines 145-147 (the stored list, the island on the Tab A9 Plus, 8.8 to 11.2 s against 23.6 s). start-time "## Pipelines on phones", lines 252-280 (the same counts, times and the same island figures). phones line 103 ("55 pipelines took 10.9 seconds").
- Claim: The same facts live in three places, with small drifts: loading-screens says "46 to 63 pipelines on a phone", and start-time gives 45 to 46 for Creek. A change to one copy leaves the others wrong.
- Evidence: loading-screens.md:134,147; start-time.md:262,280; phones.md:103. AGENTS.md "One source per fact".
- Proposed edit: Keep the figures on start-time "Pipelines on phones", in a `<details>` block. On loading-screens keep one sentence ("On a phone, a showcase's first frame builds about 50 to 60 pipelines, which take seconds") and link. On phones keep the link only.

### 8. phones and start-time: the same driver-refusal story twice (medium, duplication / internal test log)

- Anchor: phones "## When the GPU's driver refuses a shader", lines 109-111; start-time lines 108-110.
- Claim: Both pages tell the same story in almost the same words: the engine builds a refused pipeline once more, reports E1307, the island draws without its far tree cards, "The creek demo reaches its first frame at 71 seconds there, but the tablet runs out of GPU memory 4 seconds later". The second half reads as a test log of the engine's own demos on one tablet, not as advice.
- Evidence: phones.md:109-111, start-time.md:108-110.
- Proposed edit: Keep the rule (rebuild once, E1307, objects left out, E1404 for a full-screen pass) on phones only. Move the Tab A9 Plus story into a `<details>` block "Technical details: a low-end tablet's driver" on phones, and delete start-time line 110, linking to phones instead.

### 9. loading-screens, start-time, performance: the preset check explained three times (medium, duplication)

- Anchor: loading-screens "## The preset check", lines 157-176; start-time "## The preset check", lines 242-248; performance line 93 and line 364.
- Claim: Each page explains when the check runs, what it measures, the stored result and `presetCheck: 'before-play'`. The figures differ in framing: start-time line 106 gives 12 to 38 seconds during play on the Tab A9 Plus, and line 246 gives 8 to 18 seconds before play, with no note that the two lines measure different modes. The rules belong on the concept page, which each page links to anyway.
- Evidence: loading-screens.md:159-176; start-time.md:244-248; performance.md:93,364; concepts/quality-presets.md "The preset check".
- Proposed edit: Keep the full explanation on loading-screens (it is the page about the loading screen). On start-time keep two sentences (the check costs a slow tablet the most; `before-play` hides the change) and link. Move start-time line 248's rules (target from the display's rate, 4-second first round, a quarter of the target goes straight to Low) into a `<details>` block or the concept page.

### 10. loading-screens and start-time: the download list rules twice (medium, duplication / unclear)

- Anchor: loading-screens "## Report progress from the sketch", lines 57-59; start-time lines 200-202.
- Claim: Both pages give "two download at a time", "a load moves it to the front", "up to four", the serial-load warning and `serialLoadWarning: false`. loading-screens line 57 is hard to follow: "A load of a later file moves it to the front of the list. Up to four listed files then download while loads wait for them."
- Evidence: `G/packages/engine/src/sketch/runner.ts:264,272` (`LISTED_AT_ONCE = 2`, `LISTED_MOST = 4`). The facts are right; the issue is the copy.
- Proposed edit: Keep the rules on the Sketch API page (both link there). On each guide, keep one sentence: "Name the files that the first frame needs in `downloads`, in the order that the setup needs them." Rewrite the unclear part as: "Two listed files download at a time. When the setup asks for a listed file that has not started, it starts at once, and up to four then download together."

### 11. performance and phones: the same memory advice twice (medium, duplication)

- Anchor: performance line 157 and phones line 85 (object tables doubling, 16,383 to 32,767, 2.4 to 5.3 ms on a Galaxy S25 and a Pixel 9, `expectedObjects`); performance lines 224-227 and phones lines 79-81, 105 (texture budget, KTX2 at a quarter or an eighth, the cache of derived data and the S6 figures).
- Claim: Two copies of each fact, with different detail on each.
- Evidence: performance.md:157,224-227; phones.md:79-81,85,105.
- Proposed edit: Give texture memory and KTX2 to phones (the memory page for small devices), and object tables to performance. Each page links to the other in one line.

### 12. performance and phones: the governor's steps are incomplete and unclear (medium, unclear / contradiction)

- Anchor: performance line 99 ("lowers a sketch's budgets and the render scale in turn, a budget's step first, and then the live shadow settings, bloom's base, the size of ambient occlusion and last the effect itself"), performance line 271, phones line 91.
- Claim: "Last the effect itself" is unclear (it means ambient occlusion turns off). The list leaves out steps the governor takes: levels of detail, screen-space reflections, contact shadows, far character updates and the volumetric fog. phones line 91 says the `quality.onChange` handlers run "after each step that follows the render scale"; the concept page says "after each shadow step".
- Evidence: `G/docs/concepts/quality-presets.md` "The frame-budget governor" (ten numbered steps, and "the `quality.onChange` handlers run after each shadow step"); `G/packages/engine/src/quality/governor.ts`.
- Proposed edit: Replace both lists with one sentence and a link: "When frames take too long during play, the governor lowers the render scale first, then detail and effect settings one step at a time ([the frame-budget governor](../concepts/quality-presets.md#the-frame-budget-governor))." Check which steps call `onChange` and make the phones page match the concept page.

### 13. performance: one page of 8,400 words does three jobs (medium, structure / split-page)

- Anchor: whole page; headings "Measure", "Measure fairly", "Memory peak", "Browsers differ".
- Claim: The page holds a cost model, a list of fixes, a full reference of `engine.measure()` figures (lines 306-337), browser measurement quirks (lines 349-372) and benchmark records. A reader who wants "why is my scene slow" must read past all of it. The figure table at lines 306-337 also duplicates the API reference of `measure`.
- Evidence: stats.json: guides/performance 8,423 words, 21 long paragraphs.
- Proposed edit: Split into "Performance guide" (where time goes, fixes by topic) and "Measuring performance" (stats overlay, `engine.measure`, `bench`, measure fairly, the presented and completed rates, browsers differ). Link the figure table to the Engine API reference and keep only the figures that the guide uses.

### 14. performance: long, dense paragraphs that suit collapsible blocks (medium, long-paragraph / technical-details-block)

- Anchor: file lines 78, 93, 103, 125 (bullet), 131, 163 (bullet), 192, 198, 220, 224, 259, 261, 265, 288, 292, 298, 300, 339, 341, 343, 353, 355, 357, 370-372, 401-405.
- Claim: These paragraphs mix the advice with benchmark figures and implementation detail. Examples: line 125 (setters, inlining, boxing: "a fraction that it does not inline becomes an object"); line 163 (row limits per GPU path, 2,097,152 and 1,048,576, the scene table places, E1501 and E1109); line 198 (upload routes, 64 KiB to 4 MiB, staging buffers 3 to 6 times faster in Chrome); line 259 (area light integrals, caps, 8-frame fade); line 351 ("Eleven is a prime above the longest far cascade interval"); lines 355-357 (Firefox and Safari completion signals); line 343 (Chrome heap sampling).
- Evidence: stats.json guides/performance longParagraphs (body lines 71, 86, 96, 124, 185, 191, 213, 217, 252, 254, 258, 281, 285, 291, 293, 297, 332, 334, 336, 346, 348).
- Proposed edit: Keep one or two sentences of advice in each place, and move the rest into blocks, for example:
  - after line 125: `<details><summary>Technical details: why setters allocate nothing</summary>` the inlining and boxing text `</details>`;
  - after line 163: "Technical details: row limits on each GPU path";
  - after line 198: "Technical details: how uploads travel";
  - after line 259: "Technical details: how area lights shade";
  - after line 353: "Technical details: completion signals in each browser" (lines 351 last sentence, 355-357);
  - lines 370-372 and 401-405: "Technical details: browser flags and core counts".

### 15. start-time: long paragraphs (medium, long-paragraph)

- Anchor: file lines 25, 60, 106, 138, 140, 144, 162, 166, 200, 232, 244, 246, 248, 264, 270, 292.
- Claim: 16 paragraphs over the limit. Several carry dense rules that an implementer needs only now and then: line 248 (the check's target, its first round of at most 4 seconds, a quarter of the target goes to Low), line 264 (Chrome's pipeline cache sizes: 2 MB, 128 KB, 6 MB), line 270 (the stored list's key: engine version, GPU path, shader bits, preset, canvas format), line 140 (Safari stalls over HTTP/2 from the dev server).
- Evidence: stats.json guides/start-time longParagraphs.
- Proposed edit: Split each into the advice and a `<details>` block: "Technical details: how the check picks its target" (line 248), "Technical details: what browsers keep between visits" (line 264, 270), "Technical details: HTTP/2 and the dev server" (line 140).

### 16. loading-screens: long paragraphs (medium, long-paragraph)

- Anchor: file lines 23, 57, 59, 61, 69, 134, 145, 153, 159, 172, 174, 194, 200, 202, 215.
- Claim: 15 paragraphs over the limit. Line 172 (164 words) mixes the rule (the check before play hides its frames) with five device figures. Line 202 (182 words) mixes the rule (a feature's shaders load on first use) with file sizes ("at most 128 KB after Brotli", "many WebGL2 files take more than 32 KB") and the glTF and `assets optimize` paths. Line 215 (175 words) mixes the `preload` rule with WebGPU pipeline detail.
- Evidence: stats.json guides/loading-screens longParagraphs.
- Proposed edit: Keep the rule in the main text. Move the measured times of line 172 into "Technical details: what the check before play costs", the file sizes of line 202 into "Technical details: the shader files of a feature", and the WebGPU and skinned-mesh detail of line 215 into "Technical details: what preload builds before the first frame".

### 17. phones: long paragraphs (medium, long-paragraph)

- Anchor: file lines 55, 57, 61, 73, 79, 81, 83, 91, 99, 103, 109.
- Claim: Line 91 ("## Heat", 178 words, 11 sentences) holds the heat advice, the governor's steps, `onChange`, the S24+ figure and three iPad figures. Line 81 holds KTX2 sizes, `basisu -mipmap`, UASTC against ETC1S and `texture.format`.
- Evidence: stats.json guides/phones longParagraphs.
- Proposed edit: Heat: keep "aim for about 70% of the frame budget and test runs of 10 minutes", the governor link, and one figure; move the iPad figures into "Technical details: measured heat on a phone and a tablet". KTX2: keep "load large textures from KTX2 files"; move the formats and encoder flags into "Technical details: KTX2 formats on phones".

### 18. testing: the hold-mode wait rules are dense and partly unclear (medium, unclear / long-paragraph)

- Anchor: "## Hold mode", line 78 (218 words, 13 sentences), line 71 (step 4) and line 76.
- Claim: Line 78 packs the job-worker task wait, the level-of-detail plan wait, E1408 after five minutes, `levels: false`, the setup's tasks and the order of plan hand-over into one paragraph. "The levels of detail that meshes made in code plan are different." does not parse on first read. Line 71 says that with motion vectors hold mode also draws the frame before the last, and that a mirror or light probe adds one more frame at the held time. Line 76 says a pass that reads the frame before (bounce light) adds one more frame after the held one. The reader cannot tell which rule applies to which effect.
- Evidence: testing.md:71,76,78; stats.json guides/testing longParagraphs (body lines 69, 71).
- Proposed edit: Main text: "Before the held frame, hold mode waits for the sketch's tasks on the job workers (up to 10 seconds each) and for the levels of detail that meshes plan (up to five minutes, then E1408)." Move the rest into `<details><summary>Technical details: what hold mode waits for</summary>`. Rewrite the unclear sentence: "Meshes made in code plan their levels of detail on the job workers. Hold mode waits for those plans with no time limit, up to five minutes." Merge the two "frame before" rules into one list: motion vectors, mirrors and light probes, screen-space bounce light, each with the extra frame it draws.

### 19. start-time: maintainer notes and demo-only details (medium, internal-note)

- Anchor: line 162 ("The engine's package keeps no `sideEffects` list: one was measured, and it made the start slower."), line 284 ("The engine's demo page dropped such a worker: it sent about 1,570 requests and 820 MB over the start's connections."), line 232 ("The engine's showcase demos take a `?grown` switch"), line 320 (`bun run bench:startup` in the engine's repository).
- Claim: These lines tell the reader about the engine repository's own choices and tools. A user cannot act on the missing `sideEffects` list or on the demo page's history, and `?grown` is a switch of the demos, not of the engine.
- Evidence: AGENTS.md "Writing docs": "Notes for maintainers belong in code comments, in this file or in the guides in `.dev/`."
- Proposed edit: Delete line 162's last sentence. Rewrite line 284 as a present fact: "A worker that caches a large build at load can send over a thousand requests during the start." Delete the `?grown` sentence, or say "a sketch can take a switch of its own that does the same on a live page". Keep line 320 only if the reader is told it applies to the engine repository, or delete it.

### 20. performance: the three.js claim does not name the scene it loses (medium, missing-content)

- Anchor: line 13: "it beats three.js in five of its six benchmark scenes".
- Claim: The page never says which scene null3D loses, or why. The docs home names it (100,000 still boxes). This page shows that scene's figures (line 192, S1-static) without saying it is the loss. A reader who builds a scene of still objects needs to know.
- Evidence: `G/docs/index.md:13` ("The engine loses one scene, in which 100,000 boxes stand still"); `G/bench/lib/report.test.ts:290` (s1-static "is not faster than three.js's faster renderer at these object counts").
- Proposed edit: Add after line 13: "It loses S1-static, in which 100,000 boxes stand still, to three.js's fastest renderer at some object counts ([Moving objects cost uploads](#moving-objects-cost-uploads))." Give the reason in one sentence if one is known.

### 21. lens-kit: the "Cost" section is hard to follow (medium, unclear)

- Anchor: "## Cost", lines 107-116.
- Claim: "The sharpening at the whole canvas's render scale adds the first step of the two-step pass, as any `sharpen` value does. Below the whole canvas's render scale, effects do not join passes, so each draws one." needs the post-processing page to make sense. "WebGL2 keeps no figure for the whole look, because its cleared frame moves by more than the look there. Its marks stand instead." does not say what "its marks stand" means. "The add-on's README holds the figure" gives no link.
- Evidence: lens-kit.md:107-116; `G/docs/concepts/post-processing.md:217`; `G/examples/addons/lens-kit/README.md`.
- Proposed edit: Main text: "The grade and the vignette add no pass. The sharpening adds one step to the final pass. At 33 megapixels on an M3 Max the whole look costs about 3 to 4 ms of GPU time, about a tenth of a millisecond per megapixel." Move the two-step pass detail and the WebGL2 note into `<details><summary>Technical details: how the kit's passes join</summary>`, and link the README: [the add-on's README](https://github.com/null3d-engine/null3d/tree/main/examples/addons/lens-kit).

### 22. loading-screens: the paragraph about a falling percentage is unclear (medium, unclear / term-before-definition)

- Anchor: "## Show progress on the page", line 69.
- Claim: "Across the whole start the figure can fall: a counted phase that ends returns the card to the engine's stage, and a later file starts a new measure under the same label." The "card" is never defined, and "returns the card to the engine's stage" does not say what the reader sees. The paragraph mixes a rule (show a phase's share, never one total) with an edge case.
- Evidence: loading-screens.md:69; the code below it (lines 77-89) resets the bar when the label changes.
- Proposed edit: "Show each phase's own share, with its name beside it. Within a phase the bar never falls. When a new phase starts, the bar starts again from 0, as `show` does below." Delete the "card" sentence.

### 23. testing: the browser test guide is named but not linked (low, missing-prerequisite)

- Anchor: "## Browser tests of a whole app", line 200: "The null3d-develop agent skill's `references/e2e-testing.md` gives the whole setup".
- Claim: A reader who does not use the agent skill cannot find the file, and the page gives no link.
- Evidence: the file exists at `G/skills/null3d-develop/references/e2e-testing.md`.
- Proposed edit: Link it: "[the end-to-end testing guide](https://github.com/null3d-engine/null3d/blob/main/skills/null3d-develop/references/e2e-testing.md) in the null3d-develop skill".

### 24. start-time: "therefore" follows the wrong sentence (low, unclear)

- Anchor: "## What the engine does while the core downloads", lines 162-166.
- Claim: Line 166 starts "The sketch module's top-level code therefore runs before the engine has started". The cause is in lines 156-160 (the sketch worker imports the module while the core downloads). Line 162 (the Vite plugin's import list) and line 164 (`load.drawingStart`) sit between them.
- Evidence: start-time.md:156-166.
- Proposed edit: Move line 166 to follow line 160, and replace "therefore" with "So". Move line 164 to "Measure a start".

### 25. lens-kit and screens: `ctx` is used with no word on where it comes from (low, missing-prerequisite)

- Anchor: lens-kit "## Use it", line 35 (`createLensKit(ctx, {...})`); screens "## Make a screen", line 34 (`createScreen(ctx, {...})`).
- Claim: Every other guide destructures the setup's context (`({ scene, assets })`). These two pass a `ctx` that no line defines, and the screens example then shows `return { onUpdate() {...} }` with no setup around it.
- Evidence: `G/examples/addons/lens-kit/index.ts`, `G/examples/addons/screens/index.ts:161` (`createScreen(ctx: SketchContext, ...)`).
- Proposed edit: Show the setup once: `export default defineSketch((ctx) => { const lens = createLensKit(ctx, {...}); ... });`, or add the sentence "`ctx` is the context that the setup function receives."

### 26. multiple-views: no demo link, and an unclear opening (low, missing-content / unclear)

- Anchor: intro, line 13 ("Two kinds of work are different:"); no demo link on the page.
- Claim: The multiple-views demo shows exactly this page (a split of two cameras, and a picture in picture after the V key). The page does not link it. "Two kinds of work are different" does not tell the reader why the list follows.
- Evidence: `G/examples/demos.ts:472-480` (multiple-views: "split across the canvas ... The layout switches to a picture in picture"); stats.json guides/multiple-views exampleLinks: [].
- Proposed edit: Replace line 13's last sentence with "A view is not a render pass:" and add under "A split screen": "The [multiple views demo](https://github.com/null3d-engine/null3d/tree/main/examples/multiple-views/) draws a split screen, and its V key turns it into a picture in picture."

### 27. ui-overlays: the examples leave out what makes them work (low, missing-content)

- Anchor: "## Labels that follow objects" (lines 78-95), "### A page under the scene" (lines 143-149), "## GUI panels" (lines 159-174).
- Claim: The health bar sets `--hp` but no CSS shows a bar that reads it, so the example shows an empty div. The page plane is 800 by 600 units, and the page element must be 800 by 600 CSS pixels to match, which the text does not say at that point. The GUI panel sends `bloom`, and the sketch's handler ignores it.
- Evidence: ui-overlays.md:93,124,146,166,171-173.
- Proposed edit: Add a two-line CSS rule (`.hp { width: 60px; height: 6px; background: linear-gradient(90deg, #4c4 var(--hp), #400 0) }`). Add "Size the page element to 800 by 600 CSS pixels, the plane's size." Add `if (type === 'bloom') post.set({ bloom: data as boolean });`.

### 28. All pages: the "Roadmap step" banner (low, internal-note; generated)

- Anchor: line 11 on every page in the slice ("> Roadmap step 0.3, first released in null3D 0.1.0.").
- Claim: The step number tells a guide's reader nothing they can use: the docs home says steps 0.1, 0.2 and 0.3 all ship in 0.1.0. "Roadmap step" reads as an internal plan term on a how-to page.
- Evidence: `G/tools/lib/steps.ts:25` (`shipsSentence`), `G/tools/lib/docs.ts:652`; `G/docs/index.md:34`.
- Proposed edit: In `shipsSentence`, write "First released in null3D 0.1.0." and leave the step to the page list's column. Update the check in `G/tools/lib/docs.test.ts:135-142`.

### 29. phones: "falls back to WebGL2 at Medium" is not what a phone gets (low, wrong-claim)

- Anchor: "## Testing on real devices", line 125: "On a network address over plain HTTP, the engine silently falls back to WebGL2 at Medium."
- Claim: Medium is WebGL2's cap, not the preset a phone runs. A phone starts at Low on any path (line 17, performance line 93).
- Evidence: phones.md:17; performance.md:93; testing.md:36 ("High on WebGL2 and compatibility runs at Medium").
- Proposed edit: "On a network address over plain HTTP, the engine silently falls back to WebGL2, which caps the preset at Medium."

### 30. loading-screens: unlinked cross-references and stray blank lines (low, polish)

- Anchor: line 215 ('as "A later loading stage" shows', and "throws E1421" with no link); lines 177-179 (three blank lines before "## A later loading stage").
- Claim: The section name in quotes is not a link, the error code has no link though other codes on these pages do, and the extra blank lines suggest a removed section.
- Evidence: loading-screens.md:177-179,215.
- Proposed edit: Link [A later loading stage](#a-later-loading-stage) and [E1421](../errors/E1421.md); remove the extra blank lines.

## Lower-ranked findings (not verified)

### 31. video-textures: two facts stated twice on the page (low, duplication) - not verified

- Anchor: line 68 and line 90 (a paused video); lines 38-40 (code comment) and line 100 (`display: none`).
- Proposed edit: Keep each fact once: the paused video in "What a video costs while it does nothing", and `display: none` in the code comment only.

### 32. video-textures: "The page then checks the video's time" has an unclear subject (low, unclear) - not verified

- Anchor: "## Browser limits", line 101.
- Claim: "The page" here means the engine's code on the page, not the reader's page code.
- Proposed edit: "Some browsers report no frames for a video that the page never shows. The engine then checks the video's time on each display frame while it plays."

### 33. lens-kit: the grading sentence's logic is unclear (low, unclear) - not verified

- Anchor: "## How the parts draw", lines 65-68: "The kit therefore keeps no color table of its own, and a look that must show a surface's own color passes `grading: false`."
- Proposed edit: "The kit keeps no color table of its own. To show surfaces in their own colors, pass `grading: false`."

### 34. multiple-views: the picking timing note is hard to follow (low, unclear) - not verified

- Anchor: "## Picking in a view", line 96.
- Proposed edit: "A view's calls use the view's camera from the last frame that ran. During a fast turn of that camera, a click can pick a point up to one frame of motion away."

### 35. physics: no demo shows a physics library (low, missing-content) - not verified

- Anchor: whole page; stats.json exampleLinks: [].
- Claim: No demo in `G/examples/demos.ts` uses Rapier or cannon-es. The hold-mode demo shows fixed steps and repeatable frames, which the page's "Step the world at a fixed rate" section relies on.
- Proposed edit: Link the [hold mode demo](https://github.com/null3d-engine/null3d/tree/main/examples/hold-mode/) under "Step the world at a fixed rate". A Rapier demo would serve this page.

### 36. testing: the switches table mixes test switches with engine diagnostics (low, structure) - not verified

- Anchor: "## Switches for tests", lines 216-245 (30 rows).
- Claim: Rows such as `?display-check=off`, `?skinning=narrow`, `?scene-format=rg11b10` and `?half=on` measure engine internals and are not test switches.
- Proposed edit: Keep the switches a test uses (`hold`, `gpu`, `preset`, `check`, `builds`, `threads`, `view`) here, and move the rest to the Debugging guide or a `<details>` block "Technical details: switches that measure engine parts".

## Screenshots and demos per page

### guides/lens-kit

Shots:
- `post-effects-alley` (reference): the post effects demo's default view, the neon alley with the kit's look. Place under the intro, after the diagram. Reference: `tests/image/references/chrome-real-gpu/webgpu/demo-post-effects.png`. Alt: "A neon alley at night with color fringes, an anamorphic streak and film grain from the lens kit."
- `lens-marks` (scripted): the four marks side by side, one picture each: color fringes, streak, grain, speed blur. Place under "How the parts draw". Steps: hold the test sketch `tests/pages/sketches/lens-kit-sketch.ts?look=aberration`, `?look=streak`, `?look=grain`, `?look=speed` at 0 on webgpu (the image tests lens-aberration, lens-streak, lens-grain, lens-speed-blur hold the same frames), crop and join.
- `lens-core-parts` (scripted): grade, vignette and sharpening side by side, from the same test sketch with `?look=grade`, `?look=vignette`, `?look=sharpen`. Place under "Use it with the engine's own settings".

Demo links: kit look in a scene -> `post-effects/` under "Use it".

Concepts with no demo: the speed blur in a scene; `lens.effect` being null on a device with no HDR target; changing `bloomLevel` with `set`.

### guides/loading-screens

Shots:
- `loading-card` (manual): a demo page's loading screen mid-load, with its label and bar, in Chrome with the Slow 4G profile. Place under "Show progress on the page".
- `network-waterfall` (manual): Chrome's network panel waterfall of a start, with listed files starting while the core downloads. Place under "Report progress from the sketch".

Demo links: stored pipeline list -> `showcase/island/` under "Repeat visits"; the preset check before play -> `instances/` under "The preset check".

Concepts with no demo: the page code for progress (`onProgress`, `onSketchMessage`); `presetCheck: 'before-play'`; `quality.setPreset` behind a cover; `preload` of features; a later loading stage with `scene.warmUp()`.

### guides/multiple-views

Shots:
- `split-screen` (reference): the multiple-views demo's default view, two cameras side by side among standing stones. Place under "A split screen". Reference: `tests/image/references/chrome-real-gpu/webgpu/demo-multiple-views.png`.
- `picture-in-picture` (scripted): the same demo with the layout choice set to Inset (V key), held at 1 s. Place under "A picture in picture".

Demo links: views -> `multiple-views/` under "A split screen".

Concepts with no demo: picking through a view (`scene.viewAt`, `view.screenToRay`); animating `view.setRect`; a rear-view mirror.

### guides/performance

Shots:
- `stats-overlay` (scripted): the instances demo with `?stats=open`, held at 2 s, showing the card with thread times, GPU time and draw calls. Place under "Measure".
- `overdraw-view` (scripted): the overdraw debug view, from `tests/pages/sketches/debug-view-sketch.ts?view=overdraw` (image test debug-view-overdraw). Place under "The depth prepass".
- `devtools-threads` (manual): Chrome's Performance panel recording a frame, with the sketch worker, render worker and job worker tracks. Place under "Where frame time goes".
- `large-world-cells` (reference): the large-world demo's default view. Place under "Large worlds". Reference: `tests/image/references/chrome-real-gpu/webgpu/demo-large-world.png`.

Demo links: moving instances -> `instances/` under "Moving objects cost uploads"; grid cells -> `large-world/` under "Large worlds"; rectangle and tube lights -> `area-lights/` under "Point and spot lights"; many lights against three.js -> `compare/night-town/` under "Point and spot lights"; crowds of skinned characters -> `compare/battle/` and `character/` under "Crowds and large scenes"; trees of moving parts -> `compare/factory/` under "Objects during play"; blended objects -> `weighted-transparency/` under "See-through objects"; post effects -> `post-effects/` under "Post effects and scene passes"; scene pass -> `security-camera/` under "Post effects and scene passes".

Concepts with no demo: the S1 to S6 benchmark scenes (bench pages, not demos); software occlusion on WebGL2; the memory peak; allocation-free per-frame code; Rust tasks through `runTask`.

### guides/phones

Shots:
- `presets-low-high` (scripted): the island showcase with `?preset=low` and `?preset=high` side by side, same hold time, same camera. Place under "The preset on a phone".
- `render-scale-text` (scripted): the canvas-screen demo at render scale 1 and at 0.5 (a test page that sets `quality.set({ maxRenderScale: 0.5 })`, since hold mode draws at `maxRenderScale`), cropped to a panel's text. Place under "Render scale".
- `chrome-inspect` (manual): `chrome://inspect` on a computer with an Android phone listed. Place under "Testing on real devices".
- `safari-develop-menu` (manual): Safari's Develop menu on a Mac with an iPhone listed. Place under "Testing on real devices".

Demo links: fewer instances on phones -> `instances/` under "The preset on a phone"; repeat visits and pipelines -> `showcase/island/` under "Networks and repeat visits".

Concepts with no demo: touch gestures and `touch-action: none`; heat; crashed starts; the back-forward cache.

### guides/physics

Shots:
- `crates-pile` (scripted): the page's Rapier crate example drawn as a test page, held at 3 s, showing the pile of crates on the floor. Place under "Example: crates that fall on a floor". The test page does not exist yet.

Demo links: fixed steps and repeatable frames -> `hold-mode/` under "Step the world at a fixed rate".

Concepts with no demo: Rapier in the sketch worker; cannon-es with one object per body; collision events sent to the page.

### guides/screens

Shots:
- `control-room` (reference): the canvas-screen demo's default view, the reactor control room's screens. Place under the intro. Reference: `tests/image/references/chrome-real-gpu/webgpu/demo-canvas-screen.png`.
- `lcd-close-up` (scripted): the same demo with the camera close to one panel, so the sub-pixel bars, scan band and dead texels show. Place under "The LCD look".
- `boot-glitch` (scripted): the same demo a few tenths of a second after a click on a panel, rows torn and the dark band rolling. Place under "The LCD look", beside `screen.boot()`.

Demo links: screens -> `canvas-screen/` under "Make a screen"; clicks on a canvas display -> `picking/` under "Clicks on a screen".

Concepts with no demo: `lcd: false`; a refresh rate per screen.

### guides/start-time

Shots:
- `network-protocol-size` (manual): Chrome's network panel with the Protocol column and transferred size shown for the core's `.wasm` file. Place under "Measure a start" or "Compress every file".
- `waterfall-gaps` (manual): a Slow 4G waterfall with a gap where nothing downloads, and the same start with the downloads started together. Place under "Start the first view's downloads at the top of the setup".
- `creek-first-frame` (scripted): the creek showcase at its first frame and once every model is in, side by side. Place under "Draw the first frame before the large models".

Demo links: first frame before the large models -> `showcase/creek/` under "Draw the first frame before the large models"; stored pipeline list -> `showcase/island/` under "Pipelines on phones"; streaming parts -> `splats/` under "Draw the first frame before the large models"; downloads started together -> `character/` under "Start the first view's downloads at the top of the setup".

Concepts with no demo: the early core script; compression and cache headers; HTTP/2; a service worker after the first frame.

### guides/testing

Shots:
- `hold-mode-frame` (reference): the hold mode demo's held frame, 400 balls in a pen. Place under "Frames that stay the same on every run". Reference: `tests/image/references/chrome-real-gpu/webgpu/demo-hold-mode.png`.
- `stats-open` (scripted): a demo with `?stats=open`, showing frames per second, frame work bars, scale and memory. Place under "Check every rendering mode".
- `save-recording` (scripted): a demo opened with `?record`, showing the Save recording button. Place under "Record a session that went wrong".

Demo links: repeatable frames -> `hold-mode/` (exists) under "Frames that stay the same on every run"; recorded input that replays to the same picture -> `replay/` under "Record a session that went wrong".

Concepts with no demo: `shot --script`; `null3d.json` image tests; Playwright browser tests of an app.

### guides/ui-overlays

Shots:
- `labels-follow` (reference): the picking demo's HTML labels over the pieces. Place under "Labels that follow objects". Reference: `tests/image/references/chrome-real-gpu/webgpu/demo-picking.png`.
- `labels-planes` (reference): the 3D labels demo, cards that turn with the ring. Place under "Labels that are planes of the scene". Reference: `tests/image/references/chrome-real-gpu/webgpu/demo-css3d-labels.png`.
- `page-under-scene` (reference): the depth-only demo, glass in front of an embedded page. Place under "A page under the scene". Reference: `tests/image/references/chrome-real-gpu/webgpu/demo-depth-only.png`.

Demo links: labels that follow -> `picking/` under "Labels that follow objects"; planes -> `css3d-labels/` (exists); holdout -> `depth-only/` (exists).

Concepts with no demo: a lil-gui panel; HUD messages between page and sketch; health bars.

### guides/video-textures

Shots:
- `video-on-plane` (scripted): a test page that registers a short clip and shows it on a plane, held once the first frame has arrived. Place under "Show a video on a surface". The test page does not exist yet.

Demo links: none.

Concepts with no demo: `engine.registerVideo` and `textures.fromVideo`; `maxSize` and the upload budget; `frameRate`; cross-origin video.
