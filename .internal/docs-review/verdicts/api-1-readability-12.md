# api-1-readability-12

## Finding as given

- page: api/geometry
- anchor: ## Levels of detail (lines 238, 240); ## Morph targets (line 178); ## Large meshes (line 303)
- category: technical-details-block
- severity: medium
- claim: The planner's timings, its per-frame spreading, how parts share vertices, the 23 KB download and the piece rules are implementer detail. They hide the two facts a user acts on: levels arrive a few frames late, and levels: false turns them off.
- evidence: geometry.md:238 from 'The levels name the mesh's own vertices' to the end. :240 entire. :178 from 'The engine stores, for each vertex' to the end.
- proposedEdit: Add <details> blocks: 'Technical details: how the planner works' (line 238 tail), 'Technical details: pieces of a large mesh' (line 240) and 'Technical details: how morph targets are stored' (line 178 tail). Under 'Large meshes', keep 'For the fewest draw calls, keep meshes under 65,535 vertices' and put the WebGL2 primitive-restart reason and the shared-vertex copies in a details block.

Verdict: partly

## Evidence

- Long paragraphs (stats.json, which counts lines 7 lower than the current page): page line 178 has 171 words and 12 sentences, line 238 has 226 words and 13 sentences, line 240 has 182 words and 8 sentences, line 303 has 95 words and 8 sentences. The readability cost is real.
- The claim that these paragraphs "hide" the two facts is wrong. Neither fact lives in them. "The mesh draws its full shape until the levels arrive, a few frames later" is at geometry.md:228. `levels: false` is in the table at :247 and in the list at :203. A reader finds both without reading 238 or 240.
- Line 240 repeats docs/concepts/lod.md:129 ("A mesh made in code gets pieces with its planned levels ...") almost sentence for sentence: the sorted copy of the indices for a mesh that one object draws, copies that keep only their levels' pieces, splitting by space for a ground, facing pieces for building walls, hand-set levels planning facing pieces. Line 240 already links that section. A details block would keep two copies of the same rules to maintain. Cut it to a summary and the link.
- Line 238 mixes two kinds of text. Its first four sentences (each level halves the triangles, measured error, switch at once, fade once the governor raises the threshold) say when a level shows on screen. That is user-facing and must stay in the main text. "A level costs its indices alone" (memory cost) and "the frames go on meanwhile" (no stall) are also user-facing. The rest (parts sharing vertices, plan timings, one part and one level per frame, one rebuild, the 23 KB planner) fits a block. No other page gives the timings or the 23 KB size, so a block is right here, not a cut.
- Line 178: the limits (255 targets per vertex, 4,194,304 deltas, 32 MiB) and "Past those limits, fromArrays throws E1206" appear nowhere else. docs/errors/E1206.md lists other causes but not the morph limits. So the numbers must stay on this page. A block is fine for them, but a reader who gets E1206 must see from the main text that a limit exists.
- Line 303: the proposal is sound. The 16-bit index and primitive-restart reason and the shared-vertex copies are implementer detail. The two "part by part" sentences from line 238 say the same thing about parts and belong in the same block.

## Corrected claim

Lines 178, 238, 240 and 303 mix user-facing rules with implementer detail, which makes them hard to read (171, 226, 182 and 95 words). They do not hide the two key facts: the delay is at line 228 and `levels: false` at lines 203 and 247. Line 240 also repeats concepts/lod.md:129, which it links.

## Corrected edit

- Line 238: keep the first four sentences, then "A level costs only its indices. The plan runs on the job workers, and the frames go on meanwhile." Put the rest (from "The mesh keeps its vertices and triangles in their order" to "downloads with the first mesh that plans") in `<details><summary>Technical details: how the planner works</summary>`. Move the two sentences about parts sharing vertices into the Large meshes block.
- Line 240: no block. Replace it with "The plan also sorts large levels into pieces, so each copy skips the pieces that lie outside the view or face away from the camera. [Pieces of a large level](../concepts/lod.md#pieces-of-a-large-level) gives the rules." Check that any sentence missing from lod.md:121-129 moves there first.
- Line 178: keep the sentences up to the demo link. Add "The targets of a mesh have size limits. Past them, `fromArrays` throws [E1206](../errors/E1206.md)." Put the storage, the limits and the float precision in `<details><summary>Technical details: how morph targets are stored</summary>`.
- Line 303: keep "A mesh can have any number of vertices. A mesh of more than 65,535 vertices splits into parts that draw one after another. For the fewest draw calls, keep meshes under 65,535 vertices." and the cluster-tree exception. Put the 16-bit index and WebGL2 reason, the shared-vertex copies and the part-sharing sentences from line 238 in `<details><summary>Technical details: why large meshes split</summary>`.
