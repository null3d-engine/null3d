# Shot and demo-link verdicts: guides/debugging

## Shots

### stats-overlay-card: keep, change the source
The card picture helps the "Measure" section: the text lists many figures, and a reader cannot picture the card from it.
The proposed source is weak. The stats test page has a 320x180 canvas with one test box, so the card lists almost no GPU steps. Its sketch also registers a test add-on, so the card would show a test-only row. The page prints a status line under the canvas too.
Every demo page already shows the overlay, collapsed to its frame rate (examples/lib/run.ts), and a held frame never shows it.
Corrected source: in the dev server, open examples/index.html?demo=objects (live, not held). Click the overlay's header, wait two seconds, and capture the card only. The objects demo has shadows, bloom, ambient occlusion and a vignette, so the card lists real GPU steps. The dev server also shows the "Memory by system" rows that the text names.

### in-page-inspector: keep, change the source
The panel picture helps a reader find the tree, the search box and the fields.
The proposed source is wrong for a picture. The inspect test page never opens the panel: it drives the inspection calls from code, moves the box, turns it red, sets the low preset, and clears the selection. Its canvas is 320x180, and the panel is 320 px wide, so the panel covers the whole view and hides the outline.
Corrected source: in the dev server, open examples/index.html?demo=objects&inspect at 1280x720, live. A held page opens no panel, so do not add a hold. Click the row "crate 0" (a child of the group "table") in the tree, wait one second for the outline, and capture the page. The objects demo names its group and crates, so the tree shows parents and children.

### debug-view-wireframe: keep, add the compile switch
The picture helps the debug-view paragraph. The view switch works with hold mode: image tests already combine them (the lod-levels tests use view=levels with compile=wait).
A view's first frame builds its pipelines, so objects can be missing for a few frames. Add compile=wait, as those tests do.
Corrected steps: hold examples/objects/sketch.ts at 2.5 seconds (the demo's hold time) with the switches view=wireframe and compile=wait, at 1280x720, and capture.
An existing reference, tests/image/references/chrome-real-gpu/webgpu/debug-view-wireframe.png, shows the same view, but it is 320x180 and its sphere and torus look filled at that size, so the scripted shot is better.
Also: the section opens with debug lines (axes, sphere, arrow), not views. The reference tests/image/references/chrome-real-gpu/webgpu/debug.png shows axes, a box's bounds, a sphere, an arrow, a camera's frustum and a grid. It fits the first paragraph better than the wireframe does. Consider it as a second shot (it is 400x225, so it is small).

### sketch-worker-breakpoint: keep, name a demo
This is the browser's own developer tools, so "manual" is the right kind. The picture helps a newcomer find the worker thread, which is the hard step.
DevTools lists the sketch's worker as "null3d-sketch" (the worker name in the engine's page code). The text does not say this; the caption or the page should name it.
Corrected source: open the objects demo in the dev server, open Sources, pick the "null3d-sketch" thread, and set a breakpoint in examples/objects/sketch.ts inside its update callback.

## Demo links

- objects/: keep. The code exists (the objects demo has no code value, so "objects/" is right). The demo does not show the inspector itself, but its named group and crates, moved between parents, fill the inspector's tree well. Word the link as "open it with ?inspect in the dev server".
- hold-mode/: keep. The code exists. The sketch seeds the random numbers, moves the balls in fixed steps, and its summary says each live run differs and the held frame is the same. This is the "Reproduce a frame" concept.
- forest/ (new): the page says "?view=levels in the page's address shows a demo's levels with no code change", with no link. The forest demo draws trees at four levels of detail, so ?view=levels on it shows the concept. Link it there.

## Concepts said to have no demo

All five are confirmed. No demo shows error codes, the development checks, the render fallback, the MCP server or a simulated GPU loss. The replay demo catches one error code in its code but shows nothing to the viewer. Simulated GPU loss has a test page only (tests/pages/gpu-loss.html), not a demo.
