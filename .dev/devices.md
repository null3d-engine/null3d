# Device sessions

This guide covers the checks and benchmarks on phones, tablets and the Mac's browser apps. [AGENTS.md](../AGENTS.md) holds the rules and the commands.

## The runner

- The device runner, `tests/real-browsers.ts`, runs a plan of test or benchmark pages in browsers that Playwright cannot drive. Each browser loads the runner page, which opens each page of the plan in a frame and posts its result.
- The plans are `checks` (the default), `parity`, `bench`, `memory`, `depth`, `overload`, `scale` and `startup`. `bun run devices` runs the checks on the phone and on the iPad.
- The runner page fills in its run and its own name where a plan item's address has `{run}` and `{runner}`. The startup, bench and scale plans use them, so each browser loads under addresses of its own.
- Run one runner at a time. All runs share one file, `target/runs/current.json`, which tells waiting runner pages which run to start. A second runner can replace it before a waiting page reads it, and that page then waits forever.
- A runner page that waits on the local network reloads itself before each run after its first. No run then inherits memory that an earlier run kept.
- The runner reports a page that gives no result in time with its last steps. The steps are each worker it started, each step of each worker's start, and the errors it logged. A page that fails reports its steps too.
- Before a run on a phone or tablet, the runner prints a checklist. The display needs a fixed refresh rate and fixed brightness. Low Power Mode and battery saver must be off, and the device must be rested and cool.
- The runner cannot read Brave's Shields. Run Brave once with Shields on and once with them off for the dev server's site, and pass `--shields on` or `--shields off` to match. The runner records the state in each Brave result and in the run's summary.
- Do not edit engine or benchmark page files, or `vite.config.ts`, during a run. The dev server reloads the pages being measured, and restarts when its config changes.
- Do not add or move files in the tree that the dev server watches during a run. A new HTML file anywhere in it reloads every open page, and a page reloaded while it measures reports 0 frames.
- Close the browser tabs that testing opens as soon as each test ends. Old tabs keep pages running, which costs heat and skews later runs.

## What the checks plan covers

- The capabilities page loads first and again last. Each extension that the engine asks for by name must get the same answer in both loads. The runner notes whether the browser's list of supported extensions kept its order, because Brave shuffles it (hard rule 13).
- The shared memory test page starts and stops the engine again and again in each thread mode. Where the browser has room for few shared memories, as on an iPad, the page starts more engines than fit at once. The check fails when a start fails, or when the room for shared memory does not come back within 31 s after the engines stop. Safari frees memory late on a slow machine. So a start that Safari refuses waits and tries again, for 30 s in all per page, as [the implementation notes](implementation-notes.md#threads-and-shared-memory) explain.
- With `?kinds=`, the shared memory page tests other ways a worker can hold a shared memory. These tests found that Safari never frees the memory of a thread it stops inside a blocking wait, not even after a reload.
- The engine test page runs again on its production build, in each thread mode on WebGL2. The runner builds the page, and the dev server serves it as it serves the startup loads. A production build bundles the engine into shared files, so some faults show only there. These checks found that Safari runs a worker's file a second time when another file imports it.
- The shader library page runs every function of the WGSL shader library on the GPU, on WebGPU and on WebGL2. Each value must match its TypeScript reference within a tolerance that allows for the GPU's rounding. A wrong value names the function, its expected values and the values the GPU gave.
- The checks plan runs every test of the image test manifest, and compares each image with the real-GPU reference at the device tolerance. [Image tests](image-tests.md) covers the tolerance, device references and the review of new images.
- The texture page, one of those tests, replays every texture command of the GPU layer on each tier. Every tier must draw one image.
- The quality page starts the engine with every choice left to it. The run's notes give the quality preset it chose, with the GPU path and the device hints it chose from. The check fails when the preset differs from the chooser's answer for those hints. Expect Low on the S24+, Medium on the iPad, and High on the Mac.
- The image tests read frames through the engine's capture, which does not use the canvas. A frame that never reaches the screen still passes them. After a change to how frames reach the canvas, look at a demo page, and on a phone check `adb logcat` for GL errors.
- The parity plan's null3D pages use the engine's hold mode, which steps each scene to its hold time before it draws. On a slow device, that adds the update time of 121 frames to each hold page. A page whose sketch fails reports the error at once, with the sketch time where it happened.

## Benchmark runs

- The bench and scale plans load the production build of the benchmark pages, as the benchmark tools on the Mac do. [Benchmarks](benchmarks.md#production-builds) says why.
- The runner builds the pages into `target/bench-pages` before the run. The dev server serves the build under the load routes, as it serves the startup loads, with one address prefix for each run and runner.
- The phone over USB and the tablet over the local network both reach the main checkout's dev server, so both load the same build.
- A dev server that started before the load routes served the benchmark pages cannot serve these plans. The runner then stops and asks you to restart that server.

## Startup times

Two tools time the start of the engine test page, from navigation to the first frame. Both load its production build, built with relative addresses into `target/startup-pages`.

- `bun run bench:startup --android` times Chrome on the phone through Chrome's debugging socket. It loads every thread mode five times cold and five times warm, on Slow 4G and at full speed. [Benchmarks](benchmarks.md#startup) describes the tool.
- `bun tests/real-browsers.ts --plan startup` times the other browsers through the runner: Brave on the phone, and Safari and Brave on the iPad. The runner cannot limit a device's network, so these loads run at the speed of the USB cable or the local network.
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
- Brave on the phone: `bun tests/real-browsers.ts --plan startup --android brave --shields on`. Then turn Shields off for the site and run it again with `--shields off`.
- Safari and Brave on the iPad: open both runner pages, then run `bun tests/real-browsers.ts --plan startup --lan ipad-safari,ipad-brave --shields on`. Then turn Brave's Shields off and run `bun tests/real-browsers.ts --plan startup --lan ipad-brave --shields off`.

## The depth plan

- The `depth` plan runs the depth precision tests of the image test manifest. Their scene holds two surfaces 1 cm apart at each of 11 distances from 1 m to 10 km. The plan draws it on each GPU path in the device's own depth mode, then on WebGL2 with `?depth=standard`, `?depth=reversed-gl` and `?depth=reversed`.
- The run's summary gives each page's fighting pixels, where the farther surface shows through: the count over all distances, and the share at each distance.
- The fighting pixels past 40 m never fail a page. The page paints them as the nearer surface, so its image compares with the references as every manifest test's does. The manifest's expectations fail a page that drew another depth mode than it asked for, lost ties, or fought within 40 m. A browser without `EXT_clip_control` draws `?depth=reversed` as `reversed-gl`, which the summary notes.
- The phone and the iPad run it from the main checkout: `bun tests/real-browsers.ts --plan depth --allow-no-webgpu --android chrome,brave --lan ipad-safari,ipad-brave --shields on`. The Mac's four browsers run it with `bun tests/real-browsers.ts --plan depth Safari Firefox "Google Chrome" "Brave Browser"`.
- Each tile's count depends on how its surfaces' corner depths round, so a farther tile can fight less than a nearer one. Compare the modes by their counts over all distances.

## The overload plan

- The `overload` plan runs the GPU-bound page (`tests/pages/overload.html`) twice on each GPU path. The first run keeps the engine's limit of two frames waiting on the GPU. The second adds `?queue=off`, which leaves the queue to the browser.
- The page draws layers of detailed spheres, about 16,000 triangles each, that never move, so the GPU does nearly all the work. It doubles the spheres at each step and measures each step for a second. At the first step where the lower of the presented and completed rates falls below half the display's rate, it measures 5 seconds and stops.
- The run's summary gives each page's presented and completed rates at that step, and whether they parted by more than 10%. It also gives the time from submit to completion, the frames in flight that it makes, and the GPU time.
- The display's rate comes from the lightest step. Without the engine's limit, Chrome slows the drawing worker's frame callbacks to the GPU's pace. The refresh meter then reads a rate far below the display's.
- [D-11](decisions/D-11-frames-in-flight.md) holds the results. The phone and the iPad run it from the main checkout: `bun tests/real-browsers.ts --plan overload --allow-no-webgpu --android chrome,brave --lan ipad-safari,ipad-brave --shields on`. The Mac's four browsers run it with `bun tests/real-browsers.ts --plan overload Safari Firefox "Google Chrome" "Brave Browser"`.
- Without the limit, a queue can hold seconds of frames. A page then takes a while to stop, so each page gets 2 minutes.
- `?spheres=<n>` makes the page measure that many spheres alone. Use it to compare switches, such as `?queue=3`, at one load.

## Browser apps on the Mac

- Keep the Mac's screen unlocked and its display awake during runs. Safari stops running pages while the Mac is locked, and the runner then waits until its deadline. Chrome started by Playwright keeps running.
- Close a Safari tab that a test opened with AppleScript: tell Safari to close the tabs whose address holds `localhost:517`.
- On GitHub's macOS machines, Safari has no WebGPU and Firefox has no WebGL2. The CI jobs pass `--allow-no-webgpu` and `--allow-no-webgl2`, so those pages count as skipped there.
- CI runs the checks plan in each browser in a job of its own, such as `real-browsers (Safari 1/1)`. A Linux job first builds the two WebAssembly files with `bun tools/build-wasm.ts --core-only`, and each macOS job downloads them.
- Until 1.0, these jobs test only in the merge queue, once for each pull request before it merges. On a pull request and on main, each passes at once on a Linux machine. The pull request then still reports the check that the queue requires. Run `bun run test:real-browsers Safari Firefox` on the Mac before you push a change that Safari or Firefox may treat differently.
- The runner's `--shard <i>/<n>` runs one of n shards of a fixed plan. The plan's items split evenly, and each item stays with the items whose results its check compares with. Examples are the capabilities page's second load and an image test's first thread mode.
- On 30 September 2026, one job for both browsers took about 7.7 minutes. It built for 1.5 minutes, then ran the two browsers in turn for 5.6 minutes. The Rust cache did not shorten the build much. The threaded build compiled the standard library again each time, and the shader compiler took another half minute.
- The split jobs took 3.3 minutes for Safari and 3.4 for Firefox, after a Linux build of 1 minute. That is 6.6 minutes of macOS machines per run. Two shards per browser took at most 2.3 minutes each, but 8.0 machine minutes and four machines at once.
- GitHub's free plan gives 5 macOS machines at once, and main's benchmark job holds one for about 25 minutes after each merge. So add a shard only when a browser's job takes longer than the slowest Linux job, about 5 minutes. Before that, a run finishes no sooner, and other runs wait longer for a machine.

## Android phone

The team's phone is a Galaxy S24+ (SM-S926B, Exynos 2400, Android 16).

- Connect it by USB with USB debugging on, and trust the Mac. `bun run android` forwards the dev server's port to the phone. The runner opens each browser's runner page itself.
- For benchmarks, fix the display at 60 Hz: `adb shell settings put secure refresh_rate_mode 0` (Motion smoothness: Standard). A value of 1 gives adaptive rates up to 120 Hz, for the 120 Hz pass. Set brightness to manual, and keep the performance profile at Standard.
- Heat decides phone results. Within two minutes of S1 at phone scale, Samsung's heat manager reaches throttle level 2 (`adb shell getprop sys.siop.level`). Its fastest cores then run at about half speed. The caps lift after a few minutes of rest.
- Start each browser's run cool: throttle level 0 and a skin temperature of at most about 37 °C (`adb shell dumpsys thermalservice`). The core speed caps are in `/sys/devices/system/cpu/cpu*/cpufreq/scaling_max_freq`. USB charging adds heat.
- During a run, the runner reads the phone's heat every 10 seconds: the temperatures, each core group's speed cap and Samsung's throttle level. Each result records the heat it ran in.
- Do not touch the phone during a run, because a tap can close the runner's tab. A runner page that goes quiet counts as stopped after its slowest page's timeout and 30 more seconds.
- Close stale pages through Chrome's debugging protocol: `adb forward tcp:5176 localabstract:chrome_devtools_remote` (the main checkout's debugging port: the dev server's port plus 3), then `Target.closeTarget` for each page on `localhost`.
- The `scale` plan finds phone scale: the largest S1 count at which three.js holds 30 frames per second. Run `bun tests/real-browsers.ts --plan scale --allow-no-webgpu --android chrome`. In Chrome 154 on 29 September 2026, it was 300,000 from a cool start and 250,000 on a warm phone.

## iPad

The team's tablet is an iPad Pro 11-inch with 8 cores. Safari there reports a Mac user agent.

- The iPad reaches the Mac over HTTPS on the local network. `bun run dev-cert` makes the certificate. Copy its root certificate to the iPad, install the profile, and turn on full trust in Settings > General > About > Certificate Trust Settings.
- `NULL3D_HTTPS=1 bun run dev` serves HTTPS on port 5174 under the Mac's `.local` name. The dev server sends it over HTTP/1.1, because Safari on an iPad sometimes stops loading a worker's modules over HTTP/2. That failure looks like an engine start that never finishes.
- Each browser opens its own runner page: `https://<mac>.local:5174/tests/pages/runner.html?listen&runner=ipad-safari` in Safari, and `runner=ipad-brave` in Brave. The name must match the browser, or the page waits for the other browser's runs. Pass `--lan ipad-safari` or `--lan ipad-brave` to the runner.
- For benchmarks, turn on Settings > Accessibility > Motion > Limit Frame Rate, which holds the display at 60 Hz.
- Safari there holds only a few shared memories at once. It holds 6 with the engine's default maximum of 1 GiB, 18 at 256 MiB and 3 at 4 GiB. A test that stops a worker inside a blocking wait leaks one until Safari quits. After such a test, quit Safari from the app switcher and open the runner page again.
- Brave with Shields on reports 3 cores, where Safari reports 8, so the engine starts fewer job workers there.
- The iPad's scale at 60 Hz was measured in Safari 26.6 on 29 September 2026. three.js's WebGPU renderer holds 30 frames per second up to 240,000 objects, and its WebGL renderer up to 140,000.
