# Redmi Note 13 4G (23124RA7EO) in Chrome

- Device: Redmi Note 13 4G (23124RA7EO), Snapdragon 685 (TestingBot's device list), 393 x 873 at 2.75x, 8 cores
- OS: Android 14
- Browser: Chrome 138.0.7204.63
- GPU: Qualcomm Adreno 610 (WebGPU adapter: qualcomm adreno-6xx)
- GPU paths: Compatibility mode, WebGL2; the WebGPU adapter lacks the core features
- Where: TestingBot's device cloud

## Known issues

The adapter offers compatibility mode only, so the engine refuses the full WebGPU path with E1301.
The 85 failures of its checks run are the pages that force that path ([run](20261003-earlier-runs.md)).
The runner does not skip those pages on such a device.
