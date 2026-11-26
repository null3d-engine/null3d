# Verdicts: errors/E1422 (screenshots and demo links)

## Shot: console-csp-e1422 — REJECT

- The picture is a picture of text. The page's Example block already shows the E1422 message as text. A screenshot of the console adds no fact that text cannot give, and a reader cannot search it or copy from it.
- The useful part of the shot is the browser's own violation line ("Refused to create a worker from 'blob:...' because it violates ... worker-src ..."). Put that line, as text, in the Example block beside the E1422 line. Its wording differs between browsers and versions, so mark it as Chrome's.
- The named source files are wrong. The blob: worker case comes from `packages/engine/src/shared/worker-start.ts` (the refused-bootstrap check) and `packages/engine/src/shared/policy.ts`. `sketch/define-sketch.ts` raises E1422 for a different case: a sketch module that the policy blocks. `page/engine.ts` does not raise it.
- E1422 does not always reach the console. The engine reports it as the start's failure. The test page puts it in its result, not in the console. So the shot as described ("E1422 next to the violation report") needs the page to log the error itself.
- If the shot is kept anyway: "manual" is the right kind, because it shows the browser's developer tools. The setup is not vague, though. It exists as an automated test: `tests/image/cdn.spec.ts`, "a page on a CDN without blob: in worker-src gives the error that names it". That test serves the production build of `tests/pages/ktx2-files.html` from `http://localhost:<port>` with the engine files on `http://127.0.0.1:<port>`, under the CDN policy with `blob:` removed from worker-src.

## Demo links

None proposed. None needed.

## Concepts without a demo

- "a Content-Security-Policy for engine files on a CDN": confirmed. No demo in `examples/demos.ts` and no comparison in `examples/compare/comparisons.ts` sets a policy or serves files from another origin. Only the test `tests/image/cdn.spec.ts` covers it, and a test is not a demo link.
