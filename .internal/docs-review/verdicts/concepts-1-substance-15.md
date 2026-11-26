# concepts-1-substance-15

## Finding as given

- page: concepts/instances
- anchor: ## Culling, line 180 (238 words); ## Automatic batching, line 194 (133 words); also file lines 72, 130, 134
- category: duplication; severity: medium
- claim: Line 180 repeats the culling page's per-path rules. Line 194 lists the calls that rebuild the draw tables as a chain of sentences, which a reader cannot check one call at a time.
- evidence: culling.md:36-40 and :192-194 say the same as instances.md:180; stats.json concepts/instances.
- proposedEdit: Cut line 180 to: 'Each row has its own bounding sphere: the row's position, and the mesh's radius times the row's largest scale. setBoundingRadius(r) gives a batch's rows a radius of their own, for a vertex shader that moves rows far from their origins. Call it at setup, because it rebuilds the draw tables. [Culling](culling.md) explains how each GPU path culls rows.' Make line 194 a two-column table (rebuilds / never rebuilds) or a <details> block. Put the development check at line 130 in a block.

Verdict: partly

## Evidence

- The duplication is real. Most of instances.md:180 is also on culling.md: the WebGPU compute pass (culling.md:36), the CPU culling on devices that draw directly (:38), WebGL2 groups of 64 rows inside one grid cell (:40, :192), the skipping of cells out of view (:187-192), and a changed static batch tested row by row (:194).
- The proposed cut loses detail that no other page has:
  - Rows of a batch whose material blends are culled one by one on the job workers and sorted back to front, on both paths. A search for this in culling.md finds nothing.
  - A group of 64 rows that is partly in view draws whole, and the GPU clips the rows outside. This is not on culling.md.
  - "Without it, the engine culls rows that are still on the screen." This is the reason to call setBoundingRadius, and the cut drops it. setBoundingRadius is not on culling.md at all, so this page is the only place that explains it.
  - The WebGL2 rule about the frame where you mark rows, and the frame after it, is more exact than culling.md:194 ("until it rests again").
  The review rules say to move correct, dense detail into a block, not to cut it. So the cut as written is wrong.
- Line 194: a table helps, and it is better than a block. The closing advice ("create batches in the setup, and pool rows during play") is the point for every reader, so it must stay in the main text. A block alone would hide it. The table also needs a note on the exception: a batch's setCastShadows and setReceiveShadows do not rebuild when the value stays the same.
- The finding does not cover every long paragraph on the page. Stats list six. Line 184 (stats line 177: 151 words, 10 sentences, the rules for how groups split) is missing. Lines 72 and 134 are named in the anchor, but the finding proposes nothing for them. The rule is one finding for all the long paragraphs of a page.
- Line 130: a block for the development check fits. Keep the E1108 and E1110 sentences and the sentence about dynamic batches in the main text.

## Corrected claim

Line 180 repeats culling.md's rules for each GPU path. But it also holds facts found on no other page: how rows that blend are culled and sorted, that a group partly in view draws whole, why setBoundingRadius is needed, and the exact WebGL2 frames for marked rows. Cutting the paragraph as proposed loses those facts. Line 194 reads better as a table. Line 184 is also long and is not in the finding.

## Corrected edit

- Line 180, main text: "Each row has its own bounding sphere. Its center is the row's position, and its radius is the mesh's radius times the row's largest scale. `setBoundingRadius(r)` gives one batch's rows a radius of their own. Use it for a vertex shader that moves rows far from their origins, as traffic along a lane does. Without it, the engine culls rows that are still on the screen. The call rebuilds the engine's draw tables, so make it at setup. Each view culls row by row, and [Culling](culling.md#how-each-path-culls) explains how each GPU path does it."
  Then a block:
  <details>
  <summary>Technical details: how rows cull on each path</summary>

  - The rows of a batch whose material blends cull one by one on the job workers, on every path, and sort back to front.
  - On WebGL2, a group of 64 rows that is partly in view draws whole, and the GPU clips the rows outside.
  - On WebGL2, the frame where you mark a static batch's rows tests that batch row by row, with no cell skipped. So does the frame after it.

  </details>
- Line 194: one sentence that says some calls rebuild the draw tables and that the next frame costs more than usual. Then a two-column table (rebuilds the tables / never rebuilds them), and a note on the exception for a batch's shadow setters. Keep "So create batches in the setup, and pool rows during play" as main text after the table.
- Line 184: keep the first four sentences (grouping by mesh and material, 500 crates) as main text. Move the split rules (setBounds, never culled, receive shadows, WebGL2 dynamic and static at rest, blended) into a bulleted list or a block.
- Line 130: keep the E1108 sentence, "A row that changed without a mark raises E1110", "Release builds leave it out", and the sentence about dynamic batches in the main text. Move how the check samples rows (up to 4,096 rows a frame, the next rows each frame, bounded cost, sprite and point batches) into a block.
- Lines 72 and 134: line 134 reads better as numbered steps (createChunkRows, reserve, write, pack, destroy). Line 72 is under 90 words and can stay as it is.
