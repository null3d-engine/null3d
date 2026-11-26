# api-2-substance-07

## Finding as given

- page: api/impostors
- anchor: line 13, the paragraph before the Mermaid diagram
- category: term-before-definition
- severity: medium
- claim: The page opens with the demo and with 'the hand-over band', 'the far band' and an L key, before it says what an impostor is. The demo is named as examples/impostors with no link, and the page has no GitHub demo link at all. The diagram uses 'copy's turn' and 'octahedral grid' before they are explained.
- evidence: docs/api/impostors.md:13, 17-21; stats.json exampleLinks for api/impostors is empty; examples/impostors/sketch.ts:120-137 (L and T keys).
- proposedEdit: Start with the diagram and the paragraph now at line 24. Then: 'The [impostors demo](https://github.com/null3d-engine/null3d/tree/main/examples/impostors) draws a pine forest three ways by distance: meshes near, merged meshes per grid cell in the middle, and cards far out. Press L to draw the far trees as meshes and compare, and T to sweep the sun.' Define hand-over where handOverToCards is described.

Verdict: survives

## Evidence

- docs/api/impostors.md:13 is the first body paragraph after the version note. It names the demo as plain code text `examples/impostors`, uses "the far band" and "the hand-over band", and tells the reader to press L. What an impostor is comes only at line 24.
- stats.json gives `exampleLinks: []` for api/impostors. The page has no GitHub demo link.
- examples/demos.ts:969-984: the demo exists, its code value is `impostors/`, and its controls are T (sweep the sun) and L (far band as meshes or cards). examples/impostors/sketch.ts:119-137 matches.
- docs/api/impostors.md:17-19: the diagram says "octahedral grid" and "the copy's turn". A card's turn is first explained at line 24 and line 71; the octahedral fold at line 85. The term "copy" is never set up before the diagram.
- "hand-over" is not defined before line 224, where handOverToCards sets the distance bands.
- AGENTS.md "Writing docs": a concept page opens with a Mermaid diagram and a plain explanation. Moving line 24 up to follow the diagram fits that rule.

## Corrections to the proposed edit

The claim holds in full. The edit needs three fixes:

1. Link format. The demo's code value is `impostors/`, so the contract link is `https://github.com/null3d-engine/null3d/tree/main/examples/impostors/` (with the final slash).
2. Accuracy. The demo draws "one merged mesh per grid cell" in the middle (demos.ts summary, page line 13), not "merged meshes per grid cell".
3. The diagram still comes first after the reorder, so its terms still precede their definitions. Change its labels as well, for example "the octahedral grid of colors" to "a grid of colors, one view per direction", and "turns them by the copy's turn" to "turns them by the card's own turn about the world's up".

Corrected edit: Open with the diagram, relabelled as in point 3, then the paragraph now at line 24. Then write: "The [impostors demo](https://github.com/null3d-engine/null3d/tree/main/examples/impostors/) draws a pine forest three ways by distance: level-of-detail meshes near, one merged mesh per grid cell in the middle, and cards far out. Press L to draw the far trees as meshes and compare. Press T to sweep the sun." Drop the "hand-over band" sentence there, and say what the hand-over is in the handOverToCards section (line 224).
