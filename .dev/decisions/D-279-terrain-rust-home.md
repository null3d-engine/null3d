# D-279: Where the terrain's per-frame work runs in Rust

Status: proposed. Not built yet. The owner decides. Task: M3-F14.

Summary: The terrain's quadtree selection and block build run in TypeScript on the sketch thread.
Hard rule 42 asks for a Rust home. A public core hook is the smaller build, but it adds a
terrain-shaped call to the engine's frozen surface for one consumer. An add-on wasm module keeps the
terrain logic in the add-on and runs it on the job workers. It costs a new crate and a loader path.
The owner decides.

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

Proposed: the add-on wasm module. It keeps the terrain logic in the add-on and leaves the core's
surface frozen for one fewer consumer. It also lets the build run on the job workers, so the sketch
thread does not wait. The public core hook is rejected for one consumer. A terrain-shaped call would
freeze in the engine's API, and its code would join every page's start. A core hook is
acceptable only if the owner judges the builder a general height-grid primitive. Another add-on
would then use it, rather than a path built for terrain alone. The owner decides between the two.

## Consequences

With the add-on module, the work adds a `null3d-terrain` crate, a first-use loader entry and the
add-on's call. It also adds tests that compare the selection and the vertex arrays with today's. An
allocation check follows, then the develop skill and the terrain API page. With the core hook, the
work adds the public calls and the core code, and the same tests. It also freezes a permanent engine
API that one add-on uses.
