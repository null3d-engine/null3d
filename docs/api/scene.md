---
id: api/scene
title: Scene
status: experimental
since: "0.1"
summary: "Creating objects; models and copies; find; background, environment, fog, sky; warmUp."
---

# Scene

> Ships in null3D 0.1. The API is experimental, so it can still change between versions. Sky and environments are not built yet, so coding agents must not use them.

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
| `instantiate(prefab, options)` | A `PrefabInstance`: a group that holds a copy of a model that `assets.loadGltf` loaded |
| `createInstances(prefab, count, options)` | An `InstanceBatch` whose rows each draw a whole copy of a model |
| `clone(object)` | A copy of an object and of every object below it |
| `createPerspectiveCamera(options)` | A `PerspectiveCamera` that the scene can draw from |
| `createOrthographicCamera(options)` | An `OrthographicCamera`, whose view is a box, that the scene can draw from |
| `createDirectionalLight(options)` | A `DirectionalLight`: light from one direction, like sunlight |
| `createPointLight(options)` | A `PointLight`: light from a point in every direction, out to its range |
| `createSpotLight(options)` | A `SpotLight`: light from a point in a cone, out to its range |
| `createHemisphereLight(options)` | A `HemisphereLight`: light from the sky above and the ground below |
| `createAmbientLight(options)` | An `AmbientLight`: the same light on every surface |

Groups, meshes, cameras and lights take the same object options: `name`, `position`, `rotation`, `scale`, `parent`, `dynamic` and `layers`. [Objects and transforms](objects.md) describes them. `createMesh` also takes `castShadows` and `receiveShadows`, which [Shadows](../concepts/shadows.md) explains. Meshes come from `geometry` and materials from `materials` in the sketch context. One mesh and one material can serve any number of objects.

## Models and copies

`scene.instantiate(prefab, options)` creates the objects of a model that [`assets.loadGltf`](assets.md#gltf-models) loaded. It returns a `PrefabInstance`: a group that holds the copy of the file's nodes. The `options` place that group as they place any object. Every copy shares the model's meshes, materials and textures, so a second copy costs only its objects. `castShadows` and `receiveShadows` apply to every mesh of the copy. The engine reserves the places of all the copy's objects with one call, and queues their changes as one batch. So no frame shows part of a copy.

```ts
const ship = await assets.loadGltf('/models/ship.glb');
const fleet = [0, 1, 2].map((k) => scene.instantiate(ship, { position: [k * 6, 0, 0], castShadows: true }));
const turret = fleet[0].find('Turret'); // this copy's object of the node named Turret
turret?.rotateY(0.5);
```

`instance.find(name)` gives the copy's object of a node, by the node's name in the file. `scene.find` searches every object. When several copies share a name, it gives the first copy's object.

`scene.clone(object)` copies an object and every object below it, with their meshes, materials, lights, cameras and settings, as three.js's `clone` does. The copy goes under the same parent, so it starts in the same place. It uses the same path as `instantiate`: one call and one batch of changes for the whole tree. Instance batches are not objects, so `clone` leaves them out.

`scene.createInstances(prefab, count, options)` draws many copies of a model with instance batches, one for each mesh of the model. The batches share one set of rows, so each row places a whole copy. Write the returned batch's `positions`, `rotations` and `scales` as for a batch of one mesh. Each mesh keeps its place in the model. The model's lights are left out. A model with no meshes, or with instancing of its own, throws E1417. Give `createInstances` one of its meshes and a material instead, from `prefab.find(name)`.

```ts
const tree = await assets.loadGltf('/models/tree.glb');
const forest = scene.createInstances(tree, 500); // trunk and leaves move together
for (let i = 0; i < 500; i++) forest.positions.set([Math.random() * 100, 0, Math.random() * 100], i * 3);
forest.markDirty();
```

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

The canvas shows the scene from the active camera, which `setActiveCamera` picks. It can be either kind of camera, and [Cameras](cameras.md) covers both lenses. Until you pick a camera, the canvas shows only the background. `setBackground` takes a color. The default background is black, or the page behind a transparent canvas. Exposure and tone mapping change the background as they change the objects: [Color management](../concepts/color-management.md#the-background).

`setBackground` also takes a [texture](textures.md). The texture fills the camera's view behind every object, as a texture in three.js's `scene.background` does. It stretches to the shape of the view. A texture that loads with the default `flipY` stands upright. The engine samples it with the texture's own filter and ignores its alpha. It draws the texture before the objects, without the depth test, so every object draws over it.

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(async ({ scene, assets }) => {
  scene.setBackground('#20242a'); // shows until the picture is on the GPU
  scene.setBackground(await assets.loadTexture('/tex/sky.jpg'));
  return {};
});
```

The color set before a texture shows until the texture's texels are on the GPU, and again if you destroy the texture. A later color takes the place of the texture.

## Fog

`setFog` covers every object in fog, with three.js's formulas. Linear fog is clear up to `near` and hides objects from `far`, with a smooth change between them. Exponential squared fog thickens with the square of the distance, at a rate that `density` sets. Distances run from the camera along its view direction, for both kinds of camera. `setFog(null)` removes the fog.

```ts
scene.setBackground('#b8c4d0');
scene.setFog({ type: 'linear', color: '#b8c4d0', near: 10, far: 70 });
// Or thicker with distance: scene.setFog({ type: 'exp2', color: '#b8c4d0', density: 0.03 });
```

| Option | Fog | Default | What it sets |
| --- | --- | --- | --- |
| `color` | Both | none | The fog's color, in any form that `setBackground` takes |
| `near` | Linear | 1 | The distance where the fog starts |
| `far` | Linear | 1000 | The distance from which the fog hides every object. It must be above `near` |
| `density` | Exponential squared | 0.00025 | How fast the fog thickens: 0 or more |

The fog does not cover the background, so give the background the fog's color to fade far objects into it. A material created with `fog: false` keeps its color at every distance, as [Materials](materials.md#options-fixed-at-creation) says. The engine mixes the fog into each pixel as it shades the pixel, so fog adds almost no work. The fog applies from the next frame. Development builds throw E1108 for a `far` that is not above `near` and for a negative `density`, and E1203 for a value that is not a finite number. The `null3d::fog` module of the [shader library](../shaders/library.md#null3dfog) holds the same formulas for WGSL shaders.

## Lights

Each light is an object, so a scene can hold many, and each call creates another. Without lights, standard materials draw black. [Lights](lights.md) covers each kind, and which of them light surfaces in this version.

## When changes take effect

Creating an object, `destroy`, `setParent`, `setVisible`, `setLayers` and `setDynamic` change the structure of the scene, and so do the mesh calls: `setMaterial`, `setMesh`, `setCastShadows`, `setReceiveShadows`, `setRenderOrder`, `setFrustumCulled` and `setBounds`. The engine queues these changes and applies them after `onUpdate` returns, before it updates transforms and draws. The frame drawn after the call shows the change. Some of them make the engine rebuild its draw tables, as the [performance guide](../guides/performance.md#objects-during-play) lists.

Values that the engine computes, such as the result of `getWorldPosition`, come from the engine's last transform update. In `onUpdate` they come from the previous frame. In `onLateUpdate` they already hold the frame's changes, because the engine updates transforms before it calls `onLateUpdate`. Setters that `onLateUpdate` calls show in the same frame, and structural changes that it makes wait for the next frame ([Sketch API](sketch.md#when-changes-show)).

When the engine cannot apply a change, such as a parent loop (E1104), it skips that change and logs the error to the console. The rest of the queue still applies.

## Warm-up

The GPU draws each kind of object with a pipeline, which takes time to build. The first frame waits until its pipelines are built. After that, an object whose pipeline is still building draws nothing until it is built. A warm-up, `await scene.warmUp()`, resolves once every pipeline that the scene needs is built, hidden objects included. So create a later loading stage hidden, warm up, then show it. [Loading screens and warm-up](../guides/loading-screens.md) shows the pattern.

## Instance batches

An instance batch is one object that draws many copies of one mesh with one material. Its rows live in typed arrays that sketch code writes directly, with no call per row. A static batch, the default, uploads the rows you mark with `markDirty`. A batch created with `dynamic: true` uploads every row in every frame. Every row of a batch shares the batch's layers, which the `layers` option and `setLayers(mask)` set, as [Render layers](../concepts/render-layers.md) explains. [Instances and batching](../concepts/instances.md) explains batches in full.

## Limits

- One engine holds up to 16,383 objects at once: groups, meshes, cameras and lights together. One more throws E1102. A destroyed object frees its place when the frame applies the change.
- The rows of an instance batch take none of those places. One engine holds up to 256 batches, and `createInstances(prefab, ...)` takes one for each mesh of the model.
- The queue holds up to 65,536 changes between two frames. One more throws E1102.

## Related pages

- [Objects and transforms](objects.md): the calls that every object has.
- [Handles and objects](../concepts/handles.md): how objects keep their data in the engine's memory.
- [Static and dynamic objects](../concepts/static-dynamic.md): what the `dynamic` option changes.
- [Materials](materials.md) and [Geometry](geometry.md): what a mesh draws.
- [Loading screens and warm-up](../guides/loading-screens.md): waiting for the scene's pipelines.
- [Assets and prefabs](../concepts/assets.md): models from glTF files, and what a prefab shares.

## API reference

<!-- null3d:api:start -->

### `Exp2FogOptions`

Interface `Exp2FogOptions`.

Exponential squared fog, as three.js's `FogExp2`: an object at distance d takes the fog color by a factor of 1 - exp(-(density × d)²). Distances run from the camera along its view direction.

| Member | Description |
| --- | --- |
| `type: 'exp2'` | Exponential squared fog. |
| `color: ColorInput` | The fog's color. |
| `density?: number` | How fast the fog thickens with distance: 0 or more. The default is 0.00025. |

### `FogOptions`

```ts
type FogOptions = LinearFogOptions | Exp2FogOptions;
```

Options of `scene.setFog`: linear fog or exponential squared fog.

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
| `destroy(): void` | Removes the batch and frees its rows. Its typed arrays are not valid after this: another batch can take their memory. |

### `InstanceOptions`

Interface `InstanceOptions`.

Options for `scene.createInstances`.

| Member | Description |
| --- | --- |
| `material: Material` | The material of every row. |
| `dynamic?: boolean` | Every row updates and uploads every frame; a static batch updates rows marked dirty only. |
| `colors?: boolean` | Adds a color per row (RGBA, linear). This version stores the colors but does not draw them yet. |
| `layers?: number` | The layers every row is on, as a 32-bit mask. The default, 1, is layer 0. |

### `InstantiateOptions`

Interface `InstantiateOptions`, which extends `NodeOptions`.

Options for `scene.instantiate`: where the copy's group goes, and settings for all its meshes.

| Member | Description |
| --- | --- |
| `castShadows?: boolean` | True makes every mesh of the copy cast the shadows of a directional light. The default is false. |
| `receiveShadows?: boolean` | True makes shadows fall on every mesh of the copy. The default is false. |
| `occluder?: boolean` | True makes every mesh of the copy block the view for software occlusion culling on WebGL2, like `setOccluder(true)`. The default is false. |

### `LinearFogOptions`

Interface `LinearFogOptions`.

Linear fog, as three.js's `Fog`: none up to `near`, full from `far`, and a smooth step between them. Distances run from the camera along its view direction.

| Member | Description |
| --- | --- |
| `type: 'linear'` | Linear fog. |
| `color: ColorInput` | The fog's color. |
| `near?: number` | The distance where the fog starts. The default is 1. |
| `far?: number` | The distance from which the fog hides every object. It must be above `near`. The default is 1000. |

### `MeshOptions`

Interface `MeshOptions`, which extends `NodeOptions`.

Options for `scene.createMesh`.

| Member | Description |
| --- | --- |
| `mesh: MeshGeometry` | The shape to draw, from `ctx.geometry`. |
| `material: Material` | How the surface looks, from `ctx.materials`. |
| `castShadows?: boolean` | True makes the mesh cast the shadows of a directional light, like `setCastShadows(true)`. The default is false. |
| `receiveShadows?: boolean` | True makes shadows fall on the mesh, like `setReceiveShadows(true)`. The default is false. Unlit materials show no shadows. |
| `occluder?: boolean` | True makes the mesh block the view for software occlusion culling on WebGL2, like `setOccluder(true)`. The default is false. |

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

### `PrefabInstance`

Class `PrefabInstance`, which extends `Group`.

The group that holds a copy of a model, which `scene.instantiate` returns. Its children are the copies of the file's root nodes.

| Member | Description |
| --- | --- |
| `batches: readonly InstanceBatch[]` | The instance batches of the nodes with instancing of their own, as the file gives them. Their rows are placed in the world when the copy is created, and they do not move with the group. |
| `find(name: string): Object3D \| undefined` | The copy's first object with `name`, in the file's order, which is not destroyed, or undefined. It searches the copy's objects, so call it at setup. |

### `Scene`

Class `Scene`.

The scene: every object, the active camera, the lights and the background.

| Member | Description |
| --- | --- |
| `find(name: string): Object3D \| undefined` | The first object created with `name` that is not destroyed, or undefined when no object has the name. It looks the name up in an index, so its cost does not grow with the scene. Call it at setup and keep the object it returns. |
| `createGroup(options: NodeOptions = {}): Group` | An empty node, for hierarchy. |
| `createMesh(options: MeshOptions): Mesh` | A drawn object. It is static unless `dynamic: true`. |
| `instantiate(prefab: Prefab, options: InstantiateOptions = {}): PrefabInstance` | Creates the objects of a model that `assets.loadGltf` loaded, under one new group that `options` places, and returns that group. All the objects are created with one batch of commands, and every copy shares the model's meshes, materials and textures. The group's `find` gives the copy's object of a node, by the node's name. Throws E1102 when the scene has no room for the objects, before it creates any. |
| `clone<T extends Object3D>(object: T): T` | Copies an object and every object below it, as three.js's `clone` does, with their meshes, materials, lights, cameras and settings, and returns the copy of the object. The copy has the same parent, so it starts in the same place. The copies are created with one batch of commands. Instance batches are not objects, so they are not copied. Throws E1102 when the scene has no room for the copies, before it creates any. |
| `createInstances(mesh: MeshGeometry, count: number, options: InstanceOptions): InstanceBatch` | Many copies of one mesh and material, with typed arrays of rows. Or many copies of a model that `assets.loadGltf` loaded, without a material: one batch for each mesh of the model, which share one set of rows, so one row places a whole copy. The model's lights are left out. Throws E1417 for a model with no meshes, or with instancing of its own. |
| `createInstances(prefab: Prefab, count: number, options?: Omit<InstanceOptions, 'material'>): InstanceBatch` | Many copies of one mesh and material, with typed arrays of rows. Or many copies of a model that `assets.loadGltf` loaded, without a material: one batch for each mesh of the model, which share one set of rows, so one row places a whole copy. The model's lights are left out. Throws E1417 for a model with no meshes, or with instancing of its own. |
| `createPerspectiveCamera(options: PerspectiveCameraOptions = {}): PerspectiveCamera` | A perspective camera; `fov` is vertical, in degrees. Cameras are dynamic by default. |
| `createOrthographicCamera(options: OrthographicCameraOptions = {}): OrthographicCamera` | An orthographic camera, whose view is a box: things keep their size at every distance. Give `height`, and the width follows the canvas, or give `left`, `right`, `top` and `bottom`. Cameras are dynamic by default. |
| `setActiveCamera(camera: Camera): void` | Draws the scene from this camera. |
| `createDirectionalLight(options: DirectionalLightOptions = {}): DirectionalLight` | Light from one direction, like sunlight: `direction` is the way it travels. |
| `createPointLight(options: PointLightOptions): PointLight` | Light from a point in every direction, out to `range` meters, which it needs. |
| `createSpotLight(options: SpotLightOptions): SpotLight` | Light from a point in a cone, out to `range` meters, which it needs. |
| `createHemisphereLight(options: HemisphereLightOptions = {}): HemisphereLight` | Light from the sky above and the ground below. |
| `createAmbientLight(options: LightOptions = {}): AmbientLight` | Light on every surface, from no direction. |
| `setBackground(background: ColorInput \| Texture): void` | What the camera shows behind every object: a color, or a texture. A texture fills the view and stretches to its shape, as a texture in three.js's `scene.background` does. The color set before it shows until the texture's texels are on the GPU, and again if the texture is destroyed. A color takes the place of a texture. Exposure and tone mapping change the background with the rest of the scene. Without a background, the canvas shows black, or the page behind it on a transparent canvas. |
| `setFog(fog: FogOptions \| null): void` | Fog over every object, with three.js's formulas: linear fog as its `Fog`, or exponential squared fog as its `FogExp2`. Null removes the fog. The background takes no fog, and a material created with `fog: false` keeps its color. Converting the color allocates. |
| `raycast(origin: Vec3Like, direction: Vec3Like, options: RaycastOptions \| undefined, hit: RaycastHit): boolean` | Casts a ray from `origin` along `direction`, and writes its closest hit into `hit`. Returns true on a hit. On a miss it sets `hit.object` to null and leaves the other fields as they were. The direction needs no unit length. The ray tests the triangles of objects and instance rows on the layers of `options.layers`, as their materials draw them: front faces, or both faces for a double-sided material. Queries see the scene as the last frame's update left it, so a move, a new object or a destroy in this frame counts from the next frame, or from `onLateUpdate`. Create `hit` and `options` once and pass them each time. |
| `raycastAny(origin: Vec3Like, direction: Vec3Like, options?: RaycastOptions): boolean` | True when a ray from `origin` along `direction` hits anything on the layers of `options.layers`. It stops at the first hit it finds, so it is faster than `raycast`: use it for line-of-sight checks. |
| `raycastAll(origin: Vec3Like, direction: Vec3Like, options: RaycastOptions \| undefined, hits: RaycastHit[]): number` | Casts a ray as `raycast` does, writes every hit into `hits` nearest first, one hit for each triangle that the ray crosses, and returns how many. It fills the first entries of `hits`, adds hit objects when the array is too short, and leaves the entries after the hits as they were. |
| `raycastBatch(rays: ArrayLike<number>, options: RaycastOptions \| undefined, out: RaycastBatchHits): number` | Casts many rays at once on the job workers, and writes each one's closest hit into `out`. `rays` holds six numbers per ray: its origin, then its direction. Returns how many rays hit something. A miss writes -1 as its distance. |
| `overlapSphere(center: Vec3Like, radius: number, options: QueryOptions \| undefined, out: OverlapHit[]): number` | Finds the objects and instance rows on the layers of `options.layers` that have a triangle within `radius` meters of `center`, writes them into `out`, and returns how many. It fills `out` as `raycastAll` fills its hits, in no set order. |
| `overlapBox(min: Vec3Like, max: Vec3Like, options: QueryOptions \| undefined, out: OverlapHit[]): number` | Finds the objects and instance rows on the layers of `options.layers` that have a triangle inside the box from `min` to `max` or crossing it, as `overlapSphere` does. The box's sides lie along the world's axes. |
| `warmUp(): Promise<void>` | Builds every GPU pipeline that the scene needs as it stands, and resolves once they are all built. Hidden objects count too. After the first frame, an object whose pipeline is still building draws nothing, so create a loading stage's objects hidden, warm up, then show them. The first frame waits for its pipelines anyway. In the setup, a warm-up draws that frame once they are built, before the setup goes on. |

<!-- null3d:api:end -->
