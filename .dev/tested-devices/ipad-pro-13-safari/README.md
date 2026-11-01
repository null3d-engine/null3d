# iPad Pro 13 in Safari

- Device: iPad Pro 13 (BrowserStack's device list), 1032 x 1376 at 2x, 8 cores
- OS:
- Browser: Safari 26.6.1
- GPU: Apple GPU; WebGPU adapter: apple
- GPU paths: WebGPU, compatibility mode, WebGL2
- Where: BrowserStack Automate

## Known issues

Under BrowserStack Automate, the engine can refuse pages for memory (E1109) after about 20 pages.
The runner then ends the session and starts a new one ([run](20261004-earlier-runs.md), [D-12](../../decisions/D-12-memory-budgets.md)).

[The bench run `20261024-081826`](20261024-081826-bench.md) records S5's per-pass GPU figures. They
do not give the two-step pass's second step. That run held the render scale at High's floor of 0.75, with the
governor on. The engine times seven passes, and folds every later pass into the seventh. The pass
it calls the last one therefore holds the frame's tail, and its 20.5 to 34.9 ms is not the second
step. The governor is off there, and the render scale is pinned at 0.5. The second step then costs
2.96 to 2.99 ms at Low, where the frame is 6.14 to 6.23 ms. On High's canvas it costs 3.71 to 4.16 ms
([run](20261101-061916-bench.md), [D-236](../../decisions/D-236-final-pass-upscale-build.md)).

S5's gate rows read 29.0 frames a second against the gate commit's 36.1. Three runs of the same page
at one code state read 36.2, 35.7 and 29.6 as the device warmed. The render scale was pinned at 0.5
in each. The gate commit's 36.1 lies inside that spread; the head's 29.0 sits 0.6 below its floor.
The drop is still not separable from the device's own variation at this precision ([run](20261101-061301-bench.md),
[D-236](../../decisions/D-236-final-pass-upscale-build.md)).

Under BrowserStack Automate, Safari keeps the memory of engines in frames that a live page removed, as on the cloud iPhone 16.
So `frame-destroyed-restarts-pipelined` fails with E1109 once the room is gone, which takes 2 to 5 starts ([run](20261011-121744-smoke.md), [run](20261011-133156-smoke.md), [Where Automate differs from Live](../../devices.md#where-automate-differs-from-live)).
