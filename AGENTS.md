# Rules for people and agents working in this repository

This repository holds the null3D engine, its tools, its documentation and its agent skills. This file holds the working rules. The pages in [`docs/`](docs/index.md) describe the design, and the [maintainer guides](.dev/README.md) in `.dev/` hold the detail behind these rules.

## Where things are

| Path | Contents |
| --- | --- |
| `docs/` | The user documentation as Markdown, one page per ID, with status front matter. It ships inside `@null3d/engine`. |
| `docs/data/threejs-mapping.json` | The single source of the three.js to null3D mapping |
| `skills/` | Agent skills for building with null3D and for porting three.js apps (the source) |
| `.claude/skills/` | A generated copy of `skills/` for Claude Code, which `bun install` writes. Git does not keep it. Never edit it. |
| `crates/` | The Rust crates: core, GPU layer, renderer, shaders, the WebAssembly entry point, and the modules that build tools load: the shader compiler and the asset tool's formats |
| `packages/` | npm packages: `engine`, `vite-plugin`, `controls`, and `cli`, which is the `null3d` command. Code in the repository reads their TypeScript source, and a pack builds their JavaScript, as [Releases](.dev/releases.md#the-npm-packages) says |
| `tests/` | Browser tests: test pages, the image test manifest and its reference images, the Playwright tests and the real-browser runner |
| `tools/` | The WebAssembly build, the docs generator, the skills check and the commit hooks |
| `examples/` | Feature demos: one sketch of under 150 lines each, listed in `examples/demos.ts`. The examples page runs each demo live, and the image test manifest draws each one in hold mode. A demo makes its content in code, and loads files only when loading is what it shows. The same folder builds from a clone and on the website ([Examples](.dev/examples.md)) |
| `bench/`, `templates/`, `porting-corpus/` | Benchmarks, starter projects and the three.js porting corpus, as the milestones add them. `bench/results` keeps a small record of each benchmark run ([Benchmarks](.dev/benchmarks.md#the-results-archive)) |
| `.dev/` | Maintainer guides: [benchmarks](.dev/benchmarks.md), [benchmark results](.dev/benchmark-results.md), [device sessions](.dev/devices.md), [examples](.dev/examples.md), [image tests](.dev/image-tests.md), [implementation notes](.dev/implementation-notes.md), [pull requests and parallel work](.dev/pull-requests.md), [releases](.dev/releases.md), [sample content](.dev/sample-content.md) and [tested devices](.dev/tested-devices.md) |
| `.dev/decisions/` | [Decision records](.dev/decisions/README.md): the data behind measured design choices. `bun run decisions` lists them. Read the record before you change a choice it settled |

## Commands

| Command | Use |
| --- | --- |
| `bun install` | Install the tools, set up the git hooks, and write the generated files, which git does not keep |
| `bun run build` | Build both WebAssembly files, the threaded one and the single-threaded one, the shader compiler for the Vite plugin, and the asset tool's formats for the command-line tool. Print their sizes and the sizes of the engine's JavaScript in a production build |
| `bun run build:check-size` | Build, then compare each file's size after Brotli compression with main's build. Fail when a file grew more than 2% and by 64 bytes or more, and no `Size-Growth:` trailer explains it. `--base <ref>` compares with another commit |
| `bun run test` | Unit tests for the engine, the benchmark scenes, the repository tools and the code that the demos share |
| `bun run test:browser` | The browser tests in Chrome, through Playwright: the image test manifest on every GPU tier, and the engine's behavior. The engine, errors and sketch shaders tests run again on a production build served by `vite preview`. CI splits the tests into shards with `--shard=1/2`, and runs the tests that check times and allocations alone, with `--grep @alone --workers=1`, as [image tests](.dev/image-tests.md#tests-that-run-alone) says |
| `bun run test:browser-weights` | Work out the shard weights of CI's `browser` job from the test times in recent CI runs on main, with the GitHub CLI, and print each shard's modelled time. [Image tests](.dev/image-tests.md#ci) says when to retune them |
| `bun run test:images` | The image test manifest alone. Add Playwright's options, such as `-g scene` for the tests whose names hold scene |
| `bun run images:review` | Show the images that runs saved because they have no reference or differ from it, each beside its reference and diff. `--accept` makes them references, and `--ci <run>` fetches a CI run's images first |
| `bun run test:shader-compiler` | Run the shader crate's build tests again through the shader compiler, which must give the native build's results, then the compiler's own tests and the Vite plugin's WGSL tests. Run `bun run build` first |
| `bun run test:packages` | Pack every public package as the publish job does, and check each tarball. Then install the tarballs into a fresh Vite project outside the repository, where the command-line tool's `test` command must pass on every GPU tier and `vite build` must work. Last, build a page of its own layout around a copy of `examples/`, as the website does, and start two demos and a comparison with three.js in each engine from that build. Run `bun run build` first. `--keep` keeps the project's folder |
| `bun run test:real-browsers Safari Firefox` | The same test pages and the image test manifest in browser apps that Playwright cannot drive, through the runner page (macOS) |
| `bun run devices` | The same checks in Chrome on an Android phone over USB and on a runner page that waits on the local network (an iPad's Safari) |
| `bun run devices:cloud` | The same checks on BrowserStack Automate's real phones, tablets and desktops, with no setup in a browser: `--tier A` or `--tier B` picks the devices of [device sessions](.dev/devices.md#browserstack-automate), `--only` names runners, `--part 1/3` runs a third of them, `--parallel` limits the sessions at once, and `--check` checks the account and the devices without a run |
| `bun run devices:record` | Print the record of tested devices as one table, with every run's plans and results. [Tested devices](.dev/tested-devices.md) says how the record is kept |
| `bun run test:bench` | The production build of the benchmark pages of both engines in Chrome, through Playwright |
| `bun run parity` | Compare each benchmark scene's hold frame in null3D with three.js's, per GPU tier; `--save-baselines` stores how much three.js's two renderers differ, for devices that lack one of them |
| `bun run bench:run` | The benchmark protocol in a visible Chrome window: fresh runs of each scene in both engines and of the scene code both run, with a summary of each engine's whole frame, own work, busiest thread and frame pacing; `--sweep` runs each scene from one object up, on both null3D paths in both latency modes and both three.js renderers, and compares each path with three.js's faster renderer and with three.js on the same API; `--jobs 1,2,4` runs the null3D pages at each job worker count; `--compare <baseline>,<new>` runs the null3D pages of two built checkouts in turns and fails when the new build is slower, as the benchmark job in CI does; `--shard 1/3` runs one share of those pages, as each CI shard does, and `--merge <folder>` judges the shares' records as one comparison; `--dev` runs the dev server's pages instead of the production build |
| `bun run bench:gpu-check` | Compare this checkout's GPU time per frame with main's in Chrome on this computer's GPU: S4 and S6 on WebGPU at Medium and High, in turns. The first run takes about 15 minutes with both builds. It prints the `GPU-Checked:` trailer line that a pull request which changes how the GPU draws needs; `--base <dir>` compares with another built checkout, and `--no-build` skips building this one |
| `bun run bench:allocation` | Sample what the sketch worker and the render worker allocate per frame in S1, with Chrome's heap profiler; `--gpu webgl2` samples the WebGL2 path, `--scene s1-cells` samples S1-cells, which skips whole grid cells, `--scene s3` samples S3, whose 256 point lights move, `--scene s4` samples S4, the phone scene, `--blend` makes S1's boxes see through so each frame sorts them for the transparent pass, `--animated 64` adds 64 skinned characters to S1 for the animator and the skinning, `--morphed 64` adds 64 morphed spheres whose weights change every frame, `--grading` gives S1 a color grading table and the vignette, `--sprites` draws S1's swarm as blended sprites, `--lines` draws it as dashed line segments, `--ao` turns ambient occlusion on in S1, `--bloom` turns bloom on in S1 and changes it every frame, `--dof` turns depth of field on in S1 and moves its focus every frame, `--outline` adds outlined boxes and changes the outline every frame, `--tile-shadows` adds spot and point lights whose shadow tiles draw again every frame, `--batch-shadows` makes S1's rows cast and receive the sun's shadows, `--labels 256` adds 256 moving HTML labels to S1, `--environment` lights S1 with the built-in room and turns it every frame, `--effects` adds two custom effects to S1 and changes their uniforms every frame, `--sky` draws three.js's sky behind S1 and moves its sun every frame, `--sky-environment` also lights S1 with the sky's environment, which refreshes while the sun moves, `--reflection` puts water under S1 that a reflection pass mirrors the swarm into while the camera orbits, `--transmission` puts clear water under S1 that lets the light below through, from a copy of the frame's opaque colors, `--prepass` turns the depth prepass on, `--stats` shows the stats overlay so the engine samples its costly figures, `--stats-collapsed` shows it collapsed, which samples none of them, `--no-inline` turns the browser's inlining off so each function's objects show in its own place, and `--dev` the dev server's pages |
| `bun run bench:profile` | Sample Chrome's CPU profiler on the render worker while each benchmark scene runs, and split the time of the draw-list replay into the engine's own code and the browser calls it makes; `--gpu webgpu` profiles the WebGPU path, `--thread sketch` profiles the sketch worker's frame step instead, `--android` profiles Chrome on a phone connected by USB, and `--dev` the dev server's pages |
| `bun run bench:startup` | Starts of the engine test page's production build in Chrome, from navigation to the first frame: the medians of each stage, requests and bytes. By default it times cold loads on Slow 4G. `--loads cold,warm`, `--network slow-4g,full` and `--modes all` add warm loads, full speed and every thread mode. `--android` runs them all in Chrome on a phone connected by USB |
| `bun run bench:soak` | S1 in Chrome for 10 minutes, with the JavaScript heap of the page and of each engine worker and the WebAssembly memory sampled every 30 seconds. It fails when the sketch worker's or the render worker's heap grows after the warm-up, or when the WebAssembly memory does; `--scene s4` runs S4, `--gpu webgl2` and `--minutes` change the GPU path and the length, and `--dev` runs the dev server's pages |
| `bun run bench:archive` | Write a small record of a benchmark, comparison, sweep, scale, governor, soak, startup or gate run to `bench/results/<run>.json`, and print its rows for the [benchmark results](.dev/benchmark-results.md) page. Name run folders or run names; `--rows` prints the rows of every record |
| `bun run gate` | The Mac's part of M1's exit gate, one step after another: the image test manifest on the Mac's GPU and on SwiftShader, the parity check, the budgets, the docs checks, the release version, the commit's CI and benchmark job, the desktop speed target, S3, S1-cells and S4 against three.js, the allocation check and the soak on S4, and the time to first frame. It writes the record to `target/gate/`. `--quick` makes the benchmark runs fewer and shorter for a rehearsal, `--only` and `--skip` pick steps, and `--list` prints them |
| `bun run readme-media` | Render the README's animation of S1 with the engine |
| `bun run dev` | Serve the test pages, the benchmark pages and the demos with the isolation headers on port 5173, or on the port that `NULL3D_PORT` names |
| `bun run examples:build` | Build the examples page and every demo for production into `target/examples/`, against this checkout's packages, with the engine's address switches on. Run `bun run build` first |
| `bun run examples:preview` | Serve the examples build with the isolation headers and the sample files, on port 5173 or the port that `NULL3D_PORT` names |
| `bun run dev-cert` | Make a local HTTPS certificate for testing on phones and tablets |
| `bun run android` | Forward port 5173 to an Android phone connected by USB |
| `bun run docs` | Write the generated files: placeholder pages, the API reference pages, the error pages, the list of all pages, the quality preset tables, the tested device tables, the mapping page and copies, and the skills copy. Git keeps none of them |
| `bun run docs:check` | Write the generated files, then check the API reference's doc comments, front matter and links, that git keeps no generated file, that this table lists every command, and that every decision record has a title, a status and a summary under its own number |
| `bun run decisions` | List the decision records, each with its status and summary, read from the records themselves |
| `bun run docs:style` | Check the writing rules in all published Markdown |
| `bun run skills` | Write `.claude/skills/` from `skills/`, then check the skills |
| `bun run skills:check` | Check the skills without writing the copy |
| `bun run samples:fetch` | Download the sample content at the pinned commit into the cache that every copy of the repository shares, and check each file's SHA-256. `--verify` hashes the cached copy again, and `--pin <commit or branch>` pins another commit. [Sample content](.dev/sample-content.md) says how tests use it |
| `bun run shaders` | Build every shader variant in the shader manifest and write the generated TypeScript modules, when they are missing or out of date: the main module, the engine's shaders in one module for each GPU path and each value of the bits a device fixes, and one module for each GPU path of each shader that loads on first use. Git ignores the modules, and the build, the type check, the tests and the dev server run this step first |
| `bun run check` | Lint and format check (Biome), then the image test references: each manifest test must have the references of both sets, and each reference must belong to a test |
| `bun run check:fix` | Lint and format, fixing what Biome can |
| `bun run typecheck` | TypeScript check |
| `bun run release` | Print the next version and its changelog. `--apply` writes them, as the Release workflow does, and `--notes <version>` prints one release's notes |

A file can grow after Brotli against main's build by more than 2%, and by 64 bytes or more. It then needs a reason: a `Size-Growth:` trailer, as "Commit gates" says. A file over its budget fails every build. Each WebAssembly file may take 600 KB after Brotli. The engine's JavaScript that a page downloads at its start may take 140 KB after Brotli, 448 KB after gzip and 3,328 KB uncompressed. Some files of engine code load on a feature's first use, or after the first frame. Each may take 16 KB after Brotli, 24 KB after gzip and 64 KB uncompressed. A feature that a page does not use loads its code on first use, so it adds nothing to the start. Its shader builds load on first use too, from files that its table in the shader manifest declares ([D-56](.dev/decisions/D-56-first-use-shader-files.md)). Each such file may take what one start shader file may: 32 KB after Brotli, 320 KB after gzip and 1,536 KB uncompressed. Only the owner raises a budget, in writing. The owner approved these figures for M2 on 2026-10-04, as [D-14](.dev/decisions/D-14-js-budget.md) records. [Benchmarks](.dev/benchmarks.md#download-size) says how the check builds main.

## Design principles

These ten principles decide design conflicts, and a higher one wins over a lower one. Speed comes first because it is the reason the engine exists. Ease of use comes last, but it still binds.

1. Measure before and after. Every performance claim has a benchmark in CI. A change that slows a benchmark does not merge without a written reason.
2. Data first. Scene data lives in flat arrays that fit the CPU cache. Code processes the arrays in bulk, not objects one at a time.
3. One copy of each piece of data. The core owns scene data, and TypeScript reads and writes the same memory. There are no mirrored objects and no per-frame sync.
4. Do work once. Cache results (static shadow maps, render bundles, compiled pipelines) and update only what changed, through dirty flags and dirty ranges.
5. Move bulk work off the critical path. On WebGPU it goes to the GPU; on WebGL2 it goes to job workers.
6. The main thread belongs to the page. When a worker is available, the engine does no frame work on the main thread.
7. No garbage in the frame loop. TypeScript hot paths allocate nothing, and Rust uses memory arenas that reset each frame.
8. Pay only for what you use. Optional modules and decoders load only when a sketch needs them.
9. Both backends are first-class. A feature ships only when it works on WebGPU and WebGL2, or when its WebGL2 fallback is documented.
10. Simple for people and agents. There is one clear way to do each task, and every error message says how to fix the problem.

## Hard rules

Code review enforces these rules.

1. No per-frame allocation in TypeScript hot paths or in the render worker. Rust frame code uses arenas and pools only, never a general-purpose allocator. The objects that the browser itself returns each frame are the only exception, and `bun run bench:allocation` budgets each of them.
2. The render worker owns every GPU object. No other thread touches browser GPU objects.
3. The render worker draws only inside its own `requestAnimationFrame` callback.
4. No thread waits synchronously for another on the critical path, and no worker makes a synchronous call to the main thread.
5. The sketch worker and the render worker wait with `Atomics.waitAsync` (a `MessageChannel` message on Firefox before 145). Only job workers block with `Atomics.wait`.
6. The WebGPU path stays within WebGPU's default limits. Where the engine supports compatibility mode, it also stays within that mode's lower limits (the portable budget in [GPU tiers and backends](docs/concepts/backends.md#the-portable-budget)). Anything beyond these needs a capability flag and a fallback. For example, compute workgroups use at most 128 invocations.
7. Per-instance data reaches vertex shaders through vertex buffers, never through storage buffers. The one exception is the `?instances=index` test switch on core WebGPU, which [D-23](.dev/decisions/D-23-index-instances.md) measures.
8. Indirect draws keep first-instance at 0. Buckets select their data with vertex-buffer offsets.
9. Dynamic buffer offsets align to 256 bytes.
10. WGSL uses only the three language features that Chrome, Safari and Firefox all report: `packed_4x8_integer_dot_product`, `pointer_composite_access` and `readonly_and_readwrite_storage_textures`. Any other language feature needs a capability flag and a fallback. Flat interpolation uses `@interpolate(flat, either)`.
11. Optional WebGPU features are used only after a capability check. They are transient attachments, immediates, subgroups, timestamp queries, `shader-f16`, `rg11b10ufloat-renderable`, `float32-filterable`, `float32-blendable`, and each texture-compression family. A missing limit counts as absent, not as zero.
12. Float textures that need filtering use 16-bit floats. 32-bit float data textures are read without filtering (`textureLoad`, `texelFetch`).
13. On WebGL2, request each extension by name with `getExtension()`. Never trust `getSupportedExtensions()`, because Brave shuffles it.
14. Never decide anything from GPU names or user agents. Firefox and Brave can hide GPU names.
    - One exception, until Safari ships WebKit's fix: the WebGPU backend copies indirect draw arguments only in Apple's WebKit ([D-87](.dev/decisions/D-87-webkit-indirect-arguments.md), which says how to remove it).
15. Core Rust code never calls APIs that fail on `wasm32-unknown-unknown`, such as `std::time::SystemTime::now()`. Time comes from the engine clock, and a lint enforces this.
16. Tests read pixels back through the engine. They never encode images through a canvas in the page and never rely on browser screenshots.
17. A change that makes a benchmark median more than 3% slower does not merge without a written reason, given in a `Bench-Expected:` trailer.
18. A pull request that changes a public API also updates the API's docs page and any skill that shows the API. It updates the API's three.js mapping entry too, where one exists.
19. The pull request that ships a feature changes its docs status from `planned` to `experimental` or `stable`. Agents never use planned APIs.

## Performance work

The benchmarks compare null3D with three.js in the same browser. [Benchmarks](.dev/benchmarks.md) says how to run them and read them. [Device sessions](.dev/devices.md) covers phones, tablets and the Mac's browser apps. [Implementation notes](.dev/implementation-notes.md) holds the habits and browser faults behind the hard rules. These points apply to every change:

- A report gives each engine's whole frame and its own work on the busiest thread. The desktop target uses own work, because both engines run the same scene code.
- Do not edit engine or benchmark page files, or the dev server's config, during a browser run. The dev server reloads the pages being measured, and restarts when its config changes.
- The benchmarks measure a production build of the benchmark pages, as developers ship the engine, so the development checks do not count. The tools take `--dev` for the dev server's pages.
- Every tool finds the dev server on port 5173, and uses the one that already answers there. A second copy of the repository, such as a git worktree, would test the first copy's code. Give each copy its own ports with `NULL3D_PORT`, for example `NULL3D_PORT=6173 bun run test:browser`. Its dev server takes that port, the HTTPS server the next one, and the production preview the one after. Tools that drive Chrome through its debugging protocol take the one after that.
- The benchmark job in CI compares main's newest commit with the last commit on main that it measured, at most once an hour. Mac machines run its pages in shards, and a last job merges them into one verdict. With the `benchmark` label, it compares a pull request with its merge base. It fails when a page gets slower than its rule allows. [Benchmarks](.dev/benchmarks.md#the-benchmark-job-in-ci) says how to read it.
- After a pull that changes the Vite plugin or the Vite config, run `bun run build` and restart the dev server before a browser run. The dev server keeps the plugin it started with, as [Device sessions](.dev/devices.md#the-runner) says.
- Run one device runner at a time. Runs share one file that tells waiting runner pages which run to start.
- Keep hot paths free of allocation with the habits in the implementation notes, and check them with `bun run bench:allocation`.

## Parity with three.js and add-on modules

The owner set these rules on 4 October 2026. [D-52](.dev/decisions/D-52-intent-parity.md) gives the detail and the reasons.

1. Intent parity is strict. null3D shows what files and authors mean: glTF, materials, color spaces, units, and animation curves and sampling. Check them against the glTF specification, with three.js as the reference.
2. Look parity is "equivalent or better". Each feature uses the best technique as its default. The porting skill and the port tools map three.js's settings onto it and list the visible differences.
3. The core engine has no three.js-look modes. The few that a port truly needs go in the opt-in `three-compat` add-on module. That module uses only the engine's public extension points and loads on first use.
4. A benchmark compares equal work: the same scene content and comparable quality settings. Its report gives quality notes beside the timings. The images need not be identical.
5. Pixel tests against three.js cover only shared building blocks: lighting terms, tone curves that both engines offer, skinning poses, animation sampling and glTF interpretation. A feature with a better technique gets null3D's own references, and a looser sanity comparison with three.js.
6. Built-in assets are made at run time. The engine's package never ships them as files.
7. Heavy or niche features ship as add-on modules. Each takes one install and one import, with no manual file copying. It works with Vite and the null3D plugin, the one supported bundler, and from CDNs, under a strict Content Security Policy. Its code loads files the standard way (`new URL('<file>', import.meta.url)`), so other bundlers stay possible ([D-54](.dev/decisions/D-54-addon-modules.md#bundlers)). Its version stays in step with the engine's, and its code loads on first use.
8. Add-ons and the engine's first-use decoders load through the one on-demand loader (`shared/tasks.ts`). It compiles each WebAssembly module once per page and sends it to the workers that run it. Add-ons run in the job workers and start no workers of their own. A decoder's task never holds up a frame. [D-54](.dev/decisions/D-54-addon-modules.md#built) gives the detail.
9. Every engine worker starts through `spawnWorker`, in the form `new Worker(new URL('<file>', import.meta.url), options)`, which adds a `blob:` bootstrap for a script on a CDN. Engine code names every file it loads with `new URL('<file>', import.meta.url)` and no Vite-only query. A third-party script that the engine ships makes no code from strings, so a policy without `'unsafe-eval'` runs it.
8. What a glTF file or a standard scene needs stays in the core and loads on first use. Examples are morph targets, environment light and Draco. Optional features with heavy machinery of their own are add-ons.
9. One loader in the engine loads first-use WebAssembly, for the core and for add-ons, into the engine's job workers. An add-on starts no workers of its own.
10. The bundled path comes first. From a CDN, every worker starts from one `blob:` bootstrap in the engine. The docs give the policy and the headers that it needs, and the engine names what is missing. [D-54](.dev/decisions/D-54-addon-modules.md) gives the detail.

## Docs and skills stay in sync

1. One source per fact. The API reference comes from TypeScript doc comments, the three.js mapping from `docs/data/threejs-mapping.json`, and the page inventory from `tools/lib/docs.ts`. Skills link to docs pages by ID and do not copy facts.
2. Never commit a generated file, unless [D-105](.dev/decisions/D-105-generated-files-out-of-git.md) gives the reason to keep it. Git ignores each generated file, and a written page links to a generated page that it needs. [Generated files](.dev/pull-requests.md#generated-files) lists each one, its generator and the step that builds it. The install step, `bun install`, writes them. The git hooks write them again after each checkout, merge or rebase, and before each commit. Run `bun run docs` to see a change of a source at once. A new generator writes only into paths that `.gitignore` names.
3. A placeholder page carries a marker comment, and `bun run docs` rewrites it. Git ignores each placeholder page by name in `.gitignore`. When you write the real page, remove the marker and the page's line in `.gitignore`. The generator then leaves the page alone.
4. Every docs page has front matter: `id`, `title`, `status` (`planned`, `experimental`, `stable` or `generated`), `since` and `summary`.
5. The API reference on the `api/` pages comes from the TSDoc comments on the engine's public exports. Each export needs a summary and a `@category api/<page>` tag that names its page. Each public member needs a summary too. A public declaration may name only types that the engine exports. The generator writes each written API page's reference on a page of its own, `docs/api/reference/<page>.md`. The written page links to it under its "API reference" heading, and the docs check refuses a written page without that link.
6. The skills give each call the first version that has it, such as (0.2) or (after 1.0). A part of the current version that is not built yet says "later in 0.1". A TypeScript code block in a skill that exports `defineSketch(...)` is a complete sketch. The unit tests (`bun run test`) type check each one against the engine. The browser tests (`bun run test:browser`) draw each one in hold mode on every GPU tier. The tests leave out a sketch under a heading that names a later version. Remove the version from the heading when the feature merges.

## Writing docs

Published Markdown (every page under `docs/`, the skills, the README, the package READMEs, `CHANGELOG.md`, this file and the guides in `.dev/`) follows these rules.

- Write plain English in short sentences, at most 25 words each, in the active voice. Simplified Technical English is the model.
- Use sentence case in headings, with no emojis.
- Use no dashes as connectors. Use a comma, a colon, parentheses or a new sentence.
- Use straight quotes and apostrophes.
- A concept page opens with a Mermaid diagram and a plain explanation, followed by examples.
- A page describes what exists now. Its status label says whether the feature is built. When only part of a page's feature is built, the page is `experimental`. The note under its title then names the parts that are not built yet.
- Write for developers who use the engine. Never mention the maintainers' milestones, checkpoints, task IDs, proposals or internal plans, and never explain where a fact came from in those terms. Give the reason when it helps the reader, such as a browser or GPU limit. Name the engine's benchmarks when you cite a figure. Notes for maintainers belong in code comments, in this file or in the guides in `.dev/`. Those files are for contributors, so this rule does not apply to them, but public docs never link to them.
- Commit subjects and pull request titles become lines in the public changelog, so they follow these rules too.
- Show commands with Bun: `bun add`, `bun install`, `bun run` and `bunx`, never the npm or npx forms. Run the command line tool as `bunx @null3d/cli <command>`, with the scope. Both rules cover code blocks too.
- Run the humanizer skill over any prose you write or change. This covers user-facing text that lives in data or code too: the mapping notes, error messages and TSDoc comments.

The docs style check catches the mechanical part of these rules. It blocks build-process words such as milestone and checkpoint, and the command line tool run by the wrong name. It checks each commit subject too. The humanizer pass and your own re-reading cover the rest.

## Record the reasons

The owner set this rule on 7 October 2026. Every pull request records its reasons in `.dev/`, in the same pull request. Pull request text, commit messages and chat are not enough.

- A design choice or an owner's ruling: a [decision record](.dev/decisions/README.md), new or an addendum. It gives the problem, the figures, the options rejected and why, and who decided and when.
- A bug fix: the cause, and why the fix is right, in the record or guide that owns the area. Examples are the [implementation notes](.dev/implementation-notes.md), the driver bugs, the [image tests](.dev/image-tests.md) and the [benchmarks](.dev/benchmarks.md).
- A device or benchmark run: a new run file in the [tested devices](.dev/tested-devices.md) record, or a row in the [benchmark results](.dev/benchmark-results.md).
- A lesson about process or tools: the guide that covers it, such as [pull requests and parallel work](.dev/pull-requests.md) or the benchmarks.

The `Docs-Checked:` trailer names the `.dev` page that holds the reason, or says why there is no new reason. [Pull requests and parallel work](.dev/pull-requests.md#before-you-open-a-pull-request) gives an example of each kind.

## Commit gates

`bun install` sets up git hooks that keep the docs in line with the code. Never skip them with `--no-verify`: CI runs the same checks and fails the pull request.

Before each commit:

- Biome (errors only) and the TypeScript check.
- When Rust files or Cargo settings are staged: `cargo fmt --check` and Clippy, with warnings treated as errors.
- The generators run clean. The hook writes the generated files, and fails when a public export lacks the doc comments that the API reference needs. It also fails when git would keep a generated file.
- Every command in `package.json` is in the table under "Commands", and every command that this file, the README and the guides in `.dev/` run with `bun run` exists.
- Every decision record starts with its title, then a `Status:` and a `Summary:` paragraph, and no two records share a number.

On each commit message:

- The message follows [Conventional Commits](https://www.conventionalcommits.org/). The scope names the area, such as `core`, `gpu`, `engine`, `docs`, `tools` or `ci`.
- A commit that changes `crates/*/src/`, `packages/*/src/`, `packages/*/bin/` or `skills/` needs a `Docs-Checked:` trailer. This file, the README and the guides in `.dev/` describe the repository's tools, so a commit that changes the tools needs one too. They are `tools/`, `bench/` apart from its tests, the test runner (`tests/real-browsers.ts` and `tests/lib/`) and `package.json`. The trailer names the docs pages you updated or re-read, or says why none apply. The pass also confirms that those pages speak only to developers who use the engine.
- A commit that changes a package's source, the WGSL shader library, `skills/` or `docs/data/threejs-mapping.json` needs a `Skills-Checked:` trailer. It names the skill files you updated or re-read.
- A pull request that changes how the GPU draws needs a `GPU-Checked:` trailer: the line that `bun run bench:gpu-check` prints. It goes on the last commit that makes such a change, or on a later one. This covers `crates/null3d-shaders/src/`, `crates/null3d-shaders/wgsl/`, its `shaders.toml`, and `packages/engine/src/gpu/`, `render/` and `quality/`, less tests. CI's benchmark job has no GPU timer, so the check runs on a computer with a GPU of its own ([Pull requests](.dev/pull-requests.md#the-gpu-check), [D-109](.dev/decisions/D-109-gpu-time-guard.md)).
- A commit that makes a benchmark median slower on purpose needs a `Bench-Expected:` trailer. It names the benchmarks and gives the reason, as [Benchmarks](.dev/benchmarks.md#mark-an-expected-slowdown) shows. The benchmark job in CI reads it.
- A file that grows after Brotli against main's build needs a `Size-Growth:` trailer on a commit of the pull request. This applies when it grows by more than 2% and by 64 bytes or more, and to each new file. Without the byte floor, the hashed file names in a small file fail the check. A pull request must not fail CI for a failure that anyone can predict ([Benchmarks](.dev/benchmarks.md#download-size)). Put the trailer on a plain commit, not a merge commit. The squash onto main drops merge commits' messages, so the check reads none of their trailers. The trailer names each file as the size report prints it and gives the reason, such as `Size-Growth: js/page.js +3.1%, the key table of the input ring`.
- Every internal link in the published Markdown resolves, and new external links in changed files answer.
- Changed published Markdown and the commit's subject pass the docs style check. Errors block the commit; warnings only print.

A trailer value must say what you checked. Bare values such as "yes" or "done" are rejected. For example:

```text
feat(engine): add setScale to objects

Docs-Checked: updated docs/api/objects.md; re-read docs/concepts/static-dynamic.md
Skills-Checked: updated skills/null3d-develop/references/api-quickref.md
```

Maintainers also add a `Task:` footer with the milestone task ID.

## Releases

Pull requests merge by squash only, with no merge queue ([D-99](.dev/decisions/D-99-no-merge-queue.md)). CI runs every job on each pull request that is ready for review, on GitHub's merge of it into main. The pull request merges once that run passes. A draft runs only the quick checks. Before a merge, test the pull request with current main and with each pull request that merges before it. Each push to main runs every job again, and while main's run fails, nothing merges until a fix lands. The squash writes one line on main: the pull request's title, or the commit's subject when the pull request has one commit. That line becomes a changelog entry, so the PR title workflow checks it with commitlint and the docs style check. [Pull requests and parallel work](.dev/pull-requests.md) covers merging main into a branch, the steps before a merge, and what CI runs on each event. It also covers several copies of the repository on one machine. [Releases](.dev/releases.md) covers how a release is made.
