# Verdict: api-reference-readability-12

## The finding as given

```json
{
 "page": "api/reference/features,api/reference/render,api/reference/materials,api/reference/scene,api/reference/engine,api/reference/geometry",
 "anchor": "features `defineFeature` line 65; render `addPass` line 173; materials `shader` line 142",
 "category": "wall-of-text",
 "severity": "medium",
 "claim": "Error rules are buried at the end of long prose, so a developer with an error code cannot find which call throws it and why.",
 "evidence": "97 'Throws', 'rejects with' or 'fail with' sentences. defineFeature packs ten E1223 conditions into one 90-word sentence. addPass lists E1220, E1215, E1216, E1502-E1505 in four sentences.",
 "proposedEdit": "Support @throws tags, one per code, rendered as an 'Errors' list under the member's H3 with each code linked to its error page. Make the E1223 conditions in defineFeature a bullet list.",
 "generatedSource": "tools/lib/api-docs.ts",
 "id": "api-reference-readability-12",
 "slice": "api-reference",
 "role": "readability"
}
```

Verdict: partly

## Evidence

What holds:
- The throw rules come at the end of long descriptions. In features.md line 65, the E1223 sentence in `defineFeature` has 84 words, which is far over the 25-word limit in the AGENTS.md "Writing docs" rules. The finding says 90 words. That number is a little high, but the point stands. In render.md line 173, the `addPass` cell ends with four sentences that list E1220, E1215, E1216 and E1502 to E1505. In materials.md line 142, the `shader` cell has the same shape.
- The six pages have about 100 sentences that say "Throws", "throws", "rejects with" or "fail(s) with" (features 8, render 17, materials 7, scene 27, engine 34, geometry 7). This agrees with the finding's count of 97.
- None of the six pages links an error code to its error page. Error codes appear 259 times in plain text and are linked 0 times. Hand-written pages do link codes, for example `](../errors/E1213.md)`.
- The generator (tools/lib/api-docs.ts) has no `@throws` support. Its list of known tags (line 99) holds only `category`, `internal`, `param` and `returns`. The `flat` helper (line 74) joins every comment onto one line, so a bullet list in a TSDoc comment cannot render now.

What is wrong:
- "A developer with an error code cannot find which call throws it" is false. The error code is the starting point, and every error page names the calls that throw it. The "What happened" text of docs/errors/E1223.md starts with "defineFeature(), FeatureRegistry.add(), addFeatureDraw(), post.addFeatureEffect(), scene.setSkyLayer() or a compute pass of render.addPass() got a description that it cannot take". E1215 starts with "materials.shader(), post.addEffect(), post.set() or scene.setSkyLayer()". E1220 starts with "render.addPass()". E1502 names render.addPass() and render.removePass(). The runtime messages also name the call, as in the E1223 example "FeatureRegistry.add() got the slot 'ao'". The real cost falls on a developer who reads the API reference to learn what a call refuses, not on one who has a code.
- The proposed edit does not fit the page layout. These pages have no H3 headings: top-level exports are H2 sections, and class and namespace members are rows in a "| Member | Description |" table (`renderSymbol`, api-docs.ts lines 486 to 502). Two of the three anchors, `Render.addPass` and `materials.shader`, are table cells. A GFM table cell cannot hold a bullet list or a `<details>` block, so an "Errors list under the member's H3" cannot go there.

## Corrected claim

Throw rules come as long run-on sentences at the end of member descriptions. The E1223 sentence in `defineFeature` has 84 words. The codes are not linked to their error pages. So a developer who reads the API reference cannot quickly see what a call refuses, or jump to the fix. A developer who starts from an error code is already served, because each error page names the calls that throw it.

## Corrected edit

In tools/lib/api-docs.ts, add `throws` to the known tags. Read one `@throws E1234 <short reason>` tag for each code, and render the tags in two ways:
- In an H2 section for a function, such as `defineFeature`, add a short "Errors" bullet list after the summary. Each item starts with the code, linked as `[E1223](../../errors/E1223.md)`, and gives one short reason.
- In a member table row, such as `Render.addPass` or `materials.shader`, end the cell with one inline line, for example "Errors: [E1220](../../errors/E1220.md), [E1215](../../errors/E1215.md), ...". Then take the throw sentences out of the summary. The error pages already list the full conditions, so the cell needs only the linked codes.

In packages/engine/src/scene/features.ts (`defineFeature`, line 992), move the E1223 conditions into `@throws` tags. If the full list of conditions stays on the API page, put it in a collapsible block below the summary, for example `<summary>Technical details: what E1223 rejects</summary>`, as a bullet list. The main text must still make sense when the block is closed. Never put this block in a table cell.
