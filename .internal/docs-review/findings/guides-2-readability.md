# Readability and layout review: slice guides-2

Pages: guides/lens-kit, guides/loading-screens, guides/multiple-views, guides/performance, guides/phones, guides/physics, guides/screens, guides/start-time, guides/testing, guides/ui-overlays, guides/video-textures.

Line numbers are file lines of `docs/<page-id>.md`. stats.json counts lines from the end of the front matter, so its line numbers are 7 less on every page in this slice. Word and sentence counts come from stats.json.

Findings 1 to 30 are verified against the page text. Findings 31 to 36 are "not verified": they were noted on a first read and not checked again.

---

## 1. guides/start-time: the page opens with 85 lines of before-and-after tables (high, structure)

- Anchor: "## Where the time goes", lines 27 to 110.
- Claim: Before the first instruction ("Compress every file", line 112), a reader passes six measurement tables (lines 31, 44, 64, 75, 88, 99) and four dense paragraphs. Most tables compare "before the changes" with "after", which is the history of the engine's own work, not what holds now. A newcomer who wants to know what to do must scroll past all of it. The writing rules say a page states what holds now and leaves when it happened to git.
- Evidence: line 29 "Before the changes that this guide describes, a first visit spent its time on these steps"; line 42 "Each change below was then measured alone"; line 60 "the same Mac timed the engine before and after the changes in turns"; line 86 "Before the changes, a first visit drew its first frame"; line 97 "With the changes, on the same devices".
- Proposed edit: Keep a short "Where the time goes" section: one table with the columns Step, Typical cost on a phone link, What shortens it (a link to the section). Base it on the first table (line 31), with present-tense rows. Put the rest of the figures in one block at the end of the section:
  `<details><summary>Technical details: measured starts on a simulated phone link and on real phones</summary>` ... the "Over HTTP/1.1" and "Over HTTP/2" tables, the two real-phone tables and the paragraphs at lines 106 to 110, rewritten as present-tense figures (for example "On a Galaxy S25 in Chrome, the creek demo draws its first frame in 5.7 s") ... `</details>`. Drop the "Change / Before / After" table at line 44, or turn each row into one present-tense figure in the section it links to.

## 2. guides/performance: one page of 8,423 words does three jobs (high, split-page)

- Anchor: whole page, 27 headings.
- Claim: The page explains the frame, lists the cost of each feature, and teaches measurement. At 8,423 words it is the longest guide in this slice. A reader who wants "how do I measure" finds "## Measure" at line 302 of 406, though line 15 tells them to measure first. The feature sections (lines 190 to 300) are a reference that a reader opens for one feature, not reads in order.
- Evidence: stats.json words 8423; headings "## Moving objects cost uploads" to "## The depth prepass" are 12 per-feature sections; "## Measure", "### The presented rate...", "## Measure fairly", "## Memory peak", "## Browsers differ" are 5 measurement sections at the end.
- Proposed edit: Split into three pages.
  1. guides/performance (keep the id): intro, "Where frame time goes", "The frame budget" with its H3s, "Put performance-sensitive work in Rust", "Write per-frame code that allocates nothing", "Objects during play", "How the engine batches...". Add a short "Measure first" section after the intro with three steps (open `?stats`, call `engine.measure`, run `bunx @null3d/cli bench`) and a link to the new measuring page.
  2. guides/performance-costs, "What each feature costs": lines 190 to 300, one H2 per feature as today.
  3. guides/measuring, "Measure performance": lines 302 to 405.
  Update the page inventory in tools/lib/docs.ts (PAGES) and the links from testing.md, start-time.md, phones.md and loading-screens.md that point at `performance.md#measure`, `#memory-peak`, `#the-depth-prepass` and `#phones-and-tablets`.

## 3. guides/testing: the page opens with performance rules, and the easiest path comes last (medium, scan-order)

- Anchor: "## Check every rendering mode", line 26; "## Image tests from the command line", line 147.
- Claim: The intro (line 24) is about image tests and hold mode. The first section is a checklist for frame rate, memory and the stats overlay, which belongs with measuring. Then the reader gets Playwright code (line 99) before the two commands that need no test code (`shot`, line 119, and `test`, line 149). A newcomer reads the hardest path first.
- Evidence: line 28 "check frame rate, memory and looks in each of these"; lines 45 to 50 explain the stats overlay's `Sketch`, `Drawing`, `GPU` and `Scale` fields; line 149 "`bunx @null3d/cli test` runs your image tests with no test code."
- Proposed edit: Reorder the H2s: Hold mode; Image tests from the command line; A held frame from the command line; Frames that stay the same on every run; When a hold fails; Reading the result in a test (Playwright); Record a session that went wrong; Browser tests of a whole app; Check every rendering mode; Switches for tests. Move the stats overlay list (lines 45 to 50) to the performance guide's "Measure" section and leave one sentence with a link.

## 4. guides/performance: the batching table holds paragraphs in its cells (medium, wall-of-text)

- Anchor: "## How the engine batches, builds pipelines and times frames", table at lines 170 to 178.
- Claim: Four answer cells are paragraphs of 6 to 15 sentences. The "Which passes walk the scene?" cell (line 175) is about 190 words. A table cell cannot hold lists or breaks, and on a phone screen the column becomes a long thin strip. The reader cannot scan it.
- Evidence: line 172 (what makes the GPU build a pipeline, 10 sentences), line 174 (what the engine batches, 7 sentences), line 175 (which passes walk the scene, 15 sentences).
- Proposed edit: Keep the table with a one-sentence answer per question. Example: "Which passes walk the scene? The culling pass, the opaque pass, and one more pass for each shadow cascade, scene pass, prepass and outline." Give each long answer its own H3 below the table, with the pass list as bullets. Put the draw-path facts (lines 174: direct versus indirect draws on Apple GPUs, meshes over 65,535 vertices) in a block `<details><summary>Technical details: direct and indirect draws</summary>`.

## 5. guides/performance: "the lower rows of the table" is not true of the "Objects during play" table (medium, unclear)

- Anchor: "## Objects during play", table at lines 133 to 152, and the bullet at line 164.
- Claim: Line 164 tells the reader that a `rebuilds` count above zero "points to one of the calls in the lower rows of the table". The rows are not sorted that way. Rows that cost "Nothing" (line 151) and "The object's weights" (line 148) sit among the rebuild rows, and a rebuild row (`texture.update()`, line 152) is last. A reader who looks at "the lower rows" gets the wrong set.
- Evidence: line 148 `setMorphWeight` costs "The object's weights"; line 151 `render.setPassEnabled` ... "Nothing"; lines 142 to 147 and 152 are rebuilds.
- Proposed edit: Split the table in two. "Calls that upload only what they change" (transform setters, `setVisible`, `setActiveCount`, `setLayers`, `setOccluder`, `setRenderOrder`, `material.set`, `setMorphWeight`, `render.setPassEnabled` and the others that cost nothing). "Calls that rebuild the draw tables" (create or destroy, `setMaterial`, `setMesh`, `setParent`, `setDynamic`, `setBounds`, `setFrustumCulled`, `scene.overrideMaterial`, shadow setters, `setLevelBias`, `setOutlined`, `texture.update()` at a new size, `texture.destroy()`). Keep the pass rows (`post.set`, `render.addPass`) in a third short table, "Calls that add passes". Change line 164 to "points to one of the calls in the rebuild table".

## 6. guides/performance: 21 long paragraphs (medium, long-paragraph)

- Anchor: file lines 78, 93, 103, 131, 192, 198, 220, 224, 259, 261, 265, 288, 292, 298, 300, 304, 339, 341, 343, 353, 355.
- Claim: stats.json lists 21 paragraphs over 4 sentences or 90 words. The worst are line 288 (163 words, 9 sentences), line 93 (147 words, 10 sentences) and line 259 (142 words, 9 sentences).
- Evidence: stats.json guides/performance longParagraphs.
- Proposed edit:
  - Line 93: keep the first four sentences (how the engine picks). Turn the rest into a list: "The preset sets: the pixel ratio cap; the anti-aliasing mode; the shadow settings; the texture filtering cap, upload budget and memory budget; the size of bloom and ambient occlusion; on WebGL2, the depth prepass, occlusion culling and the most morph targets per object."
  - Line 259 (area lights): a lead sentence, then bullets: cost per pixel; the `areaLights` cap per preset (4, 8, 16, 32); fading over 8 frames; short ranges; no cost without area lights.
  - Line 288 (WebGL2 blockers): numbered steps. 1. Turn it on with `softwareOcclusion`. 2. Mark a few large solid objects with `setOccluder(true)`. 3. Keep small props from blocking with `setOccluder(false)` or `"occluder": false`. 4. Compare `occludedEntries` with `visibleEntries`, and the job workers' time with the option on and off. Put the "few dozen triangles, under 2 pixels" detail in a technical details block.
  - Line 304 (stats overlay): two sentences on how to open it, then a list of what the card shows.
  - Lines 339, 343, 355: move into technical details blocks (see finding 7).
  - Lines 78, 131, 192, 198, 220, 224, 261, 265, 292, 298, 300, 341, 353: break each after its third or fourth sentence, at the point where it turns from the rule to the figures.

## 7. guides/performance: benchmark figures and browser internals crowd the advice (medium, technical-details-block)

- Anchor: lines 46 to 57, 65 to 89, 198, 261, 298 to 300, 343, 351, 355 to 357, 370 to 372, 401 to 405.
- Claim: Correct, useful figures sit inline with the rule they back. A reader who wants the rule must read the device, browser and millisecond figures to find it. Examples: the S1 per-thread table (line 48), the upload route timing (line 198), Chrome's heap sampling (line 343), why eleven is the sampling interval (line 351), Firefox and Safari completion lag (lines 355 to 357), Chrome command-line flags (370, 372), job worker counts per browser (401 to 405).
- Evidence: line 351 "Eleven is a prime above the longest far cascade interval, so the timed frames take in every turn of the far cascades."; line 343 "A render worker whose own heap is 1.4 MB can show as 52 MB."
- Proposed edit: Keep one figure per section in the main text, the one that makes the point. Move the rest into blocks, one per section, for example:
  `<details><summary>Technical details: how S1's frame splits on a MacBook Pro</summary>` (the table at line 48 and line 57) `</details>`;
  `<details><summary>Technical details: how uploads travel</summary>` (line 198) `</details>`;
  `<details><summary>Technical details: how each browser reports finished frames</summary>` (lines 351, 355 to 357) `</details>`;
  `<details><summary>Technical details: Chrome flags for GPU timing and uncapped frames</summary>` (lines 370, 372) `</details>`;
  `<details><summary>Technical details: job workers in each browser</summary>` (lines 401 to 405) `</details>`.

## 8. guides/loading-screens: the sections are out of the order that a loading screen runs (medium, scan-order)

- Anchor: H2 outline.
- Claim: A reader builds a loading screen in this order: report progress, show it, remove it at the first frame, then think about warm-up and later stages. Today "## The first frame" (line 151), which says when to remove the screen, comes after "## Pipelines and warm-up" and its H3. "## Textures after the loading screen" (line 234), which is about the same first frames, sits near the end, after "A change of preset". Start topics and play topics alternate.
- Evidence: heading order in stats.json: Report progress, Show progress, Pipelines and warm-up, Repeat visits, The first frame, The preset check, A later loading stage, Loading everything up front, A change of preset, Textures after the loading screen, Measure the warm-up.
- Proposed edit: Order the H2s as: Report progress from the sketch; Show progress on the page; The first frame; Textures after the loading screen; Pipelines and warm-up (with "Repeat visits"); The preset check; Loading everything up front; A later loading stage; A change of preset; Measure the warm-up. Update the cross-reference at line 161 ("as the next section says").

## 9. guides/loading-screens: 15 long paragraphs (medium, long-paragraph)

- Anchor: file lines 23, 57, 59, 61, 69, 134, 145, 153, 159, 172, 174, 194, 200, 202, 215.
- Claim: stats.json lists 15 long paragraphs. The worst are line 215 (182 words, 11 sentences), line 202 (175 words, 11 sentences), line 172 (164 words, 12 sentences) and line 134 (144 words, 10 sentences).
- Evidence: stats.json guides/loading-screens longParagraphs.
- Proposed edit:
  - Line 23 (intro): turn into a numbered list that matches the diagram: 1. the engine starts and the files download; 2. the setup builds the scene and posts progress; 3. warm-up builds the pipelines; 4. the first frame shows and the page removes the screen; 5. the preset check runs in the first moments of play.
  - Line 57: split into a list of three rules (list the files in setup order, name only what the first frame waits for, start the rest at `engine.firstFrame`) and one sentence on the download priority. Move "For a later stage..." to "A later loading stage".
  - Line 69: break after "Neither knows how much of the whole start is left." Make the rest a list: measure each phase on its own; within a phase the share never falls; across the start it can fall.
  - Line 153: break after "So a loading screen that waits for it can say why the scene never came."
  - Lines 134, 172, 174, 202, 215: see finding 10.
  - Lines 59, 61, 145, 159, 194, 200: break each after its third or fourth sentence.

## 10. guides/loading-screens: device figures and file-format detail belong in technical details blocks (medium, technical-details-block)

- Anchor: lines 122 to 134, 147, 172, 174, 202, 215.
- Claim: The rules that a reader needs are short ("check before play hides the change but makes the viewer wait"; "list features in `preload` to fetch nothing during play"). They are buried in device timings and the layout of the shader files.
- Evidence: line 172 "An 11-inch iPad Pro measured this with the check before play. Each benchmark scene and demo showed its first frame about 1 second after the call ... On a Galaxy S24+, the first frame showed after 0.23 to 0.43 seconds."; line 202 "Each such file takes at most 128 KB after Brotli. A WebGL2 file is larger than its WebGPU twin, and many WebGL2 files take more than 32 KB."
- Proposed edit:
  - Line 172: keep the first three sentences and "A phone starts at Low, which has no lighter preset, so the engine skips the check." Move the iPad, MacBook Pro and Galaxy timings into `<details><summary>Technical details: what the check costs on each device</summary>`.
  - Line 174: keep the first four sentences. Move the iPad timing to the same block.
  - Lines 122 to 134: keep the table and one sentence; move the showcase-scene figures in line 134 into `<details><summary>Technical details: pipeline builds of larger scenes on phones</summary>`, or replace them with a link to start-time.md#pipelines-on-phones.
  - Line 202: keep the first two sentences of line 200 and the sentence on `assets optimize` model lists. Move the file sizes, the paired-feature files and the glTF early start into `<details><summary>Technical details: how the first-use shader files are split</summary>`.
  - Line 215: keep "The listed files download beside the engine's own shaders, so the start waits only for the largest file." and the E1421 sentence. Move the WebGL2 and WebGPU first-draw behavior and the 70 ms figure into `<details><summary>Technical details: what a preload list builds before the first frame</summary>`.

## 11. guides/start-time: 16 long paragraphs (medium, long-paragraph)

- Anchor: file lines 25, 60, 106, 138, 140, 144, 162, 166, 200, 232, 244, 246, 248, 264, 270, 292.
- Claim: stats.json lists 16 long paragraphs. The worst are line 248 (126 words, 7 sentences), line 270 (109 words, 7 sentences) and line 244 (107 words, 6 sentences).
- Evidence: stats.json guides/start-time longParagraphs.
- Proposed edit:
  - Line 200: numbered steps. 1. Name the first view's files in `downloads`. 2. List them in the order the setup needs them. Then one sentence on the low priority and the move to the front, and one on hold mode.
  - Line 244: break after "Where the GPU misses the target frame rate, the engine lowers the preset in front of the viewer." The rest is about `engine.presetChecked` and repeat visits.
  - Line 248: move the whole paragraph (stored rounds, target rate, 4-second limit, quarter-of-target rule) into `<details><summary>Technical details: how the check measures</summary>`.
  - Line 270: keep the first three sentences. Move the list key (engine version, GPU path, shader bits, preset, canvas format) and the background builds into a technical details block.
  - Lines 60, 106: go into the block of finding 1.
  - Lines 25, 138, 140, 144, 162, 166, 232, 264, 292: break each after its third or fourth sentence.

## 12. guides/start-time: no checklist for a reader who scans (medium, scan-order)

- Anchor: page top, lines 13 to 25.
- Claim: The page has 15 H2 sections, split between the host's work and the sketch's work, but no list of the steps. A reader who wants "what do I change" must read 5,470 words. The intro (line 25) says "This guide gives the steps that shorten it, in the order of the start", but never lists them.
- Evidence: stats.json headings; line 25.
- Proposed edit: After line 25, add a short checklist in two groups, each item a link:
  "On the host: compress every file; let the browser keep the files; serve over HTTP/2; keep the early core script. In the sketch: start the first view's downloads at the top of the setup; draw the first frame before the large models; keep the first view's pipelines few; register a service worker only after the first frame. Then: test a production build, and measure the start."

## 13. guides/start-time: a "therefore" paragraph sits two paragraphs away from what it follows (medium, unclear)

- Anchor: "## What the engine does while the core downloads", lines 154 to 166.
- Claim: Line 166 starts "The sketch module's top-level code therefore runs before the engine has started". Its reason is the list at line 156 (the sketch worker imports the module while the core downloads). Between them sit a paragraph on the Vite plugin's import list (162) and a sentence on `load.drawingStart` (164). The "therefore" reads as if it follows from the measure figure. Line 162 also ends with maintainer history: "one was measured, and it made the start slower".
- Evidence: lines 160 to 166.
- Proposed edit: Move line 166 to follow line 160. Move line 164 to "## Measure a start". In line 162, change the last sentence to a present fact, for example "The engine's package has no `sideEffects` list, because such a list makes the start slower.", or cut it.

## 14. guides/testing: hold mode's internals bury what a test author needs (medium, technical-details-block)

- Anchor: "## Hold mode", lines 66 to 82.
- Claim: The numbered list is the right form, but steps 2 and 4 carry the reasons and the edge cases (motion vectors, mirrors, light probes). Then three paragraphs (74, 76, 78) explain frame counts, the extra frame for bounce light, tasks on the job workers and planned levels of detail. Line 78 is 218 words in 13 sentences, the longest paragraph in this slice. A test author needs: what hold mode fixes, how to start it, what you get, and the limits.
- Evidence: stats.json line 71 (file line 78) 218 words, 13 sentences; step 4 at line 71 "Motion vectors read the frame before, so with them it draws the frame before the last one too."
- Proposed edit: Keep each numbered step to its first one or two sentences. Keep line 74's first three sentences and line 80. Move the rest into one block:
  `<details><summary>Technical details: frame counts, extra frames, tasks and planned levels</summary>` the reason for one-at-a-time loads (step 2), the extra frames for motion vectors, mirrors and light probes (step 4), line 76, and line 78 split into two paragraphs (tasks on the job workers; planned levels and E1408) `</details>`.
  Keep in the main text one sentence: "Hold mode waits for tasks on the job workers and for planned levels of detail before it draws the held frame."

## 15. guides/testing: the switches table mixes everyday switches with engine diagnostics (medium, structure)

- Anchor: "## Switches for tests", lines 214 to 245.
- Claim: The table has 30 rows. A test author needs about eight: `hold`, `gpu`, `preset`, `check=fresh`, `builds=fresh`, `latency`, `threads=off`, `view`. The rest compare engine paths for performance work (`skinning=full`, `display-check=off`, `wake=message`, `scene-format`, `half`, `shadowdepth=32`, `multidraw=off`). Those long rows push the common ones apart. Line 214 also packs five facts about build types into one paragraph.
- Evidence: stats.json line 207 (file line 214) 94 words, 6 sentences; rows at lines 232, 236, 237, 238.
- Proposed edit: Turn line 214 into a list: "The switches work in: the dev server; the `null3d` command's runs; the CDN build's development entry. They do not work in a production build, unless you set `null3d({ urlSwitches: true })`." Then a table "Common switches" with the eight rows. Put the other rows in `<details><summary>Technical details: switches that compare the engine's paths</summary>` as a second table.

## 16. guides/phones: the Memory section is a wall of seven paragraphs on six topics (medium, structure)

- Anchor: "## Memory", lines 63 to 87.
- Claim: One H2 covers tab death, shared WebAssembly memory, texture budgets, KTX2 encoding, a second engine, object tables and crash recovery. Five of its paragraphs are long (73, 79, 81, 83, plus the table lead). The reader cannot find "how do I make textures smaller" or "what happens after a crash" by scanning.
- Evidence: stats.json lines 66, 72, 74, 76 (file 73, 79, 81, 83); line 81 "Encode its mip levels into the file, as `basisu -mipmap` does ... Use UASTC for normal maps and detailed color maps, and ETC1S where the download must stay small."
- Proposed edit: Split into H3s: "### How much memory a tab gets" (lines 65 to 77), "### Textures" (lines 79 to 81), "### A second engine on the page" (line 83), "### Large scenes" (line 85), "### After a crash" (line 87). In "Textures", keep "Load large textures from KTX2 files" and the size figure, and move the encoding advice (ASTC and ETC2, `basisu -mipmap`, UASTC versus ETC1S) into `<details><summary>Technical details: encoding KTX2 textures for phones</summary>`, or link to the asset pipeline.

## 17. guides/phones: 11 long paragraphs; the Heat section is one 178-word paragraph (medium, long-paragraph)

- Anchor: file lines 55, 57, 61, 73, 79, 81, 83, 91, 99, 103, 109.
- Claim: stats.json lists 11 long paragraphs. "## Heat" (line 91) is 178 words in 11 sentences and mixes advice, the governor's order and three device figures.
- Evidence: stats.json guides/phones longParagraphs, line 84 (file 91).
- Proposed edit:
  - Line 91: a list of what to do: "Aim for about 70% of the frame budget. Test runs of 10 minutes. Lighten your own work in `quality.onChange`." Then one sentence on the governor with its link. Move the Galaxy S24+ and iPad Pro figures into `<details><summary>Technical details: how warm devices slowed in the benchmarks</summary>`.
  - Line 61 (Shadows): break after "The preset sets the cascade count and the map size of each light whose options name neither." and make the advice ("leave `cascades` and `mapSize` out") its own short paragraph.
  - Line 99 (Touch input): break after "`input.touches` lists every finger on the canvas." Put the `touch-action: none` rule in its own sentence pair, with a CSS snippet.
  - Lines 55, 57, 73, 103, 109: break each after its third or fourth sentence. For 73, 79, 81, 83 see finding 16.

## 18. guides/start-time, guides/loading-screens, guides/performance, guides/phones: the preset check and pipeline figures are told four times (medium, duplication)

- Anchor: start-time "## The preset check" (lines 242 to 248) and "## Pipelines on phones" (250 to 280); loading-screens "## The preset check" (157 to 176), "### Repeat visits" (143 to 149) and line 134; performance line 93; phones line 103 and line 111.
- Claim: Each page explains the check, its two timings and its stored result in its own words, with its own device figures. The showcase pipeline figures (46 to 63 pipelines, 1.8 to 5.4 s on a Galaxy S25, 23.5 s on a Galaxy Tab A9 Plus) appear in start-time and in loading-screens. The island and creek failure on the Galaxy Tab A9 Plus appears in start-time (108 to 110) and phones (111). A reader who reads two guides reads the same long passage twice, and figures can drift apart.
- Evidence: start-time line 244 and loading-screens line 159 both describe the check in the first frames of play; start-time line 270 and loading-screens line 145 both describe the stored pipeline list; loading-screens line 134 "They took 1.8 to 5.4 seconds on a Galaxy S25" against start-time line 256.
- Proposed edit: Give each topic one home. The preset check: loading-screens.md "The preset check" (with the `before-play` code), and concepts/quality-presets for the rules. start-time.md keeps two sentences and a link. Pipeline builds on phones and the stored list: start-time.md "Pipelines on phones". loading-screens.md "Repeat visits" keeps two sentences and a link. phones.md keeps one sentence per topic with links, and drops the island and creek figures at line 111.

## 19. All 11 pages: the version banner says "Roadmap step" (medium, internal-note)

- Anchor: line 11 of each page, "> Roadmap step 0.x, first released in null3D 0.1.0."
- Claim: "Roadmap step" is a plan term. The rules forbid plans in docs/. On lens-kit, multiple-views, screens and video-textures it reads "Roadmap step 0.3, first released in null3D 0.1.0", which a user reads as a contradiction: a 0.3 step that shipped in 0.1.0.
- Evidence: lens-kit.md line 11; the sentence comes from `shipsSentence` in tools/lib/steps.ts, and the docs check (tools/lib/docs.ts, tests in tools/lib/docs.test.ts line 137) requires each page to start with it.
- Proposed edit: Change `shipsSentence` to give only the release, for example "First released in null3D 0.1.0. The API is experimental, so it can still change between versions.", and update the docs check and every page's banner to match. This is a site-wide change; it lists here only the pages of this slice.

## 20. guides/screens: the second example uses calls that the text explains only after it (medium, term-before-definition)

- Anchor: "## Make a screen", lines 50 to 68.
- Claim: The `onUpdate` example (lines 54 to 60) calls `screen.mark` and `screen.flush` and an undefined `paintTheReading`. The text that says what `mark`, `flush` and `paint` do comes after it (lines 63 to 65), and the rule about a refresh that returns false comes after that. `paint`, the call most readers need, has no example until "Clicks on a screen".
- Evidence: lines 54 to 60, then line 63 "`screen.paint(draw, changed)` draws and uploads the rectangle that changed."
- Proposed edit: Put a short table before the second example: `screen.paint(draw, rect?)` draws and uploads; `screen.mark(rect)` adds a rectangle without drawing; `screen.flush()` uploads the marked rectangles as one change, and returns false while the refresh rate holds it back. Rewrite the example with `screen.paint(...)` and an inline draw function, so the code runs as shown. Keep the `mark` and `flush` form as a second, shorter snippet.

## 21. guides/multiple-views: the Cost section mostly says what a view draws (medium, structure)

- Anchor: "## Cost", lines 98 to 108; "## What a view leaves out", lines 110 to 114.
- Claim: Of the five paragraphs under "Cost", line 102 is about what a view draws (shadows, background, fog, no ambient occlusion, no screen-space reflections) and line 106 is about which GPU paths draw views. A reader who looks for "what does a view not show" finds half the answer under "Cost" and half under "What a view leaves out". Line 106 has a semicolon join and a dense 8-bit path detail.
- Evidence: line 102 "Its objects take no ambient occlusion or screen-space reflections, which shade the camera's view."; line 106 "On the 8-bit path a view writes display color into the camera's image, and the resolve pass or the final pass draws it to the canvas; the picture looks the same as on the HDR path".
- Proposed edit: Keep lines 100, 104 (first sentence) and 108 under "Cost". Move line 102 to "What a view leaves out", as a list: draws (shadows of the camera's view, background, environment light, fog, the lights it sees); leaves out (ambient occlusion, screen-space reflections, objects that show a pass texture). Rename that section "What a view draws and its limits". Put line 106 and the depth-target sentence of line 104 into `<details><summary>Technical details: how views draw on each GPU path</summary>`.

## 22. guides/performance: the allocation advice has one 130-word bullet and no code (medium, example-placement)

- Anchor: "## Write per-frame code that allocates nothing", bullet at line 125.
- Claim: The last bullet covers light, camera, line and background setters, inlining, `material.set` boxing, `material.setUniform` and `camera.setPose` in eight sentences. It is the most useful advice in the section and the hardest to read. The section has no code, though each habit has a short good form.
- Evidence: line 125, from "A light's, the camera's, a line's and the background's setters" to "from the arrays that hold it."
- Proposed edit: Split line 125 into three bullets: setters allocate nothing, so call them from a small function; `material.set` is for setup; change a per-frame value with `material.setUniform(name, value)` and a camera with `camera.setPose(position, rotation)`. Add one code block after the list that shows a hot loop written the right way (index reads, reused arrays, `setUniform`). Move the inlining and boxing reasons into `<details><summary>Technical details: why some calls allocate in hot code</summary>`.

## 23. guides/lens-kit: the cost figures and the mark reads read better as a table and a block (low, technical-details-block)

- Anchor: "## How the parts draw" (lines 63 to 88) and "## Cost" (lines 100 to 116).
- Claim: Each mark gets a bold-led paragraph, and its neighbor reads are given later under "Cost". A reader comparing marks must hold both in mind. The M3 Max figure paragraph (line 111, stats line 106) mixes the test setup, the cost per megapixel and a note on WebGL2 measurement.
- Evidence: stats.json lines 67, 95, 106 (file lines 74, 102, 111); line 103 "The fringes take 2, the streak 10 and the speed blur 6, and the grain takes none."
- Proposed edit: Add a table under "How the parts draw": Mark | What it does | Neighbor reads | Needs. Rows: color fringes, 2, none; streak, 10, bloom; speed blur, 6, none; grain, 0, none. Keep the explanatory paragraphs short below it. Under "Cost", keep "a megapixel costs about a tenth of a millisecond" in the main text, and move the M3 Max setup and the WebGL2 note into `<details><summary>Technical details: how the cost was measured</summary>`.

## 24. guides/phones: a back-forward cache note sits under the driver section (low, structure)

- Anchor: "## When the GPU's driver refuses a shader", line 113.
- Claim: Line 113 says the engine gives back its GPU device in the back-forward cache. It has nothing to do with a refused shader, so a reader looking for it cannot find it. Line 111 repeats the island and creek failure figures from start-time.md lines 108 to 110.
- Evidence: line 113 "On phones and tablets, the engine also gives back its GPU device while the browser keeps the page in its back-forward cache."
- Proposed edit: Move line 113 to "## Power" (it saves the device's resources), or to a short H2 "When the page leaves and comes back". Replace line 111 with one sentence and a link to start-time.md#on-real-phones.

## 25. guides/ui-overlays: the GUI panel and health bar examples are incomplete (low, example-placement)

- Anchor: "## GUI panels", lines 159 to 174; "## Labels that follow objects", lines 78 to 95.
- Claim: The page code posts `exposure` and `bloom`, but the sketch handler applies only `exposure`, and it does not show where `page` and `post` come from. The health bar sets a `--hp` CSS variable, but no CSS rule uses it, so a reader who copies the code sees empty bars.
- Evidence: line 166 posts `'bloom'`; line 172 handles only `'exposure'`; line 93 `bar.style.setProperty('--hp', ...)`.
- Proposed edit: Add a `'bloom'` branch that turns bloom on and off in the form that api/post.md gives (`post.set({ bloom: {} })` turns it on with its last values), and show the context: `defineSketch(({ page, post }) => { ... })`. Add a three-line CSS block after the label page code: `.hp { width: 60px; height: 6px; background: linear-gradient(to right, #4caf50 var(--hp), #333 0); }`.

## 26. guides/physics: side notes come before the library table and the example (low, scan-order)

- Anchor: lines 21 to 38.
- Claim: Before the reader sees which libraries to use, the page explains the single-threaded build (line 23) and deterministic servers (line 25). The download size of each library (line 115), which helps a reader choose, sits after the first example.
- Evidence: line 23 "In the single-threaded build ..."; line 25 "Physics in the sketch only moves what the player sees."; line 115 "it adds about 1.2 MB after Brotli compression".
- Proposed edit: Order: intro paragraph (line 21), the library table with a "Download size" column (about 1.2 MB for the Rapier `-compat` package, about 20 KB for cannon-es), the install command, then the examples. Move lines 23 and 25 to a short "## Notes" list before "Related pages", or after "Step the world at a fixed rate".

## 27. guides/video-textures: the "Browser limits" list mixes limits, engine behavior and repeats (low, structure)

- Anchor: "## Browser limits", lines 93 to 103.
- Claim: The list has 9 bullets. Some are browser limits (formats, autoplay, CORS), some are engine behavior (101: how frames are reported; 103: the engine never controls playback). Line 100 repeats the code comment at lines 38 to 40, and line 98 repeats line 89.
- Evidence: line 100 "Keep the element in the page's layout, out of sight. An element that `display: none` hides may give no frame in some browsers."; lines 38 to 40 say the same.
- Proposed edit: Split into two lists: "Browser limits" (formats, autoplay and sound, cross-origin, `display: none`, phone frame rate) and "How the engine follows the video" (frame reports, `createImageBitmap`, playback stays with the element). Cut the repeats at lines 98 and 100, or shorten each to one sentence with a link up.

## 28. guides/start-time: demo history and the engine repository's own commands (low, internal-note)

- Anchor: lines 232, 284, 320.
- Claim: Line 284 tells what "the engine's demo page dropped", which is history. Line 232 names the showcase demos' `?grown` switch, which a user's page does not have. Line 320 gives `bun run bench:startup`, a command in the engine's repository that a user cannot run in their project. Each breaks the reader's flow with facts about the engine's own work.
- Evidence: line 284 "The engine's demo page dropped such a worker: it sent about 1,570 requests and 820 MB over the start's connections."; line 320 "The engine's repository times the engine's own start with `bun run bench:startup`."
- Proposed edit: Line 284: state the present fact, for example "A worker that caches a large build at load can send over a thousand requests on the start's connections." Line 232: cut the `?grown` sentence, or move it into a technical details block. Line 320: cut, or move into `<details><summary>Technical details: how the engine's own start is timed</summary>`.

## 29. guides/loading-screens: stray blank lines and a heading named in quotes (low, structure)

- Anchor: lines 176 to 179; line 215.
- Claim: Three blank lines follow line 176. Line 215 says `as "A later loading stage" shows` in quotes, where every other cross-reference on the page is a link. On the website the reader cannot click it.
- Evidence: lines 177 to 179 are empty; line 215.
- Proposed edit: Remove two of the blank lines. Change line 215 to `as [A later loading stage](#a-later-loading-stage) shows`.

## 30. guides/testing: a skill file named without a link, and a repeated paragraph (low, missing-content)

- Anchor: line 200; line 194.
- Claim: Line 200 points to "The null3d-develop agent skill's `references/e2e-testing.md`" with no link, so a reader on the website cannot open it. Line 194 repeats step 2 of hold mode (line 69) almost word for word.
- Evidence: line 200; line 194 "While the engine holds frames or replays, the sketch's `assets` calls run one at a time, in the order the sketch made them."
- Proposed edit: Link the skill file on GitHub (`https://github.com/null3d-engine/null3d/blob/main/skills/null3d-develop/references/e2e-testing.md`; the file exists at that path in the source tree). Cut line 194 to one sentence: "Loads that run side by side are safe in a held frame, as [Hold mode](#hold-mode) explains."

---

## Not verified

## 31. guides/phones: "Browsers on iPhone and iPad" comes late (low, scan-order) (not verified)

- Anchor: "## Browsers on iPhone and iPad", line 115.
- Claim: The Safari 18 requirement decides whether the sketch runs at all on an iPhone. It sits after the driver section, near the end.
- Proposed edit: Move it to follow "## The preset on a phone", or into the intro as one sentence.

## 32. guides/multiple-views: the picking timing note is dense (low, technical-details-block) (not verified)

- Anchor: line 96.
- Claim: The note on which frame's camera a view's call uses is correct but hard to follow for a newcomer.
- Proposed edit: Keep "A click during a fast turn of the view's camera can pick up to a frame of its motion away." Move the rest into `<details><summary>Technical details: which frame's camera a pick uses</summary>`.

## 33. guides/screens: the LCD look paragraph and the cost paragraph (low, long-paragraph) (not verified)

- Anchor: lines 72 to 76, 109 to 113 (stats lines 65, 102).
- Claim: Both paragraphs have 5 sentences. The derivative detail interrupts the description of the look.
- Proposed edit: Turn line 72's effects into a list (sub-pixel bars, drifting band, dark row foot, dead texels). Move "The pattern's size comes from the texture coordinates' derivatives" and the cost breakdown into one technical details block.

## 34. guides/performance: the governor is described in three places (low, duplication) (not verified)

- Anchor: lines 99, 212, 271.
- Claim: The governor's order of steps appears in "Quality presets", "Crowds" and "Shadows", in different words.
- Proposed edit: Keep the full order once at line 99, and use one sentence with a link in the other two.

## 35. guides/ui-overlays: limits are spread through the page (low, structure) (not verified)

- Anchor: lines 99 and 128.
- Claim: The 4,096-label and 256-plane limits sit in different sections.
- Proposed edit: Add a short "## Limits" list before "Related pages" with both limits and their options.

## 36. guides/performance: the engine repository's benchmark command in the intro (low, internal-note) (not verified)

- Anchor: line 13.
- Claim: "which the engine's repository runs with `bun run bench:run`" names a command that a user cannot run in their own project.
- Proposed edit: Cut the clause, or point to `bunx @null3d/cli bench`.
