# tree-structure-28

Finding as given:

```json
{
 "page": "pages",
 "anchor": "AREAS",
 "category": "scan-order",
 "severity": "low",
 "claim": "The area order puts the API reference before Guides and the Cookbook after Errors.",
 "evidence": "AREAS: getting-started, concepts, api, guides, shaders, porting, cli, errors, cookbook.",
 "proposedEdit": "Order: getting-started, concepts, guides, cookbook, shaders, deploy, porting, api, extend, cli, errors. Learning and doing first, reference last.",
 "generatedSource": "tools/lib/docs.ts (AREAS)",
 "id": "tree-structure-28",
 "slice": "tree",
 "role": "structure"
}
```

Verdict: partly

Evidence:
- tools/lib/docs.ts:58-69: the area list is getting-started, concepts, api, guides, shaders, porting, cli, errors, cookbook. Its comment says "Docs areas in reading order". The claim about the order is correct.
- docs/pages.md: "API reference" starts at line 49 and runs to line 93, before "Guides" at line 94. "Errors" runs from line 153 to 237, about 80 error rows. "Cookbook" comes last at line 238. A reader who looks for the recipes must scroll past every error code. That is a real cost, not only taste. Low severity is right.
- tools/lib/docs.ts:306 and tools/lib/skills.ts:95 use the list only as a set of area names, so the order changes nothing but the page list (docs.ts:523). A reorder is safe.
- The proposed edit names two areas, "deploy" and "extend", that do not exist. There is no docs/deploy or docs/extend folder, and AREAS has no such entry. Pages about hosting live in getting-started, and pages about add-ons live in api. A list entry with no pages is skipped (docs.ts:528), so the entries would do nothing, and they suggest areas the docs do not have.

Corrected claim: The area order puts the API reference before Guides, and puts the one-page Cookbook after about 80 error rows. Only the page list (docs/pages.md) uses this order.

Corrected edit: In tools/lib/docs.ts AREAS, use the order getting-started, concepts, guides, cookbook, shaders, porting, api, cli, errors. Do not add "deploy" or "extend" unless a separate change makes those areas and moves pages into them.
