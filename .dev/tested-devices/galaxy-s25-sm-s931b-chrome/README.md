# Galaxy S25 (SM-S931B) in Chrome

- Device: Galaxy S25 (SM-S931B), 360 x 780 at 3x, 8 cores
- OS: Android 15
- Browser: Chrome 152.0.7977.54
- GPU: Qualcomm Adreno 830, through Qualcomm's GL driver with no ANGLE in the WebGL2 renderer (WebGPU adapter: qualcomm adreno-8xx)
- GPU paths: WebGPU, compatibility mode, WebGL2
- Where: BrowserStack Live; BrowserStack Automate

## Known issues

WebGPU on the Adreno 830 runs fractal noise's octave loop once.
So `noise::fbm2` returns only its first octave ([run](20261003-earlier-runs.md)).
[#262](https://github.com/null3d-engine/null3d/pull/262) does not cure it on WebGPU, and its fix has not merged.
On WebGL2, mip levels that the engine draws read black, and a copy from a layer of an array copies layer 0.
The driver removes uniforms that a program never reads.
[Browser faults](../../implementation-notes.md#browser-faults) gives the fixes.
The cloud phone's screen runs at 30 Hz in the timed runs, so the runner marks their frame figures unreliable.
GPU times come from the GPU's timer, which WebGL2 lacks.
In the prefilter prototype, writing half floats straight into the cube on WebGL2 raises GL error 0x502, on every phone tested.
On WebGPU and in compatibility mode, a compute skinning pass can write packed 8-bit normalized attributes wrong.
The meshopt KHR test model then draws as broken cubes (3.7% and 4.0% of pixels).
The lean skinning pass draws it right, as skinning in the vertex shader does ([run](20261007-213008-checks.md), [D-20](../../decisions/D-20-webgpu-skinning.md)).
With WebGL2, every environment image differs by 13.8% to 14.9%: the spheres lose their reflections.

Without the S25 WebGPU fixes, objects past 512 m draw in the wrong place on WebGPU.
Without them, captures of scenes that resolve straight into the canvas also come back empty ([Browser faults](../../implementation-notes.md#browser-faults)).

WebGPU: S1's scene pass takes about 4.8 ms more GPU time once it draws anything besides the swarm, a background or a small box alike (D-68).
