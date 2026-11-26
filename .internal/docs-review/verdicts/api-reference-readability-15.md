# Verdict: api-reference-readability-15

## Finding as given

- page: api/reference/scene
- anchor: lines 115 `ChunkRowWriter`, 151 `FogCurve`, 492 `timeOfDay`; `Scene` class line 365
- category: long-paragraph, severity: medium
- claim: Three long paragraphs, and the Scene class is one 47-row, 4,398-word table with 21 cells over 90 words.
- evidence: stats.json scene 108 (106 words), 144 (67 words), 485 (191 words). pick 262 words, addFeatureDraw 254, setSkyLayer 222, setBackground 212, createView 193.
- proposedEdit: timeOfDay: paragraph on the result, paragraph on `out`, then a real code block. FogCurve: table of curves with formulas. ChunkRowWriter: two numbered steps (write each chunk once; pack with one count per slot). Scene.pick: keep 2 sentences, move frame timing, skinned mismatch and raycast fallback into @details. Group Scene members in the index by task (objects, background and sky, environment and fog, probes, views, feature draws).
- generatedSource: packages/engine/src/scene/time-of-day.ts

Verdict: partly

## Evidence

- The counts hold. stats.json lists the three long paragraphs (108: 106 words, 6 sentences; 144: 67 words, 5 sentences; 485: 191 words, 9 sentences). The Scene member table runs from line 373 to 419 (47 or 48 rows, about 4,380 words, 20 to 21 cells over 90 words, by how the signature is counted).
- The cause and the source to edit are wrong for two of the three paragraphs. The TSDoc already has the structure that the finding asks for:
  - packages/engine/src/scene/time-of-day.ts:199-222: three paragraphs (the result; `out`; a fenced ```ts code block).
  - packages/engine/src/scene/chunk-rows.ts:63-76: three paragraphs (write and pack; which batches take rows; allocation).
- The generator joins them. tools/lib/api-docs.ts:74 `flat` replaces every newline with a space, and `summaryOf` (api-docs.ts:120-124) applies it to every summary, also the top-level summary that `renderSymbol` prints as a paragraph (api-docs.ts:497). The flatten is only needed for table cells.
- Result on the page, line 492: the timeOfDay example is not a code block. It shows as inline text that starts with ```ts and ends with ```, so the example is unreadable. That is worse than a long paragraph: it misleads a reader who wants to copy the example (high, not medium).
- An edit to the TSDoc alone cannot make a numbered list (ChunkRowWriter) or a table (FogCurve). The same flatten would join a list or table into one line.
- Scene.pick in "@details": no such tag exists (no "details" anywhere in tools/ or packages/engine/src). Members render as one row each of a GFM table (api-docs.ts:493-496). A `<details>` block needs blank lines around its Markdown body, so it cannot sit inside a table cell. The pick TSDoc (packages/engine/src/scene/scene.ts:5841-5861) already splits its content into three paragraphs; the table flattens them.
- Grouping Scene members by task has no mechanism in the generator. Members render in declaration order (membersOf, api-docs.ts:220). The edit needs a generator change, which the finding does not name.
- FogCurve (fog.ts:19-28) is one paragraph in source too. A table of the three curves is a fair polish edit, but only with a generator that keeps block Markdown. Low on its own.
- Not in the finding, but in the same paragraph: "`bun run bench:allocation --time-of-day` checks that" (time-of-day.ts:207-208) names a repository script that a user of the published package cannot run. It should leave the published text.

## Corrected claim

The scene reference page has three long paragraphs and a very long Scene member table. For timeOfDay and ChunkRowWriter the TSDoc already has paragraph breaks and, for timeOfDay, a fenced code example. The API reference generator joins every summary into one line, so the breaks are lost and the timeOfDay example renders as broken inline text (high). Long member descriptions such as Scene.pick cannot hold a collapsible block, because each member is one table row.

## Corrected edit

1. tools/lib/api-docs.ts: keep the raw comment text for a symbol's own summary (the paragraph under its heading) and apply `flat` only to member summaries that go into table cells. This alone fixes timeOfDay (line 492) and ChunkRowWriter (line 115), and makes Markdown blocks (lists, tables, `<details>`) possible in TSDoc summaries.
2. time-of-day.ts:206-208: drop the sentence that names the allocation benchmark script.
3. For long member descriptions (pick, addFeatureDraw, setSkyLayer, setBackground, createView): have the generator keep the first sentence or two in the table cell, and render the full TSDoc text of a member whose comment has more than one paragraph below the table, under the member's name, with the later paragraphs in a `<details><summary>Technical details: ...</summary>` block. No headings inside the block.
4. Optional, after step 1: FogCurve TSDoc as a short table of the three curves with their formulas; ChunkRowWriter's first paragraph as two numbered steps.
5. Grouping Scene members by task needs a generator feature (for example a member tag that names a group). Treat it as a separate, lower-priority change.
