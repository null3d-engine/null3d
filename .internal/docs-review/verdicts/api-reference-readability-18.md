# api-reference-readability-18

## Finding as given

```json
{
 "page": "api/reference/quality",
 "anchor": "`QualitySettings` line 137; `governor` line 177",
 "category": "structure",
 "severity": "medium",
 "claim": "48 settings in one 3,326-word table in name order. The governor cell describes the step-down order as one long chain of clauses.",
 "evidence": "QualitySettings 48 rows; 5 cells over 90 words; governor 163 words, 8 sentences.",
 "proposedEdit": "Group settings in the member index by area (resolution, shadows, lighting, post effects, levels of detail, culling). governor: keep the first sentence and the last three; move the step-down order into @details as a numbered list.",
 "generatedSource": "packages/engine/src/quality/presets.ts",
 "id": "api-reference-readability-18",
 "slice": "api-reference",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- The table has 48 rows and about 3,330 words (docs/api/reference/quality.md, lines 137-185). This holds.
- "In name order" is wrong. The rows follow the order of declaration in packages/engine/src/quality/presets.ts (the QualitySettings interface, from about line 515). That order is already loosely by area: resolution and textures, shadows, post effects, lighting, levels of detail, sky, governor, then the settings that only `createEngine` sets. The generator does not sort members.
- "5 cells over 90 words" is wrong. Three cells pass 90 words: governor (163), gpuOcclusion (120), lodShadowThreshold (98). subsurfaceSamples is exactly 90.
- The governor cell is 163 words and 8 sentences (line 177; source presets.ts lines 747-759). This holds. It is the hardest cell to read on the page.
- The step-down order is already on the same page and on the linked written page:
  - The `QualityGovernor` section intro and its member rows list the steps in order (lines 108-127).
  - docs/api/quality.md, "The frame-budget governor" section (line 102 and the rules at lines 165-171), gives the same order in prose, and the reverse order on the way back up.
  So the order does not need a new block. The governor cell can point to these places.
- The proposed edit does not work as written:
  - There is no `@details` tag. tools/gen-docs.ts and tools/lib/docs.ts have no support for a collapsible block in TSDoc.
  - The block format in the website contract needs blank lines and a Markdown body. A GFM table cell holds one line only. A `<details>` block with a numbered list cannot sit inside a member row.
  - "Keep the first sentence and the last three" drops the one-line gist ("when frames take too long it lowers settings one step at a time"). It also drops the sentence that says the governor raises the settings again in reverse order. With only "Whether the frame-budget governor runs" left, the cell no longer says what the governor does.
- Grouping the member index by area has some value, but the table is already loosely grouped. Real groups need a generator change (sub-tables or a group column), and no heading can go inside a table. The cost to a reader now is small. The clearer split is "changes during play" against "fixed at start": depthPrepass, gpuOcclusion, parallax and softParticles change during play but sit among the start-only settings at the end of the table.

## Corrected claim

The 48-row QualitySettings table follows declaration order, which is already loosely by area. Three cells pass 90 words. The governor cell (163 words, 8 sentences) repeats the step-down order, which the QualityGovernor section of the same page and the governor section of docs/api/quality.md already give.

## Corrected edit

In packages/engine/src/quality/presets.ts, shorten the governor doc comment (about lines 747-759) to the gist and a pointer. No block is needed:

"Whether the frame-budget governor runs. When frames take too long, it lowers the render scale, a sketch's budgets and then other settings one step at a time, and raises them again in reverse order once frames have time to spare. `quality.governor` reports its steps, in the order that `QualityGovernor` lists them. False keeps the render scale at `maxRenderScale` and the other settings as set, as benchmarks and captures need. It changes during play."

Optional, low severity: to group the table, move the four live settings (depthPrepass, gpuOcclusion, parallax, softParticles) above the start-only settings in the interface, so that every row from antialias down is "set at start, `set` does not take it". Drop the area-grouping proposal unless the generator gains group support.
