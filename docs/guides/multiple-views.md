---
id: guides/multiple-views
title: Multiple views
summary: "Split screens and picture in picture with scene.createView: a camera and a rectangle of the canvas, drawn after the camera's view in the same frame; per-view culling; the cost of each view."
---

# Multiple views

A view draws the scene again from another camera, into a rectangle of the canvas, in the same frame as the camera's view. Use it for a split screen, a picture in picture, a rear-view mirror or a tactical inset. A view is not a render pass:

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

## Picking in a view

`camera.screenToRay` and `camera.worldToScreen` map the whole canvas, with the canvas's shape. A view's image has its own camera and shape, so a view has the same two calls:

- `view.screenToRay(x, y, ray)` writes the ray from the view's camera through a point of the view's image.
- `view.worldToScreen(point, out)` writes where a point in the world lies in the view's image: `x`, `y` and the depth.
- `scene.viewAt(x, y)` gives the view under a point, or `undefined` where only the camera's view shows. Where views overlap, it gives the one on top.
- `view.contains(x, y)` says whether a point lies in the view's rectangle.

All of them count CSS pixels from the canvas's top-left corner, as `input.pointer` does. So pass the pointer's position as it is, with no offset for the rectangle. The lens takes the shape of the view's rectangle, as the view draws it.

This sketch picks through whichever image is under the pointer:

```ts
import { defineSketch, type RaycastHit, vec3 } from '@null3d/engine';

export default defineSketch(({ scene, input }) => {
  const camera = scene.createPerspectiveCamera({ fov: 60, position: [0, 2, 6], target: [0, 0, 0] });
  scene.setActiveCamera(camera);
  const top = scene.createPerspectiveCamera({ fov: 40, position: [0, 12, 0.01], target: [0, 0, 0] });
  scene.createView({ camera: top, rect: [0.69, 0.02, 0.29, 0.32] });

  // Made once, and filled again by each call.
  const ray = { origin: vec3.create(), direction: vec3.create() };
  const hit: RaycastHit = { object: null, instance: -1, point: vec3.create(), normal: vec3.create(), distance: 0, triangle: -1 };
  const options = {};
  return {
    onUpdate() {
      if (!input.wasPressed('Mouse0')) return;
      const { x, y } = input.pointer;
      const view = scene.viewAt(x, y);
      if (view) view.screenToRay(x, y, ray);
      else camera.screenToRay(x, y, ray);
      if (scene.raycast(ray.origin, ray.direction, options, hit)) console.log('picked', hit.point);
    },
  };
});
```

A view's calls use the view's camera of the frame that last ran, with its lens as it is now. `camera.screenToRay` at a pointer event uses the camera of the frame that was on screen at that event, and a view's call does not. A click during a fast turn of the view's camera can pick up to a frame of its motion away.

## Cost

Each view culls the scene once more and draws it once more, at its rectangle's pixels. A picture in picture at a tenth of the canvas costs about a tenth of a scene draw. The camera's view always draws first, so a split screen of two halves costs the camera's draw and two view draws.

The shadows cost nothing more: a view reuses the sun's cascades and the point and spot lights' shadows that the camera's view made.

The rectangle follows the render scale, as the camera's view does, so a lower scale lowers a view's cost with the rest of the image. No preset switches views off or lowers their count. On a phone, keep a picture in picture small: each view costs what its rectangle costs on the preset that the device runs, as [Quality presets](../concepts/quality-presets.md) describes.

## What a view draws and its limits

Views draw on both GPU paths, in every thread mode.

- A view draws: the shadows of the camera's view, the background, the environment's light, the material fog and the lights it sees. The camera's volumetric fog and outline are added to the whole image after the views draw, so they also reach a view's rectangle.
- A view leaves out: ambient occlusion and screen-space reflections, which shade only the camera's view, and any object whose material shows a render pass's texture.

A pass cannot read a target that another pass draws into, so keep such objects in the camera's view, or show the pass's texture on a screen in the world instead.

A scene and its passes share 32 views, the camera's included. Reflection probes take six while they capture. `scene.createView` throws E1501 when no view is free, and the same error names the limit when a frame draws too many.

<details>
<summary>Technical details: how views draw on each GPU path</summary>

A view has a depth target of the canvas's size. The engine makes it once in a frame and shares it with the other views when their turns do not overlap. The scene culling runs on the GPU on WebGPU and on the job workers on WebGL2, as it does for the camera.

On the 8-bit path a view writes display color into the camera's image. The resolve pass or the final pass draws it to the canvas. The picture looks the same as on the HDR path, with no bloom, as the 8-bit path has none.

</details>

## Related pages

- [Scene](../api/scene.md#multiple-views): `createView`, `setCamera`, `setRect` and `destroy`.
- [Cameras](../api/cameras.md): the two lenses and their options.
- [Custom passes and render targets](custom-passes.md#render-to-a-texture): a camera's view in a texture that a material shows.
- [The render graph](../concepts/render-graph.md): how the engine plans and orders what it draws.
- [Performance](performance.md): the frame budget and the render scale.
- [A picture in picture](https://github.com/null3d-engine/null3d/tree/main/examples/multiple-views): one scene from a high, wide camera and a low one, split across the canvas or in an inset.
