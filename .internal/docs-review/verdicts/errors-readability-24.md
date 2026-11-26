# errors-readability-24

## Finding as given

```json
{
 "page": "errors/E1110",
 "anchor": "page line 13",
 "category": "technical-details-block",
 "severity": "medium",
 "claim": "The cause is 122 words in 7 sentences, with one of 44 words. The first three sentences say what went wrong. The rest explains when development builds check, which only implementers need.",
 "evidence": "stats.json E1110: line 6 (122, 7). codes.ts line 91.",
 "proposedEdit": "Keep the first three sentences, plus one on batch rows without markDirty(). Move the check timing (transform updates, onLateUpdate, a share of a large batch, release builds) into 'Technical details: when the check runs'. fixCases: objects (a setter, or a dynamic object); batch rows (markDirty or dynamic: true); no direct writes (an engine bug).",
 "generatedSource": "packages/engine/src/errors/codes.ts (E1110); packages/engine/src/errors/fixes.ts (E1110)",
 "id": "errors-readability-24",
 "slice": "errors",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- The claim about the text holds. docs/errors/E1110.md line 13 is the cause: 122 words, 7 sentences (stats.json, line 6 is the same text in the front matter). The batch-row sentence is 44 words, which breaks the AGENTS.md "Writing docs" rule of at most 25 words a sentence. Sentences 4, 5 and the second half of 6 describe when development builds check, which a reader fixing the error does not need.
- The cause is used in three places, not one. tools/lib/docs.ts errorPage() (line 436 on) puts entry.cause in the front matter summary (line 442) and under "What happened" (line 448). errorIndexPage() (line 466) puts it in the row of the table in docs/errors/index.md (line 24). The ErrorEntry type in codes.ts says cause is "What went wrong, in one or two sentences". A <details> block written into the cause string would land in the YAML summary and in a table cell, and break both. So the edit cannot be made in codes.ts alone. It needs a new optional field (for example `details`) on ErrorEntry in codes.ts, and errorPage() in tools/lib/docs.ts must render it after the cause, under "What happened". The finding does not name docs.ts as a source.
- The check timing is already on a linked-to concept page, in more detail: docs/concepts/static-dynamic.md line 74 ("Setters and direct writes") and line 76. It covers both transform checks, the onLateUpdate second check, the turns of at most 4,096 rows a frame, and release builds. The E1110 page has no link to it. A link moves the reader to the full story and needs no generator change. A details block would repeat that page.
- "fixCases" does not exist anywhere in tools/ or packages/engine/src/errors/. The fix text (fixes.ts line 26) is 4 sentences, the longest about 22 words, and stats.json lists no long paragraph for it. That part of the edit has no basis, and it also changes the runtime message text that ends every EngineError.

## Corrected claim

The cause of E1110 (codes.ts line 91) is 122 words with a 44-word sentence, over the 25-word limit. It is also the page summary and the errors index row, so its length costs readers in three places. The check timing repeats docs/concepts/static-dynamic.md "Setters and direct writes", which the page does not link.

## Corrected edit

In codes.ts, cut the E1110 cause to what went wrong, each sentence under 25 words, for example:

"A static object's position, rotation, scale or bounding sphere changed without a setter. The engine recomputes a static object only in a frame where a setter marks it or its parent moves, so the change can show late, or never. A row of a static instance, sprite or point batch that changed without markDirty() raises it too. Development builds check for these writes in every frame; release builds leave the check out. [Static and dynamic objects](../concepts/static-dynamic.md#setters-and-direct-writes) explains the check."

Prefer this link over a details block, because the concept page already holds the timing detail. If a block is still wanted on the error page, add an optional `details` field to ErrorEntry in codes.ts and render it in errorPage() in tools/lib/docs.ts as `<details><summary>Technical details: when the check runs</summary>...</details>` after the cause. Never put the block in the cause string, which feeds the front matter summary and the index table. Leave fixes.ts as it is.
