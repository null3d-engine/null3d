# D-30: Raycasts and overlap queries over the scene

Status: decided. Date: 2026-10-03. Task: M2-D2.

## Question

D-27 built the trees. This record settles how sketches query them:

1. What a query returns, and where its results go.
2. What an overlap query tests: bounding spheres or triangles.
3. Which box stands for each object and instance row in the scene's trees.
4. When a mesh's tree is built, for meshes that come from the geometry generators and from arrays.
5. Which frame's positions a query sees.
6. How a batch of rays reaches the job workers.

## Rule

- Every raycast gives three.js's `Raycaster` hits on the same scene: the same objects, rows and triangles, at the same distances to 32-bit precision.
- Every query gives the answer of testing every triangle of every object and row in turn, to the bit.
- A query allocates nothing once its lists have grown to the most hits any query found, in TypeScript and in the core.
- A frame without queries costs nothing more.
- A query fails only with an error code that says how to fix the call.

## Data

### Answers against brute force

`crates/null3d-core/tests/queries.rs` builds 10 frames of a scene of objects and two instance batches. Objects are created, destroyed, hidden and moved across cells, some 6,378 km out. One batch is static and moves rows in some frames; the other is dynamic and changes its active rows in every frame. Each frame casts 180 rays and runs 60 overlap queries of each kind, over three layer masks. Every closest distance matches brute force to the bit, every list of every hit matches, and every overlap query finds the same items.

The browser test in `tests/image/raycast.spec.ts` builds the same scene in null3D and in three.js 0.186. It casts 600 seeded rays through both, on WebGPU and WebGL2 and in every thread mode. The scene has every generator shape, mirrored objects, a child of a turned group and double-sided materials. It also has hidden objects, objects on other layers and both kinds of instance batch. A sphere of 70,941 vertices makes WebGL2 store a mesh in several parts. The test allows no difference in hit object, row or triangle. Distances and points may differ by up to 2e-4 of the distance.

### Allocation

The test in `crates/null3d-core/tests/bvh_no_alloc.rs` counts allocator calls on the test thread and four job workers over 57 frames. Each frame moves 5,000 dynamic objects and 3,000 dynamic rows, and syncs the trees. Then it runs 100 rays of each raycast, 200 overlap queries and a batch of 500 rays. The count is 0, and 0 again with no job workers. The first version counted one allocation in frame 36. A ray crossed more objects than any ray before it, so the list of every hit grew once. Lists grow and never shrink, so a sketch reaches its steady state after its largest query. The call `SceneQueries::reserve` gives a test, or the engine, room up front.

## Decision

### Results go into the caller's objects

The call `scene.raycast(origin, direction, options, hit)` writes the closest hit into `hit` and returns true or false. The calls `raycastAll`, `overlapSphere` and `overlapBox` fill the caller's array and return a count. They add hit objects only when the array is too short. The call `raycastBatch` fills typed arrays that the caller passes. In three.js, `intersectObjects` returns a new array of new objects for every ray. A sketch that casts in every frame would pay for them in every frame.

The core writes hit records of 11 numbers into one array of 64-bit floats, which TypeScript reads through a view. A query passes no fraction as an argument: TypeScript writes the ray into an input array first. Chrome's headless build boxes fraction arguments of calls that it does not inline, and the core's calls are never inlined. The hit array moves when it grows, so TypeScript reads its address again only when a query returns more hits than the view holds.

A hit names its object by slot and its batch by id. TypeScript keeps the wrapper of each slot and batch slot, and checks a batch's full id. A slot cannot hold a new object before the frame that applies the old one's destroy. So a slot's wrapper is always the object that the core found.

### Defaults follow three.js

The layer mask defaults to layer 0 alone, as `Raycaster.layers` does. A material's `doubleSided` decides the faces, as three.js's `side` does: front faces only otherwise. Faces are front or back in the object's own space, as three.js tests them, so a mirrored object keeps three.js's answers. `hit.triangle` is three.js's `faceIndex`, and `hit.instance` its `instanceId`. Two choices differ from three.js, and the docs say so:

- Hidden objects are never hit. three.js tests them unless the caller filters them out. The engine already gives hidden objects an empty box.
- `hit.normal` is the triangle's own normal in world space, turned to face the ray's origin. three.js gives the interpolated vertex normal in the object's space. A face normal is what placing a decal or a footstep needs, and it needs no normals in the mesh.

### Overlap queries test triangles

An overlap query finds the objects with a triangle within a sphere, or inside or crossing an axis-aligned box. Testing bounding spheres would be cheaper, but a long wall's sphere reaches far past the wall, so an explosion would hit walls metres away. The trees already reach the few triangles near the volume: the query moves the volume's box into each object's space and walks the mesh tree. The sphere test takes the closest point of each triangle. The box test is Akenine-Möller's separating axis test of 2001. Both run in 64-bit floats in the cell's frame, and treat a triangle with no area as its edges.

A volume entirely inside a closed mesh touches none of its triangles, so it does not find the mesh. Physics engines' mesh colliders behave the same way.

### Boxes come from the mesh

D-27's sync gave each object the box around its world bounding sphere. The trees now take the mesh's own box, moved by the object's world matrix. The sphere is the wrong box for two reasons. A sketch can give an object smaller bounds of its own (`setBounds`), and triangles outside them would then never be hit. And an unculled object has a sphere of radius 10^30, which every ray would visit. The mesh's box is also tighter for long objects. Moving a box costs a matrix product per object, inside the dynamic tree's budget of 0.1 µs per object.

The moved box grows by 2^-20 of its size and position and by 0.24 mm, four float steps at half a cell. A hit found in the mesh's space then lies in the box, so the trees find every hit that brute force finds.

### Instance rows join the trees

Each active row of a batch, as its last update wrote it, is one item. Rows of static batches join the static tree, and rows of dynamic batches the dynamic tree. Their ids count on from the scene's last slot, one run per batch. A batch's version counts its updates that wrote rows, so a sync refits the static tree only when a static batch's rows moved. A new batch, a destroyed batch or a new active count lists every item again.

### Mesh trees build on the first query

The renderer keeps every mesh's vertices and indices in its pages, which it needs again after a GPU loss. Queries read triangles from those pages, so a mesh costs no second copy, only its tree of about 20 bytes per triangle. The first sync after new meshes builds their trees on the job workers, one mesh per job. A sketch that never queries never builds them. Loaded models will bring stored trees, as D-27 says.

### Positions of the last update

A query sees the world output of the last transform update. That is the last frame's output in `onUpdate`, and this frame's in `onLateUpdate`. Batch rows update after `onLateUpdate`, so they are a frame older there. The scene counts its transform updates (`SceneStorage::world_version`). So a query after a late update syncs again, and looks at every object stamped in the frame. The call getWorldPosition reads the same output. three.js's raycaster reads `matrixWorld`, which also changes only when the scene updates.

### Batches of rays

The call `raycastBatch` splits the rays into chunks of 64 across the job workers. Each chunk writes its own rays' results, and the results are the same as one `raycast` per ray. TypeScript copies the rays into the core's ray array, and copies the results out into the caller's arrays. A copy of 10,000 rays costs microseconds, against milliseconds for the rays themselves.

## Consequences

- `crates/null3d-core/src/bvh/query.rs` holds `SceneQueries`. `SceneBvh::sync` takes the batch table and each mesh's box, and `SceneBvh::source` names an item's object or row. `SceneStorage` gained `world_version`, and `InstanceBatch` gained `version`.
- `crates/null3d-render/src/queries.rs` gives the queries each mesh's triangles and each material's faces. `MeshStorage::triangles` reads a mesh's triangles through its parts.
- The WebAssembly entry point adds `queryArrays`, `reserveRays`, `raycast`, `raycastBatch` and `overlap`, and the generated constants add `QUERY_*`.
- `packages/engine/src/scene/queries.ts` holds the calls behind `scene.raycast`, `raycastAny`, `raycastAll`, `raycastBatch`, `overlapSphere` and `overlapBox`, and the types `RaycastHit`, `OverlapHit`, `RaycastOptions`, `QueryOptions` and `RaycastBatchHits`.
- `docs/api/raycast` is experimental. Pointer events on objects (M2-D4), `camera.screenToRay` (M2-D3) and GPU picking (M2-D6) are not built yet. Skinned characters get their capsules with the skinning tasks.
