# guides-2-substance-14

## Finding as given

- page: guides/performance
- anchor: file lines 78, 93, 103, 125, 131, 163, 192, 198, 220, 224, 259, 261, 265, 288, 292, 298, 300, 339, 341, 343, 353, 355-357, 370-372, 401-405
- category: technical-details-block
- severity: medium
- claim: Long paragraphs mix the advice with benchmark figures and implementation detail. Examples: line 125 (inlining and boxing, 'a fraction that it does not inline becomes an object'); 163 (row limits per GPU path, E1501, E1109); 198 (upload routes, staging buffers); 259 (area light integrals, caps, 8-frame fade); 351 ('Eleven is a prime above the longest far cascade interval'); 355-357 (completion signals per browser).
- evidence: stats.json guides/performance longParagraphs (body lines 71, 86, 96, 124, 185, 191, 213, 217, 252, 254, 258, 281, 285, 291, 293, 297, 332, 334, 336, 346, 348; file lines are 7 higher).
- proposedEdit: Keep one or two sentences of advice in each place and move the rest into blocks: after line 125 "Technical details: why setters allocate nothing"; after 163 "Technical details: row limits on each GPU path"; after 198 "Technical details: how uploads travel"; after 259 "Technical details: how area lights shade"; after 353 "Technical details: completion signals in each browser"; lines 370-372 and 401-405 "Technical details: browser flags and core counts".

Verdict: partly

## Evidence

The core claim holds. The page does mix advice with internal detail, and several of the proposed blocks are right:

- Line 198 opens with "The render worker picks how each upload travels, so you do not need to." Nothing after it asks the reader to act. A block fits well.
- Line 351 ("Eleven is a prime above the longest far cascade interval...") is pure internal reasoning in a bullet about the GPU time figure.
- Line 259: "two integrals over the light's outline" and "reads their tables" are internal. Lines 355 and 357 (Firefox reports a frame late, the WebGL2 fence, Safari waiting at frame end) help a reader read the figures, but line 353 stands alone without them.
- Line 163: the exact row counts (2,097,152 and 1,048,576) are detail. The advice is "size each batch for the rows it uses" and "read `engine.capabilities.maxInstances`".

These parts do not hold:

1. The anchor list does not match stats.json. Lines 125 and 163 are list bullets, not long paragraphs from stats.json. Stats body line 297 is file line 304 (the stats overlay paragraph), and the anchor leaves it out. Line 351, which the claim cites, is not in the anchor.
2. Lines 370-372 are bullets in "Measure fairly" (file lines 360-373), and they are actions. Start Chrome with the named flags to get exact GPU times. Know that Safari runs worker frames from a timer. Know that uncapped Chrome reports a meaningless `refreshHz`. A reader who measures needs these, so they belong in the main text. Putting a block in the middle of that list would also break the list.
3. Lines 370-372 and 401-405 sit in different sections, with "Memory peak" between them. One block "browser flags and core counts" cannot hold both.
4. Lines 401-405 are most of "Browsers differ". Line 401 ends with a colon that leads into the bullets. A block is possible there only if line 401 is rewritten so that it reads as a complete thought with the block closed.
5. "Keep one or two sentences of advice in each place" would cut advice at line 259. "Give area lights short ranges", "A pixel whose cluster holds no area light pays nothing" and the `areaLights` cap per preset are things a reader acts on or tunes. Only the integral and table sentences, and maybe the fade detail, should move.
6. At line 125, the advice "call them from a small function of their own" and "use `setUniform` and `setPose` per frame" must stay in the bullet. Only the inlining and boxing reasons can move. The block must go after the list ends (after line 125, before line 127), not inside the bullet.
7. The finding lists 16 other long paragraphs (78, 93, 103, 131, 192, 220, 224, 261, 265, 288, 292, 298, 300, 304, 339, 341, 343) but proposes nothing for them. Some are mostly benchmark figures and suit a block: 78, 192, 220, 261, 298 and 300. Others are advice that only needs splitting: 93, 288, 292 and 339. Lines 103 (60 words) and 224 (54 words) are only one sentence over the limit, and they read clearly. Changing them is a matter of taste.

## Corrected claim

The page mixes advice with internal detail and benchmark figures. Internal detail belongs in collapsible blocks at these places: line 198 (upload routes), line 351 (why one frame in eleven), the integral and table sentences of line 259, lines 355-357 (per-browser completion signals), the exact row counts at line 163, and the inlining and boxing reasons at line 125. The benchmark-figure paragraphs (78, 192, 220, 261, 298, 300) can also go into blocks, each placed after the advice it supports. The advice paragraphs 93, 288, 292, 304 and 339 should be split, not hidden. The "Measure fairly" bullets at lines 370-372 are actions and stay in the main text.

## Corrected edit

- After the list that ends at line 125: block "Technical details: why setters allocate nothing" with the inlining and boxing sentences. The bullet keeps "call them from a small function of their own" and the `setUniform` and `setPose` advice.
- After the list that ends at line 164: block "Technical details: row limits on each GPU path" with the exact counts and the object-table detail. The bullet keeps `engine.capabilities.maxInstances`, E1501, E1109 and "size each batch for the rows it uses".
- Line 198: keep "The render worker picks how each upload travels, so you do not need to." Move the routes and browser timings into "Technical details: how uploads travel".
- Line 259: keep the cost relative to point lights, the `areaLights` caps, short ranges and "pays nothing". Move the integrals, tables and fade into "Technical details: how area lights shade".
- Line 351: end the bullet after "one frame in eleven". Move the cost and the reason for the prime into a block after the list at line 351, or into the block below.
- After line 353: block "Technical details: completion signals in each browser" holding lines 355 and 357.
- Lines 401-405: rewrite line 401 so that it is complete on its own, for example "The engine starts one job worker for each logical core that the browser reports, less 2, and at least 1, and browsers report different counts on the same device." Then put the three bullets in "Technical details: core counts in each browser".
- Leave lines 370-372 in the main list.
- Split 93, 288, 292, 304 and 339 into shorter paragraphs. Move the benchmark figures of 78, 192, 220, 261, 298 and 300 into blocks after the advice they support.
