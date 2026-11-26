# concepts-1-readability-22

## Finding as given

- Page: concepts/instances
- Anchor: ## Rows that arrive in chunks, lines 132-142
- Category: structure. Severity: medium.
- Claim: An add-on author API (Gaussian splats) sits between "Static and dynamic batches" and "Pools", the sections most users read next. It is a call sequence written as one 147-word paragraph, and its source is hard-wrapped, unlike every other paragraph.
- Evidence: instances.md:134-142; stats.json concepts/instances long paragraph at stats line 127.
- Proposed edit: Move the section to just before Related pages. Make it numbered steps: 1. batch.createChunkRows(); 2. writer.reserve(count); 3. writer.write(slot, chunk) per chunk; 4. writer.pack(counts) in each frame that the chosen rows change; 5. writer.destroy(). Add one sentence on the batches that take no chunked rows. Join the hard-wrapped lines.

Verdict: partly

## Evidence

- The placement holds. The headings run Create a batch (26), The row arrays (60), Static and dynamic batches (109), Rows that arrive in chunks (132), Pools (144), Culling (178), Automatic batching (182), Limits (196), Per-row colors (206), Per-row values (231), Related pages (276). A section for add-on authors cuts in between two sections that every batch user reads.
- The paragraph is a call sequence: 147 words and 12 sentences (stats.json, stats line 127, which is page line 134 after the front matter). Numbered steps suit it.
- The source of lines 134-142 is hard-wrapped. Every other paragraph on the page is one line. But Markdown, GitHub included, joins wrapped lines into one paragraph, so a reader sees no difference. Joining the lines is source cleanup, not a reader problem.
- "Add one sentence on the batches that take no chunked rows" asks for something the page already has. Lines 140-142 say: "The batch must own its rows' transforms: a part of a model, or a sprite or line batch, takes no chunked rows." The edit must keep this sentence, not add a second one.
- The steps leave out that the writer arrives in a promise. `createChunkRows` is `async` and returns `Promise<ChunkRowWriter>` (packages/engine/src/scene/scene.ts:2925). The only caller awaits it (packages/splats/src/system.ts:265). The page says only "The writer's code loads on first use". Step 1 must say `await`, or a reader calls `reserve` on a promise.
- `reserve(slots)` can be called again when the cloud gets more chunks (packages/engine/src/scene/chunk-rows.ts:103-107). `pack` returns the count that the batch draws (chunk-rows.ts:170-176). Both facts can go in the steps.
- docs/api/scene.md:583 links to `../concepts/instances.md#rows-that-arrive-in-chunks`. Moving the section and keeping its heading keeps that link working.

## Corrected claim

The section is in the wrong place: an add-on author API sits between the static and dynamic section and the pools section, which every batch user reads. It is also a call sequence written as one 147-word paragraph. The hard wrap in its source does not change what a reader sees, so it is a cleanup nit only. The page already says which batches take no chunked rows.

## Corrected edit

Move the section, with its heading unchanged, to just after "Per-row values" and before "Related pages". Join the wrapped lines. Rewrite it as follows:

    ## Rows that arrive in chunks

    An add-on can give the engine rows that arrive in pieces, such as the chunks of a Gaussian splat cloud. A chunk row writer stores each chunk in the engine's memory once. In each frame it then packs the rows that you choose into the batch, in the engine's core, so the sketch copies no rows and runs no loop over them.

    1. `const writer = await batch.createChunkRows()` makes the writer. Its code loads on first use.
    2. `writer.reserve(count)` makes room for `count` chunks. Call it again when the cloud gets more chunks.
    3. `writer.write(slot, chunk)` stores one chunk when it arrives. Do not call it in a frame.
    4. `writer.pack(counts)`, in each frame where the chosen rows change, takes one count for each slot. It writes the first `counts[slot]` rows of each chunk into the batch, in slot order, sets the batch's active count and returns that count.
    5. `writer.destroy()` frees the chunks.

    The batch must own its rows' transforms. A part of a model, or a sprite or line batch, takes no chunked rows.
