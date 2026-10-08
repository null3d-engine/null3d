# Pixel 11 in Chrome

- Device: Pixel 11, 412 x 924 at 2.625x, 7 cores, 8 GB
- OS: Android 17
- Browser: Chrome 151.0.7922.173 (TestingBot); Chrome 152.0.7977.54 (BrowserStack)
- GPU: Imagination PowerVR C-Series CXTP-48-1536 (ANGLE on Vulkan 1.4.317, driver 1.662.3024; WebGPU adapter: img-tec)
- GPU paths: WebGPU, compatibility mode, WebGL2
- Where: TestingBot's and BrowserStack's device clouds

## Known issues

The driver could not build the library test shader's pipeline on WebGPU, and the WebGL2 draw read back zeros.
The test shader held the whole library in one 50 KB switch, and now draws one module at a time ([#235](https://github.com/null3d-engine/null3d/pull/235), [Implementation notes](../../implementation-notes.md#browser-faults))
