# D-184: Bound a KTX2 file's level index before the transcoder allocates it

Status: decided and built. Task: M2-R17, the limits of [D-59](D-59-file-limits.md).

Summary: The KTX2 reader checks the level index that follows the header, and both the loader and the worker take their answer from it. The index declares the bytes each level decompresses to, and the transcoder allocates that count in its heap before it decompresses anything. Unchecked, a 149-byte file that declares 1 GiB grows the worker's heap by 1,024 MiB for the worker's life.

## Question

What stops a small KTX2 file from making the transcoder allocate hundreds of megabytes before it refuses the file? D-59's table records the KTX2 sides, layers and mip levels as checked "from the KTX2 header, before the transcoder starts". Which counts of the file does that cover, and which does it leave to the transcoder?

## Rule

- A reader checks every count of a file against the limits before it allocates ([D-59](D-59-file-limits.md)).
- A file that passes a limit fails before the allocation, with a reason that names what is wrong.
- A bound may not refuse a file that the engine loads: it sits at or above the largest value a legitimate file gives.

## Data

The reproduction: `tests/pages/assets/textures/quarters-uastc.ktx2` is 1,407 bytes. A copy with both size words of its header set to 16,384, and nothing else changed, makes the transcoder grow its heap by 253 MiB before it refuses the file.

The smallest file that a reader without the index check accepts, and that the transcoder then tries to decompress, is 149 bytes. It is a 64 x 64 UASTC texture with Zstandard supercompression, one mip level and one byte of level data. One field of it differs from the repository's file: the level's declared decompressed length.

One 32-bit word of the index is not enough, which is why a sweep of single header words comes back empty. The two size words of the header are separate fields, and either one alone stays under a megabyte; both together cost 253 MiB. The cheapest single change is the level's declared length, eight bytes, and no header word at all.

Each figure is the transcoder's own `Module.HEAP8.buffer.byteLength`, which never shrinks under `ALLOW_MEMORY_GROWTH`. The process figures are the maximum resident set size of `/usr/bin/time -l`. Each run started alone, while the Mac carried other work, so the figures below are loaded ones.

| A 149-byte file that declares | Heap before the refusal, without the index check | Heap before the refusal, with it |
| --- | --- | --- |
| 16 MiB | 15 MiB | none: refused at once |
| 64 MiB | 64 MiB | none |
| 256 MiB | 256 MiB | none |
| 1,024 MiB | 1,024 MiB, process peak 1,089 MiB | none, process grew under 1 MiB |

The declared length is allocated before the output format is used, so every format pays the same figure. Measured through the worker's task as both ASTC and RGBA8, a file that declares 1,024 MiB grows the heap by 1,024 MiB without the check, and the process by nothing with it.

The sides of the file feed a second allocation, and the format does size that one: the same file with both size words at 16,384 grows the heap by 253 MiB as ASTC and by 1,024 MiB as RGBA8. D-59 refuses that count on the loader's thread, and the worker refuses it too.

| Work | Without the index check | With it |
| --- | --- | --- |
| `bun test packages/engine/src/scene/malformed-files.test.ts`, peak | 1,694 MiB | 264 MiB |
| The same check's transcodes of the five legitimate fixture files | 22 of 22 file and format pairs write the reference build's bytes | 22 of 22 |

How the data was produced: `bun` scripts sent files to the transcoder's task through `serveTasks`, as the worker does. The 149-byte shape was built by a script of that measurement, from the header and the descriptor of `quarters-uastc.ktx2`. That file's own 1,407-byte shape, whose first level claims 256 MiB, is held by `ktx2.test.ts` and by `malformed-files.test.ts`. The check's figures are its own runs: without the index check on the revision the branch started from, and with it on the branch.

### Can an ordinary page reach it?

Yes, which is why this is a page's memory and not only a test harness's.

The loader is the only path to the transcoder. `assets.loadTexture` on a `.ktx2` file, and each image of a glTF file that names one, end in `loadKtx2`, which reads the file's header and checks it against the device's limits before it sends the file to the worker. Without the index check, the hostile file passes both of those checks: measured, the reader accepts it and `ktx2TooLarge` gives no reason to refuse it. The worker then receives it, and its run of a 1,024 MiB claim grows the process by 759 MiB before the refusal.

Measured through that loader, with a stub in place of the worker, a reader without the index check starts one worker for the file. With the check, the loader starts none and refuses the file with E1412.

A site that loads users' files can therefore be made to hold hundreds of megabytes by one asset with one field changed. That is any texture file, not a file the engine wrote: a model pack, a download, or a file a player uploaded.

The transcoder is reachable by no other route. The only caller of its task in the engine is that one step of the loader, and the only other callers of the module are `tools/lib/basis-transcoder.ts` and the tests, which read the repository's own files. So the check belongs in the reader that both the loader and the worker use, as the folder's limits rule says, and not inside the transcoder alone.

## The counts the header does not give

A KTX2 file is an 80-byte header, a level index of three 64-bit numbers for each level, a data format descriptor and the levels' data. D-59's reader, `readKtx2Header`, reads the header and the descriptor. It reads none of the index, and the index gives each level's data range and the bytes it holds once decompressed.

The transcoder's `ktx2_transcoder::decompress_level_data` takes that last number and resizes a WebAssembly-side vector to exactly it. It calls Zstandard only afterwards, and Zstandard fails on a file whose data cannot hold the claim. Its own checks bound the number below 2,048 MiB. That is a limit on the transcoder, not on the engine's textures: the engine's largest texture is 4096 texels a side (D-59's `textureSide`).

The transcode also allocates the target format's size for each level. The transcoder computes that from the header's sides, which D-59 does check.

## Decision

`packages/engine/src/scene/ktx2-file.ts` holds the reading of a KTX2 file, the format choice and the sizes, and imports only `scene/file-limits.ts`. Both the loader (`ktx2.ts`) and the transcoder's task (`ktx2-transcode.ts`) read a file with it, so the two agree on what the engine loads. A worker's bundle then holds none of the loader's task client or its cache. Read one of those two files, not the other's copy.

`readKtx2Header` reads the level index and refuses a file whose index asks for more than its own texels hold:

| What is checked | Bound | Reason it cannot refuse a legitimate file |
| --- | --- | --- |
| A level's declared decompressed bytes | The level's own texels at 16 bytes to a 4 x 4 block, or `itemBytes`, whichever is smaller | Every codec the engine loads stores whole blocks, and UASTC's 16 bytes a block is the largest of them. ETC1S data is 8 bytes a block, so the bound is generous for it |
| The same, for BasisLZ data | Must be zero | `init` of the transcoder requires zero, and every ETC1S file writes zero |
| The same, for Zstandard data | Must be given, and within the bound above | `init` requires it, and a Zstandard level holds exactly its texels' bytes |
| Each level's data range | Inside the file, at or after the header | The transcoder requires the same |
| The high word of all three numbers, and the level count | Zero, so no count reaches 4 GiB; the level index must fit in the file | No texture the engine loads is that large, and a larger count cannot be indexed |

The transcoder's task reads the file itself, before it constructs the transcoder. It sizes its output buffer from the engine's own count of the texels, and refuses the file when the transcoder counts differently. The request carries the device's texture size, so the task applies the loader's own device bound rather than trust the bytes it was sent. Without these steps the task would hand the file to the transcoder unchecked, and the transcoder's own count would size the buffer.

Rejected:

- A bound in the transcoder's C++ only. The engine vendors a build of Basis Universal v2.50, so a change there means rebuilding and re-verifying the WebAssembly module. The engine's limits are the engine's to state, and the reader of the file is the engine's.
- A bound on the whole index's total only. The transcoder allocates one level at a time, so a file may pass a total and still ask for too much at one level.
- The check in the loader alone. The worker is a reader of a file that comes from another thread; an unchecked file there is the defect, whatever the loader does first.

## Consequences

- `scene/ktx2-file.ts` holds `readKtx2Header`, `ktx2Target`, `ktx2TooLarge`, `transcodedBytes`, the target formats and the level index checks. `scene/ktx2.ts` keeps the task, the cache and the loads. `malformed-files.test.ts` and `ktx2.test.ts` read that module.
- `ktx2.test.ts` holds the reachability: a file whose level claims 256 MiB gives E1412 from `assets.loadTexture` and starts no worker, so a change that sends an unchecked file to the transcoder fails it.
- The two KTX2 readers keep their own copies of the file identifier and of the header reading on purpose, and `ktx2-file.ts` says so where a tidy-up would start. The environment map reader serves the tool's cube maps, with their own limits and their own dialect, and one module that both import would leave the KTX2 feature's files and load with every page's start.
- `TranscodeRequest` carries `maxSize`, the device's texture size, which the loader has already read the file against.
- `packages/vite-plugin/src/offline.ts` lists `scene/ktx2-file` under the KTX2 feature, so an offline build groups it with the feature and not with the page's start.
- D-59's table of KTX2 limits holds the level index. Sides, layers, mip levels and declared level sizes are all checked before the transcoder starts.
