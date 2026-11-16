# iPad Pro 11-inch in Safari

- Device: iPad Pro 11-inch (2018, iPad8,1), A12X Bionic, 834 x 1194 at 2x, 8 cores
- OS: iPadOS 26.7
- Browser: Safari 26.6.2, with a Mac user agent
- GPU: Apple GPU
- GPU paths: WebGPU, compatibility mode, WebGL2
- Where: The owner's tablet, over the local network

## Known issues

Safari keeps the shared memory of earlier engines until it quits, then refuses new engines with E1109 ([#223](https://github.com/null3d-engine/null3d/pull/223)).
The first engine start in a frame can stall in its setup, so the engine checks each wait of a start again ([#223](https://github.com/null3d-engine/null3d/pull/223)).
The tab closes at 2016 MiB of GPU textures ([D-12](../../decisions/D-12-memory-budgets.md)).
The governor needs [#222](https://github.com/null3d-engine/null3d/pull/222) to see slow frames here.
Without [#212](https://github.com/null3d-engine/null3d/pull/212), the WebGL2 path waits for the GPU.
Warm, S4 at Medium holds 44 to 47 fps against 60, at a render scale of 0.6 ([D-11](../../decisions/D-11-frames-in-flight.md)).
WebGL2 costs about three times WebGPU's GPU time per pixel.
S4 at Medium draws 15.6 to 17.0 fps on WebGL2 against 55.5 to 58.5 fps on WebGPU, and 36 fps at Low ([implementation notes](../../implementation-notes.md#safaris-webgl2-path)).
In hold mode, a screenshot of the heaviest S4 frame that draws again can fail its read-back with E1414 ([run](20260929-earlier-runs.md)).
So screenshots in hold mode reuse the held pixels, and the GPU draws no more ([implementation notes](../../implementation-notes.md#captures)).
