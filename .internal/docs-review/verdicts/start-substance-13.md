# start-substance-13

## Finding as given

- page: getting-started/install
- anchor: ## Add the Vite plugin bullets (lines 50-57); ## Builds line 71
- category: technical-details-block
- severity: medium
- claim: Several bullets explain bundler internals that a newcomer does not need: ES module workers and 34 MB classic workers, file preloading in workers, and data addresses under a strict policy. Line 71 explains the shader cache's key.
- evidence: install.md:53, :54, :57, :71; stats.json getting-started/install longParagraphs line 64.
- proposedEdit: Keep a short list: headers, compression and HTTPS, the sketch and core build, the WGSL compile, the development checks, and the notices and file list. Move the worker-format, worker-preload and data-address bullets into <details><summary>Technical details: how the plugin builds the engine's files</summary>. Move line 71's key and miss rules into <details><summary>Technical details: the shader cache's key</summary>.

Verdict: partly

## Evidence

- install.md:53 (worker format, 34 MB classic workers) and :54 (worker preloading of on-demand imports) describe only what happens without the plugin or how the plugin speeds up worker loads. Line 59 already says the plugin is required, so a reader cannot act on either bullet. Moving them into a closed block is right. The plugin warns on a wrong worker format by itself (packages/vite-plugin/src/index.ts:615-617).
- install.md:57 (data addresses) holds one fact a reader can act on: "Your own small files keep Vite's setting", so the reader's own small images or files still become `data:` addresses that a strict Content-Security-Policy blocks. The Content-Security-Policy section of hosting.md (lines 44-58) does not say this. Hiding this in a closed block hides an actionable caveat.
- install.md:71 is the stats.json long paragraph at body line 64 (the 7-line front matter shifts it to file line 71); it is 79 words and 5 sentences. Its key sentence matches packages/vite-plugin/src/shader-cache.ts:5-8 (WGSL, variant spec, compiler version; the code also keys on the source path). The last sentence, "A changed shader, a changed variant or a newer compiler misses and compiles again, so the cache never serves a wrong shader", tells the reader they never need to clear the cache for correctness. That belongs in the main text, next to line 75 that says how to ignore or clear the cache.

## Corrected claim

The worker-format and worker-preload bullets (lines 53-54) are internals a newcomer does not need and fit a closed block. The data-address bullet (line 57) holds one user-facing caveat about the reader's own small files under a strict policy, which must stay visible. In line 71 only the key sentence is internal detail; the "never serves a wrong shader" sentence is user-facing.

## Corrected edit

- Move lines 53 and 54 into one block after the list, `<details><summary>Technical details: how the plugin builds the engine's workers</summary>`, with the body as two plain paragraphs (no headings, no nesting). Do not put the block inside a list item.
- Shorten line 57 to a visible bullet: "Keeps each of the engine's files a file of its own, so a strict Content-Security-Policy does not block them. Vite still turns your own small files into `data:` addresses, which such a policy blocks." Put the reason (Vite's inline limit) in the same block if wanted. Consider adding the own-files caveat to the Content-Security-Policy section of hosting.md too.
- Line 71: keep "A compile can take most of a second... So the plugin keeps each compiled shader in `node_modules/.cache/null3d-shaders`. A later build of the same shader takes the cached result and starts no compiler. A changed shader, a changed variant or a newer compiler misses and compiles again, so the cache never serves a wrong shader." Move only the key sentence (the WGSL, its path, the variant spec and the compiler's version, where the version also changes with each engine release) into `<details><summary>Technical details: the shader cache's key</summary>` after the paragraph.
