---
id: api/math
title: Math helpers
status: experimental
since: "0.1"
summary: "vec3, quat, mat4 and color on plain arrays; math.clamp, lerp, damp and a random generator that hold mode seeds."
---

# Math helpers

> Ships in null3D 0.1. The API is experimental, so it can still change between versions.

The math helpers work on plain arrays, in the style of the gl-matrix library. A helper that makes a vector, a rotation, a matrix or a color writes it into the array you pass first, `out`. It also returns that array. The helpers allocate nothing, so create your arrays once in the setup and reuse them in every frame.

```ts
import { vec3 } from '@null3d/engine';

const offset = vec3.create();          // [0, 0, 0], made once
vec3.set(offset, 1, 2, 3);
vec3.add(offset, offset, [0, 1, 0]);   // offset is now [1, 3, 3]
const length = vec3.length(offset);
```

The engine exports five groups of helpers: `vec3` for vectors, `quat` for rotations, `mat4` for matrices, `color` for colors and `math` for single numbers. They work in the sketch and on the page. A bundler keeps only the helpers that your code calls, so a sketch that calls `vec3.add` downloads that one function.

## Arrays

- A helper reads the first elements of each array it gets: 3 for a vector, 4 for a quaternion and 16 for a matrix. Tuples such as `[0, 1, 0]`, plain arrays and typed arrays all work.
- `out` can also be an input, as in `vec3.normalize(v, v)`. Each helper reads its inputs before it writes.
- `vec3.create()`, `quat.create()` and `mat4.create()` make new arrays, so call them in the setup, never in `onUpdate`.
- Make the arrays that helpers write into with `create()`. An array literal of whole numbers, such as `[0, 0, 0]`, also works. But in Chrome, a helper that has written a fraction into such an array then makes a small object on every call. The `create()` functions make arrays that hold fractions from the start.
- A helper reads an array from its start. To work on one row of an instance batch, copy the row into a scratch vector with `vec3.set`, and copy the result back.

## Example: an object that chases a point

```ts
import { defineSketch, quat, vec3 } from '@null3d/engine';

export default defineSketch(({ scene, geometry, materials, time }) => {
  const camera = scene.createPerspectiveCamera({ position: [0, 6, 12], target: [0, 0, 0] });
  scene.setActiveCamera(camera);
  scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 3 });
  const drone = scene.createMesh({
    mesh: geometry.box({ width: 0.4, height: 0.2, depth: 0.8 }),
    material: materials.standard({ color: '#e8554e' }),
    dynamic: true,
  });

  // Scratch arrays: made once, reused in every frame.
  const goal = vec3.create();
  const position = vec3.create();
  const facing = quat.create();

  return {
    onUpdate(dt) {
      vec3.set(goal, Math.cos(time.now) * 4, 1, Math.sin(time.now) * 4);
      // Close a share of the gap that suits the frame's step, as math.damp does for one number.
      vec3.lerp(position, position, goal, 1 - Math.exp(-3 * dt));
      quat.lookAt(facing, position, goal);
      drone.setPosition(position[0], position[1], position[2]);
      drone.setRotation(facing[0], facing[1], facing[2], facing[3]);
    },
  };
});
```

The [math helpers demo](https://github.com/null3d-engine/null3d/tree/main/examples/math) moves 300 drones this way, as the rows of one instance batch.

## Conventions

- Units are meters and radians. Convert degrees with `math.degToRad`.
- Coordinates are right-handed, with +Y up, as in three.js and glTF.
- A quaternion is (x, y, z, w), in the order that `setRotation` and instance batches use.
- A matrix stores its 16 numbers column by column, as three.js and WebGPU do. Elements 12, 13 and 14 hold the translation.
- `quat.lookAt` turns an object's +Z axis toward a point, as a mesh's `lookAt` does. Cameras and lights look down their -Z axis, so swap the eye and the target for them.
- `quat.fromEuler` takes radians and three.js's axis orders, such as `'XYZ'`. gl-matrix's `fromEuler` takes degrees.
- Where three.js has the same operation, a helper does three.js's arithmetic, so the results match three.js. The reference below names the matching three.js call, where there is one.

## Colors

The color helpers give linear RGB, the color space that the engine lights in. The color options of materials, lights and the background take hex colors, which are sRGB, and convert them for you, as three.js does. They take three linear components as they are, so the helpers' results go straight into them. The colors of an instance batch are linear too, so convert sRGB colors with the helpers first:

```ts
// In the setup: a color for each box.
const boxes = scene.createInstances(geometry.box(), 100, {
  material: materials.standard(),
  colors: true, // a linear RGBA color per row, white to start
});
const rgb = vec3.create();
const colors = boxes.colors as Float32Array;
for (let i = 0; i < boxes.count; i++) {
  color.fromHsl(rgb, i / boxes.count, 0.7, 0.5); // the color three.js's setHSL gives
  colors.set(rgb, i * 4);
}
boxes.markDirty();
color.fromHex(rgb, '#ff8800'); // the linear RGB of an sRGB hex color
```

This version stores a batch's colors but does not draw them yet, so every row shows its material's color.

## Random numbers

`math.random()` gives a number from 0 up to but not including 1, as `Math.random` does. Each thread has one generator:

- It starts from an unpredictable seed, so a live sketch draws new numbers on every run.
- `math.seed(n)` starts it again from the seed `n`, and the same numbers follow on every run. `math.seed(n)` followed by `math.random()` gives what three.js's `MathUtils.seededRandom(n)` gives.
- Hold mode seeds it before the sketch loads, and makes `Math.random` draw from it too. A held frame is then the same on every run. See [Testing your sketch](../guides/testing.md).
- `math.randFloat`, `math.randInt` and `math.randFloatSpread` draw their numbers from it.

## API reference

[The API reference](reference/math.md) lists every export of this page with its type and description. The engine's doc comments make it.
