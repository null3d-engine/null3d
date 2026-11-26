# Shot and demo-link verdicts: index

## Shots

### showcase-island: keep, with a larger capture

- The source is right. `tests/image/references/chrome-real-gpu/webgpu/demo-island.png` exists (also under compat and webgl2). It shows the default view: the whole island from above the sea, with forest, the beach, the harbour town and the golf course on the headland. The alt text matches the picture.
- It helps the reader. It is the one picture that shows what the engine can draw, at the top of the first page.
- Problem: the reference is 320 x 180 pixels, the image tests' default size. That is too small for a hero picture.
- Better source: scripted. Open the examples page with `?demo=island`, wait for the first full frame of the default view (the demo holds at 0.5 s in the image tests), and capture the canvas at 1280 x 720 or larger on WebGPU. If a scripted capture is not possible, use the reference as it is.

### compare-factory: drop as proposed

- The steps cannot be done. The comparison page runs one engine at a time. Each engine has a page of its own (`?engine=null3d` or `?engine=threejs`), and the engine switch loads the page again. Nothing draws the two sides next to each other.
- The page has no switch to hold a frame at a set sketch time. Hold is an option of the image tests (`startComparison` with `hold`), not a page parameter.
- The page shows no frame-time label per engine. The guided walkthrough ends with a table of frames per second at each count, measured on the viewer's own device, so its numbers change from machine to machine.
- The bullet's numbers (0.35 ms against 3.18 ms) come from the S2 scene-graph benchmark, not from this comparison. A capture of the comparison would show other numbers under the same text.
- If the page wants a picture here, an honest choice is the two held references side by side, captioned "the same factory scene in null3D and in three.js": `tests/image/references/chrome-real-gpu/webgpu/compare-factory-null3d.png` and `.../webgpu/compare-factory-threejs.png` (640 x 360 each). That shows the same look, not the speed, so the caption must not claim speed.

## Demo links

### showcase/island/ for "What null3D draws": keep

`showcase/island/` is the `code` of the `island` demo in `examples/demos.ts`. The demo is the showcase island the hero picture shows.

### compare/factory/ for "Faster than three.js": keep, with care in the link text

`compare/factory/` is the `code` of the `factory` entry in `examples/compare/comparisons.ts`. It runs the same scene in both engines on the scene-graph route and ramps the count, so a reader can see the gap on their own device. The link text must say it is a live comparison to run. It must not suggest that the quoted 0.35 ms and 3.18 ms come from it; those figures come from the S2 benchmark.

## Concepts said to have no demo

- Status labels: confirmed, no demo. Also, this branch removes the status labels section from the index page, so the concept no longer needs anything.
- Page IDs: confirmed, no demo. It is a docs convention.
- Docs that ship in the engine package: confirmed, no demo. It is a packaging fact.
