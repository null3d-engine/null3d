# D-59: Limits on what one untrusted file may decode to

Status: decided. Date: 2026-10-04. Task: M2-R17.

## Question

A game can load model and texture files that its users made, or files that are broken. The review of 4 October found small files that hold the glTF worker for minutes or make it allocate hundreds of megabytes. What limits does each file get, and how are they checked before anything allocates? And how do the decoders still to come share them: Draco, WebP and AVIF images, and UASTC HDR textures?

## Rule

- A file that passes a limit fails before the allocation, with a code that says how to fix it. It never holds a thread for more than a moment.
- Every sample model and test model loads, with room to spare. A real model never meets a limit that a hostile file needs.
- One object holds the limits, and every reader of files takes its numbers from it, so a new decoder cannot forget one.

## What the review found

| Finding | File | Before |
| --- | --- | --- |
| R1-02 | An accessor of the type `constructor`, at the largest count | `TYPES["constructor"]` is a function, every size check passes, and the copy loop runs 2^31 times: about 11 minutes per accessor |
| R1-03 | 50 primitives that name one accessor without a buffer view, 1,832 bytes | 600 MB of zeros, one copy per primitive |
| R1-03 | A triangle strip of 89 million 8-bit vertices | A triangle list of 1.07 GB, with no check of its own |
| R1-04 | A chain of 80,000 nodes, 1.7 MB | 7.5 s for the parent loop check, which walks up from every node |
| R4-02 | A clip of 32 tracks with keys at 0 s and 34,000 s, 1 KB | 11.4 s of resampling, and a 261 MB clip, because the limit counted frames and not frames times tracks |
| R4-06 | A stored tree whose empty slot holds a box of infinite size | The reader accepts it, and the first query follows the empty slot and stops the engine |
| R5-04 | A mesh of millions of vertices with normals to compute | The allocation fails inside the core, which stops for good |
| R1-10 | A KTX2 file that says it holds 16,384 x 16,384 texels | The whole chain transcodes before the core refuses the size: about 360 MB for an 8,192 file |

## Data

### What real models decode to

The parser read every glTF file of the sample content and of the test pages' models, 249 files in all. The budget counted every allocation. The sample content holds the 28 Khronos models, the 213 Kenney city models and the Knight.

| Measure | Value |
| --- | --- |
| Largest ratio of decoded bytes to file bytes | 2.92: the asset scene with meshopt compression and levels of detail |
| Ratio of the other meshopt files | 2.55 to 2.88 |
| Ratio of uncompressed files | 1.00 or less: the images are the bulk, and they are copied once |
| Largest decoded total | 11.2 MB (MetalRoughSpheres) |
| Files that a ratio of 4 with no floor refuses | 0. A ratio of 2 refuses 4 |

D-34 measured meshopt at 6.9 times on a dense grid (8.98 MB from 1.31 MB). Draco compresses meshes further than meshopt does, so its files decode to more times their bytes. Blender writes morph targets as sparse accessors, which decode to zeros where a vertex does not move. 50 shape keys over 20,000 vertices decode to 12 MB.

### The hostile files after the fix

Bun 1.3.14 on the Mac, `parseGltf`, scratch timing script:

| File | Bytes | Time | Result |
| --- | --- | --- | --- |
| An accessor of the type `constructor`, count 2^31 - 1 | 5,124 | 2.7 ms | E1416: "accessor 0 has the type constructor" |
| 50 primitives on 50 accessors of zeros | 5,792 | 13.7 ms | E1416 at the sixth accessor: 68.7 MiB past the file's 64.2 MiB |
| 50 primitives on one accessor of zeros | 1,832 | 2.3 ms | Loads, with one 12 MB copy that the primitives share |
| A chain of 20,000 nodes | 409,109 | 34 ms | Loads |
| A chain of 80,000 nodes | 1,669,109 | 271 ms | Loads; 7.5 s before |
| A chain of 200,000 nodes | 4,289,109 | 623 ms | Loads; the JSON parse is most of it |

The clip of R4-02 is refused before the core allocates a key. Each of the six views of the meshopt test file decodes to 2,097,150 zero vertices of 16 bytes. The file is refused at its third primitive, at 168 MiB against the 160.1 MiB that its 3 MB allow.

How the data was produced: `bun` scripts in a scratch folder ran `parseGltf` over the sample content at commit c52dda2 and over `tests/pages/assets`. A wrapper around `FileBudget.prototype.take` recorded each file's peak. `bun test packages/engine/src/scene/gltf-hostile.test.ts` and `cargo test -p null3d-core --test animation --test bvh` hold the files as tests. Each glTF file test of `gltf-hostile.test.ts` fails or hangs against the parser before the fix.

## Decision

`packages/engine/src/scene/file-limits.ts` holds `FILE_LIMITS` and `FileBudget`. The module imports nothing, so the glTF worker and each loader that loads on first use hold their own copy.

| Limit | Value | Reason | Code |
| --- | --- | --- | --- |
| `itemBytes`: one decoded array, view or texture | 256 MiB | WebGPU's portable limit on a buffer's size, which no mesh page passes anyway | E1416, E1412 |
| A model file's decoded total | 64 MiB + 32 x the file's bytes, up to 1 GiB | The floor lets a small file with sparse morph targets decode freely. Real files reach 2.9 times their bytes, meshopt 6.9 at most, so 32 leaves room for Draco. The cap is the engine's default memory, which a larger total could never fill | E1416 |
| `textureLayers`: layers of one texture file | 256 | WebGPU's default limit on array layers | E1412 |
| The sides of one texture file | `textures.maxSize` of the device | Checked from the KTX2 header, before the transcoder starts | E1412 |
| The mip levels of one texture file | `floor(log2(longest side)) + 1` | A chain cannot hold more levels | E1412 |
| Keys of one clip, frames times tracks | 4,194,304 (`MAX_CLIP_KEYS` in the core) | Resampling holds about 28 bytes per key at its peak, so about 112 MiB. That is 23 minutes at 30 keys per second for a 65-joint rig, or 45 seconds for the largest skeleton's 3,072 tracks | E1218, E1416 from `loadGltf` |

The budget counts what a reader allocates, not what it reads in place. A view of the file's own bytes costs nothing. Each accessor's copy is made once and shared by every primitive that names it, since no code changes it. So the budget counts accessor copies, decoded meshopt views and triangle lists from strips and fans. It counts 8-bit indices widened to 16 and floats made from normalized integers. It also counts morph targets that leave an attribute out, the joints of each skinned copy and each embedded image.

Texture files do not count against a model's total. An ETC1S texture can transcode to 450 times its bytes as RGBA8 on a device without compressed formats, so a ratio would refuse real textures. The side and byte limits bound a texture instead.

Rejected:

- A fixed total per file, with no ratio. A 40 MB city of meshopt files would decode past any fixed number that also stops a 2 KB bomb quickly.
- A total tied to the engine's own memory maximum. The worker does not know it, and the cap of 1 GiB already matches the default.
- A limit on vertices per mesh with its own code. The model total bounds the arrays, and the core's fallible building gives E1109 for meshes from `geometry.fromArrays`.

### Text keys

Tables keyed by text from the file (accessor types, meshopt modes and filters, animation paths and interpolations) are `Map` and `Set` objects. A plain object answers `constructor`, `toString` and `__proto__` with its prototype's members. The component table stays an object, because the parser looks it up with `Number(...)`, which never names such a member.

### The parent loop check

Each node has at most one parent, which the parser checks first. So a walk down from the nodes without a parent reaches every node that is not in a loop or below one. One walk visits each node once. A node that it misses walks up as many steps as there are nodes, which lands inside the loop, and the error names that node.

### Mesh building in the core

In `from_arrays`, `try_reserve_exact` reserves each buffer whose size follows the mesh:

- the index list and the adjacency
- the normals and tangents of faces and vertices
- the float copies of integer arrays
- the interleaved vertices and the index copy

Then `MeshStorage::add` reserves the page's room for the vertices, the indices and the edge list before it changes a page. A mesh that does not fit fails with E1109, the storage holds no part of it, and the engine runs on. The limits page asks for a mesh of 12 million vertices with normals to compute, and draws a batch after the refusal.

### Stored trees

The reader requires each empty child slot to hold the empty box bit for bit, which `write` gives it. Each used slot's box and the tree's own box must be finite. The tree walks test four slots at once, so a slot with any other box sends a query into the empty word. M2-R16 adds a mask of empty slots to the walks. Either check alone keeps a damaged tree from stopping the engine.

### KTX2 format choice on WebGL2

On WebGL2, a device with BC7 now takes BC7 for both ETC1S and UASTC data, before ETC2 and ASTC. Mesa on desktop Linux offers ETC2 and ASTC on GPUs without them, and decodes such textures in software on the page's thread. three.js turns ETC2 and ASTC off on Linux Firefox when BC is present, by its user agent string. null3D decides from capabilities alone (hard rule 14), so the rule covers every WebGL2 device with BC. That is desktop Linux, and any other desktop that offers ETC2 or ASTC beside BC, such as a Mac forced onto WebGL2. On a Mac, an ETC1S texture without alpha then takes 16 bytes per block where ETC2 took 8. WebGPU keeps the old order: browsers offer a WebGPU format only where the GPU has it.

A KTX2 texture whose sides are not whole 4 x 4 blocks still loads as RGBA8, at 4 to 8 times the memory. Development builds warn with its size. The asset tool now writes sides of at least 4 texels, so every power of two it writes is a whole number of blocks.

### For the decoders to come

M2-A6 (Draco) and M2-A7 (WebP, AVIF and UASTC HDR) take their limits from `FILE_LIMITS`:

- Draco runs in the job workers through M2-R18's loader. Before it decodes a mesh, it takes the decoded attribute and index bytes from the file's `FileBudget`, as meshopt views do, and each array stays within `itemBytes`.
- WebP and AVIF images in a glTF file read their width and height from the image header before `createImageBitmap`. A side past `textures.maxSize` fails with E1412. The decoded bytes, 4 per texel, count against the file's budget. PNG and JPEG images should join this check: today the browser decodes them at any size the file claims.
- UASTC HDR textures pass `ktx2TooLarge` with their own format's bytes per block, as ETC1S and UASTC files do.

## Consequences

- `scene/file-limits.ts` holds the limits. `gltf-parse.ts`, `gltf-animation.ts` and `gltf-json.ts` take a `FileBudget`; `gltf-hostile.test.ts` holds the hostile files.
- `ktx2.ts` adds `ktx2TooLarge` and the WebGL2 rule; `Textures` keeps whether the engine draws with WebGL2.
- The core: `MAX_CLIP_KEYS` replaces `MAX_FRAMES`, and E1218's problem 5 is now `KEYS`, whose detail is the keys the clip would hold. The stored-tree reader adds `FormatError::EmptySlot`. `ArraysError` and `MeshError` add `OutOfMemory`, which the WebAssembly entry point reports as E1109.
- The glTF loader passes E1109 from a mesh through, instead of wrapping it in E1416.
- The asset tool's `textureSize` keeps each side at 4 texels or more.
- `concepts/assets` lists the limits; `api/assets`, `api/textures` and the pages of E1109, E1218, E1412 and E1416 name them.
- The record is in the table in [README.md](README.md).
