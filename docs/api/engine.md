---
id: api/engine
title: "Page API: createEngine"
status: planned
since: "0.1"
summary: "createEngine options; engine.postToGame, capture, labels, requestPointerLock, capabilities, destroy."
---

<!-- sokko3d:placeholder -->

# Page API: createEngine

> Planned for sokko3d 0.1. No release has these APIs yet, so coding agents must not use them. The reference below lists what the engine in this repository has so far, and the rest of the page is not written yet.

This page will cover: createEngine options; engine.postToGame, capture, labels, requestPointerLock, capabilities, destroy.

## API reference

This reference is generated from the TSDoc comments in `packages/engine/src`. To change it, edit the comments.

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

Starts the engine on the page. It tests the device, picks the build and the GPU path, starts the workers, and runs the game module.

### `Engine`

Interface `Engine`.

A running engine, as `createEngine` returns it.

| Member | Description |
| --- | --- |
| `readonly capabilities: EngineCapabilities` | The GPU path the engine chose, and what it offers. |
| `readonly report: CapabilityReport` | The full capability report, as plain JSON. |
| `readonly mode: EngineMode` | How the engine runs on this device. |
| `postToGame(name: string, data?: unknown, transfer?: Transferable[]): void` | Sends a message to the game, which receives it through `ctx.page.onMessage`. |
| `onGameMessage(handler: (name: string, data: unknown) => void): void` | Receives the messages the game sends with `ctx.page.post`. |
| `setPaused(paused: boolean): void` | Pauses or resumes the game's frames. |
| `measure(seconds: number): Promise<FrameMetrics>` | Measures the running engine for a number of seconds, then returns CPU time per frame by thread and phase, GPU time, frame intervals, uploads, draw calls, memory and load time. |
| `captureFrame(): Promise<{ width: number; height: number; pixels: Uint8Array; }>` | Draws one frame offscreen and returns its pixels as RGBA8 rows, top row first. |
| `destroy(): void` | Stops the engine and its workers. The engine cannot start again. |

### `EngineCapabilities`

Interface `EngineCapabilities`.

The GPU path the engine chose, and what it offers.

| Member | Description |
| --- | --- |
| `tier: Tier` | The GPU path the engine draws with. |
| `threaded: boolean` | True when the engine runs the threaded build. |
| `features: string[]` | The optional features of the GPU path: WebGPU features, or the WebGL2 extensions present. |
| `limits: Record<string, number \| null>` | The WebGPU limits, or an empty object on WebGL2. |

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
| `build: 'threaded' \| 'single'` | With `threaded`, the game and the render step run in workers, helped by job workers. With `single`, everything runs on the page's thread, for pages without shared memory. |
| `latency: LatencyMode \| 'single'` | The latency mode in use, or `single` for the single-thread build. |
| `renderThread: 'render-worker' \| 'game-worker' \| 'main'` | The thread that owns the canvas and draws. |
| `jobWorkers: number` | The job workers that share the engine's parallel work. |

### `EngineOptions`

Interface `EngineOptions`.

Options for `createEngine`.

| Member | Description |
| --- | --- |
| `canvas: HTMLCanvasElement` | The canvas to draw into, sized by CSS. |
| `game: URL \| string` | The game module, which runs in the game worker; `new URL('./game.ts', import.meta.url)`. |
| `maxPixelRatio?: number` | Cap for the device pixel ratio. |
| `gpu?: 'auto' \| 'webgpu' \| 'webgl2'` | Forces a GPU tier, for testing only. |
| `latency?: LatencyMode` | The latency mode. The default is `pipelined`. |

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
	| 'E1203'
	| 'E1204'
	| 'E1301'
	| 'E1401'
	| 'E1402'
	| 'E1403'
	| 'E1501';
```

The code of an engine error. Each code has a docs page that gives its cause and its fix.

### `LatencyMode`

```ts
type LatencyMode = 'pipelined' | 'low';
```

How the engine trades latency for speed. In `pipelined` mode, the render worker draws each frame while the game computes the next one. In `low` mode, the game worker draws each frame right after its update.

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
| `sharedMemoryUploads: { bufferSubData: boolean; texSubImage2D: boolean; } \| null` | Whether WebGL accepts views on shared memory for uploads; null without shared memory. |
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
