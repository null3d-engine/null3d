Plans: checks 2026-09-29 to 2026-10-03;
bench, memory, parity, scale 2026-09-29;
overload, depth 2026-09-30;
bench, governor, skinning, tab-memory, warm-up-time 2026-10-02;
bench 2026-10-03;
startup, bench, governor 2026-10-04;
bench 2026-10-05 (S4 at Low, main against the shadow fix, 4 runs);
smoke and checks 2026-10-05 on main 91c7d279;
the WebGL2 environment pages, room-light and generator pages of feat/m2-e9-room-at-load 0d49786c;
the WebGL2 shadow pages and contact checks of fix/shadow-contact-gap 02ea2e43 against main;
the WebGL2 meshopt and skinning pages of fix/s25-meshopt-vertex-format 6e3c76b3;
low latency on WebGL2 in rounds on five commits, 2026-10-05, in Chrome 154.0.8037.126;
startup (twice), bench, governor, checks 2026-10-05, on the gate commit 89a1d6295;
jitter 2026-10-05 (feat/m2-h2-world-jitter eecaaa187);
environment-load 2026-10-07 on main 3ca165cc3;
startup 2026-10-07 on main 3ca165cc3, 5 loads of each kind in every thread mode, on Slow 4G and at full speed

Result: startup 2026-10-04, on the gate commit: 100 of 100 loads.
On Slow 4G, the first frame of a cold load took 4.90 s in the pipelined mode, over the 4.5 s target, and a warm load 0.96 s, within 1 s.
bench 2026-10-04, on the gate commit: S4 at Low for 10 minutes held 60 fps in 100% of the measured seconds.
S1 at 300,000 against three.js: 16 passed, 5 skipped; null3D took 58% of three.js's CPU time per frame.
S3 and S1-cells: 27 passed, 10 skipped, and the 5 S3 pages of three.js's WebGL renderer failed, because that renderer cannot draw S3 on this GPU.
governor 2026-10-04: 2 passed, 2 skipped.
checks 2026-10-03: 239 passed, 413 skipped (the WebGPU and compatibility mode pages), 0 failed.
bench 2026-10-05: 8 of 8 passed (4 runs and their visual checks).
smoke 2026-10-05: 22 passed, 29 skipped, 0 failed (run 20261005-072232-smoke).
checks 2026-10-05: 305 passed, 522 skipped, 1 failed, low latency on WebGL2 (run 20261005-072427-checks).
E9: 8 of 8 environment pages (run 20261005-074005-checks); room light passed; generator passed, first map at load 60.1 ms.
Shadow fix: 15 of 15 shadow pages (run 20261005-074055-checks); the stripes on open lit ground fall from 3.7% to 10.8% on main to 0.06% to 0.41% with the fix, under the 1.5% limit.
Skinning fix: 10 of 10 meshopt and skinning pages (run 20261005-074712-checks).
The phone stayed cool: thermal status 0, no Samsung throttle.
Gate commit 89a1d6295, 2026-10-05, at 60 Hz and thermal status 0 before each timed run: startup, Slow 4G, pipelined, first frame done at 4,532 ms cold and 945 ms warm, then 4,557 ms and 945 ms in a second run; the cold target is 5.5 s ([D-83](../../decisions/D-83-gate-rulings-2026-10-06.md)).
S4 at Low for 10 minutes held 60 fps in 300 of 300 seconds (run 20261005-155424-bench).
governor: 2 passed, 2 skipped (run 20261005-160442-governor).
S1 at 300,000 against three.js: 16 passed, 5 skipped; null3D took 57% of three.js's CPU time per frame (run 20261005-160642-bench).
S3 and S1-cells: 27 passed, 10 skipped, and the 5 S3 pages of three.js's WebGL renderer failed (run 20261005-162110-bench).
checks: 307 passed, 524 skipped, 0 failed (run 20261005-163754-checks).
jitter: 1 passed, 1 skipped (run 20261005-190800-jitter).
environment-load 2026-10-07: 3 passed, 3 skipped (the WebGPU pages), 0 failed (run 20261007-053943-environment-load).
The room, the .exr and the .hdr drew their first lit frame 174, 339 and 508 ms after the request, and no frame lacked the light ([D-19](../../decisions/D-19-environment-maps.md)).
startup 2026-10-07, medians to the first finished frame: Slow 4G cold 4,616 to 4,682 ms, with 12 requests and 424 KB; Slow 4G warm 937 to 968 ms.
At full speed: cold 342 to 359 ms, warm 328 to 364 ms.
All are within the targets of 5.5 s cold and 1 s warm ([D-83](../../decisions/D-83-gate-rulings-2026-10-06.md)).
Pipelined cold was about 125 ms slower than at the gate commit.
No heat warning; the battery went from 31.0 to 32.6 °C.
