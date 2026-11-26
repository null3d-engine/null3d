# Verdict: api-reference-readability-28

## Finding as given

```json
{
 "page": "api/reference/scene,api/reference/engine,api/reference/materials,api/reference/quality,api/reference/controls,api/reference/water",
 "anchor": "Options interfaces, e.g. scene `AtmosphereOptions` line 31",
 "category": "structure",
 "severity": "low",
 "claim": "Defaults are hidden in prose, so a developer who wants only the default reads each cell.",
 "evidence": "600 of 787 option rows say 'The default is ...' inside the description.",
 "proposedEdit": "Support @defaultValue and print a Default column in options tables; move 'The default is X' into the tag.",
 "generatedSource": "tools/lib/api-docs.ts",
 "id": "api-reference-readability-28",
 "slice": "api-reference",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- The issue is real. In docs/api/reference/scene.md, the `AtmosphereOptions` table (lines 27-45) puts every default inside the description, and its place in the sentence varies: at the end for most rows, but at the start for others, followed by more text (for example "The default is true. glTF textures use false. ..." on another page).
- The generator has no default support. tools/lib/api-docs.ts line 99 knows only the tags `category`, `internal`, `param` and `returns`. `renderSymbol` (lines 484-500) always prints a two-column `| Member | Description |` table. No source comment uses `@defaultValue` or `@default`.
- The generator source named in the finding is right: the table is drawn in tools/lib/api-docs.ts, not in tools/lib/docs.ts.
- The count is not for the six pages named. Across all 39 reference pages, 790 rows are optional members (`name?:`), and 591 rows say "The default ...". On the six pages named, about 211 of 327 optional rows say "The default is". The quality page has 1 such row and the water page has none, so these two pages gain almost nothing.
- Not every default is a short value. Of 536 "The default is ..." phrases, the longest is 404 characters, and 14 depend on something else (a preset, a size, the atlas's cells). Example: "The default is 512: a 16:9 frame of that width is 512 x 288 texels, ...". A blind move of the whole sentence into the tag would put long prose in a narrow column.

## Corrected claim

Option tables on the reference pages give each default inside the description, in no fixed place, so a reader who wants only the defaults must read each row. Across all 39 reference pages, 591 rows hold a "The default ..." sentence, and 790 rows are optional members. The scene, materials and controls pages have the most such rows. The quality and water pages have almost none.

## Corrected edit

In tools/lib/api-docs.ts:
1. Add `defaultValue` to the known tags (line 99). If it is not added, the text that strips unknown tags from summaries treats it as body text and appends it to the description.
2. Read the tag for each member and keep it on the member record.
3. In `renderSymbol`, print a third Default column only when at least one member of that type has the tag, so class and method tables stay at two columns.
4. In the source comments (`@category api/<page>` exports in packages/*/src), move only the value into `@defaultValue` as a code span (`true`, `0.4`, `` `pipelined` ``). Keep the reason or the condition in the description. Where the default is not a value (for example "the atlas's cells"), give a short phrase in the tag and keep the full explanation in the description.
5. Add a check that an optional member whose description still says "The default is" gets reported, so the two forms do not drift apart.
