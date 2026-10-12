# iPhone 18 Pro in Safari

- Device: iPhone 18 Pro (BrowserStack's device list), 402 x 874 at 3x, 4 cores
- OS:
- Browser: Safari 27.0
- GPU: Apple GPU; WebGPU adapter: apple
- GPU paths: WebGPU, compatibility mode, WebGL2
- Where: BrowserStack Automate

## Known issues

Under BrowserStack Automate, Safari keeps the memory of engines in frames that a live page removed, as on the cloud iPhone 16. So `frame-destroyed-restarts-pipelined` fails with E1109 once the room is gone, which took 2 to 5 starts on 11 October 2026 ([Where Automate differs from Live](../../devices.md#where-automate-differs-from-live)).
