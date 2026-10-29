---
id: api/impostors
title: Impostors (@null3d/impostors)
status: experimental
since: "0.2"
summary: "createImpostors: far objects as camera-facing cards that blend the three stored views nearest the camera and light from baked normals; mergeFarGeometry: one mesh per far grid cell."
---

# Impostors

> Roadmap step 0.2, first released in null3D 0.1.0. The API is experimental, so it can still change between versions. Not built yet: an `assets impostor` command that writes the atlases from a file. Coding agents must not use it yet.

The demo "Impostors" in `examples/impostors` draws a pine forest three ways by distance. Level-of-detail meshes stand near, one merged mesh stands per grid cell in the middle, and cards baked from the pine stand far out. Press L there to draw the far band as meshes instead, and compare. The near meshes and the cards share the hand-over band.

```mermaid
flowchart LR
    views["bakeImpostorAtlas draws<br/>the mesh from each cell's direction"] --> atlas["Two atlases: the octahedral<br/>grid of colors, and the grid<br/>of normals and depths"]
    atlas --> cards["createImpostors:<br/>one instance batch of cards<br/>that stand upright and<br/>turn to the eye"]
    eye["The frame's camera"] --> blend["The card's material blends<br/>the three nearest views,<br/>turns them by the copy's turn<br/>and lights them"]
    blend --> cards
    copies["Many copies of a mesh,<br/>a far level of detail"] --> merge["mergeFarGeometry:<br/>one mesh per far grid cell"]
```

A far object covers few pixels, so its triangles cost work that no one sees. A level of detail cuts the triangles but keeps one draw per object. An impostor goes further. A bake draws the object from many directions into atlases ahead of time. Far away, the object draws as one card that stands upright and turns to the eye. The card blends the three stored views nearest the camera, and the light falls on it from the normals the bake stored, so a card follows the scene's sun. A card's turn about the world's up turns its views and its light by the same angle, so a turned tree hands over to a card whose crown matches it. The light stays on the tree's side as the camera moves: the card faces the eye, but its stored normal does not turn with the camera. Many cards draw in one instance batch.

`@null3d/impostors` holds the cards and a second tool for far geometry. `mergeFarGeometry` writes many copies of a mesh into the arrays of one mesh. A whole grid cell of a forest or a skyline then draws in one draw.

## Install

The package is an add-on. Install it beside the engine, and import it where a sketch needs it.

```sh
bun add @null3d/engine @null3d/impostors
```

## Create the cards

`createImpostors` makes one instance batch: one quad per position, drawn by the package's material. Each quad stands upright, turns about the world's up toward the eye, and the material blends the three atlas views nearest the direction from the card toward the eye. The cards cull and draw as any batch does, on WebGPU and WebGL2.

```ts
import { createImpostors, octahedralAtlas } from '@null3d/impostors';
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene, materials, geometry, assets }) => {
  const camera = scene.createPerspectiveCamera({ position: [0, 8, 30], target: [0, 3, 0] });
  scene.setActiveCamera(camera);

  // The atlases hold the object's views. `bakeImpostorAtlas` makes them, or a tool writes them.
  const atlas = octahedralAtlas(8);
  const color = await assets.loadTexture('forest-tree-impostor.png');
  const surface = await assets.loadTexture('forest-tree-impostor-surface.png');
  const positions = new Float32Array(20_000 * 3);
  const turns = new Float32Array(20_000);
  for (let i = 0; i < 20_000; i++) {
    positions.set([(i % 100) * 2 - 100, 0, Math.floor(i / 100) * 2 - 100], i * 3);
    turns[i] = (i % 8) * 0.25;
  }
  const trees = createImpostors(
    { scene, materials, geometry },
    { color, surface, atlas, positions, turn: turns, size: 6, alphaMode: 'mask' },
  );
});
```

The cards need no per-frame call. The material reads the eye from the frame's camera, so a camera that flies through the forest changes what every card shows with nothing written on the CPU. That is also why the cards take world positions: the engine draws everything relative to the camera, so a forest far from the world's origin keeps the precision of 32-bit floats.

The cards are a static batch. After you change cards' positions, sizes, turns or colors through `trees.batch`, call `trees.markDirty(start, count)` for those cards. The batch uploads them, and the next frame draws them where they now stand. A card's turn is the row's first value, in radians about the world's up.

`trees.setViews(1)` draws each card from its nearest view alone. That reads each atlas once instead of three times, and it hops from view to view as the eye turns. The default, `setViews(3)`, blends the three nearest views. A field of cards far away saves its blend's cost with one view, where a seam between views shows little.

The `depth` option is the object's depth along a view, in world units: the distance that the surface atlas's stored depth spans. A card that receives shadows reads that depth to place its shadow lookup at the surface it shows. The default is the card's width, which holds the object's widest horizontal reach.

A card's light comes from the scene's lights, as a mesh's does. The surface atlas holds each view's normal, so the sun lights the side of the tree that it would light on the mesh. `roughness` and `metalness` set how the cards light, as the standard material's options do.

The cards cast a shadow only if you ask. Give a batch `castShadows: true` and a layer that the sun draws and no camera does, and the card casts the crown's shape rather than its quad, because the material tests the coverage that the bake stored. A batch with `receiveShadows: true` takes the shadows of other objects at the surface that the stored depth shows, not at its own plane, so a card does not darken itself. A card takes the shadow map's shadows alone: the contact shadows' march takes a flat card for a solid wall, as it takes a leaf card. A card turns toward the view that draws it, so its shadow holds still while the sun does, and the far shadow cascades stay cached.

## The atlas and its cells

`octahedralAtlas(views)` gives the squarest grid that holds at least `views` views, as `{ columns, rows }`. The cells count from the top left, along each row and then down, as an image's rows do. The rows of the texture run from the bottom up, as `textures.fromData` reads them.

`frameDirection(frame, atlas)` gives the direction a cell's view is drawn from. `impostorFrame(direction, atlas)` gives the cell a direction shows. A bake walks `frameDirection` over every frame. The cards pick their cells as `impostorFrame` does. The two agree on every cell, because they are inverses. `encodeOctahedral` and `decodeOctahedral` fold the directions onto one square. The front half of the sphere fills the square's middle diamond, and the back half fills its four corners. So a grid covers both poles too. The back pole, straight behind, lands on the corner at the bottom right.

A bake needs the direction of each cell and one view per cell, looking from that direction at the object. `bakeImpostorAtlas` draws them all on the CPU, so every GPU path gets the same two atlases.

## Bake the atlases

`bakeImpostorAtlas(options)` draws a mesh from every cell's direction into the color and surface atlases. It takes the grid, the texels on each side of a cell, the parts that make the object, and the object's bounds in its own frame. A part gives its positions, normals, texture coordinates and indices, and its color: either vertex colors or a color map, with an optional coverage map. A part that draws leaves names the leaf atlas's cell and draws both sides.

```ts
import { bakeImpostorAtlas, octahedralAtlas } from '@null3d/impostors';

const bake = bakeImpostorAtlas({
  atlas: octahedralAtlas(25),
  texels: 64,
  parts: [{ positions, normals, uvs, indices, color: { width, height, data } }],
  min: [-1.2, 0, -1.1],
  max: [1.1, 7.4, 1.3],
});
const color = textures.fromData({ ...bake.color, colorSpace: 'srgb', mipmaps: false });
const surface = textures.fromData({ ...bake.surface, colorSpace: 'linear', mipmaps: false });
```

The bake is arithmetic over the arrays. It gives the same pixels on every device, and it needs no GPU pass, so a scene's fog and lights never color the picture. It returns the card's `size`: the width that holds the object's widest horizontal reach, and its full height. A card at scale 1 stands on the object's lowest point.

The bake stores each point's normal in the object's own frame. At draw time the card turns that normal by the copy's turn and lights it, so a turned copy lights as its turned mesh does. The bake reads the mesh's own normals, and makes them where the part gives none.

The `@null3d/vegetation` add-on bakes a plant's most detailed level at first use with `bakeFarTree`, and hands the near meshes over to the cards with `handOverToCards` ([Vegetation](vegetation.md)).

## The surface atlas

The second atlas holds what the card's light needs, in the cells of the first: red and green are the octahedral code of the point's normal, blue is the point's depth from the view's front, 0, to its back, 1, and alpha is its coverage. The normal lies in the object's own frame, so a turned copy lights correctly and the cell's own view does not enter it.

`encodeImpostorSurface(normal, depth, coverage, out)` writes those four bytes. `bakeImpostorAtlas` calls it for each texel of each cell. The card reads the depth to place its shadow lookup at the surface it shows. The bake also returns `depth`, the object's widest horizontal extent, which scales that stored depth.

The demo's bake in `examples/impostors/forest.ts` shows the whole loop.

## Merged far geometry

`mergeFarGeometry(parts)` writes copies of a mesh's arrays into the arrays of one mesh, each copy moved by its own transform. It returns `MeshArrays` for `geometry.fromArrays`. Positions and indices are always kept. Attach normals, texture coordinates, colors and tangents when every copy has them. A copy's normals turn by the inverse transpose of its transform, so a stretched copy keeps its shading. Its tangents turn with it, so its normal map lights from the right side. A mirrored copy, such as one scaled by -1 along an axis, gets its triangles' winding reversed and its tangents' sign flipped. So its front faces stay outward.

```ts
import { farCellGroups, mergeFarGeometry } from '@null3d/impostors';

// The arrays that made each mesh's far level, and where each copy sits.
const centers = trees.map((tree) => tree.position);
for (const group of farCellGroups(centers, 64)) {
  const merged = mergeFarGeometry(group.map((i) => ({
    arrays: treeFarArrays,
    transform: place(trees[i]),
  })));
  scene.createMesh({ mesh: geometry.fromArrays(merged), material });
}
```

`farCellGroups(centers, cellSize)` groups copies by the cell of the grid their centers fall in, so each group becomes one mesh. The detailed levels stay for what is near, and the merged far meshes draw as single objects.

## Compared with three.js

three.js has no impostor or merged-far-geometry helper. Its `LOD` picks one whole object by distance, which null3D does with [`mesh.setLevels`](geometry.md). Build the atlases and the merged meshes outside a three.js renderer too, and draw the cards as `InstancedMesh` of one quad with a `ShaderMaterial`, and the merged mesh as a `Mesh`.

## API reference

[The API reference](reference/impostors.md) lists every export of this page with its type and description. The package's doc comments make it.
