# tree-structure-25

## Finding as given

- page: porting/*
- anchor: "## Porting from three.js (pages.md)"
- category: scan-order, severity: low
- claim: The mapping table that every porting page leans on comes last, and the threads and loop page, the biggest structural change, is fifth.
- evidence: pages.md porting order: overview, materials, shaders, postprocessing, loop-and-threads, react-three-fiber, unsupported, verification, threejs-mapping.
- proposedEdit: Order: threejs-overview, threejs-loop-and-threads, threejs-mapping, threejs-materials, threejs-shaders, threejs-postprocessing, react-three-fiber, threejs-unsupported, verification.
- generatedSource: tools/lib/docs.ts (PAGES and the generated-page order)

Verdict: partly

## Evidence

- The order is as stated. docs/pages.md lines 137-145 list the nine porting pages in that order.
- Why the mapping page is last: tools/lib/docs.ts `pageList` (about line 518) ranks pages by their index in PAGES. The mapping page is generated (`mappingMarkdown`, about line 391) and is not in PAGES (lines 180-187), so it gets rank MAX_SAFE_INTEGER and always sorts last in its area.
- Loop-and-threads is fifth because PAGES puts it after postprocessing (docs.ts line 184). The overview's own workflow (step 4, "Port the loop, then the camera ...") and its "What changes in the code" table make the loop the first thing a port touches, so moving it up matches the docs' own advice.
- The cost to a reader is small. pages.md is an inventory of all pages, not the reading path. The reading path starts at the overview, which is already first. The overview links the mapping in its second paragraph, links the loop page right after its "What changes" table, and its "Related pages" list (end of docs/porting/threejs-overview.md) already gives mapping first and loop-and-threads second. The docs home (docs/index.md line 43) links the mapping page directly.
- "Every porting page leans on" the mapping is overstated. threejs-shaders.md and verification.md do not link the mapping page; the other written porting pages do.
- The edit cannot be made in PAGES alone. Moving loop-and-threads up is a one-line reorder in PAGES. Putting the mapping page third needs the pageList rank to know about generated pages (for example, a rank entry for porting/threejs-mapping), because it is not in PAGES.

## Corrected claim

In the all-pages list (docs/pages.md), the three.js mapping page sorts last in the porting area because generated pages are not in the inventory order, and the loop and threads page sits fifth although the overview says to port the loop first. The overview's "Related pages" list already gives the better order (mapping, then loop), so the effect is limited to the all-pages list. Severity low.

## Corrected edit

1. In tools/lib/docs.ts PAGES, move `porting/threejs-loop-and-threads` to directly after `porting/threejs-overview`.
2. In `pageList`, give generated pages a rank so the mapping page can sit after the overview (for example, rank `porting/threejs-mapping` just after the overview, or add an explicit position for generated pages in the inventory). Resulting order: overview, threejs-mapping, loop-and-threads, materials, shaders, postprocessing, react-three-fiber, unsupported, verification. This matches the overview's "Related pages" order, so the two lists agree.
