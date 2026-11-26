# guides-1-readability-05

## The finding as given

- Page: guides/custom-passes
- Anchor: `# Custom passes and render targets`
- Category: split-page. Severity: medium.
- Claim: 5,698 words and 25 headings cover custom effects, tone curves, scene passes, reflections with a long water recipe, full-screen passes and compute passes. Effects and tone curves work on the camera's image; the rest are render-graph passes into textures. A reader who wants a tint effect gets the whole render graph.
- Evidence: stats.json guides/custom-passes: words 5698, 25 headings, 2 Mermaid diagrams, one per half.
- Proposed edit: Split into guides/custom-effects ('Custom effects and tone curves': lines 13-252, first diagram, error rows E1213, E1215, E1216, E1203, E1101) and guides/custom-passes ('Render passes and render targets': lines 254-577, second diagram, rows E1220, E1502, E1503, E1504). Each links to the other in its first paragraph.

Verdict: partly

## Evidence

What holds:
- The page is long (5,698 words; 25 headings). The page median is about 1,240 words. It is not the longest guide (performance has 8,423 words, assets-pipeline has 8,386), but it does join two jobs. Lines 27-252 are about post effects and tone curves (`post.*`). Lines 254-563 are about render-graph passes (`render.addPass`). Each half has its own Mermaid diagram (lines 13 and 258). A split is a fair fix.

What is wrong or missing:
1. The two halves are not independent. A full-screen pass "runs an effect's WGSL" (line 427). It uses the `EffectInput` fields and the `effect*` functions that only the effects half defines (lines 53-83). The `effectInputSize` and `effectPassUv` rows already point at full-screen passes (lines 78-79). The effects "Textures" section reads pass textures through `textures.fromPass` (line 97). The soft outline glow (lines 468-503) is a full-screen pass plus an effect. So the passes page must link back to "What an effect reads" for the WGSL contract. One link in the first paragraph is not enough.
2. The error split is wrong. `render.addPass` also throws E1215 and E1216 for full-screen and compute passes (packages/engine/src/scene/render.ts:525-526, 1226-1245, 1400-1407). The page's own E1101 row names `render.removePass` (line 573). So E1215, E1216 and E1101 belong on both pages.
3. The first "Cost" bullet (line 215) gives the memory and GPU time of any full-screen pass. api/render.md:466 links `custom-passes.md#cost` for full-screen passes. After the split, that link would point at a page with no Cost section.
4. The proposed edit lists no follow-up work, and a split needs it:
   - A new entry in PAGES in tools/lib/docs.ts (docs/pages.md is generated from it, line 153). Also new front matter, and a new summary for the page that keeps the old id.
   - The intro paragraph at line 18 talks about both halves. It must be rewritten for each page.
   - Incoming links whose targets move to the new page: guides/custom-shaders.md (#custom-effects), shaders/surface-functions.md (#example-under-the-water), guides/performance.md:279 (#cost), concepts/post-processing.md (#cost, plus lines 200 and 414, which say "custom effects and tone curves"), api/post.md (two links), porting/threejs-postprocessing.md. api/render.md:488 lists "custom effects" among this page's topics.
   - Skills under skills/ that link the page must be checked, because the docs and skills stay in sync.

## Corrected claim

The page joins two topics: post effects and tone curves (`post.*`), and render-graph passes into textures (`render.addPass`). A reader who wants a simple tint effect must scroll past a large part of the render graph. But full-screen passes and the outline glow depend on the effect WGSL contract. Some error codes and the cost figures apply to both halves.

## Corrected edit

Split as proposed: guides/custom-effects ("Custom effects and tone curves", lines 27-252, first diagram) and guides/custom-passes ("Render passes and render targets", lines 254-563, second diagram). Also make these changes:
- Error rows. Effects page: E1213, E1215, E1216, E1203, E1101. Passes page: E1215, E1216, E1101, E1220, E1502, E1503, E1504.
- In "Full-screen passes", the first paragraph links to custom-effects.md#what-an-effect-reads for `EffectInput` and the `effect*` functions. "A soft outline glow" stays on the passes page and links to the effects page for `post.addEffect`.
- Keep the first Cost bullet (the cost of a full-screen pass) on the passes page too, under "Full-screen passes". Or point api/render.md:466 at the new page's #cost.
- Rewrite the line-18 intro for each page. Add the new page to PAGES in tools/lib/docs.ts and change the old entry's summary. Change the incoming links listed above, and the skills that link the page.
