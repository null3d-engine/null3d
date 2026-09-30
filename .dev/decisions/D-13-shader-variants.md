# D-13: Shader variants

Status: proposed. Date: 2026-09-30. Task: M1-A6, with M1-L3 for the compile times. Tests: T-12, T-26.

## Question

How many shader variants does the engine build, and how do they reach a page? A feature that changes what a shader costs is a permutation bit, and a template builds one variant for each combination of its bits. The variants can ship in the file that draws, or in files that load on first use. WebGPU's override constants can also take the place of some WGSL variants. How long does a scene's warm-up then take?

## Rule

Stay within the 60 KB budget for the engine's JavaScript in each thread mode, with M1's permutation bits. Keep S4's warm-up on the S24+ within a target that T-26's data sets.

## Data

### Sizes

M1 plans five bits for the standard material: tone mapping in the shader (TONE_MAP), vertex colors, normal maps, alpha masks and shadows. The draw index of WebGL2's multi-draw is a sixth on that path. Only the draw index had shader code when this was measured, so stand-in code of each feature's size filled the others:

- The real tone mapping library of the HDR branch, with ACES, AgX and Khronos PBR Neutral.
- A color attribute that multiplies the base color.
- A tangent attribute, a TBN basis and a normal read from a texture array.
- A base color alpha against a cutoff, with `discard`.
- Four shadow cascades in a depth texture array, with a 3 x 3 filter.
- glTF metallic-roughness lighting in place of Lambert.

The lit template took all five bits and unlit took three. At five bits the build makes 41 WGSL modules and 82 GLSL programs. Each figure is the size report's own measure of a production build of the engine test page, with Brotli at quality 11. The builds start from commit 5612c46, where the pipelined page was 48.6 KB.

| Option at 5 bits | Pipelined page, WebGPU | Pipelined page, WebGL2 | Shader text that a WebGL2 page parses | Extra requests |
| --- | --- | --- | --- | --- |
| (a) Every variant in the file that draws | 57.6 KB (96%) | 57.6 KB (96%) | 1,644 KB | 0 |
| (b1) One file per GPU path, loaded on demand | 50.9 KB (85%) | 54.4 KB (91%) | 1,338 KB | 1 |
| (b2) One file per template and GPU path | 53.6 KB (89%) | 58.7 KB (98%) | 1,338 KB | up to 3 |
| (b3) One file per GPU path and per value of the bits a device fixes | 50.4 KB (84%) | 52.0 KB (87%) | 414 KB | 1 |
| (c) WGSL override constants, one file per GPU path | 49.8 KB (83%) | 54.3 KB (91%) | 1,338 KB | 1 |

The pipelined page at each bit count, for (a) and (b3):

| Bits | (a) | (b3) WebGPU | (b3) WebGL2 |
| --- | --- | --- | --- |
| 0 | 49.4 KB | 47.6 KB | 48.7 KB |
| 1 | 51.6 KB | 48.9 KB | 49.9 KB |
| 2 | 52.4 KB | 49.0 KB | 50.2 KB |
| 3 | 53.5 KB | 49.3 KB | 50.6 KB |
| 4 | 54.6 KB | 49.5 KB | 50.9 KB |
| 5 | 57.6 KB | 50.4 KB | 52.0 KB |

Compression matters. A host that compresses on the fly often uses Brotli at quality 5 or gzip:

| Pipelined page at 5 bits | Brotli 11 | Brotli 5 | gzip 9 |
| --- | --- | --- | --- |
| (a) | 57.6 KB | 63.7 KB | 98.4 KB |
| (b1), WebGL2 page | 54.4 KB | 59.0 KB | 86.9 KB |
| (b3), WebGL2 page | 52.0 KB | 56.3 KB | 64.0 KB |
| (b3), WebGPU page | 50.4 KB | 54.6 KB | 58.2 KB |

Other findings:

- Compiling the JavaScript of the 1,338 KB GLSL file took 9.6 ms in V8 and 8.0 ms in JavaScriptCore on the Mac. The 414 KB file of (b3) took 2.2 and 1.9 ms.
- naga cannot write GLSL from a module with override constants, so WebGL2 needs one program per combination under every option. GLSL is 80% of the shader text at five bits.
- WebGPU needs every vertex input of an entry point in the pipeline's layout. So a bit that adds a vertex input, such as vertex colors, cannot be an override constant. Under (c) such bits need vertex entry points of their own, four for lit.
- Under (c), a scene of lit and unlit objects with two bits in use made 2 WebGPU shader modules instead of 8. Browsers still turn each pipeline into GPU code on its own.

How the data was produced: a separate worktree of the branch held the stand-ins in the shader folder. A prototype of each option split the variants into files. The repository's build and size report then measured each option at each bit count. The scripts and every run's record are kept with the other maintainer notes of the task.

### The extra request

Cold loads of the engine test page's production build, pipelined, in Chrome 154 on the MacBook Pro. The network was Slow 4G, and the scene had lit and unlit objects. The two builds took turns, five loads each on each GPU path. In (b1) the render worker starts the file's download as soon as it knows its GPU path.

| GPU path | Build | First frame done, median | Fastest to slowest |
| --- | --- | --- | --- |
| WebGPU | (a) | 4,543 ms | 4,251 to 4,653 ms |
| WebGPU | (b1) | 4,511 ms | 4,230 to 4,639 ms |
| WebGL2 | (a) | 4,605 ms | 4,253 to 4,665 ms |
| WebGL2 | (b1) | 4,473 ms | 4,312 to 4,744 ms |

In the same run, the separate file's first frame came 30 ms later on WebGPU and 59 ms later on WebGL2, at the median. Loads of one build vary by about 400 ms, so these runs cannot tell the extra request from no cost. The file arrived within about 0.1 s of the end of the sketch's setup.

### Warm-up (T-12, T-26)

`KHR_parallel_shader_compile`, which lets WebGL2 compile programs in the background, in the device runs recorded before this task:

| Browser | The extension |
| --- | --- |
| Mac: Chrome, Brave, Safari | Yes |
| Mac: Firefox 156 | No |
| iPad: Safari 26.6, Brave | Yes |
| Galaxy S24+: Chrome 154, Brave | No |

The warm-up test page builds 10 pipelines on WebGL2, and 11 on WebGPU, where the culling pass is the eleventh. The device runner's checks plan ran it on the MacBook Pro M5 Max. The runs are 20260930-050804-checks and 20260930-052609-checks. `load.warmUpMs` is the time from the first build's start until no build was running. Each browser had compiled these shaders before, so its own shader cache may shorten the times.

| Browser | WebGPU | WebGL2 | WebGL2 with `?compile=wait` |
| --- | --- | --- | --- |
| Chrome 154 | 131 ms | 8 ms | 0: the first draw waits for each program |
| Safari 26.6.2 | 354 ms | 215 ms | 0: the first draw waits for each program |
| Firefox 156 | 848 ms | 0: no extension, so the first draw waits | 0 |

The S24+ and the iPad rows come from the same checks plan, which records `warmUpMs` on every device. T-26's target comes from M1-L3's runs of S4 there.

## Decision

(b3): the shaders of each GPU path load as files of their own. There is one file for each value of the bits that a device fixes when the engine starts, and a page loads exactly one. The device fixes the draw index (WebGL2 with multi-draw or without) and TONE_MAP (the 8-bit output path or HDR). Each file holds every template's variants for every combination of the material bits. The thread that draws starts the download as soon as it knows its GPU path and its fixed bits. The first frame waits for its pipelines anyway.

(b3) gives the smallest page on both paths at every bit count, and the least JavaScript to parse. At five bits, a WebGL2 page is 52.0 KB and parses 414 KB of shader text. With every variant in the file that draws, it is 57.6 KB and parses 1,644 KB. (b3) keeps 8 KB of the budget with M1's five bits, and each more material bit costs about 1 KB. (c) saves 0.6 KB more on a WebGPU page and nothing on WebGL2, but each template needs a second way to write it. So (c) waits until WebGPU warm-up time asks for fewer shader modules.

How many: each file holds 2^m variants of a template with m material bits: 16 for the standard material with M1's four material bits. A scene builds only the variants that its materials use.

## Consequences

- The shader manifest marks the engine's shaders (`lit`, `unlit`, `texcoords` and `cull`) with `by_device = true`. The shader build writes their builds into `generated/shaders-<target>[-<bit>...].ts`. Today these are `shaders-wgsl.ts`, `shaders-glsl.ts` and `shaders-glsl-draw-index.ts`. A module holds the builds of each shader that a device with its bits asks for. So a shader without device bits, such as `cull`, is in every module of its target. The main module, `generated/shaders.ts`, keeps the types, the test shaders and the GPU timer's mark shader. It also has the loaders `loadWgslShaders(bits)` and `loadGlslShaders(bits)`. Each loader imports only its own target's modules.
- The core device carries the bits that the device fixes (`shaderBits`). The thread that draws starts the download while it waits for its WebGPU device or its WebGL2 context. It then gives the loaded shaders to the backend.
- The size report names each shader file (`SHADER_PARTS` in `tools/lib/size-report.ts`) and counts the largest in each thread mode's download. A new value of the device's bits adds a module, which the report must name.
- A new material bit doubles each file: check the size report when one is added.
- M1-L3 adds the warm-up times of S4 on the S24+ and the iPad, which set T-26's target.
- The record is in the table in README.md.
