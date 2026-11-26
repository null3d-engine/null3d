# Verdict: api-1-substance-01

## Finding as given

- page: api/features
- anchor: ## The fields, rows ready, resize, reset, destroy (lines 81, 87-89); ## Callbacks line 267
- category: contradiction
- severity: high
- claim: The fields table says the engine calls resize, reset and destroy, and that ready:false means no cost. The same page later says nothing in the engine calls resize or reset, the registry never calls destroy, and the draw, compute and sky-layer adapters never ask ready. Authors write callbacks that never run.
- evidence: docs/api/features.md:81, 87-89, 267, 271, 278-280. packages/engine/src/scene/features.ts:903 and :962 only check and copy resize; no caller exists in scene/ or render/ (only this.renderer.resize in render/loop.ts:417).
- proposedEdit: Rewrite each row to say who calls it, matching the 'Who calls it' table: resize/reset 'Kept on the description for the add-on's own use. The engine does not call it.'; destroy 'Called by the full-screen adapter's handle; otherwise the add-on calls it.'; ready 'Asked by the full-screen and instance adapters only.' Remove 'no cost at all' from lines 81 and 267 or limit it to those adapters. Keep one of the two tables.

Verdict: survives

## Evidence

- The page says both things. Lines 81 and 87-89 (fields table): `ready` "Called when the engine needs to know whether the feature draws. `false` means no cost at all"; `resize` "Called with the render size ... when it changes"; `reset` "Called with 'resize', 'camera' or 'exposure' ..."; `destroy` "Called once when the feature is removed or the engine stops". Line 267 repeats "no cost at all: no pass, no target, and none of its code or shaders downloads". Lines 269-270 tell the author to "Make targets of the new size", which also implies an engine call. Lines 278-280 say nothing in the engine calls `resize` or `reset`, the draw, compute and sky-layer adapters never ask `ready`, and only the full-screen handle calls `destroy`. Line 271 says "The registry does not call it". The page contradicts itself.
- The code agrees with the "Who calls it" table. In packages/engine/src/scene/features.ts:900-905 the description check only checks the callbacks, and :959-964 only copies them. A search of all packages finds no call to a description's `resize` or `reset`. `ready` is called only in scene/feature-effects.ts:193 and scene/feature-instances.ts:213 (with its listener at :319-363). `destroy` is called only in scene/feature-effects.ts:205.
- The page is hand-written (docs/api/features.md), so the edit goes there. The same false wording is also in the TSDoc on the description fields at packages/engine/src/scene/features.ts:349-352 (ready) and :386-391 (resize, reset, destroy). Editor hover text and any generated reference that uses those comments will mislead in the same way.
- Severity high holds. A reader who uses the fields table as the reference writes a resize handler or a `ready: () => false` draw and expects an effect that never happens.

## Corrected edit

Apply the row rewrites as proposed. Also fix the bullets at lines 269-270 so that they do not imply an engine call. Limit "no cost at all" at lines 81 and 267 to the full-screen and instance adapters. Do not drop either table: the fields table is the full list of every field, and the "Who calls it" table carries the caller detail. Keep the short caller wording in the fields rows and point to the Callbacks section. If the caller detail feels dense, the "Who calls it" table can go in a `<details>` block with the summary "Technical details: who calls each callback". Fix the matching TSDoc comments in packages/engine/src/scene/features.ts (around lines 349-352 and 386-391) in the same change.
