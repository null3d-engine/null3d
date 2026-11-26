# api-reference-readability-01

## Finding as given

- Pages: api/reference/tasks, scene, impostors, engine, debug, features, render, splats, geometry, lights, assets
- Anchor: tasks `runTask` line 19; scene `timeOfDay` line 492; impostors `loadImpostorAtlas` line 316; engine `DrawPathReason` line 78
- Category: wall-of-text. Severity: high.
- Claim: The generator joins every TSDoc comment into one line. Paragraphs merge into one wall, bullet lists become inline '- `x`:' text, and fenced code examples render as inline text with visible ``` markers.
- Evidence: summaryOf in tools/lib/api-docs.ts calls flat(), which replaces each newline run with a space. run-task.ts:21-53 has 7 paragraphs; the page has one 381-word, 18-sentence paragraph. time-of-day.ts:211-221 code example renders inline. draw-path-probe.ts:54-61 list renders inline. 14 of the 41 long paragraphs in stats.json have 2 or more source paragraphs.
- Proposed edit: Keep block structure in export summaries: split on blank lines, keep fenced code blocks and list items, and flatten only lines inside one prose paragraph. Use flat() only for text that goes into a table cell. Add a generator test with a two-paragraph comment, a list and a code fence.
- Generated source: tools/lib/api-docs.ts

Verdict: survives

## Evidence

- tools/lib/api-docs.ts:74 defines `flat` as `text.replace(/\s*\n\s*/g, ' ').trim()`. Its own comment says it exists "so it fits a table cell".
- tools/lib/api-docs.ts:120-123 `summaryOf` passes every export and member summary through `flat`. tools/lib/api-docs.ts:494 `renderSymbol` pushes the export summary as one line of Markdown. So every blank line, list break and code fence in a comment is lost.
- packages/engine/src/shared/run-task.ts:20-53 has seven prose paragraphs. docs/api/reference/tasks.md line 19 is one paragraph that starts "Runs a task in a job worker..." and runs all seven together.
- packages/engine/src/.../time-of-day source (lines 205-221) has a fenced `ts` block. docs/api/reference/scene.md line 492 prints it inline: "... `emptyTimeOfDay()` makes the first one to pass. ```ts const day = emptyTimeOfDay(); timeOfDay('goldenHour', {}, day); ... ```". This is broken Markdown, not just a long paragraph.
- packages/engine/src/gpu/webgpu/draw-path-probe.ts:52-64 is a bullet list. docs/api/reference/engine.md line 78 prints "...`engine.capabilities.drawPath`: - `probe-faster`: ... - `probe-not-faster`: ...".
- docs/api/reference/impostors.md line 316 shows the same inline code fence for `loadImpostorAtlas`.
- I looked for a reason the flattening is needed for export summaries. The only consumer of `symbol.summary` is `renderSymbol` (api-docs.ts:494), which puts it on its own line, not in a table. Member summaries go into a table row through `tableCell` (api-docs.ts:476, 498), and `tableCell` only escapes pipes. It does not flatten. So member summaries must stay flattened; the proposed edit already says to keep `flat` for table-cell text.
- The tests in tools/lib/api-docs.test.ts check only one-line summaries ("A child.", "A code."). No test covers a multi-paragraph comment, a list or a code fence, so the proposed test is new coverage.

## Notes on the edit

The edit is right. One detail to keep: apply `flat` where a member summary enters a table cell (or keep it in the member path of `summaryOf`), because `tableCell` does not join lines. Text that `misreadTags` adds (a summary cut at an `@` word) already keeps its newlines, so the block-aware join must also run on that part.
