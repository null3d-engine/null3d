# Verdict: api-2-readability-27

## Finding as given

```json
{
 "page": "api/quality",
 "anchor": "## Quality events, line 188",
 "category": "scan-order",
 "severity": "low",
 "claim": "The page uses quality.onChange four times before its own section explains it, and that section comes last.",
 "evidence": "onChange is used at lines 27, 87, 104 and 180; it is explained at line 190.",
 "proposedEdit": "Move '## Quality events' to just after '## Switching presets'. Make line 190 a list of when the handler runs.",
 "generatedSource": "",
 "id": "api-2-readability-27",
 "slice": "api-2",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- docs/api/quality.md: `quality.onChange` appears at lines 27 (intro example), 87 (Switching presets), 104 and 113 (frame-budget governor), and 180 (Texture memory). "## Quality events" is at line 188, with the explanation at line 190. Only "Related pages" and "API reference" follow it. The claim's facts hold.
- The intro (line 13) says the sketch can "hear when either changes", but it does not link to the Quality events section. Nothing on the page points a reader forward to it.
- The proposed move is half right. If the section goes just after "## Switching presets", lines 27 and 87 still come before it. The moved section would also refer forward to things the page has not yet explained: "shadow step of the frame-budget governor", the budgets' `onScale` functions, and "the texture memory budget". The scan-order problem moves to the section itself.
- The "make it a list" part holds. Line 190 is one paragraph with three triggers, one exclusion, the return value, a cost tip and a note about preset pipelines.
- Line 190 is also wrong about the governor, and the finding does not say so. It says the handler runs "after each shadow step of the frame-budget governor". In the code, `applyGovernedSteps` (packages/engine/src/sketch/runner.ts:1588-1604) calls `quality.governed()` after every governor step: levels of detail, shadows, bloom, ambient occlusion, screen-space reflections, contact shadows and fog. Line 104 of the page, and the `governor` TSDoc (packages/engine/src/sketch/quality.ts:246), say the same: the handlers run after each step except a step of the render scale. The doc comment on `governed()` (quality.ts:594-596) uses the same narrow "shadow settings" wording. Any list written from line 190 must fix this.
- The API reference row for `onChange` (docs/api/reference/quality.md:83, from the TSDoc on `onChange` in packages/engine/src/sketch/quality.ts:287) names only settings changes. The other triggers are in the `governor` and `textureMemory` rows. This is a smaller gap of the same kind.

## Corrected claim

The page uses `quality.onChange` at lines 27, 87, 104, 113 and 180 before its own section at line 188. Nothing points forward to that section. Moving the section just after "Switching presets" does not fix the order, because two uses still come before it and the section then refers forward to the governor, budgets and texture memory. Line 190 also says that handlers run only after the governor's shadow steps. In fact they run after every governor step except a render-scale step.

## Corrected edit

Keep "## Quality events" where it is, after the sections it refers to. In the intro (line 13), link "hear when either changes" to [Quality events](#quality-events). Rewrite line 190 as a list of when the handler runs, linking the sections above:

- At the start of the first frame after `quality.set` or `quality.setPreset` changes the settings or the preset. After a preset change, that frame waits for its pipelines, so objects that the handler makes for the new preset appear with it.
- After each step of [the frame-budget governor](#the-frame-budget-governor), apart from a step of the render scale.
- After the [texture memory](#texture-memory) budget drops mip levels or asks for them again.

Then add, in plain text: a step of the [budgets](#budgets-for-the-sketchs-own-systems) calls their `onScale` functions, not these handlers. `onChange` returns a function that removes the handler. Keep handlers cheap. They run when quality changes, not every frame.

Optionally, widen the `onChange` TSDoc in packages/engine/src/sketch/quality.ts:287 and the `governed()` comment at quality.ts:594-596 to match.
