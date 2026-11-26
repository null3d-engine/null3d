# api-reference-substance-16

## Finding as given

- page: api/reference/geometry
- anchor: geometry.md:336-421 `LEAST_LEVEL_DISTANCE`, `levelAt`, `LevelBounds`, `levelDistances`, `LevelDistances`, `levelSwitchDistance`, `LevelView`
- category: unclear
- severity: medium
- claim: Seven exports describe the engine's level-picking rule ('the rule', 'a source', 'a part') but never say when a user calls them. The written geometry page does not mention them.
- evidence: packages/engine/src/scene/level-rule.ts:139-200; the only users are examples/showcase/creek/valley.ts and packages/terrain/src/quadtree.test.ts; docs/api/geometry.md has no mention.
- proposedEdit: Open levelAt's TSDoc with its use: 'Picks a level the way the engine does, for code that draws its own levels, such as a terrain or a custom draw.' Say 'an object or an instance row' for source and 'a mesh part' for part. Add a short section on docs/api/geometry.md that links them.
- generatedSource: packages/engine/src/scene/level-rule.ts

Verdict: partly

## Evidence

- The core claim holds. The generated page (docs/api/reference/geometry.md:336-421) uses "the rule", "a source" and "a part" with no definition, and no entry says why a user calls these functions. A grep of docs/ and skills/ finds the seven names only in docs/api/reference/geometry.md. docs/api/geometry.md "Levels of detail" (lines 226-279) and docs/concepts/lod.md do not name them.
- The purpose is written down, but only in the file's top comment (level-rule.ts:1-6), which is a plain comment and does not reach the docs: "a scene that budgets its triangles asks the same rule instead of copying it". The real caller matches that: examples/showcase/creek/valley.ts:225-254 calls `levelDistances` and `levelAt` to count how many triangles the plants draw at a camera position. It does not draw anything itself.
- The evidence is partly wrong: packages/terrain/src/quadtree.test.ts:29 declares its own local function named `levelAt` (the leaf level of a quadtree). It does not use the export.
- The proposed TSDoc text gives the wrong use. `levelAt` returns an index and draws nothing; the engine still picks and draws the level itself. "For code that draws its own levels, such as a terrain or a custom draw" would send a reader to these functions for a job they do not do. The use is to predict the engine's choice, for a triangle budget or a test, without copying the rule.
- "An instance row" is not the docs' term. docs/api/geometry.md:228 and :267 say "every object and instance batch that draws it".

## Corrected claim

The seven exports never say when a user calls them, and no written page names them. The only real caller is the creek showcase, which counts the triangles that a view will draw. The terrain quadtree test has an unrelated local function of the same name.

## Corrected edit

In packages/engine/src/scene/level-rule.ts:
- Open the `levelAt` TSDoc with: "Gives the level that the engine draws for an object or for one copy in an instance batch, so your code can count the triangles that a view draws, or check the engine's choice, without copying the rule."
- Open the `LevelView` TSDoc with one sentence that names the rule: "The engine's rule for levels of detail measures each source, an object or one copy in an instance batch, against this view." Say "a part of a mesh" where the text says "a part".

In docs/api/geometry.md, at the end of "Levels by hand", add one sentence in the main text and the formulas in a closed block:

"To know which level a mesh draws at a camera position, such as to count the triangles that a view draws, call `levelDistances` and then `levelAt`. They use the engine's own rule."

<details>
<summary>Technical details: how the engine picks a level</summary>

Body: the three switch distances from the level-rule.ts top comment (error × scale × factor / bias, distance × scale / bias, radius × P[1][1] / (coverage × bias)), where factor is the render height times P[1][1] over twice the threshold, and the two measured distances (halfway into the bounds, capped at twice the nearest distance, for an error; the nearest point for a distance or a coverage), with links to the reference entries.

</details>
