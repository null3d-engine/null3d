# D-113: Extra geometry as arrays from a package, and vertex updates in place

Status: decided by the helper of M2-P2 on 2026-10-08, within the task's plan. Date: 2026-10-08. Task: M2-P2.

Summary: `@null3d/geometry` holds ports of three.js's other geometry classes as functions that return arrays for `geometry.fromArrays`. Their numbers equal three.js 0.186.1's in 124 tests. `mesh.updateVertices(name, values, start, count)` writes one attribute into the mesh's pages in place, and the next frame uploads only the changed vertices' bytes. The mesh keeps its first bounding sphere. Meshes with joints or morph targets take no updates.

## Question

Two parts of the porting map were still open for 0.2. Where do three.js's torus knot, polyhedra, lathe, shape, extrude and tube go, and in what form? And how does a sketch change a mesh's vertices every frame, as three.js's `attribute.needsUpdate` does?

## Rule

- The generators give three.js's arrays, value for value, so a port draws the same triangles.
- The engine's start download does not grow for features that most pages do not use ([D-54](D-54-addon-modules.md)).
- An update in each frame allocates nothing in TypeScript or in the frame code (hard rule 1), and uploads only what changed (design principle 4).
- Every cache that the engine keeps from a mesh's vertices stays correct after an update.

## Data

| Measure | Figure | Source |
| --- | --- | --- |
| Generator tests against three.js 0.186.1 | 92 tests of the six generators, and 32 of the curves and `ShapeUtils`, with 1,631 checks | `bun test --conditions=null3d-source packages/geometry` |
| Values that differ from three.js's | 0: every position, normal, texture coordinate and index is equal | The same tests, which compare exactly |
| Size of the package's source | 4,222 lines with tests, of which earcut is 648 | `wc -l packages/geometry/src/*.ts` |
| Bytes that a change of one vertex uploads | One vertex: the box's 32 bytes, in one write | The shadow tile tests of both frame builders |
| Allocation of a loop of 5,000 updates of every kind | None | `tests/image/vertex-updates.spec.ts`, Chrome's heap profiler |

## Options

### Where the generators go

| Option | For | Against |
| --- | --- | --- |
| (a) Rust generators in the core, beside the nine of 0.1 | One place for every generator | Every page downloads them in the core's WebAssembly. Extrude needs earcut and the curve classes, which users also call from TypeScript, so the shapes would cross into the core as data |
| (b) A TypeScript package whose functions return arrays for `geometry.fromArrays` (chosen) | A page pays only when it imports the package. The functions run anywhere, so tests compare them with three.js directly. Users can change the arrays before they make a mesh | A generator's mesh is made from arrays, so a sketch writes `geometry.fromArrays(torusKnot(...))`, one call more than the built-in generators |
| (c) Functions that take `ctx.geometry` and return a mesh | One call | Two ways to do one thing, and no access to the arrays |

The package has no WebAssembly and loads no files, so it needs none of the add-on loader of D-54. It ships the three.js and earcut licences in its own notices file, which the Vite plugin adds to a build's notices.

### How vertices change

| Option | For | Against |
| --- | --- | --- |
| (a) `mesh.updateVertices(name, values, start, count)`, with every vertex's values and a range (chosen) | A port keeps its array, as three.js does with `addUpdateRange`. A whole update copies with one `set`, and a range copies only its vertices. Nothing allocates | The array holds every vertex even for a small change |
| (b) `geometry.updateVertices(mesh, arrays)`, as the task's plan worded it, with several attributes at once | One call for positions and normals | An object of arrays per call allocates, or a sketch keeps one. The port skill and the mapping already named the call on the mesh |
| (c) Upload the page from the first changed byte to its end, as a removal of meshes does | No new state | A mesh early in a shared page would upload every mesh after it, each frame |

The page's GPU copy keeps one range of changed bytes, which grows to hold each update until the next upload. A mesh split into parts, past 65,535 vertices, keeps a list of the mesh vertex that each part vertex copies, so an update reaches every copy. A mesh in one part needs no list.

### Bounds and caches

- The mesh keeps the bounding sphere of its first vertices, as three.js keeps a geometry's `boundingSphere`. A new sphere would need every object's bounds again, which rebuilds the draw tables in each frame. `setBounds` gives an object bounds that hold every shape.
- Raycasts and overlap queries drop the mesh's tree and list the scene's items again at the next query. A frame without queries pays nothing.
- WebGL2's software occlusion culling stops using the mesh as a blocker: a blocker from its old shape would hide what it no longer covers, and a new one in each frame costs more than it saves.
- The shadow tiles of point and spot lights add the mesh's update count to each caster's pose stamp, so a still caster whose mesh changed draws its tiles again. The first update of a mesh changes the scene's structure once, which puts its casters among those that the tiles stamp.
- Meshes with joints or morph targets refuse updates. Their joint spheres and morph reach come from the first vertices, and their poses would need those again.

## Decision

The package of array functions, and `mesh.updateVertices` with every vertex's values and a range of vertices. The tests show three.js's numbers exactly, a one-vertex upload of one vertex's bytes, and no allocation.

## Consequences

- `packages/geometry` is a new public package. Its first npm publish is by hand at the 0.1.0 release ([D-108](D-108-first-release.md)).
- `api/geometry` documents both parts, the mapping entries name the calls, and both skills show them.
- E1206 covers updates that do not fit the mesh.
- The demos `extra-shapes` and `vertex-updates` draw on every tier in the image test manifest.
