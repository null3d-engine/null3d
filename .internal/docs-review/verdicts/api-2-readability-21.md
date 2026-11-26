# Verdict: api-2-readability-21

## The finding as given

- page: api/post
- anchor: long paragraphs at lines 41, 54, 332, 394
- category: long-paragraph
- severity: medium
- claim: Line 41 (115 words) mixes when to use ev100, typical values and the formula. Line 54 explains how the engine applies the exposure inside. Line 332 is hard-wrapped. Line 394 mixes GPU paths, costs and the multisample resolve.
- evidence: stats.json api/post longParagraphs (stats lines 34, 47, 325, 387).
- proposedEdit: 41: keep the meaning of ev100, add a small table of typical EV100 values (sunny 15, overcast 12, lit room 7), and move the formula to a details block. 54: put it in `<details><summary>Technical details: where the engine applies the exposure</summary>`, and keep the 'unlit colors draw black at EV100 15' warning in the main text. 332: unwrap and split. 394 and 396: put them in a details block under Vignette.
- generatedSource: "" (correct: docs/api/post.md is a hand-written page)

Verdict: partly

## Evidence

- Page lines are the stats lines plus the 7-line front matter. The four paragraphs are real and long (stats: 115 words / 8 sentences, 92 / 7, 77 / 6, 86 / 5).
- Line 41 does mix the use case, the typical values, the formula and the off switch. The formula is already on the lighting concepts page (docs/concepts/lighting.md:92 and the diagram at :83). The typical values already sit in one short sentence. A three-row table for three numbers is taste with little gain.
- Line 54 is engine detail (where the exposure is multiplied in, the 16-bit float limit). A details block fits. Its last two sentences (background and unlit colors draw black at EV100 15 unless they use real units) are a real trap for users, so they must stay in the main text. The finding says this.
- Line 332 (page lines 332-336) is hard-wrapped. Markdown joins the lines, so readers see one paragraph; the wrap has no cost on the website. The real issue is repeats: "The frame that lands a bake uploads the table, 256 KB" is at page line 335-336 and again in the bullet at line 371. Line 371 also repeats that the bake runs in a worker and stalls no frame. docs/concepts/post-processing.md:369 says it a third time.
- Line 394 is under the Vignette heading, but three of its five sentences are about grading tables ("Each table costs the final pass...", the multisample resolve). The proposal keeps them under Vignette, which keeps them in the wrong section. Its first sentence repeats the grading bullet at line 370 ("The final pass draws on every GPU path..."). The sentence "A plain background color then draws as a background, so the vignette darkens it too" is a visible effect and belongs in the main text. docs/concepts/post-processing.md:366 links to api/post.md#vignette for the "every GPU path" fact, so that fact must stay under Vignette in some form (a details block keeps the anchor working).
- Line 396 (dithering) is short (3 sentences, not in stats). docs/concepts/post-processing.md:383-388 already explains dithering in full, so a one-line link is simpler than a details block.

## Corrected claim

Lines 41, 54 and 394 are long and mix user facts with engine detail. Line 332 is hard-wrapped, but that does not hurt readers. Its real problem is that it repeats the worker and 256 KB facts from the bullet at line 371. Line 394 sits under Vignette but is mostly about grading tables.

## Corrected edit

- 41: Split into two paragraphs. The first says when to use `ev100`, with the typical values (15 sunny, 12 overcast, 7 lit room) and "each step up is one stop darker". The second says that `exposure` then works as exposure compensation and `ev100: false` turns the camera off. Replace the formula sentence with a link to [Lighting and environment](../concepts/lighting.md), or put it in a short details block. A table is optional.
- 54: Keep in the main text: "Background and unlit colors take the exposure too. At EV100 15 they draw black unless their own values are in real units." Move the rest into `<details><summary>Technical details: where the engine applies the exposure</summary>`.
- 332: Unwrap. Keep the first three sentences (what the controls do, where the pass applies them, a change stalls no frame). Cut "The frame that lands a bake uploads the table, 256 KB." here, because the bullet at line 371 says it.
- 394: Split by topic. Under Vignette, keep in the main text: "Without HDR color, the vignette still draws: the scene's shaders darken their light before their tone mapping, and a plain background color darkens too." Move the two table-cost sentences (few operations and one texture read per table; the extra final pass on a device that resolves its multisampled picture into the canvas) into a details block under Grading controls, next to the bullet at line 370, and drop the first sentence's repeat of that bullet.
- 396: Keep one sentence ("The final pass dithers last, so smooth gradients show no bands.") and link to the dithering part of docs/concepts/post-processing.md, or leave it as it is. It is short and needs no block.
