# api-1-substance-26

Finding as given:

```json
{
 "page": "api/feature-instances",
 "anchor": "## Limits, line 151",
 "category": "term-before-definition",
 "severity": "low",
 "claim": "'A device that draws the scene directly' is not explained here. The engine page calls this engine.capabilities.directDraws.",
 "evidence": "docs/api/feature-instances.md:151; docs/api/engine.md:155.",
 "proposedEdit": "'A device whose engine.capabilities.directDraws is true (Page API) fixes that choice at its first frame.'",
 "generatedSource": "",
 "id": "api-1-substance-26",
 "slice": "api-1",
 "role": "substance"
}
```

Verdict: survives

## Evidence

- docs/api/feature-instances.md:151 says "A device that draws the scene directly fixes that choice at its first frame." Nothing on the page explains the direct path, names `directDraws`, or links to docs/api/engine.md or docs/concepts/backends.md (grep found no such link).
- "that choice" has no antecedent in the item. The sentence before it is about creating the draw in setup, so it is not clear what choice is fixed.
- docs/api/engine.md:155 names `engine.capabilities.directDraws` ("whether the device draws buckets directly") and says only an Apple GPU in WebKit takes that path.
- docs/concepts/backends.md:118 explains the path best: WebKit on an Apple GPU, measured at start-up, reported by `directDraws`, and false on WebGL2, which always draws directly.
- docs/errors/E1506.md (linked from the item) explains part of it: "The direct path counts every draw on the CPU and keeps no indirect draw." A reader gets this only after clicking through, and it still does not say which devices take the path.
- The page is hand-written (not generated), so no source field is needed. The same vague phrase is in packages/engine/src/errors/fixes.ts:163-164 (the E1506 fix text), but that page gives the cause above it, so it reads better there.

The issue is real and low severity is right. Readers on Safari or on an iPhone or iPad are the ones who hit E1506. They cannot tell from this page that the limit applies to them.

## Corrected edit

The proposed edit is right in idea but needs fixes. "(Page API)" is not a link and means nothing to a reader. "Fixes that choice" stays vague. Also, `directDraws` is false on WebGL2, so the flag is the right test only for WebGPU. Replace the second sentence of the item at line 151 with:

"On an Apple GPU in Safari, or in any browser on iPhone and iPad, the engine can draw the scene directly, with no indirect draws. `engine.capabilities.directDraws` is then true (see [GPU tiers and backends](../concepts/backends.md)). Such a device sets its draw list at its first frame."

Keep the next two sentences: "Such a device cannot take a draw whose count the GPU writes later. The frame then fails with E1506."
