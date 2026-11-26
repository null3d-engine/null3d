# concepts-1-readability-07

## Finding as given

- Page: concepts/backends
- Anchor: lines 21, 35, 37, 60, 78, 80, 82, 84, 96, 98, 118, 120, 140, 144, 158, 168, 176, 190
- Category: long-paragraph. Severity: medium.
- Claim: Eighteen long paragraphs. The worst are 37 (198 words, WebGL2 draw path), 190 (170, Safari minimum and user-agent parsing), 168 (162, test switches), 176 (161, device loss) and 21 (121).
- Evidence: stats.json concepts/backends longParagraphs
- Proposed edit: 21: keep 4 sentences, and make the drawing-thread rule and the crash fallback a two-item list. 37: keep one sentence, and move data textures, the three rotating textures, the 4-byte list, visibleEntries, the 64-row groups and WEBGL_multi_draw into a block 'Technical details: how WebGL2 draws a frame'. 176: make it a list (what is rebuilt; texture copies and keepTextureCopies; no copy; E1302). 190: keep 3 sentences (Safari before 18 unsupported, E1306, the check covers every iOS browser), and move the Safari 17 faults and the AppleWebKit/600 parsing into a block 'Technical details: why Safari 18 and how the check reads the browser'. 140+144: a 3-row table 'Path | Most objects and rows | Limit from', with the texel arithmetic in a block. Split 96, 98 and 158. For 168 see the switch-table finding, and for 78-84 and 120 the HDR duplication finding.

Verdict: partly

## Evidence

- The counts hold. stats.json lists 18 long paragraphs for concepts/backends. Its line numbers are body lines; with the 7 front-matter lines added they map to page lines 21, 35, 37, 60, 78, 80, 82, 84, 96, 98, 118, 120, 140, 144, 158, 168, 176, 190. The word counts quoted (198, 170, 162, 161, 121) match.
- 21, 176, 96, 98, 158: the proposed list or split is sound. Each paragraph mixes separate points (tier choice, drawing thread, crash fallback; loss, texture copies, E1302).
- 190: the split is sound. The Safari 17 faults and the user-agent parsing are dense implementer detail, so a block fits. The proposal does not say where the Vite plugin sentence goes ("A page that the null3D Vite plugin builds still starts the core's download..."). It belongs in the block too, as it is not needed to understand the rule.
- 140, 142, 144: a table is a fair change. The portable budget table above (line 138) already gives 2,097,152, so the new table must not repeat that row in a different form. E1501 and the `maxInstances` field must stay in the main text, not in the block.
- 37 is where the edit goes wrong:
  - The sentence "On both paths, a scene spread over several grid cells skips the still objects of the cells out of view first" is not about WebGL2. A block titled "how WebGL2 draws a frame" is the wrong home for it.
  - The 4-byte list, the 64-row groups and the cell skipping are culling detail. docs/concepts/culling.md:40 already gives them ("list the visible objects, 4 bytes each", "groups of 64 nearby rows", "skip the objects and groups of the cells out of view"). culling.md:42 says backends is the page for "each path's draw calls and uploads". Moving the culling detail into a block keeps the duplicate that the cross-page finding concepts-1 #14 asks to remove. Cut it and link to Culling.
  - What is left for backends is draw and upload detail: the matrix data texture and its partial updates, the three rotating textures for dynamic batches, list uploads only on change with `visibleEntries`, and multi-draw. The Firefox sentence (no `WEBGL_multi_draw`, so one call per group) tells a reader why Firefox makes more draw calls. Keep it in the main text, not only in the block.
- 35, 60 and 118 are in the anchor but the edit proposes nothing for them. 35 and 118 are covered by finding #14 (culling duplication), and 60 partly by finding #30. The edit should name these, so no long paragraph is left without an owner.

## Corrected claim

Eighteen long paragraphs, as stated. The proposed edits hold for 21, 96, 98, 140 to 144, 158, 176 and 190, with two fixes. At 190, the Vite plugin sentence also goes into the block. At 140 to 144, E1501 and `maxInstances` stay in the main text. The edit for 37 is wrong in part: it puts culling detail and a sentence that covers both paths into a WebGL2 drawing block. That detail is already on the Culling page.

## Corrected edit

- 37: keep two sentences in the main text. First: "On WebGL2 there are no compute shaders, so the job workers cull on the CPU ([Culling](culling.md#how-each-path-culls))." Second: where the browser has `WEBGL_multi_draw`, one call draws each group of the same shading, maps and mesh buffer, and Firefox lacks it, so there each group takes one call. Cut the 4-byte list, the 64-row groups and the cell skipping, because Culling has them. Move the rest into "Technical details: how WebGL2 uploads a frame". That is the matrix data texture with its partial updates, the three rotating textures for dynamic batches, and the list upload only on change with `visibleEntries`.
- 190: as proposed, and the Vite plugin sentence also goes into the block.
- 140 to 144: as proposed, but E1501, `engine.capabilities.maxInstances` and the development-build warnings stay in the main text. Only the texel arithmetic (3 texels a matrix, 512 a row, the 8,388,608 list cap) goes into the block. Do not repeat the portable budget table's row.
- 35, 118: see finding #14. 60: see finding #30. 168: see finding #12. 78 to 84 and 120: see the HDR duplication finding.
- 21, 96, 98, 158, 176: as proposed.
