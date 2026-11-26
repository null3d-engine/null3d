# porting-shaders-readability-04

## Finding as given

- page: porting/threejs-mapping
- anchor: Every table; Docs column; e.g. WebGLRenderer / WebGPURenderer row (line 27)
- category: scan-order
- severity: medium
- claim: Calls, options and values in the three.js, null3D and Notes columns are plain text, such as createEngine({ canvas, sketch }) and antialias: true, so code cannot be told from prose. The Docs column shows a page ID in code font, such as `getting-started/first-scene`, so the reader cannot click to the page. Notes cite pages as bare IDs, such as "(concepts/post-processing)".
- evidence: threejs-mapping.md line 27; tools/lib/docs.ts line 429 renders `${e.docs}` in backticks; JSON notes hold code with no backticks.
- proposedEdit: In the JSON, put code spans in backticks in three, target and notes. In mappingMarkdown, render the Docs cell as a relative link with the page title from PAGES, such as [First scene](../getting-started/first-scene.md). Turn bare page IDs in notes into links, by hand or in the generator.
- generatedSource: docs/data/threejs-mapping.json and tools/lib/docs.ts (mappingMarkdown)

Verdict: partly

## Evidence

- The claim about the page holds. docs/porting/threejs-mapping.md line 27 shows `createEngine({ canvas, sketch })`, `antialias: true` and `'msaa'` as plain text, and the Docs cell as `` `getting-started/first-scene` ``. Of 194 entries in docs/data/threejs-mapping.json, 0 `three` cells, 4 `target` cells and 10 `notes` cells use any backticks. Bare page IDs sit in 4 notes: `(guides/performance)`, `(guides/car-paint)`, `(concepts/post-processing)`, `(guides/debugging)`.
- tools/lib/docs.ts line 427 (not 429) writes the Docs cell as `` \`${e.docs}\` ``. tableCell (tools/lib/api-docs.ts:476) only escapes pipes.
- Other porting pages link by title with relative paths (docs/porting/react-three-fiber.md:107, 175, 176, 187), and the generated docs/pages.md links each page (line 17). So this page is the odd one out.
- The proposed edit breaks the skill copy. mappingMarkdown(mapping, true) writes skills/null3d-port-threejs/references/api-mapping.md from the same rows (tools/lib/docs.ts:595-596). SKILL.md:17-18 tells the agent that each row "gives ... a doc ID", and that it reads pages by ID at `node_modules/@null3d/engine/docs/<id>.md`. A relative `../getting-started/first-scene.md` link does not resolve from the skill's references folder. The skill's analyzer (skills/null3d-port-threejs/scripts/analyze-threejs.mjs:239, 274) also prints and returns `e.docs` as an ID. Linking bare IDs by hand in the JSON notes has the same problem, because the notes feed the skill copy and the copied JSON too.
- Backticks on code spans in the JSON text are safe for both outputs: the skill table and the analyzer pass the text through as Markdown.

## Corrected claim

The page shows code as plain text and the Docs column as an ID in code font that the reader cannot click; four notes cite pages as bare IDs. In the skill copy, the ID is the intended form, because the skill tells agents to read pages by ID.

## Corrected edit

1. In docs/data/threejs-mapping.json, put backticks around the code spans only (calls, option names, values, file paths) in `three`, `target` and `notes`. Keep the prose outside the backticks, because many cells mix code and prose.
2. In mappingMarkdown in tools/lib/docs.ts, when `forSkill` is false, render the Docs cell as `[<title from PAGES>](../<id>.md)`. When `forSkill` is true, keep `` `<id>` ``. Keep `docs` in the JSON as a page ID.
3. Leave the four bare IDs in the JSON notes as IDs. In mappingMarkdown, when `forSkill` is false, turn a parenthesized page ID that is in PAGES into a link with that page's title. Never hand-write links in the JSON.
