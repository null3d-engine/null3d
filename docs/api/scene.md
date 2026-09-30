---
id: api/scene
title: Scene
status: experimental
since: "0.1"
summary: "Creating objects; find; background, environment, fog, sky; warmUp."
---

# Scene

> Ships in null3D 0.1. The API is experimental, so it can still change between versions. Fog, sky, environments, texture backgrounds and `scene.warmUp` are not built yet, so coding agents must not use them.

The scene holds everything the engine draws: the objects, the camera that the canvas shows, the lights and the background. A sketch gets it as `scene` in its setup function, and creates everything through it.

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene, geometry, materials }) => {
  scene.setBackground('#101418');
  const camera = scene.createPerspectiveCamera({ fov: 60, position: [0, 4, 10], target: [0, 0, 0] });
  scene.setActiveCamera(camera);
  scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 3 });
  scene.createAmbientLight({ intensity: 0.4 });

  const box = geometry.box();
  const red = materials.standard({ color: '#e8554e' });
  const left = scene.createGroup({ name: 'left', position: [-3, 0, 0] });
  scene.createMesh({ mesh: box, material: red, parent: left });
  scene.createMesh({ mesh: geometry.sphere({ radius: 0.6 }), material: red, parent: left, position: [0, 1.5, 0] });

  // 25 flat tiles: one batch that draws the box 25 times.
  const floor = scene.createInstances(box, 25, { material: materials.standard({ color: '#5bc27a' }) });
  for (let i = 0; i < 25; i++) {
    floor.positions.set([((i % 5) - 2) * 1.2, -1.5, (Math.floor(i / 5) - 2) * 1.2], i * 3);
    floor.scales.set([1, 0.2, 1], i * 3);
  }
  floor.markDirty();
});
```

## What the scene creates

| Call | Creates |
| --- | --- |
| `createGroup(options)` | A `Group`: an empty object that holds other objects |
| `createMesh({ mesh, material, ...options })` | A `Mesh`: an object that draws a mesh with a material |
| `createInstances(mesh, count, { material })` | An `InstanceBatch`: `count` copies of one mesh with one material |
| `createPerspectiveCamera(options)` | A `PerspectiveCamera` that the scene can draw from |
| `createOrthographicCamera(options)` | An `OrthographicCamera`, whose view is a box, that the scene can draw from |
| `createDirectionalLight(options)` | The scene's directional light |
| `createAmbientLight(options)` | The scene's ambient light |

Groups, meshes and cameras take the same object options: `name`, `position`, `rotation`, `scale`, `parent`, `dynamic` and `layers`. [Objects and transforms](objects.md) describes them. `createMesh` also takes `castShadows` and `receiveShadows`, which this version stores but does not draw yet. Meshes come from `geometry` and materials from `materials` in the sketch context. One mesh and one material can serve any number of objects.

## Finding objects by name

`scene.find(name)` returns the first object created with that name that is not destroyed, or `undefined` when no object has it. Names need not be unique. The scene keeps an index of names, so the call costs the same in a scene of any size.

```ts
import type { Mesh } from '@null3d/engine';

// At setup: the sketch created a mesh named 'door' earlier.
const door = scene.find('door') as Mesh | undefined;
door?.setVisible(false);
```

`find` returns the general `Object3D` type. When you know which kind of object has the name, cast the result to its class, such as `Mesh`, to use its own calls. Look objects up at setup and keep them, rather than calling `find` in every frame.

## The camera and the background

The canvas shows the scene from the active camera, which `setActiveCamera` picks. It can be either kind of camera, and [Cameras](cameras.md) covers both lenses. Until you pick a camera, the canvas shows only the background. `setBackground` takes a color, and the default background is black.

## Lights

The scene has one directional light and one ambient light. `createDirectionalLight` and `createAmbientLight` each set that one light, so a second call replaces the first. Without lights, standard materials draw black. [Lights](lights.md) covers both.

## When changes take effect

Creating an object, `destroy`, `setParent`, `setVisible`, `setLayers` and `setDynamic` change the structure of the scene, and so do the mesh calls: `setMaterial`, `setMesh`, `setCastShadows`, `setReceiveShadows`, `setRenderOrder`, `setFrustumCulled` and `setBounds`. The engine queues these changes and applies them after `onUpdate` returns, before it updates transforms and draws. The frame drawn after the call shows the change. Some of them make the engine rebuild its draw tables, as the [performance guide](../guides/performance.md#objects-during-play) lists.

Values that the engine computes, such as the result of `getWorldPosition`, come from the last frame it processed. They show a change from the next `onUpdate` call on.

When the engine cannot apply a change, such as a parent loop (E1104), it skips that change and logs the error to the console. The rest of the queue still applies.

## Instance batches

An instance batch is one object that draws many copies of one mesh with one material. Its rows live in typed arrays that sketch code writes directly, with no call per row. A static batch, the default, uploads the rows you mark with `markDirty`. A batch created with `dynamic: true` uploads every row in every frame. Every row of a batch shares the batch's layers, which the `layers` option and `setLayers(mask)` set, as [Render layers](../concepts/render-layers.md) explains. [Instances and batching](../concepts/instances.md) explains batches in full.

## Limits

- One engine holds up to 16,383 objects at once: groups, meshes and cameras together. One more throws E1102. A destroyed object frees its place when the frame applies the change.
- The rows of an instance batch take none of those places. One engine holds up to 256 batches.
- The queue holds up to 65,536 changes between two frames. One more throws E1102.

## Related pages

- [Objects and transforms](objects.md): the calls that every group, mesh and camera has.
- [Handles and objects](../concepts/handles.md): how objects keep their data in the engine's memory.
- [Static and dynamic objects](../concepts/static-dynamic.md): what the `dynamic` option changes.
- [Materials](materials.md) and [Geometry](geometry.md): what a mesh draws.

## API reference

<!-- null3d:api:start -->

### `InstanceBatch`

Class `InstanceBatch`.

Many copies of one mesh and material. Write rows straight into the typed arrays; a dynamic batch updates every row every frame, and a static batch updates the rows you mark dirty.

| Member | Description |
| --- | --- |
| `readonly count: number` | The number of rows: the batch's capacity. |
| `readonly positions: Float32Array` | Positions, 3 floats per row. |
| `readonly rotations: Float32Array` | Rotations as quaternions (x, y, z, w), 4 floats per row. |
| `readonly scales: Float32Array` | Scales, 3 floats per row. |
| `readonly colors: Float32Array \| undefined` | Linear RGBA colors, 4 floats per row, when the batch was created with colors. This version stores them but does not draw them yet. |
| `setActiveCount(count: number): void` | Draws only the first `count` rows. |
| `setLayers(mask: number): void` | Puts every row on the layers of a 32-bit mask, as `Object3D.setLayers` does for one object. A new mask needs no rebuild. |
| `markDirty(start = 0, count = this.count - start): void` | Marks rows of a static batch to update and upload. |
| `destroy(): void` | Removes the batch and frees its rows. Its typed arrays are not valid after this. |

### `InstanceOptions`

Interface `InstanceOptions`.

Options for `scene.createInstances`.

| Member | Description |
| --- | --- |
| `material: Material` | The material of every row. |
| `dynamic?: boolean` | Every row updates and uploads every frame; a static batch updates rows marked dirty only. |
| `colors?: boolean` | Adds a color per row (RGBA, linear). This version stores the colors but does not draw them yet. |
| `layers?: number` | The layers every row is on, as a 32-bit mask. The default, 1, is layer 0. |

### `MeshOptions`

Interface `MeshOptions`, which extends `NodeOptions`.

Options for `scene.createMesh`.

| Member | Description |
| --- | --- |
| `mesh: MeshGeometry` | The shape to draw, from `ctx.geometry`. |
| `material: Material` | How the surface looks, from `ctx.materials`. |
| `castShadows?: boolean` | True makes the mesh cast shadows, like `setCastShadows(true)`. The default is false. This version stores the setting but draws no shadows yet. |
| `receiveShadows?: boolean` | True makes the mesh receive shadows, like `setReceiveShadows(true)`. The default is false. This version stores the setting but draws no shadows yet. |

### `NodeOptions`

Interface `NodeOptions`.

Options every node takes when it is created.

| Member | Description |
| --- | --- |
| `name?: string` | A name for error messages. |
| `position?: Vec3` | The position relative to the parent. The default is (0, 0, 0). |
| `rotation?: Quat` | The rotation relative to the parent, as a quaternion (x, y, z, w). The default is none. |
| `scale?: Vec3` | The scale on each axis. The default is (1, 1, 1). |
| `parent?: Object3D \| null` | The node to attach this one to. The default, null, makes a root node. |
| `dynamic?: boolean` | True recomputes the node every frame without checks. A static node, the default for all but cameras, updates only when it changes. |
| `layers?: number` | The layers the node is on, as a 32-bit mask: bit n puts it on layer n. A camera draws the objects that share a layer with it. The default, 1, is layer 0. |

### `Scene`

Class `Scene`.

The scene: every object, the active camera, the lights and the background.

| Member | Description |
| --- | --- |
| `find(name: string): Object3D \| undefined` | The first object created with `name` that is not destroyed, or undefined when no object has the name. It looks the name up in an index, so its cost does not grow with the scene. Call it at setup and keep the object it returns. |
| `createGroup(options: NodeOptions = {}): Group` | An empty node, for hierarchy. |
| `createMesh(options: MeshOptions): Mesh` | A drawn object. It is static unless `dynamic: true`. |
| `createInstances(mesh: MeshGeometry, count: number, options: InstanceOptions): InstanceBatch` | Many copies of one mesh and material, with typed arrays of rows. |
| `createPerspectiveCamera(options: PerspectiveCameraOptions = {}): PerspectiveCamera` | A perspective camera; `fov` is vertical, in degrees. Cameras are dynamic by default. |
| `createOrthographicCamera(options: OrthographicCameraOptions = {}): OrthographicCamera` | An orthographic camera, whose view is a box: things keep their size at every distance. Give `height`, and the width follows the canvas, or give `left`, `right`, `top` and `bottom`. Cameras are dynamic by default. |
| `setActiveCamera(camera: Camera): void` | Draws the scene from this camera. |
| `createDirectionalLight(options: DirectionalLightOptions = {}): DirectionalLight` | Light from one direction. This version has one directional light: a newer one replaces the older. |
| `createAmbientLight(options: LightOptions = {}): AmbientLight` | Light on every surface. This version has one ambient light: a newer one replaces the older. |
| `setBackground(color: ColorInput): void` | The color behind every object. |

<!-- null3d:api:end -->
