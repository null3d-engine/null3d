# Verdicts: porting/react-three-fiber (shots and demo links)

## Shots

None proposed. Nothing to check.

## Demo links (all in the table "React Three Fiber and drei in null3D")

| Concept | Code | Keep | Reason |
| --- | --- | --- | --- |
| useGLTF | gltf-model/ | yes | The demo has no code value, so its folder name is the code. Its sketch loads the BoomBox with `assets.loadGltf` and places it in the scene, which is the row's mapping. |
| drei Environment | environment/ | yes | No code value, so the folder name is the code. The sketch loads an HDR and an EXR file with `assets.loadEnvironment`, then calls `scene.setEnvironment` and `scene.setBackground`. That is the `<Environment files background />` row exactly. |
| drei Html as tracked labels | css3d-labels/ | yes | No code value, so the folder name is the code. The sketch calls `ui.trackLabel` with 'world' and 'billboard' transforms and posts each label's text to the page, where the shared runner binds it with `engine.labels.bind`. It also matches drei Html's `transform` and `sprite` props. picking/ shows the plain screen-space label, if a second link is wanted. |
| Mesh pointer events | picking/ | yes | Code 'picking/' exists. The sketch uses `object.on('pointerenter' / 'pointerleave' / 'click')`, and a click posts a label change to the page with `page.post`, which is the row's "then page.post" half. |

## Concepts said to have no demo

- React view component: confirmed. No file under examples/ imports React or React Three Fiber.
- State messages between React and the sketch: not confirmed. weighted-transparency/ shows both directions: a page button sends 'blend' with `engine.postToSketch`, the sketch handles it in `page.onMessage`, and the sketch sends 'hud', 'label' and 'toast' back with `page.post`. gizmos/ shows the page-to-sketch half only (mode buttons). Neither uses React, and the page half lives in the shared runner, not in the demo folder.
- Frame-budget governor in place of drei adaptive components: confirmed. No demo calls `quality.setBudget`, and none sets a render-scale range to replace PerformanceMonitor. The showroom only fixes the scale or turns the governor off from its address for measurements, which is not the concept.
