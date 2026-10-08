# D-116: The stats overlay's memory, triangle and object figures

Status: decided, 2026-10-08. Date: 2026-10-08. Task: M2-EX2.

Summary: The page can now turn the stats overlay on, as the sketch could. The overlay adds GPU time, triangles, objects, memory and the page thread's load. Triangles and objects count every draw of every pass, as three.js's `renderer.info` counts triangles. On WebGPU the GPU-culled draws' counts come back from the GPU on one frame in eleven. The page memory counts the shared WebAssembly memory once. `@null3d/engine/stats` exports the layout, so a three.js page prints its figures the same way. The overlay always sits at the canvas's top right (the owner's ruling), and collapses to a frame-rate pill. The pill opens a card of work bars against the engine's target frame rate. Collapsed, it samples nothing.

## Question

The examples and the three.js comparison pages need one overlay that any page can show. It must report memory, triangles and objects drawn, the page thread's load and GPU time. What does each figure count, and how does the engine get it at almost no cost while the overlay is hidden?

## Rule

- With the overlay hidden, a frame pays at most a few operations per draw call, and allocates nothing.
- Each figure means the same in null3D and in a three.js page, so the comparison pages compare like with like.
- A figure that the browser does not give is left out, never shown as 0.
- The overlay's code stays within the 16 KB budget of a file that loads on first use ([D-14](D-14-js-budget.md)).

## Data

All runs are from 8 October 2026, in Chrome on the owner's Mac (Apple M5 Max), on the stats test page and on S1.

**How Chrome counts the shared memory.** `performance.measureUserAgentSpecificMemory` on the stats test page, threaded build, pipelined:

| GPU path | WebAssembly memory | Browser's figure | Parts that hold the memory | Counted once |
| --- | --- | --- | --- | --- |
| WebGPU, High | 22.1 MiB | 116.1 MiB | 3: the page 28.5, the sketch worker 32.3, the render worker 54.8 MiB | 71.8 MiB |
| WebGL2, Medium | 22.4 MiB | 99.0 MiB | 3: the page 28.8, the sketch worker 32.6, the render worker 37.2 MiB | 54.2 MiB |

The page's own JavaScript heap was 5.5 MiB, so the page's part is the shared memory plus its heap. The 16 job workers gave no part, and each measurement took 58 s, which is Chrome's time limit for workers that do not answer.

**What the engine's start downloads.** After Brotli, against main's build:

| File | Main | First build of this change | Final |
| --- | --- | --- | --- |
| `page.js` | 31,263 B | 31,767 B (+1.6%) | 31,394 B (+0.4%) |
| `page-renderer.js` | 32,091 B | 32,987 B (+2.8%) | 32,426 B (+1.0%) |
| `sketch-worker.js` | 45,641 B | | 45,907 B (+0.6%) |
| `sketch-worker-renderer.js` | 32,439 B | 33,279 B (+2.6%) | 32,732 B (+0.9%) |
| `render-worker.js` | 34,902 B | 35,794 B (+2.6%) | 35,235 B (+1.0%) |
| Pipelined start | 136.1 KB (97.2%) | 137.8 KB (98.4%) | 136.8 KB (97.7%) |

The first build kept the reader of the culled draws' counts in each renderer, and the page thread's windows and the page memory sampler in `page.js`. The final build loads the reader at the first frame that samples, about 1 KB in each thread that draws. The page's meters moved into the overlay's file, which grew from 882 B to 2,245 B.

**Allocation with the overlay shown.** `bun run bench:allocation --stats` on S1, bytes per frame of the render worker in the sample where each place allocated least:

| Place | WebGPU, 100,000 instances | WebGPU, 20,000 instances | Budget |
| --- | --- | --- | --- |
| GPU timer: `copyOut` | 14.2 | 12.1 | 24 more |
| GPU timer: `read` | 10.5 | 12.2 | 16 more |
| GPU timer: `afterSubmit` | 8.9 | 11.7 | 16 more |
| Culled counts: `afterSubmit` | 12.2 | 12.7 | 16 more |
| Culled counts: `read` | 5.9 | 5.2 | 12 more |
| Culled counts: the view of the mapped range | 3.5 | 4.8 | 8 more |

The GPU timer's places are the timer's own, which only showed once the check could run with sampling on. Its first run found an array and an iterator for each pass that the timer read, and an array for each submit. The timer now reads the words one by one and submits through the shared list. What remains are objects that the browser returns: a command buffer, a promise and its reaction, and a view of each mapped range. Each mapped range is new memory, so no pool can keep these objects. They come once in eleven frames, and the culled counts make about half of what the timer makes. The smaller scene allocates no more per readback; it draws more frames a second. WebGL2 with the overlay shown allocated nothing more that the profiler saw, and both paths with the overlay hidden passed their old budgets.

**Browser tests.** The stats test passes on both GPU paths, in every thread mode and from the `?stats` switch: 14 of 14. It ran in Chrome on the Mac's GPU and in the production build. The demo interaction test passes with the overlay on the demos: 2 of 2.

## Decision

1. **Turning it on.** `createEngine({ stats: true })`, `engine.stats(show)` and the `?stats` switch show the overlay from the page. Each also takes options, as [the overlay's layout and rules](#the-overlays-layout-and-rules) says. The sketch's `debug.stats` shows the same overlay, and the last call from either side wins. Each sketch call reaches the page, which may have changed the overlay since. Production builds read the switch only with the Vite plugin's `urlSwitches`, as they read every switch. A held engine shows no overlay, since it presents no frames.
2. **Sampling.** The overlay, a measurement and the sketch's first `debug.frameStats()` each turn on sampling, and the engine samples while any of them wants it. Sampling times one frame in eleven on the GPU, with the measurement's timer code. The overlay and the sketch's figures also want what only they show, and a second count in the header says so. On WebGPU the engine then reads back the counts of the culled draws on the timed frames. The code that reads them back loads at the first frame with such a reader, so a page that only measures never downloads it. The sketch thread also publishes the memory of textures and meshes in the header every eighth frame. Without sampling, none of this runs.
3. **Triangles and objects.** The thread that draws counts every draw of every pass: shadow maps, the depth prepass, the passes that shade and post effects. A draw of triangles adds its vertices or indices over 3, times its instances. A draw of lines adds none. Each draw adds its instances to the objects. three.js's `renderer.info.update` counts triangles the same way, per draw call, shadow maps included, so the figures compare. A three.js page gets the same object count by adding each call's instance count.
4. **Counts on WebGPU's GPU-culled path.** The culling shaders write the instance count of each indirect draw on the GPU, so the CPU never sees it. Two counts were possible:
   - The submitted count: every source in the buckets, before culling. It is known on the CPU, but it measures the scene, not what the GPU drew, and differs from WebGL2's count of the same scene.
   - The drawn count: the instance counts that the culling wrote. Only the GPU knows them.

   The engine reads the drawn count back, because only it matches WebGL2 and three.js. On a sampled frame, the backend notes each indirect draw that it replays. At the frame's end it copies the noted draws' arguments into a mappable buffer, with one copy for each buffer of draws. It sums them once the buffer maps. Each frame adds the newest sums to its own direct counts. Every indirect buffer gains `COPY_SRC` usage for these copies, which WebKit's argument copies already needed. Until the first counts come back, a counter in each frame's record marks its triangles and objects as not known. The window's means leave such frames out. Without that, the first window after the overlay shows counted only the direct draws. In CI's SwiftShader it gave 11.8 triangles per frame for the stats page's box of 12.
5. **Memory.** The overlay shows the WebAssembly memory's size and the GPU bytes of textures and meshes. It also shows the page thread's JavaScript heap from `performance.memory`, and the whole page from `performance.measureUserAgentSpecificMemory`. The browser adds a shared memory to the figure of each thread that holds it. So the browser's figure counts the engine's memory once per engine thread that answered. The overlay counts it once: it subtracts the memory's size for each holder past the first. A holder is a part of the breakdown at least as large as the shared memory, since no thread's own heap comes near it. The overlay also shows the browser's own figure. The measurement waits for every worker to run it, or about a minute. Job workers never return to their event loop, so in the threaded build each measurement takes about a minute.
6. **The page's own thread.** The class `MainThreadWindow` watches the page thread's long tasks and longest input delay. A long task takes 50 ms or more. `@null3d/engine/stats` exports the class for other engines' pages. The overlay's final design shows neither, so the overlay no longer runs it.
7. **Figures only the page has.** The JavaScript heap and the page memory stay on the overlay and out of `debug.frameStats()`. A worker cannot measure them.
8. **The shared layout.** `@null3d/engine/stats` exports `statsText`, the figure types, `MainThreadWindow`, `PageMemorySampler` and `pageHeapBytes`, with the percentile helpers. The package now builds the module, so a page outside the repository can import it.

9. **The start's cost.** The start holds only what runs each frame: the per-draw counts and the memory figures' writes. The overlay's own file holds the page's meters. The reader of the culled draws' counts loads on first use. A measurement with `engine.measure` keeps its own small meters of the page thread and the page memory in the start. They repeat about 20 lines of the overlay's meters. That costs less than moving the meters into the start. The overlay's file loads none of the page's modules that the start holds. When it did, Vite's build split shared modules out of `page.js` into files of their own.

## The overlay's layout and rules

The owner asked on 8 October 2026 for the overlay at the top right, collapsible to the frame rate, with a chevron. The owner then picked a design from five mockups and refined it in a series of rulings the same day. This section records the final design and the reasons.

### Options and defaults

- **Always at the top right.** The overlay always sits at the canvas's top-right corner, and no option moves it. The owner ruled this on 8 October 2026, for two reasons. First, there is one place to look for it, on every page. Second, the top right keeps it clear of the demos' caption, which sits at the top left. An earlier draft of this record gave a `corner` option with four corners and a top-left default. It argued that stats.js and drei's `<Stats>` sit at the top left, and that lil-gui and Tweakpane sit at the top right. The owner dropped the option for the two reasons above. A page with a tweak panel at the top right can move the panel instead.
- **Collapsed.** The `collapsed` option starts the overlay with its card closed. The engine's default is open: a developer who turns the overlay on wants the figures. The examples start collapsed, so a visitor sees the demo, with the frame rate in a small pill.
- **Requests add up.** `true` shows the overlay with the options so far, and options change only the fields they name, on a shown overlay too. An overlay that shows again keeps the start state that the last requests gave. The `?stats=collapsed` and `?stats=open` switches set the start state on top of the page's option, for tests and benchmarks.

### The look

- **Header.** A light pill: a ring gauge of the frame rate as a share of the target, the frame rate, such as `58 fps`, and a chevron. The chevron points down while the card is closed and up while it is open. The header is a real `<button>` with `aria-expanded`, and Enter and Space toggle it. A click with the pointer hands the focus back to the page. So a key that the sketch reads, such as Space, does not press the button again. The button stops Enter and Space from reaching the sketch's keyboard input.
- **The button stays in its corner.** The overlay keeps its right edge on the canvas's right edge, and the panel is a flex column whose items align to the right. So the card opens under the header, and opening it never moves the header. The stats test checks the place and the button in every thread mode.
- **Card.** A light card (`rgba(250, 251, 253, 0.95)`, radius 16, a soft shadow): the frame work, the memory, then the counts. A muted last line keeps the GPU path, the preset and the render scale from the earlier overlay. The design drops the page thread's long tasks and input delay, so the overlay no longer measures them. `MainThreadWindow` stays in `@null3d/engine/stats` for other pages.
- **Contrast.** The mockup colors each work figure's text with the bar's green, amber or red. On the card over a black scene, those give 2.6, 2.0 and 3.5 to 1 against the 4.5 to 1 that small text needs. The text uses darker shades of the same hues instead: `#15703f`, `#875400` and `#b3302a`, at least 5.2 to 1 over any scene. The bars and the ring keep the bright colors, since the figure beside each bar carries its value. The dark and muted text of the card gives 16.0 and 5.1 to 1 over black, and more over light scenes.
- **Isolation.** The overlay lives in an open shadow root with its own style sheet. The page's styles do not reach it, such as a page's own `button` rules, and its styles do not reach the page. The style sheet is made in script (`CSSStyleSheet.replaceSync`), which no browser blocks under a Content Security Policy without `'unsafe-inline'`. A browser without such style sheets gets a `<style>` element instead.

### The rules

1. **Target.** The overlay judges frames against the engine's own target: the one that the preset check and the quality governor aim at. It is the display's refresh rate, at most 60 frames a second, or a lower cap such as `?fps=` (`checkTargetFps`). The overlay neither invents a target nor measures one. A 120 Hz display shows a target of 60 fps; a 30 fps cap shows 30.
2. **Scale.** Every work bar spans twice the target's interval, so the target's mark sits in the middle of each.
3. **Work colors.** A thread's or the GPU's time is green below 80% of the target's interval, amber up to it, and red past it.
4. **Frame-rate colors.** The ring is green from 90% of the target, the share that a preset must hold in the preset check (`CHECK_HOLD_SHARE`). It is amber from 75%, and red below.
5. **Stack only where the parts add up to the total shown.** A thread's phases run one after another, so its bar stacks them. The sketch's `update` phase shows as "your code". Every other phase, and the thread's untimed rest, shows as "engine". Threads run side by side, and the GPU works beside them, so each has a bar of its own and none stack together. The memory bar's parts add up to the total in its heading. The browser's whole-page figure counts a shared memory once per thread that holds it. So it is not that sum, and it gets a line of its own.
6. **Job workers.** The engine starts one job worker per CPU core less two, at least one, and `?jobs=` can lower it. They share one parallel step of the frame, and the frame waits for the slowest of them. So they show as one bar, `Jobs ×N`, with the slowest worker's time. A sum or a mean would mislead.
7. **Bars by thread mode.** The bars come in the order Sketch, Drawing, Jobs, Page, GPU, and a thread that the mode does not run has none. In low latency and in the single-thread build, one thread prepares and then draws each frame. There one bar, `Sketch + drawing`, stacks your code, the engine's sketch steps, then the drawing (the `upload` and `replay` phases, in a lighter shade of the engine's color). It replaces the Sketch and Drawing bars.
8. **Mode symbol.** A symbol before the target names the thread mode: three staggered bars for pipelined, a clock for low latency. In the single-thread build, one thread does the work one step after another, as in low latency. So it gets the clock, with its own words ("Single-thread mode: without shared memory, ..."). A page that runs the sketch while a worker draws is still pipelined. The symbol is a real button with an `aria-label` and `aria-describedby` that points at a `role="tooltip"`. The tooltip shows on hover and on the keyboard's focus, and a tap toggles it, since touch screens have no hover.
9. **Held back by.** While the frame rate is below 90% of the target, a line under the GPU bar names the bar furthest past the target's mark. When no bar passes the mark, it reads "outside the engine": the page's other code or the browser holds the frame back. It hides while the target holds.
10. **Browser-neutral figures.** The frame rate, the work bars, the engine's and the GPU's memory and the counts come from the engine's own records. So they show in every browser that the engine runs in. The JavaScript heap (`performance.memory`) and the whole-page figure (`performance.measureUserAgentSpecificMemory`) show only where the browser gives them, with no `n/a`. The memory total adds up the parts that it lists. Where the GPU path has no timer queries, the GPU bar reads "not measured" and stays empty. Where it has them, it reads "measuring" until the first timed frame comes back.

### Collapsed costs nothing extra

While the card is closed, the overlay reads only the frame rate, from the frame intervals that the engine records anyway. The sampling count in the metrics header follows the card's open state, not the overlay's. Opening the card starts the GPU timer, the culled counts' readback, the sketch thread's memory figures and the page's memory sampler. Closing it stops them. `engine.measure` keeps its own sampling. While the card is closed, the overlay formats none of its figures. While it is open, an update changes text, bar widths and levels, and builds nothing. Bar widths and the ring's arc come from tables made once, so a moving bar allocates nothing.

A test checks the closed overlay on a page that draws on its own thread. There the page counts the GPU calls of timing and readback: WebGL2's `beginQuery`, WebGPU's `resolveQuerySet` and `mapAsync`. In 2 seconds with the card closed, both GPU paths made none of them. Opening the card made them, which shows that the count sees what the engine does.

### Look in one place

The file `debug/overlay.ts` holds what shows, where and when. The file `debug/overlay-look.ts` holds the style sheet and the code that builds and fills the header and the card. A new design changes that file alone. The file `debug/frame-target.ts` holds the target and the color rules. The file `debug/stats-options.ts` holds the option types apart from the scene's types, since the page's address switches name them.

### Cost and size

All runs are from 8 October 2026, in Chrome on the owner's Mac. It is an Apple M5 Max with a 120 Hz display, and its load was 2 to 7.

**Frame time.** `bun run bench:run --scenes s4,s6 --pages null3d-webgpu,null3d-webgl2 --runs 5 --seconds 10`, with no overlay, then `--switches stats=collapsed`, then `stats=open`, then no overlay again. Medians of 5 runs; CPU is the busiest thread per frame:

| Scene and path | CPU, hidden (two runs) | CPU, collapsed | CPU, open | GPU, hidden (two runs) | GPU, collapsed | GPU, open |
| --- | --- | --- | --- | --- | --- | --- |
| S4, WebGPU | 0.15, 0.12 ms | 0.11 ms | 0.11 ms | 3.73, 3.77 ms | 3.80 ms | 3.79 ms |
| S4, WebGL2 | 0.33, 0.30 ms | 0.32 ms | 0.32 ms | 4.44, 4.75 ms | 4.32 ms | 4.30 ms |
| S6, WebGPU | 0.53, 0.55 ms | 0.55 ms | 0.55 ms | 4.91, 4.84 ms | 4.90 ms | 4.94 ms |
| S6, WebGL2 | 1.32, 1.35 ms | 1.37 ms | 1.30 ms | 5.66, 5.24 ms | 5.18 ms | 5.56 ms |

Every page held 120 frames a second in every run. The two runs without the overlay differ by up to 0.03 ms of CPU time and up to 8% of WebGL2's GPU time. Against their mean, the open card adds at most 1.9% CPU and 2.0% GPU, both inside that spread. On WebGPU's GPU time, where the two runs agree within 1%, it adds 1.1 to 1.3%. The collapsed overlay shows no difference beyond the spread. So the open card meets the owner's rule of under 2%, and the GPU timer stays at one frame in eleven. The benchmark pages measure with `engine.measure`, which turns the GPU timer on in every run. So the figures without the overlay include the timer's cost. The open card's extra is the culled counts' readback, the memory figures and the page's memory sampler.

**Allocation.** `bun run bench:allocation` on S1 with 100,000 instances, bytes per frame of the sketch worker and the render worker:

| Path | Hidden | Collapsed (`--stats-collapsed`) | Open (`--stats`) |
| --- | --- | --- | --- |
| WebGPU | 319, 578 | 326, 570 | 318, 639 |
| WebGL2 | 386, 168 | 374, 166 | 373, 166 |

All six pass. Collapsed matches hidden on both paths. On WebGPU, the open card's extra 61 bytes per frame are the GPU timer's and the culled counts' readbacks, within their budgets above. The first WebGPU runs with the overlay lost their browser window within the same minute, before any figure. Both passed when run again.

**Size.** These are the figures of `bun run build:check-size`, after Brotli. The overlay's file loads at its first showing, and takes 6,457 B. It took 2,245 B before this design, and 882 B on main. That is 39% of the 16 KB budget of a file that loads on first use. The start grows by the switch's two new values and the setup that the start hands the overlay. The file `page.js` grows from 31,394 to 31,501 B, and `page-renderer.js` from 32,426 to 32,495 B. The workers' start files do not change.

**Browser tests.** The stats test passes 26 of 26 in Chrome on the Mac's GPU, with the production build. It passes 26 of 26 with `CI=1` too, on SwiftShader with the production build. It covers every thread mode and the figures that the browser does not give. In each thread mode it checks that the overlay sits on the canvas's top-right corner, and that the button stays put as the card closes and opens. It also covers the toggle by pointer and keyboard, the focus ring and drags through the card. And it checks both mode symbols and their tooltips, and the closed overlay's GPU calls. After the owner's ruling for the top right, it passed 26 of 26 again both ways, on 8 October 2026. The first-use tests pass both ways: 26 pass, and 6 skip by their own conditions.

## Consequences

- `FrameStats` gains `gpuMs`, `triangles`, `objects`, `wasmBytes` and `meshBytes`. The overlay on the page now shows the real texture bytes, where it read 0 before.
- Each frame record has three more counters, `Triangles`, `DrawnObjects` and `UncountedFigures`. The metrics header has four memory figures and a count of the readers of the frame figures.
- The stats test page turns the overlay on from the page, through the option and the switch. Its checks need non-zero triangles, objects and memory on both GPU paths, and GPU time where the path has a timer.
- The examples' `startDemo` shows the overlay by default, at the top right and collapsed, and takes `stats: false` to leave it off.
- `bun run bench:allocation --stats` checks the allocation with the overlay's card open, and `--stats-collapsed` with it closed, which keeps the budgets of a page without it.
- `docs/api/debug.md`, `docs/api/engine.md`, the performance and debugging guides, the three.js mapping and the skills describe the figures.
