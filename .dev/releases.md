# Releases

This guide covers how a release is made. [AGENTS.md](../AGENTS.md) holds the rule that decides each changelog line: pull requests merge by squash only.

## Making a release

To release, run the Release workflow from the Actions tab and pick a release type. The workflow:

1. Waits for CI to pass on main's latest commit.
2. Runs `bun run release --apply` on a `release/<version>` branch. This sets the version in every package manifest, the engine's `VERSION` export, the Rust workspace and `Cargo.lock`. It adds the release's section to `CHANGELOG.md` and regenerates the docs.
3. Opens a pull request. Review the changelog there, and edit `CHANGELOG.md` on that branch if a line needs it.

Merging that pull request runs the Release Publish workflow. It tags the merge commit with the plain version, such as `0.0.1`, and publishes the GitHub Release with the changelog section. Then it publishes every package that is not private to npm, and skips a version that npm already has.

## Versions

Versions follow the roadmap in the README. The `auto` release type always releases a patch. Pick `minor` or `major` when a roadmap release is done. The release script refuses an x.y.0 version while a docs page with that `since` or an earlier one is still `planned` (hard rule 19).

1.0 is the first public release. The roadmap is internal, so it stays in the README until then. Before releasing 1.0, remove it: the Roadmap section, its navigation link, the status badge's link and the by-version table under Features. Replace the pre-alpha status line too. The release script refuses 1.0.0 and every later version while the README has the roadmap.

At 1.0, also announce the agent skills. Add the Claude Code plugin commands to the README's "For AI agents" section, and link `guides/agents` for other agent tools. Until then, `.claude-plugin/marketplace.json` exists and each release attaches the skill zips, but the README does not name them.

## One-time setup

- A GitHub App with write access to contents and pull requests, installed on the repository. Its ID and private key go in the `RELEASE_APP_ID` and `RELEASE_APP_PRIVATE_KEY` secrets. A pull request opened with the default token starts no workflows, so its CI would never run.
- npm trusted publishing. Publish each public package's first version by hand with a token. Then, in the package's settings on npmjs.com, name this repository and `release-publish.yml` as its trusted publisher. A public package also needs `"publishConfig": { "access": "public", "provenance": true }`.
- Git does not keep the shader modules (`packages/engine/src/generated/shaders*.ts`). The engine's `prepack` script builds them, so `npm publish` puts them in the engine's package. The publish job therefore sets up Bun and the pinned Rust toolchain. Before it publishes, `bun tools/check-package.ts` packs the engine as `npm publish` would and fails unless the package holds every shader module. The build job in CI runs the same check on every pull request.
- The publish job builds no WebAssembly, because the only public package is the command-line tool. Add the engine's WebAssembly build to the job before the engine becomes public.

## 0.1 exit gate

Release 0.1 follows M1's exit gate (task M1-K5). Every item below must hold on one commit of main, the gate commit. The command `bun run gate` runs the Mac's part of the gate one step after another, so the timing steps never overlap. It writes the record to `target/gate/<run>/gate.md` and `gate.json`, with each step's output beside them. Its `--list` option prints each step, its gate item and its command. The device runner covers the rest: Safari and Firefox on the Mac, the iPad and the Galaxy S24+, as [Device sessions](devices.md) describes.

If item 1 or item 3 fails, feature work stops. Fix the cause, then run the gate again.

### The items and how they are measured

| Item | Rule | Measured by |
| --- | --- | --- |
| 1. Image tests | Every test in the image test manifest matches its references. This holds in CI on SwiftShader and in Chrome on the Mac's GPU, on all three tiers. It holds through the device runner in Safari and Firefox on the Mac, Safari and Brave on the iPad, and Chrome and Brave on the S24+. | Steps `images-gpu`, `images-swiftshader` and `workflows`. The device runner, through `bun run test:real-browsers Safari Firefox` and `bun run devices` |
| 2. Parity | The parity scenes match their three.js twins on core WebGPU and on WebGL2, within three.js's threshold. The shadow scenes match within 0.5%. | Step `parity` |
| 3. Speed | The CI benchmark job passes on the gate commit. S1's own work on the busiest thread is at most 50% of three.js's, in Chrome on the Mac on WebGPU. S1 at phone scale is at most 100% of three.js on the S24+ and the iPad. S4 holds its preset's target frame rate in at least 95% of the seconds of a 10-minute run on both devices. S3 and S1-cells are measured against three.js on the three devices. | Steps `workflows`, `desktop-target` and `scenes`. Benchmark runs and the governor plan on the devices |
| 4. Budgets | Each WebAssembly build stays within 600 KB after Brotli, and the engine's JavaScript within 100 KB in each thread mode. `bun run bench:allocation` passes on S4 on both GPU paths. `bun run bench:soak` passes on S4 in Chrome on the Mac and in Safari on the iPad. | Steps `budgets`, `allocation-s4-webgpu`, `allocation-s4-webgl2` and `soak-s4`. The soak plan on the iPad |
| 5. Decisions | Records D-08 to D-13 are written. Tests T-11, T-12, T-21, T-22, T-24, T-25, T-26 and T-29 are closed with their dates and results. T-28, the time to first frame, is measured again with the pipeline warm-up. | Step `startup` on the Mac. `bun run bench:startup -- --android` on the S24+, and the startup plan on the iPad |
| 6. Docs | Every docs page with `since: "0.1"` is `experimental` or `stable`, or has moved to a later version with a written reason. The docs and skills checks pass, and the release script prints 0.1.0. | Steps `docs`, `docs-style`, `skills` and `release` |

The iPad's S4 run is judged at its Low preset, by the owner's decision of 3 October 2026 (#215).

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
| 4 | Allocation, S4 on WebGPU | The replay 418 of 320 bytes per frame, the wake-up timer 29.9 of 4 and the GPU completion callback 14.2 of 4. After the fix below: the replay 254 of 320, both callbacks 0.0 | Failed, then pass |
| 4 | Allocation, S4 on WebGL2 | The benchmark sketch's camera step 49.0 of 48 bytes per frame. After the fix below: 24.8 of 48 | Failed, then pass |
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

- The WebGPU replay passed each render pass's clear color to the pass setup as four numbers. The browser inlined that call in S1 but not in S4, so each of S4's four render passes boxed the fog color's three fractions. The setup now reads the color from the draw list's floats. S4's replay fell from about 420 to about 250 bytes per frame, and S1's stayed at about 208.
- The replay bound some vertex buffers whole, with the size `undefined`, and others in part, through one call. So the browser threw its optimized replay code away every 1.5 seconds and compiled it again. Each compile left about 10 KB of objects in the wake-up timer or the GPU completion callback, whichever ran first. Each case now has one call without the size and one with it. The browser's log showed 26 of these events in one run before the change, and none after it.
- The benchmark sketch's camera step stayed on the browser's middle tier for the whole 45-second run. That tier never inlined the camera's `lookAt`, so its three fractions were boxed in every frame. The step now computes the rotation with `quat.lookAt` and passes it to `setRotation`. About two boxed numbers per frame remain, within the step's budget of 48 bytes.

Per frame, S4 draws 4 render passes and S1 draws 2. S4's 2 extra passes are depth-only shadow passes, and it makes 13 buffer uploads to S1's 4. After the fix, S4's replay allocates about 46 bytes per frame more than S1's. About 35 of them are objects of 16 bytes or more, which fits one pass encoder from the browser for each extra pass. The rest are one or two number objects. That fits in the replay's budget of 320 bytes, so no budget changed. The fix's runs, on the same Mac:

| Scene and path | Sketch worker, bytes per frame | Render worker, bytes per frame | Result |
| --- | --- | --- | --- |
| S1, WebGPU | 287 | 557, with the replay at 208 of 320 | Pass |
| S1, WebGL2 | 381 | 160 | Pass |
| S4, WebGPU | 226 | 598, with the replay at 254 of 320 | Pass |
| S4, WebGL2 | 222 | 163 | Pass |

### What the gate still needs

On the gate commit, the Mac runs `bun run gate` with every step, and with no other heavy work during the timing steps. The rehearsal's figures do not count for the gate.

The coordinator runs these device runs on the gate commit:

1. Image tests through the device runner: Safari and Firefox on the Mac, on WebGPU and with WebGL2 forced. Safari and Brave on the iPad, on both paths, with Brave's full checks plan. Chrome and Brave on the S24+, on WebGL2, with Brave's Shields state.
2. S1 at phone scale against three.js: the iPad in Safari on WebGPU and with WebGL2 forced, and the S24+ in Chrome and in Brave.
3. S4's 10-minute run with dynamic resolution: the S24+ in Brave, the iPad with WebGL2 forced, and the iPad on WebGPU again at 60 Hz. The governor's stress test runs on each.
4. S3 and S1-cells against three.js on the S24+ and the iPad.
5. The soak plan on S4 in Safari on the iPad.
6. T-28: `bun run bench:startup -- --android` on the S24+ in Chrome, cold and warm on Slow 4G, and the iPad's first frame.
7. After each run, a row in [the record of tested devices](tested-devices.md).
