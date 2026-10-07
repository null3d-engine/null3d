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
- `destroy()` stops the engine and its threads, and the engine cannot start again. The sketch's `onDestroy` runs first, and every later call from the sketch's code fails with [E1420](../errors/E1420.md). Wait for its promise before you start another engine on the same page. The browser frees the engine's memory only then.
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

[The API reference](reference/engine.md) lists every export of this page with its type and description. The engine's doc comments make it.
