# iPhone 17 in Safari

- Device: iPhone 17 (BrowserStack's device list), 402 x 874 at 3x, 4 cores
- OS:
- Browser: Safari 26.6
- GPU: Apple GPU; WebGPU adapter: apple
- GPU paths: WebGPU, compatibility mode, WebGL2
- Where: BrowserStack Automate

## Known issues

Under BrowserStack Automate, Safari keeps the memory of engines in frames that a live page removed.
The cloud iPhone 16 and iPhone 18 Pro do the same.
So `frame-destroyed-restarts-pipelined` fails with E1109 once the room is gone, which takes 2 to 6 starts ([run](20261012-014322-smoke.md), [run](20261012-020348-smoke.md), [Where Automate differs from Live](../../devices.md#where-automate-differs-from-live)).
The owner's own iPad passes the same page with no refusal, so this is a fault of the cloud devices.

The device list's "iOS 26" iPhone 17 gives Safari 26.2, 26.5 or 26.6 by chance. Safari 26.2 keeps each thread's own size of the shared memory, which a grow on another thread leaves behind (WebKit changes 299880 and 304204).
Before the engine's fix, the examples' Skyway and island first visits failed there with E1404, "Out of bounds memory access (evaluating 'wasm.jobWorkerLoop(index)')". That was 2 of the 4 visits that landed on Safari 26.2. No visit on Safari 26.5 or 26.6 failed.
The engine now grows the memory by one page on a thread that is behind ([D-393](../../decisions/D-393-thread-memory-size-refresh.md)). Playwright's WebKit from WebKit's bug window shows the fault and the fix on a Mac. No Safari 26.2 session came up to rerun it on the phone.
