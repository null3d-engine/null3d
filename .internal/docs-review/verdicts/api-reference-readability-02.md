# api-reference-readability-02

## Finding as given

- Page: all 18 api/reference pages (scene, engine, assets, materials, debug, geometry, quality, lights, objects, post, render, textures, animation, cameras, sketch, terrain, ui, particles)
- Anchor: member tables, e.g. geometry line 492 `buildLevels`, render line 173 `addPass`, engine line 212 `preload`
- Category: structure. Severity: high.
- Claim: Every member, however long, sits in one table cell. A cell cannot hold paragraphs, lists, code or a details block, so the longest and most important member docs are the hardest to read, and on a phone they scroll sideways.
- Evidence: 119 of 2,704 member rows are over 90 words. buildLevels is 462 words in one cell; addPass 302; preload 287; Debug.view 280; Scene.pick 262. Scene is one table of 47 rows and 4,398 words; EngineOptions 42 rows, 3,375 words; QualitySettings 48 rows, 3,326 words. renderSymbol emits every member as a '| Member | Description |' row.
- Proposed edit: Keep the table as the member index. When a summary is over about 40 words or 2 sentences, the cell keeps the first sentence plus a "More" link, and the full text goes under an H3 below the table, such as `### Scene.pick`, with the signature in a ts code block and the text in its own paragraphs. Depth stays at H3.
- Generated source: tools/lib/api-docs.ts

Verdict: survives

## Evidence

- tools/lib/api-docs.ts:486-503 (`renderSymbol`): every member of a class, interface or namespace goes out as one `| signature | summary |` row. Nothing else is emitted for a member.
- tools/lib/api-docs.ts:74 (`flat`) and :119-123 (`summaryOf`): the member's whole doc comment, up to its first tag, is joined onto one line. Paragraph breaks in the source are lost. Example: the `buildLevels` comment in packages/engine/src/scene/resources.ts has blank comment lines that split it into paragraphs; the page prints it as one 462-word cell (docs/api/reference/geometry.md:492).
- tools/lib/docs.ts:579 calls `renderReference(symbols, '##')`, so each export is an H2 (for example docs/api/reference/scene.md:13 `## AtmosphereBackground`). Member sections at H3 fit under it, and depth stays at H3 as the finding says.
- Counts: my own count of member rows matches 2,704 in total and about 120 over 90 words.
- Small wording slip, not enough to refute: a GFM cell can hold inline code (the cells use it a lot, such as `lodThreshold`). It cannot hold code blocks, lists, paragraphs or a details block. The phone sideways-scroll point depends on the website's table styling, which lives in the other repo; it is plausible with long one-line signatures but I cannot check it here.

## Corrected edit

Keep the proposal, with three changes:

1. Raise the threshold. About 497 of the 2,704 rows are over 40 words. At 40 words, nearly 500 new H3 headings would fill the page outlines. Use "over 90 words or 3 sentences" (about 120 rows), so only the long members get their own section.
2. Keep the paragraph breaks. For a member that gets an H3, render the doc comment with its paragraph breaks kept instead of the one-line `flat` form. The table cell keeps the first sentence and a link to the H3.
3. Use the details block for dense internals. Under the H3, the text that implementers need but readers do not need to follow the main point can go in a `<details><summary>Technical details: ...</summary>` block. For `buildLevels`, the meshlet pieces, the part-by-part vertex sharing and the planner download size are examples. This needs a way for the TSDoc to mark that part, such as a `@remarks` tag that the generator renders as the block. No headings and no nested blocks go inside it.

Edit in tools/lib/api-docs.ts (`renderSymbol`, plus a non-flattened summary for the long members). The TSDoc in packages/*/src stays the content source.
