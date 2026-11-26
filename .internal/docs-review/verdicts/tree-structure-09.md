# tree-structure-09

## Finding as given

- page: concepts/*
- anchor: ## Concepts (pages.md)
- category: scan-order
- severity: medium
- claim: The concepts order follows no model. Assets and post-processing come last after LOD and culling, and the generated preset tables sit far from the presets page.
- evidence: PAGES concepts order: architecture, handles, static-dynamic, instances, particle-buffer, backends, quality-presets, color-management, materials, lighting, shadows, render-layers, render-graph, large-worlds, culling, lod, assets, post-processing; quality-preset-tables last.
- proposedEdit: Groups: How the engine runs (architecture, handles, static-dynamic, backends, quality-presets, quality-preset-tables, glossary NEW); Scene data (assets, culling, lod, large-worlds, render-layers); Rendering (color-management, materials, lighting, environment NEW, shadows, render-graph, post-processing).
- generatedSource: tools/lib/docs.ts (PAGES)

Verdict: partly

## Evidence

- tools/lib/docs.ts:90-107 holds the concepts order exactly as the finding states.
- The preset tables page is last for a mechanical reason, not by choice. It is not in PAGES. pageList (tools/lib/docs.ts:519-544) ranks a page that is missing from PAGES at Number.MAX_SAFE_INTEGER, so it always sorts to the end. docs/pages.md:47 shows it after post-processing, 12 rows away from quality presets (docs/pages.md:35). This part holds.
- The fix is cheap. A generated page can sit in PAGES: the shader library page already does (docs.ts:583). The inventory check (docs.ts:708-712) accepts a page that the generator writes.
- "Follows no model" is too strong. The list has a loose order: the object model (architecture to particle buffer), then the device fit (backends, quality presets), then drawing (color, materials, lighting, shadows, layers, render graph), then scale (large worlds, culling, LOD). Post-processing last matches its place at the end of the frame, so that part of the claim is not a real cost.
- Assets last is a real problem. A newcomer loads a model before most other things, but the assets page comes after LOD and culling.
- The proposed edit has three faults:
  1. It drops two existing pages, instances and particle-buffer, from every group.
  2. It adds two new pages (glossary, environment). New pages are out of scope for an order finding. The lighting page is already "Lighting and environment" (docs.ts:99), so a new environment page would split it. Other findings cover those pages.
  3. The page list has no sub-groups inside an area. AREAS and pageList (docs.ts:59-69, 519-544) make one flat table per area. Named groups need new generator code, which a reorder does not need.

## Corrected claim

The generated quality preset tables page sorts to the end of the concepts list, far from the quality presets page, because it is missing from PAGES. The assets page also comes too late, after the drawing and scale pages. The rest of the order has a loose model that a reader can follow, and post-processing last matches the frame order.

## Corrected edit

In tools/lib/docs.ts PAGES, keep one flat list and keep every existing page:
architecture, handles, static-dynamic, instances, particle-buffer, assets, backends, quality-presets, quality-preset-tables (new PAGES entry with the generated page's title and summary, so its rank is right after quality presets), color-management, materials, lighting, shadows, render-layers, render-graph, large-worlds, culling, lod, post-processing.
Do not add glossary or environment pages under this finding.
