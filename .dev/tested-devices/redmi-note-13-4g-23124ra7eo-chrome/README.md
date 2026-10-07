# Redmi Note 13 4G (23124RA7EO) in Chrome

- Device: Redmi Note 13 4G (23124RA7EO), Snapdragon 685 (TestingBot's device list), 393 x 873 at 2.75x, 8 cores
- OS: Android 14
- Browser: Chrome 138.0.7204.63
- GPU: Qualcomm Adreno 610 (WebGPU adapter: qualcomm adreno-6xx)
- GPU paths: Compatibility mode, WebGL2; the WebGPU adapter lacks the core features
- Where: TestingBot's device cloud

## Known issues

The 85 failures are the pages that force the full WebGPU path.
The adapter offers compatibility mode only, so the engine refuses that path with E1301.
The runner does not yet skip those pages on such a device
