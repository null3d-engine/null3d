# D-92: Frame restart pages in runner pages of their own, and notes for memory that removed frames keep

Status: decided. Date: 7 October 2026. Task: M2-R26.

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
