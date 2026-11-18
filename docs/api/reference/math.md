---
id: api/reference/math
title: "Math helpers: API reference"
status: generated
since: "0.1"
summary: "Every export of the Math helpers API, from the engine's doc comments."
---

# Math helpers: API reference

> [Math helpers](../math.md) explains these exports. The engine's doc comments make this page.

## `color`

Namespace `color`.

Colors as linear RGB in plain arrays of three numbers, from hex colors, sRGB components, or hue, saturation and lightness: `color.fromHex(out, '#ff8800')`.

| Member | Description |
| --- | --- |
| `srgbToLinear(c: number): number` | An sRGB component from 0 to 1 as a linear one, as three.js's `SRGBToLinear`. |
| `linearToSrgb(c: number): number` | A linear component from 0 to 1 as an sRGB one, as three.js's `LinearToSRGB`. |
| `fromSrgb<T extends Vec3Like>(out: T, r: number, g: number, b: number): T` | Linear RGB from three sRGB components from 0 to 1, such as a color picker gives. |
| `fromHex<T extends Vec3Like>(out: T, hex: string \| number): T` | Linear RGB from an sRGB hex color: a string such as `'#ff8800'` or `'#f80'`, or a number such as `0xff8800`. It throws E1204 for anything else. |
| `fromHsl<T extends Vec3Like>(out: T, h: number, s: number, l: number): T` | RGB from a hue, a saturation and a lightness, each from 0 to 1, as three.js's `setHSL`. Like three.js, it takes the result as linear RGB, so the same values give the same color in both engines. |

## `createMath`

```ts
function createMath(functions: MathFunctions): MathHelpers
```

The math helpers that need a sine, a cosine, an arc cosine or an exponential, built on the four functions given: `quat.setAxisAngle`, `fromEuler`, `rotateX`, `rotateY`, `rotateZ` and `slerp`, `vec3.angle` and `math.damp`. Each does the same arithmetic as the main entry's helper of its name, which uses the browser's `Math`. Pass an exact math library's functions, and a deterministic simulation gets the same bits on every JavaScript engine. Call it once, outside per-frame code: it allocates the helpers. Throws E1213 when one of the four is not a function.

## `EulerOrder`

```ts
type EulerOrder = 'XYZ' | 'YXZ' | 'ZXY' | 'ZYX' | 'YZX' | 'XZY';
```

The axis order of Euler angles, with three.js's names. `'XYZ'` turns an object about its own X axis, then its Y axis, then its Z axis.

## `mat4`

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

## `Mat4Like`

```ts
type Mat4Like = { [index: number]: number; };
```

A 4 by 4 matrix in an array of 16 numbers, stored column by column, as three.js and WebGPU store matrices. Elements 12, 13 and 14 hold the translation.

## `math`

Namespace `math`.

Number helpers with three.js's names, such as `math.clamp` and `math.damp`, and a random generator that a sketch can seed and that hold mode seeds.

| Member | Description |
| --- | --- |
| `damp(x: number, y: number, lambda: number, dt: number): number` | Moves `x` toward `y` by an amount that suits the frame's step `dt` in seconds, so the motion looks the same at every frame rate. A larger `lambda` moves faster. |
| `clamp(value: number, min: number, max: number): number` | `value` limited to the range from `min` to `max`. |
| `lerp(x: number, y: number, t: number): number` | The number a fraction `t` of the way from `x` to `y`. |
| `inverseLerp(x: number, y: number, value: number): number` | The fraction of the way from `x` to `y` at which `value` lies: the reverse of `lerp`. It is 0 when `x` equals `y`. |
| `mapLinear(x: number, a1: number, a2: number, b1: number, b2: number): number` | `x` moved from the range `a1` to `a2` onto the range `b1` to `b2`. |
| `smoothstep(x: number, min: number, max: number): number` | 0 when `x` is at or below `min`, 1 at or above `max`, and a smooth curve between them. |
| `degToRad(degrees: number): number` | An angle in degrees as radians. |
| `radToDeg(radians: number): number` | An angle in radians as degrees. |
| `euclideanModulo(n: number, m: number): number` | The remainder of `n` divided by `m`, with the sign of `m`. For example, -1 modulo 3 is 2. |
| `random(): number` | The next random number, from 0 up to but not including 1. Each thread has one generator, which starts from an unpredictable seed. Hold mode seeds it, so a sketch that draws its numbers from it draws the same frame on every run. The generator is mulberry32, as in three.js's `seededRandom`. |
| `seed(value: number): void` | Starts `random` again from a seed, an integer. The same seed always gives the same numbers: `math.seed(s)` followed by `math.random()` gives what three.js's `seededRandom(s)` gives. |
| `randFloat(low: number, high: number): number` | A random number from `low` up to but not including `high`. |
| `randInt(low: number, high: number): number` | A random integer from `low` to `high`, both included. |
| `randFloatSpread(range: number): number` | A random number from `-range / 2` to `range / 2`. |

## `MathFunctions`

Interface `MathFunctions`.

The four functions that `createMath` builds its helpers on, each taking and giving radians where it takes an angle. An exact math library that gives the same bits on every JavaScript engine has them, under these names or others. The helpers call each one as a plain function, with no `this`.

| Member | Description |
| --- | --- |
| `sin(x: number): number` | The sine of an angle in radians. |
| `cos(x: number): number` | The cosine of an angle in radians. |
| `acos(x: number): number` | The angle in radians, from 0 to π, whose cosine is `x`. |
| `exp(x: number): number` | e raised to the power `x`. |

## `MathHelpers`

Interface `MathHelpers`.

The helpers that `createMath` returns, grouped and named as the main entry's namespaces group and name them.

| Member | Description |
| --- | --- |
| `readonly quat: QuatHelpers` | `setAxisAngle`, `fromEuler`, `rotateX`, `rotateY`, `rotateZ` and `slerp`. |
| `readonly vec3: Vec3Helpers` | `angle`. |
| `readonly math: NumberHelpers` | `damp`. |

## `NumberHelpers`

Interface `NumberHelpers`.

The number helper that `createMath` builds, with the same arguments and arithmetic as `math.damp`.

| Member | Description |
| --- | --- |
| `damp(x: number, y: number, lambda: number, dt: number): number` | Moves `x` toward `y` by an amount that suits the step `dt` in seconds, as `math.damp`. |

## `quat`

Namespace `quat`.

Rotations as quaternions (x, y, z, w) in plain arrays, with angles in radians: `quat.setAxisAngle(out, [0, 1, 0], angle)` writes the rotation into `out` and returns `out`.

| Member | Description |
| --- | --- |
| `setAxisAngle<T extends QuatLike>(out: T, axis: Vec3Like, rad: number): T` | The rotation of `rad` radians about `axis`, a vector of length 1. |
| `fromEuler<T extends QuatLike>(out: T, x: number, y: number, z: number, order?: EulerOrder): T` | The rotation of Euler angles in radians, applied in `order`, `'XYZ'` by default, as three.js's `setFromEuler`. gl-matrix's `fromEuler` takes degrees, but this one takes radians. |
| `rotateX<T extends QuatLike>(out: T, a: QuatLike, rad: number): T` | Turns the rotation `a` by `rad` radians about its own X axis. |
| `rotateY<T extends QuatLike>(out: T, a: QuatLike, rad: number): T` | Turns the rotation `a` by `rad` radians about its own Y axis. |
| `rotateZ<T extends QuatLike>(out: T, a: QuatLike, rad: number): T` | Turns the rotation `a` by `rad` radians about its own Z axis. |
| `slerp<T extends QuatLike>(out: T, a: QuatLike, b: QuatLike, t: number): T` | The rotation a fraction `t` of the way from `a` to `b` along the shortest arc, turning at an even speed, as three.js's `slerp`. |
| `create(): [number, number, number, number]` | A new quaternion (0, 0, 0, 1), which turns nothing. It allocates, so create quaternions once, outside per-frame code. |
| `set<T extends QuatLike>(out: T, x: number, y: number, z: number, w: number): T` | Sets the components of `out`. |
| `copy<T extends QuatLike>(out: T, a: QuatLike): T` | Copies `a` into `out`. |
| `identity<T extends QuatLike>(out: T): T` | Sets `out` to (0, 0, 0, 1), which turns nothing. |
| `fromMat4<T extends QuatLike>(out: T, m: Mat4Like): T` | The rotation of the matrix `m`, whose upper 3 by 3 part must hold no scale, as three.js's `setFromRotationMatrix`. To read the rotation of a matrix with scale, use `mat4.decompose`. |
| `lookAt<T extends QuatLike>(out: T, eye: Vec3Like, target: Vec3Like, up?: Vec3Like): T` | The rotation that turns an object at `eye` so that its +Z axis points at `target`, with its +Y axis as close to `up` as it can be, or to +Y without `up`. A mesh looks at a point this way, in null3D and in three.js. Cameras and lights look down their -Z axis instead: for them, swap `eye` and `target`. |
| `rotationTo<T extends QuatLike>(out: T, a: Vec3Like, b: Vec3Like): T` | The shortest rotation that turns the direction `a` onto the direction `b`, as three.js's `setFromUnitVectors`. Both vectors must have length 1. |
| `multiply<T extends QuatLike>(out: T, a: QuatLike, b: QuatLike): T` | The product of `a` and `b`, as three.js's `multiplyQuaternions`. It turns a vector by `b` first, then by `a`. |
| `invert<T extends QuatLike>(out: T, a: QuatLike): T` | The rotation that undoes `a`, a quaternion of length 1, as three.js's `invert`. |
| `normalize<T extends QuatLike>(out: T, a: QuatLike): T` | Scales `a` to length 1. A zero quaternion becomes (0, 0, 0, 1). |
| `dot(a: QuatLike, b: QuatLike): number` | The dot product of `a` and `b`. |

## `QuatHelpers`

Interface `QuatHelpers`.

The quaternion helpers that `createMath` builds: the ones that turn by an angle. Each takes the same arguments as the `quat` helper of its name, and does the same arithmetic with the functions that `createMath` got.

| Member | Description |
| --- | --- |
| `setAxisAngle<T extends QuatLike>(out: T, axis: Vec3Like, rad: number): T` | The rotation of `rad` radians about `axis`, a vector of length 1, as `quat.setAxisAngle`. |
| `fromEuler<T extends QuatLike>(out: T, x: number, y: number, z: number, order?: EulerOrder): T` | The rotation of Euler angles in radians, applied in `order`, as `quat.fromEuler`. |
| `rotateX<T extends QuatLike>(out: T, a: QuatLike, rad: number): T` | Turns the rotation `a` by `rad` radians about its own X axis, as `quat.rotateX`. |
| `rotateY<T extends QuatLike>(out: T, a: QuatLike, rad: number): T` | Turns the rotation `a` by `rad` radians about its own Y axis, as `quat.rotateY`. |
| `rotateZ<T extends QuatLike>(out: T, a: QuatLike, rad: number): T` | Turns the rotation `a` by `rad` radians about its own Z axis, as `quat.rotateZ`. |
| `slerp<T extends QuatLike>(out: T, a: QuatLike, b: QuatLike, t: number): T` | The rotation a fraction `t` of the way from `a` to `b` along the shortest arc, as `quat.slerp`. |

## `QuatLike`

```ts
type QuatLike = { [index: number]: number; };
```

A rotation as a quaternion (x, y, z, w) in an array: a tuple, a plain array or a typed array. The math helpers read and write its first four elements.

## `Vec2Like`

```ts
type Vec2Like = { [index: number]: number; };
```

A point or a direction (u, v), such as a texture coordinate, in an array: a tuple such as `[0, 0]`, a plain array or a typed array. A helper that reads it reads its first two elements.

## `vec3`

Namespace `vec3`.

Vectors (x, y, z) in plain arrays, in the style of gl-matrix: `vec3.add(out, a, b)` writes the sum into `out` and returns `out`, so per-frame code allocates nothing.

| Member | Description |
| --- | --- |
| `angle(a: Vec3Like, b: Vec3Like): number` | The angle between `a` and `b` in radians, from 0 to π. It is π / 2 when either vector is zero. |
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
| `transformQuat<T extends Vec3Like>(out: T, a: Vec3Like, q: QuatLike): T` | Turns `a` by the rotation `q`, a quaternion of length 1, as three.js's `applyQuaternion`. |
| `transformMat4<T extends Vec3Like>(out: T, a: Vec3Like, m: Mat4Like): T` | Transforms the point `a` by the matrix `m`, with the perspective divide, as three.js's `applyMatrix4`. |

## `Vec3Helpers`

Interface `Vec3Helpers`.

The vector helper that `createMath` builds, with the same arguments and arithmetic as `vec3.angle`.

| Member | Description |
| --- | --- |
| `angle(a: Vec3Like, b: Vec3Like): number` | The angle between `a` and `b` in radians, from 0 to π, as `vec3.angle`. |

## `Vec3Like`

```ts
type Vec3Like = { [index: number]: number; };
```

A vector (x, y, z) in an array: a tuple such as `[0, 1, 0]`, a plain array or a typed array. The math helpers read and write its first three elements.
