# Galaxy Tab A9+ (SM-X216B) in Chrome

- Device: Galaxy Tab A9+ (SM-X216B), 800 x 1280 at 1.5x, 8 cores
- OS: Android 14
- Browser: Chrome 149.0.7827.160
- GPU: Adreno (TM) 619; WebGPU adapter: qualcomm adreno-6xx
- GPU paths: WebGPU, compatibility mode, WebGL2
- Where: BrowserStack Automate

## Known issues

The WebGL2 shader library page failed: the library's square function returned about 6e-41 on the Adreno 619.
Not fixed yet The WebGL2 shader library page keeps only the low 16 bits of each result (0x40CEB112 read as 0x0000B112), though a probe of the same 32-bit target keeps every bit.
The debug lines differ by one pixel along slanted edges, as on the S24+.
The shaders page, which compiles every shader, went back to its start for 30 minutes without a result.
In a long session, pages slowed until they timed out and the runner page stopped; a fresh session passed them
