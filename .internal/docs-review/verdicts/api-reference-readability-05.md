# api-reference-readability-05

## Finding as given

- page: api/reference/impostors, api/reference/geometry, api/reference/grass, api/reference/engine
- anchor: impostors `handOverToCards` line 136; geometry `levelAt` line 344
- category: missing-content
- severity: high
- claim: The generator drops @param and @returns text. Parameter docs exist in the source but not on the page.
- evidence: hand-over.ts:129 '@param switchDistance The distance from the camera at which these trees hand over, in meters.' does not appear at impostors lines 136-142. level-rule.ts:147-204 documents view, level, scale, radius, distance and the return value; the levelAt section shows none. summaryOf uses getDocumentationComment, which omits tags, and renderSymbol never prints them.
- proposedEdit: Render a Parameters table (Name, Description) and a Returns line for any function or method with these tags. A member with tags renders as an H3 (table cells cannot hold them).
- generatedSource: tools/lib/api-docs.ts

Verdict: survives

## Evidence

- packages/impostors/src/hand-over.ts:127-131 hold four @param tags for `handOverToCards`. The tag for `start` says what the value means and that it is in meters ("0 for a batch that draws from the camera out, or the start of a coarser level's own band"). docs/api/reference/impostors.md:136-142 shows only the signature and the summary. The summary names `switchDistance` but gives no unit, and says nothing about `meshes`, `cards` or `start`.
- packages/engine/src/scene/level-rule.ts:198-204 hold five @param tags and one @returns tag for `levelAt`. docs/api/reference/geometry.md:344-350 shows none of them. The page does not explain the `distance` union (`number | LevelDistances`), and it does not say that `levels` excludes the base mesh.
- tools/lib/api-docs.ts:120-124 (`summaryOf`) reads `getDocumentationComment`, which stops at the first tag. It adds back only "misread" text before the first real tag. `DOC_TAGS` (line 99) lists `param` and `returns` as real tags. tools/lib/api-docs.ts:486-501 (`renderSymbol`) prints a heading, the signature, the summary and a members table. Nothing reads `param` or `returns`. `membersOf` (line 234) also uses `summaryOf`, so methods lose their tags too.
- The scale is large. The package sources hold about 1,400 @param/@returns lines. The grass page (`createGrass`, grass.ts:365-366) and engine sources (for example level-rule.ts, downloads.ts:67) are also affected, so the cross-page scope is right.
- The generator named in the finding is right: docs.ts imports `readApi` and `renderReference` from tools/lib/api-docs.ts (docs.ts:35).
- I found no writing rule or test that drops tags on purpose. Units and allowed values are what an implementer needs, so "high" is fair.

## Small corrections (the verdict stands)

- level-rule.ts:147-204 covers three functions. Lines 147-151 document `levelSwitchDistance` (`level` is its parameter) and lines 172-174 document `levelDistances`. The `levelAt` tags are at 198-204: view, levels, scale, radius, distance and returns.
- "Table cells cannot hold them" goes too far. A cell can hold inline text. A nested table or a list cannot sit in a cell.

## Corrected edit

In api-docs.ts, collect `param` and `returns` tags with `getJsDocTags` (beside `summary`, on both `ApiSymbol` and `ApiMember`). In `renderSymbol`, after the summary of a function, print a "Parameters" table (Parameter, Description) and a "Returns: ..." line. Leave members in the members table, and append their tags in the description cell as inline text, for example "`start`: ...; Returns ...", with pipes escaped by `tableCell`. A heading for each tagged method would split long class sections into many headings. When a function has more than about four parameters, the table may go inside a `<details><summary>Parameters</summary>` block. The signature and summary must still make sense with the block closed.
