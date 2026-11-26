# Shot and demo-link verdicts: api/reference/feature-draws

No shots and no demo links were proposed. Two concepts were said to have no demo. Both claims hold.

## Concepts said to have no demo

- FeatureDraw: confirmed, no demo. No sketch under examples/ calls `scene.addFeatureDraw`. The only caller outside the engine is the test page tests/pages/sketches/feature-draw-sketch.ts (image test "feature-draw"), which is not a demo in examples/demos.ts or a comparison, so the website contract gives it no link.
- FeatureDrawOptions: confirmed, no demo that shows it in its own code. The splats demo (code "splats/") draws through the splats add-on, which calls `scene.addFeatureInstances` with options that extend FeatureDrawOptions (shader, vertices, origin). But the demo's sketch only calls `createSplats`; the feature-draw call sits in packages/splats/src/system.ts, outside examples/. A link to examples/splats would not show a reader these options, so it is not a good link for this page. It would suit FeatureInstances at most, and only indirectly.
