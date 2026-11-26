# Shot and demo-link verdicts: api/raycast

## Shots

### picking-demo (reference): reject

- The file exists: `tests/image/references/chrome-real-gpu/webgpu/demo-picking.png` (also under compat and webgl2).
- The "shows" text and the alt text are wrong. The picture has no labels. The labels are HTML that the demo page draws over the canvas, and the image test captures only the canvas.
- The default view already has one piece outlined: the sketch selects the red box at start. The proposal does not say so, and a reader could take the outline for the result of a click.
- The picture is 320 x 180 pixels, too small for a docs page, and it shows no ray, hit or result. Under "Rays from the pointer" it adds nothing that the click shot below does not show better. Two near-identical views of one demo on one page is redundant.
- Use only as a fallback when the scripted shot cannot be made. Then the alt text must be: "Six polished pieces on pedestals on a plinth in a dark gallery, the red box outlined, a blue grid display on the wall".

### picking-hit-marker (scripted): keep, with corrections

- Wrong section. The demo's click uses `object.on('click')`. The engine answers a pointer event with a raycast from the frame's camera (`pickForEvent` in `packages/engine/src/scene/scene.ts` calls the ray query), not with `scene.pick`. Under "Pixel-exact picking" the shot would mislead. Put it under "Rays from the pointer".
- The steps are not reliable. The plinth and the pieces turn with sketch time, so "the second piece from the left" changes from moment to moment, and the default view is ambiguous about which piece that is. The box is already selected, so a click on it would move only the dot.
- The dot is a sphere of 0.06 m. At the image test's 320 x 180 it is about two pixels. Capture larger.
- Corrected steps: open the picking demo at 1280 x 720. Wait until sketch time reaches 2 s (the reference image's hold, as the demo interaction test waits on sketch time). Click the pink capsule at the front left, at about 33 % across and 72 % down the canvas. Leave the pointer there and wait until the next frame has drawn. Capture the page with its label overlay, so the capsule's label reads "Capsule: selected".
- Corrected alt text: "The pink capsule outlined and lit under the pointer, with a white dot where the click's ray hit it and its label reading Capsule: selected".
- Side note: `scene.pick` does run in a demo. The double-click focus of the showroom, creek and island demos calls it, in `examples/lib/cinematic.ts`. That code sits outside each demo's folder, so a demo link would not lead a reader to it. Do not link it from "Pixel-exact picking".

## Demo links

### picking/ under "Rays from the pointer": keep

- The code exists in `examples/demos.ts` (name picking, code `picking/`).
- The sketch shows pointer events on objects: hover lights a piece (`pointerenter` and `pointerleave`), and a click outlines it and puts a dot at `event.point`.
- The link text must say it shows `object.on` events and the hit point. The demo never calls `camera.screenToRay` or `scene.raycast` itself.

## Concepts said to have no demo

- raycastBatch: confirmed. No example calls it.
- overlap queries: confirmed. No example calls `overlapSphere` or `overlapBox`.
- pointThreshold and lineThreshold: confirmed. No example sets them. The galaxy and sprites-lines demos draw points and lines, but they take no pointer events on them.
- the query trees: confirmed. No demo shows them. The page's diagram already covers them.
