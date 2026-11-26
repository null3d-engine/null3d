# api-reference-substance-04

## Finding as given

- page: api/reference/impostors, api/reference/scene, api/reference/engine, api/reference/ui
- anchor: impostors.md:317 `loadImpostorAtlas`; scene.md:492 `timeOfDay`; engine.md:78 `DrawPathReason`; engine.md:461; ui.md:41 `LabelTransform`
- category: structure; severity: high
- claim: TSDoc code examples and bullet lists collapse into one line of prose. The website shows '```ts const pine = ... ```' inline and lists as ': - `probe-faster`: ... - `probe-not-faster`'. Paragraph breaks also vanish, which makes most long paragraphs on these pages.
- evidence: tools/lib/api-docs.ts:74 (`flat` joins every line) used by summaryOf at :120-124. Sources with real blocks: packages/impostors/src/load.ts:33-38, packages/engine/src/scene/time-of-day.ts:210-221.
- proposedEdit: Keep block structure: split the summary on blank lines, keep fenced blocks and list items, and join lines only inside one prose paragraph. Use flat only for table cells.
- generatedSource: tools/lib/api-docs.ts

Verdict: survives

## Evidence

- tools/lib/api-docs.ts:74 defines `flat`, which replaces every newline (blank lines included) with one space. `summaryOf` (:120-124) and the per-file summary (:324) pass the whole comment through it. `renderReference` writes the symbol summary as one line (:494).
- The sources do hold blocks. packages/impostors/src/load.ts:29-38 has a blank-line paragraph break and a fenced `ts` example. packages/engine/src/scene/time-of-day.ts:204-221 has two paragraphs and a nine-line fenced example. packages/engine/src/gpu/webgpu/draw-path-probe.ts:52-64 (`DrawPathReason`) and packages/engine/src/sketch/ui.ts:57-61 (`LabelTransform`) are bullet lists.
- The generated pages show them flattened: impostors.md `loadImpostorAtlas` ends "... from a bake: ```ts const pine = ... ```"; scene.md `timeOfDay` is one 190-word line with the code inline; engine.md `DrawPathReason` and the worker-fallback reason type read ": - `probe-faster`: ... - `probe-not-faster`: ..."; ui.md `LabelTransform` reads "... in the scene. - `'screen'` ... - `'world'` ...". In GFM, the inline triple backticks become a code span and the list markers stay as plain hyphens, so the reader sees neither a code block nor a list.
- Long paragraphs (stats.json, as facts): of the nine on impostors, scene and engine, at least five come from merged source paragraphs or lists: impostors:135 (two source paragraphs), impostors:318 `mergeFarGeometry` (two), scene:108 (three), scene:485 `timeOfDay` (two plus code), engine:71 `DrawPathReason` (list). impostors:20, scene:144 and engine:47 are single source paragraphs and are not caused by this. "Most" holds, narrowly.
- Severity high is fair: a broken code example on a reference page blocks a reader who copies it.

## Notes for the fix

- `tableCell` (api-docs.ts:476) only escapes pipes; it does not join lines. Member summaries go into table rows at :498, so once `summaryOf` keeps line breaks, the table path must apply `flat` (or reject block content) itself, or the tables break. A member summary that holds a fenced block cannot sit in a table cell at all; the check at :466 could flag that.
- The per-file summary at :324 uses `flat` too and needs the same treatment.
- Expectations in tools/lib/api-docs.test.ts (around :178-190) assume flat summaries and will need updating.
- The website contract and the writing rules are not broken by the edit; it restores the source author's own structure.
