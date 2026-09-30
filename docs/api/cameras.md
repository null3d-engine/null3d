---
id: api/cameras
title: Cameras
status: experimental
since: "0.1"
summary: "Perspective and orthographic cameras; screenToRay; worldToScreen; layers."
---

# Cameras

> Ships in null3D 0.1. The API is experimental, so it can still change between versions. Orthographic cameras, `setOrthoHeight`, `screenToRay` and `worldToScreen` are not built yet, so coding agents must not use them.

A camera is the object that the engine draws the scene from. `scene.createPerspectiveCamera` makes one, and `scene.setActiveCamera` picks the camera that the canvas shows.

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

## The lens

A perspective camera shows near things larger than far things, as the eye does.

- `fov` is the vertical field of view in degrees. The default is 50.
- `near` and `far` are the distances to the nearest and farthest things the camera shows. The defaults are 0.1 and 2000.
- `setFov(degrees)` and `setNearFar(near, far)` change the lens later.

The defaults match three.js's `PerspectiveCamera`. The aspect ratio follows the canvas in every frame, so a camera needs no call when the canvas changes size.

## Moving a camera

A camera is an object, so it has every call of [Objects and transforms](objects.md), such as `setPosition` and `setParent`. A camera looks down its -Z axis. `lookAt` turns that axis toward a point, and the `target` option calls `lookAt` once when the camera is created.

Cameras are dynamic by default, because most cameras move. Pass `dynamic: false` for a camera that stays still. A camera under a parent moves with it: a camera on a car follows the car.

## Layers

`setLayers(mask)` sets the layers that the camera draws, as a 32-bit mask. The camera draws the objects and instance batches whose masks share a bit with its own. The `layers` option sets the mask when you create the camera. The default, 1, draws layer 0, where every new object starts.

A new mask needs no rebuild, so a sketch can switch a camera's layers in any frame. [Render layers](../concepts/render-layers.md) has an example that shows and hides a group of markers.

## Several cameras

A scene can have several cameras, and `setActiveCamera` switches between them. The canvas shows the scene from one camera at a time. Until you pick one, and after the engine removes the active camera, the canvas shows only the background.

## Related pages

- [Scene](scene.md): creating cameras and picking the active one.
- [Objects and transforms](objects.md): the calls that cameras share with other objects.
- [Render layers](../concepts/render-layers.md): which objects a camera draws.
- [Math helpers](math.md): `quat.lookAt`, and why cameras swap its eye and target.

## API reference

<!-- null3d:api:start -->

### `Camera`

Class `Camera`, which extends `Object3D`.

A perspective camera. Make it the scene's view with `scene.setActiveCamera`.

| Member | Description |
| --- | --- |
| `setLayers(mask: number): void` | Sets the layers the camera draws, as a 32-bit mask: it draws the objects whose masks share a layer with it. The default, 1, draws layer 0, where every object starts. |
| `setFov(degrees: number): void` | Sets the vertical field of view in degrees. |
| `setNearFar(near: number, far: number): void` | Sets the distances to the near and far clipping planes. |

### `CameraOptions`

Interface `CameraOptions`, which extends `NodeOptions`.

Options for `scene.createPerspectiveCamera`.

| Member | Description |
| --- | --- |
| `fov?: number` | The vertical field of view in degrees. The default is 50. |
| `near?: number` | The distance to the near clipping plane. The default is 0.1. |
| `far?: number` | The distance to the far clipping plane. The default is 2000. |
| `target?: Vec3` | A point the camera turns toward. |

<!-- null3d:api:end -->
