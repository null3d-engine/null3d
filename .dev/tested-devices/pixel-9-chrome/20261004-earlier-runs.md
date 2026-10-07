Plans: smoke 2026-10-04;
bloom-p2 2026-10-04;
checks 2026-10-04 (41 image pages);
prefilter, bloom-sizes and bloom 2026-10-05;
smoke, the KTX2 and meshopt pages, the second prefilter run, the environment image pages, and the room-light and environment generator pages through a held session, 2026-10-05;
smoke 2026-10-05 on main;
bench 2026-10-05, S1 with the sky off and on (M2-E3, 3891ba01e, then e8d10fd1d);
the background images 2026-10-05 and 2026-10-06 (M2-E3);
checks 2026-10-05, part 1 of 6 on main df9130987;
bench 2026-10-05, S4 against its 32-bit twin (M2-R8, cd216b832);
texture-cache 2026-10-06 (M2-A5, 8afe64d9f);
bench 2026-10-07, S4's stability with the depth snap (M2-R8, d0611b94b);
bench 2026-10-07, S1 with 7 background pages (M2-E3, 3b7d44a5b);
bench 2026-10-07, S4 at Low and Medium with and without the depth prepass (M2-R22, 293a2264c)

Result: 51 passed, 0 skipped, 0 failed bloom-p2 2026-10-04: 12 of 12 (run 20261004-192853-bloom-p2).
checks 2026-10-04: 41 of 41 (run 20261004-203238-checks).
prefilter 2026-10-05: 21 of 25 (run 20261005-004623-prefilter).
bloom-sizes 2026-10-05: 8 of 8; bloom: 4 of 4 (runs 20261005-010104-bloom-sizes, 20261005-011315-bloom) smoke 2026-10-05: 51 of 51 (run 20261005-013150-smoke).
KTX2 and meshopt pages: 36 of 36 (run 20261005-021508-checks).
prefilter, second run: 7 of 13, the 6 failures by design (run 20261005-024553-prefilter).
environment pages: 22 of 22 (run 20261005-035556-checks).
room-light 7 of 7, environment generator 3 of 3 smoke on main 62ab95e1b: 51 of 51 (run 20261005-081013-smoke).
Sky 2026-10-05: 22 of 22; WebGPU GPU time 11.80 ms without the sky and 12.12 ms with it (run 20261005-124327-bench).
With the sky drawn last: 11.99 and 12.32 ms (run 20261005-234436-bench).
Background images: 23 of 23 (run 20261005-132001-checks), and 26 of 26 on 2026-10-06 (run 20261006-003909-checks).
Part 1 of 6: 139 of 139 (run 20261005-135142-checks).
S4 against its 32-bit twin 2026-10-05: 21 of 22.
S4's shadow stability with 16-bit cascades failed on WebGPU, 0.092% of pixels against 0.05% (run 20261005-142108-bench).
Texture cache 2026-10-06: 21 of 21.
Ready in 7,811 ms without the cache and 8,029 ms with it on a first visit.
On a repeat visit, 7,872 and 7,394 ms, 6% sooner (run 20261006-230938-texture-cache).
S4 stability 2026-10-07: 12 of 12; 0.001% of shadow pixels changed on both paths; WebGPU GPU time 7.67 ms (run 20261007-011242-bench).
S1 backgrounds 2026-10-07: 36 of 36.
In the first run, before the phone grew hot, WebGPU GPU time was 11.60 ms with no background and 11.67 to 12.98 ms with each (run 20261007-022248-bench).
Depth prepass 2026-10-07: 16 of 16 runs at 59.4 to 60.1 fps.
Mean WebGPU GPU time at Low was 7.18 ms without it and 7.05 ms with it.
At Medium it was 9.08 and 8.95 ms, so no cost shows above the noise (runs 20261007-041042-bench to 20261007-050909-bench).
