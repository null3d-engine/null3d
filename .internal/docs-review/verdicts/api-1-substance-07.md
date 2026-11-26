# Verdict for api-1-substance-07

## The finding as given

```json
{
 "page": "api/feature-draws",
 "anchor": "## A point cloud (lines 28-72)",
 "category": "unclear",
 "severity": "medium",
 "claim": "The heading and diagram promise a point cloud, but the example makes one four-vertex quad in one draw. The reader learns how to draw many only in a later section.",
 "evidence": "docs/api/feature-draws.md:28, 58-68; tests/pages/sketches/feature-draw-sketch.ts:1-5 draws two clouds.",
 "proposedEdit": "Rename the heading 'One soft disc' and add one sentence that 'Many copies of one shape' turns it into a cloud, or make the example call addFeatureInstances with the same shader.",
 "generatedSource": "",
 "id": "api-1-substance-07",
 "slice": "api-1",
 "role": "substance"
}
```

Verdict: partly

## Evidence

- docs/api/feature-draws.md:28: the heading is "A point cloud". Lines 58-68: one call to `addFeatureDraw` with 4 positions and 6 indices. That is one square, so one disc. The heading claim holds.
- docs/api/feature-draws.md:13-22: the diagram does not mention a point cloud. It shows the description, the WGSL, the vertices and the uniforms going into `scene.addFeatureDraw`, then the draw list and the GPU. The "diagram promises a point cloud" part is wrong.
- Nothing between lines 28 and 116 tells the reader that the example draws one point. Line 116, "Many copies of one shape", is the first place that makes a cloud (`instances: 40_000`). It reuses the `points` shader and the `description`, so a forward pointer fits.
- tests/pages/sketches/feature-draw-sketch.ts: the sketch makes its clouds with `addFeatureDraw` alone. Its `cloudVertices` helper packs one square per point into one set of arrays, so one draw holds the whole cloud. So the claim "the reader learns how to draw many only in a later section" is too narrow: one draw can hold many squares. The page just does not show it.
- No page links to the `#a-point-cloud` anchor, so a rename breaks no link.

## Corrected claim

The heading "A point cloud" promises many points, but the example draws one square, so one soft disc. The diagram makes no such promise. The page never says that the example is one point, or how to get many: either pack many squares into the vertex arrays of one draw, or use `addFeatureInstances` (the "Many copies of one shape" section). Severity: low to medium. The code is correct; only the label and a pointer are missing.

## Corrected edit

Rename the heading to "One soft point" (or "A first draw"). After the code block, add one sentence such as: "This draws one point. For a cloud, put one square per point in the vertex arrays, or draw many copies of this shape with `scene.addFeatureInstances`, as [Many copies of one shape](#many-copies-of-one-shape) shows." Do not turn this example into an `addFeatureInstances` call. That would repeat the later section and hide the basic `addFeatureDraw` call that the page is about.

A related bug on the same lines, outside this finding: the example's WGSL (lines 41-42) uses `const` for values computed at run time (`length(input.uv ...)`, `smoothstep(... material.softness ...)`). WGSL `const` needs a value known when the shader compiles, so the shader does not compile. The sketch uses `let` for both lines. The page should use `let` too.
