# api-reference-substance-30

## Finding as given

- page: api/reference/geometry
- anchor: geometry.md:480 `MeshGeometry`
- category: wrong-claim
- severity: low
- claim: The summary promises 'its id in the engine core', but no id member appears in the table.
- evidence: geometry.md:476-493; packages/engine/src/scene/resources.ts:419.
- proposedEdit: 'A mesh the engine can draw: its bounds, its morph targets, its levels of detail and the calls that change its vertices.'
- generatedSource: packages/engine/src/scene/resources.ts

Verdict: survives

## Evidence

- geometry.md:480 says "A mesh the engine can draw: its id in the engine core, its bounding radius, and its morph targets."
- The member table (geometry.md:482-493) lists radius, morphTargets, morphTargetNames, center, destroy, updateVertices, levels, setLevels and buildLevels. It has no id member.
- In the source, the core id is private (`liveId`) and its getter is tagged `@internal` ("The engine core's id. Throws E1101 once the mesh is destroyed."). The generator leaves internal members out, so a reader cannot use the id the summary promises.
- No other place on the page or in docs/ names a mesh id for users. Only line 480 does.
- The summary also leaves out half of what the class does: `center`, the levels of detail (`levels`, `setLevels`, `buildLevels`), `updateVertices` and `destroy`. So it is both wrong and incomplete.
- The proposed edit names only public parts. "Its bounds" covers `radius` and `center`. It keeps no internal process words and adds no block, so it breaks no writing rule. Severity low is right: the wrong word costs a reader a moment of search, no more.

## Edit to make

In the TSDoc comment above `export class MeshGeometry` in packages/engine/src/scene/resources.ts, change the summary to the proposed text:

"A mesh the engine can draw: its bounds, its morph targets, its levels of detail and the calls that change its vertices."
