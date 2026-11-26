# api-2-readability-23

## Finding as given

- page: api/impostors
- anchor: intro lines 13-24; line 248
- category: scan-order
- severity: low
- claim: The page opens with the demo's three distance bands and its L key. The diagram comes next, and only line 24 says what an impostor is. The demo is named twice by folder path, with no link.
- evidence: line 13 'The demo "Impostors" in `examples/impostors` draws a pine forest three ways by distance'; line 248 'The demo's bake in `examples/impostors/forest.ts` shows the whole loop.'
- proposedEdit: Reorder the intro: three sentences on what an impostor is, then the diagram, then the demo sentence with a link to https://github.com/null3d-engine/null3d/tree/main/examples/impostors/. Make line 248 a link too.
- generatedSource: (none; the page is hand-written)

Verdict: survives

## Evidence

- docs/api/impostors.md:13 opens the body with the demo: three distance bands, the L key and the hand-over band. A newcomer reads "hand-over band" and "cards baked from the pine" before any definition.
- docs/api/impostors.md:15-22 is the diagram. docs/api/impostors.md:24 is the first sentence that says why an impostor exists and what it is.
- Of the 40 or so pages in docs/api/, impostors is the only one whose body opens with a demo sentence. All others open with a definition sentence or with the diagram. So the order is an outlier, not a house style.
- docs/api/impostors.md:13 and :248 give the demo only as code paths. stats.json lists no example links for api/impostors.
- The demo exists: examples/demos.ts:970-980 has name 'impostors', code 'impostors/', and the L key. examples/impostors/forest.ts exists. The proposed URL matches the website contract.
- AGENTS.md "Writing docs": a concept page opens with a diagram and a plain explanation. This is an API page, so the rule is not binding, but the proposed order follows its spirit.
- The page is hand-written (not under docs/api/reference), so no generator source is needed.

## Refinement of the edit

- Take the opening sentences from the current line-24 paragraph (far objects cost triangles no one sees; an impostor is a baked card that faces the eye). Keep the rest of that paragraph after the diagram. Do not write a new definition. The line-24 paragraph is also on the long-paragraph list, so this split helps that finding too.
- Line 248: the website contract gives demo links as the demo folder (tree/main/examples/<code>), not a file. Link the folder and keep the file name as code, for example: "The bake in `forest.ts` of the [Impostors demo](https://github.com/null3d-engine/null3d/tree/main/examples/impostors/) shows the whole loop."
