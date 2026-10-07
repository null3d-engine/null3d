Plans: checks 2026-10-03 (the smoke plan's 50 pages);
the mip levels and shaders pages 2026-10-03;
smoke 2026-10-03;
checks 2026-10-03, the full plan of 656 pages;
smoke 2026-10-04 (Automate);
proto-s3, bloom-p2, occlusion 2026-10-04;
checks 2026-10-04 (41 image pages of wide lines, sprites, ambient occlusion and occlusion culling);
checks 2026-10-05 (25 pages of the specular, IOR, standard maps and custom textures scenes);
prefilter, bloom-sizes and bloom 2026-10-05, from prototype and feature branches;
smoke, the KTX2 and meshopt pages, the meshopt pages with vertex skinning and the skinning probe, the second prefilter run, a WebGL2 S4 bench of two commits, the environment image pages, and the room-light, environment generator and glTF poses pages through held sessions, 2026-10-05, from feature branches and main;
the skinning fix's confirmation 2026-10-05;
the WebGL2 environment fix's confirmation 2026-10-05;
smoke 2026-10-05 on main;
the runner's screen rate check 2026-10-05 (fix/s24-low-latency-pace 7d3a73c2);
gpu-occlusion 2026-10-07, from the M2-I1 branch (89032719b);
the KTX2 pages and the HDR and image format images 2026-10-05 (feat/m2-a7-image-formats 8a5b16ec3);
the 50 shadow image tests 2026-10-04;
bench 2026-10-05, S4 at Low with the cascade blend's band on and off (M2-R1, 660fa564d);
bench 2026-10-05, S1 with the sky off and on (M2-E3, 3891ba01e, then e8d10fd1d);
the background images 2026-10-05 and 2026-10-06 (M2-E3);
the canvas reuse pages 2026-10-05 (8cf4c7ab3);
bench 2026-10-05, S4 against its 32-bit twin (M2-R8, cd216b832);
checks 2026-10-05, the whole plan in 6 parts on main 94cd0095a;
checks 2026-10-05 on main 32f387b8d;
probe pages 2026-10-05 to 2026-10-07, from probe branches that never merged (M2-R23);
texture-cache 2026-10-06 (M2-A5, 8afe64d9f);
bench 2026-10-07, S4's stability with the depth snap (M2-R8, d0611b94b);
bench 2026-10-07, S1 with 7 background pages, twice (M2-E3, 3b7d44a5b and a test build);
the 21 shadow image tests 2026-10-07 on main 80a97ab51, with 16-bit and with 32-bit cascades;
checks 2026-10-07, the map, specular and environment pages (M2-J7, 975725706);
bench 2026-10-07, S4 at Low and Medium with and without the depth prepass (M2-R22, 293a2264c)

Result: checks 2026-10-03, the full plan: 27 pages passed, then the runner page stopped answering on page 29, the held image test with the sketch on the main thread.
The shader library page on WebGPU failed `noise::fbm2` in 3 of its 426 cases, and on WebGL2 it matched all 426.
smoke 2026-10-04: 51 passed, 0 skipped, 0 failed proto-s3 2026-10-04: 10 of 10 (run 20261004-175359-proto-s3).
bloom-p2 2026-10-04: 12 of 12 (run 20261004-192853-bloom-p2).
checks 2026-10-04: 41 of 41 (run 20261004-203238-checks).
occlusion 2026-10-04: 1 of 1 (run 20261004-205925-occlusion).
checks 2026-10-05: 25 of 25 (run 20261005-003243-checks).
prefilter 2026-10-05: 21 of 25 (run 20261005-004323-prefilter).
bloom-sizes 2026-10-05: 8 of 8; bloom 2026-10-05: 4 of 4 (runs 20261005-010104-bloom-sizes, 20261005-011315-bloom) smoke 2026-10-05: 51 of 51 (run 20261005-013150-smoke).
KTX2 and meshopt pages: 34 of 36 (run 20261005-021508-checks).
meshopt KHR with vertex skinning: 2 of 2, no pixel different (run 20261005-033641-checks).
prefilter 2026-10-05, second run: 7 of 13, the 6 failures by design (run 20261005-024553-prefilter).
bench 2026-10-05, S4 at Low with WebGL2, four runs: 30 fps held in every second.
environment pages 2026-10-05: 15 of 22 (run 20261005-035556-checks).
room-light 7 of 7, environment generator 3 of 3, glTF poses 14 of 14 models Skinning fix (fix/s25-meshopt-vertex-format 510e211c7): 5 of 7; every image passes, and the skinning probe still finds one case wrong, tangents with packed 8-bit attributes (run 20261005-043306-checks) WebGL2 environment fix (fix/s25-webgl2-environment 46292b0b0): 7 of 7 environment images on WebGL2 (run 20261005-044031-checks) The skinning fix's later commit 6e3c76b38: 7 of 7, all 12 probe cases right (run 20261005-044458-checks) smoke on main 62ab95e1b: 51 of 51 (run 20261005-081013-smoke) screen rate check, 3 rounds: 12 of 12 (run 20261005-093951-checks).
The screen measured 30 Hz, and every engine page held a median frame interval of 33.33 ms gpu-occlusion 2026-10-07: 1 of 1, and all 6 views of the room match culling off in every pixel on WebGPU.
GPU time 3.74 ms with culling off and 4.85 ms with it on, with the screen at 30 Hz (run 20261007-035830-gpu-occlusion).
Image formats (feat/m2-a7-image-formats 8a5b16ec3): 12 of 12 (run 20261005-133629-checks).
The HDR file became BC6H on both paths; ETC1S and UASTC became BC7 on WebGL2, and ETC2 and ASTC on WebGPU.
Shadow image tests 2026-10-04: 50 of 50 (run 20261004-152828-checks).
Cascade blend 2026-10-05: 22 of 22; WebGPU GPU time 7.67 ms with the band and 7.60 ms without (run 20261005-122500-bench).
Sky 2026-10-05: 22 of 22; WebGPU GPU time 12.71 ms without the sky and 19.43 ms with it (run 20261005-124327-bench).
With the sky drawn last: 12.91 and 18.61 ms (run 20261005-234436-bench).
Background images 2026-10-05: 22 of 23 (run 20261005-132001-checks).
The WebGL2 environment background differed in 9.0%: the Adreno fault that #322 fixed, which the branch did not hold yet.
Background images 2026-10-06: 26 of 26 (run 20261006-003909-checks).
Canvas reuse 2026-10-05: 21 of 21 (run 20261005-153955-checks).
S4 against its 32-bit twin 2026-10-05: 20 of 22.
Both failures are S4's shadow stability with 16-bit cascades, 0.095% and 0.085% of pixels against 0.05% (run 20261005-142108-bench).
Whole plan 2026-10-05: 796 passed, 40 failed, all on WebGPU and in compatibility mode (runs 20261005-192535 to 20261005-213146-checks).
The failures were skinning, morphs, meshopt KHR, animated glTF and S5, as the skinning fix had not merged yet, plus depth precision and texture arrays.
Main 32f387b8d 2026-10-05: 52 passed, 7 failed: texture arrays in compatibility mode (87.1%) and depth precision (48.5% and 51.2%) (run 20261005-232607-checks).
The probe pages found the causes of those two faults (runs 20261005-233902-checks to 20261007-044124-checks).
Texture cache 2026-10-06: 21 of 21.
Ready in 7,604 ms without the cache and 7,842 ms with it on a first visit.
On a repeat visit, 7,775 and 7,311 ms, 6% sooner (run 20261006-230938-texture-cache).
S4 stability 2026-10-07: 12 of 12; 0.000% of shadow pixels changed on both paths; WebGPU GPU time 7.63 ms (run 20261007-011242-bench).
S1 backgrounds 2026-10-07: 36 of 36 in each run.
WebGPU GPU time was 12.91 ms with no background, and 17.69 to 18.09 ms with each background, drawn first or last (runs 20261007-013600-bench, 20261007-051203-bench).
Shadow image tests 2026-10-07: 22 of 22 with 16-bit cascades, and 22 of 22 with 32-bit cascades (runs 20261007-033205-checks, 20261007-034206-checks).
Map, specular and environment pages 2026-10-07: 19 of 19 (run 20261007-035252-checks; D-89).
Depth prepass 2026-10-07: 16 of 16 runs at 30 fps.
WebGPU GPU time at Low was 7.34 ms without it and 7.41 to 7.47 ms with it.
At Medium it was 12.26 ms without and 12.58 to 12.65 ms with (runs 20261007-041042-bench to 20261007-050909-bench).
