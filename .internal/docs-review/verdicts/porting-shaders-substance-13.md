# porting-shaders-substance-13

## Finding as given

- Page: porting/threejs-mapping
- Anchor: Docs column of every row, such as `concepts/quality-presets`; notes such as '(concepts/post-processing)'
- Category: structure. Severity: medium.
- Claim: The Docs column shows a page ID in code font, not a link, and notes cite page IDs as raw text. Readers cannot follow them.
- Evidence: tools/lib/docs.ts:427; docs/porting/threejs-mapping.md:255
- Proposed edit: Render the column as a link with the page title from PAGES, such as [Quality presets](../concepts/quality-presets.md). Turn bracketed page IDs in notes into links in the generator, or write links in the JSON.
- Generated source: tools/lib/docs.ts; docs/data/threejs-mapping.json

Verdict: survives

## Evidence

- tools/lib/docs.ts:427 writes the last cell as `` `${e.docs}` ``: inline code, never a link. The generated page confirms it on every row (for example line 30, `concepts/quality-presets`). The page has no Markdown links at all.
- Notes cite page IDs as plain text: "(concepts/post-processing)" at line 255, "(guides/custom-passes, a soft outline glow)" at line 260, and also (guides/performance), (guides/debugging), (guides/car-paint).
- Every Docs id on the page resolves to an existing file under docs/, so links would work. PAGES (tools/lib/docs.ts:80) holds a title for each id.
- The hand-written porting pages (for example docs/porting/react-three-fiber.md:107, 176, 187) link with titles and relative paths, so the mapping page is the odd one out. On the website, a code-font id is a dead end for the reader.

## Correction to the edit

The same function, mappingMarkdown, also writes the port skill's copy (skills/null3d-port-threejs/references/api-mapping.md, tools/lib/docs.ts:596). A relative link such as ../concepts/quality-presets.md does not resolve from that folder. Make the links only when forSkill is false, and keep the plain page id in the skill copy. For the notes, convert "(area/page)" and "(area/page, text)" in the generator for the docs page only, matched against PAGES ids so that "(three/webgpu)" and "(three/tsl, ...)" stay plain text. Do not write links into threejs-mapping.json, because the skill also ships that JSON.

Separate issue, not part of this finding: a note on the FXAAPass row cites "(D-206)", a decision record number, which the writing rules ban from docs/.
