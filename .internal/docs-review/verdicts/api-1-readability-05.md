# api-1-readability-05

## Finding as given

- page: api/animation
- anchor: long paragraphs at lines 50, 56, 97, 101, 120, 126, 176, 183, 203, 227, 232, 242, 268, 321, 358, 406, 420, 422, 424, 428, 442, 455
- category: long-paragraph
- severity: medium
- claim: Twenty-four paragraphs pass 4 sentences or 90 words. The worst are line 442 (162 words, 11 sentences), 455 (154 words), 420 (151 words), 422 (144 words), 183 (121 words), 358 (117 words) and 176 (112 words).
- evidence: stats.json lines 43, 49, 90, 94, 113, 119, 169, 176, 196, 220, 225, 235, 261, 314, 351, 399, 413, 415, 417, 421, 435, 448. Stats lines are file lines minus 7.
- proposedEdit: Line 97: split after '...weight too.' and make the replay rule its own paragraph. Line 242: make the three blend rules (at a point, between points, past the ends) a bullet list. Line 268: start a new paragraph at '`play` or `crossFade` on the layer ends the blend.' Line 406: split after '...room to spare.' Line 455: split into what a target is and the two calls; a 'What a target can move' bullet list with the COLOR_0 rules; and where targets come from. Line 442: keep the first four sentences and move the rest to a details block. Lines 183, 358, 420, 422 and 424: see the details-block finding. Split the rest at the sentence where the subject changes.

Verdict: partly

## Evidence

- stats.json lists 24 long paragraphs for api/animation, so "twenty-four" is right, and the word and sentence counts quoted for the worst paragraphs match. But the anchor and evidence list only 22. They leave out stats lines 456 and 458, which are file lines 463 (88 words, 6 sentences: clips that animate morph weights) and 465 (99 words, 7 sentences: how each backend morphs, the WebGL2 weight cap per quality tier, shader download size, `preload`). Line 465 is a strong candidate for a details block, the same as lines 420 and 422.
- Line 406 (docs/api/animation.md:406): the proposed split after "...room to spare." breaks the next sentence away from what it refers to. "So does a three-clip blend..." only makes sense right after "...fit with room to spare." The natural split is before "When all eight are busy", where the subject changes from what fits to what gets replaced.
- Lines 97, 242, 268 and 455: the proposed splits and lists are sound. Line 97 changes subject at "A clip that already plays on its layer...". Line 242 holds three parallel rules. Line 268 changes subject at "`play` or `crossFade` on the layer ends the blend." Line 455 mixes four topics.
- Line 442: the first four sentences describe behavior that every user of `setUpdateInterval` needs. The rest is about cost at interval 1 and which meshes skip unchanged poses, which is implementer detail. So a details block is right. The fifth sentence ("A scene that never calls `setUpdateInterval`...") repeats line 428 ("The value 1, the default, updates it in every frame"), so it can be cut instead of moved.
- Lines 50, 56, 101, 120, 126 and 321 pass the threshold only by sentence count: 59 to 70 words in 5 short sentences, each about one subject. For example, line 56 covers one call (`debug.skeleton`), and line 120 covers one call (`stop`). With no change of subject, "split where the subject changes" gives no split, and forcing one is a matter of taste. These six add little to the medium severity, which rests on the 112 to 162 word paragraphs (176, 183, 358, 420, 422, 442, 455).

## Corrected claim

The page has 24 long paragraphs, but the finding's anchor lists only 22. It leaves out lines 463 and 465 (the morph-weight clip rules and the per-backend morph detail). The paragraphs that really hurt reading are lines 176, 183, 358, 420, 422, 442, 455 and 465. Lines 50, 56, 101, 120, 126 and 321 pass the limit only on sentence count, and each covers one subject.

## Corrected edit

Keep the edits for lines 97, 242, 268 and 455. Line 406: split before "When all eight are busy", not after "...room to spare.". Line 442: keep the first four sentences, cut the fifth (line 428 already says it), and move the rest into a `<details>` block with the summary "Technical details: what a held pose saves". Line 465: keep the first two sentences (which pass morphs on each backend) in the main text. Move the WebGL2 weight cap per quality tier, the shader download size and the `preload` note into a `<details>` block. Leave lines 50, 56, 101, 120, 126 and 321 as they are, unless a reviewer finds a real change of subject inside one of them.
