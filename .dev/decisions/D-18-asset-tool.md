# D-18: How the asset tool is built

Status: decided by the owner, 2026-10-03, from the research of that day. Measured on S6's content with the built tool, 2026-10-04. The clip step measured and added, 2026-10-05, with near-constant tracks stored once by the owner's ruling of that day. Date: 2026-10-03. Tasks: M2-B1, M2-B7.

## Question

`bunx @null3d/cli assets optimize` turns glTF models into files that load and draw fast. Their meshes are quantized and reordered for the GPU's vertex cache, with levels of detail on request, and their textures are KTX2 files. Later commands add environment maps, conversions, blocker meshes and prebuilt BVHs. Which language and which encoders build the tool? And where do the formats that both the tool and the engine read come from?

## Rule

- Users install nothing native. The tool comes from npm and runs in Node or Bun.
- The same input gives the same output bytes on every machine. CI can then check an output that a laptop wrote, and a cache key can name a result.
- A format that the tool writes and the engine reads has one source.
- The tool's choice must not slow the files it writes, in load time or in drawing.

## The options

The research of 3 October weighed four options.

| Option | Encoders | Install | Same bytes everywhere | Own code |
| --- | --- | --- | --- | --- |
| A. JavaScript on the official WebAssembly encoders, shared formats in Rust built to WebAssembly | Basis Universal's own WebAssembly encoder, meshoptimizer's npm package, glTF-Transform | About 4 MB of JavaScript and WebAssembly, nothing to compile | Yes: one WebAssembly build, single-threaded | Least |
| B. Rust throughout, a native binary for each platform | Basis and meshoptimizer bound from Rust | One binary of 5 to 10 MB per platform, 6 to 8 targets to build and sign | No: native builds wrote different bytes with each thread count, and on x86 and ARM | Most: bindings to Basis 2.50 and the glTF passes again |
| C. Option A, with a native fast path for local work | As A, plus a native encoder when one is installed | As A, plus an optional native package | Only on the WebAssembly path | Two paths to test |
| D. Option A, also run by the Vite plugin with a cache | As A | As A | Yes | A cache and a dev server route |

The language does not change what the files cost the engine. With one encoder version and the same settings, native and WebAssembly builds wrote files within 0.02% of each other in size. The GPU formats were the same. Load time and frame time follow the settings: ETC1S or UASTC, the bits of each vertex stream, the meshopt codec, and the levels of detail.

## Data

### From the research, 3 October 2026

Single textures, MacBook Pro (Apple M5 Max, 18 cores), Node 24.2, default settings with mip levels:

| Job | Native, all cores | Native, one thread | WebAssembly, one thread | Output |
| --- | --- | --- | --- | --- |
| ETC1S, 2048 x 2048 color | 2.1 s | 28.9 s | 49.9 to 57.3 s | 766,184 to 766,538 bytes |
| UASTC, 2048 x 2048 normal map | 15.8 s | 141 s | 136 s | 5,415,947 bytes in all |
| meshopt, a 38 MB model | 1.38 s | | 1.64 s | 14,471,728 bytes in both |

- Bytes: native ETC1S on all cores and on one thread wrote different bytes. Native and WebAssembly wrote different bytes for ETC1S and UASTC. Two WebAssembly runs wrote the same bytes.
- The 32-bit WebAssembly encoder refuses more than 12,582,912 source texels. 4096 x 2048 works, and 4096 x 4096 fails.

### The built tool on S6's content, 4 October 2026

S6's textures are the 40 ambientCG texture sets of the sample content. They hold 144 images of 1024 x 1024 and 1024 x 512, as color, normal, roughness and occlusion maps. A generated glTF file gives each set one material. The tool encodes color and data maps in ETC1S at quality 128 and effort 2, and normal maps in UASTC with Zstandard. The native runs used the basisu 2.50 command with the same settings: `-q 128 -comp_level 2`, and `-uastc -normal_map` for normal maps. Other helpers worked on the Mac during these runs, at load averages of 9 to 30, so the times are rough.

| Run | Wall time | CPU time | Texture files |
| --- | --- | --- | --- |
| The tool, one texture per thread, 18 threads | 26.1 s, and 17.9 s on a second run | 130 s, and 177 s | 37,753,165 bytes |
| The tool, 4 threads | 104.9 s | 150 s | The same bytes |
| Native basisu, one texture at a time on all cores (option B's way) | 129.8 s | | 38,508,561 bytes |
| Native basisu, one thread per texture, 18 at once | 30.1 s | | The same 38,508,561 bytes |

One texture of 1024 x 512 on one thread:

- ETC1S: the native command took 1.9 s of CPU time. The tool's worker took 1.3 to 5 s, and it also decodes the JPEG.
- UASTC normal map: the tool took 0.7 to 1.3 s, and the native command 3.4 s.

So on a texture set, one WebAssembly encoder per thread keeps up with the native encoder. One texture at a time on all cores is the slowest way.

| Measure | Value |
| --- | --- |
| Texture files by kind | 40 ETC1S color maps, 4.5 MB; 64 ETC1S data maps, 6.4 MB; 40 UASTC normal maps, 26.8 MB |
| GPU memory of the textures with every mip level | 100 MiB with ETC2 and ASTC; 156 MiB with BC7 only; 624 MiB as RGBA8 |
| Peak memory of the run with 18 threads | 3.8 GB |
| The four Kenney city kits: 213 models | 10.5 MB to 2.5 MB in 2.4 s |
| The same with `--lod` | 2.9 MB; 91 meshes got levels |
| Bytes with 4 threads against 18 | The same in all 141 files |
| Bytes in Node against Bun | The same |

How the data was produced:

- The tool: `node packages/cli/bin/null3d.js assets optimize materials.gltf out --report report.json`, and the same with `--jobs 4`, timed with `/usr/bin/time -l`.
- The native runs: a script that ran `basisu` on the same 144 images, with and without `-no_multithreading`.
- The unit test `optimize.test.ts` checks the bytes of the test scene's outputs against the files in the repository. So each CI run on Linux checks that its bytes match the Mac's.

### The clip step, 5 October 2026

Prototype A2 measured the clip step on the sample content's animated models. The KayKit Knight has 76 clips and 8,712 channels. Its keys made about nine tenths of the binary part of the output without the step. Sizes are of the binary part of each `.glb` after Brotli at quality 11. Textures are separate files and not counted.

| Model | Without the step | With the step |
| --- | --- | --- |
| KayKit Knight | 838,350 B | 455,487 B (-46%) |
| Fox | 45,737 B | 26,805 B (-41%) |
| RiggedSimple | 1,948 B | 1,443 B |
| RecursiveSkeletons | 2,186 B | 1,364 B |
| BoxAnimated, InterpolationTest, MorphStressTest | 1,490; 585; 13,309 B | 1,888; 1,091; 14,196 B |

The last three grow by under 1 KB each, because their widely spaced or cubic keys become a key per frame. With `-c`, gltfpack 1.3 gives the Knight 434,451 bytes. It drops 4,532 constant tracks and keeps 16 bits of each translation's mantissa. The step does neither.

The Knight's changing rotation keys, after the step, by how they are stored:

| Form | After Brotli |
| --- | --- |
| 16-bit integers, uncompressed | 267,347 B |
| 16-bit integers, meshopt's attribute codec | 216,310 B |
| meshopt's quaternion filter at 16 bits | 172,750 B |
| The filter at 12 bits | 115,068 B |

Writing the one-key tracks after all changing keys, not between them, saved the Knight 25 KB more.

Near-constant tracks: 459 of the Knight's translation tracks and 519 of its scale tracks move by under a millionth, rounding noise from the exporter. The owner ruled on 5 October 2026 that such tracks count as constant, in the core for every file ([D-26](D-26-animation-clips.md#near-constant-tracks-5-october-2026)). The tool follows the core, so they keep one key. The Knight's binary part then falls from 455,487 B to 404,663 B after Brotli, 7% under gltfpack's 434,451 B. Poses do not change at three significant digits.

Poses: the `gltf-poses` test plays each sample model's clips after the tool on the source's skeleton, against three.js r186 on the source file. The Knight differs by 6.65e-5 in a skinning matrix's rotation and scale, against 6.80e-5 for the source file. RiggedFigure moves from 4.14e-5 to 6.44e-5 and InterpolationTest from 2.43e-4 to 2.68e-4. The others do not change. The limit is 1e-3 ([D-35](D-35-gltf-animation.md)).

Load: every model's output loads with no clip resampled. In the same test, the Knight's clips were ready in 7.9 ms on two job workers. From the source file they took 16.5 ms, and the core resampled 69 of the 76 clips. Parse time did not change measurably.

How the data was produced: `node packages/cli/bin/null3d.js assets optimize` on main and on the branch, and `bunx gltfpack@1.3.0 -c`. A script split each binary part by buffer view and compressed each part. The poses and load times came from `cd tests && NULL3D_PORT=14273 bunx playwright test gltf-poses.spec.ts`, in Chrome on the Mac.

## Decision

The owner chose option A with D on 3 October 2026, for three reasons:

- The language does not change load or run speed.
- Native code is faster on one large texture, but writes different bytes on each CPU and thread count.
- Only one WebAssembly build gives the same bytes on every machine.

Textures are capped at 2048 x 2048, which the 32-bit encoder takes. A 64-bit build for Node is the way to lift the cap later.

### What the tool is

- The command-line tool is plain JavaScript with JSDoc types, which TypeScript checks, as the rest of `@null3d/cli` is. It ships unbuilt, so it needs no build step.
- glTF-Transform's `core` and `extensions` packages read and write the files. Its `functions` package is left out: it depends on `sharp`, a native image library of about 27 MB, which breaks the rule. The tool's own passes do the work with meshoptimizer: reorder, simplify and quantize.
- Textures: the official Basis Universal 2.50 encoder for JavaScript, unchanged in `packages/cli/vendor/basis`. It comes from the same release as the engine's transcoder, and a test pins its SHA-256.
- Pure JavaScript decoders read PNG (fast-png) and JPEG (jpeg-js), and the tool resizes in its own code. That code only adds, multiplies, divides and rounds. It reads sRGB values from a written table, not from `Math.pow`. So every JavaScript engine computes the same pixels.
- Each texture encodes on a worker thread of its own, on one thread inside the encoder. The output does not depend on the thread count, and a set of textures uses every core.
- The formats shared with the engine come from the engine's Rust core. The `null3d-assets-wasm` crate builds them to WebAssembly, as the shader compiler is built. Its first format is the stored mesh BVH of [D-27](D-27-bvh.md): `meshBvh` in `packages/cli/src/assets/formats.js` returns `MeshBvh::to_bytes()`. M2-B4 writes it into model files for large static meshes, through this function.
- The Vite plugin runs the same steps on a model that a module imports with `?optimized`. It keeps the result in `node_modules/.cache/null3d-assets`, keyed by the hash of the model's files, the tool's version and the options.

### The settings

| Step | Setting | Why |
| --- | --- | --- |
| Positions | Unsigned 14-bit integers in 16 bits, plain, in steps of 1/16,383 of the longest side of the mesh's group | gltfpack's default; meshopt compresses fewer bits better. A 100 m building gets 6 mm steps |
| Normals, tangents | Signed bytes, normalized | gltfpack's default; the test scene's normals stay within 0.02 of their sources |
| Texture coordinates | 16-bit normalized integers when every value lies from 0 to 1, else floats | Values past 1 would need a texture transform, and the engine's materials keep one transform for all maps |
| Colors, joint weights | Normalized bytes; weights keep their sum at one | |
| Index buffers | 16 bits when the vertices allow | |
| Compression | `EXT_meshopt_compression` by default, lossless; `--compression none` leaves it out | The engine decodes meshopt in its loader's worker and downloads the decoder only for such files ([D-34](D-34-meshopt-decoding.md)). glTF-Transform writes the EXT form only, which the engine reads as it reads the KHR form |
| Levels of detail | A half, a quarter and an eighth of the triangles, under an error of a tenth of the mesh, in `MSFT_lod` | The extension that exists for levels; three.js and the engine ignore it until they read levels |
| Texture sizes | Each side at its nearest power of two, then halved together to fit 2048 | Full mip chains, and fewer sizes for the engine's texture arrays |
| ETC1S | Quality 128, effort 2 | The basisu command's defaults |
| UASTC | The default level, no rate-distortion pass, Zstandard | Normal maps keep their detail |

The tool picks each texture's format from the material slots that read it. Base color and emissive maps take sRGB, normal maps the normal map settings, and every other map linear values. Normal maps always take UASTC, since ETC1S blurs them. `--texture-quality high` gives color and data maps UASTC too.

The dequantizing transform goes where it moves nothing else:

- A node that has only the mesh takes it in its own transform.
- An instancing node puts it in each instance.
- A skin puts it in its inverse bind matrices.
- A node with children, a camera, a light, an animated transform or a place in a skeleton keeps its transform. Its mesh moves to a new child node.

The simplifier keeps the seams where vertices at one place differ in normals or coordinates. In a mesh of flat faces, such as Kenney's buildings, every edge is a seam, and nothing simplifies. A level that saves too little tries again with the seams free to move. Before that change, 2 of the 213 Kenney models got levels, and after it 91 did.

### Clips

The engine keeps each clip at one fixed rate of keys ([D-26](D-26-animation-clips.md)). Its loader resamples a file's clips to that rate on the job workers ([D-35](D-35-gltf-animation.md)). The tool's clip step does that work once, before the files ship:

- The engine core's own `bake` puts each clip's tracks on the clip's frames. The tool calls it through the formats module (`clip()`), so the tool and the loader pick the same rate and evaluate curves the same way. All tracks of a clip share one input of frame times.
- A rotation that changes keeps a key per frame as 16-bit normalized integers, the form the core stores. They take meshopt's quaternion filter at 16 bits. Translations, scales and morph weights stay 32-bit floats, which meshopt compresses with no loss.
- A track that the core counts as constant keeps one key, at the clip's last time, so the clip keeps its length in every reader. That is a track whose keys move by under a millionth of its largest value, or of 1 ([D-26](D-26-animation-clips.md#near-constant-tracks-5-october-2026)).
- Step tracks stay step tracks. Cubic spline tracks become linear keys on the curve, the keys the core would store from it.
- Keys that change come first in the buffer, each path's together, then the one-key tracks.

The loader needs no marker. The core copies a track that holds one key, or one linear or step key at each frame's time. A key within a thousandth of a frame counts. The core resamples only the other tracks. So a file from another tool whose keys lie on frames also loads with copies. Other files still resample, within M2-R17's bound on frames times tracks. `Clip::resampled_tracks` counts the tracks that a clip resampled. The WebAssembly call `resampledClips` counts the clips.

Options left out:

| Option | Why not |
| --- | --- |
| Plain 16-bit rotations, no filter | 43 KB more for the Knight |
| The quaternion filter at 12 bits | Steps of 3.4e-4, past D-26's 2e-4 for a pose component |
| glTF-Transform's filter method for all accessors | Its exponential filter keeps 12 bits of each translation and scale |
| Dropping constant tracks, as gltfpack does | A clip blends only where it has tracks ([D-26](D-26-animation-clips.md)), so a dropped track changes how it blends |
| Fewer keys where the curve allows | The track's keys become uneven, so the loader would resample again |
Version 4.5.1 of glTF-Transform gives meshopt's filters to every accessor or to none. So the class `MeshoptWithRotationFilter` in `clips.js` extends its meshopt extension. After glTF-Transform groups the accessors, it switches only the buffer views of rotation keys to the quaternion filter. It reads three fields that glTF-Transform keeps for that step. The tests in `clips.test.ts` fail when a version changes them. They check that the quaternion filter is the file's only filter.

### How three.js handles it

three.js has no asset tool of its own. Its users run other tools, such as gltfpack or the command-line tool of glTF-Transform. Its `GLTFLoader` keeps a clip's keys as the file holds them, and searches for the keys around each time. So a resampled clip saves it nothing at load. It reads the step's files, with 16-bit rotations and the quaternion filter, and plays them as the engine does. For textures, glTF-Transform starts the native `ktx` command of KTX-Software. The npm build of gltfpack has no texture compression. So KTX2 textures need a native install either way. null3D ships one tool on npm with the encoders inside. A project needs no other install.

## Consequences

- `packages/cli/src/assets/` holds the tool: the command, the steps for meshes and textures, the encoder's threads, the budget report and the formats module.
- `crates/null3d-assets-wasm` builds the formats module into `packages/cli/dist/assets.wasm`. `bun run build` makes it, and the CLI's package holds it.
- `@null3d/cli/assets` exports the steps, and `@null3d/vite-plugin` loads them on the first `?optimized` import. The plugin names the CLI as an optional peer, so a project that imports no model installs no encoder.
- meshopt compression is the default in `DEFAULT_OPTIONS` of `packages/cli/src/assets/pipeline.js`, for the command and the Vite plugin alike. The image test `asset-scene-optimized` draws the compressed output.
- The test scene in `tests/lib/asset-scene.ts` and its outputs in `tests/pages/assets/models/` change only with the tool. `NULL3D_WRITE_ASSET_SCENE=1 bun test packages/cli/src/assets/optimize.test.ts` writes them again.
- Open: layered KTX2 files that group textures of one size. Today the engine gives each compressed texture an array of its own, since compatibility mode copies no compressed texels. So the tool keeps one file per texture and reports the groups.
- Open: a 64-bit encoder for 4096 x 4096 textures, if a scene needs them.
- M2-B3 reads FBX with ufbx built to WebAssembly, by the owner's answer. M2-B4 writes blocker meshes and BVHs through the formats module.
- The file `packages/cli/src/assets/clips.js` holds the clip step and `MeshoptWithRotationFilter`. The core's `bake` and the formats module's `clip()` give it the keys. Its tests check the keys against the source curves, the one-key tracks, the 16-bit rotations and the same bytes on two runs.
- The `gltf-poses` test loads each sample model after the tool too, and requires that no clip resamples.
