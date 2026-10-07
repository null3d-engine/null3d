# D-34: Meshopt decoding

Status: decided. Date: 2026-10-04. Task: M2-A3.

Summary: meshoptimizer's own decoder, from its npm package, which the glTF worker loads with the first file that holds meshopt data: 6.2 KB after Brotli, apart from a page's first download. It reads both extension names, decodes every mode and filter as the reference decoder does, and never downloads a fallback buffer. The test file for the vendor name comes from gltfpack.

## Question

glTF files compressed with meshopt hold their vertex and index data in `EXT_meshopt_compression` or `KHR_meshopt_compression` buffer views. Which decoder reads them, where does it run, and how does a page that loads no such file avoid its download? How do the tests show that a compressed file loads as its uncompressed source does?

## Rule

- A compressed file gives the same vertex and index data as the format's reference decoder, for every mode and filter, under both names.
- A page without meshopt files downloads none of the decoder (M2-R5's rule). The size report lists the decoder apart from a page's first download.
- No frame of the sketch waits for a decode, as no frame waits for a parse ([D-29](D-29-gltf-loader.md)).
- Data that breaks the extension's rules fails with E1416 before it allocates, and never hangs.
- The compressed sample models draw on all three GPU tiers, and match three.js's `GLTFLoader` with its `MeshoptDecoder`.

## Data

### The decoder

| Option | Download, after Brotli | Speed | Upkeep |
| --- | --- | --- | --- |
| (a) meshoptimizer's own decoder from its npm package, version 1.3.0 (MIT): two WebAssembly builds, with and without SIMD, as text in one module | 6.2 KB (`js/gltf-meshopt.js`, with the engine's few lines) | 1.9 ms for 9.0 MB of decoded data | A version bump. three.js ships the same file |
| (b) The same C++ decoder, built to WebAssembly in this repository | About 3.3 KB with the SIMD build alone | The same | A C++ toolchain in the build, for 3 KB |
| (c) A decoder written again in the Rust core | Grows the core that every page downloads | Unknown | The Khronos version of the format added a vertex codec and a filter; each change would need porting |
| (d) meshoptimizer's reference decoder, plain JavaScript | 3.6 KB, before minifying | 8.0 ms for the same data | Its authors mark it "not recommended for use in production" |

Speeds come from Bun 1.3.14 on the Mac. The mesh is a grid of 250,000 vertices (16-bit positions, 8-bit normals) and 498,002 triangles. It compresses from 8.98 MB to 1.31 MB. They are a rough guide: the Mac is shared, and a browser's WebAssembly differs from Bun's. At 10 Mbit/s the compressed mesh takes about a second to download, so the decode adds about 0.2% to the load with (a).

### The test files

| File | Name | Modes and filters | Source |
| --- | --- | --- | --- |
| `MeshoptCubeTest/glTF-Meshopt` (Khronos, CC0) | `KHR_meshopt_compression` | Attributes, triangles and indices; no filter, octahedral, quaternion, exponential and color; vertex codecs 0 and 1 | The sample content |
| `MeshoptCubeTest/glTF` | The same, not required | The same, with a fallback buffer of the decoded bytes | The sample content |
| `tests/pages/assets/models/simple-instancing-meshopt.glb`, 4,168 bytes | `EXT_meshopt_compression` | Attributes and triangles; no filter, octahedral, exponential and quaternion; vertex codec 0 | SimpleInstancing (Khronos, CC0, 7,356 bytes) through gltfpack 1.3 with `-cc -ce ext` |
| Files made in the unit tests with meshoptimizer's encoder | Both names | Every mode and filter, 8-bit and 16-bit filters, both vertex codecs | `gltf-meshopt.test.ts` |

No Khronos sample model under an accepted licence uses the vendor name, so gltfpack makes one. The tool is a single-threaded WebAssembly build, and wrote the same bytes in Bun and in Node. The command `bun tests/lib/meshopt-fixtures.ts` writes the file again. A unit test checks that the committed file matches.

### Results

| Check | Result | Where |
| --- | --- | --- |
| Every mode and filter, both names, both vertex codecs: the decoder against the reference decoder | Equal, array for array | `gltf-meshopt.test.ts` |
| Modes without a filter against the arrays given to the encoder | Equal; triangles equal up to the corner each starts at | The same |
| Filters against the floats given to the encoder | Within 1e-4 for exponential, 0.02 for 8-bit and 0.002 for 16-bit octahedral and color, 0.002 for quaternion | The same |
| `MeshoptCubeTest`: decoded against its fallback buffer | Equal, apart from the corner each triangle starts at | `tests/lib/meshopt-fixtures.test.ts` |
| The gltfpack file, decoded, against the reference decoder | Equal | The same |
| 10 rules of the extension broken one at a time, and data cut short | E1416 each time, naming the broken field | `gltf-meshopt.test.ts` |
| A page that loads both files and a broken one, in every thread mode on both paths, and in a production build | The decoder downloads once; the fallback buffer never; the broken file gives E1416 | `tests/image/gltf.spec.ts` |
| A page without meshopt files | The decoder never downloads | The same |

The triangle mode keeps each triangle and its winding, but may start a triangle at another corner. So the Khronos file's triangles match its fallback buffer only up to that rotation.

### Images

The image test `gltf-meshopt-ext` draws the gltfpack file. It must match the references of `gltf-instancing`, the same model uncompressed. The tool stores positions in 14 bits and normals in 8, so 0.21% to 0.23% of the pixels differ at all. The test passes the default tolerance on every tier, on the Mac's GPU and on SwiftShader. The test `gltf-meshopt-khr` draws the Khronos file, with references of its own.

Parity with three.js (`bun run parity`, 2026-10-04), pixels that differ by three.js's rule:

| Scene | Mac GPU: WebGPU, compatibility, WebGL2 | SwiftShader: the same three |
| --- | --- | --- |
| `gltf-meshopt-ext` | 0%, 0.411%, 0.002% | 0%, 0.407%, 0% |
| `gltf-meshopt-khr` | 0.006%, 0.068%, 0% | 0.017%, 0.061%, 0% |

`gltf-meshopt-ext` takes the limit of `gltf-instancing`, 0.5%, for the same black and white edges. Compatibility mode's 8-bit path averages them after it encodes the colors. The uncompressed model gives 0.412% there. For `gltf-meshopt-khr`, three.js's WebGPURenderer draws the column of cubes with 16-bit attributes black, and its WebGLRenderer draws them as null3D does. So that scene compares every tier with WebGLRenderer (`webglOnly`). Against WebGPURenderer, 0.237% to 0.297% differed, almost all in that column.

## Decision

Option (a). `scene/gltf-meshopt.ts` imports the decoder from the `meshoptimizer` package, pinned to 1.3.0 in the engine's dependencies. That is the version whose encoder the asset tool uses (M2-B1). The decoder starts its SIMD build where the browser validates it, and its plain build elsewhere. Option (b) saves about 3 KB for a C++ toolchain in the build. Option (c) would grow every page's download, and port each change to the format. Option (d) decodes about 4 times slower.

The glTF worker imports the decoder module with the first file whose buffer views use either name, and keeps it for the worker's life. A failed download fails that load with E1406, and the next file tries again. The parser stays free of imports. It takes the decoder as an argument, and decodes a view the first time an accessor reads it, into an array of the view's length. It checks the extension's rules first. The data must lie in a buffer that holds data, and the mode and filter must allow the stride. A triangle list must hold whole triangles. The decoded bytes must fill the view and stay within an accessor's limit. A fallback buffer is never downloaded, because the engine always decodes.

The engine reads `KHR_meshopt_compression`'s newer vertex codec and color filter under either name, as meshoptimizer's decoder and three.js do.

## How three.js handles it

`GLTFLoader` decodes meshopt data only after `setMeshoptDecoder(MeshoptDecoder)`. The decoder is three.js's copy of meshoptimizer's, version 1.1 in three.js 0.186. The page downloads that module up front, whether or not a model uses it. The decode runs on the thread that loads the file, unless the page calls `useWorkers`. Without a decoder, `GLTFLoader` reads the fallback buffer when the file does not require the extension. null3D needs no setup, decodes in its loader's worker, and downloads the decoder only for a file that needs it.

## Consequences

- `packages/engine/package.json` depends on `meshoptimizer` 1.3.0, the engine's first runtime dependency. The Vite plugin keeps it out of Vite's prebundling. So a dev server does not reload the page when the worker first imports it.
- `scene/gltf-parse.ts` reads both extension names and checks their rules; `workers/gltf-worker.ts` loads `scene/gltf-meshopt.ts` on first use. `tools/lib/size-report.ts` lists `js/gltf-meshopt.js`, loaded by `js/gltf-worker.js`.
- E1406 names the meshopt decoder among the files that may fail to download. E1417 no longer covers either meshopt name.
- The CI job of the unit tests fetches the sample content, for the Khronos test file and for gltfpack's source model.
- The model scenes gain `meshopt-ext` and `meshopt-khr`, so the image tests, parity and the benchmark job's parity spec cover them. The function `featureImagePath` takes a test that compares with another test's references.
- `concepts/assets` and `api/assets` describe the decoding; the mapping entry `MeshoptDecoder / setMeshoptDecoder` points to `concepts/assets`. `guides/assets-pipeline` waits for the asset tool (M2-B1), which makes these files.
- The record is in the table in [README.md](README.md).
