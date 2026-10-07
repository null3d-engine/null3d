Plans: depth 2026-09-29 and 2026-09-30;
overload 2026-09-30;
checks 2026-10-02;
governor 2026-10-05 (with `?render=main`);
gate 2026-10-05 on 89a1d6295 (images, parity and the timing steps);
gate 2026-10-06 on fdf14a28 (allocation);
bench 2026-10-06, S4 at Low on WebGPU, GPU times of 24 builds in turns ([Releases](../../releases.md#s4s-gpu-time-at-low-the-second-comparison));
bench (S4 at Low, in view and parked, 3 runs of each GPU path per set) 2026-10-06, on chore/chrome-park;
effects 2026-10-06 (headless, [D-71](../../decisions/D-71-custom-effects.md)).
The image tests' `chrome-real-gpu` references and the benchmarks run here through Playwright every day

Result: All passed.
governor 2026-10-05: 4 of 4.
bench 2026-10-06: every run finished but one, which the browser closed; S4 at Medium with one setting changed per run, 26 of 26 runs ([D-16](../../decisions/D-16-moving-casters-and-bias.md#addendum-2026-10-06-the-shadow-reads-on-webgl2-on-apple-gpus)).
Bench, S4 at Low with the window in view and parked, 2026-10-06: every run finished.
On the Mac's own screen, 120 frames per second each way, and the same GPU and CPU times within the runs' spread (runs 20261006-092815-bench to 20261006-094946-bench).
On the external 60 Hz screen alone, 60 frames per second and the same times each way (runs 20261006-100742-bench in view, 20261006-101325-bench parked).
The app in front kept the focus in every run ([Device sessions](../../devices.md#browser-apps-on-the-mac)).
gate 2026-10-05 on 89a1d6295: images 591 of 591 on the Mac's GPU and 591 of 591 on SwiftShader; parity 112 of 112; allocation of S4 failed on WebGL2 by 0.1 byte per frame in the governor; the soak, the desktop target and the WebGPU allocation passed.
gate 2026-10-06 on fdf14a28: allocation of S4 passed on WebGPU and WebGL2 (record 20261006-021354-gate)
