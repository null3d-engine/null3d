# tree-structure-06

## The finding as given

- Page: getting-started/hosting, guides/deploying, guides/start-time, getting-started/network-use, getting-started/third-party-notices
- Anchor: ## Send the two headers / ## Let browsers keep the files / ## Compress with Brotli
- Category: duplication. Severity: medium.
- Claim: Deployment is spread over two areas and three pages that each explain the isolation headers, Brotli and cache lifetimes.
- Evidence: guides/deploying: 'Send the two headers', 'Let browsers keep the files', 'Compress with Brotli'. getting-started/hosting: 'The two headers', 'Let browsers keep the build files', 'Send the files with Brotli'. guides/start-time: 'Compress every file', 'Let the browser keep the files', 'Serve over HTTP/2'.
- Proposed edit: New area deploy ('Deploying'): guides/deploying -> deploy/index, getting-started/hosting -> deploy/hosting, guides/start-time -> deploy/start-time, getting-started/network-use -> deploy/network-use, getting-started/third-party-notices -> deploy/third-party-notices.
- Generated source: tools/lib/docs.ts (AREAS, PAGES)

Verdict: partly

## Evidence

The repeat across three pages is real:
- The same `_headers` cache block (`max-age=31536000, immutable` for `/assets/*`, `no-cache` for HTML) is in docs/guides/deploying.md:63-68 and docs/getting-started/hosting.md:247-252.
- The `Vary: Origin` advice is in all three pages: deploying.md (Let browsers keep the files), hosting.md:256, start-time.md (Let the browser keep the files, second bullet, near word for word).
- The `Content-Type: application/wasm` advice is in all three: deploying.md, hosting.md:262, start-time.md third bullet. The pages already differ: start-time names Chrome 157 and later, deploying gives no version.
- The core size figures (2.0 MB, about 0.8 MB gzip, about 0.6 MB Brotli) and the "many servers compress only text" check are in all three: deploying.md (Compress with Brotli), hosting.md:211, start-time.md:118-122.

What does not hold:
- network-use and third-party-notices hold no isolation header, Brotli or Cache-Control text (grep count 0 for both). They are not part of the duplication. Moving them is outside what the evidence shows.
- deploying.md already says it is a checklist and that hosting "explains each step in full" (line 21). start-time.md defers to hosting with links. So the split of roles exists; the fault is that the two other pages copy too much text, not that the structure is missing.
- A new area does not remove a single repeated sentence. The fix is to trim deploying and start-time. The move has a real cost: hosting is referenced from 31 files and start-time from 9 (docs, skills, packages, tools, examples), and every page id becomes a published URL on the website.
- start-time is not a deployment page. Most of its sections are page and sketch work: the early core script, the setup's downloads, the first frame before the large models, the preset check, pipelines on phones. Putting it under "Deploying" would hide it from readers who tune their sketch.

## Corrected claim

hosting, deploying and start-time repeat the same cache headers, `Vary: Origin` advice, `application/wasm` advice and Brotli size figures, and the copies already drift (Chrome version). network-use and third-party-notices are not part of this repeat.

## Corrected edit

Keep the current areas and page ids. Make getting-started/hosting the one full home of headers, caching and Brotli.
- guides/deploying: keep it a checklist. Keep the two header lines and the host table. Cut each of "Let browsers keep the files" and "Compress with Brotli" to two or three sentences that state the step and link to hosting#let-browsers-keep-the-build-files, hosting#let-chrome-keep-the-compiled-core and hosting#send-the-files-with-brotli. Drop the repeated `_headers` block and the size figures (the size budgets table keeps the 0.6 MB number).
- guides/start-time: in "Compress every file" keep only what hosting lacks: the shader file table, the Vite plugin's servers and the model compression figures. Replace the core-file row's repeat and the "compress only text" check with a link. In "Let the browser keep the files" keep the advice on hashed names for your own models, and replace the `Vary: Origin` and `application/wasm` bullets with one link to hosting.
