---
id: api/math
title: Math helpers
status: planned
since: "0.1"
summary: "vec3, quat, mat4 and color on plain arrays; math.clamp, lerp, damp and a random generator that hold mode seeds."
---

# Math helpers

> Planned for null3D 0.1. No release has these APIs yet, so coding agents must not use them.

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

## Conventions

- Units are meters and radians. Convert degrees with `math.degToRad`.
- Coordinates are right-handed, with +Y up, as in three.js and glTF.
- A quaternion is (x, y, z, w), in the order that `setRotation` and instance batches use.
- A matrix stores its 16 numbers column by column, as three.js and WebGPU do. Elements 12, 13 and 14 hold the translation.
- `quat.lookAt` turns an object's +Z axis toward a point, as a mesh's `lookAt` does. Cameras and lights look down their -Z axis, so swap the eye and the target for them.
- `quat.fromEuler` takes radians and three.js's axis orders, such as `'XYZ'`. gl-matrix's `fromEuler` takes degrees.
- Where three.js has the same operation, a helper does three.js's arithmetic, so the results match three.js. The reference below names the matching three.js call, where there is one.

## Colors

The color helpers give linear RGB, the color space that the engine lights in. The color options of materials, lights and the background take sRGB colors and convert them for you, as three.js does. The colors of an instance batch are linear, so convert sRGB colors with the helpers first:

```ts
// In the setup: a rainbow of boxes.
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

## Random numbers

`math.random()` gives a number from 0 up to but not including 1, as `Math.random` does. Each thread has one generator:

- It starts from an unpredictable seed, so a live sketch draws new numbers on every run.
- `math.seed(n)` starts it again from the seed `n`, and the same numbers follow on every run. `math.seed(n)` followed by `math.random()` gives what three.js's `MathUtils.seededRandom(n)` gives.
- Hold mode seeds it before the sketch loads, and makes `Math.random` draw from it too. A held frame is then the same on every run. See [Testing your sketch](../guides/testing.md).
- `math.randFloat`, `math.randInt` and `math.randFloatSpread` draw their numbers from it.

## API reference

<!-- null3d:api:start -->

### `color`

Namespace `color`.

Colors as linear RGB in plain arrays of three numbers, from hex colors, sRGB components, or hue, saturation and lightness: `color.fromHex(out, '#ff8800')`.

| Member | Description |
| --- | --- |
| `srgbToLinear(c: number): number` | An sRGB component from 0 to 1 as a linear one, as three.js's `SRGBToLinear`. |
| `linearToSrgb(c: number): number` | A linear component from 0 to 1 as an sRGB one, as three.js's `LinearToSRGB`. |
| `fromSrgb<T extends Vec3Like>(out: T, r: number, g: number, b: number): T` | Linear RGB from three sRGB components from 0 to 1, such as a color picker gives. |
| `fromHex<T extends Vec3Like>(out: T, hex: string \| number): T` | Linear RGB from an sRGB hex color: a string such as `'#ff8800'` or `'#f80'`, or a number such as `0xff8800`. It throws E1204 for anything else. |
| `fromHsl<T extends Vec3Like>(out: T, h: number, s: number, l: number): T` | RGB from a hue, a saturation and a lightness, each from 0 to 1, as three.js's `setHSL`. Like three.js, it takes the result as linear RGB, so the same values give the same color in both engines. |

### `EulerOrder`

```ts
type EulerOrder = 'XYZ' | 'YXZ' | 'ZXY' | 'ZYX' | 'YZX' | 'XZY';
```

The axis order of Euler angles, with three.js's names. `'XYZ'` turns an object about its own X axis, then its Y axis, then its Z axis.

### `mat4`

Namespace `mat4`.

4 by 4 matrices in plain arrays of 16 numbers, stored column by column: `mat4.multiply(out, a, b)` writes the product into `out` and returns `out`.

| Member | Description |
| --- | --- |
| `create(): number[]` | A new identity matrix. It allocates, so create matrices once, outside per-frame code. |
| `identity<T extends Mat4Like>(out: T): T` | Sets `out` to the identity matrix, which changes nothing. |
| `copy<T extends Mat4Like>(out: T, a: Mat4Like): T` | Copies `a` into `out`. |
| `multiply<T extends Mat4Like>(out: T, a: Mat4Like, b: Mat4Like): T` | The product of `a` and `b`, as three.js's `multiplyMatrices`. It transforms a point by `b` first, then by `a`. |
| `invert<T extends Mat4Like>(out: T, a: Mat4Like): T` | The inverse of `a`, which undoes it, as three.js's `invert`. A matrix that has no inverse gives all zeros. |
| `compose<T extends Mat4Like>(out: T, position: Vec3Like, rotation: QuatLike, scale: Vec3Like): T` | The matrix that scales by `scale`, then turns by the quaternion `rotation`, then moves by `position`, as three.js's `compose`. |
| `decompose(position: Vec3Like, rotation: QuatLike, scale: Vec3Like, m: Mat4Like): void` | Splits the matrix `m` into the position, rotation and scale that `compose` joins, as three.js's `decompose`, and writes them into the first three arrays. A matrix that mirrors space gives a negative X scale. A matrix that flattens space gives no rotation and a scale of 1. |

### `Mat4Like`

```ts
type Mat4Like = { [index: number]: number; };
```

A 4 by 4 matrix in an array of 16 numbers, stored column by column, as three.js and WebGPU store matrices. Elements 12, 13 and 14 hold the translation.

### `math`

Namespace `math`.

Number helpers with three.js's names, such as `math.clamp` and `math.damp`, and a random generator that a sketch can seed and that hold mode seeds.

| Member | Description |
| --- | --- |
| `clamp(value: number, min: number, max: number): number` | `value` limited to the range from `min` to `max`. |
| `lerp(x: number, y: number, t: number): number` | The number a fraction `t` of the way from `x` to `y`. |
| `inverseLerp(x: number, y: number, value: number): number` | The fraction of the way from `x` to `y` at which `value` lies: the reverse of `lerp`. It is 0 when `x` equals `y`. |
| `mapLinear(x: number, a1: number, a2: number, b1: number, b2: number): number` | `x` moved from the range `a1` to `a2` onto the range `b1` to `b2`. |
| `damp(x: number, y: number, lambda: number, dt: number): number` | Moves `x` toward `y` by an amount that suits the frame's step `dt` in seconds, so the motion looks the same at every frame rate. A larger `lambda` moves faster. |
| `smoothstep(x: number, min: number, max: number): number` | 0 when `x` is at or below `min`, 1 at or above `max`, and a smooth curve between them. |
| `degToRad(degrees: number): number` | An angle in degrees as radians. |
| `radToDeg(radians: number): number` | An angle in radians as degrees. |
| `euclideanModulo(n: number, m: number): number` | The remainder of `n` divided by `m`, with the sign of `m`. For example, -1 modulo 3 is 2. |
| `random(): number` | The next random number, from 0 up to but not including 1. Each thread has one generator, which starts from an unpredictable seed. Hold mode seeds it, so a sketch that draws its numbers from it draws the same frame on every run. The generator is mulberry32, as in three.js's `seededRandom`. |
| `seed(value: number): void` | Starts `random` again from a seed, an integer. The same seed always gives the same numbers: `math.seed(s)` followed by `math.random()` gives what three.js's `seededRandom(s)` gives. |
| `randFloat(low: number, high: number): number` | A random number from `low` up to but not including `high`. |
| `randInt(low: number, high: number): number` | A random integer from `low` to `high`, both included. |
| `randFloatSpread(range: number): number` | A random number from `-range / 2` to `range / 2`. |

### `quat`

Namespace `quat`.

Rotations as quaternions (x, y, z, w) in plain arrays, with angles in radians: `quat.setAxisAngle(out, [0, 1, 0], angle)` writes the rotation into `out` and returns `out`.

| Member | Description |
| --- | --- |
| `create(): [number, number, number, number]` | A new quaternion (0, 0, 0, 1), which turns nothing. It allocates, so create quaternions once, outside per-frame code. |
| `set<T extends QuatLike>(out: T, x: number, y: number, z: number, w: number): T` | Sets the components of `out`. |
| `copy<T extends QuatLike>(out: T, a: QuatLike): T` | Copies `a` into `out`. |
| `identity<T extends QuatLike>(out: T): T` | Sets `out` to (0, 0, 0, 1), which turns nothing. |
| `setAxisAngle<T extends QuatLike>(out: T, axis: Vec3Like, rad: number): T` | The rotation of `rad` radians about `axis`, a vector of length 1. |
| `fromEuler<T extends QuatLike>(out: T, x: number, y: number, z: number, order: EulerOrder = 'XYZ'): T` | The rotation of Euler angles in radians, applied in `order`, as three.js's `setFromEuler`. gl-matrix's `fromEuler` takes degrees, but this one takes radians. |
| `fromMat4<T extends QuatLike>(out: T, m: Mat4Like): T` | The rotation of the matrix `m`, whose upper 3 by 3 part must hold no scale, as three.js's `setFromRotationMatrix`. To read the rotation of a matrix with scale, use `mat4.decompose`. |
| `lookAt<T extends QuatLike>(out: T, eye: Vec3Like, target: Vec3Like, up?: Vec3Like): T` | The rotation that turns an object at `eye` so that its +Z axis points at `target`, with its +Y axis as close to `up` as it can be, or to +Y without `up`. A mesh looks at a point this way, in null3D and in three.js. Cameras and lights look down their -Z axis instead: for them, swap `eye` and `target`. |
| `rotationTo<T extends QuatLike>(out: T, a: Vec3Like, b: Vec3Like): T` | The shortest rotation that turns the direction `a` onto the direction `b`, as three.js's `setFromUnitVectors`. Both vectors must have length 1. |
| `multiply<T extends QuatLike>(out: T, a: QuatLike, b: QuatLike): T` | The product of `a` and `b`, as three.js's `multiplyQuaternions`. It turns a vector by `b` first, then by `a`. |
| `rotateX<T extends QuatLike>(out: T, a: QuatLike, rad: number): T` | Turns the rotation `a` by `rad` radians about its own X axis. |
| `rotateY<T extends QuatLike>(out: T, a: QuatLike, rad: number): T` | Turns the rotation `a` by `rad` radians about its own Y axis. |
| `rotateZ<T extends QuatLike>(out: T, a: QuatLike, rad: number): T` | Turns the rotation `a` by `rad` radians about its own Z axis. |
| `invert<T extends QuatLike>(out: T, a: QuatLike): T` | The rotation that undoes `a`, a quaternion of length 1, as three.js's `invert`. |
| `normalize<T extends QuatLike>(out: T, a: QuatLike): T` | Scales `a` to length 1. A zero quaternion becomes (0, 0, 0, 1). |
| `dot(a: QuatLike, b: QuatLike): number` | The dot product of `a` and `b`. |
| `slerp<T extends QuatLike>(out: T, a: QuatLike, b: QuatLike, t: number): T` | The rotation a fraction `t` of the way from `a` to `b` along the shortest arc, turning at an even speed, as three.js's `slerp`. |

### `QuatLike`

```ts
type QuatLike = { [index: number]: number; };
```

A rotation as a quaternion (x, y, z, w) in an array: a tuple, a plain array or a typed array. The math helpers read and write its first four elements.

### `vec3`

Namespace `vec3`.

Vectors (x, y, z) in plain arrays, in the style of gl-matrix: `vec3.add(out, a, b)` writes the sum into `out` and returns `out`, so per-frame code allocates nothing.

| Member | Description |
| --- | --- |
| `create(): [number, number, number]` | A new vector (0, 0, 0). It allocates, so create vectors once, outside per-frame code. |
| `set<T extends Vec3Like>(out: T, x: number, y: number, z: number): T` | Sets the components of `out`. |
| `copy<T extends Vec3Like>(out: T, a: Vec3Like): T` | Copies `a` into `out`. |
| `add<T extends Vec3Like>(out: T, a: Vec3Like, b: Vec3Like): T` | Adds `a` and `b`. |
| `sub<T extends Vec3Like>(out: T, a: Vec3Like, b: Vec3Like): T` | Subtracts `b` from `a`. |
| `multiply<T extends Vec3Like>(out: T, a: Vec3Like, b: Vec3Like): T` | Multiplies `a` and `b` component by component. |
| `scale<T extends Vec3Like>(out: T, a: Vec3Like, s: number): T` | Multiplies `a` by the number `s`. |
| `scaleAndAdd<T extends Vec3Like>(out: T, a: Vec3Like, b: Vec3Like, s: number): T` | Adds `b` times the number `s` to `a`, as three.js's `addScaledVector`. |
| `negate<T extends Vec3Like>(out: T, a: Vec3Like): T` | Reverses the direction of `a`. |
| `dot(a: Vec3Like, b: Vec3Like): number` | The dot product of `a` and `b`. |
| `cross<T extends Vec3Like>(out: T, a: Vec3Like, b: Vec3Like): T` | The cross product of `a` and `b`: a vector at right angles to both. |
| `length(a: Vec3Like): number` | The length of `a`. |
| `squaredLength(a: Vec3Like): number` | The squared length of `a`. It skips the square root, so use it to compare lengths. |
| `distance(a: Vec3Like, b: Vec3Like): number` | The distance between the points `a` and `b`. |
| `squaredDistance(a: Vec3Like, b: Vec3Like): number` | The squared distance between the points `a` and `b`. It skips the square root, so use it to compare distances. |
| `normalize<T extends Vec3Like>(out: T, a: Vec3Like): T` | Scales `a` to length 1. A zero vector stays zero. |
| `lerp<T extends Vec3Like>(out: T, a: Vec3Like, b: Vec3Like, t: number): T` | The point a fraction `t` of the way from `a` to `b`. |
| `min<T extends Vec3Like>(out: T, a: Vec3Like, b: Vec3Like): T` | The smaller of `a` and `b` on each axis. |
| `max<T extends Vec3Like>(out: T, a: Vec3Like, b: Vec3Like): T` | The larger of `a` and `b` on each axis. |
| `angle(a: Vec3Like, b: Vec3Like): number` | The angle between `a` and `b` in radians, from 0 to π. It is π / 2 when either vector is zero. |
| `transformQuat<T extends Vec3Like>(out: T, a: Vec3Like, q: QuatLike): T` | Turns `a` by the rotation `q`, a quaternion of length 1, as three.js's `applyQuaternion`. |
| `transformMat4<T extends Vec3Like>(out: T, a: Vec3Like, m: Mat4Like): T` | Transforms the point `a` by the matrix `m`, with the perspective divide, as three.js's `applyMatrix4`. |

### `Vec3Like`

```ts
type Vec3Like = { [index: number]: number; };
```

A vector (x, y, z) in an array: a tuple such as `[0, 1, 0]`, a plain array or a typed array. The math helpers read and write its first three elements.

<!-- null3d:api:end -->
