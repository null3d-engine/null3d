# errors-substance-19

## Finding as given

- page: errors/E1410
- anchor: ## What happened (line 6, 77 words)
- category: missing-content
- severity: low
- claim: The page leaves out the most common cause, which the debugging guide gives: the sketch reads document while it loads. It does not say that a policy-blocked module gives E1422 instead. It does not say how to tell a failed download from a script error. The two-import retry is correct, but it is implementation detail in the main text.
- evidence: docs/guides/debugging.md:41. sketch/define-sketch.ts:305-357 (the retry, and E1422 at :322-327).
- proposedEdit: Add: 'A common cause is sketch code that reads document or window when the module loads: the sketch runs in a worker.' Add: "A message that quotes 'Failed to fetch' means the download failed. One that quotes a script error, such as ReferenceError, means the module's code threw." Add a line on E1422. Move the retry sentences into a details block.
- generatedSource: packages/engine/src/errors/codes.ts; packages/engine/src/errors/fixes.ts

Verdict: partly

## Evidence

- The gaps are real. docs/errors/E1410.md:13 (What happened) and :17 (How to fix it) do not name the `document` case, do not name E1422, and give no rule to tell a failed download from a script error. The fix text says only "When the download worked, the module's own code threw the error that the message quotes", which does not say how to see whether the download worked.
- "Most common cause" is too strong. docs/guides/debugging.md:41 gives reading `document` only as an example ("for example when it reads `document`"). Nothing measures how common it is.
- "The sketch runs in a worker" holds only by default. packages/engine/src/page/engine.ts:351-359: `sketchThread` is `worker` by default. With `main`, or in the single-threaded build, the sketch runs on the page's thread and can read `document`, so this cause does not occur there.
- "Failed to fetch" is Chrome's wording. The message quotes the browser's own reason (define-sketch.ts:352-356, `reasonOf(first)`). Firefox and Safari use other text for a failed module download, so a rule keyed on "Failed to fetch" misleads readers on those browsers.
- E1422 comes before the retry, when the page's Content-Security-Policy blocks the sketch module (define-sketch.ts:322-327). A pointer to E1422 is fair. Note that the E1422 cause text (codes.ts:472-479) talks only about the engine's own files, not the sketch module. That is a gap on the E1422 page, not on this one.
- The details-block edit cannot be made in the named sources alone. tools/lib/docs.ts:436-459 (`errorPage`) writes `entry.cause` into the front-matter `summary` and into the What happened section. `errorIndexPage` (docs.ts:463-467) writes it into a table cell of docs/errors/index.md. A `<details>` block inside the cause string would break the YAML summary and the index table. The block needs a new optional field on `ErrorEntry` (codes.ts:10-20, for example `details`) that `errorPage` renders after the cause. So docs.ts must be named as a source too.
- Stats: one long paragraph (77 words, 5 sentences), which is the cause text shown both in front matter and at line 13. Moving the retry sentences out shortens it, and shortens the front-matter summary and the index row too.

## Corrected claim

The E1410 page does not say how to tell a failed download from a script error, does not point to E1422 for a module that the page's policy blocks, and does not name reading `document` in a worker as an example cause. The two-import retry is detail for implementers and lengthens the cause text, which also feeds the front-matter summary and the error index row.

## Corrected edit

1. In fixes.ts E1410, add: "A sketch runs in a worker by default, so code that reads document or window when the module loads throws: move that code into the setup function, or start the engine with sketchThread: 'main'." (Check that the setup function also runs in the worker; if so, say only "remove that code, or use sketchThread: 'main'".)
2. In fixes.ts E1410, replace the download sentence with a browser-neutral rule: "When the message quotes a script error, such as ReferenceError or SyntaxError, the module downloaded and its code threw: fix that error. Otherwise the download failed: check the address and that the server sends the file."
3. In the cause, add one sentence: "When the page's Content-Security-Policy blocks the module, the error is E1422 instead." Optionally widen the E1422 cause text in codes.ts to name the sketch module.
4. Add an optional `details` field to `ErrorEntry` in codes.ts. Render it in `errorPage` (tools/lib/docs.ts) after the cause, wrapped in `<details><summary>Technical details: how the engine retries the import</summary> ... </details>`, and never in the front-matter summary or the index table. Move the retry sentences there, and keep one sentence in the main cause: "The engine tries the import twice before it gives this error, and the console notes the second try."
