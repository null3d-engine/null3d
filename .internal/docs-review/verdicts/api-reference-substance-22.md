# api-reference-substance-22

## The finding as given

- page: api/reference/tasks, api/reference/debug, api/reference/grass, api/reference/water
- anchor: tasks.md:16 `= NO_TRANSFER`; debug.md:527 `= CHECK_MAX_FPS`; grass.md:112 `PLANT_SWAY_DISTANCE`; water.md `OCEAN_BANDS`
- category: missing-content; severity: low
- claim: Defaults name private constants (NO_TRANSFER, CHECK_MAX_FPS) that no page shows, and object constants show their type, not their values. The sway distances (8, 16, 24, 32 m) appear nowhere.
- evidence: packages/engine/src/shared/run-task.ts:18; packages/engine/src/quality/check.ts:18; packages/grass/src/sway.ts:14-19.
- proposedEdit: Print the constant's value when a default names a constant (`= []`, `= 60`). State object constants' values in TSDoc: '8 m at Low, 16 at Medium, 24 at High and 32 at Ultra.'
- generatedSource: tools/lib/api-docs.ts, packages/grass/src/sway.ts, packages/water/src/ocean.ts

## Verdict: partly

## Evidence

- `NO_TRANSFER` holds. tasks.md:16 prints `transfer: Transferable[] = NO_TRANSFER`. The constant is module-private (`const NO_TRANSFER: Transferable[] = []`, run-task.ts:18). No docs page names it, and docs/api/tasks.md does not mention the transfer list at all.
- `CHECK_MAX_FPS` holds in part. debug.md:527 prints `maxTargetFps = CHECK_MAX_FPS`. The constant is exported from quality/check.ts:18 but not from the package index (packages/engine/src/index.ts:97 re-exports only types from that file), so a user cannot import or look it up. The value is not lost, though: the linked guide, docs/api/debug.md:226, says the target is "the display's refresh rate, at most 60 frames a second". The reference row alone does not say 60.
- The sway distances claim is wrong. docs/api/grass.md:100 says "`swayDistanceFor(preset)` gives each preset's distance from `PLANT_SWAY_DISTANCE`: 8, 16, 24 and 32 meters from Low to Ultra." The reference page links to that guide on its first line (grass.md:10). Only the reference entry itself (grass.md:112-116) lacks the values.
- `OCEAN_BANDS` holds. water.md:163 prints `const OCEAN_BANDS: readonly OceanBand[]` and the text says only "a long swell, a wind sea and the chop on top". The values (tiles 512/128/32 m, heights 2.4/1.1/0.35 m, wind 12/9/6, direction 0.6/0.75/0.9, seeds 1-3; packages/water/src/ocean.ts:48-52) appear on no page. docs/api/water.md:406 also gives only "A swell, a wind sea and chop".
- "Object constants show their type, not their values" is true. tools/lib/api-docs.ts:463 prints `const <name>: <type>` from the checker. Literal constants show their value only because their type is a literal (e.g. geometry.md:339 `LEAST_LEVEL_DISTANCE: 0.001`). Parameter defaults are printed from the source node (api-docs.ts:86, `printer.printNode`), so an identifier default comes out as the bare name.

## Corrected claim

Two parameter defaults name constants that a user cannot import: `NO_TRANSFER` (an empty list, private) and `CHECK_MAX_FPS` (60, not exported from the package). No page gives the first. The second's value appears only in prose on the linked debug guide. Object constants print their type, so `OCEAN_BANDS`'s default band values appear on no page. The sway distances are NOT missing: the linked grass guide (docs/api/grass.md:100) gives 8, 16, 24 and 32 meters. Only the reference entry lacks them.

## Corrected edit

- In tools/lib/api-docs.ts, when a parameter default is an identifier that resolves to a `const` with a literal initializer (an empty array or a number), print that initializer instead of the name: `transfer: Transferable[] = []`, `maxTargetFps = 60`.
- In packages/water/src/ocean.ts, state the default bands in the `OCEAN_BANDS` TSDoc, one short sentence per band (for example "a 512 m swell 2.4 m high in a 12 m/s wind, a 128 m wind sea 1.1 m high, and 32 m chop 0.35 m high"). The seeds and headings are optional detail.
- The `PLANT_SWAY_DISTANCE` TSDoc line ("8 m at Low, 16 at Medium, 24 at High and 32 at Ultra") is optional polish. The value is already one click away on the linked guide.
