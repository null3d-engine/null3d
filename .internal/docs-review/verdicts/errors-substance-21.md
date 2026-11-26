# errors-substance-21

## Finding as given

- page: errors/E1224
- anchor: "scene.overrideMaterial received a sprite, point or line material."
- category: wrong-claim, severity: low
- claim: The code refuses sprite, line and particle shading. A points batch uses sprite shading, so its message says 'sprite material'. A particle buffer's material is also refused, but the page does not list it.
- evidence: scene/scene.ts:1888-1892 (batchOnlyShading). scene/sprites.ts:152-153 (points use SHADING_SPRITE). scene/scene.ts:5283-5284 (particle buffers use SHADING_PARTICLE).
- proposedEdit: Cause: 'scene.overrideMaterial received the material of a sprite, points, line or particle batch. The message calls a points material a sprite material.' Link api/scene.
- generatedSource: packages/engine/src/errors/codes.ts

Verdict: partly

## Evidence

- docs/errors/E1224.md and errors/codes.ts:246-252: the cause names "a sprite, point or line material". It does not name particles.
- scene/scene.ts:1888-1892: the check refuses sprite shading ('sprite'), the two line shadings ('line') and particle shading ('particle').
- scene/scene.ts:5710-5714: the setter throws E1224 with "got a <kind> material", so a particle material gives "got a particle material". scene/scene.test.ts:2123-2141 tests this case.
- scene/sprites.ts:139-153: one helper makes the material for both scene.createSprites and scene.createPoints, with sprite shading. So a point batch's material gives "got a sprite material". The claim holds.
- A reader can reach a particle material: particles.ts:605 makes `readonly object: Mesh` public, and Mesh has `readonly materials` (scene.ts:3100). The API page docs/api/reference/particles.md:43 documents `object`. So the missing particle case is real.
- The same omission is in a second source that the finding does not name. The overrideMaterial TSDoc at scene/scene.ts:5694 says "Throws E1224 for a sprite, point or line material". The same TSDoc says lower down that "particle systems keep their own materials". That TSDoc becomes docs/api/reference/scene.md. The test title at scene.test.ts:2123 also leaves out particles, but tests are not published.

## What does not hold in the proposed edit

- "Link api/scene" cannot go in the cause. tools/lib/docs.ts:442-448 puts the cause text into the page's front-matter summary and into the "What happened" section. Line 466 also puts it in a table cell of the error index. A Markdown link there would show as raw text in the summary. No error page has a link today.
- "particle batch" is not the engine's term. The API calls it a particle buffer (particles.md:38).

## Corrected edit

codes.ts E1224 cause: "scene.overrideMaterial received the material of a sprite batch, a point batch, a line batch or a particle buffer. Such a material draws the rows of its batch, or a sprite or line of its own, rather than the surface of a mesh, so it cannot stand in for every mesh of the pass. A point batch's material is a sprite material, so the message names it that way."

Also change the TSDoc at scene/scene.ts:5694 to "Throws E1224 for a sprite, point, line or particle material". Do not add a link to the cause.
