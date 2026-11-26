# porting-shaders-substance-12

## Finding as given

- page: porting/threejs-mapping
- anchor: every section table; longest notes: CSS2DRenderer / CSS3DRenderer (409 words), LOD / SimplifyModifier (351), Raycaster.setFromCamera (283), MeshPhysicalMaterial transmission (276), AnimationMixer (273)
- category: wall-of-text
- severity: medium
- claim: 76 of 194 notes are over 80 words, each inside one table cell, on a 22,000-word page. A reader looking up one API reads a paragraph in a narrow cell. Most of it is correct detail that implementers need.
- evidence: docs/data/threejs-mapping.json notes field lengths; tools/lib/docs.ts:423-428 renders notes into the cell
- proposedEdit: Add a 'details' field to JSON entries. Keep 'notes' to one or two sentences: the action. The generator writes under each section's table one block per entry with details: `<details><summary>Technical details: CSS2DRenderer and CSS3DRenderer</summary> ... </details>`. Move the rest of each long note there.
- generatedSource: docs/data/threejs-mapping.json; tools/lib/docs.ts

Verdict: survives

## Evidence

- docs/data/threejs-mapping.json has 194 entries. 76 notes are over 80 words. The longest is 409 words (CSS2DRenderer / CSS3DRenderer). The notes hold 15,944 of the page's 21,943 words (stats.json gives 21,943).
- tools/lib/docs.ts:423-428 (mappingMarkdown) writes each entry as one table row, with the whole note in the Notes cell through tableCell. Nothing else on the page holds the detail, so no other section already handles it.
- stats.json lists 0 long paragraphs for this page, because its counter skips table rows. The wall of text is real but sits where the paragraph check cannot see it.
- I read the CSS2D/CSS3D, LOD and Raycaster notes. Each opens with the action a porter needs, then runs on with dense facts (bounds-based distance, shadow-map level choice, threshold defaults, CSS3D example coverage). That split matches the proposed notes/details split.
- The proposed edit fits the rules. A block below the table is the only workable place: GFM tables cannot hold a multi-line `<details>` body. The summary uses the "Technical details: ..." form. The body is prose, with no headings and no nested blocks.
- The same mappingMarkdown function writes the porting skill's api-mapping.md (docs.ts:596), and the skill's JSON copy is the whole file (docs.ts:597). So the skill keeps every fact, and "one source per fact" (AGENTS.md "Docs and skills stay in sync", item 1) still holds.
- Entries have an `id` field, so the generator can key each block to its row.

## Refinements (not a change of verdict)

- In a 36-row table, a reader who finds a row cannot tell that a block exists below. The generator should end each shortened note with a fixed pointer, such as "Details below the table." It should also write the blocks in row order, with the summary naming the three.js API exactly as the row does.
- When the details move, re-check them against the writing rules. Some of the moved text describes the engine's own test setup rather than what a porter does. Examples are the CSS3D note's "Each port's test draws ... compares the two layers" sentences, and similar wording in the OIT, bloom, LUT, Points and Line notes. A collapsed block is not a reason to keep text that is not for engine users.
- Run the humanizer pass on both fields, as the writing rules require for mapping notes.
