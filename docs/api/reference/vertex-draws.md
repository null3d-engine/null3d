---
id: api/reference/vertex-draws
title: "Draws from a vertex count: API reference"
status: generated
since: "0.2"
summary: "Every export of the Draws from a vertex count API, from the engine's doc comments."
---

# Draws from a vertex count: API reference

> [Draws from a vertex count](../vertex-draws.md) explains these exports. The engine's doc comments make this page.

## `VertexDraw`

Class `VertexDraw`.

A draw that has a material and a vertex count but no mesh data. Its shader makes every vertex of every copy from the indices, so the draw uploads nothing per frame. Change its counts, its sphere and its material's uniforms with the calls here, and free it with `destroy`.

| Member | Description |
| --- | --- |
| `readonly object: Mesh` | The scene object that gives the draw its place, its layers and its culling sphere. |
| `readonly material: Material<ShaderValues<Wgsl>>` | The draw's custom material, whose uniforms the WGSL reads. |
| `readonly vertices: number` | The vertices of one shape. |
| `readonly instances: number` | The copies of the shape. |
| `setCounts(vertices: number, instances: number): this` | Sets the vertices of one shape and the copies of the shape, from the next frame on. Each is a whole number from 1 to the most that the draw holds. |
| `setBounds(center: Vec3Like, radius: number): this` | Sets the sphere that culls the draw, as `object.setBounds` does. The sphere holds every shape that the shader makes. |
| `destroy(): void` | Frees the draw and its object. A second call does nothing. |

## `VertexDrawBounds`

Interface `VertexDrawBounds`.

The sphere that culls a draw. The engine draws the whole draw or none of it, so the sphere holds every shape that the shader makes. A shape that moves outside it stops drawing.

| Member | Description |
| --- | --- |
| `readonly center?: Vec3` | The middle of the sphere in the object's space. The default is (0, 0, 0). |
| `readonly radius: number` | The reach of the sphere from its center, in world units. |

## `VertexDrawOptions`

Interface `VertexDrawOptions`, which extends `Omit`.

Options of `scene.createVertexDraw`: the shader, its two counts, its bounds, and every option of `materials.shader`, such as the uniforms, the blending and `doubleSided`. A draw blends, so its material draws in the transparent pass, where its sphere culls it and one shape covers the ones behind it.

| Member | Description |
| --- | --- |
| `readonly shader: Wgsl` | The draw's WGSL, compiled by the null3D Vite plugin: one `@vertex` entry point that takes the vertex and instance indices and no mesh attribute, and one `@fragment` entry point. |
| `readonly vertices: number` | The vertices of one shape, such as 2 for a line or 6 for a card. |
| `readonly instances: number` | The copies of the shape in the draw, such as one for each streak. |
| `readonly bounds: VertexDrawBounds` | The sphere that culls the draw. |
| `readonly position?: Vec3` | The position of the draw in the world. The default is (0, 0, 0). |
| `readonly rotation?: Quat` | The rotation of the draw, as a quaternion (x, y, z, w). The default is none. |
| `readonly scale?: Vec3` | The scale of the draw on each axis. The default is (1, 1, 1). |
| `readonly layers?: number` | The layers the draw is on, as a 32-bit mask. The default, 1, is layer 0. |
