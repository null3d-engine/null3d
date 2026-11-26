# api-reference-readability-20

## Finding as given

- page: api/reference/render
- anchor: line 43 compute pass options; line 173 `addPass`
- category: technical-details-block
- severity: medium
- claim: The compute pass paragraph gives bind group layout in the main text, and addPass is a 302-word cell that covers four pass kinds, lighting rules and seven error codes.
- evidence: stats.json render 36 (141 words, 6 sentences). addPass 302 words, 15 sentences. Source packages/engine/src/scene/render.ts:274.
- proposedEdit: addPass: lead sentence, then a list of the four pass kinds (scene, reflection, full-screen, compute), then what scene and reflection passes draw; errors to an Errors list. Compute options: keep the first 4 sentences; move bind groups and the uniform block contents into @details.
- generatedSource: packages/engine/src/scene/render.ts

Verdict: partly

## Evidence

- The page says what the finding claims. docs/api/reference/render.md:43 is the 141-word compute options paragraph, with the bind group layout and block contents in its last two sentences. docs/api/reference/render.md:173 is the addPass table cell: four pass kinds, the lighting rules, and seven error codes (E1220, E1215, E1216, E1502 to E1505), all in one cell.
- The source is already split. packages/engine/src/scene/render.ts:273-286 writes the compute options comment as two paragraphs: what the pass does, then the bindings and the block. packages/engine/src/scene/render.ts:507-530 writes the addPass comment as three paragraphs: the pass kinds, the lighting, and the errors.
- The generator removes those breaks. tools/lib/api-docs.ts:74 defines `flat`, which replaces every newline, blank lines included, with one space. Lines 123 and 324 pass member and export summaries through it. So the wall of text comes from the generator, not from the TSDoc.
- So the edit cannot be made in render.ts alone. A list, an "Errors" list or a `<details>` block written in the TSDoc would be flattened onto one line, like the paragraph breaks that are already there.
- addPass is a cell of a GFM table (tools/lib/docs.ts:203-205 builds each row as one line). A GFM table cell cannot hold a list, paragraphs or a `<details>` block with a Markdown body. The proposed list of pass kinds and Errors list cannot go into that cell.
- "@details" is not a TSDoc tag that tools/lib/api-docs.ts knows. It would need generator support.

## Corrected claim

The two blocks are dense, as the finding says. But the TSDoc source already has the paragraph breaks that the finding asks for. The generator (tools/lib/api-docs.ts, `flat`) joins them into one line, and the method table cannot hold block content. The fix belongs mainly in the generator, with small TSDoc edits after it.

## Corrected edit

1. tools/lib/api-docs.ts: keep blank-line paragraph breaks in export summaries. Collapse only single newlines.
2. Same file and tools/lib/docs.ts: when a method's comment has more than one paragraph, put the first paragraph in the members table. Render the full text under the table, in a short block for that method (for example, a bold method name, not a heading), where lists and `<details>` work.
3. Give the generator one way to mark dense detail, for example a TSDoc `@remarks` section that renders as `<details><summary>Technical details: ...</summary> ... </details>`. Then in packages/engine/src/scene/render.ts:
   - ComputePassOptions: move the second paragraph (bindings and block contents) into that section.
   - addPass: write the pass kinds as a four-item list. Keep the lighting paragraph. Keep the error codes visible as a short list, or put them in the details block. Readers who hit an error land on its error page, so they do not depend on this list.
