# porting-shaders-readability-23

## Finding as given

- page: shaders/surface-functions
- anchor: ## Vertex offsets bullets at lines 531-532 (castsStill, swayDistance); ## Shadows bullets at lines 553, 554, 557
- category: structure
- severity: low
- claim: The last two vertex offset bullets are about shadow cascade caching, and the last Shadows bullet is about the vertex record, an input of vertex offsets. Lines 553 and 554 are details of how the caster builds and culls.
- evidence: surface-functions.md lines 528-557.
- proposedEdit: Move the vertex record bullet (557) into Vertex offsets, under the vertexRecord row. Move the castsStill and swayDistance bullets into Shadows as "Shadows of moving vertices". Put bullets 553 and 554 in a technical details block, keeping one sentence: "Give flat single-sided casters `doubleSided: true`, or they cast nothing."

Verdict: partly

## Evidence

- Line 557 (the vertex record bullet) sits in "## Shadows" but says nothing about shadows. It is about a vertex offset input. The `vertexRecord` row of the input table (line 515) already says the mesh carries it with `geometry.fromArrays({ targets })`. So the move holds, and the bullet should shrink to the two new facts: the record is bound only where the WGSL reads it, and it holds either the shape's four numbers or morph data, never both.
- Line 553 is build internals (caster builds, fragment stage on both GPU paths, the engine's depth template). A technical details block fits it.
- Line 554 holds one rule a user must act on (`doubleSided: true` for flat single-sided casters) plus its reason. Keeping the rule in the main text and moving the reason into a block is fine.
- The castsStill / swayDistance move does not hold. The "## Shadows" section (lines 534-557) is about the coverage function of masked casters. Lines 531-532 start with "Shadows follow the moved vertices" and are the shadow consequences of writing a vertex offset; a reader writing `fn vertexOffset` finds them where they need them. The API page uses the same placement: docs/api/materials.md lines 843-845 put castsStill and swayDistance right after the vertex offset text. Moving them into a coverage section would mix two topics and split the vertex offset story. This is taste with no real reader cost.

## Corrected claim

Line 557 is misplaced in Shadows and partly repeats the `vertexRecord` row at line 515. Line 553 is implementation detail that suits a technical details block. Lines 531-532 belong where they are: they describe how a vertex offset affects shadows, and the Shadows section is about the coverage function.

## Corrected edit

1. Move line 557 into "## Vertex offsets", as a bullet after line 530 or folded into the `vertexRecord` row: "The engine binds the vertex record only where the WGSL reads `input.vertexRecord`. The record holds either the shape's four numbers or a morphed mesh's morph data, never both." Drop the repeat of `geometry.fromArrays({ targets })`, which the row already gives.
2. Keep lines 531-532 in "## Vertex offsets".
3. Replace line 554 with "Give a flat single-sided caster `doubleSided: true`, or it casts nothing." Put line 553 and the reason from line 554 (the shadow pass culls front faces) in one block after the Shadows bullets:

<details>
<summary>Technical details: how the shadow casters build</summary>

WGSL that declares a coverage function gets the caster builds, with a fragment stage on both GPU paths. A material that declares neither a vertex offset, a coverage function nor a surface alpha casts its whole shape through the engine's own depth template. The shadow pass culls the front faces of single-sided geometry, so a flat single-sided caster is culled whole.

</details>
