---
id: api/engine
title: "Page API: createEngine"
status: planned
since: "0.1"
summary: "createEngine options; engine.postToSketch, capture, labels, requestPointerLock, capabilities, destroy."
---

<!-- null3d:placeholder -->

# Page API: createEngine

> Planned for null3D 0.1. No release has these APIs yet, so coding agents must not use them. The reference below lists the APIs the engine has now. The rest of the page is not written yet.

This page will cover: createEngine options; engine.postToSketch, capture, labels, requestPointerLock, capabilities, destroy.

## API reference

### `CapabilityReport`

Interface `CapabilityReport`.

What the browser and device can do, as plain JSON. The engine picks its build and GPU path from these feature tests, never from browser or GPU names.

| Member | Description |
| --- | --- |
| `crossOriginIsolated: boolean` | True when the page is cross-origin isolated, which shared memory needs. |
| `sharedArrayBuffer: boolean` | True when the page can make shared memory. |
| `atomicsWaitAsync: boolean` | True when the browser has `Atomics.waitAsync`. |
| `hardwareConcurrency: number` | The logical cores that the browser reports. |
| `devicePixelRatio: number` | Device pixels per CSS pixel when the probe ran. |
| `offscreenCanvas: boolean` | True when the browser has `OffscreenCanvas`. |
| `transferControlToOffscreen: boolean` | True when a page canvas can hand its drawing to a worker. |
| `webgpu: WebGPUReport` | What WebGPU offers. |
| `webgl2: WebGL2Report` | What WebGL2 offers. |
| `worker: WorkerProbe \| { error: string; }` | What a dedicated worker can do, or why the probe worker failed. |

### `createEngine`

```ts
function createEngine(options: EngineOptions): Promise<Engine>
```

Starts the engine on the page. It tests the device, picks the build and the GPU path, starts the workers, and runs the sketch module. In hold mode it also steps the sketch to the held time, then draws that frame and reads it back. It publishes the frame, or the error that stopped it, as `window.__null3dHold` for test tools.

### `Engine`

Interface `Engine`.

A running engine, as `createEngine` returns it.

| Member | Description |
| --- | --- |
| `readonly capabilities: EngineCapabilities` | The GPU path the engine chose, and what it offers. |
| `readonly report: CapabilityReport` | The full capability report, as plain JSON. |
| `readonly mode: EngineMode` | How the engine runs on this device. |
| `readonly firstFrame: Promise<void>` | Resolves once the GPU has finished the first frame, so it is on screen: the moment to remove a loading screen. It never resolves when the engine is destroyed first. |
| `postToSketch(name: string, data?: unknown, transfer?: Transferable[]): void` | Sends a message to the sketch, which receives it through `ctx.page.onMessage`. |
| `onSketchMessage(handler: (name: string, data: unknown) => void): () => void` | Receives the messages the sketch sends with `ctx.page.post`. When no handler listened from the start, the first handler also receives the messages sent before it was registered. Returns a function that removes the handler. |
| `onFailure(handler: (error: EngineError) => void): () => void` | Receives a failure after the engine started: the browser took the GPU away and the engine could not carry on with a new device (E1302), or an engine thread failed (E1404). The engine reports each failure once. Without a handler, it logs the failure to the console. Returns a function that removes the handler. |
| `setPaused(paused: boolean): void` | Pauses or resumes the sketch's frames. A pause also stops input: the sketch sees every key and button that was down come up, and input that comes during the pause never reaches it. |
| `detach(): void` | Takes the canvas off the page and pauses the engine. The engine keeps its threads, its GPU resources and the scene, and stops reading input. Use it when a single-page app leaves the view that shows the canvas, and `attach` when the view comes back. |
| `attach(container: Element): void` | Puts the canvas at the end of `container` and resumes the engine where it stopped, unless `setPaused(true)` paused it. |
| `measure(seconds: number): Promise<FrameMetrics>` | Measures the running engine for a number of seconds, then returns CPU time per frame by thread and phase, GPU time, frame intervals, uploads, draw calls, memory and load time. |
| `captureFrame(): Promise<{ width: number; height: number; pixels: Uint8Array; }>` | Draws one frame offscreen and returns its pixels as RGBA8 rows, top row first. In hold mode, it returns the held frame. |
| `simulateGpuLoss(): void` | Acts out a loss of the GPU, as a driver reset causes. The engine starts a new GPU device and draws the whole scene again, as it does after a real loss. Use it to test how your page handles one. |
| `destroy(): Promise<void>` | Stops the engine and its workers. The engine cannot start again. The promise resolves once every worker has stopped, when the browser can free the engine's memory. Wait for it before you start another engine on the same page: an iPad has room for only a few engines' memory. |

### `EngineCapabilities`

Interface `EngineCapabilities`.

The GPU path the engine chose, and what it offers.

| Member | Description |
| --- | --- |
| `tier: Tier` | The GPU path the engine draws with. |
| `threaded: boolean` | True when the engine runs the threaded build. |
| `features: string[]` | The optional features of the GPU path: WebGPU features, or the WebGL2 extensions present. |
| `limits: Record<string, number \| null>` | The WebGPU limits, or an empty object on WebGL2. |
| `maxInstances: number` | The most objects and instance rows, counted together, that a scene can draw on this device. On WebGPU every device draws at least 2,097,152, and a device with larger GPU buffers draws more, up to 8,388,480. On WebGL2 the number follows the largest texture the device allows: 2,097,152 at 4,096 pixels, and 1,048,576 at the 2,048 that every device allows. Engine memory can run out first: see E1109. |

### `EngineError`

Class `EngineError`, which extends `Error`.

An error the engine throws. Its message says what failed and how to fix it, and links to the code's docs page.

| Member | Description |
| --- | --- |
| `readonly code: ErrorCode` | The error's code, such as `E1108`. |
| `readonly docs: string` | The docs page for this code. |

### `EngineMode`

Interface `EngineMode`.

How the engine runs on this device: its build, its latency mode and its threads.

| Member | Description |
| --- | --- |
| `build: 'threaded' \| 'single'` | With `threaded`, the sketch and the render step run in workers, helped by job workers. With `single`, everything runs on the page's thread, for pages without shared memory. |
| `latency: LatencyMode \| 'single'` | The latency mode in use, or `single` for the single-thread build. |
| `renderThread: 'render-worker' \| 'sketch-worker' \| 'main'` | The thread that owns the canvas and draws. |
| `jobWorkers: number` | The job workers that share the engine's parallel work. |
| `hold: number \| null` | The sketch time in seconds that hold mode holds the sketch at, or null for a live engine. |

### `EngineOptions`

Interface `EngineOptions`.

Options for `createEngine`.

| Member | Description |
| --- | --- |
| `canvas: HTMLCanvasElement` | The canvas to draw into, sized by CSS. |
| `sketch: URL \| string` | The sketch module, which runs in the sketch worker; `new URL('./sketch.ts', import.meta.url)`. |
| `maxPixelRatio?: number` | Cap for the device pixel ratio. |
| `gpu?: 'auto' \| 'webgpu' \| 'webgl2'` | Forces a GPU tier, for testing only. |
| `powerPreference?: 'high-performance' \| 'low-power'` | Which GPU to draw with on a device that has two, such as a laptop with a separate graphics chip: `high-performance`, the default, for the faster one, or `low-power` to save battery. The browser treats it as a request. A device with one GPU ignores it. |
| `latency?: LatencyMode` | The latency mode. The default is `pipelined`. |
| `onProgress?: (stage: StartupStage) => void` | Called as the start reaches each stage, in this order: `core` once the engine core is compiled and the GPU paths are tested, `sketch` once the sketch's setup has run, and `first-frame` once the GPU has finished the first frame. |
| `onSketchMessage?: (name: string, data: unknown) => void` | Receives the messages the sketch sends with `ctx.page.post`, from the start of the sketch's setup. Use it for progress that the sketch reports while it loads. `engine.onSketchMessage` adds more handlers once the engine has started. |
| `signal?: AbortSignal` | Cancels a start in progress, for example when the user leaves the page. `createEngine` then stops the engine's threads and rejects with the signal's reason. |
| `hold?: number` | Starts the engine in hold mode for image tests, held at this many seconds of sketch time. The engine steps the sketch from 0 to the time in fixed steps of 1/60 second, with no frame loop. `math.random` and `Math.random` in the sketch's thread give the same numbers on every run, and the sketch gets no input: every key and button stays up. The engine then draws that one frame and reads it back, and `createEngine` resolves. The `?hold=<seconds>` switch overrides this time, and a bare `?hold` holds at it, or at 0 without it. |

### `ErrorCode`

```ts
type ErrorCode =
	| 'E1101'
	| 'E1102'
	| 'E1103'
	| 'E1104'
	| 'E1105'
	| 'E1106'
	| 'E1107'
	| 'E1108'
	| 'E1109'
	| 'E1203'
	| 'E1204'
	| 'E1205'
	| 'E1206'
	| 'E1301'
	| 'E1302'
	| 'E1303'
	| 'E1401'
	| 'E1402'
	| 'E1403'
	| 'E1404'
	| 'E1405'
	| 'E1406'
	| 'E1407'
	| 'E1408'
	| 'E1501'
	| 'E1502'
	| 'E1503'
	| 'E1504'
	| 'E1505';
```

The code of an engine error. Each code has a docs page that gives its cause and its fix.

### `HeldFrame`

Interface `HeldFrame`.

The frame that hold mode drew and read back, as `window.__null3dHold` holds it.

| Member | Description |
| --- | --- |
| `ok: true` | True: the engine drew the held frame and read it back. |
| `time: number` | The sketch time of the frame, in seconds. |
| `frame: number` | The frame's number, counting from 1: the steps to the held time, plus one. |
| `tier: Tier` | The GPU path that drew the frame. |
| `width: number` | The frame's width in pixels. |
| `height: number` | The frame's height in pixels. |
| `pixels: Uint8Array` | The frame's pixels as RGBA8 rows, top row first. |

### `HoldFailure`

Interface `HoldFailure`.

The error that stopped hold mode, as `window.__null3dHold` holds it.

| Member | Description |
| --- | --- |
| `ok: false` | False: the engine stopped before it read the held frame back. |
| `code: ErrorCode \| null` | The error's code, or null for an error that has none, such as one the sketch threw. |
| `error: string` | The error's message. |

### `HoldResult`

```ts
type HoldResult = HeldFrame | HoldFailure;
```

What hold mode publishes on the page as `window.__null3dHold`: the held frame, or the error that stopped the hold. The engine publishes it the moment it knows either, so a test tool never waits out a timeout on a page that failed.

### `LatencyMode`

```ts
type LatencyMode = 'pipelined' | 'low';
```

How the engine trades latency for speed. In `pipelined` mode, the render worker draws each frame while the sketch computes the next one. In `low` mode, the sketch worker draws each frame right after its update.

### `StartupStage`

```ts
type StartupStage = 'core' | 'sketch' | 'first-frame';
```

A stage of the engine's start, as `onProgress` reports it.

### `Tier`

```ts
type Tier = 'webgpu' | 'webgpu-compat' | 'webgl2';
```

The GPU path the engine draws with: core WebGPU, WebGPU in compatibility mode on devices that cannot run core WebGPU, or WebGL2.

### `VERSION`

```ts
const VERSION: '0.0.0'
```

The engine version, which the WebAssembly core and this package always share.

### `WebGL2Report`

Interface `WebGL2Report`.

What the browser's WebGL2 offers, in `CapabilityReport.webgl2`.

| Member | Description |
| --- | --- |
| `available: boolean` | True when the browser can make a WebGL2 context. |
| `extensions: Record<string, boolean>` | Each extension the engine uses or tests for, and whether the browser has it. |
| `supportedExtensions: string[]` | The list as the browser reports it, in its order; some browsers shuffle it, so it is only recorded. |
| `maxSamples: number \| null` | The most samples per pixel for antialiasing, or null without WebGL2. |
| `maxTextureSize: number \| null` | The largest texture width and height in pixels, or null without WebGL2. |
| `maxUniformBlockSize: number \| null` | The largest uniform block in bytes, or null without WebGL2. |
| `sharedMemoryUploads: { bufferSubData: boolean; texSubImage2D: boolean; } \| null` | Whether WebGL accepts views on shared memory for buffer and texture uploads. Null without shared memory. |
| `floatRenderTargets: { rgba16f: { complete: boolean; readsBack: boolean; }; rgba32f: { complete: boolean; readsBack: boolean; }; } \| null` | Whether the device renders into float textures, which high dynamic range color needs. The engine tests a 16-bit and a 32-bit float RGBA texture. `complete` says whether a framebuffer with the texture is complete. `readsBack` says whether a clear to a known color, with a value above 1, reads back as floats. WebGL2 renders into both formats with `EXT_color_buffer_float`, and into the 16-bit one with `EXT_color_buffer_half_float`. Null without WebGL2. |
| `renderer: string \| null` | Reported for the record only; the engine never branches on it. |
| `error?: string` | Why the probe failed, when it did. |

### `WebGPUReport`

Interface `WebGPUReport`.

What the browser's WebGPU offers, in `CapabilityReport.webgpu`.

| Member | Description |
| --- | --- |
| `available: boolean` | True when the browser has WebGPU. |
| `compatibilityAdapter: boolean` | An adapter from a compatibility-mode request (the engine's normal request). |
| `coreFeaturesAndLimits: boolean` | The adapter offers `core-features-and-limits`, so the device can run as core WebGPU. |
| `features: string[]` | The adapter's optional features, sorted. |
| `limits: Record<string, number \| null>` | Each limit, or null when the adapter does not report it (absent, never zero). |
| `wgslLanguageFeatures: string[]` | The WGSL language features the browser supports, sorted. |
| `preferredCanvasFormat: string \| null` | The canvas texture format the browser prefers, or null without WebGPU. |
| `adapterInfo: { vendor: string; architecture: string; device: string; description: string; } \| null` | Reported for the record only; the engine never branches on it. |
| `error?: string` | Why the probe failed, when it did. |

### `WorkerProbe`

Interface `WorkerProbe`.

What a dedicated worker can do, in `CapabilityReport.worker`. A render worker needs the frame timer and an offscreen canvas for its GPU path.

| Member | Description |
| --- | --- |
| `requestAnimationFrame: boolean` | True when workers have `requestAnimationFrame`. |
| `offscreenWebGL2: boolean` | True when a worker can draw with WebGL2 into an `OffscreenCanvas`. |
| `offscreenWebGPU: boolean` | True when a worker can draw with WebGPU into an `OffscreenCanvas`. |
| `error?: string` | Why the probe failed, when it did. |
