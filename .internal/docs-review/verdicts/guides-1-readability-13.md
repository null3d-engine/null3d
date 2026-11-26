# Verdict: guides-1-readability-13

## The finding as given

- page: guides/first-use-shaders
- anchor: feature table, lines 15-57
- category: scan-order
- severity: medium
- claim: 43 rows in shader-manifest order mix post effects, material features and scene features. Two rows are for the engine's own tests (texcoords, instance_index). Several cells are 2-3 sentences. A reader who wants to know what to preload must read all 43.
- evidence: lines 22 and 52 'only in the engine's own tests'; rows come from Object.keys(manifest.first_use) in firstUsePage.
- proposedEdit: Give each FIRST_USE_DOWNLOADS entry a group (Post-processing, Materials, Lights and shadows, Sky and background, Meshes and animation, Transparency, Engine tests) and print one table per group under an H2, sorted by name. Put the test-only features last with one line saying a page never needs them. Keep each cell to one sentence.
- generatedSource: tools/lib/first-use-docs.ts

Verdict: partly

## Evidence

- The table has 41 rows, not 43. Lines 17 to 57 hold 41 feature rows, and the shader manifest (`crates/null3d-shaders/shaders.toml`) has 41 `[first_use.*]` tables.
- The order claim holds. `firstUsePage` in `tools/lib/first-use-docs.ts:108-111` maps the features in the order that `manifestFeatures` (`:81-86`) returns, which is `Object.keys` of the manifest's `first_use` table. The rows mix post effects (bloom line 24, dof 27), materials (bump 55, hash 51), sky (sky 45, clouds 46) and engine passes (views 32, effect_groups 23) with no grouping.
- The test-only rows hold: line 22 (`'texcoords'`) and line 52 (`'instance_index'`) say "only in the engine's own tests". They sit in the middle of the table, where a reader must read past them.
- Several cells have two or three sentences: lines 23, 29, 30, 37, 38, 41, 42, 46, 47, 49, 54, 56, 57.
- The page has one heading only (stats.json: headings = ["# Shaders that load on first use"]), so nothing helps a reader scan the 41 rows.
- Not handled elsewhere: `guides/loading-screens.md:200` links here as the full list and names only two examples.

## What does not hold in the proposed edit

1. "Keep each cell to one sentence" would cut useful detail. Most second sentences say what the reader sees until the shaders are built: "Its mesh draws nothing until they are built" (line 54), "It casts none until its shaders are built" (line 41), "The view shows the background color until the sky is built" (line 47), "Until its shaders are built, the engine draws without it" (line 57). That is the main reason to choose a feature for `preload`. The task's rule says to keep correct, dense detail. A `<details>` block cannot go inside a table cell in a way the website collapses well, so a block is not the fix here either. Move the second sentence into its own column instead.
2. The proposed groups leave several features with no home: `picking`, `views`, `effect_groups`, `color_copy`, `motion`, `occlusion`, `cluster_levels`. Add an "Engine passes" (or "Scene passes and picking") group, or put `effect_groups` under Post-processing and `cluster_levels`, `occlusion`, `lod_fade` under Meshes.
3. The generator already fails when the manifest and the descriptions differ (`firstUseProblems`, `:89-105`). The group must be part of each entry so that the same check catches a feature with no group.

## Corrected claim

The 41 rows come in shader-manifest order, with no grouping and no headings. Post effects, material features, sky features and engine passes mix, and the two test-only rows (lines 22 and 52) sit in the middle. A reader who looks for the features of one kind must scan every row.

## Corrected edit

In `tools/lib/first-use-docs.ts`, change each `FIRST_USE_DOWNLOADS` entry to an object `{ group, downloads, untilBuilt? }`. Use these groups: Post-processing, Materials, Transparency, Lights and shadows, Sky and background, Meshes and animation, Engine passes, and Engine tests. Make `firstUseProblems` fail on a feature with no group. In `firstUsePage`, print one H2 in sentence case for each group, in a fixed order, with Engine tests last. Under each H2, print a table sorted by feature name with three columns: Feature, Its shaders download, Until they are built. Put a cell's second sentence in the third column (empty when there is none). Under "Engine tests", one line says that a page never needs these features. Keep every sentence that has a fact. Split only where a sentence is over 25 words (line 33, line 46).

Separate issue on the same page, not part of this finding: line 31 (`'taa'`) ends with "(D-206)", which is a decision record number. The writing rules do not allow these numbers in docs/. The source is the `taa` entry at `tools/lib/first-use-docs.ts:25`.
