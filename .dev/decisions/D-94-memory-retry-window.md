# D-94: Retry a refused shared memory for about 45 seconds, and tell the page at 10

Status: decided. Date: 7 October 2026. Task: M2-R26.

Summary: When the browser refuses the engine's shared memory, the engine tries again for about 45 seconds, with waits that double from 50 ms up to 8 s, before it fails with E1109. At the first refusal after 10 seconds of waits, `onProgress` reports `memory-wait`. Safari on CI's Mac gave memory back 16 to 40 seconds after it refused it.

## Question

How long should a new engine wait for memory that the browser refuses, and should the page hear about the wait before the engine gives up?

## Rule

The window covers the slowest return of memory measured in a browser the engine supports. A page that waits that long hears early that the start is slow. A memory that never comes back still fails with E1109.

## Data

| Measure | Result | Device and browser |
| --- | --- | --- |
| Memory of engines in removed frames, held after the frames went | Came back 16 to 40 s later; at times held for minutes ([D-92](D-92-safari-removed-frames.md)) | GitHub's macOS 15 machines, Safari 26.6.1 |
| The same, on this Mac, in the restart pages | Came back within 1 s | Mac, Safari 26.6.2 |
| Removed-frame probe, a page with no engine, plain Safari with no automation | Held 1 place for about 19 s ([D-92](D-92-safari-removed-frames.md)) | Mac, Safari 26.6.2 |
| Engine starts refused before this change | 9 tries over 10 s, then E1109, in the same-canvas checks after the frame restart pages | GitHub's macOS 15 machines, Safari 26.6.1 |

How the data was produced: diagnostic CI runs of the Safari 1/2 shard on 6 and 7 October 2026, as D-92 describes.

## Decision

The owner chose this option on 7 October 2026, from a sketch with the window, the gaps and the notice. The waits are 50, 100, 200, 400, 800, 1600, 3200 and 6400 ms, then 8000 ms four times: 44.75 s in all, over 13 tries. The notice comes at the first refusal after 10 seconds of waits, at the ninth try, 12.75 s in. The notice is a new stage of `onProgress`, so it needs no new callback. A refusal after the last wait fails with E1109, as before.

## Consequences

- `createSharedMemory` in `packages/engine/src/page/loader.ts` holds the schedule, and its unit tests check it with a clock that the waits move on.
- `StartupStage` gains `memory-wait`. The engine API page, the loading screens guide, the E1109 error page and the skill's quick reference and recipes say so.
- An app whose memory never comes back hears E1109 after about 45 seconds instead of 10. A real leak still fails, only later.
