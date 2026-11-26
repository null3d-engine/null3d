# Verdict: api-reference-readability-21

## Finding as given

- page: api/reference/materials
- anchor: lines 19 `AlphaMode`, 27 `Blending`, 148 `ShaderOptions`; line 142 `Materials.shader`
- category: long-paragraph, severity: medium
- claim: Three long type paragraphs and a 260-word shader cell holding three error codes and development-build rules.
- evidence: stats.json materials 12 (96 words), 20 (83 words), 141 (74 words). shader cell 260 words, 9 sentences. StandardValues 35 rows, 1,588 words. Source packages/engine/src/scene/resources.ts:1812, 1824, 2442.
- proposedEdit: AlphaMode and Blending become value tables. shader: keep the first 3 sentences, list E1215/E1216/E1217 under Errors, move the development-build E1217 alpha and transmission rules into @details.
- generatedSource: packages/engine/src/scene/resources.ts

Verdict: partly

## Evidence

- The problem is real. stats.json lists the three paragraphs (file lines 12, 20, 141 = page lines 19, 27, 148; the offset is the front matter). The `materials.shader` cell on page line 142 is 261 words and 9 sentences, and it names E1215, E1216 and E1217 as plain text, with no links to their pages. Its TSDoc is in resources.ts at about lines 4714-4734; the type comments are at resources.ts:1811-1821 (`AlphaMode`), 1823-1833 (`Blending`) and 2442-2450 (`ShaderOptions`).
- The proposed edit cannot be done by editing resources.ts alone. The generator that writes these pages is tools/lib/api-docs.ts, not the files the finding names:
  - api-docs.ts:74 `flat()` puts every summary on one line, and summaryOf (api-docs.ts:120) uses it. So a value table, a paragraph break or a `<details>` block in a TSDoc comment is flattened into one line, and the Markdown breaks.
  - api-docs.ts:99 knows only the `category`, `internal`, `param` and `returns` tags. No `@details` or `@throws` tag exists. misreadTags (api-docs.ts:107-117) puts any other `@` tag back into the summary as text, so a `@details` tag would print as literal text in the cell.
  - api-docs.ts:496-498 puts each member's summary in a Markdown table cell. A `<details>` block needs blank lines around its Markdown body, and a table cell cannot hold them. The website contract's block format cannot go in a member cell.
  - The page has no "Errors" list for a member. The generator has no such format.
- The detail the edit would move is already on a linked page. docs/errors/E1217.md says that custom materials take alpha to coverage or the hash mode only where their WGSL sets or reads the surface's alpha, and that a custom material with transmission or diffuseTransmission needs WGSL that sets it. The shader cell repeats this.
- Changing `AlphaMode` and `Blending` (96 and 83 words, one value per sentence) to value tables is a small gain, and it also needs the generator to keep line breaks in a type's summary.

## Corrected claim

The `materials.shader` cell (261 words) is hard to read, and the `AlphaMode`, `Blending` and `ShaderOptions` summaries are long. But the generator (tools/lib/api-docs.ts) flattens every summary to one line, knows no `@details` or Errors tag, and puts member summaries in table cells. So no value table, Errors list or collapsible block can come from resources.ts alone.

## Corrected edit

1. In resources.ts, cut the `materials.shader` comment to its first sentences plus one sentence about errors, with links: "Throws [E1215](../../errors/E1215.md) for WGSL that the null3D Vite plugin did not compile, [E1216](../../errors/E1216.md) for a uniform or texture that the WGSL does not declare, and, in a development build, [E1217](../../errors/E1217.md) for an option that its WGSL does not support." Remove the alpha and transmission rules, because the E1217 page already gives them (its source is packages/engine/src/errors/codes.ts and fixes.ts). Keep the type-check sentence.
2. Optional, and only with a generator change in tools/lib/api-docs.ts: keep blank lines in summaries of types and interfaces (not member cells), so that `AlphaMode` and `Blending` can show one short paragraph or a list of values. Do not use `<details>` in a member table cell.
