# Shot and demo-link verdicts: api/debug (slice api-1)

## Shots

| Shot | Keep | Verdict |
| --- | --- | --- |
| debug-shapes | yes, change the source | A reference image already exists, so this is a "reference" shot, not "scripted": `tests/image/references/chrome-real-gpu/webgpu/debug.png` (the `debug` test, 400 by 225, hold 1). It shows the grid, a yellow box around a red cube, a green sphere's circles, axes at a point and on the spinning crate, a pink arrow, a white line, a camera frustum and a light. The alt text leaves out the sphere, the line and the light. Better alt: "A grid, a box, a sphere, two sets of axes, an arrow, a line, a camera frustum and a light, drawn as thin lines over a small scene." |
| debug-views | yes, change the source | All five views have reference images on every tier, so this is a "reference" shot: `tests/image/references/chrome-real-gpu/webgpu/debug-view-{normals,depth,overdraw,wireframe,shadows}.png` (320 by 180 each). Each reads well. Place them in a row in the table's order. |
| levels-view | yes, change the source | The forest steps are possible (the examples page forwards `?view=levels`, and the dev server reads address switches), but nothing checks the result. The ground, bushes and hills also take level colors, so the alt text ("near trees blue, far trees green, yellow, orange") is a guess. A checked picture exists: `tests/image/references/chrome-real-gpu/webgpu/lod-levels.png` (the `lod-levels` test, same on every tier). Alt: "Copies of one mesh at growing distances, each in its level's color: blue, green, yellow and orange." `lod-levels-hide.png` also shows the striped magenta marker that the row describes. |
| motion-view | yes, check the capture | The steps work: the math demo's camera stays still with no input, and hold mode draws the frame before, so one step of motion shows. Risk: the drones are small, and the existing motion references (`motion-vectors.png`, `custom-cutout-motion.png`) are almost black. Look at the capture before use, and crop to the flock if it reads as a black frame. |
| stats-overlay-frame | yes, fix the steps | Demos show the overlay by default, and `?stats=open` opens the card. But the overlay is page markup over the canvas, and a held engine shows no overlay, so the capture must be a live page screenshot clipped to the canvas's top-right corner, not a canvas capture. Say so in the steps. |
| stats-overlay-memory | yes, fix the steps | Same fix as stats-overlay-frame. Then click the `Memory` tab and wait for the whole-page line to leave `measuring`. |
| inspector-panel | yes, fix the steps | `?inspect` on the examples dev server opens the panel docked at the left. "Select a crate" should read "click a crate's row in the panel's tree", which outlines it in the view. |
| devtools-memory-panel | no | The page never mentions Chrome's Memory panel. Its whole-page figure comes from the browser's memory measurement call, not from DevTools heap snapshots, so the picture invites a comparison the text does not make. The Memory tab shot already shows the whole-page line. |

## Demo links

| Concept | Code | Keep | Verdict |
| --- | --- | --- | --- |
| Skeleton drawing | character | no | The character demo never calls the skeleton drawing call, so it does not show the concept. Its code is also wrong: the demo has no code value, so the link would be `character/`. A picture exists instead: `tests/image/references/chrome-real-gpu/webgpu/gltf-skeleton.png` (a fox and an arm drawn as joints alone). |
| Shadow cascades from elsewhere | hero-shadow/ | no | The hero shadow demo shows a fitted shadow map for one object. It never watches cascades from a second camera and never turns on the shadows view. No demo calls that function. |
| Levels view | forest/ | yes | The forest demo is the level-of-detail demo, and the page says `?view=levels` shows any demo's levels. The link text should tell the reader to add `?view=levels` when running it. |

## Concepts said to have no demo

| Concept | Confirmed | Demo that shows it |
| --- | --- | --- |
| Debug drawing shapes | yes | No demo calls the drawing calls. The test page picture `debug.png` covers it. |
| Add-on debug views | no | `water/`: the water add-on that the demo uses registers a view, and `?view=water-bounds` shows it. A checked picture exists: `water-bounds.png`. The demo's own code does not hold the registration, which lives in the add-on. |
| StatsPanel for another engine | no | `compare/battle/` (and every comparison): the three.js half shows the same panel over its canvas. The code that builds it is shared by the comparisons, not inside the comparison's folder. |
| engine.measure | yes | Only the comparison harness and its load ramps call it, outside any linkable demo folder, and nothing on screen shows it. |
