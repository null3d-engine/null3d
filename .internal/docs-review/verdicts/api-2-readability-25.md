# Verdict for api-2-readability-25

## The finding as given

- page: api/particles
- anchor: lines 23, 143, 145, 177, 181, 193
- category: technical-details-block
- severity: low
- claim: Lines 143-145 explain how the shader samples the wind field and how to drive a buffer by hand. Line 193 explains how birth times shift every 1,024 seconds. The detail is correct but breaks up the how-to.
- evidence: stats.json api/particles longParagraphs (stats lines 16, 136, 138, 170, 174, 186).
- proposedEdit: Under Wind, keep 'the field replaces wind' and 'call the wind's update() first'. Put 143-145 in `<details><summary>Technical details: how a particle reads the wind field</summary>`. Put 193 in `<details><summary>Technical details: birth times and the sub-emitter table</summary>`. Split 177 into what softness does and what it costs.

Verdict: partly

## Evidence

- The page is hand-written (docs/api/particles.md; tools/lib/docs.ts:138 only lists it in PAGES). An empty generatedSource is correct.
- The page says what the finding claims. Line 143 tells how the shader samples the field. Line 145 tells how to call `buffer.setWind(field, time.now)` by hand. Line 193 tells how birth times move every 1,024 seconds and how the sub-emitter event table grows.
- The detail is correct. packages/particles/src/system.ts:11-12 moves the time base every 1,024 seconds and rewrites a share at a time. packages/particles/src/system.ts:250 calls `buffer.setWind(windField, clock.now)` each frame. packages/engine/src/scene/particles.ts:1066-1070 documents `setWind` and its `time` argument.
- The main text already holds what the edit wants to keep. Line 121 says to give `windField` and call the wind's `update()` before the system's. The Motion table (line 114) says `windField` replaces `wind`. So the main text reads well with the blocks closed.
- Weak point 1. The linked page "The particle buffer" (docs/concepts/particle-buffer.md:171-173) has a "The wind field" section. It already covers `setWind(field, time)`, the camera-following box, the one read for each particle, the field replacing `wind`, and the gust and swirl time. Line 190 of that page covers the 1,024-second time base. So most of line 145, and the sampling half of line 143, repeat a linked page. A short link serves this better than a details block that copies the text.
- Weak point 2. Line 143 holds one fact that a user sees: a particle does not ride a gust along its path, because the field pushes it where it is. That fact explains how the smoke looks, so it belongs in the main text, not in a closed block.
- Weak point 3. The anchor names lines 23 and 181, but the edit proposes nothing for them. Stats confirm both are long (line 23: 87 words, 6 sentences; line 181: 62 words, 5 sentences). The finding must cover all long paragraphs of the page in one finding, so it is incomplete. Line 23 is the core idea of the page (closed-form motion, one CPU call). It should be split, not hidden. Line 181 can split after "by its bounds".
- The split of line 177 is right. Its first two sentences say what softness does. The rest says what it costs (one full-screen depth copy for each frame, only for the camera's view, off on the Low preset).

## Corrected claim

Lines 23, 143, 145, 177, 181 and 193 are long. Lines 143-145 repeat the wind-field detail that the linked particle buffer page already gives, apart from one fact users see (particles do not ride gusts). Line 193 is internal timing and memory detail that suits a closed block. Lines 23, 177 and 181 need a split, not a block.

## Corrected edit

- Line 23: split after "No pass simulates the particles." Keep both parts in the main text.
- Lines 143-145: keep in the main text: "A particle takes the field's displacement over its age. It cannot ride a gust along its path, because it keeps no speed of its own. A system without a field costs no texture read." Replace the rest of 143 and all of 145 with one sentence: "To drive a particle buffer yourself, see [The wind field](../concepts/particle-buffer.md#the-wind-field)." If a block is still wanted, use one only for the per-frame reason (the field's box follows the camera, so the system hands the field over in every frame), with the summary "Technical details: why the field is given in every frame".
- Line 177: split into what `softness` does (first two sentences) and what it costs (the depth copy, other views, the Low preset).
- Line 181: split after "by its bounds", so the second paragraph covers birth order and blending choice.
- Line 193: put it in `<details><summary>Technical details: birth times and the sub-emitter table</summary>` as proposed. Keep in the main text one sentence: "A system that runs for hours adds no long frame."
