---
id: api/reference/grass
title: "Grass (@null3d/grass): API reference"
status: generated
since: "0.3"
summary: "Every export of the Grass (@null3d/grass) API, from the engine's doc comments."
---

# Grass (@null3d/grass): API reference

> [Grass (@null3d/grass)](../grass.md) explains these exports. The engine's doc comments make this page.

## `createGrass`

```ts
function createGrass(ctx: SketchContext, options: GrassOptions): Promise<Grass>
```

Makes the grass: one draw for each tuft shape, filled with the placed tufts, and the calls that draw a preset's share and give the blades the frame's air. A page awaits it in its setup.

## `Grass`

Interface `Grass`.

The grass that `createGrass` made: the draws, and the calls that draw a preset's share and give them the frame's air.

| Member | Description |
| --- | --- |
| `readonly draws: readonly GrassDraw[]` | The drives, one for each shape: WebGPU's compute list, or WebGL2's instance batch. |
| `readonly batches: readonly InstanceBatch[]` | The instance batches that draw, which is empty when a compute pass fills the rows. |
| `fit(preset: QualityPreset): void` | Draws the preset's share of the tufts. |
| `setSwayDistance(distance: number): void` | Changes the distance from the camera out to which the blades sway, in meters. A page that gives the grass a preset's distance calls it when the preset changes. |
| `setWindLayer(field: WindField): void` | Gives the blades the field's newest state for this frame, and the blade list the camera's view. Call it once in each frame, before the frame draws. |

## `GrassBladeShape`

Interface `GrassBladeShape`.

The shape of a cover's blades, which `createGrass` gives every blade in place of its own narrowing strip.

| Member | Description |
| --- | --- |
| `readonly widthAt: (t: number) => number` | The blade's width in meters at a share of its length, from 0 at the root to 1 at the tip. A width of 0 at the tip closes the blade there. |
| `readonly fold: number` | The degrees that each half of the blade rises from its keel. Above 0, a row across the blade holds a third vertex at the keel and the two halves light apart. At 0 the blade is a flat strip. |

## `GrassDraw`

Interface `GrassDraw`.

One shape's tufts: the rows that draw them and the draw that fills them.

| Member | Description |
| --- | --- |
| `readonly batch?: InstanceBatch` | The instance batch that WebGL2 draws, or undefined when a compute pass fills the rows. |
| `readonly material: GrassMaterial` | The material that the rows draw with. |

## `GrassMaterial`

Interface `GrassMaterial`.

The part of a grass material that the grass itself sets.

| Member | Description |
| --- | --- |
| `setUniform(name: string, value: number): void` | Sets one of the material's uniforms, by the name of its WGSL's field. |

## `GrassOptions`

Interface `GrassOptions`.

What `createGrass` takes: the ground, the area, the count at the High preset, and the seed.

| Member | Description |
| --- | --- |
| `readonly height: (x: number, z: number) => number` | The ground's height at a point, in meters. The grass stands on it and avoids steep ground. |
| `readonly area: { readonly x: number; readonly z: number; readonly size: number; }` | The square that the grass fills, centered on `x` and `z`, with a side of `size` meters. |
| `readonly count: number` | The tufts at the High preset. Low, Medium and Ultra draw 0.35, 0.6 and 1.25 of it. |
| `readonly seed: number` | The seed that places every tuft and grows every blade, the same on every device. |
| `readonly blades?: number` | The blades in each tuft. The default is 13. |
| `readonly segments?: number` | The segments of each blade. The default is 3. |
| `readonly shapes?: number` | The shapes of tuft, each one draw. The default is 1. |
| `readonly where?: (x: number, z: number) => boolean` | Says whether grass grows at a point, for ground that holds a road or a wall. Without it, grass grows everywhere. |
| `readonly color?: string` | The blades' color, which meets the ground's own at their roots. The default is a fresh green. |
| `readonly blade?: GrassBladeShape` | The shape that every blade takes: its width along its length and the fold of its keel. Give a plant's own blade with the plant's own color, so the cover reads as the same grass where the plant stands in it. Without it each blade narrows to a point from its root. |
| `readonly maxSlope?: number` | The steepest ground that a tuft grows on, as rise over run. The default is 0.6. |
| `readonly mask?: (x: number, z: number) => boolean` | Where grass may grow. A candidate on ground that the mask refuses is skipped, as water, a rock or a footprint leaves no grass. Leave it out to grow grass wherever the ground is not steep. |
| `readonly wind?: WindField` | The wind add-on's field, the one that the scene's other swaying things read. The blades bend in its air, and a page that leaves it out grows grass that stands still. |
| `readonly sway?: number` | How far a blade bends at its tip for each meter a second of air. The default is 0.04. |
| `readonly swayDistance?: number` | The distance from the camera out to which the blades sway, in meters. Past it they stand still, so a far shadow cascade that only the grass reaches keeps the layer it holds. The default, 0, sways at every distance. |
| `readonly camera?: PerspectiveCamera` | The camera that draws the hill. Give it to cull the tiles outside the view and to thin the far tufts, which widens their blades so the cover stays the same. Without it every tuft in the preset's share draws at full width, as on a page that does not draw the hill. |
| `readonly compute?: boolean` | True lets WebGPU build the blade list in a compute pass, and the grass's near shadows follow its count. The default is true. Give false for a page that drives the rows itself, which draws an instance batch on both GPU paths. |

## `hashAt`

```ts
function hashAt(seed: number, a = 0, b = 0, c = 0, d = 0): number
```

The hash of a seed and up to four choice keys. The keys are mixed in order, so a choice names the thing, its part and the value it picks with a key of its own.

## `pcg`

```ts
function pcg(value: number): number
```

The permutation of one 32-bit value, with the same bits as the shaders' `pcg`.

## `PLANT_SWAY_DISTANCE`

```ts
const PLANT_SWAY_DISTANCE: Readonly<Record<QualityPreset, number>>
```

The distance from the camera out to which plants and grass sway, in meters, for each preset. A page reads it from the engine's preset, so a governor step that lowers the preset shortens the distance with it.

## `swayDistanceFor`

```ts
function swayDistanceFor(preset: QualityPreset): number
```

The distance from the camera out to which plants and grass sway at a preset, in meters. Pass it as `swayDistance` to `createGrass` and to a swaying plant's material, and again to `grass.setSwayDistance` when the preset changes.

## `unitAt`

```ts
function unitAt(seed: number, a = 0, b = 0, c = 0, d = 0): number
```

A choice between 0 and 1, from a seed and its keys. The top 24 bits of the hash make the value, so every device gets the same fraction.
