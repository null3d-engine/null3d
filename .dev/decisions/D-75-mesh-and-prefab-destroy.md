# D-75: Mesh and prefab destroy

Status: decided. Date: 2026-10-05. Task: M2-R21.

Summary: A destroy moves the meshes that stay down over the removed data, so memory stays flat as levels load and drop. Mesh buffers held 1.49 MB after 10 and after 100 rounds, against 19.5 MB without freeing. Removing meshes from 2,000 takes 0.07 ms to 0.3 ms in WebGL2's pages, and 4 ms to 6 ms in WebGPU's shared buffer.

## Question

How do `mesh.destroy()` and `prefab.destroy()` free a mesh whose vertices share GPU buffers with other meshes? And what do they do while objects still use it?

## Rule

- A game that loads and drops the same levels keeps the same GPU memory and the same engine memory, round after round.
- Nothing ever draws freed or reused data. No object, batch, raycast or animator reads a mesh, skeleton or clip after its memory goes to another one.
- The frame loop stays free of allocation, and a destroy costs nothing in frames that destroy nothing.
- A sketch can destroy its objects and then their mesh or model in one callback, as three.js code does before `dispose()`.

## Data

| Measure | Freed meshes packed (chosen) | Meshes not freed | Device and browser |
| --- | --- | --- | --- |
| GPU bytes of meshes after 10 and after 100 rounds of the memory test (a fox, a morphed face and a scene with stored trees, each round loaded, copied, drawn and destroyed) | 1,488,896 and 1,488,896 | 1,488,896 and 19,504,896 | M5 Max, Chrome, WebGPU |
| Texture GPU bytes and WebAssembly memory, round 10 and round 100 | The same at both | Not measured: the run stopped at the mesh bytes | M5 Max, Chrome, WebGPU and WebGL2; SwiftShader |
| The picture of a scene whose plain, morphed and skinned meshes stay after others are destroyed, against the same scene made without them | Identical, every pixel | | M5 Max and SwiftShader, Chrome: WebGPU, compatibility mode, WebGL2 |
| Time of a removal from 2,000 meshes of 1,089 vertices (70 MB of vertices), WebGPU's layout of one shared buffer per format: the first mesh, the first 50 meshes | 4.0 ms and 6.2 ms; 68 MB to 70 MB to upload again | Nothing moves or uploads | M5 Max, native release build |
| The same removals, WebGL2's layout of pages of 65,535 vertices | 0.3 ms and 0.07 ms; 2.1 MB and 0.35 MB to upload again | Nothing moves or uploads | M5 Max, native release build |

How the data was produced: `tests/image/destroy-memory.spec.ts` and `tests/image/destroy.spec.ts` on 2026-10-05, on the Mac's GPU and with `CI=1` on SwiftShader. The "not freed" column is the memory test with `prefab.destroy()` changed to skip the meshes for one run. The removal times come from the `removal_timings` test of `crates/null3d-render/src/meshes.rs` in a release build, on 2026-10-06. Other work shared the Mac, with its load between 6 and 20, so the times are rough. On WebGL2 the pages bound the cost: a removal moves only the meshes after it in its own page. In the shared buffer, every mesh after the removed one moves, so destroys belong between levels.

## Options

1. Pack: a removal moves the data of the meshes that stay down over the removed data. It does so in each page and in each list: parts, edge lists, joint spheres, reaches and morph delta texels. Later morphed meshes get their vertices' first delta texel rewritten. The GPU copies upload again from where each page and the delta texture first changed. Memory never fragments, and the buffers keep their size for the next meshes.
2. Free lists inside the pages: a removed mesh's vertex and index ranges wait for a later mesh that fits them. Nothing moves, but mixed sizes fragment the pages, and edge lists and morph texels need lists of their own.
3. Free a page only when all its meshes go. Simple, but one mesh that stays holds a whole page. So memory grows whenever a level shares a page with meshes that stay.

## Decision

Option 1. It is the only option that meets the first rule for any order of loads and destroys. Its cost is an upload of the meshes that follow the removed ones in the same page, once, in the frame after the destroy. Destroys happen between levels, so the docs say to destroy meshes between levels, not in every frame. Other choices:

- Refuse, not defer. `destroy` throws E1111 while a live object or batch uses the mesh. A prefab refuses while one uses any of its meshes or materials, or while an animator uses its skeleton. Freeing later, when the last user goes, would hide the mistake. A reused id could then draw under an object that the sketch forgot. The scene finds users through its index of live objects and batches. So the check needs no counts that every create and destroy path must keep right. A batch remembers the meshes and materials it draws for this.
- The core packs the storage in the destroy call itself, so the frame loop never moves mesh data. A prefab's meshes go in one call, so the meshes that stay move once. The ids wait for the next frame's start, after the frame applies its commands. So an object destroyed earlier in the same callback is gone by then. The core checks again there: an id that a created object or a live batch still names waits for a later frame. An object that a failed create left without a wrapper then draws nothing, never another mesh.
- Removed mesh ids go to the next meshes, lowest first. A reused id gets its query tree again at the next sync: built, or the tree that its file stored. The software occlusion blockers of removed meshes go too, and their places go to later blockers.
- A part goes to the first page of its format with room, not only to the last page. So later meshes use the room that removed meshes leave.
- A failed mesh build takes out the parts that it placed, at the ends of their pages. So a failed load leaks no vertex data.
- A prefab frees every mesh and material that its load made, with the material variants that primitives need, and its textures. It frees its skeleton with its clips, their additive versions, their events and its joint masks. Meshes, materials and textures that the sketch destroyed itself are skipped. Removed skeleton, clip and mask ids go to later ones. Each job worker's scratch memory shrinks to the largest skeleton left. Clips that job workers still resample for the skeleton are dropped with it.
- three.js's `dispose()` keeps an object usable and uploads it again on the next render. null3D's `destroy` ends the mesh or model, and later calls throw E1101, as for every other destroyed object.

## Consequences

- Engine: `MeshGeometry.destroy`, `Prefab.destroy`, `geometry.memoryBytes`, error E1111. A failed glTF load also frees its meshes and its rig.
- Core: `MeshStorage::remove`, `FrameBuilder::remove_meshes`, `SceneQueries::forget_meshes`, `Occluders::forget`, `Animations::remove_skeleton`, and the glue calls `destroyMeshes`, `destroySkeleton` and `meshMemoryBytes`.
- Docs: `api/geometry` (Destroying a mesh), `api/assets` (Freeing a model), `concepts/assets`, E1111, the `dispose` mapping entry. Skills: the develop skill's quick reference and performance notes.
