Plans: checks, bench, governor, startup 2026-10-04, on the gate commit;
the runner's screen rate check 2026-10-05 (fix/s24-low-latency-pace 7d3a73c2), 3 rounds;
environment-load 2026-10-05;
scale and bench 2026-10-04, S5 (main a1168724);
checks 2026-10-05, the capabilities page and 3 engine pages 3 times (main df9130987);
texture-cache 2026-10-06 (M2-A5, 8afe64d9f)

Result: checks 2026-10-04: 232 passed, 413 skipped (the WebGPU and compatibility mode pages), 11 failed, none a drawing fault.
bench 2026-10-04: S1 at 300,000 21 of 21, S3 and S1-cells 42 of 42, S4 2 of 2.
governor 2026-10-04: 2 passed, 2 skipped.
startup 2026-10-04: 55 of 55.
The runner's screen rate check 2026-10-05: 6 passed, 6 failed (run 20261005-094205-checks).
The screen measured 30 Hz, and every engine page held a median frame interval of 33.33 ms.
Each failure is a pipelined or low-latency engine page that took 1.5 to 2.0 s to stop: a job worker did not leave the job system.
Single-threaded passed every round.
environment-load 2026-10-05: 3 passed, 3 skipped (the WebGPU pages), 0 failed ([D-19](../../decisions/D-19-environment-maps.md)).
scale 2026-10-04, S5: three.js on WebGL holds 30 fps up to 140 characters, and draws 28.2 fps at 150 (run 20261004-155646-scale).
bench 2026-10-04, S5 at 140 characters: 21 of 21.
null3D with WebGL2 took 13.39 ms per frame, 35% of three.js's 37.95 ms, and held 30 fps (run 20261004-160138-bench).
checks 2026-10-05: 12 of 12; each engine stopped in 73 to 321 ms (run 20261005-122218-checks).
Texture cache 2026-10-06: 21 of 21.
Ready in 8,258 ms without the cache and 8,416 ms with it on a first visit.
On a repeat visit, 8,475 and 7,947 ms, 6% sooner (run 20261006-231919-texture-cache).
