# D-70: Shader hot reload, and compiles off the dev server's thread

Status: decided. Date: 2026-10-05. Task: M2-J2.

Summary: The Vite plugin compiles WGSL on up to 8 worker threads, and splits each custom material among them. One material takes 960 ms on one thread and 269 ms on 8. On the dev server, WGSL edits go to the page under a key per file or tagged literal. Each backend builds the new pipelines in the background while the old ones draw. An edit that changes a material's uniforms, textures or vertex inputs reloads the page. So does an edit to a custom effect or tone curve.

## Question

How does an edit to WGSL reach a running dev page without a reload? And how does the Vite plugin compile WGSL without blocking the dev server, which then answers no request?

## Rule

- An edit to WGSL shows in a running dev page within about a second, on WebGPU, compatibility mode and WebGL2.
- No frame loses an object while the new shader builds. A broken edit shows in Vite's overlay, and the page keeps the old image.
- The dev server answers other requests, such as the engine's worker probe, while a shader compiles.
- Production builds carry none of it.

## Data

Before: one custom material compiled in about 960 ms on Node's own thread on the M5 Max. The compile builds 80 variants (16 WGSL, 64 GLSL) and writes 4.7 MB of JSON. While it ran, the dev server answered nothing. That made the worker probe time out in CI (#199).

Compile time of one custom material, by the number of compiler threads, on the M5 Max (18 cores) at a load average near 35:

| Threads | Median |
| --- | --- |
| 1 (Node's thread, before) | 960 ms |
| 2 | 845 ms |
| 4 | 525 ms |
| 8 | 269 ms |
| 12 | 190 ms |

The process grew by 185 MB with 8 threads and 233 MB with 12, so each thread holds about 20 MB.

The time from an edit to the first frame read back with the change, in the hot reload browser test. The runs were in Chrome on the M5 Max, at a load average of 36 to 45 from other work:

| Edit | WebGPU | Compatibility | WebGL2 |
| --- | --- | --- | --- |
| Surface function in a `.wgsl` file | 1,077 to 2,027 ms | 795 to 866 ms | 572 to 731 ms |
| Surface function in a tagged literal | 855 to 1,125 ms | 691 to 726 ms | 466 to 722 ms |
| Full shader in a tagged literal | 90 to 181 ms | 166 to 172 ms | 58 ms |

Timing logs split one update. The watcher took 10 to 120 ms and the compile 400 to 1,200 ms. The transfer to the page took 50 to 300 ms, and the GPU's new pipelines 10 to 50 ms. The first edit after a page load was the slowest, while V8 still optimizes the compiler's WebAssembly. No frame skipped a draw in any run (`skippedDraws` 0).

How the data was produced: `NULL3D_PORT=17473 bun run --cwd tests test hot-reload.spec.ts`, and a script that timed `CompilerPool.material` at each size, on 5 October 2026.

## Decision

1. The plugin compiles on a pool of worker threads: one for each core but one, at most 8. A custom material's builds split into one share per thread (`MaterialSource.share` in the shader compiler), and the shares join in build order. The output is the same as one compile on one thread. 8 threads halve the compile against 4, for about 80 MB more.
2. On the dev server, the plugin gives the WGSL of each `.wgsl` file a key: its path. A tagged literal's key is its script's path with the literal's place. When only that WGSL changes, the plugin compiles it and sends it on Vite's channel under the key. A client module that the plugin injects into each page fires the event `null3d:wgsl` on the page's global object. Each engine on the page passes the update to the thread that runs its sketch.
3. A script whose code changed outside its tagged literals runs again, so Vite reloads the page. The plugin compares the code with every literal's text left out.
4. An update applies only when the new WGSL keeps the material's uniforms, textures, vertex locations, vertex attributes and base color. Those set the material's layout of values and its shading code in the core. Any other change reloads the page. A whole shader always reloads, because code outside the engine draws it.
5. The materials send the new shader under the template that the key's WGSL already has. The thread that draws lists the template as replaced. Its backend builds each live pipeline of the template again in the background: `createRenderPipelineAsync` on WebGPU, and `KHR_parallel_shader_compile` on WebGL2. The old pipeline draws until the new one is built. On WebGL2, Safari's Metal translator now and then fails a link at random. Such a link runs once more, also in the background. A build that fails otherwise logs why and keeps the old one.
6. WGSL that does not compile goes to Vite's overlay and the terminal, and no update goes out. The script's last applied code stays the base of the comparison, so the next good edit sends every literal changed since.
7. Every engine part is behind `DEV`, so a production build drops it.
8. The hot contract covers custom materials only. An edit to the WGSL of a custom effect or a custom tone curve reloads the page, as a whole shader does. Both came with custom post effects (#351), after this design. Their WGSL takes the same keys, but nothing on the page applies an update to them yet:
   - An effect's shader is a template in the same shared template table as the materials'. A swap needs a contract of its uniforms and its depth read, which set its bind group and its block of values in the core. It also needs the effects to take updates as the materials do.
   - A tone curve is built into every variant of the engine's final pass. A swap replaces the final pass's template, which the engine owns, not a material.
   - A reload shows every such edit correctly, at the cost of the sketch's state. That is the right default until the swaps exist.

## Consequences

- The plugin has `compile-pool.ts`, `compile-worker.js`, `compiler-calls.js` and `hot.ts`. The worker and the calls are plain JavaScript, so Node runs them without type stripping. The compile functions in `wgsl.ts` are async.
- The engine has `shared/wgsl-updates.ts`, `Materials.updateShaders`, `ImageTable.setShader` and its list of replaced templates, and the backends' swaps.
- Cached spot and point light shadows of a still scene keep the old shape of a vertex offset until something in their view moves. A uniform change through `set()` behaves the same way.
- Custom effects and tone curves (M2-F5) take the same keys but have no contract. So an edit to their WGSL reloads the page (decision 8). A hot swap needs their own contract in `hot.ts` and a consumer of `updateShaders`.
- Docs: `guides/custom-shaders` (hot reload) and `getting-started/install`. Skill: `null3d-develop` `shaders.md` and `testing-and-debugging.md`.
