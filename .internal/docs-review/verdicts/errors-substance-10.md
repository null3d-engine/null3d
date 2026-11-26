# errors-substance-10

## Finding as given

- Page: errors/E1305
- Anchor: "The GPU path refused a command that the engine gave it after the start"
- Category: unclear. Severity: medium.
- Claim: In these docs, 'GPU path' means WebGPU or WebGL2. Only WebGPU raises E1305, from the device's uncaptured errors. 'It quotes the GPU path' means it quotes the browser's WebGPU error. The page also does not say that only engine.onFailure receives it, once per device.
- Evidence: render/loss.ts:120-137 (GPUDevice.onuncapturederror). page/engine.ts:1046-1051. docs/guides/debugging.md:47. docs/api/engine.md:163.
- Proposed edit: Cause: "On WebGPU, the device refused a command that the engine gave it after createEngine() resolved, such as a buffer larger than the device allows. engine.onFailure receives the first such error on each device. The engine draws on without the objects that the command made or drew, and the canvas can stay black." Fix: "Read the message: it quotes the browser's WebGPU error."
- Source: packages/engine/src/errors/codes.ts; packages/engine/src/errors/fixes.ts

Verdict: partly

## Evidence

- The page says "The GPU path refused a command" and "Read the message: it quotes the GPU path". It names neither WebGPU nor engine.onFailure, and it links to no page that does.
- Elsewhere in the docs, "GPU path" means webgpu, webgpu-compat or webgl2 (cli/null3d.md:93, pages.md:189 "E1301: No usable GPU path ... neither WebGPU nor WebGL2"). So the page suggests that WebGL2 can raise E1305.
- Only WebGPU raises it. The "rejected" kind comes only from GpuErrorWatch (render/loss.ts:125-137), which listens to GPUDevice.onuncapturederror. GpuErrorWatch is built only in render/webgpu-renderers.ts:80 and :193. The WebGL2 renderers use plain GpuReports and report only "pipeline" (render/webgl2-renderers.ts:179-181). The compat tier is still WebGPU, so "On WebGPU" covers it.
- The message text is the browser's GPUError.message (loss.ts:136), wrapped by gpuFailure (page/engine.ts:1050-1051). So "quotes the browser's WebGPU error" is right.
- The error reaches engine.onFailure only, once per kind per device (loss.ts:106-117; engine.ts:1196-1201; api/engine.md:163 "The handler is the only place where these failures show"; guides/debugging.md:47). The page says "reports" but not where. A reader who meets E1305 cannot tell where to listen for it.
- Where the edit is wrong: "after createEngine() resolved". GpuErrorWatch is set up when the renderer is built, inside startDrawing (workers/render-worker.ts:63-76). That happens before the worker replies "ready", so before createEngine resolves. A command that the device refuses during start, such as an upload of the sketch's first scene, also comes as E1305. onFailure still receives it, because the first handler that listens receives a failure that no handler heard (page/engine.ts:743-748). So the timing in the edit is too narrow and would mislead a reader who sees E1305 during start.

## Corrected claim

The page uses "GPU path", which the docs use for WebGPU or WebGL2, but only WebGPU (with its compat tier) raises E1305, from the device's uncaptured errors. The message quotes the browser's WebGPU error. The page does not say that engine.onFailure receives it, once per device. The proposed timing "after createEngine() resolved" is wrong: the engine listens from the moment it sets up the device, so E1305 can also come during start.

## Corrected edit

In packages/engine/src/errors/codes.ts, E1305 cause:

"On WebGPU, the device refused a command that the engine gave it, such as a buffer larger than the device allows. engine.onFailure receives the first such error on each device. The engine draws on without the objects that the command made or drew, and the canvas can stay black."

In packages/engine/src/errors/fixes.ts, E1305:

"Read the message: it quotes the browser's WebGPU error. A buffer or texture past the device's limits names the limit: make the scene smaller there. Otherwise this is an engine bug: report it with the message and the browser."
