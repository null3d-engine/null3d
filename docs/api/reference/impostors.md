---
id: api/reference/impostors
title: "Impostors (@null3d/impostors): API reference"
status: generated
since: "0.2"
summary: "Every export of the Impostors (@null3d/impostors) API, from the engine's doc comments."
---

# Impostors (@null3d/impostors): API reference

> [Impostors (@null3d/impostors)](../impostors.md) explains these exports. The engine's doc comments make this page.

## `bakeImpostorAtlas`

```ts
function bakeImpostorAtlas(options: ImpostorBakeOptions): ImpostorBake
```

Draws `parts` from every cell of `atlas` into the colour and surface atlases, which it returns. The bake is arithmetic over the arrays. It gives the same pixels on every device, so both GPU paths draw one card.

## `createImpostors`

```ts
function createImpostors(ctx: ImpostorContext, options: ImpostorOptions): ImpostorBatch
```

Makes a batch of impostor cards: one card per position, drawn from the three atlas views nearest the direction from the card toward the eye, and lit by the scene's lights. The cards need no `update` call: the material reads the eye from the frame's camera. A card's turn, in `turn`, turns its views and its light by the same angle about the world's up, so a turned tree hands over to a card whose crown matches it. A batch that casts the sun's shadow cuts that shadow to the crown's shape, and a batch that receives shadows reads them at the surface that it shows.

## `decodeOctahedral`

```ts
function decodeOctahedral(uv: OctahedralUv, out: [number, number, number] = [0, 0, 0]): Direction
```

The unit direction that an octahedral coordinate pair names, the inverse of `encodeOctahedral`. Encoding the result gives the pair again, except on the square's outer edges, where the fold makes two points name one direction.

## `Direction`

```ts
type Direction = readonly [number, number, number];
```

A direction, three numbers. It need not have length 1: this module makes it unit length.

## `EDGE_BAND`

```ts
const EDGE_BAND: 0.08
```

The share of a draw range's edge distance over which the engine dithers that edge. The dither's phase comes from each copy's own source. The mesh and the card are different sources, so their phases differ: a card that faded in while the mesh faded out would drop the pixels that both left out, and the background would show through the crown.

## `encodeImpostorSurface`

```ts
function encodeImpostorSurface(normal: Direction, depth: number, coverage = 1, out: Uint8Array = new Uint8Array(4)): Uint8Array
```

Writes the surface atlas's texel for a point of a view: the normal in the view's space, where x and y lie across and up the picture and z points at the viewer, the point's depth from the view's front, 0, to its back, 1, and its coverage. `out` takes the four bytes, and is returned, so a bake writes one buffer without allocating.

## `encodeOctahedral`

```ts
function encodeOctahedral(direction: Direction, out: OctahedralUv = [0, 0]): OctahedralUv
```

Folds a direction onto the octahedron's two coordinates, each from -1 to 1. The front half of the sphere, z from 0 up, fills the square's middle diamond, and the back half fills its four corners, so a grid of cells covers the whole sphere. The back pole, (0, 0, -1), lands on the corner (1, 1).

## `farCellGroups`

```ts
function farCellGroups(centers: readonly (readonly [number, number, number])[], cellSize: number): number[][]
```

Groups copies by the grid cell of their centers: the cell a center falls in is its position divided by `cellSize` and rounded down, along each axis. Merge each group into one mesh, so a large world draws a few meshes instead of one per copy. Centers that share a cell, in the order they were given, come back as one list.

## `FarPart`

Interface `FarPart`.

One copy of a mesh in a merge: its arrays, and the transform that places it. The transform is a column-major 4 by 4 matrix, as `mat4` writes; without one the copy stays where its arrays are.

| Member | Description |
| --- | --- |
| `readonly arrays: MeshArrays` | The mesh's arrays, as `geometry.fromArrays` takes them. |
| `readonly transform?: Mat4Like` | Where the copy sits. The default is the origin, with no turn and no scale. |

## `frameDirection`

```ts
function frameDirection(frame: number, atlas: OctahedralAtlas, out: [number, number, number] = [0, 0, 0]): Direction
```

The direction that the view of a cell was drawn from: the center of the octahedron's cell, as a unit direction. `impostorFrame` of the result gives `frame` again.

## `handOverToCards`

```ts
function handOverToCards(meshes: InstanceBatch, cards: InstanceBatch, switchDistance: number, start = 0): void
```

Hands a batch of near meshes over to their far cards. The meshes draw up to `switchDistance`, and the engine dithers the last few per cent of that range out. The cards start early enough that their own dithered edge ends before the meshes' edge begins to thin. So each pixel that a mesh drops shows its card at full coverage, and the background never shows through. Write the cards' turns and sizes before this call, and call it at setup.

## `ImpostorBake`

Interface `ImpostorBake`.

The two atlases that a bake writes: the colour in sRGB, with the coverage in alpha, and the surface in linear colour, as `createImpostors` takes them.

| Member | Description |
| --- | --- |
| `readonly atlas: OctahedralAtlas` | The grid that the bake drew. |
| `readonly color: { width: number; height: number; data: Uint8Array; }` | The colour atlas: its texels, and their grid. |
| `readonly surface: { width: number; height: number; data: Uint8Array; }` | The surface atlas: its texels, and their grid. |
| `readonly size: readonly [number, number]` | The world size of one card's quad at scale 1: the width that holds the object's widest horizontal reach, and its height. The card stands on the object's lowest point. |
| `readonly room: number` | How many times taller a view's picture is than `size`'s height, which holds the object from every view: `createImpostors` takes it as `room`. |
| `readonly depth: number` | The object's depth along a view, in world units: the widest of its horizontal extents. The surface atlas stores each point's depth over this distance, and a card that receives shadows reads them where the depth puts the surface it shows. |

## `ImpostorBakeMap`

Interface `ImpostorBakeMap`.

A map that a bake samples: its pixels, four bytes a texel in the first row first, and the cell that a part draws.

| Member | Description |
| --- | --- |
| `readonly width: number` | Texels across. |
| `readonly height: number` | Rows down. The first row is the texture's row at v = 0. |
| `readonly data: Uint8Array \| Uint8ClampedArray` | Four bytes a texel, the first row first. |
| `readonly cell?: readonly [number, number]` | The cell that the part samples, counted from the top left. The default is (0, 0). |
| `readonly cells?: readonly [number, number]` | The cells across and down. The default is one by one. |
| `readonly tiles?: number` | How many times the map repeats over the part's texture coordinates. The default is 1. |
| `readonly wrap?: 'clamp' \| 'repeat'` | How a place past the map reads: clamp by default, or repeat. |

## `ImpostorBakeOptions`

Interface `ImpostorBakeOptions`.

What `bakeImpostorAtlas` takes: the grid, its cells' size, and the object.

| Member | Description |
| --- | --- |
| `readonly atlas: OctahedralAtlas` | The cells across and down. A bake draws a view in every cell. |
| `readonly texels: number` | The texels on each side of a cell, a whole number from 1. |
| `readonly parts: readonly ImpostorBakePart[]` | The parts that the bake draws, in any order: the depth decides what shows. |
| `readonly min: readonly [number, number, number]` | The object's bounds in its own frame: the smallest corner. |
| `readonly max: readonly [number, number, number]` | The object's bounds in its own frame: the largest corner. |

## `ImpostorBakePart`

Interface `ImpostorBakePart`.

One part that a bake draws: its mesh arrays and what colours its surface.

| Member | Description |
| --- | --- |
| `readonly positions: ArrayLike<number>` | The vertices' positions, three numbers each, in the object's frame. |
| `readonly normals?: ArrayLike<number>` | The vertices' normals, three numbers each. They are made where the part leaves them out. |
| `readonly uvs?: ArrayLike<number>` | The vertices' texture coordinates, two numbers each, where a map is drawn. |
| `readonly colors?: ArrayLike<number>` | The vertices' colours, three or four numbers each, linear. A fourth number is the vertex's coverage. |
| `readonly indices: ArrayLike<number>` | The triangles' vertices, three each. |
| `readonly color?: ImpostorBakeMap` | The colour map, in sRGB, that the part samples. Its alpha is not the coverage. |
| `readonly coverage?: ImpostorBakeMap` | The coverage map, linear: its blue holds the coverage. |
| `readonly tint?: readonly [number, number, number]` | A linear colour that multiplies the part's own colour. The default is white. |
| `readonly alphaCutoff?: number` | The coverage under which nothing draws. The default is 0.5. |
| `readonly doubleSided?: boolean` | True to draw both sides of the part's triangles and light the back ones. |

## `ImpostorBatch`

Class `ImpostorBatch`.

A batch of impostor cards, which `createImpostors` makes. The cards need no per-frame work: the material reads the eye from the frame's camera and picks each card's views itself. Write the cards' positions, sizes, turns or colors through `batch`, then call `markDirty` for those cards.

| Member | Description |
| --- | --- |
| `readonly batch: InstanceBatch` | The instance batch whose rows are the cards. |
| `readonly count: number` | The number of cards. |
| `setViews(views: 1 \| 3): void` | Sets how many atlas views a card draws: the three nearest it, which blend so no seam shows as the eye turns, or its nearest view alone, which is cheaper and hops from view to view. The default is three. |
| `markDirty(start = 0, count = this.batch.count - start): void` | Marks `count` cards from `start` as changed, after you write their positions, sizes or colors through `batch`. The default marks every card. |
| `destroy(): void` | Removes the cards and frees their rows, as an instance batch's `destroy`. |

## `ImpostorContext`

Interface `ImpostorContext`.

What `createImpostors` needs of the sketch: the scene, and the factories it draws with.

| Member | Description |
| --- | --- |
| `readonly scene: Scene` | The scene that the cards join, and that the material reads the frame's camera from. |
| `readonly materials: Materials` | The sketch's materials factory, which makes the card material. |
| `readonly geometry: { fromArrays(arrays: MeshArrays): MeshGeometry; }` | The sketch's geometry factory, which makes the quad that every card draws. |

## `impostorFrame`

```ts
function impostorFrame(direction: Direction, atlas: OctahedralAtlas): number
```

The cell of an atlas that shows a view from `direction`, as a frame counted from the atlas's top left, along each row and then down. A view was drawn from the direction a cell's center names, so a bake that walks `frameDirection` over every frame and this agree on every cell. A direction of length 0 shows the middle cell.

## `ImpostorOptions`

Interface `ImpostorOptions`.

Options of `createImpostors`: the atlases, the cards and their look.

| Member | Description |
| --- | --- |
| `readonly color: Texture` | The colour of every view, in sRGB: one cell per view, in the cells of `atlas`. |
| `readonly surface: Texture` | The surface of every view, in the same cells as `color`: red and green hold the octahedral code of the normal in the object's frame, blue its depth from the view's front to its back, and alpha its coverage. `bakeImpostorAtlas` writes one. |
| `readonly atlas: OctahedralAtlas` | The cells of the atlases: the frames across and down. |
| `readonly positions: ArrayLike<number>` | The cards: three numbers each, x, y and z, in world units. Each stands on its position, like a tree on the ground. Their count is the batch's size. |
| `readonly turn?: ArrayLike<number>` | The turn of each card about the world's up, in radians, one number a card. A bake draws each view in the tree's local frame, so a turned copy picks the views its turned mesh would show and lights from the normal that the turn gives it. The default turns every card by 0. |
| `readonly size?: number \| readonly [number, number]` | The width and height of every card, in world units. One number makes a square card. The default is the atlas's cells, one unit each, which suits a bake at one unit per cell. |
| `readonly tint?: ColorInput` | A color that multiplies every card's view. |
| `readonly roughness?: number` | The roughness that the cards light with, as the standard material's. |
| `readonly metalness?: number` | The metalness that the cards light with, as the standard material's. |
| `readonly alphaMode?: 'opaque' \| 'blend' \| 'mask'` | How the cards use their alpha: `mask` by default, since a bake cuts its object out. |
| `readonly room?: number` | How many times taller a view's picture is than a card's height: the bake's `room`. The default, 1, is a picture that fills its card. |
| `readonly alphaCutoff?: number` | The alpha under which a masked card draws nothing. The default is 0.5. |
| `readonly layers?: number` | The layers every card is on, as a 32-bit mask. The default, 1, is layer 0. |
| `readonly depth?: number` | The object's depth along a view, in world units: the distance that the surface atlas's stored depth spans. A card that receives shadows reads them where that depth puts the surface that it shows, rather than on its own plane, so its own cast does not fall on it. The default is the card's width, the widest horizontal reach that the bake fits into it. |
| `readonly castShadows?: boolean` | True makes the cards cast the sun's shadow, cut to the crown's shape that the bake stored. A card batch that only casts draws on a layer that the light sees and no camera does, so it costs nothing in the camera's view. The default is false. |
| `readonly receiveShadows?: boolean` | True makes the shadows of other objects fall on the cards. The default is false. |
| `readonly castsStill?: boolean` | True keeps the cards' casters in place while the sun stands still, so a far shadow cascade stays cached. The default is true, which suits a card that turns to the eye of each pass. A scene that turns a card whose batch casts from frame to frame moves its caster while the light stands still, and the far cascades then keep a stale shadow: pass false for such a scene. |

## `mergeFarGeometry`

```ts
function mergeFarGeometry(parts: readonly FarPart[]): MeshArrays
```

Merges copies of a mesh into the arrays of one mesh, moving each copy by its own transform. The result holds every vertex and triangle of every copy, with each copy's indices moved to point at its own vertices. Give it to `geometry.fromArrays`. Every copy must carry the same attributes, and each attribute must hold the same numbers per vertex in every copy. An attribute that any copy lacks is left out of the result. Positions are always carried, and indices are made for a copy that has none. A copy's normals turn by the inverse transpose of its transform's upper left 3 by 3, as normals turn, so a stretched copy keeps its shading. Its tangents turn by the upper left 3 by 3 itself. A mirrored copy, whose transform has a negative determinant, gets its triangles' winding reversed and its tangents' fourth number negated, so its front faces stay outward and its normal map keeps its sense. Throws a RangeError for arrays that do not fit together.

## `nearestFrame`

```ts
function nearestFrame(direction: Direction, directions: readonly Direction[]): number
```

The view of a list of directions that faces the camera most: the one whose direction has the largest dot product with `direction`. Use it when a bake holds views that are not an octahedral grid, such as 12 views a tool picked. It returns -1 for an empty list.

## `octahedralAtlas`

```ts
function octahedralAtlas(views: number): OctahedralAtlas
```

The squarest grid of cells that holds at least `views` views, as `{ columns, rows }`. The grid can hold more cells than `views`, and every cell shows a direction. Give the result to a bake, which draws a view in each cell, and to `createImpostors`, which shows them.

## `OctahedralAtlas`

Interface `OctahedralAtlas`.

The cells of an impostor atlas: `columns` across and `rows` down, as a sprite atlas.

| Member | Description |
| --- | --- |
| `readonly columns: number` | The frames across the atlas, from 1. |
| `readonly rows: number` | The frames down the atlas, from 1. |

## `octahedralCells`

```ts
function octahedralCells(atlas: OctahedralAtlas): number
```

The number of cells of an octahedral atlas: `columns` times `rows`. A bake draws a view in each of them, because each shows a direction.

## `OctahedralUv`

```ts
type OctahedralUv = [number, number];
```

Two octahedral coordinates, each from -1 to 1.
