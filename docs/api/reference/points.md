---
id: api/reference/points
title: "Points: API reference"
status: generated
since: "0.2"
summary: "Every export of the Points API, from the engine's doc comments."
---

# Points: API reference

> [Points](../points.md) explains these exports. The engine's doc comments make this page.

## `PointBatch`

Class `PointBatch`.

Many points: squares that face the camera, all of one size, each with its own position and color, like three.js's `Points` with a `PointsMaterial`. Write points straight into the typed arrays, as for an instance batch. A dynamic batch updates every point every frame, and a static batch updates the points you mark dirty.

| Member | Description |
| --- | --- |
| `readonly count: number` | The number of points: the batch's capacity. |
| `readonly material: Material<PointValues>` | The points' material: `set` changes the color, opacity and alpha cutoff of every point. |
| `readonly positions: Float32Array` | Positions in the world, 3 floats per point. |
| `readonly colors: Float32Array` | Linear RGBA colors, 4 floats per point, which multiply the material's color and map. Components from 0 to 1024 draw, and alpha from 0 to 1. |
| `setSize(size: number): void` | Sets the size of every point: world units, or CSS pixels for points made with `sizeAttenuation: false`. Every point updates and uploads once. |
| `setActiveCount(count: number): void` | Draws only the first `count` points. |
| `setLayers(mask: number): void` | Puts every point on the layers of a 32-bit mask. A new mask needs no rebuild. |
| `markDirty(start = 0, count = this.count - start): void` | Marks points of a static batch to update and upload. |
| `on(type: ObjectEventType, handler: ObjectEventHandler): void` | Calls `handler` for each pointer event of `type` on a point of the batch, as `Object3D.on` does. A ray hits a point where its square draws. The event's `instance` names the point. |
| `off(type: ObjectEventType, handler: ObjectEventHandler): void` | Removes a handler that `on` added for events of `type`. |
| `destroy(): void` | Removes the batch and frees its points. Its typed arrays are not valid after this: another batch can take their memory. |

## `PointOptions`

Interface `PointOptions`, which extends `PointValues`, `Omit`.

Options of `scene.createPoints`. The look of the points takes the options of an unlit material. Points are opaque by default, as three.js's `PointsMaterial` is.

| Member | Description |
| --- | --- |
| `positions: ArrayLike<number>` | The points: 3 numbers each. Their number is the batch's capacity, which never changes, and `points.positions` holds them after the call. |
| `colors?: ArrayLike<number>` | Linear colors that multiply `color`: 3 numbers per point (RGB), or 4 (RGBA). The default is white. |
| `size?: number` | The width and height of every point: world units, or CSS pixels without size attenuation. The default is 1. |
| `sizeAttenuation?: boolean` | True gives the size in world units, so far points look smaller. False gives it in CSS pixels, so every point keeps its size on screen, as three.js's `sizeAttenuation: false` does. The default is true. |
| `map?: Texture` | A color map, in sRGB, that each point shows whole and upright, and whose color multiplies the point's. It is fixed when the batch is created. |
| `dynamic?: boolean` | Every point updates and uploads every frame; a static batch updates points marked dirty only. |
| `layers?: number` | The layers every point is on, as a 32-bit mask. The default, 1, is layer 0. |
| `origin?: Vec3` | The point that every point's position is relative to, as an instance batch's `origin`. The default is (0, 0, 0). Points near it keep the precision of 32-bit floats at any distance from the world's origin. |
| `alphaMode?: MaterialFeatures['alphaMode']` | How the points use their alpha. The default is `opaque`, as three.js's points are. |

## `PointValues`

```ts
type PointValues = MaterialOptions;
```

The values of a point batch's material, which `points.material.set` changes at any time.
