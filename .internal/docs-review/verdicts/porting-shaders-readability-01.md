# porting-shaders-readability-01

## Finding as given

- Page: porting/threejs-mapping
- Anchor: every section table; rows "CSS2DRenderer / CSS3DRenderer (HTML labels)" (line 281) and "LOD (addLevel) / SimplifyModifier" (line 209)
- Category: wall-of-text. Severity: high.
- Claim: The Notes cells are too long to read in a table. 69 of 194 notes run over 90 words and 25 over 150; the longest are 409, 351 and 283 words. One row is 2,817 characters. On a phone the table cannot be read.
- Evidence: docs/data/threejs-mapping.json entries[].notes; tools/lib/docs.ts mappingMarkdown writes each note into one cell with tableCell(e.notes). Row lengths: line 281 is 2,817 characters, line 209 is 2,480, line 215 is 2,127.
- Proposed edit: Give each entry a short `notes` (one or two sentences: what to do) and an optional `details` field. In mappingMarkdown, after each section's table, write one technical details block ("Technical details: <section> notes") with one bullet per entry that has details, led by the three.js name in code font. Example for LOD: notes "Levels belong to the mesh. A mesh made in code of 4,096 triangles or more plans its own levels; glTF levels come from `assets optimize --lod`." Fades, coverage, shadow levels, impostors and clusters go into the block.
- Generated source: docs/data/threejs-mapping.json (rendered by tools/lib/docs.ts mappingMarkdown)

Verdict: survives

## Evidence

- Counts check out against docs/data/threejs-mapping.json: 194 entries, 69 notes over 90 words, 25 over 150, longest 409, 351, 283 words.
- Row lengths check out in docs/porting/threejs-mapping.md: line 281 is 2,817 characters, line 209 is 2,480, line 215 is 2,127.
- tools/lib/docs.ts:421-431 (mappingMarkdown) writes every note into one table cell of a six-column table. Nothing else on the page holds the detail, so the only way to read it is inside the cell.
- A block placed after each table is the right shape. A `<details>` block cannot sit inside a table cell with Markdown in it, and the main text (the short note) still makes sense with the block closed. Bullets are not headings, so the block rules hold.
- I could not refute the claim. Only the example edit has flaws, below.

## Corrections to the edit

1. The LOD example note repeats the null3D column. The target cell on line 209 already says that a mesh made in code of 4,096 triangles or more plans its levels, and that glTF levels come from `assets optimize --lod`. A short note should add what the other columns do not say.
2. The short note must keep every fact a porter must act on. This means the three.js calls with no match and the behavior differences that change the result. Do not hide them in a collapsed block. 44 notes say "no match", "no equivalent", "has no" or "not supported". Examples:
   - LOD: "getCurrentLevel and autoUpdate have no match." Distance is measured to the nearest point of the bounds, so a large object switches later.
   - CSS labels: hidden labels get `visibility: hidden`, not `display: none`. There is no z-index by distance and no center. Give an element `pointer-events: auto` for clicks.
   So allow up to three short sentences, not a hard limit of two.
3. A better LOD note: "Levels belong to the mesh, and each object and instance picks its own level each frame. Distance is measured to the nearest point of the bounds, so a large object switches later. getCurrentLevel and autoUpdate have no match." Fades, coverage, shadow levels, level materials, setLevelBias, setDrawRange, impostors and clusters go into the block.
4. Other users of the same field: mappingMarkdown also writes the port skill's api-mapping.md (tools/lib/docs.ts:596), so the skill copy gets the blocks too, which is fine. The port skill's analyzer (skills/null3d-port-threejs/scripts/analyze-threejs.mjs:239) puts `e.notes` into its own report table. It should keep using only the short note. Then the analyzer's report gets shorter too, and an agent can read the details in api-mapping.md.
5. Optional: the null3D column is also long in some rows (line 209's target cell is about 400 characters). The same pass should keep that cell to the call to use.
