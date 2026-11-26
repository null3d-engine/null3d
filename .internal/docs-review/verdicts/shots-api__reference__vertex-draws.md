# Verdicts: api/reference/vertex-draws

## Shots

None proposed. Nothing to check.

## Demo links

### VertexDraw -> rain/ (keep)

- The demo exists. `examples/demos.ts` has an entry named `rain`, titled "Rain from a vertex count", with no `code` value. So the link form `rain/` is correct: https://github.com/null3d-engine/null3d/tree/main/examples/rain
- The demo shows the concept. Its sketch (`examples/rain/sketch.ts`) calls `scene.createVertexDraw` with a WGSL shader, 6 vertices, 50,000 instances and a culling sphere, plus additive blending and no depth write. The shader makes every streak from the vertex and instance indices and `frame.time`. That is exactly what the `VertexDraw` text describes.
- Limits: the sketch never keeps the returned draw, so it does not show `setCounts`, `setBounds` or `destroy`. It shows `VertexDrawOptions` and `VertexDrawBounds` better than the class members. The link is still right for the page as a whole.
- Source to edit: this page is generated. The link must go into the TSDoc comment in `packages/engine/src/scene/vertex-draws.ts` (the `VertexDraw` class comment, or better the `VertexDrawOptions` comment, since the demo shows those options). No reference page carries a demo link today, and the generator has no demo slot, so the link would be a plain Markdown link in the comment text.
- Better home: the hand-written page `docs/api/vertex-draws.md` already talks about rain (lines 24 and 124) and has no demo link. Put the link there as well; it fits that page more naturally than a generated member table.
- Reference images exist for this demo in all three tiers (webgpu, compat, webgl2) as `demo-rain.png`, if a later shot is wanted on the hand-written page.

## Concepts said to have no demo

None listed.
