# Water for null3D

`@null3d/water` draws the water in a null3D scene: a river that follows a line, or a lake that fills
an outline, from one description. The surface has waves and ripples that the current carries,
caustics on the bed, foam around what breaks the surface, a shore that fades against the bank, and a
mirror of the banks and the sky that redraws as often as the quality preset affords. A camera that
dips under the surface keeps it, and a second effect tints, bends and lights the view from below.

## Use

```ts
import { defineSketch } from '@null3d/engine';
import { createUnderwater, createWater, foamMap } from '@null3d/water';

export default defineSketch((ctx) => {
  const { scene, geometry, materials } = ctx;
  const camera = scene.createPerspectiveCamera({ position: [0, 3, 12], target: [0, 0, 0] });
  scene.setActiveCamera(camera);
  scene.createDirectionalLight({ direction: [-0.4, -1, -0.3], intensity: 3 });

  const water = createWater(ctx, {
    shapes: [
      {
        kind: 'river',
        middle: [[-60, 0], [-30, 3], [0, 0], [30, -2]],
        halfWidth: 3,
        depth: 1.2,
        speed: 0.5,
      },
      {
        kind: 'lake',
        shore: [[40, -20], [90, -14], [96, 12], [52, 22]],
        depth: 3,
        shoreWidth: 5,
      },
    ],
    foam: foamMap(ctx, [{ x: 0, z: 0.4, r: 0.6 }], {
      origin: [-60, -12],
      size: [160, 24],
    }),
  });
  const underwater = createUnderwater(ctx, camera, water);
  const caustics: [number, number, number] = [0.6, 0.55, 0.4];
  water.setCaustics(caustics);

  return {
    onUpdate() {
      underwater.update(ctx.time.now, [0.7, 0.85, 1], caustics);
      water.update();
    },
  };
});
```

The mesh, the material and the reflection come from the shapes. `update` draws the reflection in
its turn, so call it once in each frame. `surfaceHeight` and `currentAt` give the water at a point,
for a boat or a leaf that floats on it, and `waterBody(shape)` resolves a shape on its own.

## The two bodies

A river takes the points along its middle, from its source to its mouth, its half width and its
depth. Its current runs along the middle line at `speed`. A lake takes the points around its shore,
the depth of its deepest point, and how far from the shore the bed reaches that depth. Its water is
still. The bed under a point comes from the description, and the surface reads the scene's own depth
where the bed is drawn, so a shore ends against the real bank.

A depth may be one number, one for each point of a middle line, or a function of the point. A river
may also take the depth as a function of the distance along it, and a lake as a function of the
distance from its shore.

## Costs and limits

- The surface is a custom material that declares `sceneInputs: ['sceneDepth']` and two textures, the
  mirror and the foam map. The engine's depth input gives the water its depth behind each pixel. The
  engine refuses the pair when the build has no room for both, so a page needs an engine that takes a
  depth-reading material with textures.
- The reflection pass draws the scene a second time. Its cadence is every other frame on Low and
  Medium, and every frame on High and Ultra; `reflectionEvery` gives a cadence of the caller's own.
  The pass follows the preset as it changes.
- The surface lets light through with transmission, so the engine copies the scene's colors in the
  frame that the water draws. It draws both faces, so it shows from under the water.
- The water costs no memory until a scene creates it: the add-on's code and its two shaders load
  only when a sketch imports it.

`@null3d/water` owns all water. A scene makes water with it rather than with a hand-written custom
material, so there is one way to make water and one set of settings for it.
