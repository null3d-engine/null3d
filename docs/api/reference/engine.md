---
id: api/reference/engine
title: "Page API: createEngine: API reference"
status: generated
since: "0.1"
summary: "Every export of the Page API: createEngine API, from the engine's doc comments."
---

# Page API: createEngine: API reference

> [Page API: createEngine](../engine.md) explains these exports. The engine's doc comments make this page.

## `CapabilityReport`

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

## `checkAddonVersion`

```ts
function checkAddonVersion(name: string, version: string): void
```

Checks that an add-on, built for `version` of the engine, runs against this engine's version, and throws E1432 when the two differ. An add-on calls it once, as its module loads, with its own package name and version. An add-on from another developer calls `checkPluginInterface` instead, with the range of plugin interface versions that it works with.

## `checkPluginInterface`

```ts
function checkPluginInterface(name: string, range: PluginInterfaceRange): void
```

Checks that an add-on from another developer works with this engine's plugin interface, and throws E1433 when the declared range does not hold `PLUGIN_INTERFACE_VERSION`. The add-on calls it once, as its module loads, with its own package name and the range it was built for.

## `createEngine`

```ts
function createEngine(options: EngineOptions): Promise<Engine>
```

Starts the engine on the page. It tests the device, picks the build and the GPU path, starts the workers, and runs the sketch module. In hold mode it also steps the sketch to the held time, then draws that frame and reads it back. It publishes the frame, or the error that stopped it, as `window.__null3dHold` for test tools. With the `?bench` switch, it publishes the running engine as `window.__null3dEngine`, where a benchmark tool calls `measure`.

## `DepthMode`

```ts
type DepthMode = 'reversed' | 'reversed-gl' | 'standard';
```

How the GPU path stores depth. In `reversed` depth, the near plane stores 1 and the far plane 0, in a 32-bit float depth buffer. That keeps depth precise far from the camera. WebGPU always draws it. WebGL2 draws it where the browser has the `EXT_clip_control` extension, which gives WebGL2 the depth range from 0 to 1 that WebGPU has. The `reversed-gl` mode keeps the same order, but in WebGL2's own depth range from -1 to 1, which loses most of the precision. In `standard` depth, the near plane stores 0, as in three.js's WebGL renderer.

## `DrawPathReason`

```ts
type DrawPathReason =
	| 'probe-faster'
	| 'probe-not-faster'
	| 'probe-failed'
	| 'not-apple-gpu-in-webkit'
	| 'software-renderer'
	| 'no-probe'
	| 'forced'
	| 'webgl2';
```

Why WebGPU draws on the path that the engine takes, in `engine.capabilities.drawPath`: - `probe-faster`: the start-up probe ran on an Apple GPU in WebKit and measured direct draws to be clearly faster, so the engine draws directly. - `probe-not-faster`: the probe ran there, and direct draws were not clearly faster. - `probe-failed`: the probe ran there and could not measure, as when the device was too slow or was lost. - `not-apple-gpu-in-webkit`: the device is not an Apple GPU in Safari or in a browser on iPhone or iPad. The probe did not run, and the engine draws indirectly. - `software-renderer`: the browser draws on the CPU. The probe did not run. - `no-probe`: the worker's WebGPU check gave no answer. - `forced`: `?direct=on` or `?direct=off` chose the path. - `webgl2`: the engine draws with WebGL2, which always draws directly.

## `Engine`

Interface `Engine`.

A running engine, as `createEngine` returns it.

| Member | Description |
| --- | --- |
| `readonly capabilities: EngineCapabilities` | The GPU path the engine chose, and what it offers. |
| `readonly report: CapabilityReport` | The full capability report, as plain JSON. |
| `readonly mode: EngineMode` | How the engine runs on this device. |
| `readonly firstFrame: Promise<void>` | Resolves once the GPU has finished the first frame, so it is on screen: the moment to remove a loading screen. It never resolves when the engine is destroyed first. |
| `readonly labels: EngineLabels` | The HTML elements that follow the labels the sketch tracks with `ui.trackLabel`. |
| `registerVideo(video: HTMLVideoElement, options: VideoOptions): () => void` | Shows a video element on the page as a texture in the sketch, which makes it with `textures.fromVideo(name)`. The page sends the image of each frame that the video presents, as an `ImageBitmap` of the size that the options allow, and the sketch uploads it in its turn, within the frame's upload budget. The sketch asks for the frames when its texture follows the video, so a video that no texture shows sends none, and a paused video presents no frame, so it costs nothing. Returns a function that stops the frames, which the video's texture then keeps the last frame of. Throws E1213 for a name that another video holds, or an option out of range. |
| `postToSketch(name: string, data?: unknown, transfer?: Transferable[]): void` | Sends a message to the sketch, which receives it through `ctx.page.onMessage`. |
| `onSketchMessage(handler: (name: string, data: unknown) => void): () => void` | Receives the messages the sketch sends with `ctx.page.post`. When no handler listened from the start, the first handler also receives the messages sent before it was registered. Returns a function that removes the handler. |
| `onFailure(handler: (error: EngineError) => void): () => void` | Receives a failure after the engine started: the browser took the GPU away and the engine could not carry on with a new device (E1302), or an engine thread failed (E1404). A custom shader's builds that a pipeline needs and that did not download fail the thread that draws with E1424. After E1404 or E1424 the engine draws no new frames: destroy it and start a new one. On WebGPU, the GPU can also run out of memory (E1304) or reject the engine's work (E1305), and the engine draws on without the objects that failed. The engine reports each failure once. A failure that no handler listened for when the engine reported it reaches the first handler that listens, so a failure that the app could not hear yet still arrives, and the engine also logs it to the console. A failure that ends the frames reaches these handlers before `onStop`'s. Returns a function that removes the handler. |
| `onStop(handler: () => void): () => void` | Calls `handler` once, when the engine stops drawing for good: as `destroy()` begins, or at a failure after which it draws no new frames (E1302, E1404 or E1424). At such a failure, the `onFailure` handlers hear it first. A handler added after that runs at once. A handler that throws reaches the console, and the other handlers and the stop go on. Use it to end the page's own work for the engine, such as a frame loop that sends the sketch messages. Returns a function that removes the handler. |
| `onSketchError(handler: (error: Error) => void): () => void` | Receives each distinct error that the sketch's own code, or a core call in a frame, threw while the engine runs. The engine keeps drawing, so this error alone does not stop it: a frame whose update failed is counted in `measure().updateErrors` and left out of `measure().updatedFps`. The handler receives the errors reported after it was added. Returns a function that removes the handler. Without a handler, the error also reaches the console. |
| `setPaused(paused: boolean): void` | Pauses or resumes the sketch's frames. A pause also stops input: the sketch sees every key and button that was down come up, and input that comes during the pause never reaches it. |
| `detach(): void` | Takes the canvas off the page and pauses the engine. The engine keeps its threads, its GPU resources and the scene, and stops reading input. Use it when a single-page app leaves the view that shows the canvas, and `attach` when the view comes back. |
| `attach(container: Element): void` | Puts the canvas at the end of `container` and resumes the engine where it stopped, unless `setPaused(true)` paused it. |
| `measure(seconds: number, options?: MeasureOptions): Promise<FrameMetrics>` | Measures the running engine for a number of seconds, then returns CPU time per frame by thread and phase, GPU time, frame intervals, uploads, draw calls, memory and load time. The first call downloads the code that turns the frame records into these figures. `slowMs` adds the frames whose interval broke that many milliseconds, each with the frame's own GPU parts. |
| `stats(show?: boolean \| StatsOverlayOptions): void` | Shows an overlay of figures over the top-right corner of the canvas, or hides it with `false`: the GPU path, the frame rates, CPU time per frame of each thread, GPU time, draw calls, triangles and objects drawn, memory, and the page thread's long tasks and input delay. Its header is a button with the frame rate, which shows and hides the other figures. Options pick whether the overlay starts collapsed to its header; a call on a shown overlay changes the options it names. The page draws the overlay and updates it a few times a second, and its code downloads at the first call. While the other figures show, the engine times one frame in eleven on the GPU and reads back the counts of the objects that the GPU culls, which costs a little GPU time. The sketch's `debug.stats` shows and hides the same overlay, and the last call wins. |
| `capture(): Promise<Blob>` | Resolves with an image of the next frame that the engine draws, as a PNG file. The thread that draws reads the frame back and encodes it, so the page's thread does no work for it when a worker draws. In hold mode it is an image of the held frame, whose pixels the page keeps, so the GPU draws nothing for it. While the engine is paused, the image shows the frame on the canvas. A hidden page draws no frames, so its image comes once the page shows again. When no new frame comes within a second or two, as after a sketch error, the image shows the frame drawn last. Fails with E1414 once the engine has stopped, when the thread that draws gives no answer within the engine's wait, or when that thread could not read the frame back, with the cause that the GPU gave, such as a lost device or too little memory. |
| `captureFrame(): Promise<{ width: number; height: number; pixels: Uint8Array; frame: number; }>` | Resolves with the pixels of the next frame that the engine draws, as RGBA8 rows, top row first, for tests. The thread that draws waits until its frame loop has taken a new frame, then draws that frame again offscreen and reads it back, so captures back to back give newer frames even where each readback holds that thread up. `frame` is the sketch frame that the capture drew: a capture that follows a scene change can hold the frame recorded before it, and a test that measures frames aligns them by this number. In hold mode, and while the engine is paused, it returns the frame on the canvas. A hidden page draws no frames, so its pixels come once the page shows again. When no new frame comes within a second or two, as after a sketch error, it returns the frame drawn last. It fails when the thread that draws gives no answer within the engine's wait, rather than waiting with no end. |
| `saveRecording(): Promise<Uint8Array \| undefined>` | Resolves with the recording of the session so far, or undefined when the page does not record one. A page records with the `?record` switch, which also puts a save button on the page. The file holds each frame's step and the input that the sketch read in it, from the session's first frame, so a `?replay` of it draws the same frames. Its format is the engine's own; save it to a file and open `?replay=<file>` to run it. Recording seeds the sketch thread's random numbers, so a recorded session draws the same frames when it replays. |
| `simulateGpuLoss(): void` | Acts out a loss of the GPU, as a driver reset causes. The engine starts a new GPU device and draws the whole scene again, as it does after a real loss. Use it to test how your page handles one. |
| `requestPointerLock(options?: PointerLockOptions): Promise<void>` | Locks the pointer to the canvas, for first-person controls and games that turn with the mouse. The browser hides the pointer, and the sketch's `input.pointer.dx` and `dy` give the mouse's movement, with no edge to stop it. Call it in a click or key handler: browsers lock the pointer only right after the user acts. Resolves once the lock begins. Fails with E1425 when the browser refuses it, and with E1426 on an engine started with `input: false`, which reads no movement. The user ends the lock with Esc, and the page with `document.exitPointerLock()`. Stopping the engine ends a lock that it took or that its input read. |
| `destroy(options?: { release?: boolean; }): Promise<void>` | Stops the engine and its workers. The engine cannot start again. The sketch's `onDestroy` runs first, and later calls from the sketch's code fail with E1420. The thread that draws destroys the engine's GPU textures and buffers and its GPU device, so the GPU's memory comes back at once. It also leaves the canvas blank, at its size, because Safari keeps the GPU memory of a canvas's last frame until the canvas shows another. The promise resolves once every worker has stopped. Wait for it before you start another engine on the same page: an iPad has room for only a few engines' memory. A new engine can start on the same canvas, with the same thread options; `createEngine` waits for this stop. The page keeps the memory that the engine's threads shared for about 30 seconds, and the next engine with the same memory maximum takes it. A page that destroys and creates the engine again, as React's strict mode, a route change or a hot reload does, then asks the browser for no new memory. Safari can refuse new memory for some seconds after a page drops some. The page keeps at most 2 memories, and the RAM that they hold stays taken until a new engine takes one or their time ends. `{ release: true }` lets the browser free them at once: use it when the page will not start the engine again soon. |

## `EngineCapabilities`

Interface `EngineCapabilities`.

The GPU path the engine chose, and what it offers.

| Member | Description |
| --- | --- |
| `tier: Tier` | The GPU path the engine draws with. |
| `threaded: boolean` | True when the engine runs the threaded build. |
| `features: string[]` | The optional features of the GPU path: WebGPU features, or the WebGL2 extensions present. |
| `limits: Record<string, number \| null>` | The WebGPU limits, or an empty object on WebGL2. |
| `hdr: boolean` | True when the scene draws high dynamic range color, which the final pass tone maps into the canvas. False on the 8-bit path, where each shader tone maps its own output: in WebGPU's compatibility mode with MSAA, and on WebGL2 devices whose float targets fail the engine's test. Both paths show the same colors. Edges differ a little with MSAA, because the 8-bit path averages the samples after the tone mapping. It reports the path that the engine started on: in compatibility mode, bloom moves the engine to HDR color with FXAA when a sketch turns it on, and so does a `subsurfaceSamples` setting above 0 that the page or the sketch gives. |
| `halfPrecision: boolean` | True when the scene shaders do their color math at half precision: lighting, tone mapping and sRGB encoding. On WebGPU it needs the device feature `shader-f16`, and WebGL2 runs that math at `mediump`. Positions, depth and shadow lookups keep full precision either way. |
| `maxInstances: number` | The most objects and instance rows, counted together, that a scene can draw on this device. On WebGPU every device draws at least 2,097,152, and a device with larger GPU buffers draws more, up to 8,388,480. On WebGL2 the number follows the largest texture the device allows: 2,097,152 at 4,096 pixels, and 1,048,576 at the 2,048 that every WebGL2 device allows. Engine memory can run out first: see E1109. |
| `maxCanvasSize: number` | The widest and tallest drawing buffer, in device pixels, that the GPU path draws into: 8,192 on WebGPU, 4,096 in its compatibility mode, and on WebGL2 the smallest of the device's texture, renderbuffer and viewport limits. A canvas larger than that at the screen's pixel ratio draws at a lower ratio, which `engine.viewport.pixelRatio` in the sketch reports. |
| `depth: DepthMode` | How the GPU path stores depth. WebGPU, and WebGL2 in browsers with `EXT_clip_control`, draw `reversed` depth, which stays precise far from the camera. |
| `directDraws: boolean` | True when the engine culls buckets on the CPU and draws each one directly. The start-up probe picks this path only on an Apple GPU in Safari, or in any browser on iPhone and iPad, and only when it measures direct draws to be clearly faster there. Every other device draws indirectly. False on WebGL2, which always draws directly. |
| `drawPath: DrawPathReason` | Why the engine takes its draw path, such as `not-apple-gpu-in-webkit` where the probe did not run. A benchmark records it beside its figures. |

## `EngineError`

Class `EngineError`, which extends `Error`.

An error the engine throws. Its message says what failed and how to fix it, and links to the code's docs page. A thread's first error loads the text of the fixes; until it arrives the message holds the code and the detail alone, and the fix then replaces it.

| Member | Description |
| --- | --- |
| `readonly code: ErrorCode` | The error's code, such as `E1108`. |
| `readonly docs: string` | The docs page for this code. |

## `EngineMode`

Interface `EngineMode`.

How the engine runs on this device: its build, its latency mode and its threads.

| Member | Description |
| --- | --- |
| `build: 'threaded' \| 'single'` | With `threaded`, the sketch and the render step run in workers, helped by job workers. With `single`, everything runs on the page's thread, for pages without shared memory. |
| `latency: LatencyMode \| 'single'` | The latency mode in use, or `single` for the single-thread build. A page that runs the sketch and draws steps the sketch right before each draw, which is `low`. |
| `sketchThread: SketchThread` | The thread that runs the sketch and the engine core. |
| `renderThread: 'render-worker' \| 'sketch-worker' \| 'main'` | The thread that owns the canvas and draws. |
| `jobWorkers: number` | The most job workers that share the engine's parallel work. The engine starts none at first, and starts them as the work grows. |
| `hold: number \| null` | The sketch time in seconds that hold mode holds the sketch at, or null for a live engine. |
| `preset: QualityPreset` | The quality preset that the engine runs. The preset check can lower it before `createEngine` resolves, and `ctx.quality.setPreset` in the sketch changes it later. |
| `presetCheck: PresetCheck \| null` | What the preset check measured, or null when no check ran. The engine checks the preset when it chose it from the device: after the first frame, it measures the frame rate of the scene that the setup built, and lowers the preset until one holds the target. A later start of the sketch in the same browser on the same device takes the stored result instead, and starts at its preset. `reused` is then true. |
| `crashedStarts: number` | The starts of this sketch before this one that crashed the tab, one after another, as the engine's note in `localStorage` records them. After one, the engine starts a preset lower, and after two at `low`. |
| `memoryMaximumMiB: number \| null` | The shared memory's maximum in MiB, or null for the single-threaded build, whose memory is not shared. |
| `renderFallback: RenderFallback \| null` | Why the page draws when a worker was meant to, or null when the thread that draws is the one that the options asked for. `report.worker` holds the probe's answer. |
| `keepTextureCopies: boolean` | True when the engine keeps its copy of each texture's texels after their upload, so a map comes back after the GPU is lost. It is on for a phone and a tablet, and the page's `keepTextureCopies` option can name either value. |

## `EngineOptions`

Interface `EngineOptions`.

Options for `createEngine`.

| Member | Description |
| --- | --- |
| `canvas: HTMLCanvasElement` | The canvas to draw into, sized by CSS. On a canvas that no CSS sizes, the engine sets the CSS width and height that it shows when the engine starts. One engine draws on a canvas at a time: a start on the canvas of an engine that is stopping, or still starting and then destroyed, waits for that engine to stop. A canvas whose engine runs on fails with E1419. |
| `sketch: URL \| string` | The sketch module, which runs in the sketch worker; `new URL('./sketch.ts', import.meta.url)`. |
| `preset?: 'auto' \| QualityPreset` | The quality preset: `auto`, the default, lets the engine choose one for the device, and `low`, `medium`, `high` or `ultra` names one. The GPU path caps it: WebGL2 and WebGPU's compatibility mode run at most `medium`. After a start that crashed the tab, the engine starts a preset lower. Another value fails with E1213. The `?preset=` switch wins over it. |
| `targetFps?: TargetFps` | The frame rate that the engine defends: the preset check and the quality governor lower the quality when frames fall below it. Without it, the target is the display's refresh rate, at most 60. `display` targets the display's full rate, such as 120 or 144 for a game on a fast display. A whole number from 1 up caps the target at that rate. The engine draws at the display's rate in every case. The `?target-fps=` switch wins over it. Another value fails with E1213. |
| `maxPixelRatio?: number` | Cap for the device pixel ratio, a number from 0.5 up. Without it, the quality preset sets the cap. `ctx.quality.set` changes it during play. |
| `gpu?: 'auto' \| 'webgpu' \| 'webgl2'` | Forces a GPU tier, for testing only. |
| `powerPreference?: 'high-performance' \| 'low-power'` | Which GPU to draw with on a device that has two, such as a laptop with a separate graphics chip: `high-performance`, the default, for the faster one, or `low-power` to save battery. The browser treats it as a request. A device with one GPU ignores it. |
| `latency?: LatencyMode` | The latency mode. The default is `pipelined`. Low latency needs a worker that draws: where no worker can draw, the engine runs in pipelined mode, and `engine.mode` says so. |
| `antialias?: 'msaa' \| 'fxaa' \| 'none'` | How the engine smooths the edges of what it draws: `msaa` draws 4 samples per pixel, `fxaa` smooths edges in the final pass, and `none` leaves them sharp. Without it, the quality preset sets the mode: FXAA on Low, MSAA from Medium up. Each mode works on every GPU path, and the mode stays fixed while the engine runs. Another value fails with E1213. |
| `shadowCascades?: number` | The cascades of a directional light's shadows, a whole number from 1 to 4, for each light whose `shadow` options name none. Without it, the quality preset sets it. Another value fails with E1213. |
| `shadowMapSize?: number` | Texels on each side of each cascade's shadow map, for each directional light whose `shadow` options name no `mapSize`: 512, 1,024, 2,048 or 4,096. Without it, the quality preset sets it. Another value fails with E1213. |
| `shadowTiles?: number` | The most tiles of the shadow atlas that spot and point lights cast their shadows into, a whole number from 0 to 24. Without it, the quality preset sets it. 0 turns the shadows of spot and point lights off. Another value fails with E1213. |
| `shadowTileSize?: number` | Texels on each side of each tile of the shadow atlas: 256, 512, 1,024 or 2,048. Without it, the quality preset sets it. Another value fails with E1213. |
| `heroTileSize?: number` | Texels on each side of the tile that holds a directional light's hero shadow, for each light whose `shadow` options name no `heroTileSize`: 1,024, 2,048 or 4,096. Without it, the quality preset sets it. Another value fails with E1213. |
| `pointLightShadows?: boolean` | True makes point lights cast shadows, false keeps them from it. Without it, the quality preset decides: High and Ultra turn them on. Another value fails with E1213. |
| `depthPrepass?: boolean` | True to draw the depth of the opaque objects before the engine shades them, so each pixel is shaded once, for its nearest surface. It saves GPU time in scenes where objects hide many others and shading costs much, and costs a second pass over the objects' vertices. Without it, the quality preset decides: every preset draws the prepass on WebGL2, and none on WebGPU. The prepass stays fixed while the engine runs, and the `?prepass=on` or `?prepass=off` switch wins over this option. Another value fails with E1213. |
| `momentTransparency?: boolean` | True to blend the camera's blended surfaces in the moment transparency layer. It needs no sort and is nearer an exact back-to-front blend than `blending: 'weighted'` is, and it draws those surfaces twice. Every preset leaves it off, and the `?moments=on` or `?moments=off` switch wins over this option. It stays fixed while the engine runs. Another value fails with E1213. |
| `gpuOcclusion?: boolean` | True to run GPU occlusion culling on WebGPU: large opaque objects hide the objects that lie wholly behind them, so the GPU skips those. Each camera view draws the depth of the opaque objects that it showed in the last frame and that look large on the screen, and tests every object against it. `setOccluder(false)` keeps an object out of them. A check during play turns the extra passes off while they hide too little or make the GPU's frame longer, and on again when they pay. Without the option, the High and Ultra presets turn it on for desktops, and phones and tablets leave it off. It stays fixed while the engine runs, and the `?occlusion=on` or `?occlusion=off` switch wins over this option. WebGL2 and the depth prepass draw without it. Another value fails with E1213. |
| `morphTargets?: number` | The most morph target weights of each object that a WebGL2 device draws, a whole number from 1 to 256. Each object keeps the weights farthest from 0. Without it, the quality preset sets it. WebGPU draws every weight. Another value fails with E1213. |
| `cloudSteps?: number` | The steps of each ray of the sky's volumetric cloud tier when the engine starts, a whole number from 0 to 64. Above 0 the sky draws volumetric clouds in place of the flat layer, from the same cloud settings; 0 draws the flat layer. Without it, the quality preset sets it: 0 on Low and Medium, 32 on High and 48 on Ultra. It lets a page on WebGL2 or in compatibility mode, whose presets stop at Medium, draw the tier. The sky's environment map marches at most 16 steps, and draws them only when this option is above 0, because the map picks its tier's shaders at the page's start. A sketch can change the sky's count during play with `quality.set`. Another value fails with E1213. |
| `softwareOcclusion?: boolean` | True to run software occlusion culling on WebGL2: objects that `setOccluder(true)` marks hide the objects that lie wholly behind them, so the GPU skips those. False turns it off. Without it, the quality preset decides, and a sketch can change it during play with `quality.set`. The `?occlusion=on` or `?occlusion=off` switch wins over this option. WebGPU ignores it. Another value fails with E1213. |
| `textureMemoryMiB?: number` | The GPU memory in MiB that textures may take, a whole number from 64 to 16,384. Past it, the engine drops the largest mip levels of textures from files, and loads them again once room returns. Without it, the quality preset sets it: 256, 512, 1,024 or 2,048 from Low to Ultra, and at most 1,008 on phones and tablets. A sketch can change it during play with `quality.set`. Another value fails with E1213. |
| `keepTextureCopies?: boolean` | True keeps the engine's copy of each texture's texels after their upload, so a texture that maps an image draws with its map again after the browser takes the GPU away. It costs about one more copy of each image in memory. False frees each copy once no frame reads it, and such a texture draws with its color alone until the sketch gives it texels again. Without this option, a phone and a tablet keep copies and a desktop does not, because a phone or a tablet is likeliest to lose its GPU. |
| `transparent?: boolean` | True for a see-through canvas: the page shows through wherever no object draws, until the sketch sets a background color. The canvas holds premultiplied alpha, as a browser composites it. The default is false, an opaque canvas. |
| `hdr?: boolean` | False draws the scene into 8-bit color, where each material's shader applies the output transform, instead of HDR color, which the final pass tone maps. Both paths honour a material's `toneMapped: false`, and the 8-bit path also honours it on a blended surface. The default lets the engine pick the path from the device, which draws HDR color wherever it can. The `?hdr=off` switch takes the 8-bit path too. |
| `largeWorld?: boolean` | True for scenes that reach far beyond a city, such as a planet. Object positions then keep the precision of JavaScript's numbers at any distance from the origin: 0.03 mm or better. Without it, positions are 32-bit floats, which move in steps of 6 cm at 1,000 km from the origin and 0.5 m at the Earth's radius. It costs 12 bytes of memory per object and a little work in each position setter. The default is false. Instance batches need no mode: give each one an `origin` near its rows. |
| `sketchThread?: SketchThread` | The thread that runs the sketch's code and the engine core: `worker`, the default, or `main` for the page's main thread, where the sketch can reach the DOM. Use `main` for apps that work mostly with the DOM, and for debugging. The render worker still draws in pipelined mode, and the page draws in low-latency mode. The sketch's frames then share the page's thread with the page's own work, so each can slow the other. The single-threaded build always runs the sketch on the page's thread. The `?sketch-thread=` switch wins over this option. |
| `memory?: { maximumMiB: number; }` | The engine's memory. `maximumMiB` sets the most memory that the engine's threads share, in MiB: a whole number from 256 to 4096, 1024 by default. Another value fails with E1409. The browser reserves address space for the whole maximum when the engine starts. So a larger maximum leaves less room for other engines and WebAssembly modules on the page. Ask for more only when a scene needs it. The single-threaded build's memory is not shared, so this option does not change it. The `?memory=<MiB>` switch wins over it. |
| `maxLabels?: number` | The most HTML labels that the sketch can track at once with `ui.trackLabel`: a whole number from 1 to 65,536, 4,096 by default. Another value fails with E1213. The engine keeps three tables of 16 bytes per label in memory that its threads share, so 4,096 labels take 192 KB. |
| `maxLabels3d?: number` | The most labels that the sketch can track at once with `ui.trackLabel` whose `transform` is `'world'` or `'billboard'`: a whole number from 0 to 65,536, 256 by default. Another value fails with E1213. Each of them is a plane of the scene, which takes three tables of 52 bytes per label, so 256 of them take 40 KB. A sketch that tracks one more fails with E1219. |
| `expectedObjects?: number` | The number of objects that the scene will hold at most, when the sketch knows it: a whole number from 1 to 1,048,575. Another value fails with E1213. The scene then starts with room for that many, so it never grows during play. Without it, the scene starts with room for 1,023 objects. A scene grows on its own when it needs more: it doubles its room at the start of a frame once it is three quarters full. A create call that finds it full doubles it at once. Each growth copies the scene's tables, about 267 bytes per object, in one short pause. Set this option for a scene that creates many objects during play, so they never wait for one. |
| `onProgress?: (stage: StartupStage, progress?: StartupProgress) => void` | Called as the start reaches each stage, in this order: `core-download` as the engine core's file downloads, with the bytes that have arrived; `core` once the engine core is compiled and the GPU paths are tested; `sketch` once the sketch's setup has run; and `first-frame` once the GPU has finished the first frame. Before `core`, `core-download` reports the core file's bytes, and `memory-wait` comes when the browser has refused the engine's memory for 10 seconds. The engine then tries for about 35 seconds more before it fails with E1109. `progress` gives a stage's figures while it has some: the bytes of a download, measured against the length that the server announced. |
| `onSketchMessage?: (name: string, data: unknown) => void` | Receives the messages the sketch sends with `ctx.page.post`, from the start of the sketch's setup. Use it for progress that the sketch reports while it loads. `engine.onSketchMessage` adds more handlers once the engine has started. |
| `onSketchError?: (error: Error) => void` | Receives each distinct error that the sketch's own code, or a core call in a frame, threw while the engine runs. The error's message holds the failure, such as `E1102: ...`. The engine keeps drawing and presenting frames, so the error alone does not stop it: a frame whose update failed is counted in `measure().updateErrors` and left out of `measure().updatedFps`. `engine.onSketchError` adds more handlers once the engine has started. Without a handler, the error also reaches the console. |
| `onWorkerRetry?: (worker: string, script: string) => void` | Called when a worker's script did not load before the worker's first message, and the engine started a second copy of it. The fault comes and goes, so the engine recovers on its own: the call names the worker, such as `render` or `job 2`, and the address of its script. The engine also warns in the console. Without a second copy that loads, the start fails with E1405, which names the worker and its script. |
| `signal?: AbortSignal` | Cancels a start in progress, for example when the user leaves the page. `createEngine` then stops the engine's threads and rejects with the signal's reason. |
| `hold?: number` | Starts the engine in hold mode for image tests, held at this many seconds of sketch time. The engine steps the sketch from 0 to the time in fixed steps of 1/60 second, with no frame loop. `math.random` and `Math.random` in the sketch's thread give the same numbers on every run, and the sketch gets no input: every key and button stays up. The engine then draws that one frame and reads it back, and `createEngine` resolves. The `?hold=<seconds>` switch overrides this time, and a bare `?hold` holds at it, or at 0 without it. |
| `input?: boolean` | False keeps the engine from listening for input, for a page whose input another library records, such as a game whose simulation replays a log of it. The engine's input then adds no listener: none for pointers, keys, the wheel, focus, page visibility, the pointer lock or gamepads. It captures no pointer on the canvas, and leaves the canvas's context menu to the browser. The engine keeps its listeners that take no input, such as the canvas watch's `visibilitychange`, after which the sketch's next step counts no hidden time. The sketch's `ctx.input` stays at rest: every key, button and action is up, `value` gives 0, `input.touches` is empty, and the pointer stays at the canvas's top-left corner with no movement, wheel or buttons. Objects get no pointer events, and `requestPointerLock` fails with E1426. A development build warns in the console, once for each kind, when the sketch reads `ctx.input`, gives an object a pointer event handler or imports `@null3d/controls`. The warning about the controls comes as they load in the sketch's thread, so it misses controls that another sketch in that thread loaded first. Two engines on the page's thread both hear a load by either one's sketch. The default is true. |
| `preload?: readonly ShaderFeature[]` | Features whose shaders load before the first frame, for a game that must fetch nothing while it plays. Each feature's shaders otherwise download the first time the sketch uses it: `'skinning'` with the first skinned mesh, `'morph'` with the first morphed mesh, `'bloom'` and `'ao'` when `post.set` turns them on, `'sprites'` and `'lines'` with the first batch, `'background'` with a texture, environment or cube map background, `'sky'` with the sky, `'coverage'` with the first masked material that MSAA smooths, `'hash'` with the first hashed material, `'cutout'` with the first masked object that casts shadows, which casts none until its shaders are built, `'transmission'` with the first material that lets light through, `'color_copy'` with the first step that reads the color of the frame before, which the preset's bounce light draws at its start, `'translucency'` with the first material that lets light through to its other side, `'subsurface'` with the first material with a `subsurfaceRadius` while the subsurface blur has taps, `'coat_sheen'` with the first material with a clear coat or a sheen, `'weighted'` with the first material of the `weighted` blending, and `'occlusion'` with the first opaque object that may hide others while GPU occlusion culling runs on WebGPU. WebGPU morphs in the skinning pass, so there `'morph'` loads the skinning shaders, and WebGL2 has no `'occlusion'` shaders to load. Listed features download beside the engine's own shaders, so the start waits only for the largest. The shaders that two or more listed features need together, such as a skinned mesh's with the alpha hash, download with them. Loading a glTF file with skins or morph targets, or making a batch, also starts its feature's download at once, before the objects draw. Throws E1421 for a name it does not know. |
| `stats?: boolean \| StatsOverlayOptions` | True or options show the stats overlay over the canvas from the first frame, as `engine.stats` does with the same value. The default is false. The `?stats` or `?stats=on` switch shows it too, with these options when they are given, and `?stats=off` hides it, whatever this option says. A held engine for image tests shows no overlay. |
| `still?: boolean` | False draws every frame of a view that holds still. By default such a view blends its frames into a sharper picture and then stops drawing until something changes. The `?still-camera=off` switch turns it off too, and hold mode draws without it. |

## `ErrorCode`

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
	| 'E1112'
	| 'E1203'
	| 'E1204'
	| 'E1205'
	| 'E1206'
	| 'E1207'
	| 'E1208'
	| 'E1209'
	| 'E1213'
	| 'E1214'
	| 'E1215'
	| 'E1216'
	| 'E1217'
	| 'E1218'
	| 'E1219'
	| 'E1220'
	| 'E1221'
	| 'E1222'
	| 'E1223'
	| 'E1224'
	| 'E1225'
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
	| 'E1424'
	| 'E1425'
	| 'E1426'
	| 'E1430'
	| 'E1431'
	| 'E1432'
	| 'E1433'
	| 'E1434'
	| 'E1435'
	| 'E1436'
	| 'E1437'
	| 'E1501'
	| 'E1502'
	| 'E1503'
	| 'E1504'
	| 'E1505'
	| 'E1506';
```

The code of an engine error. Each code has a docs page that gives its cause and its fix.

## `HeldFrame`

Interface `HeldFrame`.

The frame that hold mode drew and read back, as `window.__null3dHold` holds it.

| Member | Description |
| --- | --- |
| `ok: true` | True: the engine drew the held frame and read it back. |
| `time: number` | The sketch time of the frame, in seconds. |
| `frame: number` | The frame's number, counting from 1: the steps to the held time, plus one. |
| `tier: Tier` | The GPU path that drew the frame. |
| `directDraws: boolean` | True when the engine drew the frame with the direct-draw path, which culls buckets on the CPU and draws each one directly. False otherwise, as on WebGL2, which always draws directly. |
| `clusterPatches: boolean \| null` | True when the frame drew a cluster tree's patches as ranges on the job workers, and false when it drew the tree's whole levels. Null where the GPU path picks the patches itself, as WebGPU does, or where the count belongs to another frame. The engine reads it from the frame builder's culling, not from the switches. |
| `width: number` | The frame's width in pixels. |
| `height: number` | The frame's height in pixels. |
| `pixels: Uint8Array` | The frame's pixels as RGBA8 rows, top row first. |
| `stats: FrameSummary` | The held frame's figures, in the form that `engine.measure` returns: CPU time by thread and phase, draw calls, uploads and pipelines, for the held frame alone. The engine draws no frame before the held one, so the held frame creates every GPU object and uploads the whole scene. `rebuilds` and `visibleEntries` cover every step of the hold. GPU time is null, because the engine times the GPU only while `engine.measure` runs. |
| `script?: HoldScriptResult` | What a timed script's dump steps read, and the steps that failed, when the page gave a script. A step that failed stops no hold: the tool that gave the script decides what a failure means. |
| `replay?: ReplayResult` | What a replay gave, when the held frame is the last frame of a recording. |

## `HoldDump`

Interface `HoldDump`.

What a dump step read from its target.

| Member | Description |
| --- | --- |
| `at: number` | The sketch time of the step, in seconds. |
| `target: string` | The target as the step named it. |
| `path?: string` | The property path, when the step named one. |
| `value: readonly number[] \| Readonly<Record<string, unknown>>` | The property's numbers, or the object's properties by name. |

## `HoldFailure`

Interface `HoldFailure`.

The error that stopped hold mode, as `window.__null3dHold` holds it.

| Member | Description |
| --- | --- |
| `ok: false` | False: the engine stopped before it read the held frame back. |
| `code: ErrorCode \| null` | The error's code, or null for an error that has none, such as one the sketch threw. |
| `error: string` | The error's message. |

## `HoldResult`

```ts
type HoldResult = HeldFrame | HoldFailure;
```

What hold mode publishes on the page as `window.__null3dHold`: the held frame, or the error that stopped the hold. The engine publishes it the moment it knows either, so a test tool never waits out a timeout on a page that failed.

## `HoldScript`

Interface `HoldScript`.

A timed script that hold mode performs: its steps, in time order.

| Member | Description |
| --- | --- |
| `steps: readonly HoldScriptStep[]` | The steps of the script, in time order, with the sketch time at which each one happens. |

## `HoldScriptProblem`

Interface `HoldScriptProblem`.

A script step that failed, with the reason in plain words.

| Member | Description |
| --- | --- |
| `at: number` | The sketch time of the step, in seconds. |
| `step: string` | The step as it was written, such as `set "cr".position`. |
| `error: string` | Why the step failed, such as why a target is not in the scene. |

## `HoldScriptResult`

Interface `HoldScriptResult`.

What the steps of a timed script gave while hold mode performed it.

| Member | Description |
| --- | --- |
| `dumps: HoldDump[]` | What each dump step read. |
| `problems: HoldScriptProblem[]` | The steps that failed, in time order. |

## `HoldScriptStep`

```ts
type HoldScriptStep =
	| { at: number; verb: 'key'; code: string; down: boolean; }
	| { at: number; verb: 'pointer'; action: 'move' | 'down' | 'up' | 'wheel'; x?: number; y?: number; }
	| { at: number; verb: 'set'; target: string; path: string; value: readonly number[]; }
	| { at: number; verb: 'dump'; target: string; path?: string; };
```

One step of a timed script that hold mode performs while it steps the sketch. A tool gives each step the sketch time, in seconds, at which the hold performs it, and the steps come in time order.

## `LatencyMode`

```ts
type LatencyMode = 'pipelined' | 'low';
```

How the engine trades latency for speed. In `pipelined` mode, the render worker draws each frame while the sketch computes the next one. In `low` mode, the sketch worker draws each frame right after its update.

## `PLUGIN_INTERFACE_VERSION`

```ts
const PLUGIN_INTERFACE_VERSION: 1
```

The version of the plugin interface that an add-on from another developer builds against. It is a whole number, and it changes only when a stable add-on hook changes, never with every engine release. The engine's own add-ons pin the engine version instead.

## `PluginInterfaceRange`

Interface `PluginInterfaceRange`.

The plugin interface versions that an add-on from another developer works with: the lowest and the highest, both included.

| Member | Description |
| --- | --- |
| `readonly min: number` | The lowest plugin interface version that the add-on works with. |
| `readonly max: number` | The highest plugin interface version that the add-on works with. |

## `PointerLockOptions`

Interface `PointerLockOptions`.

Options for `engine.requestPointerLock`.

| Member | Description |
| --- | --- |
| `unadjustedMovement?: boolean` | True asks for the mouse's raw movement, without the speed-up that the system applies. Browsers that cannot give it refuse the lock with E1425. The default is false. |

## `readDeviceHints`

```ts
function readDeviceHints(): DeviceHints
```

Reads the device hints on the page's main thread, which workers cannot: they have no media queries and no screen.

## `RenderFallback`

```ts
type RenderFallback = WorkerProbeFailure['failure'] | 'no-surface';
```

Why the engine draws on the page's thread when its options asked a worker to draw: - `no-answer`: the probe worker, and a second one after it, gave no answer within their time limits. A stalled GPU call or a very busy machine causes this. - `failed-to-start`: the probe worker's script failed to load or run. - `no-surface`: a worker cannot draw with the GPU path here, as the browser offers no context of it for an `OffscreenCanvas` in a worker.

## `ReplayResult`

Interface `ReplayResult`.

What a replay gave, once its frames ran.

| Member | Description |
| --- | --- |
| `frames: number` | The frames that ran, which is the recording's frame count. |
| `seconds: number` | The sketch time at the end, in seconds. |
| `sketch: string` | The sketch that the recording was made with. |
| `stopped: boolean` | True when the recording stopped at its limit before the recorded session ended. |

## `ShaderFeature`

```ts
type ShaderFeature =
	| 'motion'
	| 'ao'
	| 'area_lights'
	| 'background'
	| 'bloom'
	| 'bump'
	| 'clouds'
	| 'cluster_levels'
	| 'coat_sheen'
	| 'color_copy'
	| 'coverage'
	| 'cutout'
	| 'decals'
	| 'displacement'
	| 'dof'
	| 'effect_groups'
	| 'exposure'
	| 'fog_volume'
	| 'hash'
	| 'instance_index'
	| 'lines'
	| 'lod_fade'
	| 'moment'
	| 'morph'
	| 'occlusion'
	| 'particles'
	| 'physical_sky'
	| 'picking'
	| 'probe_grid'
	| 'row_values'
	| 'single_layer'
	| 'skinning'
	| 'sky'
	| 'sprites'
	| 'subsurface'
	| 'taa'
	| 'texcoords'
	| 'translucency'
	| 'transmission'
	| 'views'
	| 'weighted';
```

A feature whose shader builds load on first use, which `createEngine`'s `preload` lists.

## `SketchThread`

```ts
type SketchThread = 'worker' | 'main';
```

The thread that runs the sketch's code and the engine core. With `worker`, the default, the sketch runs in a worker of its own. With `main`, it runs on the page's main thread, where it can reach the DOM, while the render worker draws. The single-threaded build always runs it on the page's thread.

## `StartupProgress`

Interface `StartupProgress`.

What a start stage has done, as `onProgress` reports it.

| Member | Description |
| --- | --- |
| `done: number` | How much of the stage's work is done, in `unit`s. |
| `total: number` | How much the stage expects, in `unit`s, or 0 when it knows no total: a response that announced no length, or a stage whose work is not counted. A page shows no fraction for it. |
| `unit: 'bytes'` | What `done` and `total` count. |

## `StartupStage`

```ts
type StartupStage = 'core-download' | 'memory-wait' | 'core' | 'sketch' | 'first-frame';
```

A stage of the engine's start, as `onProgress` reports it.

## `Tier`

```ts
type Tier = 'webgpu' | 'webgpu-compat' | 'webgl2';
```

The GPU path the engine draws with: core WebGPU, WebGPU in compatibility mode on devices that cannot run core WebGPU, or WebGL2.

## `VERSION`

```ts
const VERSION: '0.0.0'
```

The engine version, which the WebAssembly core and this package always share.

## `VideoOptions`

Interface `VideoOptions`.

What `engine.registerVideo` takes: the name that the sketch follows the video by, the most texels a frame may hold, and how often the page sends frames.

| Member | Description |
| --- | --- |
| `name: string` | The video's name, which the sketch's `textures.fromVideo` takes. |
| `maxSize?: number` | The most texels of the frame's widest or tallest side. The page scales each frame down to it, with the video's shape, and leaves a frame that is smaller as it is. The default is 512: a 16:9 frame of that width is 512 x 288 texels, which is 576 KiB, so one frame fits the Low preset's 2 MiB upload budget whole. A frame of 1,024 texels a side is 4 MiB, which a phone's Low preset uploads over two frames. Keep it within the sketch's `textures.maxSize`, the largest texture that the device takes. |
| `frameRate?: number` | The most frames a second that the page sends, as an upper limit: a call that comes sooner sends nothing. The default is 0, which sends each frame that the video presents. |

## `WebGL2Report`

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
| `floatRenderTargets: { rgba16f: { complete: boolean; readsBack: boolean; samples: number; }; rgba32f: { complete: boolean; readsBack: boolean; samples: number; }; r11fG11fB10f: { complete: boolean; readsBack: boolean; samples: number; }; rg16f?: { complete: boolean; readsBack: boolean; samples: number; }; } \| null` | Whether the device renders into float textures, which high dynamic range color needs. The engine tests a 16-bit and a 32-bit float RGBA texture, and the 32-bit packed format `R11F_G11F_B10F`, which holds three channels in half the bytes of the 16-bit one. `complete` says whether a framebuffer with the texture is complete. `readsBack` says whether a clear to a known color, with a value above 1, reads back as floats. `samples` is the most samples per pixel for antialiasing that the format takes, or 0 where the device does not render into it. WebGL2 renders into the three formats with `EXT_color_buffer_float`, and into the 16-bit one with `EXT_color_buffer_half_float`. The engine draws high dynamic range color where the 16-bit format passes both tests, and with MSAA takes 4 samples. It also tests the two-channel 16-bit format `RG16F`, the motion target's, for a complete framebuffer and its samples alone, as a readback waits for the GPU at every start. Null without WebGL2. |
| `renderer: string \| null` | Reported for the record. The engine reads no meaning from it, and only compares it with an earlier start's, to tell whether a stored preset check came from the same GPU. |
| `error?: string` | Why the probe failed, when it did. |

## `WebGPUReport`

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
| `directDraws: boolean` | True when the start-up probe measured the device drawing a bucket faster with direct draws than with the engine's indirect draws, so the engine draws directly. The probe runs on a worker's device, and only on an Apple GPU in WebKit, whose validation of each indirect draw the direct path removes (D-174). False on WebGL2. |
| `drawPath: DrawPathReason` | Why the probe chose that draw path, or why it did not measure. |
| `adapterInfo: { vendor: string; architecture: string; device: string; description: string; } \| null` | Reported for the record. The engine reads no meaning from it, and only compares it with an earlier start's, to tell whether a stored preset check came from the same GPU. |
| `error?: string` | Why the probe failed, when it did. |

## `WorkerProbe`

Interface `WorkerProbe`.

What a dedicated worker can do, in `CapabilityReport.worker`. A render worker needs the frame timer and an offscreen canvas for its GPU path.

| Member | Description |
| --- | --- |
| `requestAnimationFrame: boolean` | True when workers have `requestAnimationFrame`. |
| `offscreenWebGL2: boolean` | True when a worker can draw with WebGL2 into an `OffscreenCanvas`. |
| `offscreenWebGPU: boolean` | True when a worker can draw with WebGPU into an `OffscreenCanvas`. |
| `directDraws: boolean` | True when the device is an Apple GPU in WebKit and draws a bucket faster with direct draws than with the engine's indirect draws, measured on the worker's own device at start. |
| `drawPath: DrawPathReason` | Why the worker chose that draw path, or why it did not measure. |
| `webgpuError?: string` | Why the WebGPU check failed, when it threw. The WebGL2 check's answer still holds. |

## `WorkerProbeFailure`

Interface `WorkerProbeFailure`.

Why the probe worker gave no answer, in `CapabilityReport.worker`. The engine then draws on the page's thread, and `engine.mode.renderFallback` names the reason.

| Member | Description |
| --- | --- |
| `failure: 'no-answer' \| 'failed-to-start'` | `no-answer` when neither probe worker answered within its time limit, which a stalled GPU call or a very busy machine causes. `failed-to-start` when the worker's script failed to load or run. |
| `error: string` | The failure in words. |
