---
id: concepts/culling
title: Culling
status: experimental
since: "0.1"
summary: "Frustum culling on the GPU on WebGPU, or on the job workers there when the device draws directly, and on the job workers on WebGL2; grid cells, whole cells out of view skipped first, positions relative to the camera, and occlusion culling: behind large opaque objects that the GPU picks on WebGPU, and behind marked blockers on WebGL2."
---

# Culling

> Roadmap step 0.1, first released in null3D 0.1.0. Step 0.2 adds occlusion culling. The API is experimental, so it can still change between versions.

```mermaid
flowchart LR
    subgraph core["Engine core, each frame"]
        cells["Objects and rows, each<br/>relative to its grid cell"]
        offsets["The offset from the camera<br/>to each cell, in 64-bit floats"]
        boxes["Each cell's box around<br/>its still objects"]
    end
    subgraph test["GPU on WebGPU, job workers on WebGL2<br/>and on a device that draws directly"]
        skip["Skip the still objects<br/>of cells out of view"]
        cull["Frustum test of each object<br/>left, relative to the camera"]
    end
    cells --> skip
    offsets --> skip
    boxes --> skip
    skip --> cull
    cull --> occlude["Skip what lies behind<br/>large opaque objects"]
    occlude --> draw["Draw the visible<br/>objects and rows"]
```

Culling finds the objects and instance rows in the camera's view, so the GPU draws only those. Occlusion culling also skips the objects that others hide. The engine tests each bounding sphere against the six planes of the view. Every position in the test is relative to the camera, so a scene far from the origin culls and draws as it does near it. When a scene spreads over several grid cells, the engine first skips every still object of the cells out of view. The engine culls each [view](render-graph.md) separately, against that view's camera. A view is the camera's, a shadow cascade's, a shadow tile's, a [scene pass](../api/render.md)'s, or one that [`scene.createView`](../api/scene.md#multiple-views) draws into a rectangle of the canvas.

## How each path culls

On WebGPU the GPU culls the scene itself. A compute pass runs one GPU thread per object or instance row. Each thread adds its cell's offset to its bounding sphere and tests the sphere. An object in view joins its group: the objects that share a mesh and a material. The prerecorded draws read how many each group holds. The CPU's cost per frame stays almost flat as the scene grows. When the scene spreads over several grid cells, the pass runs only over the objects of the cells in view and over the moving objects.

On an Apple GPU in Safari, or in any browser on iPhone and iPad, a start-up measurement can find direct draws clearly faster. The job workers then cull on the CPU instead. They use the WebGL2 culling on the WebGPU layout's own buckets. Each bucket then draws with its known count. The probe takes the direct path only when that path measures at least 25% faster and at least 0.15 ms a frame faster. Other devices skip the measurement and cull on the GPU. `engine.capabilities.directDraws` says which path the device took, and `engine.capabilities.drawPath` says why. The [Performance guide](../guides/performance.md#how-the-engine-batches-builds-pipelines-and-times-frames) explains how the engine batches.

On WebGL2 there are no compute shaders, so the job workers cull on the CPU. They test four spheres per SIMD instruction and list the visible objects, 4 bytes each. They test a static instance batch that has stopped changing in groups of 64 nearby rows, one test per group. Each group lies inside one grid cell. The job workers skip the objects and groups of the cells out of view.

[GPU tiers and backends](backends.md) describes each path's draw calls and uploads.

## What each kind of object culls with

- An object culls with its mesh's bounding sphere, or with the sphere that `setBounds` gives it ([Bounds that you set](#bounds-that-you-set)).
- A skinned mesh culls with bounds that follow its pose, so a character's raised arm stays in view.
- A morphed mesh culls with a sphere that its weights grow: each target's longest move, times its weight.
- Sprites, points and line segments cull as instance rows do, one sphere each. Sprites and points sized in CSS pixels, with `sizeAttenuation: false`, never cull, because their size in the world grows with their distance.

## GPU occlusion culling on WebGPU

The frustum test keeps every object in view, even one that a wall hides. On WebGPU, large opaque objects hide the objects behind them, and the GPU skips those. You mark nothing: the GPU picks the objects that hide others itself, among every opaque object and instance row. The GPU works in two phases in each frame, for each camera:

```mermaid
flowchart LR
    early["Phase 1: keep the large opaque objects<br/>that showed last frame"] --> first["Draw their depth"]
    first --> pyramid["Build a depth pyramid<br/>from that depth"]
    pyramid --> late["Phase 2: test every object<br/>in view against the pyramid"]
    late --> second["Draw the ones that show"]
```

1. The first phase keeps the opaque objects and instance rows in view that showed in the camera's last frame and look large on the screen. The bounds of such an object span at least a sixteenth of the render size's longer side. The GPU draws their depth alone, into a depth target of its own.
2. A compute pass builds a depth pyramid from that depth. Each level holds the farthest depth of each 2 x 2 square of the level below it.
3. The second phase tests each object in view against the pyramid. An object whose bounding sphere lies wholly behind the depth that the pyramid holds under it is hidden. The GPU notes which objects show, for the next frame.
4. The depth prepass, where it runs, and the opaque pass draw the objects that show, as they do without occlusion culling.

The pyramid holds the depth of objects drawn in this frame, at the detail that they draw at, so no object that shows can hide behind it. The image matches the image without occlusion culling. When the camera turns fast, the first phase keeps the wrong objects, so fewer objects hide, but none shows a frame late.

### Which objects hide others

- Every opaque mesh and every row of an instance batch may hide others, when it showed last frame and looks large. Walls, buildings, hills and the ground hide what lies behind them without a mark.
- A custom material that moves its vertices hides others with its own vertex shader, so a hill that the terrain add-on raises hides what lies behind the hill.
- Objects that blend, cut holes with an alpha mask or skip the depth buffer hide nothing.
- `setOccluder(false)`, or the `occluder: false` option of `createMesh` and `instantiate`, keeps an object from hiding others. An instance batch takes `occluder: false` too, and `setOccluder(false)` on the batch. Use it for an object whose depth costs more to draw than it hides, such as a large mesh of many triangles that hides little. `setOccluder(true)` makes an object a blocker on WebGL2 too ([below](#software-occlusion-culling-on-webgl2)).

### The check during play

The extra passes cost GPU time: a depth draw of the occluders, a depth pyramid and a second culling pass. Another program's work on the GPU can also run in the gaps between them, so a frame with them can take longer although it draws less. So the engine checks during play whether they pay:

- The second phase counts the objects in view that would draw and those that the pyramid hid. A frame copies the counts, and the GPU sends them back a few frames later. Nothing waits for them.
- About every 120 frames, the engine runs a few frames the other way: without the passes while they run, or with them while they do not. It compares the GPU's frame times, from each frame's submit to its completion, with the frames just before.
- The passes stay on while they hide at least a tenth of the objects that would draw, and a frame with them takes no longer than one without, within 2%. Otherwise they stay off until a later check finds that they pay.
- The occluders' pass draws only the groups of objects that held occluders in the last few checks, so it draws nothing for the rest.
- While the view holds still, the check pauses: the passes stay as they are and nothing is copied, so the still-camera accumulation finishes and the view rests. It starts again a little after the view moves.

`engine.measure` reports the objects that the culling hid as `occludedEntries`: the count of the newest frame whose counts came back, and 0 while the check keeps the passes off. The `?occlusion-check=off` switch keeps the passes on in every frame, for a test that compares the image with culling and without it.

### Where it runs

- High and Ultra turn it on for desktops. Phones and tablets keep it off on every preset, unless the page asks for it: several mobile GPU drivers fail at GPU culling in other engines.
- The `gpuOcclusion` option of `createEngine` replaces the preset's choice, and the `?occlusion=on` and `?occlusion=off` switches win over the option. It is fixed while the engine runs. Compare the scene's `gpuMs` with each switch to see what it saves.
- It runs on WebGPU, in compatibility mode too, with or without the depth prepass. Shadow cascades, shadow tiles and scene passes cull with the frustum test alone. See-through objects draw from the sorted list of the transparent pass, and hide nothing.
- Its shaders download the first time the scene holds an object that may hide others. Until they are built, each camera culls once, as without occlusion culling. A game that must fetch nothing during play lists `'occlusion'` in `createEngine`'s `preload` ([loading screens](../guides/loading-screens.md#loading-everything-up-front)).
- An object hides only behind the occluders that the first phase kept. An occluder that comes into view hides others from the next frame on. A hidden object costs two culling tests, and no draw.

```ts
// High and Ultra cull hidden objects on desktops. Keep a large, detailed sculpture out of the
// occluders, as its depth costs more than it hides.
scene.createMesh({ mesh: sculpture, material: bronze, position: [0, 0, -8], occluder: false });
```

## Bounds that you set

By default, culling tests an object's mesh sphere: the sphere around the center of the box that holds every vertex of its mesh. `mesh.center` and `mesh.radius` give it in the mesh's own space. The object's scale grows it, and its rotation turns it. A shader that moves vertices, such as waves on water, can move them outside that sphere. Culling then hides the object while parts of it are still in view. Two mesh calls change what culling tests:

- `setBounds(center, radius)` gives the object a sphere of its own, with its center relative to the object's origin. Bounds that cover the moved vertices keep culling at work.
- `setFrustumCulled(false)` turns culling off for the object, so the engine draws it wherever it is.

```ts
// Waves lift the water's vertices by up to 2 m. A sphere 1 m higher and 1 m wider than the
// mesh's sphere holds every lifted vertex.
const [x, y, z] = waterMesh.center;
water.setBounds([x, y + 1, z], waterMesh.radius + 1);
```

Both calls rebuild the draw tables, so make them at setup. On WebGPU, each object with a sphere of its own draws from a group of its own, as the GPU tests one sphere per group. Skinned objects without morph targets are the exception: copies of one mesh and material share a group, whose sphere holds every copy's. On WebGL2, the job workers test each object's own sphere and the cost stays the same.

## Software occlusion culling on WebGL2

Frustum culling keeps everything in the view, even what a building hides. On WebGL2, objects that you mark as blockers hide the objects behind them, so the GPU skips those too:

```ts
// Buildings block the view from the street; the props behind them skip the GPU.
for (const lot of lots) {
  scene.createMesh({ mesh: building, material: walls, position: lot.position, occluder: true });
}
// Or mark an object later.
tower.setOccluder(true);
```

Each frame, the job workers draw the blockers in the camera's view, nearest first, into a small depth buffer of about 256 x 144 pixels. Then each object that passed the frustum test is tested against it. An object whose bounding sphere lies wholly behind the blockers is not drawn. The job workers test four spheres at a time, with SIMD.

- The buffer never hides an object that a finer depth buffer would show. A pixel counts as covered only when the blocker covers its whole square, and its depth is the blocker's farthest depth there. An object that shows through a gap, beside an edge or above a roof still draws.
- It uses the frame's own camera and positions, so a hidden object shows in the same frame that it comes into view.
- A blocker draws its own mesh, up to 4,096 triangles. The frame draws up to 16,384 blocker triangles, nearest first. The frame skips a blocker whose radius is under 2 pixels of the buffer.
- A blocker mesh splits into its connected parts: triangles that share corners. Each part takes its place by the nearest point of its own bounding sphere. Say one mesh holds all the buildings of one material across a city. It blocks with its near buildings first, and its far ones wait behind nearer blockers. The frame that first draws a mesh draws it whole, and splits it for later frames. The 4,096-triangle limit counts the whole mesh.
- Mark large, solid objects that hide much of the scene: buildings, walls and hills. A blocker that hides little costs time and saves none.
- Objects that blend, cut holes with an alpha mask, skip the depth buffer, use a custom material or are skinned never block. Their drawn shape can have gaps that the mesh does not show.
- Only the active camera's view uses blockers. Shadow cascades, shadow tiles and other views cull as before, so a hidden object still casts its shadow.
- A blocker must lie inside what its object draws. An object's own mesh does.

### Blockers from the asset tool

`assets optimize` gives a blocker to each mesh of a model that encloses space. The blocker is one or two boxes inside the mesh, joined into one closed surface of a few dozen triangles at most. The tool checks each blocker against the mesh, and drops one that would show outside it. A copy of the model then blocks with those meshes. Each draws its blocker in place of its mesh, so a building of thousands of triangles blocks for the cost of a few dozen:

```ts
// city.glb came from assets optimize, so its buildings block on WebGL2.
const city = await assets.loadGltf('/models/city.glb');
scene.instantiate(city);
// Or keep a copy's meshes from blocking.
scene.instantiate(city, { occluder: false });
```

`setOccluder` changes an object afterwards. [The asset pipeline](../guides/assets-pipeline.md#blockers-and-stored-trees) says which meshes get blockers.

### Turn it on where it pays

Every quality preset leaves software occlusion culling off. The engine measured it in S6, its benchmark city, on three Android phones and an iPad, all on WebGL2. It hid 23% to 39% of the entries in view, but removed fewer than 3% of the draw calls. Most hidden entries were rows of instance batches whose other rows still showed, so the batch still drew. The job workers spent 7 to 22 ms more per frame, and the render worker saved 2.3 ms at most. On every device, it cost at least 3.5 times what it saved.

A scene whose few large blockers hide many separate meshes, each its own draw call, can gain where the city lost. So turn it on only when your scene measures a gain:

```ts
const engine = await createEngine({ canvas, sketch, softwareOcclusion: true });
```

- Compare the page with `?occlusion=on` and with `?occlusion=off` on your slowest WebGL2 device. The switch wins over the option. Keep the culling only where the frame takes less time with it on.
- `engine.measure` reports the entries that it hid as `occludedEntries`, beside `visibleEntries`. The `?stats` overlay shows each thread's CPU time ([Debug drawing and stats](../api/debug.md#stats-overlay-and-frame-figures)).
- The `softwareOcclusion` quality setting turns it on and off during play, with `quality.set`.
- The `?occlusion-buffer=384x216` switch gives the buffer about that many pixels, to measure a larger buffer against the default.

WebGPU picks its occluders itself for its own [occlusion culling on the GPU](#gpu-occlusion-culling-on-webgpu), which the `gpuOcclusion` setting turns on, and ignores the `softwareOcclusion` setting. There, `setOccluder(false)` keeps an object out of them.

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
- `getWorldPosition` and `getWorldMatrix` give 64-bit positions. Pass them a plain array or a `Float64Array`, because a `Float32Array` rounds them to 32 bits.
- At most 512 cells hold objects at once. An object in a cell past that stays in the origin cell, where its position keeps only 32-bit precision. The engine then warns once in the console.

For a world the size of a planet, `createEngine`'s `largeWorld` option keeps every position that you set exact. A batch's `origin` option keeps its rows precise far from the origin. [Large worlds and precision](large-worlds.md) explains both.

## Related pages

- [GPU tiers and backends](backends.md): how each path draws.
- [Architecture: threads and the frame](architecture.md): where culling runs in a frame.
- [Static and dynamic objects](static-dynamic.md): which objects upload their data each frame.
- [Large worlds and precision](large-worlds.md): `largeWorld` mode and batch origins.
- [The demo far from the origin](https://github.com/null3d-engine/null3d/tree/main/examples/far-from-origin): keys 2 cm wide, 1,000 km from the origin, seen from 40 cm.
