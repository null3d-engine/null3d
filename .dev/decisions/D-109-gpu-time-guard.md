# D-109: A guard on GPU time: the comparison's GPU rule, a nightly Mac run and a check before landing

Status: decided by the owner, on the coordinator's proposal. Built, with the check in two steps and a shared baseline. Task: M2-J7.

Summary: CI's benchmark job cannot time the GPU, so it passed #389, which made S4 and S6 5 to 33 times slower on the Mac. The build comparison judges GPU time, and fails a page more than 25% and 0.3 ms slower, beyond twice its noise. The Mac runs it on main each night, and a branch that changes how the GPU draws records `bun run bench:gpu-check` in a trailer.

## Question

#389 put a switch in the standard material that picks each map's texture. With 4x MSAA on the Mac's GPU, it makes every textured draw many times slower. No CI check catches such a slowdown: this one stayed on main for 17 hours ([D-89](D-89-webgl2-texture-units.md#the-webgpu-slowdown-from-a-switch-on-the-maps-slot)). How can such a slowdown fail before it reaches main, or soon after?

## Rule

- It must catch a slowdown of the GPU's work as large as #389's, on the GPU that showed it.
- It must not fail comparisons of identical builds, nor fail on the Mac's normal spread between runs.
- It must cost little: no new CI machines, and minutes, not hours, on the Mac.

## Data

What #389 did to the GPU time per frame, in Chrome 155 on the owner's Mac (Apple M5 Max). The medians come from runs of 8 s, in two rounds that alternate the builds ([D-89](D-89-webgl2-texture-units.md#the-webgpu-slowdown-from-a-switch-on-the-maps-slot)):

| Page | With #389, GPU ms | With the fix, GPU ms |
| --- | --- | --- |
| S4, WebGPU, Medium | 30.8, 28.1 | 1.86, 1.97 |
| S4, WebGPU, High | 40.0, 22.9 | 1.82, 1.96 |
| S6, WebGPU, Medium | 28.4, 26.5 | 3.82, 3.93 |
| S6, WebGPU, High | 32.5, 32.0 | 6.17, 6.75 |

What CI's benchmark job saw. Main's run 37644306103 compared 73abc0739 with ef2e6b028, whose commits held #389, on GitHub's Mac machine. It passed:

- None of its 240 runs timed the GPU. Chrome on that virtual machine has no GPU timer.
- S4's CPU times on WebGPU did not change.
- S4 on WebGPU drew a median of 242 frames in a measured run, against the baseline's 267. Its time from a frame's submit to the GPU's finish rose from 27.0 ms to 28.8 ms. The shared GPU holds S4 under 60 frames per second without #389 too, and that time stops growing at about two frames.
- S4 on WebGL2, whose shaders did not change, moved more: from 24.8 ms to 31.9 ms.

The GPU rule was replayed on 14 comparisons that helpers ran on the owner's Mac. 13 of them timed the GPU, on 17 pages in all. Two builds of the same commit, f46c068, differed by 6.5% in S4. One page failed: S4 on WebGPU, 1.27 ms to 1.60 ms, from f46c068 to #309. That was a real cost. #307 found two shadow fixes between those commits, which added 0.11 ms and 0.17 ms to S4's GPU work. Round by round, two builds with the same WebGL2 shaders differed by 2% to 3% in S4 and 3% to 6% in S6. One build's two rounds of S6 at High on WebGPU differed by 9%.

One run of the GPU check compared 061177262, which holds #389, with 0b8b832c3, which holds #434's fix. It ran in Chrome 155 on the owner's Mac and took 14 minutes with both builds. The Mac's 1-minute load was 8.6 at the start and 24 at the end. It printed `GPU-Checked: 061177262..0b8b832c3 passed: s4 medium 6.83 to 2.96 ms (-56.6%); s6 medium 10.24 to 4.93 ms (-55.5%); s4 high 5.15 to 3.92 ms (-24.3%); s6 high 13.57 to 4.59 ms (-66.7%)`. Under that load #389 cost less than in D-89's quiet runs, but every page still showed it. S4 at High counted as "same". Its baseline's rounds ran from 4.46 to 7.71 ms, so the change was less than twice its noise of 13.2%. A check on a loaded Mac can therefore miss a smaller fault. That is why the nightly run waits for the quiet window.

How the data was produced: `bun run bench:run --compare` on the Mac, the records under each worktree's `target/bench/*-compare/runs.json`, judged again with the new rule. CI's figures come from the artifact of run 37644306103.

## Options

- Judge GPU time in CI. Rejected: GitHub's Mac machine has no GPU timer, and its frames and GPU delay moved within their noise. CI's Linux machines draw with SwiftShader, a software GPU. It does not run Apple's shader compiler, whose handling of the switch caused #389's slowdown.
- Judge frames per run or the GPU delay on CI's Mac. Rejected: the shared GPU already held S4 below the display's rate, and S4 on WebGL2 moved more than WebGPU with no change to its shaders.
- A test per known fault, such as the shader crate's test that fails when a WebGPU build of the standard material holds a switch (#434). Kept, but it only stops that one fault from coming back.
- Device runs on every pull request. Rejected: device sessions cost minutes of a person's time or of BrowserStack's, and the owner keeps cloud runs to manual sittings.
- A comparison of GPU time on the Mac, at two points. It runs each night on main, and before merge on the pull requests that can change the GPU's work. Chosen.

## Decision

- **The GPU rule.** `bench/lib/compare.ts` judges GPU time per frame as a third measure, `gpu-time`. A page has it when both builds' runs timed the GPU, in at least 2 rounds. It fails when the change is more than 25% and more than 0.3 ms, and more than twice its noise. The rule is wide on purpose. The GPU changes its clock with its load, and no comparison of identical builds has measured GPU time yet. The fault to catch made the GPU's work 5 to 33 times slower. It would have failed #389 by far, and in the replay it failed only one page, a real cost. 0.3 ms keeps a page whose GPU work takes about 1 ms from failing on the clock's steps. On CI the rule decides nothing, as no run there times the GPU. A `Bench-Expected:` trailer can name the measure, as `s4/null3d-webgpu/gpu-time`.
- **The GPU check.** `bun run bench:gpu-check` compares a checkout with a baseline. By default that is a prepared build of its merge base with origin/main. Every copy of the repository shares the cache of such builds ([Two steps and a shared baseline](#two-steps-and-a-shared-baseline)). It runs S4 and S6 on WebGPU, at Medium and at High, 3 rounds of 4 s each, in Chrome on the computer's own GPU. These are the pages with the most GPU work: S4's textured materials and S6's city. WebGPU draws with MSAA at Medium and above. The check prints one line, the `GPU-Checked:` trailer: the two commits, the status and each page's GPU times. Its status is `passed`, `failed`, `not measured` (a page with no GPU time from both builds) or `not judged` (the benchmark pages changed between the commits).
- **Before landing.** A branch that changes `crates/null3d-shaders/src/`, `crates/null3d-shaders/wgsl/`, `crates/null3d-shaders/shaders.toml`, or `packages/engine/src/gpu/`, `render/` or `quality/`, less tests, needs a `GPU-Checked:` trailer. The trailer check reads it from every commit of the range except merges, so it may go on any of them. One measurement of the branch's build answers for the whole range. So run the check once the code is final. Run it again after a later change to those files, so that the line measures the code that lands. CI cannot run the check, since its machines have no GPU timer. So the trailer is the author's record that the check ran, as `Docs-Checked:` is the record of the docs pass. The trailer check fails a range only when the trailer is missing or says nothing. It cannot check the figures.
- **Each night.** The quiet-window chain on the owner's Mac runs the check on main against the build of the night before, which it keeps. It writes one line per night for the coordinator. A failed night names the two commits, so the pull request that caused it can be found. Each night's main becomes the next night's base whatever the result, as CI's benchmark job does with a failed run.

## Consequences

- `bench/lib/compare.ts` judges `gpu-time`. The comparison's summary lists GPU time as table rows.
- `bench/gpu-check.ts`, `bench/lib/gpu-check.ts` and the `bench:gpu-check` command hold the check. `tools/hooks/check-gpu-ack.ts` holds the paths and the trailer rule, and `tools/hooks/check-trailers.ts` runs it in CI.
- [Benchmarks](../benchmarks.md#the-benchmark-job-in-ci) gives the GPU rule and its replay. [Branches and parallel work](../pull-requests.md#the-gpu-check) says when the check must run and how to record it. AGENTS.md lists the trailer under "Commit gates".
- The nightly run takes a build of main and the check, on the Mac, in each quiet window. The maintainers' script keeps its base and its log out of git.
- A branch that changes shaders costs its author one run of the check on a Mac, after both builds.
- Phones, tablets and Safari are not checked for GPU time on each change. Device sessions cover them.

## Two steps and a shared baseline

Helpers queue each check as a timing run, which holds the Mac alone, so a long check makes the others wait. Checks waited up to 45 minutes for their turn. The coordinator asked for a shorter quiet window per check.

A check in one step spends most of its window on builds. Each of the two presets builds both checkouts' benchmark pages with Vite, about 20 s each, so 4 page builds per check. A new copy of the repository also builds its own worktree of main's merge base beside the checkout, with `bun install` and a full Rust build. Logged windows of such checks took 14.3 minutes, 5.4 of them for the builds. Another took 9 minutes with a new base, and 6.6 minutes with a base that built only the changes. A recheck with nothing to build took 3.7 minutes. 14 such base worktrees sat beside the helpers' checkouts, 1.3 GB each, for 8 distinct commits.

The timing itself cannot get shorter without a looser check. 3 rounds is the fewest that the comparison rules judge, and the run and warm-up times are part of the noise work on S6.

Decision:

- The check has two steps. `--prepare` builds everything with the CPU only: the checkout, its pages and the baseline. `--measure` builds nothing and only times. It fails when a build it needs is missing or older than its sources, and names the step to run. With neither option, the check runs both. Helpers run `--prepare` in the CPU lane and only `--measure` as a timing run.
- The baseline is a prepared build of the merge base's pages, in one cache that every copy of the repository on the computer shares: `~/.cache/null3d/gpu-check-baselines/<commit>`. One builder worktree in the cache builds each new commit of main in turn, so it rebuilds only what changed. A lock lets one check build at a time. The cache keeps the 6 baselines used last, and never removes one used in the last 2 hours.
- A comparison keeps each checkout's build of the pages with a stamp of its sources, and builds it again only when they change. So the two presets build the pages once, and in `--prepare`, before the window.

Results, on the owner's Mac in Chrome 155:

- `--measure` held the quiet window for 3.75 minutes (225 s), at a 1-minute load of 4.2 to 5.3. It built nothing. It printed `GPU-Checked: bdcfa752a..dd17d4afb passed: s4 medium 3.94 to 3.96 ms (+0.7%); s6 medium 4.72 to 4.72 ms (-0.0%); s4 high 3.94 to 3.95 ms (+0.3%); s6 high 4.95 to 4.91 ms (-0.9%)`.
- The check in one step holds the window for 6.6 to 14.3 minutes in the logs above.
- A `--prepare` with an empty cache took 30 minutes in the CPU lane, at background priority and a load of 12 to 14. Its builder worktree installed and built main from nothing. A later check on the same commit of main finds the baseline in the cache and builds only its own checkout and pages. A new commit of main rebuilds only what changed in the builder.
- The cache held 127 MB for the baseline and 1.4 GB for the builder worktree. One builder replaces a 1.3 GB base worktree per copy of the repository.
