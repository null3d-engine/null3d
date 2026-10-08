# D-54: Add-on modules, the on-demand loader and CDN delivery

Status: decided by the owner on 2026-10-04. The add-on rule came at 18:00, CDN delivery at 19:00, and the one loader with the line between core and add-ons at 19:20. Draco's support and the bundler decided the same day. The loader, the bootstrap and the CDN checks are built (M2-R18, 5 October 2026; see "Built"); Draco and add-ons build on them. Date: 2026-10-04. Task: M2-N1, M2-R18.

Summary: What a glTF file or a standard scene needs stays in the core and loads on first use; physics, splats, particles, MSDF text and `three-compat` are add-ons. One loader compiles first-use WebAssembly once and runs it in the engine's job workers, or in the glTF worker for its decoders; add-ons start no workers, and decoder tasks never hold up a frame. Bundled is the main path; from a CDN every worker starts from one `blob:` bootstrap, with E1422 and E1423 for a missing policy item or header. The engine reads Draco files, with the decoder (59 KB) loaded on first use.

## Question

[D-52](D-52-intent-parity.md) says that heavy or niche features ship as add-on modules. Each takes one install and one import. It works with the Vite plugin and from CDNs, under a strict Content Security Policy. Five questions remain:

1. Which features are add-ons, and which stay in the core but load on first use?
2. How does an add-on's WebAssembly reach the threads that run it? Does an add-on start workers of its own?
3. How do the engine and its add-ons start workers when a page loads them from a CDN?
4. Does the engine read Draco-compressed glTF files, and how does the decoder load?
5. Which bundlers does null3D support?

## Rule

- A game that does not use a feature pays nothing for it: no download, no start time, and no core size.
- One clear way to do each task (design principle 10): one way to start workers, one way to load WebAssembly on first use.
- An add-on works under a strict policy, and the engine says what is missing when the page's policy or headers block it.
- The engine's own files obey the same rules as an add-on's.

## Data

The library code review of 4 October 2026 checked each condition of the add-on rule against main ([Code review, October 2026](../code-review-2026-10.md)):

| Condition | State on main at fe137a6b | Finding |
| --- | --- | --- |
| Shaders that load on first use | Only the morph builds on M2-C5's branch, and the room's generator on #283 | The review's per-feature shader files |
| A strict policy | A threaded page does not start under one. Vite inlines the core's 46-byte limits file as a `data:` URL, which `connect-src 'self'` blocks, and the error (E1406) blames the host | R8-01 |
| A clear error without `'wasm-unsafe-eval'` | A raw `CompileError` with no code | R8-05 |
| Vite without the plugin | Each worker builds as a 34 MB file | R8-07 |
| CDNs | The engine starts each worker with `new Worker(new URL(..., import.meta.url))`. A dedicated worker's script must have the page's origin, so a page that loads the engine from a CDN cannot start its workers. The hosting guide wrongly allows workers from another origin | R8-06 |
| Licence notices | No notice reaches a game's build: Basis with its NOTICE, Zstandard, meshopt, the three.js lighting table | R8-03 |
| WebAssembly of its own | The Basis transcoder (365 KB after Brotli, loaded with the first KTX2 file) and meshopt's decoder ([D-34](D-34-meshopt-decoding.md), 6.2 KB, loaded with the first file that holds meshopt data) show the pattern | |

Facts from the web platform:

- The [HTML standard](https://html.spec.whatwg.org/multipage/workers.html#dom-worker) runs a dedicated worker only from a URL of the page's origin. A `blob:` URL that the page makes has the page's origin. A module worker started from it may import modules from a CDN, which the CDN must serve with CORS.
- A cross-origin isolated page (needed for shared memory) loads files from another origin only when they carry CORS or a `Cross-Origin-Resource-Policy` header.
- A worker started from a `blob:` URL takes the page's policy. The policy must allow `blob:` and the CDN in `worker-src` (Firefox checks a worker's imports there), the CDN in `script-src` and `connect-src`, and `'wasm-unsafe-eval'` for WebAssembly.
- `WebAssembly.compileStreaming` compiles a module once. The page or a worker can post the compiled module to other workers, which then instantiate it without compiling again. PlayCanvas loads its decoders this way.

Draco:

- Draco's glTF-only decoder is 59 KB after Brotli: 49 KB of WebAssembly and 10 KB of JavaScript. The 66 KB figure first quoted is the full build's `.wasm` alone.
- After Brotli, Draco files are 14 to 27% smaller than meshopt files on static meshes. They are 3.2 to 3.7 times larger on animated or morphed files, because Draco leaves clips and morph targets raw.
- Blender 5.2 LTS reads and writes meshopt. Blender 5.1 and older refuse files that require it, and read Draco since 2.92 (S-20 in the [technique review](../technique-review-2026-10.md#web-search-results)).
- three.js's `DRACOLoader` reads such files, and many three.js projects ship them.

## Decision

### Core or add-on

- A feature that a glTF file or a standard scene needs to show correctly stays in the core. Its code loads on first use. Examples: morph targets, environment light and the generated room, Draco, KTX2 and meshopt decoding.
- An optional feature with heavy machinery of its own is an add-on. Examples: physics (`@null3d/rapier`), Gaussian splats, particles (`@null3d/particles`), MSDF text, `three-compat`, and IK if it grows large. Splats, MSDF text, physics and particles ship in 0.1.0, at M3's gate ([D-108](D-108-first-release.md)).
- An add-on has its own package or entry point, its own WebAssembly if it needs one, and shaders that load on first use. It takes one install and one import, with no manual file copying. Its version follows the engine's.

### One on-demand loader

- One loader in the engine loads first-use WebAssembly for the core and for add-ons alike. It loads the Draco decoder, the Basis transcoder, meshopt's decoder, and each add-on's module.
- The loader compiles each module once with `WebAssembly.compileStreaming` and registers it with the engine. It posts the compiled module to the engine's existing job workers, which instantiate it there.
- Add-ons run inside the engine's job workers. They start no workers of their own. Their failures reach the page through the engine's own error paths.
- A failed compile becomes an engine error with a code and a fix, such as a policy without `'wasm-unsafe-eval'`, never a raw `CompileError`.

### CDN delivery

- The main path is bundled: the engine and its add-ons from npm, built with Vite and the null3D plugin.
- CDN use works through one shared mechanism in the engine. Each worker starts from a small `blob:` bootstrap that the page makes, which imports the worker's code from the CDN. The core's own workers start the same way, so there is one way to start workers.
- The docs state the policy that this needs: `blob:` and the CDN in `worker-src`, the CDN in `script-src` and `connect-src`, and `'wasm-unsafe-eval'`. They also state the headers: cross-origin isolation, and CORS or `Cross-Origin-Resource-Policy` on the CDN's files.
- The engine gives a clear error, with a code and a fix, when the policy or a header is missing.
- No self-hosted worker copies: a page never has to copy worker files to its own origin.

### Bundlers

- null3D requires Vite with the null3D plugin. Other bundlers are not supported, and no test builds with them. The install guide says so, and the plugin warns when a setting builds workers in a format other than ES modules.
- The engine still loads its workers, its WebAssembly and its other files the standard way, `new URL('<file>', import.meta.url)`, with no feature that only Vite has. Every modern bundler understands that pattern, so other bundlers stay possible. The engine's addresses no longer carry Vite's `?no-inline` query: the null3D plugin keeps the engine's files from becoming `data:` addresses instead.
- Reason: one supported toolchain is one to test and to document. The standard loading pattern keeps other bundlers open without that cost. The review's webpack and Rspack test builds (R8-07) are dropped, and no Next.js test project is built.

### Draco

- The engine reads `KHR_draco_mesh_compression`. This reverses the earlier answer of the same day, which pointed users to the asset tool's converter.
- The decoder is Draco's glTF-only build, 59 KB after Brotli. It loads on first use, only for files that hold Draco data, in the glTF worker, once per page, through the on-demand loader.
- It is a recorded exception to the 16 KB limit for first-use files ([D-14](D-14-js-budget.md)).
- The worker quantizes decoded normals, tangents and UVs into [D-25](D-25-vertex-types.md)'s types, which halves the GPU memory of most Draco meshes.
- The docs keep advising meshopt: `assets optimize` converts to meshopt by default. Draco suits large static meshes on pages that load several hundred KB of them. For the round trip to Blender 5.1 and older, keep a Draco or plain copy.

## Built

M2-R18 built the loader and the bootstrap on 5 October 2026. [Implementation notes](../implementation-notes.md#the-on-demand-loader) hold the detail.

### The loader

- The function `compileOnce` (`shared/tasks.ts`) compiles each WebAssembly file once per page with `WebAssembly.compileStreaming`. It runs in the thread that runs the sketch. The function `runTask` posts a task with the compiled modules that its worker lacks. Workers only instantiate them.
- Tasks run in the job workers. A job worker blocks in the core's job loop, where it reads no messages, so the loader first asks the core to call it. The core lets it leave the loop only when no frame chunk is left to claim. It runs its tasks and goes back.
- Where the engine has no job workers, as in the single-threaded build, the loader starts one task worker with its first task. It replaces the KTX2 transcoder's own worker.
- The glTF worker stays (coordinator, 5 October 2026). Draco's decoder runs where the file is parsed, as decided above. Moving glTF parsing into the job workers would put long parses beside frame work. So the loader serves the glTF worker too. The worker names the decoders that a file needs, beside its buffers, and the loader sends their compiled modules. The meshopt decoder loads this way now, and Draco adds one entry to the glTF loader's table of decoders. For its decoders the engine starts only the job workers and the glTF worker, or the task worker where it has no job workers.
- The KTX2 transcoder moved into the job workers. Add-ons will run there too.

### Frames come first

Rule (coordinator, 5 October 2026): a decoder's task never holds up a frame.

- A job worker leaves the job loop only between frame chunks. The sketch thread runs every chunk that no job worker claims, so a frame never waits for a worker that is away.
- With two or more job workers, the first never takes tasks, so one job worker always serves the frames.
- Measured on the Mac (M5 Max, Chrome, WebGPU, 12 s of S1 with the `decode` switch). The KTX2 sample model's 19 textures loaded round after round, 893 files per run. The meshopt sample model loaded after each round. With 16 job workers and with 2, every run kept 719 or 720 of 720 frames at 60 Hz. The busiest thread's CPU time per frame at the 99th percentile was:

| Job workers | Without decoding | Transcoder in its own worker | Transcoder in the job workers |
| --- | --- | --- | --- |
| 16 | 5.07, 5.04 ms | 5.23, 5.33 ms | 5.51, 5.35 ms |
| 2 | 4.96, 5.22 ms | 5.13, 5.30 ms | 5.28, 5.24 ms |

Two runs each. The differences are within the Mac's run-to-run spread.

### CDN delivery

- `spawnWorker` (`shared/worker-start.ts`) starts every engine worker: the sketch, render, job, probe, glTF and task workers. For a script of the page's origin it changes nothing. For a script of another origin it starts a `blob:` module that imports the script and holds early messages for it.
- The engine keeps the form `new Worker(new URL('<file>', import.meta.url), options)` that bundlers read, and `spawnWorker` runs it while the thread's `Worker` is a subclass that adds the bootstrap.
- Codes: E1422 names the directive when the page's policy blocks a worker's bootstrap or an engine file. E1423 is for an engine file of another origin without a CORS header. E1418 stays for `'wasm-unsafe-eval'`. A page without the isolation headers runs single-threaded, as on any host.
- `Cross-Origin-Resource-Policy` alone does not serve: module imports and `fetch` of another origin are CORS requests, which need `Access-Control-Allow-Origin`.
- A `blob:` worker takes the page's policy. The official Basis Universal transcoder makes its bindings with `new Function`. So KTX2 textures failed under any policy without `'unsafe-eval'`. On main they failed too when the host sent its policy on the transcoder's script. The engine now ships its own build of v2.50 without that, which writes the same bytes (implementation notes, KTX2 textures).

### Firefox and worker-src (found 7 October 2026)

- The first stated policy allowed only `'self'` and `blob:` in `worker-src`. A run of the CDN test in Playwright's Firefox, after the loader merged (#340), found that a threaded page did not start under it. The run failed 3 of 3 times.
- The cause: Firefox checks the modules that a worker imports against `worker-src`. Chrome and WebKit check them against `script-src`. The sketch worker imports the sketch from the CDN, and that import's shared chunk was blocked. Firefox's console named `worker-src` and the chunk's address.
- The start then failed with E1410, whose fix tells the developer to pass the sketch differently. That is the wrong fix.
- The fix: the stated policy names the CDN in `worker-src` too. The policy then serves every browser, and it allows nothing that `script-src` does not allow already. With it, the CDN test passed 8 of 8 in Playwright's Firefox and 8 of 8 in its WebKit.
- The sketch's loader now looks for the worker's violation report when the import fails. It accepts a report from the module's origin by a script, worker or default directive. It then fails with E1422, which names the directive and the blocked file. Under the old policy, Firefox now gives `E1422: ... its worker-src does not allow <CDN>/.../src-<hash>.js`.
- Rejected: a CI job in Firefox for the CDN test. The queue's Firefox job runs the runner's pages, which cannot set a page's policy, and the case needs only one rule in the policy.
- Chrome's tests cannot show this fault, so the CDN test's policy is the one guard. Run `cdn.spec.ts` in Playwright's Firefox after a change to how workers import modules.

### Tests

- A page loads a meshopt glTF file and eight KTX2 files at once, in each thread mode. It downloads each decoder's module once, and starts no worker besides the engine's own (`ktx2.spec.ts`).
- The production build's KTX2 page with its files on another origin starts threaded and single-threaded under the stated policy, and runs both decoders. Five cases each leave one item out (`cdn.spec.ts`). Without `blob:` in `worker-src` or the CDN in `connect-src`, it gives E1422. Without `'wasm-unsafe-eval'`, it gives E1418. Without CORS on the `.wasm` files or on the workers' scripts, it gives E1423.
- The same page under the strict policy of one origin runs both decoders (`content-security-policy.spec.ts`). It fails on main.

### Options rejected while building

- Move glTF parsing into the job workers, so that only job workers decode. A long parse would sit beside frame work, and Draco's decoder runs where the file is parsed.
- Job workers that wait with `Atomics.waitAsync`, so they read messages between frames. Waking through the event loop is slower than a blocking wait's wake, several times per frame ([implementation notes](../implementation-notes.md#threads-and-shared-memory)).
- Have the plugin rewrite the engine's worker constructors for CDN use. Other bundlers would then lose CDN use, and the plugin skips files in `node_modules`.
- Patch the official transcoder's script by hand to drop `new Function`. A rebuild from the release's sources with one more flag is reproducible, and its output is checked against the official build's.

## Options rejected

- Each add-on starts its own workers. A page with two add-ons would start three sets of threads, each with its own memory and start-up cost. Each add-on would solve the CDN problem again.
- Self-hosted worker copies: the page copies worker files to its own origin. That is the manual file copying that the add-on rule forbids, and a copy falls out of step with the engine's version.
- No CDN support. The owner's rule asks for CDNs. Some users try an engine from a CDN before they install anything.
- Point Draco users to the converter only. Many three.js projects ship Draco files, and a port should load them as they are.

## Consequences

- M2-R18 builds the loader and the `blob:` bootstrap, and moves the core's workers and both decoders onto them. It removes the engine's Vite-only address queries (see "Built").
- M2-A6 builds Draco on the loader, with the per-file limits of fix group A.
- One notices file per build, which each add-on extends: Draco and Rapier are Apache-2.0 (R8-03).
- `docs/getting-started/hosting.md` gives the policy and the headers, and drops the claim that workers may come from another origin.
- AGENTS.md's rules for add-on modules point here.
- The record is in the table in [README.md](README.md).
