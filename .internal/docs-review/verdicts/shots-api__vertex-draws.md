# Shot and demo-link verdicts: api/vertex-draws (slice api-3)

General note: every demo reference image is 320 x 180 pixels, on all three tiers. On a docs page these are thumbnails. If the website shows them wide, recapture the same view larger.

## Shots

### rain: keep, with a small alt text change
- The file exists: tests/image/references/chrome-real-gpu/webgpu/demo-rain.png (also compat and webgl2). The manifest makes a `demo-<name>` test for every demo, so this is the rain demo's default view at its hold time.
- The demo's sketch (examples/rain/sketch.ts) makes 50,000 streaks with one `scene.createVertexDraw` call, 6 vertices and 50,000 instances, the same numbers as the page's example. So the caption "Fifty thousand rain streaks from one vertex draw" is true.
- The picture helps. It shows what one draw with no mesh data can make, which the text alone cannot show. It fits under "## Rain around the camera", beside the code that makes it.
- The picture is almost all streaks on black. The street, its windows and the lamps are dark; one lamp shows as a small orange dot. "Around the camera" is not visible in one still frame. Proposed alt: "Thousands of thin rain streaks fall through a dark night street with one distant lamp."
- At 320 pixels the streaks are still clear, but a larger capture would look better on the website.

## Demo links

### A draw from a vertex count -> rain/: keep
- The demo is in examples/demos.ts (name `rain`, title "Rain from a vertex count"). It has no code field, so the link is https://github.com/null3d-engine/null3d/tree/main/examples/rain/. The folder exists.
- The sketch shows the concept directly: `scene.createVertexDraw` with a vertex count, an instance count and a bounds sphere, and a WGSL vertex entry point that takes only the vertex and instance indices. It also uses `wrap_relative` from `null3d::wrap`, so the same demo shows "## Wrapping around the camera".
- The page has no GitHub example link now, so this is the page's only demo link. Put it under "## Rain around the camera", where the page's code is a cut-down copy of the demo.

## Concepts said to have no demo

### wrap_around: confirmed, no demo
- Only the rain demo imports `null3d::wrap`, and it uses `wrap_relative`, not `wrap_around`. No other demo or comparison uses the module.

### setBounds (on a vertex draw): confirmed, no demo
- The rain demo sets its sphere once, through the `bounds` option, and never calls `draw.setBounds`.
- Other demos call `setBounds` (hero-shadow, vertex-updates, the battle comparison, the island showcase), but each one calls it on a mesh object, not on a vertex draw. They do not show this page's call.
- No other demo calls `scene.createVertexDraw`. The weather add-on README says its rain uses particles, not a vertex draw.
