# D-29: The glTF loader, prefabs and their copies

Status: decided. Date: 2026-10-03. Task: M2-A2.

Summary: A worker of the loader's own parses glTF files and decodes their images, loaded with the first file. A prefab is a template that `instantiate` creates with one core call and one batch of commands. A model's instance batches share one set of rows through batch parts. Ten sample models match three.js's `GLTFLoader` by its image rule, two under limits with reasons.

## Question

`assets.loadGltf(url)` returns a prefab: a template whose meshes, materials and textures exist once on the GPU. Where does the file get parsed, so that no frame waits for it? How does `scene.instantiate` create a model's objects in one batch? How do `scene.createInstances(prefab, count)` and `scene.clone(object)` copy a model, or a tree of objects? And what does each part of a glTF file become, where the engine and three.js's `GLTFLoader` differ?

## Rule

- No frame of the sketch waits for a file: the download, the parse and the image decodes run outside the sketch's frames.
- A page that loads no glTF file downloads none of the loader (M2-R5's rule). The loader's code counts apart from a page's first download, as the KTX2 transcoder's does.
- A file that breaks glTF's rules fails with a code that says how to fix it, and never hangs or allocates its counts.
- The sample models draw on all three GPU tiers. They match three.js's `GLTFLoader` by three.js's own image rule, or within a limit that this record explains.
- `instantiate` of a 1,000-object prefab costs one batch of commands, and no frame shows part of a copy.

## Where the file is parsed

| Option | Frames wait | Download | Thread modes | Notes |
| --- | --- | --- | --- | --- |
| (a) A Rust parser in the core, run on the job workers | No | The parser grows the core's WebAssembly, which every page downloads | The single-threaded build has no job workers, so it parses on the page | Job workers block in the job system's loop between frames. A parse of several milliseconds there delays the next frame's parallel work. The JSON would be parsed by Rust code, while the browser's `JSON.parse` is native |
| (b) Parse on the thread that runs the sketch | Yes: a large file's JSON and accessor copies block its frames | Nothing more than the loader | Every mode | Simple, but against the rule |
| (c) A worker of its own, started by the loader on first use | No | A loader chunk and a worker file, both on first use | Every mode, the single-threaded build too | The worker hands back the arrays and the decoded images without copies |

The plan's outline said job workers. In this engine a job worker runs only the core's job loop, which the sketch thread wakes for each frame's parallel work. So option (c) keeps the outline's point, a parse that no frame waits for, without a cost to the frame's own jobs.

## Data

### Sizes

| File | After Brotli | Downloaded |
| --- | --- | --- |
| `js/sketch-worker-gltf.js` (and `js/page-gltf.js` in the single-threaded build): the loader | 3.0 KB | With the first `loadGltf` call |
| `js/gltf-worker.js`: the parser and the image decodes | 5.8 KB | With the first `loadGltf` call |
| The engine's JavaScript of a pipelined page | 89.4 KB, up 2.6 KB | At the start: `instantiate`, `clone`, `createInstances(prefab)`, `loadGltf`'s import and the object state that `clone` copies |
| The core's WebAssembly | Under 1% more | At the start: `reserveObjects`, batch parts and `copyLight` |

`bun run build` and `bun run build:check-size`, 2026-10-03.

### The sample models

Every one of the 31 glTF files of the 28 Khronos sample models in the sample content parses (`bun` with `parseGltf`). Two refuse with E1417, as the rule asks: `RiggedSimple/glTF-Draco` requires `KHR_draco_mesh_compression`, and `MeshoptCubeTest/glTF-Meshopt` requires `KHR_meshopt_compression`.

Ten models draw as image tests on all three tiers. The parity test compares each with its twin, which loads the same file with three.js's `GLTFLoader` and `KTX2Loader`. Pixels that differ, by three.js's rule (`bun run parity`, 2026-10-03):

| Scene | Mac GPU: WebGPU, compatibility, WebGL2 | SwiftShader: the same three |
| --- | --- | --- |
| `gltf-metal-rough` (MetalRoughSpheres) | 0.026%, 0.069%, 0.026% | 0.026%, 0.069%, 0.027% |
| `gltf-texture-transform` (TextureTransformTest, a `.gltf` with its files) | 0%, 0.024%, 0% | 0%, 0.022%, 0% |
| `gltf-unlit` (UnlitTest) | 0%, 0%, 0% | 0%, 0%, 0% |
| `gltf-emissive-strength` (EmissiveStrengthTest) | 0.051%, 0%, 0.050% | 0.051%, 0%, 0.051% |
| `gltf-lights` (PointLightIntensityTest) | 0%, 0%, 0% | 0%, 0%, 0% |
| `gltf-instancing` (SimpleInstancing) | 0%, 0.412%, 0% | 0%, 0.409%, 0% |
| `gltf-ktx2` (StainedGlassLamp, KTX2 textures) | 0.739%, 0.708%, 0.868% | 0.711%, 0.679%, 0.869% |
| `gltf-alpha-modes` (AlphaBlendModeTest) | 0%, 0.020%, 0.001% | 0%, 0.010%, 0% |
| `gltf-vertex-colors` (VertexColorTest) | 0%, 0%, 0% | 0%, 0%, 0% |
| `gltf-texture-coordinates` (TextureCoordinateTest) | 0%, 0%, 0% | 0%, 0%, 0% |

Two scenes pass under limits of their own, in `MODEL_LIMITS` of `bench/lib/parity.ts`. The lamp's glass uses `KHR_materials_transmission`, volume and ior, which three.js draws and null3D does not read, so it takes 1%. All its differing pixels lie on the glass and its beads. Since null3D draws transmission ([D-122](D-122-transmission.md)), 0.27% to 0.39% differ on the Mac, all on the stained glass, whose transmission map and clear coat null3D does not draw. The limit is now 0.5%. The instanced cubes put black faces beside white ones at hundreds of edges. Compatibility mode's 8-bit path averages those edges after it encodes the colors, so the scene takes 0.5%. It matches exactly on the other tiers.

### Copies

| Measure | Value | Where |
| --- | --- | --- |
| Core calls that reserve the objects of a 1,000-object prefab | 1, against 1,000 with `reserveObject` | `prefab.test.ts` |
| Batches of commands that the copy publishes | 1, of 2,001 records: a create for each object and a material for each mesh | the same test |
| A batch part's matrices against the row's matrix times the part matrix | Equal, bit for bit, on the four-lane and the one-row paths | Rust tests in `instances.rs` |

## Decision

### The loader

Option (c). `assets.loadGltf` downloads the file through `assets`, so `preload` and `onProgress` cover it, and imports the loader on first use, as `loadTexture` imports the KTX2 loader. The loader starts one glTF worker per thread that runs a sketch, which stays for the thread's life, as the transcoder's worker does.

The worker reads the container and the JSON, and lists the buffers that a `.gltf` file names by address. The loader downloads them through `assets` and hands them over. The worker then checks every index, offset and count before it reads or allocates. It copies each accessor into a tight array of the type the file holds it in, with sparse values applied and strides removed. So `KHR_mesh_quantization` types reach the meshes as M2-A1 takes them (D-25). It turns strips and fans into triangle lists. It decodes each image that the file holds with `createImageBitmap`, once for each color space a material reads it in. One message hands back every array and image without a copy. An image that the file names by address downloads through `assets`, and decodes as `loadImageBitmap` decodes. A KTX2 image goes through the transcoder (M1-D7).

The loader on the sketch thread then makes each mesh, material and texture once. The prefab keeps no copy of the arrays: the engine copies them into its memory, as for any mesh.

### What each part becomes

- A node with a mesh of one primitive becomes a `Mesh`. A node with several primitives, or with a light and a mesh, becomes a `Group` with one child for each. Any other node becomes a `Group`, or the light it holds.
- Materials follow `GLTFLoader`. Vertex colors turn on where a primitive has them, and a primitive without normals shades flat. One without tangents turns the normal map's green channel over. Blended materials write no depth. The default material of glTF is metal-rough with both factors at 1.
- `KHR_texture_transform` sets the material's one `uvTransform`. three.js gives each map its own; the engine's materials have one, so the base color map's transform wins, or else the first map's. A map's `texCoord` sets the texture's `uvSet`, so a texture that two materials read on different sets becomes two textures.
- glTF's lights are in three.js's units, and the engine's too. The engine assigns lights to clusters by their ranges. So a point or spot light without a `range` ends where its light falls to 0.001 lux, at `sqrt(intensity / 0.001)` meters. In three.js, `distance = 0` means no end. The parity of the lights scene is exact at that cutoff.
- `EXT_mesh_gpu_instancing` becomes one instance batch per node of each copy. Batches have no parent, so each row takes the node's place in the world when the copy is created, and stays there.
- Skins, clips and morph targets wait for M2-C7. Points and lines wait for lane G; the loader leaves them out with a warning in development builds.
- Cameras in the file are left out: a sketch makes its own.

### `instantiate`

A prefab holds a template: one node per object, parents first, with its transform, mesh, material, flags and light. The scene reserves every slot with one core call, `reserveObjects`. It writes the transforms and every record into the command ring, and publishes the ring's write index once. It checks first that the ring has room for every record, so a copy that does not fit creates nothing. The core applies the records together at the next frame's start.

### `createInstances(prefab, count)`

A model's meshes need their own batches, because the renderer draws one mesh and one material per batch. Three ways to give the batches one set of rows were weighed:

| Option | Cost | Problem |
| --- | --- | --- |
| Copy the first batch's rows into the others each frame, in TypeScript | A copy per part per frame | Per-frame work on the sketch thread, and the parts' own transforms still need applying |
| Bake each part's transform into a copy of its mesh | GPU memory for the copies | Integer positions would need floats again, which undoes `KHR_mesh_quantization` |
| A batch that reads another batch's rows, with a part matrix of its own | 36 multiply-adds per row and part, in the core's existing parallel update | None of the above |

The third option ships. The core call `createBatchPart` makes a batch with a 3 × 4 part matrix, which the update applies after it composes each row. The first part owns the rows. Each other part reads them, follows their active count, and adds their dirty bits to its own. Then it computes its own world output, cells and changed ranges. So the renderer sees ordinary batches. The four-lane path and the one-row path apply the matrix in the same order, so their results match bit for bit.

### `clone`

`clone` takes the same path as `instantiate`. It builds a template from the object's tree and creates it with one batch. Objects created in the same frame are not in the core yet, so the core cannot list a tree. Each wrapper therefore keeps what its calls set: its parent, flags and layers, and a mesh's mesh, material and render order. The scene keeps the set of live objects, which `clone` searches once. A destroyed parent leaves its children as roots, as in the core, so `clone` never reaches them through it. Lights copy their row with `copyLight`, and cameras their lens.

## How three.js handles it

Its `GLTFLoader` parses on the main thread, and decodes images with `ImageBitmapLoader` where the browser has it. It builds a new scene graph per load. Then `gltf.scene.clone()` or `SkeletonUtils.clone` copies objects that share geometry and materials. An `InstancedMesh` holds one geometry and one material. So a model of several meshes needs one per mesh, kept in step by hand. null3D parses in a worker and shares GPU data through the prefab. It creates copies with one batch of commands, and keeps a model's batches in step in the core.

## Consequences

- `crates/null3d-core/src/instances.rs` has batch parts, `scene.rs` has `reserve_many`, and `lights.rs` has `duplicate`. The WebAssembly entry point exposes `reserveObjects`, `createBatchPart` and `copyLight`.
- `packages/engine/src/scene/gltf-parse.ts` is the parser, `workers/gltf-worker.ts` its worker, `scene/gltf.ts` the loader, and `scene/prefab.ts` the prefab. The size report lists the loader and the worker apart.
- E1416 covers files the loader cannot read, and files that pass a limit on what one file may decode to ([D-59](D-59-file-limits.md)). E1417 covers files that require an extension it does not read. An embedded image that does not decode gives E1412, as an image that the file names does. The `rewriteUrl` option checks the addresses that a file names, for models from users. Draco (M2-A6) and meshopt (M2-A3) lift E1417 for their extensions. M2-A3 decodes meshopt data in the glTF worker, where the parser reads buffer views ([D-34](D-34-meshopt-decoding.md)), so `MeshoptCubeTest/glTF-Meshopt` now loads.
- M2-C7 reads skins, clips and morph targets in the parser, and hands them to M2-C1's core calls from the loader.
- The image tests `gltf-*` load sample models, so the CI jobs that draw them fetch the sample content first (`.github/actions/samples`).
- The record is in the table in [README.md](README.md).
