Plans: smoke 2026-10-05;
checks 2026-10-06, M2-R15 items only: `frame-restarts-pipelined` 3 rounds each with main's, #336's first and #336's final WebGL2 context code, and with fix/ios-memory merged in;
the 10 WebGL2 `same-canvas-*` items;
the 6 `canvas-kept-restarts-*` and `frame-destroyed-restarts-*` items with fix/ios-memory;
then, with the restart pages' 91 s room wait, `restarts-low-latency`, `restarts-drawing-on-the-main-thread` and both `frame-restarts-*` items, 3 rounds each;
checks 2026-10-06, the Safari same-canvas memory fix: CI's order of the restart, frame restart and WebGL2 same-canvas `then` items, 3 rounds;
the same-canvas items with room counts, 2 rounds;
then, with the fix, the 3 `frame-restarts-*` items and the 10 WebGL2 `same-canvas-*` items, 2 rounds;
checks 2026-10-06, the capped room count: CI's 170 pages of Safari shard 2, in CI's order, twice;
with full counts of the room, the 3 restart pages 3 rounds, then the single-threaded and pipelined restart pages at 43 starts 2 rounds, then the memory plan's room count

Result: smoke 2026-10-05: 3 passed, 0 skipped, 0 failed.
Checks 2026-10-06: 28 of 28 passed (runs 20261006-003243 to -003530).
In the 12 frame restart rounds, the room fell by 3 at most and came back.
The kept-canvas items passed, but the room fell from 35 or 36 to between 24 and 29.
With the 91 s wait: 12 of 12 passed (run 20261006-005125).
The room was 38 before each page and 37 or 38 at the first count after.
Same-canvas memory fix, 2026-10-06: CI's order 27 of 27 passed (run 20261006-080405); with room counts 10 of 10 (run 20261006-081614), the room 36 to 38 at each page's start and 30 to 36 before its third start; with the fix 26 of 26 (run 20261006-084440), the room 35 to 37 at each start, so no page waited.
The screen was 1512 x 982 at 2x for these runs.
Capped room count, 2026-10-06: CI's shard 2, 169 of 170 (run 20261006-144206); the single-threaded restart page's held fall to 7 failed the stricter rule, which the next commit leaves to threaded engines.
Then 170 of 170 (run 20261006-145412); each restart page counted 10, the cap, before and after its starts.
Full counts: 8 of 9, then 4 of 4, then 1 of 1 (runs 20261006-150513, -150939 and -151154-memory).
The one failure was the check's own error, which judged a threaded page's fall by the room before its second round; that round got the room back.
The room at the end was 39
