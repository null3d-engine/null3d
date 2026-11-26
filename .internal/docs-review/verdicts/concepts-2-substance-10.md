# concepts-2-substance-10

## Finding as given

- page: concepts/render-graph
- anchor: ## Scene inputs table, lines 86-93; ## Motion vectors, line 104
- category: unclear; severity: medium
- claim: Two of the four inputs cannot be used: no pass makes 'normals', and "the adapters" (a term the page never explains) refuse 'motionVectors'. Line 104 names temporal anti-aliasing and motion blur as users of motion vectors, then says "Today the motion debug view reads them". That reads as a promise of features that the engine does not have.
- evidence: docs/concepts/render-graph.md:86-93, 104; AGENTS.md: a page makes no promise of a later feature.
- proposedEdit: Keep 'sceneColor' and 'sceneDepth' in the table. Add: "The names 'normals' and 'motionVectors' exist, but no pass makes normals, and custom materials and effects cannot read motion vectors." Line 104: "Only the motion debug view, debug.view('motion'), reads them."

Verdict: partly

## Evidence

What holds:
- Line 104 names temporal anti-aliasing, motion blur and reflections that reuse the last frame, then says "Today the motion debug view ... reads them". The engine has no public motion blur. Temporal anti-aliasing exists only as an internal prototype for measuring (packages/engine/src/scene/post.ts:531-535, marked @internal). The word "Today" and the list of absent users read as a promise. AGENTS.md "Writing docs" rule 10: "It makes no promise of a later feature."
- "the adapters" (line 93) is never explained on this page. The term is explained only on the linked features page (docs/api/features.md:11, 286-289).

What does not hold:
- The page does not hide that the two inputs are unusable. The table says "No pass makes them" for normals (line 90). The motionVectors row correctly says the motion pass makes them while the debug view shows it (line 91). Line 93 says effects read only sceneColor/sceneDepth and custom materials read only sceneDepth. So it is a wording issue, not a misleading table.
- Dropping the normals and motionVectors rows from the table is wrong. They are real values of the public `SceneInput` type (packages/engine/src/scene/features.ts:57). Validation accepts the names and gives a specific E1217 message for them (packages/engine/src/scene/resources.ts:3797-3834). The motionVectors row tells a reader where the data comes from. Cutting the rows removes correct facts.
- The proposed sentence "custom materials and effects cannot read motion vectors" is incomplete. Compute passes refuse every scene resource (packages/engine/src/scene/render.ts:1300-1303 and 1347-1350). Full-screen effects refuse it (packages/engine/src/scene/feature-effects.ts:112-117). Custom materials refuse it (resources.ts:3833-3837). Feature draws and instance draws do not check `reads` at all (docs/api/feature-draws.md:76, feature-instances.md:152). They accept the name but bind nothing. So "the adapters refuse" is also not exact for draws.

## Corrected claim

Line 104 lists features the engine does not offer and says "Today", which reads as a promise. Line 93 uses "the adapters" without explaining it, and the claim is not exact: effects, compute passes and custom materials refuse 'motionVectors', but feature draws accept the name and bind nothing. The table itself is accurate and should keep all four rows.

## Corrected edit

- Keep all four table rows.
- Line 93: replace "No pass makes `'normals'`, and the adapters refuse `'motionVectors'`." with "No pass makes `'normals'`, so a feature that reads them gets a neutral value. No custom material, full-screen effect or add-on pass gets the motion vectors bound."
- Line 104: "Motion vectors record how far each pixel's surface moved on the screen since the last frame. The motion debug view, `debug.view('motion')`, is the one public reader." Delete the sentence that names temporal anti-aliasing, motion blur and reflections.
