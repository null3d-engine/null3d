# api-3-substance-03

## The finding as given

- page: api/water
- anchor: ## The water object, line 224: "The reflection pass carries its own cadence now, so the call changes nothing"
- category: unclear
- severity: medium
- claim: The table says `update()` does nothing, yet both examples call it every frame. "Now" is changelog language. Line 38 says the ocean's reflection follows "the camera that `update()` follows", which is a different `update`, and the page does not tell them apart.
- evidence: packages/water/src/water.ts:214-218; docs/api/water.md:73-74, 324, 426.
- proposedEdit: Either remove water.update() from the object and the examples, or write "`update()` does no work. Call it once a frame so the sketch's loop stays the same." Drop "now". In "The ocean object" say that ocean.update() moves the mesh and is required.

Verdict: partly

## Evidence

- The row at docs/api/water.md:224 does say the call "changes nothing", and it uses "now". The examples at lines 74, 179 and 324 call `water.update()` each frame. That part of the finding holds.
- The claim that the call does nothing is false in the code, so the page row and the TSDoc it copies (packages/water/src/water.ts:214-217) are wrong, not only unclear. The body of `update()` at packages/water/src/water.ts:585-606 does real work each frame:
  - With a wind field, it points the surface at the wind texture's current layer and uploads the air settings when a gust is sent (lines 587-595).
  - It applies the lowest quality tier's reflection cadence (line 600, `cadence.lowest`).
  - It follows the camera for the reflection cadence (line 601, `cadence.follow`). In packages/water/src/cadence.ts:84-105, `follow()` reads the camera pose and switches the reflection to every frame while the view moves. This is the same work the ocean's `update()` does.
  - It draws the debug bounds of each body when that option is on (lines 603-606).
- So the proposed edit is wrong both ways. Removing `water.update()` would stop the wind lift and gusts, the lowest-tier cadence and the moving-camera reflection. Writing "does no work" repeats the false claim.
- The third part of the edit is already done. The ocean table at docs/api/water.md:426 says `update()` moves the mesh about the camera and must be called once each frame after the camera moves.
- Line 38 sits in the paragraph that starts with `createOcean`, so its `update()` reads as the ocean's. The ambiguity is small. Since both `update()` calls follow the camera for the reflection, the sentence is also true of the river and lake.

## Corrected claim

The water object's `update()` row (docs/api/water.md:224) is wrong, not only unclear, and it uses changelog language. It says the call changes nothing. In fact the call follows the camera for the reflection's cadence, applies the lowest tier's cadence, carries the wind field's layer and gusts into the surface, and draws the debug bounds. The same wrong text is in the TSDoc at packages/water/src/water.ts:214-217. Severity should be high, because a reader who trusts the row may drop the call and lose the wind and the moving-camera reflection.

## Corrected edit

Replace the row at docs/api/water.md:224 with:

| `update()` | Follows the camera for the reflection's cadence, which draws in every frame while the view moves. It also carries the wind field's gusts into the surface. Call it once in each frame, after the camera and the wind move |

Rewrite the TSDoc at packages/water/src/water.ts:214-217 to the same effect, so the API reference page agrees. Optionally, at line 38 write "the camera that the ocean's `update()` follows". Leave the ocean table as it is.
