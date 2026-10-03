# D-18: How the asset tool is built

Status: decided by the owner, 2026-10-03, from the research of that day; measured on S6's content with the built tool, 2026-10-04. Date: 2026-10-03. Task: M2-B1.

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
| Compression | None by default; `--compression meshopt` writes `EXT_meshopt_compression`, lossless | The engine reads meshopt only once M2-A3 lands. glTF-Transform writes the EXT form only, and the KHR form waits for the engine's decoder |
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

### How three.js handles it

three.js has no asset tool of its own. Its users run other tools, such as gltfpack or the command-line tool of glTF-Transform. For textures, glTF-Transform starts the native `ktx` command of KTX-Software. The npm build of gltfpack has no texture compression. So KTX2 textures need a native install either way. null3D ships one tool on npm with the encoders inside. A project needs no other install.

## Consequences

- `packages/cli/src/assets/` holds the tool: the command, the steps for meshes and textures, the encoder's threads, the budget report and the formats module.
- `crates/null3d-assets-wasm` builds the formats module into `packages/cli/dist/assets.wasm`. `bun run build` makes it, and the CLI's package holds it.
- `@null3d/cli/assets` exports the steps, and `@null3d/vite-plugin` loads them on the first `?optimized` import. The plugin names the CLI as an optional peer, so a project that imports no model installs no encoder.
- When M2-A3 lands, meshopt compression becomes the default in `DEFAULT_OPTIONS` of `packages/cli/src/assets/pipeline.js`. The image test `asset-scene-optimized` then draws the compressed output.
- The test scene in `tests/lib/asset-scene.ts` and its outputs in `tests/pages/assets/models/` change only with the tool. `NULL3D_WRITE_ASSET_SCENE=1 bun test packages/cli/src/assets/optimize.test.ts` writes them again.
- Open: layered KTX2 files that group textures of one size. Today the engine gives each compressed texture an array of its own, since compatibility mode copies no compressed texels. So the tool keeps one file per texture and reports the groups.
- Open: a 64-bit encoder for 4096 x 4096 textures, if a scene needs them.
- M2-B3 reads FBX with ufbx built to WebAssembly, by the owner's answer. M2-B4 writes blocker meshes and BVHs through the formats module.
