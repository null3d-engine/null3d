# api-reference-substance-28

## Finding as given

- page: api/reference/debug
- anchor: debug.md:18 `Debug` summary (132 words)
- category: technical-details-block
- severity: low
- claim: The summary ends with a release build's one traversal of objects with levels. The detail is true but buries the main rule that only development builds draw.
- evidence: debug.md:18; packages/engine/src/debug/debug.ts:76.
- proposedEdit: Keep 'Each drawing call draws for one frame only. Only development builds draw; a release build drops the drawing code.' Move the traversal detail into a `<details><summary>Technical details: Debug</summary>` block.
- generatedSource: packages/engine/src/debug/debug.ts

Verdict: partly

## Evidence

- The long paragraph is real (stats.json: line 18, 132 words, 9 sentences). The release-build rule sits near the end of it, after the drawing details.
- The claim misreads the end of the paragraph. It ends with "The calls `stats` and `frameStats` work in every build.", not with the traversal clause.
- The source already splits this text into two paragraphs (packages/engine/src/debug/debug.ts, the comment on `interface Debug`: a blank comment line comes before "Only development builds draw."). The generator joins them. `summaryOf` in tools/lib/api-docs.ts:119-123 passes every summary through `flat` (api-docs.ts:74), which turns each line break into a space. `renderSymbol` (api-docs.ts:494) then writes the summary as one line. So the merge comes from the generator, not from the comment.
- For the same reason, the proposed `<details>` block cannot work from TSDoc. `flat` would put `<details><summary>...</summary> ... </details>` on the same line as the paragraph before it. That gives inline HTML inside a `<p>`, with no blank lines around the Markdown body. It breaks the block format and would not collapse correctly on the website.
- The traversal detail is already on the linked page. The reference page links to docs/api/debug.md at its top. That page has a "Release builds" section (api/debug.md:68-70), and api/debug.md:130 names the traversal of objects whose meshes have levels and gives its size. The reference summary repeats it, so a block is not needed to keep it.
- The proposed kept text drops "The calls `stats` and `frameStats` work in every build." That fact matters to a reader who ships the overlay in a release build. It must stay in the main text.

## Corrected claim

The `Debug` summary is one 132-word paragraph because the API page generator joins the comment's two paragraphs into one line. The release-build rule is the start of the second paragraph in the source. The clause about the one traversal of objects with levels is implementation detail that api/debug.md already covers in "Release builds" and in its debug-views limits.

## Corrected edit

In packages/engine/src/debug/debug.ts, in the comment on `interface Debug`, cut the traversal clause and keep the rest:

"Only development builds draw. In a release build every drawing call does nothing, and the build holds none of the drawing code. The calls `stats` and `frameStats` work in every build."

Do not add a `<details>` block to a TSDoc summary. The generator flattens summaries to one line, so the block would break. If the reference pages should keep paragraph breaks in an export's summary, change `summaryOf` / `renderSymbol` in tools/lib/api-docs.ts to keep the blank lines between paragraphs for export summaries, and flatten only the table cells of members. That is a separate generator change.
