---
id: api/scene
title: Scene
status: planned
since: "0.1"
summary: "Creating objects; find; background, environment, fog, sky; warmUp."
---

<!-- sokko3d:placeholder -->

# Scene

> Planned for sokko3d 0.1. No release has these APIs yet, so coding agents must not use them. The reference below lists what the engine in this repository has so far, and the rest of the page is not written yet.

This page will cover: Creating objects; find; background, environment, fog, sky; warmUp.

## API reference

This reference is generated from the TSDoc comments in `packages/engine/src`. To change it, edit the comments.

### `InstanceBatch`

Class `InstanceBatch`.

Many copies of one mesh and material. Write rows straight into the typed arrays; a dynamic batch updates every row every frame, and a static batch updates the rows you mark dirty.

| Member | Description |
| --- | --- |
| `readonly count: number` | The number of rows: the batch's capacity. |
| `readonly positions: Float32Array` | Positions, 3 floats per row. |
| `readonly rotations: Float32Array` | Rotations as quaternions (x, y, z, w), 4 floats per row. |
| `readonly scales: Float32Array` | Scales, 3 floats per row. |
| `readonly colors: Float32Array \| undefined` | Linear RGBA colors, 4 floats per row, when the batch was created with colors. |
| `setActiveCount(count: number): void` | Draws only the first `count` rows. |
| `markDirty(start = 0, count = this.count - start): void` | Marks rows of a static batch to update and upload. |
| `destroy(): void` | Removes the batch and frees its rows. Its typed arrays are not valid after this. |

### `InstanceOptions`

Interface `InstanceOptions`.

Options for `scene.createInstances`.

| Member | Description |
| --- | --- |
| `material: Material` | The material of every row. |
| `dynamic?: boolean` | Every row updates and uploads every frame; a static batch updates rows marked dirty only. |
| `colors?: boolean` | Adds a color per row (RGBA, linear). |

### `MeshOptions`

Interface `MeshOptions`, which extends `NodeOptions`.

Options for `scene.createMesh`.

| Member | Description |
| --- | --- |
| `mesh: MeshGeometry` | The shape to draw, from `ctx.geometry`. |
| `material: Material` | How the surface looks, from `ctx.materials`. |

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

### `Scene`

Class `Scene`.

The scene: every object, the active camera, the lights and the background.

| Member | Description |
| --- | --- |
| `createGroup(options: NodeOptions = {}): Group` | An empty node, for hierarchy. |
| `createMesh(options: MeshOptions): Mesh` | A drawn object. It is static unless `dynamic: true`. |
| `createInstances(mesh: MeshGeometry, count: number, options: InstanceOptions): InstanceBatch` | Many copies of one mesh and material, with typed arrays of rows. |
| `createPerspectiveCamera(options: CameraOptions = {}): Camera` | A perspective camera; `fov` is vertical, in degrees. Cameras are dynamic by default. |
| `setActiveCamera(camera: Camera): void` | Draws the scene from this camera. |
| `createDirectionalLight(options: DirectionalLightOptions = {}): DirectionalLight` | Light from one direction. This version has one directional light: a newer one replaces the older. |
| `createAmbientLight(options: LightOptions = {}): AmbientLight` | Light on every surface. This version has one ambient light: a newer one replaces the older. |
| `setBackground(color: ColorInput): void` | The color behind every object. |
