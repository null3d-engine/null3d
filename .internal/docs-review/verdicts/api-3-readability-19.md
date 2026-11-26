# Verdict: api-3-readability-19

## The finding as given

```json
{
 "page": "api/render",
 "anchor": "## Compute passes, lines 225-452",
 "category": "split-page",
 "severity": "medium",
 "claim": "Compute passes take about 220 lines and six of the page's eight H3 sections, so a reader who wants a minimap or a mirror meets the largest share of the page in an advanced add-on topic. 'Switching and removing passes' applies to every kind but sits as an H3 under compute.",
 "evidence": "stats.json headings for api/render; 6,480 words.",
 "proposedEdit": "Move '## Compute passes' and its H3s (lines 225-445) to a new page 'Compute passes', linked from the intro's pass-kind table. Promote 'Switching and removing passes' to an H2 on api/render.",
 "generatedSource": "tools/lib/docs.ts (PAGES entry for the new page)",
 "id": "api-3-readability-19",
 "slice": "api-3",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- The page has 10 H3 sections, not 8 (stats.json heading outline; docs/api/render.md:65, 144, 150, 309, 322, 336, 345, 407, 439, 447). Seven sit under "## Compute passes". Six of them are about compute alone. The seventh is "Switching and removing passes".
- The compute section runs from line 225 to line 446: 222 of the page's 499 lines, and about 2,480 words. It is the largest H2 section. It is not most of the page: the scene, reflection and full-screen sections before it hold about 3,000 words. The line count also overstates it, because "State between runs" (345-405) and "Reading a region back" (407-437) are hard-wrapped near 100 characters, while the rest of the page puts each paragraph on one line.
- A reader who wants a minimap does not have to pass through compute. "A minimap" is the first section (23-36), and scene and reflection passes come next (38-152). That part of the claim is weak.
- The misplaced section is a real problem. "Switching and removing passes" (447-452) covers every pass kind. It names full-screen passes and compute passes, and it documents `setPassEnabled`, `setPassEvery` and `removePass` for every kind. As an H3 under "Compute passes", a reader who wants to pause a minimap or a mirror will not look there. This holds on its own and needs no page split.
- The proposed edit has an error. The intro (lines 9-21) has no "pass-kind table". It is one paragraph with a link to each section, the compute link at line 21 included.
- The edit leaves out work that a move needs:
  - Three inbound links point to `render.md#compute-passes`: docs/guides/custom-passes.md:507, docs/api/features.md:11 and docs/api/features.md:289.
  - The Errors table (470-482) mixes compute causes into E1220 and E1215, and E1223 is about compute alone. Those rows must move or be split.
  - `render.readPass`, `render.setPassSteps`, `render.resetPass` and `render.setPassUniforms` stay in the generated reference for api/render (`@category api/render`). The new page must link to reference/render.md, or the TSDoc categories must change.
  - The PAGES summary for api/render (tools/lib/docs.ts:125) already omits compute passes. It needs a new summary, and the new page needs its own PAGES entry.
- There is a precedent for the split. Other add-on surfaces have their own API pages (api/feature-draws, api/feature-effects, api/feature-instances), and the compute pass takes a feature description like them. So a separate page is a defensible structure, not only a matter of taste. But it is optional, because the page reads in order from simple to advanced.

## Corrected claim

The compute section is the page's largest H2: about 220 lines, about 2,480 of some 6,500 words, and 7 of the page's 10 H3 sections. Because it comes after scene, reflection and full-screen passes, a minimap or mirror reader meets it only by reading on. The firm problem is that "Switching and removing passes" applies to every pass kind but sits as an H3 under "Compute passes", so readers of the other kinds will not find it.

## Corrected edit

1. Required: promote "### Switching and removing passes" (line 447) to "## Switching and removing passes", placed before "## The graph as text".
2. Optional, for page size: move lines 225-446 to a new hand-written page, such as docs/api/compute-passes.md. Then:
   - give it a PAGES entry in tools/lib/docs.ts and update the api/render summary at line 125;
   - keep a short "## Compute passes" stub on api/render with one sentence and a link, so the intro link at line 21 and the inbound `#compute-passes` anchors in docs/guides/custom-passes.md:507 and docs/api/features.md:11 and :289 still work, or point those links at the new page;
   - move the compute-only error causes (E1223, the compute parts of E1220 and E1215) to the new page's Errors table;
   - link the new page to reference/render.md for `readPass`, `setPassSteps`, `resetPass` and `setPassUniforms`.
