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
- T-28's target is on the S24+ in Chrome on Slow 4G: a cold start within 4.5 s, and a warm one within 1 s ([D-06](decisions/D-06-success-targets.md)). The Mac is inside both, but the gate's figures come from the S24+ and the iPad. On the iPad, the preset check took about 1 s for each preset it measured. Pull request #234 skips the check on repeat visits ([D-17](decisions/D-17-stored-preset-check.md)), so the warm figures change on the gate commit.

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

### Results on the gate commit

The gate commit is 5309dba5 (#271), and main's CI passed on it. Each device run below served the pages from a checkout at that commit. The run names are in UTC.

| Item | Device and browser | Check | Figure | Result |
| --- | --- | --- | --- | --- |
| 1 | iPad Pro 11-inch, Safari 26.6.2 | The full checks plan on WebGPU, compatibility mode and WebGL2 (run 20261004-035655-checks) | 656 passed, 0 skipped, 0 failed | Pass |

### What the gate still needs

On the gate commit, the Mac runs `bun run gate` with every step, and with no other heavy work during the timing steps. The rehearsal's figures do not count for the gate.

The owner decided two changes on 4 October 2026:

- Brave is no longer tested. It draws as Chrome does, so the gate drops its Brave items.
- The phone items run on BrowserStack Automate's phones where they can, and on the S24+ where they cannot.

The coordinator runs these device runs on the gate commit:

1. Image tests through the device runner: Safari and Firefox on the Mac, on WebGPU and with WebGL2 forced. Safari on the iPad, on both paths. Chrome on the S24+, on WebGL2.
2. S1 at phone scale against three.js: the iPad in Safari on WebGPU and with WebGL2 forced, and the S24+ in Chrome.
3. S4's 10-minute run with dynamic resolution: the S24+ in Chrome, the iPad with WebGL2 forced, and the iPad on WebGPU again at 60 Hz. The governor's stress test runs on each.
4. S3 and S1-cells against three.js on the S24+ and the iPad.
5. The soak plan on S4 in Safari on the iPad.
6. T-28: `bun run bench:startup -- --android` on the S24+ in Chrome, cold and warm on Slow 4G, and the iPad's first frame.
7. After each run, a row in [the record of tested devices](tested-devices.md).
