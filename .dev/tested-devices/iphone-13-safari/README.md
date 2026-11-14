# iPhone 13 in Safari

- Device: iPhone 13 (BrowserStack's device list), Apple A15, 4 GB, 390 x 844 at 3x, 4 cores
- OS: iOS 18.4.1
- Browser: Safari 18.4
- GPU: Apple GPU
- GPU paths: WebGL2
- Where: BrowserStack Automate

## Known issues

Safari 17.5 on iOS 17 refuses the engine's 1,024 MiB of shared memory (E1109), 9 times in 10 seconds.
It does so on the preset change, the warm-up and the stats pages on WebGL2.
On its shaders page, `createShader` returns null for the standard material's maps program with the draw index, vertex colors, an alpha mask and vertex tangents.
Neither gets a fix, because Safari 17 is below the minimum, Safari 18 ([D-64](../../decisions/D-64-minimum-browsers.md)).
