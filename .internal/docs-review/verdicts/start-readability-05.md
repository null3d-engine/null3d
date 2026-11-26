# Verdict on start-readability-05

## The finding as given

- page: getting-started/install
- anchor: ## Add the Vite plugin, lines 46 to 57
- category: technical-details-block
- severity: medium
- claim: A newcomer needs one fact: add the plugin. The page then lists ten jobs, several of them 4 to 6 sentences of build internals (worker format and the 34 MB script, the worker import chain, data: addresses, shader declarations).
- evidence: install.md line 51 (6 sentences), 52 (5), 53 (4), 54 (5).
- proposedEdit: Keep one line per job in the main text (headers, Brotli, sketch build and core, WGSL compile, checks removed in production, notices and file list). Move the worker format, import chain, data: address and no-plugin development build details into <details><summary>Technical details: how the plugin builds workers and files</summary>. Keep one sentence in the main text that a page without the plugin runs as a development build, because it changes frame times.

Verdict: partly

## Evidence

- docs/getting-started/install.md lines 48 to 57 hold ten bullets, as the finding says. The sentence counts hold: line 51 has 6 sentences, line 52 has 5, line 53 has 4 (with the 34 MB figure), line 54 has 5. Line 50 also carries a detail a newcomer does not need (the small preload script per page).
- stats.json does not list these bullets as long paragraphs. It counts list items apart from paragraphs, so this is not a conflict with the stats. Its only long paragraph on the page (stats line 64, page line 71) is the shader cache paragraph in "Builds", outside this finding.
- The claim holds: the list mixes what a newcomer must know with build internals, and the page already states at line 46 and line 59 that the plugin is required.
- The proposed edit is wrong in one part. Its main-text list keeps only seven jobs (headers, Brotli, sketch and core, WGSL, checks, notices, file list). It drops three jobs from the main text: ES-module workers, the worker import preload, and keeping engine files out of data: addresses.
  - The plugin prints a visible warning when workers build in another format (packages/vite-plugin/src/index.ts:615 to 617, "workers build as ... not as ES modules ... Set worker.format to 'es'"). A reader who sees that warning must find the job in the main text.
  - The data: job matters to anyone with a strict Content-Security-Policy, which is a deploy concern that hosting.md also covers. Its one-line reason (a strict CSP blocks data: addresses) belongs in the main text.
- A <details> block inside a Markdown bullet list renders badly in many renderers. Put the block after the list, not inside a bullet.
- No writing rule in AGENTS.md "Writing docs" forbids the block. The proposed summary text fits the contract form.

## Corrected claim

The claim holds as written. Only the edit needs correction.

## Corrected edit

Keep one short line for each of the ten jobs in the main list:
1. Sends the two isolation headers on the dev server and vite preview (link to hosting.md).
2. Compresses with Brotli, with https and http2 options (link to hosting.md#during-development).
3. Compiles the sketch for the sketch worker and ships the WebAssembly core. The build stops if the core is missing.
4. Compiles WGSL in .wgsl files and /* wgsl */ strings. A shader error stops Vite with file, line and column (link to custom-shaders.md).
5. Removes the engine's development checks from production builds. Without the plugin, the engine runs as a development build, with every check on.
6. Builds the engine's workers as ES modules. The plugin warns if another setting changes this.
7. Starts each worker's on-demand imports together, so a worker does not wait one round trip for each file.
8. Keeps each engine file a separate file, so a strict Content-Security-Policy does not block a data: address.
9. Writes the third-party notices (link to hosting.md#publish-the-third-party-notices).
10. Writes null3d-files.json for offline play (link to hosting.md#offline-play).

After the list, add one block:

<details>
<summary>Technical details: how the plugin builds workers and files</summary>

Move here: the per-page preload script (line 50); the .d.ts declarations beside each .wgsl file, compiles on worker threads, and hot reload without a page reload (line 51); the address switches, other bundlers, no-bundler pages and the CDN production entry link (line 52); the classic-script fallback and the 34 MB worker size (line 53); the import-chain detail for the sketch and add-on tasks (line 54); and the note that your own small files keep Vite's inline setting (line 57).

</details>
