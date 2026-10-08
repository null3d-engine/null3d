# D-112: Draco decoding

Status: decided. The owner decided on 2026-10-04 that the engine reads Draco files, with the decoder loaded on first use ([D-54](D-54-addon-modules.md#draco), [D-14](D-14-js-budget.md#recorded-exceptions)). This record holds how M2-A6 built it. Date: 2026-10-08. Task: M2-A6.

Summary: The glTF worker reads `KHR_draco_mesh_compression` with Google's own glTF decoder, Draco 1.5.7, kept unchanged in the repository: 59 KB after Brotli, downloaded with the first Draco file and compiled once per page. Decoded normals and tangents become 8-bit integers and texture coordinates in 0 to 1 become 16-bit ones, which halves those attributes' GPU memory. Decoded counts must match the accessors, broken data fails with E1416 in under a millisecond, and a decoder that failed or grew past 64 MiB gives way to a fresh one.

## Question

How does the engine decode Draco data: which build of the decoder, how a module worker runs its script, which types the decoded attributes take, and how a hostile file stays within the limits of [D-59](D-59-file-limits.md)?

## Rule

- Intent parity: the decoded mesh matches what the file's uncompressed twin holds, within Draco's own quantization ([D-52](D-52-intent-parity.md)).
- A page that loads no Draco file downloads none of the decoder. The decoder loads through the one on-demand loader, and never in a worker of its own ([D-54](D-54-addon-modules.md)).
- The decoder's script makes no code from strings, so a strict Content-Security-Policy runs it.
- A broken or hostile file fails fast with E1416, and a later file still loads.
- The core and the start's download do not grow.

## Data

### The decoder

| Option | Download, after Brotli | Upkeep | Chosen |
| --- | --- | --- | --- |
| (a) Draco's glTF build, `draco_wasm_wrapper_gltf.js` and `draco_decoder_gltf.wasm`, from the release's `javascript/` folder, unchanged | 59 KB with the engine's code | A hash bump per release | Yes |
| (b) Draco's full build, three.js's default | About 76 KB | The same | No: glTF files need only the glTF build |
| (c) Our own build from Draco's sources, as for Basis Universal | About the same | An Emscripten toolchain in the repository | No: the official script already makes no code from strings, so the reason for Basis's own build does not apply |
| (d) A hand-written binding to the module's exports, without Draco's script | About 49 KB | The exports' names are minified, so each release breaks it | No |

The official script calls no `eval` and no `Function` constructor on strings: a search of its text finds none. Its four imports come from the script, so the engine passes the compiled module through the script's `instantiateWasm` hook, and the script never fetches the `.wasm` itself.

The script is not an ES module. In a production build, Vite's bundler wraps it as CommonJS, and its import gives the factory as the default export. The dev server serves it as it is, and the browser runs it as a module, where it hands the factory to an AMD `define`. `scene/gltf-draco.ts` offers that `define` on the global object for the time of the import, and then removes it. Both paths run in the browser tests: the dev server's pages, and the production build of the test pages.

Measured from this build (`bun run build`, 8 October 2026):

| File | Raw | gzip | Brotli |
| --- | --- | --- | --- |
| `draco_decoder_gltf.wasm` (first-use module) | 192,593 B | 63,239 B | 48,764 B |
| `js/gltf-draco-decoder.js`, Draco's script as the bundle wraps it | 57,321 B | 11,166 B | 9,480 B |
| `js/gltf-draco.js`, the engine's Draco code | 4,362 B | 1,987 B | 1,775 B |
| Together | 254,276 B | 76,392 B | 60,019 B (58.6 KiB) |

Each script stays within the 16 KB limit for files that load on first use, and the module goes in the size report's section of first-use WebAssembly, which has no budget. The start of each thread mode does not change: Draco's code loads only from the glTF worker.

### Decode speed

Bun 1.3.14 on the Mac, a sphere grid with normals and texture coordinates, encoded by glTF-Transform 4.5 with Draco's encoder at its defaults, decoded with the shipped decoder through `parseGltf`, quantizing included. Median of 7 runs, each with a fresh decoder:

| Vertices | Triangles | File | Decode |
| --- | --- | --- | --- |
| 16,384 | 32,258 | 58 KB | 7.9 ms |
| 262,144 | 522,242 | 466 KB | 141 ms |
| 1,048,576 | 2,093,058 | 1.5 MB | 552 ms |

That is about 0.5 µs per vertex. The largest grid decodes to about 44 MB, at about 80 MB/s. meshopt's decoder wrote 9.0 MB in 1.9 ms on the same Mac, about 60 times faster ([D-34](D-34-meshopt-decoding.md)). The decode runs in the glTF worker, so no frame waits for it, but a large Draco file loads visibly later than its meshopt copy. The warning in development builds says so and names the converter.

### Types after decoding

three.js and the other engines ask the decoder for each attribute in its accessor's type, which is float for almost every Draco file, and keep the floats. The worker instead writes:

| Attribute | Draco file's accessor | Kept as | Bytes per vertex |
| --- | --- | --- | --- |
| Normal | 3 floats | 3 normalized signed bytes | 12 to 4 (the GPU pads to whole words) |
| Tangent | 4 floats | 4 normalized signed bytes | 16 to 4 |
| Texture coordinates within 0 to 1 | 2 floats | 2 normalized 16-bit integers | 8 to 4 |
| Texture coordinates outside 0 to 1 | 2 floats | Floats | 8 |
| Positions, colors, joints, weights | As the accessor gives them | As the accessor gives them | Unchanged |

These are the types that the asset tool writes and that [D-25](D-25-vertex-types.md) draws. A typical vertex of position, normal and texture coordinates goes from 32 to 20 bytes. Positions stay floats: their integers would need a scale on the node, which only the tool can write. Draco's own quantization of texture coordinates can land a value a hair outside 0 to 1, such as 1.00000024 in the test file. Values within half a 16-bit step of the range count as inside it.

### Broken and hostile data

The decoder rejected each broken input at once, on the Mac in Node, without growing its 16 MiB of memory:

| Input | Decoder's answer | Time |
| --- | --- | --- |
| RiggedSimple's Draco data cut to 100 bytes | Failed to decode geometry data | 0.2 ms |
| No bytes | Failed to parse Draco header | under 0.1 ms |
| 2,000 bytes of a pattern | Not a Draco file | under 0.1 ms |
| Every seventh byte changed | Failed to decode geometry data | 0.1 ms |
| A run of 0xFF over each header byte from 8 to 23 | An error for each | under 0.3 ms each |

The decoder's memory may grow to 2 GiB and never shrinks. So:

- Before the decoder copies out an array, the array takes its bytes from the file's budget, and the decoded counts must equal the counts of the accessors. Those counts pass the file's limits first.
- A decoder instance that throws, or whose memory has grown past 64 MiB (the decoded size that any file may reach), is spent. The worker drops it and starts a fresh instance from the compiled module for the next file, so the old memory goes.
- A file whose Draco data does not start with `DRACO` fails before the decoder sees it.

The spec says that the accessors "must match the decompressed data". three.js ignores the accessors' counts. The engine checks them, because they are what the file's limits are checked against before the decode.

### Tests

- Unit tests (`tests/lib/draco-decoding.test.ts`) with the shipped decoder. The Khronos RiggedSimple Draco model gives the triangles of its uncompressed twin, each vertex within 0.005 of its twin's position, normals within 0.02, the same joints and weights within 0.01. The test file's texture coordinates match its source within 0.001. Six broken files each give E1416, and a fresh decoder reads the whole file after a spent one.
- `tests/lib/draco-fixtures.test.ts` checks that the test file is what the encoder builds, and `tools/lib/draco-vendor.test.ts` that the vendored files are the pinned release's.
- Image tests on all three tiers: `gltf-rigged` (new references), and `gltf-draco-rigged` and `gltf-draco-texture-coordinates`, which match their uncompressed scenes' references within the default tolerance, on the Mac's GPU and on SwiftShader. The parity check compares all three with three.js's `GLTFLoader` and `DRACOLoader`: 0.000% of the pixels differ on every tier in both sets (8 October 2026). The rigged scenes needed a fixed frame, since three.js's bounds of a skinned mesh hold the pose.
- A browser test in each thread mode on both GPU paths loads both Draco files, refuses a broken one with E1416, and loads the test file again. The page downloads the decoder's script and module once, and pages without Draco files download neither.

## Decision

Option (a), with the quantized types and the checks above.

## Options rejected

- Decoding in the job workers through `runTask`. The decoder runs where the file is parsed ([D-54](D-54-addon-modules.md#built)), and a task per primitive would copy every compressed and decoded array between threads twice.
- Keeping floats, as three.js does. The memory of the attributes above would double, and the asset tool already writes the smaller types.
- Loading files whose counts differ from their accessors, as three.js does. The counts bound the decode's allocations, and the spec requires them to match.

## Consequences

- `KHR_draco_mesh_compression` joins the extensions that the loader reads. E1417 no longer names Draco as its example.
- The size report lists `draco_decoder_gltf.wasm` among the first-use modules, with the exception of D-14, and the decoder's script as a part that the glTF worker loads.
- `THIRD-PARTY-NOTICES.txt` holds Draco's notice. The offline list puts the decoder under the `gltf` feature.
- `docs/concepts/assets.md` says when a Draco file is worth keeping. The three.js mapping turns `DRACOLoader` into a direct entry.
