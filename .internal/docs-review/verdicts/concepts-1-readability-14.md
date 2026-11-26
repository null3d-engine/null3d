# concepts-1-readability-14

## Finding as given

- page: concepts/backends, concepts/culling, concepts/instances, concepts/architecture
- anchor: backends '## How each path draws' and line 118; culling '## How each path culls'; instances '## Culling'; architecture pass item 2
- category: duplication. Severity: medium
- claim: The Apple direct-draw measurement, the WebGL2 64-row groups and cell skipping are each described three or four times, with different detail. Only culling gives the 25% and 0.15 ms thresholds, so a reader cannot tell which page is complete.
- evidence: backends.md:35, 37, 118; culling.md:36-40; instances.md:180; architecture.md:92
- proposedEdit: Make culling 'How each path culls' the full text. Backends keeps one sentence per path, a link and its draw-call and upload detail. Instances keeps only what is special to rows and links to culling. Architecture item 2 stays.

Verdict: partly

## Evidence

- The repeats are real. The direct-draw path is described at backends.md:35, backends.md:118, culling.md:38, instances.md:180 and architecture.md:92. The 64-row groups are at backends.md:37, culling.md:40, culling.md:192, culling.md:194, instances.md:180 and also static-dynamic.md:100, which the finding misses. Cell skipping is at backends.md:37, culling.md:32, 36, 40, instances.md:180 and architecture.md:92.
- The thresholds appear only at culling.md:38. They match the code: packages/engine/src/gpu/webgpu/draw-path-probe.ts:33 (a 1.25 margin, so 25% faster) and :35 (0.15 ms minimum gain).
- "A reader cannot tell which page is complete" is overstated. backends.md:35 links to culling.md#how-each-path-culls for the direct path, backends.md:37 links to culling.md for cell skipping, and culling.md:42 links back to backends for draw calls and uploads. The pages already name culling as the home of culling detail.
- Culling is not yet the complete text, so the edit needs more than cuts. "A group partly in view draws all its rows, and the GPU clips the ones outside" is at backends.md:37 and instances.md:180, but not on culling.md.
- backends.md:118 is not a "how each path draws" repeat. It sits in the capabilities section, explains the directDraws and drawPath fields, and gives the only reason on these pages for the probe: WebKit checks each indirect draw at a fixed cost. The proposed edit does not say what to do with it, and cutting it would lose that reason.

## Corrected claim

The direct-draw path, the WebGL2 64-row groups and cell skipping are repeated on backends, culling, instances, architecture and static-dynamic, with different detail on each. Cross-links already point to culling as the home. But culling lacks the partial-group clipping detail that backends and instances give, and only culling gives the probe thresholds.

## Corrected edit

Make culling "How each path culls" the full text, and add to it the sentence that a group partly in view draws whole and the GPU clips the rows outside. In backends "How each path draws", cut the 64-row group and cell-skipping sentences to one sentence that links to culling, and keep the draw-call, matrix texture and upload detail. Keep backends.md:118 in the capabilities section as the home of the directDraws and drawPath fields and of the WebKit cost reason, and have culling.md:38 link to it rather than repeat the field names. In instances "Culling", keep the row-specific parts (bounding radius, blended rows sorted one by one, the row-by-row test in a frame that marks rows) and cut the general WebGPU, WebGL2 and cell-skip sentences to one link to culling. Trim static-dynamic.md:100 the same way. Architecture item 2 stays.
