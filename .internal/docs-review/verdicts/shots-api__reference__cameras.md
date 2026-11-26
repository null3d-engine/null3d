# Shot and demo-link verdicts: api/reference/cameras

Source to edit for this generated page: the TSDoc comments tagged `@category api/cameras` in `packages/*/src`.

## Shots

None proposed.

## Demo links

- **SceneView → multiple-views/** (under `## SceneView`): KEEP. The demo has no `code` field, so `multiple-views/` is the right path. Its sketch calls `scene.createView` for a split screen and an inset, and switches between them with the V key. That is exactly what the section describes.
- **PerspectiveCamera lens → camera-lens/** (under `## PerspectiveCamera`): KEEP. The demo has no `code` field, so `camera-lens/` is right. Its sketch makes a perspective camera and calls `setFocalLength` every frame, from 35 to 85 mm, in a dolly zoom. That shows `setFocalLength` and `focalLength` well.
- **Ray → picking/** (under `## Ray`): DROP. The picking sketch never makes or reads a ray. It uses `object.on('click')` and reads `event.point`; its own header says it finds the piece "with no raycast". The only example code that fills a ray is the shared helper `examples/lib/interact.ts` (`camera.screenToRay` then `scene.raycast`), which is not a demo. A reader who opens the picking demo to see the ray type will not find it. If a link is wanted, put the picking link on the pointer-event page instead.

## Concepts without a demo

- **OrthographicCamera**: CONFIRMED. No demo or comparison makes an orthographic camera. A search of all example code finds the word only in the shared helper's camera type, where it accepts either camera kind.
