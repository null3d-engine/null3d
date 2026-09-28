---
id: api/objects
title: Objects and transforms
status: planned
since: "0.1"
summary: "Setters and getters; parents; flags; destroy."
---

<!-- null3d:placeholder -->

# Objects and transforms

> Planned for null3d 0.1. No release has these APIs yet, so coding agents must not use them. The reference below lists the APIs the engine has now. The rest of the page is not written yet.

This page will cover: Setters and getters; parents; flags; destroy.

## API reference

### `EulerOrder`

```ts
type EulerOrder = 'XYZ' | 'YXZ' | 'ZXY' | 'ZYX' | 'YZX' | 'XZY';
```

The axis order of Euler angles, with three.js's names. `'XYZ'` turns an object about its own X axis, then its Y axis, then its Z axis.

### `Group`

Class `Group`, which extends `Object3D`.

An empty node, for hierarchy.

### `Mesh`

Class `Mesh`, which extends `Object3D`.

A drawn object: a mesh and a material.

| Member | Description |
| --- | --- |
| `setMaterial(material: Material): void` | Changes the material from the next frame. |

### `Object3D`

Class `Object3D`.

A node in the scene: position, rotation and scale, a parent, visibility.

| Member | Description |
| --- | --- |
| `readonly name: string` | The name from the create options, or an empty string. |
| `describe(): string` | The object's name and slot, as error messages show them. |
| `setPosition(x: number, y: number, z: number): void` | Sets the position relative to the parent. |
| `setRotation(x: number, y: number, z: number, w: number): void` | Sets the rotation as a quaternion (x, y, z, w). |
| `setRotationEuler(x: number, y: number, z: number, order: EulerOrder = 'XYZ'): void` | Sets the rotation from Euler angles in radians, with three.js's axis order names. |
| `setScale(x: number, y: number, z: number): void` | Sets the scale on each axis. |
| `lookAt(x: number, y: number, z: number): void` | Turns the object toward a point. It assumes the object's parents are not rotated. |
| `getPosition(out: { [index: number]: number; }): void` | Copies the position into `out`. |
| `getWorldPosition(out: { [index: number]: number; }): void` | Copies the world position of the frame that last ran into `out`. |
| `setParent(parent: Object3D \| null): void` | Moves the object under another, or to the root with null. It keeps its local transform. |
| `setVisible(visible: boolean): void` | Hides or shows the object and everything under it. |
| `setDynamic(dynamic: boolean): void` | Makes the object dynamic or static from the next frame. See `NodeOptions.dynamic`. |
| `destroy(): void` | Removes the object at the next frame. Its children become roots. |

### `Quat`

```ts
type Quat = readonly [number, number, number, number];
```

A rotation as a quaternion (x, y, z, w).

### `Vec3`

```ts
type Vec3 = readonly [number, number, number];
```

A vector (x, y, z).
