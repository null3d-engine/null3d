# Grass for null3D

`@null3d/grass` draws grass over a ground in a null3D scene. Tufts of bent blades stand on the
ground's height, skip steep ground and the ground that a mask refuses, and take their places from
integer hashes. One seed therefore places the same grass on every device. The blades bend in the
air of the wind add-on's field, so the grass answers the same gusts as the rest of the scene.

On WebGPU a compute pass builds the blade list each frame. It culls the list to the view, thins the
far tufts and widens their blades, so the cover stays the same. The near shadow cascades draw from
the count that it writes. WebGL2 draws the same rows as an instance batch. Each quality preset draws
its own share of the tufts.

## Use

```ts
import { defineSketch } from '@null3d/engine';
import { createGrass, swayDistanceFor } from '@null3d/grass';
import { createWind } from '@null3d/wind';

export default defineSketch(async (ctx) => {
  const { scene, quality } = ctx;
  const camera = scene.createPerspectiveCamera({ position: [0, 2, 12], target: [0, 0, 0] });
  scene.setActiveCamera(camera);
  scene.createDirectionalLight({ direction: [-0.4, -1, -0.3], intensity: 3, castShadows: true });

  const wind = createWind(ctx, { camera, box: 128 });
  const grass = await createGrass(ctx, {
    height: () => 0,
    area: { x: 0, z: 0, size: 40 },
    count: 20000,
    seed: 7,
    wind: wind.field,
    camera,
    swayDistance: swayDistanceFor(quality.preset),
  });

  return {
    onUpdate() {
      wind.update();
      grass.setWindLayer(wind.field);
    },
  };
});
```

The package needs `@null3d/engine` and `@null3d/wind` at the same version. Its shaders ship
compiled, so a build needs no extra setup for them.

```sh
bun add @null3d/grass @null3d/wind
```

The docs page `api/grass` describes every option.
