# Rules for people and agents working in this repository

This repository holds the null3d engine, its tools, its documentation and its agent skills. This file holds the working rules. The pages in [`docs/`](docs/index.md) describe the design.

## Where things are

| Path | Contents |
| --- | --- |
| `docs/` | The user documentation as Markdown, one page per ID, with status front matter. It ships inside `@null3d/engine`. |
| `docs/data/threejs-mapping.json` | The single source of the three.js to null3d mapping |
| `skills/` | Agent skills for building with null3d and for porting three.js apps (the source) |
| `.claude/skills/` | A generated copy of `skills/` for Claude Code. Never edit it. |
| `crates/` | The Rust crates: core, GPU layer, renderer, shaders, and the WebAssembly entry point |
| `packages/` | npm packages: `engine`, `vite-plugin`, and `cli`, which is the `null3d` command |
| `tests/` | Browser tests: test pages, Playwright image tests, reference images and the real-browser runner |
| `tools/` | The WebAssembly build, the docs generator, the skills check and the commit hooks |
| `examples/`, `bench/`, `templates/`, `porting-corpus/` | Demos, benchmarks, starter projects and the three.js porting corpus, as the milestones add them |

## Commands

| Command | Use |
| --- | --- |
| `bun install` | Install the tools and set up the git hooks |
| `bun run build` | Build both WebAssembly files, the threaded one and the single-threaded one, and print their sizes |
| `bun run build:check-size` | Build, and fail when a WebAssembly file grew more than 2% after Brotli compression |
| `bun run test` | Unit tests for the engine, the benchmark scenes and the repository tools |
| `bun run test:browser` | Image tests on WebGPU and WebGL2 in Chrome, through Playwright, and the engine test again on a production build served by `vite preview` |
| `bun run test:real-browsers Safari Firefox` | The same test pages in browser apps that Playwright cannot drive, through the runner page (macOS) |
| `bun run devices` | The same checks on an Android phone over USB (Chrome, then Brave) and on runner pages that wait on the local network (an iPad's Safari and Brave) |
| `bun run test:bench` | The benchmark pages of both engines in Chrome, through Playwright |
| `bun run parity` | Compare each benchmark scene's hold frame in null3d with three.js's, per GPU tier; `--save-baselines` stores how much three.js's two renderers differ, for devices that lack one of them |
| `bun run bench:run` | The benchmark protocol in a visible Chrome window: fresh runs of each scene in both engines and of the scene code both run, with a summary of each engine's whole frame and own work; `--sweep` runs each scene from one object up, on both null3d paths and both three.js renderers, and compares each path with three.js's faster renderer and with three.js on the same API |
| `bun run bench:allocation` | Sample what the sketch worker and the render worker allocate per frame in S1, with Chrome's heap profiler; `--gpu webgl2` samples the WebGL2 path |
| `bun run bench:startup` | A cold start of the engine test page's production build in Chrome, on Slow 4G with an empty cache: the startup milestones, requests and bytes of each run |
| `bun run readme-media` | Render the README's animation of S1 with the engine |
| `bun run dev` | Serve the test and benchmark pages with the isolation headers on port 5173 |
| `bun run dev-cert` | Make a local HTTPS certificate for testing on phones and tablets |
| `bun run android` | Forward port 5173 to an Android phone connected by USB |
| `bun run docs` | Regenerate placeholder pages, the API reference, the error pages, the page list in `docs/index.md`, and the mapping page and copies |
| `bun run docs:check` | Check the API reference's doc comments, front matter, generated files and links, and that this table lists every command |
| `bun run docs:style` | Check the writing rules in all published Markdown |
| `bun run skills` | Sync `.claude/skills/` from `skills/`, then check the skills |
| `bun run skills:check` | Check the skills without syncing |
| `bun run shaders` | Build every shader variant in the shader manifest and write the generated TypeScript module |
| `bun run shaders:check` | Fail when the committed shader module is out of date |
| `bun run check` | Lint and format check (Biome) |
| `bun run check:fix` | Lint and format, fixing what Biome can |
| `bun run typecheck` | TypeScript check |
| `bun run release` | Print the next version and its changelog. `--apply` writes them, as the Release workflow does, and `--notes <version>` prints one release's notes |

A size growth over 2% needs a reason: explain it in the commit message and run `bun tools/build-wasm.ts --update-size`, which rewrites the committed baseline.

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
17. A change that makes a benchmark median more than 3% slower does not merge without a written reason.
18. A pull request that changes a public API also updates the API's docs page and any skill that shows the API. It updates the API's three.js mapping entry too, where one exists.
19. The pull request that ships a feature changes its docs status from `planned` to `experimental` or `stable`. Agents never use planned APIs.

## Performance work

The benchmarks compare null3d with three.js in the same browser. These points come from the first checkpoint's measurements.

- A report gives each engine's whole frame and its own work on the busiest thread. The desktop target uses own work, because both engines run the same scene code.
- null3d's own work comes from its phase timers: each thread's time less its `update` step. three.js's own work is its frame time less the scene code, timed alone on the scene-code page. That page's loop compiles to slower code than an engine's loop, so this estimate of three.js's own work is low.
- Keep the Mac's screen unlocked and its display awake during browser runs. Safari stops running pages while the Mac is locked, and the runner then waits until its deadline. Chrome started by Playwright keeps running.
- Do not edit engine or benchmark page files during a run. The dev server reloads the pages being measured.
- Compare results at the same display refresh rate. The engine measures it, and each benchmark result records it with the presented and finished frame rates and the GPU delay. Runs at 120 and at 144 frames per second differed by about 10% for both engines.
- `bun run bench:allocation` samples allocations after a 30-second warm-up. The browser optimizes code that runs once per frame only after thousands of frames. Places that allocate because the browser does have budgets with their reasons in `bench/allocation.ts`, and every other place must stay under 4 bytes per frame. Add `--n 30000` to include the staging ring.
- The engine's hot paths stay allocation-free with these habits. Read typed arrays by index rather than by destructuring. Reuse WebGPU descriptors (`RenderPassSetup` and `submitOne` in `packages/engine/src/gpu/webgpu/reusable.ts`). Pass typed arrays straight to WebGPU, as `setBindGroup` reads dynamic offsets from the draw list. Keep reused lists at a fixed length. Do not wrap browser promises in `async` functions, and use `Math.sqrt` rather than `Math.hypot`. Keep closures out of functions that run every frame, even in a branch that rarely runs. Until the browser optimizes such a function, it allocates the variables a closure captures on every call.
- Rust tests that count allocations use `null3d_core::testing::CountingAllocator`, from the core crate's `testing` feature. It counts only the threads a test marks, so the test runner's own threads cannot reach the count.
- The frame recorder sizes a frame's upload arena for the most that any frame can copy for the scene as it stands. It keeps its layout tables and scratch space between rebuilds. Only the frames right after the scene grows allocate. Pipelined frames keep one arena per frame parity, so the allocation tests change the structure on both parities after warm-up.
- Uploads from 64 KiB to 4 MiB take the route that the render worker measures as faster on the device: `queue.writeBuffer` or the staging ring. In Chrome on a Mac the ring is 3 to 6 times faster there, as `writeBuffer` takes up to 0.8 ms per MB. In Safari `writeBuffer` wins at every size, because unmapping a staging buffer costs time in proportion to the buffer's size. Outside that range `writeBuffer` wins in every browser measured.
- Safari 26 drops a whole submit if its commands hold two or more copies from one buffer that was mapped when they were recorded. WebGPU allows that, and Chrome and Firefox accept it. The staging ring therefore records a frame's copies after it unmaps the buffer, just before the frame's next command. The uploads test page reports each frame's WebGPU errors, which show such a failure.
- Work around a browser's fault with an order or a call that is valid everywhere, as the staging ring does. Where browsers differ in speed, time the choices on the device, as the upload routes do. When neither works, detect the fault with a feature test, never from the user agent (hard rule 14).
- Chrome's page-wide memory measurement waits up to a minute for the job workers, and it counts shared memory once per worker. Chrome's debugger gives exact heaps per worker through `Runtime.getHeapUsage`.
- On GitHub's macOS machines, Safari has no WebGPU and Firefox has no WebGL2. The CI job passes `--allow-no-webgpu` and `--allow-no-webgl2`, so those pages count as skipped there.

## Docs and skills stay in sync

1. One source per fact. The API reference comes from TypeScript doc comments, the three.js mapping from `docs/data/threejs-mapping.json`, and the page inventory from `tools/lib/docs.ts`. Skills link to docs pages by ID and do not copy facts.
2. Generated files are committed. Run `bun run docs` and `bun run skills` after changing a source, and stage what they write.
3. A placeholder page carries a marker comment, and `bun run docs` rewrites it. When you write the real page, remove the marker. The generator then leaves the page alone, apart from its API reference (rule 5).
4. Every docs page has front matter: `id`, `title`, `status` (`planned`, `experimental`, `stable` or `generated`), `since` and `summary`.
5. The API reference on the `api/` pages comes from the TSDoc comments on the engine's public exports. Each export needs a summary and a `@category api/<page>` tag that names its page. Each public member needs a summary too. A public declaration may name only types that the engine exports. On a written API page, the reference goes between the `<!-- null3d:api:start -->` and `<!-- null3d:api:end -->` markers.

## Writing docs

Published Markdown (every page under `docs/`, the skills, the README, the package READMEs, `CHANGELOG.md` and this file) follows these rules.

- Write plain English in short sentences, at most 25 words each, in the active voice. Simplified Technical English is the model.
- Use sentence case in headings, with no emojis.
- Use no dashes as connectors. Use a comma, a colon, parentheses or a new sentence.
- Use straight quotes and apostrophes.
- A concept page opens with a Mermaid diagram and a plain explanation, followed by examples.
- A page describes what exists now. Its status label says whether the feature is built.
- Write for developers who use the engine. Never mention the maintainers' milestones, checkpoints, task IDs, proposals or internal plans, and never explain where a fact came from in those terms. Give the reason when it helps the reader, such as a browser or GPU limit. Name the engine's benchmarks when you cite a figure. Notes for maintainers belong in code comments or in this file. This file is for contributors, so this rule does not apply to it.
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
- Every command in `package.json` is in the table under "Commands", and every command that this file and the README run with `bun run` exists.

On each commit message:

- The message follows [Conventional Commits](https://www.conventionalcommits.org/). The scope names the area, such as `core`, `gpu`, `engine`, `docs`, `tools` or `ci`.
- A commit that changes `crates/*/src/`, `packages/*/src/`, `packages/*/bin/` or `skills/` needs a `Docs-Checked:` trailer. This file and the README describe the repository's tools, so a commit that changes them needs one too. They are `tools/`, `bench/` apart from its tests, the test runner (`tests/real-browsers.ts` and `tests/lib/`) and `package.json`. The trailer names the docs pages you updated or re-read, or says why none apply. The pass also confirms that those pages speak only to developers who use the engine.
- A commit that changes a package's source, the WGSL shader library, `skills/` or `docs/data/threejs-mapping.json` needs a `Skills-Checked:` trailer. It names the skill files you updated or re-read.
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

Pull requests merge by squash only. The squash writes one line on main: the pull request's title, or the commit's subject when the pull request has one commit. That line becomes a changelog entry, so the PR title workflow checks it with commitlint and the docs style check.

To release, run the Release workflow from the Actions tab and pick a release type. The workflow:

1. Waits for CI to pass on main's latest commit.
2. Runs `bun run release --apply` on a `release/<version>` branch. This sets the version in every package manifest, the engine's `VERSION` export, the Rust workspace and `Cargo.lock`. It adds the release's section to `CHANGELOG.md` and regenerates the docs.
3. Opens a pull request. Review the changelog there, and edit `CHANGELOG.md` on that branch if a line needs it.

Merging that pull request runs the Release Publish workflow. It tags the merge commit with the plain version, such as `0.0.1`, and publishes the GitHub Release with the changelog section. Then it publishes every package that is not private to npm, and skips a version that npm already has.

Versions follow the roadmap in the README. The `auto` release type always releases a patch. Pick `minor` or `major` when a roadmap release is done. The release script refuses an x.y.0 version while a docs page with that `since` or an earlier one is still `planned` (hard rule 19).

1.0 is the first public release. The roadmap is internal, so it stays in the README until then. Before releasing 1.0, remove it: the Roadmap section, its navigation link, the status badge's link and the by-version table under Features. Replace the pre-alpha status line too. The release script refuses 1.0.0 and every later version while the README has the roadmap.

At 1.0, also announce the agent skills. Add the Claude Code plugin commands to the README's "For AI agents" section, and link `guides/agents` for other agent tools. Until then, `.claude-plugin/marketplace.json` exists and each release attaches the skill zips, but the README does not name them.

One-time setup:

- A GitHub App with write access to contents and pull requests, installed on the repository. Its ID and private key go in the `RELEASE_APP_ID` and `RELEASE_APP_PRIVATE_KEY` secrets. A pull request opened with the default token starts no workflows, so its CI would never run.
- npm trusted publishing. Publish each public package's first version by hand with a token. Then, in the package's settings on npmjs.com, name this repository and `release-publish.yml` as its trusted publisher. A public package also needs `"publishConfig": { "access": "public", "provenance": true }`.
- The publish job builds nothing, because the only public package is the command-line tool. Add the engine's WebAssembly build to the job before the engine becomes public.
