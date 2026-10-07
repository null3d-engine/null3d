Plans: checks 2026-09-29 to 2026-10-04;
memory, parity, scale, shared memory 2026-09-29;
bench 2026-09-29 to 2026-10-06;
depth 2026-09-30;
startup 2026-09-30, 2026-10-03 and 2026-10-05;
governor 2026-10-02 to 2026-10-04;
skinning, tab-memory 2026-10-02;
soak 2026-10-02, 2026-10-04 and 2026-10-05;
warm-up-time 2026-10-02 and 2026-10-03;
animation 2026-10-03;
soak, moving shadow page and bench 2026-10-06, the shadow fix 21fbae72c against main 8699fab4e;
checks, bench, governor 2026-10-05 on 03a1ad198;
startup, soak and bench 2026-10-05 on the gate commit 89a1d6295;
the bench plan's S4 visual checks 2026-10-06, on fix/capture-yield b72cb9640 (Medium, governor off, `?render=main`);
bench 2026-10-06, gr-a11 against fdf14a28;
bench 2026-10-06, the GPU time split of S4 at Low across 7 builds;
checks 2026-10-06 on main e9734b72e, with #352;
environment-load 2026-10-07 on main 3ca165cc3;
effects 2026-10-07 on main eff499ea4;
gpu-occlusion 2026-10-07 (docs/m2-i1-g1-timing a9ac1834d, main with #379);
checks 2026-10-07, the 18 map, glTF specular and environment image pages (M2-J7, feat/m2-j7-texture-packing 975725706)

Result: startup 2026-10-05, on the gate commit: 55 of 55; first frame done, pipelined, 182 ms cold and 131 ms warm over the local network.
bench 2026-10-05, S4 at Low with the governor off, WebGPU: 4 of 4, GPU time 9.16 and 9.17 ms on f46c0686 against 10.10 and 10.09 ms on the gate commit; an earlier round, run warm and charging, slowed with each run and is not used.
bench 2026-10-05, the same comparison of main 1533939f against the fix 84e2bd47 for Low ([D-16](../../decisions/D-16-moving-casters-and-bias.md)): 4 of 4, GPU time 11.33 and 11.35 ms against 10.35 and 10.47 ms.
soak 2026-10-05, on the gate commit: 2 of 2, both 30-minute S4 soaks, with no GPU loss and no memory growth; median 59.1 fps on WebGPU and 53.3 fps with WebGL2.
checks 2026-10-04, on the gate commit: 656 of 656 passed.
bench 2026-10-04, on the gate commit, S1 at 256,000 against three.js: 27 of 27 passed.
null3D took 52% of three.js's CPU time per frame on WebGPU and 55% with WebGL2 forced.
S4 at Low for 10 minutes: 60 fps in 99% of the measured seconds on each GPU path.
governor 2026-10-04: 4 of 4.
bench 2026-10-04, S3 and S1-cells: 49 passed, and the 5 S3 pages of three.js's WebGL renderer failed, because that renderer cannot draw S3.
soak 2026-10-04, stopped early: the 10 GPU-loss pages passed, and the two 30-minute soaks did not run to the end.
checks 2026-10-03: 6 of 6, the integer vertex types and their float twins on each GPU path.
soak 2026-10-02: 12 of 12.
startup 2026-10-03: 55 of 55, twice.
warm-up-time 2026-10-03: 120 of 120.
animation 2026-10-03: 2 of 2 ([D-26](../../decisions/D-26-animation-clips.md)).
bench 2026-10-06: S4 at Medium with one setting changed per run, 26 of 26 runs ([D-16](../../decisions/D-16-moving-casters-and-bias.md#addendum-2026-10-06-the-shadow-reads-on-webgl2-on-apple-gpus)).
Shadow fix 2026-10-06, on iPadOS 26.7: the S4 soak with the engine's preset (Low) ran 5 of 5 minutes at a median of 59.6 fps, and the owner saw the shadows stay under the cars (run 20261006-090211-soak).
The moving shadow page: 8 of 8 runs within 5 px, the largest gap 4.11 px.
S4 at Low on WebGPU, governor off: main 11.42 and 11.64 ms of GPU time, the fix 11.73, 11.70 and 11.99 ms, all at 60 fps; one slow run of main (55.5 fps) was left out (runs 20261006-093959 to 20261006-102909-bench).
Governor on for 300 s: 22 steps on main and 21 on the fix, both 98% of seconds at 60 fps ([D-16](../../decisions/D-16-moving-casters-and-bias.md#the-owners-ipad-check-and-the-cost-ruling-6-october-2026)).
2026-10-05, charging, with Limit Frame Rate on: checks on 03a1ad198, 831 of 831 (run 20261005-135655-checks).
S4 at Low for 10 minutes: 295 of 300 seconds at 60 fps on WebGPU, and 299 of 299 with WebGL2 forced after a 10-minute rest (runs 20261005-111656-bench, 20261005-130618-bench).
governor: 4 of 4.
S1 at 256,000: 27 of 27, null3D 53% of three.js's CPU time per frame on WebGPU and 56% with WebGL2.
S3 and S1-cells: 49 passed, and the 5 S3 pages of three.js's WebGL renderer failed.
On the gate commit: startup 55 of 55, first frame done, pipelined, 175 ms cold and 136 ms warm (run 20261005-154744-startup).
soak 12 of 12, but at 14.8 fps on WebGPU and 32.2 fps with WebGL2, because the iPad had slowed (run 20261005-161025-soak).
bench, S4 at Low with the governor off, f46c0686 against the gate commit: only the first pair held 60 fps, 9.46 against 10.08 ms of GPU time.
On fdf14a28, 2026-10-06: bench, a 60-second heat check at 60.0 fps after a Safari restart for E1109 (run 20261006-021836-bench); soak 12 of 12, median 59.3 fps on WebGPU and 50.0 fps with WebGL2, no GPU loss and no memory growth (run 20261006-022207-soak); bench, S4 at Low with the governor off, f46c0686 against fdf14a28: 4 of 4 at 60 fps, 9.91 and 9.92 ms against 10.75 and 10.73 ms of GPU time; bench, S4 at Low for 10 minutes: 300 of 300 seconds at 60 fps, 6 quality steps (run 20261006-040336-bench).
The S4 visual checks with the screenshot fix, 2026-10-06: 2 of 2 passed, WebGPU and WebGL2, no E1414 (run 20261006-053456-bench).
The same WebGPU check had failed with E1414 on main 01e0b0b1a (run 20261006-012128-bench).
bench 2026-10-06, S4 at Low with the governor off, gr-a11 (f46c0686 with the new GPU timer) against fdf14a28: 4 of 4 at 60 fps, 9.65 and 9.73 ms against 10.57 and 10.70 ms of GPU time.
bench 2026-10-06, 7 builds in 2 rounds, all at 60 fps with 56 draw calls: 9.70 to 11.09 ms of GPU time per frame (runs 20261006-145054-bench to 20261006-153019-bench).
checks 2026-10-06 on main e9734b72e, with the memory fix #352: 17 of 17, no E1109, no Safari restart (run 20261006-153139-checks).
environment-load 2026-10-07: 6 of 6 (run 20261007-043312-environment-load).
The room, the Venice Sunset .hdr and the studio .exr each drew their first lit frame 417 to 1,312 ms after the request.
WebGPU: room 1,312, .hdr 595, .exr 417 ms.
WebGL2: room 608, .hdr 466, .exr 418 ms.
No frame with the environment lacked its light ([D-19](../../decisions/D-19-environment-maps.md)).
effects 2026-10-07: 4 of 4, no memory refusal (run 20261007-054211-effects).
WebGPU GPU time per frame without and with 4 effects: 6.55 and 6.94 ms at render scale 1, and 7.60 and 7.53 ms at 0.5.
With WebGL2, the render worker's CPU time went from 0.58 to 0.72 ms at scale 1, and from 0.62 to 0.80 ms at 0.5 ([D-71](../../decisions/D-71-custom-effects.md)).
gpu-occlusion 2026-10-07: 1 of 1, no memory refusal (run 20261007-054639-gpu-occlusion).
All 6 views matched culling off in every pixel, with 94% of the room hidden.
GPU time 7.76 ms with culling off and 8.10 ms with it on ([D-22](../../decisions/D-22-occlusion-presets.md)).
Map, specular and environment pages 2026-10-07: 18 of 18 on WebGPU, compatibility mode and WebGL2 (run 20261007-053931-checks; D-89).
Three earlier tries never started, because the iPad's tab was asleep.
