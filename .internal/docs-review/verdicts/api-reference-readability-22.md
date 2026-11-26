# api-reference-readability-22

## Finding as given

- page: api/reference/impostors
- anchor: lines 27 `createImpostors`, 142 `handOverToCards`, 325 `mergeFarGeometry`
- category: technical-details-block
- severity: medium
- claim: Three long paragraphs; mergeFarGeometry puts transform maths for normals, tangents and mirrored copies in the main text.
- evidence: stats.json impostors 20 (106 words), 135 (99 words), 318 (169 words, 10 sentences). Sources packages/impostors/src/batch.ts:165, hand-over.ts:119, merge.ts:105.
- proposedEdit: mergeFarGeometry: keep 3 sentences plus the attribute rules as a list; move normals, tangents and mirroring into @details. handOverToCards: dithered-edge timing into @details, keep the call order in the main text, render its @param tags. createImpostors: split after 'the material reads the eye from the frame's camera.'
- generatedSource: packages/impostors/src/merge.ts

Verdict: partly

## Evidence

- The page has the three long paragraphs at lines 27, 142 and 325. The stats lines (20, 135, 318) are offset by the 7 lines of front matter. The mergeFarGeometry paragraph does carry the normal, tangent and mirroring rules in the main text.
- The root cause is mostly in the generator, not in the comments. In the source, mergeFarGeometry is already two paragraphs (packages/impostors/src/merge.ts:105-118, blank line after "Give it to `geometry.fromArrays`."), and handOverToCards is already two paragraphs (packages/impostors/src/hand-over.ts:118-124, blank line before "A plant that hands over in groups").
- tools/lib/api-docs.ts:74 `flat` replaces every run of whitespace with a newline, blank lines included, with one space. `summaryOf` (api-docs.ts:120-124) applies it to the whole comment. So every paragraph break in a source comment is lost on the page. The same collapse turns the loadImpostorAtlas code example into an inline run of backticks (page line 317).
- handOverToCards has four @param tags (hand-over.ts:126-130). `renderSymbol` (api-docs.ts:485-501) prints only the signature, the summary and members, so no @param text reaches the page. The finding is right that they should render, but this needs generator work.
- There is no `@details` tag. `DOC_TAGS` (api-docs.ts:99) holds only category, internal, param and returns. `misreadTags` (api-docs.ts:106-117) treats any other leading tag as text and adds it to the summary. So a `@details` block written into merge.ts today would print in the main text, prefixed by the literal "@details", and flattened into the same paragraph. Editing only merge.ts (the named source) cannot give the result proposed.
- Content check on the split points: the createImpostors split after "camera." is a clean break. For handOverToCards, the sentence "So each pixel that a mesh drops shows its card at full coverage, and the background never shows through" is the user-facing promise; it should stay in the main text. Only the timing detail ("their own dithered edge ends before the meshes' edge begins to thin") fits in a block.

## Corrected claim

Three long paragraphs on the page (lines 27, 142, 325), and mergeFarGeometry puts its transform maths in the main text. Two of the three are already split in the source; the generator joins them, drops @param tags, and has no way to render a technical details block.

## Corrected edit

1. tools/lib/api-docs.ts: keep blank-line paragraph breaks in `summaryOf` (flatten single newlines only; keep `flat` for table cells). Render @param tags as a short list under the summary. Add a details tag (for example `@details`) to `DOC_TAGS`, take it out of the summary, and render it after the summary as `<details><summary>Technical details: ...</summary>` with a blank line before and after its body, and no headings inside.
2. packages/impostors/src/merge.ts: keep the first paragraph. Put the attribute rules as a list. Move the normal, tangent and mirrored-copy sentences into the details tag. Keep "Throws a RangeError for arrays that do not fit together." in the main text.
3. packages/impostors/src/hand-over.ts (handOverToCards): keep "Hands one group ... background never shows through", the setup order and the grouped-plant call order in the main text. Move only the dithered-edge timing into the details tag.
4. packages/impostors/src/batch.ts (createImpostors): add a paragraph break after "the material reads the eye from the frame's camera." The break only shows after step 1.
