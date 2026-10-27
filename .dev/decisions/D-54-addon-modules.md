# D-54: Add-on modules, the on-demand loader and CDN delivery

Status: decided by the owner: the add-on rule, CDN delivery, the one loader with the line between core and add-ons, Draco's support and the bundler, and the rules that [D-173](D-173-addon-hooks.md) adds. The splats add-on's design was decided while building M3-F2. Built: the loader, the `blob:` bootstrap and the CDN checks (M2-R18), Draco decoding (M2-A6), the pack-time WGSL compile (M3-D1), the CDN build with its add-ons (M3-O1), and the Gaussian splats add-on with streaming (M3-F2). The splat budget stays a count of drawn splats, decided by the owner on the audit's recommendation. Pending: one recorded frame rate of a real scan on the iPad and on an S24-class phone, and a recorded pass of the streaming test since the chunking fix. Task: M2-N1, M2-R18, M3-D1, M3-O1, M3-F2.

Summary: What a glTF file or a standard scene needs, Draco's 59 KB decoder among it, stays in the core and loads on first use; physics, splats, particles, MSDF text and `three-compat` are add-ons, each its own npm package on the public API. One loader compiles first-use WebAssembly once and runs it in the engine's job workers, or in the glTF worker for its decoders, so add-ons start no workers and decoder tasks never hold up a frame. Bundled is the main path; from a CDN every worker starts from one `blob:` bootstrap, with E1422 and E1423 for a missing policy item or header, and `bun run build:cdn` serves a page with no bundler.

## Question

[D-52](D-52-intent-parity.md) says that heavy or niche features ship as add-on modules. Each takes one install and one import. It works with the Vite plugin and from CDNs, under a strict Content Security Policy. Six questions follow:

1. Which features are add-ons, and which stay in the core but load on first use?
2. How does an add-on's WebAssembly reach the threads that run it? Does an add-on start workers of its own?
3. How do the engine and its add-ons start workers when a page loads them from a CDN?
4. Does the engine read Draco-compressed glTF files, and how does the decoder load?
5. Which bundlers does null3D support?
6. What does a page with no bundler load from a CDN, and how is it made?

## Rule

- A game that does not use a feature pays nothing for it: no download, no start time, and no core size.
- One clear way to do each task (design principle 10): one way to start workers, one way to load WebAssembly on first use.
- An add-on works under a strict policy, and the engine says what is missing when the page's policy or headers block it.
- The engine's own files obey the same rules as an add-on's.

## Data

The library code review checked each condition of the add-on rule against main. This record's design fixes or settles each of its R8 findings, so [the code review](../code-review.md) no longer lists them:

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

- Draco's glTF-only decoder is 59 KB after Brotli: 49 KB of WebAssembly and 10 KB of JavaScript. The full build's `.wasm` alone is 66 KB.
- After Brotli, Draco files are 14 to 27% smaller than meshopt files on static meshes. They are 3.2 to 3.7 times larger on animated or morphed files, because Draco leaves clips and morph targets raw.
- Blender 5.2 LTS reads and writes meshopt. Blender 5.1 and older refuse files that require it, and read Draco since 2.92 (S-20 in the [technique review](../technique-review.md#web-search-results)).
- three.js's `DRACOLoader` reads such files, and many three.js projects ship them.

## Decision

### Core or add-on

- A feature that a glTF file or a standard scene needs to show correctly stays in the core. Its code loads on first use. Examples: morph targets, environment light and the generated room, Draco, KTX2 and meshopt decoding.
- An optional feature with heavy machinery of its own is an add-on. Examples: physics (`@null3d/rapier`), Gaussian splats, particles (`@null3d/particles`), MSDF text, `three-compat`, and IK if it grows large. Splats, MSDF text, physics and particles ship in 0.1.0, at M3's gate ([D-108](D-108-first-release.md)).
- One place per feature: a feature lives in the core or in one add-on, never both. An add-on extends or replaces a core feature only through that feature's own settings. Flat clouds stay in the core sky, and a water add-on owns all water.
- Public API only: add-ons and examples reach the engine only through `@null3d/engine` and `@null3d/engine/stats`. `bun tools/check-addon-imports.ts`, which `bun run check` runs, enforces it. Particles are no exception: their add-on uses the public `scene.createParticleBuffer`.
- Foundations: the engine's team builds physics, Gaussian splats, MSDF text, particles, terrain, water, controls, geometry, impostors and `three-compat`. M3's content add-ons are example add-ons in `examples/addons/`.

The owner set these three rules, and the publishing rules below, with [D-173](D-173-addon-hooks.md), which gives the hooks that add-ons use.

### Publishing

- Each foundation add-on is its own npm package, never a sub-path of the engine package. It has its own WebAssembly if it needs one, and shaders that load on first use. It takes one install and one import, with no manual file copying.
- Its version stays in step with the engine's, through an exact pin. It also checks the engine's version at run time.
- An add-on's package ships its WGSL compiled, because a browser cannot import a `.wgsl` file from a CDN. M3-D1 builds this: `tools/lib/packages.ts` compiles each `.wgsl` file of a package's `src/` while it builds `lib/`, into the module shape that the plugin writes for a project's own WGSL. The module holds the compiled shader and a file per set of a custom material's builds. A device loads a set when it first needs one, so a page downloads only the sets of its own GPU path. The pack check requires each compiled module and refuses a tarball that holds the raw file. A shader that does not compile fails the pack with the file, line and column, so a broken shader stops the publish rather than a user's page. An add-on then needs no `@null3d/vite-plugin` peer for its shaders. The fresh-project test installs terrain and particles.
- Other developers' add-ons get a plugin interface version ([D-223](D-223-plugin-interface-version.md)) and a listing check ([D-225](D-225-addon-listing-check.md)).

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
- The engine still loads its workers, its WebAssembly and its other files the standard way, `new URL('<file>', import.meta.url)`, with no feature that only Vite has. Every modern bundler understands that pattern, so other bundlers stay possible. The engine's addresses carry no Vite query: the null3D plugin keeps the engine's files from becoming `data:` addresses.
- Reason: one supported toolchain is one to test and to document. The standard loading pattern keeps other bundlers open without that cost. The review's webpack and Rspack test builds (R8-07) are not built, and neither is a Next.js test project.

### Draco

- The engine reads `KHR_draco_mesh_compression`.
- The decoder is Draco's glTF-only build, 59 KB after Brotli. It loads on first use, only for files that hold Draco data, in the glTF worker, once per page, through the on-demand loader.
- It is a recorded exception to the 16 KB limit for first-use files ([D-14](D-14-js-budget.md)).
- The worker quantizes decoded normals, tangents and UVs into [D-25](D-25-vertex-types.md)'s types, which halves the GPU memory of most Draco meshes.
- The docs keep advising meshopt: `assets optimize` converts to meshopt by default. Draco suits large static meshes on pages that load several hundred KB of them. For the round trip to Blender 5.1 and older, keep a Draco or plain copy.

## Built

M2-R18 built the loader and the bootstrap. [Implementation notes](../implementation-notes.md#the-on-demand-loader) hold the detail.

### The loader

- The function `compileOnce` (`shared/tasks.ts`) compiles each WebAssembly file once per page with `WebAssembly.compileStreaming`. It runs in the thread that runs the sketch. The function `runTask` posts a task with the compiled modules that its worker lacks. Workers only instantiate them.
- Tasks run in the job workers. A job worker blocks in the core's job loop, where it reads no messages, so the loader first asks the core to call it. The core lets it leave the loop only when no frame chunk is left to claim. It runs its tasks and goes back.
- Where the engine has no job workers, as in the single-threaded build, the loader starts one task worker with its first task. The KTX2 transcoder has no worker of its own.
- The glTF worker stays, by the coordinator's ruling. Draco's decoder runs where the file is parsed, as decided above. Moving glTF parsing into the job workers would put long parses beside frame work. So the loader serves the glTF worker too. The worker names the decoders that a file needs, beside its buffers, and the loader sends their compiled modules. The meshopt decoder loads this way, and Draco has one entry in the glTF loader's table of decoders. For its decoders the engine starts only the job workers and the glTF worker, or the task worker where it has no job workers.
- The KTX2 transcoder runs in the job workers, as add-ons do.

### Frames come first

Rule, by the coordinator: a decoder's task never holds up a frame.

- A job worker leaves the job loop only between frame chunks. The sketch thread runs every chunk that no job worker claims, so a frame never waits for a worker that is away.
- With two or more job workers, the first never takes tasks, so one job worker always serves the frames.
- Measured on the Mac (M5 Max, Chrome, WebGPU, 12 s of S1 with the `decode` switch). The KTX2 sample model's 19 textures loaded round after round, 893 files per run. The meshopt sample model loaded after each round. With 16 job workers and with 2, every run kept 719 or 720 of 720 frames at 60 Hz. The busiest thread's CPU time per frame at the 99th percentile was:

| Job workers | Without decoding | Transcoder in its own worker | Transcoder in the job workers |
| --- | --- | --- | --- |
| 16 | 5.07, 5.04 ms | 5.23, 5.33 ms | 5.51, 5.35 ms |
| 2 | 4.96, 5.22 ms | 5.13, 5.30 ms | 5.28, 5.24 ms |

Two runs each. The differences are within the Mac's run-to-run spread.

### CDN delivery

- `spawnWorker` (`shared/worker-start.ts`) starts every engine worker: the sketch, render, job, probe, glTF, panorama and task workers. For a script of the page's origin it changes nothing. For a script of another origin it starts a `blob:` module that imports the script and holds early messages for it.
- The engine keeps the form `new Worker(new URL('<file>', import.meta.url), options)` that bundlers read, and `spawnWorker` runs it while the thread's `Worker` is a subclass that adds the bootstrap.
- Codes: E1422 names the directive when the page's policy blocks a worker's bootstrap or an engine file. E1423 is for an engine file of another origin without a CORS header. E1418 stays for `'wasm-unsafe-eval'`. A page without the isolation headers runs single-threaded, as on any host.
- `Cross-Origin-Resource-Policy` alone does not serve: module imports and `fetch` of another origin are CORS requests, which need `Access-Control-Allow-Origin`.
- A `blob:` worker takes the page's policy. The official Basis Universal transcoder makes its bindings with `new Function`. So with it, KTX2 textures fail under any policy without `'unsafe-eval'`, and also when the host sends its policy on the transcoder's script. The engine ships its own build of v2.50 without `new Function`, which writes the same bytes (implementation notes, KTX2 textures).

### Firefox and worker-src

- Firefox checks the modules that a worker imports against `worker-src`. Chrome and WebKit check them against `script-src`. The sketch worker imports the sketch from the CDN. Under a policy with only `'self'` and `blob:` in `worker-src`, Firefox blocks that import's shared chunk, and a threaded page does not start. Under that policy the CDN test failed 3 of 3 times in Playwright's Firefox, in the run that pull request #387 (`3766f8756`) records. Firefox's console names `worker-src` and the chunk's address.
- So the stated policy names the CDN in `worker-src` too. The policy then serves every browser, and it allows nothing that `script-src` does not allow already. With it, the CDN test passed 8 of 8 in Playwright's Firefox and 8 of 8 in its WebKit, in the run that the same pull request records.
- When the import fails, the sketch's loader looks for the worker's violation report. It accepts a report from the module's origin by a script, worker or default directive. It then fails with E1422, which names the directive and the blocked file: `E1422: ... its worker-src does not allow <CDN>/.../src-<hash>.js`. Without that report the start would fail with E1410, whose fix tells the developer to pass the sketch differently. That is the wrong fix.
- Rejected: a CI job in Firefox for the CDN test. The queue's Firefox job runs the runner's pages, which cannot set a page's policy, and the case needs only one rule in the policy.
- Chrome's tests cannot show this fault, so the CDN test's policy is the one guard. Run `cdn.spec.ts` in Playwright's Firefox after a change to how workers import modules.

### Tests

- A page loads a meshopt glTF file and eight KTX2 files at once, in each thread mode. It downloads each decoder's module once, and starts no worker besides the engine's own (`ktx2.spec.ts`).
- The production build's KTX2 page with its files on another origin starts threaded and single-threaded under the stated policy, and runs both decoders. Five cases each leave one item out (`cdn.spec.ts`). Without `blob:` in `worker-src` or the CDN in `connect-src`, it gives E1422. Without `'wasm-unsafe-eval'`, it gives E1418. Without CORS on the `.wasm` files or on the workers' scripts, it gives E1423.
- The same page under the strict policy of one origin runs both decoders (`content-security-policy.spec.ts`).

### Draco decoding

- Draco has its entry in the glTF loader's table of decoders. The glTF worker asks for it beside a file's buffers, and the loader compiles `draco_decoder_gltf.wasm` with `compileOnce` and sends it.
- The worker imports Draco's script (`scene/gltf-draco.ts`) on first use, and instantiates the module through the script's `instantiateWasm` hook. Pages without Draco files download neither.
- A decoder that failed, or whose memory grew past 64 MiB, gives way to a fresh instance from the same module. [D-112](D-112-draco-decoding.md) gives the build's choices and figures.

### Options rejected while building

- Move glTF parsing into the job workers, so that only job workers decode. A long parse would sit beside frame work, and Draco's decoder runs where the file is parsed.
- Job workers that wait with `Atomics.waitAsync`, so they read messages between frames. Waking through the event loop is slower than a blocking wait's wake, several times per frame ([implementation notes](../implementation-notes.md#threads-and-shared-memory)).
- Have the plugin rewrite the engine's worker constructors for CDN use. Other bundlers would then lose CDN use, and the plugin skips files in `node_modules`.
- Patch the official transcoder's script by hand to drop `new Function`. A rebuild from the release's sources with one more flag is reproducible, and its output is checked against the official build's.

## The CDN build for a page with no bundler

A page can draw a scene with one HTML file and no bundler, from a CDN, as three.js allows (M3-O1). The sections above settle how a page's engine files may come from another origin. This section settles what such a page loads and how it is made.

### The gap

The engine's npm package carries no built shader JavaScript, because a project's Vite build takes it from the release asset. A page that has no build step has no plugin to resolve those imports, so its copy of `lib/` alone fails: the engine's import of `../generated/shaders.js` answers no file. Every other address the engine loads is relative to its own module, and the `blob:` bootstrap already starts each worker from another origin.

An add-on's built code imports the engine by its package name, `@null3d/engine`. A page's import map resolves that name for the page's own modules. It does not reach a worker, and an add-on's code runs in the sketch worker and the job workers. So a copy of the package beside the engine would start on the page and fail on the first worker.

### The build

`bun run build:cdn` writes `target/cdn`, or the folder that `--out` names:

- the engine's built JavaScript and declarations, from the engine package's build
- the generated shader modules that this machine's shader build writes, in `lib/generated`
- both WebAssembly builds
- the vendor files: the KTX2 transcoder, the meshopt and Draco decoders, and the area lights' table
- each foundation add-on in `addons/<name>/`, in the layout of the add-on's package

A page imports `lib/index.js` from that folder with a plain `<script type="module">`, or through an import map that gives `@null3d/engine` that address. `docs/getting-started/cdn.md` gives the page and the policy. The folder keeps the package's layout, so every relative address in the engine's files resolves on the CDN.

The build compiles each add-on with the same pack-time compile that the npm packages take, so its WGSL is compiled and no `.wgsl` file ships. It rewrites each JavaScript file's engine imports to a relative address that reaches the engine in the same build, such as `../../../lib/index.js`. Both the page and every worker then resolve the same engine module from the same version of the build.

The build writes `null3d-third-party-notices.txt` at its root, with the engine's notices first and each add-on's after it. A host publishes the folder, which is a redistribution, so the notices travel with it.

The build stamps the folder with a hash of the engine's source files and of the files it copies, so a second run in the same checkout writes nothing. A first build of the engine alone in a checkout wrote 6,656 files and 2.52 GB, in a run whose log is not kept. Most of that is the device modules of each GPU path, each family of features and each value of the bits a device fixes. A page downloads only its own device's files, each on its first use.

Every engine worker starts through `spawnWorker`, the panorama worker of `scene/panorama.ts` among them. A worker started with `new Worker` directly fails on such a page, because the worker's script must have the page's origin. So an HDR environment loads on such a page, and its failures name the policy item or header that is missing.

### What proves it

`tests/image/cdn-script-tag.spec.ts` serves the build from another origin and draws a terrain from it. The terrain's shader comes from the pack-time compile, and the add-on's code imports the engine beside it. The page renders on each GPU path that the browser offers, in both thread modes. The four tests are WebGPU, compatibility mode and WebGL2 threaded, and WebGL2 single-threaded without the isolation headers. On the Mac's GPU all four passed (the run that commit 45d0b2b78 records). Every path drew the same frame mean, which shows that each path showed the same ground.

The Playwright test runs in Playwright's own browser builds. A hand run served the build from another origin and the two pages from their own origin, then opened them in Safari 26.2 and Firefox 158.0.1 on a Mac with an M3 Max. It used no Playwright, and the window stayed in front. Each browser ran the page single-threaded with no isolation headers, and single-threaded through an import map. It also ran the page threaded with the isolation headers, so every worker started from a `blob:` address. Each browser also drew the terrain add-on in threaded mode on core WebGPU. Every case drew, and no page reported an error (the runs that [Safari](../tested-devices/macbook-pro-m3-max-safari/20261027-script-tag.md) and [Firefox](../tested-devices/macbook-pro-m3-max-firefox/20261027-script-tag.md) record).

### Options rejected

- Put the shader modules in the npm package. They are hundreds of megabytes, and a project with a build step never reads them from there.
- Fetch the release asset's tar in the page and make modules of it. That adds a second loader, a policy item for the archive's origin and a slow start, for files that a CDN can serve as they are.
- One UMD file with a global, as three.js ships. The engine's workers, WebAssembly and first-use shader files stay files of their own by design (D-56 and the rules above). A single file would inline every device's shader builds, or would still load files beside it and gain nothing.
- Leave the add-ons out of the build. The page could not load them, and the add-on rule's CDN promise would stay unmet.
- Give the page's import map the add-on's engine import. A worker reads no import map, so the add-on fails as soon as the sketch runs in a worker.
- Ship a second copy of the engine beside each add-on. A page would load two engine modules and could mix versions.

### Limits

A page with no build step draws with the engine's own materials, geometry and shaders, and with the foundation add-ons. Custom shader WGSL needs the plugin's compile, and a TypeScript sketch needs a bundler. The docs page states both.

## The Gaussian splats add-on

The splats add-on ships as `@null3d/splats`, its own package whose version stays in step with the engine's. It claims the namespace `splats` and the error codes 2100 to 2199. It reads SPZ files in both containers: a legacy file is one gzip stream, and a version 4 file is a plain header, a table of contents and one zstd stream for each array, through the browser's `DecompressionStream`. It reads glTF files that carry `KHR_gaussian_splatting`, and it draws the first spherical-harmonic band's color; higher bands are ignored, which the extension allows.

### The draw goes through the feature draw hook

The cloud is one instance batch whose rows are the splats that draw: `scene.addFeatureInstances`, the many-copies form of M3-E1's feature draw. The add-on gives one quad and a surface function, and each row brings a center, rotations and spreads (the row's place, its quaternion and its scales), a linear RGBA color (the row's color) and four values. The shader projects each row's covariance, sizes a camera-facing card to its ellipse, and fades the card with the same ellipse; it reads the copy of the scene's depth (M3-E4) to fade a splat where it meets a mesh.

The per-splat sort is the engine's own: the transparent pass culls and sorts the batch's rows back to front on the job workers, on both GPU paths. The add-on adds no second sort, because a second sort would duplicate the one place that orders blended draws.

### Detail levels, streaming and the budget

`createSplats` cuts the cloud into chunks of nearby splats, each in importance order (blurred volume times opacity), so a prefix of a chunk is a coarser level of it: all, a half, a quarter and an eighth. A task on the job workers (M3-E2's `runTask`) chooses each chunk's prefix from its distance and the budget, nearest first, and the sketch writes the chosen rows between two frames. The chunks are cut one at a time, so the cloud appears coarse to fine and a large file holds up no frame.

The budget is a feature setting through M3-E6's `FeatureHost`: 100,000 splats on Low to 800,000 on Ultra, with lower counts on WebGL2, and the frame-budget governor lowers it again. The host reports the batch's memory to the stats overlay. GPU time is not measured for add-on features, so the overlay shows it as not measured.

### A chunk's level follows the cloud's size

A chunk's level measures its distance in the radius of the whole cloud, which the selector works out from the chunks' bounds and writes into the task's buffer. So a cut does not change a chunk's level. Measured in a chunk's own radius, a smaller chunk would pass for a farther one, and a view would draw fewer splats as the cloud is cut finer. That is a look regression, since a cut is not a change of what the camera sees.

| Cut of the 36,000-splat demo cloud | Distance in the chunk's own radius | Distance in the cloud's radius |
| --- | --- | --- |
| One chunk | 36,000 | 36,000 |
| 8 chunks, as it ships | 22,026 | 36,000 |
| 27 chunks | 12,563 | 35,403 |

The 27-chunk cut keeps 597 fewer because its far, smaller chunks cover less of the screen and their band asks for half. The distance still thins a cloud that is viewed from far, which is what the levels are for: 4,503 splats at 50 m either way. The budget still stops the total, so a device's preset decides how many draw and the levels decide where. The same 400,000-splat cloud draws its 250,000 budget near the camera, and its 10,000 cap in the streaming test.

- A screen-space rule, which would compare a chunk's apparent size with its splat count, was rejected. It draws fewer splats than the cloud holds whenever the view is dense, so it would keep the regression.
- The first view's byte bound below does not depend on this rule. The chunks it loads draw their chosen prefixes, and a budget that binds, as every device preset does, still caps the total.

### The stream is an index of SPZ files

The add-on reads a small index first. It then downloads only the chunks that the selection wants, nearest first, so a large cloud draws before all of its bytes arrive.

- SPZ version 4 stores one zstd stream for each attribute of the whole cloud. Its table of contents names six streams. It does not name a part of the cloud that a reader could fetch on its own. So a stream cannot be cut out of an ordinary SPZ file.
- The index is a JSON file of a few kilobytes. It names each chunk's file, its count, its bounds and its size. Each chunk is an ordinary SPZ file, so the reader that reads SPZ files reads a chunk with no change. The reader, `decodeSpz`, and the writer, `encodeSpz`, stay the only code that knows the SPZ layout.
- A binary container would put the same table in one file. The index keeps each chunk a file that a CDN caches on its own, and a person can read the index without a tool. It also needs no second binary format to validate.
- `chunkSplats` cuts a cloud, and `encodeSpz` writes each chunk. A converter makes a stream by writing the chunks as files and naming them in the index.
- A whole SPZ file and a glTF model load in one piece. A page that wants no stream pays nothing.

### The load path

`createSplats` reads the index, which arrives at once, and makes the draw from its counts and bounds. The selection task chooses each chunk's prefix from the chunk's bounds, which the index gives before any chunk has loaded. The sketch turns that answer into a fetch order, nearest first, and the loader keeps four requests in flight.

A chunk that fails is fetched twice more, with a wait that doubles. A request that sends nothing for 30 seconds is given up and counted as a failure. A chunk that still fails is reported in the console and counted in `splats.failed`. The rest of the cloud keeps drawing. A chunk that arrives after the camera moved away stays in memory but takes no row. The pack follows the last selection's counts, so a late chunk never draws where it no longer belongs.

`ready` resolves when the first view's chunks have loaded (next section). A moving camera can show a part of the cloud. The chunks that come into view arrive while it draws. `bytes` gives the cloud's size and `loadedBytes` gives the part that has arrived.

### The first view draws the nearest chunks

`ready` waits for the nearest chunks whose files fit in `FIRST_VIEW_BYTES`, one megabyte, and for the nearest chunk at least. The loader still fetches every chunk that the selection wants. The bound limits what the first frame waits for, not what the stream downloads. The rest keep arriving behind the frames that draw, and each arrival repacks the rows, so the cloud fills in.

A first view that waits for every chunk that the last `update` wants makes a fresh start slow. The wanted set follows the preset's budget. On a fresh visit the budget is still the engine's start preset, because the preset check runs after the first frame. A 400,000-splat cloud at Medium's 250,000 asks for the coarse level of every chunk, which is every chunk file. With that rule, the iPad's WebGPU page drew its first frame only after all 11 files, 5,628,772 bytes, had arrived. That was 28,581 ms after navigation, of which about 3 s was the GPU.

The test cloud of 400,000 splats is 27 chunks of 5,682,650 bytes. At Low's 50,000, Medium's 250,000 and the counts between, the selection wants all 27 chunks. The first view waits for 5 of them, 930,524 bytes served, or 16 per cent of the cloud.

- The first view can miss the chunks whose files lie beyond the megabyte. A view with no hole is given up on purpose: a blank screen for the whole download looks worse than a cloud that starts near the camera and fills in.
- A complete coarse view cannot be cheaper. Each chunk costs its whole file at any level, so an eighth of every chunk is still every file. A stream that wants a complete first view needs a separate coarse file of the whole cloud in its index. That is a format change with a writer, and it is not built.
- Capping the start budget with `setBudget` was rejected as the general answer. It puts the same decision on every app, and cannot follow a device that the preset check will lower anyway.
- `firstViewCount` decides the prefix, and it is a pure function with its own test. The loader reports `settled(index)`, which is true for a chunk that loaded and for one that stayed unreachable, so a failed nearest chunk cannot hold the first view forever.

### Streaming on the cloud devices

The streaming runs cut the test cloud of 400,000 splats into 11 chunk files, 5,628,772 bytes, with an index of 1.6 KB. Their first view waited for every chunk that the last update wanted. Two cloud devices ran the streaming plan:

| Device and path | Chunks loaded at the first view | Bytes at the first view | Presented fps |
| --- | --- | --- | --- |
| Galaxy S24, WebGL2 | 3 of 11 | 1,890,725 (34%) | 12.74 |
| iPad Pro 13, WebGL2 | 5 of 11 | 3,451,272 (61%) | 3.28 |
| iPad Pro 13, WebGPU | 11 of 11 | 5,628,772 (100%) | 1.06 |

The S24's display ran at 30 Hz and the Mac was loaded, so every timing figure there is unreliable. The rates match the runs of the same cloud as one file: 12.4, 3.29 and 1.07 frames a second. The draw held its settled budget on each page, and no chunk failed.

The iPad's WebGPU path loaded the whole cloud. The engine's startup preset check drew the feature at Medium before it settled at Low. Medium's 250,000-splat budget wanted every chunk at a coarse level. A cloud with many more chunks than the budget covers would load only its share. This one has 11, so the check wanted all of them. No test cloud should be tuned to hide that. A page that minds the check's download can set its own cap for the start, through `setBudget`.

The runs are [the iPad record](../tested-devices/ipad-pro-13-safari/20261024-171907-splats.md) and [the S24 record](../tested-devices/galaxy-s24-sm-s921b-chrome/20261024-171610-splats.md).

### The glTF extension registers as the add-on loads

M3-E3's handler API, `assets.registerGltfExtension`, registers for one sketch. A file that requires `KHR_gaussian_splatting` tells the developer to import the add-on, and an add-on's module has no sketch to register with. So the add-on hook has `registerGltfExtension(handler)`, which registers for every sketch of the thread. A sketch's own handler for the same extension reads its files in the add-on's place. A later add-on handler for one extension replaces the earlier one, so a development reload does not throw E1213.

### Limits

- A glTF model's splats draw in the file's order inside each part, and the model is cut into up to 64 parts that the transparent pass sorts by depth. A large cloud uses an SPZ file, whose rows the engine sorts one by one.
- A splat casts no shadow and receives none.
- The cards need the scene's depth copy, whose cost the material's scene input carries.

### Image tests

The add-on draws from both file kinds: an SPZ file whose cloud a sketch writes in code, and a glTF model that carries `KHR_gaussian_splatting`. The image tests draw a knot of splats above a ground with a bar in front of it, the same cloud under a capped budget, and a ribbon from a glTF model. Each draws on all three tiers and in all five thread modes. All 45 runs passed on the Mac's GPU and all 45 on SwiftShader, and each mode drew the other modes' picture (the runs that commit 110f8ca5e records). The iPhone's figures remain to be measured.

### Not the first user of a GPU-written instance count

M3-E9 plans a draw whose instance count the GPU writes. The splats add-on is not its first user. The splats draw is the engine's instance batch: the transparent pass culls and sorts its rows back to front on the job workers, and a GPU-written count would skip that sorted list, so the splats would blend in the wrong order. The count is also no per-frame problem here. It changes when the camera or the budget crosses a threshold, and the sketch then packs the chosen rows once between two frames. E9 therefore needs another first user, such as vegetation or hair, or a hook that keeps the engine's sorted rows.

### The splat budget is a count of drawn splats

The budget is a count of splats. The device runs and a control show that a count says little about what a page pays. The cost follows how much of the screen each splat's card covers, and the count says nothing about that.

The streaming check drew a 400,000-splat cloud whose cards are about 0.05 m wide, at 4 to 6 m from the camera. On the cloud devices, at the preset's own budget:

| Device and path | Preset | Drawn | Presented fps | Display |
| --- | --- | --- | --- | --- |
| iPad Pro 13, WebGPU | Low | 100,000 | 1.07 | 60 Hz |
| iPad Pro 13, WebGL2 | Low | 50,000 | 3.29 | 60 Hz |
| Galaxy S24, WebGL2 | Low, governor at 75% | 37,500 | 12.4 | 30 Hz |

A control ran the same page on the Mac's GPU at the iPad's own pixel count. The canvas was 1032 by 1376 at 2x, so 11.4 million pixels, with the budget pinned:

| Drawn | Presented fps | Frame interval | GPU ms per frame |
| --- | --- | --- | --- |
| 1 | 60 at the display's cap | 16.7 ms | 0.72 |
| 25,000 | 11.67 | 83.3 ms | 142.9 |
| 50,000 | 7.29 | 133.3 ms | 241.9 |
| 100,000 | 4.26 | 233.3 ms | 497.7 |

Three readings follow:

- Everything that is not the splats costs 0.72 ms of GPU time, under 1% of each frame. On the screen's schedule that part is at most one 60 Hz frame. Counting it so, the splats take 80%, 88% and 93% of the frame at 25,000, 50,000 and 100,000.
- The count alone does not set the cost. At 50,000 the same page drew 6.2 frames a second at 11.4 million pixels, against 24.0 at 0.9 million. The cards covered about 12 times the pixels for 3.9 times the frame time.
- A quarter of the count still misses a usable rate at the iPad's pixels: 11.67 frames a second for 25,000 splats.

The streaming runs repeat these figures at the cloud devices' own pixel counts. The iPad drew 75,000 splats at 1.06 frames a second on WebGPU, and 50,000 at 3.28 on WebGL2. The S24 drew 37,500 at 12.74 on a 30 Hz display. So a count alone cannot hold a frame target on a screen whose cards cover many pixels. Streaming does not change that: it lowers the bytes that a view downloads, not the fill that its splats cost.

The test cloud is the worst case for coverage. At 11.4 million pixels each card covers tens of thousands of pixels, so 100,000 of them cover the screen hundreds of times over. A scan's splats are usually far smaller on screen at the same distance, so the same count costs far less fill.

The owner chose to keep the count, on the audit's recommendation. The budget is a cap on the drawn splats, not a promise of a frame rate. A page whose cards cover a lot tunes the count itself, through `setBudget`, `capacity`, the camera or a lower preset, and the quality governor lowers it. A real scan pays nothing: it draws its full count, and its small cards leave room in the frame. A close camera or a scene of large cards still stalls, and the engine gives no warning and no guard. Keeping the count costs no code and no memory.

"Within its budget" means that the drawn count holds the preset's budget, or the governor's lower one, on the iPad and on an S24-class phone. One recorded frame rate of a real scan on each is still owed: the test cloud above is the worst case for coverage, not a scan. One test scene whose cards cover the screen many times over must not tune the engine.

The runs are [the cloud iPad's record](../tested-devices/ipad-pro-13-safari/20261024-074806-splats.md) and [the Galaxy S24's](../tested-devices/galaxy-s24-sm-s921b-chrome/20261024-074630-splats.md).

## Options rejected

- A coverage budget beside the count of splats, rejected by the owner's ruling on the audit's recommendation. The budget would become a pixel allowance, estimated from each chunk's radius and distance. It costs a setting per preset and GPU path, a coverage term in the selection task, tuning on the phones and the iPad, and a test scene of known coverage. It also turns a real scan coarser where the camera is close, and the batch's memory still follows the count. A count costs no code and no memory, and a page tunes it.
- Each add-on starts its own workers. A page with two add-ons would start three sets of threads, each with its own memory and start-up cost. Each add-on would solve the CDN problem again.
- Self-hosted worker copies: the page copies worker files to its own origin. That is the manual file copying that the add-on rule forbids, and a copy falls out of step with the engine's version.
- No CDN support. The owner's rule asks for CDNs. Some users try an engine from a CDN before they install anything.
- Point Draco users to the asset tool's converter only. Many three.js projects ship Draco files, and a port should load them as they are.

## Consequences

- M2-R18 builds the loader and the `blob:` bootstrap, and moves the core's workers and both decoders onto them (see "Built").
- M2-A6 builds Draco on the loader, with the per-file limits of fix group A.
- One notices file per build, which each add-on extends: Draco and Rapier are Apache-2.0 (R8-03).
- `docs/getting-started/hosting.md` gives the policy and the headers.
- AGENTS.md's rules for add-on modules point here.
