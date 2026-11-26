# guides-2-readability-05

## Finding as given

- Page: guides/performance
- Anchor: ## Objects during play, table lines 133-152 and bullet line 164
- Category: unclear. Severity: medium.
- Claim: Line 164 says a rebuilds count above zero "points to one of the calls in the lower rows of the table". The rows are not sorted that way: rows that cost nothing or only weights sit among the rebuild rows, and a rebuild row is last. A reader who checks the lower rows gets the wrong set.
- Evidence: line 148 setMorphWeight costs "The object's weights"; line 151 render.setPassEnabled ... "Nothing"; lines 142-147 and 152 are rebuilds.
- Proposed edit: split into three tables (calls that upload only what they change; calls that rebuild the draw tables; calls that add passes), and change line 164 to "points to one of the calls in the rebuild table".

Verdict: partly

## Evidence

- docs/guides/performance.md:135-141: the top seven rows cost changed matrices, draw entries, a material row, or nothing. None is a rebuild.
- docs/guides/performance.md:142-147: six rows that cost "A rebuild".
- docs/guides/performance.md:148: setMorphWeight costs "The object's weights". Not a rebuild.
- docs/guides/performance.md:149-150: post.set bloom/AO, addEffect, render.addPass cost "New passes". Not a rebuild of the draw tables.
- docs/guides/performance.md:151: setPassEnabled, setEffectUniform, setBackground, setEnvironment cost "Nothing".
- docs/guides/performance.md:152: texture.update at a new size and texture.destroy cost "A rebuild".
- packages/engine/src/sketch/runner.ts:2398 counts a rebuild only when the core reports that the draw tables were rebuilt. packages/engine/src/page/frame-stats.ts:201-206 says the count covers structure changes (objects, meshes, materials, batches). So pass changes (rows 149-150) do not raise the count; they show in the pipelines count instead.

So the core claim holds: line 164 is imprecise, because four of the lower rows (148-151) do not raise the count, and the rebuild rows are not one block.

What does not hold: "the reader gets the wrong set" is overstated. Every rebuild row is in the lower half of the table, so a reader who reads "the lower rows" sees all the right calls plus four extra. The cost column says "A rebuild" on each right row, so the reader can filter. The cost is a small detour, not a wrong answer. Severity is low, not medium.

The proposed three-table split is heavier than the problem needs. It also leaves out one detail: "post.set with outline turned on or off" (line 147) is a rebuild, and the proposal names only "post.set bloom/AO" under passes. A single table with the rows reordered keeps the page shorter and fixes the pointer.

## Corrected claim

Line 164 sends the reader to "the lower rows of the table", but the rebuild rows are not grouped: rows 148-151 (morph weights, new passes, and calls that cost nothing) sit between rebuild rows 142-147 and rebuild row 152. A reader sees all the rebuild calls there, plus four rows that do not raise the count. Severity: low.

## Corrected edit

Keep one table. Move the texture.update/texture.destroy row (line 152) up to sit after line 147, so every "A rebuild" row forms one block. Then change line 164 to: "Check with `measure`. A `rebuilds` count above zero during play points to one of the calls whose cost is a rebuild in the table. New passes show in `pipelines`, not in `rebuilds`."
