# D-58: Failure reporting, canvas reuse and GPU-loss recovery

Status: decided. Date: 2026-10-04; kept canvases in Safari decided by the owner on 2026-10-06. Task: M2-R15.

## Question

The code review of October 2026 ([group B](../code-review-2026-10.md)) found failures that froze or leaked instead of reporting:

- A frame loop or a job worker that broke after the start froze the engine. With the sketch on the page, it hung the tab.
- A new engine on the canvas of a destroyed one failed and leaked every worker it started.
- WebGPU errors and a WebGL2 loss found in the middle of a frame went unseen or ended the engine.
- Sketch code that outlived an engine reached the next engine's core.

Which path does each failure take to the page, and what may a page do with a canvas after `destroy()`?

## Rule

- Every failure after the start reaches `engine.onFailure` with a code, once. No thread waits for good on a thread that failed, and the page's thread never spins.
- Nothing per frame: the checks may not allocate in a frame or add work to the replay.
- A canvas that a page keeps must work again for a new engine, as React's StrictMode needs. A page that drops its canvases must keep no idle workers.

## Data

| Case | Before | After | How it was measured |
| --- | --- | --- | --- |
| The frame step throws, in the 5 thread modes | 3 of 5 froze with no report | 5 of 5 report E1404 | `tests/image/failures.spec.ts` |
| A job worker dies inside a chunk, in the 4 threaded modes | 4 of 4 froze; with the sketch on the page the tab hung for the whole 90 s test | 4 of 4 report E1404, and the page's own timer runs on | the same spec, which makes job worker 0's clock throw |
| A second engine on the same canvas, 2 StrictMode patterns in 5 modes | 9 of 10 failed: InvalidStateError, E1403 or no frames | 10 of 10 draw, with as many workers as one engine | the same spec |
| Stopped engines whose canvas stays, in the 3 modes where a worker draws (Chrome) | the page reached each stopped engine's memory through its parked worker's handlers, and the worker reached it through its stopped drawing | the page and the worker reach none | `tests/image/restart.spec.ts`, and a count in each worker's heap |
| 42 starts and stops on kept canvases in Playwright's WebKit, room 38 | the room fell by about 1 for each engine, and stayed down | every start passed; a refused start ended the idle parked workers | the shared memory page, `?kinds=canvas-kept` |
| A call from sketch code after `destroy()` | A TypeError, then success against the next engine | E1420 both times | the same spec |
| WebGL2 context lost inside a framebuffer check | E1404 | recovers and draws on | `gpu-loss.html?mid-frame` |
| A WebGPU buffer past the device's limit | a black canvas, no code | E1305 | `tests/image/gpu-errors.spec.ts` |

How the data was produced: the new specs ran on the Mac's GPU in Chrome on 4 October 2026. They ran on this branch, and again with the engine's source of main (3aadcee0) put back. On main, 19 of the 22 tests in `failures.spec.ts` failed. The 3 that passed cover paths that were already guarded. Low latency and the single-threaded build already reported a frame step that throws. Drawing on the page could already start again after a cancelled start.

## Decision

Failures:

- A thread's loop that throws reports E1404 and ends. The pipelined loop catches its own errors, as the other loops did. A worker reports with a `fault` reply, the page with a direct call.
- A job worker marks the chunk it holds. When its loop fails, as after a WebAssembly trap, its own thread calls the core's `jobWorkerFailed`. That counts the held chunk as done and failed, so the caller's wait ends with a panic. The caller's thread then fails too and reports E1404. A wait on the stop flag alone would free the closure that live workers still run. So the count is the only safe end.
- After E1404 the engine draws no new frames. The page destroys it and starts a new one. Healing a failed thread would mean trusting memory that a trap left half written.
- WebGPU errors that no scope catches arrive through `onuncapturederror`, set once per device. The first out-of-memory error reports E1304, and the first other error E1305; the engine draws on. No error scopes run per frame. Later errors of a kind are counted, and development builds warn once.
- A WebGL2 error inside a frame on a lost context is dropped. The loss event that follows starts recovery, as a loss between frames does. The renderer listens for a loss before its first wait, so a loss during the shader download comes back too.
- Add-on modules run in the job workers ([D-54](D-54-addon-modules.md)), so their failures take the job worker's path.

The canvas:

- One engine holds a canvas at a time, and one engine holds the page's copy of the core. A start waits for an engine that is stopping or still starting. It fails with E1419 or E1415 only when the holder runs on after its start settled. The waiting start takes the canvas in the same task as it finds it free.
- A canvas moved to a worker can never come back to the page. So when its engine stops, the worker that drew stays with it, without the engine's core and GPU device. The next engine on the canvas draws through that worker, in the same role. It stays only while the canvas is in the document. A canvas that leaves the page, or that the browser collects, takes the worker with it. So does the page when it goes away. So does a new engine whose shared memory the browser refuses, unless an engine is starting on that canvas. A later engine on that canvas then fails with E1419. Options rejected:
  - Refusing a canvas that moved to a worker, as the review proposed. StrictMode mounts would then fail in every app.
  - A parked worker that stays until the canvas is collected. The restart tests keep every canvas, so each would keep a worker.
  - A parked worker with a time limit. A page could not know how long it has.
- The parked worker drops the stopped engine's message handlers, and drops the stopped drawing. Before 6 October 2026, both still reached the engine's 1 GiB shared memory. Even with no reference left, Safari frees that memory only once the worker collects its garbage. An idle worker never does. In Playwright's WebKit, each parked worker kept its memory for good. The room fell by 11 places after 10 engines on kept canvases, and again in a second round. Only a churn of about 400 MB of garbage in each parked worker brought it back. So the engine ends parked workers when the room is needed or the page leaves ([implementation notes](../implementation-notes.md#threads-and-shared-memory)). Options rejected:
  - Churning garbage in the parked worker to make it collect. 16 MB and 64 MB did nothing in WebKit, and the amount that works is a property of the browser's collector.
  - Moving the canvas to a fresh worker for the next engine. A canvas with a context cannot be transferred.
- Sketch code that outlives its engine fails with E1420. The sketch's `onDestroy` runs first, on its own thread. Then the runner swaps the core for a stand-in whose every function throws, and views on engine memory cannot be made again. The swap costs nothing per call. The loaders' helper workers stop at the same time.

Long runs:

- Frame numbers go round the 32-bit count of the control slots, after about 4 billion frames: 2 years at 60 frames a second, 207 days at 240. Before, the core aborted at the wrap, and every comparison of frames in the threads failed past 2^31. Now a frame number skips 0 ("no frame yet") and -1 ("none"). Frames compare by their distance around the circle (`shared/control.ts`, `null3d_core::frames`). Skipping the two values keeps each frame's parity alternating, which the two draw lists and the two world buffers need.
- The quality governor kept the page's clock in 32-bit integers. So it stopped raising quality after 24.8 days. Its clock now counts from an origin that the frame loop moves forward every 6 days or so. Its times stay small whole numbers in 32-bit integers. The first fix kept the times in 64-bit floats, which made the governor allocate in each judgement ([Render scale](../implementation-notes.md#render-scale)).
- A slot's 10-bit generation comes round after 1,023 reuses. Once a scene has used every slot, a freed slot comes back at once, so a stale handle could match a new object within minutes. The highest generation is now never given out, and a destroyed object's wrapper takes a handle with it. A later call on the wrapper then fails as stale however often the slot is reused. Options rejected: a longer wait before a slot comes back, which would cost capacity in a full scene. Wider generations, which would change the handle's layout on both sides.

## Kept canvases in Safari: the owner's ruling

The worker that kept a canvas stays alive, idle, for as long as the canvas is in the document: one thread per such canvas. It costs no GPU memory. In Safari it keeps the stopped engine's shared memory, 1 GiB by default, until the worker ends. It ends when the canvas leaves the page, when the page goes away, or when the browser refuses the memory of a new engine. In Safari 26.6.2 on a Mac, about 40 starts and stops on kept canvases all passed. They left the room at 24 to 29 of 35 or 36. A large memory that other code on the page asks for, such as another WebAssembly module, does not end the kept workers. Its request can then fail.

Decided by the owner on 6 October 2026: keep the workers as they are, and document the cost. The engine API page tells apps that load other large modules to remove a canvas once they are done with it. Options rejected:

- A time limit on a kept worker, such as a few seconds. A page cannot know how long it has: an app may stop its engine and start another on the same canvas a minute later. That start would then fail with E1419. D-58 rejected a time limit for the same reason when canvas reuse came.
- No canvas reuse for a canvas that a worker drew on, refused with E1419. Apps would then make a new canvas element for each engine. React components that render `<canvas ref>` would fail under StrictMode, which starts every effect twice.

The fix holds for the runner's pages on the cloud iPhone 16: the 12 engine pages that failed on main all pass. A different fault remains there. A frame that a live page removes keeps its engine's memory there, with or without a kept worker. So the frame restart checks fail on that iPhone. The [device guide](../devices.md#where-automate-differs-from-live) gives the runs. It is not part of this decision, and a separate investigation follows.

## Consequences

- The engine package's page, worker, runner and render code changed; the error table gained E1304, E1305, E1419 and E1420. `api/engine`, `api/sketch` and `guides/debugging` describe the paths.
- An idle worker per kept canvas is the cost of reuse. The `canvas-kept-restarts-*` and `frame-destroyed-restarts-*` device checks start engines on kept canvases and in frames removed after the stop, as the runner page runs every page. On 5 October 2026, without them, iPhones refused the engine's memory after about 10 pages of every checks run.
- The built-in room, which a frame's list makes in slices at its first use, comes back through the same recovery after a GPU loss. Its texture store fills the room again on the new device.
