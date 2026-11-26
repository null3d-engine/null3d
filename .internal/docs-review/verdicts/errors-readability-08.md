# errors-readability-08

## Finding as given

- page: errors/* (all 80)
- anchor: ## How to fix it
- category: structure
- severity: medium
- claim: The fix in fixes.ts also ends every runtime EngineError message, and the page prints the same string. So a fix written to cover every case is a wall on the page and in the developer's console. The page has no docs-only place for fixes that apply to one case each. Applies to all 80 pages.
- evidence: engine-error-core.ts line 19 messageFor() appends the fix. The fixes.ts header says the text 'ends every EngineError message' and downloads with the page. Fix lengths: E1217 320 words, E1109 161, E1223 150, E1215 115, E1216 107.
- proposedEdit: Limit fix to the general fix, in at most 4 sentences and 90 words. Move the fixes for each case into the docs-only fixCases in codes.ts. The message's 'See <page>' link then leads to them. This also makes the page download smaller.
- generatedSource: packages/engine/src/errors/fixes.ts; packages/engine/src/errors/codes.ts; tools/lib/docs.ts

Verdict: partly

## Evidence

Holds:
- packages/engine/src/errors/engine-error-core.ts:18-21: messageFor() appends the fix to the detail, then "See <docs page>". The console message and the page section carry the same text.
- tools/lib/docs.ts:450-452: the "How to fix it" section prints entry.fix unchanged. codes.ts:23 onward (DOCS) has title, cause, example and since only. There is no docs-only place for extra fix text.
- Fix lengths, measured from ERROR_FIXES: E1217 320 words, E1109 161, E1223 150, E1215 115, E1216 107. The E1217 fix has 16 to 17 sentences and lists many cases one by one. It is a wall in the console too.

Does not hold:
- "Applies to all 80 pages" is overstated. docs/errors holds 79 code pages plus index.md, which has no fix section. Only 8 of 79 fixes are over 90 words, and stats.json marks the fix paragraph long on 12 pages (E1109, E1206, E1215, E1216, E1217, E1218, E1223, E1307, E1405, E1412, E1416, E1501). The median fix is about 41 words. The missing docs-only place is general, but the cost falls on about 12 pages.
- "the docs-only fixCases in codes.ts" does not exist. No field of that name is in codes.ts or docs.ts. The edit must add a new optional field to the DOCS entries and render it in errorPage() in tools/lib/docs.ts.
- "This also makes the page download smaller" is wrong. engine-error.ts:1-5 and :64 load fixes.ts by dynamic import at a thread's first error only: "A page that throws no error downloads none of that text." No runtime file imports ERROR_FIXES statically (only types). Shorter fixes shrink only the chunk that loads when an error happens. The fixes.ts header ("The page imports this table and hands it to each worker it starts, so the text downloads once, with the page") is stale against engine-error.ts. The finding quotes that stale header as evidence.

## Corrected claim

On about 12 of the 79 error pages (worst: E1217, E1109, E1223, E1215, E1216), the fix lists every case one by one. The same text ends the console message, so it is a wall in both places. The error page has no docs-only place for fixes that apply to one case each.

## Corrected edit

- In packages/engine/src/errors/fixes.ts, cut each long fix to the general fix: at most 4 sentences and 90 words. Keep the console text short and true for every case.
- In packages/engine/src/errors/codes.ts, add an optional docs-only field to ErrorEntry and the DOCS entries (for example `fixDetails`) for the fixes that apply to one case each. Fill it only for the pages that need it.
- In tools/lib/docs.ts errorPage(), print that field after the general fix in a collapsible block, so the page reads well with the block closed:

  <details>
  <summary>Technical details: fixes for each case</summary>

  (a short list, one case per item)

  </details>

  No headings and no nested blocks inside it.
- Fix the stale header comment in fixes.ts so it says the table loads at a thread's first error.
- Drop the "smaller page download" benefit from the rationale.
