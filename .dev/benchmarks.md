# Benchmarks

This guide covers how to run the benchmarks and read their numbers. [AGENTS.md](../AGENTS.md) lists the commands, and [Device sessions](devices.md) covers phones and tablets.

The benchmarks compare null3D with three.js in the same browser. These points come from the first checkpoint's measurements.

## Production builds

The benchmarks measure the engine as developers ship it. A production build leaves out the engine's development checks, such as the handle and argument checks, so the benchmarks leave them out too.

- `bench/vite.pages.config.ts` builds every benchmark page for production: null3D's pages, three.js's pages and the scene-code pages. The development checks are off, and Vite minifies as it does in any production build. So three.js runs minified too, as it ships.
- `bun run bench:run`, `bun run bench:profile`, `bun run bench:allocation` and `bun run bench:soak` build the pages into `target/bench-pages` before each run. `vite preview` serves the build on the preview port, the dev server's port plus 2.
- `--dev` runs the dev server's pages instead, where the engine runs its development checks. Run the same pages with and without it to see what the checks cost.
- `bun run test:bench` checks the production build, as the benchmarks run it. The image test manifest and `bun run parity` still load the dev server's pages.
- The device runner's bench and scale plans load the production build through the dev server's load routes. [Device sessions](devices.md#benchmark-runs) says how.
- The build keeps hidden source maps beside its files, and the built files stay as a production build writes them. The profile and the allocation check read the maps to name each function and its source file, as the dev server's pages would.
- DEVCOST_PLACEHOLDER [D-06](decisions/D-06-success-targets.md) gives the numbers of each scene.

## What a report measures

- A report gives each engine's whole frame and its own work on the busiest thread. The desktop target uses own work, because both engines run the same scene code.
- null3D's own work comes from its phase timers: each thread's time less its `update` step. three.js's own work is its frame time less the scene code, timed alone on the scene-code page.
- The scene-code page's loop compiles to slower code than an engine's loop, so this estimate of three.js's own work is low.
- Compare results at the same display refresh rate. The engine measures it, and each result records it with the presented and finished frame rates and the GPU delay. Runs at 120 and at 144 frames per second differed by about 10% for both engines.
- The page switch `?fps=<n>` holds null3D's drawing at n frames per second, at most the display's rate. Use it to compare runs on displays of different rates. The three.js pages do not read it.
- On WebGL2, `measure` reports `visibleEntries`, the entries in each frame's list of visible objects, and the bench summary divides the upload by it. When only the camera moves, as in S1-static, the upload is about 4 bytes per entry.

## The benchmark job in CI

- The Benchmarks workflow compares a new commit with a baseline on one of GitHub's machines. On main it runs one job at a time, so it leaves GitHub's other Mac machines to the pull requests' Safari and Firefox checks.
- A push to main waits while a job runs, and a newer push replaces the job that waits. So the baseline of a push is the last commit on main that a job measured with success, which `bench/ci-baseline.ts` finds. The next job then measures the change of every push that got no job.
- Without such a commit, the baseline is the commit before. After a failed job, the next job still compares with the last commit that passed. Main's job then fails until a commit fixes the slowdown or names it in a `Bench-Expected:` trailer.
- For a pull request it runs on demand, against the pull request's merge base. Add the `benchmark` label, and each push runs it again while the label stays. You can also start the workflow from the Actions tab with a pull request's number, a branch or a commit.
- GitHub's machines are shared, and their speed changes from run to run. So the job judges a new commit only against a baseline measured in the same job. It builds both commits on one machine, each in a git worktree of its own, with `bun run build`.
- It then runs `bun run bench:run --compare <baseline>,<new>` in Chrome. The command builds each commit's benchmark pages for production, into `target/bench-pages-baseline` and `target/bench-pages-new`, and serves each build on a port of its own.
- A commit from before `bench/vite.pages.config.ts` existed has its pages built with the new commit's config.
- S1, S1-static and S2 run on null3D's two GPU paths. The job runs 10 rounds. Each round runs every page once in each build, the two runs back to back, and even rounds run the new build first. Each run has 5 s of warm-up and 5 s measured.
- It drops a run that measured no frames, and a run that measured another refresh rate than most runs of its page did.
- Each run gives two medians of CPU time per frame: the busiest thread's time, and the engine's own work on that thread. For each page and measure, the job divides the new build's median by the baseline's in each round. The change is the median of these ratios. A machine that changes speed between rounds then changes both runs of a round alike.
- The job fails when the busiest thread's change is more than 5% and more than 0.01 ms. It also fails when own work's change is more than 15% and more than 0.02 ms. The browser's timer counts in steps of 5 microseconds, so a small time moves by whole steps between runs.
- A pull request that makes a benchmark more than 3% slower still needs its written reason (hard rule 17). One job cannot tell such a change from the machine's noise, but its table shows every change.
- The job runs on GitHub's Mac machine (`macos-15`, 3 cores of an Apple M1 in a virtual machine). Its GPU is shared with other machines, so the job reports GPU time but never judges it. Device sessions measure the GPU.
- A job takes about 25 minutes: 3 minutes to set up, 3 to build both commits and 20 to run the pages.
- The summary goes to the run's page. Each run's result, `summary.json` and `summary.md` stay in an artifact for 90 days, so the workflow's list of runs holds the history.

### How the machine and the rules were chosen

On 30 September 2026, jobs compared two builds of identical engine code, so every change they measured was noise.

- On the Linux machine, the software GPU drew S1 and S1-static at under one frame per second. A run of 10 s measured 5 to 7 frames, and the software GPU took the processor from the engine's threads. Identical builds differed by up to 29% in own work. The job also dropped every run of S2, whose refresh rate varied from 20 to 30 Hz.
- The Mac machine kept every run at 60 Hz, but its speed changed often. The same scene code took 3.4 to 5.4 ms per frame in runs 20 seconds apart. So the job compares the builds round by round. The builds' plain medians differed by up to 22% on identical builds.
- Six jobs on the Mac ran 5 rounds of 10 s, 10 rounds of 5 s or 15 rounds of 3 s each. Round by round, the largest slowdowns of identical builds were +4.7% for the busiest thread and +12.0% for own work, both in S1. In S1-static and S2 the largest was 0.012 ms. Shorter runs gave noisier rounds, and 10 rounds of 5 s gave the least noise for the time.
- Own work is the busiest thread's time less the scene's update: a small difference of two larger times. In S1 it also waits for a job worker, whose timing varies on 3 cores. Both make own work noisier, so its rule is wider.
- The busiest thread's rule is the smallest tested that none of the six jobs broke: 3% failed three jobs, and 4% failed two. For own work, 10% failed two jobs and 12% one. Its rule of 15% keeps 3 points above the largest slowdown.
- More rounds narrow the noise only slowly. A job of 20 rounds would take about 45 minutes, and its medians would still wander by about 2%.

### Mark an expected slowdown

A commit that makes a benchmark slower on purpose names the change and gives the reason in a `Bench-Expected:` trailer:

```text
Bench-Expected: s1/null3d-webgl2: the batch pass now writes normals, about 0.1 ms per frame
```

- Before the colon, name the benchmarks: a scene, then a page and a measure if needed. For example `s1`, `s1/null3d-webgl2` or `s1/null3d-webgl2/own-work`. The measures are `busiest-thread` and `own-work`. A `*` stands for any part, and a comma separates two benchmarks.
- After the colon, give the reason. A bare value such as "yes" does not count.
- The job reads the trailers of every commit from the baseline to the new commit. A squash merge keeps them, because main's squash messages list each commit's message.
- A trailer that does not parse excuses nothing, and the summary lists it.

### Run a comparison on your computer

Build two checkouts, such as a git worktree of main beside your branch, with `bun run build` in each. Then run `bun run bench:run --compare ../main,. --runs 10 --seconds 5`, the job's settings. The baseline's pages are served on the port that `NULL3D_PORT` names, and the new build's pages on the next one. With `--dev`, each checkout's dev server takes its port instead.

## Hold frames

- A benchmark page with `?hold` draws one frame at the scene's hold time, 2 seconds, and publishes its pixels. `?hold=<seconds>` holds at another time.
- The image test manifest compares null3D's hold frames with their references. `bun run parity` and the device runner's parity plan compare them with three.js's frames. The benchmark page tests check that three.js's frames show the scene.
- The null3D pages start the engine in hold mode with that time. The engine steps the sketch from 0 to the time at 60 steps per second, then draws that one frame and reads it back. The sketches pose their scene at `time.now`, and hold no time of their own.
- The three.js pages pose their scene at the hold time and draw one frame into a render target, which they read back. The scenes are functions of time, so both engines draw the same moment.
- Before it draws, a hold at 2 seconds runs 121 frames of the scene's update and the engine's steps. S1's hold page on the Mac takes about 0.6 seconds with 100,000 instances.

## Runs on phones and tablets

- Phones and tablets run the benchmarks through the device runner. First find the device's scale with the `scale` plan. Then `--plan bench --n <count>` runs the protocol at that count, with five runs of each page. The pages take turns run by run.
- Both plans load the production build of the benchmark pages, as the tools on the Mac do.
- The bench plan runs S1 on its usual pages. `--pages` and `--scenes` pick others. For example, to compare two null3D paths on a phone: `bun tests/real-browsers.ts --plan bench --allow-no-webgpu --android chrome --scenes s1-static,s2 --pages null3d-webgl2,null3d-webgl2-low`.
- `--seconds <n>` sets each bench page's warm-up and measured time, n seconds each. For the protocol's 10-minute sustained run on a phone, use `--seconds 300`: 5 minutes of warm-up, then 5 measured.

## Sweeps for the open defaults

Three sweeps measure the defaults that are still open: the latency mode, the job worker count and the shared memory's maximum. Each runs on the Mac, and on a phone or an iPad through the device runner.

- The page kinds that end in `-low` run null3D in low-latency mode, and the bench plan runs them beside the pipelined pages. On the Mac, run `bun run bench:run --pages null3d-webgpu,null3d-webgpu-low,null3d-webgl2,null3d-webgl2-low`. Compare the presented frame rate, the 95th and 99th percentiles of the frame interval, and the busiest thread. In low-latency mode the sketch worker draws, so its time includes the drawing.
- The page switch `?jobs=<n>` starts n job workers. On the Mac, `bun run bench:run --jobs 1,2,4,8,16` runs null3D's two GPU paths at each count. On a phone, add the counts to the bench plan: `bun tests/real-browsers.ts --plan bench --allow-no-webgpu --android chrome --n 300000 --jobs 2,4,6,8`. The summary gives each count's frame time, busiest thread and the sketch worker's own work. A run whose engine started another count fails.
- The page switch `?memory=<MiB>` sets the shared memory's maximum, up to the 4096 MiB that the engine core declares. It wins over the `memory` option of `createEngine`. The `memory` plan loads the engine test page 20 times at each maximum from 256 to 4096 MiB. It names the largest maximum that loaded every time. A failed allocation counts as a failed load, and `--runs <n>` changes the number of loads.
- Before the loads at each maximum, the memory plan counts how many shared memories with that maximum fit at once. That is how many engines a page can hold. `--runs 0` runs only these counts.

## Download size

- The size report builds the engine test page for production with hidden source maps, which leave the built files unchanged. Vite names each file after a module and adds a hash. The report therefore names each file of the engine's JavaScript by the engine module that it holds. The list of parts is `ENGINE_PARTS` in `tools/lib/size-report.ts`. A new file of engine code fails the report until the list names it.
- `bun run build:check-size` compares each file's size after Brotli with a build of a base commit. The base is main's own build. The repository keeps no size record, so pull requests cannot conflict over one.
- The base is HEAD's merge base with main. CI tests a pull request as GitHub's merge of it into main, so the base there is the main commit that it merged into. A push to main compares with the commit before. `--base <ref>` picks another commit.
- The check builds the base in a git worktree, `target/.size-base/tree`, with the base's own build script. The base therefore keeps its own flags, toolchain and list of parts. The script's `--sizes-only` builds only what the report measures, without the shader compiler, and writes the sizes.
- The check keeps the sizes of each base commit in `target/.size-base/<commit>.json` and reuses them. Locally it fetches main first. For a new base commit, the check rebuilds only what changed in the worktree.
- The folder is hidden because `bun test` runs the tests of any git checkout inside a folder that is not hidden, even an ignored one.
- The check copies this checkout's Rust build folders, with their file times, into a new worktree. Cargo then compiles only the engine's own crates. Never share one Rust build folder between two checkouts. Cargo finds the engine's crates at the same paths in both, and judges them fresh by file times. The next build of one checkout can then take the other's crates.
- A file that grows more than 2% after Brotli fails the check, and so does a new file. A `Size-Growth:` trailer on a commit after the base explains the growth. It names each file as the report prints it and gives the reason. The squash merge copies the trailers into main's commit, so keep them when you edit a squash message.
- The check prints each file's growth in the log, and CI adds the table to the job summary. A base from before this check keeps its sizes in `tools/size-baseline.json`, and the check reads them after that base's own build rewrites the file.
- On GitHub's Linux machines, the base build takes about 28 s, because it compiles only the engine's own crates and builds no shader compiler. On a MacBook Pro, the first local run took 21 s, and the base build took 12 s of that. A later run with the same base took 14 s, against 8 s for `bun run build`, and the fetch of main took most of the difference. The times are from 30 September 2026.

## Startup

- `bun run bench:startup` times the start of the engine test page in Chrome, from navigation to the first frame. It builds the page for production, serves it with `vite preview`, and drives Chrome through its debugging protocol.
- Without options it times what it always has: three cold loads in the pipelined mode, on WebGPU and Slow 4G. Each cold load gets a fresh Chrome profile, so even the GPU shaders compile from scratch.
- `--loads cold,warm` adds warm loads, `--network slow-4g,full` adds loads at full speed, and `--modes all` runs every thread mode. `--runs`, `--gpu` and `--switches` work as before.
- `--android` drives Chrome on the phone instead. It makes five loads of each kind, in every thread mode, cold and warm, on both networks. [Device sessions](devices.md#startup-times) says how cold loads avoid the phone's caches without clearing them.
- Chrome refuses network limits on a worker. It applies the page's limit to a worker's own requests only once the debugging protocol's Network domain is on in that worker. So on Slow 4G the tool attaches to each worker, which waits at its start until the domain is on.
- Without that step, the workers would load the core's loader and the sketch at full speed. The first frame would then come about a second early.
- On Slow 4G the start is a chain of round trips of at least 562 ms each. After the page and its script come the core and the probe worker, then the other workers. Then the workers load the core's loader, and then the sketch.
- In single-threaded mode the sketch downloads with the core. The page asks for the core's loader and the renderer once the core has compiled, and both take about one round trip.
- The engine starts its workers only once the core has compiled. On Slow 4G their scripts and imports therefore add two round trips after the core.
- The MacBook Pro was measured in Chrome 154 on 30 September 2026. A cold load in the pipelined mode finished its first frame after 4.0 s on Slow 4G. A warm load took 0.7 s, and both took about 0.1 s at full speed.

## Soak

- `bun run bench:soak` runs the production build, and samples every 30 seconds. Before each sample, the page, the sketch worker and the render worker collect their garbage, so a sample counts only what they keep.
- While the engine runs, a job worker blocks inside the job system's loop, so it never runs a collection that the debugger asks for. The soak reads its heap as it is, garbage included.
- The WebAssembly memory's size comes from `Runtime.queryObjects` on the page, because the engine keeps the memory out of the page's global scope.
- The soak judges the run after a 2-minute warm-up. The sketch worker's and the render worker's heaps may each grow by 256 KB. The growth is the median of the last three samples less the median of the first three.
- The WebAssembly memory may not grow at all, and the engine must still draw at the end.

## Allocation and profiling

- `bun run bench:allocation` samples allocations after a warm-up of at least 30 seconds and 3,600 frames. The browser optimizes code that runs once per frame only after thousands of frames, so a display at 60 Hz takes a minute.
- While it warms up and samples, the check moves the mouse over the canvas and presses a key and the mouse button. So the sample covers the sketch's reading of input, and that code is warm when the sample starts.
- Places that allocate because the browser does have budgets with their reasons in `bench/allocation.ts`. Every other place must stay under 4 bytes per frame. Add `--n 30000` to include the staging ring.
- The check samples the production build. The build's source maps give each place its function and file, so one set of budgets holds for the build and for `--dev`. With `--dev`, the development checks allocate a little more on the sketch worker, which a budget allows.
- `bun run bench:profile` shows where the render worker's replay spends its time. A browser call costs the same from any language. The engine's own share of the replay is therefore the most that a replay loop in another language could save.
- The profile samples the production build, and names its functions through the build's source maps. With `--dev`, it profiles the dev server's pages, whose development checks then count in the engine's share.
- The profiler samples every 50 microseconds after a 20-second warm-up. Code the browser has not optimized yet counts as the engine's, so a shorter warm-up overstates the engine's share.
- `--thread sketch` samples the sketch worker's frame step instead, and splits it between the engine's code, the engine core and the browser. It also lists the engine's per-frame phase times on that thread, such as the update and the batch pass.
- The shipped core has no function names. Build it with `bun tools/build-wasm.ts --names` before a profile, so the profile names the core's functions. The names add size, so that build skips the size checks: build again without it before you check sizes.
- Chrome's page-wide memory measurement waits up to a minute for the job workers, and it counts shared memory once per worker. Chrome's debugger gives exact heaps per worker through `Runtime.getHeapUsage`.

## GPU time per pass

- On WebGPU, `measure` returns `gpuPassMs` beside `gpuMs`: the copies before the frame's first pass, each pass, and the time between passes. The bench plan's results keep it in each result's stats.
- In Chrome, the time between the culling pass and the main pass is Chrome's own check of the indirect draws. At 240,000 boxes it takes about 0.1 to 0.3 ms.
- The timestamps cover only the GPU passes. Work that the browser does outside them shows in `gpuLatencyMs` and in the frame rate, as [Safari's frame path](implementation-notes.md#safaris-frame-path) describes.

## Safari's own work

Safari runs WebGPU in its GPU process, `com.apple.WebKit.GPU`, and no engine timer sees the work it does there. Instruments shows it. With Xcode installed, run these while a benchmark page runs in Safari with `?demo`:

```sh
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
xcrun xctrace record --template 'Metal System Trace' --all-processes --time-limit 3s --output metal.trace
xcrun xctrace record --template 'Time Profiler' --attach <pid> --time-limit 4s --output safari-gpu.trace
xcrun xctrace export --input metal.trace --toc
```

- The Metal trace names the GPU process's id. Other apps that embed WebKit have GPU processes of their own, so `pgrep -fl com.apple.WebKit.GPU` can list several.
- Export a table with `--xpath '/trace-toc/run[@number="1"]/data/table[@schema="<name>"]'`. `metal-gpu-intervals` gives each encoder's GPU time. `metal-application-command-buffer-submissions` gives each command buffer's time from creation to commit. `time-profile` holds the CPU samples.
- In S1-static at 240,000 boxes, the Metal trace showed about 1.5 ms of GPU work per frame. The profile showed Safari's GPU process spending 9.6 ms of CPU per frame on a native render bundle, which the engine no longer makes.
