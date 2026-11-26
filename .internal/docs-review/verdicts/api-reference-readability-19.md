# api-reference-readability-19

## Finding as given

- page: api/reference/debug
- anchor: line 25 `Debug` summary; line 31 `Debug.view`
- category: long-paragraph, severity: medium
- claim: The module summary is a 132-word, 9-sentence paragraph, `view` is a 280-word cell that walks eight view names, and about 30 of 44 exports are stats types mixed with the drawing API.
- evidence: stats.json debug 18 (132 words, 9 sentences). view cell 280 words, 16 sentences. Source packages/engine/src/debug/debug.ts:64.
- proposedEdit: Split line 25 into drawing rules and build rules; move the release-build scene traversal into @details. view: a lead sentence then a View | What it shows table (lit, normals, depth, overdraw, wireframe, shadows, motion, levels). Group the index into 'Debug drawing' and 'Frame figures and memory'.
- generatedSource: packages/engine/src/debug/debug.ts

Verdict: partly

## Evidence

- The reading problem is real. Page line 25 is one 132-word, 9-sentence paragraph (stats.json). The `view` cell at line 31 is 280 words (measured), with about 19 sentence breaks, not 16.
- Exports: the page has 43 export headings, not 44. 7 are drawing exports (countPerSecond is a stats helper; Debug, DebugGridOptions, DebugLightOptions, DebugView, DebugViewName, EngineDebugView). The other 36 are frame-figure, memory and stats-panel types. So "36 of 43", not "about 30 of 44".
- The source already splits the summary. packages/engine/src/debug/debug.ts:63-74 has two paragraphs: drawing rules, then "Only development builds draw ...". The generator joins them. tools/lib/api-docs.ts:119-123 (`summaryOf`, "on one line") calls `flat` (api-docs.ts:74), which turns every newline, blank lines included, into a space. So editing debug.ts cannot split line 25, and a `<details>` block in any TSDoc summary also collapses onto one line. The source to edit is tools/lib/api-docs.ts, not only debug.ts.
- A table inside the `view` cell cannot render. `renderSymbol` (api-docs.ts:494-498) writes each interface member as one Markdown table row. `tableCell` (api-docs.ts:476) escapes pipes, and a table cell cannot hold a nested table or a `<details>` block with a Markdown body.
- The table already exists. The linked page docs/api/debug.md (reference page line 11 links to it) has a "View | What it shows" table for all eight views (lines ~110-121), with more detail than the cell. Its list at line 130 also covers the release-build traversal, with the size cost.
- Grouping: the page has no index. The generator sorts all exports of one category by name (api-docs.ts:471) and has no groups. Grouping needs a generator feature, or the stats types need their own `@category` page (a new PAGES/AREAS entry in tools/lib/docs.ts).

## Corrected claim

The `Debug` summary (line 25, 132 words) and the `view` cell (line 31, 280 words) are hard to read. The summary is long because the generator flattens the two source paragraphs into one line. The `view` cell repeats, in one table cell, the per-view table that the linked guide already has. 36 of the 43 exports are frame-figure and memory types, listed by name among the 7 drawing exports.

## Corrected edit

1. In tools/lib/api-docs.ts, make `summaryOf` keep blank-line paragraph breaks for export summaries (keep `flat` only for member cells). Line 25 then shows the two paragraphs debug.ts already has. Do not add a `<details>` block here: the guide's line 130 already holds the release-build detail.
2. In packages/engine/src/debug/debug.ts, cut the `view` member comment to a lead and the call rules: "Draws the whole scene with one debug shading in place of every material, from the next frame on, until the next call; `'lit'` draws the materials again. Debug views use no tone mapping, and an add-on can register more. Only development builds draw them. A view's first frame builds its pipelines, so objects can be missing for a few frames." Move the per-view meanings to the guide's existing table (docs/api/debug.md), and add there any fact the cell has that the table lacks (for example "the other views clear to black"). Do not put a table in the cell.
3. Optional, and a larger change: move the 36 frame-figure and memory types to their own reference page (a new `@category`, such as api/stats, with its PAGES entry), or add group support to the generator. Do not propose an index grouping that the generator cannot make.
