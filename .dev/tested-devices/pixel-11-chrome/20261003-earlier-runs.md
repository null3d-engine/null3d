Plans: smoke 2026-10-03 (TestingBot);
the two shader library pages 2026-10-03 (BrowserStack);
smoke 2026-10-04 (Automate);
bloom-p2 2026-10-04;
prefilter, bloom-sizes and bloom 2026-10-05;
the second prefilter run 2026-10-05;
the environment image pages, the room-light and environment generator pages through a held session, the KTX2 and meshopt pages, and smoke on main, 2026-10-05;
checks 2026-10-05, the whole plan in 6 parts on main 94cd0095a

Result: smoke: 48 passed, and both shader library pages failed.
The rerun of those pages passed 2 of 2 smoke 2026-10-04: 51 of 51 (run 20261004-195904-smoke).
bloom-p2 2026-10-04: 12 of 12 (run 20261004-194005-bloom-p2).
prefilter 2026-10-05: 21 of 25 (run 20261005-005528-prefilter).
bloom-sizes 2026-10-05: 8 of 8; bloom: 4 of 4 (runs 20261005-010847-bloom-sizes, 20261005-011736-bloom) prefilter, second run: 7 of 13, the 6 failures by design (run 20261005-025041-prefilter) environment pages 2026-10-05: 22 of 22 (run 20261005-072106-checks); room-light 7 of 7 and environment generator 3 of 3, first map at load 56.0, 49.4 and 49.4 ms on WebGPU, compatibility mode and WebGL2.
KTX2 and meshopt pages: 36 of 36 (run 20261005-073902-checks).
smoke on main 62ab95e1b: 51 of 51 (run 20261005-091027-smoke).
Whole plan 2026-10-05: 836 of 836 (runs 20261005-163749 to 20261005-185722-checks).
