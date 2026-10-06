# Releases

This guide covers how a release is made. [AGENTS.md](../AGENTS.md) holds the rule that decides each changelog line: pull requests merge by squash only.

## Making a release

The first release is 1.0, as [Versions](#versions) says. Until then, no step below runs. To release, run the Release workflow from the Actions tab and pick a release type. The workflow:

1. Waits for CI to pass on main's latest commit.
2. Runs `bun run release --apply` on a `release/<version>` branch. This sets the version in every package manifest, the engine's `VERSION` export, the Rust workspace and `Cargo.lock`. It adds the release's section to `CHANGELOG.md` and regenerates the docs.
3. Opens a pull request. Review the changelog there, and edit `CHANGELOG.md` on that branch if a line needs it.

Merging that pull request runs the Release Publish workflow. It tags the merge commit with the plain version, such as `1.0.0`, and publishes the GitHub Release with the changelog section. Then it builds the WebAssembly files, packs every package that is not private, and publishes each tarball to npm. It skips a version that npm already has. [The npm packages](#the-npm-packages) says how a package is built and packed.

## Versions

The first release is 1.0, when all the planned work is done. There is no 0.1, 0.2 or 0.3 release (owner, 3 October 2026). Each milestone ends when its exit gate passes, and no publish step follows it. Each release before 1.0 would add steps by hand: the first npm publishes, the trusted publishers and the release secrets. None of them helps finish the engine. The npm packaging (#248) and the Release workflows stay, for 1.0.

The README's roadmap lists 0.1, 0.2 and 0.3 before 1.0. Each names a set of features, and the docs pages' `since` values and the skills' version labels use those numbers, but none of them is released. For 1.0, run the Release workflow with `major`, which takes the packages from 0.0.0 to 1.0.0. After 1.0, the `auto` release type always releases a patch, and you pick `minor` or `major` when a set of features is done. The release script refuses an x.y.0 version while a docs page with that `since` or an earlier one is still `planned` (hard rule 19).

1.0 is also the first public release. The roadmap is internal, so it stays in the README until then. Before releasing 1.0, remove it: the Roadmap section, its navigation link, the status badge's link and the by-version table under Features. Replace the pre-alpha status line too. The release script refuses 1.0.0 and every later version while the README has the roadmap.

At 1.0, also announce the agent skills. Add the Claude Code plugin commands to the README's "For AI agents" section, and link `guides/agents` for other agent tools. Until then, `.claude-plugin/marketplace.json` exists and each release attaches the skill zips, but the README does not name them.

### Open point for 1.0: the version labels

Docs pages carry `since: "0.1"`, `"0.2"` or `"0.3"`, and the skills label calls with a version, such as (0.2) or "later in 0.1" (docs rule 6 in AGENTS.md). With no release before 1.0, these labels name versions that never ship. The release script reads them too: it refuses an x.y.0 version while a page with that `since` or an earlier one is `planned`. Every one of these labels is lower than 1.0. So the script refuses 1.0.0 while any such page is planned, which is the rule that the first release needs.

Before 1.0, decide whether every `since` becomes "1.0", or names the milestone that built the feature. Then change the release script's check, the gate's release step, the README's version labels and the skills to match. Until then, the labels stay as they are, because the release script and the M1 exit gate's docs item read them.

## One-time setup

- A GitHub App with write access to contents and pull requests, installed on the repository. Its ID and private key go in the `RELEASE_APP_ID` and `RELEASE_APP_PRIVATE_KEY` secrets. A pull request opened with the default token starts no workflows, so its CI would never run.
- npm trusted publishing for each public package. npm cannot publish a package's first version that way, so the owner publishes it by hand, as [The first version of a new package](#the-first-version-of-a-new-package) shows. A public package also needs `"publishConfig": { "access": "public", "provenance": true }`, and the pack check fails without it.
- No npm token in the repository. npm skips trusted publishing when `NPM_TOKEN` or `NODE_AUTH_TOKEN` is set, even to an empty string, so the publish job sets neither. It gets an OIDC token through `id-token: write`, and `actions/setup-node` with `registry-url: https://registry.npmjs.org`. Trusted publishing needs npm 11.5.1 or newer and Node 22.14 or newer, so the job uses Node 24 and installs the latest npm.
- Git keeps neither the WebAssembly files nor the shader modules (`packages/engine/src/generated/shaders*.ts`). The publish job therefore sets up Bun and the pinned Rust toolchain, and runs `bun tools/build-wasm.ts --pages-only` before it packs. That builds the shader modules and both WebAssembly files of the engine, with no size report. It also builds the Vite plugin's shader compiler and the command-line tool's asset formats.
- The repository's own script, `tools/release.ts`, makes each release, and semantic-release is not installed. So the rule that semantic-release needs `@semantic-release/npm` 13.1.0 or newer for trusted publishing does not apply. The publish job sets `HUSKY: "0"`, as the Release workflow does, so no git hook runs in CI.

## The npm packages

Four packages are public. Each one's `prepack` script runs `bun tools/build-package.ts <folder>`, which makes what its tarball holds besides the files that git keeps (`tools/lib/packages.ts`). Every tarball also holds both license files. The WebAssembly files come from `bun run build`, which runs first.

| Package | What its tarball holds | What its pack step makes |
| --- | --- | --- |
| `@null3d/engine` | `lib/`, the built JavaScript and declarations. Both WebAssembly builds in `dist/wasm/`, the KTX2 transcoder in `vendor/`, and a copy of `docs/` | The shader modules, then `lib/` and the copy of the docs |
| `@null3d/vite-plugin` | `lib/`, and the shader compiler in `dist/shader-compiler.wasm` | `lib/` |
| `@null3d/controls` | `lib/` | The engine's `lib/`, whose declarations it reads, then its own |
| `@null3d/cli` | `bin/` and `src/`, plain JavaScript with JSDoc types. The Basis Universal encoder in `vendor/`, and the asset tool's formats in `dist/assets.wasm` | Nothing |

### Source in the repository, built files on npm

Each package's `exports` give its TypeScript source under the `null3d-source` condition, and its built files under `types` and `default`. Inside the repository, the tsconfig files set the condition in `customConditions`. The Vite configs set it with `sourceResolve` from `tools/lib/source-condition.ts`. `bun run test` passes `--conditions=null3d-source` to Bun's test runner. The test pages, the benchmark pages, the unit tests and the type checks therefore read the source, with no build step and no stale copy. A project that installs a package from npm sets no such condition, so it gets `lib/`.

Vite loads its configs with Node, and Playwright runs in Node, so they cannot take the condition. The Vite configs and the Playwright tests therefore import the Vite plugin's source by its path. The root `package.json` sets `"type": "module"`, so Vite loads the root config, and the plugin source that it bundles, as an ES module. As CommonJS, the plugin's import of `magic-string` failed.

The pack tool deletes each `lib/` after it packs. So no local check can pass on built files that CI does not have.

The engine's `./internal` and `./stats` entry points exist under the source condition only. The repository's tests and benchmark pages use them, and a project that installs the engine cannot import them.

These options were rejected:

- `publishConfig` fields that replace `exports` when a package is packed. pnpm and Yarn read them, but `bun pm pack` and `npm pack` do not. Bun 1.3.14 packed a test package's `exports` unchanged.
- `exports` that point at `lib/` inside the repository too. Every check and every dev server would need a build first. An edit to the source would not reach the pages until the next build.
- A staging folder with a generated manifest for each package. The manifest on npm would then differ from the one in git.

### How lib/ is built

TypeScript writes `lib/` file for file, with the declarations. The build does not bundle the engine, because the engine loads its workers and its WebAssembly core by address, as in `new URL('../workers/sketch-worker.ts', import.meta.url)`. A project's bundler follows each address and writes each worker as a file of its own, as it does for the source in the repository. So each file keeps its place beside the others. A project's build then splits the engine as the repository's build does, and the size report's figures hold for a project too.

The source imports its own modules without an extension or with `.ts`. After TypeScript writes `lib/`, the build rewrites each relative import, each import type and each worker address to the `.js` file that TypeScript wrote. TypeScript's parser finds each one, so the same text in a string, such as an error message, stays as it is. The build fails when an import answers no file. Vite accepts imports without an extension, but Node's module rules and some other bundlers do not.

The controls build without the source condition. TypeScript then reads the engine's built declarations, as in a project that installs both, and the engine's source stays out of the controls' `lib/`.

### Pack with Bun, publish with npm

The publish job packs each package with `bun pm pack`, then publishes each tarball with `npm publish`:

- Bun writes the real version in place of each `workspace:` version, such as the engine version that the controls need. npm would publish `workspace:*` as it is, which no package manager can install.
- npm publishes, because trusted publishing and provenance need npm's own command-line tool.
- `npm publish` reads `publishConfig` from the manifest inside the tarball, so each package still asks for public access and provenance. A flag on the command line overrides it.

`bun tools/pack-packages.ts` packs every public package into `target/packages/`, or into the folder that `--out` names, and checks each tarball. It fails unless the manifest asks for public access and provenance, and names no `workspace:` version. The tarball must hold every file that `exports` and `bin` name, and the files that the code loads by address. Those are the engine's workers, both WebAssembly builds, the shader modules, the transcoder and the docs, and the plugin's shader compiler. For the command-line tool, they are its encoder, the encoder's worker and the asset formats.

### The fresh-project test

`bun run test:packages` packs the packages, then makes a new Vite project from `tests/fixtures/fresh-project/` in a temporary folder. The folder is outside the repository, so no package in the repository's `node_modules` can stand in for a file that a tarball lacks. The test installs the tarballs with Bun, then runs the command-line tool's `test` command twice. The first run keeps its images as the references, and the second must match them. The command type checks the project with `skipLibCheck` off, so every declaration file in the packages must compile. It draws the sketch, which uses the orbit controls, on WebGPU, WebGPU's compatibility mode and WebGL2. Last, `vite build` must write both engine cores. The `packages` job in CI runs the test on SwiftShader.

The project's `overrides` take each `@null3d` package from its tarball. Without them, Bun looks on npm for the engine version that the controls name, which npm does not have before the release.

The first run passed on a MacBook Pro M5 Max in Chrome on 3 October 2026. The type check passed, the first run saved 3 references, and the second run matched 3 of 3. In the dev server, Vite kept the engine out of its prebundled copy of the controls, so a page loads one copy of the engine. The engine's tarball is 3.4 MB, mostly the shader modules, and the plugin's is 1.2 MB, mostly the shader compiler.

### The first version of a new package

This is part of making 1.0. npm cannot publish a package's first version through trusted publishing. So the owner publishes the first version of `@null3d/engine`, `@null3d/vite-plugin` and `@null3d/controls` by hand. `@null3d/cli` is on npm at 0.0.0 already.

1. On a clean checkout of main, run `bun install` and `bun run build`.
2. Run `bun tools/pack-packages.ts`, which writes the tarballs to `target/packages/`.
3. Log in to npm with `npm login`, as an account that may publish in the `@null3d` scope.
4. Publish each new tarball. Provenance needs a CI provider, so a flag turns it off for these three publishes:

   ```sh
   npm publish target/packages/null3d-engine-0.0.0.tgz --access public --provenance=false
   npm publish target/packages/null3d-vite-plugin-0.0.0.tgz --access public --provenance=false
   npm publish target/packages/null3d-controls-0.0.0.tgz --access public --provenance=false
   ```

5. On npmjs.com, open each of the four packages' settings, and add a trusted publisher: GitHub Actions, the owner `null3d-engine`, the repository `null3d` and the workflow `release-publish.yml`.
6. Run the Release workflow with `major`. Its publish job publishes 1.0.0 of every package through trusted publishing, with provenance.

Until step 5, the publish job fails at the first package that has no trusted publisher. It skips the versions that npm has, so run it again after the setup.

## M1 exit gate

M1 ends at its exit gate (task M1-K5), with no release. Every item below must hold on one commit of main, the gate commit. The command `bun run gate` runs the Mac's part of the gate one step after another, so the timing steps never overlap. It writes the record to `target/gate/<run>/gate.md` and `gate.json`, with each step's output beside them. Its `--list` option prints each step, its gate item and its command. The device runner covers the rest: Safari and Firefox on the Mac, the iPad and the Galaxy S24+, as [Device sessions](devices.md) describes.

If item 1 or item 3 fails, feature work stops. Fix the cause, then run the gate again.

### The items and how they are measured

| Item | Rule | Measured by |
| --- | --- | --- |
| 1. Image tests | Every test in the image test manifest matches its references. This holds in CI on SwiftShader and in Chrome on the Mac's GPU, on all three tiers. It holds through the device runner in Safari and Firefox on the Mac, Safari on the iPad, and Chrome on the S24+. | Steps `images-gpu`, `images-swiftshader` and `workflows`. The device runner, through `bun run test:real-browsers Safari Firefox` and `bun run devices` |
| 2. Parity | The parity scenes match their three.js twins on core WebGPU and on WebGL2, within three.js's threshold. The shadow scenes match within 0.5%. | Step `parity` |
| 3. Speed | The CI benchmark job passes on the gate commit. S1's own work on the busiest thread is at most 50% of three.js's, in Chrome on the Mac on WebGPU. S1 at phone scale is at most 100% of three.js on the S24+ and the iPad. S4 holds its preset's target frame rate in at least 95% of the seconds of a 10-minute run on both devices. S3 and S1-cells are measured against three.js on the three devices. | Steps `workflows`, `desktop-target` and `scenes`. Benchmark runs and the governor plan on the devices |
| 4. Budgets | Each WebAssembly build stays within 600 KB after Brotli, and the engine's JavaScript within 100 KB in each thread mode. `bun run bench:allocation` passes on S4 on both GPU paths. `bun run bench:soak` passes on S4 in Chrome on the Mac and in Safari on the iPad. | Steps `budgets`, `allocation-s4-webgpu`, `allocation-s4-webgl2` and `soak-s4`. The soak plan on the iPad |
| 5. Decisions | Records D-08 to D-13 are written. Tests T-11, T-12, T-21, T-22, T-24, T-25, T-26 and T-29 are closed with their dates and results. T-28, the time to first frame, is measured again with the pipeline warm-up. | Step `startup` on the Mac. `bun run bench:startup -- --android` on the S24+, and the startup plan on the iPad |
| 6. Docs | Every docs page with `since: "0.1"` is `experimental` or `stable`, or has moved to a later version with a written reason. The docs and skills checks pass, and the release script prints 0.1.0. | Steps `docs`, `docs-style`, `skills` and `release` |

Item 6's release step makes no release. It prints the version that a `minor` release would take, 0.1.0, and it passes only while no docs page with `since: "0.1"` is still `planned`.

The iPad's S4 run is judged at its Low preset, by the owner's decision of 3 October 2026 (#215).

Item 2's parity step compares with three.js's threshold only where both engines draw the same building block. By the owner's decision of 4 October 2026 ([D-52](decisions/D-52-intent-parity.md)), a feature that moves to a better technique leaves that strict check. It then gets null3D's own references and a looser sanity limit against its twin. Item 3 compares equal work: the same scene content and comparable quality settings.

### Rehearsal on the Mac, 3 October 2026

A rehearsal ran every Mac step before the gate commit, on a MacBook Pro M5 Max in Chrome 154, with the display at 144 Hz. The untimed steps ran on main at bfbb206d (#221). The timing steps ran on main at 850e2d55 (#230), with the gate runner of #232 on top. They used the full protocol of 5 runs of 30 seconds. The real gate runs every step again on the gate commit.

| Item | Check | Figure | Result |
| --- | --- | --- | --- |
| 1 | Manifest, Chrome on the Mac's GPU, three tiers | 334 of 334 pass | Pass |
| 1 | Manifest, SwiftShader, three tiers | 334 of 334 pass | Pass |
| 1 | CI on main | Green on every commit since #221 | Pass |
| 2 | Parity scenes, core WebGPU and WebGL2 | 46 of 46 pass. Shadows differ by 0.229% on WebGPU and 0.235% on WebGL2, of 0.5% | Pass |
| 3 | CI benchmark job | Red on every main commit since c006a992. An A/A comparison on the Mac passed, so the baseline was stuck and the code was not slower. #233 fixed the baseline | Run again on the gate commit |
| 3 | S1, own work on the busiest thread, WebGPU | null3D 0.350 ms. three.js's faster renderer (WebGL) 3.248 ms, after its 2.395 ms of scene code. 10.8% of three.js, against at most 50% | Pass |
| 3 | S3 against three.js, own work | null3D 0.11 ms on WebGPU and 0.18 ms on WebGL2. three.js on WebGPU 0.28 ms, so 40% and 65%. three.js on WebGL cannot draw S3 | Recorded |
| 3 | S1-cells against three.js, own work | null3D 0.06 ms on both paths. three.js 0.03 ms on WebGL and 0.14 ms on WebGPU. Every figure is under 0.15 ms, near the timer's resolution | Recorded |
| 3 | S4 against three.js, own work | null3D 0.09 ms on WebGPU and 0.23 ms on WebGL2. three.js 1.67 ms on WebGL and 3.65 ms on WebGPU, so 5% and 13% of its faster renderer | Recorded |
| 4 | WebAssembly builds | Threaded 144.4 KB, single-threaded 143.6 KB, of 600 KB | Pass |
| 4 | Engine JavaScript per thread mode | 77.7 to 83.9 KB, of 100 KB | Pass |
| 4 | Allocation, S4 on WebGPU | The replay 418 of 320 bytes per frame, the wake-up timer 29.9 of 4 and the GPU completion callback 14.2 of 4. After the fix below: the replay 263 of 320, both callbacks 0.0 | Failed, then pass |
| 4 | Allocation, S4 on WebGL2 | The benchmark sketch's camera step 49.0 of 48 bytes per frame. After the fix below: 24.0 of 48 | Failed, then pass |
| 4 | Soak, S4 in Chrome, 10 minutes | After the 2-minute warm-up: sketch worker heap +16 KB, render worker heap +37 KB, of 256 KB each. WebAssembly memory +0.00 MB | Pass |
| 5 | T-28 on the Mac: first frame done, median of 3, pipelined, WebGPU | Slow 4G: cold 3918 ms, warm 650 ms. Full speed: cold 87 ms, warm 79 ms. 12 requests and 237.1 KB on a cold load | Recorded |
| 6 | `bun run docs:check` | Docs OK, 78 inventory pages | Pass |
| 6 | `bun run docs:style` | 0 errors, and 106 warnings, which do not block | Pass |
| 6 | `bun run skills:check` | 2 skills, 73 pages referenced | Pass |
| 6 | `bun run release -- --release-type minor` | Prints 0.1.0 and does not refuse | Pass |

Notes on the figures:

- The desktop target's run overlapped other work on the Mac: SwiftShader image checks, an allocation run, and the iPad's reruns served from the Mac. 10.8% passes by a wide margin, so the overlap cannot change the verdict. null3D's own work, 0.35 ms, is 2.5 times M0's 0.14 ms ([D-06](decisions/D-06-success-targets.md)). three.js's own work rose from about 0.8 ms to 3.25 ms when the scenes moved to the standard material. The gate's clean run confirms the null3D figure.
- T-28's target is on the S24+ in Chrome on Slow 4G: a cold start within 5.5 s, and a warm one within 1 s ([D-06](decisions/D-06-success-targets.md)). The cold target was 4.5 s until the owner's ruling of 6 October 2026 ([D-83](decisions/D-83-gate-rulings-2026-10-06.md)). The Mac is inside both, but the gate's figures come from the S24+ and the iPad. On the iPad, the preset check took about 1 s for each preset it measured. Pull request #234 skips the check on repeat visits ([D-17](decisions/D-17-stored-preset-check.md)), so the warm figures change on the gate commit.
- T-28 on the S24+ at 1533939f, after the early shader download (#296): cold 4.64 to 4.70 s in the five thread modes, over 4.5 s; warm 0.95 to 0.98 s. [T-28: the core's download](#t-28-the-cores-download) has the fix and its figures.

### T-28: the core's download

At 1533939f the S24+'s page script ran at 1.51 s and the core was ready at 4.48 to 4.56 s, so the core's download came last. Its request went out only once the page's own scripts had arrived and run. The Vite plugin now adds an early script that starts that request as soon as the early script arrives ([Start order](implementation-notes.md#start-order)). A cold load makes one request more, for the early script's 0.2 KB, and downloads the core once.

These are the medians of 5 loads, Chrome on Slow 4G, WebGL2, with the first frame done at the time given. The Mac ran `bun run bench:startup -- --runs 5 --gpu webgl2 --modes all --loads cold,warm` on main at fd681ea5 and on the change. The S24+ ran `bun run bench:startup -- --android` on the change, on 5 October 2026:

| Thread mode | Mac cold, before | Mac cold, after | Mac warm, before | Mac warm, after | S24+ cold | S24+ warm |
| --- | --- | --- | --- | --- | --- | --- |
| Pipelined | 4,429 ms | 4,240 ms | 677 ms | 658 ms | 4,529 ms | 937 ms |
| Low latency | 4,417 ms | 4,220 ms | 657 ms | 642 ms | 4,474 ms | 964 ms |
| Single-threaded | 4,358 ms | 4,167 ms | 658 ms | 637 ms | 4,501 ms | 956 ms |
| Drawing on the main thread | 4,408 ms | 4,207 ms | 666 ms | 664 ms | 4,527 ms | 957 ms |
| Sketch on the main thread | 4,389 ms | 4,191 ms | 671 ms | 669 ms | 4,478 ms | 995 ms |

The S24+ gained about 0.3 s, but main's core had grown from about 249 KB to 267 KB after Brotli since 1533939f, which costs about 0.11 s. Three modes still miss 4.5 s, by 1 to 29 ms. On the phone the core's request now goes out at 1.31 s. From its first byte at about 1.88 s the link stays full until the core ends, so each KB taken off the start saves about 6.5 ms.

With #306 (M2-R14 and M2-R11) merged in as well, the start downloads about 6 KB less, and every mode passes on the S24+ (same command, 5 October 2026). The margin is 11 to 61 ms:

| Thread mode | S24+ cold | S24+ warm |
| --- | --- | --- |
| Pipelined | 4,489 ms | 939 ms |
| Low latency | 4,464 ms | 976 ms |
| Single-threaded | 4,439 ms | 951 ms |
| Drawing on the main thread | 4,476 ms | 944 ms |
| Sketch on the main thread | 4,454 ms | 954 ms |

About 2 KB more at the start would push the pipelined mode over its target again.

### The allocation fix for S4

The allocation budgets were set on S1, and S4 is the first scene with shadow passes in the check. A heap profile of each place, and the browser's log of the code it compiles and throws away, found three causes. Two were in the engine and one in the benchmark sketch. [Implementation notes](implementation-notes.md#hot-paths-without-allocation) holds the habit that each one taught.

- The WebGPU replay passed each render pass's clear color to the pass setup as four numbers. The browser inlined that call in S1 but not in S4, so each of S4's four render passes boxed the fog color's three fractions. The setup now reads the color from the draw list's floats. S4's replay fell from about 420 to about 260 bytes per frame, and S1's stayed at about 210.
- The replay bound some vertex buffers whole, with the size `undefined`, and others in part, through one call. So the browser threw its optimized replay code away every 1.5 seconds and compiled it again. Each compile left about 10 KB of objects in the wake-up timer or the GPU completion callback, whichever ran first. Each case now has one call without the size and one with it. The browser's log showed 26 of these events in one run before the change, and none after it.
- The benchmark sketch's camera step stayed on the browser's middle tier for the whole 45-second run. That tier never inlined the camera's `lookAt`, so its three fractions were boxed in every frame. The step now computes the rotation with `quat.lookAt` and passes it to `setRotation`. About two boxed numbers per frame remain, within the step's budget of 48 bytes.

Per frame, S4 draws 4 render passes and S1 draws 2. S4's 2 extra passes are depth-only shadow passes, and it makes 13 buffer uploads to S1's 4. After the fix, S4's replay allocates 46 to 48 bytes per frame more than S1's. About 35 of them are objects of 16 bytes or more, which fits one pass encoder from the browser for each extra pass. The rest are one or two number objects. That fits in the replay's budget of 320 bytes, so no budget changed. The fix's runs on the same Mac, after a merge of main at d69b2cd4 (#235):

| Scene and path | Sketch worker, bytes per frame | Render worker, bytes per frame | Result |
| --- | --- | --- | --- |
| S1, WebGPU | 264 | 561, with the replay at 215 of 320 | Pass |
| S1, WebGL2 | 344 | 167 | Pass |
| S4, WebGPU | 237 | 604, with the replay at 263 of 320 | Pass |
| S4, WebGL2 | 237 | 164 | Pass |

### Results on the first gate commit, 5309dba5

The gate commit was 5309dba5 (#271), and main's CI passed on it. Each device run below served the pages from a checkout at that commit. The run names are in UTC.

| Item | Device and browser | Check | Figure | Result |
| --- | --- | --- | --- | --- |
| 1 | iPad Pro 11-inch, Safari 26.6.2 | The full checks plan on WebGPU, compatibility mode and WebGL2 (run 20261004-035655-checks) | 656 passed, 0 skipped, 0 failed | Pass |
| 3 | iPad Pro 11-inch, Safari 26.6.2 | S1 at phone scale, 256,000 boxes, against three.js, 5 runs of each page at 60 Hz (run 20261004-125547-bench) | CPU time per frame: null3D on WebGPU 16.44 ms, 52% of three.js's faster renderer (WebGPU, 31.32 ms). null3D with WebGL2 forced 17.18 ms, 55% of three.js on WebGPU and of three.js on WebGL (31.40 ms). Own work on the busiest thread 14% and 23 to 24%. Frames per second: null3D 28.0 on WebGPU, where 28 ms of GPU time per frame limits it, and 27.3 with WebGL2. three.js 28.3 on WebGPU and 14.1 on WebGL. Target: at most 100% of the CPU time | Pass |
| 3 | iPad Pro 11-inch, Safari 26.6.2 | S4 at Low with dynamic resolution, WebGL2 forced, 5 minutes of warm-up and 5 measured (run 20261004-132154-bench) | 298 of 300 seconds at 60 fps, 99%. Lowest 56 fps, lowest render scale 0.55, 7 quality steps. 0.88 ms per frame on the render worker. Target: 95% of the seconds | Pass |
| 3 | iPad Pro 11-inch, Safari 26.6.2 | S4 at Low with dynamic resolution, WebGPU, 5 minutes of warm-up and 5 measured (run 20261004-133405-bench) | 295 of 299 seconds at 60 fps, 99%. Lowest 56 fps, lowest render scale 0.75, 8 quality steps. 0.18 ms per frame on the render worker, 13.04 ms of GPU time. Target: 95% of the seconds | Pass |
| 3 | iPad Pro 11-inch, Safari 26.6.2 | The governor's stress test on WebGPU and WebGL2 (run 20261004-134426-governor) | 4 of 4 passed. 9 live quality steps down and back up on each path. Under the heavy scene, the last 15 seconds held 52 to 61 fps on WebGPU, at a lowest render scale of 0.8, and 58 to 61 fps on WebGL2, at 0.75 | Pass |
| 3 | iPad Pro 11-inch, Safari 26.6.2 | S3 and S1-cells against three.js, 5 runs of each page (run 20261004-134958-bench) | S3: null3D 0.18 ms per frame on WebGPU and 0.70 ms with WebGL2, 6% and 23% of three.js on WebGPU (3.08 ms). three.js on WebGL cannot draw S3, so its 5 pages failed. null3D held 59.9 fps on WebGPU and 49.8 with WebGL2, where it waits for the GPU. S1-cells: null3D 0.20 ms on WebGPU and 0.78 ms with WebGL2, 29% and 111% of three.js on WebGL (0.70 ms). Every S1-cells page held 60 fps | Recorded |
| 4 | iPad Pro 11-inch, Safari 26.6.2 | The soak plan on S4, stopped early by the owner (run 20261004-142218-soak) | The 10 GPU-loss pages passed: each of the 5 thread modes on WebGPU and on WebGL2 counted 1 GPU loss, drew again and matched its references. The owner needed the iPad back during the 30-minute WebGPU soak, so neither 30-minute soak has a result | Partial: the 2 soaks passed on 5 October 2026, in a row below |
| 4 | iPad (10th generation, A14) on BrowserStack Automate, Safari 27.0, standing in for the owner's iPad Pro 11-inch | The soak plan's two 30-minute S4 soaks, on WebGPU and with WebGL2 forced, at the default preset (run 20261004-163141-soak) | 2 of 2 passed. Each path ran 30 of 30 minutes with no GPU loss, no growth of WebAssembly memory and no engine failure. Median 21.0 fps on WebGPU (lowest 20.5) and 35.1 fps with WebGL2 (lowest 32.8). The runner page measured the screen at 60 Hz before each soak | Pass. The GPU-loss pages of the soak plan passed on the owner's iPad, in the row above |
| 4 | iPad Pro 11-inch, Safari 26.6.2 | The soak plan's two 30-minute S4 soaks on the owner's iPad, on WebGPU and with WebGL2 forced, at the default preset, with the iPad charging (run 20261005-014822-soak) | 2 of 2 passed. Each path ran 30 of 30 minutes with no GPU loss, no growth of WebAssembly memory and no engine failure. The engine's preset check chose Low on each path. WebGPU: median 59.1 fps, lowest 58.0, 10.7 to 13.1 ms of GPU time per frame. WebGL2: median 53.3 fps, lowest 47.5 in the first minute. With the GPU-loss pages of run 20261004-142218-soak, the soak plan has now passed in full on this iPad | Pass |
| 5 | iPad (10th generation, A14) on BrowserStack Automate, Safari 27.0, standing in for the owner's iPad Pro 11-inch | The runner's startup plan on WebGPU, 5 cold and 5 warm loads of each thread mode (run 20261004-173401-startup) | 55 of 55 passed. First frame done, median, pipelined: 1083 ms cold and 307 ms warm. The other thread modes: 880 to 1074 ms cold and 272 to 313 ms warm. A cold load fetched 11 or 12 files, 317 to 324 KB after compression. A warm load fetched 1 file, because Safari kept the rest in its cache. The loads came through BrowserStack Local's tunnel, with no network throttling | Recorded |
| 5 | iPad Pro 11-inch, Safari 26.6.2 | T-28 on the owner's iPad: the runner's startup plan on WebGPU, 5 cold and 5 warm loads of each thread mode, over the local network with no throttling (run 20261005-005444-startup) | 55 of 55 passed. First frame done, median, pipelined: 182 ms cold and 131 ms warm. The other thread modes: 169 to 208 ms cold and 111 to 153 ms warm. On a cold load the engine draws its first frame, then checks which preset the iPad holds, so createEngine resolves later, at 939 to 967 ms. A warm load uses the stored check and resolves at 79 to 121 ms. A cold load fetched 11 or 12 files, 317 to 324 KB after compression. A warm load fetched 1 file | Recorded |
| 3 | iPad (10th generation, A14) on BrowserStack Automate, Safari 27.0, standing in for the owner's iPad Pro 11-inch | GPU time of S4 at Low with the governor off, on WebGPU: the older commit f46c0686 (A) against the gate commit (B), in turns A, B, A, B, 30 seconds measured each, all in one session. Runs: A 20261004-174107-bench and 20261004-174656-bench, served from f46c0686; B 20261004-174322-bench and 20261004-174853-bench | GPU time per frame: A 10.89 and 10.88 ms, B 11.93 and 12.03 ms. The gate commit takes about 1.1 ms more, 10%. It makes 63 draw calls against 56. CPU time per frame 0.32 to 0.34 ms on both sides. Both sides drew 23 fps, with frames about 45 ms apart, while the screen ran at 60 Hz | Recorded: the gate commit costs 10% more GPU time on S4 at Low |
| 3 | iPad Pro 11-inch, Safari 26.6.2 | GPU time of S4 at Low with the governor off, on WebGPU, on the owner's iPad: the older commit f46c0686 (A) against the gate commit (B), in turns A, B, A, B, 30 seconds measured each, each side's runner tab in front. Runs: A 20261005-013811-bench and 20261005-014304-bench, served from f46c0686; B 20261005-014016-bench and 20261005-014517-bench | GPU time per frame: A 9.16 and 9.17 ms, B 10.10 and 10.09 ms. The gate commit takes 0.93 ms more, 10%, as on the cloud iPad. It makes 63 draw calls against 56. CPU time per frame 0.12 to 0.14 ms on both sides. Each run held 60 fps in every measured second. An earlier round on the same day is not used: the iPad was warm and charging after the first-frame runs, and each run was slower than the one before, whichever commit it served. Its figures in run order were A 9.11, B 10.17, A 13.60 and B 15.32 ms (runs 20261005-011454-bench, 20261005-011846-bench, 20261005-012050-bench, 20261005-012301-bench). The round above ran after 10 minutes of rest and a reload of both tabs | Recorded: the gate commit costs 10% more GPU time on S4 at Low, and S4 still holds 60 fps |
| 3 | iPad Pro 11-inch, Safari 26.6.2 | The fix for that cost, after the owner's ruling for Low ([D-16](decisions/D-16-moving-casters-and-bias.md)): GPU time of S4 at Low with the governor off, on WebGPU, main at 1533939f (A) against the fix at 84e2bd47 (B), in turns A, B, A, B, 30 seconds measured each, after 10 minutes of rest. Runs: A 20261005-032036-bench and 20261005-032818-bench, B 20261005-032549-bench and 20261005-033044-bench | GPU time per frame: A 11.33 and 11.35 ms, B 10.35 and 10.47 ms. The fix saves 0.93 ms, 8%. Draw calls: A 63 in every frame, B a median of 56 and 63 at the 95th percentile. CPU time per frame 0.16 to 0.20 ms on both sides. Each run held 60 fps in every measured second | Recorded: the fix wins back 0.93 ms of main's GPU time at Low |
| 1 | Galaxy S24 (SM-S921B) on BrowserStack Automate, Chrome 149.0.7827.160, standing in for the S24+ | The full checks plan on WebGL2, in two halves (runs 20261004-125729-checks and 20261004-132522-checks) | 232 passed, 413 skipped (the WebGPU and compatibility mode pages, which the phone lacks), 11 failed. 8 failures are engine pages whose frames came every 41.7 ms against a limit of 34 ms: the page measured the cloud phone's screen at 24 Hz, and the engine drew one frame per refresh. 3 failures are the debug view's image, which differs from the Mac's reference by 1.564%. The S24+ keeps its own reference for it, and the cloud phone's images match that reference with no pixel different. The test names only the S24+'s model, so the cloud phone compared with the Mac's | Open: no drawing fault. The frame checks need a screen of at least 30 Hz, and the debug test needs the cloud phone's model |
| 3 | Galaxy S24 (SM-S921B) on BrowserStack Automate, Chrome 149.0.7827.160 | S1 at phone scale, 300,000 boxes, against three.js, 5 runs of each page (run 20261004-141519-bench) | CPU time per frame: null3D on WebGL2 28.41 ms, 61% of three.js on WebGL (46.60 ms). With low latency 31.80 ms, 68%. Own work on the busiest thread 25% and 35% of three.js's. Frames per second: null3D 25.5, three.js 20.8. The screen ran at 24 to 30 Hz, so the runner marks the timing figures unreliable. Target: at most 100% of the CPU time | Pass on these figures; the S24+ or a cloud phone at 60 Hz confirms them |
| 3 | Galaxy S24 (SM-S921B) on BrowserStack Automate, Chrome 149.0.7827.160 | S3 and S1-cells against three.js, 5 runs of each page (run 20261004-143245-bench) | S3: null3D with WebGL2 6.64 ms per frame, 99% of three.js on WebGL (6.73 ms), and 6.11 ms with low latency, 91%. S1-cells: null3D 1.33 ms and 1.82 ms with low latency, 193% and 264% of three.js on WebGL (0.69 ms). Every null3D page held the screen's 30 fps, and three.js held 24.5 fps on S3. The screen ran at 24 to 30 Hz, so the runner marks the timing figures unreliable | Recorded |
| 3 | Galaxy S24 (SM-S921B) on BrowserStack Automate, Chrome 149.0.7827.160 | S4 with dynamic resolution on WebGL2, 5 minutes of warm-up and 5 measured (run 20261004-150445-bench) | 299 of 299 seconds at the target, 100%. The screen ran at 30 Hz, so the target was 30 fps, not 60. Lowest 29 fps, render scale 1 throughout, no quality steps. 7.11 ms per frame on the busiest thread. Target: 95% of the seconds | Pass at 30 Hz only; the 60 Hz case needs the S24+ |
| 3 | Galaxy S24 (SM-S921B) on BrowserStack Automate, Chrome 149.0.7827.160 | The governor's stress test on WebGL2 (run 20261004-151717-governor) | 2 of 2 passed, and the 2 WebGPU pages skipped. 9 live quality steps down and back up. Under the heavy scene, the last 15 seconds held 30 of 30 fps at a lowest render scale of 0.8, with the screen at 30 Hz | Pass at 30 Hz only |
| 5 | Galaxy S24 (SM-S921B) on BrowserStack Automate, Chrome 149.0.7827.160 | The runner's startup plan on WebGL2, 5 loads of each mode (run 20261004-152052-startup). T-28's Slow 4G figures need `bun run bench:startup -- --android`, which drives Chrome over USB, so a cloud phone cannot run it | 55 of 55 passed. First frame, pipelined: 1407 ms cold and 1362 ms warm. Single-threaded: 1119 ms cold and 1078 ms warm. The cloud phone fetched each file again through BrowserStack Local on each load, so warm loads gain nothing | Recorded. T-28 ran on the S24+ over USB, in its own row |
| 3 | Galaxy S24+ (SM-S926B), Chrome 154.0.8037.126, over USB | S4 at Low with dynamic resolution on WebGL2, 5 minutes of warm-up and 5 measured, with the display at 60 Hz (run 20261004-145501-bench) | 299 of 299 seconds at 60 fps, 100%. Lowest 58 fps, render scale 1 all through, no quality steps. 4.03 ms of CPU time per frame, on the sketch worker. The phone stayed cool: Samsung throttle level 0, skin at most 34.5 °C | Pass |
| 3 | Galaxy S24+ (SM-S926B), Chrome 154.0.8037.126, over USB | The governor's stress test on WebGL2 (run 20261004-150518-governor) | 2 of 2 passed, and the 2 WebGPU pages skipped. 9 live quality steps down and back up. Under the heavy scene, the last 15 seconds held 59 to 60 fps, at a lowest render scale of 0.8 | Pass |
| 3 | Galaxy S24+ (SM-S926B), Chrome 154.0.8037.126, over USB | S1 at phone scale, 300,000 boxes, against three.js, 5 runs of each page taking turns, at 60 Hz (run 20261004-150730-bench) | CPU time per frame: null3D on WebGL2 16.80 ms, 58% of three.js on WebGL (29.09 ms). Own work on the busiest thread 22% (3.88 ms against 17.93 ms). Frames per second: null3D 39.0, three.js 33.6. three.js on WebGPU skipped, because Chrome has no WebGPU adapter on this phone. The run started cool and grew hot: Samsung throttle level up to 4, Android thermal status up to 3, fastest cores down to 51% of top speed at the lowest. Target: at most 100% of the CPU time | Pass |
| 3 | Galaxy S24+ (SM-S926B), Chrome 154.0.8037.126, over USB | S3 and S1-cells against three.js, 5 runs of each page (run 20261004-151814-bench), on a phone still warm from S1 (Samsung throttle level up to 3) | S3: null3D with WebGL2 3.71 ms per frame at 59.9 fps. three.js on WebGL cannot draw S3 on this GPU (its shader needs more than 1,024 fragment uniform vectors), so its 5 pages failed, as on 2 October 2026. three.js on WebGPU skipped. S1-cells: null3D 1.03 ms, 222% of three.js on WebGL (0.46 ms). Own work 0.93 ms against 0.45 ms. Every S1-cells page held 60 fps | Recorded |
| 5 | Galaxy S24+ (SM-S926B), Chrome 154.0.8037.126, over USB | T-28: `bun run bench:startup -- --android`, 5 cold and 5 warm loads of each thread mode on Slow 4G and at full speed, WebGL2 (run 20261004-143115-startup-android, the tool's log) | First frame done, median, pipelined, Slow 4G: cold 4895 ms, warm 957 ms. The other thread modes: cold 4820 to 4863 ms, warm 976 to 989 ms. Full speed: cold 364 ms, warm 344 ms. A cold load downloads 11 files, 323 KB after compression, against 110 to 117 KB and a cold 4431 ms on 30 September 2026. The engine core is now about 219 KB after Brotli, and its download and compile end at 3.9 s. Targets: cold within 4.5 s, warm within 1 s | Cold failed, warm pass |

### S4's GPU time at Low against the older commit

The gate compares S4's GPU time on one iPad, in turns: the gate commit 5309dba5 against the older commit f46c0686. S4 runs on WebGPU at Low, with the governor off. On the cloud iPad (10th generation, Safari 27), the gate commit read 11.93 and 12.03 ms. The older commit read 10.89 and 10.88 ms. So the gate commit was 1.1 ms (10%) slower, with 63 draw calls against 56. The owner ruled it a regression to find.

The same runs on the Mac in Chrome found where it came from. Each commit ran S4 at Low twice for 10 s, with the governor off (5 October 2026):

| Commit | Draw calls per frame | GPU ms per frame | What changed |
| --- | --- | --- | --- |
| f46c0686, the older commit | 56, and 63 in 1 frame of 4 | 1.19 | |
| 5bdea5dc, before #227 | 56, and 63 in 1 frame of 4 | 1.19 | |
| deb77723 (#227) | 63 | 1.36 | The far cascade draws in every frame while a moving caster touches it ([D-16](decisions/D-16-moving-casters-and-bias.md)) |
| f980a754, before #257 | 63 | 1.36 | |
| 2ab66e2e (#257) | 63 | 1.47 | The shadow filter compares each read with the receiver's plane, against acne on flat casters |
| 5309dba5, the gate commit | 63 | 1.47 | |
| 1533939f, main on 5 October | 63 | 1.55 | |
| fix/gate-ab-regression, without the ruling | 63 | 1.48 | Surfaces that face away from the sun skip the shadow lookup, and the GPU timer times every phase of the far cascade's turns |
| fix/gate-ab-regression | 56, and 63 in 1 frame of 4 | 1.32 | Low keeps its far cascade's turns while cars move in it, by the owner's ruling |

The owner ruled on 5 October 2026 ([D-16](decisions/D-16-moving-casters-and-bias.md)). At Low, a far cascade keeps its turns while moving casters touch it. So a far moving shadow can trail its caster by up to 3 frames. Medium and up keep the far cascade drawing in every frame. The receiver plane stays on every preset, so no surface shows acne. The older commit's figure was also too low. The GPU timer timed one frame in 8, and the far cascade drew once in 4 frames, so no timed frame held it. [Implementation notes](implementation-notes.md#shadows) gives the rule and the test that holds S4's draw calls and passes.

### Results on the gate commit 89a1d6295

The gate moved to 89a1d6295 (#321), the cold-load fix, and ran on the night of 5 to 6 October 2026. CI passed on it. The iPad's runs before T-28 ran on main at 03a1ad198. That commit differs from 89a1d6295 only in how the start's download begins, so their results stand for the gate commit ([D-83](decisions/D-83-gate-rulings-2026-10-06.md)). The Mac ran on a MacBook Pro M5 Max in Chrome 154.0.8037.93, with its timing steps inside a quiet window. Its 1-minute load was 7.2 when they started. The iPad Pro 11-inch ran in Safari 26.6.2, charging, with Limit Frame Rate on, so its screen ran at 60 Hz. The Galaxy S24+ ran in Chrome 154.0.8037.126 over USB, at 60 Hz, and each timed run started at Android thermal status 0. The run names are in UTC.

| Item | Device and browser | Check | Figure | Result |
| --- | --- | --- | --- | --- |
| 1 | Mac, Chrome on the Mac's GPU | The image test manifest on all three tiers (gate step `images-gpu`) | 591 passed | Pass |
| 1 | Mac, Chrome with SwiftShader | The image test manifest on all three tiers, `CI=1 bun run test:images --workers 6`. It ran on its own, outside the gate's record, to keep the Mac's load down | 591 passed | Pass |
| 1, 3 | GitHub Actions | CI and the benchmark job on the gate commit (gate step `workflows`). The benchmark job now runs once an hour on main's newest commit, so it ran by hand on a branch at the gate commit (run 37311229382) | CI passed. The benchmark job's first attempt failed: S1 on WebGPU read 10% more on the busiest thread and 15.6% more own work than the commit before, with run ranges that overlap widely. Its rerun passed | Pass |
| 1 | Mac, Firefox 157.0 | The full checks plan through the device runner (run 20261005-191616-checks) | 825 passed, 6 failed. The room environment on WebGL2 failed in all 5 thread modes: 5.2% to 6.3% of pixels differ from the Chrome reference, against 0.5%, and the modes differ from each other. The WebGPU engine page with the sketch on the main thread had no GPU times, although the device has timestamp queries | Fail. Runs again after the fixes merge |
| 1 | Mac, Safari 26.6.2 | The full checks plan through the device runner (run 20261005-223110-checks), and its 4 restart pages again with the display kept awake (run 20261005-234423-checks) | 825 passed, 6 failed. Four were the screen lock, not the engine: the screen saver locked the screen at 06:53 local time, and Safari then gave the pages no animation frames. They were the restart page with the sketch on the main thread, and the in-frame starts, pipelined, low latency and drawing on the main thread. Run again with the display awake, 4 of 4 passed. The other 2 are the 100,000-sprite scene, on WebGPU and in compatibility mode. They hit a Safari 26 fault, WebKit bug 321876: two indirect draws from one buffer in one render pass can hang the GPU. macOS reset the GPU twice, and current main fails the same way. An earlier run that night is not a result: the screen was locked, and every page failed | Fail on the 2 sprite pages. Runs again after the fix merges |
| 1 | iPad Pro 11-inch, Safari 26.6.2 | The full checks plan on WebGPU, compatibility mode and WebGL2, on 03a1ad198 (run 20261005-135655-checks) | 831 passed, 0 failed | Pass |
| 1 | Galaxy S24+ (SM-S926B), Chrome 154.0.8037.126 | The full checks plan on WebGL2 (run 20261005-163754-checks) | 307 passed, 524 skipped (the WebGPU and compatibility mode pages), 0 failed | Pass |
| 2 | Mac, Chrome on the Mac's GPU | The parity scenes on core WebGPU and WebGL2 (`bun run parity -- --tier webgpu,webgl2`, on its own) | 112 of 112 comparisons pass | Pass |
| 3 | Mac, Chrome | S1's own work on the busiest thread, WebGPU (gate step `desktop-target`) | null3D 0.160 ms, three.js 1.400 ms after its 1.370 ms of scene code: 11.4%, against at most 50% | Pass |
| 3 | Mac, Chrome | S3, S1-cells and S4 against three.js (gate step `scenes`) | CPU time per frame. S3: null3D 30% of three.js on WebGPU (0.09 against 0.30 ms) and 72% with WebGL2. S1-cells: null3D on WebGPU 183% of three.js on WebGL (0.06 against 0.03 ms) and 48% of three.js on WebGPU, and with WebGL2 167%. S4: null3D 5% of three.js on WebGL (0.09 against 1.74 ms) on WebGPU, and 14% with WebGL2 | Recorded. S1-cells is a finding: null3D takes more time than three.js on WebGL, though both figures are under 0.1 ms |
| 3 | iPad Pro 11-inch, Safari 26.6.2 | S1 at phone scale, 256,000 boxes, against three.js, 5 runs of each page, on 03a1ad198 (run 20261005-123824-bench) | 27 of 27 passed. CPU time per frame: null3D on WebGPU 16.46 ms, 53% of three.js on WebGPU (30.80 ms). With WebGL2 forced 17.30 ms, 56%. Own work on the busiest thread 14% and 24%. Target: at most 100% | Pass |
| 3 | iPad Pro 11-inch, Safari 26.6.2 | S4 at Low with dynamic resolution, WebGPU, 5 minutes of warm-up and 5 measured, on 03a1ad198 (run 20261005-111656-bench) | 295 of 300 seconds at 60 fps, 98%. Lowest 56 fps, lowest render scale 0.75, 34 quality steps against 8 on 5309dba5. 0.20 ms of CPU and 12.82 ms of GPU time per frame. Target: 95% | Pass |
| 3 | iPad Pro 11-inch, Safari 26.6.2 | S4 at Low with dynamic resolution, WebGL2 forced, 5 minutes of warm-up and 5 measured, on 03a1ad198 | First run (20261005-121546-bench): 297 of 300 seconds, 99%, lowest 54 fps, 18 quality steps. Its lowest fell below 5309dba5's 56, so the iPad rested 10 minutes and the item ran again (20261005-130618-bench): 299 of 299 seconds, 100%, lowest 57 fps, lowest render scale 0.5, 4 quality steps, 0.84 ms per frame. Target: 95% | Pass, on the second run |
| 3 | iPad Pro 11-inch, Safari 26.6.2 | The governor's stress test on WebGPU and WebGL2, on 03a1ad198 (run 20261005-122606-governor) | 4 of 4 passed. 9 live quality steps down and back up on each path. Under the heavy scene, the last 15 seconds held 54 to 60 fps on WebGPU, at a lowest render scale of 0.85, and 59 to 61 fps on WebGL2, at 0.75 | Pass |
| 3 | iPad Pro 11-inch, Safari 26.6.2 | S3 and S1-cells against three.js, 5 runs of each page, on 03a1ad198 (run 20261005-132155-bench) | 49 passed, 5 failed. three.js on WebGL cannot draw S3 on this iPad: its shader needs more than 1,024 fragment uniform vectors, so its 5 pages failed. Every null3D page passed. S3: null3D 0.22 ms per frame on WebGPU and 0.90 ms with WebGL2, 7% and 29% of three.js on WebGPU (3.14 ms). S1-cells: 0.20 ms and 0.80 ms, 28% and 111% of three.js on WebGL (0.72 ms) | Recorded |
| 3 | Galaxy S24+ (SM-S926B), Chrome 154.0.8037.126 | S1 at phone scale, 300,000 boxes, against three.js, 5 runs of each page (run 20261005-160642-bench) | 16 passed, 5 skipped. CPU time per frame: null3D on WebGL2 16.80 ms, 57% of three.js on WebGL (29.56 ms). Own work on the busiest thread 19% (3.57 against 18.42 ms). Target: at most 100% | Pass |
| 3 | Galaxy S24+ (SM-S926B), Chrome 154.0.8037.126 | S4 at Low with dynamic resolution on WebGL2, 5 minutes of warm-up and 5 measured (run 20261005-155424-bench) | 300 of 300 seconds at 60 fps, 100%. Lowest 58 fps, render scale 1 all through, no quality steps. Target: 95% | Pass |
| 3 | Galaxy S24+ (SM-S926B), Chrome 154.0.8037.126 | The governor's stress test on WebGL2 (run 20261005-160442-governor) | 2 passed, and the 2 WebGPU pages skipped. 9 live quality steps down and back up. Under the heavy scene, the last 15 seconds held 59 to 60 fps, at a lowest render scale of 0.7 | Pass |
| 3 | Galaxy S24+ (SM-S926B), Chrome 154.0.8037.126 | S3 and S1-cells against three.js, 5 runs of each page (run 20261005-162110-bench) | 27 passed, 10 skipped, 5 failed. three.js on WebGL cannot draw S3 on this GPU, for the same reason as on the iPad, so its 5 pages failed. S3: null3D with WebGL2 3.86 ms per frame. S1-cells: null3D 1.15 ms, 264% of three.js on WebGL (0.44 ms) | Recorded |
| 3 | iPad Pro 11-inch, Safari 26.6.2 | GPU time of S4 at Low with the governor off, on WebGPU: the older commit f46c0686 (A) against the gate commit (B), in turns A, B, A, B, 30 seconds measured each, with one tab whose dev server changed sides before each run. First round: A 20261005-155921-bench and 20261005-160221-bench, B 20261005-160051-bench and 20261005-160350-bench. Second round, after 10 minutes of rest: A 20261005-172151-bench and 20261005-172459-bench, B 20261005-172327-bench and 20261005-172629-bench | First round: A 9.46 ms at 60 fps, B 10.08 ms at 59.9 fps, then A 11.75 ms and B 11.37 ms, both at 30 fps. Second round: A 11.79, B 11.45, A 16.76 and B 18.02 ms, all at 18.6 to 29.4 fps. Both sides drew 56 calls per frame. A run that drops to 30 fps does not count, so only the first pair stands: B takes 0.62 ms more, 6.6% | Invalid: one clean pair only. Runs again on a cool iPad |
| 4 | Mac | The WebAssembly builds and the engine's JavaScript (gate step `budgets`) | WebAssembly: threaded 275.9 KB and single-threaded 275.2 KB after Brotli, 46% of 600 KB. Engine JavaScript: 109.1 to 116.8 KB after Brotli in the five thread modes, 78.0% to 83.5% of the current budget | Pass |
| 4 | Mac, Chrome | Allocation, S4 on WebGPU (gate step `allocation-s4-webgpu`) | Sketch worker 254.0 bytes per frame, render worker 640.5 | Pass |
| 4 | Mac, Chrome | Allocation, S4 on WebGL2 (gate step `allocation-s4-webgl2`) | The governor's judge step allocates 4.1 bytes per frame against its budget of 4, and 4.6 at most. Sketch worker 243.5 bytes per frame, render worker 150.8. The cause is the float arrays that #318 put in the governor. #335 keeps its times in 32-bit integers | Fail. Runs again on the new gate commit |
| 4 | Mac, Chrome | Soak, S4, 10 minutes (gate step `soak-s4`) | After the 2-minute warm-up, the sketch worker's heap grew 11 KB and the render worker's 32 KB, of 256 KB each. WebAssembly memory +0.00 MB | Pass |
| 4 | iPad Pro 11-inch, Safari 26.6.2 | The soak plan on S4: the GPU-loss pages and two 30-minute soaks, at the preset the engine chose (run 20261005-161025-soak) | 12 of 12 passed. The 10 GPU-loss pages each counted 1 GPU loss, drew again and matched their references. Each soak ran 30 of 30 minutes, with no GPU loss, no growth of WebAssembly memory and no engine failure. The preset check chose Low. But the median frame rate was 14.8 fps on WebGPU and 32.2 fps with WebGL2, against 59.1 and 53.3 on 5309dba5. GPU time per frame stayed at 13 to 14 ms | Invalid: the iPad slowed, see the notes. Runs again on a cool iPad |
| 5 | Mac, Chrome | T-28, first frame done, median of 3, pipelined, WebGPU (gate step `startup`) | Slow 4G: cold 4,288 ms, warm 669 ms. Full speed: cold 93 ms, warm 90 ms. 13 requests and 404.9 KB on a cold load | Recorded |
| 5 | iPad Pro 11-inch, Safari 26.6.2 | T-28: the runner's startup plan on WebGPU, 5 cold and 5 warm loads of each thread mode, over the local network with no throttling (run 20261005-154744-startup) | 55 of 55 passed. First frame done, median, pipelined: 175 ms cold and 136 ms warm. The other thread modes: 141 to 194 ms cold and 132 to 142 ms warm | Recorded |
| 5 | Galaxy S24+ (SM-S926B), Chrome 154.0.8037.126 | T-28: `bun run bench:startup -- --android`, 5 cold and 5 warm loads of each thread mode on Slow 4G and at full speed, WebGL2. It ran twice, the second time after 10 idle minutes at thermal status 0 | First frame done, median, pipelined, Slow 4G: cold 4,532 ms and warm 945 ms, then cold 4,557 ms and warm 945 ms. The other thread modes: cold 4,507 to 4,550 ms and 4,474 to 4,536 ms, warm 942 to 966 ms and 961 to 984 ms. Full speed, pipelined: cold 338 ms, warm 340 ms. A cold load fetched 12 files, 402 KB after compression. Targets: cold within 5.5 s, warm within 1 s | Pass, by the owner's target of 6 October 2026 ([D-83](decisions/D-83-gate-rulings-2026-10-06.md)). Against the earlier 4.5 s it missed by 32 and 57 ms |
| 6 | Mac | `bun run docs:check`, `docs:style`, `skills:check` and `release -- --release-type minor` (gate steps `docs`, `docs-style`, `skills`, `release`) | No problems in each check. The release script prints 0.1.0 | Pass |

Notes on the figures:

- The iPad slowed during the night, whichever commit it served. In the first GPU time round, its frame rate fell from 60 to 30 fps. From the soak on, it held 15 fps on WebGPU. The rate fell in exact halves of the 60 Hz screen, and GPU time per frame barely moved. The older commit ran as slowly as the gate commit. So the iPad capped its own frame rate, most likely from heat after hours of charging and load. It does not point to the engine. Its soak and GPU time comparison run again on a cool iPad.
- The owner watched the soak's S4 page on 03a1ad198, in run 20261005-143144-soak. That run stopped after its GPU-loss pages, for the Mac's quiet window. The shadows jerkily trail the cars, very obviously. At Low, a far cascade draws once in 4 frames and keeps its turns while cars move in it ([D-16](decisions/D-16-moving-casters-and-bias.md)). So a far shadow can trail by up to 3 frames. Each shadow step of the governor makes the far cascade's turns longer, up to every 8th frame. S4's 10-minute WebGPU run took 34 quality steps, against 8 on 5309dba5. S4 does not report the far cascade's interval, so how far the governor took it is not known. By the owner's ruling of 6 October 2026, this finding does not hold back the gate ([D-83](decisions/D-83-gate-rulings-2026-10-06.md)). The cause is known: at Low, the far cascade draws only every few frames, so it lags moving casters. The fix keeps a cached far layer, on fix/shadow-trail (944bb64ef), and lands in M2.
- On the Mac, the GPU image step ran while the jitter branch built, and the Mac's 1-minute load reached about 40. The SwiftShader images, the parity scenes, Safari and Firefox then ran one at a time, each at a load below 18.

### Reruns on the gate commit fdf14a28

These items ran again on the new gate commit fdf14a28 (#347), by the owner's ruling of 6 October 2026 ([D-83](decisions/D-83-gate-rulings-2026-10-06.md)). Each replaces its row on 89a1d6295.

| Item | Device and browser | Check | Figure | Result |
| --- | --- | --- | --- | --- |
| 4 | Mac, Chrome | Allocation, S4 on WebGPU and on WebGL2 (gate steps `allocation-s4-webgpu` and `allocation-s4-webgl2`, record 20261006-021354-gate), at a 1-minute load of about 4 | WebGL2: sketch worker 241.6 bytes per frame, render worker 149.6. The governor's judge step, 4.1 of 4 before, no longer allocates. WebGPU: sketch worker 244.1, render worker 633.9, with the replay at 298.7 of 320 against 296.9 on 89a1d6295 | Pass |

### What the gate still needs

The gate moves to a newer main commit, by the owner's ruling of 6 October 2026 ([D-83](decisions/D-83-gate-rulings-2026-10-06.md)). It is fdf14a28, the first main commit that holds #347, the refresh meter's allocation fix, and so also #335, the governor's. Firefox and Safari run again on the later main commit that holds their fixes, and their rows name it. Only these items run again there. Every other item keeps its result from 89a1d6295, or from 03a1ad198 for the iPad runs before T-28.

The open items, with the helper that owns each one. This list changes as each item ends:

| Item | What runs | Commit | Owner | State |
| --- | --- | --- | --- | --- |
| 4 | The iPad's soak plan on S4, on a cool iPad | fdf14a28 | ipad-runner-b | Started |
| 3 | The iPad's GPU time comparison of S4 at Low against f46c0686, A, B, A, B. A run that drops to 30 fps does not count | fdf14a28 | ipad-runner-b | Started |
| 1 | Firefox on the Mac through the device runner, after the fix for the room and GPU times (#350) merges | 156c0621, the first main commit with #350 | ff-room | #350 merged; the rerun is starting |
| 1 | Safari on the Mac, the 2 pages of the 100,000-sprite scene, after the fix for WebKit bug 321876 merges. Its 4 restart pages passed again with the display awake | The first main commit with the fix | safari-gate | Fix in progress on fix/safari-gate-1006 |

After each run, a row goes in [the record of tested devices](tested-devices.md).

### The owner's changes of 4 October 2026

- Brave is no longer tested. It draws as Chrome does, so the gate drops its Brave items.
- The phone items run on BrowserStack Automate's phones where they can, and on the S24+ where they cannot.

### The owner's rulings of 5 October 2026

The owner ruled on two gate results on 5 October 2026 ([D-67](decisions/D-67-rulings-2026-10-05.md)).

- The GPU time of S4 is a regression, and the gate does not pass until it is fixed. The cloud iPad 10th ran S4 in Safari 27.0, at Low on WebGPU with the governor off. Two commits took turns in one session, 30 seconds each. The gate commit 5309dba5 took 11.93 and 12.03 ms of GPU time per frame. The older commit f46c0686 took 10.89 and 10.88 ms. The gate commit takes about 1.1 ms more, 10%, and makes 63 draw calls against 56. CPU time stayed at 0.32 to 0.34 ms on both. A fix is in progress, and the comparison runs again once it lands.
- The owner's iPad Pro 11-inch runs the gate's iPad items that are still open. Among them are the two 30-minute soaks and the first frame, which only the cloud iPad has run so far. Results from the cloud iPad are kept as evidence, and they do not replace a run on the owner's iPad.

### The owner's rulings of 6 October 2026

The owner ruled on the gate's results on 6 October 2026 ([D-83](decisions/D-83-gate-rulings-2026-10-06.md)).

- The gate commit moves to the first main commit that holds #347 and #335, the allocation fixes. Only the items that failed, or that gave no valid result, run again there. [What the gate still needs](#what-the-gate-still-needs) lists them.
- T-28's cold-start target on the S24+ in Chrome on Slow 4G is 5.5 s, up from 4.5 s. The warm target stays at 1 s. So the gate commit's 4,532 and 4,557 ms pass.
- The shadows that trail the cars in S4 at Low are a known finding, and they do not hold back the gate. The fix lands in M2.
