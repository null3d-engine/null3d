# D-228: Staged levels of detail, coarse first

Status: accepted. The owner approved the staged load and the automatic skip of a level that never draws on 24 October 2026. Built on the M3-L4 branch: whole levels download as stages, and the cluster patch groups' share of the layout is fixed but not yet read. Date: 23 October 2026. Task: M3-L4.

Summary: A model's levels of detail can download apart from the model, so the coarsest level draws at once and each finer level replaces the triangles that the one before it drew as it arrives. The asset tool writes it with `--stages`: the file keeps the mesh's full vertex stream and its coarsest level, and each finer level goes into a file of its own beside it. Each node's extras name its stages, with the error of each level, as `NULL3D_stages`. The engine downloads them from the coarsest down and draws each as it arrives, without a new object: the copies that already draw the mesh refine in place. A loader option caps the levels that a page downloads, and the engine drops a stage whose level the camera never picks, so a page whose camera never shows the finest level downloads less. One stage layout carries whole levels and, later, a cluster tree's patch groups.

## Question

A model's levels of detail make it cheap to draw far away. They also make its file big: the finest level is most of the geometry, and a page waits for all of it before it draws anything. How does a page draw a model at once, with the coarse shape it needs at that distance, and get the finer levels while it draws? Which files hold the levels, how does the loader apply them to copies that already exist, and how does a page on a phone skip a level that it never shows?

## Rule

- Speed first: a page draws its first picture sooner, and a stage that never shows costs no download.
- One file layout serves whole levels and the cluster patch groups that M3-L3 builds.
- The file stays a valid glTF model that other readers draw, at the detail it holds.
- A stage costs indices alone where the levels share the mesh's vertices.
- No new object, no flicker: the copies that a page already made refine in place.
- Hard rule 1: no allocation per frame. A stage arrives at load time, which no frame waits for.

## Options

### Where the levels go

| Option | Verdict |
| --- | --- |
| A: the model file holds the full vertices and the coarsest level; each finer level is a binary stage file beside it | Chosen |
| B: a separate glTF file for each level, loaded with `loadGltf` | Rejected. Each file parses in the worker and builds its own meshes, materials and textures, and only the stage's indices are new |
| C: all levels in the model file, as `MSFT_lod` gives them | Rejected. This is the state before the change: the page waits for the finest level, which is most of the file |
| D: an external buffer per level, named by the file's buffer views | Rejected. The loader downloads every external buffer before it parses, so the coarse level would still wait for the finest |

### How an arriving level replaces the one on screen

| Option | Verdict |
| --- | --- |
| A: the mesh takes the finer triangles in place, and the level it drew becomes a level of the mesh | Chosen |
| B: the copy swaps its mesh for a new one when a stage arrives | Rejected. Objects name a mesh by its id, so every copy of the model at every place in the scene would change |
| C: the page waits for every stage and instantiates once | Rejected. That is the wait this change removes |

Option A needs one engine call that the public API does not offer: `MeshStorage::replace_indices` gives a live mesh another triangle list in the same vertex stream, and the next frame uploads it. The old list stays in the mesh's page until the mesh goes, so a mesh that takes a whole chain holds about one more list than its finest. The call is internal: a level that arrives is engine work, not a sketch's.

## Data

The model is the cluster test's heightfield of 32,768 triangles, optimized with `--lod --stages` (`packages/cli/src/assets/staged-fixture.ts`).

| Measure | Value |
| --- | --- |
| The model file, which draws the coarsest level | 69,880 bytes |
| The same model with every level in the file (`--lod`) | 559,672 bytes |
| Stage files | 6 files, 6,168 to 196,632 bytes each, 387,216 bytes in all |
| The bytes that arrive after the first picture | 85% of the staged model's bytes |
| The finest stage, the full mesh's 32,768 triangles | 196,632 bytes, of which 98,304 indices at 2 bytes |
| Browser test `staged-levels`, first picture against the last | Passes on SwiftShader under `CI=1` and on the Mac's GPU, on all three tiers. The stage files arrive, the mesh carries every level, and more than 1% of the pixels change, with the ground over more than 40% of the picture. The first picture is the file's own level: a load with the limit of 1, which takes no stage, draws the same picture |
| The same with `maxLevels: 1` | Passes: the page requests no stage file, the mesh keeps no level, and the two pictures are equal within 0.1% of their pixels |

How the data was produced: `bun packages/cli/src/assets/staged-fixture.ts`, which prints each file's size. The browser test runs with `bun run test:browser -- image/staged-levels.spec.ts`, and with `CI=1` for the software GPU's set: four tests, three tiers and the level limit.

## Decision

1. `--lod --stages` writes a model whose file holds the full vertex stream and the coarsest level. Each finer level becomes a stage file named after the model, `<model>.m<mesh>.lod<k>.bin`, from the next coarsest down to the finest. The last stage holds the mesh itself, exact, so the finest picture is the full mesh rather than its first simplification. A mesh whose levels hold positions of their own, such as a level of cards, and a mesh with one level, keep their levels in the file as `MSFT_lod` gives them.
2. A stage file is words, little-endian: the magic `N3DS` as a 32-bit word, the layout's version, the kind, the number of lists, then for each list its index count, the number of bytes of each index (2 or 4), and its indices, padded to a whole word. Kind 0 holds whole levels, one list for each of a mesh's primitives. Kind 1, which the tool does not write yet, holds a cluster tree's patch group: its patch bounds, records and indices, from the coarsest group down. The loader reads a kind it knows and leaves the model at the level it has for any other.
3. Each node that draws a staged mesh names its stages in its extras as `NULL3D_stages`: the error of the level that the file holds, then each stage's address, its length in bytes and the error of the level it holds. The loader downloads a node's stages one at a time, from the coarsest down.
4. When a stage arrives, the loader makes the level that the mesh draws into a level of the mesh, replaces the mesh's triangles with the stage's, and sets the mesh's levels with the arriving one first. The base mesh is always the finest level loaded so far, and each level's switch is its measured error, so every copy of the model picks by distance with no code.
5. `assets.loadGltf` takes `maxLevels`, the most levels to load, counting the file's own. A page whose objects never come close enough to show the finest level gives 1, or the number of levels that show, and downloads no stage. The default loads every stage.
6. A stage that fails to download, or that a mesh cannot take, leaves the model at the level it had and warns in development builds. A load never fails because a stage did.

## Alternatives rejected

- Waiting for the coarsest level as a separate first file: the model file must hold the vertices anyway, so the coarse level costs it almost nothing, and one download is fewer round trips than two.
- A public API for replacing a mesh's triangles: a sketch has no use for it, and the API freeze would carry it. The level chain and `setLevels` stay the documented way.
- Deciding the device class from the user agent or the GPU name (hard rule 14): the levels that a camera shows follow from its distances, which the page knows and the engine does not.

## Consequences

- The loader (`packages/engine/src/scene/gltf.ts`) downloads stages after `loadGltf` returns. `prefab.destroy()` stops them, and frees every level that arrived.
- The engine core gains `replace_indices`, an internal call. A mesh with an edge list, morph targets, a split part or a level of its own refuses it, and its stages stop.
- The `--stages` option needs `--lod`. The tool's report does not list the stage files' bytes yet.
- The Vite plugin's `assets` option passes `stages` too: it writes the stage files into the model's cache folder, lists them by reading `NULL3D_stages` back from the model, and serves and emits them beside it. So a project that imports an optimized model gets the same chain that a page loads by address.
- Reader-facing docs: [Levels of detail](../../docs/concepts/lod.md), [The asset pipeline](../../docs/guides/assets-pipeline.md#levels-as-separate-downloads) and [Assets](../../docs/api/assets.md). The develop skill's quick reference shows `maxLevels`.
- A commit that changes `NULL3D_stages` must change the engine's reader and the tool's writer together; the format's version word guards the pair.

## Addendum, 24 October 2026: a stage that never draws costs no download

The loader now skips a stage that the camera would never show, so a phone at Low does not download levels that it cannot pick.

- The engine counts, for each mesh, the levels that the views picked. The count sits where the level is already picked. The GPU path counts copies in `gpu_driven/copies.rs`, and the camera view's culling output counts entries in `cpu_culled/cull.rs`. A bucket with at least one source marks its level. The counter reads each level's bucket once, and costs nothing while no loader waits (`StageWatches` in `crates/null3d-render/src/levels.rs`).
- A level whose coarser neighbour was never picked cannot be picked either. Switch distances grow from level to level. So the loader fetches the stage after the file's own level at once. It holds each later stage until the level that the mesh draws now was picked at least once.
- A warm-up of 120 frames decides a held stage. That is about two seconds at 60 frames a second, so a camera that starts far away can show the coarse level. When the warm-up passes with no pick, the loader drops that stage and every finer one. The switch point follows the camera and the preset, so it names no device (hard rule 14).
- The warm-up counts only the frames that drew the mesh. A page may load a model long before it instantiates it. A frame with no source of the mesh restarts the warm-up rather than spending it. A page that never draws the model downloads no stage after the first.
- The engine calls are `watchStageLevels(mesh)`, `stageLevelPicks(mesh)` and `stageFrames(mesh)`. The loader polls every 100 ms, which runs at load time only. No frame waits, and no frame allocates.
- The browser test `staged-levels` takes `?far`, which stands the camera beyond every switch of the staged model. The far page asks for one stage file and keeps one level. It draws the same picture before and after that stage. The near page asks for every stage. The test runs on WebGPU and WebGL2, so both counting paths are checked.
- The cost is that a page which reaches a hero object within the warm-up draws the level above it until the next stage lands. `maxLevels` stays as the exact limit for a page that knows its camera.

