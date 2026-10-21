Plans: The twelve comparison pages of [D-174](../../decisions/D-174-apple-gpu-direct-draws.md), 2026-10-19, on the working tree of `perf/battle-webgpu` at `63f24269d`: Battle and Factory, each on null3D and three.js, on WebGPU and WebGL2, then Battle and Factory on null3D's WebGPU with `?direct=off` and `?direct=on`. Safari 26.5 (iOS 26), screen at 60 Hz. Each page ran 15 seconds of warm-up and 8 seconds measured by its own measure, at a canvas backing size of 603 x 1009 (402 x 673 CSS pixels) at a pixel ratio of 1.5.

Result: twelve pages measured, none failed, in one session of 11 minutes.

| Page | null3D | three.js |
| --- | --- | --- |
| Battle, WebGPU | 23.9 fps, 30.55 ms GPU, 1,269 draws | 31.4 fps, WebGPURenderer |
| Battle, WebGL2 | 46.3 fps, 196 draws | 36.6 fps, WebGLRenderer |
| Factory, WebGPU | 44.5 fps, 16.00 ms GPU, 152 draws | 31.1 fps, WebGPURenderer |
| Factory, WebGL2 | 59.9 fps, 151 draws | 59.5 fps, WebGLRenderer |
| Battle, WebGPU, `?direct=off` | 10.4 fps, 79.35 ms, 1,246 draws | |
| Factory, WebGPU, `?direct=off` | 38.9 fps, 18.78 ms, 152 draws | |
| Battle, WebGPU, `?direct=on` | 23.6 fps, 31.01 ms, 1,237 draws | |
| Factory, WebGPU, `?direct=on` | 37.6 fps, 19.45 ms, 152 draws | |

This tree started the skinning pass as well as the 3-texel sun filter on a phone that runs Apple's WebKit. Its Battle pages drew 23.7 frames a second, against 24.4 before either change, and the indirect path fell to 10.4 because the pass draws each skinned unit on its own. So the skinning pass is not a default ([D-20](../../decisions/D-20-webgpu-skinning.md#addendum-2026-10-19-the-pass-measured-on-an-iphone-17-and-why-it-is-not-a-default)); the engine keeps the vertex shaders, and this run's numbers stand as the reason.

The WebGL2 pages drew as before: Battle 46.3 against 47.4 on the tip, three.js 36.6 against 36.5, Factory 59.9 against 60.0 and 59.5 against 59.2. The phone's WebGPU Battle keeps the gap that this task opened: 23.9 against three.js's 31.4.
