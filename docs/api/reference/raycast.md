---
id: api/reference/raycast
title: "Raycasting and spatial queries: API reference"
status: generated
since: "0.2"
summary: "Every export of the Raycasting and spatial queries API, from the engine's doc comments."
---

# Raycasting and spatial queries: API reference

> [Raycasting and spatial queries](../raycast.md) explains these exports. The engine's doc comments make this page.

## `OverlapHit`

Interface `OverlapHit`.

An object that a query found: a scene object, or a row of an instance batch.

| Member | Description |
| --- | --- |
| `object: QueryTarget \| null` | The object or the batch of a row, or null after a raycast that hit nothing. |
| `instance: number` | The row of a batch: an instance row, a sprite, a point or a line's segment. -1 for an object. |

## `QueryOptions`

Interface `QueryOptions`.

The options of every query.

| Member | Description |
| --- | --- |
| `layers?: number` | The layers to test, as a 32-bit mask like `Object3D.setLayers` takes. A query tests an object when their masks share a layer. The default is layer 0 alone, as for a camera and for three.js's `Raycaster`. |

## `QueryTarget`

```ts
type QueryTarget = Object3D | InstanceBatch | SpriteBatch | PointBatch | LineBatch;
```

What a query can find: an object, or the batch of a row. That batch is an instance, sprite, point or line batch.

## `RaycastBatchHits`

Interface `RaycastBatchHits`.

The arrays that `scene.raycastBatch` fills: one entry per ray, or three numbers per ray for points and normals. Only `distances` is required; the call fills each other array you give.

| Member | Description |
| --- | --- |
| `distances: Float32Array \| Float64Array` | The distance to each ray's closest hit in meters, or -1 when the ray hits nothing. |
| `objects?: (QueryTarget \| null)[]` | The object or the batch of a row that each ray hit, or null. |
| `instances?: Int32Array` | The row of a batch that each ray hit, or -1. |
| `points?: Float32Array \| Float64Array` | Each hit's point in world space, three numbers per ray. |
| `normals?: Float32Array \| Float64Array` | Each hit triangle's unit normal in world space, facing the ray, three numbers per ray. |

## `RaycastHit`

Interface `RaycastHit`, which extends `OverlapHit`.

A raycast's hit. Create one with `point` and `normal` arrays, and pass it to each raycast.

| Member | Description |
| --- | --- |
| `point: Vec3Like` | Where the ray hit, in world space. |
| `normal: Vec3Like` | The unit normal of the hit triangle in world space, on the side that faces the ray. A hit on a sprite or a point faces the camera; on a line, or within a threshold, it points back along the ray. |
| `distance: number` | The distance from the ray's origin to the hit, in meters. |
| `triangle: number` | The index of the hit triangle in its mesh, as three.js's `faceIndex`, or -1 for a sprite, a point or a line. |

## `RaycastOptions`

Interface `RaycastOptions`, which extends `QueryOptions`.

The options of a raycast.

| Member | Description |
| --- | --- |
| `maxDistance?: number` | The farthest hit, in meters from the ray's origin. The default is no limit. |
| `pointThreshold?: number` | When set, a ray hits a point that it passes within this many meters of, whatever the point's size, as three.js's `Raycaster.params.Points.threshold` does. By default a ray hits the square that a point draws. |
| `lineThreshold?: number` | When set, a ray hits a line that it passes within this many meters of, whatever the line's width, as three.js's `Raycaster.params.Line.threshold` does. By default a ray hits a line within half its width. |
