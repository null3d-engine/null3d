---
id: guides/multiple-views
title: Multiple views
status: experimental
since: "0.3"
summary: "Split screens and picture in picture with scene.createView: a camera and a rectangle of the canvas, drawn after the camera's view in the same frame; per-view culling; the cost of each view."
---

# Multiple views

> Roadmap step 0.3, first released in null3D 0.1.0. The API is experimental, so it can still change between versions.

A view draws the scene again from another camera, into a rectangle of the canvas, in the same frame as the camera's view. Use it for a split screen, a picture in picture, a rear-view mirror or a tactical inset. Two kinds of work are different:

- A **view** draws into the canvas, so the user sees it in place. `scene.createView` makes one.
- A **pass** draws into a texture, which a material shows in the world, as a minimap on a screen does. [render.addPass](custom-passes.md#render-to-a-texture) makes one.

## A picture in picture

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene }) => {
  const main = scene.createPerspectiveCamera({ fov: 55, position: [6, 5, 9], target: [0, 1, 0] });
  scene.setActiveCamera(main);
  const chase = scene.createPerspectiveCamera({ fov: 70, position: [0, 1.4, 2.5], target: [1, 1.4, 0] });
  // The canvas's top-right corner: x and y from its top-left, then the width and the height.
  scene.createView({ camera: chase, rect: [0.69, 0.02, 0.29, 0.32] });
  return {};
});
```

`rect` is `[x, y, width, height]` as fractions of the canvas's width and height from its top-left corner. `[0, 0, 0.5, 1]` is the left half and `[0.5, 0, 0.5, 1]` the right half. The rectangle's shape gives the camera its aspect ratio, so a half-width view shows objects with the proportions of a half-screen.

## A split screen

The camera's view draws the whole canvas first, and each view covers its rectangle afterwards. The camera's aspect ratio is the canvas's, so a half of its image is a crop of a wider view. For two half-width cameras, add a view for each half:

```ts
const left = scene.createPerspectiveCamera({ fov: 50, position: [-4, 2, 6], target: [0, 1, 0] });
const right = scene.createPerspectiveCamera({ fov: 50, position: [4, 2, 6], target: [0, 1, 0] });
scene.setActiveCamera(left);
scene.createView({ camera: left, rect: [0, 0, 0.5, 1] });
scene.createView({ camera: right, rect: [0.5, 0, 0.5, 1] });
```

Each half draws with the aspect ratio of its rectangle, so objects keep their proportions. The camera's view draws the whole canvas underneath, so the scene draws three times: once across the canvas, which the halves cover, and once for each half. A picture in picture draws the scene twice: the camera's view, which shows, and the inset.

## Changing and removing views

- `view.setCamera(camera)` draws the view from another camera from the next frame on.
- `view.setRect(rect)` moves the view from the next frame on. It allocates nothing, so a sketch can animate the rectangle in any frame.
- `view.destroy()` removes the view, and the camera's view draws the canvas alone again. Development builds throw E1101 for a call on a removed view.
- `view.live`, `view.camera` and `view.rect` read the view.
- The view takes its camera's layers, and follows them when they change, as a scene pass does.

## Cost

Each view culls the scene once more and draws it once more, at its rectangle's pixels. A picture in picture at a tenth of the canvas costs about a tenth of a scene draw. The camera's view always draws first, so a split screen of two halves costs the camera's draw and two view draws.

The shadows cost nothing more: a view draws the sun's cascades and the point and spot lights' shadows that the camera's view made, as a scene pass does. The view draws the background, the environment's light, the material fog and the lights it sees. Its objects take no ambient occlusion or screen-space reflections, which shade the camera's view. The camera's volumetric fog and outline are added to the whole image after the views draw, so they also reach a view's rectangle.

A view has a depth target of the canvas's size, made once in a frame and shared with the other views when their turns do not overlap. The rectangle follows the render scale, as the camera's view does, so a lower scale lowers a view's cost with the rest of the image.

Both GPU paths draw views, in every thread mode. The scene culling runs on the GPU on WebGPU and on the job workers on WebGL2, as it does for the camera. On the 8-bit path a view writes display color into the camera's image, and the resolve pass or the final pass draws it to the canvas; the picture looks the same as on the HDR path, with no bloom, as the 8-bit path has none.

No preset switches views off or lowers their count. On a phone, keep a picture in picture small: each view costs what its rectangle costs on the preset that the device runs, as [Quality presets](../concepts/quality-presets.md) describes.

## What a view leaves out

A view draws no object whose material shows a render pass's texture, since a pass cannot read a target that another pass draws into. Keep such objects in the camera's view, or show the pass's texture on a screen in the world instead.

`camera.screenToRay` and `camera.worldToScreen` map the whole canvas, with the shape of the canvas. They do not read a view's rectangle, so a ray through a point of a view's image does not follow that view's camera. They take no view, and picking inside a view's rectangle is not supported yet.

A scene and its passes share 32 views, the camera's included. Reflection probes take six while they capture. `scene.createView` throws E1501 when no view is free, and the same error names the limit when a frame draws too many.

## Related pages

- [Scene](../api/scene.md#multiple-views): `createView`, `setCamera`, `setRect` and `destroy`.
- [Cameras](../api/cameras.md): the two lenses and their options.
- [Custom passes and render targets](custom-passes.md#render-to-a-texture): a camera's view in a texture that a material shows.
- [The render graph](../concepts/render-graph.md): how the engine plans and orders what it draws.
- [Performance](performance.md): the frame budget and the render scale.
