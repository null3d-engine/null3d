# Galaxy Tab A9+ (SM-X216B) in Chrome

- Device: Galaxy Tab A9+ (SM-X216B), 800 x 1280 at 1.5x, 8 cores
- OS: Android 14
- Browser: Chrome 152.0.7977.54
- GPU: Adreno (TM) 619; WebGPU adapter: qualcomm adreno-6xx
- GPU paths: WebGPU, compatibility mode, WebGL2
- Where: BrowserStack Automate

## Known issues

On WebGL2, a value that a GLSL structure holds keeps only 16 bits.
With its values in structures, the shader library's square function returns about 6e-41 on the Adreno 619.
The shader library page then keeps only the low 16 bits of each result (0x40CEB112 read as 0x0000B112).
A probe of the same 32-bit target keeps every bit.
The WebGL2 build splits structures into plain values, and the page passes with the fault noted ([run](20261017-155754-smoke.md), [Driver bug reports](../../driver-bugs.md)).
The debug lines differ by one pixel along slanted edges, as on the S24+.
The shaders page, which compiles every shader, can go back to its start for 30 minutes without a result.
In a long session, pages slow until they time out and the runner page stops.
A fresh session passes them.

On WebGL2, the driver fails to link many of the engine's draw index programs, which read the draw's index through `WEBGL_multi_draw`, and gives empty logs.
In one smoke run, the shaders pages listed 430 of 560 such programs as not linked, and no other program.
13 engine pages failed, among them 10 image pages, stats and warm-up.
A rerun of all 9 shaders parts listed 1,284 of 3,404 GLSL programs as not linked, every one a draw index program ([run](20261012-172329-smoke.md)).
M2-R28 fixes the fault.

On WebGPU and in compatibility mode, the first render pass that draws on a new device gets nothing from its indirect draws.
This holds when the CPU wrote their arguments ([run](20261012-183358-smoke.md)).
The engine draws one point on each new device before its first frame, which avoids it ([Driver bug reports](../../driver-bugs.md)).

Compatibility mode loses the GPU on this device.
The engine reports no compatibility adapter.
A page that forces the mode draws no scene, and its render worker loses the Vulkan device with E1302 (`vkQueueSubmit failed with VK_ERROR_DEVICE_LOST`).
In the vegetation run, that page reported 3 frames in 5.5 s, so the runner counted a pass.
Its figures must not be read ([run](20261024-111020-vegetation.md), [Driver bug reports](../../driver-bugs.md)).
This fault no longer repeated: the wind field run reports a WebGPU adapter and plays every path, and its compatibility figures stand ([run](20261101-030741-wind-field-cost.md)).

The garden at Low on WebGL2 does not draw. Five runs of the Creek garden each drew a first frame and
no second one. Each then lost the WebGL2 context ([run](20261121-201300-vegetation.md),
[run](20261121-204816-vegetation.md), [run](20261121-220834-vegetation.md),
[run](20261121-221552-tab-probe.md), [run](20261121-223106-tab-probe2.md)). The first frames took
175.1, 115.0, 119.1, 106.5 and 139.9 s. A 5 s window and a 60 s window each saw no frame after the
first. After the first heavy page, `getContext('webgl2')` returns null, so the next page reports `the
canvas has no WebGL2 context`. Capping the engine's job workers and memory (`jobs=2`, `memory=256`)
changed nothing: its first frame took 139.9 s, slower than the 107.0 s of the defaults. The engine
named no refused target and no lost context on the first page. The render worker blocks in the
driver's first draw of each new program. Whether this class runs the garden at Low is the owner's
call.
