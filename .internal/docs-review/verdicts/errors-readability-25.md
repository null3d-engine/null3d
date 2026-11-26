# errors-readability-25

## Finding as given

- page: errors/E1422
- anchor: page line 17: 'For example: worker-src 'self' blob: https://cdn.example.com; script-src ...'
- category: example-placement
- severity: medium
- claim: The fix holds a whole Content-Security-Policy value inside a sentence. On the page it wraps as normal text, so a reader cannot copy it cleanly or see where it ends.
- evidence: fixes.ts line 128.
- proposedEdit: Add a docs-only fixExample to E1422 in codes.ts with the policy line as a text code block, and have errorPage() print it under the fix. Do the same for E1418. Shorten the runtime text to 'Add blob: and the engine's origin to worker-src, and the origin to script-src and connect-src.'
- generatedSource: packages/engine/src/errors/codes.ts (E1422, E1418); tools/lib/docs.ts (errorPage)

Verdict: partly

## Evidence

- docs/errors/E1422.md:17 holds three directives inline, in plain text. The last one ends with "https://cdn.example.com." and the next sentence "Or serve ..." follows at once, so the policy's end runs into the sentence's full stop. The claim about E1422 holds.
- The source is packages/engine/src/errors/fixes.ts:127-128. That text also ends the runtime EngineError message (fixes.ts:1-3), so an edit there changes what the console prints too.
- tools/lib/docs.ts:436-459 (errorPage) prints entry.fix as one paragraph. It has no field for a code block or a link, so a docs-only field needs a new optional member on ErrorEntry and a new branch in errorPage. The proposed source locations are right.
- The inline policy is also not the whole policy. It has no default-src. docs/getting-started/hosting.md:85-87 gives the full CDN policy in an http code block, with a list that explains each part (hosting.md:89-92). The E1422 page does not link to it, so the reader cannot find the clean copy from the error page.
- E1418 is wrong to include. docs/errors/E1418.md:17 gives only "script-src 'self' 'wasm-unsafe-eval'", which is short and reads fine inline. Its real gap is different: "The hosting page of the docs gives the whole policy" is plain text with no link (fixes.ts:120).
- The proposed short runtime text drops "Or serve the engine's files from the page's own origin." That is a second, valid fix and must stay.

## Corrected claim

On E1422 only, the fix puts a partial Content-Security-Policy (three directives, no default-src) inline in a sentence. The policy's end runs into the sentence's full stop, so it is hard to copy cleanly. The full policy is in a code block on the Hosting page, and the error page does not link to it. E1418's inline example is short and reads fine.

## Corrected edit

- In packages/engine/src/errors/codes.ts, give E1422's DOCS entry an optional docs-only policy line (for example a `fixExample` field). Use the same line as hosting.md:86, default-src included. In tools/lib/docs.ts errorPage(), print that field as a code block under "How to fix it" when it is present, followed by a link to ../getting-started/hosting.md#the-engines-files-on-a-cdn.
- In packages/engine/src/errors/fixes.ts, shorten E1422's fix to: "Add what the message names to the page's Content-Security-Policy. Its worker-src needs blob: and the origin of the engine's files, and its script-src and connect-src need that origin. Or serve the engine's files from the page's own origin." This keeps the second fix and avoids printing the example twice on the page.
- Leave E1418's inline example as it is. Treat its unlinked mention of the hosting page as a separate, low-severity finding.
- Severity: low to medium. The page is still correct, and the Hosting page has the clean copy.
