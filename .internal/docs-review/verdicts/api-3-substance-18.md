# Verdict on api-3-substance-18

## The finding as given

- id: api-3-substance-18 (slice api-3, role substance)
- page: api/wind
- anchor: ## Reading the field in your own WGSL, lines 83-270 (the wind-steady and wind-sample blocks)
- category: technical-details-block
- severity: medium
- claim: About 190 lines of WGSL that the reader must copy sit in the main flow and bury the section. Line 81 already points to shaders/field.wgsl in the package. The blocks are correct and useful, so they belong in collapsible blocks, not cut.
- evidence: docs/api/wind.md:81-270; stats.json api/wind 4060 words.
- proposedEdit: Keep line 81 and one sentence on what each block holds. Wrap each block in `<details><summary>Technical details: the steady field block (wind-steady)</summary> ... </details>`, and the same for wind-sample. Keep the material and vertex offset examples (274-320) in the main text.
- generatedSource: (none; the page is written by hand)

Verdict: survives

## Evidence

- docs/api/wind.md:79-81. The section opens with a three-sentence lead. Line 81 says "Copy both from `shaders/field.wgsl` in the package, or from the blocks below." So the main text already names a source for the code outside the page.
- docs/api/wind.md:83-224 is the first fence (the noise import, the texture declaration, and the steady-field block between its start and end markers). Lines 226-270 are the second fence (the sampling block). That is 188 lines of code before the prose resumes at line 272. The finding's "about 190 lines" is right.
- packages/wind/package.json `files` includes `shaders`, so `shaders/field.wgsl` ships in the published package. The pointer at line 81 is real.
- docs/api/wind.md:272 (inside the box, outside the box), 274-288 (the material call), 290-294 (the four vectors and the layer), 296-320 (the vertex offset, with "The two sampling blocks go here."). All of this reads correctly with both blocks closed. It names the two blocks and the functions it calls, and line 81 says where the code lives.
- packages/wind/src/grid.test.ts:7-14 and 150-151. A test reads the page and slices the text between the `// <wind-steady>` and `// </wind-sample>` comment markers. It does not care what surrounds the code fence. So wrapping a fence in a collapsible block keeps the test passing, as long as the markers and the code between them do not change.
- No tool in tools/ or tools/lib/ rejects `<details>`, and no docs page uses one yet. So the edit breaks no check. The proposed summary text follows the "Technical details: ..." form in the task brief. Nothing in the block is a heading, and the blocks are not nested.

I tried three ways to refute it. (1) The code must be copied, so hiding it hurts the reader. This fails: line 81 already sends the reader to the package file, and a closed block is one click away. (2) Wrapping would break the sync test. This fails, because the test finds the markers anywhere in the file. (3) This is only a matter of taste. This fails: 188 lines of code split the explanation from the material and vertex offset examples that a newcomer needs.

## Notes on the edit

- Put the whole of each fence inside its block, the `#import null3d::noise::{value3}` line and the `var wind` declaration in the first one included. Do not change a byte between the markers. The sync test at packages/wind/src/grid.test.ts:150-151 compares that text with packages/wind/shaders/field.wgsl.
- Leave a blank line after `</summary>` and before `</details>`, so GitHub Flavored Markdown renders the code fence inside the block.
- Line 81 needs a small change, from "or from the blocks below" to "or from the two blocks below", so a reader knows the code is inside the closed blocks. Line 328 ("Tests hold the readers' blocks equal to this page's.") stays true.
