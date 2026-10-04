# D-54: Add-on modules, the on-demand loader and CDN delivery

Status: decided by the owner on 2026-10-04. The add-on rule came at 18:00, CDN delivery at 19:00, and the one loader with the line between core and add-ons at 19:20. Draco's support decided the same day. Nothing of it is built yet. Date: 2026-10-04. Task: M2-N1.

## Question

[D-52](D-52-intent-parity.md) says that heavy or niche features ship as add-on modules. Each takes one install and one import. It works with the Vite plugin, plain bundlers and CDNs, under a strict Content Security Policy. Four questions remain:

1. Which features are add-ons, and which stay in the core but load on first use?
2. How does an add-on's WebAssembly reach the threads that run it? Does an add-on start workers of its own?
3. How do the engine and its add-ons start workers when a page loads them from a CDN?
4. Does the engine read Draco-compressed glTF files, and how does the decoder load?

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
| Plain bundlers | Without the Vite plugin, each worker builds as a 34 MB file | R8-07 |
| CDNs | The engine starts each worker with `new Worker(new URL(..., import.meta.url))`. A dedicated worker's script must have the page's origin, so a page that loads the engine from a CDN cannot start its workers. The hosting guide wrongly allows workers from another origin | R8-06 |
| Licence notices | No notice reaches a game's build: Basis with its NOTICE, Zstandard, meshopt, the three.js lighting table | R8-03 |
| WebAssembly of its own | The Basis transcoder (365 KB after Brotli, loaded with the first KTX2 file) and meshopt's decoder ([D-34](D-34-meshopt-decoding.md), 6.2 KB, loaded with the first file that holds meshopt data) show the pattern | |

Facts from the web platform:

- The [HTML standard](https://html.spec.whatwg.org/multipage/workers.html#dom-worker) runs a dedicated worker only from a URL of the page's origin. A `blob:` URL that the page makes has the page's origin. A module worker started from it may import modules from a CDN, which the CDN must serve with CORS.
- A cross-origin isolated page (needed for shared memory) loads files from another origin only when they carry CORS or a `Cross-Origin-Resource-Policy` header.
- A worker started from a `blob:` URL takes the page's policy. The policy must allow `blob:` in `worker-src`, the CDN in `script-src` and `connect-src`, and `'wasm-unsafe-eval'` for WebAssembly.
- `WebAssembly.compileStreaming` compiles a module once. The page or a worker can post the compiled module to other workers, which then instantiate it without compiling again. PlayCanvas loads its decoders this way.

Draco:

- Draco's glTF-only decoder is 59 KB after Brotli: 49 KB of WebAssembly and 10 KB of JavaScript. The 66 KB figure first quoted is the full build's `.wasm` alone.
- After Brotli, Draco files are 14 to 27% smaller than meshopt files on static meshes. They are 3.2 to 3.7 times larger on animated or morphed files, because Draco leaves clips and morph targets raw.
- Blender 5.2 LTS reads and writes meshopt. Blender 5.1 and older refuse files that require it, and read Draco since 2.92 (S-20 in the [technique review](../technique-review-2026-10.md#web-search-results)).
- three.js's `DRACOLoader` reads such files, and many three.js projects ship them.

## Decision

### Core or add-on

- A feature that a glTF file or a standard scene needs to show correctly stays in the core. Its code loads on first use. Examples: morph targets, environment light and the generated room, Draco, KTX2 and meshopt decoding.
- An optional feature with heavy machinery of its own is an add-on. Examples: physics (`@null3d/rapier`), Gaussian splats, particles, MSDF text, `three-compat`, and IK if it grows large.
- An add-on has its own package or entry point, its own WebAssembly if it needs one, and shaders that load on first use. It takes one install and one import, with no manual file copying. Its version follows the engine's.

### One on-demand loader

- One loader in the engine loads first-use WebAssembly for the core and for add-ons alike. It loads the Draco decoder, the Basis transcoder, meshopt's decoder, and each add-on's module.
- The loader compiles each module once with `WebAssembly.compileStreaming` and registers it with the engine. It posts the compiled module to the engine's existing job workers, which instantiate it there.
- Add-ons run inside the engine's job workers. They start no workers of their own. Their failures reach the page through the engine's own error paths.
- A failed compile becomes an engine error with a code and a fix, such as a policy without `'wasm-unsafe-eval'`, never a raw `CompileError`.

### CDN delivery

- The main path is bundled: the engine and its add-ons from npm, built with the Vite plugin or any bundler.
- CDN use works through one shared mechanism in the engine. Each worker starts from a small `blob:` bootstrap that the page makes, which imports the worker's code from the CDN. The core's own workers start the same way, so there is one way to start workers.
- The docs state the policy that this needs (`worker-src blob:`, the CDN in `script-src` and `connect-src`, and `'wasm-unsafe-eval'`) and the headers (cross-origin isolation, and CORS or `Cross-Origin-Resource-Policy` on the CDN's files).
- The engine gives a clear error, with a code and a fix, when the policy or a header is missing.
- No self-hosted worker copies: a page never has to copy worker files to its own origin.

### Draco

- The engine reads `KHR_draco_mesh_compression`. This reverses the earlier answer of the same day, which pointed users to the asset tool's converter.
- The decoder is Draco's glTF-only build, 59 KB after Brotli. It loads on first use, only for files that hold Draco data, in the glTF worker, once per page, through the on-demand loader.
- It is a recorded exception to the 16 KB limit for first-use files ([D-14](D-14-js-budget.md)).
- The worker quantizes decoded normals, tangents and UVs into [D-25](D-25-vertex-types.md)'s types, which halves the GPU memory of most Draco meshes.
- The docs keep advising meshopt: `assets optimize` converts to meshopt by default. Draco suits large static meshes on pages that load several hundred KB of them. For the round trip to Blender 5.1 and older, keep a Draco or plain copy.

## Options rejected

- Each add-on starts its own workers. A page with two add-ons would start three sets of threads, each with its own memory and start-up cost. Each add-on would solve the CDN problem again.
- Self-hosted worker copies: the page copies worker files to its own origin. That is the manual file copying that the add-on rule forbids, and a copy falls out of step with the engine's version.
- No CDN support. The owner's rule asks for CDNs. Some users try an engine from a CDN before they install anything.
- Point Draco users to the converter only. Many three.js projects ship Draco files, and a port should load them as they are.

## Consequences

- A new task builds the loader and the `blob:` bootstrap. It moves the core's workers, the Basis transcoder and meshopt's decoder onto them. A test starts a fresh project under a strict policy and behind a CDN. Fix group F of the code review (R8-01, R8-05, R8-06, R8-07) goes first, and the per-feature shader files (M2-R11, D-56) are its prerequisite.
- M2-A6 builds Draco on the loader, with the per-file limits of fix group A.
- One notices file per build, which each add-on extends: Draco and Rapier are Apache-2.0 (R8-03).
- `docs/getting-started/hosting.md` gives the policy and the headers, and drops the claim that workers may come from another origin.
- AGENTS.md's rules for add-on modules point here.
- The record is in the table in [README.md](README.md).
