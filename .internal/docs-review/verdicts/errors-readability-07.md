# errors-readability-07

## Finding as given

```json
{
 "page": "errors/* (all 80), errors/index",
 "anchor": "front matter summary; index column 'What happened'",
 "category": "scan-order",
 "severity": "medium",
 "claim": "errorPage() copies the whole cause into the front-matter summary, and errorIndexPage() puts the whole cause in the index table cell. Long causes give 200-word summaries and cells, so the index rows spread far apart. Applies to all 80 pages and the index.",
 "evidence": "tools/lib/docs.ts line 443 ['summary', entry.cause]; line 466 tableCell(entry.cause). docs/errors/E1416.md line 6: a 194-word summary. E1223: a cell of one 207-word sentence.",
 "proposedEdit": "Once cause is limited to two sentences, the summary and cell stay short. Until then, have the generator use only the cause's first sentence for the summary and the index cell.",
 "generatedSource": "tools/lib/docs.ts (errorPage, errorIndexPage)",
 "id": "errors-readability-07",
 "slice": "errors",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- The mechanism is real. In `tools/lib/docs.ts`, `errorPage()` writes `['summary', entry.cause]` into the front matter, and `errorIndexPage()` writes `tableCell(entry.cause)` into the "What happened" column. The full cause is also the body of the "What happened" section on each page.
- The examples are right. `docs/errors/E1416.md` has a summary of about 194 words. The E1223 row in `docs/errors/index.md` (line 44) is one sentence of about 207 words.
- The scope is overstated. There are 79 error pages, not 80. Short causes are not a problem: 20 summaries have 40 words or fewer (E1101 to E1106 are one or two short sentences). The harm is in 32 pages with summaries over 60 words, 15 of them over 100 words. The longest are E1217 (about 255), E1109 (about 217), E1223, E1416, E1412 (about 166).
- The fallback edit does not fix the worst case. E1223's cause is a single 207-word sentence, so "first sentence only" still gives a 207-word summary and cell. For the other long causes, the first sentence is short (E1217: 24 words, E1109: 10, E1416: 14, E1412: 11, E1434: 17, E1406: 20), so the fallback works for them.
- A naive first-sentence split is risky. Causes hold dots that do not end a sentence, such as `assets.loadGltf()`, `scene.createLines()` and "glTF 2.0". The split must end only at a full stop followed by a space and a capital letter, or at the end of the text.

## Corrected claim

`errorPage()` and `errorIndexPage()` copy the whole cause into the front-matter summary and the index "What happened" cell. The code does this for all 79 error pages. It hurts readability in the 32 pages whose cause is over 60 words (15 over 100 words), and in their index rows.

## Corrected edit

Give each error entry in `packages/engine/src/errors/codes.ts` a short cause of one or two sentences. `errorPage()` uses it for the summary, `errorIndexPage()` uses it for the index cell, and the page's "What happened" section starts with it. Move the long list of failure cases (for example E1416's size limits and E1223's list of refused descriptions) from the cause into the page body, as a list or in a `<details>` block with a `<summary>Technical details: every case that raises this error</summary>`. Until that is done, the generator can use the cause's first sentence, with a split that skips dots inside code names and numbers. E1223 is one 207-word sentence, so it must be rewritten in the source in any case.
