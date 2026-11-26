---
id: api/reference/feature-draws
title: "Add-on feature draws: API reference"
status: generated
since: "0.3"
summary: "Every export of the Add-on feature draws API, from the engine's doc comments."
---

# Add-on feature draws: API reference

> [Add-on feature draws](../feature-draws.md) explains these exports. The engine's doc comments make this page.

## `FeatureDraw`

Class `FeatureDraw`.

One add-on draw that a feature description declared. It draws its vertices with its own WGSL, in the frame point that the description names. Change its vertices, its uniforms and its place with the calls that this class and its `object` and `material` give, and free it with `destroy`.

| Member | Description |
| --- | --- |
| `readonly name: string` | The feature's name, from the description. |
| `readonly object: Mesh` | The scene object that draws the mesh with the material. |
| `readonly material: Material<ShaderValues<Wgsl>>` | The draw's custom material, whose uniforms the WGSL reads. |
| `updateVertices(name: Parameters<MeshGeometry['updateVertices']>[0], values: Parameters<MeshGeometry['updateVertices']>[1], start = 0, count?: number): void` | Writes new values into one attribute of the draw's vertices, as `mesh.updateVertices` does. The draw's vertex format stays the same, and the defaults update every vertex. |
| `setUniform<Name extends keyof ShaderValues<Wgsl> & string>(name: Name, value: NonNullable<ShaderValues<Wgsl>[Name]>): void` | Changes one uniform of the draw, or one of its material values, by name. |
| `set(values: ShaderValues<Wgsl>): void` | Changes several uniforms and material values at once, as `material.set` does. |
| `setVisible(visible: boolean): void` | Draws the draw, or hides it, from the next frame on. |
| `setRenderOrder(order: number): void` | Sets where the draw sorts among the blended objects of its pass, as `mesh.setRenderOrder` does. It is the description's order inside its band by default, so a lower number draws first. The engine orders opaque and masked draws itself. |
| `destroy(): void` | Frees the draw's object, material and vertices. Later calls on it throw E1101. |

## `FeatureDrawOptions`

Interface `FeatureDrawOptions`, which extends `Omit`.

Options of `scene.addFeatureDraw` besides the feature description. The shader and its uniforms take the options of `materials.shader`, so a draw takes every value and texture that a custom material takes. Where the draw sits, and where it sorts, come from the description.

| Member | Description |
| --- | --- |
| `readonly shader: Wgsl` | The draw's WGSL, compiled by the null3D Vite plugin. |
| `readonly vertices: FeatureDrawVertices` | The vertex data of one shape, which fixes the draw's vertex format. |
| `readonly position?: Vec3` | The position of the draw in the world. The default is (0, 0, 0). |
| `readonly rotation?: Quat` | The rotation of the draw, as a quaternion (x, y, z, w). The default is none. |
| `readonly scale?: Vec3` | The scale of the draw on each axis. The default is (1, 1, 1). |
| `readonly layers?: number` | The layers the draw is on, as a 32-bit mask. The default, 1, is layer 0. |

## `FeatureDrawVertices`

```ts
type FeatureDrawVertices = MeshArrays;
```

The vertex data of one shape that a draw shows: the arrays that `geometry.fromArrays` takes. The arrays fix the draw's vertex format and its bounds.

## `FeatureInstances`

Class `FeatureInstances`.

A draw of many copies: one shape that the engine repeats once for each row of an instance batch. The add-on writes the rows in the batch's arrays, and the engine culls and sorts them like any other batch's rows. Its material and its vertices work as a one-shape draw's do.

| Member | Description |
| --- | --- |
| `readonly name: string` | The feature's name, from the description. |
| `readonly batch: InstanceBatch` | The batch whose rows place the copies, and whose arrays the add-on writes. |
| `readonly material: Material<ShaderValues<Wgsl>>` | The draw's custom material, whose uniforms the WGSL reads. |
| `readonly count: number` | The number of copies that the batch holds. |
| `setCount(count: number): void` | Draws the first `count` rows, and hides the rest, from the next frame on. The rows keep the order that the batch holds them in; the transparent pass sorts the rows that draw. |
| `updateVertices(name: Parameters<MeshGeometry['updateVertices']>[0], values: Parameters<MeshGeometry['updateVertices']>[1], start = 0, count?: number): void` | Writes new values into one attribute of the shape, as `mesh.updateVertices` does. |
| `setUniform<Name extends keyof ShaderValues<Wgsl> & string>(name: Name, value: NonNullable<ShaderValues<Wgsl>[Name]>): void` | Changes one uniform of the draw, or one of its material values, by name. |
| `set(values: ShaderValues<Wgsl>): void` | Changes several uniforms and material values at once, as `material.set` does. |
| `destroy(): void` | Frees the draw's rows, material and shape. Later calls on it throw E1101. |

## `FeatureInstancesOptions`

Interface `FeatureInstancesOptions`, which extends `FeatureDrawOptions`.

Options of `scene.addFeatureInstances`: the options of a draw, and the number of copies that the engine draws of its one shape. Each copy is a row of an instance batch, with its own place, color and values, which the add-on writes in the batch's arrays.

| Member | Description |
| --- | --- |
| `readonly instances: number` | The number of copies of the shape, from 1 up. |
| `readonly rows?: FeatureRowOptions` | The row arrays that the copies bring beside their places. |
| `readonly origin?: Vec3` | The point that every row's position is relative to, as `scene.createInstances` takes it. Use it for a draw far from the world's origin, which keeps its rows precise. |

## `FeatureRowOptions`

Interface `FeatureRowOptions`.

The row arrays of a draw of many copies, as `scene.createInstances` takes them: a color for each row, four values of the add-on's for each row, and whether every row updates in every frame.

| Member | Description |
| --- | --- |
| `readonly colors?: boolean` | Adds a linear RGBA color for each row, which multiplies the material's color and opacity. |
| `readonly values?: boolean` | Adds four numbers of the add-on's for each row, which its WGSL reads as `object.values`. |
| `readonly dynamic?: boolean` | True when every row updates and uploads in every frame. |
