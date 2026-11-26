# errors-substance-02

## Finding as given

- page: errors/E1101, errors/E1209, errors/E1422, errors/E1506 (template: all 80 error pages)
- anchor: page end (no See also section)
- category: missing-content
- severity: high
- claim: No error page links to the API page, concept or guide for its feature. About 40 pages link to error pages, but none link back. The fix text names pages without links, because that text is also the runtime message.
- evidence: tools/lib/docs.ts:436-459 has no link section. fixes.ts:94 and :120 say 'the hosting page of the docs gives...'. fixes.ts:146 says 'which docs/guides/baked-light-data.md describes'. fixes.ts:42 says "the texture's docs page". docs/concepts/handles.md:73-75 explains E1101 in full, and the E1101 page does not link to it.
- proposedEdit: Add a `see` list of page ids, each with an optional anchor, to each entry in codes.ts. Print it as '## See also', with titles from the page list, so the docs link check covers it. For the slice: E1101 concepts/handles. E1209 concepts/lighting and shaders/surface-functions. E1218 api/animation. E1224 api/scene. E1305 and E1404 api/engine and guides/debugging. E1410 guides/debugging. E1416 api/assets. E1422 getting-started/hosting#the-engines-files-on-a-cdn and getting-started/cdn. E1431 api/lights. E1437 cli/null3d#chrome-for-testing. E1506 api/feature-instances and concepts/culling.
- generatedSource: packages/engine/src/errors/codes.ts; tools/lib/docs.ts

Verdict: partly

## Evidence

- `errorPage()` in tools/lib/docs.ts (about lines 436-459) writes only "What happened", "How to fix it" and "Example". There is no link section.
- None of the 80 files in docs/errors/E*.md contains a Markdown link (grep for `](` finds 0 files).
- 47 pages outside docs/errors/ link to an error page (46 without pages.md). "About 40" is a little low, but the point holds.
- The fix text is the runtime message. `messageFor()` in packages/engine/src/errors/engine-error-core.ts:19-21 joins the detail and the fix. The message then links to the error page (DOCS_BASE, line 13). So the error page is where a developer lands from a thrown error, and it is a dead end.
- The fix texts name pages with no link: fixes.ts:94 (E1405) and :120 (E1418) say "the hosting page of the docs"; :146 (E1434) says "docs/guides/baked-light-data.md"; :42 (E1208) says "the texture's docs page"; :46 (E1213) says "The call's docs page lists them."
- docs/concepts/handles.md:73-75 explains E1101 in more depth than the E1101 page, and links to it. The E1101 page does not link back.
- Every proposed target exists: api/engine, api/lights, api/feature-instances, api/assets, api/animation, api/scene, guides/debugging, concepts/culling, shaders/surface-functions, cli/null3d, getting-started/cdn. The anchors exist too: hosting.md:60 "The engine's files on a CDN" and cli/null3d.md:590 "Chrome for Testing".
- The targets fit. Each page that mentions E1209 (concepts/lighting, shaders/surface-functions) and E1506 (api/feature-instances:151) explains the cause. concepts/culling.md:38 explains the direct draw path that E1506 is about.
- The `ErrorEntry` interface in codes.ts:10-21 has no field for related pages. A docs-only field in codes.ts (the DOCS table, not fixes.ts) keeps the links out of the runtime message and out of the bundle. That is the right place.

## What does not hold

- Severity. "High" means the page misleads a reader or blocks a newcomer. The error pages do neither. Each one states the cause and the fix correctly, and the website navigation still reaches the related pages. The cost is a dead end on the page that thrown errors link to, plus unlinked page names in some fixes. That makes a page clearly harder to use, which is medium.

## Corrected claim

No error page has any link. 46 other pages link to error pages, and none of the error pages link back. A thrown error links to its error page, so a developer who arrives there has no path to the concept, guide or API page that explains the feature. Some fix texts name a docs page without a link, because the same text is the runtime message. Severity: medium.

## Edit

Keep the proposed edit. Put the `see` list in the docs-only table in codes.ts, not in fixes.ts, so the runtime message and bundle do not change. Render it in `errorPage()` as "## See also" with titles from the page list, and with relative links so the docs link check covers them. For the codes whose fix names a page in words (E1405, E1418 to getting-started/hosting#content-security-policy; E1434 to guides/baked-light-data; E1208 to api/textures; E1213 to the API page of the call), include that page in the list.
