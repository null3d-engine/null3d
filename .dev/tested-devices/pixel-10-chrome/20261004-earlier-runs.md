Plans: smoke 2026-10-04;
checks 2026-10-04 (41 image pages);
occlusion 2026-10-04;
prefilter 2026-10-05;
the second prefilter run 2026-10-05;
the environment image pages, the room-light and environment generator pages through a held session, the KTX2 and meshopt pages, and smoke on main, 2026-10-05;
environment-load 2026-10-05;
effects 2026-10-05 and 2026-10-06

Result: 51 passed, 0 skipped, 0 failed checks 2026-10-04: 41 of 41 (run 20261004-203238-checks).
occlusion 2026-10-04: 1 of 1 (run 20261004-205925-occlusion).
prefilter 2026-10-05: 21 of 25 (run 20261005-005022-prefilter) prefilter, second run: 7 of 13, the 6 failures by design (run 20261005-024553-prefilter) environment pages 2026-10-05: 22 of 22 (run 20261005-071625-checks); room-light 7 of 7 and environment generator 3 of 3, first map at load 94.5, 91.8 and 67.8 ms on WebGPU, compatibility mode and WebGL2.
KTX2 and meshopt pages: 36 of 36 (run 20261005-073018-checks).
smoke on main 62ab95e1b: 51 of 51 (run 20261005-081013-smoke).
environment-load 2026-10-05: 6 of 6 ([D-19](../../decisions/D-19-environment-maps.md)).
effects 2026-10-05: 4 of 4 pages, then the WebGL2 pages twice more with per-call timing, 2 of 2 each.
effects 2026-10-06, on the final build: 4 of 4 (run 20261006-002702-effects)
