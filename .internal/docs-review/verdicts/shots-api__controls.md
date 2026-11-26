# Shot and demo-link verdicts: api/controls

## Shots

### walk-and-fly: KEEP
- Source is right. tests/image/references/chrome-real-gpu/webgpu/demo-walk-and-fly.png exists (also in compat and webgl2). It shows the temple from eye height: columns, two lit torches, a tiled floor, warm low light.
- The default view is the demo's scripted walk, which runs until the first input. It is still a true first-person view, so it fits the section.
- Alt text is accurate. Could add "with lit torches".
- Placement: the demo link sits under "## Pointer lock". The picture can go under "## First-person controls" as proposed, or next to that link.
- The reference is only 320 x 180 pixels. The website may want a larger capture of the same view.

### gizmo-handles: KEEP
- Source is right. tests/image/references/chrome-real-gpu/webgpu/demo-gizmos.png exists. The sketch selects the jade sphere at start (select(1)) in translate mode, with a yellow outline.
- Zoomed in, the picture shows the X, Y and Z arrows and the three plane tiles on the sphere. The alt text is accurate.
- The handles cover about 40 pixels of a 320 x 180 image. Prefer a larger capture of the same default view, or crop to the plinth.

### gizmo-modes: KEEP, steps corrected
- Useful: it shows the three handle sets that the modes table describes.
- The steps are wrong in two places:
  1. "Select one piece" is not needed. The jade sphere starts selected. A click on the canvas can select another piece or hit a handle.
  2. "Hold and capture" cannot work. The demo page hides the Mode buttons when the URL has the hold switch (examples/index.ts: choices exist only when there is no hold).
- Corrected steps: open the examples page with ?demo=gizmos and no hold. Wait until it loads. The sphere starts selected in Translate. Keep the pointer off the canvas, so no handle is highlighted. Capture the canvas. Click "Rotate" in the Mode bar, wait a few frames, capture. Click "Scale", wait a few frames, capture. Put the three canvas crops in a row. (Each button posts a "mode" message that the sketch hands to gizmo.setMode.)
- The camera does not move by itself in this demo, so the three frames line up.

### orbit-after-drag: DROP
- The source exists as a reference, not only as a scripted shot: tests/image/references/chrome-real-gpu/webgpu/controls.png (manifest entry "controls", ?moved, hold 0). So "scripted" is the wrong kind.
- The picture does not help a reader. It is a test page, not a demo: a checked floor with coloured markers. One still frame after a drag shows nothing about a gesture. With no "before" frame, a reader cannot see that anything moved.
- The Gestures section is a table of inputs. A picture adds nothing there.

## Demo links

### Orbit controls -> gltf-model: KEEP, with notes
- "gltf-model" is a demo in examples/demos.ts. It has no code value, so the contract path is "gltf-model/". The URL https://github.com/null3d-engine/null3d/tree/main/examples/gltf-model/ is right.
- The demo does use orbit controls: its sketch calls interact(...), and examples/lib/interact.ts makes them with createOrbitControls. Orbit starts at the first drag, wheel or pinch.
- Weakness: the sketch never names createOrbitControls. A reader who opens the folder sees only the shared helper. The link text should say that the demo's camera uses orbit controls through the demos' shared helper. No demo calls createOrbitControls itself.
- Placement: the intro paragraph ("as in a model viewer") fits better than "## Gestures". The BoomBox on a turntable is a model viewer.

## Concepts said to have no demo

- map controls: CONFIRMED. No demo or comparison calls createMapControls. Only the test page tests/pages/sketches/controls-sketch.ts (?map) uses them.
- drag controls: CONFIRMED. No demo or comparison calls createDragControls.
- keys and listenToKeyEvents: CONFIRMED. No demo calls listenToKeyEvents. walk-and-fly reads keys through first-person and fly controls, which is a different feature.
- saveState and reset: CONFIRMED. No demo calls saveState or the controls' reset.
