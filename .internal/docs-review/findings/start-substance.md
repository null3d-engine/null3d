# Sense and substance review: slice "start"

Pages: cli/null3d, cookbook/index, getting-started/cdn, getting-started/first-scene, getting-started/hosting, getting-started/install, getting-started/network-use, getting-started/project-structure, getting-started/third-party-notices, index.

Line numbers are file lines in the generated copy. The paragraph lines in stats.json are 7 lower, because stats.json counts from the end of the front matter. Paths are relative to the generated copy's root.

Findings 1 to 30 are verified. Findings 31 and 32 are not verified.

---

## Findings, ranked

### 1. HIGH: the CDN page needs a copy of the engine's source and the Rust toolchain, and never says so
- Page: getting-started/cdn, getting-started/install
- Anchor: cdn "## Make the CDN build" (lines 22-35); install line 13 "To try the engine in one HTML file with no install, see Try null3D from a CDN"
- Category: missing-prerequisite
- Claim: The page tells the reader to run `bun run build` and `bun run build:cdn`. These are scripts of the engine's own repository, not of the npm packages. `bun run build` compiles the Rust core, so it needs rustup and the pinned nightly toolchain. No release publishes the CDN folder. A newcomer who follows "no install" from the install page cannot run either command.
- Evidence: package.json:27-29 (`"build": "bun tools/build-wasm.ts"`, `"build:cdn": "bun tools/build-cdn.ts"`); tools/build-cdn.ts:4 ("Run from the repository root, after `bun run build`"); README.md:260-265 (the Rust toolchain through rustup, `git clone https://github.com/null3d-engine/null3d.git`); .github/workflows/release.yml has no CDN build step.
- Proposed edit: Add a first section, "Before you start": "The CDN build comes from the engine's repository, not from npm. Clone it, install Bun and the Rust toolchain through rustup, as the repository's README says, and run the two commands in the clone." In install line 13, replace "with no install" with "with no bundler. That page builds the engine from its source once."

### 2. HIGH: the docs home has no link to install, the first scene or the templates
- Page: index
- Anchor: "## Where to start" (lines 36-43)
- Category: missing-content
- Claim: The landing page's start list goes to architecture, backends, performance, phones, hosting and porting. It has no link to Install null3D, Your first scene, Project structure or the CDN trial. A newcomer can reach them only through All pages.
- Evidence: index.md:38-43; the getting-started pages are listed only in pages.md:16-22.
- Proposed edit: Open "Where to start" with three bullets: "[Install null3D](getting-started/install.md): the packages and the Vite plugin." "[Your first scene](getting-started/first-scene.md): a turning box in four files." "[Project structure](getting-started/project-structure.md): start from a template with `bunx @null3d/cli create`." Then add "[Try null3D from a CDN](getting-started/cdn.md)" and "[For AI agents](guides/agents.md)".

### 3. HIGH: the offline feature table leaves out most of the shader features, and the text then names one that is not in it
- Page: getting-started/hosting
- Anchor: "## Offline play" table (line 289-295), and line 356 "`'color_copy'`"
- Category: missing-content
- Claim: The table lists nine shader features: ao, background, bloom, lines, morph, occlusion, skinning, sky and sprites. The build's file list also names coverage, hash, cutout, transmission, color_copy, translucency, subsurface, coat_sheen and weighted. A game whose service worker caches only the table's names misses those files. It then needs the network the first time it draws a masked, hashed, transmissive or weighted material. Line 356 tells the reader to cache `'color_copy'`, but the table never mentions it.
- Evidence: packages/engine/src/page/engine.ts:459-475 (preload lists `'coverage'`, `'hash'`, `'cutout'`, `'transmission'`, `'color_copy'`, `'translucency'`, `'subsurface'`, `'coat_sheen'`, `'weighted'`); packages/vite-plugin/src/offline.ts:81-90 (each shader feature in null3d-files.json takes its preload name); packages/engine/src/scene/shader-preloads.ts:34 (`features.push('ao', 'color_copy')`).
- Proposed edit: Change the first row to "Every name that `createEngine`'s `preload` takes ([Engine](../api/engine.md))". Put the full list, with the call that starts each one, in a `<details><summary>Technical details: every shader feature in the list</summary>` block under the table. Add: "Read `features` in your build's own `null3d-files.json` to see the names your build holds."

### 4. HIGH: the wall recipe hides nothing on WebGL2 as written, and on WebGPU only on High and Ultra
- Page: cookbook/index
- Anchor: "## Hide what walls hide" (lines 620-656)
- Category: wrong-claim
- Claim: The intro says "the engine skips those". On WebGL2, every preset leaves software occlusion off. The recipe is a sketch, and only the page's `createEngine` turns it on, so the recipe culls nothing there. On WebGPU, only High and Ultra on desktops cull. "Cull them on desktops without a mark" is unclear: the reader cannot tell what "a mark" means (it means `occluder: true`).
- Evidence: docs/concepts/culling.md:159 ("Every quality preset leaves software occlusion culling off"), culling.md:164 (`createEngine({ canvas, sketch, softwareOcclusion: true })`), culling.md:172 (WebGPU ignores the `softwareOcclusion` setting).
- Proposed edit: Rewrite the intro: "On WebGPU, the High and Ultra presets on a desktop cull hidden objects on the GPU, and pick the occluders themselves. On WebGL2, culling is off on every preset. Mark large blockers with `occluder: true`, and pass `softwareOcclusion: true` to `createEngine` on the page." Add the page line as a second code block, and say that the recipe alone shows no culling on WebGL2.

### 5. MEDIUM: the first scene tells the reader to catch the start error, but its code catches nothing
- Page: getting-started/first-scene
- Anchor: "## The page module" (lines 48-62)
- Category: missing-content
- Claim: Line 62 says `createEngine` rejects on Safari before 18, without SIMD or without a GPU path: "Catch it, and show the page without the scene." The page module uses a bare top-level `await createEngine(...)`. On such a browser, the module fails and the canvas stays blank with an uncaught error. This is the only page module a newcomer copies.
- Evidence: first-scene.md:53-57 and :62; packages/engine/src/errors/codes.ts:262-302 (E1301, E1303, E1306).
- Proposed edit: Show the catch in the code: `try { const engine = await createEngine({...}); await engine.firstFrame; } catch (error) { if (!(error instanceof EngineError)) throw error; canvas.replaceWith(Object.assign(document.createElement('p'), { textContent: 'This browser cannot show the 3D scene.' })); }`. Import `EngineError`, and keep the sentence that explains it.

### 6. MEDIUM: "Roadmap step" banners and the "step" column use internal plan language on every page
- Page: index, cli/null3d, cookbook/index, getting-started/cdn, getting-started/first-scene, getting-started/hosting, getting-started/install, getting-started/network-use, getting-started/project-structure, getting-started/third-party-notices (and pages.md)
- Anchor: line 11 of each page, "> Roadmap step 0.x, first released in null3D 0.1.0."; index.md:34 and :49; pages.md:11 and its "Step" column
- Category: internal-note
- Claim: "Roadmap step 0.1/0.2/0.3" names the maintainers' plan. A user cannot act on it, because all three steps ship in 0.1.0. It reads like a version number that differs from the release number, and so confuses the reader. AGENTS.md "Writing docs" bars internal plans in docs.
- Evidence: tools/lib/steps.ts:1-30 (`releaseOf`, `shipsSentence`, `STEPS_NOTE`), tools/lib/docs.test.ts:135-142 (the docs check requires the sentence).
- Proposed edit: In tools/lib/steps.ts, make `shipsSentence` return "Available since null3D 0.1.0." for the three steps, and drop `STEPS_NOTE`. Rename the "Step" column of pages.md to "Since", and show 0.1.0. Remove index.md:34, and change :49 to "with its status and the release that added it". Update the docs check's expected sentence to match.
- Generated source: tools/lib/steps.ts, tools/lib/docs.ts (pages.md and the banner check)

### 7. MEDIUM: the cookbook does not say which file each address needs
- Page: cookbook/index
- Anchor: line 21 "The recipes that load files name them as a project serves them from its public folder"
- Category: missing-prerequisite
- Claim: Four recipes load `/models/knight.glb`, `/models/morph-cube.glb` or `/env/sunset.hdr`. The page links three sources, but it does not say which file of each goes at which address. The KayKit pack holds many files, and the Khronos repository holds hundreds. The third-person and crowd recipes also hide node names, such as `1H_Sword`, that exist only in that Knight file.
- Evidence: tests/lib/skill-sketches.ts:89-93 (`/models/knight.glb` is `kaykit-knight/Knight.glb`, `/models/morph-cube.glb` is Khronos AnimatedMorphCube, `/env/sunset.hdr` is `polyhaven/venice_sunset/venice_sunset_2k.hdr`).
- Proposed edit: Replace the sentence with a table: "Address | File | Source": `/models/knight.glb` is `Knight.glb` from KayKit Adventurers; `/models/morph-cube.glb` is `AnimatedMorphCube.glb` from the Khronos glTF sample assets; `/env/sunset.hdr` is `venice_sunset_2k.hdr` from Poly Haven. Say that the weapon names in two recipes belong to the Knight file.

### 8. MEDIUM: Project structure does not say how to get the agent skill
- Page: getting-started/project-structure
- Anchor: "## The agent files", line 70 "The project does not hold a copy of the skill today."
- Category: missing-content
- Claim: The page says that an agent reads `.claude/skills/null3d-develop/SKILL.md` when it exists. It does not say how to put it there. "Today" also suggests a later change, which the writing rules forbid. The install steps are on the For AI agents guide, which this page never links.
- Evidence: docs/guides/agents.md:29-40 (the plugin, the release zips, `bunx skills add https://github.com/null3d-engine/null3d/tree/0.1.0/.claude/skills/null3d-develop`).
- Proposed edit: "The template holds no copy of the skill. [For AI agents](../guides/agents.md) shows how to add it, as a Claude Code plugin or with `bunx skills add`. When the project has `.claude/skills/null3d-develop/SKILL.md`, an agent reads that file. Otherwise it reads the engine docs in `node_modules/@null3d/engine/docs/`, which match the installed version."

### 9. MEDIUM: Network use names one `preload` and leaves out the other
- Page: getting-started/network-use
- Anchor: "## What your own code downloads", line 42 "`preload` downloads the features that you list, when you call it."
- Category: unclear
- Claim: The engine has two preloads. `createEngine`'s `preload` option takes feature names and is not a call. `assets.preload` takes file addresses and is a sketch call. The bullet mixes the two, and the list of calls that download addresses leaves out `assets.preload`.
- Evidence: packages/engine/src/scene/assets.ts:777 (`preload(urls)`), packages/engine/src/page/engine.ts:459-475 (the `preload` option takes feature names); the cookbook uses `assets.preload` at cookbook/index.md:284.
- Proposed edit: Add `assets.preload` to the first bullet's list of calls. Replace line 42 with "`createEngine`'s `preload` option downloads the shaders of the features that it lists, before the first frame. These are engine files, from the engine's own address."

### 10. MEDIUM: Hosting has eight long, dense paragraphs that should move into technical-details blocks
- Page: getting-started/hosting
- Anchor: lines 210, 243, 267, 297, 350, 366, 384, 388 (stats.json lines 203, 236, 260, 290, 343, 359, 377, 381)
- Category: technical-details-block
- Claim: These paragraphs hold correct detail that only implementers need: Chrome's code-cache write timing (201 words, 13 sentences), HTTP/1.1 connection counts, shader file variants, the dev server's compression, and Safari over HTTP/2. They make the page hard to scan for its main task, which is to send two headers.
- Evidence: stats.json getting-started/hosting longParagraphs; line 267 cites Chrome 156, 157 and 158 and timings in ms.
- Proposed edit: For line 267, keep the first two sentences ("Chrome writes the code while the page runs... It first compiles each function quickly, and optimizes the functions that run most."), then add one: "So a repeat visit gains only after an earlier visit ran the engine for a few seconds." Move the rest into `<details><summary>Technical details: when Chrome writes the compiled core</summary>`. Do the same for line 243 ("Technical details: listed downloads over HTTP/1.1 and HTTP/2"), line 297 ("Technical details: shader files for each device"), line 366 ("Technical details: what the dev server and the preview compress"), and lines 384 and 388 ("Technical details: HTTP/2 on Safari and untrusted certificates"). Lines 210 and 350 need only a split into two paragraphs.

### 11. MEDIUM: the command page has 14 long paragraphs; the gate and asset detail belongs in blocks
- Page: cli/null3d
- Anchor: lines 39, 52, 191, 210, 223, 300, 312, 347, 442, 446, 470, 488, 539, 541 (stats.json 32...534)
- Category: technical-details-block
- Claim: The allocation gate (line 442, 161 words) and `assets optimize` (line 446, 154 words) are the longest paragraphs in the slice. They use terms such as "permutation bits", "pipeline keys" and "samples a page that allocates faster less finely" with no explanation. The impostor bake (lines 539-541) and the glTF extras (line 470) are dense reference text.
- Evidence: stats.json cli/null3d longParagraphs.
- Proposed edit: Line 446: keep three sentences: "`assets optimize` makes glTF models smaller and faster to load and draw. Each model becomes one `.glb` file with its textures in a `textures` folder beside it. It prints a budget report for each model." Move the merge, quantization, clip-rate and shader-list detail into `<details><summary>Technical details: what optimize changes in a model</summary>`. Line 442: keep "The allocation gate counts the bytes that the add-on's own code allocates in each frame, on each preset. It fails only when it cannot measure the add-on's code." Move the rest into `<details><summary>Technical details: how the allocation gate samples</summary>`. Put lines 470 and 539-541 in blocks too. Split lines 191, 347 and 300 into two paragraphs.

### 12. MEDIUM: Network use repeats the Chrome for Testing section of the command page in one 162-word paragraph
- Page: getting-started/network-use, cli/null3d
- Anchor: network-use line 73 "To draw on your computer's GPU, the tool uses one pinned version of Chrome for Testing"; cli "### Chrome for Testing" (lines 590-599)
- Category: duplication
- Claim: Line 73 restates the download, the hash check, E1437, the fallback, the cache folder and the two `NULL3D_CHROME` values, all of which the command page lists. Lines 75-84 are also hard-wrapped mid-paragraph, unlike every other page.
- Evidence: network-use.md:73 vs cli/null3d.md:594-599; stats.json network-use longParagraphs lines 66 and 73.
- Proposed edit: Shorten line 73 to: "To draw on your computer's GPU, the tool downloads one pinned Chrome for Testing once, from Google's `storage.googleapis.com`, and checks its SHA-256 hash. With `CI` or `NULL3D_CHROME=installed` set, it downloads nothing. [Chrome for Testing](../cli/null3d.md#chrome-for-testing) gives the check, the fallback and the cache folder." Unwrap lines 75-84.

### 13. MEDIUM: Install's list of plugin jobs and its cache paragraph are dense reference text in a getting-started page
- Page: getting-started/install
- Anchor: "## Add the Vite plugin" bullets (lines 50-57), "## Builds" line 71
- Category: technical-details-block
- Claim: Several bullets explain bundler internals that a newcomer does not need: ES module workers and the 34 MB classic workers (line 53), file preloading inside workers (line 54), and data addresses under a strict policy (line 57). Line 71 explains the shader cache's key. The page's job is to install the packages and add the plugin.
- Evidence: install.md:50-57, :71; stats.json getting-started/install longParagraphs line 64.
- Proposed edit: Keep a short list: headers, compression and HTTPS, the sketch and core build, the WGSL compile, the development checks, and the notices and file list. Move the worker-format, worker-preload and data-address bullets into `<details><summary>Technical details: how the plugin builds the engine's files</summary>`. Move line 71's key and miss rules into `<details><summary>Technical details: the shader cache's key</summary>`, and keep "The plugin keeps each compiled shader in `node_modules/.cache/null3d-shaders`, so a later build of the same shader compiles nothing."

### 14. MEDIUM: CDN page's entry and build detail is dense, with long paragraphs
- Page: getting-started/cdn
- Anchor: lines 31, 43, 187; "## Production and development entries" lines 56-64
- Category: technical-details-block
- Claim: Lines 31, 43 and 187 are long. The entries section mixes the one rule a trial needs ("use the development entry while you work") with how to tell the entries apart through `?threads=off` (line 62) and with the benchmark build (line 64).
- Evidence: stats.json getting-started/cdn longParagraphs lines 24, 36, 180; cdn.md:62, :64.
- Proposed edit: Move lines 58, 62 and 64 into `<details><summary>Technical details: telling the entries apart, and a benchmark build</summary>`. Split line 43 into a "Headers for the CDN" list: CORS, the `.wasm` type, a version prefix and `immutable`.

### 15. MEDIUM: "a pipelined page" is used without explanation
- Page: getting-started/hosting
- Anchor: line 199 "In this version, a pipelined page's start downloads about:"
- Category: term-before-definition
- Claim: "Pipelined" is defined only in concepts/architecture. A reader of the hosting page cannot tell whether their page is pipelined. "In this version" also suggests the figure will change, which the writing rules ask pages to avoid.
- Evidence: hosting.md:199; pages.md:28 ("the pipelined frame" belongs to concepts/architecture).
- Proposed edit: "With the default threaded setup, a page's start downloads about:" Add a link to [Architecture](../concepts/architecture.md) if the latency mode matters, and drop "In this version".

### 16. MEDIUM: the benchmark claim on the docs home does not name the benchmark or how it was measured
- Page: index
- Anchor: line 13 "A scene graph of 5,096 objects costs null3D 0.35 ms of CPU time per frame, and three.js 3.18 ms."
- Category: wrong-claim
- Claim: AGENTS.md "Writing docs" asks pages to name the engine's benchmarks when they cite a figure. The figure is S2, measured in a production build in Chrome on a MacBook Pro. The home page gives neither the name nor the machine, and the losing scene is S1-static.
- Evidence: README.md:152 ("S2: a scene graph of 5,096 objects, 6 levels deep | 0.35 ms | 3.18 ms"), README.md:156 (S1-static 0.20 vs 0.07 ms); docs/guides/performance.md:13.
- Proposed edit: "In S2, the engine's benchmark scene graph of 5,096 objects, null3D takes 0.35 ms of CPU time per frame and three.js 3.18 ms, in Chrome on a MacBook Pro. null3D loses S1-static, in which 100,000 boxes stand still."

### 17. MEDIUM: `create` says it never overwrites hook files, but it refuses any folder that has files
- Page: cli/null3d
- Anchor: "## create", line 39 "The command never overwrites an existing `.claude/settings.json` or `.codex/hooks.json`"
- Category: contradiction
- Claim: The sentence suggests that `create` can merge into a folder that has these files. The code stops on any folder that is not empty. It names these two files only to give a clearer message.
- Evidence: packages/cli/src/create.js:140-151 (a special error for the two files, then `"is not empty, and create needs an empty folder"`).
- Proposed edit: "The folder must not exist, or it must be empty. A folder that holds `.claude/settings.json` or `.codex/hooks.json` gets its own message, because those files can hold your own hooks."

### 18. MEDIUM: check-addon uses "a listing", "gates" and "plugin interface range" without explanation
- Page: cli/null3d
- Anchor: "## check-addon", lines 412 and 425
- Category: term-before-definition
- Claim: "A listing runs it before it publishes the add-on" names no listing, and the reader cannot tell what or where it is. "The engine's gates" comes before the gate table. "The plugin interface range" is explained only on the add-ons guide.
- Evidence: cli/null3d.md:412, :425; docs/guides/add-ons.md:6 and :29 (`pluginInterface: { min, max }`).
- Proposed edit: "`check-addon` runs the engine's checks for add-ons, called gates, on one add-on package. Run it before you publish an add-on." Change the interface row to "the entry's `pluginInterface` range ([Building an add-on](../guides/add-ons.md)), or...". Drop "a listing", or name the catalog if one exists.

### 19. MEDIUM: Install says Bun runs every command, and the command page says the tool needs Node
- Page: getting-started/install, cli/null3d
- Anchor: install line 15 "The commands on these pages use Bun 1.4.3 or newer"; cli line 23 "The command needs Node 20.19 or later, or Node 22.12 or later"
- Category: contradiction
- Claim: The command's entry runs under Node, so a Bun-only reader cannot tell whether `bunx @null3d/cli` works without Node. Install never names Node.
- Evidence: packages/cli/bin/null3d.js:1 (`#!/usr/bin/env node`); packages/cli/package.json:49-50 (`"node": "^20.19.0 || >=22.12.0"`).
- Proposed edit: Say one thing on both pages, such as: "`bunx @null3d/cli` runs the tool with Node, so install Node 20.19 or later, or 22.12 or later, beside Bun." Or, if Bun's own Node shim is supported, say that and test it.

### 20. LOW: the `--url` row says "the server" starts a browser
- Page: cli/null3d
- Anchor: mcp options table, `--url` row (line 218) "The server still starts its own browser"
- Category: unclear
- Claim: The command starts the headless browser, not the dev server.
- Evidence: packages/cli/src/mcp.js:11 ("`--url` attaches to a dev server that already runs, still with its own headless browser").
- Proposed edit: "Uses a dev server that already runs, instead of starting one. The command still starts its own headless browser."

### 21. LOW: Network use names "a replay page" and hold-mode downloads without explanation
- Page: getting-started/network-use
- Anchor: line 17 "A replay page names a recording..."; line 43 "A recording, a replay and hold mode download them only at their loads."
- Category: term-before-definition
- Claim: Recordings, replays and hold mode are explained on the testing guide, and this page never links it. Line 43 is hard to parse: it means these modes ignore the download list and download each file when the sketch loads it. Lines 17 and 28 use semicolons to join sentences.
- Evidence: docs/api/sketch.md:101 ("Hold mode, a replay and a recording download each file at its load, as without the list, so their runs stay the same").
- Proposed edit: Line 17: "A page that replays a recording ([Testing](../guides/testing.md#record-a-session-that-went-wrong)) downloads the recording from the address that the page gives. It uses no other address." Line 43: "In hold mode, a recording and a replay, each file downloads when the sketch loads it, so every run stays the same." Split the semicolons.

### 22. LOW: Project structure does not say how to turn off the hook, or which scripts the template holds
- Page: getting-started/project-structure
- Anchor: "## The agent files" lines 72-78; "## Make a project" line 39 `bunx vite`
- Category: missing-content
- Claim: The template's own AGENTS.md says how to stop the hook, and this page does not. The template's package.json has `dev`, `build` and `preview` scripts, but the page runs `bunx vite` and never names them.
- Evidence: packages/cli/templates/empty/AGENTS.md ("The hook is optional: delete its entries in `.claude/settings.json` and `.codex/hooks.json`, or the hook file, to stop the checks"); packages/cli/templates/empty/package.json scripts.
- Proposed edit: Add "To stop the checks, delete the hook's entries in `.claude/settings.json` and `.codex/hooks.json`, or delete the hook file." Change the run step to `bun run dev`, and list `build` and `preview` in the package.json row.

### 23. LOW: `create` is described twice, on the command page and on Project structure
- Page: cli/null3d, getting-started/project-structure
- Anchor: cli "## create" (lines 25-39); project-structure "## Make a project" (lines 33-48)
- Category: duplication
- Claim: Both pages give the `--template` option table, the empty-folder rule and "installs nothing, run bun install". If one changes, the other can go stale.
- Evidence: cli/null3d.md:35-39 vs project-structure.md:42-48.
- Proposed edit: Keep the option table and the folder rule on the command page. On Project structure, keep the template table and the four commands, and link "[create](../cli/null3d.md#create) gives its options".

### 24. LOW: three pages give three different strict policies
- Page: getting-started/hosting, getting-started/cdn, getting-started/network-use
- Anchor: hosting line 49; cdn line 168; network-use line 93
- Category: duplication
- Claim: The hosting page's strict policy has no `connect-src`. Network use's policy adds `connect-src 'self'`, and the CDN page has its own. A reader cannot tell which one is the canonical one. The hosting text at line 54 explains `connect-src`, but its policy does not hold it.
- Evidence: hosting.md:49 vs network-use.md:93 vs cdn.md:168.
- Proposed edit: Make hosting line 49 the one strict policy, with `connect-src 'self'`. In Network use, "Check the claim" says "Send the strict policy from [Hosting](hosting.md#content-security-policy)" instead of repeating it. Keep the CDN policy, because it differs on purpose, and say how it differs.

### 25. LOW: four pages repeat the publish-the-notices instruction
- Page: getting-started/hosting, getting-started/cdn, getting-started/install, getting-started/third-party-notices
- Anchor: hosting "## Publish the third-party notices" (215-219); cdn line 228; install line 55; third-party-notices line 94
- Category: duplication
- Claim: Four pages give the same "Keep that file with the build, or show its text in your credits" text.
- Evidence: the lines cited above.
- Proposed edit: Keep the rule on Third-party notices. In hosting, replace the section with one sentence and a link. Keep install's bullet as a link only.

### 26. LOW: the cookbook links no demo
- Page: cookbook/index
- Anchor: each recipe's closing paragraph
- Category: missing-content
- Claim: Most recipes have a fuller demo in the examples folder. The page links only the examples folder (line 664). stats.json shows no example links.
- Evidence: examples/demos.ts entries picking, character, morph-flowers, time-of-day, post-effects, security-camera, canvas-screen, sprites-lines and galaxy; examples/compare/comparisons.ts battle.
- Proposed edit: Add a "Demo:" link after each recipe's related-page link, as listed in the demos section for this page below.

### 27. LOW: the docs home puts a rule for agents under "Status labels"
- Page: index
- Anchor: line 30 "Coding agents use only the APIs that these pages and the engine's type declarations show. The null3D agent skills follow the same rule."; line 45 "From version 0.1, the same pages ship inside..."
- Category: structure
- Claim: The agent rule does not belong under status labels, and it reads as an instruction to agents, not to the page's reader. "From version 0.1" describes history.
- Evidence: index.md:30, :45.
- Proposed edit: Move the agent sentence under a short "For coding agents" paragraph, next to the page-ID sentence, with a link to [For AI agents](guides/agents.md). Change line 45 to "The same pages ship inside the `@null3d/engine` package...".

### 28. LOW: Third-party notices uses "moment transparency layer" without explanation, and names SMAA two ways
- Page: getting-started/third-party-notices
- Anchor: line 53 "SMAA, the subpixel morphological anti-aliasing that smooths the moment transparency layer's edges"; line 19 "SMAA 1x" vs line 53 "SMAA"
- Category: term-before-definition
- Claim: A reader of a license page does not know what the moment transparency layer is. The name changes between the two tables.
- Evidence: third-party-notices.md:19, :53, :84.
- Proposed edit: "SMAA 1x, the anti-aliasing of the optional moment transparency mode ([Moment transparency](../concepts/quality-presets.md#moment-transparency))". Use "SMAA 1x" everywhere, and link the quality presets page.

### 29. LOW: Hosting measured the code cache on Chrome 158, but the command pins Chrome 156, which has the fault
- Page: getting-started/hosting, cli/null3d
- Anchor: hosting line 267 "On the engine's test page in Chrome 158 ... Chrome 156 and earlier have a fault ... Chrome 157 fixed it."; cli line 319 "Chrome 156.0.8078.80"
- Category: missing-content
- Claim: A developer who times repeat starts with the command's browser draws with Chrome 156, which "rarely keeps the code". Neither page says so, so a timing of a repeat start can look worse than a user's.
- Evidence: packages/cli/src/browser.js:68 (`CHROME_FOR_TESTING_VERSION = '156.0.8078.80'`); hosting.md:267.
- Proposed edit: In the new technical-details block for line 267, add: "The command line tool's pinned Chrome for Testing is a version with this fault, so time repeat starts in a current Google Chrome."

### 30. LOW: the first scene's flat layout differs from the templates' `src/` layout
- Page: getting-started/first-scene, getting-started/project-structure
- Anchor: first-scene line 22 "Put the four files below in one folder"; project-structure table `src/page.ts`, `src/sketch.ts`
- Category: unclear
- Claim: Project structure says "[Your first scene] explains the page module, the sketch module", but the two pages put the files in different places. The first scene also has no `package.json` or `tsconfig.json`, which the `test` command needs.
- Evidence: first-scene.md:22, :39 (`src="./page.ts"`); project-structure.md:54-58; packages/cli/templates/empty/src.
- Proposed edit: In first-scene, add: "A project from `bunx @null3d/cli create` keeps the two modules in `src/`, with a `package.json` and a `tsconfig.json` ([Project structure](project-structure.md))."

### 31. LOW (not verified): cookbook wording uses engine jargon
- Page: cookbook/index
- Anchor: line 58 "A click that outlines a mesh rebuilds the engine's draw tables once."; line 19 "exists and runs in this version"
- Category: unclear
- Claim: "Draw tables" is not explained. "In this version" is time-relative.
- Evidence: cookbook/index.md:19, :58.
- Proposed edit: "An outline change costs some CPU work once, so change it on a click, not in every frame." Use "So each call that a recipe shows exists and runs."

### 32. LOW (not verified): plain HTTP may fall back to Low, not Medium
- Page: getting-started/hosting
- Anchor: line 368 "A page served over plain HTTP on a network address silently falls back to WebGL2 at Medium."
- Category: wrong-claim
- Claim: WebGL2 runs at most Medium. A weak device, or the preset check, can choose Low.
- Evidence: docs/concepts/backends.md:56 ("WebGL2 and WebGPU's compatibility mode run at most the Medium quality preset").
- Proposed edit: "...falls back to WebGL2, at Medium or lower."

---

## Screenshots and demos, per page

### index
- Shots:
  - `showcase-island` (reference): the Island showcase's default view, under the opening paragraph, as the page's hero picture. Reference: tests/image/references/chrome-real-gpu/webgpu/demo-island.png. Alt: "A hilly Mediterranean island with forests, a beach and a harbour town, drawn by null3D with WebGPU." Source files: examples/showcase/island/, examples/demos.ts.
  - `compare-factory` (scripted): the factory comparison with null3D and three.js side by side and their frame times, under "Faster than three.js". Steps: open the comparison page for compare/factory/ at its default count, and hold both sides at the same time. Source files: examples/compare/comparisons.ts, examples/compare/factory/.
- Demo links: Island at https://github.com/null3d-engine/null3d/tree/main/examples/showcase/island/ (under the opening). The factory comparison at https://github.com/null3d-engine/null3d/tree/main/examples/compare/factory/ (under "Faster than three.js").
- Concepts with no demo: status labels, page IDs, docs that ship in the package.

### getting-started/install
- Shots:
  - `shader-compile-line` (manual): the terminal during a first `bunx vite build`, with the plugin's line that names the shader it compiles and the cache folder, under "## Builds". Source files: packages/vite-plugin/src/index.ts.
- Demo links: none fit well. A small demo such as generators (https://github.com/null3d-engine/null3d/tree/main/examples/generators/) could go under "## Run the sketch" as a "bigger first project".
- Concepts with no demo: the Vite plugin's jobs, the shader cache, version pinning, the CLI install.

### getting-started/first-scene
- Shots:
  - `turning-box` (scripted): the page's own sketch, a blue box on a dark background lit by a directional and an ambient light, held at 1 s, under "## Run it". Steps: put the four files in a folder, then run `bunx @null3d/cli shot --time 1 --size 1280x720 --out turning-box.png`. Source files: docs/getting-started/first-scene.md (the code), packages/cli/templates/empty/src/sketch.ts.
- Demo links: Objects and parents at https://github.com/null3d-engine/null3d/tree/main/examples/objects/ (under "## Next steps", with Objects and transforms). Instancing at https://github.com/null3d-engine/null3d/tree/main/examples/instances/ (under "## Next steps", with Instances and batching).
- Concepts with no demo: createEngine errors and their catch, the pixel-ratio cap, the page and sketch split itself.

### getting-started/project-structure
- Shots:
  - `template-empty`, `template-product`, `template-game` (scripted): each template's first view, side by side in the template table. Steps: `bunx @null3d/cli create t-<name> --template <name>`, `bun install`, then `bunx @null3d/cli shot --time 2 --out template-<name>.png` in each folder. Source files: packages/cli/templates/*/src/sketch.ts.
  - `hook-flag` (manual): an agent session in which the hook flags an allocation in onUpdate, with its message, under "## The agent files". Source files: packages/cli/src/agent-rules.js, packages/cli/templates/empty/.agent/agent-hook.mjs.
- Demo links: Showroom to street at https://github.com/null3d-engine/null3d/tree/main/examples/showroom/ (beside the product template, a fuller viewer). Input and actions at https://github.com/null3d-engine/null3d/tree/main/examples/input/ (beside the game template's keys and gamepad).
- Concepts with no demo: the agent hook, AGENTS.md, the package pins.

### getting-started/hosting
- Shots:
  - `console-isolated` (manual): the browser console with `crossOriginIsolated` returning `true` on a page with the two headers, under "## The two headers".
  - `network-brotli` (manual): the browser network panel with the engine core's `.wasm` row, showing the transferred size against the size, under "## Send the files with Brotli".
  - `response-headers` (manual): the developer tools' headers view of a `.wasm` response showing `Content-Type: application/wasm` and `Cache-Control: ... immutable`, under "## Let Chrome keep the compiled core".
  - `cache-storage` (manual): DevTools Application > Cache Storage with a `game-<version>` cache that holds the start's files, under "## Offline play".
  - `service-worker-offline` (manual): DevTools Application > Service Workers with "Offline" ticked and the game running, plus the console showing `crossOriginIsolated` true, under "### Keep the page isolated".
- Demo links: none of the demos is about hosting.
- Concepts with no demo: COOP/COEP, CORS/CORP, CSP, the CDN base, Electron, Brotli, caches, offline play, mkcert HTTPS.

### getting-started/cdn
- Shots:
  - `one-file-box` (scripted): the "One HTML file" page's orange unlit box on a dark blue background, under "## One HTML file". Steps: serve the page and a CDN build folder locally, and capture the canvas after the first frame. Source files: docs/getting-started/cdn.md (the HTML), tools/build-cdn.ts, tools/lib/cdn.ts.
  - `cdn-network` (manual): the network panel of that page, showing `lib/index.js`, the worker scripts and the `.wasm` files from the CDN origin, under "## Start the core early".
  - `cdn-terrain` (scripted): the add-on example's terrain view, under "## Add-ons from the CDN". Steps: as for one-file-box, with the add-on page. Source files: docs/getting-started/cdn.md, packages/terrain/.
- Demo links: Terrain at https://github.com/null3d-engine/null3d/tree/main/examples/terrain/ (under "## Add-ons from the CDN").
- Concepts with no demo: the production and development entries, import maps, thread modes, the CDN policy.

### getting-started/network-use
- Shots:
  - `network-own-origin` (manual): the network panel of a running page, filtered to third-party domains, showing no rows, under "## Check the claim".
  - `csp-block` (manual): the console's error when the strict policy blocks a request to another origin, naming the address, under "## Check the claim".
- Demo links: Positional sound at https://github.com/null3d-engine/null3d/tree/main/examples/sound/ (under "## What your own code downloads", next to the @null3d/sound bullet). Gaussian splats at https://github.com/null3d-engine/null3d/tree/main/examples/splats/ (next to the @null3d/splats bullet).
- Concepts with no demo: the build's shader download, NULL3D_ENGINE_SHADERS, the CLI's network use.

### getting-started/third-party-notices
- Shots: none needed.
- Demo links: none.
- Concepts with no demo: every concept on the page (license tables, the notices file).

### cli/null3d
- Shots:
  - `hold-mode` (reference): the Repeatable frames demo's held frame, with 400 balls in a pen, under "## shot", as the kind of image `shot` writes. Reference: tests/image/references/chrome-real-gpu/webgpu/demo-hold-mode.png. Source files: examples/hold-mode/sketch.ts.
  - `test-diff` (scripted): a failing image test's result, reference and red diff image side by side, under "### References and results". Steps: in a template project, run `bunx @null3d/cli test --update-references`, change the sketch's color, then run `bunx @null3d/cli test` and take `start.png`, the reference and `start-diff.png`. Source files: packages/cli/src/test.js, packages/cli/src/compare.js.
  - `record-button` (scripted): a page opened with `?record`, showing the Save recording button over the canvas, under "## Replay a recording". Steps: open a dev page with `?record` and capture it after the first frame. Source files: packages/engine/src/page/record-button.ts.
  - `inspector-panel` (scripted): a dev page with `?inspect` and the in-page inspector open on an object, under "## mcp". Steps: open the picking demo with `?inspect` and select a piece. Source files: packages/engine/src/debug/inspector.ts.
  - `impostor-atlas` (scripted): the color atlas that `assets impostor` writes for a pine, under the impostor command. Steps: run `bunx @null3d/cli assets impostor <pine.glb> --views 25 --texels 64` and show `pine-impostor-color.png`. Source files: packages/cli/src/assets.js, packages/impostors/.
  - `impostors-view` (reference): the Impostors demo's forest, beside the atlas. Reference: tests/image/references/chrome-real-gpu/webgpu/demo-impostors.png.
- Demo links: Repeatable frames at https://github.com/null3d-engine/null3d/tree/main/examples/hold-mode/ (under "## shot"). Impostors at https://github.com/null3d-engine/null3d/tree/main/examples/impostors/ (under "## assets", impostor). Environment light at https://github.com/null3d-engine/null3d/tree/main/examples/environment/ (under "## assets", env). Aurora at https://github.com/null3d-engine/null3d/tree/main/examples/aurora/ (under "## check-addon", as an add-on to check). Picking and labels at https://github.com/null3d-engine/null3d/tree/main/examples/picking/ (under "## mcp", as a page to inspect).
- Concepts with no demo: timed scripts, `?record` recordings, bench, upgrade, assets convert, pack-orm, normal-from-bump, Chrome for Testing.

### cookbook/index
- Shots (each beside its recipe):
  - `picking` (reference): the Picking and labels demo, under "Select objects with the pointer". Reference: tests/image/references/chrome-real-gpu/webgpu/demo-picking.png.
  - `walk-to-click` (scripted): the recipe's ground, player and marker after one click, under "Walk to the point that the user clicks". Steps: draw the recipe with a timed script, `0.5 pointer down 900 500`, `0.6 pointer up`, `2 shot walked`. Source files: docs/cookbook/index.md, tests/lib/skill-sketches.ts.
  - `character` (reference): the Animated characters demo's Knight, under "A third-person camera". Reference: tests/image/references/chrome-real-gpu/webgpu/demo-character.png.
  - `crowd` (scripted): the crowd recipe's 64 Knights, held at 2 s, under "A crowd of animated characters". Steps: hold the recipe in its cookbook test page. Source files: tests/lib/skill-sketches.ts.
  - `morph-flowers` (reference): under "Morph targets from a model". Reference: tests/image/references/chrome-real-gpu/webgpu/demo-morph-flowers.png.
  - `time-of-day` (reference): under "A sky with a moving sun and fog". Reference: tests/image/references/chrome-real-gpu/webgpu/demo-time-of-day.png.
  - `post-effects` (reference): under "Glow and a custom effect". Reference: tests/image/references/chrome-real-gpu/webgpu/demo-post-effects.png.
  - `security-camera` (reference): under "A screen that shows another camera". Reference: tests/image/references/chrome-real-gpu/webgpu/demo-security-camera.png.
  - `canvas-screen` (reference): under "Screens in the world". Reference: tests/image/references/chrome-real-gpu/webgpu/demo-canvas-screen.png.
  - `sprites-lines` (reference): under "A trail behind a moving object". Reference: tests/image/references/chrome-real-gpu/webgpu/demo-sprites-lines.png.
  - `galaxy` (reference): under "A field of stars". Reference: tests/image/references/chrome-real-gpu/webgpu/demo-galaxy.png.
  - `occlusion-stats` (scripted): the wall recipe with the `?stats` overlay, with occlusion on and off side by side, showing the hidden-object count, under "Hide what walls hide". Steps: hold the recipe on webgpu at the High preset with `?stats`, once with `?occlusion=on` and once with `?occlusion=off`. Source files: docs/cookbook/index.md, packages/engine/src/debug/.
- Demo links:
  - Select objects: Picking and labels, https://github.com/null3d-engine/null3d/tree/main/examples/picking/
  - Third-person camera: Animated characters, https://github.com/null3d-engine/null3d/tree/main/examples/character/
  - Crowd: Battle comparison, https://github.com/null3d-engine/null3d/tree/main/examples/compare/battle/
  - Loading screen: glTF models, https://github.com/null3d-engine/null3d/tree/main/examples/gltf-model/
  - Morph targets: Morph targets, https://github.com/null3d-engine/null3d/tree/main/examples/morph-flowers/
  - Sky and fog: Time of day, https://github.com/null3d-engine/null3d/tree/main/examples/time-of-day/
  - Glow and custom effect: Post effects, https://github.com/null3d-engine/null3d/tree/main/examples/post-effects/
  - Screen showing another camera: Render to texture, https://github.com/null3d-engine/null3d/tree/main/examples/security-camera/
  - Screens in the world: Screens drawn on a canvas, https://github.com/null3d-engine/null3d/tree/main/examples/canvas-screen/
  - Trail: Sprites and lines, https://github.com/null3d-engine/null3d/tree/main/examples/sprites-lines/
  - Field of stars: Points, https://github.com/null3d-engine/null3d/tree/main/examples/galaxy/
- Concepts with no demo: walking to a clicked point, the loading screen's progress messages, occlusion culling with marked occluders.
