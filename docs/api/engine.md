---
id: api/engine
title: "Page API: createEngine"
status: experimental
since: "0.1"
summary: "createEngine options and start errors; memory; capabilities and mode; pausing, detaching, failures, measuring, captureFrame, messages and destroy."
---

# Page API: createEngine

> Ships in null3D 0.1. The API is experimental, so it can still change between versions.

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

`createEngine` tests what the browser offers, and picks the build and the GPU path from those tests, never from browser or GPU names. It starts the engine's threads, loads the sketch module and runs the sketch's setup. It resolves once the setup has run, and `engine.firstFrame` resolves once the GPU has finished the first frame. When the engine chose the preset itself, `createEngine` also waits for the [preset check](../concepts/quality-presets.md#the-preset-check). The check draws the first frames, so the first frame is then on the screen before `createEngine` resolves. On a repeat visit, the engine takes the check's stored result instead, and `createEngine` resolves after the setup.

`onProgress` reports each stage of the start, in this order:

- `core`, once the engine core is compiled and the GPU paths are tested;
- `sketch`, after the sketch's setup, and after the preset check when one runs;
- `first-frame`, once the GPU has finished the first frame.

Before `core`, `memory-wait` comes when the browser has refused the engine's memory for 10 seconds. A browser can hold memory that an earlier engine used for a while after it stops, and Safari at times held it for 40 seconds. The engine keeps trying for about 45 seconds in all, then fails with E1109. Show the user that the start takes longer than usual.

An `AbortSignal` in `signal` cancels a start in progress. Then `createEngine` stops the engine's threads and rejects with the signal's reason.

`createEngine` rejects with an `EngineError` when the engine cannot start:

| Code | Cause |
| --- | --- |
| [E1407](../errors/E1407.md) | The `hold` option or the `?hold=` switch gives a time that is not a number of seconds from 0 to 600. |
| [E1415](../errors/E1415.md) | The sketch would run on the page's main thread, where another engine still runs its sketch. |
| [E1213](../errors/E1213.md) | An option is out of its range: `preset`, `maxPixelRatio`, `antialias`, the shadow options, `depthPrepass` or `maxLabels`. The options table gives each range. |
| [E1409](../errors/E1409.md) | The `memory` option asks for a maximum that is not a whole number of MiB from 256 to 4096. |
| [E1303](../errors/E1303.md) | The browser runs WebAssembly without SIMD. |
| [E1306](../errors/E1306.md) | The browser runs the WebKit engine of a Safari before 18: Safari 17 or older, or any browser on iOS or iPadOS 17 or older. |
| [E1301](../errors/E1301.md) | The browser has no usable GPU path, or no path that `gpu` or `?gpu=` asks for. |
| [E1406](../errors/E1406.md) | The engine core's WebAssembly file did not download. |
| [E1418](../errors/E1418.md) | The page's Content-Security-Policy blocks WebAssembly: its `script-src` lacks `'wasm-unsafe-eval'`. |
| [E1109](../errors/E1109.md) | The browser refused the engine's memory, even after about 45 seconds of tries. |
| [E1402](../errors/E1402.md) | The engine core's file comes from another build than the engine's JavaScript. Every build checks that the threaded core imports shared memory, and development builds also check each function. |
| [E1410](../errors/E1410.md) | The sketch module did not load: it did not download, or its code threw an error while it loaded. |
| [E1401](../errors/E1401.md) | The sketch module's default export is not `defineSketch(...)`. |
| [E1214](../errors/E1214.md) | An option of `defineSketch` is out of its range. |
| [E1405](../errors/E1405.md) | An engine thread did not start. |
| [E1404](../errors/E1404.md) | An engine thread, or the drawing on the page, failed during the start. For example, the GPU had no memory for the first frame's textures. A worker that fails before it is ready reports E1405 instead. |
| [E1302](../errors/E1302.md) | The browser took the GPU away during the start, and no new device started. |
| [E1408](../errors/E1408.md) | In hold mode, the sketch or the engine failed before the engine read the held frame back. |

An error that the sketch's setup throws also rejects the start ([Sketch API](sketch.md#the-setup-function)).

## Options

`canvas` and `sketch` are required. `sketch` is the address of the sketch module, usually `new URL('./sketch.ts', import.meta.url)`.

The canvas takes its size from CSS. The engine sizes the canvas's drawing buffer to that size times the screen's pixel ratio, up to the cap that `maxPixelRatio` or the preset sets.

- A canvas that no CSS sizes shows its drawing buffer at one CSS pixel per buffer pixel, so each new buffer would make it larger. The engine sets the CSS width and height that the canvas shows when the engine starts.
- The drawing buffer is never wider or taller than `engine.capabilities.maxCanvasSize`. That is 8,192 pixels on WebGPU and 4,096 in its compatibility mode. On WebGL2 it is the smallest of the device's texture, renderbuffer and viewport limits. A larger canvas draws at a lower pixel ratio, which `engine.viewport.pixelRatio` in the sketch reports.

| Option | Default | What it does |
| --- | --- | --- |
| `preset` | `'auto'` | The quality preset, which the engine chooses for the device unless the page names one: [Quality presets](../concepts/quality-presets.md). The `?preset=` switch wins over it. |
| `maxPixelRatio` | The preset's cap | Caps the screen's pixel ratio that the engine draws at, in place of the preset's cap |
| `antialias` | The preset's mode | `'msaa'`, `'fxaa'` or `'none'`, in place of the preset's anti-aliasing mode: [GPU tiers and backends](../concepts/backends.md#color-and-anti-aliasing-on-each-tier) |
| `shadowTiles`, `shadowTileSize`, `pointLightShadows` | The preset's values | The shadows of spot and point lights, in place of the preset's settings: [Shadows](../concepts/shadows.md#settings). Each is fixed while the engine runs. |
| `depthPrepass` | `true` on WebGL2 and `false` on WebGPU, on every preset | `true` draws the depth of the opaque objects before they are shaded: [The depth prepass](../concepts/quality-presets.md#the-depth-prepass). The `?prepass=` switch wins over it. |
| `gpu` | `'auto'` | Forces a GPU path, for tests only. The `?gpu=` switch in the page's address wins over it, and also takes `compat` for WebGPU's compatibility mode. |
| `powerPreference` | `'high-performance'` | Picks the GPU on a device that has two. `'low-power'` saves battery. |
| `latency` | `'pipelined'` | The latency mode, `'pipelined'` or `'low'`: [Architecture](../concepts/architecture.md#latency-modes). The `?latency=` switch wins over it, and the single-threaded build ignores it. Where no worker can draw, the engine runs pipelined. |
| `transparent` | false | Makes a see-through canvas: [A transparent canvas](#a-transparent-canvas) |
| `largeWorld` | false | Keeps the positions of objects exact at any distance from the origin, for scenes the size of a planet: [Large worlds and precision](../concepts/large-worlds.md#large-world-mode) |
| `sketchThread` | `'worker'` | The thread that runs the sketch. `'main'` runs it on the page's main thread, where it can reach the DOM: [Where the sketch runs](../concepts/architecture.md#where-the-sketch-runs). The `?sketch-thread=` switch wins over it, and the single-threaded build always runs the sketch on the main thread. |
| `memory` | `{ maximumMiB: 1024 }` | The most memory that the engine's threads share: [Memory](#memory) |
| `maxLabels` | `4096` | The most labels that the sketch tracks at once, from 1 to 65,536: [UI overlays and labels](ui.md). Another value fails with [E1213](../errors/E1213.md). |
| `onProgress` | None | Reports each stage of the start |
| `onSketchMessage` | None | Receives the sketch's messages from the start of its setup: [Messages](page.md) |
| `signal` | None | Cancels the start |
| `hold` | None | Holds the sketch at a time for image tests: [Testing your sketch](../guides/testing.md). The `?hold=` switch wins over it. |

## A transparent canvas

With `transparent: true`, the page shows through wherever no object draws. The canvas holds premultiplied alpha, the form that browsers composite. The sketch can still set a background with `scene.setBackground`, which makes the canvas opaque again.

```ts
const engine = await createEngine({
  canvas,
  sketch: new URL('./sketch.ts', import.meta.url),
  transparent: true,
});
```

Use it to put a model over the page's own background, such as a product on a marketing page. [Color management](../concepts/color-management.md#transparent-canvases) covers how the edges of objects blend with the page.

## Memory

On a page with worker threads, the engine's threads share one WebAssembly memory, which holds the scene. The memory's maximum is 1024 MiB on every quality preset. A scene that needs more can ask for up to 4096 MiB, in whole MiB:

```ts
const engine = await createEngine({ canvas, sketch, memory: { maximumMiB: 2048 } });
```

The browser reserves address space for the whole maximum when the engine starts, and the memory grows into it as the scene needs. Every other engine and WebAssembly module on the page, such as a physics engine, shares the address space that is left. So a larger maximum leaves less room for them. In Safari on an iPad Pro, a page holds the memories of 6 engines at 1024 MiB, and of 3 at 4096 MiB.

Ask for more only when a scene needs it. Each instance row takes about 210 bytes of engine memory, so 1024 MiB holds about 5 million rows with the rest of the scene. A scene that needs more memory than the maximum fails with [E1109](../errors/E1109.md). A maximum that is not a whole number of MiB from 256 to 4096 fails the start with [E1409](../errors/E1409.md).

The single-threaded build's memory is not shared. It grows as the scene needs, so the option does not change it. The `?memory=<MiB>` switch in the page's address wins over the option, for tests.

## What the engine reports

- `engine.capabilities` gives the GPU path (`tier`), whether the engine runs threaded, and the optional features and limits of the GPU path. It also gives whether the scene draws HDR color (`hdr`), the depth mode, and the most objects and instance rows that the device draws (`maxInstances`). The `halfPrecision` field says whether the scene shaders do their color math at half precision, which only the `?half=on` switch turns on. [GPU tiers and backends](../concepts/backends.md) explains each.
- `engine.mode` gives the build, the latency mode, the thread that runs the sketch and the thread that draws. It also gives the number of job workers and the held time in hold mode. It gives the quality preset, what the preset check measured, the starts that crashed the tab before this one, and the memory maximum too.
- `engine.report` holds every result of the start's tests, as plain JSON.

## The running engine

- `setPaused(true)` stops the sketch's frames, and `setPaused(false)` resumes them. The first step after a pause is 0 seconds.
- `detach()` takes the canvas off the page and pauses the engine, and `attach(container)` puts it back. Use them when a single-page app leaves the view with the canvas and comes back. The engine keeps its threads, its GPU resources and the scene.
- `onFailure(handler)` receives a failure after the start. It can be a GPU that the engine could not get back ([E1302](../errors/E1302.md)), or an engine thread that failed ([E1404](../errors/E1404.md)). After E1404 the engine stops drawing new frames, and the canvas keeps the last one: destroy the engine and start a new one. It can also be a job worker that did not start ([E1405](../errors/E1405.md)). On WebGPU it can be a GPU that ran out of memory ([E1304](../errors/E1304.md)) or rejected the engine's work ([E1305](../errors/E1305.md)). The engine then draws on without the objects that failed. Without a handler, the engine logs the failure to the console. The handler is the only place where these failures show: no promise rejects for them.
- `simulateGpuLoss()` acts out a loss of the GPU, so you can test how the page handles one. The engine starts a new GPU device and draws the whole scene again.
- `measure(seconds)` measures the running engine: CPU time per frame by thread, GPU time, frame intervals, uploads, draw calls, memory and load time. [Performance guide](../guides/performance.md) explains the numbers.
- `capture()` resolves with a PNG image of the next frame that the engine draws: [Screenshots](#screenshots).
- `captureFrame()` returns the pixels of the next frame that the engine draws, as RGBA8 rows, top row first. The thread that draws waits for its frame loop to take a new frame, then draws that frame again offscreen and reads it back. So captures back to back give newer frames, even on a slow GPU whose readback holds that thread up. In hold mode it returns the held frame and draws nothing. On a transparent canvas the pixels keep their premultiplied alpha. Tests use it: [Testing your sketch](../guides/testing.md).
- `postToSketch` and `onSketchMessage` send and receive [messages](page.md).
- `labels.bind(id, element)` moves an HTML element over the label that the sketch tracks under `id`: [UI overlays and labels](ui.md).
- `destroy()` stops the engine and its threads, and the engine cannot start again. The sketch's `onDestroy` runs first, and every later call from the sketch's code fails with [E1420](../errors/E1420.md). Wait for its promise before you start another engine on the same page.
- The page keeps the memory that a stopped engine's threads shared, for about 30 seconds. The next engine with the same memory maximum takes it. React's StrictMode, route changes and hot reloads destroy and create the engine again. Such a page then asks the browser for no new memory. Safari can refuse a new memory for some seconds after a page drops one. The page keeps at most 2 memories. Their RAM stays in use until a new engine takes one, the 30 seconds end or the page goes away. Call `destroy({ release: true })` when the page will not start the engine again soon: the browser can then free the memory at once. An engine whose threads did not all stop cleanly leaves no memory to reuse. The single-threaded build's memory is not shared, and the page keeps its core for the next engine.
- A new engine can start on the canvas of an engine that you destroyed. Its start waits until the old engine has stopped, so it can begin before `destroy()` resolves. React's StrictMode needs this, because it starts an effect twice on one `<canvas>`. A canvas that a worker drew on stays with that worker. So the new engine needs the same thread options as the old one. The worker ends when the canvas leaves the page or the page goes away. It also ends when the browser refuses memory for a new engine while no engine runs on the canvas. A new engine on its canvas then fails with [E1419](../errors/E1419.md), as on a canvas whose engine still runs.
- In Safari, a stopped engine's canvas that stays in the page keeps the engine's memory, 1 GiB by default, until that worker ends. A new engine that needs the room gets it. Other code does not: a page that also loads a large WebAssembly module can run out of room. So remove the canvas from the page once you are done with it.
- A page that goes away without `destroy()`, such as a page in a frame that your app removes, still gives back the engine's memory. When the page hides, the engine wakes its job workers and ends their loops. Safari never frees the memory of a worker that it stops while the worker waits for work. Without this, an iPad would run out of room after a few such pages. A page that the browser brings back from its back-forward cache runs on, with the job workers' share of the work on the sketch thread.

Each `on...` call returns a function that removes its handler. `engine.requestPointerLock` comes in null3D 0.2.

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

The thread that draws reads the frame back from the GPU and encodes the image. When a worker draws, the page's thread does no work for it. The image has the size that the engine draws at, in pixels. It is opaque, as the canvas is, unless the engine draws on a [transparent canvas](#a-transparent-canvas): then the image keeps the frame's alpha.

- While the engine is paused, the image shows the frame on the canvas.
- In hold mode, the image shows the held frame. The page keeps that frame's pixels, so the GPU draws nothing more for the image.
- A page in a hidden tab draws no frames, so its image comes when the tab shows again.
- When no new frame comes within a second or two, such as after an error stopped the sketch, the image shows the frame drawn last.
- After `destroy()`, `capture()` fails with [E1414](../errors/E1414.md). So does a capture whose frame the engine could not read back or encode. On WebGPU, the message names the cause when the GPU gives one: a lost device with its reason, or too little GPU memory.

## Related pages

- [Your first scene](../getting-started/first-scene.md): a page and a sketch that run together.
- [Sketch API: defineSketch and the context](sketch.md): the sketch's side of the engine.
- [Hosting and cross-origin isolation](../getting-started/hosting.md): the headers that let the engine run threaded.
- [3D scenes on content pages](../guides/content-pages.md): fallbacks, load deadlines and pausing on product pages.
- [Color management](../concepts/color-management.md): HDR color, tone mapping and transparent canvases.

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
| `worker: WorkerProbe \| WorkerProbeFailure` | What a dedicated worker can do, or why the probe worker gave no answer. |

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
| `readonly labels: EngineLabels` | The HTML elements that follow the labels the sketch tracks with `ui.trackLabel`. |
| `postToSketch(name: string, data?: unknown, transfer?: Transferable[]): void` | Sends a message to the sketch, which receives it through `ctx.page.onMessage`. |
| `onSketchMessage(handler: (name: string, data: unknown) => void): () => void` | Receives the messages the sketch sends with `ctx.page.post`. When no handler listened from the start, the first handler also receives the messages sent before it was registered. Returns a function that removes the handler. |
| `onFailure(handler: (error: EngineError) => void): () => void` | Receives a failure after the engine started: the browser took the GPU away and the engine could not carry on with a new device (E1302), or an engine thread failed (E1404). After E1404 the engine draws no new frames: destroy it and start a new one. On WebGPU, the GPU can also run out of memory (E1304) or reject the engine's work (E1305), and the engine draws on without the objects that failed. The engine reports each failure once. Without a handler, it logs the failure to the console. Returns a function that removes the handler. |
| `setPaused(paused: boolean): void` | Pauses or resumes the sketch's frames. A pause also stops input: the sketch sees every key and button that was down come up, and input that comes during the pause never reaches it. |
| `detach(): void` | Takes the canvas off the page and pauses the engine. The engine keeps its threads, its GPU resources and the scene, and stops reading input. Use it when a single-page app leaves the view that shows the canvas, and `attach` when the view comes back. |
| `attach(container: Element): void` | Puts the canvas at the end of `container` and resumes the engine where it stopped, unless `setPaused(true)` paused it. |
| `measure(seconds: number): Promise<FrameMetrics>` | Measures the running engine for a number of seconds, then returns CPU time per frame by thread and phase, GPU time, frame intervals, uploads, draw calls, memory and load time. |
| `capture(): Promise<Blob>` | Resolves with an image of the next frame that the engine draws, as a PNG file. The thread that draws reads the frame back and encodes it, so the page's thread does no work for it when a worker draws. In hold mode it is an image of the held frame, whose pixels the page keeps, so the GPU draws nothing for it. While the engine is paused, the image shows the frame on the canvas. A hidden page draws no frames, so its image comes once the page shows again. When no new frame comes within a second or two, as after a sketch error, the image shows the frame drawn last. Fails with E1414 once the engine has stopped, or when the thread that draws could not read the frame back, with the cause that the GPU gave, such as a lost device or too little memory. |
| `captureFrame(): Promise<{ width: number; height: number; pixels: Uint8Array; }>` | Resolves with the pixels of the next frame that the engine draws, as RGBA8 rows, top row first, for tests. The thread that draws waits until its frame loop has taken a new frame, then draws that frame again offscreen and reads it back, so captures back to back give newer frames even where each readback holds that thread up. In hold mode, and while the engine is paused, it returns the frame on the canvas. A hidden page draws no frames, so its pixels come once the page shows again. When no new frame comes within a second or two, as after a sketch error, it returns the frame drawn last. |
| `simulateGpuLoss(): void` | Acts out a loss of the GPU, as a driver reset causes. The engine starts a new GPU device and draws the whole scene again, as it does after a real loss. Use it to test how your page handles one. |
| `destroy(options?: { release?: boolean; }): Promise<void>` | Stops the engine and its workers. The engine cannot start again. The sketch's `onDestroy` runs first, and later calls from the sketch's code fail with E1420. The thread that draws destroys the engine's GPU textures and buffers and its GPU device, so the GPU's memory comes back at once. It also leaves the canvas blank, at its size, because Safari keeps the GPU memory of a canvas's last frame until the canvas shows another. The promise resolves once every worker has stopped. Wait for it before you start another engine on the same page: an iPad has room for only a few engines' memory. A new engine can start on the same canvas, with the same thread options; `createEngine` waits for this stop. The page keeps the memory that the engine's threads shared for about 30 seconds, and the next engine with the same memory maximum takes it. A page that destroys and creates the engine again, as React's strict mode, a route change or a hot reload does, then asks the browser for no new memory. Safari can refuse new memory for some seconds after a page drops some. The page keeps at most 2 memories, and the RAM that they hold stays taken until a new engine takes one or their time ends. `{ release: true }` lets the browser free them at once: use it when the page will not start the engine again soon. |

### `EngineCapabilities`

Interface `EngineCapabilities`.

The GPU path the engine chose, and what it offers.

| Member | Description |
| --- | --- |
| `tier: Tier` | The GPU path the engine draws with. |
| `threaded: boolean` | True when the engine runs the threaded build. |
| `features: string[]` | The optional features of the GPU path: WebGPU features, or the WebGL2 extensions present. |
| `limits: Record<string, number \| null>` | The WebGPU limits, or an empty object on WebGL2. |
| `hdr: boolean` | True when the scene draws high dynamic range color, which the final pass tone maps into the canvas. False on the 8-bit path, where each shader tone maps its own output: in WebGPU's compatibility mode with MSAA, and on WebGL2 devices whose float targets fail the engine's test. Both paths show the same colors. Edges differ a little with MSAA, because the 8-bit path averages the samples after the tone mapping. It reports the path that the engine started on: in compatibility mode, bloom moves the engine to HDR color with FXAA when a sketch turns it on. |
| `halfPrecision: boolean` | True when the scene shaders do their color math at half precision: lighting, tone mapping and sRGB encoding. On WebGPU it needs the device feature `shader-f16`, and WebGL2 runs that math at `mediump`. Positions, depth and shadow lookups keep full precision either way. |
| `maxInstances: number` | The most objects and instance rows, counted together, that a scene can draw on this device. On WebGPU every device draws at least 2,097,152, and a device with larger GPU buffers draws more, up to 8,388,480. On WebGL2 the number follows the largest texture the device allows: 2,097,152 at 4,096 pixels, and 1,048,576 at the 2,048 that every WebGL2 device allows. Engine memory can run out first: see E1109. |
| `maxCanvasSize: number` | The widest and tallest drawing buffer, in device pixels, that the GPU path draws into: 8,192 on WebGPU, 4,096 in its compatibility mode, and on WebGL2 the smallest of the device's texture, renderbuffer and viewport limits. A canvas larger than that at the screen's pixel ratio draws at a lower ratio, which `engine.viewport.pixelRatio` in the sketch reports. |
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
| `preset: QualityPreset` | The quality preset that the engine runs. The preset check can lower it before `createEngine` resolves, and `ctx.quality.setPreset` in the sketch changes it later. |
| `presetCheck: PresetCheck \| null` | What the preset check measured, or null when no check ran. The engine checks the preset when it chose it from the device: after the first frame, it measures the frame rate of the scene that the setup built, and lowers the preset until one holds the target. A later start of the sketch in the same browser on the same device takes the stored result instead, and starts at its preset. `reused` is then true. |
| `crashedStarts: number` | The starts of this sketch before this one that crashed the tab, one after another, as the engine's note in `localStorage` records them. After one, the engine starts a preset lower, and after two at `low`. |
| `memoryMaximumMiB: number \| null` | The shared memory's maximum in MiB, or null for the single-threaded build, whose memory is not shared. |
| `renderFallback: RenderFallback \| null` | Why the page draws when a worker was meant to, or null when the thread that draws is the one that the options asked for. `report.worker` holds the probe's answer. |

### `EngineOptions`

Interface `EngineOptions`.

Options for `createEngine`.

| Member | Description |
| --- | --- |
| `canvas: HTMLCanvasElement` | The canvas to draw into, sized by CSS. On a canvas that no CSS sizes, the engine sets the CSS width and height that it shows when the engine starts. One engine draws on a canvas at a time: a start on the canvas of an engine that is stopping, or still starting and then destroyed, waits for that engine to stop. A canvas whose engine runs on fails with E1419. |
| `sketch: URL \| string` | The sketch module, which runs in the sketch worker; `new URL('./sketch.ts', import.meta.url)`. |
| `preset?: 'auto' \| QualityPreset` | The quality preset: `auto`, the default, lets the engine choose one for the device, and `low`, `medium`, `high` or `ultra` names one. The GPU path caps it: WebGL2 and WebGPU's compatibility mode run at most `medium`. After a start that crashed the tab, the engine starts a preset lower. Another value fails with E1213. The `?preset=` switch wins over it. |
| `maxPixelRatio?: number` | Cap for the device pixel ratio, a number from 0.5 up. Without it, the quality preset sets the cap. `ctx.quality.set` changes it during play. |
| `gpu?: 'auto' \| 'webgpu' \| 'webgl2'` | Forces a GPU tier, for testing only. |
| `powerPreference?: 'high-performance' \| 'low-power'` | Which GPU to draw with on a device that has two, such as a laptop with a separate graphics chip: `high-performance`, the default, for the faster one, or `low-power` to save battery. The browser treats it as a request. A device with one GPU ignores it. |
| `latency?: LatencyMode` | The latency mode. The default is `pipelined`. Low latency needs a worker that draws: where no worker can draw, the engine runs in pipelined mode, and `engine.mode` says so. |
| `antialias?: 'msaa' \| 'fxaa' \| 'none'` | How the engine smooths the edges of what it draws: `msaa` draws 4 samples per pixel, `fxaa` smooths edges in the final pass, and `none` leaves them sharp. Without it, the quality preset sets the mode: FXAA on Low, MSAA from Medium up. Each mode works on every GPU path, and the mode stays fixed while the engine runs. Another value fails with E1213. |
| `shadowCascades?: number` | The cascades of a directional light's shadows, a whole number from 1 to 4, for each light whose `shadow` options name none. Without it, the quality preset sets it. Another value fails with E1213. |
| `shadowMapSize?: number` | Texels on each side of each cascade's shadow map, for each directional light whose `shadow` options name no `mapSize`: 512, 1,024, 2,048 or 4,096. Without it, the quality preset sets it. Another value fails with E1213. |
| `shadowTiles?: number` | The most tiles of the shadow atlas that spot and point lights cast their shadows into, a whole number from 0 to 24. Without it, the quality preset sets it. 0 turns the shadows of spot and point lights off. Another value fails with E1213. |
| `shadowTileSize?: number` | Texels on each side of each tile of the shadow atlas: 256, 512, 1,024 or 2,048. Without it, the quality preset sets it. Another value fails with E1213. |
| `pointLightShadows?: boolean` | True makes point lights cast shadows, false keeps them from it. Without it, the quality preset decides: High and Ultra turn them on. Another value fails with E1213. |
| `depthPrepass?: boolean` | True to draw the depth of the opaque objects before the engine shades them, so each pixel is shaded once, for its nearest surface. It saves GPU time in scenes where objects hide many others and shading costs much, and costs a second pass over the objects' vertices. Without it, the quality preset decides: every preset draws the prepass on WebGL2, and none on WebGPU. The prepass stays fixed while the engine runs, and the `?prepass=on` or `?prepass=off` switch wins over this option. Another value fails with E1213. |
| `gpuOcclusion?: boolean` | True to run GPU occlusion culling on WebGPU: objects that `setOccluder(true)` marks hide the objects that lie wholly behind them, so the GPU skips those. Each camera view draws the depth of the marked objects that it showed in the last frame and tests every object against it. It saves GPU time where walls and large objects hide many detailed ones; a scene that marks no object pays nothing. Every quality preset leaves it off: measure your scene's GPU time with it first, as its passes can cost more than they save. It stays fixed while the engine runs, and the `?occlusion=on` or `?occlusion=off` switch wins over this option. WebGL2 and the depth prepass draw without it. Another value fails with E1213. |
| `morphTargets?: number` | The most morph target weights of each object that a WebGL2 device draws, a whole number from 1 to 256. Each object keeps the weights farthest from 0. Without it, the quality preset sets it. WebGPU draws every weight. Another value fails with E1213. |
| `softwareOcclusion?: boolean` | True to run software occlusion culling on WebGL2: objects that `setOccluder(true)` marks hide the objects that lie wholly behind them, so the GPU skips those. False turns it off. Without it, the quality preset decides, and a sketch can change it during play with `quality.set`. The `?occlusion=on` or `?occlusion=off` switch wins over this option. WebGPU ignores it. Another value fails with E1213. |
| `transparent?: boolean` | True for a see-through canvas: the page shows through wherever no object draws, until the sketch sets a background color. The canvas holds premultiplied alpha, as a browser composites it. The default is false, an opaque canvas. |
| `largeWorld?: boolean` | True for scenes that reach far beyond a city, such as a planet. Object positions then keep the precision of JavaScript's numbers at any distance from the origin: 0.03 mm or better. Without it, positions are 32-bit floats, which move in steps of 6 cm at 1,000 km from the origin and 0.5 m at the Earth's radius. It costs 12 bytes of memory per object and a little work in each position setter. The default is false. Instance batches need no mode: give each one an `origin` near its rows. |
| `sketchThread?: SketchThread` | The thread that runs the sketch's code and the engine core: `worker`, the default, or `main` for the page's main thread, where the sketch can reach the DOM. Use `main` for apps that work mostly with the DOM, and for debugging. The render worker still draws in pipelined mode, and the page draws in low-latency mode. The sketch's frames then share the page's thread with the page's own work, so each can slow the other. The single-threaded build always runs the sketch on the page's thread. The `?sketch-thread=` switch wins over this option. |
| `memory?: { maximumMiB: number; }` | The engine's memory. `maximumMiB` sets the most memory that the engine's threads share, in MiB: a whole number from 256 to 4096, 1024 by default. Another value fails with E1409. The browser reserves address space for the whole maximum when the engine starts. So a larger maximum leaves less room for other engines and WebAssembly modules on the page. Ask for more only when a scene needs it. The single-threaded build's memory is not shared, so this option does not change it. The `?memory=<MiB>` switch wins over it. |
| `maxLabels?: number` | The most HTML labels that the sketch can track at once with `ui.trackLabel`: a whole number from 1 to 65,536, 4,096 by default. Another value fails with E1213. The engine keeps three tables of 16 bytes per label in memory that its threads share, so 4,096 labels take 192 KB. |
| `onProgress?: (stage: StartupStage) => void` | Called as the start reaches each stage, in this order: `core` once the engine core is compiled and the GPU paths are tested, `sketch` once the sketch's setup has run, and `first-frame` once the GPU has finished the first frame. Before `core`, `memory-wait` comes when the browser has refused the engine's memory for 10 seconds. The engine then tries for about 35 seconds more before it fails with E1109. |
| `onSketchMessage?: (name: string, data: unknown) => void` | Receives the messages the sketch sends with `ctx.page.post`, from the start of the sketch's setup. Use it for progress that the sketch reports while it loads. `engine.onSketchMessage` adds more handlers once the engine has started. |
| `signal?: AbortSignal` | Cancels a start in progress, for example when the user leaves the page. `createEngine` then stops the engine's threads and rejects with the signal's reason. |
| `hold?: number` | Starts the engine in hold mode for image tests, held at this many seconds of sketch time. The engine steps the sketch from 0 to the time in fixed steps of 1/60 second, with no frame loop. `math.random` and `Math.random` in the sketch's thread give the same numbers on every run, and the sketch gets no input: every key and button stays up. The engine then draws that one frame and reads it back, and `createEngine` resolves. The `?hold=<seconds>` switch overrides this time, and a bare `?hold` holds at it, or at 0 without it. |
| `preload?: readonly ShaderFeature[]` | Features whose shaders load before the first frame, for a game that must fetch nothing while it plays. Each feature's shaders otherwise download the first time the sketch uses it: `'skinning'` with the first skinned mesh, `'morph'` with the first morphed mesh, `'bloom'` and `'ao'` when `post.set` turns them on, `'sprites'` and `'lines'` with the first batch, `'background'` with a texture, environment or cube map background, `'sky'` with the sky, and `'occlusion'` with the first object that `setOccluder(true)` marks while GPU occlusion culling runs on WebGPU. WebGPU morphs in the skinning pass, so there `'morph'` loads the skinning shaders, and WebGL2 has no `'occlusion'` shaders to load. Listed features download beside the engine's own shaders, so the start waits only for the largest. Loading a glTF file with skins or morph targets, or making a batch, also starts its feature's download at once, before the objects draw. Throws E1421 for a name it does not know. |

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
	| 'E1111'
	| 'E1203'
	| 'E1204'
	| 'E1205'
	| 'E1206'
	| 'E1207'
	| 'E1208'
	| 'E1213'
	| 'E1214'
	| 'E1215'
	| 'E1216'
	| 'E1217'
	| 'E1218'
	| 'E1219'
	| 'E1301'
	| 'E1302'
	| 'E1303'
	| 'E1304'
	| 'E1305'
	| 'E1306'
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
	| 'E1416'
	| 'E1417'
	| 'E1418'
	| 'E1419'
	| 'E1420'
	| 'E1421'
	| 'E1422'
	| 'E1423'
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

### `RenderFallback`

```ts
type RenderFallback = WorkerProbeFailure['failure'] | 'no-surface';
```

Why the engine draws on the page's thread when its options asked a worker to draw: - `no-answer`: the probe worker, and a second one after it, gave no answer within their time limits. A stalled GPU call or a very busy machine causes this. - `failed-to-start`: the probe worker's script failed to load or run. - `no-surface`: a worker cannot draw with the GPU path here, as the browser offers no context of it for an `OffscreenCanvas` in a worker.

### `ShaderFeature`

```ts
type ShaderFeature =
	| 'ao'
	| 'background'
	| 'bloom'
	| 'instance_index'
	| 'lines'
	| 'morph'
	| 'occlusion'
	| 'skinning'
	| 'sky'
	| 'sprites'
	| 'texcoords';
```

A feature whose shader builds load on first use, which `createEngine`'s `preload` lists.

### `SketchThread`

```ts
type SketchThread = 'worker' | 'main';
```

The thread that runs the sketch's code and the engine core. With `worker`, the default, the sketch runs in a worker of its own. With `main`, it runs on the page's main thread, where it can reach the DOM, while the render worker draws. The single-threaded build always runs it on the page's thread.

### `StartupStage`

```ts
type StartupStage = 'memory-wait' | 'core' | 'sketch' | 'first-frame';
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
| `maxRenderbufferSize: number \| null` | The largest renderbuffer width and height in pixels, or null without WebGL2. |
| `maxViewportDims: [width: number, height: number] \| null` | The largest viewport width and height in pixels, or null without WebGL2. |
| `maxUniformBlockSize: number \| null` | The largest uniform block in bytes, or null without WebGL2. |
| `sharedMemoryUploads: { bufferSubData: boolean; texSubImage2D: boolean; } \| null` | Whether WebGL accepts views on shared memory for buffer and texture uploads. Null without shared memory. |
| `floatRenderTargets: { rgba16f: { complete: boolean; readsBack: boolean; samples: number; }; rgba32f: { complete: boolean; readsBack: boolean; samples: number; }; r11fG11fB10f: { complete: boolean; readsBack: boolean; samples: number; }; } \| null` | Whether the device renders into float textures, which high dynamic range color needs. The engine tests a 16-bit and a 32-bit float RGBA texture, and the 32-bit packed format `R11F_G11F_B10F`, which holds three channels in half the bytes of the 16-bit one. `complete` says whether a framebuffer with the texture is complete. `readsBack` says whether a clear to a known color, with a value above 1, reads back as floats. `samples` is the most samples per pixel for antialiasing that the format takes, or 0 where the device does not render into it. WebGL2 renders into the three formats with `EXT_color_buffer_float`, and into the 16-bit one with `EXT_color_buffer_half_float`. The engine draws high dynamic range color where the 16-bit format passes both tests, and with MSAA takes 4 samples. Null without WebGL2. |
| `renderer: string \| null` | Reported for the record. The engine reads no meaning from it, and only compares it with an earlier start's, to tell whether a stored preset check came from the same GPU. |
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
| `transientAttachments: boolean` | True when the browser's WebGPU has the transient attachment texture usage (Chrome 146 and later). A render target with it can stay in a tile-based GPU's own memory. The engine gives it to the targets that live within one render pass, such as the multisampled color and depth. |
| `adapterInfo: { vendor: string; architecture: string; device: string; description: string; } \| null` | Reported for the record. The engine reads no meaning from it, and only compares it with an earlier start's, to tell whether a stored preset check came from the same GPU. |
| `error?: string` | Why the probe failed, when it did. |

### `WorkerProbe`

Interface `WorkerProbe`.

What a dedicated worker can do, in `CapabilityReport.worker`. A render worker needs the frame timer and an offscreen canvas for its GPU path.

| Member | Description |
| --- | --- |
| `requestAnimationFrame: boolean` | True when workers have `requestAnimationFrame`. |
| `offscreenWebGL2: boolean` | True when a worker can draw with WebGL2 into an `OffscreenCanvas`. |
| `offscreenWebGPU: boolean` | True when a worker can draw with WebGPU into an `OffscreenCanvas`. |
| `webgpuError?: string` | Why the WebGPU check failed, when it threw. The WebGL2 check's answer still holds. |

### `WorkerProbeFailure`

Interface `WorkerProbeFailure`.

Why the probe worker gave no answer, in `CapabilityReport.worker`. The engine then draws on the page's thread, and `engine.mode.renderFallback` names the reason.

| Member | Description |
| --- | --- |
| `failure: 'no-answer' \| 'failed-to-start'` | `no-answer` when neither probe worker answered within its time limit, which a stalled GPU call or a very busy machine causes. `failed-to-start` when the worker's script failed to load or run. |
| `error: string` | The failure in words. |

<!-- null3d:api:end -->
