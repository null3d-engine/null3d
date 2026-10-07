# iPhone 16 Pro in Safari

- Device: iPhone 16 Pro (TestingBot's device list), 402 x 874 at 3x, 4 cores
- OS: iOS 26.4 (TestingBot's device list); the user agent says iPhone OS 18.7
- Browser: Safari 26.4
- GPU: Apple GPU
- GPU paths: WebGPU, compatibility mode, WebGL2
- Where: TestingBot's device cloud

## Known issues

Safari refused the engine's shared memory of 1024 MiB, out of memory.
It kept the memory of earlier engines while their pages waited ([#223](https://github.com/null3d-engine/null3d/pull/223)).
The runner now ends the turn of a browser that keeps refusing ([#221](https://github.com/null3d-engine/null3d/pull/221))
