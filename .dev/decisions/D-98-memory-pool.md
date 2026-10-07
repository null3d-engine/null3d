# D-98: Keep a stopped engine's shared memory for the page's next engine

Status: decided, owner decision, 7 October 2026. Task: M2-R26.

Summary: When a threaded engine stops cleanly, the page keeps its shared memory for about 30 seconds, at most 2 memories. The next engine with the same core and maximum takes it, so a restart asks the browser for no new memory. In Mac Safari, 50 starts in a row made 1 memory in place of 50. A start in a full address space took 125 ms in place of 187 ms.

## Question

Apps destroy and create the engine in one page: React's strict mode, route changes, hot reloads, and the test runner's pages. Each threaded engine made a new shared memory. In Safari, that new memory could be refused (E1109), or wait in D-94's retries. How does the engine avoid that?

## Rule

A restart in the same page must not depend on when the browser frees the last engine's memory. The new engine must start as in a new memory, and no state of the last engine may reach it. The memory must not grow with each reuse.

## Why Safari needs it

Safari's JavaScript engine gives each of the first 8 WebAssembly memories in a page a "fast" place. That is 4 GiB of address space, so that the code needs no bounds checks. A later memory is bounds-checked, and takes only its maximum. A dropped memory's place stays taken until Safari's collector frees the memory.

On the owner's iPad (Safari 26.6.2) on 7 October 2026, main's engine failed this way within one page. The page started the engine 50 times in a row. In pipelined mode, Safari refused the 1 GiB memory of the 11th start 13 times over 45 s (E1109). With the sketch on the page, it refused the 7th start the same way. The same pages passed again in a new page. The iPad has room for about 6 such memories, so a few stopped engines that Safari has not freed yet fill it.

An earlier repro on the Mac seemed to show that Safari holds a dropped fast memory for as long as the page keeps asking. The test page itself still reached that memory, so it proved nothing ([D-94](D-94-memory-retry-window.md#open)). With nothing reaching it, Safari gave the place back at the next request. So the pool does not work around a fault in Safari. It removes the request, and with it the wait for Safari's collector, which a quick restart outruns on a device with little room.

## Options

| Option | Effect | Cost |
| --- | --- | --- |
| Keep D-94's retries only | A refused start waits until Safari frees a stopped engine's memory | On the owner's iPad, 45 s of retries did not get it back within the page |
| Longer gaps between the first retries | A refused start waits a few seconds at once | Every refused start waits, and no measure shows that a few seconds is enough |
| A smaller first memory | None: Safari gives a fast memory 4 GiB of address space at any size | None |
| Keep the stopped engine's memory in the page for the next engine (chosen) | A restart asks the browser for nothing | The memory's RAM stays taken until a new engine takes it or its time ends |

## Data

The restart page (`tests/pages/shared-memory.html`) started and stopped the engine 50 times in a row in each thread mode, with no other page open. It counts the shared memories that the starts made and that the browser refused, and the starts that waited for memory.

| Measure | Main (bf13d1bba) | With the pool | Device and browser |
| --- | --- | --- | --- |
| Shared memories made by 50 starts, each threaded mode | 50 | 1 | Mac, Safari 26.6.2 |
| Shared memories made by 50 starts, single-threaded | 0 | 0 | Mac, Safari 26.6.2 |
| Refused memories, and starts that waited for memory | 0 and 0 | 0 and 0 | Mac, Safari 26.6.2 |
| Start to first frame, median of the 50 starts, empty sketch, pipelined and sketch on the page | 125 ms and 108 ms | 115 ms and 102 ms | Mac, Safari 26.6.2 |
| The same with 34 memories held, so the address space is full (`?ballast=on`) | 187 ms and 140 ms | 125 ms and 108 ms | Mac, Safari 26.6.2 |
| The same with a million instances, so the memory grows to 246 MiB (`?sketch=heap`) | 207 ms and 190 ms | 210 ms and 174 ms | Mac, Safari 26.6.2 |
| The memory's size after 50 starts of that scene | 246 MiB each time, in 50 memories | 246 MiB, in 1 memory | Mac, Safari 26.6.2 |
| Clearing the start of a kept memory (1.1 MiB) on the page | 0.02 ms | | Mac, Safari 26.6.2 |
| The same | 0.33 ms | | Mac, Chrome 155 |
| Clearing a heap of 256 MiB and of 1 GiB with `memory.fill` | 1.7 ms and 6.9 ms | | Mac, Safari 26.6.2 |
| The same | 1.2 ms and 4.8 ms | | Mac, Chrome 155 |

On tablets and phones, the restart pages ran on main d6292d4b5 and on the branch's fix 2f382ab77. The 8 restart pages ran with their usual counts of the room, then 50 starts in a row on 3 of them:

| Device and browser | Main | With the pool |
| --- | --- | --- |
| The owner's iPad Pro 11-inch (A12X), Safari 26.6.2 | 8 pages: 7 of 8, one shared memory per start. 50 starts: Safari refused the memory at the 11th start in pipelined mode and at the 7th with the sketch on the page (E1109) | 8 of 8 and 3 of 3; 1 shared memory for each threaded page, none refused |
| BrowserStack's iPad (10th generation), Safari 27.0 | 8 of 8 and 3 of 3; one memory per start | 8 of 8 and 3 of 3; 1 memory for each threaded page |
| BrowserStack's Galaxy S25, Chrome 149 | 8 of 8 and 3 of 3; one memory per start | 50 starts: 3 of 3. With the sketch on the page, 6 of 50 stops waited out the 2 s limit, so its starts made 7 memories. The 8 pages did not run: the runner page did not start |

The first branch commit kept each test page's memory after the runner removed the page. On BrowserStack's iPad, each page then left one place of room taken, and the 7th page found none (E1109). The rule below that lets go of the pool on `pagehide` fixed it.

On this Mac, Safari refused no memory on main either. That held in a clean page, with the address space full, and with the room counted after each start. The refusals of D-92 and D-94 came on CI's slower Mac. So the local gain is fewer memories, and faster starts when the address space is full. The pool removes the request that CI's Safari refused.

The restart, failure and engine pages of the checks plan, 53 items, passed in Safari with the pool, twice. The restart pages made 1 memory each in 43 starts. In both runs of the 53, `canvas-kept-restarts-low-latency` found the room at 7 or 8 of 10 after its starts, which is a note. Main gave the same note in the same 53 pages, at 7 of 10. Six runs of the kept-canvas pages on their own found the room at 10 of 10.

How the data was produced: `bun tests/real-browsers.ts --only restarts-pipelined,... --switches 'cycles=50&room=off' Safari`, with `&sketch=heap` or `&ballast=on`, on 7 October 2026. Each pair of runs, on main and on the branch, ran back to back, with the Mac's load at 7 to 10. The clearing times come from a small page that fills a shared memory of each size and times `memory.fill` and a typed array's `fill`.

## Decision

The owner chose the pool on 7 October 2026, in every browser, so that the engine behaves the same everywhere.

- `engine.destroy()` keeps the memory once every thread that got the core answered its stop. The page's own core must not still be starting. A thread that failed, or did not answer within the stop's timeout, could still run in the memory. So the page drops that memory, and the browser frees it. The code is in `packages/engine/src/page/memory-pool.ts`.
- The pool keeps at most 2 memories, for 30 seconds each, and a third stop drops the oldest. React's strict mode and hot reloads start the next engine within a second. A page that stops the engine for good gets its RAM back after 30 seconds.
- `engine.destroy({ release: true })` empties the pool at once. A page that will not start the engine again soon uses it, most of all on a phone with little memory.
- A memory serves only an engine with the same core file and the same maximum, as `memory.maximumMiB` or the preset sets it. A memory's maximum is fixed. A larger one would let the engine grow past what the page asked for. An engine with another maximum makes a new memory, and the kept one stays until its time ends.
- The pool lets go of its memories when the page goes away (`pagehide`). A frame that its page removes runs no more timers, so the 30 seconds never end there. Safari can keep a removed frame's page, and all that it reaches, for minutes ([D-92](D-92-safari-removed-frames.md)). Before this rule, each test page on BrowserStack's iPad left its kept memory held. The seventh page in a row found no room at all (E1109).
- A new memory that the browser refuses first lets go of the kept memories, as it ends the drawing workers of kept canvases.
- The pool lives on the page's global object, so a hot reload's new copy of the engine's code finds it.
- The single-threaded build needs no pool. The page keeps its core, and the memory that the core made, for the next engine already.

### How a reused memory starts as a new one

The threaded core's start (`__wbindgen_start`) reads three words in the memory. A flag in the core's zeroed data says whether a thread has copied the core's data into the memory. The thread counter and lock of wasm-bindgen pick the first thread, which takes the static stack. They lie in a page that wasm-bindgen adds after the linker's memory. Before a new engine starts in a kept memory, the page clears its first 1.1 MiB, the core's initial size. The first thread then copies the data again, clears the zeroed data and takes the static stack, as in a new memory.

The heap needs one more step. Rust's allocator on this target gets pages only by growing the memory from its end. In a kept memory, it would grow past the last engine's heap and never use those pages again. Each reuse would add the last engine's peak, until the memory reached its maximum. So the threaded build has a global allocator of its own (`crates/null3d-wasm/src/heap.rs`). It is the dlmalloc that the standard library uses, behind the same spin lock. Its first request takes the pages that the memory already has above the core's initial size. It clears them with `memory.fill`, and grows the memory only for the rest. A new memory has no such pages, so it grows as before.

The heap starts one page after the end of the linker's memory, `__heap_end`. Version 0.2.129 of wasm-bindgen adds that page for its thread counter and the stack of a starting thread. With another count, the heap would overwrite them. So `bun run build` checks that the threaded core's memory has exactly one page more than the linked module's. Otherwise the build fails (`checkHeapStart` in `tools/build-wasm.ts`).

## Consequences

- `loadCore` takes a kept memory before it asks the browser for one. D-94's retries apply only to a new memory.
- An engine in a kept memory reports the memory's size from its start in `measure()`: the size that the largest engine in it reached.
- The RAM of a kept memory stays taken for up to 30 seconds after the stop.
- The restart checks count the kept memory: after the starts, the page reaches 1 memory, and the threaded starts on the page made 1. A restart page whose starts made more fails. With `?release=on`, the page reaches none.
- The engine API page and the skill's quick reference describe `destroy({ release })`.
- Open: BrowserStack's Galaxy S25 ran 50 starts with the sketch on the page. There the branch's stops took 1.7 s at the median, and 6 of 50 reached the 2 s limit. On main they took 1.55 s, and none did. Most of each stop waits for job workers that were still starting. In pipelined mode the branch's stops were shorter than main's. The two runs came from different sessions, so this needs a run of both in one session.
- The decoders make memories of their own in their workers: the meshopt decoder in the glTF worker, and the KTX2 transcoder in the job workers. The pool does not cover them. Whether their memories hold fast places after an engine stops is not measured yet.
