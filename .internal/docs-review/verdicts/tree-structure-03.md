# tree-structure-03

## Finding as given

- page: pages
- anchor: ## Errors
- category: structure
- severity: high
- claim: Pages that PAGES leaves out always sort last in their area. errors/index comes after 80 error pages, and quality-preset-tables, first-use-shaders and threejs-mapping sit far from the pages that explain them. The list also holds 80 error rows that navigation should not show.
- evidence: tools/lib/docs.ts pageList: rank = order.get(p.id) ?? Number.MAX_SAFE_INTEGER. pages.md lists E1101..E1506 then '[Error codes](errors/index.md)' last; 'Quality preset tables' after 'The post-processing chain'; 'Shaders that load on first use' after 'Working with AI agents'.
- proposedEdit: Give generated pages an order slot (a generated flag in PAGES that the written-pages check skips, or a separate order list). In the errors area list only errors/index; the E pages stay reachable from its table.
- generatedSource: tools/lib/docs.ts (pageList, pageListPage, PAGES)

Verdict: partly

## Evidence

- tools/lib/docs.ts:519-521: pageList ranks a page by its index in PAGES, and a page not in PAGES gets Number.MAX_SAFE_INTEGER, then ties break on id. So the sort claim holds.
- docs/pages.md: "Quality preset tables" is the last Concepts row (line 47), seven rows after "Quality presets ..." (line 35). "Shaders that load on first use" is the last Guides row (line 122), far from "Loading screens and warm-up". "three.js to null3D mapping" is the last Porting row (line 145), eight rows after "Porting from three.js". "Error codes" (errors/index) is the last Errors row (line 236), after the E rows, because "errors/E..." sorts before "errors/index" on the id tie-break.
- The count is wrong: pages.md has 79 errors/E rows, not 80 (80 rows with the index).
- The proposed "generated flag that the written-pages check skips" is not needed. The missing-page check at tools/lib/docs.ts:709-712 already accepts a page that the generator writes (`generated.has(path) || existsSync(...)`), and shaders/library is a generated page that already sits in PAGES (docs.ts:178), so it sorts in place. The four generated pages can go into PAGES the same way. The other PAGES users (generateDocs loop at docs.ts:572, referenceProblems, release.ts:430 pageStatuses) do not break for pages with no API symbols. The comment above PAGES ("The inventory lists only written pages") is already untrue because of shaders/library, and should be reworded.
- "Navigation should not show" the E rows: pages.md is the "All pages" listing, not the website navigation. Its front matter summary and docs/index.md:49 promise "every page by area". The 79 E rows are still a real cost: they bury the "Error codes" row, and errors/index already lists every code with its cause. pageListPage already drops a whole area (the reference pages, docs.ts:547), so dropping errors/E* has a precedent. If the rows go, the pages-list summary and docs/index.md:49 must stop saying "every page".
- Severity: nothing here misleads a reader or blocks a newcomer. Every page is still listed and linked. This is medium (the list is clearly harder to use), not high.

## Corrected claim

Generated pages that are not in the PAGES inventory sort last in their area. So "Error codes" comes after the 79 error-code rows, and the quality preset tables, the first-use shaders list and the three.js mapping sit at the end of their areas, away from the pages they belong with. The 79 error-code rows also bury the error index, which already lists every code. Severity: medium.

## Corrected edit

In tools/lib/docs.ts, add entries for concepts/quality-preset-tables (after concepts/quality-presets), guides/first-use-shaders (after guides/loading-screens), porting/threejs-mapping (after porting/threejs-overview) and errors/index to PAGES, as shaders/library already is. The missing-page check already accepts generated pages, so no flag is needed. Reword the comment above PAGES so that it does not say the inventory lists only written pages. In pageListPage, also filter out ids that match errors/E*, as it already filters the reference area. Then change the "All pages" summary and docs/index.md line 49 so they no longer say "every page", or say that error codes are listed on the Error codes page.
