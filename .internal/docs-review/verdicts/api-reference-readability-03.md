# api-reference-readability-03

## Finding as given

- page: api/reference/geometry, engine, render, impostors, debug, tasks, quality
- anchor: geometry line 492 `buildLevels`; engine line 111 `destroy`; render line 43; impostors line 325; debug line 25
- category: technical-details-block
- severity: high
- claim: Comments mix what a user needs with dense implementer detail, and the generator has no TSDoc form that becomes a collapsible technical details block, so both render as one block of prose.
- evidence: buildLevels explains part splitting past 65,535 vertices, pieces of 32,768 triangles, one part read per frame and sorted index copies in the same cell as its basic use. destroy explains 2 kept shared memories for about 30 seconds and Safari's memory delay. render line 43 lists bind groups and the uniform block layout. mergeFarGeometry gives inverse-transpose maths for normals. DOC_TAGS holds only category, internal, param, returns.
- proposedEdit: Add a custom block tag `@details` to DOC_TAGS (so misreadTags stops treating it as text) and render it after the summary as `<details>\n<summary>Technical details</summary>\n\n…\n\n</details>`. Allow it on exports and on members rendered as H3. The docs check rejects headings and nested `<details>` inside it. Then move the detail listed in the page findings into @details.
- generatedSource: tools/lib/api-docs.ts

Verdict: partly

## Evidence

- The pages say what the finding says. geometry.md line 492 (`buildLevels`) mixes basic use with part splitting past 65,535 vertices, pieces for lists of 32,768 triangles, one part read per frame and sorted index copies. engine.md line 111 (`destroy`) mixes "wait before you start another engine" with the 30-second shared memory reuse, the limit of 2 memories and Safari's delay. render.md line 43 (`ComputePassOptions`) gives bind group numbers and the uniform block layout. impostors.md line 325 (`mergeFarGeometry`) gives the inverse-transpose rule for normals. debug.md line 25 (`Debug`) explains what a release build keeps.
- tools/lib/api-docs.ts:99 `DOC_TAGS = new Set(['category', 'internal', 'param', 'returns'])`. No tag yields a collapsible block. tools/lib/api-docs.ts:74 `flat()` collapses every summary to one line, and summaryOf (line 120-124) applies it, so a summary cannot carry a block today. No `<details>` exists in docs/ and tools/lib/docs-style.ts has no rule for one. The core claim holds.
- The proposed edit is wrong in one part. No member renders as an H3. renderSymbol (tools/lib/api-docs.ts, near the end of the file) writes every member as one row of a `| Member | Description |` table, and exports render under `##` on reference pages (tools/lib/docs.ts:579 passes '##'). Every reference page has 0 H3 headings. So "members rendered as H3" matches nothing, and the two worst cases the finding names, `buildLevels` and `destroy`, are table cells. A `<details>` block with blank lines and a Markdown body breaks a GFM table row, so the edit as written cannot move their detail.
- Severity is too high. Dense but correct detail does not mislead a reader or block a newcomer. The rubric's "makes a page clearly harder to read" fits: medium.

## Corrected claim

The generator has no TSDoc form for a collapsible block. Its summaries flatten to one line, and members render as table rows. So user-facing text and implementer detail share one paragraph or one table cell, in exports' summaries (render `ComputePassOptions`, impostors `mergeFarGeometry`, debug `Debug`) and in member cells (geometry `buildLevels`, engine `destroy`). Severity: medium.

## Corrected edit

In tools/lib/api-docs.ts:
1. Add `details` to DOC_TAGS, so misreadTags (line 106) ends the summary at it and does not read it as text.
2. Read the tag text with the existing `tag()` helper, keeping its line breaks (do not pass it through `flat()`). Store it as `details` on ApiSymbol and on each member.
3. In renderSymbol, write an export's block after its summary and before the members table:
   `<details>` / `<summary>Technical details: <what is inside></summary>` / blank line / body / blank line / `</details>`. Take the summary text from the tag's first line, so each block says what it holds, as the website contract asks.
4. For members, keep the table cell to the user-facing text and write each member's block after the table, with a summary that names the member, for example `<summary>Technical details: how buildLevels splits large meshes</summary>`. A block cannot sit inside a GFM table cell.
5. In tools/lib/docs-style.ts, reject a heading or a nested `<details>` inside a block, and check that the main text still reads with the blocks closed (the cell or summary must not point into the block).
Then move the detail named above into `@details` in the TSDoc of the exports in packages/*/src.
