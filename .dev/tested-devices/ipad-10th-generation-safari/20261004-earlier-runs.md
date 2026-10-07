Plans: smoke 2026-10-04, twice;
checks 2026-10-05 (25 pages of the specular, IOR, standard maps and custom textures scenes);
smoke and the KTX2 and meshopt pages 2026-10-05;
bench 2026-10-05, S4 at Low on WebGPU, of two commits and with video on and off;
smoke 2026-10-05 on main;
bench 2026-10-06, S4 at Low on WebGPU with the governor off, on fix/shadow-trail: main, the far cascade in every frame, and a cache of the far cascade's still casters (since dropped), in turns;
smoke (the capabilities page), soak, startup and bench 2026-10-04, on the gate commit, standing in for the owner's iPad Pro 11-inch;
the KTX2 pages and the HDR and image format images 2026-10-05 (feat/m2-a7-image-formats 8a5b16ec3);
the shaders page 3 times 2026-10-05, on main 9c9749982 and on fix/webgl2-uniform-args 424e43ad5;
the background images 2026-10-05 and 2026-10-06 (M2-E3)

Result: smoke 2026-10-04: 50 passed, 0 skipped, 1 failed (run 20261004-175848-smoke).
checks 2026-10-05: 25 of 25 (run 20261005-003243-checks) smoke 2026-10-05: 50 passed, 1 failed, the same S4 image (run 20261005-013150-smoke).
KTX2 and meshopt pages: 36 of 36 (run 20261005-021508-checks).
bench: 21 to 23 fps on WebGPU and 33 fps with WebGL2, with the screen at 60 Hz smoke on main 62ab95e1b: 49 passed, 2 failed (run 20261005-081013-smoke): the S4 image as before, and one WebGL2 program that does not link bench 2026-10-06 (runs 20261006-015357 to 20261006-021131-bench): 2 of 2 in each of 6 runs.
Median GPU time per frame: main 6.36 ms and the far cascade in every frame 6.47 ms in sessions that waited about 12 ms; all three builds 13.13 to 13.76 ms in sessions that waited about 45 ms ([D-16](../../decisions/D-16-moving-casters-and-bias.md#the-still-caster-cache-built-and-dropped-6-october-2026)).
smoke 2026-10-04: 1 of 1, the capabilities page, screen at 60 Hz.
soak 2026-10-04: 2 of 2, both 30-minute S4 soaks, with no GPU loss and no memory growth; median 21.0 fps on WebGPU and 35.1 fps with WebGL2.
startup 2026-10-04: 55 of 55; first frame done, pipelined, 1083 ms cold and 307 ms warm.
bench 2026-10-04, S4 at Low with the governor off, WebGPU: 4 of 4, GPU time 10.89 and 10.88 ms on f46c0686 against 11.93 and 12.03 ms on the gate commit.
Image formats (feat/m2-a7-image-formats 8a5b16ec3): 12 of 12 (run 20261005-133629-checks).
The HDR file became `rgb9e5ufloat`, ETC1S became ETC2 and UASTC became ASTC, on both paths.
Shaders page 2026-10-05: 6 of 6 on main (run 20261005-110730-checks), and 3 of 3 on the fix, with no program linked again (run 20261005-121642-checks).
Background images 2026-10-05: 23 of 23 (run 20261005-132001-checks).
Background images 2026-10-06: 7 passed and 3 failed, then the engine's memory was refused (E1109), and 16 did not run (run 20261006-003909-checks).
