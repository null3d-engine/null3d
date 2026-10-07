# D-92: Frame restart pages in runner pages of their own, and notes for memory that removed frames keep

Status: decided, and confirmed by the owner on 7 October 2026. Date: 7 October 2026. Task: M2-R26.

Summary: Safari on CI's Mac sometimes keeps a removed frame's whole page, and the shared memory it reaches, for minutes, even with no engine. So each frame restart page runs in a runner page of its own. Memory that stopped engines in removed frames leave held is a note, not a failure.

## Question

Safari 1/2 in the merge queue failed about 1 run in 3 with E1109 on the same-canvas pages. Those pages run right after the frame restart pages. What holds the memory, and what should the engine and the checks do about it?

## Rule

Fix the cause in the engine if the engine holds the memory. If the browser holds it, keep later pages free of it, and judge the browser's part apart from the engine's.

## Data

Diagnostic runs on CI's Mac (Safari 26.6.1), on a branch of their own that never merges, from 6 to 7 October 2026:

| Measure | Result |
| --- | --- |
| Safari's memory map at each refused engine start (run 37545710355) | 55 to 59 GiB of the 64 GiB area free, in blocks of 25 to 30 GiB; 1 or 2 engine memories alive |
| The same request straight after a refused room count (run 37548335782) | Granted at all 18 refusals, with 5 more of other sizes |
| Removed-frame probe, 2 frames of 256 MiB each, room watched for 16 s (run 37556572452) | Held past 16 s: a plain page with no engine 2 of 8, its page still alive; a running low-latency engine 2 of 4, its page still alive; others came back within 4 s |
| Restart pages that count the whole room (run 37559349506) | 12 of 36 places held for 118 s and 123 s after `frame-destroyed-restarts-low-latency` and the next page; other pages started at 2, 3 or 6 and were back to full by their end |
| Safari's budget of bytes for these memories | 21 memories of 1 GiB initial size, against 36 to 38 places of address space; engines start at 1.1 MiB, so the budget does not refuse them |

The same probe ran on the owner's Mac (Safari 26.6.2) on 7 October 2026, in plain Safari and through WebDriver. All 8 pages passed. Plain Safari kept a removed frame's page with no engine, and 1 place of room, for at least the 19 s that the probe watched. The probe stops watching at 19 s, so it cannot tell 19 s from 19 minutes. On CI, held room came back after about 2 minutes. So Safari keeps removed frames without automation too.

How the data was produced: `gh workflow run ci.yml` on the diagnostic branch, running only the Safari 1/2 shard, at most 4 copies at once. The test server saved Safari's memory map with `vmmap` when a page posted a refusal. The probe is `tests/pages/frame-memory.html`, on the branch `probe/ios-frame-memory`.

## Decision

The browser holds the memory. A removed frame's page that Safari keeps reaches everything in it: the engine, the scene's typed arrays and the app's own variables. Ending the engine's workers earlier changes nothing there, and the probe's case that ends every worker on `pagehide` still held once. So the engine is not changed.

- The frame restart pages (`frame-restarts-*` and `frame-destroyed-restarts-*`) each run in a runner page of their own (`ownTab` in the plan). The runner tool opens runner pages for the browser apps on a Mac. There, a runner page hands the run to a new one before such a page and after it, and closes. What Safari keeps from those frames then cannot starve the pages after them.
- In `frame-destroyed-restarts-*`, room that stays held after the engines stopped is a note. The note gives the room before and after each round, and how long the page waited. A start or stop that fails still fails the check.
- The restarts on the page still fail on held room, since their engines stop with no frame. So does `frame-restarts-*`, whose engines run when their frames go. Kept canvases keep their drawing workers while the page lives, as the owner ruled, and their held room stays a note.

## Consequences

- `tests/lib/runs.ts` (`ownTab`, `handovers`, the wait's `onHandover`), `tests/pages/runner.ts` and `tests/real-browsers.ts` hand the run over; `tests/lib/plans.ts` marks the pages and judges the held room.
- A run takes about 5 more runner pages, a few seconds each. Runner pages that the tool cannot open, on phones, tablets and the device cloud, run these pages in place as before.
- The owner can overrule. A fix in Safari, or proof of an engine part, reopens the question.

## Addendum, 2026-10-07

A review of this record against WebKit's source and bug list found three things that change how to read the data. The decision stands.

### WebKit already knows this behavior

[WebKit bug 247984](https://bugs.webkit.org/show_bug.cgi?id=247984), "References to iframes seem do not get garbage collected", has been open since November 2022. It holds a sample with a `WebAssembly.Memory` in a removed frame, the same case as ours. Apple's engineers replied that the frame's page is still alive, so its memory is too. On 26 April 2023 one of them found no leak, since removed frames do get destroyed. But "GC is not destroying frames as fast as they are constructed", which "looks like GC not being aggressive enough". No standard says when a browser must free a removed frame's memory. So the hold is known behavior of Safari's collector, not a new fault.

### Safari collects and tries again before it refuses

When a new WebAssembly memory does not fit, Safari's JavaScript engine runs one full garbage collection and tries again (`tryAllocate` in WebKit's `WasmMemory.cpp`). Every collection then frees the dead WebAssembly memories it found at once. So a memory that nothing reaches comes back at the first refusal.

The collection runs only on the heap of the thread that asked. The page and its same-origin frames share the main thread's heap, and each worker has a heap of its own. When the last reference to a memory was in another thread, the memory stays held. A local experiment on 7 October 2026 showed this. A worker's request was refused while memories that the page had dropped waited. The page's own request then got them back. This is the likely reason a worker's request can fail while the page holds dead memories. [D-94](D-94-memory-retry-window.md#open) gives what it means for the engine.

### What the probe can and cannot show

- The probe's kept frames survived at least 4 refusals, each with a full collection of the main thread's heap. So something still reached them. Safari scans the stack conservatively: a value on the stack that looks like a pointer keeps its object alive. WebKit's own leak tests make 10 to 20 frames and pass when any one is freed, for this reason. A Web Inspector heap snapshot tells a conservative root from a strong reference that outlived the frame. Only the second would be a WebKit fault.
- The probe's frames loaded Vite's live-reload client, and the parent page read each frame's window. Both put references to the frame on the page's side.
- The probe and the whole-room counts keep every memory they count in one array and drop them together. One stale pointer to that array holds all of them. This most likely explains a WebDriver run that found no room at all: two frames of 256 MiB each cannot take about 120 places.
- A clean repro without these confounders is still to come. The figures above give the room that the tests saw held. They do not show what held it.
