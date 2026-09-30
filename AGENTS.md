# Rules for people and agents working in this repository

This repository holds the null3D engine, its tools, its documentation and its agent skills. This file holds the working rules. The pages in [`docs/`](docs/index.md) describe the design, and the [maintainer guides](.dev/README.md) in `.dev/` hold the detail behind these rules.

## Where things are

| Path | Contents |
| --- | --- |
| `docs/` | The user documentation as Markdown, one page per ID, with status front matter. It ships inside `@null3d/engine`. |
| `docs/data/threejs-mapping.json` | The single source of the three.js to null3D mapping |
| `skills/` | Agent skills for building with null3D and for porting three.js apps (the source) |
| `.claude/skills/` | A generated copy of `skills/` for Claude Code. Never edit it. |
| `crates/` | The Rust crates: core, GPU layer, renderer, shaders, the WebAssembly entry point, and the shader compiler that build tools load |
| `packages/` | npm packages: `engine`, `vite-plugin`, and `cli`, which is the `null3d` command |
| `tests/` | Browser tests: test pages, the image test manifest and its reference images, the Playwright tests and the real-browser runner |
| `tools/` | The WebAssembly build, the docs generator, the skills check and the commit hooks |
| `examples/` | Feature demos: one sketch of under 150 lines each, listed in `examples/demos.ts`. The examples page runs each demo live, and the image test manifest draws each one in hold mode |
| `bench/`, `templates/`, `porting-corpus/` | Benchmarks, starter projects and the three.js porting corpus, as the milestones add them |
| `.dev/` | Maintainer guides: [benchmarks](.dev/benchmarks.md), [device sessions](.dev/devices.md), [image tests](.dev/image-tests.md), [implementation notes](.dev/implementation-notes.md) and [releases](.dev/releases.md) |
| `.dev/decisions/` | [Decision records](.dev/decisions/README.md): the data behind measured design choices. Read the record before you change a choice it settled |

## Commands

| Command | Use |
| --- | --- |
| `bun install` | Install the tools and set up the git hooks |
| `bun run build` | Build both WebAssembly files, the threaded one and the single-threaded one, and the shader compiler for the Vite plugin. Print their sizes and the sizes of the engine's JavaScript in a production build |
| `bun run build:check-size` | Build, then compare each file's size after Brotli compression with main's build. Fail when a file grew more than 2% and no `Size-Growth:` trailer explains it. `--base <ref>` compares with another commit |
| `bun run test` | Unit tests for the engine, the benchmark scenes and the repository tools |
| `bun run test:browser` | The browser tests in Chrome, through Playwright: the image test manifest on every GPU tier, and the engine's behavior. The engine, errors and sketch shaders tests run again on a production build served by `vite preview`. CI splits the tests into shards with `--shard=1/2` |
| `bun run test:images` | The image test manifest alone. Add Playwright's options, such as `-g scene` for the tests whose names hold scene |
| `bun run images:review` | Show the images that runs saved because they have no reference or differ from it, each beside its reference and diff. `--accept` makes them references, and `--ci <run>` fetches a CI run's images first |
| `bun run test:shader-compiler` | Run the shader crate's build tests again through the shader compiler, which must give the native build's results, then the compiler's own tests and the Vite plugin's WGSL tests. Run `bun run build` first |
| `bun run test:real-browsers Safari Firefox` | The same test pages and the image test manifest in browser apps that Playwright cannot drive, through the runner page (macOS) |
| `bun run devices` | The same checks on an Android phone over USB (Chrome, then Brave) and on runner pages that wait on the local network (an iPad's Safari and Brave). Add `--shields on` or `--shields off` to record the state of Brave's Shields |
| `bun run test:bench` | The production build of the benchmark pages of both engines in Chrome, through Playwright |
| `bun run parity` | Compare each benchmark scene's hold frame in null3D with three.js's, per GPU tier; `--save-baselines` stores how much three.js's two renderers differ, for devices that lack one of them |
| `bun run bench:run` | The benchmark protocol in a visible Chrome window: fresh runs of each scene in both engines and of the scene code both run, with a summary of each engine's whole frame, own work, busiest thread and frame pacing; `--sweep` runs each scene from one object up, on both null3D paths in both latency modes and both three.js renderers, and compares each path with three.js's faster renderer and with three.js on the same API; `--jobs 1,2,4` runs the null3D pages at each job worker count; `--compare <baseline>,<new>` runs the null3D pages of two built checkouts in turns and fails when the new build is slower, as the benchmark job in CI does; `--dev` runs the dev server's pages instead of the production build |
| `bun run bench:allocation` | Sample what the sketch worker and the render worker allocate per frame in S1, with Chrome's heap profiler; `--gpu webgl2` samples the WebGL2 path, and `--dev` the dev server's pages |
| `bun run bench:profile` | Sample Chrome's CPU profiler on the render worker while each benchmark scene runs, and split the time of the draw-list replay into the engine's own code and the browser calls it makes; `--gpu webgpu` profiles the WebGPU path, `--thread sketch` profiles the sketch worker's frame step instead, `--android` profiles Chrome on a phone connected by USB, and `--dev` the dev server's pages |
| `bun run bench:startup` | Starts of the engine test page's production build in Chrome, from navigation to the first frame: the medians of each stage, requests and bytes. By default it times cold loads on Slow 4G. `--loads cold,warm`, `--network slow-4g,full` and `--modes all` add warm loads, full speed and every thread mode. `--android` runs them all in Chrome on a phone connected by USB |
| `bun run bench:soak` | S1 in Chrome for 10 minutes, with the JavaScript heap of the page and of each engine worker and the WebAssembly memory sampled every 30 seconds. It fails when the sketch worker's or the render worker's heap grows after the warm-up, or when the WebAssembly memory does; `--gpu webgl2` and `--minutes` change the GPU path and the length, and `--dev` runs the dev server's pages |
| `bun run readme-media` | Render the README's animation of S1 with the engine |
| `bun run dev` | Serve the test pages, the benchmark pages and the demos with the isolation headers on port 5173, or on the port that `NULL3D_PORT` names |
| `bun run dev-cert` | Make a local HTTPS certificate for testing on phones and tablets |
| `bun run android` | Forward port 5173 to an Android phone connected by USB |
| `bun run docs` | Regenerate placeholder pages, the API reference, the error pages, the page list in `docs/index.md`, and the mapping page and copies |
| `bun run docs:check` | Check the API reference's doc comments, front matter, generated files and links, and that this table lists every command |
| `bun run docs:style` | Check the writing rules in all published Markdown |
| `bun run skills` | Sync `.claude/skills/` from `skills/`, then check the skills |
| `bun run skills:check` | Check the skills without syncing |
| `bun run shaders` | Build every shader variant in the shader manifest and write the generated TypeScript modules: the main module, and the engine's shaders in one module for each GPU path and each value of the bits a device fixes |
| `bun run shaders:check` | Fail when a committed shader module is out of date |
| `bun run check` | Lint and format check (Biome) |
| `bun run check:fix` | Lint and format, fixing what Biome can |
| `bun run typecheck` | TypeScript check |
| `bun run release` | Print the next version and its changelog. `--apply` writes them, as the Release workflow does, and `--notes <version>` prints one release's notes |

A file that grows more than 2% after Brotli against main's build needs a reason: a `Size-Growth:` trailer, as "Commit gates" says. A file over its budget fails every build. The budgets are 600 KB after Brotli for each WebAssembly file, and 70 KB for the engine's JavaScript that a page downloads. Only the owner raises a budget, in writing. [Benchmarks](.dev/benchmarks.md#download-size) says how the check builds main.

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
7. Per-instance data reaches vertex shaders through vertex buffers, never through storage buffers.
8. Indirect draws keep first-instance at 0. Buckets select their data with vertex-buffer offsets.
9. Dynamic buffer offsets align to 256 bytes.
10. WGSL uses only the three language features that Chrome, Safari and Firefox all report: `packed_4x8_integer_dot_product`, `pointer_composite_access` and `readonly_and_readwrite_storage_textures`. Any other language feature needs a capability flag and a fallback. Flat interpolation uses `@interpolate(flat, either)`.
11. Optional WebGPU features are used only after a capability check. They are transient attachments, immediates, subgroups, timestamp queries, `shader-f16`, `rg11b10ufloat-renderable`, `float32-filterable`, `float32-blendable`, and each texture-compression family. A missing limit counts as absent, not as zero.
12. Float textures that need filtering use 16-bit floats. 32-bit float data textures are read without filtering (`textureLoad`, `texelFetch`).
13. On WebGL2, request each extension by name with `getExtension()`. Never trust `getSupportedExtensions()`, because Brave shuffles it.
14. Never decide anything from GPU names or user agents. Firefox and Brave can hide GPU names.
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
- The benchmark job in CI compares main with the last commit on main that it passed, one job at a time. With the `benchmark` label, it compares a pull request with its merge base. It fails when a page gets slower than its rule allows. [Benchmarks](.dev/benchmarks.md#the-benchmark-job-in-ci) says how to read it.
- Run one device runner at a time. Runs share one file that tells waiting runner pages which run to start.
- Keep hot paths free of allocation with the habits in the implementation notes, and check them with `bun run bench:allocation`.

## Docs and skills stay in sync

1. One source per fact. The API reference comes from TypeScript doc comments, the three.js mapping from `docs/data/threejs-mapping.json`, and the page inventory from `tools/lib/docs.ts`. Skills link to docs pages by ID and do not copy facts.
2. Generated files are committed. Run `bun run docs` and `bun run skills` after changing a source, and stage what they write.
3. A placeholder page carries a marker comment, and `bun run docs` rewrites it. When you write the real page, remove the marker. The generator then leaves the page alone, apart from its API reference (rule 5).
4. Every docs page has front matter: `id`, `title`, `status` (`planned`, `experimental`, `stable` or `generated`), `since` and `summary`.
5. The API reference on the `api/` pages comes from the TSDoc comments on the engine's public exports. Each export needs a summary and a `@category api/<page>` tag that names its page. Each public member needs a summary too. A public declaration may name only types that the engine exports. On a written API page, the reference goes between the `<!-- null3d:api:start -->` and `<!-- null3d:api:end -->` markers.
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

## Commit gates

`bun install` sets up git hooks that keep the docs in line with the code. Never skip them with `--no-verify`: CI runs the same checks and fails the pull request.

Before each commit:

- Biome (errors only) and the TypeScript check.
- When Rust files or Cargo settings are staged: `cargo fmt --check` and Clippy, with warnings treated as errors.
- Generated files are current and staged. The hook regenerates the docs and the skills copy in memory, and fails if a committed file differs or has unstaged changes. It also fails when a public export lacks the doc comments that the API reference needs.
- Every command in `package.json` is in the table under "Commands", and every command that this file, the README and the guides in `.dev/` run with `bun run` exists.

On each commit message:

- The message follows [Conventional Commits](https://www.conventionalcommits.org/). The scope names the area, such as `core`, `gpu`, `engine`, `docs`, `tools` or `ci`.
- A commit that changes `crates/*/src/`, `packages/*/src/`, `packages/*/bin/` or `skills/` needs a `Docs-Checked:` trailer. This file, the README and the guides in `.dev/` describe the repository's tools, so a commit that changes the tools needs one too. They are `tools/`, `bench/` apart from its tests, the test runner (`tests/real-browsers.ts` and `tests/lib/`) and `package.json`. The trailer names the docs pages you updated or re-read, or says why none apply. The pass also confirms that those pages speak only to developers who use the engine.
- A commit that changes a package's source, the WGSL shader library, `skills/` or `docs/data/threejs-mapping.json` needs a `Skills-Checked:` trailer. It names the skill files you updated or re-read.
- A commit that makes a benchmark median slower on purpose needs a `Bench-Expected:` trailer. It names the benchmarks and gives the reason, as [Benchmarks](.dev/benchmarks.md#mark-an-expected-slowdown) shows. The benchmark job in CI reads it.
- A file that grows more than 2% after Brotli against main's build needs a `Size-Growth:` trailer on a commit of the pull request. The trailer names each file as the size report prints it and gives the reason, such as `Size-Growth: js/page.js +3.1%, the key table of the input ring`.
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

Pull requests merge through GitHub's merge queue, by squash only. The queue runs CI on each pull request on top of main and the pull requests ahead of it. Two changes that pass alone therefore cannot break main together. A pull request joins the queue once its own checks pass, even when it is behind main. The squash writes one line on main: the pull request's title, or the commit's subject when the pull request has one commit. That line becomes a changelog entry, so the PR title workflow checks it with commitlint and the docs style check. [Releases](.dev/releases.md) covers how a release is made.
