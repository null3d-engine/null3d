# iPad Pro 11-inch in Safari

- Device: iPad Pro 11-inch, 834 x 1194 at 2x, 8 cores
- OS: iPadOS
- Browser: Safari 26.6.2, with a Mac user agent
- GPU: Apple GPU
- GPU paths: WebGPU, compatibility mode, WebGL2
- Where: The owner's tablet, over the local network

## Known issues

Safari kept the shared memory of earlier runs until it quit, then refused new engines with E1109 ([#223](https://github.com/null3d-engine/null3d/pull/223)).
The first engine start in a frame once stalled in its setup; the engine now checks each wait of a start again ([#223](https://github.com/null3d-engine/null3d/pull/223)).
The tab closed at 2016 MiB of GPU textures ([D-12](../../decisions/D-12-memory-budgets.md)).
The governor missed slow frames ([#222](https://github.com/null3d-engine/null3d/pull/222)).
The WebGL2 path waited for the GPU ([#212](https://github.com/null3d-engine/null3d/pull/212)).
Warm, S4 at Medium held 44 to 47 fps against 60, at a render scale of 0.6 ([D-11](../../decisions/D-11-frames-in-flight.md)).
WebGL2 costs about three times WebGPU's GPU time per pixel: on 2026-10-06, S4 at Medium drew 15.6 to 17.0 fps on WebGL2 against 55.5 to 58.5 fps on WebGPU, and 36 fps at Low ([implementation notes](../../implementation-notes.md#safaris-webgl2-path)).
In hold mode, a screenshot of the heaviest S4 frame once failed its read-back with E1414; screenshots in hold mode now reuse the held pixels, so the GPU draws no more ([implementation notes](../../implementation-notes.md#captures))
