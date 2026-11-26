# Verdict: concepts-1-readability-20

## Finding as given

- page: concepts/culling
- anchor: lines 32, 36, 38, 40, 105, 159, 181
- category: long-paragraph, severity: medium
- claim: Seven long paragraphs. The opening (32, 120 words) packs the frustum test, camera-relative positions, cells and the kinds of view. Line 159 puts a benchmark inside the reason for a default.
- proposedEdit: 32: keep 3 sentences and make the kinds of view a list. 36: split after '...tests the sphere.' 38: keep 2 sentences and the directDraws and drawPath fields, and move the 25% and 0.15 ms thresholds into a block. 40: split after '...4 bytes each.' 105: split 'default sphere' from 'shader moves vertices outside it'. 159: keep 'Every preset leaves it off; in the S6 city benchmark on WebGL2 phones it cost at least 3.5 times what it saved', and move the per-device figures into a block 'Technical details: the S6 measurements'. 181 goes with the grid-cell merge.

Verdict: partly

## Evidence

- stats.json lists seven long paragraphs for concepts/culling at body lines 25, 29, 31, 33, 98, 152, 174. With the 7 lines of front matter these are page lines 32, 36, 38, 40, 105, 159, 181. The anchors are right.
- Line 32 does pack the frustum test, camera-relative positions, cells and a run-on list of five kinds of view. The camera-relative and cell sentences repeat the diagram above and the "Grid cells" and "Skipping cells out of view" sections, so a shorter opening loses nothing. A list for the kinds of view is right.
- Line 36 and line 40 splits fall at real topic changes. Good.
- Line 38: the 25% and 0.15 ms thresholds are real (packages/engine/src/gpu/webgpu/draw-path-probe.ts:35 sets the minimum gain at 0.15 ms). They are implementer detail, so a block fits.
- Line 105: splitting the default sphere from the shader problem is a real topic break. Good.
- Line 159: AGENTS.md "Writing docs" says "Name the engine's benchmarks when you cite a figure", so keeping "S6" is correct.

## What does not hold

1. Line 159, the kept sentence is wrong. It says "on WebGL2 phones", but the page says the test ran on three Android phones and an iPad. Write "on three Android phones and an iPad, all on WebGL2".
2. Line 159, the reason must stay in the main text. "Most hidden entries were rows of instance batches whose other rows still showed, so the batch still drew" is not a per-device figure. It is the reason the feature lost. Line 161 ("A scene whose few large blockers hide many separate meshes, each its own draw call, can gain where the city lost") only makes sense after it. With that sentence in a closed block, the main text breaks the rule that it must read well with every block closed.
3. Line 181 has no edit. "Goes with the grid-cell merge" points to another finding. On its own this finding gives no fix for line 181. A fix: split after "...uploads one vector per cell." so the first part says where the matrices are stored and the second says how the GPU makes them camera-relative.
4. Line 32, "keep 3 sentences" does not say which three. Keep: what culling does, what occlusion culling adds, and that each view culls separately, then the list of views.

## Corrected claim

Seven long paragraphs, and six of the proposed splits or blocks are right. Line 159 must keep the reason (instance rows whose batch still drew) in the main text, and its kept sentence must name the real devices. Line 181 needs its own edit.

## Corrected edit

- 32: keep "Culling finds...", "Occlusion culling also skips..." and "The engine culls each view separately...". Make the kinds of view a list. Drop the camera-relative and cell sentences: the diagram and the "Grid cells" sections cover them.
- 36: split after "...tests the sphere."
- 38: keep the sentence on when the job workers cull instead, the `directDraws` and `drawPath` sentence and the guide link. Move the 25% and 0.15 ms thresholds and the bucket detail into "Technical details: how the device picks a path".
- 40: split after "...4 bytes each."
- 105: split after "...its rotation turns it."
- 159: main text: "Every quality preset leaves software occlusion culling off. In S6, the engine's benchmark city, on three Android phones and an iPad, all on WebGL2, it cost at least 3.5 times what it saved. Most hidden entries were rows of instance batches whose other rows still showed, so the batch still drew." Block "Technical details: the S6 measurements": the 23% to 39% hidden, under 3% of draw calls removed, 7 to 22 ms more on the job workers, 2.3 ms saved at most on the render worker.
- 181: split after "...uploads one vector per cell."
