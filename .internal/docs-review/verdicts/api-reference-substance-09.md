# Verdict: api-reference-substance-09

## The finding as given

- Page: api/reference/engine, scene, materials, assets, debug, geometry, quality, render, objects, lights, post, textures, cameras, animation, ui, terrain, sketch, particles, wind
- Anchor: geometry.md:492 `buildLevels` (463 words); render.md:173; engine.md:212 `preload`; debug.md:31; scene.md:412; materials.md:142; scene.md:385; engine.md:111
- Category: technical-details-block. Severity: medium.
- Claim: 123 of 2,704 member table cells run over 90 words, up to 463. The page statistics miss them because they count paragraphs only. The detail is correct and useful to implementers, but a table cell cannot hold paragraphs, lists or code.
- Evidence: measured over rows starting '| `' in docs/api/reference/*.md: engine 25, scene 21, materials 12, assets 12, debug 7, geometry 6, quality 6, others fewer. Rendering at tools/lib/api-docs.ts:486-503.
- Proposed edit: in renderSymbol keep the first TSDoc paragraph of each member in its cell, and print later paragraphs after the table in one block per member: `<details><summary>Technical details: `buildLevels`</summary> ... </details>`. Then split the long member comments into a short first paragraph (what it does, returns, throws) and later paragraphs (limits, memory, timing). Needs finding 4's fix.
- Generated source: tools/lib/api-docs.ts

Verdict: survives

## Evidence

- Recount: 2,704 member rows in docs/api/reference/*.md. 119 description cells run over 90 words (134 if the signature cell is counted too). Top pages: engine 24, scene 21, assets 12, materials 11, debug 7, geometry 6, quality 5. The longest is geometry.md:492 (`buildLevels`) at 462 words. The finding's 123 sits between the two counts; the difference does not change the claim.
- The table is written at tools/lib/api-docs.ts:496-499: one row per member, `| signature | summary |`.
- The summary is flattened to one line by `summaryOf` (tools/lib/api-docs.ts:119-124), which calls `flat` (tools/lib/api-docs.ts:74). So paragraph breaks in the TSDoc are lost.
- The `buildLevels` TSDoc (packages/engine/src/scene/resources.ts, just above `buildLevels(options`) already has two paragraphs. The generator joins them into one 462-word cell.
- The docs style check skips table rows (tools/lib/docs-style.ts:426, `if (block.kind === 'table') continue;`). So neither the page statistics nor the style check catch these cells. Nothing else on the pages handles them.
- The proposed block follows the contract: a `<details>` block with a `Technical details:` summary, no headings and no nesting inside. The table row still says what the member does when the block is closed.

## Notes on the edit (no correction to the verdict)

- The split alone does not fix `buildLevels`. Its first TSDoc paragraph is still about 230 words, and its return value and errors (E1221, E1406, E1101) are in the second paragraph. The TSDoc rewrite the finding asks for must move "resolves with", "rejects with" and "throws" into the short first paragraph. Errors must not hide inside a closed block.
- The cell must stay one line even after finding 4's fix, so keep `flat` for the first paragraph in the cell, and keep fenced code and lists only inside the block.
