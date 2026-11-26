# start-substance-28

## The finding as given

- page: getting-started/third-party-notices
- anchor: line 53 "smooths the moment transparency layer's edges"; line 19 "SMAA 1x"
- category: term-before-definition
- severity: low
- claim: A reader of a license page does not know what the moment transparency layer is. SMAA has a different name in the two tables.
- evidence: third-party-notices.md:19, :53, :84; the term is explained at concepts/quality-presets.md:208.
- proposedEdit: "SMAA 1x, the anti-aliasing of the optional moment transparency mode ([Moment transparency](../concepts/quality-presets.md#moment-transparency))". Use "SMAA 1x" everywhere.
- generatedSource: (none; hand-written page)

Verdict: survives

## Evidence

- docs/getting-started/third-party-notices.md:53 names "the moment transparency layer" with no link and no explanation. Nothing else on the page explains it.
- The name differs: line 19 (package table) and line 84 (Vite plugin table) say "SMAA 1x"; line 53 (engine table) says "SMAA". The engine's own notices file uses "SMAA 1x" too (packages/engine/THIRD-PARTY-NOTICES.txt:614, "follows the SMAA 1x reference implementation").
- The target anchors exist: docs/concepts/quality-presets.md:208 "### Moment transparency", and docs/api/materials.md:680 "### Moment transparency".
- Severity low is right: the page is about licenses, and the row still says the code is anti-aliasing, so no reader is misled.

## Corrected edit

The proposed edit is sound. Two small changes make it better:
- Keep the word "layer", which the other pages use. "Mode" is a new term.
- Link to docs/api/materials.md#moment-transparency, which describes the layer and how to turn it on. The quality-presets section itself sends readers there.

Line 53 becomes:
"SMAA 1x, the anti-aliasing of the optional [moment transparency layer](../api/materials.md#moment-transparency) | MIT | the renderer's moment layer tables and shaders"
