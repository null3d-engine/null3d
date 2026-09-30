---
id: api/objects
title: Objects and transforms
status: experimental
since: "0.1"
summary: "Setters and getters; parents; flags; destroy."
---

# Objects and transforms

> Ships in null3D 0.1. The API is experimental, so it can still change between versions. The calls `rotateX`, `rotateY`, `rotateZ`, `translate`, `getRotation`, `getWorldQuaternion`, `getWorldMatrix`, `setMesh`, `setCastShadows`, `setReceiveShadows`, `setLayers`, `setRenderOrder`, `setFrustumCulled`, `setBounds`, and `setParent` with `keepWorld` are not built yet, so coding agents must not use them.

Groups, meshes and cameras are objects: nodes in the scene with a position, a rotation, a scale and a parent. Each class extends `Object3D`, so the calls on this page work on all three. Lights are not objects in this version, and [Lights](lights.md) gives their own calls.

```ts
import { defineSketch, vec3 } from '@null3d/engine';

export default defineSketch(({ scene, geometry, materials }) => {
  // A camera and lights, as on the Scene page, go here.
  const arm = scene.createGroup({ name: 'arm', position: [0, 1, 0], dynamic: true });
  const hand = scene.createMesh({
    name: 'hand',
    mesh: geometry.box(),
    material: materials.standard({ color: '#e8554e' }),
    parent: arm,
    position: [2, 0, 0],
    scale: [0.5, 0.5, 0.5],
  });
  const where = vec3.create(); // made once, reused in every frame
  let angle = 0;

  return {
    onUpdate(dt) {
      angle += dt;
      arm.setRotationEuler(0, angle, 0); // the hand swings around with its parent
      hand.getWorldPosition(where); // where the hand was in the last frame
    },
  };
});
```

## Position, rotation and scale

Each object has a position, a rotation and a scale, all relative to its parent. Positions are in meters and angles in radians.

- `setPosition(x, y, z)` and `setScale(x, y, z)` set the position and the scale.
- `setRotation(x, y, z, w)` sets the rotation as a quaternion. `setRotationEuler(x, y, z, order)` sets it from Euler angles, with three.js's axis orders. The default order is `'XYZ'`.
- `lookAt(x, y, z)` turns a mesh or a group so that its +Z axis points at a point. A camera turns its -Z axis there instead. The call assumes that the object's parents are not rotated.

Setters write straight into the engine's memory and mark the object as changed. They send no message and allocate nothing, so `onUpdate` can call them for many objects in every frame. In development builds, a setter that gets `NaN` or an infinite number throws E1203.

## Reading transforms

Getters copy into an array you pass, so they allocate nothing. Make the array once, for example with `vec3.create()`, and reuse it.

- `getPosition(out)` copies the position that you set, relative to the parent.
- `getWorldPosition(out)` copies the position in the world from the last frame that the engine processed. A change that you make in `onUpdate` shows in it from the next `onUpdate` call on.

## Parents

An object gets a parent from the `parent` option, or later from `setParent(parent)`. `setParent(null)` makes it a root object. The object keeps its position, rotation and scale relative to the parent, so its place in the world changes with the new parent.

Children move with their parent. A static child of a dynamic parent follows it too, because the engine recomputes the child whenever the parent moves.

A parent loop puts an object under itself, or under an object below it, so it cannot work. The engine skips that change when it applies it, and logs E1104 to the console.

## Visibility, kind and removal

- `setVisible(false)` hides the object and everything under it. `setVisible(true)` shows it again.
- `setDynamic(true)` makes the engine recompute the object in every frame, and `setDynamic(false)` makes it static again. [Static and dynamic objects](../concepts/static-dynamic.md) explains when each kind costs less.
- `destroy()` removes the object. Its children become root objects and keep their own transforms.
- A mesh changes its material with `setMaterial(material)`.

These calls change the structure of the scene, so they take effect when the engine processes the frame, after `onUpdate` returns. [Scene](scene.md#when-changes-take-effect) gives the details.

After `destroy`, development builds throw E1101 when a setter, `lookAt`, `setParent`, `setVisible`, `setDynamic` or `destroy` reaches the object. Once the frame has removed the object, `getWorldPosition` throws E1101 in every build.

## Names

The `name` option gives an object a name that error messages show, such as `"Crate" (slot 7)`. `describe()` returns that text.

## Related pages

- [Scene](scene.md): creating objects, and when changes take effect.
- [Handles and objects](../concepts/handles.md): how an object keeps its data in the engine's memory.
- [Static and dynamic objects](../concepts/static-dynamic.md): the `dynamic` option.
- [Math helpers](math.md): vectors and quaternions for the setters.

## API reference

<!-- null3d:api:start -->

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

<!-- null3d:api:end -->
