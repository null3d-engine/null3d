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

Under BrowserStack Automate, Safari keeps the memory of engines in frames that a live page removed, as on the cloud iPhone 16.
So `frame-destroyed-restarts-pipelined` fails with E1109 once the room is gone, which takes 2 to 5 starts ([run](20261011-121744-smoke.md), [run](20261011-133156-smoke.md), [Where Automate differs from Live](../../devices.md#where-automate-differs-from-live)).
