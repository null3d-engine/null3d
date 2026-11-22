# Terrain for null3D

`@null3d/terrain` draws a height field as the ground of a
[null3D](https://github.com/null3d-engine/null3d) scene. It divides the ground into a quadtree of
blocks around the camera. A block near the camera draws a fine grid, and a far block draws a coarse
grid over more ground. So the near ground keeps its detail, and the far hills stay cheap. One
material blends up to four tiled layers over every block by a splat map. The ground has no
collision.

## Install

```sh
bun add @null3d/terrain @null3d/engine
```

The surface shader ships compiled, so your build needs no extra setup for it.

## Use

```ts
import { defineSketch } from '@null3d/engine';
import { createTerrain, terrainTextures } from '@null3d/terrain';

const ground = (x: number, z: number) => 20 * Math.sin(x * 0.02) * Math.cos(z * 0.02);

export default defineSketch((ctx) => {
  const { scene, textures } = ctx;
  const camera = scene.createPerspectiveCamera({ fov: 55, position: [0, 40, 120], target: [0, 0, 0] });
  scene.setActiveCamera(camera);
  scene.createDirectionalLight({ direction: [-0.4, -1, -0.3], intensity: 3, castShadows: true });
  scene.createAmbientLight({ intensity: 0.5 });

  const layers = terrainTextures(textures, { seed: 1 });
  const terrain = createTerrain(ctx, {
    size: 800,
    height: ground,
    camera,
    layers: [
      { map: layers.grass, tile: 6, roughness: 1, heightFrom: 'alpha' },
      { map: layers.soil, tile: 10, roughness: 1, heightFrom: 'alpha' },
      { map: layers.rock, tile: 7, roughness: 0.85, heightFrom: 'alpha' },
      { map: layers.snow, tile: 12, roughness: 0.7, heightFrom: 'alpha' },
    ],
  });

  const at = [0, 0, 0];
  return {
    onUpdate() {
      camera.getWorldPosition(at);
      terrain.update(at);
    },
  };
});
```

`createTerrain` samples the height field once. The height comes from a function, as here, or from
a height map in a `Float32Array`. Call `update` with the camera's place in each frame. The ground
picks new blocks when the camera crosses a cell of the finest level, so a still camera costs no
work.

## The surface

`terrainTextures` makes four layer maps in code: `grass`, `soil`, `rock` and `snow`. Each one keeps
a height in its alpha channel, so its layer takes `heightFrom: 'alpha'`. Where two layers meet, the
heights push one through the other, so rock shows through grass in ragged patches. The default
splat map comes from the ground itself: grass on low, gentle ground, soil higher up, rock on steep
slopes and snow above. Give `splat` to paint the weights yourself.

Every pixel lights from a normal map baked over the whole ground, so a coarse far block still shows
the relief of the hills. Each block morphs toward its parent's surface as the camera pulls away, so
the ground does not pop when blocks merge. Two options set the detail: `error`, the allowed screen
error in pixels, whose default follows the quality preset, and `maxLevel`, the finest level.

## Placing things on the ground

To stand an object on the ground, read its height with `heightAt(x, z)` and its upright direction
with `normalAt(x, z, out)`. Both allocate nothing, so a frame can call them freely.

## Costs and limits

- A terrain draws one mesh per visible block. A 1,200 meter ground at the default settings draws
  about 200 blocks, near 130,000 triangles, from a camera near the ground. That figure is for a
  picture 1,080 pixels tall.
- The block selection and build run in the add-on's WebAssembly module on the engine's job workers.
  One task builds at most `blocksPerUpdate` new blocks, 16 by default. The ground draws its last
  complete selection until the new one is ready.
- The height field does not change shape after `createTerrain`.
- On a very steep seam between blocks, a thin sliver of a block's skirt can show.

## Docs

The [terrain docs page](https://github.com/null3d-engine/null3d/blob/generated/docs/api/terrain.md)
describes every option. The API is experimental, so it can still change between versions.

## License

Licensed under either of the Apache License 2.0 or the MIT license, at your option.
