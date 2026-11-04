# D-285: Where the splats add-on's per-frame work runs in Rust

Status: decided and built. Task: M3-F2. The splats add-on selects the chunks that draw in its own WebAssembly module on the engine's job workers. It packs the chosen rows in the core's memory through a public hook on the instance batch.

Summary: The splats add-on chose each chunk's detail level and sorted the chunks by distance in TypeScript. It packed the chosen rows into the instance batch on the sketch thread. Hard rule 42 puts both loops in Rust. The selection moves into a crate of the add-on's own, as the terrain's selection did ([D-279](D-279-terrain-rust-home.md)). The pack cannot move there. The batch's rows live in the core's memory, so the core packs them. The add-on reaches that pack through a public hook that any add-on could use.

## Question

Where do the splats add-on's two per-frame loops run in Rust? The loops are the chunk selection with its distance sort, and the packing of the chosen rows into the instance batch.

## Rule

Hard rule 42 puts every per-frame loop over objects, instances, vertices, pixels or draw-list commands in `crates/`. TypeScript starts the frame, reads settings and makes the browser's own calls. An add-on ships its frame loop as WebAssembly through the task hook. Rule 12 says an add-on reaches the engine only through public entry points. A hook built for one add-on must let another developer build the same add-on. Rule 11 says each feature lives in the core or in one add-on, never both.

## Data

The selection in `packages/splats/src/select-task.ts` walked every chunk and computed its distance. It sorted the chunk indices with `Array.prototype.sort` and ran two budget passes. The chunk table is small, at one row for each chunk of the cloud. The add-on already ran the selection as a task on a job worker, but the loop was TypeScript.

The pack in `packages/splats/src/pack.ts` copied each chunk's chosen prefix into the batch's four row arrays. At the High preset a WebGPU page draws 500,000 splats. A row takes 56 bytes, so one moved frame copies up to 28 MB through the sketch's heap. The batch's rows are `Vec<f32>` fields of the core's `InstanceBatch`, which the render worker reads.

The batch rows therefore have a Rust home already: the core. The chunk data did not, because it arrived as JavaScript `Float32Array`s from the SPZ reader.

## Options

| Option | For | Against |
| --- | --- | --- |
| (a) Both loops in an add-on wasm module | One crate, no new public API, nothing on the start path | The pack would still copy the rows back through a message, because the batch's rows are not in the add-on module's memory |
| (b) Both loops in the core behind one public hook | The pack reads and writes the core's own rows, with no second copy | A splat-shaped call on the frozen engine surface, used by one consumer, and its code joins every page's start |
| (c) The selection in an add-on module, the pack in the core behind a public hook that stores chunked rows | Each loop runs where its data already lives | A new public hook, and the chunk data is stored once in the core's memory |

## Decision

Option (c). The selection keeps the shape that the terrain's selection has. It is a crate of the add-on's own, run on the job workers through the existing task hook. The pack moves into the core, beside the batch rows.

The hook is general on purpose. `InstanceBatch.createChunkRows()` makes a `ChunkRowWriter` that any add-on can use. It suits rows that arrive in chunks. The writer stores each chunk once at load. It then packs the chosen prefix of each chunk into the batch's rows in the core's memory. It names no splat. The chunk store is `crates/null3d-core/src/chunk_rows.rs`. The pack copies from the core's chunk arrays into the core's batch rows. A moved frame therefore makes no JavaScript array and runs no JavaScript loop. The writer and its code load on first use. A page that packs no chunked rows downloads none of it.

The selection is `crates/null3d-splats`. It reads a parameter block of 64-bit floats and a chunk table. It computes the distances and sorts a stable nearest-first order. It then writes the two budget passes' counts. `packages/splats/src/select-task.ts` is its task module. `packages/splats/src/select-reference.ts` is the TypeScript reference that the unit tests drive.

## Costs

| Cost | The selection module | The core pack |
| --- | --- | --- |
| Reached at start | Nothing; it loads on first use with the task | Nothing; its code loads on first use with `createChunkRows()` |
| Memory | The chunk table and the sort scratch, in the add-on module's memory | The chunk arrays, once for each loaded chunk, in the core's memory |
| A moved frame | Copies the header into the worker and the counts back | A Rust pass over the chosen prefixes, with no JavaScript allocation |
| Engine surface | None | One public method on `InstanceBatch`, and one class that the engine exports as a type |

The core stores each chunk's arrays for as long as the cloud lives. The splats' memory is therefore the same bytes that the JavaScript reader held before, in the engine's memory instead of the sketch worker's heap. The sketch's slot keeps only a flag that the chunk arrived, because the rows live in the core once the writer copied them, so a cloud is not held twice. A cloud that is destroyed forgets its chunks.

The measured cost at 500,000 splats, the High preset's count, is 0.6 to 1.6 ms for the TypeScript pack. The core pack costs 0.7 to 2.0 ms. Both copy the same 28 MB, so the port removes the JavaScript loop and its per-frame objects rather than the copy. The selection costs 1 to 4 us a call at a realistic 20-chunk cloud. At a 4,096-chunk cut it costs 0.5 to 0.8 ms, against 0.9 to 1.7 ms in TypeScript. The pack therefore costs about a thousand times the selection, which makes it the loop whose cost a player could feel.

## What stays in TypeScript

Two small loops over the chunk list stay on the sketch thread, and neither is a loop that hard rule 42 names:

- `differs` (`packages/splats/src/system.ts`) compares the chosen counts of two selections, to learn whether the draw must pack again. It walks the chunk list, which a cut keeps at 4,096 entries at most, with no browser call.
- `askForChunks` (`packages/splats/src/system.ts`) orders the chunks that a stream still needs by their distance, and asks the loader for them. It runs only while a stream loads, over the same bounded chunk list.

The rule names loops over objects, instances, vertices, pixels and draw-list commands, and these walk chunks: a few dozen entries for a cloud at the presets, and 4,096 at the most. The selection and the pack, which run over the splats themselves, are in Rust. The loops are recorded here so a later reader knows they were weighed rather than missed.

The worker keeps a selector's arrays while they hold a grown cloud's chunk count, and it takes a dropped selector's arrays back, so a cloud cut into many chunks leaves neither one state for each chunk nor a module memory that only grows.

## Consequences

- `crates/null3d-core/src/chunk_rows.rs` holds the chunk store and the pack. Its tests mirror the TypeScript reference's cases.
- `crates/null3d-splats` holds the selection and the sort. `packages/splats/src/select-parity.test.ts` compares the built module with the reference over seven clouds and views. It also compares a cloud whose distances all tie, a `SharedArrayBuffer` as a page with shared memory gives it, and two frames that share one version. A shared buffer is the path that production takes.
- `packages/splats/src/select-task.ts` keeps a selector's chunk table in the module's memory while the input's version and chunk count agree, so a moved frame copies no table.
- `packages/engine/src/shared/tasks.test.ts` covers the loader's caches: a URL's text and a task's module key are made once, a failed download is tried again, and two concurrent asks share the one pending module.
- `packages/splats/src/pack.ts` stays as the TypeScript reference, and the draw no longer calls it.
- `packages/engine/src/scene/chunk-rows.ts` holds the public writer. `docs/concepts/instances.md` names the hook, and the API reference comes from its doc comments.
- `bun run build` builds the crate with the other tool modules. It copies the module to `packages/splats/dist/splats.wasm`, which the tarball carries.
- `shared/tasks.ts` caches each WebAssembly file's URL text, each task's module key and its compiled module. A task that runs in every frame then copies no string and awaits no resolved compile, which the allocation check of this add-on showed.
- `bench/allocation.ts` gives the `--splats` switch its own render-worker budgets, measured on the Mac, for the texture that the cloud refreshes in every frame.
- The three splat pictures pass on every GPU path: 9 of 9 on the Mac's GPU, the three tests on WebGPU, compatibility mode and WebGL2, with no reference moved, so the pack draws the rows in the same order as before. CI's shard 18 passed the same nine pictures in run 41374295180, but that run is red overall: more than a hundred other pictures and many other jobs failed. The run is therefore not evidence that the branch is green, and the task's picture evidence is the Mac's own drawing. No GPU-time line is owed: the branch changes no shader and none of the engine's `gpu`, `render` or `quality` folders.
