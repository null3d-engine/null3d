# Shot and demo-link verdicts: guides/phones

Paths are relative to the generated copy of the repository.

## Shots

### presets-low-high: keep, with a corrected source

The picture helps. "The preset on a phone" lists what Low leaves out, and a side-by-side makes "lighter" visible.

What is wrong with the proposal:
- It says the picture shows the pixel-ratio difference. It cannot. A held picture draws at a fixed size in device pixels, so both halves have the same pixel count. Pixel ratio has its own section with a table. Remove pixel ratio from the caption.
- The island's default view at the demo's hold time is the whole island from far away. At that distance the Low and High pictures look almost the same: ambient occlusion, shadow cascades and MSAA against FXAA hardly show. The island also fixes its render scale at 1 on every preset, so the render scale does not change either.
- The existing pair of island pictures cannot stand in. The default view at High is in tests/image/references/chrome-real-gpu/webgpu/demo-island.png. The Low picture is in tests/image/references/chromium-swiftshader/webgpu/demo-island.png, but the software GPU drew it. The two pictures differ by renderer as well as by preset.

Corrected source (scripted): use the image test page, which reads `?preset=` and holds a time:
`tests/pages/image.html?sketch=/examples/showcase/island/sketch.ts&size=1280x720&preset=low&hold=5`, and the same address with `preset=high`. Hold time 5 s is the "closer" view on the island's camera route (tests/image/script-runs.ts), where the town's houses, trees and shadows fill the frame. Draw both on webgpu on the same machine. Crop the same town area from each picture and put them side by side. Caption: ambient occlusion, shadow detail and edge smoothing. Do not mention pixel ratio.

### render-scale-text: keep the idea; the steps do not work as written

The point is on the page ("Text and fine lines in the scene get softer at a lower scale"), and a picture shows it well.

The steps fail. No page exists that runs canvas-screen with `quality.set({ maxRenderScale: 0.5 })`. The canvas-screen sketch reads no render-scale switch, and the engine has no URL switch for the render scale. (The creek sketch has its own `?render-scale=`, but canvas-screen does not.) The claim that hold mode draws at the highest scale of the range is correct (tests/image/manifest.ts, the render-scale tests).

Corrected source (reference, no new code): the existing pair of the boxes test scene at render scale 1 and 0.5:
- tests/image/references/chrome-real-gpu/webgpu/scene.png (the render-scale-100 test uses this reference)
- tests/image/references/chrome-real-gpu/webgpu/render-scale-50.png
The seams between the floor tiles and the box edges are visibly softer at 0.5. Change the alt text to "fine lines" in place of "screen text".

If text is a requirement: add a `?render-scale=` switch to examples/canvas-screen/sketch.ts, as the creek sketch has. Then hold `examples/canvas-screen/sketch.ts?render-scale=0.5` at 1 s beside the default (demo-canvas-screen.png), and crop the small labels under the chart.

### chrome-inspect: keep

This is the browser's own developer tools, so "manual" is the right source. The picture helps a newcomer find the device list and the "inspect" link. When you capture it, open only a null3D demo tab on the phone. The page lists the open tabs' addresses and the phone's model.

### safari-develop-menu: keep

This is also browser developer tools, so "manual" is correct. Note for the page itself, not for the shot: the Develop menu is hidden on a Mac until you turn on "Show features for web developers" in Safari's Advanced settings. The bullet does not tell the reader to do this, but the screenshot assumes it is done.

## Demo links

- instances/ for "Fewer instances on phones": keep. The code is in examples/demos.ts. The sketch keeps a column count per preset in one table (101 x 101 at Low, 317 x 317 above it). It reads `quality.preset` and runs the count again in `quality.onChange`. This is the pattern from the page's code example, with live preset changes added.
- showcase/island/ for "Repeat visits and the pipeline list on phones": reject this concept. The island sketch does nothing special for repeat visits, the pipeline list or the cache of derived data. No demo loads KTX2 files. The island is also a poor example of phone start time: the page says that a Galaxy Tab A9 Plus refused its far tree cards.
- showcase/island/ for "A first frame before the large models arrive": keep under "Networks and repeat visits", beside "draws before its large models arrive". On a live page the island draws its first frame first, then loads the species, the lawns and the town models, which appear as they arrive (sketch.ts, near the first-frame and preload code).

## Concepts said to have no demo

- Touch gestures and `touch-action: none`: partly wrong. picking/ shows the last sentence of the section: an object's `click` handler, which a tap calls too. The shared camera helper (examples/lib/interact.ts, used by most demos) turns the camera with a one-finger drag and zooms with a pinch. `touch-action: none` is set only in the examples page's CSS (examples/index.html), not in a sketch, so no demo link shows that line.
- Heat and long runs: confirmed. No demo shows this.
- Crashed starts and `engine.mode.crashedStarts`: confirmed. No demo reads it.
- The back-forward cache: confirmed. No demo handles it.
