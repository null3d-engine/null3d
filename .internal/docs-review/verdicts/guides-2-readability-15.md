# guides-2-readability-15

## Finding as given

- page: guides/testing
- anchor: ## Switches for tests, lines 214-245
- category: structure
- severity: medium
- claim: The table has 30 rows. A test author needs about eight (hold, gpu, preset, check=fresh, builds=fresh, latency, threads=off, view). The rest compare engine paths for performance work, and their long rows push the common ones apart. Line 214 packs five build-type facts into one paragraph.
- evidence: stats.json line 207 (file 214) 94 words, 6 sentences; rows at lines 232 (display-check), 236-237 (skinning), 238 (scene-format).
- proposedEdit: Turn line 214 into a list of where switches work (dev server; null3d command runs; CDN development entry) and where they do not (production builds, unless null3d({ urlSwitches: true })). Then a 'Common switches' table with the eight rows. Put the other rows in <details><summary>Technical details: switches that compare the engine's paths</summary> as a second table.
- generatedSource: (none; hand-written page)

Verdict: partly

## Evidence

- The table has 28 rows (docs/guides/testing.md:218-245), not 30.
- The long paragraph is a fact from stats.json (94 words, 6 sentences, file line 214). It mixes where switches work, where they do not, and two ways to turn them on. A short list is a fair fix. The link to the CDN page (getting-started/cdn.md#production-and-development-entries) must stay.
- The split into "eight common rows" and "the rest compare engine paths for performance" is wrong in two places:
  1. The page's own first section, "Check every rendering mode" (lines 30-36), tells every reader to test `?gpu=webgpu&direct=off` and `?gpu=webgpu&direct=on`. The proposed edit hides `?direct=` (line 220) in the collapsed block, so the page would tell readers to use a switch that it then hides.
  2. Many of "the rest" do not measure performance. They make the engine act like another browser, so a test author can check a fallback path: `?depth=reversed-gl` (Firefox, line 221), `?uploads=copy` (line 222), `?multidraw=off` (line 223), `?compile=wait` (line 224), `?wake=message` (Firefox before 145, line 230), `?compression=` (line 227), `?render=main` (line 231). These are test switches, and the section title is "Switches for tests". The summary "switches that compare the engine's paths" would mislabel them.
- The rows that do only measure an engine saving are real and long: `?display-check=off` (232), `?skinning=` (236-237), `?scene-format=` (238), `?shadowdepth=32` (239), `?half=` (240), `?still-camera=off` (241), `?cells=off` (235), `?derived-cache=off` (228), `?sketch-thread=main` (233). Moving these into a collapsible block is sound. GitHub Flavored Markdown renders a table inside `<details>` when blank lines surround it, and the block holds no heading.

## Corrected claim

The table has 28 rows. About a third of them only measure what one engine saving costs, and their long rows push the common ones apart. Others make the engine act like a browser without a feature; those check fallback paths and belong to testing. The first paragraph (line 214, 94 words, 6 sentences) packs where switches work and how to turn them on in production into one paragraph.

## Corrected edit

1. Turn line 214 into a short list: switches work on the dev server, in `null3d` command runs and in the CDN development entry (`lib-dev/index.js`); production builds and `lib/index.js` ignore them; turn them on for test pages with `null3d({ urlSwitches: true })`, or `bun run build:cdn --url-switches` for the CDN build. Keep the CDN link.
2. Visible table "Common switches": hold, gpu, direct, preset, target-fps, preset-check, check=fresh, builds=fresh, latency, threads=off, view.
3. Visible table "Act like another browser": depth, uploads, multidraw, compile, wake, compression, render=main. (These may also go in a second block, with a summary such as "Technical details: switches that act like a browser without a feature", but not under a performance label.)
4. `<details><summary>Technical details: switches that measure one engine saving</summary>` with a table of display-check, cells, skinning (both rows), scene-format, shadowdepth, half, still-camera, derived-cache and sketch-thread. Add one line of main text before it that says these switches exist, so the page reads well with the block closed.
