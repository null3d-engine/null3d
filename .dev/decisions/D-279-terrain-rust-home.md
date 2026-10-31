# D-279: Where the terrain's per-frame work runs in Rust

Status: decided by the owner: the terrain's Rust home is the add-on compiled to wasm, not a public core call. Not built yet. Task: M3-F14.

Summary: The terrain's quadtree selection and block build run in TypeScript on the sketch thread.
Hard rule 42 asks for a Rust home. A public core hook is the smaller build, but it adds a
terrain-shaped call to the engine's frozen surface for one consumer. An add-on wasm module keeps the
terrain logic in the add-on and runs it on the job workers. It costs a new crate and a loader path.
The owner chose the add-on wasm module.

## Question

Where should the terrain's per-frame work run in Rust? One option is the engine core behind a public
hook. The other is a WebAssembly module that the terrain add-on loads on first use.

## Rule

Hard rule 42 asks that the per-frame loops over vertices run in Rust. Rule 11 says each feature lives
in one place. Rule 12 says an add-on reaches the engine only through public entry points. A hook
built for one add-on must let another developer build the same add-on. D-173 ruling 14 says a feature
that leaves the core goes through the public hooks like any add-on. The core's public API freezes at
1.0 ([D-223](D-223-plugin-interface-version.md)), so a new core call is permanent.

## Data

The per-frame work is the quadtree selection in `packages/terrain/src/quadtree.ts`, which walks the
tree when the camera crosses a cell. The block build in `packages/terrain/src/terrain.ts` samples the
height field once per vertex through `writeChunkVertices` and `writeParentHeights` in
`packages/terrain/src/chunk.ts`. At the default build count that is about 4,600 vertices a frame.
The height samples are already a `Float32Array`, `Heightfield.heights`. The engine already has a
vertex-update call into the core, `mesh.updateVertices`.

No build of either option exists, so the costs below are what each option adds, not measured figures.

| Cost | A public core hook | An add-on wasm module |
| --- | --- | --- |
| Engine surface | Two to three new public calls, frozen at 1.0, that only the terrain add-on uses | None; the add-on uses the existing first-use loader |
| Start download | The builder's code joins the core wasm, so every page pays for it | Nothing until a page draws terrain |
| Build time | The core wasm build grows by the builder | A new crate, its compile in the build, and its pack step |
| Thread | The call is synchronous in the core, so the sketch thread waits | The task runs on the job workers |
| New machinery | No new crate; the hook must take and hold the height samples | A crate, a loader entry, a cache key and the pack gates |
| Rule fit | One-consumer public API, against rule 12 and D-173 ruling 14 | The terrain logic stays in the add-on (rule 11) |

## Look

Both options draw the same ground from the same height field, so the look does not decide.

## Decision

Decided: the add-on wasm module. The owner ruled that the terrain's Rust home is the add-on compiled
to wasm, not a public core call. The terrain's per-frame work therefore moves into a module that
`@null3d/terrain` loads on first use. The public core hook is rejected: a terrain-shaped call would
freeze in the engine's API at 1.0, and its code would join every page's start, for one consumer.

### What this means for M3-F14's shape

- **A crate of its own.** `null3d-terrain` (the build confirms the name) holds the block build and
  the quadtree selection. A call takes the height samples, the block's origin and size, the shape's
  counts, the skirt's depth and the parent's place, and writes the positions, the normals and the
  parent's heights into buffers that the add-on hands in.
- **A pack step.** The add-on's package ships the crate's compiled bytes as a binary asset, as the
  engine ships its own core, and the pack gates hold the asset's size. The bytes are not part of the
  engine's start download.
- **A first-use loader entry.** The add-on fetches, compiles and keeps the module the first time a
  page draws terrain, for that page only. The cache key pairs the module's interface version with
  the add-on's version, so a page never runs a module that another add-on version wrote.
- **The block build on the job workers.** A block's build is one call into the module from one of
  the engine's job workers, so the sketch thread does not wait for it. The add-on uploads the
  finished arrays through the mesh path that it uses today.
- **The engine's surface does not change.** No new public call and no new start code.

### The first slice

The crate skeleton and its loader path, with the block build in them, proven by a page whose cells
still come from the TypeScript quadtree: one block of a height field draws from the module's arrays,
vertex for vertex as today, on both GPU paths. That slice puts the new machinery in place, the pack
step, the loader entry, the cache key and the worker call, and it has an exact comparison, because
the block build's output is today's arrays. The quadtree selection follows once the loader path is
proven, then the allocation check and the docs.

## Consequences

The work adds a `null3d-terrain` crate, a pack step, a first-use loader entry and the add-on's call.
It also adds tests that compare the selection and the vertex arrays with today's, an allocation
check, and the develop skill and the terrain API page's notes. The engine gains no public call, so
its surface stays as it is at the freeze. The add-on's first use pays one download and one compile
of the module, and a page that never draws terrain pays nothing.

## The particle loop, priced both ways

The hard rule 42 audit found the particles add-on writing one birth record for each particle on the
sketch thread, and the owner ruled that the loop takes the engine shape: a Rust function over the
emitter's rate and its births, with the settings passed across. These are the two ways to build it,
priced as the terrain's options were above.

| Cost | The engine shape | An add-on wasm module |
| --- | --- | --- |
| Where the loop runs | A function in the core's particles module, beside the buffer that already holds the records | A second crate, its pack step and a first-use loader entry |
| Start download | The core wasm grows by the spawn code | Nothing until a page emits particles |
| The events seam | Rust hands back a block of the births and the add-on plans the sub-emitter events from it, or the event age's flight maths moves to Rust too | The same choice |
| Seeded records | The shape's cube root and sines move to Rust, so the golden records change once and then hold on every device | The same |
| Build | About 300 to 400 lines of Rust over the rate, the bursts and the per-birth maths, with tests, then the glue, the add-on's loop removed and its tests reworked: 2 to 3 days | The same maths, plus the crate, the pack step, the loader entry, the cache key and the worker call: 1 to 1.5 helper-weeks |

The engine shape reuses the core wasm that a page already downloads, and the record buffer is
already in it, so it is the smaller build by the loader path alone. The add-on module would share
the terrain's loader once that module lands, which narrows the gap and still leaves a second crate
and a second download.
