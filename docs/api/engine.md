---
id: api/engine
title: "Page API: createEngine"
status: experimental
since: "0.1"
summary: "createEngine options and start errors; memory; capabilities and mode; pausing, detaching, failures, measuring, captureFrame, messages and destroy."
---

# Page API: createEngine

> Ships in null3D 0.1. The API is experimental, so it can still change between versions. The `createEngine` option `transparent` is not built yet, so coding agents must not use it.

`createEngine` starts the engine on a canvas and runs a sketch. It returns an `Engine`, the page's handle on the running engine. The page keeps the HTML, and the sketch builds the scene in a worker of its own.

```ts
// page.ts
import { createEngine } from '@null3d/engine';

const canvas = document.querySelector('canvas')!;
try {
  const engine = await createEngine({
    canvas,
    sketch: new URL('./sketch.ts', import.meta.url),
    onProgress: (stage) => console.log('start:', stage), // core, sketch, first-frame
  });
  engine.onFailure((error) => console.error(error.code, error.message));
  await engine.firstFrame; // the first frame is on the screen: remove the loading screen
} catch (error) {
  // The browser cannot run the engine: show the page without the scene.
}
```

## The start

`createEngine` tests what the browser offers, and picks the build and the GPU path from those tests, never from browser or GPU names. It starts the engine's threads, loads the sketch module and runs the sketch's setup. It resolves once the setup has run, and `engine.firstFrame` resolves once the GPU has finished the first frame.

`onProgress` reports each stage of the start: `core` once the engine core is compiled and the GPU paths are tested, `sketch` after the sketch's setup, and `first-frame`. An `AbortSignal` in `signal` cancels a start in progress: `createEngine` then stops the engine's threads and rejects with the signal's reason.

`createEngine` rejects with an `EngineError` when the engine cannot start:

| Code | Cause |
| --- | --- |
| [E1407](../errors/E1407.md) | The `hold` option or the `?hold=` switch gives a time that is not a number of seconds from 0 to 600. |
| [E1415](../errors/E1415.md) | The sketch would run on the page's main thread, where another engine still runs its sketch. |
| [E1213](../errors/E1213.md) | The `preset` option names no preset, or `maxPixelRatio` is not a number from 0.5 up. |
| [E1409](../errors/E1409.md) | The `memory` option asks for a maximum that is not a whole number of MiB from 256 to 4096. |
| [E1303](../errors/E1303.md) | The browser runs WebAssembly without SIMD. |
| [E1301](../errors/E1301.md) | The browser has no usable GPU path, or no path that `gpu` or `?gpu=` asks for. |
| [E1406](../errors/E1406.md) | A file of the engine core did not download. |
| [E1402](../errors/E1402.md) | Development builds only: the engine core's file comes from another build than the engine's JavaScript. |
| [E1109](../errors/E1109.md) | The browser refused the engine's memory, even after about 3 seconds of tries. |
| [E1410](../errors/E1410.md) | The sketch module did not load: it did not download, or its code threw an error while it loaded. |
| [E1401](../errors/E1401.md) | The sketch module's default export is not `defineSketch(...)`. |
| [E1214](../errors/E1214.md) | An option of `defineSketch` is out of its range. |
| [E1405](../errors/E1405.md) | An engine thread did not start. |
| [E1408](../errors/E1408.md) | In hold mode, the sketch or the engine failed before the engine read the held frame back. |

An error that the sketch's setup throws also rejects the start ([Sketch API](sketch.md#the-setup-function)).

## Options

`canvas` and `sketch` are required. The canvas takes its size from CSS, and `sketch` is the address of the sketch module, usually `new URL('./sketch.ts', import.meta.url)`.

| Option | Default | What it does |
| --- | --- | --- |
| `preset` | `'auto'` | The quality preset, which the engine chooses for the device unless the page names one: [Quality presets](../concepts/quality-presets.md) |
| `maxPixelRatio` | The preset's cap | Caps the screen's pixel ratio that the engine draws at, in place of the preset's cap |
| `gpu` | `'auto'` | Forces a GPU path, for tests only. The `?gpu=` switch in the page's address wins over it. |
| `powerPreference` | `'high-performance'` | Picks the GPU on a device that has two. `'low-power'` saves battery. |
| `latency` | `'pipelined'` | The latency mode, `'pipelined'` or `'low'`: [Architecture](../concepts/architecture.md#latency-modes). The `?latency=` switch wins over it, and the single-threaded build ignores it. |
| `sketchThread` | `'worker'` | The thread that runs the sketch. `'main'` runs it on the page's main thread, where it can reach the DOM: [Where the sketch runs](../concepts/architecture.md#where-the-sketch-runs). The `?sketch-thread=` switch wins over it, and the single-threaded build always runs the sketch on the main thread. |
| `memory` | `{ maximumMiB: 1024 }` | The most memory that the engine's threads share: [Memory](#memory) |
| `onProgress` | None | Reports each stage of the start |
| `onSketchMessage` | None | Receives the sketch's messages from the start of its setup: [Messages](page.md) |
| `signal` | None | Cancels the start |
| `hold` | None | Holds the sketch at a time for image tests: [Testing your sketch](../guides/testing.md) |

## Memory

On a page with worker threads, the engine's threads share one WebAssembly memory, which holds the scene. The memory's maximum is 1024 MiB on every quality preset. A scene that needs more can ask for up to 4096 MiB, in whole MiB:

```ts
const engine = await createEngine({ canvas, sketch, memory: { maximumMiB: 2048 } });
```

The browser reserves address space for the whole maximum when the engine starts, and the memory grows into it as the scene needs. Every other engine and WebAssembly module on the page, such as a physics engine, shares the address space that is left. So a larger maximum leaves less room for them. In Safari on an iPad Pro, a page holds the memories of 6 engines at 1024 MiB, and of 3 at 4096 MiB.

Ask for more only when a scene needs it. Each instance row takes about 180 bytes of engine memory, so 1024 MiB holds about 5 million rows with the rest of the scene. A scene that needs more memory than the maximum fails with [E1109](../errors/E1109.md). A maximum that is not a whole number of MiB from 256 to 4096 fails the start with [E1409](../errors/E1409.md).

The single-threaded build's memory is not shared. It grows as the scene needs, so the option does not change it. The `?memory=<MiB>` switch in the page's address wins over the option, for tests.

## What the engine reports

- `engine.capabilities` gives the GPU path (`tier`), whether the engine runs threaded, and the optional features and limits of the GPU path. It also gives the depth mode, and the most objects and instance rows that the device draws (`maxInstances`). [GPU tiers and backends](../concepts/backends.md) explains each.
- `engine.mode` gives the build, the latency mode, the thread that runs the sketch and the thread that draws. It also gives the number of job workers and the held time in hold mode. It gives the quality preset, the starts that crashed the tab before this one, and the memory maximum too.
- `engine.report` holds every result of the start's tests, as plain JSON.

## The running engine

- `setPaused(true)` stops the sketch's frames, and `setPaused(false)` resumes them. The first step after a pause is 0 seconds.
- `detach()` takes the canvas off the page and pauses the engine, and `attach(container)` puts it back. Use them when a single-page app leaves the view with the canvas and comes back. The engine keeps its threads, its GPU resources and the scene.
- `onFailure(handler)` receives a failure after the start: a GPU that the engine could not get back ([E1302](../errors/E1302.md)), or an engine thread that failed ([E1404](../errors/E1404.md)). Without a handler, the engine logs the failure to the console.
- `simulateGpuLoss()` acts out a loss of the GPU, so you can test how the page handles one. The engine starts a new GPU device and draws the whole scene again.
- `measure(seconds)` measures the running engine: CPU time per frame by thread, GPU time, frame intervals, uploads, draw calls, memory and load time. [Performance guide](../guides/performance.md) explains the numbers.
- `capture()` resolves with a PNG image of the next frame that the engine draws: [Screenshots](#screenshots).
- `captureFrame()` draws one frame offscreen and returns its pixels as RGBA8 rows, top row first. Tests use it: [Testing your sketch](../guides/testing.md).
- `postToSketch` and `onSketchMessage` send and receive [messages](page.md).
- `destroy()` stops the engine and its threads, and the engine cannot start again. Wait for its promise before you start another engine on the same page, because the browser frees the engine's memory only then.

Each `on...` call returns a function that removes its handler. `engine.labels` and `engine.requestPointerLock` come in null3D 0.2.

## Screenshots

`engine.capture()` resolves with an image of the next frame that the engine draws, as a PNG `Blob`. It takes the place of three.js's `preserveDrawingBuffer` with `canvas.toDataURL()`. The page cannot read a frame from the canvas itself: a worker usually draws on it, and the browser clears it after each frame.

```ts
shotButton.onclick = async () => {
  const blob = await engine.capture();
  const link = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: 'shot.png',
  });
  link.click();
};
```

The thread that draws reads the frame back from the GPU and encodes the image. When a worker draws, the page's thread does no work for it. The image has the size that the engine draws at, in pixels, and it is opaque, as the canvas is.

- While the engine is paused, and in hold mode, the image shows the frame on the canvas.
- A page in a hidden tab draws no frames, so its image comes when the tab shows again.
- After `destroy()`, `capture()` fails with [E1414](../errors/E1414.md).

## Related pages

- [Your first scene](../getting-started/first-scene.md): a page and a sketch that run together.
- [Sketch API: defineSketch and the context](sketch.md): the sketch's side of the engine.
- [Hosting and cross-origin isolation](../getting-started/hosting.md): the headers that let the engine run threaded.
- [3D scenes on content pages](../guides/content-pages.md): fallbacks, load deadlines and pausing on product pages.

## API reference

<!-- null3d:api:start -->

### `CapabilityReport`

Interface `CapabilityReport`, which extends `DeviceHints`.

What the browser and device can do, as plain JSON. The engine picks its build and GPU path from these feature tests, and its quality preset from the device hints. It never decides from browser or GPU names.

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

Starts the engine on the page. It tests the device, picks the build and the GPU path, starts the workers, and runs the sketch module. In hold mode it also steps the sketch to the held time, then draws that frame and reads it back. It publishes the frame, or the error that stopped it, as `window.__null3dHold` for test tools. With the `?bench` switch, it publishes the running engine as `window.__null3dEngine`, where a benchmark tool calls `measure`.

### `DepthMode`

```ts
type DepthMode = 'reversed' | 'reversed-gl' | 'standard';
```

How the GPU path stores depth. In `reversed` depth, the near plane stores 1 and the far plane 0, in a 32-bit float depth buffer. That keeps depth precise far from the camera. WebGPU always draws it. WebGL2 draws it where the browser has the `EXT_clip_control` extension, which gives WebGL2 the depth range from 0 to 1 that WebGPU has. The `reversed-gl` mode keeps the same order, but in WebGL2's own depth range from -1 to 1, which loses most of the precision. In `standard` depth, the near plane stores 0, as in three.js's WebGL renderer.

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
| `capture(): Promise<Blob>` | Resolves with an image of the next frame that the engine draws, as a PNG file. The thread that draws reads the frame back and encodes it, so the page's thread does no work for it when a worker draws. In hold mode, and while the engine is paused, the image shows the frame on the canvas. A hidden page draws no frames, so its image comes once the page shows again. Fails with E1414 once the engine has stopped. |
| `captureFrame(): Promise<{ width: number; height: number; pixels: Uint8Array; }>` | Draws one frame offscreen and returns its pixels as RGBA8 rows, top row first, for tests. In hold mode, it returns the held frame. |
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
| `maxInstances: number` | The most objects and instance rows, counted together, that a scene can draw on this device. On WebGPU every device draws at least 2,097,152, and a device with larger GPU buffers draws more, up to 8,388,480. On WebGL2 the number follows the largest texture the device allows: 2,097,152 at 4,096 pixels, and 1,048,576 at the 2,048 that every WebGL2 device allows. Engine memory can run out first: see E1109. |
| `depth: DepthMode` | How the GPU path stores depth. WebGPU, and WebGL2 in browsers with `EXT_clip_control`, draw `reversed` depth, which stays precise far from the camera. |

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
| `latency: LatencyMode \| 'single'` | The latency mode in use, or `single` for the single-thread build. A page that runs the sketch and draws steps the sketch right before each draw, which is `low`. |
| `sketchThread: SketchThread` | The thread that runs the sketch and the engine core. |
| `renderThread: 'render-worker' \| 'sketch-worker' \| 'main'` | The thread that owns the canvas and draws. |
| `jobWorkers: number` | The job workers that share the engine's parallel work. |
| `hold: number \| null` | The sketch time in seconds that hold mode holds the sketch at, or null for a live engine. |
| `preset: QualityPreset` | The quality preset that the engine runs. |
| `crashedStarts: number` | The starts of this sketch before this one that crashed the tab, one after another, as the engine's note in `localStorage` records them. After one, the engine starts a preset lower, and after two at `low`. |
| `memoryMaximumMiB: number \| null` | The shared memory's maximum in MiB, or null for the single-threaded build, whose memory is not shared. |

### `EngineOptions`

Interface `EngineOptions`.

Options for `createEngine`.

| Member | Description |
| --- | --- |
| `canvas: HTMLCanvasElement` | The canvas to draw into, sized by CSS. |
| `sketch: URL \| string` | The sketch module, which runs in the sketch worker; `new URL('./sketch.ts', import.meta.url)`. |
| `preset?: 'auto' \| QualityPreset` | The quality preset: `auto`, the default, lets the engine choose one for the device, and `low`, `medium`, `high` or `ultra` names one. The GPU path caps it: WebGL2 and WebGPU's compatibility mode run at most `medium`. After a start that crashed the tab, the engine starts a preset lower. Another value fails with E1213. The `?preset=` switch wins over it. |
| `maxPixelRatio?: number` | Cap for the device pixel ratio, a number from 0.5 up. Without it, the quality preset sets the cap. `ctx.quality.set` changes it during play. |
| `gpu?: 'auto' \| 'webgpu' \| 'webgl2'` | Forces a GPU tier, for testing only. |
| `powerPreference?: 'high-performance' \| 'low-power'` | Which GPU to draw with on a device that has two, such as a laptop with a separate graphics chip: `high-performance`, the default, for the faster one, or `low-power` to save battery. The browser treats it as a request. A device with one GPU ignores it. |
| `latency?: LatencyMode` | The latency mode. The default is `pipelined`. |
| `sketchThread?: SketchThread` | The thread that runs the sketch's code and the engine core: `worker`, the default, or `main` for the page's main thread, where the sketch can reach the DOM. Use `main` for apps that work mostly with the DOM, and for debugging. The render worker still draws in pipelined mode, and the page draws in low-latency mode. The sketch's frames then share the page's thread with the page's own work, so each can slow the other. The single-threaded build always runs the sketch on the page's thread. The `?sketch-thread=` switch wins over this option. |
| `memory?: { maximumMiB: number; }` | The engine's memory. `maximumMiB` sets the most memory that the engine's threads share, in MiB: a whole number from 256 to 4096, 1024 by default. Another value fails with E1409. The browser reserves address space for the whole maximum when the engine starts. So a larger maximum leaves less room for other engines and WebAssembly modules on the page. Ask for more only when a scene needs it. The single-threaded build's memory is not shared, so this option does not change it. The `?memory=<MiB>` switch wins over it. |
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
	| 'E1110'
	| 'E1203'
	| 'E1204'
	| 'E1205'
	| 'E1206'
	| 'E1207'
	| 'E1208'
	| 'E1213'
	| 'E1214'
	| 'E1217'
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
	| 'E1409'
	| 'E1410'
	| 'E1411'
	| 'E1412'
	| 'E1413'
	| 'E1414'
	| 'E1415'
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
| `stats: FrameSummary` | The held frame's figures, in the form that `engine.measure` returns: CPU time by thread and phase, draw calls, uploads and pipelines, for the held frame alone. The engine draws no frame before the held one, so the held frame creates every GPU object and uploads the whole scene. `rebuilds` and `visibleEntries` cover every step of the hold. GPU time is null, because the engine times the GPU only while `engine.measure` runs. |

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

### `SketchThread`

```ts
type SketchThread = 'worker' | 'main';
```

The thread that runs the sketch's code and the engine core. With `worker`, the default, the sketch runs in a worker of its own. With `main`, it runs on the page's main thread, where it can reach the DOM, while the render worker draws. The single-threaded build always runs it on the page's thread.

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

<!-- null3d:api:end -->
