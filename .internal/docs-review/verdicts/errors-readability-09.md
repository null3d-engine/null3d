# errors-readability-09

## Finding as given

- page: errors/* (all 80)
- anchor: end of page
- category: missing-content
- severity: medium
- claim: An error page is often the first docs page a reader lands on, but it links to no other page. Fixes point to 'the hosting page of the docs' and 'the call's docs page' without links, and E1434 gives a raw path. 45 other pages link to error pages, and no page links back. Applies to all 80 pages.
- evidence: fixes.ts lines 94 (E1405), 120 (E1418), 46 (E1213), 146 (E1434, 'docs/guides/baked-light-data.md'). E1422 is linked from getting-started/cdn, getting-started/hosting and api/input. E1101 is linked from concepts/handles and guides/debugging. E1410 is linked from guides/custom-shaders and api/sketch.
- proposedEdit: Add '## Related pages'. Fill it from a docs-only related?: string[] in codes.ts (for example E1101 -> concepts/handles; E1405, E1418, E1422, E1423 -> getting-started/hosting; E1215, E1216 -> guides/custom-shaders; E1434 -> guides/baked-light-data). Then add the pages that link to errors/<code>.md, which the generator finds by searching the other pages.
- generatedSource: tools/lib/docs.ts (errorPage); packages/engine/src/errors/codes.ts

Verdict: survives

## Evidence

- tools/lib/docs.ts:436-460 (errorPage) writes only front matter, "What happened", "How to fix it" and "Example". It adds no link of any kind, not even to the error index.
- A search of docs/errors/ for Markdown links finds them only in index.md. None of the 80 E pages has a link.
- fixes.ts:46 ("The call's docs page lists them."), :94 and :120 ("the hosting page of the docs") and :146 (raw "docs/guides/baked-light-data.md") are as the finding says. Rendered E1434.md shows the raw path as plain text.
- Readers do land here first: guides/debugging.md:32 says each error carries the page's address in error.docs.
- The proposed mappings fit the titles: E1405 (engine thread did not start), E1418 (WebAssembly blocked), E1422 (engine file blocked), E1423 (engine file without CORS) are hosting problems; E1215/E1216 are custom WGSL problems; E1434 is the baked light format.
- Backlinks exist and are few per code (E1203: 9 pages, E1108: 7, E1422: 4), so an auto list stays short.

## Corrections and notes

- Count: 47 pages outside docs/errors/ reference an error page, not 45 (pages.md included). This does not change the finding.
- The edit is right to put links in codes.ts and not in fixes.ts. fixes.ts:1-5 says the fix text ends every runtime EngineError message, so Markdown links there would show in the console. codes.ts is docs-only (codes.ts:1-3).
- Add one fixed link on every page to the error index (errors/index.md) and to guides/debugging.md, so pages with no related entry and no backlinks still link somewhere.
- Sort the backlink list and leave out pages.md and errors/index.md, so it lists only pages that explain the error.
