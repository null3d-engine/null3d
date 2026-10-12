# iPhone 17 in Safari

- Device: iPhone 17 (BrowserStack's device list), 402 x 874 at 3x, 4 cores
- OS:
- Browser: Safari 26.6
- GPU: Apple GPU; WebGPU adapter: apple
- GPU paths: WebGPU, compatibility mode, WebGL2
- Where: BrowserStack Automate

## Known issues

Under BrowserStack Automate, Safari keeps the memory of engines in frames that a live page removed. The cloud iPhone 16 and iPhone 18 Pro do the same. So `frame-destroyed-restarts-pipelined` fails with E1109 once the room is gone, which took 2 to 6 starts on 12 October 2026 ([Where Automate differs from Live](../../devices.md#where-automate-differs-from-live)).
The owner's own iPad passed the same page with no refusal, so this is a fault of the cloud devices.
