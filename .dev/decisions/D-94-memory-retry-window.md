# D-94: Retry a refused shared memory for about 45 seconds, and tell the page at 10

Status: decided. Date: 7 October 2026. Task: M2-R26.

Summary: When the browser refuses the engine's shared memory, the engine tries again for about 45 seconds before it fails with E1109. The waits double from 50 ms up to 8 s. At the first refusal after 10 seconds of waits, `onProgress` reports `memory-wait`. Safari on CI's Mac gave memory back 16 to 40 seconds after it refused it.

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
| Engine starts refused before this change | 9 tries over 10 s, then E1109, in the same-canvas checks after the frame restart pages | GitHub's macOS 15 machines, Safari 26.6.1 |

How the data was produced: diagnostic CI runs of the Safari 1/2 shard on 6 and 7 October 2026, as D-92 describes.

## Decision

The owner chose this option on 7 October 2026, from a sketch with the window, the gaps and the notice. The waits are 50, 100, 200, 400, 800, 1600, 3200 and 6400 ms, then 8000 ms four times: 44.75 s in all, over 13 tries. The notice comes at the first refusal after 10 seconds of waits, at the ninth try, 12.75 s in. The notice is a new stage of `onProgress`, so it needs no new callback. A refusal after the last wait fails with E1109, as before.

## Consequences

- `createSharedMemory` in `packages/engine/src/page/loader.ts` holds the schedule, and its unit tests check it with a clock that the waits move on.
- `StartupStage` gains `memory-wait`. The engine API page, the loading screens guide, the E1109 error page and the skill's quick reference and recipes say so.
- An app whose memory never comes back hears E1109 after about 45 seconds instead of 10. A real leak still fails, only later.

## Addendum, 2026-10-07

WebKit bug 247984 already covers the memory that Safari keeps for removed frames. Safari also collects and tries again before it refuses a memory, but only on the asking thread's heap. [D-92](D-92-safari-removed-frames.md#addendum-2026-10-07) gives the detail. This addendum says what that means for the engine.

### Where the engine asks for its memory

The threaded build makes its shared memory on the page's main thread (`createSharedMemory` in `packages/engine/src/page/loader.ts`). Each worker gets the memory in its start message. So each refused try in the window above makes Safari collect the main thread's heap. That heap holds the page and its same-origin frames. A dead memory that only the page or a removed frame reached comes back at the next try. Asking on the main thread, or asking there again after a refusal, is what the engine does already.

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
