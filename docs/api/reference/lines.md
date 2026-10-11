---
id: api/reference/lines
title: "Lines: API reference"
status: generated
since: "0.2"
summary: "Every export of the Lines API, from the engine's doc comments."
---

# Lines: API reference

> [Lines](../lines.md) explains these exports. The engine's doc comments make this page.

## `LineBatch`

Class `LineBatch`.

Lines of any width: segments between points, each drawn as a quad with round ends that faces the camera, like three.js's `Line2`. Write points straight into the typed arrays, as for an instance batch. A dynamic batch updates every segment every frame, and a static batch updates the segments of the points you mark dirty.

| Member | Description |
| --- | --- |
| `readonly count: number` | The number of points: the batch's capacity. |
| `readonly material: LineMaterial` | The lines' material: `set` changes the color, opacity and dashes of every segment. |
| `readonly positions: Float32Array` | Positions in the world, 3 floats per point. |
| `readonly colors: Float32Array` | Linear RGB colors, 3 floats per point, which multiply the material's color. |
| `setWidth(width: number): void` | Sets the width: CSS pixels, or world units for lines made with `worldUnits`. Every segment updates and uploads once. |
| `setActiveCount(count: number): void` | Draws only the segments between the first `count` points. |
| `setLayers(mask: number): void` | Puts every segment on the layers of a 32-bit mask. A new mask needs no rebuild. |
| `markDirty(start = 0, count = this.count - start): void` | Marks points of a static batch to update and upload, with the segments that use them. On a dashed line, the segments after them update too, as their distances along the line change. |
| `on(type: ObjectEventType, handler: ObjectEventHandler): void` | Calls `handler` for each pointer event of `type` on a segment of the batch, as `Object3D.on` does. A ray hits a segment within half its width. The event's `instance` names the segment. |
| `off(type: ObjectEventType, handler: ObjectEventHandler): void` | Removes a handler that `on` added for events of `type`. |
| `destroy(): void` | Removes the batch and frees its points. Its typed arrays are not valid after this: another batch can take their memory. |

## `LineMaterial`

Class `LineMaterial`.

A line batch's material: its color and opacity, as a material's `set` takes them, and its dash values.

| Member | Description |
| --- | --- |
| `set(values: LineValues): void` | Changes the values that it gets and keeps the others. Every segment of the batch changes with them. Converting a new color allocates. |

## `LineMode`

```ts
type LineMode = 'segments' | 'strip' | 'loop';
```

Which points each segment joins. With `segments`, each pair of points makes a segment, like three.js's `LineSegments`. With `strip`, every point joins the next, like `Line` and `Line2`. With `loop`, the last point also joins the first, like `LineLoop`.

## `LineOptions`

Interface `LineOptions`, which extends `LineValues`, `Pick`.

Options of `scene.createLines`. The look of the lines takes the options of an unlit material.

| Member | Description |
| --- | --- |
| `positions: ArrayLike<number>` | The points: 3 numbers each. Their number is the batch's capacity, which never changes, and `lines.positions` holds them after the call. |
| `colors?: ArrayLike<number>` | Linear RGB colors, 3 numbers per point, which multiply `color`. A segment takes the color of each end and blends from one to the other. The default is white. |
| `mode?: LineMode` | Which points each segment joins. The default is `strip`. |
| `width?: number` | The width of the lines: CSS pixels, or world units with `worldUnits`. The default is 1, as three.js's `linewidth`. |
| `worldUnits?: boolean` | True gives the width in world units, so far lines look thinner, as three.js's `worldUnits` does. False gives it in CSS pixels. The default is false. |
| `dashed?: boolean` | Draws the lines as dashes, which `dashSize`, `gapSize` and the other dash values shape. |
| `lit?: boolean` | Lights the lines as a standard material lights a surface that faces the camera: the sun, the point and spot lights and the ambient light shade them. False draws the color as it is, as three.js's line materials do. The default is false. |
| `dynamic?: boolean` | Every point updates and uploads every frame; a static batch updates points marked dirty only. |
| `layers?: number` | The layers every segment is on, as a 32-bit mask. The default, 1, is layer 0. |
| `origin?: Vec3` | The point that every point's position is relative to, as an instance batch's `origin`. The default is (0, 0, 0). Lines near it keep the precision of 32-bit floats at any distance from the world's origin. |
| `alphaMode?: 'opaque' \| 'blend'` | How the lines use their opacity. The default is `opaque`, as three.js's lines are. |

## `LineValues`

Interface `LineValues`, which extends `Omit`, `Pick`.

The values of a line batch's material, which `lines.material.set` changes at any time. The dash values act on dashed lines, as three.js's `LineMaterial` takes them. The metalness, roughness and emissive values act on lit lines, as a standard material takes them.

| Member | Description |
| --- | --- |
| `dashSize?: number` | The length of each dash, along the line. The default is 1. |
| `gapSize?: number` | The length of each gap between dashes. The default is 1. |
| `dashScale?: number` | A factor of the line's length, which the dash and gap sizes measure. The default is 1. |
| `dashOffset?: number` | How far along the line the dashes start, which moves them when it changes. The default is 0. |
