# iPhone 13 in Safari

- Device: iPhone 13 (BrowserStack's device list), Apple A15, 4 GB, 390 x 844 at 3x, 4 cores
- OS: iOS 17 (BrowserStack's device list)
- Browser: Safari 17.5. Not supported: below the minimum, Safari 18 ([D-64](../../decisions/D-64-minimum-browsers.md))
- GPU: Apple GPU
- GPU paths: WebGL2
- Where: BrowserStack Automate

## Known issues

Safari refused the engine's 1,024 MiB of shared memory (E1109) 9 times in 10 seconds, on 3 of the last 5 pages: the preset change, the warm-up and the stats pages on WebGL2.
On the shaders page, `createShader` returned null for the standard material's maps program with the draw index, vertex colors, an alpha mask and vertex tangents.
Neither gets a fix, because Safari 17 is not supported
