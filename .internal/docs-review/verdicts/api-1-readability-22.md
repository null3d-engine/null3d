# Verdict for api-1-readability-22

## The finding as given

- Page: api/features
- Anchor: long paragraphs at lines 26, 178, 180, 233, 257, 261, 303
- Category: long-paragraph. Severity: medium.
- Claim: Line 303 (111 words, 8 sentences) lists the throw conditions in prose and repeats the Errors table. Line 178 lists the namespace rules in prose. Line 257 (108 words) explains GPU timing internals.
- Evidence: stats.json lines 19, 171, 173, 226, 250, 254, 296.
- Proposed edit: Line 178: a bullet list of the rules (name, package, reserved null3d, codes 2000-9999 with no overlap, quality keys). Line 303: one sentence that links to Errors, and turn the Errors cell into a bullet list. Line 257: keep the first sentence and put the one-in-eleven, seven-pass and 'later passes' rules, with line 261, in `<details><summary>Technical details: how the overlay times a feature</summary>`. Split lines 26, 180 and 233 at the change of subject.
- Source to edit: docs/api/features.md (hand-written page, not generated).

Verdict: partly

## Evidence

The stats.json lines are the source page's lines. The generated copy has 7 more lines at the top, so stats line 296 is generated line 303, and so on. The seven paragraphs are real, and the counts are facts.

Parts that hold:
- Line 303 (Checks) and the E1223 row of the Errors table (line 312) list almost the same conditions. The repeat is real.
- Line 178 is a list of six separate rules in prose. A bullet list reads better and loses nothing.
- Line 257 holds sampling detail (one frame in eleven, at most seven passes, the shared "later passes" figure, the figure that stays between frames). The code backs these numbers: `GPU_TIMED_PASSES` and the "later pass" slot in packages/engine/src/gpu/webgpu/gpu-timer.ts lines 50, 215-222, 251. This is dense, correct detail for implementers, and a collapsible block fits it.
- Line 26 changes subject at "Every add-on hook...". That is a fair split point.

Parts that fail:
1. The edit for line 303 goes the wrong way and would lose a fact. The Errors cell does not list every throw. It leaves out "a GPU scope pass that `render.addPass` did not return". The engine does throw for it (packages/engine/src/scene/features.ts lines 792-815, and the doc comment at line 988). If Checks shrinks to one link, readers lose that condition. Also, GFM tables do not support bullet lists in a cell. You would need raw `<ul>` or `<br>` markup in the cell, which renders badly and is hard to keep up to date. The detail belongs in the Checks section, which exists for it. The Errors table should stay short.
2. Line 261 should not go into the same block as line 257. It is about the `FeatureStats` / `FeatureHost.stats` API, not about how the overlay times a pass. It also holds a fact that a test writer needs: the sketch's copy of `gpuMs` stays null. That fact must stay visible. Line 259 (the "GPU steps" list) also sits between the two paragraphs, so one block cannot cover both without moving text around.
3. The last sentence of line 257 ("On WebGL2 the engine times the whole frame alone, so no feature has a figure there") is user-facing behavior. It must stay in the main text, not in the block. The proposal does not say where it goes.
4. Lines 180 and 233 have about 60 words each. Splitting them is polish (low), not medium. Line 233 has no clear change of subject. Its quarter-step and `min` sentences could go in a block, but splitting the paragraph adds little.

## Corrected claim

Line 303 (Checks) and the E1223 row of the Errors table repeat the same list of throw conditions. The table row is the shorter copy and leaves out the bad GPU scope pass. Line 178 lists six namespace rules in prose. Line 257 mixes a user-facing rule ("gpu not measured", no figures on WebGL2) with sampling internals. Line 26 holds two subjects. Lines 180, 233 and 261 are a little long, but each has one subject. Severity: medium for lines 303 and 257; low for the rest.

## Corrected edit

- Line 303 (Checks): keep the detail here as a bullet list. Start with "`defineFeature` returns a frozen description with the defaults filled. It throws [E1223](../errors/E1223.md) for:", then one bullet for each condition, the GPU scope pass included.
- Errors table (line 312): shorten the E1223 cell to "A description that `defineFeature` or `FeatureRegistry.add` cannot take. [Checks](#checks) lists each case." Do not put a list in the cell.
- Line 178: a bullet list of the rules (name, package, the reserved `null3d`, the 2000 to 9999 code range with no overlap, quality keys), as proposed.
- Line 257: keep the first sentence ("gpu not measured") and the WebGL2 sentence in the main text. Move the one-in-eleven, seven-pass, "later passes" and "keeps the last window's figure" sentences into `<details><summary>Technical details: how the engine samples GPU time</summary>`, placed right after that paragraph.
- Line 261: leave it in the main text, outside the block. Optionally split it after "...stays null, because the page is what reads the frame's GPU timings."
- Line 26: split before "Every add-on hook that records frame work uses this one shape."
- Lines 180 and 233: leave them, or treat any split as low-severity polish.
