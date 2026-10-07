---
id: api/cameras
title: Cameras
status: experimental
since: "0.1"
summary: "Perspective and orthographic cameras; screenToRay; worldToScreen; layers."
---

# Cameras

> Ships in null3D 0.1, with `screenToRay` and `worldToScreen` from null3D 0.2. The API is experimental, so it can still change between versions.

A camera is the object that the engine draws the scene from. There are two kinds: `scene.createPerspectiveCamera` makes a perspective camera, and `scene.createOrthographicCamera` makes an orthographic one. `scene.setActiveCamera` picks the camera that the canvas shows.

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene, time }) => {
  const camera = scene.createPerspectiveCamera({ fov: 60, near: 0.1, far: 100, position: [0, 4, 10], target: [0, 0, 0] });
  scene.setActiveCamera(camera);

  return {
    onUpdate() {
      // Circle the scene, and keep looking at its center.
      const orbit = time.now * 0.4;
      camera.setPosition(Math.cos(orbit) * 9, 4, Math.sin(orbit) * 9);
      camera.lookAt(0, 0, 0);
    },
  };
});
```

## Perspective cameras

A perspective camera shows near things larger than far things, as the eye does.

- `fov` is the vertical field of view in degrees. The default is 50.
- `near` and `far` are the distances to the nearest and farthest things the camera shows. The defaults are 0.1 and 2000.
- `setFov(degrees)` and `setNearFar(near, far)` change the lens later. The `fov`, `near` and `far` properties read it.

The defaults match three.js's `PerspectiveCamera`. The aspect ratio follows the canvas in every frame, so a camera needs no call when the canvas changes size.

The field of view goes from 0 to 180 degrees, and the near plane must lie in front of the camera, beyond 0. In development builds, values outside these ranges throw E1108.

## Orthographic cameras

An orthographic camera's view is a box. Things keep their size at every distance, as in maps and isometric games.

```ts
const camera = scene.createOrthographicCamera({ height: 20, near: 1, far: 200, position: [30, 25, 30], target: [0, 0, 0] });
scene.setActiveCamera(camera);
```

- `height` is the height of the view in world units. The width follows the canvas's aspect ratio in every frame. The default height is 2, as in three.js.
- `left`, `right`, `top` and `bottom` give the four edges instead, as three.js's `OrthographicCamera` takes them. The view then keeps these edges on any canvas, and stretches to fill it. Give all four edges and no `height`.
- `near` and `far` are the distances along the view to its nearest and farthest planes. The defaults are 0.1 and 2000. The near plane can lie behind the camera, because nothing in the view grows as it gets closer.
- `setOrthoHeight(height)` zooms: a smaller height shows less of the scene, and shows it larger. A view made from four edges scales about its center and keeps its shape, as three.js's `zoom` scales it.
- The `height` property reads the view's height. The `width` property reads the width of a view made from edges, and is `undefined` while the width follows the canvas.

In development builds, a view with no size throws E1108. So does a far plane that is not beyond the near plane, for both kinds of camera.

## Which kind of camera

`camera.isOrthographic` is true for an orthographic camera and false for a perspective one. Code that works with either kind, such as camera controls, reads `fov` or `height` after that check.

Both kinds draw reversed depth on every GPU tier, which keeps surfaces apart far from the camera. [GPU tiers and backends](../concepts/backends.md#depth-on-each-tier) covers depth on each tier.

## Moving a camera

A camera is an object, so it has every call of [Objects and transforms](objects.md), such as `setPosition` and `setParent`. A camera looks down its -Z axis. `lookAt` turns that axis toward a point, and the `target` option calls `lookAt` once when the camera is created.

Cameras are dynamic by default, because most cameras move. Pass `dynamic: false` for a camera that stays still. A camera under a parent moves with it: a camera on a car follows the car.

## Layers

`setLayers(mask)` sets the layers that the camera draws, as a 32-bit mask. The camera draws the objects and instance batches whose masks share a bit with its own. The `layers` option sets the mask when you create the camera. The default, 1, draws layer 0, where every new object starts.

A new mask needs no rebuild, so a sketch can switch a camera's layers in any frame. [Render layers](../concepts/render-layers.md) has an example that shows and hides a group of markers.

## Points on the screen

Two calls connect the canvas with the world. Both count CSS pixels from the canvas's top-left corner, as `input.pointer` does.

- `screenToRay(x, y, ray)` writes the ray from the camera through a point on the canvas into `ray`. A perspective ray starts at the camera, and an orthographic ray starts on the near plane. The direction has length 1.
- `worldToScreen(point, out)` writes where a point in the world lies on the canvas into `out`: `x`, `y` and the depth. The depth is the distance in front of the camera along its view. A depth below 0 puts the point behind the camera, where `x` and `y` have no meaning. The point is in view when `x` and `y` lie on the canvas and the depth lies between `near` and `far`.

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene, input, page }) => {
  const camera = scene.createPerspectiveCamera({ position: [0, 3, 8], target: [0, 0, 0] });
  scene.setActiveCamera(camera);
  // Create the arrays once: the calls write into them, and allocate nothing.
  const ray = { origin: [0, 0, 0], direction: [0, 0, -1] };
  const ground = [0, 0, 0];
  const onScreen = [0, 0, 0];
  return {
    onUpdate() {
      if (input.wasPressed('Mouse0')) {
        camera.screenToRay(input.pointer.x, input.pointer.y, ray);
        // Where the ray meets the ground, the plane y = 0.
        const along = -ray.origin[1] / ray.direction[1];
        if (along > 0) {
          for (let k = 0; k < 3; k++) ground[k] = ray.origin[k] + ray.direction[k] * along;
          page.post('ground', { x: ground[0], z: ground[2] });
        }
      }
    },
    onLateUpdate() {
      // Where the world's origin shows this frame, for an HTML element on the page.
      camera.worldToScreen([0, 0, 0], onScreen);
    },
  };
});
```

`scene.raycast` takes the ray's `origin` and `direction`, and finds the objects along it ([Raycasting](raycast.md)).

### Which frame a ray sees

The engine draws a frame on one thread while the sketch computes the next one on another. A click therefore lands on a frame that is older than the sketch's current camera. During a fast pan, a ray from the current camera would miss what the user clicked.

So the engine keeps the cameras of the last four views that it drew. Frames in a row with the same view count as one view. The frames that the engine draws while the setup runs count too, so a click during the setup picks what that frame showed. When `x` and `y` come from `input.pointer` or a finger in `input.touches`, the ray uses the camera of the frame on screen at that event. Any other point uses the camera of the frame that last ran, with its lens as it is now. This holds in every thread mode.

Objects keep their current positions. A ray finds a moving object where it is now. That can be up to a frame of its motion away from where the user saw it.

`worldToScreen` always uses the camera of the frame that last ran. In `onLateUpdate`, that is the frame being drawn, so a point placed there lines up with the image.

## Several cameras

A scene can have several cameras, and `setActiveCamera` switches between them. The canvas shows the scene from one camera at a time. Until you pick one, and after the engine removes the active camera, the canvas shows only the background.

## Related pages

- [Scene](scene.md): creating cameras and picking the active one.
- [Objects and transforms](objects.md): the calls that cameras share with other objects.
- [Render layers](../concepts/render-layers.md): which objects a camera draws.
- [Input](input.md): the pointer and touches whose positions `screenToRay` takes.
- [Raycasting](raycast.md): finding the objects along a ray.
- [Math helpers](math.md): `quat.lookAt`, and why cameras swap its eye and target.

## API reference

[The API reference](reference/cameras.md) lists every export of this page with its type and description. The engine's doc comments make it.
