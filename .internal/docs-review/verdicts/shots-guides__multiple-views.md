# Shot and demo-link verdicts: guides/multiple-views

## Shots

### split-screen: keep
- The reference file exists for all three tiers: tests/image/references/chrome-real-gpu/{webgpu,compat,webgl2}/demo-multiple-views.png.
- The webgpu picture shows the demo's default layout: the high wide camera on the left half and the low camera, looking at the brass orb, on the right half. The alt text is correct.
- The demo starts in the split layout (both halves made before the first frame), so the default view is the split screen the section describes.

### picture-in-picture: keep (scripted steps are real)
- The demo has a "layout" choice with options Split and Inset (examples/demos.ts). The page sends it to the sketch as a message, and the sketch's message handler switches to the inset layout. The V key does the same through the "layout" action.
- In the inset layout the active wide camera fills the canvas and the low camera draws in a rectangle at the top right (x 0.70, y 0.03, size 0.27 by 0.27). The alt text "inset in the top-right corner" is correct.
- Prefer the choice button over the V key: the key path also posts a toast ("Inset view: on"), which could show in the picture if the capture includes the page overlay.
- The wide camera drifts with time until a user takes it, so hold at a fixed time (the demo's own hold is 1 s) to get a stable picture.
- Alternative if a scripted capture is not wanted: tests/image/references/chrome-real-gpu/webgpu/demo-look-at.png is an existing reference with a real picture in picture (a close-up of a knight's face in the top-right corner). It is a different scene, so the scripted shot from the same demo is better for this page.

## Demo links

### multiple-views/: keep
- The demo exists in examples/demos.ts and has no code field, so "multiple-views/" is the right code.
- Its sketch calls scene.createView for both halves of a split screen and for an inset, and destroys and remakes views when the layout changes. It shows split screen and picture in picture.
- Placement: the demo shows both layouts, so the link fits the page's opening or the first section ("A picture in picture") as well as "A split screen".
- Extra candidate: look-at/ (Joint overrides) also makes a picture-in-picture view with scene.createView in the canvas's top-right corner. It could be a second link under "A picture in picture".

## Concepts said to have no demo

- Picking through a view (scene.viewAt, view.screenToRay): confirmed. No demo calls viewAt or a view's screenToRay. The orbit helper picks with the main camera's screenToRay only.
- Animating view.setRect: confirmed. No demo calls setRect. The multiple-views demo destroys and remakes its views to change layout.
- A rear-view mirror: confirmed. Only multiple-views and look-at call scene.createView, and neither is a rear-view mirror. The skyway demo's "from behind" is a camera position, not a view.
