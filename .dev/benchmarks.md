# Benchmarks

This guide covers how to run the benchmarks and read their numbers. [AGENTS.md](../AGENTS.md) lists the commands, and [Device sessions](devices.md) covers phones and tablets.

The benchmarks compare null3D with three.js in the same browser. These points come from the first checkpoint's measurements.

A comparison measures equal work: the same scene content and comparable quality settings ([D-52](decisions/D-52-intent-parity.md)). Each engine may draw an effect with its own technique. Where the two images differ by design, the report gives a quality note beside the timings.

## Production builds

The benchmarks measure the engine as developers ship it. A production build leaves out the engine's development checks, such as the handle and argument checks, so the benchmarks leave them out too.

- `bench/vite.pages.config.ts` builds every benchmark page for production: null3D's pages, three.js's pages and the scene-code pages. The development checks are off, and Vite minifies as it does in any production build. So three.js runs minified too, as it ships.
- `bun run bench:run`, `bun run bench:profile`, `bun run bench:allocation` and `bun run bench:soak` build the pages into `target/bench-pages` before each run. `vite preview` serves the build on the preview port, the dev server's port plus 2.
- `--dev` runs the dev server's pages instead, where the engine runs its development checks. Run the same pages with and without it to see what the checks cost.
- `bun run test:bench` checks the production build, as the benchmarks run it. The image test manifest and `bun run parity` still load the dev server's pages. So does null3D's side of each feature scene's [parity test](image-tests.md#parity-with-threejs), so `bun run test:bench` starts the dev server too.
- CI runs `bun run test:bench` on SwiftShader in two shards, the `bench` jobs, with the WebAssembly files that its `build` job built once. Each test of `bench/tests/pages.spec.ts` opens a page of its own, so the file runs its tests in parallel, and Playwright can split it between shards. S4's tests are the exception: they run in order in one worker. S4 keeps SwiftShader's processor busy, and two S4 runs side by side once measured no whole second, so the trace came back empty.
- A short run must measure for more than two frames at the page's slowest rate. The engine's `measure` counts a frame only when the sketch stepped it and the renderer drew it inside the measured time. The renderer draws each frame about one frame after its step. Merge queue run 37104979684 on 3 October 2026 shows the risk. There, SwiftShader drew S2 with two cascades on WebGPU at 2.4 frames a second. Its window of 1 second presented a frame but counted none. The test had passed in all 247 earlier `bench` jobs. Its runs now last 2 seconds, as the other short runs of S2 do.
- The device runner's bench and scale plans load the production build through the dev server's load routes. [Device sessions](devices.md#benchmark-runs) says how.
- The build keeps hidden source maps beside its files, and the built files stay as a production build writes them. The profile and the allocation check read the maps to name each function and its source file, as the dev server's pages would.

## What a report measures

- A report gives each engine's whole frame and its own work on the busiest thread. The desktop target uses own work, because both engines run the same scene code.
- null3D's own work comes from its phase timers: each thread's time less its `update` step. three.js's own work is its frame time less the scene code, timed alone on the scene-code page.
- The scene-code page's loop compiles to slower code than an engine's loop, so this estimate of three.js's own work is low.
- Compare results at the same display refresh rate. The engine measures it, and each result records it with the presented and finished frame rates and the GPU delay. Runs at 120 and at 144 frames per second differed by about 10% for both engines.
- The page switch `?fps=<n>` holds null3D's drawing at n frames per second, at most the display's rate. Use it to compare runs on displays of different rates. The three.js pages do not read it.
- On WebGL2, `measure` reports `visibleEntries`, the entries in each frame's list of visible objects, and the bench summary divides the upload by it. When only the camera moves, as in S1-static, the upload is about 4 bytes per entry.
- null3D's benchmark pages start the warm-up when the GPU finishes the first frame. On a first visit, `createEngine` resolves only after the preset check, which runs after the first frame. A later start in the same browser takes the check's stored result, and `createEngine` resolves before the first frame. Runs on phones and tablets keep the browser's storage, so without the wait their warm-up would shrink by the time to the first frame. Playwright gives each benchmark run on the Mac fresh storage, so those runs check the preset each time.
- `packages/cli/src/protocol.js` holds the protocol's warm-up, measured time and run count. It also holds the timed run of a null3D page, and the median and spread of runs. The command-line tool's `bench` command runs the same protocol on a project's page, so a change there changes both.

## The benchmark job in CI

- The Benchmarks workflow compares a new commit with a baseline on GitHub's machines. On main it runs one run at a time, so it leaves GitHub's other Mac machines to pull requests and the merge queue.
- A push to main waits while a run goes on, and a newer push replaces the run that waits. So the baseline of a push is the last commit on main that a run measured, which `bench/ci-baseline.ts` finds. The next run then measures the change of every push that got no run. The commit before would leave those changes unmeasured.
- A run measured its commit when the report's step `Merge the shards into one comparison` passed, whether the verdict then passed or failed. A cancelled run, a run whose builds failed and a run whose shards left a page out measured nothing, and the next run skips them.
- A failed verdict counts too, so a slowdown fails the one run that holds it. The next run compares with that commit and judges only the changes after it. Until 3 October 2026, only a run that passed counted. One false alarm then kept the baseline on an old commit, and every later run compared with it. Main's run failed 7 times in a row on S1 WebGL2. The owner's Mac measured no change between those commits.
- Without such a commit, the baseline is the commit before.
- Each build runs its own commit's benchmark pages: `bench/pages` and `bench/scenes`, less their tests. The commits from the baseline to the new commit can change those pages or the comparison's switches. Then the two builds measure in different ways, and the summary says **Measurement changed**. It names the change and lists the pages that would fail as not judged. The run passes, and the next run on main compares with its commit. After #217, the new pages took a fixed preset and the baseline's pages chose their own. The next run failed on that alone.
- For a pull request it runs on demand, against the pull request's merge base. Add the `benchmark` label, and each push runs it again while the label stays. You can also start the workflow from the Actions tab with a pull request's number, a branch or a commit.
- GitHub's machines are shared, and their speed changes from run to run. So each Mac machine runs the pages of both commits. A page's new build is judged only against the baseline that ran on the same machine.
- The workflow has four kinds of jobs:
  - `choose the commits` picks the baseline and the new commit.
  - `build (baseline)` and `build (new)` each build one commit on a Linux machine, with that commit's `bun run build`. That build also makes the commit's shader modules, unless the commit keeps them in git. The built files are the same on every platform, so each job packs them into an artifact.
  - The `benchmark (shard i of 3)` jobs run on Mac machines. Each one makes a git worktree of each commit, unpacks its build there, and runs `bun run bench:run --compare <baseline>,<new> --shard i/3` in Chrome. The command builds each commit's benchmark pages for production, into `target/bench-pages-baseline` and `target/bench-pages-new`, and serves each build on a port of its own. The shards need no Rust toolchain, because `vite preview` does not build the shader modules that a dev server needs.
  - `benchmark report` downloads the record of each shard, `runs.json`, and runs `bun run bench:run --merge`. It judges every page as one comparison would, with the same rules and the same trailers, and writes the verdict to `summary.json`. The step `Judge the new build` then fails when the verdict does. Its summary and artifact are the run's result.
- A commit from before `bench/vite.pages.config.ts` existed has its pages built with the new commit's config.
- S1, S1-static, S1-cells, S2, S3 and S4 run on null3D's two GPU paths. Each scene on each path is one page, so the plan has 12 pages. A shard runs every third page, from its own place in the plan. So each shard runs 4 pages of 3 or 4 scenes.
- A scene that one of the two commits has no page for runs in neither. So a pull request that adds a benchmark is compared on the other scenes.
- Each shard runs 10 rounds. Each round runs every page of the shard once in each build, the two runs back to back. Even rounds run the new build first. Each run has 5 s of warm-up and 5 s measured.
- Every page of a comparison runs with `?preset=high&governor=off`, unless `--switches` names either switch. Both builds then draw the same work in every run:
  - Without a named preset, the engine chooses one and checks it with the first frames' rate. On the shared Mac, a slow moment during that check lowers the preset in one run and not in the next. Run 37013358376 for #198 on 2 October 2026 drew 42 of its 240 runs below the desktop's preset. In two rounds of S2 on WebGL2, the baseline drew at Low and the new build at Medium. One of them gave the page's lowest ratio, 0.57.
  - The preset explains only part of that run's noise. S2's highest ratio on WebGL2, 2.16, came from a round in which both builds drew at Medium. S2's times there were 0.2 to 0.5 ms per frame, so a short stall moves a round's ratio far.
  - High is the preset that a desktop gets, within each GPU path's ceiling, so WebGL2 draws at Medium. A named preset also skips the check and the crash marker. Low was rejected, because it would measure less work than a desktop draws.
  - The quality governor is off in every scene but S4, whose sketch turns it on. `?governor=off` keeps it off there too. A governor step during the measured seconds would change what the rest of that run draws. Dropping such runs was rejected: a slower build takes more steps, so its runs would be the ones dropped.
  - Dropping the rounds whose builds drew at different presets was rejected too. It would discard runs, and could leave a page with too few rounds to compare.
- The summary gives the preset of each page. A page whose runs drew at different presets gets a list of each round's preset in each build. It also gives the quality steps in the measured seconds of S4, the page that records a trace. Each run's preset and steps stay in `summary.json`, under `quality`.
- A baseline from before the governor switch draws S4 with the governor on. The summary's steps show whether it stepped.
- The comparison drops a run that measured no frames, and a run that measured another refresh rate than most runs of its page did.
- Each run's engine chooses its own preset, with the preset check, and the pages do not fix it. On a busy CI Mac, the two builds of one round can choose different presets. In one pull request's run, S2's WebGL2 ratios ran from 0.57 to 2.16 for that reason, with no change to S2's code path. Three runs of 10 rounds on a MacBook Pro then measured that page at -9.1%, -2.5% and -9.5%. Read a page whose ratios swing that far as noise, and measure it again.
- Each run gives two medians of CPU time per frame: the busiest thread's time, and the engine's own work on that thread. For each page and measure, the comparison divides the new build's median by the baseline's in each round. The change is the median of these ratios. A machine that changes speed between rounds then changes both runs of a round alike.
- A page fails when the busiest thread's change is more than 5% and more than 0.01 ms. It also fails when own work's change is more than 15% and more than 0.02 ms. The browser's timer counts in steps of 5 microseconds, so a small time moves by whole steps between runs.
- A shard fails when one of its own pages fails, and the report fails when any page fails. Each shard's page shows the summary of its own pages, and the report's page shows them all.
- To measure a shard again, open the run and use "Re-run failed jobs". GitHub then runs the failed shards and the report again, with the same commits and the same builds. The shards that passed keep their records, and a shard that runs again replaces its own.
- The report also fails when no record holds a page of the plan, such as after a shard ran out of time. Its log names the missing pages.
- A pull request that makes a benchmark more than 3% slower still needs its written reason (hard rule 17). One run cannot tell such a change from the machine's noise, but its table shows every change.
- The shards run on GitHub's Mac machine (`macos-15`, 3 cores of an Apple M1 in a virtual machine). Its GPU is shared with other machines, so the comparison reports GPU time but never judges it. Device sessions measure the GPU.
- On 2 October 2026, each run took about 12 s with its load. A shard's 80 runs then take about 16 minutes, after about a minute to set up. The Linux builds come first. A shard's limit is 30 minutes.
- GitHub's free plan gives 5 Mac machines at once, and the merge queue's Safari and Firefox jobs need 4 of them. Main's run holds 3 machines after each merge. Shards of one page each would take about 5 minutes. But 12 of them would need more Mac machines than GitHub gives, so the run would not end sooner. To change the count, change the shard list in `.github/workflows/bench.yml`. The job names and the `--shard` option follow the list.
- The workflow is not a check that the merge queue waits for.
- Each shard's results stay in an artifact for 30 days, the time in which GitHub lets a run's jobs run again. The report's artifact holds every shard's results, `summary.json` and `summary.md` for 90 days, so the workflow's list of runs holds the history.

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
- The comparison reads the trailers of every commit from the baseline to the new commit. A squash merge keeps them, because main's squash messages list each commit's message.
- A trailer that does not parse excuses nothing, and the summary lists it.

### Run a comparison on your computer

Build two checkouts, such as a git worktree of main beside your branch, with `bun run build` in each. Then run `bun run bench:run --compare ../main,. --runs 10 --seconds 5`, the job's settings. The baseline's pages are served on the port that `NULL3D_PORT` names, and the new build's pages on the next one. With `--dev`, each checkout's dev server takes its port instead.

Add `--shard 2/3` to run only the pages of one shard, as a CI shard does. Each run writes its record to `runs.json` beside its summary. `bun run bench:run --merge <folder>` judges the records under a folder as one comparison, as the report job does. It needs no browser, and fails only when the records miss a page: the verdict is in `summary.json`.

## Visual figures and captured frames

A change can make a scene faster and make it look worse, such as a smaller shadow map. So the device runner's bench plan measures how each scene looks, beside its timings. It also keeps frames for people to look at.

- After the timed runs, the bench plan runs the visual page of each scene on each GPU path of its null3D pages. Each item has the name `visual-<scene>-<path>`. [Image tests](image-tests.md#visual-checks) says what the page measures, and why. The page loads from the dev server, because only development builds draw debug views. It runs after every timed page, so it changes no timing.
- The page draws the desktop's preset, `?preset=high`, as the image tests do. Each scene's limits come from that preset's shadow settings, so every device measures the same settings.
- The bench summary prints two columns beside the GPU time of each null3D page. The first is the share of pixels whose shadow changed between frames. The second is the shadow edge offset in pixels. A figure over its scene's limit reads `OVER` and the limit, and the visual item fails. A scene without limits, such as S1, whose sun casts no shadows, prints its figures alone.
- The visual page captures PNG files from hold mode. They are the first and last stability frames, the reference, and 4 consecutive frames of the moving scene, 1/60 s apart. The runner saves them in `target/runs/<run>/<runner>/frames/<scene>-<path>/`, with `figures.json`. Hold mode gives consecutive frames exactly. A live engine cannot: `captureFrame` draws the newest frame again and reads it back, which takes longer than a frame on a phone.
- The first timed run of each null3D page also captures its live frame with `engine.capture()`, after its measured seconds. The runner saves it as `frames/<scene>-<page>-live.png`. It shows what the device drew at full speed, with the quality governor's settings and the far cascades' update schedule. Hold mode runs neither. A plan that sweeps job worker counts captures nothing.
- The runner prints the frames folder after the summary. The coordinator looks at the frames after each run.
- `bun run test:bench` checks the same figures for S2 with three cascades and S4 on SwiftShader in CI (`bench/tests/visual.spec.ts`).

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

## Grid-cell culling

- S1-cells spreads S1-static's boxes over 8 x 8 grid cells, 8 km on each side. Its camera flies low along -Z at 200 m/s, so a few cells are in view. New ones come into view about every 5 seconds.
- The page kinds that end in `-half` start null3D with `?half=on`, so the scene shaders do their color math at half precision. [D-09](decisions/D-09-half-precision.md) gives the commands and the results on the Mac, the iPad and the S24+.
- The page kinds that end in `-cells-off` start null3D with `?cells=off`. Culling then skips no cell: WebGPU's culling pass covers every source. WebGL2 culls every object. It builds no clusters for a static batch whose rows lie in several cells.
- On the Mac, compare both paths with and without cells: `bun run bench:run --scenes s1-cells --pages null3d-webgpu,null3d-webgpu-cells-off,null3d-webgl2,null3d-webgl2-cells-off,threejs-webgpu,threejs-webgl,scene-code`.
- On the phone: `bun tests/real-browsers.ts --plan bench --allow-no-webgpu --android chrome --scenes s1-cells --pages null3d-webgl2,null3d-webgl2-cells-off,threejs-webgl`.
- On 30 September 2026 the MacBook Pro ran S1-cells in Chrome at 144 Hz, 3 runs of 10 s per page (`target/bench/20260930-052100-bench`). Other builds loaded the machine at the time. On WebGL2, cells cut the busiest thread's CPU time from 0.21 ms to 0.07 ms per frame. They cut all threads' time from 0.54 ms to 0.12 ms. Each frame then listed 79 entries instead of 1,517. three.js's WebGL renderer took 0.07 ms.
- On WebGPU the CPU time stayed at 0.10 ms, because the GPU culls. The culling pass took 0.025 ms of GPU time with cells and 0.039 ms without them, and the drawing pass 0.082 ms either way.

## Many point lights

- S3 stands 20,000 still boxes in one instance batch on a floor 200 m wide. 256 point lights with a range of 12 m light them, and each light moves on a circle of its own. The camera orbits. `?n=` sets the box count, and the lights stay at 256.
- The boxes stand on a grid, one per cell, and never touch. Where two boxes meet, some pixels have equal depth, and the GPU can draw them in either order. With random places, the image test's two thread modes differed by one pixel on SwiftShader.
- The sun and the ambient light are dim, so the point lights stand out. The twin's hold frame shows a pool of colored light under each point light.
- The three.js twin draws the 256 lights as `PointLight` objects with a distance and a decay. WebGPURenderer shades them through three.js's clustered lighting, the `ClusteredLighting` addon (Forward+). It assigns each light to the clusters of the view that its range reaches, so each fragment shades only its cluster's lights.
- WebGLRenderer has no clustered lighting. Its shader for 256 point lights needs more than the 1,024 uniform vectors that the Mac's GPU gives a fragment shader in Chrome. The shader fails to build there, and the WebGL page reports the GPU's reason and draws nothing. A benchmark run then lists the WebGL page as failed. A device without WebGPU has no three.js twin of S3 when its GPU has the same limit. On 2 October 2026, WebGLRenderer failed to build that shader in Chrome and Brave on the S24+, and in Safari on the iPad. The error was "FRAGMENT shader uniforms count exceeds MAX_FRAGMENT_UNIFORM_VECTORS(1024)".
- SwiftShader gives a fragment shader 4,096 uniform vectors, so the WebGL twin's shader builds there, but only after minutes. The page tests leave that page out on SwiftShader. The WebGPU twin's short run warms up for 5 seconds and measures for 5, because its first frames take seconds on SwiftShader.
- The parity checks leave S3 out, because each of them compares with WebGLRenderer's frame. `LEFT_OUT_OF_PARITY` in `bench/lib/parity.ts` lists why a scene is left out: a feature that its twin draws and null3D does not draw yet, a twin that cannot draw it, or a tier whose frame differs from the twin's by more than the checks allow.
- On WebGPU a compute pass lists each cluster's lights (M1-E3), and the CPU only uploads the light list. We measured it on 2 October 2026 with `bench:run --compare`, 10 rounds on the Mac in Chrome at 144 Hz. S3's own work per frame on WebGPU went from 0.140 ms to 0.070 ms. The busiest thread went from 0.153 ms to 0.087 ms. WebGL2, where the job workers still list the lights, did not change. The GPU time per frame went from 2.85 ms to 3.06 ms: the pass's three dispatches take about 0.2 ms at the clock speed the GPU keeps in this scene.
- On the Mac: `bun run bench:run --scenes s3 --pages null3d-webgpu,null3d-webgl2,threejs-webgpu,scene-code`.
- On the phone: `bun tests/real-browsers.ts --plan bench --allow-no-webgpu --android chrome --scenes s3 --pages null3d-webgl2,null3d-webgl2-low,scene-code`.
- On the iPad: `bun tests/real-browsers.ts --plan bench --lan ipad-safari --scenes s3 --pages null3d-webgpu,null3d-webgl2,threejs-webgpu,scene-code`.
- [D-06](decisions/D-06-success-targets.md#addendum-2026-10-02-s3-s4-and-s1-at-phone-scale-on-each-device) gives S3's figures on the S24+, the iPad and the Mac from 2 and 3 October 2026.

## The phone scene

- S4 is a town of 4 x 4 blocks. Its 5,000 still objects are buildings, what stands on their roofs, street furniture and road marks, in 48 mesh and material buckets. 200 vehicles drive the streets as dynamic objects, in 4 more buckets. They drive along X in 10 lanes, 20 to a lane, and each lane keeps one speed. So no two vehicles ever overlap. Overlapping surfaces at equal depth draw in either order on WebGPU, and the image test's thread modes then differed by a pixel. A sun casts shadows, 16 street lights stand at the block corners nearest the center, and linear fog hides the distance. The camera circles above the town once a minute.
- Every material is a standard material with a texture. `bench/scenes/spec.ts` makes the textures from data, so the scene loads no files.
- The page runs with the quality preset that null3D chooses for the device, as an app does. A comparison of two builds names High instead, and turns the governor off with `?governor=off` ([The benchmark job in CI](#the-benchmark-job-in-ci)). Its canvas fills the window, at the device's pixel ratio up to the preset's cap. The device runner's frame fills the screen, so a phone draws what a full-screen app draws. `?preset=low` fixes the preset of the page and its twins.
- The three.js twin takes the preset that null3D chooses for its GPU path: WebGL2 for WebGLRenderer, and WebGPU for WebGPURenderer. It copies the preset's pixel ratio cap, anisotropy cap, shadow cascade count and shadow map size from the engine's preset table, planned rows included. Its still objects share one `BatchedMesh` per material, which culls each object. Its vehicles use one `InstancedMesh` per kind. Its shadows come from three.js's cascaded shadow addon: `CSM` on WebGL and `CSMShadowNode` on WebGPU. Its cascades end at 200 m, where null3D's shadows end by default.
- Each null3D run records a trace of each measured second: the presented and completed frame rates from `engine.measure()`, the render scale, and the quality steps. The sketch tells the page the render scale and each quality change. The twin's trace holds the frames that it drew each second.
- The report adds a table of the traces. It gives the measured seconds and the target rate: the display's rate, up to 60 Hz. It also gives the seconds that held 95% of the target, the lowest rate of any second, the lowest render scale and the steps. The result file of each run keeps every second.
- null3D draws shadows on both GPU paths, and lights surfaces with point lights. The sketch asks for each feature in one place, marked with a comment that starts with `Feature:`. S4 then shows each feature as soon as the engine draws it. The pull request that builds a feature makes S4's image references again.
- S4 measures how a preset holds its frame rate on phones, so it keeps the preset's render scale range and the quality governor, as an app does. The governor lowers the render scale and then the shadows when frames take too long, and S4's trace shows the render scale and each quality step. The other benchmark scenes keep the render scale at 1 and turn the governor off, as their three.js twins draw. `?governor=off` turns S4's governor off too, so that a comparison of two builds measures the same work in every run.
- `LEFT_OUT_OF_PARITY` keeps S4 out of the parity checks. On the Mac, its WebGPU and compatibility mode frames pass, but its WebGL2 frame differs from WebGLRenderer's in 0.45% of the pixels, and three.js's two renderers differ in 0.37%.
- SwiftShader draws S4 slowly. null3D draws a few frames a second, and the twins take minutes over their first frames. The page tests draw S4 in a 480 x 320 window. On SwiftShader they give null3D's short runs 8 seconds, and they run the twins on real GPUs only.
- On the Mac: `bun run bench:run --scenes s4 --pages null3d-webgpu,null3d-webgl2,threejs-webgpu,threejs-webgl,scene-code`.
- `?shadowCascades=`, `?shadowMapSize=` and `?shadowFilter=` on a null3D page replace the preset's shadow settings, so one build can try other values for a preset on a device. The twins ignore them. The device runner's `--switches` gives every page of its bench plan such switches, such as `--switches preset=medium&shadowFilter=3`.
- On the phone: `bun tests/real-browsers.ts --plan bench --allow-no-webgpu --android chrome --scenes s4 --pages null3d-webgl2,threejs-webgl,scene-code`. For the long run, add `--pages null3d-webgl2 --runs 1 --seconds 600`: 10 minutes of warm-up, then a trace of 10 measured minutes.
- On the iPad: `bun tests/real-browsers.ts --plan bench --lan ipad-safari --scenes s4 --pages null3d-webgpu,null3d-webgl2,threejs-webgpu,scene-code`.
- [D-06](decisions/D-06-success-targets.md#addendum-2026-10-02-s3-s4-and-s1-at-phone-scale-on-each-device) gives S4's figures on each device from 2 and 3 October 2026, with the long runs. [D-03](decisions/D-03-latency-mode.md) gives S4's pacing in low-latency mode on the iPad.

## The crowd

- S5 draws 500 copies of one animated character on a lit ground. `?n=` sets the count. The character is the KayKit Knight of the sample content (CC0), which the asset tool optimizes when the page imports it ([Sample content](sample-content.md#use-a-sample-file)). Both engines load the same optimized file, with meshopt buffers and a KTX2 texture.
- Each knight keeps one sword and one round shield, with its helmet and cape, as a game shows it. The page removes the file's four other weapons and shields. A knight then has 10 meshes, 4,957 vertices, 5,296 triangles and 41 joints. Its 6 body meshes are skinned. The helmet, the cape, the sword and the shield follow their bones as rigid meshes.
- The knights walk in rings around the center, and the rings take turns going one way and the other. Each knight blends the walk `Walking_A` with the run `Running_B`, whose clips are both 1.07 s long, so the blend stays in step. Each ring has its own share of the run, from 0.2 to 0.8, and moves at the speed of its blend. The knights of a ring keep their spacing, and the rings lie 2 m apart, so no two knights overlap.
- Each knight plays its clips at a rate of its own, from 0.85 to 1.15, so no two step in time. S5's design starts each character's clips at a time of its own. The engine has no call that starts a clip at a chosen time, so the rates spread the poses instead.
- S5's design calls for characters of about 2,500 vertices. The Knight has about 4,950, and the asset tool cannot simplify meshes. So S5 draws about twice the vertices of its design. The vertex work of both engines grows with it.
- A sun casts shadows, and an ambient light fills them. S5's design also lights it with an environment. The engine does not light scenes with environment maps yet, so S5 and its twin leave it out. The pull request that builds environment light adds it to both, and makes S5's image references again.
- The camera orbits the crowd once a minute, at a radius that fits the outer ring.
- The page runs with the preset that null3D chooses and the governor on. S4 does the same ([The phone scene](#the-phone-scene)). `?demo` makes it the playable demo: the stats overlay, orbit controls, and Space to pause the crowd.
- The three.js twin loads the file with `GLTFLoader`, `KTX2Loader` and `MeshoptDecoder`. `SkeletonUtils.clone` copies it for each knight. The copies share their geometries and materials, and each gets a skeleton of its own. Each knight has one `AnimationMixer`, which plays the two clips as actions whose weights add up to 1. three.js has no instanced skinning in its core. So each `SkinnedMesh` draws on its own, skinned in the vertex shader of each pass. The shadows come from the cascaded shadow addon, as in S4's twin.

### What S5 found

- three.js could not load any model that the asset tool optimized. The tool wrote each KTX2 texture as the texture's plain source, and glTF names a KTX2 image only through `KHR_texture_basisu`. The tool now turns the extension on whenever it writes KTX2 files.
- On WebGPU, each skinned object draws from a bucket of its own, and every bundle names every bucket. The draw list kept a fixed room of 16,384 words, so 500 knights failed their first frame with E1501. The builder now reserves the words that the camera, prepass, cascade and tile bundles can take, for the layouts as they stand. A Rust test draws 5,000 skinned copies on both builders.
- The Knight's material is double-sided, so both engines draw its lit faces into the shadow map. null3D's default `normalBias` of 0.02 m keeps those faces from shading themselves. The twins' cascades had no normal offset, so three.js speckled the sunlit helmets with acne. Then null3D's frame differed from three.js's in 0.93% of its pixels on WebGPU, 0.95% in compatibility mode and 1.76% on WebGL2. three.js's two renderers differed by 0.69%. With knights that receive no shadows, both tiers differed by only 0.12%. The cascades of S4's and S5's twins now take null3D's default `normalBias`, which three.js gives in meters too.
- After that change, the Mac's GPU gave these figures on 4 October 2026. 0.27% of S5's pixels differed on WebGPU, 0.33% in compatibility mode and 0.20% on WebGL2. three.js's two renderers differed by 0.46%. SwiftShader gave 0.29%, 0.32% and 0.20%, against 0.52%. S4's figures hardly moved: 0.159% to 0.156% on WebGPU, 0.174% to 0.173% in compatibility mode and 0.248% to 0.242% on WebGL2.

- At 500 knights, null3D's WebGL2 path first drew 8.4 frames per second on the Mac, with the GPU 233 ms behind. Each frame wrote about 1,500 small runs of moved rows into the resident texture, one write each. The upload now joins runs that lie close together ([Implementation notes](implementation-notes.md#safaris-webgl2-path)), and the same page draws 89 frames per second.

### S5 on SwiftShader

- S5's ten page tests pass on SwiftShader, with the twins: each takes 2 to 22 seconds. The image tests draw both thread modes of each tier in about 20 seconds.
- On SwiftShader, null3D's held frame takes longer than three.js's. We timed 500 knights on the Mac under a heavy load. null3D gave its held frame in 24 seconds on WebGL2 and 11 on WebGPU. three.js took 9 and 5. The sketch's steps took under 2 seconds. Most of the rest was SwiftShader running the frame's GPU work, which the read back waits for. SwiftShader runs GPU work on the CPU, so it says nothing about a real GPU. On the Mac's GPU, each engine gives the frame in about a second.

### Run S5

- The CI comparison leaves S5 out (`COMPARED_SCENES` in `bench/run.ts`) until it runs at a pinned preset.
- On the Mac: `bun run bench:run --scenes s5 --pages null3d-webgpu,null3d-webgl2,threejs-webgpu,threejs-webgl,scene-code`.
- Phones and tablets first find S5's own scale: `bun tests/real-browsers.ts --plan scale --scenes s5 --allow-no-webgpu --android chrome` ([Device sessions](devices.md#android-phone)). Then run the bench plan at that count: `bun tests/real-browsers.ts --plan bench --allow-no-webgpu --android chrome --scenes s5 --pages null3d-webgl2,threejs-webgl,scene-code --n <count>`.
- On the iPad: `bun tests/real-browsers.ts --plan scale --scenes s5 --lan ipad-safari`, then `--plan bench --lan ipad-safari --scenes s5 --pages null3d-webgpu,null3d-webgl2,threejs-webgpu,scene-code --n <count>`.

## Shadows

- `?shadows=<n>` on S2's pages turns on the sun's shadows, and every node casts and receives them. null3D draws them in n cascades, from 1 to 4, and three.js in one map. Both maps have 2,048 texels on each side (`SHADOWS` in `bench/scenes/spec.ts`), and three.js's map covers a box around the whole forest.
- `--switches <switches>` gives every page of a run more switches. On the Mac, run S2 without shadows, then with each cascade count: `bun run bench:run --scenes s2 --pages null3d-webgpu,null3d-compat,threejs-webgpu,threejs-webgl --switches shadows=1`. Each count's difference from the run without shadows is the cost of its cascades, in CPU time and in GPU time.
- `bun run parity --scene s2 --switches shadows=3` compares the hold frames on each tier. On 30 September 2026 on the Mac, 0.147% of the pixels differed on both WebGPU tiers, and three.js's two renderers differed by 0.270%. WebGL2 drew no shadows then, so it has no figure yet.
- Each cascade adds a culling dispatch and a depth pass on the GPU. On the CPU it adds the recording of both, and its uniforms: about the same work whatever the number of casters.
- `?far=<n>` on S4's null3D pages sets `farCascadeInterval`, from 1 to 8. `--switches far=1` draws every cascade in every frame. Its difference from the preset's run is what drawing the far cascades in turn saves. S4's cars drive through every cascade. Since [D-16](decisions/D-16-moving-casters-and-bias.md), its far cascades therefore draw in every frame anyway, and both runs draw the same passes.

## The depth prepass

- The page switch `?prepass=on` or `?prepass=off` turns the depth prepass on or off, whatever the preset says. Both GPU paths draw it ([Depth on WebGL2](implementation-notes.md#depth-on-webgl2)). `?prepass=on` on a benchmark page, with `measure`'s `gpuPassMs`, gives the prepass's GPU cost in the scene's render pass.
- The page kinds that end in `-prepass` start null3D with `?prepass=on`, so a bench run takes turns between a page and its prepass twin: `bun run bench:run --scenes s2 --pages null3d-webgl2,null3d-webgl2-prepass,null3d-webgpu,null3d-webgpu-prepass`.
- On 2 October 2026 (M1-A7), S2 ran on WebGPU in Chrome on the MacBook Pro, 3 runs of 10 seconds each way. Its GPU time per frame was 0.28 ms without the prepass and 0.41 ms with it. The scene's render pass grew from 0.13 ms to 0.26 ms. S2's trees hide few others, and its shading is cheap, so a second pass over its vertices costs more than it saves.
- On 4 October 2026 (M2-R2), S2 ran again with the `-prepass` pages, 5 runs of 5 seconds each, in turns. WebGPU's GPU time per frame went from 0.28 ms to 0.40 ms. On WebGL2 the draw calls went from 101 to 201, and the render worker's time per frame from 0.075 ms to 0.080 ms. Chrome on the Mac has no GPU timer on WebGL2, so the WebGL2 GPU cost needs a device.
- Every preset leaves the prepass off on those results. The iPad's and the phones' figures, from the bench plan with the `-prepass` pages, are still to come.

## Sweeps for the open defaults

Three sweeps measure the defaults that are still open: the latency mode, the job worker count and the shared memory's maximum. Each runs on the Mac, and on a phone or an iPad through the device runner.

- The page kinds that end in `-low` run null3D in low-latency mode, and the bench plan runs them beside the pipelined pages. On the Mac, run `bun run bench:run --pages null3d-webgpu,null3d-webgpu-low,null3d-webgl2,null3d-webgl2-low`. Compare the presented frame rate, the 95th and 99th percentiles of the frame interval, and the busiest thread. In low-latency mode the sketch worker draws, so its time includes the drawing.
- The page switch `?jobs=<n>` starts n job workers. On the Mac, `bun run bench:run --jobs 1,2,4,8,16` runs null3D's two GPU paths at each count. On a phone, add the counts to the bench plan: `bun tests/real-browsers.ts --plan bench --allow-no-webgpu --android chrome --n 300000 --jobs 2,4,6,8`. The summary gives each count's frame time, busiest thread and the sketch worker's own work. A run whose engine started another count fails.
- The page switch `?memory=<MiB>` sets the shared memory's maximum, up to the 4096 MiB that the engine core declares. It wins over the `memory` option of `createEngine`. The `memory` plan loads the engine test page 20 times at each maximum from 256 to 4096 MiB. It names the largest maximum that loaded every time. A failed allocation counts as a failed load, and `--runs <n>` changes the number of loads.
- Before the loads at each maximum, the memory plan counts how many shared memories with that maximum fit at once. That is how many engines a page can hold. `--runs 0` runs only these counts.

## Download size

- The size report builds the engine test page for production with hidden source maps, which leave the built files unchanged. Vite names each file after a module and adds a hash. The report therefore names each file of the engine's JavaScript by the engine module that it holds. The list of parts is `ENGINE_PARTS` in `tools/lib/size-report.ts`. A new file of engine code fails the report until the list names it.
- The report gives two budgets for the engine's JavaScript, both after Brotli ([D-14](decisions/D-14-js-budget.md#m2-the-start-and-the-files-that-load-later), approved by the owner for M2 on 2026-10-04). What a page downloads at its start may take 140 KB, in the thread mode that downloads the most. It holds each mode's files and the largest shader file. Each file that no mode downloads at its start may take 16 KB. Such a file loads on a feature's first use, as the glTF loader does with the first glTF file. Or it loads after the first frame, as the preset check does. The report lists these files in a section of their own, and no start counts them. `LATER_PARTS` in `tools/lib/size-report.ts` names them.
- A feature that a page does not use adds nothing to the page's start. Its code loads on first use, in a part of its own: add the part to `ENGINE_PARTS` with the part that loads it. A file that loads on a feature's first use must not load on a page that does not use the feature. An engine test checks each such part: "a page that uses no feature that loads on first use downloads none of their files". It runs in every thread mode on both GPU paths, on the dev server and in a production build. Mark a part that every page loads after its first frame with `afterFirstFrame`, and the test leaves it out.
- The report lists the KTX2 transcoder apart from what a page downloads at its start. Its `ktx2/` files are the transcoder's worker and the Basis Universal build's script and module. A page downloads them with its first KTX2 file. They have no budget, because the engine ships them as their authors build them. The growth check covers them as it covers every file.
- `bun run build:check-size` compares each file's size after Brotli with a build of a base commit. The base is main's own build. The repository keeps no size record, so pull requests cannot conflict over one.
- The base is HEAD's merge base with main. CI tests a pull request as GitHub's merge of it into main, so the base there is the main commit that it merged into. A push to main compares with the commit before. `--base <ref>` picks another commit.
- A merge queue run compares with the commit that its group builds on. That is the commit before the group's head, and it holds the pull requests ahead in the queue. The queue squashes each pull request into one commit on top of the one ahead.
  - Until 3 October 2026, the queue's run compared with main's merge base too. Main did not yet hold the pull requests ahead, so their growth counted against the pull request behind them. On 2 October 2026, #201 was ahead of #198 in the queue. The check measured #198's growth as +3.0% instead of its own +1.3%, and the queue removed #198.
  - The event's own record of the group's base commit was rejected. It names the same commit, and the commit before needs no event file, as for a push to main.
- The check builds the base in a git worktree, `target/.size-base/tree`, with the base's own build script. The base therefore keeps its own flags, toolchain and list of parts. The script's `--sizes-only` builds only what the report measures, without the shader compiler, and writes the sizes.
- The shader modules go into the engine's JavaScript, so each base needs its own. A base from before git stopped keeping them has them in git, and its build script uses them as they are. A later base's build script builds them in the worktree from that base's shader sources. The first such build in a worktree also compiles the shader build's own crates. On a MacBook Pro on 2 October 2026, that made the base build take 39 s instead of 21 s.
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
- On Slow 4G the start is a chain of round trips of at least 562 ms each. After the page and its script come the core, the probe worker and every other download that the start needs. With worker threads these are the workers and the sketch module. In single-threaded mode they are the core's loader, the sketch module and the renderer. The workers then load the core's loader while the core still downloads.
- So the core is the last download in most modes, and the engine is ready soon after it. [Implementation notes](implementation-notes.md#start-order) give the order and the times.
- The MacBook Pro was measured in Chrome 154 on 30 September 2026. A cold load in the pipelined mode finished its first frame after 4.0 s on Slow 4G. A warm load took 0.7 s, and both took about 0.1 s at full speed.

## Soak

- `bun run bench:soak` runs the production build, and samples every 30 seconds. Before each sample, the page, the sketch worker and the render worker collect their garbage, so a sample counts only what they keep.
- While the engine runs, a job worker blocks inside the job system's loop, so it never runs a collection that the debugger asks for. The soak reads its heap as it is, garbage included.
- The WebAssembly memory's size comes from `Runtime.queryObjects` on the page, because the engine keeps the memory out of the page's global scope.
- The soak judges the run after a 2-minute warm-up. The sketch worker's and the render worker's heaps may each grow by 256 KB. The growth is the median of the last three samples less the median of the first three.
- The WebAssembly memory may not grow at all, and the engine must still draw at the end.
- `--scene s4` soaks S4, the phone scene, as M1's exit gate asks. Its shadows, street lights, moving vehicles and quality governor run frame code that S1 never reaches. S4 has a fixed count of objects, so the soak ignores `--n` there. `bun run bench:allocation --scene s4` samples the same scene, on WebGPU or with `--gpu webgl2`.

## Allocation and profiling

- `bun run bench:allocation` samples allocations after a warm-up of at least 30 seconds and 3,600 frames. The browser optimizes code that runs once per frame only after thousands of frames, so a display at 60 Hz takes a minute.
- While it warms up and samples, the check moves the mouse over the canvas and presses a key and the mouse button. So the samples cover the sketch's reading of input, and that code is warm when they start.
- Places that allocate because the browser does have budgets with their reasons in `bench/allocation.ts`. Every other place must stay under 4 bytes per frame. Add `--n 30000` to include the staging ring.
- `--animated 64` adds 64 animated characters of 40 joints to S1. Each plays a clip, a masked layer and an additive layer, and has event handlers. Each frame, the sketch sets a layer weight of every character, and a character cross-fades now and then. Each character is a skinned mesh, a small box at each joint, in rows in front of S1's boxes. The job workers pose them, and both GPU paths skin them each frame. The benchmark page passes its `blend`, `animated`, `grading` and `sprites` switches on to the sketch.
- `--grading` loads the sample content's warm color grading table into S1 and turns the vignette on. Each frame, the sketch changes the table's intensity and the vignette's offset through one settings object. On 3 October 2026 both GPU paths passed with it. On WebGPU the sketch worker allocated 296 bytes per frame and the render worker 574. On WebGL2 they allocated 358 and 150. No place of `post.set` showed in the samples.
- The first run with `--grading` failed: `post.set` allocated 22 bytes per frame on the sketch worker. It passed each fraction as an argument of a core call that the browser does not inline, and the browser stores each such fraction in an object of its own. Bit patterns as whole numbers would not help, because the patterns of values from 2 up exceed the browser's small integers. So `post.set` writes its numbers into a block of the core's memory (`postValues`), through one view, and the core calls take none.
- `--sprites` draws S1's swarm as one dynamic batch of 100,000 blended sprites, in place of the boxes. Each frame, the sketch writes every sprite's position and rotation, and the transparent pass sorts the sprites. On 4 October 2026 both GPU paths passed with it. On WebGPU the sketch worker allocated 369 bytes per frame and the render worker 509. On WebGL2 they allocated 348 and 157. No place of the engine's sprite code showed in the samples.
- Chrome's heap profiler charges each object to the outermost optimized function on the stack. When the browser inlines a function into its caller, the function's objects count in the caller's place. So a budget also covers the functions that the browser inlines into its place. A change that alters what the browser inlines can move the same objects to another place.
- `--no-inline` starts Chrome with V8's inlining off. Each function's objects then count in its own place, so a place that a budget hides shows by name. Calls cost more and box more, so the budgets do not hold. Compare the places with a run of the same scene without the feature, not with the verdict. The labels' half-width helper was found this way. It hid in the sketch's frame step, whose figure swings by up to 80 bytes per frame from run to run.
- The check takes two samples of 5 seconds each, and judges each place by the sample where it allocated less. Allocation in every frame shows in both. Some events happen once, in one sample only, such as a function that runs unoptimized for a moment. The report shows each place's larger figure too.
- When the browser installs code that it has just optimized, it makes a few large objects: the code and its tables. The heap profiler charges them to the first function that runs in the next task, which can be any callback. In one branch's runs, it put five objects of 0.2 to 7 KB in the render loop's frame callback. In each sample, the check sets aside one burst per place. A burst is a run of objects that the profiler sampled one after another at one place. It has at most 16 objects, and it holds at least a tenth of the place's bytes in the sample. A place that allocates in every frame has hundreds of runs between other places' objects, so it has no burst. Code that the browser throws away and compiles again every second or two makes more than one burst in a place, and the others count. That is how the check found S4's replay compiled every 1.5 seconds. The report's larger figure keeps the bursts.
- The browser keeps compiling the render worker's frame code for minutes. A trace of S1 on WebGPU ran on a 120 Hz display. From 30 to 145 seconds after the start, the browser compiled frame code 24 times, to its top or middle tier. It compiled the replay's `passCommand` at 38 seconds. Before the check set bursts aside, the wake-up timer of the render worker failed 3 of 5 runs on a quiet Mac. The load was 4 to 6, and the timer took 6.1 to 6.8 bytes per frame of 4. Its callback is empty. One burst of 9 objects, 17 KB in all, was the installation of `passCommand`. With the timer turned off, the same burst went to the GPU completion callback, which then failed 3 of 3 runs. So no other way to wake the thread avoids it, and the load of the Mac does not cause it. On WebGL2 the same bursts came near the budget but passed 3 of 3 runs.
- After about 140 seconds, the browser compiled the render loop's `draw` with the renderer's `drawFrame` inlined. It did not inline the completion tracker's `afterSubmit`. The queue's promise and its reaction then show in `afterSubmit`, at 136 bytes per frame on WebGPU, and no longer in `drawFrame`. The check gives `afterSubmit` its own budget for them, so a long `--warmup` passes too.
- The check samples the production build. The build's source maps give each place its function and file, so one set of budgets holds for the build and for `--dev`. With `--dev`, the development checks allocate a little more on the sketch worker, which a budget allows.
- `bun run bench:profile` shows where the render worker's replay spends its time. A browser call costs the same from any language. The engine's own share of the replay is therefore the most that a replay loop in another language could save.
- The profile samples the production build, and names its functions through the build's source maps. With `--dev`, it profiles the dev server's pages, whose development checks then count in the engine's share.
- The profiler samples every 50 microseconds after a 20-second warm-up. Code the browser has not optimized yet counts as the engine's, so a shorter warm-up overstates the engine's share.
- `--thread sketch` samples the sketch worker's frame step instead, and splits it between the engine's code, the engine core and the browser. It also lists the engine's per-frame phase times on that thread, such as the update and the batch pass.
- The shipped core has no function names. Build it with `bun tools/build-wasm.ts --names` before a profile, so the profile names the core's functions. The names add size, so that build skips the size checks: build again without it before you check sizes.
- Chrome's page-wide memory measurement waits up to a minute for the job workers, and it counts shared memory once per worker. Chrome's debugger gives exact heaps per worker through `Runtime.getHeapUsage`.

## WebGL call times

The page kinds that end in `-timed` start null3D on WebGL2 with `?gl-timing`. The thread that draws then times each WebGL call while the page measures. The report adds two tables: the calls that took the most time per frame, and the slow calls of the slowest frame, in order. The timing wraps every call and allocates for each one, so these pages are not for comparisons.

- Safari runs WebGL in a process of its own. It answers a call that returns a value only after that process has run every call before it. So the time of such a call holds the process's work on the calls before it.
- The page kinds that end in `-synced` start null3D with `?gl-timing=sync`. Each call then ends with `getError`, which waits for that process, so a wait there counts toward the call that caused it. Writes into a texture count apart for each texture, named by its size and its format's GL code.
- On the iPad: `bun tests/real-browsers.ts --plan bench --scenes s4 --pages null3d-webgl2-timed,null3d-webgl2-synced --runs 2 --seconds 10 --lan ipad-safari`.
- On 2 October 2026 these pages found the two waits that [Safari's WebGL2 path](implementation-notes.md#safaris-webgl2-path) describes. In S3, `fenceSync` took 22 ms per frame. In S4, the synced page put 16 ms on one texture write per frame.

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
