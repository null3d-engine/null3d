# D-393: A thread that sees the shared memory as smaller than the heap grows it by one page

Status: decided and built. The heap and the job system bring a thread's own view of the memory's size up to date. They do so before the thread uses memory that another thread grew. Proven in Playwright's WebKit from WebKit's bug window. No BrowserStack session landed on Safari 26.2 to rerun it on an iPhone.

Summary: Safari 26.2 keeps, on each thread, the memory size that the thread last saw. A grow on another thread leaves that size as it was, and a block copy or fill past it traps. A job worker that started before the sketch thread grew the memory then fails with E1404 "Out of bounds memory access". So a thread whose own size ends before the heap's memory now grows the memory by one page, which brings its size up to date. The heap hands that page out at its next growth. In Playwright's WebKit 26.0, Skyway's first visit failed 10 of 10 times before the fix and passed 13 of 13 after it.

## Question

The examples' iPhone 17 first visits on Safari 26.2 failed 2 of 4 times. Both job workers stopped with E1404, "Out of bounds memory access (evaluating 'wasm.jobWorkerLoop(index)')", right after the first frame's pipeline warm-up. The sketch thread failed after them. What causes it, and what does the engine do about it?

## Rule

- The engine runs in every supported browser, which includes every Safari from 18 on ([D-64](D-64-minimum-browsers.md)).
- A path comes from a measurement on the device, not from the browser's name (hard rule 14).
- The frame loop allocates nothing (hard rules 1 and 7), and the fix adds no measurable time to a frame.

## Cause

- WebKit change 299880 (commit 12207bfdbb, bug 298743) gave each WebAssembly instance a cached memory size. `memory.size`, `memory.copy` and `memory.fill` read it.
- A shared memory has one instance on each thread. Until WebKit change 304204 (commit 597e00851c, bug 303387), a grow updated the cached size only on the instances of the thread that grew. Another thread's instance updates only when it is made, or when its own thread grows the memory by one page or more. A grow of zero pages does not update it.
- Plain loads and stores check against the memory's reserved maximum, so they still work. A block copy or fill that reaches past the thread's old size traps as an out-of-bounds access. Rust's `memcpy` and `memset` compile to those instructions, and the heap clears and copies blocks with them.
- The job workers make their instances early, before the sketch thread's first frame grows the memory. Their first frame chunks then copy into the new pages and trap. The sketch thread fails the same way after a job worker grows the memory.
- Starting the job workers later only hides the fault. Any growth after a job worker starts can trigger it.

## Data

iPhone 17 first visits in BrowserStack Automate, from the examples' production builds, by Safari version:

| Safari | Branch build | Base build |
| --- | --- | --- |
| 26.2 | 2 of 4 failed with E1404 (Skyway and island at the third preset failed; two network runs passed) | 3 of 3 passed, all the instances demo; Skyway and island never ran there |
| 26.5 and 26.6 | 0 failures | 0 failures |

Automate offers only "iOS 26" ([Where Automate differs from Live](../devices.md#where-automate-differs-from-live)). Safari 26.2 came up in 3 of 32 sessions, then in none of 23 more, so the fixed build never ran on it.

A test page with no engine shows the fault. A worker makes an instance of a small module on a shared memory of one page. The main thread grows the memory to 17 pages. The worker then fills 1 KiB at the start of the new pages with `memory.fill`. Playwright's WebKit builds give:

| WebKit | Worker's `memory.size` | Fill in the new pages | After a grow of 0 | After the worker's own grow of one page |
| --- | --- | --- | --- | --- |
| 26.0 (Playwright 1.57.0, build 2227, inside the window between the two changes) | 1 page | "Out of bounds memory access" | still 1 page, still fails | 18 pages, the fill works |
| 26.6 (Playwright 1.63.0, build 2359) | 17 pages | works | works | works |

Skyway first visits in Playwright's WebKit 26.0 (build 2227), each in a new browser, from production builds served on this Mac:

| Build | Runs | Failed | Fault |
| --- | --- | --- | --- |
| Branch head, without the fix | 10 | 10 | E1404 in a job worker's loop; the sketch thread also failed in `addSkyMap` and `cullFrame` |
| Main, the branch's base | 4 | 4 | E1405 in the sketch thread's `cullFrame` |
| Branch head with the fix | 13 | 0 | none; first frame after 6.5 to 15.8 s |
| Branch head with the fix, in Playwright's WebKit 26.6 | 3 | 0 | none |

Island in WebKit 26.0 gave the same picture. Without the fix 5 of 5 visits failed with an out-of-bounds access, four in a job worker and one in the sketch thread. With the fix, 0 of 5 did, and each reached its first frame. The test server served no sample models, so both builds drew island's code-built stand-ins.

Main fails as well. There the job workers start later, after the first frame's growth, and the sketch thread falls behind a job worker's growth instead.

The check's cost, from `bun run bench:run --compare <head>,. --scenes s4,s6 --pages null3d-webgpu --runs 6 --seconds 5`. It ran in Chrome 156 on this Mac at 60 Hz, at the High preset, with the Mac's load at 4 to 6 (run 20261124-123835-compare). The compare passed: no page is slower than its rule allows.

| Scene | Measure | Head, median ms (lowest to highest run) | With the fix | Noise | Compare's result |
| --- | --- | --- | --- | --- | --- |
| S4 | Busiest thread | 0.347 (0.155 to 0.435) | 0.250 (0.185 to 0.285) | 8.1% | faster |
| S4 | Own work | 0.265 (0.145 to 0.290) | 0.200 (0.170 to 0.245) | 13.2% | same |
| S4 | GPU time | 3.920 | 3.770 | 26.6% | same |
| S6 | Busiest thread | 0.405 (0.260 to 0.525) | 0.398 (0.315 to 0.470) | 3.4% | same |
| S6 | Own work | 0.400 (0.260 to 0.525) | 0.390 (0.305 to 0.470) | 3.4% | same |
| S6 | GPU time | 9.616 | 9.654 | 0.7% | same |

S4's "faster" is noise: the head's own runs spread from 0.155 to 0.435 ms, and the check cannot make a frame faster. In Chrome no thread ever falls behind, so each check reads the thread's memory size and the recorded end, and grows nothing. The core's frame test (`frames_allocate_nothing`) runs with the hook switched on: the hook runs during the frames, and they make no allocator call. The check itself calls no allocator.

## Look

The options look the same: the fix changes no pixel.

## Decision

- The heap records the end of the memory that it has handed out. A thread is behind when its own `memory.size` ends before that end. A thread that is behind grows the memory by one page, which brings its size up to date. That check is the measurement that hard rule 14 asks for. Where every thread sees the memory's size at once, no thread is ever behind, and nothing grows. So no browser detection is needed.
- The heap keeps those pages at the memory's end, and hands them out first at its next growth, so they cost nothing. They do not move the recorded end, so one thread's page never makes the others grow one.
- A thread checks at each allocation, under the heap's lock. A job worker checks before each chunk and each background task that it takes. The calling thread checks after each loop that it handed to the job workers. The call `clipReady` checks before it takes a clip that a job worker resampled.

Options rejected:

- Starting the job workers later, as the base did. It hides the fault in the first frame only. Any later growth still traps.
- Growing the memory to a large size before the job workers start. The final size is not known, the phone holds the pages, and a later growth still traps.
- Leaving the job loop when the memory grows, so that a new call starts. The call `memory.size` on the thread that is behind gives the old size too, so the loop never sees the growth. A new call also keeps the instance's old size.
- Building the core without block copies and fills. A shared memory needs the bulk memory instructions for its data segments, and every browser would copy more slowly.
- A check of the browser's name. The size check measures the fault itself.

## Consequences

- `crates/null3d-wasm/src/heap.rs` records the heap's end and keeps the spare pages, and its `refresh_view` brings a thread up to date. The function `JobConfig::refresh_memory` in `crates/null3d-core/src/jobs.rs` runs it on the job workers and after each loop. A job system test checks where the hook runs.
- [Browser faults](../implementation-notes.md#browser-faults) describes the fault, and the iPhone 17 Safari folder of [tested devices](../tested-devices.md) lists it as a known issue.
- To remove it: wait until the minimum Safari ([D-64](D-64-minimum-browsers.md)) reaches the first release with WebKit change 304204. Then delete the spare pages, the recorded end, `refresh_view` and the job system's hook. Safari 26.5 and 26.6 have the change. Safari 26.3 and 26.4 are not measured.
