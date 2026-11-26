# api-reference-substance-08

## Finding as given

```json
{
 "page": "api/reference/grass",
 "anchor": "grass.md:115 `PLANT_SWAY_DISTANCE`",
 "category": "wrong-claim",
 "severity": "high",
 "claim": "The text says 'a governor step that lowers the preset shortens the distance with it'. The frame-budget governor never changes the preset; only quality.setPreset does.",
 "evidence": "packages/engine/src/quality/governor.ts:1-9 lists every governor step (budgets, render scale, LOD threshold, shadow cascades and filter, bloom, AO, contact shadows, far characters, volumetric fog); no preset. quality.md:78 and :81 agree. Claim source: packages/grass/src/sway.ts:9-10.",
 "proposedEdit": "'A sketch reads it from the engine's preset. Read it again, and call `grass.setSwayDistance`, after `quality.setPreset` changes the preset.'",
 "generatedSource": "packages/grass/src/sway.ts",
 "id": "api-reference-substance-08",
 "slice": "api-reference",
 "role": "substance"
}
```

Verdict: partly

## Evidence

- The page says it: docs/api/reference/grass.md:115, "a governor step that lowers the preset shortens the distance with it". Source: packages/grass/src/sway.ts:8-10 (TSDoc on `PLANT_SWAY_DISTANCE`).
- The governor never changes the preset. packages/engine/src/quality/governor.ts:1-9 lists its steps (budgets, render scale, LOD threshold, far cascades, shadow filter, bloom, AO, contact shadows, far character poses, fog slices) and says "It never changes a setting that is fixed while a preset runs". grep of governor.ts finds no preset change. So the claim about the governor holds.
- Nothing changes the distance by itself. The value only reaches the grass when sketch code calls `grass.setSwayDistance(swayDistanceFor(quality.preset))` (packages/grass/src/grass.ts:553; examples/contact-shadows/garden.ts:383-386 does it in a `quality.onChange` handler). So "shortens the distance with it" also wrongly suggests an automatic change.
- The finding's "only quality.setPreset does" is wrong. The preset check also lowers the preset after the sketch's setup, in the first frames of play by default: docs/concepts/quality-presets.md:94 ("the engine lowers the preset by one ... The sketch's `quality.onChange` handlers hear of each lighter preset"), docs/api/quality.md:75 ("when it lowers the preset after the setup"), docs/api/quality.md:33.
- So the proposed edit, which ties the re-read to `quality.setPreset` only, would leave the grass at the start preset's distance when the preset check lowers the preset. The garden example's pattern (re-read in `quality.onChange`) covers both cases.

## Corrected claim

The text wrongly says a governor step lowers the preset and that the distance follows on its own. The governor never changes the preset. The preset changes when the preset check lowers it in the first frames of play, or when the sketch calls `quality.setPreset`; in both cases the sketch must pass the new distance with `grass.setSwayDistance`.

## Corrected edit (packages/grass/src/sway.ts, TSDoc of `PLANT_SWAY_DISTANCE`)

"The distance from the camera out to which plants and grass sway, in meters, for each preset. A sketch reads it from the engine's preset. Read it again in a `quality.onChange` handler and pass it to `grass.setSwayDistance`, because the preset check and `quality.setPreset` can change the preset during play. The frame-budget governor does not change the preset."
