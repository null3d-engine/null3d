# concepts-2-readability-11

## Finding as given

- Page: concepts/post-processing
- Anchor: effect step lists (76-81, 122-127, 170-175, 223-229, 272-277, 321-323, 344-346); long paragraphs 39, 101, 155, 263, 299, 305, 307, 358, 392
- Category: technical-details-block. Severity: medium.
- Claim: Each effect section opens with a numbered list of how the GPU builds it (13-tap downsample, Karis average, spiral gather, horizon slices, Hi-Z march). The post.set call and the settings come only after that. Nine more paragraphs pass 90 words or 4 sentences. Line 392 packs the whole still-camera life cycle into 104 words.
- Evidence: stats.json longParagraphs lines 32, 94, 148, 256, 292, 298, 300, 351, 385. Line 79 'with the weights of Call of Duty: Advanced Warfare's bloom ... a Karis average'.
- Proposed edit: Use the same shape in every effect section: 1-2 sentences on the look, the code example, the settings table, the user bullets, then `<details><summary>Technical details: how bloom draws</summary>` with the numbered steps (one per effect). Split 155 into a passes sentence and a cost list. Split 263 so the three.js comparison stands alone. Make 392 a list: what happens while still, when it rests, what restarts it.

Verdict: partly

## Evidence

The core point holds. Bloom (file lines 78-81), depth of field (124-127), ambient occlusion (225-229), screen-space reflections (274-277), bounce light (321-323) and outlines (344-346) each put a numbered list of GPU steps before the code or the settings. The quote on line 79 is exact. The steps are dense, correct implementer detail. A collapsed block fits them well and fits the owner's request.

What does not hold:

1. "Each effect section" is wrong for automatic exposure. Its code sample (line 167) and the link to its settings (line 170) come before the four meter steps (172-175). That section already has the shape that the finding proposes.
2. The bloom section has no code sample at all. The page's only bloom `post.set` call is in the page's opening sample (line 47). The proposed shape ("the code example" in every section) needs a new sample for bloom, or a pointer to line 47.
3. Only bloom, ambient occlusion and screen-space reflections have a settings table. Depth of field (line 134), automatic exposure (170) and outlines (348) link to the post-processing API page for their settings. "The settings table" in every section must read "the settings table or the link to the API page". Do not copy those tables into this page.
4. The paragraph count is wrong. stats.json lists ten long paragraphs, not nine. The finding leaves out stats line 30 (file line 37): 226 words and 12 sentences, the longest on the page. The rule says all long paragraphs of a page go in one finding, so line 37 belongs here.
5. Line numbers: stats.json lines are 7 lower than file lines. The finding's file lines (39, 101, ...) match its stats lines (32, 94, ...). Line 39 has only 63 words; it is flagged for its 5 sentences.
6. Each step list hangs off a lead sentence that ends in a colon ("blur apart:" line 122, "as Bevy, Filament and Unity draw bloom:" line 76, "in four steps" line 272, "The meter works in four steps:" line 170, "at half the render size" line 319). Moving the list needs a new lead sentence, or the main text reads as cut off with every block closed.
7. A few steps carry facts that a user needs, not only an implementer. These must stay in the main text when the steps move into a block:
   - Line 225 (step 1 of ambient occlusion): turning ambient occlusion on also turns on the depth prepass. The Cost section (263, 266) repeats this, so it is safe.
   - Line 78: a NaN pixel turns black, so one bad pixel cannot spread. This can move.
   - Line 124: sharp detail does not bleed into the blur. Line 136 repeats this as a user bullet, so it is safe.
   - Line 345: `color` against `hiddenColor`. The API page (docs/api/post.md line 290) covers it, so it is safe.
   - Line 175: how `speedUp`, `speedDown`, `minEv` and `maxEv` act. The API page (lines 96-102) covers them, so it is safe.
   In short, the move loses no user-facing fact. But the edit should tell the writer to check each step against the bullets and the API page.

The split proposals for 155, 263 and 392 are sound. Line 263 mixes the pass list, the test setup, two timings and the three.js comparison in 82 words. Line 392 holds the jitter, the blend count, the rest and the restart in 104 words.

## Corrected claim

Six of the seven effect sections with a GPU step list (bloom, depth of field, ambient occlusion, screen-space reflections, bounce light, outlines) put that list before the code or the settings. Automatic exposure already shows its code first. Ten paragraphs pass 90 words or 4 sentences, at file lines 37, 39, 101, 155, 263, 299, 305, 307, 358 and 392. Line 37 is the worst at 226 words and 12 sentences. Line 392 packs the still-camera life cycle into 104 words.

## Corrected edit

In each of bloom, depth of field, ambient occlusion, screen-space reflections, bounce light and outlines: one or two sentences on the look, a lead sentence that does not end in a colon, the code sample, then the settings table or the API link. Bloom needs its own short sample, or a pointer to the sample at the top of the page. Then the user bullets. Then one `<details><summary>Technical details: how <effect> draws</summary>` block that holds the numbered steps. Use no heading inside it. Before you move a step, check that the bullets or the API page state its user-facing fact. Automatic exposure keeps its order; only its four meter steps move into a block. Break up line 37: put the order of passes in one paragraph, and the work of the final pass in a short list or a block. Split 155 into a sentence on the passes and a list of the timings. Split 263 so the three.js comparison stands alone. Make 392 a list: what happens while the view is still, when it rests, and what restarts it.
