# concepts-2-substance-15

## Finding as given

```json
{
 "page": "concepts/render-graph,concepts/shadows",
 "anchor": "render-graph diagram line 15 (\"GPU-driven path only\") and line 76 (\"a device that draws directly\"); shadows line 420",
 "category": "term-before-definition",
 "severity": "medium",
 "claim": "Neither term is explained or linked. A reader cannot tell which devices take the direct path, or that the job workers then cull on WebGPU too.",
 "evidence": "docs/concepts/culling.md:38; docs/concepts/backends.md:35.",
 "proposedEdit": "Diagram: \"Culling<br/>on WebGPU, unless the device draws directly\". Line 76 and shadows 420: \"On a device that draws directly ([Culling](culling.md#how-each-path-culls): some Apple GPUs, after a start-up measurement), ...\".",
 "generatedSource": "",
 "id": "concepts-2-substance-15",
 "slice": "concepts-2",
 "role": "substance"
}
```

Verdict: partly

## Evidence

- render-graph.md:15: the diagram label is "Culling<br/>GPU-driven path only". The phrase "GPU-driven" appears nowhere else in docs/. The page never defines it. This half holds.
- render-graph.md:76 and shadows.md:420 both say "On a device that draws directly". Neither page defines the phrase or links to culling.md#how-each-path-culls. Neither page names the devices. This half holds.
- The second half of the claim does not hold for those two lines. render-graph.md:76 says "the job workers list them on WebGPU too". shadows.md:420 says "the job workers test the casters on the CPU, as on WebGL2". So the reader is told that the job workers cull. Only the diagram leaves that out.
- The finding misses a third spot with the same gap. render-graph.md:45, the passes table row "Culling", says "on WebGPU only". On a direct-draw device this pass does not run on WebGPU either.
- Code check: packages/engine/src/gpu/webgpu/draw-path-probe.ts:59 and :95 skip the probe unless the device is an Apple GPU in Safari or in any browser on iPhone and iPad. culling.md:38 matches this. "Some Apple GPUs" in the proposed edit is loose. The rule is by browser, not by GPU model.
- Both pages are hand-written, not generated, so no generated source applies.

## Corrected claim

The diagram's "GPU-driven path only" (render-graph.md:15) and "a device that draws directly" (render-graph.md:76, shadows.md:420) are never defined or linked. A reader cannot tell which devices take the direct path. Lines 76 and 420 do say that the job workers then cull. The passes table row at render-graph.md:45 ("on WebGPU only") has the same gap.

## Corrected edit

- render-graph.md:15 diagram: `culling["Culling<br/>on WebGPU, except on direct draws"]`.
- render-graph.md:45 table, Kind cell: "Compute, one pass per view (the camera's, and each shadow cascade's and tile's), on WebGPU unless the device draws directly".
- render-graph.md:76 and shadows.md:420: "On a device that draws directly (an Apple GPU in Safari, or any browser on iPhone and iPad, where a start-up measurement finds direct draws faster: see [Culling](culling.md#how-each-path-culls)), ...".
