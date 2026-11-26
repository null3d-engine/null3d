# concepts-2-substance-19

## Finding as given

- page: concepts/render-graph
- anchor: Long paragraphs at lines 33, 37, 68, 70, 74, 76 (211 words), 78 (175 words), 80, 93, 114, 142, 144, 158, 162
- category: long-paragraph
- severity: medium
- claim: Line 76 mixes what a view is, culling on each path, scene passes, createView, image row order, the copy pass and a WGSL helper name (reflection_uv). Line 78 mixes full-screen passes, compute passes, order rules and vertex offsets.
- evidence: stats.json concepts/render-graph longParagraphs.
- proposedEdit: Give line 76 a heading "Views" and split it in two. Move the row order, the copy pass and reflection_uv into `<details><summary>Technical details: image rows on WebGPU and WebGL2</summary>`. Split line 78 into "Full-screen passes" and "Compute passes", with the vertex offset rule in a details block.

Verdict: partly

## Evidence

- stats.json lists 14 long paragraphs for this page. Its line numbers count from after the front matter, so they are 7 lower than the page lines (stats 69 = page 76, stats 71 = page 78). The finding's page lines are right: 76 has 211 words in 12 sentences, 78 has 175 words in 9 sentences.
- Page line 76 does mix the topics the claim names: what a view is, culling on WebGPU and WebGL2, scene passes, `scene.createView`, row order, the copy pass and `reflection_uv`. Page line 78 does mix full-screen passes, compute passes, order rules and the vertex offset rule. The claim holds.
- The row order, the copy pass, `reflection_uv` and the vertex offset rule are all already in the Render graph API page, which line 35 links: docs/api/render.md:59 (v = 0 at the bottom row, `reflection_uv` exception), :137 (`reflection_uv`), :218 (pass texture row order), :339 (a vertex offset orders the pass before shadow, motion and pick passes), :465 (WebGPU copy turns the image upright, WebGL2 draws upright, full-screen passes write upright on both paths). docs/guides/custom-passes.md:79 and :113 say the same for effects. A details block that repeats them adds a second copy to keep in sync. A one-sentence summary with a link is the leaner fix; a details block is acceptable only if it is short and links to the API page.
- The anchor names 14 paragraphs, but the proposed edit covers only 2 of them. The other 12 (page lines 33, 37, 68, 70, 74, 80, 93, 114, 142, 144, 158, 162) get no proposal. Page line 74 (112 words, occlusion culling order rule), 80 (131 words, final pass and 8-bit path) and 142 (153 words, target sizes and render scale) are also long and dense.
- A "Views" heading placed at line 76 would put line 78 (sketch full-screen and compute passes) and line 80 (the final pass and the 8-bit path) under a heading that does not fit them, unless more headings follow. "Full-screen passes" and "Compute passes" as headings for one paragraph each would make very short sections; as paragraph splits they are fine.

## Corrected claim

Lines 76 and 78 each mix several topics, as claimed. The row order, the copy pass, `reflection_uv` and the vertex offset rule are already explained in docs/api/render.md (lines 59, 137, 218, 339, 465), so they need a link, not a second full copy. The edit covers only 2 of the 14 long paragraphs the anchor names.

## Corrected edit

- Add `## Views and a sketch's passes` before page line 76, and `## The final pass and the resolve pass` before page line 80, so each following paragraph sits under a heading that fits it.
- Split line 76 into two paragraphs: (a) what a view is and how each path culls it; (b) the order of the camera's view, a sketch's scene passes and `scene.createView` views. Replace the row-order sentences with one sentence: "On WebGPU a copy pass turns each scene pass's image upright for materials; [Render graph API](../api/render.md) gives the rules for reading pass textures." If the dense detail stays, put it in `<details><summary>Technical details: image rows on WebGPU and WebGL2</summary>` (the row order, the copy pass, the HDR reflection exception and `reflection_uv`) and end the block with that same link.
- Split line 78 into two paragraphs, full-screen passes then compute passes (paragraphs, not headings). Put the vertex offset sentence in a details block or replace it with a link to docs/api/render.md#compute-passes.
- Also break the other long paragraphs the anchor names, at least page lines 74 (move the "so far" ordering rule into a details block), 80 (split the HDR path from the 8-bit path) and 142 (split target sizes from the render-scale exception for kept targets).
