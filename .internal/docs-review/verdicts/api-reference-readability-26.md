# api-reference-readability-26

## Finding as given

- page: api/reference/engine, api/reference/debug, api/reference/scene, api/reference/assets
- anchor: engine line 598 `floatRenderTargets`; debug line 126 `load`; scene line 503 `sky`; scene line 387 `addComputeInstances`
- category: structure; severity: medium
- claim: Long inline types fill the member column and make tables wider than a laptop screen, squeezing the description column.
- evidence: 77 rows have a signature over 80 characters. floatRenderTargets 315 characters, FrameStats.load 275, TimeOfDay.sky 203, addComputeInstances 193.
- proposedEdit: For a signature over about 80 characters, print a short form in the cell (such as `floatRenderTargets: { ... }`) and the full type in a code block under the member's H3; or name and export the object type in the source.
- generatedSource: tools/lib/api-docs.ts

Verdict: partly

## Evidence

- The problem is real. A count of member-table rows across docs/api/reference/*.md gives exactly 77 signatures over 80 characters. The four anchors are as quoted (engine.md line 598, debug.md line 126, scene.md lines 387 and 503).
- `renderSymbol` in tools/lib/api-docs.ts (lines 486-501) prints every member as one table row, with the full signature in an inline code cell. `propertyOf` (lines 195-213) prints the type node's text as written in the source, so an inline object type in the source becomes an inline object type in the cell.
- "Wider than a laptop screen" is not shown. Inline code that has spaces usually wraps, and how the table renders depends on the website's CSS. What does hold: a cell of 200 to 300 characters takes most of the row and squeezes the description.
- The first option in the edit does not fit the page structure. Members have no H3 headings. Each export is a heading and its members are table rows (`grep '^### '` finds 0 headings on all reference pages). A short form such as `{ ... }` with nothing else would hide the field names, which is worse for a reader than a long cell.
- The second option is the better fix, and it brings an extra gain. `FrameMetrics.load` in packages/engine/src/page/frame-stats.ts (line 262 on) has a TSDoc comment on each field, but the page shows none of them, because the inline object prints as one cell. A named, exported type gets its own member table, so those field docs would show. `floatRenderTargets` in packages/engine/src/page/capabilities.ts (lines 169-174) repeats the same `{ complete; readsBack; samples }` shape four times, and one named type would remove that repeat.
- Naming types does not fix `addComputeInstances`. Its length comes from the generic parameter with its default (`<const Wgsl extends string | CompiledWgsl = string | CompiledWgsl>`), not from an inline object. The same holds for `addFeatureDraw`, `addFeatureInstances` and `createVertexDraw`.

## Corrected claim

77 member rows have signatures over 80 characters. They squeeze the description column. Most of them are inline object types copied from the source, and some are generic call signatures. One such type (`FrameMetrics.load`) also hides the per-field docs that the source has.

## Corrected edit

1. In the source, name and export the inline object types that the long rows show, with TSDoc and the same `@category`: for example a float-target test result type used four times in `floatRenderTargets`, a load-times type for `FrameMetrics.load`, and types for `TimeOfDay.sky` and `TimeOfDay.light`. Each then gets its own member table, and the row shows only the type name.
2. For the long generic call signatures, change `renderSymbol` in tools/lib/api-docs.ts. When a member's signature is longer than about 80 characters, print a short name in the cell (such as `addComputeInstances(description, options)`), and put the full signature in a `ts` code block in a list under the table, keyed by the member name. Do not add member H3 headings, and do not print `{ ... }` with no full type somewhere on the page.
