# api-3-substance-25

## Finding as given

- page: api/vertex-draws
- anchor: line 24 "You cannot change the shape per copy"; line 150 "A raycast tests the small triangle"; E1108 row "more draws than the scene holds"
- category: unclear; severity: low
- claim: The rain example makes each copy differ by its index, so line 24 reads as false; it means every copy has the same vertex count and no data of its own. Line 150 suggests a raycast can hit the draw, but the triangle has all corners at 0 and is never hit. The 256-draw limit is not stated.
- evidence: packages/engine/src/scene/scene.ts:5221-5236 (degenerate triangle, VERTEX_DRAW_MAX_DRAWS); packages/engine/src/generated/core.ts:200-202 (256 draws).
- proposedEdit: Line 24: "Every copy has the same vertex count and no data of its own: the shader makes each one from its index." Line 150: "Raycasts and picks never hit a vertex draw." E1108: "more than 256 draws in a scene".

Verdict: partly

## Evidence

- Line 24. The reason the finding gives is wrong. In the rain example each copy differs only by its place: every streak has the same shape (docs/api/vertex-draws.md:48-57). So the example does not contradict the sentence. But the sentence is still loose. The shader makes every vertex from the instance index, so it can give each copy a different shape (other sizes, or corners folded together to make a triangle instead of a card). What is fixed is the vertex count and the lack of per-copy data. Line 152 ("one shape and one material") uses "shape" for the vertex template, which is the same loose sense.
- Line 150. Holds. The draw's object uses a mesh whose three corners are all at 0 (packages/engine/src/scene/scene.ts:5227-5231). The ray-triangle test (crates/null3d-core/src/bvh/mesh.rs:121-144) computes a determinant of 0 for that triangle, so every side mode rejects it. A degenerate triangle is never hit. The page's advice ("do not use a draw to hit-test") is right, but "tests the small triangle" lets a reader think a hit near the object's origin is possible. Picks call the same raycast (scene.ts:5929), and line 151 says the pick pass draws no vertex draw, so "Raycasts and picks never hit a vertex draw" is accurate.
- E1108. Holds. The limit is 256 (packages/engine/src/generated/core.ts:200; check at scene.ts:5219-5223, which throws when the scene already holds 256). The page states the other two limits as numbers on line 104, so the missing number is an inconsistency. The API reference page also gives no number.

## Corrected claim

Line 24 is loose, not false by the rain example: the rain copies differ only by place. The real gap is that a shader can vary a copy's shape from its index; only the vertex count is shared and no copy has data of its own. Lines 150 and the E1108 row hold as stated.

## Corrected edit

Line 24: "Every copy has the same vertex count and no data of its own: the shader makes each one from its index. You cannot hit-test the shapes, and the whole draw sorts as one object in the transparent pass." (Keep the hit-test and sort clauses, which the proposed edit drops.)
Line 150: "Raycasts and picks never hit a vertex draw, so do not use one to hit-test."
E1108 row: "... or more than 256 draws in a scene". Optionally also add the 256-draw limit to the counts section beside the other limits on line 104.
