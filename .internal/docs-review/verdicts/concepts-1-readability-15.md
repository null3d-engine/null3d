# concepts-1-readability-15

## Finding as given

- page: concepts/lighting
- anchor: lines 240, 271, 406-412, 570
- category: duplication
- severity: medium
- claim: The sky environment's 20-step refresh, its half-degree threshold and its frame counts appear four times, worded differently ('20 stages', '20 short steps', 'about 20 frames').
- evidence: lighting.md:240, 271, 409-411, 570
- proposedEdit: Keep the full list once under 'Sky and backgrounds'. Keep 'the light follows a moving sun about 320 ms later at 60 frames per second' in the main text, and wrap the steps (409-411) in a block 'Technical details: how the sky's map refreshes'. At 240, 271 and 570, use one sentence and a link to #sky-and-backgrounds.

Verdict: partly

## Evidence

- Line 240 (Environment maps) does not repeat the numbers. It says only "when the sun moves, the map refreshes over the next frames", and it already links to #sky-and-backgrounds. That part of the edit is already done.
- Line 570 (Time of day) is a half-sentence: "the sky's environment takes about 20 frames to follow anyway". It is a short reason for the advice in that bullet, not a restatement. The one real flaw: it says "about 20 frames" while line 410 says 19 frames. Low cost.
- The real overlap is between line 271 (Cost bullet) and lines 409-410 (Sky and backgrounds). Both say the map refreshes in 20 stages or steps, one a frame, and both say the scene draws with the old map until the last one. The code agrees: `stages: 20` in packages/engine/src/scene/builtin-environments.ts:48.
- Line 271 is not a pure copy. It holds facts that are found nowhere else on the page: the first map takes about 14 ms, each stage takes about 1 ms of GPU time, a color that drifts by less than 2% does not trigger a refresh, and slowly drifting clouds wait and add up. Lines 409-410 give only the sun's half-degree threshold. If line 271 shrinks to "one sentence and a link", as the edit proposes, the cost numbers disappear from the Cost section, which is where a reader looks for them, and the 2% and cloud rules disappear from the page.
- Line 410 starts with "So", which refers to the step list in line 409. If line 409 goes into a block and line 410 stays outside, line 410 must be reworded so that it makes sense with the block closed.

## Corrected claim

The 20-step refresh and the "old map until the last step" rule appear twice, at line 271 (Cost) and line 409 (Sky and backgrounds), worded differently ("20 stages" and "20 short steps"). Line 240 already gives only a summary and a link. Line 570 is a short reference whose frame count ("about 20") does not match line 410 ("19 frames").

## Corrected edit

- Line 240: leave as it is.
- Sky and backgrounds, main text: one bullet in place of lines 409-410. For example: "After a change of the sky, the map refreshes over 20 frames, and the scene uses the old map until then. The light follows a sun that turned half a degree about 320 ms later at 60 frames per second. Smaller changes wait: a sun that turns less than half a degree, a color that drifts by less than 2%, and slowly drifting clouds. A change during a refresh can take up to 39 frames." This moves the 2% and cloud rules here from line 271.
- Wrap the step breakdown (six faces, thirteen filter steps, the final copy, the diffuse light changing in the same frame as the reflections), the software-GPU step time (line 411) and the CPU diffuse time (line 412) in one block: `<details><summary>Technical details: how the sky's map refreshes</summary> ... </details>`, as whole list items, with no heading inside.
- Line 271 (Cost): keep the cost facts and drop the repeated mechanism. For example: "The sky's environment loads the same code and shaders as the room. Its first map takes about 14 ms of GPU time on a MacBook Pro, in the next frame. A refresh after a change spreads over 20 frames at about 1 ms each, so no frame waits for a whole map. [Sky and backgrounds](#sky-and-backgrounds) says when the map refreshes."
- Line 570: change "about 20 frames" to "about 19 frames" (or "a third of a second"), so it matches line 410. A link is optional.
- Severity: low, not medium. The two copies agree on the facts and sit in sections with different purposes (cost and behavior). The overlap costs the reader a few sentences, not understanding.
