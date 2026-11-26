---
id: api/objects
title: Objects and transforms
summary: "Setters and getters; parents; flags; destroy; pointer events."
---

# Objects and transforms

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
- `setRotation(x, y, z, w)` sets the rotation as a quaternion. `setRotationEuler(x, y, z, order)` sets it from Euler angles. The order names the axes in turn: the default, `'XYZ'`, turns the object about its own X axis, then its Y axis, then its Z axis. The other orders are `'YXZ'`, `'ZXY'`, `'ZYX'`, `'YZX'` and `'XZY'`.
- `setPose(position, rotation)` sets the position and, when you give it, the rotation, from two arrays that hold them: `[x, y, z]` and the quaternion `[x, y, z, w]`. Give it the arrays that a pose lives in, and no number crosses the call. The controls write a camera's pose this way in every frame.
- `rotateX(angle)`, `rotateY(angle)` and `rotateZ(angle)` turn the object by an angle about its own X, Y or Z axis.
- `translate(x, y, z)` moves the object along its own axes. The object's rotation turns the vector, but its scale does not stretch it. So `camera.translate(0, 0, -1)` moves a camera 1 m forward.
- `lookAt(x, y, z)` turns a mesh or a group so that its +Z axis points at a point. A camera or a light turns its -Z axis there instead. The call assumes that the object's parents are not rotated.

<details>
<summary>Technical details: why setPose takes arrays</summary>

The calls above pass each number on its own. A number passed to a call that the browser does not inline becomes an object of its own.

</details>

Setters write straight into the engine's memory and mark the object as changed. They send no message and allocate nothing, so `onUpdate` can call them for many objects in every frame. In development builds, a setter that gets `NaN` or an infinite number throws E1203.

Positions are 32-bit floats by default, which move in steps of 6 cm at 1,000 km from the origin. An engine started with `largeWorld: true` keeps each position that you set exact at any distance. [Large worlds and precision](../concepts/large-worlds.md) explains both.

## Reading transforms

Getters copy into an array you pass, so they allocate nothing. Make the array once, for example with `vec3.create()`, and reuse it.

- `getPosition(out)` copies the position that you set, relative to the parent. In large-world mode it keeps its full precision, so pass a plain array or a `Float64Array`. `getRotation(out)` copies the rotation, as a quaternion (x, y, z, w).
- `getWorldPosition(out)` copies the position in the world, and `getWorldQuaternion(out)` the rotation in the world.
- `getWorldMatrix(out)` copies the world matrix: 16 numbers, column by column, as the [math helpers](math.md) hold them.

The world getters read the engine's last transform update. A change that you make in `onUpdate` shows in them in the same frame's `onLateUpdate`, and from the next `onUpdate` call on. Their positions are 64-bit numbers, which keep their precision far from the origin. Pass a plain array or a `Float64Array`, because a `Float32Array` rounds them to 32 bits.

## Parents

An object gets a parent from the `parent` option, or later from `setParent(parent)`. `setParent(null)` makes it a root object. `getParent()` returns the parent, or null for a root object.

By default the object keeps its position, rotation and scale relative to the parent. Its place in the world then changes with the new parent. `setParent(parent, { keepWorld: true })` keeps its place, rotation and size in the world instead. The engine gives the object the position, rotation and scale that do that under the new parent.

```ts
// Pick up a crate: it stays where it is, then moves with the hand.
crate.setParent(hand, { keepWorld: true });
```

In the [objects and parents demo](https://github.com/null3d-engine/null3d/tree/main/examples/objects), crates step on and off a turntable this way.

The engine works out those values when it applies the change, after `onUpdate` returns. It uses the transforms that the object and both parents have at that moment. So set the object's own transform before `setParent` in the same frame. A setter called after it writes a value relative to the old parent.

Two kinds of parent change the result:

- A parent that is turned and scaled by different amounts on its axes shears its children. No position, rotation and scale can express a shear. The object keeps its place, but its rotation and scale come out close to the old ones.
- A parent scaled to 0 on an axis flattens its children, and no transform can undo that. The object then keeps its values relative to the parent.

Children move with their parent. A static child of a dynamic parent follows it too, because the engine recomputes the child whenever the parent moves.

A parent loop puts an object under itself, or under an object below it, so it cannot work. In development builds, `setParent` throws E1104 when an object is given itself as its parent. The engine skips any other loop when it applies it, and logs E1104 to the console.

## Visibility, kind and removal

- `setVisible(false)` hides the object and everything under it. `setVisible(true)` shows it again. Objects under a hidden object cost almost nothing per frame, dynamic ones too: the engine stops recomputing them two frames after they hide. They take their place again in the frame that shows them. Their world getters still give their place, from their local transforms. A camera under a hidden object keeps moving with it.
- `setDynamic(true)` makes the engine recompute the object in every frame, and `setDynamic(false)` makes it static again. [Static and dynamic objects](../concepts/static-dynamic.md) explains when each kind costs less.
- `destroy()` removes the object. Its children become root objects and keep their own transforms.

These calls change the structure of the scene, so they take effect when the engine processes the frame, after `onUpdate` returns. [Scene](scene.md#when-changes-take-effect) gives the details.

In development builds, every call on a destroyed object throws [E1101](../errors/E1101.md), except `describe` and `off`. A model's copy also allows `find` and `setOutlined`, which skip its destroyed parts. A call that gets a destroyed object as an argument, such as `setParent`, also throws E1101. Once the frame has removed the object, its world getters throw E1101 in every build. In a release build, the other calls on a destroyed object change nothing, and never reach the object that takes its slot ([Handles](../concepts/handles.md#stale-handles)).

## Layers

`setLayers(mask)` puts the object on the layers of a 32-bit mask: bit n puts it on layer n. A camera draws the object only when their masks share a bit. New objects are on layer 0, which every new camera draws. The `layers` option sets the mask when you create the object. `getLayers()` returns the mask that the object has now, which a sketch reads before it adds a layer of its own.

The mask belongs to the object alone, so its children keep their own. Like `setVisible`, `setLayers` takes effect when the engine processes the frame, and it rebuilds nothing. In development builds, a mask that is not a whole number of 32 bits throws E1207. [Render layers](../concepts/render-layers.md) explains masks in full.

## Mesh calls

A mesh has these calls besides the ones above. Like the structural calls, they take effect in the next frame.

These calls rebuild the draw tables, so call them at setup or behind a loading screen:

- `setMaterial(material)` changes the material, and `setMesh(mesh)` changes the shape. The new mesh's bounding sphere replaces any bounds that `setBounds` gave.
- `setCastShadows(true)` and `setReceiveShadows(true)` make the mesh cast and receive the shadows of every light that casts them. The `castShadows` and `receiveShadows` options of `createMesh` set them at the start. Both are false by default. Unlit materials show no shadows. [Shadows](../concepts/shadows.md) explains them.
- `setOutlined(true)` draws an outline around the mesh while `post.set({ outline })` turns outlines on. It is false by default. A model's copy from `scene.instantiate` has `setOutlined` too, which outlines each of its meshes. [Outlines](post.md#outlines) gives the outline's settings.
- `setFrustumCulled(false)` makes the engine draw the mesh even when its bounds are out of view.
- `setBounds(center, radius)` gives the object a bounding sphere of its own, which culling tests instead of the mesh's sphere. Use it when a shader moves vertices outside the mesh's sphere. [Culling](../concepts/culling.md#bounds-that-you-set) explains how the engine culls with your bounds.
- `setLevelBias(bias)` raises or lowers the threshold that picks this object's levels of detail, as the inverse of Godot's `lod_bias`: a Godot bias of 2 is about a null3D bias of 0.5. A bias above 1 draws coarser levels, and one below 1 keeps the object's detail. The same factor moves the distance at which the object hides. The bias is 1 by default, and does nothing without a mesh that has levels. [Levels of detail](../concepts/lod.md#the-bias-of-one-object) shows it.
- `setDrawRange(start, end)` draws the mesh only between those distances from the camera to its nearest point, fading at each edge. [Distance bands](../concepts/lod.md#distance-bands) shows it. The [impostors demo](https://github.com/null3d-engine/null3d/tree/main/examples/impostors) calls it on the merged mesh of each grid cell.

These calls cost nothing during play:

- `shaderId` is the number that a custom material reads as `object.id` for the mesh. Pass it to a uniform to pick out the mesh in a shader, as [Built-in shader inputs](../shaders/builtins.md#object) shows.
- `setRenderOrder(order)` sets the order in which blended objects draw, lower first. Objects of one order draw farthest first. The engine orders opaque and masked objects itself, for speed, as the depth test decides what shows. [Materials and pipelines](../concepts/materials.md#the-transparent-pass) explains the sort.
- `setMorphWeight(nameOrIndex, weight)` and `getMorphWeight(nameOrIndex)` set and read a morph target's weight: [Morph targets](animation.md#morph-targets).
- `setOccluder(true)` makes the mesh block the view on WebGL2 while software occlusion culling runs, which every preset leaves off. On WebGPU, GPU occlusion culling needs no mark where it runs: every opaque mesh may hide what lies behind it. There, `setOccluder(false)` keeps a mesh out, and `setOccluder(true)` lets it back in. The `occluder` option of `createMesh` and `instantiate` sets it at the start, and a change needs no rebuild. [Culling](../concepts/culling.md#gpu-occlusion-culling-on-webgpu) explains both methods.

A click that outlines the picked object rebuilds them once, which is fine. The [performance guide](../guides/performance.md#objects-during-play) lists the cost of each call.

<details>
<summary>Technical details: occluders and bounds</summary>

On WebGL2, software occlusion culling is off in every preset. Mark large, solid meshes of up to 4,096 triangles, such as buildings. A model that `assets optimize` gave blockers starts with those meshes blocking, and each draws its blocker in place of its mesh. Meshes that blend, use an alpha mask or a custom material, or are skinned never block on WebGL2.

The center that `setBounds` takes is relative to the object's origin, and both values are before the object's scale. A group has no sphere of its own, so it needs one wherever a sphere is read, such as a directional light's hero shadow.

</details>

The radius that `setBounds` takes must be 0 or more. A negative radius throws [E1108](../errors/E1108.md) in development builds.

## Animation

An object that a model with animations created has an animator, and `animator()` returns it. The animator plays, fades and layers the model's clips, and calls your handlers for their events. On an object without animation clips, `animator()` throws E1218. Destroying the object stops its clips. [Animation](animation.md) describes the animator.

## Pointer events

`on(type, handler)` calls `handler` for each pointer event of `type` on the object: `'click'`, `'pointerdown'`, `'pointerup'`, `'pointermove'`, `'pointerenter'` or `'pointerleave'`. `off(type, handler)` removes the handler. An event on a child goes on to its parents, so a handler on a group hears the events of everything under it. The `'pointerenter'` handler of the [picking demo](https://github.com/null3d-engine/null3d/tree/main/examples/picking) lights the piece under the pointer.

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
- [Camera layer masks](https://github.com/null3d-engine/null3d/tree/main/examples/layers): a camera that changes its layers every 2 seconds.
- [The hero fir and the B key](https://github.com/null3d-engine/null3d/tree/main/examples/forest): the nearest tree keeps a level-of-detail bias of its own, for comparison.

## API reference

[The API reference](reference/objects.md) lists every export of this page with its type and description. The engine's doc comments make it.
