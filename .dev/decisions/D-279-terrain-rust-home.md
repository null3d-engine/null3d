# D-279: Where the terrain's per-frame work runs in Rust

Status: decided by the owner, and built: the terrain's Rust home is the add-on compiled to wasm, not a public core call. Task: M3-F14, M3-R39.

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

### What shipped

- **The crate.** `crates/null3d-terrain` holds `terrain_select` and `terrain_build`. It imports
  nothing, allocates nothing, and reads every array through a parameter block of 64-bit floats, so
  a call gives the bytes that the add-on's TypeScript reference gives.
- **The pack step.** `bun run build` builds the crate with the other tool modules and copies it to
  `packages/terrain/dist/terrain.wasm`. The tarball requires that file, and the CDN build carries
  it beside `lib`.
- **The loader entry.** `packages/terrain/src/terrain-builder.ts` names the task and its module, and
  runs it with `runTask`. The engine compiles the module once per page and each job worker
  instantiates it at its first terrain task.
- **The arrays.** The add-on makes one buffer for the terrain and shares it with the worker where
  the page allows a `SharedArrayBuffer`: the height samples, the height boxes, the skirt's ring, the
  leaves and one block's place for each slot of a batch. A selection that outgrows the leaves makes
  the buffer again, once, and asks again.
- **The reference.** `packages/terrain/src/reference-builder.ts` runs the same selection and build
  in the thread that runs the sketch, so the package's unit tests drive them with no worker. The
  package build leaves that file out of the tarball, with the tree walk and the vertex writers that
  it reads. `packages/terrain/src/wasm-parity.test.ts` drives the built module through the shipped
  task module on a view that mixes levels, and compares the leaves and every vertex with that
  reference, so an edit to either side that moves a number fails. CI's build job hands the module to
  the unit tests with the page's other WebAssembly.
- **Hold mode.** A hold runs its frames with no frame loop, so a task that the sketch queued never
  answers while it steps. The held frame now waits for those tasks, then draws one more frame at
  the held time, as it already waits for textures and a grading table. Without that wait a held
  picture would show the ground that the tasks had not yet written. A task counts from its call,
  before its WebAssembly file compiles. A count that starts after the compile misses the terrain's
  first build while it compiles. That happens when an earlier task has already loaded the task
  code, as the plant core's tasks in the Island's setup do. The hold then took its frame with no ground,
  and the sea showed through the island. A unit test holds the count at one through a slow compile.

## Consequences

The work adds a `null3d-terrain` crate, a pack step, a first-use loader entry and the add-on's call.
It also adds tests that compare the selection and the vertex arrays with today's, an allocation
check, and the develop skill and the terrain API page's notes. The engine gains no public call, so
its surface stays as it is at the freeze. The add-on's first use pays one download and one compile
of the module, and a page that never draws terrain pays nothing.

The module's memory is never given back. A worker forgets a dropped terrain's arrays, but the
bytes stay used and the allocation cursor keeps rising, so a page that builds and destroys many
terrains in one worker would grow that worker's module memory without bound. One terrain per page
is the normal case, which makes the limit acceptable; a page that needs more would need the module
to free a terrain's arrays.

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
