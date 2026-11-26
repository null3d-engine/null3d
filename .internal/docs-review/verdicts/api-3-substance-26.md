# api-3-substance-26

## Finding as given

- page: api/splats
- anchor: line 142 "offers the Quality control at run time"; lines 212-213 `feature` and `draw`; line 227 "which a material that reads the scene's depth makes"
- category: unclear; severity: low
- claim: "The Quality control" is a demo page control, not an engine term. `feature` and `draw` are listed with no meaning. Line 227 reads as if the user must add a depth-reading material.
- evidence: docs/api/splats.md:142, 212-213, 227; "Quality control" appears nowhere else in docs/.
- proposedEdit: 142: "A scene that lets the user change the preset during play passes capacity for the highest preset". 212: "`feature` is the add-on's feature and `draw` its feature draw ([Add-on feature draws](feature-draws.md))". 227: "The cards read the scene's depth copy, which costs one full-screen pass and four bytes a pixel, shared with every material that reads depth."

Verdict: partly

## Evidence

- Line 142 holds. "Quality control" appears only at docs/api/splats.md:142 in docs/ and in no package source. It matches the demo pages' "Quality" radio group (examples/lib/showcase-effects.ts:292). The proposed wording fits.
- Line 227 holds. The splat material declares `sceneInputs: ['sceneDepth']` itself (packages/splats/src/system.ts:257), so the cards cause the copy. The page's wording can be read as "you must add such a material". docs/api/materials.md:813-814 confirms one copy per frame, made while any material that declares the input draws, at one full-screen pass and four bytes a pixel. So "shared" is correct.
- Lines 212-213 hold only in part. `total`, `drawn`, `chunks` and `loaded` are also in that list with no meaning, so `feature` and `draw` are not special cases. The Related pages section (lines 255-258) already says what the feature draw and the feature description are, and the API reference page (reference/splats.md) carries the TSDoc for both fields (system.ts:118-121). The gap is that the sentence does not link the field names to those pages. The proposed edit links `draw` but gives `feature` no link.

## Corrected claim

Line 142 uses a demo control name as if it were an engine term. Line 227 hides the fact that the splat cards are the material that makes the depth copy. The list at lines 212-213 names fields with no meaning, `feature` and `draw` among them. The Related pages and the API reference explain them, but the list does not point there.

## Corrected edit

- 142 and 227: as proposed.
- 212-213: "`feature` is the add-on's feature ([Add-on feature descriptions](features.md)) and `draw` is its feature draw ([Add-on feature draws](feature-draws.md)). [The API reference](reference/splats.md) describes the other members." The TSDoc in packages/splats/src/system.ts stays as it is.
