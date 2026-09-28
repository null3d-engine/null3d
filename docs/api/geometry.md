---
id: api/geometry
title: Geometry
status: planned
since: "0.1"
summary: "Generators with three.js parameters; fromArrays; updateVertices."
---

<!-- sokko3d:placeholder -->

# Geometry

> Planned for sokko3d 0.1. No release has these APIs yet, so coding agents must not use them. The reference below lists what the engine in this repository has so far, and the rest of the page is not written yet.

This page will cover: Generators with three.js parameters; fromArrays; updateVertices.

## API reference

This reference is generated from the TSDoc comments in `packages/engine/src`. To change it, edit the comments.

### `BoxOptions`

Interface `BoxOptions`.

Options for `geometry.box`. The box is centered on its origin.

| Member | Description |
| --- | --- |
| `width?: number` | The size along the X axis. The default is 1. |
| `height?: number` | The size along the Y axis. The default is 1. |
| `depth?: number` | The size along the Z axis. The default is 1. |
| `widthSegments?: number` | How many faces divide each side along the width. The default is 1. |
| `heightSegments?: number` | How many faces divide each side along the height. The default is 1. |
| `depthSegments?: number` | How many faces divide each side along the depth. The default is 1. |

### `Geometry`

Class `Geometry`.

Mesh generators with the parameters and defaults of three.js's geometry classes.

| Member | Description |
| --- | --- |
| `box(options: BoxOptions = {}): MeshGeometry` | A box, like three.js's `BoxGeometry`. |
| `sphere(options: SphereOptions = {}): MeshGeometry` | A sphere, like three.js's `SphereGeometry`. |

### `MeshGeometry`

Class `MeshGeometry`.

A mesh the engine can draw: its id in the engine core, and its bounding radius.

| Member | Description |
| --- | --- |
| `readonly radius: number` | The distance from the mesh's origin to its farthest vertex. |

### `SphereOptions`

Interface `SphereOptions`.

Options for `geometry.sphere`. The sphere is centered on its origin.

| Member | Description |
| --- | --- |
| `radius?: number` | The radius. The default is 1. |
| `widthSegments?: number` | How many faces go around the equator. The default is 32. |
| `heightSegments?: number` | How many faces go from pole to pole. The default is 16. |
