# guides-2-readability-06

## Finding as given

- page: guides/performance
- anchor: 21 long paragraphs: file lines 78, 93, 103, 131, 192, 198, 220, 224, 259, 261, 265, 288, 292, 298, 300, 304, 339, 341, 343, 353, 355 (stats.json lines are 7 less)
- category: long-paragraph
- severity: medium
- claim: stats.json lists 21 paragraphs over 4 sentences or 90 words. The worst are line 288 (163 words, 9 sentences), line 93 (147 words, 10 sentences) and line 259 (142 words, 9 sentences).
- evidence: stats.json guides/performance longParagraphs.
- proposedEdit: Line 93: keep the first four sentences, then a list 'The preset sets: pixel ratio cap; anti-aliasing mode; shadow settings; texture filtering cap, upload budget and memory budget; bloom and AO size; on WebGL2, depth prepass, occlusion culling, most morph targets'. Line 259: lead sentence plus bullets (cost per pixel; areaLights cap 4/8/16/32; fade over 8 frames; short ranges; no cost without area lights). Line 288: numbered steps (turn on softwareOcclusion; mark a few large solid objects with setOccluder(true); stop small props with setOccluder(false) or "occluder": false; compare occludedEntries with visibleEntries and job worker time on and off), triangle detail in a technical details block. Line 304: two sentences, then a list of what the card shows. Lines 339, 343, 355: technical details blocks. Others: break after the third or fourth sentence, where the rule turns into figures.

Verdict: partly

## Evidence

- stats.json has 21 long paragraphs for guides/performance. The stats lines are 71, 86, 96, 124, 185, 191, 213, 217, 252, 254, 258, 281, 285, 291, 293, 297, 332, 334, 336, 346, 348. Add 7 and you get the file lines in the anchor. The three worst are as the claim says: 281 (163 words, 9 sentences), 86 (147, 10) and 252 (142, 9). The claim holds.
- docs/guides/performance.md:288 (WebGL2 blockers) is a how-to written as prose. Numbered steps fit it. The sentence about models from `assets optimize` must stay in the main text, because it is the reason for the step that stops small props from blocking. Only the triangle count and the 2-pixel skip belong in a block.
- docs/guides/performance.md:304 lists what the stats card shows. A list fits it.
- docs/guides/performance.md:93: the proposal says "keep the first four sentences, then a list". That drops sentences 5 and 6. They say that when the page names no preset, the engine checks its choice after the first frame and lowers the preset until one holds the target. That fact changes what a reader measures, and the page says it nowhere else. It must stay.
- docs/guides/performance.md:259: the bullets leave out three facts. Each area light takes two integrals and table reads, and a light with an image adds two more reads. The cap keeps the lights that give the camera the most light. A fading light shades beside the lights that the cap keeps. These facts are correct and useful to implementers. The task rules say to move such detail into a block, not to cut it.
- docs/guides/performance.md:339: this is the only text that explains `slowMs` and `?gpu-samples=every`, and it warns that timing every frame changes the rate. If the whole paragraph goes into a block, a reader with every block closed loses an instruction they can act on. Only the last sentence (the measuring code loads before the window opens) is background detail.
- docs/guides/performance.md:343: the warning that Chrome adds shared memory to each worker's figure (1.4 MB can show as 52 MB), and the `jsHeapNote` field, explain the `memory` figure in the table. With the whole paragraph in a block, the main text gives no warning about memory figures that look too large. The timing details (when Chrome answers, the idle job workers, the one-second sample) can go into a block.
- docs/guides/performance.md:355: the first sentence (Firefox reports finished WebGPU frames about a frame late, which costs frame rate when the GPU is busy) is a browser limit that readers need. The test figures (15% fewer frames at 60% GPU load) can go into a block.
- "Others: break after the third or fourth sentence": stats lines 96 (60 words), 217 (54), 258 (63) and 291 (62) are short. Each of their sentences is well under 25 words, and each paragraph makes one point. Breaking them is a matter of taste and costs the reader nothing as they are. That leaves 78, 131, 192, 198, 220, 261, 292, 300, 341 and 353 as fair candidates.

## Corrected claim

The counts are correct. The worst three paragraphs (file lines 288, 93 and 259) and line 304 should become lists or steps. The rest of the proposal needs these corrections: line 93 keeps the two sentences about the check after the first frame; line 259 keeps its shader detail in a block and does not cut it; lines 339, 343 and 355 keep their warnings in the main text and put only the mechanics or figures in a block. The short paragraphs at file lines 103, 224, 265 and 298 need no change.

## Corrected edit

- Line 93: keep sentences 1 to 6, then "The preset sets:" with this list: the pixel ratio cap; the anti-aliasing mode; the shadow settings; the texture filtering cap, the texture upload budget and the texture memory budget; the size of bloom and of ambient occlusion; on WebGL2, the depth prepass, occlusion culling and the most morph targets per object.
- Line 259: a lead sentence, "Rectangle and tube lights join the same clusters, and cost a pixel several times what a point light costs." Then bullets: the `areaLights` cap of the preset (4 on Low, 8 on Medium, 16 on High, 32 on Ultra), which keeps the lights that give the camera the most light; a light that crosses the cap fades over 8 frames; give area lights short ranges; a pixel whose cluster holds no area light, and a scene with no area lights, pays nothing for them. Then a block, "Technical details: what an area light costs", with the two integrals, the table reads, the two extra reads for a light with an image, and how a fading light shades beside the kept lights.
- Line 288: as proposed. Keep the `assets optimize` sentence in the main text before the step for small props. Put the triangle count and the 2-pixel skip in a block, "Technical details: what a blocker costs".
- Line 304: as proposed.
- Line 339: keep the first three sentences. Put the last sentence (the measuring code loads before the window opens) in a block, or join it to the `slow` row of the table.
- Line 343: keep one or two sentences in the main text: "Chrome adds shared memory, such as the engine's own, to each worker's heap figure, so a render worker of 1.4 MB can show as 52 MB. The `jsHeapNote` field says when the figures cover only the page." Put the rest in a block, "Technical details: how Chrome measures the heap".
- Line 355: keep the first two sentences. Put the test figures in a block, "Technical details: Firefox's WebGPU frame rate".
- Lines 78, 131, 192, 198, 220, 261, 292, 300, 341, 353: break where the rule turns into benchmark figures, as proposed. Leave lines 103, 224, 265 and 298 as they are.
