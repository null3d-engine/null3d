# errors-substance-17

## Finding as given

- page: errors/E1422
- anchor: ## How to fix it; example 'blocks the job-0 worker'
- category: missing-content
- severity: medium
- claim: A page without a build step makes its sketch at a blob: address. Its script-src then needs blob:, and 'unsafe-inline' for an inline script. The CDN page says so, and E1422 does not. E1422 is also raised when the policy blocks the sketch module itself. The example uses the internal thread name 'job-0'. The page does not link the hosting page that holds the whole policy.
- evidence: docs/getting-started/cdn.md:164-176. docs/getting-started/hosting.md:84-98. sketch/define-sketch.ts:322-327. page/frame-stats.ts:132 (job-0 is a thread name).
- proposedEdit: Add: 'A page without a build step makes its sketch at a blob: address, so its script-src needs blob: too.' In the example, write 'blocks a job worker'. Move the Firefox note and the blob: mechanism into a details block. Link getting-started/hosting#the-engines-files-on-a-cdn and getting-started/cdn.
- generatedSource: packages/engine/src/errors/codes.ts; packages/engine/src/errors/fixes.ts

Verdict: partly

## Evidence

Holds:
- packages/engine/src/sketch/define-sketch.ts:305-330 (loadSketch) raises E1422 when the policy's script directive blocks the sketch module: "blocks the sketch module <url>: its <directive> does not allow <blocked>". The E1422 cause (codes.ts:472-478) names only workers and .wasm files. Its fix (fixes.ts E1422) gives an example script-src with no blob:. docs/getting-started/cdn.md:164-171 says a no-build page makes its sketch module at a blob: address, so script-src needs blob:. A reader who copies the E1422 example policy on such a page still gets E1422.
- The page gives no pointer to the full policy. The E1418 fix already does this in plain text ("The hosting page of the docs gives the whole policy that the engine needs").

Does not hold:
- 'unsafe-inline' is not E1422 territory. An inline script that the policy blocks never runs, so the engine cannot raise any code. hosting.md:100 says the browser console names the directive in that case.
- 'job-0' is not internal. The example is the engine's real message: shared/worker-start.ts:146 builds "the <name> worker" from the worker name "null3d-job-<n>" (page/engine.ts:1632) with the prefix removed, and refusedBootstrap (worker-start.ts:84-92) prints the example text word for word. job-0 is also a public thread name in frame stats (page/frame-stats.ts:132, debug/stats.ts:38). "blocks a job worker" would make the example differ from what the reader sees.
- A details block or a Markdown link does not fit these sources. tools/lib/docs.ts:436-458 (errorPage) puts the cause in the front matter summary and in the error index table cell, and errors/engine-error-core.ts:19-21 (messageFor) appends the fix text to the runtime error message. HTML or Markdown there would show as raw text in console messages, the summary and the table. No error page under docs/errors/ holds a link today. The page is 177 words with no long paragraph (stats.json), so there is no dense block to fold.

## Corrected claim

E1422 is also raised when the page's script-src blocks the sketch module, and a no-build page makes its sketch at a blob: address. The page's cause and its example policy do not say that script-src then needs blob:. The page also gives no pointer to the hosting page's full policy, as the E1418 fix does.

## Corrected edit

In codes.ts E1422 cause, add one sentence: "The policy's script-src can also block the sketch module, which a page without a build step makes at a blob: address." In fixes.ts E1422, add: "A page that makes its sketch at a blob: address also needs blob: in script-src. The hosting page of the docs gives the whole policy that the engine needs." Keep both as plain text: no links and no details block, because the fix is part of the runtime message and the cause is the page summary. Keep the job-0 example as it is.
