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

### Draco (M2-A6, 8 October 2026)

- Draco adds its entry to the glTF loader's table of decoders, as planned above. The glTF worker asks for it beside a file's buffers, and the loader compiles `draco_decoder_gltf.wasm` with `compileOnce` and sends it.
- The worker imports Draco's script (`scene/gltf-draco.ts`) on first use, and instantiates the module through the script's `instantiateWasm` hook. Pages without Draco files download neither.
- A decoder that failed, or whose memory grew past 64 MiB, gives way to a fresh instance from the same module. [D-112](D-112-draco-decoding.md) gives the build's choices and figures.

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

## Addendum, 15 October 2026: one place per feature, public API only, and publishing

[D-173](D-173-addon-hooks.md) adds to the line between core and add-ons. The owner ruled on 15 October 2026:

- **One place per feature.** A feature lives in the core or in one add-on, never both. An add-on extends or replaces a core feature only through that feature's own settings. Flat clouds stay in the core sky, and a water add-on owns all water.
- **Public API only.** Add-ons and examples reach the engine only through `@null3d/engine` and `@null3d/engine/stats`. `bun tools/check-addon-imports.ts`, which `bun run check` runs, enforces it. Particles are no exception: their add-on uses the public `scene.createParticleBuffer`.
- **Foundations.** The engine's team builds physics, Gaussian splats, MSDF text, particles, terrain, water, controls, geometry, impostors and `three-compat`. M3's content add-ons are example add-ons in `examples/addons/`.
- **Publishing.** Each foundation add-on is its own npm package, never a sub-path of the engine package. It keeps this record's rule: its version stays in step with the engine's, through an exact pin. It also checks the engine's version at run time.
- **WGSL compiled when packed.** An add-on's package ships its shaders compiled, because a browser cannot import a `.wgsl` file from a CDN, which this record promises. The fresh-project test installs terrain and particles, and the CDN test loads one add-on. M3-D1 lands it: `tools/lib/packages.ts` compiles each `.wgsl` file of a package's `src/` while it builds `lib/`, into the module shape that the plugin writes for a project's own WGSL. The module holds the compiled shader and a file per set of a custom material's builds, which a device loads when it first needs one, so a page downloads only the sets of its own GPU path. The pack check requires each compiled module and refuses a tarball that holds the raw file. A shader that does not compile fails the pack with the file, line and column, so a broken shader stops the publish rather than a user's page. An add-on then needs no `@null3d/vite-plugin` peer for its shaders.
- **Versions for other developers.** Their add-ons get a plugin interface version and a listing check in M4, before the API freezes at 1.0.

## Addendum, 22 October 2026: the CDN build for a page with no bundler

M3-O1 builds a page that draws a scene with one HTML file and no bundler, from a CDN, as three.js
allows. The record above settled how a page's engine files may come from another origin. This
addendum settles what such a page loads and how it is made.

### The gap

The engine's npm package carries no built shader JavaScript, because a project's Vite build takes
it from the release asset (above). A page that has no build step has no plugin to resolve those
imports, so its copy of `lib/` alone fails: the engine's import of `../generated/shaders.js`
answers no file. Every other address the engine loads is relative to its own module, and the
`blob:` bootstrap already starts each worker from another origin.

### The build

`bun run build:cdn` writes `target/cdn`, or the folder that `--out` names:

- the engine's built JavaScript and declarations, from the engine package's build
- the generated shader modules that this machine's shader build writes, in `lib/generated`
- both WebAssembly builds
- the vendor files: the KTX2 transcoder, the meshopt and Draco decoders, and the area lights' table

A page imports `lib/index.js` from that folder with a plain `<script type="module">`, or through
an import map that gives `@null3d/engine` that address. `docs/getting-started/cdn.md` gives the
page and the policy. The folder keeps the package's layout, so every relative address in the
engine's files resolves on the CDN.

The build stamps the folder with a hash of the engine's source files and of the files it copies, so
a second run in the same checkout writes nothing. On 22 October 2026 the first build in a checkout
wrote 6,656 files and 2.52 GB. Most of that is the device modules of each GPU path, each family of
features and each value of the bits a device fixes; a page downloads only its own device's files,
each on its first use.

### The one engine change

`scene/panorama.ts` started its worker with `new Worker` directly. A page whose engine files come
from another origin cannot start a worker that way, because the worker's script must have the
page's origin. It now goes through `spawnWorker`, as every other worker does, so an HDR
environment loads on such a page and its failures name the policy item or header that is missing.

### Options rejected

- **Put the shader modules in the npm package.** They are hundreds of megabytes, and a project
  with a build step never reads them from there.
- **Fetch the release asset's tar in the page and make modules of it.** That adds a second loader,
  a policy item for the archive's origin and a slow start, for files that a CDN can serve as they
  are.
- **One UMD file with a global, as three.js ships.** The engine's workers, WebAssembly and
  first-use shader files stay files of their own by design (D-56 and the rule above). A single
  file would inline every device's shader builds, or would still load files beside it and gain
  nothing.

### Limits

A page with no build step draws with the engine's own materials, geometry and shaders. Custom
shader WGSL needs the plugin's compile, a TypeScript sketch needs a bundler, and the add-on
packages are separate. The docs page states all three.

## Addendum, 23 October 2026: the Gaussian splats add-on and the hooks it closes

Status: decided while building M3-F2. Date: 2026-10-23. Task: M3-F2.

The splats add-on ships as `@null3d/splats`, its own package whose version stays in step with the
engine's. It claims the namespace `splats` and the error codes 2100 to 2199. It reads SPZ files in
both containers: a legacy file is one gzip stream, and a version 4 file is a plain header, a table of
contents and one zstd stream for each array, through the browser's `DecompressionStream`. It reads
glTF files that carry `KHR_gaussian_splatting`, and it draws the first spherical-harmonic band's
color; higher bands are ignored, which the extension allows.

### The draw goes through the feature draw hook

The cloud is one instance batch whose rows are the splats that draw: `scene.addFeatureInstances`, the
many-copies form of M3-E1's feature draw. The add-on gives one quad and a surface function, and each
row brings a center, rotations and spreads (the row's place, its quaternion and its scales), a linear
RGBA color (the row's color) and four values. The shader projects each row's covariance, sizes a
camera-facing card to its ellipse, and fades the card with the same ellipse; it reads the copy of the
scene's depth (M3-E4) to fade a splat where it meets a mesh.

The per-splat sort is the engine's own: the transparent pass culls and sorts the batch's rows back to
front on the job workers, on both GPU paths. The add-on adds no second sort, because a second sort
would duplicate the one place that orders blended draws.

### Detail levels, streaming and the budget

`createSplats` cuts the cloud into chunks of nearby splats, each in importance order (blurred volume
times opacity), so a prefix of a chunk is a coarser level of it: all, a half, a quarter and an
eighth. A task on the job workers (M3-E2's `runTask`) chooses each chunk's prefix from its distance
and the budget, nearest first, and the sketch writes the chosen rows between two frames. The chunks
are cut one at a time, so the cloud appears coarse to fine and a large file holds up no frame.

The budget is a feature setting through M3-E6's `FeatureHost`: 100,000 splats on Low to 800,000 on
Ultra, halved on WebGL2, lowered by the frame-budget governor. The host reports the batch's memory to
the stats overlay. GPU time is not measured for add-on features yet, so the overlay shows it as not
measured.

### The glTF extension registers as the add-on loads

M3-E3's handler API was per sketch (`assets.registerGltfExtension`), but a file that requires
`KHR_gaussian_splatting` tells the developer to import the add-on, and an add-on's module has no
sketch to register with. The hook gained `registerGltfExtension(handler)`, which registers for every
sketch of the thread. A sketch's own handler for the same extension reads its files in the add-on's
place. A later add-on handler for one extension replaces the earlier one, so a development reload
does not throw E1213.

### Limits

- A glTF model's splats draw in the file's order inside each part, and the model is cut into up to
  64 parts that the transparent pass sorts by depth. A large cloud uses an SPZ file, whose rows the
  engine sorts one by one.
- A splat casts no shadow and receives none.
- The cards need the scene's depth copy, whose cost the material's scene input carries.
