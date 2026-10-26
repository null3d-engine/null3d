# Galaxy S24 (SM-S921B) in Chrome

- Device: Galaxy S24 (SM-S921B), 8 GB, 360 x 780 at 3x, 10 cores
- OS: Android 16
- Browser: Chrome 152.0.7977.54
- GPU: Samsung Xclipse 940 (ANGLE on Vulkan 1.3.279)
- GPU paths: WebGL2; no WebGPU adapter
- Where: BrowserStack Automate

## Known issues

The cloud phone's screen runs at 24 to 30 Hz, so its frame rates top out at 30 fps ([run](20261004-earlier-runs.md)).
So the engine pages' frame checks fail, and the runner marks the timing figures unreliable.
Its debug view images match the S24+'s own references, but the test names only the S24+'s model.
