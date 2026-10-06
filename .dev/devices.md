# Device sessions

This guide covers the checks and benchmarks on phones, tablets and the Mac's browser apps. [AGENTS.md](../AGENTS.md) holds the rules and the commands.

## The runner

- The device runner, `tests/real-browsers.ts`, runs a plan of test or benchmark pages in browsers that Playwright cannot drive. Each browser loads the runner page, which opens each page of the plan in a frame and posts its result.
- The plans are `checks` (the default), `smoke`, `parity`, `bench`, `bloom`, `ao`, `occlusion`, `memory`, `depth`, `governor`, `overload`, `scale`, `skinning`, `skinning-webgpu`, `animation`, `startup`, `tab-memory`, `soak` and `warm-up-time`. `bun run devices` runs the checks in Chrome on the phone and in Safari on the iPad.
- The runner page's top line counts the pages that passed, failed and are left, and names the page that runs. Below it, the runner page shows a grid with one cell per page of the run. A cell is grey while its page waits, yellow while it runs, green when it passes and red when it fails. It is blue-grey when the runner page skips its page, because the device lacks the page's GPU path. Tap or hover a cell to see its page and its error. Under the grid are the failures with their errors, then a line for each result, newest first. Scroll for the older lines.
- The report covers each page's frame in the plans that only check results: `checks`, `parity`, `memory` and `depth`. The frame stays full size and on screen underneath, so its canvas keeps the size that the references expect. Browsers slow or stop the animation frames of a frame that is hidden, tiny or off screen. Without the cover, the screen would flash between the report and each page. In the plans that time pages, each page's frame covers the report, so the browser composites nothing over a measured page. The list of covered plans is `REPORT_ON_TOP_PLANS` in `tests/lib/plans.ts`.
- The runner page fills in its run and its own name where a plan item's address has `{run}` and `{runner}`. The startup, bench and scale plans use them, so each browser loads under addresses of its own.
- `--switches <q>` gives every page of a plan more switches, such as `half=on` or `half=on&preset=ultra`. The checks plan's image tests then compare those pages with the usual references, at the device tolerance.
- Run one runner at a time. All runs share one file, `target/runs/current.json`, which tells waiting runner pages which run to start. A second runner can replace it before a waiting page reads it, and that page then waits forever.
- A runner page that waits on the local network reloads itself before each run after its first. No run then inherits memory that an earlier run kept.
- A runner page that opens without `&from=` starts at the first page of the plan that has no result. Safari reloads a runner page whose tab crashed, and the reloaded page goes on where the run stopped. The dev server lists a runner's results for it.
- A plan item can mark a page that may end its tab on purpose, as the tab memory page does. The page posts its progress after each step, under a name beside its result. So the dev server keeps its last step when the tab dies. Before such a page, the runner page notes that it started. A runner page that finds such a page started and without a result records its last progress as its result. It then rests for 150 s, so the device frees the dead tab's memory, and goes on with the next page. Safari reloads a crashed page only when the last crash was some time ago. On the iPad on 2 October 2026, Safari reloaded the runner page after a crash 2.3 minutes after the one before. It did not reload it after a crash 1 minute after the one before. It showed its own error page in the tab instead, and no later run started on the iPad until Safari was quit and opened again.
- The runner reports a page that gives no result in time with its last steps. The steps are each worker it started, each step of each worker's start, and the errors it logged. A page that fails reports its steps too. The last step of a page without a result tells how far the page loaded: the state of its document, and the files it loaded. A page whose script or one of its imports never arrived has no other steps.
- When a worker's script or one of its imports does not load, the browser gives no reason. The page's steps then count the workers that run, and say whether a second copy of the worker loads. A copy that loads points to a passing fault of the network or the dev server.
- The runner's `--only <ids>` runs only those items of a fixed plan, with the items whose results their checks compare with.
- The runner's `--rounds <n>` runs the items n times over, one round after another, to catch a fault that comes only now and then. Each later round's results go under ids that end with `-round-<n>`.
- A runner page that stops answering sends no result at all, so it has no steps to report. The runner names the page it was on: the first page of the plan without a result.
- Safari can lose a request that the runner page sends just after it removes a page's frame. The request never reaches the dev server, and it never fails. In two merge queue runs on 1 and 2 October 2026, this stopped CI's Safari runner page. Each time, a page had failed within 0.2 s, and its frame closed while its connection to the dev server's live reload was opening. A new request to the server later freed the lost one. So each request from the runner page to the dev server has a time limit of 20 s. A request with no answer by then goes out again, up to three times in all.
- A live page can also call `watchEngine` from `tests/pages/lib/engine-watch.ts`. Its steps then hold the engine's frame counters each second while they change. When they stop, the steps give the newest frame that each thread recorded. The texture arrays page does this, and also notes each of its steps and each frame of its sketch. A failed CI run keeps every page's full list of steps in its `real-browser-runs` artifact.
- Before a run on a phone or tablet, the runner prints a checklist. The display needs a fixed refresh rate and fixed brightness. Low Power Mode and battery saver must be off, and the device must be rested and cool.
- No plan or command runs Brave by default, as [Which device runs a check](#which-device-runs-a-check) says. The runner still runs it where a run names it, such as `--android brave` or `--lan ipad-brave`. It cannot read Brave's Shields there. Run Brave once with Shields on and once with them off for the dev server's site, and pass `--shields on` or `--shields off` to match. The runner records the state in each Brave result and in the run's summary.
- Do not edit engine or benchmark page files, or `vite.config.ts`, during a run. The dev server reloads the pages being measured, and restarts when its config changes.
- The dev server loads the Vite plugin, and the shader compiler that the plugin runs, once when it starts. It never loads a new copy of them while it runs.
- After a pull that changes `packages/vite-plugin` or the Vite config, run `bun run build`, then restart the dev server before a run. Restart it before the browser tests too, because they use a dev server that already answers on their port. The build also brings the engine core that the server serves up to date. On 1 October 2026, a stale server rejected new custom material sketches with "the WGSL has no entry point".
- The dev server watches no file under a `.claude/` folder, as `server.watch.ignored` in `vite.config.ts` says. So a dev server in a worktree under `.claude/worktrees/` sees no edits. It serves each file as it first served it. After a change in such a worktree, restart its dev server. A file with a new name loads fresh without a restart. On 4 October 2026, an edited probe page loaded as its old copy, on the S25 and on the Mac.
- Do not add or move files in the tree that the dev server watches during a run. A new HTML file anywhere in it reloads every open page, and a page reloaded while it measures reports 0 frames.
- The `smoke` plan is about a tenth of the checks plan, for a device in a cloud session of limited time. It keeps the capability, isolation, shader, upload, preset, warm-up and stats pages, the restarts of each build, and the main features' image tests. Each image test runs on every GPU tier in its first thread mode, so new tiers and modes join by the same rules.
- The runner page detects the browser it runs in, from Brave's object on `navigator`, the client hints and the user agent. It records the browser, the GPU and the page's address in `device.json`. The summary names each runner's browser. When a runner's name names one browser and its page runs in another, the runner warns. A name that names no browser, such as `bspixel10`, suits a device whose browser is chosen in the session.
- After a fixed plan, the runner prints a row for each browser for [the record of tested devices](tested-devices.md).
- Close the browser tabs that testing opens as soon as each test ends. Old tabs keep pages running, which costs heat and skews later runs.

## Guards on device runs

The runner watches each browser's results while a run goes on. Three guards keep a tired device from wasting a run, or from giving figures that look true but are not.

### A page that gets no animation frames

- A browser gives a page no animation frames while it reports the page hidden. Every test page then waits for frames until its time limit. On 4 October 2026, Samsung Internet on BrowserStack's Galaxy S25 opened the runner page hidden in 2 of 3 Automate sessions. The runner page then waited forever on its first step, the measure of the refresh rate. The runner ended the turn only when the page went quiet.
- So the runner page waits at most 20 seconds for the 61 frames of that measure. A visible page gets them in about a second, and a page that the browser shows within the limit goes on. When the frames do not come, the runner page posts the device's facts with no refresh rate, and whether the browser reported the page hidden. It then posts a `no-frames` record and stops. It does the same before each page of a timed plan.
- The runner ends the turn as soon as it reads the record, as the out-of-memory guard does, and counts one failure. It prints the reason and what to do:

  ```text
  bsgalaxys25-samsung: the browser reports the page hidden, so it gets no animation frames. The session could not bring the page to the front. Run it again with bun run devices:cloud --only bsgalaxys25-samsung for a new session, or test this browser in BrowserStack Live, where a person holds the device
  ```

- On the phone, the iPad or the Mac, the message asks you to bring the runner page to the front and keep the screen on.

### A browser that keeps refusing memory

- After hours of runs, Safari on the iPad can refuse the engine's shared memory on every page. Each page then fails with E1109, or with the browser's own "Out of memory" error.
- This happened twice. On 2 October 2026, a checks run failed 433 of its 490 pages. A later run failed 82 of its 116 pages. Each time, only quitting and opening Safari again brought the memory back.
- So the runner ends a browser's turn when 3 of its last 5 pages failed for lack of memory. Three such pages in a row end it too, because they lie among the last 5. The counts are `OOM_STOP_PAGES` and `OOM_WINDOW_PAGES` in `tests/lib/runs.ts`.
- A single page that fails for lack of memory does not end the turn. One page can leak or ask for too much on its own, and the next page then starts fresh.
- Replayed on the results of the run that failed 433 of 490 pages, the guard ends that run after 9 pages.
- Pages that push the memory limit on purpose do not count. These are the memory plan's loads, the shared memory page's counts of its room, and the tab memory plan. A refused memory is what they measure. The list is `MEMORY_LIMIT_CHECKS` in `tests/lib/plans.ts`.
- The other runners keep going. The runner prints a message that names the runner, its browser and its device, and what to do:

  ```text
  ipad-safari: the browser keeps refusing the engine's memory (E1109 on 3 of its last 5 pages). Quit and reopen Safari on the iPad, bring the runner page to the front, then run again with --only <the pages left>
  ```

- The `--only` list holds the pages without a result and the pages that failed for lack of memory. A page of a later round appears under its own id. Give the new run no `--shard`, because the list holds only the pages of the shard that ran.
- To end the turn, the runner first takes the browser out of the run's turn list. A reloaded runner page then does not start the run again. Next, the runner marks the browser's claim on its results as ended.
- The dev server then refuses the runner page's next result, and any new claim, with 410. The runner page stops at the end of the page that runs. A runner page that waits on the local network waits for the next run, and a runner page in a Mac app closes its tab.
- The runner records why the turn ended in `ended-early.json`, in the browser's folder of the run. The record holds the reason, the failed pages, what to do and the `--only` list. The run's `summary.json` holds the same record.
- The browser's line in the summary says that its turn ended early, and counts the pages that never ran. Those pages print no failure lines of their own.
- The guard does not stop the whole run. The other browsers' results stay good, because each device has memory of its own.
- The guard does not pause and try the failed pages again. Safari does not give the memory back until it quits, so a pause only wastes time.
- The guard looks at the last pages, not at the whole run. A long run can see a few unrelated refusals over hours, and those must not end it.

### A display whose refresh rate changes

- Frame rates mean little without the display's refresh rate. On 3 October 2026, the iPad reported refresh rates from 35 to 65 Hz between runs. A drop from 49 to 35 frames per second looked like a regression in the code. It followed the display's rate instead.
- So in the plans that time pages, the runner page measures the refresh rate before each page. These plans are `bench`, `startup`, `governor`, `skinning`, `skinning-webgpu`, `bloom`, `ao`, `occlusion`, `overload` and `soak`, and the scale search. The list is `TIMED_PLANS` in `tests/real-browsers.ts`.
- The runner page measures with no test page loaded, from the middle interval of 60 animation frames. It adds the rate to the page's result as `runnerRefreshHz`. Each runner page also measures it once at its start, in `device.json`.
- While it measures, the runner page changes its report's background by one shade on every frame, and it starts the timing after half a second. A phone lowers its display's rate while the screen barely changes, and a reading on such a screen gives that lower rate. On the Galaxy S24+ on 5 October 2026, the old reading gave 24 Hz for 2 of 35 pages in two runs. It also gave 24 Hz in 5 of 5 tries after a few seconds of a screen that changed 3 times a second. With the changing shade, the display rose to 60 Hz within 330 ms, and two runs gave 60 Hz for 40 of 40 pages.
- After the run, the runner marks a browser's timing figures as unreliable when a reading is below 55 Hz. It marks them too when the readings differ by more than a tenth of the highest one. The device checklist asks for 60 Hz.
- The limits are `EXPECTED_REFRESH_HZ`, `LOWEST_REFRESH_HZ` and `REFRESH_SPREAD` in `tests/real-browsers.ts`. A display that holds 120 Hz all through the run passes, as on a Mac with a 120 Hz screen.
- The browser's line in the summary then says why its timing figures are unreliable, and `summary.json` keeps the reason. The runner also prints what to check:

  ```text
  ipad-safari: the display ran at 37 Hz (expected 60): the iPad is hot, or Limit Frame Rate is off, or Low Power Mode or Reduce Motion is on; let it cool and check its settings. Its timing figures in this run are unreliable.
  ```

- The guard does not use the refresh rate that the engine's own figures report. The engine reads it on the thread that draws, and under a heavy scene that reading falls with the frame rate.
- For example, on 30 September 2026 the iPad's bench pages reported 57 and 28 Hz in turn, with the scene. The runner page read 59 Hz at the start of the same run.
- Each reading adds about a second to each page. The plans that only check results do not take it.
- The guard marks the figures and does not end the run. The run's other results still count, and the person decides whether to run it again.

## GPU paths that a device lacks

- A page that forces a GPU path with `?gpu=` cannot run on a device without that path. `--allow-no-webgpu` and `--allow-no-webgl2` let a device lack WebGPU or WebGL2. The runner then counts those pages as skipped, not failed.
- The runner page decides from the capabilities page's report, the first page of the `checks` and `smoke` plans. The report holds the facts that the engine picks its path from. Core WebGPU needs an adapter with core features and limits. Compatibility mode needs any adapter, and WebGL2 needs a context.
- After the report, the runner page skips each page that needs a path that the device lacks and that the run lets it lack. It posts a skip as the page's result and does not open the page.
- `--allow-no-webgpu` covers both WebGPU paths. On a device that offers compatibility mode only, it skips the core WebGPU pages and runs the compatibility mode pages.
- A page's path is the one that its `?gpu=` switch forces. A page without the switch takes its check's path. A WebGPU page without the switch, such as the uploads page, takes any adapter, so it needs compatibility mode only. The plan's file gives each page's path as `gpu`, and the skip flags as `skipMissing`.
- Each browser's line in the run's summary names the paths whose pages it skipped. So does the result in its row for [the record of tested devices](tested-devices.md).
- On 3 October 2026, TestingBot's Redmi Note 13 in Chrome 138 offered compatibility mode only: its adapter had no core features and limits. The engine refused each page that forced core WebGPU with E1301, as it must, and the run counted 85 such pages as failures.
- Four pages that force core WebGPU passed on the Redmi: the clear page, two replay pages and the shader library page. They ask for an adapter themselves and do not start the engine. They now count as skips there too, because the engine never draws with core WebGPU on that device.
- Each shard of a plan with the capabilities page loads that page first, so each shard skips the missing paths. Before this, on 4 October 2026, the second shard of the checks plan opened every WebGPU page on the cloud Galaxy S24. It took about 40 minutes in place of 17.
- A plan without the capabilities page runs every page. Judging then counts a page as skipped when its error says that the browser lacks the page's path, as E1301 does.
- Judging by the error alone was the only test before. It still opens each page, which costs minutes in a cloud session. E1301 can also come from a fault in the engine's choice of path, which a skip would then hide.
- The runner page's own GPU facts in `device.json` do not decide. They come from an adapter asked for without a feature level. Chrome 138 on the Redmi gave the clear page such an adapter, while the engine refused core WebGPU there.
- Without the flags, the runner skips nothing. A browser that should offer every path, such as Chrome on the Mac, must fail its run when it loses one.

## What the checks plan covers

- The capabilities page loads first and again last. Each extension that the engine asks for by name must get the same answer in both loads. The runner notes whether the browser's list of supported extensions kept its order, because Brave shuffles it (hard rule 13).
- The shared memory test page starts and stops the engine again and again in each thread mode. Where the browser has room for few shared memories, as on an iPad, the page starts more engines than fit at once. The check fails when a start fails, or when the room for shared memory does not come back within 31 s after the engines stop. Safari frees memory late on a slow machine. So a start that Safari refuses waits and tries again, for 30 s in all per page, as [the implementation notes](implementation-notes.md#threads-and-shared-memory) explain.
- The `frame-restarts-*` checks run the same page with `?kinds=frame` in the threaded modes with a sketch worker. Each engine starts in a frame, and the page removes the frame while the engine runs. An app does the same when it removes a page that never called `destroy()`. `?kinds=frame-destroyed` stops each engine before the page removes its frame.
- With `?kinds=`, the shared memory page tests other ways a worker can hold a shared memory. These tests found that Safari never frees the memory of a thread it stops inside a blocking wait, not even after a reload.
- The engine test page runs again on its production build, in each thread mode on WebGL2. The runner builds the page, and the dev server serves it as it serves the startup loads. A production build bundles the engine into shared files, so some faults show only there. These checks found that Safari runs a worker's file a second time when another file imports it.
- The shaders page compiles every GLSL program and WGSL module that the engine ships, for all devices. It compiles the GLSL programs 32 at a time. It starts every compile of a batch before it reads a result, so the browser can compile many programs at once. It checks and deletes each batch before the next, and yields between batches. Its time limit grows with the number of GLSL programs, because each new shader variant adds programs. It is 30 s, plus half a second for each program. On 2 October 2026, CI's Safari took about a third of a second per program when it compiled them one at a time. It took about 46 s for 147 programs, and failed the limit of 30 s that the page had then. In Safari on the Mac, cold, the same 147 programs take 1.8 s when they compile at once, against 13 s one at a time.
- On 4 October 2026, the shaders page never finished on the Galaxy Tab A9 Plus (Adreno 619, 4 GB). It started all 1,113 programs at once, from about 51 MB of GLSL, and the driver held each one's compiled code until the end. Status reads timed out. Then the runner page counted from zero again on the same page, because the browser had reloaded the tab. A reloaded runner page resumes at the first page without a result. That repeated for 30 minutes. The 16-bit fault of the shader library check on the same tablet changes values in draws that finish, so it was not the cause. Batches keep the driver's memory to a few dozen programs, and the page answers status reads between them.
- Each uniform block and texture that a program's reflection names must be declared in its GLSL. A driver may remove a declared one that the program never reads, as GLSL allows, and the engine then binds nothing to it. The page lists such names as removed, and the run's notes give them. Adreno 830 removes the spot and point lights' shadow atlas from the shadows debug view, which reads only the sun's shadow map.
- The mip levels page makes the mip levels of one layer of a texture array on WebGL2 in several ways, and reads every level back. It then copies an array into one of twice the layers, as the texture store grows an array. The check fails when the engine's way writes a wrong level, or its copy a wrong layer. The other ways are facts about the driver: plain draws, spare textures, `generateMipmap`, blits, and copies through a buffer. The run's notes say which of them work. [Browser faults](implementation-notes.md#browser-faults) gives the Galaxy S25's results.
- The skinning pass page runs WebGPU's skinning shader on fixed meshes, on WebGPU and in compatibility mode. It lays out the mesh page, the pass's table and the joint texture as the renderer does, then reads back the skinned vertices. A draw then reads each part's vertices from its region of the skinned vertex buffer, as the scene passes do. The CPU skins the same vertices. The cases change one thing at a time. Joints are 8-bit or 16-bit, and weights normalized 8-bit or float. Rigid cubes each follow one joint, as the glTF loader makes of meshes that a clip moves. A column blends two joints, as a character does. The check fails when a case that the renderer makes comes out wrong. Two more cases tell a fault of the table from one of the joint texture: one dispatch per part, and a joint texture written whole. The run's notes say which cases the device gets right.
- The shader library page runs every function of the WGSL shader library on the GPU, on WebGPU and on WebGL2. Each value must match its TypeScript reference within a tolerance that allows for the GPU's rounding. A wrong value names the function, its expected values and the values the GPU gave.
- The checks plan runs every test of the image test manifest, and compares each image with the real-GPU reference at the device tolerance. [Image tests](image-tests.md) covers the tolerance, device references and the review of new images.
- The texture page, one of those tests, replays every texture command of the GPU layer on each tier. Every tier must draw one image.
- The stats page shows the stats overlay and reads the sketch's frame figures on each GPU path. The overlay must sit on the canvas's corner and show each thread. The figures must name every thread, with nonzero frame rates. Both load their code on demand, which a worker's dynamic import must allow.
- The KTX2 page loads files of ETC1S and UASTC data on each GPU path. Each file must become the format that the device's WebGPU features or WebGL2 extensions allow, with the GPU bytes of its blocks. The run's notes give the formats. On the iPad and the S24+, expect ETC2 for ETC1S data and ASTC for UASTC data. The KTX2 image tests then draw the same files in BC7, ASTC and RGBA8, where the device has them.
- The quality page starts the engine with every choice left to it. The run's notes give the quality preset it chose, with the GPU path and the device hints it chose from. The check fails when the preset differs from the chooser's answer for those hints. Expect Low on the S24+, Medium on the iPad, and High on the Mac.
- The preset change page starts the engine at Medium, then changes to Low. It names Medium with the engine's `?preset=` switch, because the crash marker can lower a preset that the page's option names. The check fails when the engine started at another preset. On 2 October 2026, Chrome on the S24+ found a crash note that an earlier start had left. So it started at Low, and the change to Low changed nothing.
- The capture page compares the PNG file of `engine.capture()` with the frame's pixels. Brave's Shields change a few bytes of each image that a canvas encodes, each by one step, to defeat fingerprinting. In Brave, the check allows such changes in up to 1% of the bytes, unless the run passed `--shields off`.
- The image tests read frames through the engine's capture, which does not use the canvas. A frame that never reaches the screen still passes them. After a change to how frames reach the canvas, look at a demo page, and on a phone check `adb logcat` for GL errors.
- The parity plan's pages get `?preset=high`, as the image tests do, so a phone or a tablet draws the desktop's preset. The three.js twin of S4 copies that preset's settings. The parity plan's null3D pages use the engine's hold mode, which steps each scene to its hold time before it draws. On a slow device, that adds the update time of 121 frames to each hold page. A page whose sketch fails reports the error at once, with the sketch time where it happened.

## Benchmark runs

- The bench and scale plans load the production build of the benchmark pages, as the benchmark tools on the Mac do. [Benchmarks](benchmarks.md#production-builds) says why.
- The runner builds the pages into `target/bench-pages` before the run. The dev server serves the build under the load routes, as it serves the startup loads, with one address prefix for each run and runner.
- The phone over USB and the tablet over the local network both reach the main checkout's dev server, so both load the same build.
- A dev server that started before the load routes served the benchmark pages cannot serve these plans. The runner then stops and asks you to restart that server.
- After every benchmark, scale, governor, soak or startup run, archive it: `bun run bench:archive <run>`. Commit the record in `bench/results`, and add the rows that it prints to [Benchmark results](benchmark-results.md). Do the same for runs of `bun run bench:run` and `bun run gate` on the Mac. [Benchmarks](benchmarks.md#the-results-archive) says what a record keeps.
- After its timed runs, the bench plan runs the visual page of each scene on each GPU path, from the dev server. The first timed run of each null3D page captures its frame. The summary prints the shadow figures beside the timings, and the runner saves the frames in the run's folder. [Benchmarks](benchmarks.md#visual-figures-and-captured-frames) says what they show.

## Startup times

Two tools time the start of the engine test page, from navigation to the first frame. Both load its production build, built with relative addresses into `target/startup-pages`.

- `bun run bench:startup --android` times Chrome on the phone through Chrome's debugging socket. It loads every thread mode five times cold and five times warm, on Slow 4G and at full speed. [Benchmarks](benchmarks.md#startup) describes the tool.
- `bun tests/real-browsers.ts --plan startup` times the other browsers through the runner, such as Safari on the iPad. The runner cannot limit a device's network, so these loads run at the speed of the USB cable or the local network.
- The startup plan first loads each thread mode once to fill the cache. Then each of five runs loads every mode cold and then warm. `--runs` changes the number of runs.
- A cold load uses addresses that the browser has never seen. The dev server and `vite preview` serve each load's files under a path prefix of its own, which they strip. No cache holds any file of the load, so every file downloads and the browser compiles the core and the scripts from scratch.
- The server also puts a custom section of its own at the start of each cold load's core. Without it, Chrome can reuse a core with the same bytes that it compiled earlier in the same process, as in the runner's tab.
- A warm load repeats the addresses of its mode's first load, as a repeat visit does. The browser checks the page again and takes the other files from its cache.
- The tools never clear a browser's cache, cookies or storage. Each cold load leaves its files in the cache, under addresses that no later load uses.
- The browser and the GPU driver keep compiled shaders across loads, and the tools cannot clear them. So on a phone or a tablet, even a cold load can draw with shaders that an earlier load compiled.
- In the runner, a warm load repeats the load in the same tab, so it can also hit the browser's memory cache.
- The server sends the files as a host that compresses ahead of time does: Brotli when the browser accepts it, and gzip otherwise. Safari accepts Brotli only over HTTPS. Hashed files are immutable, and the page is checked again on each visit.
- The requests and kilobytes in a report are what the server sent for the load. A warm load usually makes one request, the check of the page, and downloads nothing.
- The report gives the medians of each thread mode and kind of load, with times from navigation start. They mark when the page script ran, the GPU probe finished and the core was ready. They also mark when the engine had started, and when its first frame was submitted and finished.
- A dev server that started before the startup routes existed cannot serve the loads. The runner then stops and asks you to restart that server.

To collect the numbers, rest each device first and close its other tabs:

- Chrome on the phone: `bun run bench:startup --android`.
- Safari on the iPad: open its runner page, then run `bun tests/real-browsers.ts --plan startup --lan ipad-safari`.

## The depth plan

- The `depth` plan runs the depth precision tests of the image test manifest. Their scene holds two surfaces 1 cm apart at each of 11 distances from 1 m to 10 km. The plan draws it on each GPU path in the device's own depth mode, then on WebGL2 with `?depth=standard`, `?depth=reversed-gl` and `?depth=reversed`.
- The run's summary gives each page's fighting pixels, where the farther surface shows through: the count over all distances, and the share at each distance.
- The fighting pixels past 40 m never fail a page. The page paints them as the nearer surface, so its image compares with the references as every manifest test's does. The manifest's expectations fail a page that drew another depth mode than it asked for, lost ties, or fought within 40 m. A browser without `EXT_clip_control` draws `?depth=reversed` as `reversed-gl`, which the summary notes.
- The phone and the iPad run it from the main checkout: `bun tests/real-browsers.ts --plan depth --allow-no-webgpu --android chrome --lan ipad-safari`. The Mac's browsers run it with `bun tests/real-browsers.ts --plan depth Safari Firefox "Google Chrome"`.
- Each tile's count depends on how its surfaces' corner depths round, so a farther tile can fight less than a nearer one. Compare the modes by their counts over all distances.

## The overload plan

- The `overload` plan runs the GPU-bound page (`tests/pages/overload.html`) twice on each GPU path. The first run keeps the engine's limit of two frames waiting on the GPU. The second adds `?queue=off`, which leaves the queue to the browser.
- The page draws layers of detailed spheres, about 16,000 triangles each, that never move, so the GPU does nearly all the work. It doubles the spheres at each step and measures each step for a second. At the first step where the lower of the presented and completed rates falls below half the display's rate, it measures 5 seconds and stops.
- The run's summary gives each page's presented and completed rates at that step, and whether they parted by more than 10%. It also gives the time from submit to completion, the frames in flight that it makes, and the GPU time.
- The display's rate comes from the lightest step. Without the engine's limit, Chrome slows the drawing worker's frame callbacks to the GPU's pace. The refresh meter then reads a rate far below the display's.
- [D-11](decisions/D-11-frames-in-flight.md) holds the results. The phone and the iPad run it from the main checkout: `bun tests/real-browsers.ts --plan overload --allow-no-webgpu --android chrome --lan ipad-safari`. The Mac's browsers run it with `bun tests/real-browsers.ts --plan overload Safari Firefox "Google Chrome"`.
- Without the limit, a queue can hold seconds of frames. A page then takes a while to stop, so each page gets 2 minutes.
- `?spheres=<n>` makes the page measure that many spheres alone. Use it to compare switches, such as `?queue=3`, at one load.

## The skinning plan

- The `skinning` plan times two ways to skin characters on WebGL2, for [D-10](decisions/D-10-webgl2-skinning.md). The page (`tests/pages/skinning.html`) draws with WebGL2 calls of its own, and no engine code runs. So it can time the path that the engine does not take. The engine skins in the vertex shader, as D-10 decided.
- The scene is a crowd of generated characters on a ground plane, under a directional light with 1 to 4 shadow cascades. Each character has 2,560 vertices and a chain of 32 joints, with four joint weights per vertex. The page bends each chain every frame and uploads the joint matrices to a float texture.
- The vertex shader path skins each character again in each pass that draws it: each cascade and the main pass. The transform feedback path skins each character that some pass draws once per frame, into a buffer of positions and a buffer of normals. Then the cascades and the main pass draw those buffers as plain vertices.
- Both paths cull the crowd per pass on the CPU, and fit each cascade's box to its slice of the view, as the engine does. The frame is 1280 x 720 pixels on every device, with 2048 x 2048 texels in each cascade.
- Each page first draws one pose both ways and compares the two images. It fails when more than 0.1% of the pixels differ by more than 2 levels.
- Then the page draws each path's frames back to back in batches of about 100 ms. It reads a pixel at the end of each batch, which waits for the GPU. The paths take 12 turns each, so heat slows both alike. The figures are medians per frame: the whole frame, the JavaScript, and the GPU time where the browser has timer queries. Phones and tablets have none.
- The plan runs each crowd of 50, 100, 200 and 500 characters with 1, 2, 3 and 4 cascades: 16 pages. The run's summary gives each page's characters per pass, each path's figures, and the share of the frame time that transform feedback saves.
- Run it on the phone and the iPad from a checkout of the branch that holds the page: `bun tests/real-browsers.ts --plan skinning --android chrome --lan ipad-safari`. Turn on Limit Frame Rate on the iPad first, and start the phone cool.
- The page takes `?characters=`, `?cascades=`, `?rounds=` and `?warmup=` (milliseconds), to time one load by hand.
- The `skinning-webgpu` plan times the same scene on WebGPU, for [D-20](decisions/D-20-webgpu-skinning.md). Its page (`tests/pages/skinning-webgpu.html`) draws with WebGPU calls of its own. Its vertex shader path skins in every pass, as on WebGL2. Its other path skins once per frame in a compute pass, into one buffer of positions and normals. The cascades and the main pass then draw that buffer.
- The WebGPU page uploads the joint matrices to a float texture for its vertex shaders, or to a storage buffer for its compute pass. It submits each frame on its own, and waits for the GPU at the end of each batch. Where the adapter has timestamp queries, it also reports the GPU time from each batch's first pass to its last, per frame. It takes the same switches, and `?gpu=compat` asks for a compatibility mode adapter.
- Run it on the iPad and on the Mac: `bun tests/real-browsers.ts --plan skinning-webgpu --lan ipad-safari "Google Chrome"`. The phone has no WebGPU. The browser tests run both pages with a small crowd (`tests/image/skinning.spec.ts`).

## The effect cost plans

- The `bloom` plan and the `ao` plan measure what bloom and ambient occlusion cost, for [D-21](decisions/D-21-effect-chain.md). Their page (`tests/pages/effect-cost.html`) draws the effect's scene over the whole window, at a fixed render scale with the governor off. Its `effect` switch names the effect: `bloom`, the default, or `ao`.
- After 2 seconds of play, the page measures 2 seconds with the effect off and 2 with it on, three times each. Heat then slows both sides alike. The page reports the medians of each side's frame interval and CPU time. Where the browser has a GPU timer, it reports the GPU time per frame too.
- Each plan runs the page on each GPU path at render scales of 1 and 0.5. The difference between the sides is the effect's cost at that scale.
- Ambient occlusion turns the depth prepass on with it. So the `ao` plan also runs each page with the prepass on in both halves, in the items that end in `-prepass`. Their difference is the cost of ambient occlusion's own passes, and the rest is the prepass's.
- The `bloom-sizes` plan runs the bloom page on WebGPU at each base size of bloom's chain, through the page's `size` switch. The sizes are 512, 256, 128 and 64 texels on the shorter side. Each halving drops a level, so the sizes draw 15, 13, 11 and 9 passes. Its results split bloom's cost into a cost per pass and a cost per texel.
- The `ao` plan also draws three.js's `GTAOPass` on the same scene and canvas (`bench/pages/threejs/ao-cost.html`, item `ao-threejs-100`). Its page times each frame with WebGL2's timer queries where the browser has them, and else waits for each frame with `readPixels`.
- Run them on the iPad and the phone: `bun tests/real-browsers.ts --plan bloom --android chrome --lan ipad-safari`, and the same with `--plan ao`. Turn on Limit Frame Rate on the iPad first, and start the phone cool. On a device that draws faster than its display, the GPU time tells the cost. The frame interval only shows whether the frames kept the display's rate.

## The environment plan

- The `environment` plan measures what the environment's light costs, for [D-19](decisions/D-19-environment-maps.md). Its page (`tests/pages/environment-cost.html`) draws 8 planes of the standard material over the whole window. Each draws over the last with no depth test. The render scale stays at 1, with the governor off.
- After 2 seconds of play, the page measures 2 seconds without an environment and 2 with the built-in room. It does so three times each, as the bloom plan does. It reports the medians of each side's frame interval and CPU time, and the GPU time per frame where the browser has a GPU timer. The difference between the sides, over the 8 layers, is the lookup's cost for one layer of pixels.
- The plan runs the page on each GPU path: 3 pages. `?layers=` and `?scale=` change the layers and the render scale.
- Run it on the iPad and the phone: `bun tests/real-browsers.ts --plan environment --android chrome --lan ipad-safari`. Turn on Limit Frame Rate on the iPad first, and start the phone cool. The iPad gives GPU time. The phone gives none, so its figure is the frame interval. Raise `?layers=` until the frames miss the display's rate without the room: the GPU then sets the pace.

## The occlusion plan

- The `occlusion` plan measures what software occlusion culling costs and saves on WebGL2, for [D-41](decisions/D-41-software-occlusion.md). Its page is `tests/pages/occlusion-cost.html`.
- The page draws a city over the whole window. It has 64 buildings that block the view, and 3,000 spheres and 20,000 boxes along the streets. A camera flies down one street. The render scale is fixed at 1 and the governor is off.
- After 2 seconds of play, the page measures 2 seconds with the culling off and 2 with it on, three times each. Heat then slows both sides alike.
- It reports the medians of each side's figures. They are the busiest thread's CPU time per frame and all threads' together, and the sketch worker's time with its culling step. Then come the render worker's time, the job workers' time together and the GPU time where the browser has a timer. Last come the frame interval, and the entries that the frame drew and that the culling hid.
- The culling saves when the render worker's time and the GPU's time fall by more than the job workers' and the sketch worker's time grows.
- Run it on the phone and the iPad: `bun tests/real-browsers.ts --plan occlusion --android chrome --lan ipad-safari`. Turn on Limit Frame Rate on the iPad first, and start the phone cool. The page takes `?rounds=` and `?seconds=` to time one load by hand.

## The animation plan

- The `animation` plan times the core's animation step on the job workers, for [D-26](decisions/D-26-animation-clips.md). The page (`tests/pages/animation.html`) draws nothing. It runs the core on its own thread, as the sketch worker does, and starts its own job workers.
- The crowd is generated: each character has 48 joints in five chains, and two clips. One clip has keys every thirtieth of a second for one second, the other every 24th for 0.75 s. Each frame, every character blends both clips at its own times, with weights of 0.6 and 0.4.
- Each frame starts in a `requestAnimationFrame` callback and wakes the job workers, as the engine's frame does. After 60 frames of warm-up, the page times 240 frames. It reports the step's median, 90th percentile and mean on its own thread, and the job workers' busy time per frame, added up. It also checks that every skinning matrix is finite and that two characters got different poses.
- The plan runs a crowd of 100 and one of 500 with the default job worker count. The run's summary gives a row for each.
- Run it on the phone and the iPad: `bun tests/real-browsers.ts --plan animation --android chrome --lan ipad-safari`. Start the phone cool. The page takes `?characters=`, `?joints=`, `?jobs=`, `?frames=` and `?warmup=`.
- The browser tests run the page with a small crowd (`tests/image/animation.spec.ts`). The native benchmark of the same step is `bench_animation_crowd` in `crates/null3d-core/tests/bench.rs`.

## The governor plan

- The `governor` plan runs the quality governor's stress test (`tests/pages/governor.html`) in two stages on each GPU path. The browser tests run the same page (`tests/image/governor.spec.ts`).
- The walk forces every live step down and back up. The sketch spins its thread for two frame budgets in each frame, a load that no setting lightens. The governor lowers the render scale from 1 to 0.9 first. Then the far cascades go from every 4th frame to every 8th, and the shadow filter from 5 to 3. After the load stops, it takes each step back up. The page captures a frame after each step and compares it with the first in blocks of 16 pixels. It also measures the frames all along: no frame may stick, and no pipeline may build.
- The hold shows the governor holding a target under stress. A plane in front of the camera runs a loop for each pixel, so the GPU's work follows the render scale. With the governor off, the page grows the loop until the GPU draws under 75% of the target. With the governor on, the render scale must bring the rate back: 70% of the last 15 seconds must hold 90% of the target. One failed step up costs about two seconds, which the share allows.
- Run it on the phone and the iPad: `bun tests/real-browsers.ts --plan governor --allow-no-webgpu --android chrome --lan ipad-safari`. Each stage takes about a minute. `?work=` fixes the hold's load, and the engine's `?fps=30` lowers the target. CI skips both stages: its software GPU takes 300 to 400 ms for some frames of the scene without a load.
- Run it with drawing on the page's thread too, where Safari's frame callbacks slow with the GPU: `bun tests/real-browsers.ts --plan governor --switches render=main --lan ipad-safari`, and `Safari` in place of `--lan ipad-safari` on the Mac. Each measurement's refresh rate must stay at the display's.
- The cost of the page thread's checks of the display: S4 on the warm iPad at Medium with the governor off. The checks are on and off in turn. There the frames run under 90% of the display rate, so the checks run. Warm the iPad first, then run each command twice, in the order A, B, A, B:
  - A: `bun tests/real-browsers.ts --plan bench --lan ipad-safari --scenes s4 --pages null3d-webgpu,null3d-webgl2 --runs 3 --switches 'render=main&preset=medium&governor=off'`
  - B: the same with `--switches 'render=main&preset=medium&governor=off&display-check=off'`
  - Compare the presented frame rates of A and B on each GPU path. Each run's refresh rate must stay at 60 Hz in A. [D-11](decisions/D-11-frames-in-flight.md#drawing-on-the-pages-thread-m2-r3) gives the expected cost.

## The tab memory plan

- The `tab-memory` plan finds how much memory one tab can use, for [D-12](decisions/D-12-memory-budgets.md). The page (`tests/pages/tab-memory.html`) grows one kind of memory in steps of 32 MiB until something gives. It grows GPU textures or GPU buffers on one GPU path, or a shared WebAssembly memory.
- Each step allocates textures of 2048 x 2048 texels or buffers of 16 MiB. It fills every byte with data that does not compress, and waits until the GPU has taken it. The WebAssembly memory grows and fills its new pages.
- Growth ends when the browser closes the tab, refuses an allocation or takes the GPU away. It also ends when a step gives no answer for a minute. On a desktop it ends at a cap of 8 GiB, and at 4 GiB for WebAssembly memory.
- The plan grows textures, then buffers, on WebGPU, then on WebGL2, then WebAssembly memory. `--runs 2` repeats it. The run's summary gives each growth's last MiB that lived and how it ended, and the lowest point at which each kind failed.
- Each page of the plan may end the tab. On the phone, the runner tool opens a new runner page after each dead tab, so the phone runs it unattended: `bun tests/real-browsers.ts --plan tab-memory --allow-no-webgpu --android chrome`.
- On the iPad, only Safari can reload a runner page that a crash closed, and it stops after crashes close together. So the iPad runs the plan only while someone is at it, never in a queue of unattended runs. The runner tool refuses the plan on `--lan` devices without `--attended`: `bun tests/real-browsers.ts --plan tab-memory --lan ipad-safari --attended`. Start from a Safari that was quit and opened again. When Safari shows its error page instead of the runner page, reload the tab. After the run, quit Safari and open the runner page again, before any other run on the iPad.
- `?step=` and `?most=` change the step and the cap, in MiB, for a run by hand.

## The soak plan

- The `soak` plan closes T-24. First the scene page acts out a GPU loss in each thread mode on each GPU path. The engine must draw the whole scene again on a new device, match the scene's references, and count one loss.
- Then S4 plays for 30 minutes on each GPU path, from the benchmark pages' production build. `--minutes` changes the length. The page measures the engine once a minute, and stops early when the engine fails.
- The run's summary gives each soak's preset. S4's soak sets none, so the device's own check picks it, and the summary gives the frame rate of each preset that the check tried. It gives the GPU losses that the engine recovered from, and in which minutes. It also gives the median and lowest frame rate of a minute, and the growth of the WebAssembly memory. A recovered loss is a finding; an engine failure, or a minute with no frames, fails the page.
- The iPad runs it with `bun tests/real-browsers.ts --plan soak --lan ipad-safari`. Turn on Limit Frame Rate, and keep the iPad's screen from locking.
- On 2 October 2026, Safari 26.6 on the iPad passed all 12 pages (run 20261002-173220-soak). The engine came back from the acted-out loss in each of the ten thread modes and paths. In 30 minutes of S4 on each path, the GPU was never lost, the engine never failed, and the WebAssembly memory did not grow. The preset check chose Low on both paths.
- In that run, WebGPU held 60 frames per second for 3 minutes. Then the GPU time per frame rose from 9.4 ms to about 14 ms. The rate settled at 55.5, likely as the iPad grew warm. WebGL2 held 31.5 frames per second all through.

## The warm-up time plan

- The `warm-up-time` plan closes T-26, for [D-13](decisions/D-13-shader-variants.md) and the loading screens guide. The page (`tests/pages/warm-up-time.html`) starts a sketch on a canvas that fills the window, at the preset that the engine chooses.
- Each load reports its pipeline wait: the warm-up, `load.warmUpMs`, plus the first draw, `load.firstDrawMs`. Where the browser cannot compile WebGL2 programs in the background, the warm-up is about 0 and the first draw waits for the compiles. Each load also reports the time from `createEngine` until the first frame was on screen.
- The plan loads each benchmark scene at its own count and each demo, on each GPU path. The first two loads are first visits. They take `?shaders=fresh`, which gives each shader's text a new comment, so the browser cannot reuse programs that it compiled before. They also take `?check=fresh`, so the preset check measures again. Then two loads take the shaders as they ship and the preset check's stored result, as repeat visits do. The last of them reuses what the browser compiled for the first.
- A fresh comment stops the browser's cache of compiled programs, which keys on the shader's text. A GPU driver may still keep compiled code of its own.
- The phone runs it with `bun tests/real-browsers.ts --plan warm-up-time --allow-no-webgpu --android chrome`, and the iPad with `--lan ipad-safari`.
- D-13 holds the results of 2 October 2026. On the iPad, the time until the first frame is mostly the preset check, about 1 s for each preset that it measures. The S24+ starts at Low, which skips the check. Since [D-17](decisions/D-17-stored-preset-check.md), repeat visits take the check's stored result instead.

## Browser apps on the Mac

- Keep the Mac's screen unlocked and its display awake during runs. Safari stops running pages while the Mac is locked, and the runner then waits until its deadline. Chrome started by Playwright keeps running.
- A runner page in a Mac app that sends nothing for its current page's timeout and 30 more seconds counts as stopped. The runner then prints the Mac's state: the screen lock, the memory pressure and the size of each web content process. It closes the quiet runner page in Safari, and opens a new one at the same page, so that page runs again. That page's result gets a note that says so.
- In CI, the runner cannot close the quiet runner page, because macOS asks for permission to control Safari. A quiet page can also still be running, hidden behind the new one. So each runner page claims its runner's results when it starts. The dev server refuses results from an older runner page, and that page then stops and closes its tab.
- A page where the runner page stops twice fails, and the next runner page starts after it. The runner replaces a runner page at most twice per run, and never on a tablet.
- When a page that may end its tab goes quiet, the runner records its last progress as its result. On the phone, Chrome and Brave then show their crash page in place of the runner page. So the runner opens a new runner page, which goes on with the next page. These new runner pages do not count against the two. On the phone, the runner never replaces a runner page that stopped on another page.
- Close a Safari tab that a test opened with AppleScript: tell Safari to close the tabs whose address holds `localhost:517`.
- CI runs Safari on GitHub's macOS machines and Firefox on its Linux machines. Neither browser gets WebGPU there, so the jobs pass `--allow-no-webgpu`, and those pages count as skipped. Firefox on Linux runs under a virtual display (`xvfb-run`) and draws WebGL2 with llvmpipe, Mesa's software renderer. The runner's record names it as a software renderer. On macOS, Firefox had no WebGL2 either.
- Firefox moved to Linux on 5 October 2026. Its two shards took 8.1 and 7.9 minutes there, against 12.9 and 11.6 minutes on macOS in the merge queue run before. GitHub gives many more Linux machines than macOS machines, so only Safari now waits for macOS machines. Without WebGPU, Firefox on Linux skips the pages for WebGPU and compatibility mode. Its first run passed 294 pages and failed 4, all images within 0.8% of the Mac's references, as [Image tests](image-tests.md#ci) says.
- CI runs the checks plan in each browser in shards of its own, such as `real-browsers (Safari 1/2)`. CI's `build` job first runs `bun tools/build-wasm.ts --pages-only` on Linux, which builds what the test pages need. That is the two WebAssembly files, and the shader compiler that the dev server runs on the WGSL in test sketches. Each browser's job downloads them.
- Until 1.0, these jobs test only in the merge queue, once for each pull request before it merges. On a pull request and on main, the jobs are skipped, and CI's `ci-passed` job accepts that. Run `bun run test:real-browsers Safari Firefox` on the Mac before you push a change that Safari or Firefox may treat differently.
- The runner's `--shard <i>/<n>` runs one of n shards of a fixed plan. The plan's items split evenly, and each item stays with the items whose results its check compares with. Examples are the capabilities page's second load and an image test's first thread mode.
- On 30 September 2026, one job for both browsers took about 7.7 minutes. It built for 1.5 minutes, then ran the two browsers in turn for 5.6 minutes. The Rust cache did not shorten the build much. The threaded build compiled the standard library again each time, and the shader compiler took another half minute.
- The split jobs took 3.3 minutes for Safari and 3.4 for Firefox, after a Linux build of 1 minute. That is 6.6 minutes of macOS machines per run. Two shards per browser took at most 2.3 minutes each, but 8.0 machine minutes and four machines at once.
- The plan grows with each feature. On 1 October 2026, it held about 450 items for each browser, at about 2 seconds each. One shard per browser then took about 14 minutes.
- GitHub's free plan gives 5 macOS machines at once. CI runs Safari in 2 shards, so the 2 macOS jobs of one queue run start at once when 2 machines are free. Until 5 October 2026, Firefox's 2 shards ran on macOS too, and one queue run needed 4 machines. At most once an hour, main's benchmark run holds 3 machines for about 17 minutes, as [Benchmarks](benchmarks.md#the-benchmark-job-in-ci) says. The queue's jobs then wait for machines. Until 5 October 2026 it ran after each merge. While that run holds them, a queue run gets 2 machines, so a third Safari shard would wait for a second turn. When several queue runs wait for machines, more shards only add the time that each job takes to start.

## Android phone

The team's phone is a Galaxy S24+ (SM-S926B, Exynos 2400, Android 16). It runs only the checks that need its USB cable; cloud phones run the rest, as [Which device runs a check](#which-device-runs-a-check) says.

- Connect it by USB with USB debugging on, and trust the Mac. `bun run android` forwards the dev server's port to the phone. The runner opens each browser's runner page itself.
- For benchmarks, fix the display at 60 Hz: `adb shell settings put secure refresh_rate_mode 0` (Motion smoothness: Standard). A value of 1 gives adaptive rates up to 120 Hz, for the 120 Hz pass. Set brightness to manual, and keep the performance profile at Standard.
- Standard is a ceiling, not a fixed rate. Android still lowers the display to 24 Hz when the screen barely changes, as under the runner's report or on a still page. Every frame callback then comes 41.7 ms apart. A page whose check times frames must stay on screen. [A hidden canvas and the display's rate](implementation-notes.md#a-hidden-canvas-and-the-displays-rate) has the evidence. The runner's own reading of the rate had the same fault, as [A display whose refresh rate changes](#a-display-whose-refresh-rate-changes) says.
- To see the display's rate changes, read SurfaceFlinger's mode history: `adb shell dumpsys SurfaceFlinger | grep -E "ID=(17|20) "`. On the S24+ at full resolution, mode 17 is 60 Hz and mode 20 is 24 Hz. A Perfetto trace with the `android.surfaceflinger.frametimeline` data source and the `gfx` category shows the frames that each layer sent and Android's vote for each layer.
- Heat decides phone results. Within two minutes of S1 at phone scale, Samsung's heat manager reaches throttle level 2 (`adb shell getprop sys.siop.level`). Its fastest cores then run at about half speed. The caps lift after a few minutes of rest.
- Start each browser's run cool: throttle level 0 and a skin temperature of at most about 37 °C (`adb shell dumpsys thermalservice`). The core speed caps are in `/sys/devices/system/cpu/cpu*/cpufreq/scaling_max_freq`. USB charging adds heat.
- During a run, the runner reads the phone's heat every 10 seconds: the temperatures, each core group's speed cap and Samsung's throttle level. Each result records the heat it ran in.
- Do not touch the phone during a run, because a tap can close the runner's tab. A runner page that goes quiet counts as stopped after its current page's timeout and 30 more seconds.
- Close stale pages through Chrome's debugging protocol: `adb forward tcp:5176 localabstract:chrome_devtools_remote` (the main checkout's debugging port: the dev server's port plus 3), then `Target.closeTarget` for each page on `localhost`.
- When Chrome's debugging socket does not answer, the request for its page list (`/json/list` on the forwarded port) hangs. Then stop both browsers, which ends the runner's stale pages: `adb shell am force-stop com.android.chrome` and `adb shell am force-stop com.brave.browser`.
- The `scale` plan finds phone scale: the largest S1 count at which three.js holds 30 frames per second. Run `bun tests/real-browsers.ts --plan scale --allow-no-webgpu --android chrome`. In Chrome 154 on 29 September 2026, it was 300,000 from a cool start and 250,000 on a warm phone.
- `--scenes s5` searches S5's characters instead, and `--scenes s1,s5` searches both, one after the other. S5's search starts at 25 characters and doubles up to 3,200, where S1's starts at 1,000 objects. Each character skins about 5,000 vertices in every pass, so a phone carries far fewer of them than of S1's boxes. The runner then prints the bench plan's command for each scene, such as `--plan bench --scenes s5 --n 400`.

## iPad

The team's tablet is an iPad Pro 11-inch with 8 cores. Safari there reports a Mac user agent.

- The iPad reaches the Mac over HTTPS on the local network. `bun run dev-cert` makes the certificate. Copy its root certificate to the iPad, install the profile, and turn on full trust in Settings > General > About > Certificate Trust Settings.
- `NULL3D_HTTPS=1 bun run dev` serves HTTPS on port 5174 under the Mac's `.local` name. The dev server sends it over HTTP/1.1, because Safari on an iPad sometimes stops loading a worker's modules over HTTP/2. That failure looks like an engine start that never finishes.
- Each browser opens its own runner page: `https://<mac>.local:5174/tests/pages/runner.html?listen&runner=ipad-safari` in Safari. The name must match the browser, or the page waits for another browser's runs. Pass `--lan ipad-safari` to the runner.
- For benchmarks, turn on Settings > Accessibility > Motion > Limit Frame Rate, which holds the display at 60 Hz.
- Safari there holds only a few shared memories at once. It holds 6 with the engine's default maximum of 1 GiB, 18 at 256 MiB and 3 at 4 GiB. A test that stops a worker inside a blocking wait leaks one until Safari quits. After such a test, quit Safari from the app switcher and open the runner page again.
- After a tab crash, Safari on the iPad can stay stuck until it is quit and opened again. It shows its own error page in place of the runner page, and no later run starts. On 2 and 3 October 2026, this held up the iPad's runs of several pull requests after the tab memory plan. Quit Safari from the app switcher after any run that crashes a tab, before the next run.
- Safari on the iPad keeps memory from earlier runs until it quits. On 2 October 2026, a checks run failed 433 of its 490 pages. Its first page failed with "Out of memory", and every later page with E1109. Safari had run out of room for shared memory before the run began. After a quit and a fresh start, the same plan passed 490 of 490. A run that fails from its first page this way says nothing about the code. The runner now ends such a run after a few pages, as [Guards on device runs](#guards-on-device-runs) explains.
- Until 3 October 2026, the memory built up within runs too. Each page that left its engine running, such as the stats pages, kept its engine's memory once the runner removed its frame. The engine now ends its job workers' waits when its page goes away, as [the implementation notes](implementation-notes.md#threads-and-shared-memory) explain. The `frame-restarts-*` checks start more engines in frames than the iPad has room for, and remove each frame while its engine runs.
- Brave with Shields on reports 3 cores, where Safari reports 8, so the engine starts fewer job workers there.
- The iPad's scale at 60 Hz was measured in Safari 26.6 on 29 September 2026. three.js's WebGPU renderer holds 30 frames per second up to 240,000 objects, and its WebGL renderer up to 140,000.

### What the iPad says about the iPhone

The team has no iPhone, so the iPad stands in for Apple's phones. It proves some things and not others.

- Safari on the iPad and on the iPhone is one engine: WebKit, with the same WebGPU and WebGL2 code on Metal. So correctness and feature support carry over. So do Safari's faults, such as the waits of its WebGL2 path for the GPU and the late release of shared memory.
- Memory does not carry over. iPhones have less RAM, and their tabs die sooner. The iPad's tab died at 2016 MiB of GPU textures. Safari also limits how many shared memories of 1 GiB a page can hold at once.
- Speed does not carry over. An iPhone has a smaller GPU, and it throttles earlier as it warms.
- The screen differs. An iPhone has a pixel ratio of 3, against the iPad's 2, and Pro models refresh at 120 Hz.
- An iPhone without iOS 26 has no WebGPU, so the engine draws with WebGL2 there.

So the iPad shows that the engine works on an iPhone. It does not show that the engine is fast enough there, or that it stays within the iPhone's memory. That needs an iPhone in the device runs, with a runner page of its own, such as `--lan iphone-safari`.

## Which device runs a check

The owner set these rules on 4 October 2026. [D-53](decisions/D-53-technique-defaults.md) records them as ruling 10.

Real-phone tests run on BrowserStack Automate's phones wherever they can do the job: `bun run devices:cloud`, one session at a time. The owner's Galaxy S24+ serves only the checks that need its USB cable, or a run that the owner asks for. Examples are the runs that log the phone's heat, `bench:startup --android` and `bench:profile --android`. So testing no longer waits for someone to connect the phone.

Brave is no longer tested on any device. It draws with Chrome's engine, so its results repeat Chrome's. `bun run devices` runs Chrome on the phone and Safari on the iPad only. No command example names Brave. The runner still knows Brave and its Shields, for a run that the owner asks for by name. No plan or gate needs it.

The S24+ has no WebGPU adapter, so every check of WebGPU on Android runs on a cloud phone. These go to BrowserStack's Galaxy S25 (Adreno 830) and Pixel 9 (Mali-G715). The Pixel 10 and 11 (PowerVR) join where a check names them. Each runs on WebGPU and with WebGL2 forced:

| Check | Why | Plan or page |
| --- | --- | --- |
| Shadow image tests on WebGPU | three.js turns off hardware shadow comparison on every Android browser, after wrong shadow results on Adreno phones with no error ([three.js PR #32548](https://github.com/mrdoob/three.js/pull/32548)). From Chrome 149, Dawn works around it on Qualcomm GPUs for the 2D and 2D-array depth textures that null3D uses. Run the S25 with Chrome 149 or later, and with an older Chrome if BrowserStack offers one ([D-53](decisions/D-53-technique-defaults.md) ruling 28) | The checks plan's `shadows*` tests |
| GPU occlusion culling, quiet and loaded, with its image check | Bevy blocks it for driver crashes on Adreno 730 and older, Mali drivers before r48, and the Pixel 10 and 11. Unity turns it off on Qualcomm GPUs for missing objects. Add those GPUs where BrowserStack offers them: a Snapdragon Galaxy S22, a Mali phone with a driver before r48 | The `gpu-occlusion` plan |
| Skinning, compute against the vertex shader | [D-20](decisions/D-20-webgpu-skinning.md) needs an Android WebGPU phone and S5 | The `skinning-webgpu` plan, S5 |
| MSAA 4x against FXAA on Low | Whether WebGPU phones can afford MSAA at Low. Record whether Chrome draws WebGL2 through ANGLE on Vulkan, the only backend known to resolve MSAA in tile memory | S4 at Low |
| Half precision, low priority | The Pixel 9's Mali-G715 runs 16-bit floats at twice the rate, in vector math only ([D-09](decisions/D-09-half-precision.md)) | `bench` with `--switches half=on` |
| Culling shader counters | Qualcomm, Arm and Apple advise adding per workgroup first; no phone timing is published | `bench:run --compare` pages |
| Driver faults | Mali may crash with MSAA unless all uniforms are in bind group 0. Some Adreno drivers treat `int` as medium precision: the Galaxy Tab A9 Plus (Adreno 619) kept 16 bits of whole numbers declared without `highp`, so the GLSL build declares each one `highp` ([implementation notes](implementation-notes.md#browser-faults)). Adreno on WebGL may crash with more than one directional shadow light. Adreno 830 ran a write behind a false check in the skinning shader on WebGPU, which the skinning pass page catches ([Browser faults](implementation-notes.md#browser-faults)). Adreno 830 on WebGL2 leaves the arrays empty in a struct copied out of a uniform block, which the GLSL build refuses ([Browser faults](implementation-notes.md#browser-faults)). On PowerVR, zeroed workgroup memory is unreliable, and mip sizes of depth textures whose size is not a power of two come out wrong | The checks plan with MSAA on; S25 WebGL2 shadows with several cascades; the S25's environment image tests on WebGL2; the checks plan's `skin-pass-*` pages |

Compatibility mode on a real OpenGL ES driver runs on the Galaxy Tab A9 Plus (Adreno 619). A Mali device in compatibility mode joins if BrowserStack offers one. For the scene format on WebGL2, add a Valhall Mali phone older than the Mali-G710, such as the Pixel 6, if offered.

Four kinds of sitting serve the technique prototypes ([Technique review, October 2026](technique-review-2026-10.md#prototypes)). Each runs both sides of every comparison in turns, as the iPad needs.

1. The Mac with a quiet GPU, with no other Chrome running: occlusion culling, culling counters, prefilter cost, AO, bloom and skinning variants.
2. The iPad: AO at High and Medium, bloom, prefilter, upscaling, 16-bit cascades, the cascade blend, occlusion culling and skinning.
3. BrowserStack Automate's Android phones: the checks above, and the WebGL2 phone figures that the S24+ gave before.
4. The S24+ over USB: the checks that need the cable.

A cloud session gives no control of heat or refresh rate. Treat its timings as guides, from comparisons run in turns in one session. Where a gate item needs heat control, such as the 10-minute showcase runs, the owner decides between the S24+ over USB and a cloud phone.

Every run on a device and browser goes into [the record of tested devices](tested-devices.md), with its date, plan, commit and result.

## BrowserStack Live

[BrowserStack Live](https://www.browserstack.com/live) lends real phones, tablets and desktop browsers for live sessions. Each device opens the runner page over BrowserStack's tunnel to the Mac. The person picks the browser for each session.

- TestingBot was tried first, on 3 October 2026. Its device screens often did not load and its sessions dropped during runs, so the team moved to BrowserStack. TestingBot's rows stay in [the record of tested devices](tested-devices.md).
- BrowserStack is not a lasting subscription. There are no nightly runs and no runs on each merge. Each tier below is a manual sitting, or one command while the team has [BrowserStack Automate](#browserstack-automate).
- The tiers name device models, systems and GPUs. If BrowserStack lapses, another cloud, a borrowed device or a new team device of the same kind stands in.
- The iPad and the Mac stay the timing devices. Phone timings come from BrowserStack Automate's phones where they can, as [Which device runs a check](#which-device-runs-a-check) says. Cloud timings are only a rough guide, because nobody controls the devices' heat or display settings.

### Set up a session

1. Download BrowserStackLocal for macOS from BrowserStack. Check its signature with `codesign -dv --verbose=2 BrowserStackLocal`. It must print `Authority=Developer ID Application: Browserstack Inc (YQ5FZQ855D)`.
2. Keep the access key in `~/.browserstack`, with `chmod 600`. Never paste the key into a chat, a log or a commit. Start the tunnel with `./BrowserStackLocal --key "$(cat ~/.browserstack)"`.
3. Serve HTTPS from a checkout of main: `NULL3D_PORT=3000 NULL3D_HTTPS=1 bun run dev`. HTTPS then answers on port 3001.
4. The certificate must name `bs-local.com`. `bun run dev-cert` makes one that does.
5. In BrowserStack Live, pick the device and the browser. Turn on Self-Signed Certificate in the session's toolbar, so the device accepts the certificate. It does not work together with network throttling, so leave throttling off.
6. On the device, open `https://bs-local.com:3001/tests/pages/runner.html?listen&runner=<name>`. Type `bs-local.com` on every device. BrowserStack changes `localhost` to `bs-local.com` by itself in most browsers, but not in Chrome on iOS.
7. Start the run on the Mac with the same port and name: `NULL3D_PORT=3000 bun tests/real-browsers.ts --plan smoke --lan bsgalaxys25-samsung`.
8. End the session when the run ends, so the device does not keep pages running.

- Name each runner `bs<device>-<browser>`, such as `bsiphone17-safari`, `bsgalaxys25-samsung` or `bswin11-edge`. Write the device as one word. A device word that is also a browser word, as in `bs-moto-edge-50-chrome`, makes the runner expect Edge.
- The browser words are `safari`, `chrome`, `samsung`, `edge` and `firefox`. The runner warns when the page runs in another browser than its name says.
- Pass `--allow-no-webgpu` only where the tier's table expects no core WebGPU. On a device that should have it, a lost path must fail the run, as [GPU paths that a device lacks](#gpu-paths-that-a-device-lacks) explains.
- A session that drops leaves its results in place. Open a new session with the same runner name. The runner page starts at the first page without a result.
- After each run, paste the runner's row into [the record of tested devices](tested-devices.md). Add BrowserStack's device name to the device cell. Fill the GPU cell from the tables below where the browser hides the GPU.
- The runner marks a GPU name such as SwiftShader or Microsoft Basic Render Driver as a software renderer. That machine has no GPU, so its run tests the clear failure, not the GPU paths.

### What BrowserStack offers

These facts come from BrowserStack's [list of browsers and platforms](https://www.browserstack.com/list-of-browsers-and-platforms/live) and its [answer on mobile browsers](https://www.browserstack.com/support/faq/mobile/devices-amp-browsers/can-i-test-different-browsers-on-mobile-devices), read on 3 October 2026.

- Android devices offer Chrome, Edge and Firefox. Samsung devices also offer Samsung Internet. Opera is not tested: the owner left it out on 3 October 2026, and the runner records it as Chrome.
- iPhones and iPads offer Safari and Chrome. Every browser on iOS draws with WebKit, so Chrome there is only a check of the runner page.
- The phones run Android 10 to 17 and iOS 13 to 27. The newest are the Pixel 11 on Android 17, and the iPhone 18 Pro on iOS 27.
- The iPads include M-series models on iPadOS 26 and 27. The newest are the iPad Pro 13 2025 and the iPad Pro 11 2025, both with the M5.
- The desktops run Windows XP to 11 and macOS from Snow Leopard to Golden Gate. Windows and macOS offer Chrome, Edge and Firefox, in versions back to the 2010s. Safari comes with each macOS: 27 on Golden Gate, 26.4 on Tahoe and 18.4 on Sequoia.
- BrowserStack does not publish the desktops' GPUs. Its Windows 11 machines have none. On 4 October 2026, Chrome 154 and Edge there named Microsoft Basic Render Driver, Windows' software renderer, and gave no WebGPU adapter. Every WebGPU page failed with E1301, 30 of the smoke plan's 51, and the WebGL2 pages passed in software. Firefox gave no WebGL2 context either, and passed 2 of 51.
- So the device list runs Chrome and Edge on Windows with `--allow-no-webgpu`. Their WebGPU pages skip, and their runs test the WebGL2 path in software. Firefox on Windows is left out of the cloud runs, as it tests nothing there that Chrome's run does not. The cloud cannot test Intel, AMD or NVIDIA GPUs on Windows.

### What each GPU path needs

The tables say which GPU paths each device should offer. These rules come from [GPU tiers and backends](../docs/concepts/backends.md#the-three-tiers) and the browsers' notes.

- Core WebGPU: Chrome, Edge and Samsung Internet on Android 12 and later with Qualcomm Adreno or ARM Mali GPUs. Chrome also allows the Pixel 10's PowerVR GPU, with [known driver faults](https://github.com/playcanvas/engine/issues/8874). Safari 26 and later on iOS, iPadOS and macOS. Chrome and Edge on Windows and macOS with a GPU. Firefox on Windows, and on Apple silicon Macs.
- Compatibility mode only: Chrome on older GPUs whose adapter lacks core WebGPU's features, such as the Adreno 610.
- WebGL2 only: Android 10 and 11, Samsung's Xclipse GPUs, older PowerVR GPUs and Firefox on Android. Also iOS 18, and Safari 18 on macOS.
- Not supported: Safari 17 and older, since 5 October 2026 ([D-64](decisions/D-64-minimum-browsers.md)). The engine refuses to start there with a clear start error.
- A clear failure: Safari before 16.4, Chrome before 91 and Firefox before 89 lack WebAssembly SIMD, so the engine stops with E1303. A browser without any GPU path stops with E1301.

### Time per device

- On 3 October 2026, the smoke plan's 50 pages took 5 minutes on BrowserStack's iPad Pro 13 2025 in Safari. All 50 passed.
- Plan 10 to 15 minutes for the smoke plan on a phone with WebGPU. Slower phones and heat stretch the time.
- Where only WebGL2 runs, the runner skips about 30 of the 50 pages. Plan 6 to 8 minutes.
- A desktop takes about 8 to 10 minutes. A clear-failure check takes about 5 minutes.
- Add about 3 minutes per session to start it, turn on the certificate setting and open the runner page. Another browser on the same device needs a new session too.
- In Automate on 4 October 2026, with the tunnel's compression, the smoke plan took 9 to 11 minutes on most phones. These were the iPhones, the Galaxy S25 and the Pixels. It took 5 minutes on the iPhone 16 with WebGL2 only, 8.5 minutes on Windows 11, and 15.5 minutes on the Galaxy Tab A9 Plus. Opening each session took about 1 minute more.

### Tier A: each milestone's gate and each release

Tier A covers the devices with the most users, and the newest GPUs, systems and browsers. It takes about 2 hours 40 minutes.

| Device | System | Browser | GPU | Expected paths | Why | Minutes |
| --- | --- | --- | --- | --- | --- | --- |
| iPhone 17 | iOS 26 | Safari | Apple A19 | WebGPU, compatibility mode, WebGL2 | The most common new iPhone | 15 |
| iPhone 18 Pro | iOS 27 | Safari | Apple | WebGPU, compatibility mode, WebGL2 | The newest iPhone and the newest Safari | 15 |
| iPad Pro 13 2025 | iPadOS 26 | Safari | Apple M5 | WebGPU, compatibility mode, WebGL2 | The newest iPad | 8 |
| iPhone 16 | iOS 18 | Safari | Apple A18 | WebGL2 | The WebGL2 path on iPhones before iOS 26 | 10 |
| Galaxy S25 | Android 15 | Chrome | Adreno 830 | WebGPU, compatibility mode, WebGL2 | Qualcomm's current GPU line | 15 |
| Galaxy S25 | Android 15 | Samsung Internet | Adreno 830 | WebGPU, compatibility mode, WebGL2 | The default browser on Galaxy phones | 12 |
| Pixel 10 | Android 16 | Chrome | PowerVR DXT-48-1536 | WebGPU, compatibility mode, WebGL2 | PowerVR's new driver line, with known WebGPU faults | 15 |
| Pixel 9 | Android 17 | Chrome | Mali-G715 | WebGPU, compatibility mode, WebGL2 | ARM's Mali line on the newest Android | 15 |
| Redmi Note 12 4G | Android 13 | Chrome | Adreno 610 | Compatibility mode, WebGL2 | A mid-range phone with compatibility mode only | 12 |
| Windows 11 | Windows 11 | Chrome, newest | None on BrowserStack | WebGL2 in software; WebGPU with a GPU | The most common desktop | 12 |

- The Redmi Note 12 4G has the same chip and GPU as the Redmi Note 13 that TestingBot lent. Pass `--allow-no-webgpu` there and on the iPhone 16.
- BrowserStack's Windows machines have only a software renderer, as [What BrowserStack offers](#what-browserstack-offers) says. So the Windows row runs with `--allow-no-webgpu`, and its run checks WebGL2 in software and the clear failure of WebGPU pages.

### Tier B: each milestone

Tier B covers low memory, the other browser engines, more GPU lines and desktop Safari without WebGPU. It takes about 3 hours. Split it in two sittings if needed: the Apple devices and desktops, then the Android devices.

| Device | System | Browser | GPU | Expected paths | Why | Minutes |
| --- | --- | --- | --- | --- | --- | --- |
| iPad 10th | iPadOS 27 | Safari | Apple A14, 4 GB | WebGPU, compatibility mode, WebGL2 | WebGPU with little memory | 15 |
| iPhone 13 | iOS 18 | Safari | Apple A15, 4 GB | WebGL2 | The oldest supported Safari on iPhones, with little memory. It ran iOS 17 until the owner ruled Safari 17 out ([D-64](decisions/D-64-minimum-browsers.md)) | 10 |
| iPhone 17 | iOS 26 | Chrome | Apple A19 | WebGPU, compatibility mode, WebGL2 | One iOS browser other than Safari, as a check of WebKit | 12 |
| Galaxy S24 | Android 16 | Chrome | Xclipse 940 or Adreno 750, by region | WebGL2 on Xclipse | Samsung's AMD-based GPU on the newest Android | 10 |
| Galaxy S25 | Android 15 | Edge | Adreno 830 | WebGPU, compatibility mode, WebGL2 | Edge on Android | 12 |
| Galaxy S25 | Android 15 | Firefox | Adreno 830 | WebGL2 | Firefox's own engine, Gecko, which has no WebGPU on Android | 10 |
| Galaxy A16 5G | Android 15 | Chrome | Mali-G68 MP2 or Mali-G57 MC2, 4 to 8 GB | WebGPU or compatibility mode | A low-end Mali with little memory | 15 |
| Galaxy Tab S11 | Android 16 | Chrome | Immortalis-G925 | WebGPU, compatibility mode, WebGL2 | An Android tablet with ARM's largest GPU | 15 |
| Pixel 11 | Android 17 | Chrome | PowerVR CXTP-48-1536 | Not known yet | The newest Pixel GPU, which Chrome's WebGPU list did not name in June 2026 | 15 |
| Windows 11 | Windows 11 | Edge, newest | None on BrowserStack | As Chrome in tier A | The default Windows browser | 12 |
| Windows 11 | Windows 11 | Firefox, newest | None on BrowserStack | WebGPU and WebGL2 with a GPU | Firefox's own WebGPU code on Windows. Not on Automate: without a GPU it gives no WebGL2 either | 12 |
| macOS Sequoia | macOS 15 | Safari 18.4 | Not published | WebGL2 | Desktop Safari without WebGPU | 8 |

- The Galaxy S24 ships with Exynos and Xclipse in most regions, and with Snapdragon and Adreno in the US, China and Japan. If its GPU cell names Adreno, run the Galaxy S26 or the Galaxy S22 instead, which split the same way.
- Pass `--allow-no-webgpu` on the iPhone 13, the Galaxy S24, Firefox, the Galaxy A16 5G, the Pixel 11, Edge on Windows and Safari 18.4.
- On the newest iPads, the owner also wants a short bench run at the Medium and High presets. It shows whether newer iPads hold the presets that the team's iPad cannot hold when warm. Run it after the smoke plan passes, and read its timings as a rough guide.

### Tier C: once

Tier C covers the oldest systems: the WebGL2 path on old drivers, and the clear failure where the engine cannot run. Run it once, and again when the engine's startup checks change. It takes about 1 hour 30 minutes.

| Device | System | Browser | GPU | Expected result | Why | Minutes |
| --- | --- | --- | --- | --- | --- | --- |
| iPhone SE 2022 | iOS 15 | Safari | Apple A15 | E1303 | Safari 15 has no WebAssembly SIMD | 5 |
| iPhone 12 | iOS 14 | Safari | Apple A14 | E1303, or the page cannot run | An old WebKit | 5 |
| iPad 8th | iPadOS 16 | Safari | Apple A12, 3 GB | The start error for Safari before 18 from 16.4, E1303 before it | The oldest iPad in the list, below the minimum Safari | 5 |
| Galaxy S20 | Android 10 | Chrome | Mali-G77 or Adreno 650 | WebGL2 | The oldest Android with a current Chrome | 8 |
| Vivo Y21 | Android 11 | Chrome | PowerVR GE8320, 4 GB | WebGL2 | An old PowerVR driver | 8 |
| Nexus 5 | Android 5.0 | Chrome | Adreno 330 | A clear failure | The oldest Android in the list | 5 |
| Windows 11 | Windows 11 | Chrome 90 | Not published | E1303 | Chrome before WebAssembly SIMD | 3 |
| Windows 11 | Windows 11 | Firefox 88 | Not published | E1303 | Firefox before WebAssembly SIMD | 3 |
| Windows 11 | Windows 11 | Firefox 140 | Not published | WebGL2, with threads that wake by messages | Firefox before WebGPU and `Atomics.waitAsync` | 10 |
| macOS Monterey | macOS 12 | Safari 15.6 | Not published | E1303 | Desktop Safari before WebAssembly SIMD | 3 |
| macOS Ventura | macOS 13 | Safari 16.5 | Not published | The start error for Safari before 18 | Desktop Safari with WebAssembly SIMD, below the minimum Safari | 3 |

- Where the engine should draw, run the smoke plan with `--allow-no-webgpu`.
- Where it should fail, run only the pages that start the engine, with no skip flags: `--plan smoke --only capabilities,restarts-pipelined,restarts-single-threaded`. Each page must fail at once with the error in the table, not wait until its time limit.
- An old browser may not run the runner page itself. Then open `https://bs-local.com:3001/tests/pages/engine.html` directly. The page prints its result, with the error, on screen. If the screen stays blank, read the console in BrowserStack's developer tools. Record what you saw by hand.

### Other devices

Swap these in when a device of a tier is busy, or to widen the cover from one milestone to the next.

- Apple: iPad Pro 11 2025 (M5), iPad Air 11 2026, iPhone Air and iPhone 17e. Also the iPhone 15 on iOS 27, and Safari 27 on macOS Golden Gate.
- Adreno: Galaxy S26 Ultra (Adreno 840), Galaxy Z Fold 7 (Adreno 830), Realme P3 (Adreno 810) and OnePlus 13R (Adreno 750). For little memory, the Galaxy Tab A9 Plus (Adreno 619). For compatibility mode, the Oppo A96 (Adreno 610).
- Mali: Redmi Note 14 Pro 5G and Motorola Edge 60 Fusion (Mali-G615), Pixel 7 (Mali-G710) and Galaxy A35 (Mali-G68).
- Xclipse: Galaxy S26 (Xclipse 960 outside the US, China and Japan) and Galaxy S22 (Xclipse 920 in Europe).
- Desktops: Chrome on Windows 10, and Chrome and Firefox on macOS Tahoe.

## BrowserStack Automate

[BrowserStack Automate](https://www.browserstack.com/automate) runs the tiers with nobody at the browser. `bun run devices:cloud` opens a session on each device of a tier, through BrowserStack Local. The device runner then drives the runner page there, as it drives a page on the local network.

- The owner took Automate for one month, from 3 October 2026. It is not a lasting subscription, so nothing in CI or in nightly runs depends on it.
- When it lapses, the command stops at its first check, because BrowserStack refuses the account. The manual steps of [BrowserStack Live](#browserstack-live) still work then, with the same tiers and runner names.
- Cloud timings are only a rough guide, as in Live.

### Run a tier

1. Keep the username in `~/.browserstack-user` and the access key in `~/.browserstack`. Give both files `chmod 600`. The command sends them only in a request header, and never prints them.
2. Start BrowserStack Local and the HTTPS dev server from a checkout of main, as steps 1 to 4 of [Set up a session](#set-up-a-session) say.
3. From the same checkout, check the account and the devices: `NULL3D_PORT=3000 bun run devices:cloud --tier A --check`.
4. Run the tier: `NULL3D_PORT=3000 bun run devices:cloud --tier A`.
5. Paste the rows that the runner prints into [the record of tested devices](tested-devices.md). Their place cell says BrowserStack Automate.

- `--tier B` or `--tier A,B` picks other tiers. `--only bsiphone17-safari,bspixel10-chrome` picks runners from any tier.
- `--part 2/3` runs only the second of three parts of the picked devices, in the list's order. Each part is a run of its own, with its own build on the dashboard. With one session at a time, tier A's 10 devices take about 2 hours, so run them as `--part 1/3`, `--part 2/3` and `--part 3/3`. On 4 October 2026, the three parts took 25, 18 and 47 minutes.
- `--plan` picks the plan, which is `smoke` by default. `--parallel 2` opens at most two sessions at once.
- Options after `--` go to the device runner as they are. For example, `bun run devices:cloud --only bspixel10-chrome -- --only capabilities` runs one page on one device.
- Ctrl-C ends every open session before the command exits.

### What the command does

1. It reads the account's plan from BrowserStack's REST API, and opens at most as many sessions at once as the plan has free.
2. It looks for each device in Automate's list of devices and browsers. When one is missing, it stops before any session opens, and names the nearest devices in the list.
3. It splits the devices into two runs of the device runner: first the devices whose core WebGPU must work, then the ones that run with `--allow-no-webgpu`.
4. Each run gives the device runner `--cloud` with the runner names, `--parallel` and the build name. Each runner's turn opens a session, which loads the runner page that waits at `https://bs-local.com:3001`. The page starts the run when its turn comes.
5. Every 30 seconds, the runner reads the page's status line through the session, and prints it when it changes. A session ends after 300 seconds without a command, the longest idle time that Automate allows. So these reads also keep the session open.
6. The session ends with the runner's turn. That happens when the page finishes, or a guard ends its turn: the page got no frames, or the browser keeps refusing memory. It also happens when the page goes quiet, does not start within 3 minutes, or loses its session.
7. After the run, it marks each session passed or failed with the runner's summary line, and prints each session's link on BrowserStack's dashboard. Each session records video and the browser's console. Each session also turns on interactive debugging, so a person can take over the device from the dashboard while it runs. The owner asked for this on 4 October 2026.

- A command that is killed with no chance to clean up leaves its sessions open. BrowserStack ends them after 5 minutes without a command.
- A session that stopped answering still gets the command that ends it. On 4 October 2026, BrowserStack timed out the reads of a Galaxy M32 session, but kept the session open. It held the plan's only parallel session until someone ended it by hand.
- Automate ends any session after 2 hours. The smoke plan fits easily. Split a longer plan with the device runner's `--shard`.
- Each 30-second read of the page's status may wait up to 2 minutes for an answer. Safari on an iPhone can leave one read unanswered while a page compiles its shaders, and the page still finishes its run. So only 3 unanswered reads in a row count the session as lost.
- The device runner's `--network-logs`, given after `--`, makes Automate keep each session's network log, with each request's timing. The log comes from BrowserStack's own proxy, which changes how the browser treats the certificate and its cache. Use it to look at timings, not to count what the browser fetched.
- The device runner can open cloud sessions without the command too: `NULL3D_PORT=3000 bun tests/real-browsers.ts --plan smoke --cloud bspixel10-chrome`. It then opens one session at a time.

The code is in these files:

- `tests/devices-cloud.ts`: the command. It picks the devices, checks them and the plan, and starts the device runner.
- `tests/lib/browserstack-devices.ts`: the devices of tiers A and B, with BrowserStack's names. Edit it when Automate's list changes.
- `tests/lib/browserstack.ts`: the credentials, each session's capabilities, and the REST calls.
- `tests/lib/cloud-sessions.ts`: the sessions' lifecycle. `tests/lib/webdriver.ts`: a small client for the W3C WebDriver protocol, so no WebDriver package is needed.

### Pages through the tunnel

The dev server compresses its answers to requests for `bs-local.com`, the name by which every cloud device reaches the Mac. Before it did, the smoke plan's texture, material and preset pages ran out of their 30 seconds on the Galaxy S25 and the Pixel 10. Their GPU work takes about a second.

- The dev server sends the engine as separate modules. One image page asks for about 115 files in Safari on an iPhone, and 250 to 300 in Chrome on an Android phone. Each engine thread loads its own copies.
- A cloud device's browser accepts the dev server's certificate as an exception. Chrome and Safari 26 keep no file from such a site in their cache, so they fetch every file again on each page. On 4 October 2026, Safari 26 on the iPhone 17 and Chrome on the Galaxy S25 fetched every file in full. They reused no file from an earlier page. Chromium on this Mac did the same when it accepted the certificate as an exception. Safari 18 on the iPhone 16 kept its copies: 2,655 of its 4,834 requests were checks that the file had not changed.
- Through BrowserStack Local, each request waited about 0.3 seconds for its first byte. The dev server speaks HTTP/1.1, so the browser sends at most 6 requests at once, and the rest wait in turn. One 4.4 MB module took 8 to 14 seconds to arrive.
- The largest modules are shader sources as strings, with their source maps. A WebGL2 page loads a 7.3 MB module, and a custom-surface page a 15 MB one. Text this repetitive shrinks well. Brotli at quality 5 makes them 0.12 MB and 0.05 MB, in less than 20 ms each.
- So for that host alone, the dev server compresses scripts, WebAssembly, styles, pages and other text. It uses Brotli, or gzip where the browser lacks Brotli. Requests by any other name get the answers as before. That covers USB, the local network and the Mac's own browsers. The server's own routes under `/__null3d/` choose their own compression.
- On 4 October 2026, the 7 pages that had failed passed on both phones. Each took 10 to 18 seconds on the Galaxy S25 and 11 to 13 seconds on the Pixel 10. The 7 pages moved 15 MB in all, where one page alone had moved 6 to 18 MB.

These ways were weighed and set aside:

- A longer cache time for tunnel answers. Chrome and Safari 26 keep nothing from the site in their cache, so a cache time changes nothing for them. It would help only Safari 18, which runs the fewest pages, and it would show stale files in a Live session after an edit.
- A production build. The image page loads its sketch by an address in the query, which a production build cannot follow. The smoke plan also checks the development build.
- A longer page limit for cloud devices. It hides the cost, and every page of a run pays it.
- HTTP/2 for the tunnel. It would let the browser send every request at once. It is not tried yet. Safari on an iPad stalled on HTTP/2 while a worker loaded its modules, and iOS devices use the tunnel too.

The code is in `tests/lib/tunnel-server.ts`.

### Where Automate differs from Live

These facts come from BrowserStack's Automate docs, read on 3 October 2026: [mobile browsers](https://www.browserstack.com/docs/automate/selenium/deliver-better-mobile-user-exp), [Chromium on iOS](https://www.browserstack.com/docs/automate/selenium/chromium-on-ios), [insecure certificates](https://www.browserstack.com/docs/automate/selenium/accept-insecure-certificates), [capabilities](https://www.browserstack.com/automate/capabilities), [timeouts](https://www.browserstack.com/docs/automate/selenium/timeouts) and the [REST API](https://www.browserstack.com/docs/automate/api-reference/selenium/plan).

- Real Android devices offer Chrome, Samsung Internet, Firefox and Edge. Edge sessions record no video.
- iPhones and iPads offer Safari, and Chromium in place of Chrome. Both draw with WebKit. So tier B's Chrome on the iPhone 17 runs as `bsiphone17-chromium`.
- Automate's list lacks two devices of the tiers. In tier A, the Galaxy Tab A9 Plus stands in for the Redmi Note 12 4G. Its Adreno 619 is of the same line, with compatibility mode only. In tier B, the Galaxy M32 stands in for the Galaxy A16 5G. It has a low-end Mali GPU and little memory, on Android 11, so it runs WebGL2 only.
- No toolbar setting is needed for the dev server's certificate. The capability `acceptInsecureCerts` accepts it in most browsers. In Safari and on iOS, BrowserStack's `acceptSsl` command passes the warning page after each load. Edge on Android ignores the capability, and BrowserStack does not support `acceptSsl` there. On 4 October 2026 its runner page stopped at Edge's "Privacy error" page. So after each load there, the runner clicks the warning page's own link on to the page. `certificateScript` in `tests/lib/browserstack.ts` picks the way for each browser.
- Samsung Internet on the Galaxy S25 can open the page hidden. On 4 October 2026, 2 of 3 Automate sessions reported the page as hidden right after it loaded. A hidden page gets no animation frames. So the runner page stopped at "reading the device", where it measures the display's refresh rate. The runner ended the turn after 60 seconds. WebGPU, WebGL2 and the browser's own facts answered at once. The third session showed the page as visible. Samsung Internet passed in Live on 3 October, where a person holds the device.
- So each session asks the page for an animation frame right after it loads the runner page, and waits 3 seconds for it. Without one, it switches to the page's own window, which brings that tab to the front in Chromium's drivers. If the page still gets no frame within 3 seconds, the session loads the page again and waits once more. The output says which way worked, and what the browser reported each time. When neither works, the runner page stops after 20 seconds without frames. The runner then ends the turn with that reason, as [A page that gets no animation frames](#a-page-that-gets-no-animation-frames) says.
- Only a frame counts. On 5 October 2026, Samsung Internet on the S25 opened the page hidden in 2 of 2 smoke runs. After the switch to its window, the browser reported the page visible, but the page still got no frames, and the runner ended the turn. The first version of the session took the visible report as proof and did not load the page again.
- An Android phone's screen can run at 24 to 30 Hz. On 4 October 2026, the runner page on the cloud Galaxy S24 measured 24 to 30 Hz in every run. So the pages that limit the time between frames failed there, at 41.7 ms against a limit of 34 ms. The runner marked every timing figure unreliable. The cloud iPad 10th measured 60 Hz on 5 October. Before you call a frame-rate failure on a cloud device a fault of the engine, read the runner's warning about the refresh rate.
- Those readings came from a runner page that measured on a still screen, and the engine pages ran under the report. On the S24+ over USB, both faults gave 24 Hz, as [A hidden canvas and the display's rate](implementation-notes.md#a-hidden-canvas-and-the-displays-rate) says. Readings of 24 to 30 Hz from cloud phones before 5 October 2026 may be such faults, not the phones' real rates. To check on the Galaxy S25 and S24: `bun run devices:cloud --only bsgalaxys25-chrome,bsgalaxys24-chrome --plan checks -- --only capabilities,engine-webgl2-pipelined,engine-webgl2-low-latency,engine-webgl2-single-threaded --rounds 3`. Then read `refreshRateHz` in each phone's `device.json`, and each engine page's `refreshHz` and median frame interval.
- Cloud frame rates do not compare with real devices. On 5 October 2026, the cloud iPad 10th drew S4 at Low at 22 fps on WebGPU, with its screen at 60 Hz. The page's GPU work took 12 to 15 ms a frame, yet each frame waited 44 to 60 ms for the GPU. That held with the session's video on and off. The runs: 20261005-041513-bench with video off, 20261005-041911-bench with video on, and 20261005-042324-bench with WebGL2 forced, at 33 fps. Work outside the page holds the GPU, likely the screen's compositing and the live stream that interactive debugging needs. So a cloud comparison of two commits uses the page's GPU time, measured in turns within one session, and never the frame rate.
- iOS does not send `localhost` through the tunnel, so every device opens `bs-local.com`. BrowserStack allows every port for current browsers.
