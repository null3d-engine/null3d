---
id: api/reference/debug
title: "Debug drawing and stats: API reference"
status: generated
since: "0.1"
summary: "Every export of the Debug drawing and stats API, from the engine's doc comments."
---

# Debug drawing and stats: API reference

> [Debug drawing and stats](../debug.md) explains these exports. The engine's doc comments make this page.

## `countPerSecond`

```ts
function countPerSecond(intervalsMs: ArrayLike<number>, seconds = Math.floor(spanMs(intervalsMs) / 1000)): number[]
```

Events in each whole second, from the intervals between them. An event falls in the second that the running sum of the intervals reaches at it. It counts the first `seconds` seconds, by default every second that has ended: the ones before the last event's second.

## `Debug`

Interface `Debug`.

Debug drawing and frame figures. The drawing calls draw lines that show where things are, such as bounds, directions and axes. Each draws for one frame only, so call it in `onUpdate` in every frame that needs the drawing. Lines are one pixel wide, and objects in front of them hide them. Colors take the same forms as material colors, and positions are in world space. The overlay of `stats` shows frame figures on the page, and `frameStats` gives the sketch the same figures. Only development builds draw. In a release build every drawing call does nothing, and the build holds none of the drawing code. The calls `stats` and `frameStats` work in every build.

| Member | Description |
| --- | --- |
| `stats(show?: boolean \| StatsOverlayOptions): void` | Shows an overlay of frame figures over the top-right corner of the canvas, or hides it with `false`: the GPU path, the quality preset, the render scale, the frame rates, CPU time per frame of each thread and phase, GPU time, draw calls, triangles and objects drawn, memory, and the page thread's long tasks and input delay. Its header is a button with the frame rate, which shows and hides the other figures. Options pick whether the overlay starts collapsed to its header. The page draws the overlay and updates it a few times a second. Its code downloads at the first call. The page's `engine.stats` shows and hides the same overlay, and the last call wins. Each call sends a message to the page, so call it when the choice changes, not in every frame. |
| `frameStats(): FrameStats` | The figures that the stats overlay shows, for the sketch: means per frame over about the last half second. Call it each time you need figures, and read them from the object it returns. It allocates nothing, so a sketch can call it every frame. Its code downloads at the first call, so the figures are 0 until about half a second after that call. The first call also turns on the figures that the engine samples, for the engine's life: GPU time on one frame in eleven, the memory of textures and meshes, and on WebGPU the counts of the objects that the GPU culls. |
| `view(view: DebugView): void` | Draws the whole scene with one debug shading in place of every material, from the next frame on, until the next call. `'lit'` draws the materials again. `'normals'` shows each surface's world-space normal as a color, and `'depth'` its distance from the camera as a gray, white at the near plane and black at the far plane. `'overdraw'` adds light for each surface that covers a pixel, so bright pixels cost the most shading. `'wireframe'` draws each triangle's edges in its material's color. `'shadows'` shows how much of the main directional light's shadow falls on each surface, as a gray: black in full shadow, white in full light. Surfaces that face away from the sun are black, and surfaces that receive no shadows are white. Debug views clear to black and use no tone mapping. Only development builds draw them: in a release build the call does nothing. A view's first frame builds its pipelines, so objects can be missing for a few frames after a change. |
| `shadowCamera(camera?: Camera): void` | Places the main directional light's shadow cascades from `camera` instead of from the active camera, from the next frame on, until the next call. The active camera still draws the frame, so it can watch from a fixed place how the cascades move as `camera` moves and turns: shadow edges that shimmer or crawl show at once. Call it with no camera to place the cascades from the active camera again. Only development builds use it: in a release build the call does nothing. |
| `line(from: Vec3Like, to: Vec3Like, color?: ColorInput): void` | Draws a line from one point to another. The default color is yellow. |
| `box(min: Vec3Like, max: Vec3Like, color?: ColorInput): void` | Draws the edges of a box that lines up with the world's axes, from its lowest corner `min` to its highest corner `max`. The default color is yellow. |
| `sphere(center: Vec3Like, radius: number, color?: ColorInput): void` | Draws a sphere as three circles around its center, one in each plane of the world's axes. The default color is yellow. |
| `arrow(origin: Vec3Like, direction: Vec3Like, length?: number, color?: ColorInput): void` | Draws an arrow from `origin` in `direction`, `length` meters long, with a head at its tip. The direction needs no unit length. The default length is 1, and the default color is yellow. |
| `axes(target: Object3D \| Vec3Like, size?: number): void` | Draws x, y and z axes, in red, green and blue, `size` meters long: at a position, or on an object. An object's axes take its position and rotation in the frame they draw in, so they never lag behind it. The default size is 1. |
| `grid(size?: number, divisions?: number, options?: DebugGridOptions): void` | Draws a square grid on the horizontal plane through its center, `size` meters wide, with `divisions` cells along each side, as three.js's `GridHelper` does. The defaults are 10 and 10. |
| `frustum(camera: Camera, color?: ColorInput): void` | Draws the space that a camera sees: its near and far planes and the edges between them, in the canvas's shape. The camera takes its place in the frame it draws in. The default color is orange, as in three.js's `CameraHelper`. |
| `light(light: DirectionalLight, options?: DebugLightOptions): void` | Draws a directional light as a square that faces its light, with an arrow in the direction its light travels. The light takes its place and direction in the frame it draws in. |
| `skeleton(object: Object3D, color?: ColorInput): void` | Draws the skeleton that animates an object, such as the copy of a model that `scene.instantiate` made: a line from each joint of the model's skins to its parent joint, in the pose of the frame it draws in. As in three.js's `SkeletonHelper`, each line is blue at the joint and green at its parent, unless `color` gives one color. An object without an animator draws nothing. |

## `DebugGridOptions`

Interface `DebugGridOptions`.

Options for `debug.grid`.

| Member | Description |
| --- | --- |
| `center?: Vec3Like` | The center of the grid. The default is the origin. |
| `color?: ColorInput` | The color of the grid's lines. The default is `'#888888'`, as in three.js's `GridHelper`. |
| `centerColor?: ColorInput` | The color of the two lines through the center. The default is `'#444444'`. |

## `DebugLightOptions`

Interface `DebugLightOptions`.

Options for `debug.light`.

| Member | Description |
| --- | --- |
| `position?: Vec3Like` | Where to draw the light, such as a place in view for a directional light, whose own position does not change its light. The default is the light's position. |
| `size?: number` | The size of the drawing in meters. The default is 1. |
| `color?: ColorInput` | The color of the drawing. The default is the light's own color. |

## `DebugView`

```ts
type DebugView = 'lit' | 'normals' | 'depth' | 'wireframe' | 'overdraw' | 'shadows';
```

A debug view of `debug.view`: the materials' own shading with `'lit'`, or one debug shading in place of every material.

## `FrameMetrics`

Interface `FrameMetrics`, which extends `FrameSummary`.

What `engine.measure` returns: the per-frame figures, memory, load time and download size.

| Member | Description |
| --- | --- |
| `seconds: number` | Length of the measurement. |
| `memory: MemoryStats` | The engine's WebAssembly memory and the JavaScript heap. |
| `load: { engineStartMs: number; probeMs: number; coreMs: number; firstFrameMs: number \| null; firstFrameDoneMs: number \| null; warmUpMs: number \| null; firstDrawMs: number \| null; firstFramePipelines: number \| null; }` | How long the engine took to start and to draw its first frame, in milliseconds. |
| `gpuLosses: number` | Times the browser took the GPU away since the engine started, and the engine carried on with a new device. `simulateGpuLoss` counts too. |
| `downloadBytes: { wasm: number \| null; }` | Bytes of the engine's WebAssembly file as the page downloaded it. |
| `lostRecords: number` | Frame records the page read too late; nonzero means some frames are missing from the figures. |
| `completionSignal: 'queue' \| 'fence'` | How the renderer learned that the GPU finished a frame: its queue (WebGPU) or a fence (WebGL2). |
| `refreshHz: number \| null` | The display's refresh rate in hertz, as the thread that draws measured it, or null before then. |
| `mainThread: MainThreadStats \| null` | The page's own thread during the measurement, where the browser reports it, or null. |
| `perSecond: SecondRates[]` | The frame rates of each whole second of the measurement, in order. A long measurement shows here when and for how long the rate fell, which the rates of the whole measurement hide. |

## `FrameStats`

Interface `FrameStats`.

Figures of the running engine, as `debug.frameStats()` returns them and the stats overlay shows them. Each figure per frame is a mean over the frames of the last window: about half a second of presented frames. The figures change when a window ends, and stay the same while the engine presents no frames.

| Member | Description |
| --- | --- |
| `readonly frames: number` | Frames that the engine presented in the window, or 0 before the first window ended. |
| `readonly seconds: number` | The window's length in seconds. |
| `readonly presentedFps: number` | Frames per second that the engine presented. |
| `readonly completedFps: number` | Frames per second that the GPU finished. Below `presentedFps`, frames queue on the GPU, and the display shows fewer than the presented rate suggests. |
| `readonly cpuMs: number` | Mean CPU time per frame of the busiest thread, in milliseconds. |
| `readonly threads: readonly FrameStatsThread[]` | CPU time per frame of each engine thread. |
| `readonly gpuMs: number \| null` | Mean GPU time per frame, in milliseconds, from the GPU's timer queries on one frame in eleven: from the frame's first command to the end of its last pass. Null where the GPU path has no timer queries, and until the first timed frame comes back. The window that has no timed frame keeps the figure of the window before it. |
| `readonly drawCalls: number` | Mean draw calls per frame, over every pass. |
| `readonly triangles: number` | Mean triangles drawn per frame, over every pass: shadow maps and the depth prepass count as well as the passes that shade, as three.js's `renderer.info` counts them. Lines count none. On WebGPU the GPU culls most objects, and the count of their triangles comes back from the GPU on one frame in eleven, a few frames late. |
| `readonly objects: number` | Mean objects drawn per frame, over every pass: each draw counts its instances, so an object counts once in each pass that draws it, such as a shadow cascade, and each part of a mesh with several materials counts once. On WebGPU the count of the objects that the GPU culls comes back from the GPU on one frame in eleven, a few frames late. |
| `readonly uploadBytes: number` | Mean bytes uploaded to the GPU per frame. |
| `readonly tier: Tier` | The GPU path the engine draws with. |
| `readonly preset: QualityPreset` | The quality preset that the engine runs. |
| `readonly renderScale: number` | The render scale of the newest frame: the share of the canvas's width and height that the scene draws at, from 0 to 1. Dynamic resolution moves it during play. |
| `readonly wasmBytes: number` | The size of the engine's WebAssembly memory at the window's end, in bytes. |
| `readonly textureBytes: number` | The GPU bytes that every texture takes at the window's end, with the free layers of their texture arrays: `quality.textureMemory.bytes`. |
| `readonly textureBudgetBytes: number` | The GPU bytes that textures may take: the quality setting `textureMemoryMiB` in bytes. |
| `readonly droppedLevels: number` | The largest mip levels that the texture memory budget dropped, over every texture. |
| `readonly meshBytes: number` | The GPU bytes that every mesh takes at the window's end: the shared vertex and index buffers, which keep room to grow, and the texture of morph target deltas, as `geometry.memoryBytes`. |
| `readonly gpuTextureBytes: number` | The GPU bytes of every texture that the engine holds at the window's end: the scene's textures, the render targets with their multisampled copies, the depth and shadow maps, the post effects' targets and the environment's maps. Each counts its mip levels, layers and samples as the GPU stores them. 0 until the thread that draws first publishes it. |
| `readonly gpuBufferBytes: number` | The GPU bytes of every buffer that the engine holds at the window's end: vertices, indices, instance rows, uniforms, the culling and indirect draw buffers, upload staging and the readbacks of the GPU's timings. 0 until the thread that draws first publishes it. |

## `FrameStatsThread`

Interface `FrameStatsThread`.

One thread's CPU time per frame, in `FrameStats.threads`.

| Member | Description |
| --- | --- |
| `readonly name: string` | The thread, named as `engine.measure` names it: `main`, `sketch-worker`, `render-worker`, `job-0` and so on. |
| `readonly busyMs: number` | Mean CPU time per frame on this thread, in milliseconds. |
| `readonly phases: Readonly<Record<PhaseName, number>>` | Mean CPU time per frame of each phase, in milliseconds: 0 for a phase that runs elsewhere. |

## `FrameSummary`

Interface `FrameSummary`.

Per-frame figures of a measurement: CPU time by thread, GPU time, frame intervals, uploads and draw calls.

| Member | Description |
| --- | --- |
| `frames: number` | Frames that the sketch computed and the renderer drew within the measurement. |
| `cpuMs: Percentiles` | CPU time per frame of the busiest thread, the time that limits the frame rate. |
| `cpuMsAllThreads: Percentiles` | CPU time per frame summed over every thread. |
| `threads: Record<string, ThreadStats>` | Per thread, by name: `main`, `sketch-worker`, `render-worker`, `job-0` and so on. |
| `gpuMs: Percentiles \| null` | GPU time per frame, where the device has timestamp queries: from the frame's first command to the end of its last pass. Where the browser cannot time the commands before the first pass, the time starts at the first pass. On WebGL2 it needs the timer queries of `EXT_disjoint_timer_query_webgl2`, which most desktop browsers offer and most phones do not, and covers the frame's commands as a whole. The engine times one frame in eleven, which keeps the cost of measuring small and takes in every turn of the far shadow cascades. |
| `gpuPassMs: GpuPassStats[] \| null` | The parts of the GPU time per frame, in the order the frame runs them: the copies before the first pass, where the browser times them, each pass that the browser times, and the time between passes in frames where it times every pass. In a frame with more passes than the engine times one by one, the last pass it times also counts the passes after it. Null where `gpuMs` is. On WebGL2 the frame has no parts, so the list is empty. |
| `gpuStepMs: number \| null` | The step between GPU times when the browser rounds its timestamps, or null when they look exact. Chrome rounds them unless its WebGPU developer features are turned on. |
| `intervalMs: Percentiles` | Time between presented frames. |
| `presentedFps: number` | Frames per second that the renderer presented. |
| `completedFps: number \| null` | Frames per second that the GPU finished. Below `presentedFps`, frames queue on the GPU, and the display shows fewer than the presented rate suggests. Null when no completion arrived. |
| `gpuLatencyMs: Percentiles \| null` | Time from a frame's submit to the GPU finishing it. The engine lets at most two frames wait unfinished on the GPU, so when the GPU falls behind, the figure grows to about two completed frame intervals. With a WebGL2 fence, the engine sees completion at its next frame callback, so the figure rounds up to frame intervals. The figure ends when the thread that draws sees the finish, so it also counts time that the thread spends blocked. In Safari, the copy of a worker's frame to the page blocks the worker until the GPU has finished the frame. |
| `uploadBytes: Percentiles` | Bytes uploaded to the GPU per frame. |
| `drawCalls: Percentiles` | Draw calls per frame. |
| `visibleEntries: Percentiles \| null` | Entries per frame in the list of visible objects on WebGL2, where the job workers cull. Each visible object or instance row is one entry. So is each visible group of 64 rows in a static batch that has stopped changing. The list uploads 4 bytes per entry in each frame that changes it. Null on WebGPU, where the GPU culls and the CPU never learns the count. |
| `occludedEntries: Percentiles \| null` | Entries per frame that software occlusion culling took out of the list of visible objects on WebGL2: objects, instance rows and groups of rows inside the camera's view that lie wholly behind blockers. Null on WebGPU, where the GPU culls. |
| `rebuilds: number` | Frames whose structure change rebuilt the draw tables: objects created or destroyed, meshes or materials changed, or batches created or destroyed. Steady play has none; showing or hiding objects and changing a batch's active count do not rebuild. |
| `pipelines: number` | GPU pipelines built during the measurement. A build can stall the frame it happens in. The engine builds its pipelines in the first frame, after a change of quality preset, and after the browser replaces the GPU, so steady play builds none. |
| `gpuObjects: number` | GPU buffers, textures, texture views, samplers and bind groups that the engine made during the measurement. Steady play makes none, and neither does a new render scale. |
| `skippedDraws: number` | Draw commands that frames skipped during the measurement because their pipeline was still building, so the objects they draw were missing from those frames. `scene.warmUp()` before new objects show, and `quality.setPreset()`, keep it at 0. |

## `GpuPassStats`

Interface `GpuPassStats`.

GPU time per frame of one part of the frame, in `FrameSummary.gpuPassMs`.

| Member | Description |
| --- | --- |
| `name: string` | The part: `copies` for the copies before the frame's first pass, a pass by its kind and its place among the passes of that kind, such as `compute 1` or `render 2`, or `between passes`. |
| `ms: Percentiles` | GPU time per frame of the part. |

## `MainThreadStats`

Interface `MainThreadStats`.

The page's own thread during a measurement: tasks that kept it busy for 50 ms or more, and the delay before the page handled input.

| Member | Description |
| --- | --- |
| `longTasks: number` | Tasks of 50 ms or more on the page's thread. |
| `longestTaskMs: number` | The longest of them, or 0 when there were none. |
| `inputDelayMs: Percentiles \| null` | Time from each input event to the page starting to handle it, or null without input. |

## `MainThreadWindow`

Class `MainThreadWindow`.

Watches the page's own thread in windows, one after another: its long tasks and its longest input delay. They come from the browser's long task and event timing entries, where the browser reports them.

| Member | Description |
| --- | --- |
| `take(): StatsMainThread \| null` | The long tasks and the longest input delay since the last call, or since the watch began, and starts the next window. Null where the browser does not report long tasks. |
| `stop(): void` | Stops watching. |

## `MemoryMeasurement`

Interface `MemoryMeasurement`.

What the browser's measurement of the page's memory, `performance.measureUserAgentSpecificMemory`, resolves with: the bytes of the whole page, and the bytes of each part, with the scope and the script address of the thread that the part belongs to.

| Member | Description |
| --- | --- |
| `bytes: number` | The memory of the whole page and its workers, in bytes. |
| `breakdown: { bytes: number; attribution: { url?: string; scope?: string; }[]; }[]` | Each part of the memory in bytes, with the threads that it belongs to. |

## `MemoryStats`

Interface `MemoryStats`.

Memory figures of a measurement.

| Member | Description |
| --- | --- |
| `wasmBytes: number \| null` | Size of the engine's WebAssembly memory at the end of the measurement. |
| `jsHeap: { bytes: number; byScope: Record<string, number>; } \| null` | JavaScript heap by global scope: the page and its workers when a measurement of them finished during the run, otherwise the page alone where the browser reports that. Chrome adds shared memory, such as the engine's own, to the figure of each worker that holds it, so worker figures overlap and can far exceed the worker's own heap. |
| `jsHeapSamples: { atSeconds: number; bytes: number; }[]` | Measurements of the page and its workers that finished during the run, for long runs. |
| `jsHeapNote: string \| null` | Why the heap figures cover only the page, or null when they also cover the workers that run JavaScript each frame. |

## `pageHeapBytes`

```ts
function pageHeapBytes(): number | null
```

The JavaScript heap of the page's own thread in bytes, from `performance.memory`, or null where the browser does not have it.

## `PageMemory`

Interface `PageMemory`.

The memory of the whole page and its workers, from the browser's own measurement, in `StatsMemory.page`.

| Member | Description |
| --- | --- |
| `readonly bytes: number \| null` | The page's memory in bytes, with a memory that several threads share counted once, or null until the first measurement ends. |
| `readonly browserBytes: number \| null` | The browser's own figure in bytes, which counts a shared memory once for each thread that holds it, or null until the first measurement ends. |

## `PageMemorySampler`

Class `PageMemorySampler`.

Samples the memory of the whole page and its workers, one measurement after another with a gap of a few seconds, where the browser offers the measurement. `page` holds the newest figures. At most one measurement is in flight on the page. When the browser leaves the first one unanswered for two minutes, the page asks no more, and `page` is null until an answer comes after all.

| Member | Description |
| --- | --- |
| `last: MemoryMeasurement \| undefined` | The newest measurement as the browser gave it, or undefined before the first. |
| `failure: string \| null` | Why the browser refused a measurement, or null. |
| `readonly page: PageMemory \| null` | The newest figures, or null where the browser offers no measurement, refused it, or left the first one unanswered for two minutes. |
| `start(): void` | Starts the samples. It does nothing where the browser offers no measurement. |
| `stop(): void` | Stops the samples. A measurement under way still ends, and its figures still count. |

## `percentiles`

```ts
function percentiles(samples: ArrayLike<number>): Percentiles
```

The median, 95th and 99th percentiles and mean of per-frame samples. It sorts a copy, so call it outside frame code.

## `Percentiles`

Interface `Percentiles`.

A summary of per-frame samples.

| Member | Description |
| --- | --- |
| `count: number` | The number of samples. |
| `median: number` | The middle value. |
| `p95: number` | The 95th percentile: 95% of samples are at or below it. |
| `p99: number` | The 99th percentile: 99% of samples are at or below it. |
| `mean: number` | The average. |

## `PhaseName`

```ts
type PhaseName =
	| 'update'
	| 'commands'
	| 'transforms'
	| 'batches'
	| 'cull'
	| 'record'
	| 'upload'
	| 'replay';
```

A step of a frame that `engine.measure` times. The `update` step is the sketch's own code, in all of its callbacks, and the other steps are the engine's.

## `ratePerSecond`

```ts
function ratePerSecond(intervalsMs: ArrayLike<number>): number | null
```

Events per second from the intervals between them: the count over the time they took, so a few long intervals lower the rate as much as they cost. Null without intervals.

## `SecondRates`

Interface `SecondRates`.

The frame rates of one second of a measurement, in `FrameMetrics.perSecond`.

| Member | Description |
| --- | --- |
| `presentedFps: number` | Frames that the renderer presented in the second. |
| `completedFps: number \| null` | Frames that the GPU finished in the second, or null when no completion arrived at all. |

## `StatsFigures`

Interface `StatsFigures`.

The figures that the stats overlay shows, in the form that `statsText` lays out. Means per frame are over the last window of frames, about half a second.

| Member | Description |
| --- | --- |
| `readonly heading: string` | The first line, such as the GPU path, the quality preset and the render scale. |
| `readonly frames: number` | Frames in the window, or 0 before the first window ended. |
| `readonly presentedFps: number` | Frames per second that reached the screen. |
| `readonly completedFps: number \| null` | Frames per second that the GPU finished, or null where the page does not know it. |
| `readonly cpuMs: number` | Mean CPU time per frame of the busiest thread, in milliseconds. |
| `readonly threads: readonly StatsThread[]` | CPU time per frame of each thread. |
| `readonly gpuMs: number \| null` | Mean GPU time per frame, in milliseconds, or null where the GPU path cannot time frames. |
| `readonly drawCalls: number` | Mean draw calls per frame. |
| `readonly uploadBytes: number \| null` | Mean bytes uploaded to the GPU per frame, or null where the page does not know it. |
| `readonly triangles: number \| null` | Mean triangles drawn per frame, over every pass, or null where the page does not know it. |
| `readonly objects: number \| null` | Mean objects drawn per frame, over every pass, or null where the page does not know it. |
| `readonly memory: StatsMemory` | The memory figures. |
| `readonly mainThread: StatsMainThread \| null` | The page's own thread, or null where the browser does not report long tasks. |

## `StatsFrameMode`

```ts
type StatsFrameMode = 'pipelined' | 'low' | 'single' | 'one-thread';
```

How the threads of a renderer share each frame's work, which a symbol before the target explains: `'pipelined'` and `'low'` are null3D's latency modes, `'single'` is null3D's single-thread build, and `'one-thread'` is a renderer that prepares and draws each frame on one thread, as three.js does.

## `StatsMainThread`

Interface `StatsMainThread`.

The page's own thread over the last few seconds, in `StatsFigures.mainThread`.

| Member | Description |
| --- | --- |
| `readonly seconds: number` | The seconds that the figures cover. |
| `readonly longTasks: number` | Tasks of 50 ms or more on the page's thread. |
| `readonly longestTaskMs: number` | The longest of them in milliseconds, or 0 when there were none. |
| `readonly inputDelayMs: number \| null` | The longest time from an input event to the page starting to handle it, in milliseconds, or null when no input came. |

## `StatsMemory`

Interface `StatsMemory`.

Memory figures in bytes, in `StatsFigures.memory`. Each is null where the page cannot know it, and the overlay then shows `n/a`.

| Member | Description |
| --- | --- |
| `readonly wasmBytes: number \| null` | The size of the engine's WebAssembly memory, which every engine thread shares. |
| `readonly gpuTextureBytes: number \| null` | The GPU bytes of every texture and render target. |
| `readonly gpuBufferBytes: number \| null` | The GPU bytes of every buffer: vertices, indices, instances, uniforms and the like. |
| `readonly jsHeapBytes: number \| null` | The JavaScript heap of the page's own thread, where the browser has `performance.memory`. |
| `readonly page: PageMemory \| null` | The memory of the whole page and its workers, from the browser's own measurement, where the browser has `performance.measureUserAgentSpecificMemory`, on a cross-origin isolated page. |

## `StatsOverlayOptions`

Interface `StatsOverlayOptions`.

Options for the stats overlay, which `debug.stats`, `engine.stats` and the `stats` option of `createEngine` take in place of `true`. A field that a call leaves out keeps its last value.

| Member | Description |
| --- | --- |
| `collapsed?: boolean` | True shows only the overlay's header, a button with the frame rate. A click or the Enter or Space key on it shows and hides the other figures. The default is false: every figure shows. |

## `StatsPanel`

Class `StatsPanel`.

The stats overlay's header and card over the top-right corner of a canvas, in the overlay's own look. The engine's overlay is one; a page that draws with another engine makes its own and fills it with its figures, so both show the same figures in the same place and look. The header's button opens and closes the card. Collapsed, the panel formats nothing but the frame rate.

| Member | Description |
| --- | --- |
| `readonly collapsed: boolean` | True while only the header shows. |
| `setCollapsed(collapsed: boolean): void` | Opens or closes the card, and tells `onToggle` when that changes. |
| `showRate(frames: number, fps: number, refreshHz: number, maxTargetFps = CHECK_MAX_FPS): void` | Shows the frame rate in the header: `frames` is 0 before the first window of frames ended. The rate is judged against null3D's target for the display's refresh rate, at most `maxTargetFps`. |
| `update(figures: StatsFigures, frame: StatsPanelFrame): void` | Shows a set of figures in the card. It does nothing while the panel is collapsed. |
| `follow(): void` | Keeps the panel on the canvas's top-right corner, and hides it while the canvas is off the page. Call it a few times a second, as the figures come. |
| `remove(): void` | Takes the panel off the page. |

## `StatsPanelFrame`

Interface `StatsPanelFrame`.

How a panel judges and lays out one set of figures, in `StatsPanel.update`.

| Member | Description |
| --- | --- |
| `readonly refreshHz: number` | The display's refresh rate in hertz, or 0 before it is measured. The panel judges the figures against null3D's target: this rate, at most `maxTargetFps`. |
| `readonly maxTargetFps?: number` | The highest target frame rate, as null3D's `targetFps` setting and a frame rate cap allow. The default is null3D's own highest target without a setting. |
| `readonly gpuTimer: boolean` | True where the GPU path can time the GPU's work. The GPU bar otherwise says "not measured". |
| `readonly mode: StatsFrameMode` | How the threads share each frame's work. |
| `readonly bothSteps?: string` | The thread, by its name in `StatsFigures.threads`, that prepares and then draws each frame, where one thread does both. Its bar holds your code, the renderer's work and the drawing. |

## `StatsPanelOptions`

Interface `StatsPanelOptions`.

Options of a `StatsPanel`.

| Member | Description |
| --- | --- |
| `collapsed?: boolean` | True starts the panel with only its header, a button with the frame rate. The default is false. |
| `onToggle?: (collapsed: boolean) => void` | Called when the panel opens or closes, with true for closed. A page samples its costly figures only while the panel is open. |

## `statsText`

```ts
function statsText(figures: StatsFigures): string
```

The stats overlay's text for a set of figures: one figure group per line, in a fixed order. A figure that the page cannot know shows as `n/a`.

## `StatsThread`

Interface `StatsThread`.

One thread's CPU time per frame, in `StatsFigures.threads`.

| Member | Description |
| --- | --- |
| `readonly name: string` | The thread's name. Threads named `job-0`, `job-1` and so on show as one line, with the busiest of them. |
| `readonly busyMs: number` | Mean CPU time per frame on this thread, in milliseconds. |
| `readonly phases?: Readonly<Record<string, number>>` | Mean CPU time per frame of each step of the frame on this thread, in milliseconds. |

## `ThreadStats`

Interface `ThreadStats`.

One thread's CPU time per frame, in `FrameSummary.threads`.

| Member | Description |
| --- | --- |
| `busyMs: Percentiles` | CPU time per frame on this thread. |
| `phases: Partial<Record<PhaseName, Percentiles>>` | CPU time per frame of each phase that ran on this thread. |
