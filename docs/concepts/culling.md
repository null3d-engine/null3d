---
id: concepts/culling
title: Culling
status: experimental
since: "0.1"
summary: "Frustum culling on the GPU on WebGPU and on the job workers on WebGL2; grid cells, whole cells out of view skipped first, and positions relative to the camera."
---

# Culling

> Ships in null3D 0.1. The API is experimental, so it can still change between versions.

```mermaid
flowchart LR
    subgraph core["Engine core, each frame"]
        cells["Objects and rows, each<br/>relative to its grid cell"]
        offsets["The offset from the camera<br/>to each cell, in 64-bit floats"]
        boxes["Each cell's box around<br/>its still objects"]
    end
    subgraph test["GPU on WebGPU, job workers on WebGL2"]
        skip["Skip the still objects<br/>of cells out of view"]
        cull["Frustum test of each object<br/>left, relative to the camera"]
    end
    cells --> skip
    offsets --> skip
    boxes --> skip
    skip --> cull
    cull --> draw["Draw the visible<br/>objects and rows"]
```

Culling finds the objects and instance rows in the camera's view, so the GPU draws only those. The engine tests each bounding sphere against the six planes of the view. Every position in the test is relative to the camera, so a scene far from the origin culls and draws as it does near it. When a scene spreads over several grid cells, the engine first skips every still object of the cells out of view. The engine culls each [view](render-graph.md) separately, against that view's camera.

## How each path culls

On WebGPU the GPU culls the scene itself. A compute pass runs one GPU thread per object or instance row. Each thread adds its cell's offset to its bounding sphere and tests the sphere. An object in view joins its group: the objects that share a mesh and a material. The prerecorded draws read how many each group holds. The CPU's cost per frame stays almost flat as the scene grows. When the scene spreads over several grid cells, the pass runs only over the objects of the cells in view and over the moving objects.

On WebGL2 there are no compute shaders, so the job workers cull on the CPU. They test four spheres per SIMD instruction and list the visible objects, 4 bytes each. They test a static instance batch that has stopped changing in groups of 64 nearby rows, one test per group. Each group lies inside one grid cell. The job workers skip the objects and groups of the cells out of view.

[GPU tiers and backends](backends.md) describes each path's draw calls and uploads.

## Grid cells

The engine divides space into cells 1,024 m wide. The origin cell spans 512 m on each side of the origin, so a scene within 512 m of it uses one cell.

- A root object takes the cell that holds its position. Its children take its cell.
- An instance row takes the cell that holds its position.

The engine keeps each world matrix relative to its cell's center, where 32-bit floats are precise to a fraction of a millimeter. Each frame it computes the offset from the camera to each cell in use, in 64-bit floats, and uploads one vector per cell. Each view gets the offsets from its own camera. The GPU adds an object's offset to its position, so every position it sees is relative to the camera. Positions near the camera keep the most precision.

When only the camera moves, static objects keep their data on the GPU, and only the offsets change. A scene inside one cell uploads one vector per frame.

## Skipping cells out of view

Most frames of a large world show a few of its cells. The engine then tests each cell once, and skips every still object in a cell out of view:

- A still object is a static object whose parents are all static, or a row of a static instance batch. Everything else moves: dynamic objects, static objects under a dynamic parent, and the rows of dynamic batches. Each view tests every moving object, as without cells.
- Each cell has a box around the bounding spheres of its still objects. Each view tests the box against its frustum. A cell counts as out of view only when its box lies outside the frustum by more than the rounding of the per-object test. So skipping a cell never drops a still object that the per-object test would keep.
- On WebGPU the engine keeps the still objects in cell order: each cell's are one run of a list on the GPU. Each view's culling pass covers only the runs of its cells in view and the moving objects.
- On WebGL2 the job workers skip the still objects of each cell out of view. A static batch at rest builds its groups of 64 rows inside cells, so it skips whole cells of groups too.
- A still object that changes grows its cell's box. One that moves into another cell rebuilds the cell order, as creating or destroying an object does. Keep objects that cross cells often dynamic.
- On WebGL2, a static batch whose rows change is tested row by row until it rests again. So is a static batch whose rows are spread so thinly over cells that its groups of 64 rows would be mostly empty.

A scene inside one cell has nothing to skip, and culls as it would without cells. The benchmark scene S1-cells spreads 100,000 still boxes over 8 x 8 cells and flies the camera low over them.

## What this means for your sketch

Write world positions as usual, and the engine picks the cells:

```ts
const base = [250_000, 0, -80_000] as const;
const camera = scene.createPerspectiveCamera({
  position: [base[0], 5, base[2] + 12],
  target: base,
});
scene.setActiveCamera(camera);
scene.createMesh({ mesh: geometry.box(), material: stone, position: base });
```

The cells have these limits:

- The engine stores positions as 32-bit floats. It places an object 100 km from the origin to within about 4 mm, and 1,000 km out to within about 3 cm. What it computes from those positions, such as a child's place under its parent, keeps its precision.
- A mesh's vertices are offsets from its object's origin, and they stay 32-bit. Put large coordinates in object positions, never in vertices.
- `getWorldPosition` gives 64-bit numbers. Pass it a plain array or a `Float64Array`, because a `Float32Array` rounds them to 32 bits.
- At most 512 cells hold objects at once. An object in a cell past that stays in the origin cell, where its position keeps only 32-bit precision.

## Related pages

- [GPU tiers and backends](backends.md): how each path draws.
- [Architecture: threads and the frame](architecture.md): where culling runs in a frame.
- [Static and dynamic objects](static-dynamic.md): which objects upload their data each frame.
