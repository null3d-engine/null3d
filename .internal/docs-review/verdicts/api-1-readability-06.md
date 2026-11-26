# Verdict: api-1-readability-06

## Finding as given

- page: api/geometry
- anchor: long paragraphs at lines 50, 83, 128, 155, 161, 178, 208, 228, 238, 240, 277, 279, 295, 303
- category: long-paragraph, severity: medium
- claim: 'Levels of detail' holds the three longest paragraphs in the slice: line 238 (226 words, 13 sentences), 240 (182 words) and 228 (121 words). Line 178 (morph targets) is 171 words and 12 sentences. A reader looking for when a mesh plans levels must read 121 words to find the two numbers.
- evidence: stats.json lines 43, 76, 121, 148, 154, 171, 201, 221, 231, 233, 270, 272, 288, 296.
- proposedEdit: Line 228: one sentence, then a bullet list of the two thresholds, then the job-worker sentence as its own paragraph. Line 238: keep the first three sentences and move the rest to a details block. Line 240: one sentence with a link to concepts/lod.md#pieces-of-a-large-level, and the rest in a details block. Line 178: split into weights and the demo, a 'Limits' bullet list (255 targets per vertex, 4,194,304 deltas or 32 MiB, E1206), and storage precision in a details block. Lines 277 and 279: a table Measure | Unit | Draws while | Fades, and a bullet list of the per-level rules. Split the others at the change of subject.

Verdict: partly

## Evidence

- The counts hold. stats.json numbers its lines 7 lower than the page; the 14 paragraphs map to page lines 50-303 as listed. Lines 238 (226 words, 13 sentences), 240 (182 words, 8 sentences), 228 (121 words, 5 sentences) and 178 (171 words, 12 sentences) are long and mix subjects.
- The "must read 121 words to find the two numbers" claim is wrong. Both thresholds (4,096 triangles; 256 triangles whose copies hold 65,536) are in the first sentence of line 228, within its first 50 words. The `levels` table at line 246 gives them again, with their constant names. The real cost of line 228 is that one sentence carries both thresholds plus an example; the bullet split is still a fair fix.
- Line 240 (pieces) is almost all a shorter copy of docs/concepts/lod.md "Pieces of a large level" (lod.md lines 121-129). That section already covers the sorted index copy for a single-object mesh, copies drawing their full mesh only near the camera, splitting by space for a ground, facing pieces for a 1,024+ triangle list that many copies draw, walls getting one piece per way, and hand-set levels planning facing pieces. A details block that keeps this text keeps a duplicate that can drift. One sentence and the link is enough; the rest should be cut, not hidden.
- Line 238 sentences 2-4 (instant switch under the threshold, fade once the governor passes about 1.5 pixels, a preset's own threshold never fades) repeat lod.md "Levels of meshes made in code" (line 37) and "Fading between levels" (lines 164-167). Sentence 4 ("A preset's own threshold never makes it fade") belongs with the first three, not in a block. The rest of line 238 is page-only detail not found in any concept page: vertex sharing per part above 65,535 vertices, plan time (about 0.5 s for 130,000 triangles, 6 s for a million), work spread over frames, one draw-table rebuild, and the 23 KB planner download. That part fits a details block, as proposed.
- Line 278 (now 277) fade rules also repeat lod.md "Fading between levels". The proposed table (Measure | Unit | Draws while | Fades) is a good fit; the 'Fades' column lets the measured-vs-hand-set error rules shrink to one row each.
- Line 178 limits are real: packages/engine/src/scene/mesh-arrays.ts:497 throws for a vertex moved more than 255 times or past the shared delta budget; mesh-arrays.test.ts:387 uses 4,194,304. A Limits list plus a precision block is right.
- The short flagged paragraphs (lines 50 at 56 words, 83 at 62, 128 at 52, 155 at 64, 295 at 69) are flagged by sentence count only. Each holds one subject. "Split the others at the change of subject" has little to split there; it is polish at most. Lines 161 (101 words), 208 (94) and 303 (95) do change subject and can split.

## Corrected claim

Four paragraphs in 'Levels of detail' and 'Morph targets' (lines 178, 228, 238, 240) are long and mix subjects, and lines 277 and 279 pack rules that a table and list would show better. The planning thresholds are not hidden: they open line 228 and repeat in the `levels` table. Much of lines 238, 240 and 277 repeats docs/concepts/lod.md. The short flagged paragraphs (50, 83, 128, 155, 295) are single-subject and need no change.

## Corrected edit

- Line 228: as proposed (one sentence, two-item threshold list, the job-worker and same-planner sentences as their own paragraph).
- Line 238: keep sentences 1-4 (halving and error, instant switch, governor fade, preset never fades) as the main text, with a link to [Fading between levels](../concepts/lod.md#fading-between-levels). Move the rest (index-only cost and vertex sharing by part, plan times, work spread over frames, one rebuild, 23 KB planner download) into one `<details>` block, "Technical details: cost of a plan".
- Line 240: one sentence ("The plan also sorts large lists into pieces that each copy skips when they lie outside the view or face away") with the link to [Pieces of a large level](../concepts/lod.md#pieces-of-a-large-level). Cut the rest; it duplicates that section. No details block.
- Line 178: as proposed.
- Lines 277 and 279: as proposed; the fade column replaces the measured/hand-set sentences.
- Lines 161, 208, 303: split at the change of subject. Leave lines 50, 83, 128, 155 and 295 as they are.
