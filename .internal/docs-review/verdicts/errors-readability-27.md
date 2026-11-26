# errors-readability-27

## Finding as given

- page: errors/E1410
- anchor: page line 13: 'The sketch module that createEngine got did not load...'
- category: technical-details-block
- severity: low
- claim: The cause is 77 words in 5 sentences, and three of them explain the second import. A reader needs only the two causes and the fact that the message gives the reason.
- evidence: stats.json E1410: line 6 (77, 5). codes.ts line 381.
- proposedEdit: Cause: 'The sketch module that createEngine got did not load. It did not download, or its code threw an error while it loaded. The message gives the reason.' Details block 'Technical details: the second import'. fixCases: did not download (new URL('./sketch.ts', import.meta.url)); code threw (fix the quoted error).
- generatedSource: packages/engine/src/errors/codes.ts (E1410); packages/engine/src/errors/fixes.ts (E1410)

Verdict: partly

## Evidence

- The page (docs/errors/E1410.md line 13) and codes.ts line 381 hold the same 77-word, 5-sentence cause. Sentences 3 to 5 explain the second import, so the count of three holds.
- The ErrorEntry type (codes.ts lines 10-21) says the cause is "What went wrong, in one or two sentences". The current cause breaks the type's own rule, and the short cause fits it. So the shortening is right.
- The cause is not only the page body. errorPage in tools/lib/docs.ts (lines 436-460) also uses it as the frontmatter summary, and errorIndexPage (line 466) puts it in a table cell of docs/errors/index.md. The long cause makes the index row for E1410 long too, so the shortening helps three places. But a details block cannot go into the cause: it would break the index table cell and the frontmatter summary.
- ErrorEntry has no field for a details block, and errorPage renders only cause, fix and example. So the block needs a new optional field on ErrorEntry (codes.ts) and a change to errorPage in tools/lib/docs.ts that writes it after "What happened". The finding names only codes.ts and fixes.ts as sources, so it misses the renderer.
- "fixCases" does not exist. The fix in fixes.ts line 104 is already two sentences, one for each cause (a download that failed, then code that threw). It is also put into the runtime error message (define-sketch.test.ts line 69 checks that the message contains ERROR_FIXES.E1410). It needs no new structure. That part of the edit has no reader cost to fix and is not supported by the code.
- The retry detail matches the code (packages/engine/src/sketch/define-sketch.ts lines 305-311, and lines 340-342 for no second download when code threw). The code also says an engine error thrown by the module keeps its own code, which the page does not say. That fits in the same block.

## Corrected claim

The cause breaks the one-or-two-sentence rule of the error table, and three of its five sentences explain the second import. Shorten the cause. Move the second-import detail to a new optional details field that only the error page renders. The fix text already covers both causes and needs no change.

## Corrected edit

- codes.ts E1410 cause: "The sketch module that createEngine got did not load. It did not download, or its code threw an error while it loaded. The message gives the reason."
- codes.ts: add an optional details field to ErrorEntry. For E1410: "The engine imports a module that did not load once more after a short wait, and the console notes that second import. The error comes only when the second import fails too, and it gives the reason of the first. A module whose code threw is not imported again, since it would throw again. When that code threw an engine error, the load fails with that error's code instead of E1410."
- tools/lib/docs.ts errorPage: when details is set, write it after the cause, inside `<details>` with `<summary>Technical details: the second import</summary>`, with blank lines around the body. Do not use it in the summary or in the index table.
- fixes.ts E1410: no change.
