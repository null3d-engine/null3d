# iPad (10th generation) in Safari

- Device: iPad (10th generation), A14, 820 x 1180 at 2x, 4 cores
- OS: iPadOS 27 (BrowserStack's device list)
- Browser: Safari 27.0
- GPU: Apple GPU; WebGPU adapter: apple
- GPU paths: WebGPU, compatibility mode, WebGL2
- Where: BrowserStack Automate

## Known issues

The S4 image with WebGL2 differs from the Mac's reference in 0.81% of pixels against 0.5%: the roofs' window grid is softer, as from a coarser texture level at a steep angle.
The owner's iPad Pro and the cloud iPhone 17 pass it.
The page's GPU work takes 12 to 15 ms a frame, but each frame waits 44 to 60 ms for the GPU.
The session's video makes no difference.
Work outside the page, likely the screen's compositing and the live stream of interactive debugging, holds the GPU.
Its frame rates do not compare with the owner's iPad, but GPU times do compare between commits in one session.
One WebGL2 program of the standard material, with alpha mask, received shadows, morph targets and vertex tangents, fails to link in Safari.
Its translation to Metal cannot pass a uniform's field to the roughness level function's reference parameter.
The other 1,116 programs link.
BrowserStack offers no iPad with the A12X on a system that runs the gate's pages.
Its A12Z iPad Pro runs iOS 14 only.
The A14 is the closest chip with a current Safari.
Safari 27.0 cannot compile a shader that calls `atomicCompareExchangeWeak`, and the engine's shaders do not call it ([run](20261007-204114-bench.md), [Browser faults](../../implementation-notes.md#browser-faults)).
Under BrowserStack Automate, slow loads can run smoke pages out of time with no engine error.
In one smoke run, 5 of the 137 pages ran out of time on the cloud iPad ([20261012-133710-smoke](20261012-133710-smoke.md)).
Two parts of the shaders page timed out at 220 seconds, after 74 to 86 seconds to load their files.
Three glTF pages timed out at 30 seconds, after 24 to 28 seconds before their workers were ready.
