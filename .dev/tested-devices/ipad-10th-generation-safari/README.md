# iPad (10th generation) in Safari

- Device: iPad (10th generation), A14, 820 x 1180 at 2x, 4 cores
- OS: iPadOS 27 (BrowserStack's device list)
- Browser: Safari 27.0
- GPU: Apple GPU; WebGPU adapter: apple
- GPU paths: WebGPU, compatibility mode, WebGL2
- Where: BrowserStack Automate

## Known issues

The S4 image with WebGL2 differs from the Mac's reference in 0.81% of pixels against 0.5%: the roofs' window grid is softer, as from a coarser texture level at a steep angle.
The owner's iPad Pro and the cloud iPhone 17 pass it The page's GPU work takes 12 to 15 ms a frame, but each frame waits 44 to 60 ms for the GPU, with the session's video on or off: work outside the page, likely the screen's compositing and the live stream of interactive debugging, holds the GPU.
Its frame rates do not compare with the owner's iPad; GPU times do compare between commits in one session One WebGL2 program of the standard material, with alpha mask, received shadows, morph targets and vertex tangents, fails to link in Safari: its translation to Metal cannot pass a uniform's field to the roughness level function's reference parameter.
The other 1,116 programs link.
BrowserStack offers no iPad with the A12X on a system that runs the gate's pages.
Its A12Z iPad Pro runs iOS 14 only.
The A14 is the closest chip with a current Safari
Safari 27.0 cannot compile a shader that calls `atomicCompareExchangeWeak`; the engine's shaders do not call it ([Browser faults](../../implementation-notes.md#browser-faults))
