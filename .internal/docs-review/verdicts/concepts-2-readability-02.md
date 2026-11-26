# Finding concepts-2-readability-02

```json
{
 "page": "concepts/quality-presets",
 "anchor": "## The frame-budget governor (diagram 291-298, list 302-311)",
 "category": "contradiction",
 "severity": "high",
 "claim": "The diagram numbers 4 steps (1 budgets and render scale, 2 LOD, 3 far cascades, 4 shadow filter). The list numbers 10 steps from 1 = LOD. So 'step 3' means two different things, and the diagram leaves out list steps 4-10.",
 "evidence": "Diagram: 'detail[\"2. Levels of detail...\"]', 'far[\"3. Far shadow cascades...\"]', 'filter[\"4. Shadow filter...\"]'. List: '1. The lodThreshold ... doubles', '2. The far shadow cascades', '3. The shadow filter'.",
 "proposedEdit": "Remove the numbers from the diagram nodes. Draw 'Sketch budgets and render scale, in turn' -> 'Detail, shadow and effect steps, in the order below' -> 'One step back up, in reverse order'. Or add a list step 1 for budgets and render scale and renumber, so the two share numbers.",
 "generatedSource": "",
 "id": "concepts-2-readability-02",
 "slice": "concepts-2",
 "role": "readability"
}
```

Verdict: survives

## Evidence

- docs/concepts/quality-presets.md lines 291-298 (Mermaid): nodes "1. Sketch budgets ... render scale", "2. Levels of detail", "3. Far shadow cascades", "4. Shadow filter: 3 x 3 texels". The last node has no outgoing arrow, so the diagram reads as if the shadow filter is the final step.
- Same page lines 302-311: a numbered list of 10 steps that starts at 1 = the levels-of-detail threshold, 2 = far cascades, 3 = shadow filter, then 4-10 = bloom, ambient occlusion (two steps), reflections, contact shadows, far animation, volumetric fog. So the diagram's "3" is the list's "2", and the diagram's "4" is the list's "3". Bloom, ambient occlusion, reflections, contact shadows, far animation and fog are missing from the diagram.
- The code agrees with the list, not the diagram's implied end point. packages/engine/src/quality/governor.ts lines 1-8 give the order: budgets and render scale in turn, then the detail threshold, then far shadow cascades, the shadow filter, bloom's base, ambient occlusion, contact shadows, far animation interval, fog; and the reverse order going up.
- Nothing else on the page reconciles the two numberings. The paragraph between them (line 300) explains that budgets and render scale come first, but it does not say the list continues the diagram's count.

## Note on severity

The list directly under the diagram gives the full, correct order, so a careful reader recovers. "Medium" may fit better than "high". But the diagram on its own implies a four-step governor that ends at the shadow filter, which is wrong about behavior, so the issue is real.

## Edit

The first option in the proposed edit is the better one: drop numbers from the diagram nodes and make the middle node "Detail, shadow and effect steps, in the order below". It keeps the diagram short and lets the list be the only numbered source. Keep the first node's detail (budgets 0.25 lower and render scale 0.05 lower, in turn, down to minRenderScale), since the list does not repeat it.
