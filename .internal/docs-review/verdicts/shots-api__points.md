# Shot and demo-link verdicts: api/points

## Shots

### galaxy: keep
- The source is right. `tests/image/references/chrome-real-gpu/webgpu/demo-galaxy.png` exists and is the galaxy demo's default view (the manifest makes `demo-<name>` from every demo's sketch). Copies also exist for compat and webgl2.
- The picture helps. It shows what one large point batch with a soft round map and additive blending looks like.
- Caveats:
  - The reference is only 320 x 180 pixels. A fresh capture of `galaxy/` at full size would look better on the page.
  - The page's own code sample draws a different galaxy: 20,000 opaque squares, with no map. The caption must say that the picture is the demo (120,000 soft stars), not the code above it.

### points-sizes: drop it for this section
- The source type is wrong. This is not a scripted shot. The image is a stored reference: `tests/image/references/chrome-real-gpu/webgpu/points.png` (640 x 360), from the `points` test page (`tests/pages/sketches/points-sketch.ts`, scene data in `bench/scenes/points.ts`).
- The picture does not show what the proposal says. It holds four clouds: opaque squares in world units at several depths, cut-out discs, see-through discs, and 12 px squares near the floor. A reader cannot tell which points keep their screen size and which shrink with distance. The world-unit squares differ in size only a little, and nothing labels the two kinds.
- The disc map has a dark bar near its top that marks which way is up, and the 16 px map draws as octagons. A reader is likely to see both as rendering faults.
- Possible reuse: under "Round points, maps and blending", with a caption that names each row (opaque squares, cut-out discs, see-through discs, pixel-sized squares). The same caveats about the bar and the octagons apply.

## Demo links

### A large point batch -> galaxy/: keep
- `galaxy` is in `examples/demos.ts` and has no `code` value, so `galaxy/` is right under the contract.
- The sketch draws 120,000 stars in one dynamic points batch (30,000 on the low preset) and writes their positions in every frame. This matches the page's text.
- The page already has this link in "Create a batch". No change is needed.

### New: round points with a map and additive blending -> galaxy/
- The galaxy sketch uses a soft disc map made from data, with `alphaMode: 'blend'`, `blending: 'additive'` and `depthWrite: false`. This is exactly the advice in "Round points, maps and blending".
- The same sketch also draws a sky of 4,000 points with `sizeAttenuation: false` at 2 CSS pixels. So "Sizes in the world and on the screen" can link it too.

## Concepts said to have no demo

- Masked round points: confirmed. No demo makes points with `alphaMode: 'mask'`. Only the `points` test page does. The galaxy demo shows round points, but with blending, not a mask.
- Weighted blending of points: confirmed for points. The `weighted-transparency/` demo shows the same weighted blend on 600 smoke sprites and on glass panes, with a key that switches to normal blending. Points are sprites of one size, so a link labelled "weighted blending, shown on sprites" is useful. It fits the materials page better than this page.
- pointThreshold picking: confirmed. No demo uses `pointThreshold`. The galaxy demo has no clicks on points.
