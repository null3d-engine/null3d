---
id: api/reference/feature-instances
title: "Add-on instance draws: API reference"
status: generated
since: "0.3"
summary: "Every export of the Add-on instance draws API, from the engine's doc comments."
---

# Add-on instance draws: API reference

> [Add-on instance draws](../feature-instances.md) explains these exports. The engine's doc comments make this page.

## `ComputeInstances`

Class `ComputeInstances`.

One add-on draw whose live count the GPU writes. Draw its instances from the add-on's own buffer with `setInstances`, or from a compute pass that writes the count word, and free it with `destroy`. The description's `ready` callback decides each frame whether the draw draws. While it answers false the engine records nothing for the draw: no draw, no count copy and no conversion.

| Member | Description |
| --- | --- |
| `readonly object: Mesh \| InstanceBatch` | The scene object that places the draw, or the instance batch on the CPU path. |
| `readonly material: Material<ShaderValues<Wgsl>>` | The draw's custom material, whose WGSL reads its instances. |
| `readonly counts: FeatureInstanceBuffer` | The count word that a compute pass writes for the draw, which the engine reads each frame. |
| `readonly instances: FeatureInstanceBuffer` | The per-instance buffer that a compute pass fills and the draw reads. |
| `readonly count: number` | The count that the GPU or the CPU set. |
| `readonly materialIndex: number` | The index of the draw's material in the engine's table. A compute pass that fills the rows writes it in each row's first id word, the material that the vertex shader reads. |
| `setCount(count: number): this` | Sets the count that a page without compute draws, which the count word starts each frame from. On WebGL2 it is the count that the draw renders. It is a whole number from 0 to the capacity. |
| `setInstances(values: Float32Array, count: number): this` | Writes `count` instances from `values`, laid out as the engine's instance rows: three world-matrix rows, then the ids, sixteen floats for each. WebGPU uploads them into the add-on's buffer; WebGL2 places each row in the instance batch. It also sets the count. |
| `setVisible(visible: boolean): void` | Draws the draw, or hides it, from the next frame on. |
| `destroy(): void` | Frees the draw's object, material and vertices. Later calls on it throw E1101. |

## `ComputeInstancesOptions`

Interface `ComputeInstancesOptions`, which extends `Omit`.

Options of `scene.addComputeInstances` besides the feature description. The shader and its uniforms take the options of `materials.shader`, so a draw takes every value and texture that a custom material takes.

| Member | Description |
| --- | --- |
| `readonly shader: Wgsl` | The draw's WGSL, compiled by the null3D Vite plugin. |
| `readonly vertices: ComputeInstanceVertices` | The vertex data of one shape, which every live instance draws. |
| `readonly capacity: number` | The most instances that the draw may hold, which sizes its buffers. |
| `readonly count?: number` | The count at the first frame. The default is 0. |
| `readonly layers?: number` | The layers the draw is on, as a 32-bit mask. The default, 1, is layer 0. |

## `ComputeInstanceVertices`

```ts
type ComputeInstanceVertices = MeshArrays;
```

The vertex data of one shape that an instance draw shows: the arrays that `geometry.fromArrays` takes. One shape draws once for each live instance.

## `FeatureInstanceBuffer`

Interface `FeatureInstanceBuffer`.

A handle for a buffer that the engine made for an instance draw, which a compute pass binds. `buffer` names the buffer in the frame's draw list.

| Member | Description |
| --- | --- |
| `readonly buffer: number` | The engine's name for the buffer, which a compute pass binds. |
| `readonly bytes: number` | The buffer's size in bytes, which a compute pass binds. |
