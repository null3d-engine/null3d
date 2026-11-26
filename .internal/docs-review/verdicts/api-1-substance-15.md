# api-1-substance-15

## Finding as given

- Page: api/geometry
- Anchor: ## Meshes from arrays, the targets row (line 112); also 119, 135, 221, 256
- Category: unclear. Severity: medium.
- Claim: targets is "the position at a coarser level of detail ... which a generated shape's material reads". The page never says which material reads it, when to give it, or what a generated shape is, yet it appears in four more rules.
- Evidence: docs/api/geometry.md:112, 119, 135, 221, 256.
- Proposed edit: Add one sentence of purpose and a link to the material that reads it. If no public material reads it, say so.

## Verdict: survives

## Evidence

- docs/api/geometry.md:112 says only "which a generated shape's material reads". Lines 119, 135, 221 and 256 give rules about `targets` (floats only, not with `morphTargets`, 16 bytes, no levels). No line on the page says what reads the values, when a reader should give them, or what a "generated shape" is. The page has no link to the shader docs for this array.
- The source TSDoc (packages/engine/src/scene/resources.ts:1570-1576) is clearer than the page: "for a shape that a custom material moves between levels of detail ... The material's `vertexOffset` reads them as `input.vertexRecord`." The reference page (docs/api/reference/geometry.md:469) carries that text, but the hand-written page drops the key fact.
- The reader of the values is a custom material's vertex offset, not one named material. docs/shaders/surface-functions.md:515 and :557 (section "## Vertex offsets", line 492) and docs/shaders/builtins.md:114 explain `input.vertexRecord` and point back to `geometry.fromArrays({ targets })`. So the explanation exists, but the geometry page does not link to it.
- The one engine user is the terrain package: packages/terrain/src/terrain.ts:745-752 passes `targets` to `fromArrays`, and packages/terrain/src/terrain.wgsl:50-66 reads `input.vertexRecord` for the block morph (docs/api/terrain.md:82 describes that morph). The terrain record holds the parent height, the block and a morph range, not a full position and an error. So the four numbers are free for the shape to define, as surface-functions.md:515 says ("or whatever the shape writes"). The geometry row presents one layout as fixed.

## Corrected edit

Replace the row text and add one sentence under the rules. For example:

- Row (line 112): `targets` | 4 numbers that a custom material's vertex offset reads, such as the position that the vertex takes at the next coarser level and that level's error |
- New rule: "`targets` is for a shape whose material moves its vertices between levels of detail, as the [terrain](terrain.md#how-it-works) does. The material's vertex offset reads the four numbers as `input.vertexRecord` ([Vertex offsets](../shaders/surface-functions.md#vertex-offsets)). Leave it out unless your vertex offset reads it."

Drop the phrase "generated shape", which the page never defines. No public built-in material reads `targets`; only a custom `vertexOffset` does.
