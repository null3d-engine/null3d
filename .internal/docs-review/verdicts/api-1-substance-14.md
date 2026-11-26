# api-1-substance-14

## Finding as given

- Page: api/geometry
- Anchor: ## Levels of detail, lines 228, 238, 240
- Category: technical-details-block
- Severity: medium
- Claim: Three paragraphs of 121, 226 and 182 words mix what a user does with planner internals: timings, 65,535-vertex parts, piece sorting, facing pieces. A newcomer cannot find the rule. Line 240 mostly repeats concepts/lod.md.
- Evidence: docs/api/geometry.md:228, 238, 240; stats.json api/geometry long paragraphs.
- Proposed edit: Keep three sentences: when a mesh plans levels, that the plan runs off the frame, and that the full shape draws until levels arrive. Move the rest into <details><summary>Technical details: how the planner builds and splits levels</summary> ... </details>. Replace line 240 with one sentence and a link to ../concepts/lod.md#pieces-of-a-large-level.
- Generated source: none (hand-written page)

Verdict: partly

## Evidence

- docs/api/geometry.md is hand-written (not under docs/api/reference/), so no generated source is needed. Correct.
- Line 228 mixes the trigger rule (4,096 triangles, or 256 with 65,536 drawn together), the job workers, the asset tool's `--lod` planner, and the full-shape-until-ready rule. It ends with the lead-in "Then every object and instance batch that draws it picks its level:" for the code block at 230-236.
- Line 238 holds user-facing switching rules (error, `lodThreshold`, governor fade) and implementer detail: vertex sharing per 65,535-vertex part, plan timings (half a second for 130,000 triangles, six seconds for a million), one part read and one level made per frame, one draw-table rebuild, planner size of about 23 KB after Brotli. The timings, per-frame spread and planner size appear nowhere in concepts/lod.md (grep found them only at geometry.md:238), so they must move into the block, not be cut. The proposal does move them.
- Line 240 restates concepts/lod.md:129 (the "Pieces of a large level" section, heading at lod.md:121): pieces for levels of 32,768 triangles or more, own pieces for a mesh that one object draws over a sorted index copy, copies of a large mesh keep only level pieces, a ground splits by space, hand-set levels still plan facing pieces. "Mostly repeats" holds. The anchor `#pieces-of-a-large-level` exists. Two small facts on line 240 are not in lod.md in the same words: the sorted copy "arrives in the frame after the last level", and pieces "draw only once the scene's copies of the mesh hold 65,536 triangles together" (lod.md gives this only as "until they pay").
- Overstated part: "A newcomer cannot find the rule." The table at geometry.md:244-250 states the planning rule plainly, with the constants `geometry.automaticLevelTriangles` and `geometry.automaticDrawnTriangles`, and line 246 repeats the thresholds from line 228. The reader can find the rule; the cost is that they must read about 530 words of internals before the table that states it.
- The proposed block follows the contract: no headings inside, not nested, and the main text still reads with the block closed, if the code lead-in stays outside.

## Corrected claim

Three paragraphs of 121, 226 and 182 words put planner internals (timings, per-part vertex sharing, per-frame spreading, planner size, piece sorting) ahead of the `levels` table that states the rule, so a reader must get through them to reach it. Line 240 mostly repeats concepts/lod.md "Pieces of a large level".

## Corrected edit

- Line 228: keep when a mesh plans (or point to the table below, since line 246 gives the same thresholds), that the plan runs on the job workers and never in a frame, that the full shape draws until the levels arrive, and the lead-in sentence to the code block.
- Line 238: keep one sentence in the main text: each level about halves the triangles and switches in where its error covers less than the `lodThreshold` setting's pixels, with a link to ../concepts/lod.md#fading-between-levels. Move the rest into `<details><summary>Technical details: how the planner builds and splits levels</summary>`: the governor fade rule, shared vertices and parts, plan timings, per-frame spreading, the single draw-table rebuild and the planner download size. These facts exist only on this page.
- Line 240: replace with one sentence and a link to ../concepts/lod.md#pieces-of-a-large-level. Put the two facts that lod.md lacks (the sorted index copy arrives the frame after the last level; facing pieces draw only once the scene's copies hold 65,536 triangles together) in the same block, or add them to lod.md.
