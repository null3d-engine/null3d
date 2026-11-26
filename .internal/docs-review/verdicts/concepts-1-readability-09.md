# concepts-1-readability-09

## Finding as given

```json
{
 "page": "concepts/instances",
 "anchor": "lines 72, 130, 134, 180, 184, 194",
 "category": "long-paragraph",
 "severity": "medium",
 "claim": "Six long paragraphs. Line 180 ('## Culling') is 238 words and 17 sentences: bounding radius, WebGPU, direct draws, blended rows, WebGL2 groups, cells and marked frames in one block.",
 "evidence": "stats.json concepts/instances longParagraphs",
 "proposedEdit": "180: keep 3 sentences (each row culls with its position and mesh radius times largest scale; setBoundingRadius for vertex shaders that move rows; call it at setup because it rebuilds draw tables), and move the per-path detail into a block 'Technical details: how each GPU path culls rows' as bullets. 72: split 'arrays are views that can empty' from 'read them from the batch each frame'. 130: keep 'E1108 past capacity; development builds raise E1110 for writes without a mark', and move the 4,096-rows sampling into a block. For 134 see the chunk-rows finding, and for 184 and 194 the rebuild-table finding.",
 "generatedSource": "",
 "id": "concepts-1-readability-09",
 "slice": "concepts-1",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- stats.json concepts/instances longParagraphs lists six paragraphs at stats lines 65, 123, 127, 173, 177, 187. These are file lines 72, 130, 134, 180, 184, 194 (front matter adds 7). Line 180 is 238 words and 17 sentences. The count claim holds.
- The page is hand-written (docs/concepts/instances.md), so no generated source is needed.
- instances.md:180 does mix the row sphere, `setBoundingRadius`, WebGPU compute culling, direct-draw CPU culling, blended rows, WebGL2 groups of 64, grid-cell skipping and the marked-frame rule. A block for the per-path detail is right.
- Source check: `setBoundingRadius` (packages/engine/src/scene/scene.ts:2947-2958) calls `setBatchBounds`, consistent with "rebuilds the draw tables, so call it at setup". The sampling size is `ROWS_PER_CHECK = 4096` in packages/engine/src/scene/unmarked-writes.ts:201, so the 4,096 figure is correct and belongs in a block, not cut.
- The cross-references hold: findings/concepts-1-readability.md rank 22 covers line 134 (chunk rows) and rank 21 covers lines 184 and 194 (rebuild table).

## What does not hold

1. Line 180: the three kept sentences drop "Without it, the engine culls rows that are still on the screen." That sentence is the visible symptom that tells a reader when they need `setBoundingRadius`. It must stay in the main text. The link to [Culling](culling.md) also sits only inside the detail now; it must stay in the main text so a closed block still points to the full rules.
2. Line 180: the same per-path culling detail is already the full text on concepts/culling ("How each path culls"), as rank 14 of the same review notes. Copying all of it as bullets into a block here keeps the duplication. The block should hold only what is special to instance rows (blended rows culled one by one and sorted; WebGL2 groups of 64 rows per grid cell; the marked frame and the frame after it tested row by row) and link to Culling for the rest.
3. Line 130: the kept text names only E1108 and E1110. It drops four short, user-facing facts that are not sampling detail: sprite and point batches get the same check; release builds leave it out; a dynamic batch needs no marks; and the link to [Static and dynamic objects](static-dynamic.md). Only the "note the marked rows, compare up to 4,096 rows a frame, the next frame takes the next rows" mechanism should move into the block.
4. Line 72 split is fine as proposed.

## Corrected claim

The six long paragraphs are real, and blocks are right for lines 130 and 180. But the proposed main text for 180 cuts the symptom sentence and the Culling link, and the proposed main text for 130 cuts user-facing facts that are not technical detail.

## Corrected edit

180 main text:

> Each row has its own bounding sphere: its center is the row's position, and its radius is the mesh's radius times the row's largest scale. A vertex shader that moves rows far from their origins, as traffic along a lane does, needs `setBoundingRadius(r)`. Without it, the engine culls rows that are still on the screen. The call rebuilds the engine's draw tables, so make it at setup. [Culling](culling.md) explains how each GPU path culls.

Then a block `<summary>Technical details: how rows are culled</summary>` with bullets for the row-specific points only: culling is per row in each view; on WebGPU a compute pass culls, and on direct-draw devices the job workers cull; rows of a blended material are culled one by one on the CPU and sorted back to front on both paths; on WebGL2 a static batch at rest is tested in groups of 64 nearby rows inside one grid cell, and a partly visible group draws whole; static rows in grid cells out of view are skipped; on WebGL2 a frame that marks a static batch, and the frame after it, test that batch row by row with no cell skipped.

130 main text:

> A mark past the batch's capacity throws [E1108](../errors/E1108.md). Development builds also find rows that changed without a mark and raise [E1110](../errors/E1110.md), which names the row. Sprite and point batches get the same check, and release builds leave it out. A dynamic batch needs no marks, because it recomputes every row in use in every frame. [Static and dynamic objects](static-dynamic.md) compares what each kind uploads.

Then a block `<summary>Technical details: how the unmarked-write check works</summary>`: before each batch update the check notes the marked rows, then compares up to 4,096 drawn rows a frame, over all static batches, with the values it read before; the next frame takes the next rows, so a write is found within a few frames at a bounded cost per frame.

72: split as proposed. 134, 184, 194: as in ranks 22 and 21.
