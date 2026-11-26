# Shot and demo-link verdicts: guides/deploying

## Shots

### network-wasm-brotli: keep, with a corrected source
- It helps. The page tells the reader to compare the core's transferred size with its size (line 84). A newcomer does not know that Chrome hides the second number by default. One picture shows where to look.
- "Manual" is right, because it is a capture of the browser's developer tools.
- "A deployed production build" is too vague to repeat. The null3D Vite plugin's preview server compresses every answer with Brotli, loopback included (packages/vite-plugin/src/index.ts, configurePreviewServer; packages/vite-plugin/src/compress.ts). So a local preview gives the same view as a good host.
- The preview first answers at a fast Brotli quality, then compresses each file again at the best quality while idle. Take the shot on a later load, or the core shows more than the page's "about 0.6 MB".
- Corrected source: run `bun run examples:build`, then `bun run examples:preview`. Open any demo. In the Network panel, turn on "Big request rows", tick "Disable cache", filter to Wasm, and add the Content-Encoding and Content-Type columns (right-click a column title, Response Headers; add Content-Type through "Manage header columns"). Load once, wait a few seconds, and reload. Capture the core's row: transferred size above resource size, Content-Encoding br, Content-Type application/wasm.
- Alt text: add the numbers, for example "The network panel shows the engine core sent with Brotli: about 0.6 MB transferred for a 2.0 MB file."

### cross-origin-isolated-console: reject
- A picture of a console that prints one word, `true`, tells the reader nothing that the step's text does not. A reader cannot copy text from a picture.
- A short code block does the job better under "Check the deployed page", step 1:
  > crossOriginIsolated
  true
- The source ("a deployed production build") is also vague. If kept, the same examples preview would serve.

## Demo links
None were proposed.

## Concepts said to have no demo
- headers on hosts: confirmed. No demo in examples/demos.ts or examples/compare/comparisons.ts shows host headers. The examples preview sends the isolation headers, but it is not a demo.
- caching: confirmed. No demo shows cache headers or cached reloads.
- Brotli: confirmed. Compression lives in the Vite plugin, not in any demo.
- size budgets: confirmed. No demo shows download sizes or the asset budget report. The comparison pages label the GPU path (examples/lib/compare.ts), but not sizes or the threaded build.
