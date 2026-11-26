# Readability and layout review: slice start

Role: readability and layout. Pages: cli/null3d, cookbook/index, getting-started/cdn, getting-started/first-scene, getting-started/hosting, getting-started/install, getting-started/network-use, getting-started/project-structure, getting-started/third-party-notices, index.

Line numbers are file lines in `docs/<page-id>.md`. Every page in this slice has a 7-line front matter, so a stats.json line is the file line minus 7 (stats line 64 = file line 71).

No page in this slice is generated, except that the roadmap banner wording and the page order come from `tools/lib/steps.ts` and `tools/lib/docs.ts` (findings 10 and 11).

Page with no finding of its own beyond finding 23: getting-started/first-scene. It is short, has no long paragraph, and puts each code block next to the text that explains it.

Findings 1 to 30 are verified against the page text. Findings 31 to 36 are "not verified": they are lower ranked and were checked less closely.

---

## 1. index: "Where to start" does not link to Install or Your first scene

- Page: index
- Anchor: `## Where to start` (lines 36 to 43)
- Category: scan-order. Severity: high.
- Claim: The docs home is the first page a newcomer opens. Its "Where to start" list links to architecture, backends, performance, phones, hosting and the three.js mapping. It does not link to Install null3D, Your first scene, Project structure or the CDN trial. A newcomer who wants to draw a first frame has no path from the home page, except through the long "All pages" table.
- Evidence: index.md lines 38 to 43 list six pages; none of them is `getting-started/install`, `getting-started/first-scene`, `getting-started/project-structure` or `getting-started/cdn`.
- Proposed edit: Make "Where to start" a numbered path, with the start pages first:
  1. [Install null3D](getting-started/install.md): the packages and the Vite plugin.
  2. [Your first scene](getting-started/first-scene.md): a turning box in four files.
  3. [Project structure](getting-started/project-structure.md): start from a template with `bunx @null3d/cli create`.
  4. [Try null3D from a CDN](getting-started/cdn.md): one HTML file, no bundler.
  Then a second list, "Read next", with the six links that are there now.

## 2. getting-started/cdn: the "try it" page hides that the build runs in a clone of the engine, and puts the HTML third

- Page: getting-started/cdn
- Anchor: `## Make the CDN build` (line 22) and `## One HTML file` (line 66)
- Category: missing-prerequisite. Severity: high.
- Claim: The title promises a quick trial with no install. But the first section asks the reader to run `bun run build` and `bun run build:cdn`, which are scripts of the engine repository (`tools/build-wasm.ts`, `tools/build-cdn.ts`), not of the reader's project. The page never says to clone the engine repository, or what that build needs. Then the reader must pass a 6-paragraph section on the two entries before the page shows the HTML file that is the point of the page.
- Evidence: cdn.md lines 26 to 29 (`bun run build`, `bun run build:cdn`); package.json lines 27 and 29 map them to `tools/build-wasm.ts` and `tools/build-cdn.ts`. The HTML example starts at line 70, after `## Production and development entries` (lines 45 to 64).
- Proposed edit: Open `## Make the CDN build` with one sentence that says the commands run in a clone of the null3D repository, and link to what that build needs. Reorder the sections: `## Make the CDN build` (steps only), `## One HTML file`, `## Production and development entries`, `## Start the core early`, then the rest. Add a short "In short" numbered list under the intro: 1. build the folder, 2. upload it with the headers, 3. save the HTML file, 4. switch to the development entry while you work.

## 3. cli/null3d: ten commands on one page of 7,450 words, with no list of the commands

- Page: cli/null3d
- Anchor: `# The `null3d` command` (line 9)
- Category: split-page. Severity: high.
- Claim: The page has 7,450 words and 25 headings. It covers create, shot, replay, timed scripts, mcp, test, bench, check-addon, six `assets` commands, upgrade and the browser setup. Nothing near the top says which command does what, so a reader who wants `test` must scroll past `shot` and `mcp`. Each command has its own options, output and JSON format, so the parts do not need one another.
- Evidence: stats.json `cli/null3d`: words 7450, 25 headings, 14 long paragraphs, 5 Mermaid diagrams. The only overview is the front matter summary "create, test, bench, check-addon, shot, upgrade, assets, mcp."
- Proposed edit: First, after the `bunx` block (line 21), add a table: Command | What it does | Who needs it. One row per command: `create`, `test`, `shot`, `bench`, `mcp`, `assets`, `upgrade`, `check-addon`. Then split the page:
  1. `cli/null3d` (keep the ID): what the tool is, the command table, `create`, `upgrade`, `## Where the commands draw` with `### Chrome for Testing`.
  2. `cli/shot`: `shot`, its output and JSON, `## Replay a recording`, `## Timed scripts` (see finding 9).
  3. `cli/test`: `test`, the list of image tests, references, output.
  4. `cli/bench`: `bench`, output, JSON, `### Measure fairly`.
  5. `cli/mcp`: `mcp` and `### Objects in a call`.
  6. `cli/assets`: the six `assets` commands, each under its own H2 (see finding 8).
  7. `check-addon` goes to `cli/check-addon`, or into the add-ons guide, since only add-on authors run it.
  Add each new page to AREAS and PAGES in `tools/lib/docs.ts`.

## 4. getting-started/hosting: one page holds three topics, and a newcomer must read past caching and offline play

- Page: getting-started/hosting
- Anchor: `# Hosting and cross-origin isolation` (line 9)
- Category: split-page. Severity: high.
- Claim: The page has 4,792 words and 20 headings. Its title is the isolation headers, which every reader needs. But about half the page is the caches between visits, Chrome's code cache, offline play with a service worker, and Electron. A person who only wants to set two headers on Netlify meets the CSP, the CDN case and two builds first. A person who wants offline play does not look for it under "Hosting and cross-origin isolation".
- Evidence: stats.json `getting-started/hosting`: words 4792, 20 headings, 8 long paragraphs. `## Caches between visits` (line 221) to `### Keep the engine's cache` (line 358) is about 140 lines. `## Desktop apps with Electron` is lines 152 to 195.
- Proposed edit: Split into:
  1. `getting-started/hosting` (keep the ID): the two headers, headers on common hosts, what isolation changes, files from other sites, the CSP, the CDN case, two builds, Brotli, the third-party notices, during development.
  2. `guides/caching-and-offline` (new): `## Caches between visits`, `## Let browsers keep the build files`, `### Let Chrome keep the compiled core`, `## Offline play` with its three H3s.
  3. `guides/electron` (new): `## Desktop apps with Electron`.
  Leave one-line links in the hosting page where each part was. Update the many links that point to `hosting.md#offline-play`, `hosting.md#caches-between-visits` and `hosting.md#let-chrome-keep-the-compiled-core` (install.md lines 56, cdn.md line 43, network-use.md lines 32 and 49). Add the pages to AREAS and PAGES in `tools/lib/docs.ts`.

## 5. getting-started/install: the list of what the Vite plugin does is a wall of ten dense bullets

- Page: getting-started/install
- Anchor: `## Add the Vite plugin`, lines 46 to 57
- Category: technical-details-block. Severity: medium.
- Claim: A newcomer needs one fact here: add the plugin. The page then lists ten jobs, and several bullets are 4 to 6 sentences of build internals: worker format and the 34 MB classic script (line 53), the import chain that each worker starts (line 54), `data:` addresses and the CSP (line 57), the shader compile and declaration files (line 51). The first-time reader cannot tell which bullets matter to them.
- Evidence: install.md line 51 (6 sentences), line 52 (5 sentences), line 53 (4 sentences), line 54 (5 sentences).
- Proposed edit: Keep a short list of one line per job in the main text: sends the isolation headers; compresses with Brotli; builds the sketch for its worker and ships the core; compiles your WGSL; removes the development checks from production; writes the notices file and the file list. Then move the detail into a block:
  ```
  <details>
  <summary>Technical details: how the plugin builds workers and files</summary>

  - Workers build as ES modules, so they share the shader files. Without the plugin, each worker is one classic script of about 34 MB.
  - Each worker starts the files that an on-demand file imports, together with that file ...
  - Each engine file stays a file of its own, never a `data:` address, which a strict CSP blocks ...
  - Without the plugin, the engine's code runs as a development build ...

  </details>
  ```
  Keep the warning that a page without the plugin runs as a development build in the main text, as one sentence, because it changes frame times.

## 6. getting-started/hosting: eight long paragraphs, one of 201 words

- Page: getting-started/hosting
- Anchor: lines 210, 243, 267, 297, 350, 366, 384, 388
- Category: long-paragraph. Severity: medium.
- Claim: Eight paragraphs pass 90 words or 4 sentences. Line 267 is 201 words and 13 sentences of Chrome's code-cache timing, with three Chrome version numbers and benchmark figures. Line 243 explains HTTP/1.1 connection limits for the `downloads` option, which is off the section's topic.
- Evidence: stats.json lines 203, 236, 260, 290, 343, 359, 377, 381 (file lines +7). Line 267 starts "Chrome writes the code while the page runs".
- Proposed edit:
  - Line 210 (Brotli on hosts): make a list, one item per host: Netlify, Cloudflare Pages and Vercel: Brotli by default. GitHub Pages: gzip only. nginx: steps 1 to 3 (`brotli -q 11`, `brotli_static on;`, add `application/wasm` to `gzip_types`).
  - Line 243 (the `downloads` option over HTTP/1.1 and HTTP/2): move to the download list section of `api/sketch` or `guides/start-time`, and leave one link. If it stays, put it in a block `<summary>Technical details: listed downloads and the browser's connections</summary>`.
  - Line 267: keep two sentences in the main text: "Chrome writes the code a few seconds after the page starts. So a repeat visit gains only after an earlier visit ran the engine for a while." Move the rest (the two-second wait, the 1 MB rule, the test-page and benchmark figures, the Chrome 156 fault) into `<summary>Technical details: when Chrome writes the compiled core</summary>`.
  - Line 297 (shader files per path and settings, sizes): keep the first two sentences. Move the two-feature shaders and the size figures into a block `<summary>Technical details: what the feature lists hold</summary>`.
  - Line 350 (isolation of a cached page): split into two paragraphs: the rule (copy the headers on a made response), then how to check.
  - Line 366 (compression in dev and preview): split. One paragraph for the dev server, one for the preview. The re-compression at Brotli's best level goes in a block.
  - Line 384 (HTTP/1.1 and Safari): keep "The plugin serves HTTPS over HTTP/1.1, because Safari on an iPad sometimes stops over HTTP/2. For other browsers, `http2: true` serves HTTP/2." Move the hundreds-of-files reason into a block.
  - Line 388 (untrusted certificate): split after "every timing of a start is wrong.". Start the second paragraph with the rule "Install the root certificate on every device that tests a page." and then the 30-second figure.

## 7. cli/null3d: fourteen long paragraphs

- Page: cli/null3d
- Anchor: lines 39, 52, 191, 210, 223, 300, 312, 347, 442, 446, 470, 488, 539, 541
- Category: long-paragraph. Severity: medium.
- Claim: Fourteen paragraphs pass 4 sentences or 90 words. Several are procedures or lists written as prose.
- Evidence: stats.json `cli/null3d` longParagraphs at lines 32, 45, 184, 203, 216, 293, 305, 340, 435, 439, 463, 481, 532, 534 (file lines +7). Line 442 is 161 words and 9 sentences; line 446 is 154 words; line 347 is 110 words.
- Proposed edit:
  - Line 39 (create): split after the first sentence. Put "Run `bun install` in the new folder, then `bunx vite`." as its own line under the code block.
  - Line 52 (shot): make three numbered steps: 1. starts your Vite dev server on a free port, 2. opens the page in a headless browser with `?hold`, 3. the engine steps to the time, draws and reads the frame back.
  - Line 191 (mcp): split into "What an agent can do" (list: list and change objects, capture a frame, read figures, errors and the render graph, switch the preset or GPU path) and "What the page needs" (list: a development build; starts the engine as it loads; not a held page or a replay page).
  - Line 210 (`--connect`): numbered steps: 1. start Chrome with `--remote-debugging-port=9222`, 2. open the page from the dev server, 3. add the server with the second command. The tab choice rule goes after the steps.
  - Line 223 (objects in a call): make a list of the three ways to name an object: by name, by `#<slot>` or a whole number, `#camera`.
  - Line 300 (sketch test or page test): a two-row table: Test kind | What it draws | Use it when.
  - Line 312 (new reference): numbered steps: 1. run `test`, which fails and saves the image, 2. open the image, 3. run `test --update-references`, 4. check the new references in your git diff, 5. commit them.
  - Line 347 (bench): numbered steps that match the diagram above it: build for production into a temporary folder, serve it, open with `?bench`, wait for the first frame and the preset check, play for the warm-up, measure. Keep "Your page needs no benchmark code." after the list.
  - Lines 442 and 440 (check-addon allocation and cost gates): keep one sentence per gate in the gate table. Move the sampling detail (250,000 objects, source-map naming, `node_modules` copy, the software GPU's lower figure) into `<summary>Technical details: how the allocation gate measures</summary>`.
  - Line 446 (assets optimize): one sentence, then a list of what it does: merges equal meshes, materials and textures; stores vertices as 8-bit and 16-bit integers in GPU order; resamples clips to the engine's key rate; encodes KTX2 textures with every mip; prints a budget report; writes the shader list into the model.
  - Line 470 (glTF extras): a table: Extra | Effect | Use it for. Rows `"occluder": false`, `"occluder": true`, `"quantizePositions": false`.
  - Line 488 (assets convert): a list of inputs and what converts: formats; Draco to meshopt; OBJ and FBX materials; FBX skins, blend shapes and clips; units and up axis.
  - Line 539 (impostor output): a table of the three files: File | What it holds.
  - Line 541 (impostor limits): a short list under "Limits": PNG or JPEG base color only, so bake the source model; triangle lists only; at most 4,096 texels on a side.

## 8. cli/null3d: six `assets` commands run together under one H2 with no subheadings

- Page: cli/null3d
- Anchor: `## assets` (line 444 to 541)
- Category: heading-depth. Severity: medium.
- Claim: `assets optimize`, `assets env`, `assets convert`, `assets pack-orm`, `assets normal-from-bump` and `assets impostor` each have their own paragraph, command and option table. They sit under one H2 with no H3, so the page outline shows only "assets" and a reader cannot jump to `assets env`. The section is about 100 lines.
- Evidence: stats.json headings: `## assets` has no child heading. The commands start at lines 446, 474, 488, 500, 513 and 527.
- Proposed edit: Give each command an H3: `### assets optimize`, `### assets env`, `### assets convert`, `### assets pack-orm`, `### assets normal-from-bump`, `### assets impostor`. Open `## assets` with a 6-row table: Command | What it makes. If the page splits (finding 3), these become H2s on `cli/assets`.

## 9. cli/null3d: replay and timed scripts are H2s, though they are options of `shot` and `test`

- Page: cli/null3d
- Anchor: `## Replay a recording` (line 112), `## Timed scripts` (line 124)
- Category: heading-depth. Severity: medium.
- Claim: The H2s read as two more commands. They are `shot --replay` and `shot --script` (and the `script` setting of a `test` entry). The command order is also not the order people use them: `mcp` sits between `shot` and `test`, while the install page shows `test` as the first command to run.
- Evidence: Headings in stats.json: create, shot, Replay a recording, Timed scripts, mcp, test, bench, check-addon, assets, upgrade. install.md line 101 runs `bunx @null3d/cli test` first.
- Proposed edit: Make them `### Replay a recording` and `### Timed scripts` under `## shot`. Their own H3s, "Objects in a script" and "What shot draws with a script", would then fall to H4, so turn them into plain paragraphs or a details block (finding 29). Reorder the H2s: create, test, shot, bench, mcp, assets, upgrade, check-addon, Where the commands draw.

## 10. Getting-started pages are listed in an order that puts hosting before the trial and project structure last

- Page: getting-started/install, getting-started/first-scene, getting-started/hosting, getting-started/network-use, getting-started/third-party-notices, getting-started/cdn, getting-started/project-structure
- Anchor: `## Getting started` in docs/pages.md (lines 17 to 23)
- Category: scan-order. Severity: medium.
- Claim: The area lists install, first scene, hosting, network use, third-party notices, CDN, project structure. A newcomer reads in this order. So `bunx @null3d/cli create`, the quickest start, comes last, after the licenses page. The CDN trial, which suits a first look, comes after network use and notices.
- Evidence: docs/pages.md lines 17 to 23; the order comes from PAGES in `tools/lib/docs.ts` lines 82 to 88.
- Proposed edit: Reorder PAGES in `tools/lib/docs.ts`: install, first-scene, project-structure, cdn, hosting, network-use, third-party-notices. If the website takes its sidebar from the same list, the sidebar follows.
- Generated source: tools/lib/docs.ts

## 11. Every page opens with a roadmap-step banner that a reader cannot use

- Page: cli/null3d, cookbook/index, getting-started/cdn, getting-started/first-scene, getting-started/hosting, getting-started/install, getting-started/network-use, getting-started/project-structure, getting-started/third-party-notices, index
- Anchor: line 11 of each page, "> Roadmap step 0.1, first released in null3D 0.1.0."; index.md line 34
- Category: scan-order. Severity: medium.
- Claim: The first line under each title names a step of the maintainers' roadmap. All three steps shipped in the same release, so the step tells a reader nothing. It is also a plan word that the writing rules keep out of docs. It pushes the page's opening sentence down. The index spends a paragraph (line 34) explaining the step column.
- Evidence: 103 pages carry "Roadmap step"; the sentence comes from `shipsSentence` in `tools/lib/steps.ts` line 18, and the docs check in `tools/lib/docs.ts` (around line 662) and its test in `tools/lib/docs.test.ts` line 90 require it. index.md line 34; pages.md line 11.
- Proposed edit: Change the banner to the release and the status only: "> First released in null3D 0.1.0. The API is experimental, so it can still change between versions." Change `shipsSentence` and the check that requires the text. Drop the "Step" column from pages.md (`tools/lib/docs.ts` around lines 411 and 557) or rename it "Since" with the release, and delete index.md line 34.
- Generated source: tools/lib/steps.ts

## 12. getting-started/hosting: the host examples and the isolation pitfall come after the CSP, the CDN case and two builds

- Page: getting-started/hosting
- Anchor: `## Headers on common hosts` (line 117), `## What isolation changes` (line 392)
- Category: scan-order. Severity: medium.
- Claim: The reader learns the two headers at line 22, then must pass the CSP, the CDN case (with its own CSP and error table) and the two builds before the page shows how to send the headers on Netlify, Vercel or nginx. The one real risk of isolation, a broken sign-in popup, is the last section, after the dev server setup. A reader turns isolation on before they read it.
- Evidence: Heading order in stats.json: The two headers, Files from other sites, Content-Security-Policy, The engine's files on a CDN, Two builds, Headers on common hosts ... During development, What isolation changes.
- Proposed edit: Reorder: `## The two headers`, `## Headers on common hosts`, `## What isolation changes`, `## Two builds`, `## Files from other sites`, `## Content-Security-Policy`, `## The engine's files on a CDN`, then Brotli, the notices and During development.

## 13. getting-started/network-use: a 162-word paragraph on the test browser download, which the CLI page also gives

- Page: getting-started/network-use
- Anchor: `## The command-line tool`, lines 73 and 80
- Category: long-paragraph. Severity: medium.
- Claim: Line 73 has 162 words and 11 sentences: the download, its host, the hash check, the error, the fallback, the cache folder, the CI case and two settings. Line 80 has 85 words and 7 sentences on the `mcp` addresses. The download detail repeats the CLI page's `### Chrome for Testing` list almost point by point.
- Evidence: stats.json lines 66 and 73 (file lines 73 and 80). cli/null3d.md lines 594 to 599 give the same first use, hash check, folder and fallback.
- Proposed edit: Make line 73 a table: Case | What the tool downloads. Rows: first draw on your GPU (Chrome for Testing once, from `storage.googleapis.com`, hash checked); `CI` set (nothing, software GPU); `NULL3D_CHROME=installed` (nothing); `mcp --connect` (nothing). Then one sentence and a link to [Chrome for Testing](../cli/null3d.md#chrome-for-testing) for the hash check and the cache folder. Make line 80 a list: by default (local server and browser), `--url` (your address), `--connect` (your Chrome's endpoint).

## 14. getting-started/cdn: the entries section is six paragraphs after its table, and the third form hides at the end

- Page: getting-started/cdn
- Anchor: `## Production and development entries` (lines 45 to 64)
- Category: structure. Severity: medium.
- Claim: The table gives two entries. Then six paragraphs follow: what the checks do, why the development entry is slower, how production behaves, mixing entries, how to tell entries apart, and a third build for benchmarks. The third build (`--url-switches`) is a row the table lacks. How to tell entries apart with `?threads=off` and `engine.mode.build` is a debugging detail.
- Evidence: cdn.md lines 49 to 52 (two-row table); lines 54, 56, 58, 60, 62, 64.
- Proposed edit: Add a third row to the table: "Production with switches | `lib/index.js` from `build:cdn --url-switches` | Never run | Read | Benchmark pages only; never ship it". Keep lines 56 (time only the production entry) and 60 (use one entry for the whole page) in the main text, as the two rules. Merge line 54 and 58 into one short paragraph. Move line 62 into `<summary>Technical details: see which entry a page runs</summary>`. Delete line 64 once its row is in the table, apart from the "never ship it" reason.

## 15. getting-started/cdn: three long paragraphs, two of them a list of hosting rules

- Page: getting-started/cdn
- Anchor: lines 31, 43, 187
- Category: long-paragraph. Severity: medium.
- Claim: Line 31 mixes what the build writes, its size, where to upload it and the `--out` option. Line 43 gives three header rules and a versioned prefix in five sentences. Line 187 explains the add-on layout and the two entries in six sentences. The upload rules are a checklist that a reader follows, so prose makes them easy to miss.
- Evidence: stats.json lines 24, 36, 180 (file lines 31, 43, 187).
- Proposed edit: After the build commands, add "### Upload the folder" with numbered steps: 1. upload `target/cdn` under a prefix per engine version, such as `https://cdn.example.com/null3d/0.1.0/`, and keep its layout; 2. send `Access-Control-Allow-Origin: *` on every file; 3. send `.wasm` files with `Content-Type: application/wasm`; 4. send `Cache-Control: public, max-age=31536000, immutable`. Put the size note ("most of it is the shader builds") as one sentence. For line 187, make a two-row table: Entry | Add-on path (`addons/<name>/lib/index.js`, `addons/<name>/lib-dev/index.js`), and keep "The add-on imports the engine from the same build, so the versions always match." as one sentence.

## 16. getting-started/install: the shader cache section sits before "Run the sketch", and its cache key is implementer detail

- Page: getting-started/install
- Anchor: `## Builds` (line 63) and `## Run the sketch` (line 81)
- Category: scan-order. Severity: medium.
- Claim: A newcomer installs, adds the plugin and wants to run. The page puts 17 lines on the shader cache between them. The paragraph at line 71 gives the cache key (the WGSL, the variant spec and the compiler version), which a user needs only to trust the cache.
- Evidence: stats.json line 64 (file line 71): 79 words, 5 sentences. Heading order: Install the packages, Add the Vite plugin, Builds, Run the sketch.
- Proposed edit: Move `## Run the sketch` up to follow `## Add the Vite plugin`. Rename `## Builds` to `## The shader cache`. Keep in the main text: the first build compiles every shader and pauses, and prints what it compiles; later builds read the cache; how to ignore or clear it. Move line 71's key and why the cache never serves a wrong shader into `<summary>Technical details: what the cache keys on</summary>`.

## 17. getting-started/install: "Vite only, other bundlers are not supported" comes after ten bullets

- Page: getting-started/install
- Anchor: line 59, "null3D requires Vite with this plugin."
- Category: scan-order. Severity: medium.
- Claim: Whether the engine works with the reader's bundler is a first question. The answer sits after the ten-bullet list. A reader with webpack or esbuild may stop reading before it. Line 13 also says "You need no command-line tool to build or run" but does not say Vite is required.
- Evidence: install.md line 59; line 46 "Every Vite build of a null3D project needs the plugin" implies, but does not state, that Vite is required.
- Proposed edit: Move line 59's first two sentences to the top of `## Add the Vite plugin`, before the code block: "null3D requires Vite with the null3D plugin. Other bundlers are not supported or tested." Add "with Vite" to line 13: "null3D installs from npm and builds with Vite."

## 18. cookbook/index: thirteen recipes with no list at the top and no grouping

- Page: cookbook/index
- Anchor: `# Cookbook` (line 9) through `## Hide what walls hide` (line 620)
- Category: scan-order. Severity: medium.
- Claim: The page has 13 recipes and 3,831 words, most of it code. The only way to see the recipes is the heading outline. The recipes cover very different tasks (input, cameras and animation, loading, look, screens, culling) in no clear order: a crowd sits between a third-person camera and a loading screen.
- Evidence: stats.json `cookbook/index` headings; recipes at lines 23, 60, 140, 225, 270, 305, 333, 388, 433, 480, 540, 586, 620.
- Proposed edit: Under the intro, add a table: Recipe | What it shows | Main calls (for example "Select objects with the pointer | hover and click highlight | `object.on`, `setOutlined`"). Group the H2s into an order a reader follows: input (select, walk to click), characters (third-person camera, crowd, morph targets), loading (loading screen), look (sky and fog, glow and custom effect, trail, stars), screens (another camera, screens in the world), speed (hide what walls hide). Keep each recipe as an H2, and do not add H3s.

## 19. cookbook/index: the page opens with how the engine's tests check the recipes

- Page: cookbook/index
- Anchor: Mermaid diagram (lines 13 to 17) and line 19
- Category: technical-details-block. Severity: medium.
- Claim: The first thing a reader sees is a diagram of the type check and hold mode, and a paragraph (60 words, 5 sentences) on the engine's tests. A reader wants to know how to use a recipe. The test fact is a trust note, useful but second.
- Evidence: stats.json line 12 (file line 19): "Each recipe is a complete sketch ... The engine's tests run every recipe on this page."
- Proposed edit: Delete the diagram. Open with two sentences: "Each recipe is a complete sketch for one common task. Copy it into your project's `sketch.ts` and change it from there." Then the files note (line 21). Move the test sentences into `<summary>Technical details: how the recipes are tested</summary>`: they type check against the engine and draw in hold mode on every GPU tier.

## 20. getting-started/cdn and getting-started/hosting repeat the CDN headers, CSP and error table

- Page: getting-started/cdn, getting-started/hosting
- Anchor: cdn.md `## Make the CDN build` lines 37 to 43 and `## The Content-Security-Policy` lines 163 to 176; hosting.md `## The engine's files on a CDN` lines 73 to 102
- Category: duplication. Severity: medium.
- Claim: Both pages give `Access-Control-Allow-Origin: *`, the `application/wasm` rule, a CSP with `blob:` and the CDN in `worker-src`, the same four reasons for each item, and the same three errors (E1422, E1423, E1418). A reader of either page reads the same rules twice, and a later change must reach both.
- Evidence: cdn.md lines 171 to 176 and hosting.md lines 89 to 100 give the same item reasons and errors; cdn.md line 43 and hosting.md line 81 give the same `.wasm` rule.
- Proposed edit: Keep the full list and the error table in hosting.md `## The engine's files on a CDN`. In cdn.md keep the CSP line (it differs: it adds `blob:` in `script-src` and `'unsafe-inline'`) and the two items that differ (`blob:` in `script-src`, `'unsafe-inline'` for the inline script). Replace the rest with a link to the hosting section.

## 21. getting-started/third-party-notices: the summary table repeats the per-part tables, with very long cells

- Page: getting-started/third-party-notices
- Anchor: `## Each package` (lines 17 to 32), `## The engine` (lines 40 to 54), `## The tools` (lines 62 to 84)
- Category: duplication. Severity: medium.
- Claim: The first table lists every third-party part of the engine, the CLI and the Vite plugin in one cell per package. The engine cell names 13 projects. The next sections list the same parts again, one per row. On a narrow screen the first table is hard to read, and the reader sees each part twice.
- Evidence: third-party-notices.md line 19 (engine cell) against lines 42 to 54; line 20 against lines 66 to 71; line 21 against lines 77 to 84.
- Proposed edit: In `## Each package`, replace the "Third-party code" cell of the engine, CLI and Vite plugin with "See [The engine](#the-engine)" or "See [The tools](#the-tools)". Keep the full cell only for the packages without a section of their own (controls, geometry, three-compat, sound, splats, terrain, wind). Optionally drop the "Notices" column, which says `THIRD-PARTY-NOTICES.txt` on every row that has code, and say it once above the table.

## 22. getting-started/hosting: the service worker code comes after a list, a table and a long paragraph

- Page: getting-started/hosting
- Anchor: `## Offline play` (lines 269 to 346)
- Category: example-placement. Severity: low.
- Claim: The reader wants to see the service worker. The page first gives the file list JSON, four bullets on its fields, a five-row feature table and a 117-word paragraph on shader files, and only then the code (line 301). The registration code follows with its reason after it, and two paragraphs about `cache.addAll` follow later.
- Evidence: hosting.md lines 284 to 297 sit between the JSON (line 273) and the service worker (line 301).
- Proposed edit: Order the section as: one-paragraph intro; the service worker (line 301); the registration (line 332); then `### The file list` with the JSON, the four bullets and the feature table; then the `cache.addAll` notes. Put the line 297 detail in a block (finding 6).

## 23. getting-started/first-scene: the text says to catch the error, but the code does not

- Page: getting-started/first-scene
- Anchor: `## The page module`, line 62
- Category: example-placement. Severity: low.
- Claim: Line 62 says `createEngine` rejects on an unsupported browser, and "Catch it, and show the page without the scene." The page module above it has no `try` or `catch`. A newcomer copies the code as it is, and an unsupported browser shows an uncaught error.
- Evidence: first-scene.md lines 48 to 58 (no catch); line 62.
- Proposed edit: Add the catch to the page module, with a short comment:
  ```ts
  try {
    const engine = await createEngine({ canvas, sketch: new URL('./sketch.ts', import.meta.url) });
    await engine.firstFrame; // the first frame is on the screen
  } catch (error) {
    canvas.remove(); // this browser cannot run the engine: show the page without the scene
  }
  ```
  Or keep the code and show the catch in a second short block right after line 62.

## 24. getting-started/network-use: a one-sentence H2 and two sentences in the wrong sections

- Page: getting-started/network-use
- Anchor: `## Turn off the build's download` (line 65), line 17, line 63
- Category: structure. Severity: low.
- Claim: `## Turn off the build's download` is one paragraph of two sentences that only repeats the first item of the list above it. Line 17 puts a sentence about replay recordings in the engine's own files section, where it breaks the topic. Line 63, about Vite's hot reload connection, is a development fact inside the build's download section. The page has no overview of its three actors (the page at run time, the build, the command-line tool).
- Evidence: network-use.md lines 17, 55, 63, 65 to 67.
- Proposed edit: Merge `## Turn off the build's download` into `## The build's one download` as its last paragraph. Move line 17's replay sentence into `## What your own code downloads` as a bullet. Move line 63 to a short `## During development` paragraph, or to the end of the engine section. Under the intro, add a three-row table: Who | What it contacts | How to stop it (the page: only your origin and the addresses you give; the build: GitHub once, `NULL3D_ENGINE_SHADERS`; the tool: Chrome for Testing once, `CI` or `NULL3D_CHROME=installed`).

## 25. getting-started/project-structure: the hook's rules are prose, and its rule module is implementer detail

- Page: getting-started/project-structure
- Anchor: `## The agent files`, lines 74 to 78
- Category: long-paragraph. Severity: low.
- Claim: Lines 74 and 76 each list three rules in a sentence. Line 76 is 55 words and 5 sentences, line 78 is 61 words and 5 sentences. A reader scanning for "will the hook block my command?" must parse the prose.
- Evidence: stats.json lines 69 and 71 (file lines 76 and 78).
- Proposed edit: Make a table: Rule | What the hook does. Rows: wait with `sleep` (refuses), stop a process by name (refuses), follow a log (refuses), object, array or string made in `onUpdate` (flags, the edit goes on), DOM name in the sketch module (flags), import of a name the engine does not export (flags). Keep one sentence: "Each message gives the file, the line and the fix." Move line 78 into `<summary>Technical details: where the hook's rules come from</summary>` (the `@null3d/cli/agent-rules` module, and the behavior before `bun install`).

## 26. getting-started/cdn: the import-map limit for workers is said three times

- Page: getting-started/cdn
- Anchor: lines 111, 150, 226
- Category: duplication. Severity: low.
- Claim: "A worker does not read the page's import map, so the sketch imports the engine by its full address" appears after the HTML example, in `## Import maps`, and again in `## Add-ons from the CDN`.
- Evidence: cdn.md line 111 "That works in a worker too, where a page's import map does not reach."; line 150 "A worker does not read the page's import map."; line 226 "but a worker reads no import map".
- Proposed edit: Keep the rule once, in `## Import maps` (line 150), with the reason. At lines 111 and 226, keep only a link: "(see [Import maps](#import-maps))".

## 27. getting-started/third-party-notices: what the reader must do comes last

- Page: getting-started/third-party-notices
- Anchor: `## Where the notices are` (line 90); line 34
- Category: scan-order. Severity: low.
- Claim: The one action for a game developer is: keep `null3d-third-party-notices.txt` with the build, or show it in the credits. The page says it at the very end (line 94), after three large tables. Line 34 gives half of it, without the action.
- Evidence: third-party-notices.md lines 34 and 94.
- Proposed edit: Add a short `## What to publish` section right after the intro paragraph, with the action from line 94. Delete the second sentence of line 34 and the second paragraph of `## Where the notices are`, so the fact appears once.

## 28. cli/null3d and getting-started/project-structure both document `create` in full

- Page: cli/null3d, getting-started/project-structure
- Anchor: cli/null3d `## create` (lines 25 to 39); project-structure `## Make a project` (lines 33 to 48)
- Category: duplication. Severity: low.
- Claim: Both pages give the same `--template` option table (one row), the rule that the folder must be empty, and the rule that `create` installs nothing. A one-row option table is heavier than a sentence.
- Evidence: cli/null3d.md lines 35 to 39; project-structure.md lines 42 to 48.
- Proposed edit: Keep the full rules (including that `create` never overwrites `.claude/settings.json` or `.codex/hooks.json`) in cli/null3d. In project-structure, keep the four commands and one sentence: "`create` writes the files and installs nothing, so run `bun install`. [create](../cli/null3d.md#create) lists its option." Replace both one-row tables with a sentence: "`--template <name>` picks `empty` (the default), `product` or `game`."

## 29. cli/null3d: the parsing rules of object names in a script are dense detail

- Page: cli/null3d
- Anchor: `### Objects in a script` (lines 158 to 172)
- Category: technical-details-block. Severity: low.
- Claim: Lines 160 to 166 explain where `set` and `dump` split a name at the last dot, the case that cannot be dumped, and which properties each object kind takes and which `dump` reads. A script author needs "name the object, then the property" and the property list. The splitting edge cases are for the rare object named `Cube.001`.
- Evidence: cli/null3d.md lines 160, 162, 164, 166.
- Proposed edit: Keep one sentence ("A step names an object by its scene name, then a dot and a property, such as `ship.position`. `#camera` names the active camera.") and a table: Object kind | Properties `set` writes | Properties `dump` reads. Move lines 160 to 162 (dots in names) into `<summary>Technical details: names that hold dots</summary>`. If finding 9 makes this an H4 position, turn the heading into the paragraph's first sentence instead.

## 30. cli/null3d: the JSON field tables of `shot` and `bench` are reference that most readers skip

- Page: cli/null3d
- Anchor: `### The JSON file` (line 84 and line 389)
- Category: technical-details-block. Severity: low.
- Claim: Two tables of 10 and 8 rows describe the JSON files field by field. They break the flow from "what it prints" to "when it draws no frame". A reader who scripts against the JSON wants them; a reader who runs the command does not.
- Evidence: cli/null3d.md lines 86 to 100 and 391 to 400.
- Proposed edit: Replace each `### The JSON file` heading and table with one sentence ("`shot` also writes a JSON file beside the image, with the frame's facts and what the page logged.") followed by `<details><summary>Technical details: the fields of the JSON file</summary>` holding the table. No heading inside the block.

---

## Not verified

## 31. getting-started/cdn: the notices file sits at the end of the add-ons section (not verified)

- Page: getting-started/cdn
- Anchor: line 228
- Category: structure. Severity: low.
- Claim: "The build also writes `null3d-third-party-notices.txt`..." is about the whole CDN folder, not add-ons. A reader who skips add-ons misses it.
- Evidence: cdn.md line 228 under `## Add-ons from the CDN`.
- Proposed edit: Move it to the upload steps under `## Make the CDN build` (finding 15), as the last step: "Keep `null3d-third-party-notices.txt` with the folder, or show its text in your credits."

## 32. getting-started/third-party-notices: the Vite plugin table repeats the same prefix five times (not verified)

- Page: getting-started/third-party-notices
- Anchor: lines 80 to 84
- Category: structure. Severity: low.
- Claim: Five rows start "The engine shaders in the module:". The prefix hides the part's name.
- Evidence: third-party-notices.md lines 80 to 84.
- Proposed edit: Put one sentence above the rows ("The module also holds the engine's shaders, which port these projects:") and name only the project in each row.

## 33. getting-started/network-use: two paragraphs are hard-wrapped at about 100 characters (not verified)

- Page: getting-started/network-use
- Anchor: lines 75 to 84
- Category: structure. Severity: low.
- Claim: The `check-addon` and `mcp` paragraphs break lines inside sentences, unlike the rest of the docs. It renders the same, but diffs and edits of these lines differ from every other paragraph.
- Evidence: network-use.md lines 75 to 78 and 80 to 84.
- Proposed edit: Join each paragraph onto one line, as the other pages do.

## 34. cookbook/index: "Hide what walls hide" puts preset rules before the code (not verified)

- Page: cookbook/index
- Anchor: line 622
- Category: example-placement. Severity: low.
- Claim: The intro gives which presets cull on WebGPU and which options turn culling on, before the reader sees the wall. Other recipes keep the intro to the goal.
- Evidence: cookbook/index.md line 622 (4 sentences, two option names).
- Proposed edit: Keep the first two sentences before the code. Move the WebGPU and WebGL2 rules to the note after the code (line 656), or a two-row table: GPU path | How culling turns on.

## 35. index: the status section mixes the labels with notes aimed at coding agents (not verified)

- Page: index
- Anchor: lines 30 to 34, 45
- Category: structure. Severity: low.
- Claim: After the status table, three paragraphs cover limits, what agents may use, the API reference and roadmap steps. Line 45 on page IDs for agents sits in "Where to start". A human reader looks for the start links and meets agent notes.
- Evidence: index.md lines 30, 32, 34, 45.
- Proposed edit: Move lines 30 (second and third sentences) and 45 into a short `## For coding agents` section after "Where to start". Delete line 34 (finding 11).

## 36. getting-started/hosting: the compression table is "in this version" figures without the benchmark name (not verified)

- Page: getting-started/hosting
- Anchor: `## Send the files with Brotli`, line 199
- Category: unclear. Severity: low.
- Claim: "In this version, a pipelined page's start downloads about" does not say which page or benchmark the figures come from, and "pipelined" is not explained on this page.
- Evidence: hosting.md line 199.
- Proposed edit: Name the page the figures come from, such as the engine's startup benchmark, and drop "pipelined" or link it to the page that defines it.
