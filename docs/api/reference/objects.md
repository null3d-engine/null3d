---
id: api/reference/objects
title: "Objects and transforms: API reference"
status: generated
since: "0.1"
summary: "Every export of the Objects and transforms API, from the engine's doc comments."
---

# Objects and transforms: API reference

> [Objects and transforms](../objects.md) explains these exports. The engine's doc comments make this page.

## `Group`

Class `Group`, which extends `Object3D`.

An empty node, for hierarchy.

## `Mesh`

Class `Mesh`, which extends `Object3D`.

A drawn object: a mesh and a material.

| Member | Description |
| --- | --- |
| `setMorphWeight(target: number \| string, weight: number): void` | Sets how far the mesh moves toward one of its morph targets, from the next frame: 0 keeps the target's shape out, 1 adds all of it, and other numbers scale it. Like setting three.js's `morphTargetInfluences[target]`. `target` is the target's number, from 0, or its name. A clip that animates the weight blends its own value with this one while it plays, as three.js's mixer does, and this one holds when no clip moves it. A WebGL2 device draws a preset's count of each mesh's largest weights (the `morphTargets` quality setting). Throws E1218 for a target that the mesh does not have, and E1203 for a weight that is not a finite number. |
| `getMorphWeight(target: number \| string): number` | The weight of one of the mesh's morph targets, as `setMorphWeight` or the model's file set it, without what a playing clip adds. Throws E1218 for a target that the mesh does not have. |
| `destroy(): void` | Removes the object at the next frame, and frees its morph weights. Its children become roots. |
| `setMaterial(material: Material): void` | Changes the material from the next frame. |
| `setMesh(mesh: MeshGeometry): void` | Changes the shape from the next frame. The mesh's bounds replace the object's, so call `setBounds` again after this when the object needs bounds of its own. |
| `setCastShadows(cast: boolean): void` | Makes the mesh cast the shadows of a directional light, or stop. The default is false. A change rebuilds the engine's tables of what it draws, as a new material does. |
| `setReceiveShadows(receive: boolean): void` | Makes shadows fall on the mesh, or stop. The default is false. Unlit materials show no shadows. A change rebuilds the engine's tables of what it draws, as a new material does. |
| `setOutlined(outlined: boolean): void` | Draws an outline around the mesh, or stops, as adding it to three.js's `OutlinePass.selectedObjects` does. The outline shows while `post.set({ outline })` turns outlines on, and every outlined mesh takes its settings. The default is false. A change rebuilds the engine's tables of what it draws, as a new material does. |
| `setOccluder(occluder: boolean): void` | Makes the mesh block the view, or stop. The default is false, except for the meshes of a model file that the asset tool gave blockers. On WebGL2, while the `softwareOcclusion` quality setting is on, the job workers draw each blocker into a small depth buffer every frame, and the engine skips every object that lies wholly behind the blockers. On WebGPU, while the `gpuOcclusion` setting is on, the GPU draws the depth of the blockers that showed in the last frame and skips every object wholly behind them. Mark large, solid meshes that hide much of the scene, such as buildings and walls, whose mesh has at most 4,096 triangles. On WebGL2, a mesh that the asset tool gave a blocker draws that blocker instead, a few boxes inside the mesh, whatever the mesh's own size. A blocker's mesh must lie inside what the object draws, as the object's own mesh does. Objects that blend, cut holes with an alpha mask or use a custom material never block, whatever this says, nor do skinned ones on WebGL2. A change needs no rebuild of the engine's tables. |
| `setRenderOrder(order: number): void` | Sets the order in which the mesh draws among blended objects, lower first, as three.js's `renderOrder`. Objects of one order draw farthest first. The default is 0. The engine orders opaque and masked objects itself. |
| `setFrustumCulled(culled: boolean): void` | With false, the engine draws the mesh even where its bounds are out of view, as three.js's `frustumCulled = false` does. The default is true. For vertices that a shader moves, larger bounds from `setBounds` cost less. |
| `setBounds(center: Vec3Like, radius: number): void` | Replaces the mesh's bounding sphere, which culling tests, with a sphere of your own: `center` relative to the object's origin, and `radius`, both before the object's scale. Use it when a shader moves vertices outside the mesh's sphere. `setMesh` gives the mesh's sphere back. |

## `Object3D`

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

## `ParentOptions`

Interface `ParentOptions`.

Options for `setParent`.

| Member | Description |
| --- | --- |
| `keepWorld?: boolean` | True keeps the object's place, rotation and size in the world, as three.js's `attach` does: the engine gives it the position, rotation and scale that do that under the new parent. The default, false, keeps the values relative to the parent, as three.js's `add` does. |

## `Quat`

```ts
type Quat = readonly [number, number, number, number];
```

A rotation as a quaternion (x, y, z, w).

## `Vec3`

```ts
type Vec3 = readonly [number, number, number];
```

A vector (x, y, z).
