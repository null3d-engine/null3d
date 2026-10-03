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

<!-- null3d:api:start -->

### `Camera`

Class `Camera`, which extends `Object3D`.

An object that the scene can be drawn from. `scene.setActiveCamera` picks the camera that the canvas shows. A camera is a `PerspectiveCamera` or an `OrthographicCamera`, and `isOrthographic` tells them apart.

| Member | Description |
| --- | --- |
| `readonly isOrthographic: boolean` | True for an `OrthographicCamera`, false for a `PerspectiveCamera`. |
| `readonly near: number` | The distance to the near clipping plane. |
| `readonly far: number` | The distance to the far clipping plane. |
| `setLayers(mask: number): void` | Sets the layers the camera draws, as a 32-bit mask: it draws the objects whose masks share a layer with it. The default, 1, draws layer 0, where every object starts. |
| `setNearFar(near: number, far: number): void` | Sets the distances to the near and far clipping planes. |
| `screenToRay(x: number, y: number, out: Ray): void` | Writes the ray from the camera through a point on the canvas into `out`: `x` and `y` are CSS pixels from the canvas's top-left corner, as `input.pointer` gives them. A perspective ray starts at the camera, and an orthographic ray on the near plane. The direction has length 1. When the point is the position of the pointer or a finger from `input`, the ray uses the camera of the frame that was on screen at that event, if the engine still keeps it. It keeps the last four views, and frames in a row with the same view count as one. So a click during a fast pan picks what the user saw. Any other point uses the camera of the frame that last ran, with its lens as it is now. Objects stay where they are now, so a moving object can be up to a frame of its motion away from where the user saw it. |
| `worldToScreen(point: Vec3Like, out: Vec3Like): void` | Writes where a point in the world lies on the canvas into `out`: x and y in CSS pixels from the canvas's top-left corner, then the point's depth, its distance in front of the camera along the view. A depth below 0 puts the point behind the camera, where x and y have no meaning. It uses the camera of the frame that last ran, with its lens as it is now, so in `onLateUpdate` it places points where the frame draws them. |

### `CameraOptions`

Interface `CameraOptions`, which extends `NodeOptions`.

Options that both kinds of camera take.

| Member | Description |
| --- | --- |
| `near?: number` | The distance to the near clipping plane. The default is 0.1. |
| `far?: number` | The distance to the far clipping plane. The default is 2000. |
| `target?: Vec3` | A point the camera turns toward. |

### `OrthographicCamera`

Class `OrthographicCamera`, which extends `Camera`.

A camera whose view is a box: things keep their size at every distance, as in maps and isometric games.

| Member | Description |
| --- | --- |
| `readonly isOrthographic: true` | True: an orthographic camera. |
| `readonly height: number` | The view's height in world units. |
| `readonly width: number \| undefined` | The view's width in world units, or undefined when the width follows the canvas's aspect ratio. |
| `setOrthoHeight(height: number): void` | Sets the view's height in world units. A width that follows the canvas keeps following it. A view made from four edges scales about its center and keeps its shape, as three.js's `zoom` scales it. |

### `OrthographicCameraOptions`

Interface `OrthographicCameraOptions`, which extends `CameraOptions`.

Options for `scene.createOrthographicCamera`. Give `height`, and the width follows the canvas's aspect ratio. Or give all four edges, as three.js's `OrthographicCamera` takes them, for a view that keeps its shape on any canvas.

| Member | Description |
| --- | --- |
| `height?: number` | The view's height in world units. The default is 2. Leave it out when you give the edges. |
| `left?: number` | The view's left edge, in world units from the camera's axis. |
| `right?: number` | The view's right edge, in world units from the camera's axis. |
| `top?: number` | The view's top edge, in world units from the camera's axis. |
| `bottom?: number` | The view's bottom edge, in world units from the camera's axis. |

### `PerspectiveCamera`

Class `PerspectiveCamera`, which extends `Camera`.

A camera that shows near things larger than far things, as the eye does.

| Member | Description |
| --- | --- |
| `readonly isOrthographic: false` | False: a perspective camera. |
| `readonly fov: number` | The vertical field of view in degrees. |
| `setFov(degrees: number): void` | Sets the vertical field of view in degrees. |

### `PerspectiveCameraOptions`

Interface `PerspectiveCameraOptions`, which extends `CameraOptions`.

Options for `scene.createPerspectiveCamera`.

| Member | Description |
| --- | --- |
| `fov?: number` | The vertical field of view in degrees. The default is 50. |

### `Ray`

Interface `Ray`.

A ray: a start point and a direction of length 1, in world space.

| Member | Description |
| --- | --- |
| `origin: Vec3Like` | The point the ray starts from. |
| `direction: Vec3Like` | The direction the ray points in, with length 1. |

<!-- null3d:api:end -->
