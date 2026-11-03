# D-305: the CDN build ships a production entry and a development entry

Status: decided by the owner. Built: `bun run build:cdn` writes the production entry `lib/index.js` and the development entry `lib-dev/index.js`. Each add-on has both entries too. `--url-switches` makes a production entry that reads the address switches, for benchmark pages. Task: none.

Summary: no bundler defines the engine's build constants for a page that loads the CDN build. Undefined constants make a development build. So the CDN build defines them itself. The production entry is `lib/index.js`. Beside it, the development entry `lib-dev/index.js` copies only the 92 code files that differ, about 1.7 MB. It shares the 4 GB of shaders and WebAssembly.

## Question

The engine reads two constants that a bundler defines: whether the build is a development build, and whether it reads the page's address switches (`shared/dev.ts`). The Vite plugin defines both. The CDN build copies the engine's compiled files as they are, so nothing defines them, and the engine then counts as a development build. Which build should a page that loads the CDN build run, and how does the CDN build fix the constants without a bundler?

## Rule

- A page that ships runs no development checks and ignores address switches. A link must not change how it runs ([Switches in the page's address](../implementation-notes.md#switches-in-the-pages-address)).
- A timing measures what ships (design principle 1, [Benchmarks](../benchmarks.md#production-builds)).
- A page that someone is still building gets the development checks, whose errors carry codes and fixes (design principle 10).
- The build stays one folder that a host publishes as it is, and it does not copy its shader builds twice.
- No code file of the production entry reads a constant that nothing defined. A test fails when one does.

## Data

| Measure | Value | Where it comes from |
| --- | --- | --- |
| Built engine files that name a build constant | 4: `lib/shared/dev.js`, `lib/gpu/webgpu/pipelines.js`, `lib/gpu/webgl2/programs.js`, `lib/scene/ktx2.js` | A search of the built `lib/` of the CDN build |
| The whole CDN build | 9,872 files, 4.01 GB | `bun run build:cdn` on this record's branch, on the MacBook Pro |
| Its generated shader modules, `lib/generated` | 8,685 files, about 3.8 GB | The same build |
| The add-ons' code | 177 MB, most of it compiled shader modules | The same build |
| The development entry's own copies | 92 files, 1.7 MB: 55 of the engine's, 37 of the add-ons' | The build's report |
| The development check of batch rows written without `markDirty`, before its cap of rows per frame | About 0.94 ms of the sketch worker's frame, for 16 static batches of 63,000 rows in all | A CPU profile of the desert comparison in Chrome 156 on the MacBook Pro M5 Max ([Writes that skip a mark](../implementation-notes.md#writes-that-skip-a-mark)) |

That one development check took more of the frame than the scene's whole batch update. A page that runs as a development build pays such checks in every frame, and so does every timing of it.

## Look

The options draw the same pictures. They differ in the checks that run, in speed and in what the address can change.

## Decision

The owner decided that the CDN build is a production build by default, with a development build beside it.

- `lib/index.js` stays the address that a page imports, and it is now a production build. A trial page that someone ships as it is then ships a production build.
- `lib-dev/index.js` is the development build. It sits beside `lib/` at the same depth, so every address that leaves the folder, such as `../../dist/wasm/` and `../../vendor/`, stays the same in both entries. Each add-on has `addons/<name>/lib-dev/` beside its `lib/` in the same way.
- The development entry holds a copy of only the code files that differ. The build reads every code file once. A file differs when it names a build constant or is a public entry. It also differs when it names a differing file by a relative address, to any depth. Public entries are copied so that every address a page imports exists in both entries. Each copy's relative addresses then name the copies of differing files and the shared files otherwise. The shader modules, the add-ons' shader modules, the WebAssembly and the vendor files stay in one place.
- The build replaces each constant by its value as text, as a bundler's define does. It finds the files by reading every code file. So a new file that names a constant gets both forms, with no change to the tool. A constant in a file outside the folders of code stops the build, since no entry could hold its two forms. So does a written file that still names one.
- `bun run build:cdn --url-switches` makes the production entry read the address switches, as the Vite plugin's `urlSwitches` option does for a Vite build. The repository's own benchmark pages keep their Vite build. The flag serves benchmark pages that load the CDN build, such as the desert comparison, whose runs set engine switches like `?direct=off`. The tool says when a build reads them.

Options rejected:

- Keep the CDN build a development build, and say so in the docs. A page shipped from it would run every check and obey every address switch. Every timing of it would measure checks that a shipped Vite build leaves out.
- A production build only. A page with no bundler would lose the checks and their error codes, which help most while someone tries the engine.
- Two whole folders, one for each build. That copies 4 GB twice, and a host uploads both.
- A link from `lib-dev/generated` to `lib/generated`. Uploads and many hosts do not keep links.
- A third entry, production with switches, in every build. Every host would publish a folder that only benchmark pages need.
- A minifier pass over the production entry, which would also remove the checks' code from the download, as a Vite build does. The checks never run once their constant is false. The build keeps the package's files as they are, so a stack trace names the same files as the package does.
- A `createEngine` option in place of the constants. The checks would become a choice at run time in every build, so a Vite build could no longer remove their code.

## Consequences

- `tools/lib/cdn.ts` splits the entries (`splitEntries`), and its unit tests check a small build: both entries' values, the files copied and shared, and each copy's addresses. They also check a refused constant outside the code. The import rewrite covers every package that the build carries, so the vegetation add-on's import of `@null3d/impostors` resolves on a page with no bundler.
- `tests/image/cdn-script-tag.spec.ts` checks that no code file of the real build names a constant. It loads both entries, and the production entry ignores `?threads=off` while the development entry obeys it. It draws the terrain add-on from each entry.
- `docs/getting-started/cdn.md` gives both entries and when to use each. Other pages say which build a page runs, and that timings use a production build. They are the performance, testing and debugging guides, the engine and debug API pages, and the `null3d` command's page. The install page, both skills, `AGENTS.md` and [Benchmarks](../benchmarks.md#production-builds) say it too.
- In a production build on WebGPU, `engine.measure` counts the triangles of the GPU-culled draws only after the sketch calls `debug.frameStats()` or the stats card opens. A development build always counts them. A benchmark page that reports triangles calls `debug.frameStats()` once.
