# Verdicts: api/feature-draws (shots and demo links)

## Shots

### feature-draw-clouds: keep, change the source
- The picture helps. It shows the page's own example (soft discs from a feature draw) and the opaque and transparent frame points side by side.
- The source is wrong. The shot does not need a script. The test page already has a checked-in picture of this view: tests/image/references/chrome-real-gpu/webgpu/feature-draw.png. The compat and webgl2 folders hold the same view.
- The test page (tests/pages/sketches/feature-draw-sketch.ts) makes an opaque cloud of 24 small discs (softness 0.35) and, in front, a blended cloud of 15 larger discs (softness 1, band normal, order 0). Both are addFeatureDraw calls.
- Alt text: the back discs are smaller and firmer, not sharp. Suggested alt: "Two clouds of colored discs: small, firm discs behind and larger, soft discs in front."

### splats-priory: keep
- The reference exists: tests/image/references/chrome-real-gpu/webgpu/demo-splats.png. It shows the Bolton Priory scan.
- The splats add-on really draws with scene.addFeatureInstances (packages/splats/src/system.ts) from a description with frame 'resolve' (packages/splats/src/feature.ts). So it is a real use of "many copies of one shape" at the resolve point.
- The picture alone shows a priory, not copies of a shape. The caption must say that each splat is one row of a single instance batch, drawn at the resolve point.
- Page conflict to report: the Limits section says a large splat scene "is not this hook" and points to compute instances, but the shipped splats add-on uses this hook. The caption must not contradict the page, so the page text needs a fix too.

## Demo links

### Many copies and the resolve point -> splats: keep, change the code
- The demo exists in examples/demos.ts (name 'splats'), and it really shows the concept through the splats add-on.
- The demo has no code value, so the link code must be "splats/", not "splats": https://github.com/null3d-engine/null3d/tree/main/examples/splats/
- The link points to the demo sketch, which calls createSplats. The addFeatureInstances call itself is in the add-on, so the link text should say that the add-on makes the draw.

## Concepts said to have no demo

- "a single feature draw": confirmed. No demo or add-on calls addFeatureDraw. Only the feature-draw test page does.
- "band and order of a blended draw": confirmed. The splats add-on draws at the resolve point with no band or order. The grass add-on sets band 'normal', but its draw is opaque and uses compute instances. No demo places a blended draw with a band and order.
