# Controls for null3D

`@null3d/controls` moves the camera of a [null3D](https://github.com/null3d-engine/null3d) sketch
with the mouse, the wheel, a trackpad, touch and the keyboard. It also draws gizmos that move, turn
and scale scene objects. The controls run in the sketch, where the camera is, and add no DOM
listeners. Each `update(dt)` reads the sketch's input once. The controls keep the option names and
behavior of the three.js controls, which helps when you port a scene.

## Install

```sh
bun add @null3d/engine @null3d/controls
```

The package needs `@null3d/engine` at the same version.

## Use

```ts
import { defineSketch } from '@null3d/engine';
import { createOrbitControls } from '@null3d/controls';

export default defineSketch((ctx) => {
  const { scene, geometry, materials } = ctx;
  const camera = scene.createPerspectiveCamera({ fov: 45, position: [3, 2, 5] });
  scene.setActiveCamera(camera);
  scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 3 });
  scene.createMesh({
    mesh: geometry.box(),
    material: materials.standard({ color: '#e8554e' }),
    position: [0, 0.5, 0],
  });

  const controls = createOrbitControls(ctx, camera, {
    target: [0, 0.5, 0],
    enableDamping: true,
    minDistance: 2,
    maxDistance: 12,
    maxPolarAngle: Math.PI * 0.49,
  });

  return {
    onUpdate(dt) {
      controls.update(dt);
    },
  };
});
```

A left drag or one finger turns the camera around the target. The wheel, a pinch and a middle drag
dolly it, and a right drag or two fingers pan. Pass the whole sketch context first: the controls
read its input, the canvas size and the user's motion preference. The camera can be perspective or
orthographic. Each option is also a property, so `controls.enablePan = false` turns off the pan at
any time.

## The page

The controls read the input that the page forwards, so keep the browser's own gestures off the
canvas:

- Give the canvas `touch-action: none` in its CSS. Without it, the browser scrolls or zooms the
  page and cancels the touches.
- Stop the wheel from scrolling the page:
  `canvas.addEventListener('wheel', (e) => e.preventDefault(), { passive: false })`.

## Other controls

- `createMapControls` pans over the ground, as in a map or a strategy game. It takes the orbit
  options.
- `createFlyControls` moves the camera along its own axes and turns it about them, so it can loop
  and roll.
- `createFirstPersonControls` walks over the ground with the keys and looks around with a drag.
  While the page holds the pointer lock (`engine.requestPointerLock()`), the mouse turns the view.
- `createTransformControls` draws handles on one object. A drag of a handle moves, turns or scales
  the object.
- `createDragControls` drags any object of a list over a plane that faces the camera.

## Costs and limits

- The camera controls' `update` allocates nothing.
- If the camera has a parent, the parent must not be rotated.
- Orbit controls do not zoom toward the pointer (`zoomToCursor`) or move with keys (`keys`). They
  do not limit how far the target goes (`minTargetRadius`, `maxTargetRadius`), and they have no
  `saveState` or `reset`. The gizmos do not limit a position (`minX` to `maxZ`).

## Docs

[Controls](https://github.com/null3d-engine/null3d/blob/generated/docs/api/controls.md): every
gesture, option and control, and the pointer lock.

## License

Licensed under either of the Apache License 2.0 or the MIT license, at your option.
