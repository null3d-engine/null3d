# iPad Pro 13 in Safari

- Device: iPad Pro 13 (BrowserStack's device list), 1032 x 1376 at 2x, 8 cores
- OS:
- Browser: Safari 26.6.1
- GPU: Apple GPU; WebGPU adapter: apple
- GPU paths: WebGPU, compatibility mode, WebGL2
- Where: BrowserStack Automate

## Known issues

In the first session, the engine refused 3 pages for memory (E1109) after 20 pages, so the runner ended the session ([D-12](../../decisions/D-12-memory-budgets.md))

Under BrowserStack Automate, Safari keeps the memory of engines in frames that a live page removed, as on the cloud iPhone 16. So `frame-destroyed-restarts-pipelined` fails with E1109 once the room is gone, which took 2 to 5 starts on 11 October 2026 ([Where Automate differs from Live](../../devices.md#where-automate-differs-from-live)).
