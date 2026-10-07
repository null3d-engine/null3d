# Galaxy S25 (SM-S931B) in Chrome

- Device: Galaxy S25 (SM-S931B), 360 x 780 at 3x, 8 cores
- OS: Android 15
- Browser: Chrome 152.0.7977.54 (149.0.7827.160 before 2026-10-08)
- GPU: Qualcomm Adreno 830, through Qualcomm's GL driver with no ANGLE in the WebGL2 renderer (WebGPU adapter: qualcomm adreno-8xx)
- GPU paths: WebGPU, compatibility mode, WebGL2
- Where: BrowserStack Live; BrowserStack Automate

## Known issues

WebGPU on the Adreno 830 runs fractal noise's octave loop once, so `noise::fbm2` returns only its first octave. [#262](https://github.com/null3d-engine/null3d/pull/262) did not cure it on WebGPU, and its fix has not merged yet.
Mip levels that the engine drew on WebGL2 read black, and a copy from a layer of an array copied layer 0.
The driver removes uniforms that a program never reads. [Browser faults](../../implementation-notes.md#browser-faults) gives the fixes The cloud phone's screen ran at 30 Hz in the timed runs, so the runner marks their frame figures unreliable; GPU times come from the GPU's timer.
WebGL2 has no GPU timer.
In the prefilter prototype, writing half floats straight into the cube on WebGL2 raises GL error 0x502, on every phone tested The meshopt KHR test model draws broken cubes on WebGPU and in compatibility mode (3.7% and 4.0% of pixels): the compute skinning pass writes vertices with packed 8-bit normalized attributes wrong.
Skinning in the vertex shader draws it right.
With WebGL2, every environment image differs by 13.8% to 14.9%: the spheres lose their reflections.
Main has both faults.

Objects past 512 m drew in the wrong place on WebGPU, and captures of scenes that resolve straight into the canvas came back empty: both fixed by the S25 WebGPU fixes ([Browser faults](../../implementation-notes.md#browser-faults))

WebGPU: S1's scene pass takes about 4.8 ms more GPU time once it draws anything besides the swarm, a background or a small box alike (D-68).
