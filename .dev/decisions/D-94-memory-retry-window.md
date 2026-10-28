# D-94: Retry a refused shared memory for about 45 seconds, and tell the page at 10

Status: decided by the owner. Built: the retry window and the `memory-wait` notice. Open: whether the engine also frees memories held in workers or kept frames waits for a clean repro. Task: M2-R26.

Summary: When the browser refuses the engine's shared memory, the engine tries again for about 45 seconds before it fails with E1109. The waits double from 50 ms up to 8 s. At the first refusal after 10 seconds of waits, `onProgress` reports `memory-wait`. Safari on CI's Mac gives memory back 16 to 40 seconds after it refuses it.

## Question

How long should a new engine wait for memory that the browser refuses? Should the page hear about the wait before the engine gives up?

## Rule

The window covers the slowest return of memory measured in a browser the engine supports. A page that waits that long hears early that the start is slow. A memory that never comes back still fails with E1109.

## Data

| Measure | Result | Device and browser |
| --- | --- | --- |
| Memory of engines in removed frames, held after the frames went | Came back 16 to 40 s later; at times held for minutes ([D-92](D-92-safari-removed-frames.md)) | GitHub's macOS 15 machines, Safari 26.6.1 |
| The same, on this Mac, in the restart pages | Came back within 1 s | Mac, Safari 26.6.2 |
| Removed-frame probe, a page with no engine, plain Safari with no automation | Held 1 place for at least the 19 s that the probe watched; on CI, held room came back after about 2 minutes ([D-92](D-92-safari-removed-frames.md)) | Mac, Safari 26.6.2 |
| Engine starts refused with a window of 10 s | 9 tries over 10 s, then E1109, in the same-canvas checks after the frame restart pages | GitHub's macOS 15 machines, Safari 26.6.1 |

How the data was produced: diagnostic CI runs of the Safari 1/2 shard, as D-92 describes.

## Decision

The owner chose this option, from a sketch with the window, the gaps and the notice. The waits are 50, 100, 200, 400, 800, 1600, 3200 and 6400 ms, then 8000 ms four times: 44.75 s in all, over 13 tries. The notice comes at the first refusal after 10 seconds of waits, at the ninth try, 12.75 s in. The notice is a stage of `onProgress`, so it needs no callback of its own. A refusal after the last wait fails with E1109.

## Consequences

- `createSharedMemory` in `packages/engine/src/page/loader.ts` holds the schedule, and its unit tests check it with a clock that the waits move on.
- `StartupStage` has `memory-wait`. The engine API page, the loading screens guide, the E1109 error page and the skill's quick reference and recipes say so.
- An app whose memory never comes back hears E1109 after about 45 seconds. A real leak still fails, only later than with a window of 10 s.

## What Safari's collection means for the engine

WebKit bug 247984 covers the memory that Safari keeps for removed frames. Safari also collects and tries again before it refuses a memory, but only on the asking thread's heap. [D-92](D-92-safari-removed-frames.md#safari-collects-and-tries-again-before-it-refuses) gives the detail.

### Where the engine asks for its memory

The threaded build makes its shared memory on the page's main thread (`createSharedMemory` in `packages/engine/src/page/loader.ts`). Each worker gets the memory in its start message. So each refused try in the window above makes Safari collect the main thread's heap. That heap holds the page and its same-origin frames. A dead memory that only the page or a removed frame reached comes back at the next try. The engine asks on the main thread, and asks there again after each refusal.

Two cases stay out of reach of these tries:

- A dead memory whose last reference is in a worker that still runs. A stopped engine's workers end, and the first refusal ends the drawing workers that stopped engines left with their canvases. So no engine case of this is known. An app's own worker could hold one.
- A removed frame that something still reaches, such as a pointer on the stack. No collection frees it, on any thread.

### Open

The engine does not change until a clean repro shows which case holds memory in practice. The options:

| Option | Helps with | Cost |
| --- | --- | --- |
| Keep the engine as it is | The page's and removed frames' dead memories, as now | None |
| After a refusal, tell each running engine worker to ask for a memory that cannot fit, so that Safari collects that worker's heap too | Dead memories in workers that still run | Code in each kind of worker. A full collection stalls each worker for its length, so running engines drop a frame |
| After the window, ask again with a smaller maximum, as Chrome does (three quarters, a half, then a quarter) | Room that kept frames hold or split | The scene can hold less than the page asked for, with no word from the page. Growth past the smaller maximum fails later with E1109. The page needs a notice |

Safari first tries each new memory as a "fast" memory. A process has at most 8 of them, and each takes 4 GiB of the same 64 GiB area. A memory that is not shared takes one too. The engine's decoders make such memories in their workers and keep them for the worker's life. Whether they cost the engine room is not measured yet.

The engine's memory takes a fast slot while one is free, as the first 8 memories of a page do. JavaScriptCore's own log shows this. The macOS `jsc` shell is the same build as Safari 26.6.2. Run with `--logWasmMemory=1`, it made the first 8 memories of the engine's sizes as fast ones. A fast slot comes back once nothing reaches its memory, as the tests below show.

A test of a dropped fast-slot memory must make sure that nothing reaches it. On the owner's Mac (Safari 26.6.2), test pages filled the area with memories and dropped one that held a fast slot. They then asked for one more every 250 ms. Where the page still reached the dropped memory, Safari refused for the whole 60 s in 18 of 18 rounds. The engine's own retry then ended in E1109 in 6 of 6. A function that was still waiting held the memory, or the page read a weak reference to it before each ask.

Where the page kept the memory only in a global and then cleared it, nothing reached it. Safari then granted the next request at the first try, in 6 of 6 rounds. Three of them used the engine's own retry, which needed no second try. The `jsc` shell gave the same answer. So Safari gives a fast slot back once nothing reaches its memory, and this window needs no change for it. A page whose own code still reaches a stopped engine's memory holds its slot the same way, as it holds any memory it reaches.
