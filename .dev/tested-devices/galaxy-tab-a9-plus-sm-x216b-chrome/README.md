# Galaxy Tab A9+ (SM-X216B) in Chrome

- Device: Galaxy Tab A9+ (SM-X216B), 800 x 1280 at 1.5x, 8 cores
- OS: Android 14
- Browser: Chrome 152.0.7977.54
- GPU: Adreno (TM) 619; WebGPU adapter: qualcomm adreno-6xx
- GPU paths: WebGPU, compatibility mode, WebGL2
- Where: BrowserStack Automate

## Known issues

The WebGL2 shader library page failed: the library's square function returned about 6e-41 on the Adreno 619.
Not fixed yet The WebGL2 shader library page keeps only the low 16 bits of each result (0x40CEB112 read as 0x0000B112), though a probe of the same 32-bit target keeps every bit.
The debug lines differ by one pixel along slanted edges, as on the S24+.
The shaders page, which compiles every shader, went back to its start for 30 minutes without a result.
In a long session, pages slowed until they timed out and the runner page stopped; a fresh session passed them

On WebGL2, the driver fails to link many of the engine's draw index programs, which read the draw's index through `WEBGL_multi_draw`, and gives empty logs. On 12 October 2026, the shaders pages listed 430 of 560 such programs as not linked, and no other program. 13 engine pages failed, among them 10 image pages, stats and warm-up. A rerun of all 9 shaders parts the same day listed 1,284 of 3,404 GLSL programs as not linked. Every one was a draw index program ([run](20261012-172329-smoke.md)). M2-R28 fixes the fault.

On WebGPU and in compatibility mode, the first render pass that draws on a new device gets nothing from its indirect draws. This holds when the CPU wrote their arguments. The engine draws one point on each new device before its first frame, which avoids it ([Driver bug reports](../../driver-bugs.md)).
