# api-3-substance-12

## The finding as given

- Page: api/scene
- Anchor: ## The light probe grid, lines 375-410 (bakeProbes and `bake.step(4)`)
- Category: missing-content
- Severity: medium
- Claim: bakeProbes has no options table. `samples` and `distance` are not named, and the page never says that step returns true once every probe is baked, or that bake.done and bake.finish() exist. The example's `!bake.step(4)` is unexplained.
- Evidence: packages/engine/src/scene/light-probes.ts:398-433 (box, spacing, samples 8-1024 default 64, distance default the box's diagonal, environment, environmentOptions, albedo); 623-643 (done, step(budget = 4): boolean, finish()).
- Proposed edit: Add a table: box (required), spacing (2), samples (64, 8 to 1024), distance (the box's diagonal), environment, environmentOptions, albedo. Then: "`bake.step(n)` bakes up to n probes and returns true once all are baked. `bake.done` counts them. `bake.finish()` bakes the rest at once and returns the grid."

Verdict: survives

## Evidence

- docs/api/scene.md:375-377 explain the bake in prose and give `spacing` its own paragraph. `environment`, `environmentOptions` and `albedo` appear only in the prose and the example. `box`, `samples` and `distance` have no description. The words `samples`, `distance`, `finish` and `done` do not occur in this section (grep).
- docs/api/scene.md:398 uses `!bake.step(4)` and :400 reads `bake.grid`. No sentence says what `step` returns, what the 4 means, or that `grid` exists.
- The page has 7 option tables for its other calls, so a missing table here is an inconsistency, not taste.
- Source agrees with the finding: packages/engine/src/scene/light-probes.ts:396-432 (the options and their defaults), :614-635 (`done`, `step(budget = 4)` returns true when every probe is baked, `finish()` loops `step(64)` and returns the grid).
- Mitigation found, but not enough: docs/concepts/lighting.md:335 says "`step` bakes a few probes a frame ... `finish` bakes the rest at once", without the return value. docs/api/reference/scene.md:72-95 and :322-334 list the options and the bake's members, linked only from the page's last line (scene.md:606). A reader of the example still meets an unexplained boolean.

## Refinement of the edit

The proposal is right, but it leaves the separate `spacing` paragraph (scene.md:377) beside a table that repeats it. Fold that paragraph into the table's `spacing` row and delete it. Also name `bake.grid`, which the example reads.

Table, after the paragraph at line 375:

| Option | Default | What it sets |
| --- | --- | --- |
| `box` | required | The box the probes cover, in the world, as `min` and `max` corners |
| `spacing` | 2 | The distance between probes along each axis, in meters, or one number for every axis. The grid starts at the box's least corner and takes as many probes as fit, at least two along each axis |
| `samples` | 64 | The directions cast from each probe, 8 to 1024 |
| `distance` | the box's diagonal | How far a ray reaches before it counts as the sky, in meters |
| `environment` | none | The environment whose light a hit surface sends back. Without one, the bake counts no bounce light |
| `environmentOptions` | those of `scene.setEnvironment` | The intensity and rotation that `scene.setEnvironment` got, so the bounce matches the scene |
| `albedo` | none | A function that gives a hit surface's color. Without it, the bake holds sky visibility and validity alone |

Then, before the example: "`bake.step(n)` bakes up to n probes, 4 by default, and returns true once every probe is baked. `bake.done` counts the probes baked so far. `bake.grid` holds the result. `bake.finish()` bakes the rest at once and returns the grid."
