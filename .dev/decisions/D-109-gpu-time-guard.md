# D-109: A guard on GPU time: the comparison's GPU rule, a nightly Mac run and a check before merge

Status: decided by the owner on 2026-10-08 at about 12:02 (UTC+8), on the coordinator's proposal. Date: 2026-10-08. Task: M2-J7.

Summary: CI's benchmark job judges CPU time only. So #389 passed it, though it made S4 and S6 on WebGPU 5 to 33 times slower on the Mac's GPU. The build comparison now judges GPU time too, when both builds time the GPU. A page fails when it is more than 25% and 0.3 ms slower, and the change is more than twice its noise. The Mac runs that comparison on main each night. A pull request that changes how the GPU draws runs `bun run bench:gpu-check` and records the result in a `GPU-Checked:` trailer.

## Question

#389 (7 October 2026, 17:45) gave the standard material a switch that picks each map's texture. On the Mac's GPU, with 4x MSAA, it made every textured draw many times slower. Nothing caught it for 17 hours. A look into S6's GPU time found it ([D-89](D-89-webgl2-texture-units.md#the-webgpu-slowdown-from-a-switch-on-the-maps-slot-8-october-2026)). How can such a slowdown fail before it reaches main, or soon after?

## Rule

- It must catch a slowdown of the GPU's work as large as #389's, on the GPU that showed it.
- It must not fail comparisons of identical builds, nor fail on the Mac's normal spread between runs.
- It must cost little: no new CI machines, and minutes, not hours, on the Mac.

## Data

What #389 did to the GPU time per frame, in Chrome 155 on the owner's Mac (Apple M5 Max). The medians come from runs of 8 s, in two rounds that alternate the builds ([D-89](D-89-webgl2-texture-units.md#the-webgpu-slowdown-from-a-switch-on-the-maps-slot-8-october-2026)):

| Page | Main with #389, GPU ms | The fix, GPU ms |
| --- | --- | --- |
| S4, WebGPU, Medium | 30.8, 28.1 | 1.86, 1.97 |
| S4, WebGPU, High | 40.0, 22.9 | 1.82, 1.96 |
| S6, WebGPU, Medium | 28.4, 26.5 | 3.82, 3.93 |
| S6, WebGPU, High | 32.5, 32.0 | 6.17, 6.75 |

What CI's benchmark job saw. Main's run 37644306103 compared 73abc0739 with ef2e6b028, whose commits held #389, on GitHub's Mac machine. It passed:

- None of its 240 runs timed the GPU. Chrome on that virtual machine has no GPU timer.
- S4's CPU times on WebGPU did not change.
- S4 on WebGPU drew a median of 242 frames in a measured run, against the baseline's 267. Its time from a frame's submit to the GPU's finish rose from 27.0 ms to 28.8 ms. The shared GPU held S4 under 60 frames per second before #389 too, and that time stops growing at about two frames.
- S4 on WebGL2, whose shaders did not change, moved more: from 24.8 ms to 31.9 ms.

The GPU rule was replayed on the 14 comparisons that helpers ran on the owner's Mac from 6 to 8 October 2026. 13 of them timed the GPU, on 17 pages in all. Two builds of the same commit, f46c068, differed by 6.5% in S4. One page failed: S4 on WebGPU, 1.27 ms to 1.60 ms, from f46c068 to #309. That was a real cost. #307 found two shadow fixes between those commits, which added 0.11 ms and 0.17 ms to S4's GPU work. Round by round, two builds with the same WebGL2 shaders differed by 2% to 3% in S4 and 3% to 6% in S6. One build's two rounds of S6 at High on WebGPU differed by 9%.

How the data was produced: `bun run bench:run --compare` on the Mac, the records under each worktree's `target/bench/*-compare/runs.json`, judged again with the new rule. CI's figures come from the artifact of run 37644306103.

## Options

- Judge GPU time in CI. Rejected: GitHub's Mac machine has no GPU timer, and its frames and GPU delay moved within their noise. CI's Linux machines draw with SwiftShader, a software GPU. It does not run Apple's shader compiler, whose handling of the switch caused #389's slowdown.
- Judge frames per run or the GPU delay on CI's Mac. Rejected: the shared GPU already held S4 below the display's rate, and S4 on WebGL2 moved more than WebGPU with no change to its shaders.
- A test per known fault, such as the shader crate's test that fails when a WebGPU build of the standard material holds a switch (#434). Kept, but it only stops that one fault from coming back.
- Device runs on every pull request. Rejected: device sessions cost minutes of a person's time or of BrowserStack's, and the owner keeps cloud runs to manual sittings.
- A comparison of GPU time on the Mac, at two points. It runs each night on main, and before merge on the pull requests that can change the GPU's work. Chosen.

## Decision

- **The GPU rule.** `bench/lib/compare.ts` judges GPU time per frame as a third measure, `gpu-time`. A page has it when both builds' runs timed the GPU, in at least 2 rounds. It fails when the change is more than 25% and more than 0.3 ms, and more than twice its noise. The rule is wide on purpose. The GPU changes its clock with its load, and no comparisons of identical builds have measured GPU time yet. The fault to catch made the GPU's work 5 to 33 times slower. It would have failed #389 by far, and in the replay it failed only one page, a real cost. 0.3 ms keeps a page whose GPU work takes about 1 ms from failing on the clock's steps. On CI the rule decides nothing, as no run there times the GPU. A `Bench-Expected:` trailer can name the measure, as `s4/null3d-webgpu/gpu-time`.
- **The GPU check.** `bun run bench:gpu-check` compares a checkout with a baseline: by default a worktree of its merge base with origin/main, which it builds once per commit. It runs S4 and S6 on WebGPU, at Medium and at High, 3 rounds of 4 s each, in Chrome on the computer's own GPU. These are the pages with the most GPU work: S4's textured materials and S6's city. WebGPU draws with MSAA at Medium and above. The check prints one line, the `GPU-Checked:` trailer: the two commits, the status and each page's GPU times. Its status is `passed`, `failed`, `not measured` (a page with no GPU time from both builds) or `not judged` (the benchmark pages changed between the commits).
- **Before merge.** A pull request that changes `crates/null3d-shaders/src/`, `crates/null3d-shaders/wgsl/`, `crates/null3d-shaders/shaders.toml`, or `packages/engine/src/gpu/`, `render/` or `quality/`, less tests, needs a `GPU-Checked:` trailer. It sits on the last commit that changes such a file, or on a later one, so the check measured the final code. CI cannot run the check, since its machines have no GPU timer. So the trailer is the author's record that the check ran, as `Docs-Checked:` is the record of the docs pass. CI's trailer check fails the pull request only when the trailer is missing or says nothing. It cannot check the figures.
- **Each night.** The quiet-window chain on the owner's Mac runs the check on main against the build of the night before, which it keeps. It writes one line per night for the coordinator. A failed night names the two commits, so the pull request that caused it can be found. Tonight's main becomes tomorrow night's base whatever the result, as CI's benchmark job does with a failed run.

## Consequences

- `bench/lib/compare.ts` judges `gpu-time`. The comparison's summary lists GPU time as table rows, no longer as a line that is "reported and not judged".
- `bench/gpu-check.ts`, `bench/lib/gpu-check.ts` and the `bench:gpu-check` command are new. `tools/hooks/check-gpu-ack.ts` holds the paths and the trailer rule, and `tools/hooks/check-trailers.ts` runs it in CI.
- [Benchmarks](../benchmarks.md#the-benchmark-job-in-ci) gives the GPU rule and its replay. [Pull requests](../pull-requests.md#the-gpu-check) says when the check must run and how to record it. AGENTS.md lists the trailer under "Commit gates".
- The nightly run takes a build of main and the check, on the Mac, in each quiet window. The maintainers' script keeps its base and its log out of git.
- A pull request that changes shaders costs its author one run of the check on a Mac, after both builds. Branches that change those files and were open when this rule merged need the trailer before they merge.
- Phones, tablets and Safari are still not checked for GPU time on each change. Device sessions cover them, as before.
