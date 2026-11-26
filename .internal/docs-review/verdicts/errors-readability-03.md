# errors-readability-03

## The finding as given

- page: errors/E1217
- anchor: page lines 13 and 17: 'A material factory or scene.createLines() received...', 'Give alphaMode 'opaque'...'
- category: wall-of-text
- severity: high
- claim: The page is 604 words. The cause is 254 words in 9 sentences and the fix is 320 words in 17 sentences, with sentences of 55 and 41 words. The rules for alpha modes, layered materials, transmission, diffuse transmission and custom WGSL run together, so a reader with one wrong option cannot find their rule.
- evidence: stats.json E1217: line 6 (254 words, 9 sentences), line 10 (320 words, 17 sentences). codes.ts line 195; fixes.ts line 54.
- proposedEdit: Cause: 'A material factory or scene.createLines() got an option value that it does not take, or two options that cannot go together. The message names the option.' Add a table Material | Refuses | Use instead, with rows for any material, custom, transmission, diffuse transmission and layered. Move the rules about which map shares a texture array into a details block, 'Technical details: which maps share a texture array'. Runtime fix: keep the alphaMode and blending values and the three.js mapping, then add 'The docs page gives the rule for each kind of material.' Put the rest in fixCases. Also think about splitting the code into one for alpha and blending values and one for map conflicts.
- generatedSource: packages/engine/src/errors/codes.ts (E1217); packages/engine/src/errors/fixes.ts (E1217)

Verdict: partly

## Evidence

- The claim holds. docs/errors/E1217.md line 13 is the 254-word cause and line 17 is the 320-word fix (stats.json gives them as lines 6 and 10 of the body). The longest sentences are 55 words (cause) and 41 words (fix, two of them). The writing rules cap sentences at 25 words.
- The ErrorEntry type (packages/engine/src/errors/codes.ts:10-21) documents `cause` as "What went wrong, in one or two sentences". The E1217 cause has 9.
- The cost is real beyond the page. fixes.ts:1-5 says the fix text "ends every EngineError message", and engine-error.ts:64 loads it at run time. So every E1217 message in the console carries all 320 words. The specific throw sites in packages/engine/src/scene/resources.ts (around line 3609 onward) already explain each conflict in the message itself, for example "got thicknessMap with specularColorMap; the thickness map samples the specular color map's texture array...". The long generic fix adds little to those messages.
- The cause also becomes the frontmatter summary and the row text in docs/errors/index.md (tools/lib/docs.ts:436-467, `summary` and `tableCell(entry.cause)`), so the 254 words repeat there too.

## What does not hold in the proposed edit

- "fixCases" does not exist. ErrorEntry has only title, cause, fix, example and since (codes.ts:10-21), and errorPage (tools/lib/docs.ts:436-459) renders only those.
- The table and the details block cannot go in `cause`: cause becomes the frontmatter summary and an index table cell, where a Markdown table or HTML block breaks. They cannot go in `fix` either: fix is plain text appended to runtime error messages.
- So the edit needs a new docs-only field on ErrorEntry in codes.ts (codes.ts is imported only by the docs generator and tests, per fixes.ts:3-4), and errorPage in tools/lib/docs.ts must render it. That field is where the table and the details block live.
- Splitting E1217 into two codes is an engine API change (new code, throw sites, tests), not a docs edit. Keep it as an optional note, not part of this finding's fix.

## Corrected edit

1. codes.ts E1217 `cause`: "A material factory or scene.createLines() got an option value that it does not take, or two options that cannot go together. The message names the option and the rule it breaks." (Two sentences, within the field's documented limit.)
2. fixes.ts E1217: "Give alphaMode 'opaque', 'mask', 'hash' or 'blend', and blending 'normal', 'additive', 'multiply' or 'weighted'. three.js's transparent: true is alphaMode: 'blend', and its alphaTest is alphaMode: 'mask' with alphaCutoff. For a conflict between two options, follow the message, or read the rule for each kind of material on the E1217 docs page."
3. Add an optional docs-only field (for example `details: string`) to ErrorEntry in codes.ts. Render it in errorPage in tools/lib/docs.ts after "How to fix it", under a heading such as "## Rules by kind of material". For E1217 it holds:
   - A table Material | Refuses | Use instead, with rows for any material, custom material (WGSL), transmission, diffuse transmission, layered material (clear coat, sheen, iridescence, anisotropy), and subsurfaceRadius.
   - One `<details><summary>Technical details: which maps share a texture array</summary>` block with the slot and array rules (transmissionMap samples the specular intensity slot's array, thicknessMap the specular color slot's; sRGB never shares with linear; which layer maps fill which array; layer map families). No headings inside it.
4. Every sentence 25 words or fewer; run the humanizer pass, as the writing rules require for error text.
5. Optional, separate from the docs fix: consider splitting the code into one for unknown values and one for option conflicts.
