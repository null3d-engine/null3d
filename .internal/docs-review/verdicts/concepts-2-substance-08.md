# concepts-2-substance-08

## Finding as given

- page: concepts/quality-presets
- anchor: ## The frame-budget governor: diagram lines 291-298 vs list lines 302-311
- category: contradiction
- severity: medium
- claim: The diagram numbers four steps from 1 (budgets and render scale) to 4 (filter). The list numbers ten steps from 1 (levels of detail) to 10 (fog). So "step 2" means two different steps, and the diagram leaves out six of the governor's steps.
- evidence: docs/concepts/quality-presets.md:293-297, 302-311; packages/engine/src/quality/governor.ts:1-9.
- proposedEdit: Remove the numbers from the diagram nodes, and add a last node "Then bloom, ambient occlusion, reflections, contact shadows, far animation and fog, one step each". Or number the list from 2 so that the render scale is step 1 in both.

Verdict: survives

## Evidence

- docs/concepts/quality-presets.md:292-297: the Mermaid chart numbers its nodes "1. Sketch budgets ... render scale", "2. Levels of detail", "3. Far shadow cascades", "4. Shadow filter". It stops there.
- docs/concepts/quality-presets.md:302-311: the list numbers "1." levels of detail, "2." far shadow cascades, "3." shadow filter, then 4-10 bloom, ambient occlusion (two steps), reflections, contact shadows, far animation, fog.
- So "2" is levels of detail in the chart and far shadow cascades in the list; "3" and "4" shift the same way. The chart shows 4 of the 11 kinds of step.
- packages/engine/src/quality/governor.ts:1-9 confirms the full order: budgets and render scale in turn, then threshold, far cascades, shadow filter, bloom base, ambient occlusion scale and removal, contact shadows, far animation interval, fog slices. The chart's last node (shadow filter) is not the last step, so a reader of the chart alone gets a wrong picture.
- The prose at line 300 says "detail, the live shadow settings and the effects' settings", but nothing on the page says the chart is partial. The mismatch is not handled elsewhere.

## Corrected edit

Use the first option: drop the numbers from the chart nodes and add one last node, for example `effects["Then bloom, ambient occlusion,<br/>reflections, contact shadows,<br/>far animation and fog, one step each"]`, linked from the filter node with "still over budget". The second option (start the list at 2) alone fixes the numbering clash but leaves the chart missing six steps, so it is not enough by itself.
