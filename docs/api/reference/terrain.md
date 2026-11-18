---
id: api/reference/terrain
title: "Terrain (@null3d/terrain): API reference"
status: generated
since: "0.2"
summary: "Every export of the Terrain (@null3d/terrain) API, from the engine's doc comments."
---

# Terrain (@null3d/terrain): API reference

> [Terrain (@null3d/terrain)](../terrain.md) explains these exports. The engine's doc comments make this page.

## `createHeightfield`

```ts
function createHeightfield(options: HeightfieldOptions): Heightfield
```

Makes a height field. See `Heightfield`.

## `createTerrain`

```ts
function createTerrain(context: SketchContext, options: TerrainOptions): Terrain
```

Makes a terrain: a height field drawn as a quadtree of blocks with a splat-mapped surface. Call `terrain.update(eye)` with the camera's world position when it moves, and read `heightAt` and `normalAt` to place what stands on the ground. `terrain.destroy()` frees it.

## `Heightfield`

Class `Heightfield`.

The height field that a terrain builds every block from: the height of a square piece of ground, sampled once and read back with bilinear interpolation.

| Member | Description |
| --- | --- |
| `readonly size: number` | The width and depth of the square, in meters. |
| `readonly resolution: number` | The samples along each side. |
| `readonly min: number` | The lowest sample of the ground, in meters. |
| `readonly max: number` | The highest sample of the ground, in meters. |
| `readonly heights: Float32Array` | The samples of the ground, row by row, from `z = -size / 2` upward. |
| `sample(col: number, row: number): number` | The sample at the column `col` and the row `row`, clamped to the square, so a reader just outside the ground gets the edge's height. An index below 0 or past the resolution takes the nearest edge's sample. |
| `heightAt(x: number, z: number): number` | The height of the ground at a point, in meters. A point between samples takes the bilinear interpolation of the four around it, and a point outside the square takes the edge's height. Allocates nothing. |
| `slopeAt(x: number, z: number): number` | The size of the ground's slope at a point, as the rise over the run: 0 on flat ground and about 1 at a 45 degree slope. Reads the field around the point, so it costs four `heightAt` calls. Allocates nothing. |
| `normalAt(x: number, z: number, out: number[] \| Float32Array): void` | The unit normal of the ground at a point, written into `out` as x, y and z. Reads the field around the point, so it costs four `heightAt` calls. Allocates nothing. |
| `writeNormalMap(resolution: number, data: Uint8Array): void` | Writes the ground's normals into a square image of `resolution` texels along each side, row by row from `z = -size / 2` upward, as four bytes per texel: the normal's x and z, each from -1 to 1 as 0 to 255, then two bytes that hold no value. A surface rebuilds the y from the unit length. The slope is read with the same central differences as `normalAt`, so every block of every level shades from one picture of the ground rather than from its own vertices. Allocates nothing beyond what the caller gives. |

## `HeightfieldOptions`

Interface `HeightfieldOptions`.

Options for `createHeightfield`.

| Member | Description |
| --- | --- |
| `size: number` | The width and depth of the square, in meters, centered on the origin. |
| `resolution?: number` | The samples along each side, from 2 up. The default is 256. A function's height is read once at each sample; a typed array must hold `resolution * resolution` heights already. |
| `height: ((x: number, z: number) => number) \| Float32Array` | The height of the ground at a point, in meters. A function is read once per sample. A `Float32Array` holds the samples row by row, from `z = -size / 2` upward, sampled with `resolution` heights per row. |

## `SplatFunction`

```ts
type SplatFunction = (x: number, z: number, out: number[]) => void;
```

A weight of each layer at a point, written into `out` as red, green, blue and alpha.

## `Terrain`

Class `Terrain`.

A ground drawn as a quadtree of blocks. `createTerrain` makes one.

| Member | Description |
| --- | --- |
| `readonly size: number` | The width and depth of the ground, in meters. |
| `readonly heightfield: Heightfield` | The height field, for a caller that wants to read it directly. |
| `readonly drawn: number` | How many blocks the ground draws: none while it is hidden. |
| `readonly triangles: number` | How many triangles the ground draws, with each block's skirt. |
| `readonly building: boolean` | True while the camera's newest selection is still being built, over the next frames. |
| `heightAt(x: number, z: number): number` | The height of the ground at a point, in meters, with bilinear interpolation between the samples of the height field. Allocates nothing. |
| `normalAt(x: number, z: number, out: number[] \| Float32Array): void` | The unit normal of the ground at a point, written into `out` as x, y and z, for placing an object that stands on the ground. Allocates nothing. |
| `update(eye: Vec3Like): void` | Picks the blocks to draw for a camera whose world position `eye` holds, as x, y and z. The ground picks again when the camera crosses a cell of the finest level, rises by one such cell, or draws through a different field of view or buffer height, so a still camera costs no work. The selection and the block build run in the add-on's WebAssembly module on the engine's job workers, so this call only asks for them. A new selection builds at most `blocksPerUpdate` blocks in one task, the first selection builds every block it needs, and the ground draws the selection it had until the new one is built. A block that the new selection needs takes the mesh of one that it left out. Call it in `onUpdate` with the camera's own position, in an array you keep: an array crosses the call as it is, where two fractions make the browser box each of them into an object. |
| `setMorph(enabled: boolean): void` | Turns the block morph on or off, from the next frame. The ground reads the selection's scale again with the last view, so a page that compares the look or measures the cost needs no new selection. |
| `setVisible(visible: boolean): void` | Shows or hides the whole ground, for a camera high above it. |
| `destroy(): void` | Destroys the ground: every block's object and mesh, and the material's own textures. |

## `TerrainLayer`

Interface `TerrainLayer`.

One layer of the ground's surface: a tiled color map, and how rough it is.

| Member | Description |
| --- | --- |
| `map: Texture` | The layer's color map, in sRGB, which repeats across the ground. |
| `tile?: number` | The meters that one repeat of the map covers. The default is 8. |
| `roughness?: number` | The layer's roughness, from 0 to 1. The default is 1. |
| `contrast?: number` | How strongly the layer's own height scales its weight, from 0 to 1: rocks show through the grass at a boundary instead of fading into it. The default is 1, and 0 blends by the splat map's weights alone. |
| `heightFrom?: 'brightness' \| 'alpha'` | Where the layer's height comes from at each texel: its map's brightness, the default, or the map's alpha channel for a map that keeps a height there. The maps that `terrainTextures` makes keep one in alpha. |

## `TerrainOptions`

Interface `TerrainOptions`.

What `createTerrain` needs and what the ground may change.

| Member | Description |
| --- | --- |
| `size: number` | The width and depth of the ground, in meters, centered on the origin. |
| `height: ((x: number, z: number) => number) \| Float32Array` | The height of the ground at a point, in meters. A function is read once per sample of the height field. A `Float32Array` is a height map of `resolution` samples along each side, row by row from `z = -size / 2` upward. |
| `resolution?: number` | The samples along each side of the height field, from 2 up. The default is 256. |
| `layers: readonly TerrainLayer[]` | The layers of the surface, from one to four, which the splat map's channels weight. |
| `splat?: SplatFunction` | The weight of each layer at a point, written into `out` as red, green, blue and alpha. The default puts grass on the low, gentle ground, soil on the drier higher ground, rock on the steep slopes and snow above. |
| `splatResolution?: number` | The texels along each side of the splat map. The default is 256. |
| `chunkQuads?: number` | The faces along each side of a block's grid. The default is 16. |
| `maxLevel?: number` | The finest level, from 0 to 15: a block covers `size / 2 ** maxLevel` meters. The default is 6. |
| `camera?: { readonly fov: number; }` | The camera whose field of view sets how far a block keeps its detail, which the ground reads when it picks blocks. Without one the ground assumes a vertical field of view of 50 degrees. |
| `error?: number` | The screen error, in pixels, above which a block splits into four. The default is 35 times the quality preset's `lodThreshold`, so the ground draws with that preset's detail: Low picks coarser blocks. 0 keeps the finest level everywhere. |
| `bakedNormals?: boolean` | True lights every pixel from a normal map baked over the ground, which shows relief that a coarse block's vertices cannot. The default is true; false lights from the mesh's own normals. |
| `steepFaces?: boolean` | True maps the third layer, the rock, from the sides on a steep face, where a map laid from above stretches into streaks. It costs two more samples of that map. The default is false. |
| `skirt?: number` | How far the skirt around each block hangs down, in meters. The default is four of the block's cells, which closes the seam against a neighbour up to a level or two coarser. |
| `morph?: boolean` | True moves each block toward its parent block's surface as the camera pulls away, so a block that hands over to a coarser one does not pop. The default is true. False switches each block at once and keeps the block's vertices as they are. |
| `metalness?: number` | How much the ground acts like a metal, from 0 to 1. The default is 0. |
| `castShadows?: boolean` | True makes the ground cast the sun's shadows. The default is true. |
| `receiveShadows?: boolean` | True makes shadows fall on the ground. The default is true. |
| `maxBlocks?: number` | The most meshes the ground holds, from 16 up: a block that a selection leaves out gives up its mesh to the next block that needs one, so the ground stops building meshes once it holds this many. Its meshes wait for a block again until the count passes this figure. The default is 512. |
| `blocksPerUpdate?: number` | The most new blocks that one task builds, from 1 up. A camera that crosses into a new cell may need tens of blocks, and building them all at once would stall the frame. The ground draws its last complete selection until the new one is built. The first selection builds every block that it needs, over a few tasks, since there is no ground to draw before it. The default is 16. |

## `TerrainTextureOptions`

Interface `TerrainTextureOptions`.

How to make the layer maps.

| Member | Description |
| --- | --- |
| `size?: number` | The texels along each side of every map. The default is 128. |
| `seed?: number` | The seed of the noise. The default is 1. |

## `terrainTextures`

```ts
function terrainTextures(textures: SketchContext['textures'], options: TerrainTextureOptions = {}): TerrainTextures
```

Makes the four layer maps in code. Each is `size` texels across and repeats; the noise tiles, so the maps do too, and the same seed gives the same maps on every run. Each map keeps a height in its alpha channel, so a layer that reads its height from there pushes its clumps and stones through a neighbour at a boundary.

## `TerrainTextures`

Interface `TerrainTextures`.

The four layer maps, ready for `TerrainLayer.map`.

| Member | Description |
| --- | --- |
| `grass: Texture` | Dark green blades on a lighter green ground: the layer of the low, gentle ground. |
| `soil: Texture` | Dry brown earth with small stones: the layer of the higher, dry ground. |
| `rock: Texture` | Gray rock, broken into facets: the layer of the steep slopes. |
| `snow: Texture` | Near-white, faintly blue snow with a little grain: the layer of the high ground. |
