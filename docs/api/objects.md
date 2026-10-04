---
id: api/objects
title: Objects and transforms
status: experimental
since: "0.1"
summary: "Setters and getters; parents; flags; destroy; pointer events."
---

# Objects and transforms

> Ships in null3D 0.1, with pointer events from null3D 0.2. The API is experimental, so it can still change between versions.

Groups, meshes, cameras and lights are objects: nodes in the scene with a position, a rotation, a scale and a parent. Each class extends `Object3D`, so the calls in the first sections of this page work on all of them. Meshes have more calls, which [Mesh calls](#mesh-calls) lists, and [Lights](lights.md) gives the calls of each kind of light.

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
    dynamic: true,
  });
  const where = vec3.create(); // made once, reused in every frame

  return {
    onUpdate(dt) {
      arm.rotateY(dt); // the hand swings around with its parent
      hand.rotateX(2 * dt); // and spins about its own X axis
      hand.getWorldPosition(where); // where the hand was in the last frame
    },
  };
});
```

## Position, rotation and scale

Each object has a position, a rotation and a scale, all relative to its parent. Positions are in meters and angles in radians.

- `setPosition(x, y, z)` and `setScale(x, y, z)` set the position and the scale.
- `setRotation(x, y, z, w)` sets the rotation as a quaternion. `setRotationEuler(x, y, z, order)` sets it from Euler angles, with three.js's axis orders. The default order is `'XYZ'`.
- `rotateX(angle)`, `rotateY(angle)` and `rotateZ(angle)` turn the object about its own axes, as three.js's calls of the same names do.
- `translate(x, y, z)` moves the object along its own axes, as three.js's `translateX`, `translateY` and `translateZ` do together. The object's rotation turns the vector, but its scale does not stretch it. So `camera.translate(0, 0, -1)` moves a camera 1 m forward.
- `lookAt(x, y, z)` turns a mesh or a group so that its +Z axis points at a point. A camera or a light turns its -Z axis there instead. The call assumes that the object's parents are not rotated.

Setters write straight into the engine's memory and mark the object as changed. They send no message and allocate nothing, so `onUpdate` can call them for many objects in every frame. In development builds, a setter that gets `NaN` or an infinite number throws E1203.

Positions are 32-bit floats by default, which move in steps of 6 cm at 1,000 km from the origin. An engine started with `largeWorld: true` keeps each position that you set exact at any distance. [Large worlds and precision](../concepts/large-worlds.md) explains both.

## Reading transforms

Getters copy into an array you pass, so they allocate nothing. Make the array once, for example with `vec3.create()`, and reuse it.

- `getPosition(out)` copies the position that you set, relative to the parent. In large-world mode it keeps its full precision, so pass a plain array or a `Float64Array`. `getRotation(out)` copies the rotation, as a quaternion (x, y, z, w).
- `getWorldPosition(out)` copies the position in the world, and `getWorldQuaternion(out)` the rotation in the world.
- `getWorldMatrix(out)` copies the world matrix: 16 numbers, column by column, as the [math helpers](math.md) and three.js's `matrixWorld` hold them.

The world getters read the engine's last transform update. A change that you make in `onUpdate` shows in them in the same frame's `onLateUpdate`, and from the next `onUpdate` call on. Their positions are 64-bit numbers, which keep their precision far from the origin. Pass a plain array or a `Float64Array`, because a `Float32Array` rounds them to 32 bits.

## Parents

An object gets a parent from the `parent` option, or later from `setParent(parent)`. `setParent(null)` makes it a root object.

By default the object keeps its position, rotation and scale relative to the parent, as three.js's `add` does. Its place in the world then changes with the new parent. `setParent(parent, { keepWorld: true })` keeps its place, rotation and size in the world instead, as three.js's `attach` does. The engine gives the object the position, rotation and scale that do that under the new parent.

```ts
// Pick up a crate: it stays where it is, then moves with the hand.
crate.setParent(hand, { keepWorld: true });
```

In the [objects and parents demo](https://github.com/null3d-engine/null3d/tree/main/examples/objects), crates step on and off a turntable this way.

The engine works out those values when it applies the change, after `onUpdate` returns. It uses the transforms that the object and both parents have at that moment. So set the object's own transform before `setParent` in the same frame. A setter called after it writes a value relative to the old parent.

Two kinds of parent change the result:

- A parent that is turned and scaled by different amounts on its axes shears its children. No position, rotation and scale can express a shear. The object keeps its place, but its rotation and scale come out close to the old ones. three.js has the same limit.
- A parent scaled to 0 on an axis flattens its children, and no transform can undo that. The object then keeps its values relative to the parent.

Children move with their parent. A static child of a dynamic parent follows it too, because the engine recomputes the child whenever the parent moves.

A parent loop puts an object under itself, or under an object below it, so it cannot work. In development builds, `setParent` throws E1104 when an object is given itself as its parent. The engine skips any other loop when it applies it, and logs E1104 to the console.

## Visibility, kind and removal

- `setVisible(false)` hides the object and everything under it. `setVisible(true)` shows it again.
- `setDynamic(true)` makes the engine recompute the object in every frame, and `setDynamic(false)` makes it static again. [Static and dynamic objects](../concepts/static-dynamic.md) explains when each kind costs less.
- `destroy()` removes the object. Its children become root objects and keep their own transforms.

These calls change the structure of the scene, so they take effect when the engine processes the frame, after `onUpdate` returns. [Scene](scene.md#when-changes-take-effect) gives the details.

In development builds, every call on an object apart from `describe` throws E1101 once you destroy the object. So does a call that gets a destroyed object, such as `setParent`. Once the frame has removed the object, the world getters throw E1101 in every build. In a release build, the other calls on a destroyed object change nothing, and never reach the object that takes its slot ([Handles](../concepts/handles.md#stale-handles)).

## Layers

`setLayers(mask)` puts the object on the layers of a 32-bit mask: bit n puts it on layer n. A camera draws the object only when their masks share a bit. New objects are on layer 0, which every new camera draws. The `layers` option sets the mask when you create the object.

The mask belongs to the object alone, so its children keep their own. Like `setVisible`, `setLayers` takes effect when the engine processes the frame, and it rebuilds nothing. In development builds, a mask that is not a whole number of 32 bits throws E1207. [Render layers](../concepts/render-layers.md) explains masks in full.

## Mesh calls

A mesh has these calls besides the ones above. Like the structural calls, they take effect in the next frame.

- `setMaterial(material)` changes the material, and `setMesh(mesh)` changes the shape. The new mesh's bounding sphere replaces any bounds that `setBounds` gave.
- `setCastShadows(true)` and `setReceiveShadows(true)` make the mesh cast and receive the directional light's shadows, as three.js's `castShadow` and `receiveShadow` do. The `castShadows` and `receiveShadows` options of `createMesh` set them at the start. Both are false by default. Unlit materials show no shadows. [Shadows](../concepts/shadows.md) explains them.
- `setRenderOrder(order)` sets the order in which blended objects draw, lower first, as three.js's `renderOrder` does. Objects of one order draw farthest first. The engine orders opaque and masked objects itself, for speed, as the depth test decides what shows. The order costs nothing: the engine sorts blended objects in every frame anyway. [Materials and pipelines](../concepts/materials.md#the-transparent-pass) explains the sort.
- `setFrustumCulled(false)` makes the engine draw the mesh even when its bounds are out of view, as three.js's `frustumCulled = false` does.
- `setBounds(center, radius)` gives the mesh a bounding sphere of its own, which culling tests instead of the mesh's sphere. The center is relative to the object's origin, and both values are before the object's scale. Use it when a shader moves vertices outside the mesh's sphere: bounds that cover the moved vertices keep culling at work, where `setFrustumCulled(false)` turns it off. A negative radius throws E1108 in development builds.
- `setOccluder(true)` makes the mesh block the view: the objects wholly behind it skip the GPU, on WebGL2 and on WebGPU. The `occluder` option of `createMesh` and `instantiate` sets it at the start. It is false by default, and needs no rebuild. A model that `assets optimize` gave blockers starts with its meshes that have one blocking. On WebGL2, each such mesh draws its blocker in place of its mesh. Mark large, solid meshes of up to 4,096 triangles, such as buildings. Meshes that blend, use an alpha mask or a custom material, or are skinned never block on WebGL2. [Culling](../concepts/culling.md#software-occlusion-culling-on-webgl2) explains both methods.

`setMaterial`, `setMesh`, `setBounds`, `setFrustumCulled`, `setCastShadows` and `setReceiveShadows` rebuild the draw tables, so call them at setup or behind a loading screen. The [performance guide](../guides/performance.md#objects-during-play) lists the cost of each call. [Culling](../concepts/culling.md#bounds-that-you-set) explains how the engine culls with your bounds.

## Animation

An object that a model with animations created has an animator, and `animator()` returns it. The animator plays, fades and layers the model's clips, and calls your handlers for their events. On an object without animation clips, `animator()` throws E1218. Destroying the object stops its clips. The engine cannot load animated models yet. [Animation](animation.md) describes the animator.

## Pointer events

`on(type, handler)` calls `handler` for each pointer event of `type` on the object: `'click'`, `'pointerdown'`, `'pointerup'`, `'pointermove'`, `'pointerenter'` or `'pointerleave'`. `off(type, handler)` removes the handler. An event on a child goes on to its parents, so a handler on a group hears the events of everything under it.

```ts
door.on('click', () => door.rotateY(Math.PI / 2));
```

The engine tests objects where the last frame's update put them, with the camera of the frame that was on screen at each event. Destroying an object removes its handlers. An event type that objects do not have throws [E1205](../errors/E1205.md) in development builds. [Input](input.md#pointer-events-on-objects) describes the events in full.

## Names

The `name` option gives an object a name that error messages show, such as `"Crate" (slot 7)`. `describe()` returns that text. `scene.find(name)` returns the first object created with a name. [Scene](scene.md#finding-objects-by-name) describes it.

## Related pages

- [Scene](scene.md): creating objects, and when changes take effect.
- [Handles and objects](../concepts/handles.md): how an object keeps its data in the engine's memory.
- [Static and dynamic objects](../concepts/static-dynamic.md): the `dynamic` option.
- [Render layers](../concepts/render-layers.md): which cameras draw which objects.
- [Math helpers](math.md): vectors, quaternions and matrices for the setters and getters.
- [Animation](animation.md): the animator of an animated object.
- [Input](input.md#pointer-events-on-objects): pointer events on objects.

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
| `setMesh(mesh: MeshGeometry): void` | Changes the shape from the next frame. The mesh's bounds replace the object's, so call `setBounds` again after this when the object needs bounds of its own. |
| `setCastShadows(cast: boolean): void` | Makes the mesh cast the shadows of a directional light, or stop. The default is false. A change rebuilds the engine's tables of what it draws, as a new material does. |
| `setReceiveShadows(receive: boolean): void` | Makes shadows fall on the mesh, or stop. The default is false. Unlit materials show no shadows. A change rebuilds the engine's tables of what it draws, as a new material does. |
| `setOccluder(occluder: boolean): void` | Makes the mesh block the view, or stop. The default is false, except for the meshes of a model file that the asset tool gave blockers. On WebGL2, while the `softwareOcclusion` quality setting is on, the job workers draw each blocker into a small depth buffer every frame, and the engine skips every object that lies wholly behind the blockers. On WebGPU, while the `gpuOcclusion` setting is on, the GPU draws the depth of the blockers that showed in the last frame and skips every object wholly behind them. Mark large, solid meshes that hide much of the scene, such as buildings and walls, whose mesh has at most 4,096 triangles. On WebGL2, a mesh that the asset tool gave a blocker draws that blocker instead, a few boxes inside the mesh, whatever the mesh's own size. A blocker's mesh must lie inside what the object draws, as the object's own mesh does. Objects that blend, cut holes with an alpha mask or use a custom material never block, whatever this says, nor do skinned ones on WebGL2. A change needs no rebuild of the engine's tables. |
| `setRenderOrder(order: number): void` | Sets the order in which the mesh draws among blended objects, lower first, as three.js's `renderOrder`. Objects of one order draw farthest first. The default is 0. The engine orders opaque and masked objects itself. |
| `setFrustumCulled(culled: boolean): void` | With false, the engine draws the mesh even where its bounds are out of view, as three.js's `frustumCulled = false` does. The default is true. For vertices that a shader moves, larger bounds from `setBounds` cost less. |
| `setBounds(center: Vec3Like, radius: number): void` | Replaces the mesh's bounding sphere, which culling tests, with a sphere of your own: `center` relative to the object's origin, and `radius`, both before the object's scale. Use it when a shader moves vertices outside the mesh's sphere. `setMesh` gives the mesh's sphere back. |

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
| `rotateX(angle: number): void` | Turns the object by `angle` radians about its own X axis. |
| `rotateY(angle: number): void` | Turns the object by `angle` radians about its own Y axis. |
| `rotateZ(angle: number): void` | Turns the object by `angle` radians about its own Z axis. |
| `translate(x: number, y: number, z: number): void` | Moves the object by (x, y, z) along its own axes, as three.js's `translateX`, `translateY` and `translateZ` do together. The object's rotation turns the vector, and its scale leaves it as it is, so `translate(0, 0, -1)` moves a camera 1 m forward. |
| `getPosition(out: Vec3Like): void` | Copies the position relative to the parent into `out`. |
| `getRotation(out: QuatLike): void` | Copies the rotation relative to the parent into `out`, as a quaternion (x, y, z, w). |
| `getWorldPosition(out: Vec3Like): void` | Copies the world position of the frame that last ran into `out`. |
| `getWorldQuaternion(out: QuatLike): void` | Copies the world rotation of the frame that last ran into `out`, as a quaternion (x, y, z, w). It is the rotation part of the world matrix, which `mat4.decompose` splits off. |
| `getWorldMatrix(out: Mat4Like): void` | Copies the world matrix of the frame that last ran into `out`: 16 numbers, column by column, as `mat4` and three.js's `matrixWorld` hold them. Its translation keeps full precision far from the origin when `out` is a plain array or a `Float64Array`. |
| `setParent(parent: Object3D \| null, options?: ParentOptions): void` | Moves the object under another, or to the root with null, from the next frame. By default it keeps its position, rotation and scale relative to the parent, so its place in the world changes with the new parent. With `keepWorld: true` it keeps its place in the world instead. |
| `setVisible(visible: boolean): void` | Hides or shows the object and everything under it. |
| `setLayers(mask: number): void` | Puts the object on the layers of a 32-bit mask: bit n puts it on layer n, so `1 << 2` is layer 2 and `0b101` is layers 0 and 2. A camera draws the object only when their masks share a layer. The object's children keep their own layers. A new mask needs no rebuild. |
| `setDynamic(dynamic: boolean): void` | Makes the object dynamic or static from the next frame. See `NodeOptions.dynamic`. |
| `animator(): Animator` | The object's animator, which plays the clips of the model that created the object. An object without animation clips has none, and the call throws. |
| `destroy(): void` | Removes the object at the next frame. Its children become roots. |
| `on(type: ObjectEventType, handler: ObjectEventHandler): void` | Calls `handler` for each pointer event of `type` on the object: 'click', 'pointerdown', 'pointerup', 'pointermove', 'pointerenter' or 'pointerleave'. An event on a child goes on to its parents, so a handler on a model's group hears clicks on all its parts. The engine casts a ray from the frame that was on screen at each event, against objects where they are now. Handlers run on the sketch's thread at the start of the next frame, before `onUpdate`. |
| `off(type: ObjectEventType, handler: ObjectEventHandler): void` | Removes a handler that `on` added for events of `type`. |

### `ParentOptions`

Interface `ParentOptions`.

Options for `setParent`.

| Member | Description |
| --- | --- |
| `keepWorld?: boolean` | True keeps the object's place, rotation and size in the world, as three.js's `attach` does: the engine gives it the position, rotation and scale that do that under the new parent. The default, false, keeps the values relative to the parent, as three.js's `add` does. |

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
