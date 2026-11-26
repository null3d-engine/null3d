# Impostors for null3D

`@null3d/impostors` draws many far copies of a detailed model in a
[null3D](https://github.com/null3d-engine/null3d) scene, such as the trees of a forest. A far copy
covers few pixels, so its triangles cost work that no one sees. The package cuts that work in two
ways.

An impostor card stands in for the model far away. A bake draws the model from many directions
ahead of time, into two pictures called atlases. One holds the color of each view. The other holds
each point's normal, depth and coverage. Far away, each copy draws as one flat card that faces the
camera. The card blends the three stored views nearest the camera. The scene's lights fall on the
stored normals, so the cards follow a moving sun. All the cards draw in one instance batch.

The second way merges far geometry: `mergeFarGeometry` writes many copies of a mesh into the
arrays of one mesh. So a whole grid cell of trees draws in one draw. A scene can use both:
level-of-detail meshes near, merged cells in the middle and cards far out. Both draw on WebGPU and
WebGL2.

## Install

```sh
bun add @null3d/impostors @null3d/engine
```

## Use

```ts
import { defineSketch } from '@null3d/engine';
import { bakeImpostorAtlas, createImpostors, octahedralAtlas } from '@null3d/impostors';

export default defineSketch((ctx) => {
  const { scene, textures } = ctx;
  const camera = scene.createPerspectiveCamera({ position: [0, 30, 320], target: [0, 0, 0] });
  scene.setActiveCamera(camera);
  scene.createDirectionalLight({ direction: [-0.4, -1, -0.3], intensity: 3 });
  scene.createAmbientLight({ intensity: 0.4 });

  // The model: a cone of eight sides, 6 m tall, with a color at each vertex.
  const cone = { positions: [0, 6, 0], colors: [0.1, 0.35, 0.12], indices: [] as number[] };
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    cone.positions.push(Math.cos(angle) * 1.5, 0, Math.sin(angle) * 1.5);
    cone.colors.push(0.05, 0.2, 0.06);
    cone.indices.push(0, 1 + ((i + 1) % 8), 1 + i);
  }

  // 64 views of the model, 64 texels on each side of a view.
  const bake = bakeImpostorAtlas({
    atlas: octahedralAtlas(64),
    texels: 64,
    parts: [cone],
    min: [-1.5, 0, -1.5],
    max: [1.5, 6, 1.5],
  });
  const picture = (image: typeof bake.color, colorSpace: 'srgb' | 'linear') =>
    textures.fromData({ ...image, colorSpace, wrap: 'clamp', mipmaps: false });

  // 10,000 cards on a grid 4 m apart, each turned its own way.
  const positions = new Float32Array(10_000 * 3);
  const turn = new Float32Array(10_000);
  for (let i = 0; i < 10_000; i++) {
    positions.set([(i % 100) * 4 - 200, 0, Math.floor(i / 100) * 4 - 200], i * 3);
    turn[i] = i * 2.4;
  }
  const trees = createImpostors(ctx, {
    color: picture(bake.color, 'srgb'),
    surface: picture(bake.surface, 'linear'),
    atlas: bake.atlas,
    positions,
    turn,
    size: bake.size,
    room: bake.room,
    depth: bake.depth,
  });
});
```

The cards need no call in each frame. Their material reads the eye from the frame's camera, so a
moving camera writes nothing on the CPU. The cards are a static batch: after you change cards
through `trees.batch`, call `trees.markDirty(start, count)` for them.

## Hand over from meshes to cards

Put the same trees in an instance batch of the detailed mesh, in the same order, places and turns
as the cards. Then call `handOverToCards(meshes, trees.batch, 300)` once at setup. The meshes draw
up to 300 m and the cards start just before that. Each band's edge fades with a dither, and the two
fades never overlap. So the sky never shows through a crown as a tree changes to its card.

## Merged far geometry

`farCellGroups(centers, 64)` sorts copies into cells of 64 m. For each cell, `mergeFarGeometry`
takes each copy's arrays and its matrix, and returns the arrays of one mesh. Make that mesh with
`geometry.fromArrays` and draw it as any other.

The merge carries normals, texture coordinates, colors and tangents when every copy has them. A
turned, stretched or mirrored copy keeps its shading and its outward faces.

## Costs and limits

- `trees.setViews(1)` draws each card from its nearest view alone. That reads each atlas once
  instead of three times, but the card hops from view to view as the camera turns.
- A card casts a shadow only with `castShadows: true`, and the shadow takes the model's shape. A
  card that receives shadows takes them from the shadow map alone, because contact shadows would
  treat the flat card as a solid wall.
- The bake runs on the CPU, so it gives the same atlases on every device. An atlas holds at most
  4,096 texels on a side.
- A merged cell plans no levels of detail of its own, because it already draws a far level.

## Docs

The [impostors docs page](https://github.com/null3d-engine/null3d/blob/generated/docs/api/impostors.md)
explains the atlases, the bake, the hand-over and the shadows.

## License

Licensed under either of the Apache License 2.0 or the MIT license, at your option.
